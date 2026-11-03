/** THE MARKET'S HUB, MIRRORED IN THE ACCOUNT (plan A1 task 4): a MarketHub the paper account and the service ask as they asked the venues'
 * streams in-process (paper.ts, service.ts pageFollows), answered from what the market's hub stream says (GET /api/hub, the market's
 * protocol.ts) — one stream for the whole account, under the link's own client name.
 *
 *   covers        answered here, without asking (shapes.ts hubCovers: what the market's hub streams)
 *   hold, want    sent to the market (POST /api/hub/hold, /api/hub/want — a want at most every WANT_EVERY_MS a market) and remembered, so a
 *                 stream opened again sends them again: the market lets every hold of a client go when its last stream closes
 *   quote, book,  the last of each the stream said, per market, and its trades ring (RING_SIZE at most, each trade with the market's seq),
 *   trades, since the ring's newest trade the market let go of (evictedSeq): since() counts it as the market's own hub does
 *   confirmed     the market's /api/hub/confirmed — undefined at once while the stream is down: a price nobody confirms now fills nothing
 *   onTick        a tick for each event the stream carries
 *
 * WHEN THE STREAM DROPS (the market restarting, or gone): every quote and book kept goes `live: false`, each market's `live` tick told, and
 * the stream is opened again after a wait that doubles from BACKOFF_MIN_MS to BACKOFF_MAX_MS; once it is open, every hold and want is sent
 * again. A stream that says nothing for SILENT_MS (the market's heartbeat is every 15 s) is taken for dropped.
 *
 * EACH STREAM IS AN EPOCH. A market that restarts counts its seqs from 0 again, and even one that did not sends its whole ring again to a
 * stream opened anew. So on each open every market's ring, its latest trades and its evicted seq are let go, and every seq the stream
 * says is REBASED onto the highest seq the account was told before (`base`): seqs here rise across restarts, so a seq paper judged an
 * order at (paper.ts judgedAt) stands below every trade of the new epoch, and no trade of an old one is left to touch it. A trade the new
 * stream carries that was stamped before it opened is marked a snapshot's (`snap`), as a venue's resubscription snapshot is: paper counts it
 * only if it was stamped after the moment it last judged (SinceCut.snapshotAfter). */
import { isRefusal } from "../../core/errors.ts";
import type { PublicTrade } from "../live/trade.ts";
import type { MarketClient } from "./client.ts";
import { BOOK_TOP, hubCovers, type HubBook, type HubQuote, type HubRange, type HubRing, type HubTick, type MarketHub, type SinceCut } from "./shapes.ts";

/** the trades kept per market (the market's stream-hub.ts RING_SIZE) */
export const RING_SIZE = 200;
/** the stream's wait before it is opened again: between these, doubling with each try (the market's stream-hub.ts) */
export const BACKOFF_MIN_MS = 500;
export const BACKOFF_MAX_MS = 30_000;
/** a want is sent again at most this often per market (it lasts a minute at the market: stream-hub.ts IDLE_MS) */
export const WANT_EVERY_MS = 10_000;
/** how long a want is remembered, to be sent again on a stream opened again (stream-hub.ts IDLE_MS) */
const WANT_LASTS_MS = 60_000;
/** a stream silent this long is dead: three of the market's heartbeats (protocol.ts HEARTBEAT_MS) */
export const SILENT_MS = 45_000;
/** the longest /api/hub/confirmed waits at the market (protocol.ts HUB_WAIT_MAX_MS) */
const CONFIRM_WAIT_MAX_MS = 5_000;

/** one event on the market's /api/hub (protocol.ts HubEvent) */
type HubEvent =
  | { t: "quote"; source: string; symbol: string; quote: HubQuote }
  | { t: "book"; source: string; symbol: string; book: HubBook }
  | { t: "trades"; source: string; symbol: string; ring: HubRing["trades"]; evictedSeq: number; recent: PublicTrade[] }
  | { t: "live"; source: string; symbol: string; live: boolean };

/** one market as the stream has told it */
interface Mirror {
  quote?: HubQuote | undefined;
  book?: HubBook | undefined;
  recent: PublicTrade[];
  ring: HubRing["trades"];
  evictedSeq: number;
}

