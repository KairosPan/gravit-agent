/** THE MARKET'S SHAPES, AS THE ACCOUNT USES THEM: the types, constants and pure helpers the account still needs from the files that moved
 * into the market (plan A1 task 2), so that account/src imports nothing from the market's tree. Each is COPIED from its file in the
 * market package's `live/` directory — that file is the original, and this copy follows it — with its JSDoc, and with the unexported
 * helpers it calls:
 *
 *   public-markets.ts   Listing, ListingsQuery, EventsQuery, Settlement, PublicSource, KEEP_MS, publicNo, holdBackMs, readAtOf, readLike
 *   stream-hub.ts       BOOK_TOP, HubQuote, HubBook, HubTick, HubRange, SinceCut, MarketHub, HubRing, joinHubs (and streamOf, for hubCovers)
 *   prices.ts           Price
 *   china.ts            CHINA_ID
 *   public-stocks.ts    CBOE_DELAY_MS, US_STOCKS_ID, cboeQuoteInSession, usSession, usLineAt (and usSessionWords, usClosedWords)
 *   us-quotes.ts        FRESH_MS, US_TICKER, UsQuote (and ROBINHOOD_FROM, NASDAQ_FROM, ROBINHOOD_OVERNIGHT)
 *
 * One addition of the account's own: hubCovers, whether the market's hub streams a market (streamOf, and the US stocks line's ticker). */
import type { Refusal } from "../../core/errors.ts";
import { no } from "../refuse.ts";
import { et, etDate, nextRegularSession, regularSession, usPhaseAt, usSessionFull } from "../account/calendar.ts";
import type { ExploreItem } from "../live/explore.ts";
import type { Candle, CandleInterval, CandlePage, CandleWindow, Market, MarketSession, MarketStats, OrderBook, PublicTrade, SessionClock } from "../live/trade.ts";
import { bannedNo, bannedUntil, edgeRefused, edgeWords, notTheApi, notTheApiWords, rateLimitedNo, redirectedNo, REGION, type HttpReply } from "../live/types.ts";

// ---- public-markets.ts ------------------------------------------------------------------------------------------------------------------

/** a market as a public source lists it: the shared shape, and what only a listing carries */
export type Listing = Market & {
  /** the venue's event the market belongs to, where an event holds several (Polymarket's "Brazil Presidential Election"), and `market`
   * this market's own short name inside it, in the venue's words (Kalshi's yes_sub_title "Fed maintains rate", Polymarket's groupItemTitle
   * "October 12"): what a row says in place of the market's whole question */
  event?: { id: string; title: string; market?: string | undefined } | undefined;
  /** the whole event's dollars traded in 24 hours, all its markets together, where the venue reports it (Gamma's volume24hr on the event):
   * how hot the question is, which is what Polymarket itself orders by. Only to ORDER; `volumeUsd24h` stays the market's own */
  eventVolumeUsd24h?: number | undefined;
  /** every category word and tag the venue gives it, for the category shown and the words that leave an event out (categories.ts) */
  tags?: string[] | undefined;
  /** the venue's own picture for an event market, as its API gives one (Polymarket's `icon` for the market, else for its event; Polymarket
   * US's `image`): the row's icon (live/icons.ts), shown only from the venue's own host */
  image?: string | undefined;
  /** the name of the place it trades, where one source speaks for several (Hyperliquid's HIP-3 deployers: "Hyperliquid · io"): explore.ts
   * names the market's venue line with it; absent, the line is the source's name */
  venueName?: string | undefined;
};

export interface ListingsQuery {
  /** a few letters of a symbol or a name; absent: the source's well-known or busiest markets */
  q?: string | undefined;
  /** at most this many markets (an event market counts once, however many outcomes it has) */
  limit: number;
}

export interface EventsQuery {
  /** in the venue's own words ("Economics", "Sports") */
  category?: string | undefined;
  /** closing within this many milliseconds from now */
  closingWithinMs?: number | undefined;
  limit: number;
}

/** whether an event market has settled, as its venue says: `payout` is what one contract of THIS outcome paid (1 to the side that won, 0 to
 * the other; a market called off may pay a price between), `closed` that it trades no more and has not settled yet */
export type Settlement = { settled: false; closed?: boolean | undefined } | { settled: true; payout: number; at?: string | undefined };

