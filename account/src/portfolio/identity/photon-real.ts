/** THE REAL PHOTON LINK: identity/photon-link.ts's seam over Photon's two doors. REST at `spectrum.photon.codes` (PHOTON_API) for the
 * project, its users and the line token, every call HTTP Basic with the project's ID and secret, every answer `{ succeed, data }`; and
 * advanced-imessage's gRPC client at `imessage.spectrum.photon.codes:443` (PHOTON_GRPC) over TLS, bearing the line token, for the event
 * stream and the send. The link holds one token and one client per project while the token is younger than 80% of its life; a send or a
 * stream past that point mints again, closes the old client and moves every stream onto the new one from the last sequence it delivered.
 * A stream's catch-up runs while its live subscription is already buffering, so nothing between the two is lost, and each sequence is
 * delivered once. Telemetry is never on (photon-link.ts). The secret, the Basic string and the token appear in no
 * PhotonError message and no log line — each message is fixed words and a status or a code, never what Photon or a thrown error said. */
import { ConnectionError, createClient as createGrpcClient, IMessageError, RateLimitError, ValidationError } from "@photon-ai/advanced-imessage/grpc";
import { dmChat, PHOTON_API, PHOTON_GRPC, PhotonError, type PhotonEvent, type PhotonLink, type PhotonProject, type PhotonStream, type PhotonStreamHandlers, type PhotonUser } from "./photon-link.ts";
import { basicOf } from "./secret-file.ts";
import { realClock, type IdentityClock } from "./telegram.ts";

/** the slice of advanced-imessage's gRPC client the link uses */
export interface PhotonImClient {
  messages: {
    subscribeEvents(o: { onHeartbeat: () => void }): AsyncIterable<unknown> & { close(): Promise<void> };
    sendText(chatGuid: string, text: string, o: { clientMessageId: string }): Promise<{ guid: string }>;
  };
  events: { catchUp(since?: number): AsyncIterable<unknown> & { close(): Promise<void> } };
  close(): Promise<void>;
}

export interface RealPhotonLinkOptions {
  /** PHOTON_API */
  apiBase?: string;
  /** PHOTON_GRPC */
  grpcAddress?: string;
  fetch?: typeof fetch;
  /** advanced-imessage/grpc's createClient */
  createClient?: (o: { address: string; token: string; tls: boolean; timeout: number }) => PhotonImClient;
  clock?: IdentityClock;
  log: (l: string) => void;
}

/** a token is renewed once it has lived this share of its `expiresIn` */
const RENEW_SHARE = 0.8;
/** the users list's page */
const USERS_PAGE = 500;

const AUTH_CODES = new Set(["unauthenticated", "tokenBlocked", "unauthorized"]);
const REFUSED_CODES = new Set(["addressNotFound", "chatNotFound", "recipientLocked", "invalidArgument", "preconditionFailed", "operationNotSupported"]);
const RATE_CODES = new Set([
  "dailyLimitExceeded",
  "recipientLimitExceeded",
  "uploadRateExceeded",
  "contentDuplicateExceeded",
  "recipientCoolingDown",
  "burstRateExceeded",
  "newContactThrottled",
  "sendReceiveRatioExceeded",
]);
/** every unary gRPC call (a send among them) given up after this, as Telegram's and Slack's sends are: a call Photon never answers would
 * otherwise hold the account's send chain, and the connects and disconnects that wait on it, for good. Streams are left open */
export const PHOTON_CALL_TIMEOUT_MS = 15_000;
const RETRY_CODES = new Set(["tokenExpired", "serviceUnavailable", "timeout", "networkError", "internalError"]);

/** what a REST call is, for its status mapping */
interface CallKind {
  /** `/projects/{id}/` itself: a 404 there is the project not being this secret's */
  root?: boolean;
  /** one of addUser's calls: 402, 409 and 422 are the plan's limit */
  addUser?: boolean;
  /** a 404 answers MISSING instead of throwing */
  missingOk?: boolean;
}
const MISSING = Symbol("missing");

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const answerError = (): PhotonError => new PhotonError("refused", "answer", "Photon's answer was not understood");