export interface RemoteHubOptions {
  /** the link's own name at the market's hub (CLIENT_ID: 8 to 48 letters, digits, "-" or "_") */
  clientId: string;
  /** the network the stream is opened over (the global fetch unless said) */
  fetch?: typeof fetch | undefined;
  clock?: (() => number) | undefined;
}

export class RemoteHub implements MarketHub {
  private readonly http: typeof fetch;
  private readonly clock: () => number;
  private readonly mirrors = new Map<string, Mirror>();
  /** each hold asked here, by `source|symbol` or `source|symbol|book`, and how many hold it */
  private readonly holds = new Map<string, { source: string; symbol: string; book: boolean; n: number }>();
  /** each market wanted, and when it was last sent */
  private readonly wants = new Map<string, { source: string; symbol: string; sentAt: number; wantedAt: number }>();
  private readonly listeners = new Set<(t: HubTick) => void>();
  private started = false;
  private closed = false;
  private open = false;
  private tries = 0;
  private stream: AbortController | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private silent: ReturnType<typeof setTimeout> | undefined;
  /** this epoch's base (every seq the stream says is this much higher here), the highest seq given out here, and when this epoch began */
  private base = 0;
  private highSeq = 0;
  private epochAt = 0;

  constructor(private readonly c: MarketClient, private readonly o: RemoteHubOptions) {
    this.http = o.fetch ?? fetch;
    this.clock = o.clock ?? Date.now;
  }

  /** the stream opened, and kept open until close() */
  start(): void {
    if (this.started || this.closed) return;
    this.started = true;
    void this.connect();
  }

  covers(source: string, symbol: string): boolean {
    return hubCovers(source, symbol).covers;
  }
  pricesOnly(source: string, symbol: string): boolean {
    return hubCovers(source, symbol).pricesOnly;
  }

  want(source: string, symbol: string): boolean {
    if (!this.covers(source, symbol)) return false;
    const k = `${source}|${symbol}`;
    const now = this.clock();
    const was = this.wants.get(k);
    if (!was || now - was.sentAt >= WANT_EVERY_MS) {
      this.wants.set(k, { source, symbol, sentAt: now, wantedAt: now });
      this.sendWant(source, symbol);
    } else was.wantedAt = now;
    return true;
  }

