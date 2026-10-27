/** THE ACCOUNT'S PUSH CHANNEL: what changes on the account, told to the pages listening as it happens (GET /api/account/stream, server.ts;
 * the page's end is ui/stream.js). One bus for the service: the paper accounts' books (live/paper.ts: an order's state, a fill, a position, the
 * cash, the book itself — a background look's fills as the owner's own; service.ts paperSaid), the account's own record (every statement line
 * the ledger takes, an order with it; a card raised) and the desk's floor (account/desk.ts, told on each change of its record or its work)
 * are emitted here, and each page holds one stream.
 *
 *   the wire      text/event-stream: `retry: 1000` first (a stream that drops is asked again after a second), then one frame an event —
 *                 `id: <run>.<seq>` (the run is this process's own mark, the seq rises by one an event, so a page names where it stopped),
 *                 `event: <type>`, `data: <JSON>`. A heartbeat every 15 s: a comment line, and an `hb` event without an id, so a page
 *                 that hears nothing for longer knows the stream is silent (a comment alone never reaches a page's script)
 *   two kinds     ACCOUNT events — order, fill, position, balance, paper, statement, card, desk — go out at once, in order, to every page,
 *                 and the last RING_SIZE of them are kept for a resume (the desk among them: a page that comes back after a gap hears that
 *                 its floor moved, and reads it again). COALESCED events — the market's quote, trades and book — go out at most once a
 *                 window per market (quote and trades 100 ms, book 250 ms): the first at once, the latest of what came within the window at
 *                 its end — and only to the pages that FOLLOW that market. They are never kept for a resume: a page reads the market afresh
 *   following     a page names itself when it opens its stream (?client=, a name of its own a tab keeps) and then says which markets it
 *                 shows (follow: POST /api/account/stream/markets, server.ts), at most MAX_FOLLOWS, each as `<venue>:<symbol>`; what it
 *                 follows is told to the service (onFollow), which streams those markets from the venues (live/stream-hub.ts) while a page
 *                 shows them, and emits their quote, book and trades under that key — or, for a key with a "~" before it (a market whose
 *                 price alone the page shows: a position's mark), its quote only. A page that goes away follows nothing any more (told
 *                 too). A page that named no client is sent the account events only. Each telling is numbered by the page (`n`, rising
 *                 with each it sends): one no later than the latest taken from it is let be, so two said back to back that overtake each
 *                 other on their way leave it following the later. The same tab come back under its name before its old stream was let
 *                 go carries what it followed over, and what each of those markets stands at now is told to it again at once (onAgain):
 *                 the page let go of what its old stream had pushed when that dropped
 *   a resume      a page that comes back names the last event it heard (Last-Event-ID, which a browser sends by itself when it reconnects,
 *                 or ?since= when it opens a new stream): the account events after it are sent again, from the ring. One from another
 *                 run, one the ring no longer reaches (more came meanwhile than it keeps), or none at all is sent a SNAPSHOT instead —
 *                 what the service says the account is now (its orders, its paper books), under the seq it stands at — and the page reads
 *                 afresh
 *   a slow page   one whose socket does not take a frame at once (res.write said false) is sent nothing more until it drains: meanwhile
 *                 its account events wait in a list of at most MAX_BACKLOG (past it, the list is let go and the page is sent a snapshot
 *                 alone when it drains), and its coalesced events only as the latest per market. What waited goes out in the order it was
 *                 emitted — by its seq, account events and the market's latest together — so the ids a page hears only ever rise, and
 *                 the last one it heard is always one it may resume from without missing an account event. Nothing grows without a bound
 *   closing       end() ends every stream open and lets go of every timer, so a server that closes (and a test) is never held open by
 *                 one; a page that goes away is let go at once
 *
 * Before any page has listened, nothing is kept: emit() returns at once (a page's first stream is sent a snapshot in any case), so a process
 * no page watches pays nothing for it. Nothing here reads or writes the account: it only carries what it is given. */
import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

/** what goes out at once and is kept for a resume */
export const ACCOUNT_EVENTS = ["order", "fill", "position", "balance", "paper", "statement", "card", "desk"] as const;
/** what goes out at most once a window per market, the latest of what came: the window, ms */
export const COALESCE_MS: Readonly<Record<string, number>> = { quote: 100, trades: 100, book: 250 };
export type AccountEvent = (typeof ACCOUNT_EVENTS)[number];
export type StreamEvent = AccountEvent | "quote" | "trades" | "book";

const RING_SIZE = 500;
const HEARTBEAT_MS = 15_000;
const RETRY_MS = 1_000;
const MAX_CLIENTS = 32;
const MAX_BACKLOG = 256;
/** the markets one page follows at once, and the longest key */
export const MAX_FOLLOWS = 16;
const FOLLOW_KEY_MAX = 160;
/** a page's own name for itself, as it opens its stream (?client=) */
export const CLIENT_ID = /^[A-Za-z0-9_-]{8,48}$/;
/** an event's id as it is written (`<run>.<seq>`): what a page may name to resume from */
export const STREAM_ID = /^([a-z0-9]{1,16})\.(\d{1,15})$/;

