/** THE OUTBOX — what the account was asked to send and a network could not take yet (the face's old bridge's outbox, face/src/telegram.ts,
 * moved to the account with the transport).
 *
 * `<home>/identity/outbox.json` is a list of `{t, network, kind, text, replyTo?}`: when the message was written, the network it is for, its
 * kind (an entry without one reads as `chat`), its text (the account's tokens already taken out) and the message it answers, as
 * `<network>:<id>`. At flush, an entry quiet hours would hold now is dropped (a held message is never sent later, whenever it was queued),
 * and so is one older than OUTBOX_MAX_AGE_MS (12 hours: past that an alert, a brief or a reply is stale), each with one line. At most `max` (100) are kept; one more drops the
 * oldest, with one line. Identity (identity.ts) flushes it, in order, before each poll and before each send, so what waits there always
 * goes first; a message it sends more than two minutes after it was written opens with `(written <time>, sent late)`. A message a network
 * refuses outright (Telegram's 400, or 403 for a bot the operator blocked) is dropped with one line, so it cannot hold up the rest.
 *
 * The file is written whole at each change (store.ts writeIdentityFile: 0600 in a 0700 folder, no link on the way); a write that fails is
 * one line, and the outbox is held in memory until the next one goes. It is read once, when the account starts; a link at the file, or a
 * file that is not a list, is read as an empty outbox (one line) and replaced at the next write. */
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NETWORKS, PHONE_KINDS, type Network, type PhoneKind } from "./kinds.ts";
import { identityDir, writeIdentityFile } from "./store.ts";

export const OUTBOX_MAX = 100;
/** a message flushed later than this after it was written says so */
export const LATE_MS = 120_000;
/** an entry older than this is dropped at flush, never sent: 12 hours */
export const OUTBOX_MAX_AGE_MS = 12 * 3_600_000;
const FILE = "outbox.json";

export interface OutboxEntry {
  /** when it was written, ISO */
  t: string;
  network: Network;
  /** what it is (identity.ts send): quiet hours are asked again at flush. Absent in an older file: read as `chat` */
  kind?: PhoneKind;
  text: string;
  /** the message it answers, `<network>:<id>` */
  replyTo?: string;
}

const isNetwork = (v: unknown): v is Network => typeof v === "string" && (NETWORKS as readonly string[]).includes(v);
const codeOf = (err: unknown): string => (err instanceof Error ? ((err as NodeJS.ErrnoException).code ?? err.name) : "error");

function entryOf(v: unknown): OutboxEntry | undefined {
  if (!v || typeof v !== "object") return undefined;
  const e = v as Record<string, unknown>;
  if (typeof e.t !== "string" || Number.isNaN(Date.parse(e.t)) || !isNetwork(e.network) || typeof e.text !== "string") return undefined;
  if (e.replyTo !== undefined && typeof e.replyTo !== "string") return undefined;
  const kind = typeof e.kind === "string" && (PHONE_KINDS as readonly string[]).includes(e.kind) ? (e.kind as PhoneKind) : undefined;
  return { t: e.t, network: e.network, ...(kind ? { kind } : {}), text: e.text, ...(typeof e.replyTo === "string" ? { replyTo: e.replyTo } : {}) };
}

const NEW_YORK = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function nyParts(at: number): { date: string; time: string } {
  const p = Object.fromEntries(NEW_YORK.formatToParts(new Date(at)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** The line a message written at `t` opens with when it goes more than two minutes later — its time on New York's clock, with its date
 * when that is not today's (as the face's desk shows times: `12:00 ET`, `2026-11-03 23:30 ET`) — and "" otherwise */
export function lateLine(t: string, now: number): string {
  const at = Date.parse(t);
  if (!(now - at > LATE_MS)) return "";
  const w = nyParts(at);
  const today = nyParts(now).date;
  return `(written ${w.date === today ? "" : `${w.date} `}${w.time} ET, sent late)\n`;
}

export class Outbox {
  private list: OutboxEntry[] = [];
  private readonly file: string;

  constructor(
    private readonly home: string,
    private readonly max = OUTBOX_MAX,
    private readonly log: (l: string) => void = (l) => console.error(l),
  ) {
    this.file = join(identityDir(home), FILE);
    this.load();
  }

  get length(): number {
    return this.list.length;
  }

  /** what waits, oldest first (copies) */
  entries(): OutboxEntry[] {
    return this.list.map((e) => ({ ...e }));
  }

  head(): OutboxEntry | undefined {
    const h = this.list[0];
    return h ? { ...h } : undefined;
  }

  /** queued at the end; past `max` the oldest is dropped, with one line */
  push(e: OutboxEntry): void {
    this.list.push({ ...e });
    if (this.list.length > this.max) {
      const oldest = this.list.shift()!;
      this.log(`identity: the outbox holds ${this.max} messages; the oldest, written ${oldest.t}, is dropped`);
    }
    this.persist();
  }

  /** the head gone: sent, or refused */
  shift(): void {
    if (this.list.shift()) this.persist();
  }

  /** the head cut to what did not go (it no longer answers anything: its first part did) */
  cutHead(rest: string): void {
    const h = this.list[0];
    if (!h) return;
    this.list[0] = { t: h.t, network: h.network, ...(h.kind ? { kind: h.kind } : {}), text: rest };
    this.persist();
  }

  /** every message for `network` dropped (a network disconnected: whoever connects next never receives them); how many */
  dropNetwork(network: Network): number {
    const before = this.list.length;
    this.list = this.list.filter((e) => e.network !== network);
    const dropped = before - this.list.length;
    if (dropped > 0) this.persist();
    return dropped;
  }

  /** every text passed through `f` (the account's tokens taken out of what an earlier run queued) */
  rewrite(f: (text: string) => string): void {
    let changed = false;
    this.list = this.list.map((e) => {
      const text = f(e.text);
      if (text !== e.text) changed = true;
      return { ...e, text };
    });
    if (changed) this.persist();
  }

  // ---- inside ----

  private persist(): void {
    try {
      writeIdentityFile(this.home, FILE, `${JSON.stringify(this.list)}\n`);
    } catch (err) {
      this.log(`identity: the outbox could not be written (${codeOf(err)}); ${this.list.length} queued message(s) are held in memory only`);
    }
  }

  private load(): void {
    let text: string;
    try {
      if (lstatSync(this.file).isSymbolicLink()) {
        this.log("identity: identity/outbox.json is a link: it is not read, and the next message queued replaces it");
        return;
      }
      text = readFileSync(this.file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") this.log(`identity: the outbox could not be read (${codeOf(err)}); nothing in it is sent`);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    if (!Array.isArray(parsed)) {
      this.log("identity: identity/outbox.json is not an outbox; nothing in it is sent, and the next message queued replaces it");
      return;
    }
    const entries = parsed.map(entryOf).filter((e): e is OutboxEntry => e !== undefined);
    const skipped = parsed.length - entries.length;
    if (skipped > 0) this.log(`identity: ${skipped} entr${skipped === 1 ? "y" : "ies"} in identity/outbox.json are not messages and are not sent`);
    this.list = entries.slice(-this.max);
  }
}