export interface PublicSource {
  id: string;
  name: string;
  /** an exchange's coins, event contracts, tokens that stand for shares, or US stocks (public-stocks.ts) */
  kind: "exchange" | "events" | "tokens" | "stocks";
  /** the venue on the account this is the public side of, as the owner would connect it to trade (`okx`), and the connection that does
   * (`live:exchange:okx`) */
  connectTo: string;
  connector: string;
  /** why nothing is traded through this listing itself, when nothing is (Stock Tokens: they trade from a connected wallet's own rows) */
  readOnly?: string | undefined;
  listings(o: ListingsQuery): Promise<Listing[] | Refusal>;
  /** ONE MARKET'S LINE asked alone, by its own symbol, where the source can answer one market without a search — the US stocks line: one GET
   * of Cboe at most, where a search of a short ticker reads forty (public-stocks.ts) — or null where it lists no such market now. A paper
   * account prices a market it knows by it (live/paper.ts Pricer.find) */
  line?(symbol: string): Promise<Listing | null | Refusal>;
  /** the source's own reader of the markets someone is looking at now, in the venues' streams' shape (the US stocks line's background
   * reader: live/us-quotes.ts UsQuoteFeed) — a hub the service joins with the venues' streams (stream-hub.ts joinHubs) */
  feed?: MarketHub | undefined;
  /** the last 24 hours of the markets named (absent: the well-known ones), by symbol */
  stats?(symbols?: string[]): Promise<Map<string, MarketStats> | Refusal>;
  /** event contracts, each with its question (`group`), close time and category, busiest first */
  events?(o: EventsQuery): Promise<Listing[] | Refusal>;
  /** one market's price history in a window (live/trade.ts CandleWindow), oldest first: `symbol` as its listing names it. A page that says
   * whether older bars exist and where the history ends (CandlePage), or a plain list where the source says nothing of it */
  candles?(symbol: string, interval: CandleInterval, window: CandleWindow): Promise<Candle[] | CandlePage | Refusal>;
  /** one market's order book, `depth` levels a side at most (1 to 50), best first: `symbol` as its listing names it (see the top of this
   * file). A source that publishes no book has none */
  book?(symbol: string, depth: number): Promise<OrderBook | Refusal>;
  /** one market's latest trades, newest first, `limit` at most (1 to 100) */
  trades?(symbol: string, limit: number): Promise<PublicTrade[] | Refusal>;
  /** its price history comes from another host than its listings (Polymarket's CLOB, beside Gamma): a refusal of the history holds back
   * the history alone, and the listings are still asked. A source without it answers both from one host, and one refusal holds back both.
   * Its book and trades are read apart from its listings too (the CLOB, and Polymarket's Data API) */
  historyApart?: true | undefined;
  /** an event market's settlement, asked of the venue keyless (see the top of this file): `symbol` as its listing names it */
  settlement?(symbol: string): Promise<Settlement | Refusal>;
  /** A PERPETUAL'S PAST FUNDING, hour by hour, where the source publishes it (Hyperliquid's fundingHistory, keyless): each hour paid (the
   * top of the hour, ms) and its rate, for the hours from `from` to `to` (ms), oldest first — an hour not paid yet is not in it. A paper
   * account settles a position's hours at these rates (live/paper.ts); a source without it, at the rate its quote carries */
  fundingHistory?(symbol: string, from: number, to: number): Promise<Array<{ at: number; rate: number }> | Refusal>;
  /** let go of the refusals it holds (its place rule, its edge's page, a wait), so the next ask asks the venue: called when a forced re-check
   * found the venue answering this network (service.ts) */
  reset?(): void;
  /** a stock market's clock (trade.ts SessionClock), where the source keeps one: a paper account judges a quote's own time by it and ends a
   * DAY order at its close */
  sessions?: SessionClock | undefined;
  /** what the owner should know about the listing asked with `q`, each a plain sentence under 160 characters, read after `listings` has
   * answered: what the list is made of, how much of the venue it shows when nothing is searched for ("40 of 194 shown · search for the
   * rest"). The service may answer a listing from what it kept without asking the source again, so the sentences never depend on which
   * call came last */
  notes?(o: { q?: string | undefined }): string[];
}

/** how long a list is kept: a public market's price is as old as this */
export const KEEP_MS = 90_000;
const round = (x: number, places = 6): number => Number(x.toFixed(places));

/** what a venue answered, on one line and cut at 220 characters — never inside the sentence it gave in its JSON, which runs to its end (up
 * to 600): Binance's 451 sentence ends past 220, "…if you believe you received this message in error.", and stays whole */
function saidOf(text: string): string {
  const folded = text.replace(/\s+/g, " ").trim();
  const sentence = /"(?:msg|message|retMsg|error_description)"\s*:\s*"(?:[^"\\]|\\.)*"/.exec(folded);
  return folded.slice(0, Math.min(600, Math.max(220, sentence ? sentence.index + sentence[0].length : 0)));
}

/** the words around a place rule in a page that is not JSON (an edge's HTML, a plain-text answer): the markup taken out, and the 240
 * characters around the sentence that names the place — a page's first characters are its doctype and title, not the venue's words */
function regionSaid(text: string): string {
  const plain = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const at = Math.max(0, plain.search(REGION));
  return plain.slice(Math.max(0, at - 120), at + 120).trim();
}