export interface AccountStreamOptions {
  /** the account events kept for a resume */
  ringSize?: number | undefined;
  heartbeatMs?: number | undefined;
  /** what a page waits before it asks again after the stream dropped, as the stream tells it */
  retryMs?: number | undefined;
  /** the streams open at once; one more is answered 503 by the route (one a tab: a page that opens more is broken) */
  maxClients?: number | undefined;
  /** the account events a slow page may have waiting before it is sent a snapshot instead */
  maxBacklog?: number | undefined;
  /** the coalescing windows, by event, ms (COALESCE_MS unless said) */
  coalesceMs?: Partial<Record<string, number>> | undefined;
  /** what the account is now, for a snapshot (the service's own: its orders, its paper books) */
  snapshot?: (() => unknown) | undefined;
  /** told what a page follows each time it changes — [] when it follows nothing any more (it went away) */
  onFollow?: ((client: string, keys: string[]) => void) | undefined;
  /** told when a page's stream opened again carrying over what it followed (the same tab, its old stream not let go yet): each of those
   * markets' quote, book and trades as they stand now are to be emitted again, since the page let go of what its old stream pushed */
  onAgain?: ((client: string, keys: string[]) => void) | undefined;
  clock?: (() => number) | undefined;
}

/** the options as the bus uses them: each said, or its default */
interface Resolved {
  ringSize: number;
  heartbeatMs: number;
  retryMs: number;
  maxClients: number;
  maxBacklog: number;
  coalesceMs: Record<string, number>;
  snapshot: () => unknown;
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
  /** the markets it follows: their coalesced events reach it */
  follows: Set<string>;
  /** the number of the latest telling of them taken from the page (follow's `n`; 0 before any numbered one) */
  told: number;
  /** the socket did not take the last frame at once: nothing more is written until it drains */
  slow: boolean;
  /** account events waiting for it to drain, in order */
  backlog: Kept[];
  /** coalesced events waiting for it to drain: the latest per market */
  latest: Map<string, Kept>;
  /** more account events waited than MAX_BACKLOG: it is sent a snapshot when it drains instead */
  overflow: boolean;
}
interface Pending {
  type: string;
  data: unknown;
  key: string;
  timer: ReturnType<typeof setTimeout>;
}

export class AccountStream {
  /** this process's own mark, in every id: an id from another run (a restart) is never resumed from */
  readonly run = randomBytes(4).toString("hex");
  private seq = 0;
  private readonly ring: Kept[] = [];
  /** the seq of the newest account event the ring let go: a resume from before it would miss some, so it is a snapshot */
  private dropped = 0;
  private readonly clients = new Set<Client>();
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  /** coalesced events waiting for their window's end, and when each market's last one went out, by type|key */
  private readonly pending = new Map<string, Pending>();
  private readonly sentAt = new Map<string, number>();
  /** a page has listened since the process started: from then on, what is emitted is kept for a resume */
  private heard = false;
  private readonly o: Resolved;

