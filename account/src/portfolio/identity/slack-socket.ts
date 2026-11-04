/** ONE SOCKET MODE LINK — the account's one WebSocket to Slack for a connected (or pending) Slack app, over Node's own global WebSocket:
 * no dependency. It asks apps.connections.open (the app-level token, slack-api.ts) for a URL, takes it only if socketUrlOk, opens it, and
 * hands what arrives to its owner (`run`'s handlers):
 *   - `hello`: handed over first — no envelope is handled before its handler finishes (the connector's backfill runs there). A handler
 *     that throws closes the socket, and the link backs off as on a close: the next socket's hello is handed over again. A socket that
 *     sends no hello within HELLO_DEADLINE_MS of its open is closed the same way;
 *   - an envelope (anything with an `envelope_id`): handed over one at a time, in order, across sockets; its handler answers "ack" (the
 *     link sends `{"envelope_id": …}`) or "hold" (nothing is sent, so Slack sends it again). A handler that throws holds;
 *   - `disconnect`: `refresh_requested` reopens at once; `warning` is nothing to do; `link_disabled` stops the link for good, and the
 *     status says "Socket Mode is off for this app";
 *   - a frame over 64 KiB, a binary frame or one that is not JSON is dropped, with a line at most once a minute.
 * A socket that closes is reopened after a backoff of 5 s doubling to 60 s, which a hello resets; a failed apps.connections.open or a
 * refused URL backs off the same way. A socket that has carried no frame for 30 minutes (SOCKET_REFRESH_MS) is reopened: a half-open
 * socket says nothing, and the next hello's backfill takes what it missed. Each failure is said in a line at most once a minute.
 *
 * The link always closes its own socket — and waits for it to close, up to CLOSE_WAIT_MS — before it asks for the next (on
 * refresh_requested, on silence, and after every close), so its own sockets are never two at once and a hello's num_connections above 1
 * means another holder (the plan's ruling 8); `reopen` does the same at the owner's asking (its recheck of that count). `down` is told
 * each time a socket ends, once it has closed. Neither token nor socket URL is in any line: the URL holds a
 * ticket, and the client redacts its errors. */
import { socketUrlOk, type SlackApi } from "./slack-api.ts";
import { RECORD_EVERY_MS, type IdentityClock } from "./telegram.ts";

/** a socket silent this long is reopened */
export const SOCKET_REFRESH_MS = 30 * 60_000;
/** the largest frame taken; a larger one is dropped */
export const FRAME_MAX_BYTES = 64 * 1024;
/** the backoff after a close or a failed open: 5 s, doubling to 60 s */
export const SOCKET_BACKOFF_FIRST_MS = 5_000;
export const SOCKET_BACKOFF_MAX_MS = 60_000;
/** what the status and `down` say once Slack disabled the link */
export const LINK_DISABLED = "Socket Mode is off for this app";
/** how long the link waits for its own socket to close before it goes on (a real timer: it waits on the socket, not on the clock) */
export const CLOSE_WAIT_MS = 5_000;
/** how long a socket may stay open without its hello before the link closes it and backs off */
export const HELLO_DEADLINE_MS = 30_000;
/** how long dispose waits for the frame in hand */
const DISPOSE_MS = 2_000;
/** WebSocket.OPEN */
const OPEN = 1;

export type SocketLike = Pick<WebSocket, "send" | "close" | "readyState" | "addEventListener">;
export type OpenSocket = (url: string) => SocketLike;
/** the default: Node's own WebSocket */
export const openSocket: OpenSocket = (url) => new WebSocket(url);

/** an envelope Slack sent: its id (what an ack names), its type (`events_api`, `slash_commands`, `interactive`…), its payload as sent and
 * how many times Slack sent it before (0 the first time) */
export interface Envelope {
  envelopeId: string;
  type: string;
  payload: unknown;
  retryAttempt: number;
}

