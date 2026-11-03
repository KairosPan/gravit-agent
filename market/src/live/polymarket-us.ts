/** A POLYMARKET US account — QCX LLC d/b/a Polymarket US, a CFTC-designated contract market, cleared by QC Clearing LLC (Polymarket
 * Clearing) — read and traded through its own API (docs.polymarket.us, read 2026-10-08: api-reference/introduction, authentication,
 * rate-limits, orders/overview, orders/create-order, portfolio/overview, account/get-account-balances, market/overview, price-history, the
 * OpenAPI schemas behind them, concepts/orders, market-structure/collateral-and-margin, faqs/general-faqs).
 *
 * It is not polymarket.com. Polymarket's international exchange — the Polygon CLOB, live:polymarket-trade (polymarket-clob.ts) — is a
 * separate exchange with its own rules; Polymarket US is "Fiat-based, CFTC-regulated exchange. Trades in USD. Built for US residents" (its
 * docs), with its own accounts, its own dollars and its own API. Nothing is shared between the two connections.
 *
 * Signed, at api.polymarket.us — the authenticated API "to trade":
 *
 *   GET  /v1/account/balances          {balances: [{currentBalance, buyingPower, currency, …}]}: the cash, and what it may buy now
 *   GET  /v1/portfolio/positions       {positions: {<market slug>: {netPositionDecimal, cost, qtyAvailableDecimal, …}}, nextCursor, eof}: a MAP
 *                                      of slug to position, a hundred to a page ("follow the nextCursor value … until the response returns
 *                                      eof: true", changelog 2026-06-24)
 *   POST /v1/orders                    one order: {id, executions?} — the executions only when it was sent synchronous
 *   GET  /v1/order/{orderId}           {order}: what became of it
 *   POST /v1/order/{orderId}/cancel    {marketSlug}: answered empty
 *   GET  /v1/orders/open               {orders}: what rests on the book now (all of the account's: it is filtered here)
 *
 * Public, at gateway.polymarket.us — "No API key needed" (introduction.md); nothing is signed for these, and no key goes there:
 *
 *   GET /v1/market/slug/{slug}         one market: its sides, its best bid and ask (the YES leg's), its tick, its smallest size, its status
 *   GET /v1/markets/{slug}/bbo         its top of book now: best bid and ask, the last trade, the book's state
 *   GET /v1/markets?slug=…&slug=…      the held markets, of any status, for what a position is worth now
 *   GET /v1/markets?active=true&closed=false&categories=<c>&orderBy=volume&orderDirection=desc&limit=   a category's most traded open markets
 *   GET /v1/markets/{slug}/settlement  a resolved market's settlement: 1 (YES won) or 0
 *   GET /v1/search?query=              the events matching some words, each with its markets
 *   GET /v1/price-history?symbol=      "book-derived Yes and No display prices for one market"
 *
 * The gateway's answers, checked live and keyless on 2026-10-08 (their shapes only; nothing here is about who Polymarket US serves):
 *   · a market: {id, slug, question (the event's words), title (this market's: "Los Angeles Dodgers", "Before January 2027"), category
 *     ("politics", "finance", "crypto", "sports" …), status ("MARKET_STATUS_OPEN" …), active, closed, endDate, orderPriceMinTickSize (0.001,
 *     0.005 or 0.01), minimumTradeQty (1, or 0.01 for a partial-contract market), bestBidQuote and bestAskQuote ({value: "0.6020", currency:
 *     "USD"}, the YES leg's — a side with no order is absent), marketSides ([{long: true, description: "Yes", price, tradable}, {long:
 *     false, description: "No", …}]), outcomes and outcomePrices (JSON strings — which do NOT follow one order: ["No","Yes"] beside
 *     ["0.6030","0.398"], YES's price first, so they are not read)}. No volume figure in any list, though `orderBy=volume` orders by one
 *   · a BBO: {marketData: {marketSlug, bestBid, bestAsk, lastTradePx, currentPx (the middle), settlementPx (the DAILY settlement — a price,
 *     not a result: 0.40 on a market still trading), sharesTraded (since listing, not a day), state ("MARKET_STATE_OPEN" …)}}
 *   · a book: {marketData: {bids: [{px: {value}, qty}], offers: […], state, stats: {lastTradePx, openPx, highPx, …}, transactTime}}
 *   · a settlement: {"slug": …, "settlement": 1}; a market not settled: HTTP 404 {"code": 5, "message": "Settlement not found for market …"}
 *   · a market it does not list: HTTP 404 {"code": 5, "message": "The server was unable to process your request.", "details": []}
 *   · a search: {events: [{slug, title, category, markets: [<markets as above>]}]}; a price history: {history: [{timestamp (seconds),
 *     longPrice, shortPrice}]}, and {history: []} for a symbol it does not know
 *
 * SIGNING (authentication.md): three headers — X-PM-Access-Key (the Key ID), X-PM-Timestamp (milliseconds; "Timestamps must be within 30
 * seconds of server time") and X-PM-Signature, base64 of an Ed25519 signature over the UTF-8 of `${timestamp}${METHOD}${path}`, made with "the
 * first 32 bytes of the base64-decoded secret" (its Python: `base64.b64decode("YOUR_SECRET_KEY")[:32]`). The docs' one example signs a path
 * with no query (GET /v1/portfolio/positions) and do not say whether a query is part of the path: it is signed here without one, as Kalshi's
 * is, and the signed reads ask without a query wherever the API lets them (a page of positions after the first is the one place it does
 * not). The secret is read from the key file in this process and used for nothing but these signatures.
 *
 * WHAT AN ORDER IS (orders/overview.md): "Only the long side (YES) is directly tradable. The short side (NO) is synthetic exposure created
 * through positions in the long side. The `price.value` field always represents the long side's price" — so a NO order at X goes with
 * price.value 1 − X and the intent ORDER_INTENT_BUY_SHORT or ORDER_INTENT_SELL_SHORT, and a NO held is the account's short of the YES
 * contract. Prices are "between 0.01 and 0.99 (the exchange's absolute price limits)", on the market's own tick; sizes are in contracts, on
 * its minimumTradeQty. There is no client order id, no reduce-only flag and no stop order on the retail create.
 *
 * MONEY: "Sellers (Short Positions) · Receive the contract price as proceeds · Post $1.00 margin per contract (full payout value) · Fiat
 * balance increases by sale proceeds" (collateral-and-margin.md). A NO bought at 0.40 is a YES sold at 0.60: the balance (currentBalance,
 * "Current fiat currency balance, not including security values") rises by 0.60 while $1.00 is held, and buying power falls by 0.40. So the
 * cash this account shows is the balance less $1.00 for each NO contract held, and each NO is worth its own price: the two together are
 * the balance plus every position at its price, which is what the account is worth. Polymarket US's API has no call that moves money in
 * or out: deposits and withdrawals are made in its app.
 */