  constructor(opts: AccountStreamOptions = {}) {
    this.o = {
      ringSize: opts.ringSize ?? RING_SIZE,
      heartbeatMs: opts.heartbeatMs ?? HEARTBEAT_MS,
      retryMs: opts.retryMs ?? RETRY_MS,
      maxClients: opts.maxClients ?? MAX_CLIENTS,
      maxBacklog: opts.maxBacklog ?? MAX_BACKLOG,
      coalesceMs: { ...COALESCE_MS, ...Object.fromEntries(Object.entries(opts.coalesceMs ?? {}).filter((e): e is [string, number] => typeof e[1] === "number")) },
      snapshot: opts.snapshot ?? (() => ({})),
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
  /** the seq the account stands at: the last event's */
  get at(): string {
    return `${this.run}.${this.seq}`;
  }

  /** One event, told to every page listening. An account event goes out at once and is kept for a resume; a coalesced one (a market's quote,
   * trades or book, by `key`: the market as the pages follow it) at most once a window per key — the first at once, the latest of the window
   * at its end — and only to the pages that follow it: none following, nothing is done. Nothing is done before a page has listened. The data
   * is written as it is when it goes out (JSON), never read again later */
  emit(type: StreamEvent, data: unknown, key = ""): void {
    if (!this.heard) return;
    const window = this.o.coalesceMs[type];
    if (window === undefined) return void this.send(type, data, undefined);
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

  /** A page's stream: the head (what to wait before asking again), then the account events after `last` when the ring reaches back to it —
   * else a snapshot — then every event as it comes, until the page goes or end() ends it. `last` is the id the page heard last
   * (Last-Event-ID, or ?since=), "" for none; `client` the page's own name for itself (CLIENT_ID; "" for none: it follows no market). A
   * name already open is the same tab come back: the stream it held is let go, and what it followed carries over to this one — each of
   * those markets told to it again at once (onAgain), after its head. The route has checked there is room (room()) and that `last` is
   * shaped as an id */
  attach(req: IncomingMessage, res: ServerResponse, last: string, client = ""): void {
    this.heard = true;
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
    req.socket.setNoDelay(true);
    const from = STREAM_ID.exec(last);
    const seq = from ? Number(from[2]) : NaN;
    const resumes = !!from && from[1] === this.run && seq <= this.seq && seq >= this.dropped;
    const frames = resumes ? this.ring.filter((k) => k.seq > seq).map((k) => k.frame) : [this.snapshotFrame()];
    const id = CLIENT_ID.test(client) ? client : "";
    // the same tab come back before its old stream was let go: that one goes, and its markets come with the page
    const was = id ? [...this.clients].find((c) => c.id === id) : undefined;
    const c: Client = { res, id, follows: new Set(was?.follows ?? []), told: was?.told ?? 0, slow: false, backlog: [], latest: new Map(), overflow: false };
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
    // what the markets it carried over stand at now, told again (the page let go of what its old stream pushed as that dropped)
    if (c.follows.size) {
      try {
        this.o.onAgain(id, [...c.follows]);
      } catch {
        // the bus goes on
      }
    }
  }

  /** WHAT A PAGE FOLLOWS: the markets it shows now, each as `<venue>:<symbol>` (at most MAX_FOLLOWS, the rest left out), in place of what
   * it followed before — their quote, book and trades reach it from now on. `n`: the page's own number for this telling (each it sends
   * one more): one numbered no higher than a telling already taken from it came late — a later one overtook it — so it is let be. The keys
   * it follows now, or undefined when no stream of that name is open */
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

  /** `coalesced`: the event's type|key, for a market's event — `key` the market, as the pages follow it: only they are sent it */
  private send(type: string, data: unknown, coalesced: string | undefined, key = ""): void {
    if (coalesced !== undefined && !this.followed(key)) return;
    const seq = ++this.seq;
    const frame = `id: ${this.run}.${seq}\nevent: ${type}\ndata: ${JSON.stringify(data ?? null)}\n\n`;
    if (coalesced === undefined) {
      this.ring.push({ seq, frame });
      if (this.ring.length > this.o.ringSize) this.dropped = this.ring.shift()!.seq;
    }
    for (const c of this.clients) {
      if (coalesced !== undefined && !c.follows.has(key)) continue;
      if (!c.slow) {
        this.write(c, frame);
        continue;
      }
      // a slow page: the latest per market, and the account events in order — up to the backlog's bound, past it a snapshot when it drains
      if (coalesced !== undefined) c.latest.set(coalesced, { seq, frame });
      else if (c.overflow) continue;
      else if (c.backlog.length >= this.o.maxBacklog) {
        c.backlog = [];
        c.overflow = true;
      } else c.backlog.push({ seq, frame });
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

  /** a slow page drained: what waited for it goes out in the order it was emitted — the latest of each market and its account events
   * merged by their seq, so the ids it hears only rise (a page that drops after a market's frame and resumes from its id has missed no
   * account event before it) — or, when more waited than the backlog keeps, the snapshot alone (under the seq the account stands at, past
   * all of them). Never a market's frame before that snapshot: its id is past the account events let go, so a page that dropped after it
   * and resumed from it would be sent only what came after, and miss them with no snapshot; the page reads the market afresh after a
   * snapshot in any case. It is slow again only if that is not taken at once either */
  private drained(c: Client): void {
    if (!this.clients.has(c)) return;
    const frames = c.overflow ? [this.snapshotFrame()] : [...c.latest.values(), ...c.backlog].sort((a, b) => a.seq - b.seq).map((k) => k.frame);
    c.latest.clear();
    c.backlog = [];
    c.overflow = false;
    c.slow = false;
    if (frames.length) this.write(c, frames.join(""));
  }

  private snapshotFrame(): string {
    let data: unknown;
    try {
      data = this.o.snapshot();
    } catch {
      data = {};
    }
    return `id: ${this.run}.${this.seq}\nevent: snapshot\ndata: ${JSON.stringify({ ...(data && typeof data === "object" ? data : {}), at: this.at })}\n\n`;
  }

  private drop(c: Client): void {
    if (!this.clients.delete(c)) return;
    // a page gone follows nothing — unless its tab came back under the same name meanwhile (attach carried what it followed over)
    if (c.id && c.follows.size && ![...this.clients].some((x) => x.id === c.id)) this.told(c.id, []);
    if (!this.clients.size) this.stopBeat();
  }

  /** what a page follows, told to the service; its fault is its own */
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
