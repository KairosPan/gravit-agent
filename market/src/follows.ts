/** THE MARKETS A PAGE FOLLOWS, AND THE ROUTES OF ITS STREAM, the face's market stream (face/src/market-proxy.ts, /data/market/stream):
 * each key a page follows on the market's stream (stream.ts) held from the hub while it follows it, and the market's quote, book and trades
 * told to it under that key as the hub moves. A key is `<source id or public:id>:<symbol>` the hub covers; the market keeps no venue
 * connected and no paper account, so every key is a public source's own (a connected venue's market is followed on the account's stream).
 *
 *   GET  /api/stream?client=&markets=&since=      the stream (text/event-stream)
 *   POST /api/stream/markets {client, markets, n}  what a page shows now: the markets it follows instead
 *
 * Each with its checks and answers in the market's words. */
import type express from "express";
import type { MarketCore } from "./core.ts";
import type { HubTick, MarketHub } from "./live/stream-hub.ts";
import { BOOK_TOP } from "./live/stream-hub.ts";
import { CLIENT_ID, MarketStream, MAX_FOLLOWS, STREAM_ID, type MarketStreamOptions } from "./stream.ts";

/** What is text on a page, and nothing else is taken (account/src/portfolio/account/state.ts isPlain) */
const PLAIN = /^[\p{L}\p{M}\p{N}\p{P}\p{S}\p{Zs}]*$/u;
const IGNORED = /\p{Default_Ignorable_Code_Point}/u;
const isPlain = (text: string): boolean => PLAIN.test(text) && !IGNORED.test(text);

export interface MarketFollows {
  /** what a page follows now (stream.ts onFollow): [] when it follows nothing any more */
  follow(client: string, keys: string[]): void;
  /** a page's stream opened again carrying over what it followed (stream.ts onAgain) */
  again(client: string, keys: string[]): void;
  /** every hold let go, and the hub no longer listened to */
  close(): void;
}