// Trimmed copy of account/src/portfolio/live/polymarket-us.ts at 20ead850 (account split, plan A1): the market's own from here.
import { isRefusal, type Refusal } from "../core/errors.ts";
import { no } from "../refuse.ts";
import { categoryOf } from "./categories.ts";
import { badWindow, barStart, INTERVAL_WORDS } from "./history.ts";
import { INTERVAL_MS, type Candle, type CandleInterval, type CandlePage, type CandleWindow, type Market } from "./trade.ts";

export const PMUS_GATEWAY = "https://gateway.polymarket.us";
/** Polymarket US's own category words, as its gateway filed its open markets on 2026-10-08 (sports, politics, culture, finance, geopolitics,
 * technology, macro, crypto), less the two the account's lists leave out (categories.ts: sports and culture): the categories whose most
 * traded markets are offered to start from */
export const PMUS_CATEGORIES: readonly string[] = ["politics", "finance", "crypto", "macro", "geopolitics", "technology"];
/** how many markets of each category are read to start from */
export const PMUS_PER_CATEGORY = 6;

type Rec = Record<string, unknown>;
type Outcome = "YES" | "NO";
/** a GET at the gateway, by path: the body as it came, or the venue's refusal */
export type PmusGet = (path: string) => Promise<unknown>;

const enc = encodeURIComponent;
const round = (x: number, places = 6): number => Number(x.toFixed(places));
const isRec = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);
const rec = (v: unknown): Rec => (isRec(v) ? v : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);
const fin = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};
/** an Amount, {value: "0.55", currency: "USD"}, as a number; nothing when it is absent or null */
const amountOf = (v: unknown): number | undefined => (isRec(v) ? fin(v.value) : undefined);
/** an event contract's price: more than 0 and less than 1 */
const px = (v: number | undefined): number | undefined => (v !== undefined && v > 0 && v < 1 ? v : undefined);
const mid = (bid: number | undefined, ask: number | undefined): number | undefined => (bid !== undefined && ask !== undefined && ask >= bid ? round((bid + ask) / 2) : undefined);

