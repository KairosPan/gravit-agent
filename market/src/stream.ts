/** THE MARKET'S PUSH CHANNEL: a followed market's quote, trades and book, told to the pages that follow it as the hub moves (GET /api/stream,
 * follows.ts). A copy of the account's bus (account/src/portfolio/account/stream.ts at 9dcb6a2d, account split plan A1 task 6) without
 * its ACCOUNT events: the market keeps no account, so nothing goes out to every page and nothing is kept for a resume. The windows, the
 * room, the ids and the names a page gives itself are the account bus's.
 *
 *   the wire      text/event-stream: `retry: 1000` first (a stream that drops is asked again after a second), then one frame an event —
 *                 `id: <run>.<seq>` (the run is this process's own mark, the seq rises by one an event), `event: <type>`, `data: <JSON>`. A
 *                 heartbeat every 15 s: a comment line, and an `hb` event without an id, so a page that hears nothing for longer knows the
 *                 stream is silent
 *   coalesced     the market's quote, trades and book go out at most once a window per market (quote and trades 100 ms, book 250 ms): the
 *                 first at once, the latest of what came within the window at its end — and only to the pages that FOLLOW that market.
 *                 They are never kept for a resume: a page reads the market afresh
 *   following     a page names itself when it opens its stream (?client=) and then says which markets it shows (follow: POST
 *                 /api/stream/markets), at most MAX_FOLLOWS, each as `<venue>:<symbol>`; what it follows is told to the follows
 *                 (onFollow), which hold those markets from the hub while a page shows them and emit their quote, book and trades under
 *                 that key — or, for a key with a "~" before it, its quote only. A page that goes away follows nothing any more (told too).
 *                 Each telling is numbered by the page (`n`): one no later than the latest taken from it is let be. The same tab come back
 *                 under its name before its old stream was let go carries what it followed over, and what each of those markets stands
 *                 at now is told to it again at once (onAgain)
 *   a start       every stream opens with a SNAPSHOT under the seq the bus stands at (a page that names an id of this run the bus has
 *                 reached is sent none: nothing is kept to resume, and nothing came that it missed but the market's, which it reads
 *                 afresh). The snapshot carries the bus's seq alone (`at`)
 *   a slow page   one whose socket does not take a frame at once (res.write said false) is sent nothing more until it drains: meanwhile
 *                 only the latest per market waits, sent in the order it was emitted when it drains
 *   closing       end() ends every stream open and lets go of every timer
 *
 * Before any page has listened, nothing is done: emit() returns at once. Nothing here reads the market: it only carries what it is given. */
import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

/** what goes out at most once a window per market, the latest of what came: the window, ms */
export const COALESCE_MS: Readonly<Record<string, number>> = { quote: 100, trades: 100, book: 250 };
export type StreamEvent = "quote" | "trades" | "book";

const HEARTBEAT_MS = 15_000;
const RETRY_MS = 1_000;
const MAX_CLIENTS = 32;
/** the markets one page follows at once, and the longest key */
export const MAX_FOLLOWS = 16;
const FOLLOW_KEY_MAX = 160;
/** a page's own name for itself, as it opens its stream (?client=) */
export const CLIENT_ID = /^[A-Za-z0-9_-]{8,48}$/;
/** an event's id as it is written (`<run>.<seq>`) */
export const STREAM_ID = /^([a-z0-9]{1,16})\.(\d{1,15})$/;

export interface MarketStreamOptions {
  heartbeatMs?: number | undefined;
  /** what a page waits before it asks again after the stream dropped, as the stream tells it */
  retryMs?: number | undefined;
  /** the streams open at once; one more is answered 503 by the route */
  maxClients?: number | undefined;
  /** the coalescing windows, by event, ms (COALESCE_MS unless said) */
  coalesceMs?: Partial<Record<string, number>> | undefined;
  /** told what a page follows each time it changes — [] when it follows nothing any more (it went away) */
  onFollow?: ((client: string, keys: string[]) => void) | undefined;
  /** told when a page's stream opened again carrying over what it followed: each of those markets' quote, book and trades as they stand now
   * are to be emitted again */
  onAgain?: ((client: string, keys: string[]) => void) | undefined;
  clock?: (() => number) | undefined;
}

interface Resolved {
  heartbeatMs: number;
  retryMs: number;
  maxClients: number;
  coalesceMs: Record<string, number>;
  onFollow: (client: string, keys: string[]) => void;
  onAgain: (client: string, keys: string[]) => void;
  clock: () => number;
}
/** a frame as it was written, with the seq it went out under */
interface Kept {
  seq: number;
  frame: string;
}
interface Client {
  res: ServerResponse;
  /** the page's own name for itself ("" when it gave none: it follows nothing) */
  id: string;
  follows: Set<string>;
  /** the number of the latest telling of them taken from the page (follow's `n`; 0 before any numbered one) */
  told: number;
  /** the socket did not take the last frame at once: nothing more is written until it drains */
  slow: boolean;
  /** coalesced events waiting for it to drain: the latest per market */
  latest: Map<string, Kept>;
}
interface Pending {
  type: string;
  data: unknown;
  key: string;
  timer: ReturnType<typeof setTimeout>;
}

