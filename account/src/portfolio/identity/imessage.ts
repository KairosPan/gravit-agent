/** THE CONNECTED IMESSAGE CONNECTOR — iMessage through Photon's hosted relay, once the owner signed connectNetwork: Photon's event stream
 * for the project (photon-link.ts PhotonLink.stream), read into the inbox (inbox.ts) for the face's desk.
 *
 * At start, and at each reopen, the Photon user is read again (getUser): no user, or a user whose line is not the signed one, stops the
 * connector with `movedAt` — it never follows a number Photon changed on its own. Otherwise the stream opens from the cursor kept in
 * `<home>/identity/imessage.cursor` (the last sequence handled), Photon catching up from there.
 *
 * Each event, in order:
 *   - a 1:1 iMessage text from the operator's number (service "iMessage", no `;+;` in the chat GUID, not Gravit's own): appended to the
 *     inbox as `imessage:<GUID>` (with the GUID it replies to) if the Chat with Gravit row ticks iMessage — or if it is one of the phone's
 *     commands, which the desk reads whatever the row says; else answered with the chat-off line and kept nowhere;
 *   - anything else from the operator in that 1:1 chat (a photo, a voice note) is answered "text only, please" and kept nowhere;
 *   - a 1:1 iMessage from anyone else, the operator's own email handle included: counted in Not you unless blocked, never answered;
 *     A text whose GUID is blank, or whose `imessage:<GUID>` fails WIRE_ID (kinds.ts), is not stored — the face would drop it — and is said
 *     in a line at most once a minute; a reply-to GUID that fails it is left off;
 *   - an SMS or an RCS message, from anyone, the operator's number included: dropped, said in a line at most once a minute;
 *   - a group, Gravit's own message, and every other event: dropped.
 * Only then does the cursor move past it. A text the inbox cannot store closes the stream there, the cursor before it, and the stream is
 * opened again after a backoff, so Photon hands it over again. A GUID the inbox holds, or a sequence at or below the cursor, is skipped.
 *
 * Health: a heartbeat or an event is `lastPollAt`, and clears `pollFailing` and the backoff. A check every 30 s that finds no sign for
 * HEARTBEAT_STALE_MS is `pollFailing`: the stream is closed and opened again after 5 s, doubling to 60 s. A failure Photon reports reads
 * the same way, but an auth failure retries at 60 s each time. A cursor Photon pruned is `gapAt`, and the stream goes on. The project's
 * secret is in none of this: PhotonError's messages carry none, and the log the connector is given is the identity's, which redacts. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Connector, Transport } from "./identity.ts";
import type { InboxRing } from "./inbox.ts";
import { chatOffLine, WIRE_ID } from "./kinds.ts";
import { isGroupChat, PhotonError, type PhotonEvent, type PhotonLink, type PhotonMessage, type PhotonProject, type PhotonStream } from "./photon-link.ts";
import { secretsOf, type ImessageSecret } from "./secret-file.ts";
import { identityDir, senderRef, writeIdentityFile, type Binding, type Strangers } from "./store.ts";
import { BACKOFF_FIRST_MS, BACKOFF_MAX_MS, PHONE_COMMAND, RECORD_EVERY_MS, TEXT_ONLY, type IdentityClock, type NetworkStatus } from "./telegram.ts";

export const IMESSAGE_CURSOR_FILE = "imessage.cursor";
/** no heartbeat and no event for this long: the stream is taken for stalled */
export const HEARTBEAT_STALE_MS = 120_000;
/** how often the stream's last sign is looked at */
const HEARTBEAT_CHECK_MS = 30_000;
export const IMESSAGE_CHAT_OFF = chatOffLine("imessage");

export interface ImessageConnectorDeps {
  home: string;
  link: PhotonLink;
  binding: Binding;
  secret: ImessageSecret;
  inbox: InboxRing;
  strangers: Strangers;
  /** the senders' references the owner blocked */
  blocked: () => string[];
  /** whether the Chat with Gravit row ticks iMessage */
  chatOn: () => boolean;
  /** a line to the operator */
  reply: (text: string) => Promise<void>;
  /** the last sequence handled; undefined: whatever Photon streams from now */
  sequence: number | undefined;
  clock: IdentityClock;
  log: (l: string) => void;
}

/** an iMessage part's most code units (Photon names no limit yet: unknown U7) */
export const IMESSAGE_PART_MAX = 4_000;
/** Photon's codes for a send to the operator's number it will not make: the line is recorded as refused (identity/imessage.refused) */
const LINE_REFUSED_CODES = new Set(["addressNotFound", "chatNotFound", "recipientLocked"]);
const TARGET_NOT_ALLOWED = /target not allowed/i;