/** `tec-mlb-nlchamp-2026-09-27-lad:YES` → the market's slug and the outcome: the names this connection gives markets and positions */
export function pmusParse(symbol: string): { slug: string; outcome: Outcome } | undefined {
  const m = /^([a-z0-9][a-z0-9._-]{0,159}):(yes|no)$/i.exec(String(symbol ?? "").trim());
  return m ? { slug: m[1]!.toLowerCase(), outcome: m[2]!.toUpperCase() as Outcome } : undefined;
}

// ---- a market, in the account's terms ----------------------------------------------------------------

const STATUS_WORDS: Record<string, string> = {
  MARKET_STATUS_CLOSED: "closed",
  MARKET_STATUS_RESOLVING: "past its expiry, its settlement not published yet",
  MARKET_STATUS_RESOLVED: "settled",
  MARKET_STATUS_HALTED: "Polymarket US has halted it",
  MARKET_STATUS_UNSPECIFIED: "not open for orders yet",
};
const STATE_WORDS: Record<string, string> = {
  MARKET_STATE_PREOPEN: "not open for orders yet (pre-open)",
  MARKET_STATE_SUSPENDED: "Polymarket US has suspended trading in it now (its weekly maintenance is Thursdays 6–8am ET)",
  MARKET_STATE_HALTED: "Polymarket US has halted trading in it",
  MARKET_STATE_EXPIRED: "expired",
  MARKET_STATE_TERMINATED: "terminated",
  MARKET_STATE_MATCH_AND_CLOSE_AUCTION: "in its closing auction",
};

const slugOf = (m: Rec): string => String(m.slug ?? "").toLowerCase();
/** a market in words: the event's question and this market's own title ("When will Bitcoin hit $150k? — Before January 2027") */
function wordsOf(m: Rec): string {
  const q = str(m.question);
  const t = str(m.title);
  return q && t && t !== q ? `${q} — ${t}` : (q ?? t ?? slugOf(m));
}
/** a market that takes orders by its own listing: open, active, not closed, its YES side tradable */
export const pmusTradable = (m: Rec): boolean => typeof m.slug === "string" && m.slug !== "" && m.status === "MARKET_STATUS_OPEN" && m.active !== false && m.closed !== true && !list(m.marketSides).some((s) => isRec(s) && s.long === true && s.tradable === false);

/** One Polymarket US market as the account's market for one of its outcomes. The book is the YES contract's: NO's bid is 1 − YES's ask and
 * NO's ask 1 − YES's bid. `lite` is the market's BBO when it was read (marketData): the freshest book, its last trade, its state. The
 * venue's category is kept in its own words, title-cased (categories.ts). No volume or 24-hour change is said: the gateway gives neither
 * (sharesTraded counts since listing) */