export class MarketStream {
  /** this process's own mark, in every id */
  readonly run = randomBytes(4).toString("hex");
  private seq = 0;
  private readonly clients = new Set<Client>();
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  /** coalesced events waiting for their window's end, and when each market's last one went out, by type|key */
  private readonly pending = new Map<string, Pending>();
  private readonly sentAt = new Map<string, number>();
  /** a page has listened since the process started */
  private heard = false;
  private readonly o: Resolved;

  constructor(opts: MarketStreamOptions = {}) {
    this.o = {
      heartbeatMs: opts.heartbeatMs ?? HEARTBEAT_MS,
      retryMs: opts.retryMs ?? RETRY_MS,
      maxClients: opts.maxClients ?? MAX_CLIENTS,
      coalesceMs: { ...COALESCE_MS, ...Object.fromEntries(Object.entries(opts.coalesceMs ?? {}).filter((e): e is [string, number] => typeof e[1] === "number")) },
      onFollow: opts.onFollow ?? (() => undefined),
      onAgain: opts.onAgain ?? (() => undefined),
      clock: opts.clock ?? (() => Date.now()),
    };
  }

  /** the streams open now */
  get listening(): number {
    return this.clients.size;
  }
  /** room for one more stream */
  room(): boolean {
    return this.clients.size < this.o.maxClients;
  }
  /** the seq the bus stands at: the last event's */
  get at(): string {
    return `${this.run}.${this.seq}`;
  }

  /** One market's event (its quote, trades or book, by `key`: the market as the pages follow it), at most once a window per key — the
   * first at once, the latest of the window at its end — and only to the pages that follow it: none following, nothing is done. Nothing is
   * done before a page has listened. The data is written as it is when it goes out (JSON), never read again later */
  emit(type: StreamEvent, data: unknown, key: string): void {
    if (!this.heard) return;
    const window = this.o.coalesceMs[type] ?? COALESCE_MS[type]!;
    if (!this.followed(key)) return;
    const k = `${type}|${key}`;
    const waiting = this.pending.get(k);
    if (waiting) return void (waiting.data = data);
    const now = this.o.clock();
    const last = this.sentAt.get(k);
    if (last === undefined || now - last >= window) {
      this.sentAt.set(k, now);
      return void this.send(type, data, k, key);
    }
    const timer = setTimeout(() => {
      const p = this.pending.get(k);
      this.pending.delete(k);
      if (!p) return;
      this.sentAt.set(k, this.o.clock());
      this.send(p.type, p.data, k, p.key);
    }, Math.max(0, window - (now - last)));
    timer.unref?.();
    this.pending.set(k, { type, data, key, timer });
    // the markets nobody has asked about for a while are let go
    if (this.sentAt.size > 2000) for (const [x, at] of this.sentAt) if (now - at > 60_000) this.sentAt.delete(x);
  }

  /** A page's stream: the head (what to wait before asking again), then a snapshot — none when `last` is an id of this run the bus has
   * reached — then every event as it comes, until the page goes or end() ends it. `client` the page's own name for itself (CLIENT_ID; ""
   * for none: it follows no market). A name already open is the same tab come back: the stream it held is let go, and what it followed
   * carries over to this one — each of those markets told to it again at once (onAgain), after its head. The route has checked there is
   * room (room()) and that `last` is shaped as an id */
  attach(req: IncomingMessage, res: ServerResponse, last: string, client = ""): void {
    this.heard = true;
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
    req.socket.setNoDelay(true);
    const from = STREAM_ID.exec(last);
    const resumes = !!from && from[1] === this.run && Number(from[2]) <= this.seq;
    const frames = resumes ? [] : [this.snapshotFrame()];
    const id = CLIENT_ID.test(client) ? client : "";
    // the same tab come back before its old stream was let go: that one goes, and its markets come with the page
    const was = id ? [...this.clients].find((c) => c.id === id) : undefined;
    const c: Client = { res, id, follows: new Set(was?.follows ?? []), told: was?.told ?? 0, slow: false, latest: new Map() };
    if (was) {
      this.clients.delete(was);
      try {
        was.res.end();
      } catch {
        // a socket already gone
      }
    }
    this.clients.add(c);
    res.on("close", () => this.drop(c));
    this.write(c, `retry: ${this.o.retryMs}\n\n${frames.join("")}`);
    this.beat();
    if (c.follows.size) {
      try {
        this.o.onAgain(id, [...c.follows]);
      } catch {
        // the bus goes on
      }
    }
  }