  hold(source: string, symbol: string, o: { book?: boolean | undefined } = {}): () => void {
    // a market the market's hub does not stream is held by nothing
    if (!this.covers(source, symbol)) return () => undefined;
    const book = o.book === true;
    const k = `${source}|${symbol}${book ? "|book" : ""}`;
    const h = this.holds.get(k) ?? { source, symbol, book, n: 0 };
    this.holds.set(k, h);
    if (h.n++ === 0) this.sendHold(source, symbol, book, true);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const now = this.holds.get(k);
      if (!now) return;
      if (--now.n > 0) return;
      this.holds.delete(k);
      if (!this.closed) this.sendHold(source, symbol, book, false);
    };
  }

  quote(source: string, symbol: string): HubQuote | undefined {
    return this.mirrors.get(`${source}|${symbol}`)?.quote;
  }
  book(source: string, symbol: string, depth = BOOK_TOP): HubBook | undefined {
    const b = this.mirrors.get(`${source}|${symbol}`)?.book;
    if (!b) return undefined;
    const d = Math.max(1, Math.floor(depth));
    return b.bids.length <= d && b.asks.length <= d ? b : { ...b, bids: b.bids.slice(0, d), asks: b.asks.slice(0, d) };
  }
  trades(source: string, symbol: string, limit: number): PublicTrade[] {
    const m = this.mirrors.get(`${source}|${symbol}`);
    if (!m) return [];
    return m.recent.slice(0, Math.max(1, Math.min(RING_SIZE, Math.floor(limit) || 30)));
  }

  /** the trades' extremes since `seq`, from the mirrored ring — the market's own StreamHub.since loop, over the same seqs. The seq it stands
   * at now is the market's latest it has been told: its quote's, or a newer trade's (a trades event carries no seq of its own) */
  since(source: string, symbol: string, seq: number, cut: SinceCut = {}): HubRange {
    const mk = this.mirrors.get(`${source}|${symbol}`);
    if (!mk) return { trades: 0, seq: 0 };
    let hi: number | undefined;
    let lo: number | undefined;
    let n = 0;
    for (const t of mk.ring) {
      if (t.seq <= seq) continue;
      if (cut.after !== undefined && t.at <= cut.after) continue;
      if (t.snap && cut.snapshotAfter !== undefined && t.at <= cut.snapshotAfter) continue;
      n++;
      hi = hi === undefined ? t.price : Math.max(hi, t.price);
      lo = lo === undefined ? t.price : Math.min(lo, t.price);
    }
    const at = Math.max(mk.quote?.seq ?? 0, mk.ring.at(-1)?.seq ?? 0);
    return { ...(hi !== undefined ? { hi } : {}), ...(lo !== undefined ? { lo } : {}), trades: n, seq: at, ...(mk.evictedSeq > seq ? { partial: true as const } : {}) };
  }

  async confirmed(source: string, symbol: string, maxAgeMs: number, waitMs: number): Promise<HubQuote | undefined> {
    // a market whose stream is not open now confirms nothing: no price is taken for this moment's
    if (!this.open) return undefined;
    const p = new URLSearchParams({ source, symbol, maxAgeMs: String(Math.max(0, Math.min(86_400_000, Math.floor(maxAgeMs)))), waitMs: String(Math.max(0, Math.min(CONFIRM_WAIT_MAX_MS, Math.floor(waitMs)))) });
    const base = this.base;
    const r = await this.c.get<HubQuote | null>(`/api/hub/confirmed?${p}`, 0);
    // an answer from before a stream opened anew is of another epoch: not taken
    if (isRefusal(r) || !r.value || base !== this.base || !this.open) return undefined;
    const q = { ...r.value, seq: this.rebased(r.value.seq) };
    const m = this.mirrors.get(`${source}|${symbol}`);
    if (m && (!m.quote || q.seq >= m.quote.seq)) m.quote = q;
    return q;
  }

  onTick(fn: (t: HubTick) => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  /** the stream closed for good (the account closing): the market lets this client's holds go with it */
  close(): void {
    this.closed = true;
    if (this.retry) clearTimeout(this.retry);
    if (this.silent) clearTimeout(this.silent);
    this.stream?.abort();
    this.stream = undefined;
    this.open = false;
    this.listeners.clear();
  }

  // ---- the wire ---------------------------------------------------------------------------------------------------------------------

  private sendHold(source: string, symbol: string, book: boolean, held: boolean): void {
    void this.c.post("/api/hub/hold", { client: this.o.clientId, source, symbol, book, held }).catch(() => undefined);
  }
  private sendWant(source: string, symbol: string): void {
    void this.c.post("/api/hub/want", { client: this.o.clientId, source, symbol }).catch(() => undefined);
  }
  /** every hold, and every want still lasting, sent again (a stream opened: the market kept none of them past the last one) */
  private sendAll(): void {
    const now = this.clock();
    for (const h of this.holds.values()) this.sendHold(h.source, h.symbol, h.book, true);
    for (const [k, w] of this.wants) {
      if (now - w.wantedAt > WANT_LASTS_MS) {
        this.wants.delete(k);
        continue;
      }
      w.sentAt = now;
      this.sendWant(w.source, w.symbol);
    }
  }
  private tell(source: string, symbol: string, what: HubTick["what"]): void {
    for (const fn of [...this.listeners]) {
      try {
        fn({ source, symbol, what });
      } catch {
        // a listener's throw is its own: the rest are told
      }
    }
  }
  private mirror(source: string, symbol: string): Mirror {
    const k = `${source}|${symbol}`;
    let m = this.mirrors.get(k);
    if (!m) this.mirrors.set(k, (m = { recent: [], ring: [], evictedSeq: 0 }));
    return m;
  }
  /** a seq the stream said, as it is counted here (this epoch's base under it), and the highest given out kept */
  private rebased(seq: unknown): number {
    const n = this.base + Math.max(0, Number(seq) || 0);
    if (n > this.highSeq) this.highSeq = n;
    return n;
  }
  /** a new epoch (a stream opened): its seqs counted from above every one given out before, and every market's trades let go */
  private newEpoch(): void {
    this.base = this.highSeq;
    this.epochAt = this.clock();
    for (const m of this.mirrors.values()) {
      m.ring = [];
      m.recent = [];
      m.evictedSeq = 0;
    }
  }
  /** what one event says, kept, and told */
  private heard(e: HubEvent): void {
    if (!e || typeof e !== "object" || typeof e.source !== "string" || typeof e.symbol !== "string") return;
    const m = this.mirror(e.source, e.symbol);
    if (e.t === "quote" && e.quote) {
      m.quote = { ...e.quote, seq: this.rebased(e.quote.seq) };
      this.tell(e.source, e.symbol, "quote");
    } else if (e.t === "book" && e.book) {
      m.book = e.book;
      this.tell(e.source, e.symbol, "book");
    } else if (e.t === "trades" && Array.isArray(e.ring)) {
      const newest = m.ring.at(-1)?.seq ?? 0;
      for (const t of e.ring) {
        const seq = this.rebased(t.seq);
        // a trade stamped before this stream opened: one the market had before, sent again — a snapshot's, as paper counts one
        if (seq > newest) m.ring.push({ seq, at: t.at, price: t.price, snap: t.snap === true || t.at < this.epochAt });
      }
      m.ring.sort((a, b) => a.seq - b.seq);
      while (m.ring.length > RING_SIZE) m.evictedSeq = Math.max(m.evictedSeq, m.ring.shift()!.seq);
      if (Number(e.evictedSeq) > 0) m.evictedSeq = Math.max(m.evictedSeq, this.rebased(e.evictedSeq));
      if (Array.isArray(e.recent)) m.recent = e.recent;
      this.tell(e.source, e.symbol, "trades");
    } else if (e.t === "live") {
      if (m.quote) m.quote = { ...m.quote, live: e.live === true };
      if (m.book) m.book = { ...m.book, live: e.live === true };
      this.tell(e.source, e.symbol, "live");
    }
  }
  /** the stream lost: every market kept not live, and told; opened again after the backoff */
  private dropped(): void {
    this.open = false;
    if (this.silent) clearTimeout(this.silent);
    this.silent = undefined;
    for (const [k, m] of this.mirrors) {
      if (!m.quote?.live && !m.book?.live) continue;
      if (m.quote) m.quote = { ...m.quote, live: false };
      if (m.book) m.book = { ...m.book, live: false };
      const i = k.indexOf("|");
      this.tell(k.slice(0, i), k.slice(i + 1), "live");
    }
    if (this.closed) return;
    const wait = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** Math.min(this.tries, 16));
    this.tries++;
    this.retry = setTimeout(() => void this.connect(), wait);
    this.retry.unref?.();
  }
  private heartbeat(ac: AbortController): void {
    if (this.silent) clearTimeout(this.silent);
    this.silent = setTimeout(() => ac.abort(), SILENT_MS);
    this.silent.unref?.();
  }
  private async connect(): Promise<void> {
    if (this.closed) return;
    const ac = new AbortController();
    this.stream = ac;
    try {
      const r = await this.http(new URL(`/api/hub?client=${encodeURIComponent(this.o.clientId)}`, this.c.url), { headers: { accept: "text/event-stream" }, signal: ac.signal });
      if (r.status !== 200 || !r.body) {
        await r.body?.cancel().catch(() => undefined);
        throw new Error(`the market's hub answered ${r.status}`);
      }
      this.newEpoch();
      this.open = true;
      this.tries = 0;
      this.heartbeat(ac);
      this.sendAll();
      const reader = r.body.getReader();
      const text = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        this.heartbeat(ac);
        buf += text.decode(value, { stream: true });
        let at: number;
        while ((at = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, at);
          buf = buf.slice(at + 2);
          for (const line of block.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            try {
              this.heard(JSON.parse(line.slice(6)) as HubEvent);
            } catch {
              // a line that is not an event is let be
            }
          }
        }
      }
    } catch {
      // the market not answering, or the stream cut: opened again below
    }
    if (this.stream === ac) this.stream = undefined;
    this.dropped();
  }
}
