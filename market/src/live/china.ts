/** The China source: A shares as Tencent ranks, quotes, charts and finds them, composed from the parsers moved from the face (cn-*.ts).
 * It stands beside the public sources, not among them: its rows are priced in CNY (`currency`), carry no dollar volume, sit in the China
 * tab alone and never in `all`, and every line is view-only (`canTrade` false, nothing to connect) — no venue here trades an A share.
 * Its markets quote in CNY, so every dollar path (`inDollars`) stays shut to them.
 *
 * Each read is kept a short while and shared by concurrent asks (a flight per key); a failure is never kept. A ranking that fails is
 * answered from the last good one for up to {@link STALE_KEEP_MS}, flagged stale. A refusal carries the Account's own words, never
 * Tencent's text, a URL or a thrown message. Every request goes through `cnHosts`: a GET over https to one of Tencent's four hosts. */
import { isRefusal, type Refusal } from "../core/errors.ts";
import { no } from "../refuse.ts";
import { cnHosts, realCnHttp, type CnHttp } from "./cn-http.ts";
import { CN_BARS, HISTORY_BODY_LIMIT, historyUrl, parseDayQuery, parseKline, type ChinaRange, type CnBar, type CnMinutes } from "./cn-history.ts";
import { decodeGbk, parseTencentQuotes, QUOTE_RESPONSE_LIMIT, QUOTE_TIMEOUT_MS, tencentCode, type CnQuote } from "./cn-quotes.ts";
import { mergeMovers, parseTencentRank, RANK_BODY_LIMIT, RANK_ROWS, rankUrl, type ChinaSort, type RankRow } from "./cn-rank.ts";
import { decodeSmartbox, parseTencentSearch, SEARCH_RESPONSE_LIMIT, SEARCH_RESULTS, SEARCH_TIMEOUT_MS, searchUrl, type CnHit } from "./cn-search.ts";
import { readCnSession, SESSION_CODES, type CnPhase, type CnSession } from "./cn-session.ts";
import type { ExploreItem } from "./explore.ts";
import type { Market } from "./trade.ts";

export const CHINA_ID = "china";
/** a line's venueName and every quoteFrom */
export const CHINA_NAME = "Tencent";
export const CHINA_NOTE = "China: A shares as Tencent ranks them, view-only and priced in CNY; no venue here trades them.";
export const RANK_TTL_MS = 10_000, QUOTES_TTL_MS = 5_000, MINUTES_TTL_MS = 30_000, BARS_TTL_MS = 600_000, SEARCH_TTL_MS = 60_000;
/** a ranking kept to answer, flagged stale, after a failed read */
export const STALE_KEEP_MS = 600_000;
/** a trading-hours quote older than this is "delayed" */
export const DELAYED_MS = 300_000;
/** the searches kept, least recently used first out, and the most asked of Tencent at once (the face's SEARCH_CACHE_LIMIT, SEARCH_FLIGHT_LIMIT) */
export const SEARCH_KEEP = 128, SEARCH_FLIGHTS = 32;
/** the most answers one of the source's keeps holds (cnKeeper) */
export const CN_KEPT = 200;

export interface ChinaStatus { state: "live" | "stale" | "unavailable"; said: string; at?: string | undefined }
export interface ChinaRead { sort: ChinaSort; total: number; asOf: string; session: CnSession; status: ChinaStatus }
export interface ChinaFacts {
  prevClose: number | null; open: number | null; high: number | null; low: number | null; turnover: number | null;
  turnoverRate: number | null; marketCap: number | null; peTtm: number | null; limitUp: number | null; limitDown: number | null;
  volume: number | null; amplitude: number | null; lastSession: string | null; phase: CnPhase; quoteStatus: "live" | "delayed";
}
export type ChinaMarket = Market & { currency: "CNY"; cn: ChinaFacts };
export type ChinaHistory =
  | { venue: "china"; venueName: "Tencent"; symbol: string; range: "1D" | "5D"; sessions: CnMinutes[]; source: string }
  | { venue: "china"; venueName: "Tencent"; symbol: string; range: Exclude<ChinaRange, "1D" | "5D">; candles: CnBar[]; source: string; adjustment: string };

export interface ChinaSource {
  rank(sort: ChinaSort): Promise<{ items: ExploreItem[]; read: ChinaRead } | Refusal>;
  search(q: string): Promise<ExploreItem[] | Refusal>;
  /** at most SEARCH_RESULTS (30) symbols */
  quotes(symbols: readonly string[]): Promise<Map<string, ChinaMarket> | Refusal>;
  history(symbol: string, range: ChinaRange): Promise<ChinaHistory | Refusal>;
  /** the last ranking's or quote read's outcome; a quote read made only to price a search's hits is not one */
  status(): ChinaStatus;
}