export function marketFollows(core: MarketCore, stream: MarketStream): MarketFollows {
  /** what each page follows: its client's name → each key it follows → the stream it holds for it, and its release */
  const pageHolds = new Map<string, Map<string, { source: string; symbol: string; release: () => void }>>();
  /** the keys the pages follow, by the stream each stands for (`source|symbol` → each key, and how many pages follow it) */
  const followers = new Map<string, Map<string, number>>();
  let hubOff: (() => void) | undefined;
  let closed = false;

  /** the hub, listened to from the first follow on */
  function listenHub(): MarketHub | undefined {
    const hub = core.hub;
    if (hub && !hubOff && !closed) hubOff = hub.onTick((t) => marketTold(t));
    return hub;
  }

  /** THE MARKETS A PAGE SHOWS (stream.ts follow, told here): each key — `<venue>:<symbol>` — held from the hub while the page follows it
   * (its book too: the page shows it), its quote, book and trades pushed to the page as they move (marketTold), and the ones it no longer
   * follows let go. A key with a "~" before it is a market whose PRICE ALONE the page shows: held without its book, and only its quote
   * pushed */
  function pageFollows(client: string, keys: string[]): void {
    const had = pageHolds.get(client) ?? new Map<string, { source: string; symbol: string; release: () => void }>();
    const kept = new Map<string, { source: string; symbol: string; release: () => void }>();
    for (const key of keys) {
      const was = had.get(key);
      if (!was) continue;
      kept.set(key, was);
      had.delete(key);
    }
    for (const [key, h] of had) {
      h.release();
      unfollowKey(key, `${h.source}|${h.symbol}`);
    }
    if (keys.length) pageHolds.set(client, kept);
    else pageHolds.delete(client);
    for (const key of keys) if (!kept.has(key)) void followKey(client, key).catch(() => undefined);
  }
  /** one key a page follows, held from its stream — only if the page still follows it then; what the stream has now told to the page at
   * once */
  async function followKey(client: string, key: string): Promise<void> {
    const marked = key.startsWith("~");
    const at = await streamAt(marked ? key.slice(1) : key);
    const hub = listenHub();
    const mine = pageHolds.get(client);
    if (closed || !at || !hub || !mine || mine.has(key) || !stream.followsOf(client)?.has(key)) return;
    // a market whose hub carries its price alone (a US share's real-time quote, read over REST: live/us-quotes.ts) is told its quote only
    const priceOnly = marked || hub.pricesOnly?.(at.source, at.symbol) === true;
    const release = hub.hold(at.source, at.symbol, { book: !priceOnly });
    mine.set(key, { ...at, release });
    const k = `${at.source}|${at.symbol}`;
    const keys = followers.get(k) ?? new Map<string, number>();
    keys.set(key, (keys.get(key) ?? 0) + 1);
    followers.set(k, keys);
    for (const what of priceOnly ? (["quote"] as const) : (["quote", "book", "trades"] as const)) tellMarket(k, what);
  }
  /** A PAGE'S STREAM OPENED AGAIN carrying over what it followed: each market it holds told to it again now — its quote, and its book and
   * trades where it shows them whole. A key whose stream is still being found tells itself once it is held (followKey) */
  function pageAgain(client: string, keys: string[]): void {
    const mine = pageHolds.get(client);
    if (!mine) return;
    for (const key of keys) {
      const h = mine.get(key);
      if (!h) continue;
      const priceOnly = key.startsWith("~") || core.hub?.pricesOnly?.(h.source, h.symbol) === true;
      for (const what of priceOnly ? (["quote"] as const) : (["quote", "book", "trades"] as const)) tellMarket(`${h.source}|${h.symbol}`, what);
    }
  }
  function unfollowKey(key: string, k: string): void {
    const keys = followers.get(k);
    if (!keys) return;
    const n = (keys.get(key) ?? 1) - 1;
    if (n > 0) keys.set(key, n);
    else keys.delete(key);
    if (!keys.size) followers.delete(k);
  }
  /** the stream a page's market stands for: a source the hub streams, by its id (`public:` before it, as Markets names a public source's
   * row, taken off); nothing for the rest */
  async function streamAt(key: string): Promise<{ source: string; symbol: string } | undefined> {
    const i = key.indexOf(":");
    if (i <= 0) return undefined;
    const venue = key.slice(0, i).replace(/^public:/, "");
    const symbol = key.slice(i + 1);
    // a venue's id and a market as plain text, as every read of one takes them: nothing else is read for it, or held
    if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(venue) || !symbol || symbol.length > 160 || !isPlain(symbol)) return undefined;
    return core.hub?.covers(venue, symbol) ? { source: venue, symbol } : undefined;
  }
  /** a stream's word, told to the pages that follow its market: a quote, a book or trades as they moved — and both quote and book when it
   * went live or stopped being so */
  function marketTold(t: HubTick): void {
    const k = `${t.source}|${t.symbol}`;
    if (!followers.get(k)?.size) return;
    for (const what of t.what === "live" ? (["quote", "book"] as const) : ([t.what] as const)) tellMarket(k, what);
  }
  /** one market's quote, book or trades as the stream has it, to each key the pages follow it by — written when it goes out (the bus
   * coalesces a market's events), never sooner. A key followed for its price alone ("~") is told its quote only */
  function tellMarket(k: string, what: "quote" | "book" | "trades"): void {
    const hub = core.hub;
    const keys = followers.get(k);
    if (!hub || !keys) return;
    const cut = k.indexOf("|");
    const source = k.slice(0, cut);
    const symbol = k.slice(cut + 1);
    // a market whose hub carries its price alone (a US share's) has no book and no trades to tell
    if (what !== "quote" && hub.pricesOnly?.(source, symbol) === true) return;
    for (const key of keys.keys()) {
      if (what !== "quote" && key.startsWith("~")) continue;
      const venue = key.slice(key.startsWith("~") ? 1 : 0, key.indexOf(":"));
      const head = { key, venue, symbol, source };
      const later = (data: () => Record<string, unknown>) => ({ toJSON: () => ({ ...head, ...data() }) });
      if (what === "quote") {
        stream.emit("quote", later(() => {
          const q = hub.quote(source, symbol);
          if (!q) return { live: false };
          return { ...(q.bid !== undefined ? { bid: q.bid } : {}), ...(q.ask !== undefined ? { ask: q.ask } : {}), ...(q.bidSz !== undefined ? { bidSz: q.bidSz } : {}), ...(q.askSz !== undefined ? { askSz: q.askSz } : {}), ...(q.last !== undefined ? { last: q.last } : {}), ...(q.mark !== undefined ? { mark: q.mark } : {}), ...(q.oracle !== undefined ? { oracle: q.oracle } : {}), ...(q.funding !== undefined ? { funding: q.funding } : {}), ...(q.openInterest !== undefined ? { openInterest: q.openInterest } : {}), ...(q.volumeUsd24h !== undefined ? { volumeUsd24h: q.volumeUsd24h } : {}), ...(q.prevDayPx !== undefined ? { prevDayPx: q.prevDayPx } : {}), ...(q.premium !== undefined ? { premium: q.premium } : {}), ...(q.bar ? { bar: q.bar } : {}), at: new Date(q.at).toISOString(), ...(q.priceAt !== undefined ? { priceAt: new Date(q.priceAt).toISOString() } : {}), seenAt: new Date(q.seenAt).toISOString(), from: q.from ?? `${q.src} · live`, ...(q.delayMs !== undefined ? { delayMs: q.delayMs } : {}), ...(q.everyMs !== undefined ? { everyMs: q.everyMs } : {}), ...(q.askedEveryMs !== undefined ? { askedEveryMs: q.askedEveryMs } : {}), live: q.live, seq: q.seq };
        }), key);
      } else if (what === "book") {
        stream.emit("book", later(() => {
          const bk = hub.book(source, symbol);
          // a stream that sends only its venue's top levels (Hyperliquid's and OKX's five, Kraken's ten) says each side may go on past its last
          return bk ? { bids: bk.bids, asks: bk.asks, at: new Date(bk.seenAt).toISOString(), from: `${bk.src} · live`, depth: "full", more: { bids: !bk.whole || bk.bids.length >= BOOK_TOP, asks: !bk.whole || bk.asks.length >= BOOK_TOP }, live: bk.live } : { live: false };
        }), key);
      } else {
        stream.emit("trades", later(() => ({ trades: hub.trades(source, symbol, 30), live: hub.quote(source, symbol)?.live === true })), key);
      }
    }
  }

  return {
    follow: pageFollows,
    again: pageAgain,
    close() {
      closed = true;
      for (const mine of pageHolds.values()) for (const h of mine.values()) h.release();
      pageHolds.clear();
      followers.clear();
      hubOff?.();
      hubOff = undefined;
    },
  };
}