export function pmusMarket(m: Rec, outcome: Outcome, lite?: Rec): Market {
  const slug = slugOf(m);
  const yes = outcome === "YES";
  // the BBO when it was read is the book now: a side it shows empty (null) is empty, whatever the listing's quote said
  const yb = px(amountOf(lite ? lite.bestBid : m.bestBidQuote));
  const ya = px(amountOf(lite ? lite.bestAsk : m.bestAskQuote));
  const lastYes = px(amountOf(lite?.lastTradePx));
  const bid = yes ? yb : ya === undefined ? undefined : round(1 - ya);
  const ask = yes ? ya : yb === undefined ? undefined : round(1 - yb);
  const last = lastYes === undefined ? undefined : yes ? lastYes : round(1 - lastYes);
  const price = last ?? mid(bid, ask);
  const status = String(m.status ?? "");
  const state = lite ? str(lite.state) : undefined;
  const open = pmusTradable(m) && (state === undefined || state === "MARKET_STATE_OPEN");
  const words = wordsOf(m);
  const end = str(m.endDate);
  const why = status !== "MARKET_STATUS_OPEN" ? (STATUS_WORDS[status] ?? `its status at Polymarket US is ${status || "unknown"}`) : state && state !== "MARKET_STATE_OPEN" ? (STATE_WORDS[state] ?? `its book is ${state}`) : m.active === false || m.closed === true ? "Polymarket US lists it as not active" : open ? "" : "its YES side does not trade now";
  const note = open ? (end ? `ends ${end.replace("T", " ").replace(/:\d\d(\.\d+)?Z$/, " UTC")}` : "") : why;
  const tick = fin(m.orderPriceMinTickSize);
  const priceStep = tick !== undefined && tick > 0 ? tick : 0.01;
  const lot = fin(m.minimumTradeQty);
  const qtyStep = lot !== undefined && lot > 0 ? lot : 1;
  const category = categoryOf([str(m.category)]);
  // What its create takes in every market: limit and market orders (the account's market order goes as a limit at its worst price that
  // fills at once), good-till-canceled, immediate-or-cancel, fill-or-kill, and a day order as good-till-date at the trade day's end;
  // post-only (participateDontInitiate). A sell is held to what is held, so a plain sell closes a position (no reduce-only flag exists)
  return {
    symbol: `${slug}:${outcome}`,
    name: `${words} · ${yes ? "Yes" : "No"}`,
    kind: "event",
    base: `${slug}:${outcome}`,
    quote: "USD",
    price,
    bid,
    ask,
    minQty: qtyStep,
    qtyStep,
    priceStep,
    open,
    ...(note ? { note } : {}),
    types: ["market", "limit"],
    tifs: ["gtc", "ioc", "fok", "day"],
    tifsByType: { market: ["ioc", "fok"], limit: ["gtc", "ioc", "fok", "day"] },
    postOnly: true,
    sellsReduce: true,
    ...(end ? { closeTime: end } : {}),
    ...(category ? { category } : {}),
    group: { id: slug, title: words },
    outcome,
  };
}
/** a market as its two outcomes */
export const pmusLegs = (m: Rec, lite?: Rec): Market[] => [pmusMarket(m, "YES", lite), pmusMarket(m, "NO", lite)];

/** What a category's most traded open markets are, several categories in turn — each one's most traded, then each one's second … — one
 * GET each: GET /v1/markets?active=true&closed=false&categories=&orderBy=volume&orderDirection=desc (Polymarket US gives no volume figure,
 * and orders by its own when asked: `orderBy=volume` reorders the list, `volume24hr` and `volumeNum` do not — checked 2026-10-08).
 * `endMin`/`endMax` keep the markets that end within a window (endDateMin, endDateMax). A category that refuses is left out while the
 * others answer; only when every one refuses is the refusal the answer */
export async function pmusBusiest(get: PmusGet, o: { perCategory: number; categories?: readonly string[] | undefined; endMin?: string | undefined; endMax?: string | undefined }): Promise<Rec[] | Refusal> {
  const window = `${o.endMin ? `&endDateMin=${enc(o.endMin)}` : ""}${o.endMax ? `&endDateMax=${enc(o.endMax)}` : ""}`;
  const bodies = await Promise.all((o.categories ?? PMUS_CATEGORIES).map((c) => get(`/v1/markets?active=true&closed=false&categories=${enc(c)}&orderBy=volume&orderDirection=desc&limit=${o.perCategory}${window}`)));
  let refused: Refusal | undefined;
  const lists: Rec[][] = [];
  for (const b of bodies) {
    if (isRefusal(b)) refused ??= b;
    else lists.push(list(rec(b).markets).filter(isRec).filter(pmusTradable));
  }
  if (!lists.length && refused) return refused;
  const out = new Map<string, Rec>();
  for (let k = 0; k < o.perCategory; k++) for (const l of lists) if (l[k] && !out.has(slugOf(l[k]!))) out.set(slugOf(l[k]!), l[k]!);
  return [...out.values()];
}

/** Polymarket US's own search (GET /v1/search?query=&limit=: events, each with its markets), the open markets of what it finds — every
 * category, as the venue's search reaches every market */