const LIVE_SAID = "Tencent · answering";
const UNAVAILABLE_SAID = "Tencent is not answering: A shares cannot be read now";
const SEARCH_FAILED = "Tencent's search did not answer";
const ADJUSTMENT = "forward-adjusted (前复权)";
const SEARCH_HEADERS = { accept: "application/json, text/plain, */*", "user-agent": "Mozilla/5.0 Gravit-Symbol-Search" };

const hhmm = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const unavailable = (): Refusal => no("E_VENUE_UNREACHABLE", { venue: CHINA_ID, message: UNAVAILABLE_SAID });
const badAction = (message: string): Refusal => no("E_ACCOUNT_BAD_ACTION", { venue: CHINA_ID, message });
const round = (v: number, places: number): number => Math.round(v * 10 ** places) / 10 ** places;

type Kept<T> = { at: number; answer: T };
type RankAnswer = { items: ExploreItem[]; read: ChinaRead };

/** ONE OF THE SOURCE'S KEEPS: an answer kept `ttl` per key, a flight shared per key; `read` resolves to its answer or a refusal, which is
 * never kept. As an answer comes in, those past their keep are let go and at most CN_KEPT stay, the oldest let go first: the quotes are kept
 * by the set of codes asked and a chart by its URL, so a set asked once (the rows a page shows, as the ranking moves under them) or a chart
 * opened once is not kept for the life of the process */
export function cnKeeper<T>(now: () => number, ttl: (key: string) => number) {
  const kept = new Map<string, Kept<T>>();
  const flights = new Map<string, Promise<T | Refusal>>();
  const keep = (key: string, answer: T): void => {
    const at = now();
    for (const [k, e] of kept) if (at - e.at >= ttl(k)) kept.delete(k);
    kept.delete(key);
    kept.set(key, { at, answer });
    while (kept.size > CN_KEPT) kept.delete(kept.keys().next().value!);
  };
  return {
    kept,
    flights,
    ask(key: string, read: () => Promise<T | Refusal>, isAnswer: (v: T | Refusal) => v is T): Promise<T | Refusal> {
      const hit = kept.get(key);
      if (hit && now() - hit.at < ttl(key)) return Promise.resolve(hit.answer);
      const flying = flights.get(key);
      if (flying) return flying;
      const flight = read().then((v) => { if (isAnswer(v)) keep(key, v); return v; })
        .finally(() => flights.delete(key));
      flights.set(key, flight);
      return flight;
    },
  };
}

/** one share as a China row: view-only, in CNY, in the China tab alone */
function rowOf(r: { symbol: string; name: string; price: number | null; changePct: number | null; turnover: number | null }): ExploreItem {
  return {
    key: `cn:${r.symbol}`, kind: "ashare", name: r.name, base: r.symbol, currency: "CNY",
    ...(r.price !== null ? { price: r.price } : {}),
    ...(r.changePct !== null ? { changePct24h: r.changePct } : {}),
    ...(r.turnover !== null ? { turnoverCny: r.turnover } : {}),
    quoteFrom: CHINA_NAME, tabs: ["china"],
    at: [{ venue: CHINA_ID, venueName: CHINA_NAME, symbol: r.symbol, connected: false, canTrade: false, public: true,
      ...(r.price !== null ? { price: r.price } : {}), quoteFrom: CHINA_NAME }],
  };
}

function marketOf(q: CnQuote, session: CnSession, nowMs: number): ChinaMarket {
  const changed = q.price !== null && q.prevClose !== null;
  const delayed = session.phase === "trading" && (q.asOf === null || nowMs - Date.parse(q.asOf) > DELAYED_MS);
  return {
    symbol: q.symbol, name: q.name ?? q.symbol, kind: "stock", base: q.symbol, quote: "CNY", currency: "CNY", open: false, types: [],
    ...(q.price !== null ? { price: q.price } : {}),
    ...(q.asOf !== null ? { quoteAt: q.asOf } : {}),
    quoteFrom: CHINA_NAME,
    ...(changed ? { change24h: round(q.price! - q.prevClose!, 4), changePct24h: round((q.price! / q.prevClose! - 1) * 100, 2) } : {}),
    session: { open: session.phase === "trading" },
    cn: {
      prevClose: q.prevClose, open: q.open, high: q.high, low: q.low, turnover: q.turnover, turnoverRate: q.turnoverRate,
      marketCap: q.marketCap, peTtm: q.peTtm, limitUp: q.limitUp, limitDown: q.limitDown, volume: q.volume, amplitude: q.amplitude,
      lastSession: session.lastSession, phase: session.phase, quoteStatus: delayed ? "delayed" : "live",
    },
  };
}