export interface ImessageTransportDeps {
  link: PhotonLink;
  secret: ImessageSecret;
  /** Photon refused to write to the operator's number from this line: the identity keeps the line (identity/imessage.refused) */
  refusedLine: (line: string) => void;
}

/** THE IMESSAGE TRANSPORT — one part at a time to the 1:1 chat of the bound number, as plain text, through Photon's send. Every part goes
 * under its own id (`<row id>:<n>`, identity.ts flush; a connector's reply under a fresh random one), Photon's clientMessageId, so a part
 * sent again within the hour is dropped by Photon: that duplicate answers "" and counts as sent. A part with no id is refused here. What
 * goes answers `imessage:<GUID>`. Photon refusing the number (addressNotFound, chatNotFound, recipientLocked, "Target not allowed") calls
 * `refusedLine` before the error goes on. `classify`: Photon's `retry` waits in the outbox, `auth` is the project refused, everything else
 * is refused outright — there is no `blocked`. Its tokens are the project secret and its Basic spelling; `dispose` leaves the link alone — the connector closes its own stream, and the link belongs to whoever made it (the service). */
export class ImessageTransport implements Transport {
  readonly network = "imessage" as const;
  readonly partMax = IMESSAGE_PART_MAX;
  readonly secrets: readonly string[];
  private readonly project: PhotonProject;

  constructor(private readonly o: ImessageTransportDeps) {
    this.secrets = secretsOf(o.secret);
    this.project = { projectId: o.secret.projectId, secret: o.secret.projectSecret };
  }

  async send(part: string, _replyTo?: string, partId?: string): Promise<string> {
    if (typeof partId !== "string" || partId === "") throw new Error("an iMessage part is sent under its own id");
    try {
      const r = await this.o.link.sendText(this.project, this.o.secret.phone, part, partId);
      return "duplicate" in r ? "" : `imessage:${r.guid}`;
    } catch (err) {
      if (err instanceof PhotonError && (LINE_REFUSED_CODES.has(err.code) || TARGET_NOT_ALLOWED.test(err.code) || TARGET_NOT_ALLOWED.test(err.message))) this.o.refusedLine(this.o.secret.line);
      throw err;
    }
  }

  classify(err: unknown): "retry" | "refused" | "blocked" | "auth" {
    if (err instanceof PhotonError && err.kind === "retry") return "retry";
    if (err instanceof PhotonError && err.kind === "auth") return "auth";
    return "refused";
  }

  dispose(): void {
    // the shared link is the service's to dispose: a later connection goes through it again
  }
}

const reasonOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const codeOf = (err: unknown): string => (err as NodeJS.ErrnoException).code ?? reasonOf(err);
const whole = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

export class ImessageConnector implements Connector {
  /** where a connector of this home starts after a restart: the sequence kept in `<home>/identity/imessage.cursor`, or undefined */
  static resumeFrom(home: string): number | undefined {
    try {
      const raw = readFileSync(join(identityDir(home), IMESSAGE_CURSOR_FILE), "utf8").trim();
      const n = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
      return whole(n) ? n : undefined;
    } catch {
      return undefined;
    }
  }

  private cursor: number | undefined;
  private started = false;
  private disposed = false;
  /** each open stream's number: a handler of a stream closed since does nothing */
  private generation = 0;
  private stream: PhotonStream | undefined;
  private lastSign = 0;
  private lastPollAt: string | undefined;
  private pollFailing: { since: string; reason: string } | undefined;
  private gapAt: string | undefined;
  private movedAt: string | undefined;
  private blockedBySender = false;
  private backoff = 0;
  private watchTimer: unknown;
  private reopenTimer: unknown;
  private smsSaidAt = Number.NEGATIVE_INFINITY;
  private badGuidSaidAt = Number.NEGATIVE_INFINITY;
  private readonly project: PhotonProject;