/** a venue that has banned this machine's address for too many requests without giving a time: Bybit's "IP has been banned" (retCode
 * 10009), and its 403 "access too frequent", which asks for at least ten minutes with nothing sent (exchange.ts reads the same for a key) */
const BANNED = /\bip ha(?:s|d) been banned\b|\bretCode"?\s*:\s*"?10009\b|\baccess too frequent\b/i;

/** A public answer that is not a yes, as a refusal with the venue's own words. There is no key, so nothing here blames one: a 401 or a 403
 * is the venue refusing the request, never "the key may not". Read as types.ts reads every answer: the wait the venue asked for (its
 * Retry-After) is the hold, a redirect is answered and not followed, and a page where the API answers JSON is no answer at all */
export function publicNo(venue: string, name: string, r: HttpReply): Refusal {
  const native = { status: r.status, said: saidOf(r.text) };
  const yes = r.status >= 200 && r.status < 300;
  // a page that is not JSON keeps the sentence that names the place, not its markup
  if (r.status === 451 || (!yes && REGION.test(r.text))) return no("E_VENUE_GEOBLOCKED", { venue, message: `${name} does not serve this location: that is its own rule, and the account does not look for a way around it`, native: { status: r.status, said: r.body === undefined && !/^\s*[{[]/.test(r.text) ? regionSaid(r.text) : native.said } });
  const until = bannedUntil(r.text);
  if (r.status === 418 || until !== undefined || BANNED.test(r.text)) return bannedNo(venue, name, until ?? (r.retryAfterMs ? Date.now() + r.retryAfterMs : undefined), native);
  // the server in front of the venue refusing this network with a page of its own: held back as long as a place rule, not asked every 20 s
  if (edgeRefused(r.status, r.text)) return no("E_VENUE_GEOBLOCKED", { venue, message: edgeWords(name, r.status, r.text), native: { status: r.status, edge: true } });
  if (r.status === 429) return rateLimitedNo(venue, name, r.retryAfterMs, native);
  if (r.status >= 500 || r.status === 0) return no("E_VENUE_UNREACHABLE", { venue, message: `${name} did not answer`, native: { ...native, ...(r.retryAfterMs ? { until: Date.now() + r.retryAfterMs } : {}) } });
  if (r.status >= 300 && r.status < 400) return redirectedNo(venue, name, r.status, r.location);
  if (notTheApi(r)) return no("E_VENUE_UNREACHABLE", { venue, message: notTheApiWords(name), native: { status: r.status, page: true } });
  if (yes) return no("E_VENUE_REJECTED", { venue, message: `${name} answered in a way this could not read`, native: { status: r.status } });
  return no("E_VENUE_REJECTED", { venue, message: `${name} refused the request (HTTP ${r.status})`, native });
}

/** How long a refusal is kept before the venue is asked again, when it says the venue cannot be asked just now: ten minutes for a venue
 * that does not serve this location (its rule will not change within the hour), as long as the venue asked for one that is rate-limiting
 * or has banned this address (a minute when a 429 gave no time), twenty seconds for one not answering, so a page polling every few seconds
 * does not hammer it. Zero for every other refusal, and for a place rule about one pair or product: the next ask asks the venue again.
 * The one rule, for this file's keeper and for the service's read cache */
/** how long the market service's not answering holds a source back here: the link's own keep of that refusal (client.ts REFUSAL_KEEP_MS) */
export const MARKET_DOWN_HOLD_MS = 2_000;
export function holdBackMs(r: Refusal, now: number = Date.now()): number {
  // the market service not answering (market/client.ts marketDown): held only as long as the link keeps that refusal itself, so a market
  // that is back is asked again within seconds — a source of the account's own, not a venue that is down
  if ((r.native as { market?: unknown } | undefined)?.market === "down") return MARKET_DOWN_HOLD_MS;
  // a place rule for one pair, product or feature (detail.scope) holds back nothing else of the venue: its other markets still answer
  if ((r.detail as { scope?: unknown } | undefined)?.scope !== undefined) return 0;
  if (r.code === "E_VENUE_GEOBLOCKED") return 600_000;
  // a ban for too many requests, or a wait the venue asked for, until when it said: nothing is asked of it before then (an hour at most is
  // kept, then asked again)
  const until = (r.native as { until?: unknown } | undefined)?.until;
  if (typeof until === "number" && until > now) return Math.min(until - now, 3_600_000);
  const status = (r.native as { status?: unknown } | undefined)?.status;
  if (status === 418) return 600_000;
  // rate-limited with no wait given: the minute the refusal's own sentence says
  if (status === 429) return 60_000;
  if (r.code === "E_VENUE_UNREACHABLE") return 20_000;
  return 0;
}

/** WHEN A SOURCE'S ANSWER WAS READ FROM ITS VENUE (public-markets.ts, where the keepers stamp what they take): a listing that carries no time
 * of its own is as old as the moment its venue answered, kept in a weak map beside it — nothing is added to the answer, and nothing is
 * kept once the answer is let go. Here the market's answer is stamped as it arrives, from the `readAt` the market sends beside it
 * (market/client.ts), and read by whoever prices with it (live/paper.ts). ONE MAP FOR THE PROCESS, shared with the market's own copy where
 * both are loaded in one process (a test that hands the account a market's source in-process): a stamp either side sets, the other reads */
const READ_AT: WeakMap<object, number> = ((globalThis as { [k: symbol]: unknown })[Symbol.for("gravit.readAt")] ??= new WeakMap<object, number>()) as WeakMap<object, number>;
/** the moment `x` was read from its venue (ms), where it was stamped: a kept answer, something in one, or a listing built from one */
export const readAtOf = (x: unknown): number | undefined => (x !== null && typeof x === "object" ? READ_AT.get(x) : undefined);
/** `x` (a listing, or each one of a list) stamped as read when the oldest of `from` was — each a moment (ms) or something stamped: a listing
 * built from several answers is as old as the oldest of them. Nothing stamped where none of `from` says when. Returns `x` */
export function readLike<T>(x: T, ...from: unknown[]): T {
  const times = from.map((f) => (typeof f === "number" ? f : readAtOf(f))).filter((t): t is number => typeof t === "number" && Number.isFinite(t));
  if (!times.length) return x;
  const at = Math.min(...times);
  for (const one of Array.isArray(x) ? x : [x]) if (one !== null && typeof one === "object") READ_AT.set(one, at);
  return x;
}

// ---- stream-hub.ts ---------------------------------------------------------------------------------------------------------------------

/** the levels a side of a book is read out to */
export const BOOK_TOP = 20;
/** the venues the hub streams */
type HubVenue = "hyperliquid" | "coinbase" | "kraken" | "okx";

/** a market as its stream has it now (quote) */
export interface HubQuote {
  bid?: number | undefined;
  ask?: number | undefined;
  bidSz?: number | undefined;
  askSz?: number | undefined;
  /** the last trade's price */
  last?: number | undefined;
  /** a perpetual: the venue's mark (Hyperliquid's markPx), its oracle, and its funding rate as the venue gives it (hourly at Hyperliquid) */
  mark?: number | undefined;
  oracle?: number | undefined;
  funding?: number | undefined;
  /** a perpetual, as its venue streams its day (Hyperliquid's activeAssetCtx, about every second): the contracts open, in base units
   * (openInterest), the dollars traded over the last 24 hours (dayNtlVlm), the price 24 hours ago (prevDayPx), and the venue's premium of the
   * mark over the oracle that its funding comes from (premium: -0.0003749 = −0.0375%) — each where the venue said it */
  openInterest?: number | undefined;
  volumeUsd24h?: number | undefined;
  prevDayPx?: number | undefined;
  premium?: number | undefined;
  /** the venue's own time of the latest message, ms (this machine's when the venue stamps none) */
  at: number;
  /** THE VENUE'S OWN MOMENT OF THE BEST BID AND ASK this quote carries, ms: their own channel's stamp (Hyperliquid's bbo, Coinbase's and
   * Kraken's ticker, OKX's bbo-tbt — or its tickers before bbo-tbt has spoken), or the book's where its top stands for them (Coinbase's
   * level2 while one is kept: the stamp of the message that last moved its top). What a page measures how long a price took to reach its
   * screen from. Undefined where the venue stamped none, or before it has said them on this subscription — never another channel's moment
   * (Hyperliquid's activeAssetCtx carries none, and the latest message's `at` is this machine's own clock then) */
  priceAt?: number | undefined;
  /** when the latest message came here, ms */
  recvAt: number;
  /** the latest moment the stream confirmed the market's best bid and ask as they stand (their own message, or a later one on the same live
   * connection where the venue's best-bid-and-ask channel speaks on every change: BBO_EVERY_CHANGE), ms — before the venue has said them on
   * this subscription, its latest message's */
  seenAt: number;
  /** the stream it came over, in words: "Coinbase" */
  src: string;
  /** rises with each message for the market (one count for every market of the hub) */
  seq: number;
  live: boolean;
  /** the live one-minute bar, where the venue streams one */
  bar?: { t: number; o: number; h: number; l: number; c: number; v?: number | undefined } | undefined;
  /** WHERE A QUOTE THAT IS NO STREAM'S CAME FROM, in its source's words ("Robinhood · real time"), how far behind the market that source is
   * (0), how often it writes the quote anew (`everyMs`: Robinhood's fifteen seconds, read as it is written) or — for a source that writes
   * nothing on a cadence of its own, whose stamp is its last trade's (Nasdaq's, to the minute) — how often the account asks it
   * (`askedEveryMs`), a US share's quote from the background reader beside the venues' streams (live/us-quotes.ts UsQuoteFeed), read over
   * REST and pushed as it moves — and the quote itself as that source gave it. A stream's quote has none of them: it is `<src> · live` */
  from?: string | undefined;
  delayMs?: number | undefined;
  everyMs?: number | undefined;
  askedEveryMs?: number | undefined;
  us?: UsQuote | undefined;
}
/** a market's book as its stream has it: best first, each side its top levels */
export interface HubBook {
  bids: Array<[number, number]>;
  asks: Array<[number, number]>;
  /** the venue's time of the book's latest message, when it came here, and the latest moment the stream confirmed it, ms */
  at: number;
  recvAt: number;
  seenAt: number;
  src: string;
  live: boolean;
  /** the stream keeps the venue's WHOLE book (Coinbase's level2) to the depth asked: a side shorter than asked is every level the venue
   * holds. Not said of a side cut (LEVELS_KEPT) with fewer levels inside its boundary than asked, nor of a stream that sends only its top
   * levels (Hyperliquid's and OKX's five, Kraken's ten): a side may go on past its last */
  whole?: true | undefined;
}
/** what moved: the market's quote, its trades, its book, or whether it is live */
export interface HubTick {
  source: string;
  symbol: string;
  what: "quote" | "trades" | "book" | "live";
}
/** the trades' extremes since a moment: their highest and lowest prices, how many, and the seq the market stands at now (the next since's
 * start). `partial`: the ring no longer holds every trade since then */
export interface HubRange {
  hi?: number | undefined;
  lo?: number | undefined;
  trades: number;
  seq: number;
  partial?: true | undefined;
}
/** WHICH TRADES SINCE A SEQ COUNT (since()): every trade that came live after it, by its seq alone — a venue's trades come here up to half a
 * second after the venue stamped them (Hyperliquid's), after the quote that moved a judge, so the venue's stamp is never weighed against
 * this machine's moment for them — and of the trades that came in a subscription's SNAPSHOT (the venue's recent trades, sent again on every
 * subscription, a reconnect's among them: what it holds may have printed long before) only those the venue stamped after `snapshotAfter`,
 * the moment of the judge before. `after`: only trades the venue stamped after this moment, live or not — an order never judged on a tick,
 * counted from when it was placed (or last changed): a trade from before it never touches it */
export interface SinceCut {
  after?: number | undefined;
  snapshotAfter?: number | undefined;
}

/** WHAT THE PAPER ACCOUNT AND THE SERVICE ASK OF A HUB (the hub here, or a stand-in's: test/standin) */
export interface MarketHub {
  /** whether the market — its source's id and its symbol as the listing names them — has a stream here */
  covers(source: string, symbol: string): boolean;
  /** wanted for IDLE_MS from now (the paper account's look renews it): false when it has no stream, or the hub is full */
  want(source: string, symbol: string): boolean;
  /** held while the release has not been called (a page showing it), its book too with `book` */
  hold(source: string, symbol: string, o?: { book?: boolean | undefined }): () => void;
  /** the market as its stream has it now; undefined before its first message */
  quote(source: string, symbol: string): HubQuote | undefined;
  book(source: string, symbol: string, depth?: number): HubBook | undefined;
  /** its latest trades, newest first */
  trades(source: string, symbol: string, limit: number): PublicTrade[];
  /** the trades' highest and lowest since `seq` (the market's own, from an earlier since() or quote()), cut as `cut` says (SinceCut: a
   * snapshot's trades by the venue's stamp, an order never judged from its own moment) */
  since(source: string, symbol: string, seq: number, cut?: SinceCut): HubRange;
  /** a price the stream confirmed within `maxAgeMs` — waiting up to `waitMs` for a word on the connection that confirms it, when it is live
   * but the last confirmation is older — or undefined */
  confirmed(source: string, symbol: string, maxAgeMs: number, waitMs: number): Promise<HubQuote | undefined>;
  onTick(fn: (t: HubTick) => void): () => void;
  close(): void;
  /** the hub carries the market's PRICE alone — no book, no trades (a US share's quote, live/us-quotes.ts): a page is told its quote only.
   * Absent: the hub's markets carry all three */
  pricesOnly?(source: string, symbol: string): boolean;
  /** THE MARKET'S TRADES RING after a seq (the trades since() counts, by their seq: what a caller elsewhere — the account, over the market's
   * /api/hub — needs to judge a paper order as since() does here), each with its seq, its moment (ms), its price and whether it came in a
   * subscription's snapshot; and the seq of the newest trade the ring has let go of (a range from before it is partial). Absent: the hub
   * keeps no ring (a US share's quote) */
  ring?(source: string, symbol: string, after: number): HubRing;
}
/** a market's trades ring after a seq (MarketHub.ring) */
export interface HubRing {
  trades: Array<{ seq: number; at: number; price: number; snap: boolean }>;
  evictedSeq: number;
}

/** SEVERAL HUBS AS ONE: the venues' streams, and beside them the US shares' background reader (live/us-quotes.ts UsQuoteFeed) — each market
 * asked of the first hub that covers it, every hub's ticks told, all of them closed together. What the paper account and the service ask of
 * one hub they ask of this */
export function joinHubs(...hubs: MarketHub[]): MarketHub {
  const of = (source: string, symbol: string): MarketHub | undefined => hubs.find((h) => h.covers(source, symbol));
  return {
    covers: (source, symbol) => !!of(source, symbol),
    want: (source, symbol) => of(source, symbol)?.want(source, symbol) ?? false,
    hold: (source, symbol, o) => of(source, symbol)?.hold(source, symbol, o) ?? (() => undefined),
    quote: (source, symbol) => of(source, symbol)?.quote(source, symbol),
    book: (source, symbol, depth) => of(source, symbol)?.book(source, symbol, depth),
    trades: (source, symbol, limit) => of(source, symbol)?.trades(source, symbol, limit) ?? [],
    since: (source, symbol, seq, cut) => of(source, symbol)?.since(source, symbol, seq, cut) ?? { trades: 0, seq: 0 },
    confirmed: async (source, symbol, maxAgeMs, waitMs) => of(source, symbol)?.confirmed(source, symbol, maxAgeMs, waitMs),
    pricesOnly: (source, symbol) => of(source, symbol)?.pricesOnly?.(source, symbol) === true,
    ring: (source, symbol, after) => of(source, symbol)?.ring?.(source, symbol, after) ?? { trades: [], evictedSeq: 0 },
    onTick: (fn) => {
      const offs = hubs.map((h) => h.onTick(fn));
      return () => offs.forEach((off) => off());
    },
    close: () => hubs.forEach((h) => h.close()),
  };
}

/** a coin pair as an exchange's listing names it (BTC/USD) — spot only, never a derivative's `:` */
const PAIR = /^([A-Z0-9]{1,20})\/([A-Z0-9]{1,10})$/;
/** a Hyperliquid perpetual (BTC-PERP), and a HIP-3 deployer's (io:ANTH-PERP) */
const HL_PERP = /^([A-Za-z0-9]{1,20})-PERP$/;
const HIP3_PERP = /^([A-Za-z][A-Za-z0-9]{0,15}:[A-Za-z0-9]{1,20})-PERP$/;

/** THE STREAM OF A MARKET, as its own listing source names it: the venue whose stream it is, and the venue's own symbol for it there — or
 * undefined: its source has no stream here (a stock, an event contract, a token, Binance, Bybit, a pre-IPO venue's contract) */
function streamOf(source: string, symbol: string): { venue: HubVenue; sym: string } | undefined {
  const s = String(symbol ?? "").trim();
  if (source === "coinbase" || source === "kraken" || source === "okx") {
    const p = PAIR.exec(s);
    if (!p) return undefined;
    return { venue: source, sym: source === "kraken" ? `${p[1]}/${p[2]}` : `${p[1]}-${p[2]}` };
  }
  if (source === "hyperliquid") {
    const k = HL_PERP.exec(s);
    return k ? { venue: "hyperliquid", sym: k[1]! } : undefined;
  }
  if (source === "hyperliquid-preipo" || source === "trade-xyz") {
    const k = HIP3_PERP.exec(s);
    return k && (source !== "trade-xyz" || k[1]!.startsWith("xyz:")) ? { venue: "hyperliquid", sym: k[1]! } : undefined;
  }
  return undefined;
}

// ---- prices.ts ---------------------------------------------------------------------------------------------------------------------------

export type Price = (asset: string) => Promise<number | undefined>;

// ---- china.ts ---------------------------------------------------------------------------------------------------------------------------

/** China's venue id: the account refuses it by name (its explore, quotes and history are the market's) */
export const CHINA_ID = "china";

// ---- us-quotes.ts and public-stocks.ts -------------------------------------------------------------------------------------------------

/** the words a price from each source carries (Market.quoteFrom) */
const ROBINHOOD_FROM = "Robinhood · real time";
const NASDAQ_FROM = "Nasdaq · real time";
/** Robinhood's quotes are taken in the overnight session (20:00 to 04:00 New York, ahead of a market day) too. AN ASSUMPTION, NOT A
 * MEASUREMENT: its assets list says 191 of its Stock Tokens are tradable overnight, and its AAPL daily low on 2026-10-14 (340.29) lay a cent
 * below the lowest the earlier pass found anywhere else (340.30, the 13 October after-hours low) — a margin any one print could explain, so
 * it suggests an overnight session and does not show one. Nobody watched its bid and ask move after 20:00. Set false if they do not:
 * overnight a share then has no real-time price, and nothing is filled or offered in that session. A book that does not move ages out on its
 * own either way (a quote is stamped "unchanged since", FRESH_MS), and one first seen is not taken until it moves: a book frozen since the
 * last session is not taken for a live one, after a restart either */
const ROBINHOOD_OVERNIGHT = true;
/** a quote older than this (by its own stamp) is not taken as real time */
export const FRESH_MS = 120_000;
/** a US share's ticker as the US stocks line names it: one to five letters, a class letter after a dot (BRK.B) */
export const US_TICKER = /^[A-Z]{1,5}(\.[A-Z])?$/;

/** one US share's quote from a real-time source */
export interface UsQuote {
  /** the share's ticker (AAPL, BRK.B) */
  symbol: string;
  /** the last trade (Nasdaq), or the middle of the bid and ask (Robinhood) */
  price?: number | undefined;
  bid?: number | undefined;
  ask?: number | undefined;
  /** the source's own stamp for it, in ms: for Robinhood, the generatedAt of the first answer in which this bid and ask stood ("unchanged
   * since") — of the last answer read before it, where it moved across answers that were not read; for Nasdaq, its lastTradeTimestamp (to
   * the minute) */
  at: number;
  /** how far behind the market the source is: 0 for both */
  delayMs: number;
  /** which source, in words (ROBINHOOD_FROM, NASDAQ_FROM) */
  from: string;
  /** the change of `price` from the last regular-session close before `at` — yesterday's close in pre-market and the regular session, today's
   * in after-hours — in dollars and in percent, where the source says it (Nasdaq's primaryData; Robinhood gives none) */
  change?: number | undefined;
  changePct?: number | undefined;
}

/** how far behind the market Cboe's delayed quote is */
export const CBOE_DELAY_MS = 15 * 60_000;
/** the source's id, as it has always been: paper books name it as the source of what they hold */
export const US_STOCKS_ID = "cboe";
/** a real-time quote said to be the phase's own live quote: in the phase that is on, and no older than FRESH_MS and the minute to which
 * Nasdaq stamps a trade */
const SAID_LIVE_MS = FRESH_MS + 60_000;

/** THE OLD RULE, from when every US stock was priced by Cboe alone: whether a quote fifteen minutes behind the market is from inside the
 * regular session now, true from 09:45 to 16:15 New York on a market day (13:15 on an early close). A line now says its own source, stamp
 * and delay (quoteAt, delayMs) and the source carries the market's clock (`sessions`: account/calendar.ts usClock), by which a fill is
 * judged instead; this stays only until paper.ts no longer asks it */
export const cboeQuoteInSession = (nowMs: number): boolean => nextRegularSession(nowMs - CBOE_DELAY_MS).open;

/** the US stock market's REGULAR session now, from the account's own calendar: open or closed and when, with no phase (the old shape — a
 * line now carries account/calendar.ts usSessionFull, which says the phase too) */
export const usSession = (nowMs: number): MarketSession => regularSession(nowMs);

/** the words a line carries while the market is out of its session and the price is Cboe's (the close) */
function usClosedWords(session: MarketSession): string {
  const opens = session.opensAt ? Date.parse(session.opensAt) : NaN;
  return `the US stock market is closed${Number.isFinite(opens) ? `: it opens ${etDate(opens)}, 09:30 New York` : ""}; Cboe's quote is from the close`;
}

const PHASE_WORDS: Partial<Record<string, string>> = { pre: "pre-market trading", after: "after-hours trading", overnight: "the overnight session" };
/** a phase's name, for the phase a quote's own time is in */
const PHASE_NAMES: Partial<Record<string, string>> = { pre: "pre-market", regular: "regular session", after: "after-hours", overnight: "overnight session", closed: "market closed" };
/** a New York time of day, "09:30" */
function etClock(ms: number): string {
  const t = et(ms);
  return `${String(Math.floor(t.minutes / 60)).padStart(2, "0")}:${String(t.minutes % 60).padStart(2, "0")}`;
}

/** The words a line carries outside the regular session (none inside it): which phase is on and until when, and whose price it is — a
 * real-time source's quote from that phase; or, where the real-time price is not from the phase that is on or is older than SAID_LIVE_MS
 * (Nasdaq's last trade is taken however old: a share that has not traded since the close), that source's last trade or quote and when, in
 * which phase; or Cboe's close where no real-time source answered. Closed — or overnight for a share not traded then — usClosedWords.
 * `quoteAt` is the price's own time, `now` the listing's */
function usSessionWords(session: MarketSession, quoteFrom: string, quoteAt?: number, now?: number): string | undefined {
  if (session.open) return undefined;
  const phase = PHASE_WORDS[session.phase ?? ""];
  const ends = session.phaseEndsAt ? Date.parse(session.phaseEndsAt) : NaN;
  const opens = session.opensAt ? Date.parse(session.opensAt) : NaN;
  // overnight, a share is traded only where Robinhood's 24-hour market priced it (extendedHours): for any other, the market is closed
  if (!phase || !Number.isFinite(ends) || (session.phase === "overnight" && !session.extendedHours)) return usClosedWords(session);
  const until = `${phase} is on until ${etClock(ends)} New York`;
  const opening = Number.isFinite(opens) ? `; the regular session opens ${etDate(opens)}, 09:30 New York` : "";
  const who = quoteFrom === ROBINHOOD_FROM ? "Robinhood" : quoteFrom === NASDAQ_FROM ? "Nasdaq" : undefined;
  if (!who) return `${until}, but no real-time quote answered: Cboe's quote is from the close${opening}`;
  if (quoteAt === undefined || (usPhaseAt(quoteAt) === session.phase && (now ?? quoteAt) - quoteAt <= SAID_LIVE_MS)) return `${until}: the price is ${who}'s real-time quote${opening}`;
  const day = now !== undefined && etDate(now) === etDate(quoteAt) ? "" : ` on ${etDate(quoteAt)}`;
  return `${until}: the price is ${who}'s ${who === "Nasdaq" ? "last trade" : "quote"} at ${etClock(quoteAt)} New York${day} (${PHASE_NAMES[usPhaseAt(quoteAt)] ?? usPhaseAt(quoteAt)})${opening}`;
}

/** A US LINE SAID AGAIN AT A NEWER REAL-TIME QUOTE — the background reader's (live/us-quotes.ts UsQuoteFeed), which a paper account prices a
 * share it knows from (live/paper.ts): the listing's own figures, what the market is, under that quote's price, bid, ask, stamp, delay and
 * source (never one source's price beside another's bid: a side the quote does not give is none); the session at `now` as the line says it
 * with that quote (an extended-hours order offered where a real-time source priced it — overnight only Robinhood) and its words; the day's
 * change the quote's own (Nasdaq's), else at this price from the close the listing's change was measured from (its price less its change),
 * while the listing's price and this quote are of one regular session — none otherwise, as robinhoodDay says none */
export function usLineAt(m: Listing, rt: UsQuote, now: number): Listing {
  const session = usSessionFull(now, ROBINHOOD_OVERNIGHT && rt.from === ROBINHOOD_FROM);
  const note = usSessionWords(session, rt.from, rt.at, now);
  const { price: p0, bid: _b, ask: _a, quoteAt: q0, delayMs: _d, quoteFrom: _f, session: _s, note: _n, change24h: c0, changePct24h: _c, ...rest } = m;
  let change = rt.change;
  let changePct = rt.changePct;
  if (change === undefined && changePct === undefined && rt.price !== undefined && p0 !== undefined && c0 !== undefined) {
    const was = q0 ? Date.parse(q0) : NaN;
    const ref = p0 - c0;
    if (ref > 0 && Number.isFinite(was) && usPhaseAt(rt.at) === "regular" && usPhaseAt(was) === "regular" && etDate(rt.at) === etDate(was)) {
      change = round(rt.price - ref, 6);
      changePct = round(((rt.price - ref) / ref) * 100, 4);
    }
  }
  return {
    ...rest,
    ...(rt.price !== undefined ? { price: rt.price } : {}),
    ...(rt.bid !== undefined ? { bid: rt.bid } : {}),
    ...(rt.ask !== undefined ? { ask: rt.ask } : {}),
    quoteAt: new Date(rt.at).toISOString(),
    delayMs: rt.delayMs,
    quoteFrom: rt.from,
    session,
    ...(note ? { note } : {}),
    ...(change !== undefined ? { change24h: change } : {}),
    ...(changePct !== undefined ? { changePct24h: changePct } : {}),
  };
}

// ---- the account's own ---------------------------------------------------------------------------------------------------------------------

/** WHETHER THE MARKET'S HUB STREAMS A MARKET, and whether only its price (the market's protocol.ts /api/hub/covers, answered here without
 * asking it): a venue's stream (streamOf), or the US stocks line's background reader for a plain ticker (us-quotes.ts UsQuoteFeed.covers,
 * which carries the price alone). The market's own fixture (market/test/fixtures/hub-covers.json) is the agreement both sides are tested by */
export function hubCovers(source: string, symbol: string): { covers: boolean; pricesOnly: boolean } {
  if (streamOf(source, symbol)) return { covers: true, pricesOnly: false };
  if (source === US_STOCKS_ID && US_TICKER.test(String(symbol ?? ""))) return { covers: true, pricesOnly: true };
  return { covers: false, pricesOnly: false };
}
