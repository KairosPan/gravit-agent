/** The Hong Kong source: main-board shares as Tencent ranks, quotes, charts and finds them, shaped like the China source (china.ts): the same
 * keeps (`cnKeeper`), the same status, the same stale rule, every row view-only and priced in HKD. When Tencent's ranking does not answer,
 * Eastmoney's main-board list stands behind it (its ETFs dropped), its rows worded "Eastmoney · delayed". An empty ranking, from either, is a
 * failure. A refusal carries the market's own words, never a source's text, a URL or a thrown message. */
import type { CnSession } from "./cn-session.ts";
import { isRefusal, type Refusal } from "../core/errors.ts";
import { no } from "../refuse.ts";
import { CN_BARS, HISTORY_BODY_LIMIT } from "./cn-history.ts";
import { realCnHttp, type CnHttp } from "./cn-http.ts";
import { decodeGbk, QUOTE_RESPONSE_LIMIT, QUOTE_TIMEOUT_MS } from "./cn-quotes.ts";
import { decodeSmartbox, SEARCH_RESPONSE_LIMIT, SEARCH_RESULTS, SEARCH_TIMEOUT_MS } from "./cn-search.ts";
import { BARS_TTL_MS, cnKeeper, MINUTES_TTL_MS, QUOTES_TTL_MS, RANK_TTL_MS, SEARCH_FLIGHTS, SEARCH_KEEP, SEARCH_TTL_MS, STALE_KEEP_MS } from "./china.ts";
import { eastmoney, emListUrl, EASTMONEY_NAME, type EmRow } from "./eastmoney.ts";
import type { ExploreItem } from "./explore.ts";
import {
  hkCode, hkKlineUrl, hkMinuteUrl, hkQuoteUrl, hkRankUrl, hkSearchUrl, HK_BODY_LIMIT, HK_RANK_PAGE, HK_RANK_ROWS,
  parseHkKline, parseHkMinutes, parseHkQuotes, parseHkRank, parseHkSearch, type HkHit, type HkInterval, type HkRankRow,
} from "./hk-parse.ts";
import { HK_HOSTS, politeHosts, retryOnce } from "./local-http.ts";
import { localSession, SESSIONS } from "./local-session.ts";
import { quoteWord, rankTtlMs, shareRow, type LocalHistory, type LocalMarket, type LocalRead, type LocalSort, type LocalSource, type LocalStatus } from "./local.ts";
import type { CandleRange } from "./trade.ts";

export { HK_RANK_ROWS, hkCode };
export const HK_ID = "hk";
export const HK_NAME = "Tencent";
export const HK_NOTE = "Hong Kong: main-board shares as Tencent ranks them, view-only and priced in HKD; no venue here trades them.";
const EM_NOTE = "Hong Kong: main-board shares as Eastmoney ranks them (Tencent did not answer), view-only and priced in HKD; no venue here trades them.";
/** Eastmoney declares Hong Kong delayed and gives no figure */
const EM_FROM = `${EASTMONEY_NAME} · delayed`;
/** Eastmoney's `t:3`, the main board; its list is asked for nothing else */
const EM_FS = "m:128+t:3";
/** Eastmoney's `t:3` still carries exchange-traded products under fund names (盈富基金, 南方恒生科技, 恒生中国企业, leveraged and inverse
 * products): they are no shares, and their names say so. A share named South…Airlines (南方航空) is not caught: the prefix is 南方 followed by
 * 恒生, 两倍 or 东英 only. */
const ETP_NAME = /基金|ETF|杠杆|杠桿|反向|两倍|兩倍|每日|^南方(?:恒生|东英|東英)|^恒生中国企业$|^恒生国企$|^恒生科技$/i;

const LIVE_SAID = "Tencent · answering";
const EM_LIVE_SAID = "Eastmoney · answering (Tencent did not)";
const UNAVAILABLE_SAID = "Tencent is not answering: Hong Kong shares cannot be read now";
const SEARCH_FAILED = "Tencent's search did not answer";
const ADJUSTMENT = "forward-adjusted (前复权)";
const SEARCH_HEADERS = { accept: "application/json, text/plain, */*", "user-agent": "Mozilla/5.0 gravit-Symbol-Search" };

const hhmm = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Hong_Kong", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const unavailable = (): Refusal => no("E_VENUE_UNREACHABLE", { venue: HK_ID, message: UNAVAILABLE_SAID });
const badAction = (message: string): Refusal => no("E_ACCOUNT_BAD_ACTION", { venue: HK_ID, message });
const round = (v: number, places: number): number => Math.round(v * 10 ** places) / 10 ** places;

