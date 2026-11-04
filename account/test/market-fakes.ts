/** A MARKET IN THE TEST'S OWN PROCESS, for the account's link tests (unit/market-*.test.ts): the market's real server and protocol
 * (market/src) over a core of fakes — a public source, a hub the test makes speak and a price — so that what crosses is the real
 * wire, and what the account does with it is the account's own code. */
import { createServer } from "node:net";
import { createMarketCore, type MarketCore, type MarketCoreOptions } from "../../market/src/core.ts";
import { mountProtocol, type ProtocolOptions } from "../../market/src/protocol.ts";
import { mountCn } from "../../market/src/routes-cn.ts";
import { startMarketServer, type MarketServerHandle } from "../../market/src/server.ts";
import { readLike, type Listing, type PublicSource } from "../../market/src/live/public-markets.ts";
import { streamOf, type HubBook, type HubQuote, type HubRange, type HubTick, type MarketHub, type SinceCut } from "../../market/src/live/stream-hub.ts";
import { no } from "../../market/src/refuse.ts";

/** when the fake's listings were read from its venue */
export const READ_AT = 1_700_000_000_000;

/** a free port on this machine, for a market that is started later on it */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

/** a listing as the fake lists it */
export const listing = (symbol: string, price: number, o: Partial<Listing> = {}): Listing => ({ symbol, name: `${symbol} market`, kind: "spot", base: symbol.split("/")[0]!, quote: "USD", price, bid: price - 0.5, ask: price + 0.5, open: true, types: [], volumeUsd24h: 2e9, ...o });

/** the fake public source: its listings stamped READ_AT, a note per query, a refusal for the query "NOPE", and a line */
export function fakeSource(o: { id?: string; rows?: Listing[] } = {}): PublicSource & { asked: string[] } {
  const rows = o.rows ?? [listing("BTC/USD", 62_000), listing("ETH/USD", 3_000)];
  const asked: string[] = [];
  const id = o.id ?? "fake";
  return {
    id,
    name: "Fake Ex",
    kind: "exchange",
    connectTo: id,
    connector: `live:exchange:${id}`,
    asked,
    async listings(q) {
      asked.push(`listings|${q.q ?? ""}`);
      if (q.q === "NOPE") return no("E_VENUE_REJECTED", { venue: id, message: "Fake Ex refused the request (HTTP 400)" });
      const Q = (q.q ?? "").toUpperCase();
      return readLike(rows.filter((m) => !Q || m.symbol.includes(Q)).map((m) => ({ ...m })), READ_AT);
    },
    async line(sym) {
      asked.push(`line|${sym}`);
      const m = rows.find((x) => x.symbol === sym);
      return m ? { ...m } : null;
    },
    notes: () => ["fake note"],
  };
}

/** a hub the test makes speak: it covers what the venues' streams cover (streamOf), keeps each market's quote, book and trades ring, and
 * records every hold, release and want */
export function fakeHub() {
  const listeners = new Set<(t: HubTick) => void>();
  const quotes = new Map<string, HubQuote>();
  const books = new Map<string, HubBook>();
  const rings = new Map<string, Array<{ seq: number; at: number; price: number; size: number; snap?: true }>>();
  const seen = { holds: [] as string[], releases: [] as string[], wants: [] as string[] };
  let seq = 0;
  const tell = (source: string, symbol: string, what: HubTick["what"]) => {
    for (const fn of listeners) fn({ source, symbol, what });
  };
  const hub: MarketHub = {
    covers: (s, y) => !!streamOf(s, y),
    want(s, y) {
      seen.wants.push(`${s}|${y}`);
      return !!streamOf(s, y);
    },
    hold(s, y, o) {
      const k = `${s}|${y}${o?.book ? "|book" : ""}`;
      seen.holds.push(k);
      let done = false;
      return () => {
        if (done) return;
        done = true;
        seen.releases.push(k);
      };
    },
    quote: (s, y) => quotes.get(`${s}|${y}`),
    book: (s, y) => books.get(`${s}|${y}`),
    trades: (s, y, limit) => [...(rings.get(`${s}|${y}`) ?? [])].reverse().slice(0, limit).map((t) => ({ price: t.price, size: t.size, at: new Date(t.at).toISOString() })),
    since(s, y, after, cut: SinceCut = {}): HubRange {
      const ring = rings.get(`${s}|${y}`);
      if (!ring) return { trades: 0, seq: 0 };
      let hi: number | undefined;
      let lo: number | undefined;
      let n = 0;
      for (const t of ring) {
        if (t.seq <= after) continue;
        if (cut.after !== undefined && t.at <= cut.after) continue;
        if (t.snap && cut.snapshotAfter !== undefined && t.at <= cut.snapshotAfter) continue;
        n++;
        hi = hi === undefined ? t.price : Math.max(hi, t.price);
        lo = lo === undefined ? t.price : Math.min(lo, t.price);
      }
      return { ...(hi !== undefined ? { hi } : {}), ...(lo !== undefined ? { lo } : {}), trades: n, seq, };
    },
    async confirmed(s, y, maxAgeMs) {
      const q = quotes.get(`${s}|${y}`);
      return q?.live && Date.now() - q.seenAt <= maxAgeMs ? q : undefined;
    },
    onTick(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    close: () => undefined,
    ring: (s, y, after) => ({ trades: (rings.get(`${s}|${y}`) ?? []).filter((t) => t.seq > after).map((t) => ({ seq: t.seq, at: t.at, price: t.price, snap: t.snap === true })), evictedSeq: 0 }),
  };
  /** the market's quote moves */
  const quote = (s: string, y: string, q: Partial<HubQuote>) => {
    const now = Date.now();
    quotes.set(`${s}|${y}`, { at: now, recvAt: now, seenAt: now, src: "Coinbase", live: true, ...q, seq: ++seq });
    tell(s, y, "quote");
  };
  /** the market's book moves */
  const book = (s: string, y: string, b: Partial<HubBook>) => {
    const now = Date.now();
    books.set(`${s}|${y}`, { bids: [], asks: [], at: now, recvAt: now, seenAt: now, src: "Coinbase", live: true, ...b });
    tell(s, y, "book");
  };
  /** a trade prints */
  const trade = (s: string, y: string, price: number) => {
    const k = `${s}|${y}`;
    if (!rings.has(k)) rings.set(k, []);
    rings.get(k)!.push({ seq: ++seq, at: Date.now(), price, size: 1 });
    const q = quotes.get(k);
    if (q) quotes.set(k, { ...q, seq });
    tell(s, y, "trades");
  };
  return { hub, seen, quote, book, trade };
}

/** a market on `port` (0: any) over `core`, its protocol and its Lunhui and AKShare routes mounted; its close does not close the core, so a
 * test can start it again over the same fakes */
export function startMarket(core: MarketCore, port = 0, o: ProtocolOptions = {}): Promise<MarketServerHandle> {
  return startMarketServer({
    port,
    mount: (app) => {
      mountProtocol(app, core, o);
      mountCn(app, core);
    },
  });
}

export { createMarketCore, type MarketCoreOptions };