/** THE STREAM'S ROUTES, over a bus and its follows made here: GET /api/stream and POST /api/stream/markets, the face's market stream
 * (/data/market/stream), with their checks and answers in the market's words. `close` ends every stream and lets go of every hold (the
 * server closing) */
export function mountStream(app: express.Express, core: MarketCore, o: Omit<MarketStreamOptions, "onFollow" | "onAgain"> = {}): { stream: MarketStream; follows: MarketFollows; close(): void } {
  let follows: MarketFollows | undefined;
  const stream = new MarketStream({ ...o, onFollow: (client, keys) => follows?.follow(client, keys), onAgain: (client, keys) => follows?.again(client, keys) });
  follows = marketFollows(core, stream);
  const bad = (res: express.Response, error: string) => res.status(400).json({ ok: false, error });
  /** a route's query parameters as strings, each cut to its length; one given twice is a malformed request — neither copy is picked */
  const strings = <K extends string>(req: express.Request, res: express.Response, want: Record<K, number>): Record<K, string> | undefined => {
    const out = {} as Record<K, string>;
    for (const k of Object.keys(want) as K[]) {
      const v = req.query[k];
      if (Array.isArray(v)) return void bad(res, `"${k}" is given more than once`);
      out[k] = typeof v === "string" ? v.slice(0, want[k]) : "";
    }
    return out;
  };

  // THE STREAM: one text/event-stream a page holds open. A page names itself (?client=, a name of its own its tab keeps) and may say at once
  // which markets it shows (?markets=, each `<venue>:<symbol>`, comma-separated): their quote, book and trades come on the stream as the
  // hub moves. What it shows later it says at POST /api/stream/markets. One stream a tab: past the bus's room a further one is answered 503
  app.get("/api/stream", (req, res) => {
    // a page opens its stream as an EventSource (cors, empty), never as a page of its own: a navigation here holds no slot of the bus and
    // follows no market
    if (req.headers["sec-fetch-mode"] === "navigate" || req.headers["sec-fetch-dest"] === "document") return void res.status(403).json({ ok: false, error: "this server answers only programs on this machine" });
    const q = strings(req, res, { since: 64, client: 48, markets: 4_000 });
    if (!q) return;
    const asked = String(req.get("last-event-id") ?? q.since).trim().slice(0, 64);
    if (q.client && !CLIENT_ID.test(q.client)) return void bad(res, "a page names itself in 8 to 48 letters, digits, dashes or underscores");
    if (!stream.room()) return void res.status(503).json({ ok: false, error: `this market has ${stream.listening} pages listening already: close a tab of it, and this one listens again on its next try` });
    stream.attach(req, res, STREAM_ID.test(asked) ? asked : "", q.client);
    if (q.client && q.markets) stream.follow(q.client, q.markets.split(",").slice(0, MAX_FOLLOWS));
  });
  // WHAT A PAGE SHOWS NOW: the markets whose quote, book and trades its stream carries, in place of what it showed before ({client, markets:
  // [`<venue>:<symbol>`]}, at most MAX_FOLLOWS) — 404 when no stream of that name is open. `n`, where the page numbers its tellings (a whole
  // number, one more each): a telling that arrives after a later one is let be, and the answer says what the page follows now
  app.post("/api/stream/markets", (req, res) => {
    const body = (req.body ?? {}) as { client?: unknown; markets?: unknown; n?: unknown };
    const client = typeof body.client === "string" ? body.client : "";
    if (!CLIENT_ID.test(client)) return void bad(res, "a page names itself in 8 to 48 letters, digits, dashes or underscores (\"client\")");
    if (!Array.isArray(body.markets) || !body.markets.every((m) => typeof m === "string")) return void bad(res, "\"markets\" is a list of `<venue>:<symbol>`");
    if (body.n !== undefined && !(typeof body.n === "number" && Number.isSafeInteger(body.n) && body.n > 0)) return void bad(res, "\"n\" is the face's own number for this telling: a whole number above 0");
    const following = stream.follow(client, (body.markets as string[]).slice(0, MAX_FOLLOWS), body.n as number | undefined);
    if (!following) return void res.status(404).json({ ok: false, error: "no stream of that page is open: it opens one at GET /api/stream first" });
    res.json({ ok: true, following });
  });

  return {
    stream,
    follows,
    close() {
      stream.end();
      follows!.close();
    },
  };
}