export function chinaSource(deps: { http?: CnHttp; clock?: () => number } = {}): ChinaSource {
  const http = cnHosts(deps.http ?? realCnHttp);
  const now = deps.clock ?? Date.now;
  let status: ChinaStatus = { state: "unavailable", said: "Tencent · not read yet" };

  async function get(url: string, timeoutMs: number, maxBytes: number, headers?: Record<string, string>): Promise<Uint8Array> {
    const reply = await http(url, { timeoutMs, maxBytes, ...(headers ? { headers } : {}) });
    if (reply.status !== 200) throw new Error("http");
    return reply.bytes;
  }
  const utf8 = (bytes: Uint8Array): string => new TextDecoder("utf-8").decode(bytes);
  const keeper = <T>(ttl: (key: string) => number) => cnKeeper<T>(now, ttl);

  // ---- the ranking -----------------------------------------------------------------------------------------------------------------
  const good = new Map<ChinaSort, Kept<RankAnswer>>();
  const ranks = keeper<RankAnswer>(() => RANK_TTL_MS);

  async function page(sortType: "turnover" | "priceRatio", direct: "down" | "up"): Promise<{ total: number; rows: RankRow[] }> {
    return parseTencentRank(utf8(await get(rankUrl(sortType, direct, RANK_ROWS), QUOTE_TIMEOUT_MS, RANK_BODY_LIMIT)));
  }
  async function readRank(sort: ChinaSort): Promise<RankAnswer | Refusal> {
    const startedAt = now();
    const session = readCnSession(http, startedAt);
    try {
      let total: number, rows: RankRow[];
      if (sort === "volume") ({ total, rows } = await page("turnover", "down"));
      else {
        const [gainers, losers] = await Promise.all([page("priceRatio", "down"), page("priceRatio", "up")]);
        total = gainers.total;
        rows = mergeMovers(gainers.rows, losers.rows);
      }
      const asOf = new Date(now()).toISOString();
      status = { state: "live", said: LIVE_SAID, at: asOf };
      const answer: RankAnswer = { items: rows.slice(0, RANK_ROWS).map(rowOf), read: { sort, total, asOf, session: await session, status } };
      good.set(sort, { at: now(), answer });
      return answer;
    } catch {
      await session;
      const last = good.get(sort);
      if (last && now() - last.at < STALE_KEEP_MS) {
        status = { state: "stale", said: `Tencent did not answer · China as of ${hhmm.format(new Date(last.at))} Beijing`, at: last.answer.read.asOf };
        return { items: last.answer.items, read: { ...last.answer.read, status } };
      }
      status = { state: "unavailable", said: UNAVAILABLE_SAID };
      return unavailable();
    }
  }
  const freshRank = (v: RankAnswer | Refusal): v is RankAnswer => !isRefusal(v) && v.read.status.state === "live";

  // ---- quotes ------------------------------------------------------------------------------------------------------------------------
  const quoteKeeper = keeper<Map<string, ChinaMarket>>(() => QUOTES_TTL_MS);
  const isMarkets = (v: Map<string, ChinaMarket> | Refusal): v is Map<string, ChinaMarket> => v instanceof Map;

  /** `said`: whether this read's outcome is China's status — a quote read asked for itself is; one made only to price a search's hits is
   * not, so a failed side read never says China is unavailable while its ranking answers */
  async function readQuotes(symbols: string[], said: boolean): Promise<Map<string, ChinaMarket> | Refusal> {
    const codes = symbols.map((s) => tencentCode(s)!);
    try {
      const text = decodeGbk(await get(`https://qt.gtimg.cn/q=${[...SESSION_CODES, ...codes].join(",")}`, QUOTE_TIMEOUT_MS, QUOTE_RESPONSE_LIMIT));
      const at = now();
      const { session, quotes } = parseTencentQuotes(text, symbols, at);
      if (said) status = { state: "live", said: LIVE_SAID, at: new Date(at).toISOString() };
      return new Map([...quotes].map(([s, q]) => [s, marketOf(q, session, at)]));
    } catch {
      if (said) status = { state: "unavailable", said: UNAVAILABLE_SAID };
      return unavailable();
    }
  }
  async function quotes(asked: readonly string[], said = true): Promise<Map<string, ChinaMarket> | Refusal> {
    const symbols = [...new Set(asked)];
    if (symbols.length > SEARCH_RESULTS) return badAction(`at most ${SEARCH_RESULTS} A shares are quoted at once`);
    const filed = symbols.filter((s) => tencentCode(s) !== null);
    if (!filed.length) return new Map();
    // kept by the set asked, asked of Tencent in the order given
    const got = await quoteKeeper.ask([...filed].sort().join(","), () => readQuotes(filed, said), isMarkets);
    if (!isMarkets(got)) return got;
    return new Map(symbols.flatMap((s) => (got.has(s) ? [[s, got.get(s)!] as const] : [])));
  }

  // ---- history -----------------------------------------------------------------------------------------------------------------------
  const minutesRange = (range: ChinaRange): range is "1D" | "5D" => range === "1D" || range === "5D";
  type Read = { minutes: CnMinutes[] } | { bars: CnBar[] };
  // kept by URL: 1D and 5D are one read
  const histories = keeper<Read>((url) => (url.includes("/day/query") ? MINUTES_TTL_MS : BARS_TTL_MS));
  const isRead = (v: Read | Refusal): v is Read => !isRefusal(v);

  async function history(symbol: string, range: ChinaRange): Promise<ChinaHistory | Refusal> {
    const code = tencentCode(symbol);
    if (!code) return badAction("an A share is its six digits");
    if (!minutesRange(range) && !Object.hasOwn(CN_BARS, range)) return badAction("no such A-share chart range");
    const url = historyUrl(code, range);
    const got = await histories.ask(url, async () => {
      try {
        const body = utf8(await get(url, QUOTE_TIMEOUT_MS, HISTORY_BODY_LIMIT));
        return minutesRange(range) ? { minutes: parseDayQuery(body, code) } : { bars: parseKline(body, code, CN_BARS[range][0]) };
      } catch { return unavailable(); }
    }, isRead);
    if (!isRead(got)) return got;
    const head = { venue: "china", venueName: "Tencent", symbol } as const;
    if (minutesRange(range)) {
      const sessions = "minutes" in got ? got.minutes : [];
      return { ...head, range, sessions: sessions.slice(range === "1D" ? -1 : -5), source: CHINA_NAME };
    }
    let candles = "bars" in got ? got.bars : [];
    if (range === "YTD" && candles.length) {
      const from = Date.parse(`${new Date(candles.at(-1)!.t).getUTCFullYear()}-01-01T00:00:00+08:00`);
      candles = candles.filter((c) => c.t >= from);
    }
    return { ...head, range, candles, source: CHINA_NAME, adjustment: ADJUSTMENT };
  }

  // ---- search ------------------------------------------------------------------------------------------------------------------------
  const searches = keeper<CnHit[]>(() => SEARCH_TTL_MS);
  const isHits = (v: CnHit[] | Refusal): v is CnHit[] => Array.isArray(v);

  async function search(q: string): Promise<ExploreItem[] | Refusal> {
    const query = q.trim();
    if (!query) return [];
    const key = query.toLocaleLowerCase("en-US");
    const hit = searches.kept.get(key);
    if (hit && now() - hit.at < SEARCH_TTL_MS) { searches.kept.delete(key); searches.kept.set(key, hit); } // least recently used goes first
    else if (!searches.flights.has(key) && searches.flights.size >= SEARCH_FLIGHTS) return badAction("too many A-share searches at once");
    const hits = await searches.ask(key, async () => {
      try {
        const body = decodeSmartbox(await get(searchUrl(query), SEARCH_TIMEOUT_MS, SEARCH_RESPONSE_LIMIT, SEARCH_HEADERS));
        return parseTencentSearch(body).hits.slice(0, SEARCH_RESULTS);
      } catch { return no("E_VENUE_UNREACHABLE", { venue: CHINA_ID, message: SEARCH_FAILED }); }
    }, isHits);
    if (!isHits(hits)) return hits;
    while (searches.kept.size > SEARCH_KEEP) searches.kept.delete(searches.kept.keys().next().value!);
    if (!hits.length) return [];
    // a side read: its outcome is not China's status
    const priced = await quotes(hits.map((h) => h.symbol), false);
    const markets = isMarkets(priced) ? priced : new Map<string, ChinaMarket>();
    return hits.map((h) => {
      const m = markets.get(h.symbol);
      return rowOf({ symbol: h.symbol, name: h.name, price: m?.price ?? null, changePct: m?.changePct24h ?? null, turnover: m?.cn.turnover ?? null });
    });
  }

  return {
    rank: (sort) => ranks.ask(sort, () => readRank(sort), freshRank),
    search,
    quotes: (symbols) => quotes(symbols),
    history,
    status: () => status,
  };
}