  constructor(private readonly d: ImessageConnectorDeps) {
    this.cursor = whole(d.sequence) ? d.sequence : undefined;
    this.project = { projectId: d.secret.projectId, secret: d.secret.projectSecret };
  }

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    void this.open();
  }

  status(): NetworkStatus {
    return {
      network: "imessage",
      polling: this.started && !this.disposed && this.movedAt === undefined,
      ...(this.lastPollAt === undefined ? {} : { lastPollAt: this.lastPollAt }),
      ...(this.blockedBySender ? { blocked: true as const } : {}),
      ...(this.pollFailing === undefined ? {} : { pollFailing: { ...this.pollFailing } }),
      ...(this.gapAt === undefined ? {} : { gapAt: this.gapAt }),
      ...(this.movedAt === undefined ? {} : { movedAt: this.movedAt }),
    };
  }

  setBlocked(blocked: boolean): void {
    this.blockedBySender = blocked;
  }

  /** the stream closed and every wait cleared; the link itself is the transport's to dispose */
  async dispose(): Promise<void> {
    this.disposed = true;
    await this.close();
  }

  // ---- inside ----

  private stamp(): string {
    return new Date(this.d.clock.now()).toISOString();
  }

  private live(gen: number): boolean {
    return !this.disposed && gen === this.generation;
  }

  /** the user's line read again, then the stream opened from the cursor; a line Photon moved stops the connector */
  private async open(): Promise<void> {
    const gen = ++this.generation;
    let user: Awaited<ReturnType<PhotonLink["getUser"]>>;
    try {
      user = await this.d.link.getUser(this.project, this.d.secret.userId);
    } catch (err) {
      if (!this.live(gen)) return;
      this.failed(gen, err);
      return;
    }
    if (!this.live(gen)) return;
    if (!user || user.line !== this.d.secret.line) {
      this.movedAt = this.stamp();
      this.d.log("identity: Photon no longer names the signed line for the operator: the iMessage connector stopped; disconnect and connect iMessage again");
      return;
    }
    this.lastSign = this.d.clock.now();
    try {
      this.stream = this.d.link.stream(this.project, this.cursor, {
        event: (e) => this.event(gen, e),
        heartbeat: () => {
          if (this.live(gen)) this.sign();
        },
        gap: () => {
          if (!this.live(gen)) return;
          this.gapAt = this.stamp();
          this.d.log("identity: Photon could not catch up from the iMessage cursor: messages may have been missed while the account was down");
        },
        failed: (err) => {
          if (this.live(gen)) this.failed(gen, err);
        },
      });
    } catch (err) {
      this.failed(gen, err);
      return;
    }
    this.watch(gen);
  }

  /** a heartbeat or an event: the stream is alive */
  private sign(): void {
    this.lastSign = this.d.clock.now();
    this.lastPollAt = this.stamp();
    this.pollFailing = undefined;
    this.backoff = 0;
  }

  private watch(gen: number): void {
    this.watchTimer = this.d.clock.setTimeout(() => {
      this.watchTimer = undefined;
      if (!this.live(gen)) return;
      if (this.d.clock.now() - this.lastSign >= HEARTBEAT_STALE_MS) {
        this.pollFailing = { since: this.pollFailing?.since ?? this.stamp(), reason: `no heartbeat from Photon for ${HEARTBEAT_STALE_MS / 1000} s` };
        this.reopen(this.nextBackoff(), "the iMessage stream went silent");
        return;
      }
      this.watch(gen);
    }, HEARTBEAT_CHECK_MS);
  }

  private nextBackoff(): number {
    this.backoff = this.backoff === 0 ? BACKOFF_FIRST_MS : Math.min(this.backoff * 2, BACKOFF_MAX_MS);
    return this.backoff;
  }

  /** a failure Photon reported, or a call that did not answer: pollFailing, and a reopen after the backoff (60 s for auth) */
  private failed(gen: number, err: unknown): void {
    if (!this.live(gen)) return;
    const auth = err instanceof PhotonError && err.kind === "auth";
    this.pollFailing = { since: this.pollFailing?.since ?? this.stamp(), reason: auth ? `auth: ${reasonOf(err)}` : reasonOf(err) };
    this.reopen(auth ? BACKOFF_MAX_MS : this.nextBackoff(), `the iMessage stream failed (${reasonOf(err)})`);
  }

  /** the stream closed now, and opened again after `ms` */
  private reopen(ms: number, why: string): void {
    this.d.log(`identity: ${why}; opening it again in ${ms / 1000} s`);
    void this.close();
    if (this.disposed) return;
    this.reopenTimer = this.d.clock.setTimeout(() => {
      this.reopenTimer = undefined;
      if (!this.disposed) void this.open();
    }, ms);
  }

  /** the stream under way closed, its handlers silenced, every wait cleared */
  private async close(): Promise<void> {
    this.generation += 1;
    if (this.watchTimer !== undefined) this.d.clock.clearTimeout(this.watchTimer);
    if (this.reopenTimer !== undefined) this.d.clock.clearTimeout(this.reopenTimer);
    this.watchTimer = undefined;
    this.reopenTimer = undefined;
    const s = this.stream;
    this.stream = undefined;
    try {
      await s?.close();
    } catch (err) {
      this.d.log(`identity: the iMessage stream did not close cleanly (${reasonOf(err)})`);
    }
  }

  private async event(gen: number, e: PhotonEvent): Promise<void> {
    if (!this.live(gen)) return;
    const sequence = e.type === "message" ? e.message.sequence : e.sequence;
    if (!whole(sequence) || (this.cursor !== undefined && sequence <= this.cursor)) {
      this.sign();
      return;
    }
    let ok = true;
    if (e.type === "message") {
      try {
        ok = await this.handle(e.message);
      } catch (err) {
        this.d.log(`identity: an iMessage event could not be handled (${codeOf(err)}); it is read again from Photon`);
        ok = false;
      }
    }
    if (!this.live(gen)) return;
    if (!ok) {
      // not stored: the cursor stays before it — with no cursor yet, just before it — and the stream is opened again from there
      this.cursor ??= sequence - 1;
      this.pollFailing = { since: this.pollFailing?.since ?? this.stamp(), reason: "the inbox could not store a message" };
      this.reopen(this.nextBackoff(), "a text of the operator's could not be stored");
      return;
    }
    this.sign();
    this.advance(sequence);
  }

  /** the cursor moved to `sequence` and written; a file that cannot be written is one line — a restart reads from the last one written,
   * and the inbox keeps a GUID once */
  private advance(sequence: number): void {
    this.cursor = sequence;
    try {
      writeIdentityFile(this.d.home, IMESSAGE_CURSOR_FILE, `${sequence}\n`);
    } catch (err) {
      this.d.log(`identity: iMessage's cursor could not be written (${codeOf(err)})`);
    }
  }

  /** false only when the operator's text could not be stored */
  private async handle(m: PhotonMessage): Promise<boolean> {
    if (m.fromMe) return true;
    if (m.service !== "iMessage") {
      const at = this.d.clock.now();
      if (at - this.smsSaidAt >= RECORD_EVERY_MS) {
        this.smsSaidAt = at;
        this.d.log("identity: an SMS or RCS message reached Gravit's iMessage line: dropped, as every one is (iMessage only)");
      }
      return true;
    }
    if (isGroupChat(m.chatGuid)) return true;
    if (m.from !== this.d.secret.phone) {
      this.stranger(m.from);
      return true;
    }
    if (m.nonText || typeof m.text !== "string" || m.text === "") {
      await this.say(TEXT_ONLY);
      return true;
    }
    if (!this.d.chatOn() && !PHONE_COMMAND.test(m.text.trim())) {
      await this.say(IMESSAGE_CHAT_OFF);
      return true;
    }
    const messageId = `imessage:${m.guid}`;
    // an id the face's desk would refuse (WIRE_ID) is never stored: it would be dropped there, its cursor moved past it unseen
    if (typeof m.guid !== "string" || m.guid.trim() === "" || !WIRE_ID.test(messageId)) {
      const at = this.d.clock.now();
      if (at - this.badGuidSaidAt >= RECORD_EVERY_MS) {
        this.badGuidSaidAt = at;
        this.d.log("identity: an iMessage from the operator came with no message id the face can read: it is not stored, and the stream goes on past it");
      }
      return true;
    }
    if (this.d.inbox.has(messageId, this.d.binding.botId)) return true;
    const replyTo = m.replyTo ? `imessage:${m.replyTo}` : undefined;
    try {
      this.d.inbox.append({ network: "imessage", messageId, ...(replyTo !== undefined && WIRE_ID.test(replyTo) ? { replyTo } : {}), text: m.text, at: this.stamp() }, this.d.binding.botId);
    } catch (err) {
      this.d.log(`identity: the operator's iMessage could not be stored in the inbox (${codeOf(err)}); it is read again from Photon`);
      return false;
    }
    return true;
  }

  /** a stranger counted — unless the owner blocked them; never answered. A store that cannot write is one line (no handle) */
  private stranger(from: string): void {
    if (from === "" || this.d.blocked().includes(senderRef("imessage", from))) return;
    try {
      this.d.strangers.note("imessage", from, this.d.clock.now());
    } catch (err) {
      this.d.log(`identity: a stranger could not be counted (${codeOf(err)}); the stream goes on`);
    }
  }

  private async say(text: string): Promise<void> {
    try {
      await this.d.reply(text);
    } catch (err) {
      this.d.log(`identity: a line to the operator on iMessage did not go (${reasonOf(err)})`);
    }
  }
}