type Kept<T> = { at: number; answer: T };
type RankAnswer = { items: ExploreItem[]; read: LocalRead };
type Rows = { total: number; rows: HkRankRow[]; from: string; note: string; said: string; lastTrade?: string };

const rowOf = (r: { code: string; name: string; price: number | null; changePct: number | null; turnover: number | null }, quoteFrom: string): ExploreItem =>
  shareRow({ venue: "hk", venueName: HK_NAME, code: r.code, name: r.name, currency: "HKD", price: r.price, changePct: r.changePct, turnover: r.turnover, quoteFrom });

const BAR_INTERVAL: Record<string, HkInterval> = { day: "day", week: "week", month: "month" };

export function hongKongSource(deps: { http?: CnHttp; clock?: () => number; eastmoney?: ReturnType<typeof eastmoney> } = {}): LocalSource {
  const now = deps.clock ?? Date.now;
  const http = politeHosts(deps.http ?? realCnHttp, HK_HOSTS, deps.clock ? { clock: deps.clock } : {});
  const em = deps.eastmoney ?? eastmoney({ ...(deps.http ? { http: deps.http } : {}), ...(deps.clock ? { clock: deps.clock } : {}) });
  let status: LocalStatus = { state: "unavailable", said: "Tencent · not read yet" };

  async function get(url: string, timeoutMs: number, maxBytes: number, headers?: Record<string, string>): Promise<Uint8Array> {
    const reply = await retryOnce(() => http(url, { timeoutMs, maxBytes, ...(headers ? { headers } : {}) }));
    if (reply.status !== 200) throw new Error("http");
    return reply.bytes;
  }
  const utf8 = (bytes: Uint8Array): string => new TextDecoder("utf-8").decode(bytes);
  const keeper = <T>(ttl: (key: string) => number) => cnKeeper<T>(now, ttl);

  // ---- the ranking -----------------------------------------------------------------------------------------------------------------
  /** the one ranking read both sorts are made from: movers is the same rows re-sorted, so the host sees one read */
  type Base = { rows: HkRankRow[]; total: number; from: string; note: string; said: string; asOf: string; session: CnSession; status: LocalStatus };
  let last: { at: number; base: Base } | null = null;
  let kept: { until: number; base: Base } | null = null;
  let flight: Promise<Base | Refusal> | null = null;

  /** Tencent's turnover ranking, page after page up to HK_RANK_ROWS rows; any page failing fails the read, and so does an empty one */
  async function tencentRows(): Promise<Rows> {
    const pages = Math.ceil(HK_RANK_ROWS / HK_RANK_PAGE);
    const got = await Promise.all(Array.from({ length: pages }, async (_, i) => {
      const parsed = parseHkRank(utf8(await get(hkRankUrl(i + 1), QUOTE_TIMEOUT_MS, HK_BODY_LIMIT)));
      if (!parsed) throw new Error("invalid ranking");
      return parsed;
    }));
    const seen = new Set<string>();
    const rows = got.flatMap((p) => p.rows).filter((r) => !seen.has(r.code) && seen.add(r.code)).slice(0, HK_RANK_ROWS);
    if (!rows.length) throw new Error("empty ranking");
    // the ranking carries no trade time: the top share's quote has one (a failed side read leaves it out)
    const top = await quotes([rows[0]!.code], false);
    const lastTrade = isMarkets(top) ? top.get(rows[0]!.code)?.quoteAt : undefined;
    return { total: got[0]!.total, rows, from: HK_NAME, note: HK_NOTE, said: LIVE_SAID, ...(lastTrade ? { lastTrade } : {}) };
  }
  /** Eastmoney's main-board list by turnover, its funds and leveraged products dropped */
  async function eastmoneyRows(): Promise<Rows | null> {
    try {
      const list = await em.list(emListUrl(EM_FS, { fid: "f6", pz: HK_RANK_ROWS }));
      if (isRefusal(list)) return null;
      const kept = list.filter((r: EmRow) => /^\d{5}$/.test(r.code) && !ETP_NAME.test(r.name));
      const rows = kept.map((r): HkRankRow => ({ code: r.code, name: r.name, price: r.price, changePct: r.changePct, turnover: r.turnover }));
      const lastTrade = kept.find((r) => r.at !== undefined)?.at;
      return rows.length ? { total: rows.length, rows, from: EM_FROM, note: EM_NOTE, said: EM_LIVE_SAID, ...(lastTrade ? { lastTrade } : {}) } : null;
    } catch { return null; }
  }

  async function readRank(): Promise<Base | Refusal> {
    const startedAt = now();
    let got: Rows | null;
    try { got = await tencentRows(); } catch { got = await eastmoneyRows(); }
    if (got) {
      const asOf = new Date(now()).toISOString();
      status = { state: "live", said: got.said, at: asOf };
      const base: Base = { rows: got.rows, total: got.total, from: got.from, note: got.note, said: got.said, asOf, status,
        session: localSession(SESSIONS.hk, startedAt, got.lastTrade) };
      last = { at: now(), base };
      kept = { until: now() + rankTtlMs(SESSIONS.hk, now(), RANK_TTL_MS), base };
      return base;
    }
    const old = last && now() - last.at < STALE_KEEP_MS ? last : null;
    if (old) {
      status = { state: "stale", said: `Tencent and Eastmoney did not answer · Hong Kong as of ${hhmm.format(new Date(old.at))} HKT`, at: old.base.asOf };
      return { ...old.base, status };
    }
    status = { state: "unavailable", said: UNAVAILABLE_SAID };
    return unavailable();
  }
  const answerOf = (base: Base, sort: LocalSort): RankAnswer => {
    const size = (r: HkRankRow): number => (r.changePct === null ? -1 : Math.abs(r.changePct));
    // movers: the turnover ranking, re-sorted by the size of the move (stable, so ties stay in turnover order)
    const rows = sort === "movers" ? [...base.rows].sort((a, b) => size(b) - size(a)) : base.rows;
    return { items: rows.map((r) => rowOf(r, base.from)),
      read: { venue: "hk", region: "hk", sort, total: base.total, asOf: base.asOf, session: base.session, status: base.status, note: base.note } };
  };
  async function rank(sort: LocalSort): Promise<RankAnswer | Refusal> {
    if (kept && now() < kept.until) return answerOf(kept.base, sort);
    flight ??= readRank().finally(() => { flight = null; });
    const base = await flight;
    return isRefusal(base) ? base : answerOf(base, sort);
  }

  // ---- quotes ----------------------------------------------------------------------------------------------------------------------
  const quoteKeeper = keeper<Map<string, LocalMarket>>(() => QUOTES_TTL_MS);
  const isMarkets = (v: Map<string, LocalMarket> | Refusal): v is Map<string, LocalMarket> => v instanceof Map;

  async function readQuotes(codes: string[], said: boolean): Promise<Map<string, LocalMarket> | Refusal> {
    try {
      const parsed = parseHkQuotes(decodeGbk(await get(hkQuoteUrl(codes), QUOTE_TIMEOUT_MS, QUOTE_RESPONSE_LIMIT)));
      if (!parsed) throw new Error("invalid quotes");
      const at = now();
      if (said) status = { state: "live", said: LIVE_SAID, at: new Date(at).toISOString() };
      const markets = new Map<string, LocalMarket>();
      for (const [code, q] of parsed) {
        const session = localSession(SESSIONS.hk, at, q.asOf);
        const changed = q.price !== null && q.prevClose !== null;
        markets.set(code, {
          symbol: code, name: q.name ?? code, kind: "stock", base: code, quote: "HKD", currency: "HKD", open: false, types: [],
          ...(q.price !== null ? { price: q.price } : {}),
          ...(q.asOf !== null ? { quoteAt: q.asOf } : {}),
          quoteFrom: quoteWord(HK_NAME, null),
          ...(changed ? { change24h: round(q.price! - q.prevClose!, 4), changePct24h: round((q.price! / q.prevClose! - 1) * 100, 2) } : {}),
          session: { open: session.phase === "trading" },
          local: { prevClose: q.prevClose, open: q.open, high: q.high, low: q.low, volume: q.volume, turnover: q.turnover,
            lastSession: session.lastSession, phase: session.phase, quoteStatus: "unsaid" },
        });
      }
      return markets;
    } catch {
      if (said) status = { state: "unavailable", said: UNAVAILABLE_SAID };
      return unavailable();
    }
  }
  async function quotes(asked: readonly string[], said = true): Promise<Map<string, LocalMarket> | Refusal> {
    const codes = [...new Set(asked.flatMap((s) => { const c = hkCode(s); return c ? [c] : []; }))];
    if (codes.length > SEARCH_RESULTS) return badAction(`at most ${SEARCH_RESULTS} Hong Kong shares are quoted at once`);
    if (!codes.length) return new Map();
    const got = await quoteKeeper.ask([...codes].sort().join(","), () => readQuotes(codes, said), isMarkets);
    if (!isMarkets(got)) return got;
    return new Map(codes.flatMap((c) => (got.has(c) ? [[c, got.get(c)!] as const] : [])));
  }

  // ---- history ---------------------------------------------------------------------------------------------------------------------
  type Read = { minutes: NonNullable<ReturnType<typeof parseHkMinutes>> } | { bars: NonNullable<ReturnType<typeof parseHkKline>> };
  const histories = keeper<Read>((url) => (url.includes("/hkMinute/") ? MINUTES_TTL_MS : BARS_TTL_MS));
  const isRead = (v: Read | Refusal): v is Read => !isRefusal(v);

  async function history(symbol: string, range: CandleRange): Promise<LocalHistory | Refusal> {
    const code = hkCode(symbol);
    if (!code) return badAction("a Hong Kong share is its code, up to five digits");
    if (range === "5D") return badAction("Hong Kong's five-day minutes are not read here");
    const head = { venue: "hk", venueName: HK_NAME, symbol: code } as const;
    if (range === "1D") {
      const url = hkMinuteUrl(code);
      const got = await histories.ask(url, async () => {
        try {
          const minutes = parseHkMinutes(utf8(await get(url, QUOTE_TIMEOUT_MS, HISTORY_BODY_LIMIT)), code);
          return minutes ? { minutes } : unavailable();
        } catch { return unavailable(); }
      }, isRead);
      if (!isRead(got)) return got;
      return { ...head, range, sessions: "minutes" in got ? got.minutes : [], source: HK_NAME };
    }
    if (!Object.hasOwn(CN_BARS, range)) return badAction("no such Hong Kong chart range");
    const [interval, count] = CN_BARS[range as Exclude<CandleRange, "1D" | "5D">];
    const url = hkKlineUrl(code, BAR_INTERVAL[interval]!, count);
    const got = await histories.ask(url, async () => {
      try {
        const bars = parseHkKline(utf8(await get(url, QUOTE_TIMEOUT_MS, HISTORY_BODY_LIMIT)), code, BAR_INTERVAL[interval]!);
        return bars ? { bars } : unavailable();
      } catch { return unavailable(); }
    }, isRead);
    if (!isRead(got)) return got;
    let candles = "bars" in got ? got.bars : [];
    if (range === "YTD" && candles.length) {
      const from = Date.parse(`${new Date(candles.at(-1)!.t).getUTCFullYear()}-01-01T00:00:00+08:00`);
      candles = candles.filter((c) => c.t >= from);
    }
    return { ...head, range, candles, source: HK_NAME, adjustment: ADJUSTMENT };
  }

  // ---- search ----------------------------------------------------------------------------------------------------------------------
  const searches = keeper<HkHit[]>(() => SEARCH_TTL_MS);
  const isHits = (v: HkHit[] | Refusal): v is HkHit[] => Array.isArray(v);

  async function search(q: string): Promise<ExploreItem[] | Refusal> {
    const query = q.trim();
    if (!query) return [];
    const key = query.toLocaleLowerCase("en-US");
    const hit = searches.kept.get(key);
    if (hit && now() - hit.at < SEARCH_TTL_MS) { searches.kept.delete(key); searches.kept.set(key, hit); }
    else if (!searches.flights.has(key) && searches.flights.size >= SEARCH_FLIGHTS) return badAction("too many Hong Kong searches at once");
    const hits = await searches.ask(key, async () => {
      try {
        const parsed = parseHkSearch(decodeSmartbox(await get(hkSearchUrl(query), SEARCH_TIMEOUT_MS, SEARCH_RESPONSE_LIMIT, SEARCH_HEADERS)));
        return parsed ? parsed.slice(0, SEARCH_RESULTS) : no("E_VENUE_UNREACHABLE", { venue: HK_ID, message: SEARCH_FAILED });
      } catch { return no("E_VENUE_UNREACHABLE", { venue: HK_ID, message: SEARCH_FAILED }); }
    }, isHits);
    if (!isHits(hits)) return hits;
    while (searches.kept.size > SEARCH_KEEP) searches.kept.delete(searches.kept.keys().next().value!);
    if (!hits.length) return [];
    // a side read: its outcome is not Hong Kong's status
    const priced = await quotes(hits.map((h) => h.code), false);
    const markets = isMarkets(priced) ? priced : new Map<string, LocalMarket>();
    return hits.map((h) => {
      const m = markets.get(h.code);
      return rowOf({ code: h.code, name: h.name, price: m?.price ?? null, changePct: m?.changePct24h ?? null, turnover: m?.local.turnover ?? null }, HK_NAME);
    });
  }

  return {
    venue: "hk",
    name: HK_NAME,
    rank,
    search,
    quotes: (symbols) => quotes(symbols),
    history,
    status: () => status,
  };
}