function statusError(status: number, k: CallKind, retryAfter: string | null): PhotonError {
  const code = String(status);
  if (status === 401 || status === 403 || (status === 404 && k.root)) return new PhotonError("auth", code, `Photon refused the project (HTTP ${status})`);
  if (k.addUser && (status === 402 || status === 409 || status === 422)) return new PhotonError("limit", code, `Photon's plan has no room for this (HTTP ${status})`);
  if (status === 429 || status >= 500) {
    const s = retryAfter === null ? NaN : Number(retryAfter);
    return new PhotonError("retry", code, `Photon asks to try again later (HTTP ${status})`, Number.isFinite(s) && s >= 0 ? s * 1000 : undefined);
  }
  return new PhotonError("refused", code, `Photon refused the call (HTTP ${status})`);
}

/** an advanced-imessage error as the seam's: "duplicate" for a send Photon already has */
function imError(e: unknown): PhotonError | "duplicate" {
  if (e instanceof PhotonError) return e;
  if (!(e instanceof IMessageError)) return new PhotonError("retry", "transport", "Photon's iMessage line broke");
  const code = String(e.code);
  if (AUTH_CODES.has(code)) return new PhotonError("auth", code, `Photon refused the line token (${code})`);
  if (code === "duplicateMessage") return "duplicate";
  if (REFUSED_CODES.has(code)) return new PhotonError("refused", code, `Photon refused the message (${code})`);
  if (e instanceof RateLimitError || e instanceof ConnectionError || e.retryable || RATE_CODES.has(code) || RETRY_CODES.has(code)) {
    const after = typeof e.retryAfter === "number" && Number.isFinite(e.retryAfter) && e.retryAfter >= 0 ? e.retryAfter : undefined;
    return new PhotonError("retry", code, `Photon asks to try again later (${code})`, after);
  }
  return new PhotonError("refused", code, `Photon refused the message (${code})`);
}

function userOf(d: unknown): PhotonUser {
  if (!isRecord(d) || typeof d.id !== "string" || typeof d.phoneNumber !== "string" || typeof d.assignedPhoneNumber !== "string") throw answerError();
  return { userId: d.id, phone: d.phoneNumber, line: d.assignedPhoneNumber };
}

const addressOf = (a: unknown): { address: string; service: string } | undefined =>
  isRecord(a) && typeof a.address === "string" ? { address: a.address, service: typeof a.service === "string" ? a.service : "unknown" } : undefined;

/** an advanced-imessage event as the seam's; undefined when it carries no sequence */
export function mapPhotonEvent(e: unknown): PhotonEvent | undefined {
  if (!isRecord(e) || typeof e.sequence !== "number") return undefined;
  const sequence = e.sequence;
  if (e.type !== "message.received" || !isRecord(e.message)) return { type: "other", sequence };
  const m = e.message;
  const content = isRecord(m.content) ? m.content : {};
  const who = addressOf(m.sender) ?? addressOf(e.actor);
  const attachments = Array.isArray(content.attachments) ? content.attachments.length : 0;
  const replyTo = typeof m.replyTargetGuid === "string" ? m.replyTargetGuid : typeof m.threadOriginatorGuid === "string" ? m.threadOriginatorGuid : undefined;
  return {
    type: "message",
    message: {
      sequence,
      guid: typeof m.guid === "string" ? m.guid : "",
      chatGuid: typeof e.chatGuid === "string" ? e.chatGuid : "",
      from: who?.address ?? "",
      service: who?.service ?? "unknown",
      fromMe: e.isFromMe === true,
      ...(typeof content.text === "string" ? { text: content.text } : {}),
      nonText: attachments > 0 || m.itemType !== "normal" || m.reaction !== undefined,
      ...(replyTo !== undefined ? { replyTo } : {}),
    },
  };
}