export async function pmusSearch(get: PmusGet, q: string, events = 10): Promise<Rec[] | Refusal> {
  const body = await get(`/v1/search?query=${enc(q.trim().slice(0, 60))}&limit=${Math.min(20, Math.max(1, Math.floor(events)))}`);
  if (isRefusal(body)) return body;
  const out = new Map<string, Rec>();
  for (const ev of list(rec(body).events).filter(isRec)) for (const m of list(ev.markets).filter(isRec).filter(pmusTradable)) if (!out.has(slugOf(m))) out.set(slugOf(m), m);
  return [...out.values()];
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** A market's price history: GET /v1/price-history?symbol=<slug>&fixedInterval=&fidelity= — "book-derived Yes and No display prices",
 * `longPrice` "normally derived from the best ask" and `shortPrice` "from one minus the best bid": the price each outcome could be bought at
 * then, not trades, so a bar has no volume. Its fixed profiles are five-minute points for a day (INTERVAL_1D, fidelity 5), minute points
 * for six hours (INTERVAL_6H, 1), three-hour points for a week or a month (INTERVAL_1W / INTERVAL_1M, 180) and all of it (INTERVAL_ALL, 180):
 * the one that covers the start asked is read, and its points folded into bars — first, highest, lowest, last. Bars of a minute come only
 * from the six hours' minute points, and of five or fifteen minutes only from the day's five-minute ones: where the window asked starts
 * before the profile reaches (a 1D view in minutes, a 5D one in quarter hours), the page says where its points end, never more */
export async function pmusCandles(get: PmusGet, venue: string, symbol: string, interval: CandleInterval, w: CandleWindow, now: number): Promise<Candle[] | CandlePage | Refusal> {
  const why = badWindow(interval, w, now);
  if (why) return no("E_ACCOUNT_BAD_ACTION", { venue, message: why });
  const sinceMs = w.since ?? Math.max(0, (w.until ?? now) - Math.min(w.limit ?? 300, 1_000) * INTERVAL_MS[interval]);
  const until = w.until ?? Number.POSITIVE_INFINITY;
  const s = pmusParse(symbol);
  if (!s) return no("E_ACCOUNT_BAD_ACTION", { venue, message: `a Polymarket US market here is <market slug>:YES or <market slug>:NO, not "${String(symbol).slice(0, 60)}"` });
  const span = now - sinceMs;
  // the profile whose points are fine enough for the bars and reach back far enough: minute points for six hours, five-minute ones for a
  // day, three-hour ones for a week, a month or all of it
  const fine = interval === "1m" || interval === "5m" || interval === "15m";
  const [profile, fidelity] =
    interval === "1m" ? ["INTERVAL_6H", 1] : fine ? ["INTERVAL_1D", 5] : interval === "1h" ? (span <= 6 * HOUR_MS ? ["INTERVAL_6H", 1] : span <= DAY_MS ? ["INTERVAL_1D", 5] : ["INTERVAL_1W", 180]) : interval === "4h" ? (span <= 7 * DAY_MS ? ["INTERVAL_1W", 180] : ["INTERVAL_1M", 180]) : span <= 30 * DAY_MS ? ["INTERVAL_1M", 180] : ["INTERVAL_ALL", 180];
  const body = await get(`/v1/price-history?symbol=${enc(s.slug)}&fixedInterval=${profile}&fidelity=${fidelity}`);
  if (isRefusal(body)) return body;
  const bars = new Map<number, Candle>();
  const points = list(rec(body).history)
    .filter(isRec)
    .map((p) => ({ t: fin(p.timestamp), p: px(fin(s.outcome === "YES" ? p.longPrice : p.shortPrice)) }))
    .filter((p): p is { t: number; p: number } => p.t !== undefined && p.p !== undefined && p.t * 1000 >= sinceMs && p.t * 1000 < until)
    .sort((a, b) => a.t - b.t);
  for (const { t, p } of points) {
    const at = barStart(t * 1000, interval);
    const b = bars.get(at);
    if (!b) bars.set(at, { t: at, o: p, h: p, l: p, c: p });
    else {
      b.h = Math.max(b.h, p);
      b.l = Math.min(b.l, p);
      b.c = p;
    }
  }
  // how far back each profile reaches: where the window starts before that, the page says so
  const reach = PMUS_REACH[profile as keyof typeof PMUS_REACH];
  if (sinceMs >= now - reach.ms) return [...bars.values()];
  return { bars: [...bars.values()], more: false, ends: `Polymarket US keeps ${reach.words}: no older ${INTERVAL_WORDS[interval]} bars` };
}
/** each price-history profile's reach, and its points in words */
const PMUS_REACH = {
  INTERVAL_6H: { ms: 6 * HOUR_MS, words: "minute points for six hours" },
  INTERVAL_1D: { ms: DAY_MS, words: "five-minute points for a day" },
  INTERVAL_1W: { ms: 7 * DAY_MS, words: "three-hour points for a week" },
  INTERVAL_1M: { ms: 30 * DAY_MS, words: "three-hour points for a month" },
  INTERVAL_ALL: { ms: Number.POSITIVE_INFINITY, words: "three-hour points for all of it" },
} as const;