export interface SocketHandlers {
  /** a socket's hello: the app it is for and how many sockets Slack holds for that app; no envelope is handled before this returns */
  hello(h: { appId: string; connections: number }): Promise<void>;
  /** one envelope, in order: "ack" sends its envelope_id, "hold" sends nothing */
  envelope(e: Envelope): Promise<"ack" | "hold">;
  /** a socket ended: why, in a line */
  down(reason: string): void;
}

export interface SlackSocketOptions {
  /** a client that holds the app-level token (connectionsOpen) */
  api: SlackApi;
  /** the client's base, which says which socket URLs are taken (socketUrlOk) */
  apiBase: string;
  open?: OpenSocket | undefined;
  clock: IdentityClock;
  log: (l: string) => void;
}

/** how a socket's life ended */
type End = { why: "closed" | "failed" | "refresh" | "silent" | "disabled" | "disposed"; reason: string };

interface Live {
  ws: SocketLike;
  /** the hello came */
  helloed: boolean;
  /** the socket's close event came */
  closed: boolean;
  /** its life ended (closed, or the link decided to close it): no frame of it is handled after */
  ended: boolean;
  closedP: Promise<void>;
  end: (e: End) => void;
  /** the hello deadline's timer, cleared at the hello and at the end */
  helloTimer: unknown;
}

const reasonOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export class SlackSocket {
  private readonly open: OpenSocket;
  private loop: Promise<void> | undefined;
  private disposed = false;
  private current: Live | undefined;
  private lastFrameAt: string | undefined;
  private failing: { since: string; reason: string } | undefined;
  private backoff = 0;
  private chain: Promise<void> = Promise.resolve();
  private wake: (() => void) | undefined;
  private refreshTimer: unknown;
  private failureSaidAt = Number.NEGATIVE_INFINITY;
  private readonly dropSaidAt = new Map<string, number>();

  constructor(private readonly o: SlackSocketOptions) {
    this.open = o.open ?? openSocket;
  }

  /** start the link (once); it runs until dispose, or until Slack disables it */
  run(on: SocketHandlers): void {
    if (this.loop || this.disposed) return;
    this.loop = this.life(on).catch((err: unknown) => this.o.log(`identity: the Slack socket stopped (${reasonOf(err)})`));
  }

  status(): { open: boolean; lastFrameAt?: string; failing?: { since: string; reason: string } } {
    const c = this.current;
    return {
      open: c !== undefined && c.helloed && !c.ended,
      ...(this.lastFrameAt === undefined ? {} : { lastFrameAt: this.lastFrameAt }),
      ...(this.failing === undefined ? {} : { failing: { ...this.failing } }),
    };
  }

  /** the socket open now closed and a fresh one asked for at once, with `reason` told to `down` (a recheck of how many sockets Slack
   * holds for the app); nothing when no socket is open */
  reopen(reason: string): void {
    const c = this.current;
    if (c && !c.ended && !this.disposed) c.end({ why: "refresh", reason });
  }

  /** the link stopped: the wait under way ended, the socket closed, the frame in hand finished (up to 2 s) */
  async dispose(): Promise<void> {
    this.disposed = true;
    this.clearRefresh();
    this.wake?.();
    if (this.current) await this.closeOwn(this.current);
    const bounded = (p: Promise<unknown>) =>
      new Promise<void>((done) => {
        const t = setTimeout(done, DISPOSE_MS);
        t.unref();
        void p.then(() => {
          clearTimeout(t);
          done();
        });
      });
    if (this.loop) await bounded(this.loop);
    await bounded(this.chain);
  }

  // ---- inside ----

  private stamp(): string {
    return new Date(this.o.clock.now()).toISOString();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((done) => {
      if (this.disposed) return done();
      const end = () => {
        this.o.clock.clearTimeout(timer);
        this.wake = undefined;
        done();
      };
      const timer = this.o.clock.setTimeout(end, ms);
      this.wake = end;
    });
  }

  /** a failure: the status says it, a line says it at most once a minute, and the backoff grows */
  private async fail(reason: string, line: string): Promise<void> {
    const at = this.o.clock.now();
    this.failing = { since: this.failing?.since ?? new Date(at).toISOString(), reason };
    this.backoff = this.backoff === 0 ? SOCKET_BACKOFF_FIRST_MS : Math.min(this.backoff * 2, SOCKET_BACKOFF_MAX_MS);
    if (at - this.failureSaidAt >= RECORD_EVERY_MS) {
      this.failureSaidAt = at;
      this.o.log(`identity: ${line}; trying again in ${this.backoff / 1000} s`);
    }
    await this.sleep(this.backoff);
  }

  private async life(on: SocketHandlers): Promise<void> {
    while (!this.disposed) {
      let url: string;
      try {
        url = await this.o.api.connectionsOpen();
      } catch (err) {
        if (this.disposed) break;
        const reason = reasonOf(err);
        await this.fail(reason, `Slack's apps.connections.open failed (${reason})`);
        continue;
      }
      if (this.disposed) break;
      if (!socketUrlOk(url, this.o.apiBase)) {
        await this.fail("the socket URL Slack answered is not Slack's", "apps.connections.open answered a socket URL that is not on Slack's own host, so it is refused");
        continue;
      }
      let ws: SocketLike;
      try {
        ws = this.open(url);
      } catch (err) {
        await this.fail(reasonOf(err), `the Slack socket could not be opened (${reasonOf(err)})`);
        continue;
      }
      const end = await this.live(ws, on);
      const live = this.current!;
      this.clearRefresh();
      await this.closeOwn(live);
      if (end.why === "disposed" || this.disposed) break;
      try {
        on.down(end.reason);
      } catch {
        // the owner's own fault; the link goes on
      }
      if (end.why === "disabled") {
        this.failing = { since: this.stamp(), reason: LINK_DISABLED };
        this.o.log(`identity: Slack disabled this app's Socket Mode link: ${LINK_DISABLED}, so the account stops listening on Slack`);
        break;
      }
      if (end.why === "refresh" || end.why === "silent") continue;
      await this.fail(end.reason, `the Slack socket ${end.reason.replace(/^the socket /, "")}`);
    }
    this.wake = undefined;
  }

  /** one socket's life: resolves when it closes, when Slack asks for a fresh one or disables it, when it falls silent, or on dispose */
  private live(ws: SocketLike, on: SocketHandlers): Promise<End> {
    return new Promise<End>((resolve) => {
      let closedDone: () => void = () => undefined;
      const live: Live = {
        ws,
        helloed: false,
        closed: false,
        ended: false,
        closedP: new Promise<void>((d) => (closedDone = d)),
        end: (e) => {
          if (live.ended) return;
          live.ended = true;
          this.o.clock.clearTimeout(live.helloTimer);
          this.wake = undefined;
          resolve(e);
        },
        helloTimer: undefined,
      };
      live.helloTimer = this.o.clock.setTimeout(() => {
        if (!live.helloed) live.end({ why: "failed", reason: `the socket sent no hello in ${HELLO_DEADLINE_MS / 1000} s` });
      }, HELLO_DEADLINE_MS);
      this.current = live;
      ws.addEventListener("message", (ev: MessageEvent) => this.frame(live, ev.data, on));
      ws.addEventListener("close", (ev: CloseEvent) => {
        live.closed = true;
        closedDone();
        live.end({ why: "closed", reason: `the socket closed (${ev.code}${ev.reason ? ` ${ev.reason}` : ""})` });
      });
      // an error is followed by a close, which says what happened
      ws.addEventListener("error", () => undefined);
      this.wake = () => live.end({ why: "disposed", reason: "stopped" });
      this.armRefresh(live);
    });
  }

  /** close the link's own socket and wait for it to close (up to CLOSE_WAIT_MS), before anything else is opened */
  private async closeOwn(live: Live): Promise<void> {
    live.ended = true;
    if (live.closed) return;
    try {
      live.ws.close(1000);
    } catch {
      // closing already
    }
    await new Promise<void>((done) => {
      const t = setTimeout(done, CLOSE_WAIT_MS);
      t.unref();
      void live.closedP.then(() => {
        clearTimeout(t);
        done();
      });
    });
  }

  private armRefresh(live: Live): void {
    this.clearRefresh();
    this.refreshTimer = this.o.clock.setTimeout(() => {
      this.refreshTimer = undefined;
      live.end({ why: "silent", reason: `the socket carried nothing for ${SOCKET_REFRESH_MS / 60_000} minutes` });
    }, SOCKET_REFRESH_MS);
  }

  private clearRefresh(): void {
    if (this.refreshTimer !== undefined) this.o.clock.clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
  }

  /** a frame dropped: one line, at most once a minute for each kind of drop */
  private dropped(kind: "binary" | "large" | "json", line: string): void {
    const at = this.o.clock.now();
    if (at - (this.dropSaidAt.get(kind) ?? Number.NEGATIVE_INFINITY) < RECORD_EVERY_MS) return;
    this.dropSaidAt.set(kind, at);
    this.o.log(`identity: ${line}`);
  }

  /** one frame of `live`'s, in the order it came */
  private frame(live: Live, data: unknown, on: SocketHandlers): void {
    if (live.ended || this.disposed) return;
    this.lastFrameAt = this.stamp();
    this.armRefresh(live);
    if (typeof data !== "string") return this.dropped("binary", "a binary Socket Mode frame was dropped");
    if (Buffer.byteLength(data, "utf8") > FRAME_MAX_BYTES) return this.dropped("large", `a Socket Mode frame over ${FRAME_MAX_BYTES / 1024} KiB was dropped`);
    let j: Record<string, unknown>;
    try {
      const v = JSON.parse(data) as unknown;
      if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
      j = v as Record<string, unknown>;
    } catch {
      return this.dropped("json", "a Socket Mode frame that is not a JSON object was dropped");
    }
    if (j.type === "hello") {
      const info = (j.connection_info ?? {}) as { app_id?: unknown };
      const h = { appId: typeof info.app_id === "string" ? info.app_id : "", connections: typeof j.num_connections === "number" ? j.num_connections : 1 };
      live.helloed = true;
      this.o.clock.clearTimeout(live.helloTimer);
      this.then(async () => {
        if (live.ended) return;
        try {
          await on.hello(h);
        } catch (err) {
          // the socket is closed and opened again after the backoff, and the next hello handed over afresh; this socket's envelopes are
          // not acked, so Slack sends them again
          live.end({ why: "failed", reason: `the socket closed after its hello could not be handled (${reasonOf(err)})` });
          return;
        }
        if (live.ended) return;
        this.backoff = 0;
        this.failing = undefined;
      });
      return;
    }
    if (j.type === "disconnect") {
      if (j.reason === "refresh_requested") live.end({ why: "refresh", reason: "Slack asked for a fresh socket" });
      else if (j.reason === "link_disabled") live.end({ why: "disabled", reason: LINK_DISABLED });
      return;
    }
    if (typeof j.envelope_id !== "string" || j.envelope_id === "") return;
    const e: Envelope = {
      envelopeId: j.envelope_id,
      type: typeof j.type === "string" ? j.type : "",
      payload: j.payload,
      retryAttempt: typeof j.retry_attempt === "number" && Number.isSafeInteger(j.retry_attempt) && j.retry_attempt > 0 ? j.retry_attempt : 0,
    };
    this.then(async () => {
      // a socket that ended: its envelopes are not acked, so Slack sends them again (and the next hello's backfill reads the DM)
      if (live.ended) return;
      let verdict: "ack" | "hold" = "hold";
      try {
        verdict = await on.envelope(e);
      } catch (err) {
        this.o.log(`identity: a Slack envelope's handler failed (${reasonOf(err)}); it is not acked, so Slack sends it again`);
      }
      if (verdict !== "ack" || live.closed || live.ws.readyState !== OPEN) return;
      try {
        live.ws.send(JSON.stringify({ envelope_id: e.envelopeId }));
      } catch {
        // the socket is closing: Slack sends the envelope again
      }
    });
  }

  /** run `fn` after everything handed over before it */
  private then(fn: () => Promise<void>): void {
    this.chain = this.chain.then(fn).catch(() => undefined);
  }
}