/** a live subscription read ahead into memory, so heartbeats keep coming and nothing is lost while catch-up runs */
function buffered(src: AsyncIterable<unknown>): { next(): Promise<IteratorResult<unknown>> } {
  const items: unknown[] = [];
  let done = false;
  let failed = false;
  let error: unknown;
  let wake: (() => void) | undefined;
  const poke = () => {
    const w = wake;
    wake = undefined;
    w?.();
  };
  void (async () => {
    try {
      for await (const e of src) {
        items.push(e);
        poke();
      }
    } catch (x) {
      failed = true;
      error = x;
    } finally {
      done = true;
      poke();
    }
  })();
  return {
    async next() {
      while (!items.length && !done) await new Promise<void>((r) => (wake = r));
      if (items.length) return { value: items.shift(), done: false };
      if (failed) throw error;
      return { value: undefined, done: true };
    },
  };
}

/** the token and client the link holds for one project */
interface Held {
  key: string;
  token: string;
  renewAt: number;
  im: PhotonImClient;
}

export function realPhotonLink(o: RealPhotonLinkOptions): PhotonLink {
  const apiBase = (o.apiBase ?? PHOTON_API).replace(/\/+$/, "");
  const grpcAddress = o.grpcAddress ?? PHOTON_GRPC;
  const doFetch = o.fetch ?? fetch;
  const createClient = o.createClient ?? ((c): PhotonImClient => createGrpcClient(c));
  const clock = o.clock ?? realClock();
  const log = o.log;
  const keyOf = (p: PhotonProject): string => `${p.projectId}\u0000${p.secret}`;
  const projectPath = (p: PhotonProject): string => `/projects/${encodeURIComponent(p.projectId)}`;

  async function rest(p: PhotonProject, method: string, path: string, k: CallKind = {}, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    let res: Response;
    try {
      res = await doFetch(`${apiBase}${path}`, {
        method,
        headers: { authorization: `Basic ${basicOf(p.projectId, p.secret)}`, accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        ...(signal ? { signal } : {}),
      });
    } catch {
      if (signal?.aborted) throw new PhotonError("retry", "aborted", "The Photon call was stopped");
      throw new PhotonError("retry", "network", "Photon could not be reached");
    }
    if (!res.ok) {
      void res.body?.cancel().catch(() => {});
      if (res.status === 404 && k.missingOk) return MISSING;
      throw statusError(res.status, k, res.headers.get("retry-after"));
    }
    let answer: unknown;
    try {
      answer = await res.json();
    } catch {
      throw answerError();
    }
    if (!isRecord(answer) || answer.succeed !== true) throw answerError();
    return answer.data;
  }

  async function mint(p: PhotonProject): Promise<{ token: string; expiresIn: number }> {
    const d = await rest(p, "POST", `${projectPath(p)}/imessage/tokens`);
    if (isRecord(d) && d.type === "dedicated") throw new PhotonError("refused", "dedicated", "Photon gives this project dedicated lines, not the shared pool");
    if (!isRecord(d) || d.type !== "shared" || typeof d.token !== "string" || typeof d.expiresIn !== "number" || !(d.expiresIn > 0)) throw answerError();
    return { token: d.token, expiresIn: d.expiresIn };
  }

  // ── the held token and client, one per project ──
  const held = new Map<string, Held>();
  const minting = new Map<string, Promise<Held>>();
  const runs = new Set<Run>();

  const fresh = (h: Held, key: string): boolean => h.key === key && clock.now() < h.renewAt;

  /** the held client for the project, minting a token when the held one is past 80% of its life */
  async function ensure(p: PhotonProject): Promise<Held> {
    const key = keyOf(p);
    const now = held.get(key);
    if (now && fresh(now, key)) return now;
    const pending = minting.get(key);
    if (pending) return pending;
    const done = (async () => {
      const t = await mint(p);
      const next: Held = { key, token: t.token, renewAt: clock.now() + t.expiresIn * 1000 * RENEW_SHARE, im: createClient({ address: grpcAddress, token: t.token, tls: true, timeout: PHOTON_CALL_TIMEOUT_MS }) };
      const old = held.get(key);
      held.set(key, next);
      log(`imessage: line token minted (renews in ${Math.round(t.expiresIn * RENEW_SHARE)} s)`);
      if (old) {
        for (const r of runs) if (r.on === old) r.move();
        void old.im.close().catch(() => {});
      }
      return next;
    })();
    minting.set(key, done);
    try {
      return await done;
    } finally {
      if (minting.get(key) === done) minting.delete(key);
    }
  }

  /** the held token is no longer good: the next call mints again */
  const stale = (h: Held): void => {
    if (held.get(h.key) === h) h.renewAt = -Infinity;
  };

  class Run implements PhotonStream {
    gen = 0;
    over = false;
    last: number | undefined;
    on: Held | undefined;
    live: (AsyncIterable<unknown> & { close(): Promise<void> }) | undefined;
    timer: unknown;
    /** the delivery in flight: a reopen waits for it, so no sequence is handed over twice or out of order */
    inflight: Promise<void> = Promise.resolve();

    constructor(
      private readonly p: PhotonProject,
      since: number | undefined,
      private readonly h: PhotonStreamHandlers,
    ) {
      this.last = since;
    }

    private stop(): void {
      this.gen++;
      if (this.timer !== undefined) clock.clearTimeout(this.timer);
      this.timer = undefined;
      const live = this.live;
      this.live = undefined;
      if (live) void live.close().catch(() => {});
    }

    /** the held client changed: close live and reopen from the last delivered sequence */
    move(): void {
      if (this.over) return;
      this.stop();
      void this.open();
    }

    private async deliver(g: number, e: unknown): Promise<void> {
      const ev = mapPhotonEvent(e);
      if (!ev || g !== this.gen) return;
      const seq = ev.type === "message" ? ev.message.sequence : ev.sequence;
      if (this.last !== undefined && seq <= this.last) return;
      const done = this.h.event(ev).then(() => {
        this.last = seq;
      });
      this.inflight = done.catch(() => {});
      await done;
    }

    async open(): Promise<void> {
      const g = ++this.gen;
      try {
        const on = await ensure(this.p);
        await this.inflight;
        if (g !== this.gen || this.over) return;
        this.on = on;
        const live = on.im.messages.subscribeEvents({
          onHeartbeat: () => {
            if (g === this.gen) this.h.heartbeat(clock.now());
          },
        });
        this.live = live;
        const queue = buffered(live);
        this.timer = clock.setTimeout(() => void this.renew(g), Math.max(0, on.renewAt - clock.now()));
        log(`imessage: stream open${this.last !== undefined ? ` from ${this.last}` : ""}`);
        if (this.last !== undefined) {
          // made inside the try: a catchUp that throws at once is mapped the same as one that throws as it is read
          let cu: ReturnType<typeof on.im.events.catchUp> | undefined;
          try {
            cu = on.im.events.catchUp(this.last);
            for await (const e of cu) {
              if (g !== this.gen) return;
              if (isRecord(e) && e.type === "catchup.complete") break;
              await this.deliver(g, e);
            }
          } catch (x) {
            if (!(x instanceof ValidationError)) throw x;
            if (g !== this.gen) return;
            log("imessage: catch-up could not reach back; going on live");
            this.h.gap();
          } finally {
            void cu?.close().catch(() => {});
          }
        }
        for (;;) {
          const n = await queue.next();
          if (g !== this.gen) return;
          if (n.done) throw new PhotonError("retry", "ended", "Photon's event stream ended");
          await this.deliver(g, n.value);
        }
      } catch (x) {
        this.fail(g, x);
      }
    }

    private async renew(g: number): Promise<void> {
      if (g !== this.gen || this.over) return;
      try {
        // past renewAt the held token is stale: ensure mints, and moving the held client reopens this run
        await ensure(this.p);
      } catch (x) {
        this.fail(this.gen, x);
      }
    }

    private fail(g: number, x: unknown): void {
      if (g !== this.gen || this.over) return;
      this.over = true;
      this.stop();
      runs.delete(this);
      const e = imError(x);
      const pe = e === "duplicate" ? new PhotonError("retry", "duplicateMessage", "Photon's event stream broke") : e;
      const out = pe.kind === "auth" ? pe : new PhotonError("retry", pe.code, pe.message, pe.retryAfterMs);
      if (out.kind === "auth" && this.on) stale(this.on);
      log(`imessage: stream failed (${out.kind}, ${out.code})`);
      this.h.failed(out);
    }

    async close(): Promise<void> {
      if (this.over) return;
      this.over = true;
      const live = this.live;
      this.live = undefined;
      this.gen++;
      if (this.timer !== undefined) clock.clearTimeout(this.timer);
      this.timer = undefined;
      runs.delete(this);
      if (live) await live.close().catch(() => {});
    }
  }

  return {
    async checkProject(p, signal) {
      await rest(p, "GET", `${projectPath(p)}/`, { root: true }, undefined, signal);
      const d = await rest(p, "GET", `${projectPath(p)}/imessage/`, {}, undefined, signal);
      if (isRecord(d) && d.type === "dedicated") throw new PhotonError("refused", "dedicated", "Photon gives this project dedicated lines, not the shared pool");
      if (!isRecord(d) || d.type !== "shared") throw answerError();
    },

    async findUser(p, phone, signal) {
      for (let offset = 0; ; offset += USERS_PAGE) {
        const d = await rest(p, "GET", `${projectPath(p)}/users/?limit=${USERS_PAGE}&offset=${offset}`, {}, undefined, signal);
        if (!isRecord(d) || !Array.isArray(d.users)) throw answerError();
        const hit = d.users.find((u) => isRecord(u) && u.phoneNumber === phone);
        if (hit) return userOf(hit);
        const total = typeof d.total === "number" ? d.total : 0;
        if (d.users.length < USERS_PAGE || offset + d.users.length >= total) return undefined;
      }
    },

    async getUser(p, userId, signal) {
      const d = await rest(p, "GET", `${projectPath(p)}/users/${encodeURIComponent(userId)}/`, { missingOk: true }, undefined, signal);
      return d === MISSING ? undefined : userOf(d);
    },

    async addUser(p, phone, signal) {
      const a = await rest(p, "GET", `${projectPath(p)}/imessage/shared/availability`, { addUser: true }, undefined, signal);
      if (!isRecord(a) || typeof a.available !== "boolean") throw answerError();
      if (!a.available) throw new PhotonError("noNumber", "noNumber", "Photon has no free shared number");
      return userOf(await rest(p, "POST", `${projectPath(p)}/users/`, { addUser: true }, { type: "shared", phoneNumber: phone }, signal));
    },

    async removeUser(p, userId, signal) {
      // a user already gone is removed
      await rest(p, "DELETE", `${projectPath(p)}/users/${encodeURIComponent(userId)}/`, { missingOk: true }, undefined, signal);
    },

    stream(p, since, h) {
      const run = new Run(p, since, h);
      runs.add(run);
      void run.open();
      return run;
    },

    async sendText(p, to, text, clientMessageId) {
      const h = await ensure(p);
      try {
        const m = await h.im.messages.sendText(dmChat(to), text, { clientMessageId });
        return { guid: m.guid };
      } catch (x) {
        const e = imError(x);
        if (e === "duplicate") return { duplicate: true };
        if (e.kind === "auth" || e.code === "tokenExpired") stale(h);
        throw e;
      }
    },

    async dispose() {
      await Promise.all([...runs].map((r) => r.close()));
      const all = [...held.values()];
      held.clear();
      await Promise.all(all.map((h) => h.im.close().catch(() => {})));
    },
  };
}