  /** WHAT A PAGE FOLLOWS: the markets it shows now, each as `<venue>:<symbol>` (at most MAX_FOLLOWS, the rest left out), in place of what
   * it followed before. `n`: the page's own number for this telling: one numbered no higher than a telling already taken from it came late,
   * so it is let be. The keys it follows now, or undefined when no stream of that name is open */
  follow(client: string, keys: readonly string[], n?: number): string[] | undefined {
    const c = client ? [...this.clients].find((x) => x.id === client) : undefined;
    if (!c) return undefined;
    if (n !== undefined) {
      if (n <= c.told) return [...c.follows];
      c.told = n;
    }
    const now = [...new Set(keys.map((k) => String(k ?? "").trim()).filter((k) => k && k.length <= FOLLOW_KEY_MAX && k.includes(":")))].slice(0, MAX_FOLLOWS);
    const same = now.length === c.follows.size && now.every((k) => c.follows.has(k));
    c.follows = new Set(now);
    if (!same) this.told(c.id, now);
    return now;
  }

  /** whether a page follows the market (its key, as emit() is given it) */
  followed(key: string): boolean {
    for (const c of this.clients) if (c.follows.has(key)) return true;
    return false;
  }

  /** what one page follows now (undefined when no stream of that name is open) */
  followsOf(client: string): ReadonlySet<string> | undefined {
    return client ? [...this.clients].find((c) => c.id === client)?.follows : undefined;
  }

  /** every market some page follows now, and the pages following each */
  following(): Map<string, number> {
    const out = new Map<string, number>();
    for (const c of this.clients) for (const k of c.follows) out.set(k, (out.get(k) ?? 0) + 1);
    return out;
  }

  /** every stream open ended, every timer let go: the server is closing */
  end(): void {
    for (const c of [...this.clients]) {
      this.clients.delete(c);
      if (c.id && c.follows.size) this.told(c.id, []);
      try {
        c.res.end();
      } catch {
        // a socket already gone
      }
    }
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.pending.clear();
    this.stopBeat();
  }

  /** `coalesced`: the event's type|key — `key` the market, as the pages follow it: only they are sent it */
  private send(type: string, data: unknown, coalesced: string, key: string): void {
    if (!this.followed(key)) return;
    const seq = ++this.seq;
    const frame = `id: ${this.run}.${seq}\nevent: ${type}\ndata: ${JSON.stringify(data ?? null)}\n\n`;
    for (const c of this.clients) {
      if (!c.follows.has(key)) continue;
      if (!c.slow) {
        this.write(c, frame);
        continue;
      }
      // a slow page: the latest per market
      c.latest.set(coalesced, { seq, frame });
    }
  }

  /** one frame (or several, joined) to a page: a socket that does not take it at once makes the page slow until it drains */
  private write(c: Client, text: string): void {
    let ok = true;
    try {
      ok = c.res.write(text);
    } catch {
      return void this.drop(c);
    }
    if (ok || c.slow) return;
    c.slow = true;
    c.res.once("drain", () => this.drained(c));
  }

  /** a slow page drained: the latest of each market goes out in the order it was emitted, so the ids it hears only rise */
  private drained(c: Client): void {
    if (!this.clients.has(c)) return;
    const frames = [...c.latest.values()].sort((a, b) => a.seq - b.seq).map((k) => k.frame);
    c.latest.clear();
    c.slow = false;
    if (frames.length) this.write(c, frames.join(""));
  }

  private snapshotFrame(): string {
    return `id: ${this.run}.${this.seq}\nevent: snapshot\ndata: ${JSON.stringify({ at: this.at })}\n\n`;
  }

  private drop(c: Client): void {
    if (!this.clients.delete(c)) return;
    // a page gone follows nothing — unless its tab came back under the same name meanwhile (attach carried what it followed over)
    if (c.id && c.follows.size && ![...this.clients].some((x) => x.id === c.id)) this.told(c.id, []);
    if (!this.clients.size) this.stopBeat();
  }

  /** what a page follows, told to the follows; its fault is its own */
  private told(client: string, keys: string[]): void {
    try {
      this.o.onFollow(client, keys);
    } catch {
      // the bus goes on
    }
  }

  /** the heartbeat, while a page listens: a comment and an `hb` event (no id) to each page that is not slow */
  private beat(): void {
    if (this.heartbeat || !(this.o.heartbeatMs > 0)) return;
    this.heartbeat = setInterval(() => {
      const now = this.o.clock();
      for (const c of [...this.clients]) if (!c.slow) this.write(c, `: hb ${now}\nevent: hb\ndata: {"at":${now}}\n\n`);
    }, this.o.heartbeatMs);
    this.heartbeat.unref?.();
  }
  private stopBeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
  }
}
