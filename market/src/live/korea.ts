/** The Korea source: KOSPI shares as Naver gives them, shaped like the Hong Kong source (hongkong.ts): the same keeps (`cnKeeper`), the same
 * status, the same stale rule, every row view-only and priced in KRW. Naver has no turnover ranking, so the ranking is the 200 largest KOSPI
 * shares by market value (two pages of a hundred, exchange-traded products left out), re-sorted by the day's turnover, or by the size of the move for
 * movers, from one read. Names stay Korean. An empty ranking is a failure. A refusal carries the market's own words, never a source's text,
 * a URL or a thrown message. */
import { isRefusal, type Refusal } from "../core/errors.ts";
import { no } from "../refuse.ts";
import { CN_BARS, HISTORY_BODY_LIMIT } from "./cn-history.ts";
import type { CnSession } from "./cn-session.ts";
import { realCnHttp, type CnHttp } from "./cn-http.ts";
import { QUOTE_RESPONSE_LIMIT, QUOTE_TIMEOUT_MS } from "./cn-quotes.ts";
import { SEARCH_RESPONSE_LIMIT, SEARCH_RESULTS, SEARCH_TIMEOUT_MS } from "./cn-search.ts";
import { BARS_TTL_MS, cnKeeper, QUOTES_TTL_MS, RANK_TTL_MS, SEARCH_FLIGHTS, SEARCH_KEEP, SEARCH_TTL_MS } from "./china.ts";
import type { ExploreItem } from "./explore.ts";
import {
  krChartUrl, krCode, krQuoteUrl, krRankUrl, krSearchUrl, KR_BODY_LIMIT, KR_RANK_PAGE, KR_RANK_ROWS,
  parseKrChart, parseKrQuotes, parseKrRank, parseKrSearch, type KrHit, type KrRankRow,
} from "./kr-parse.ts";
import { NAVER_HOSTS, politeHosts, retryOnce } from "./local-http.ts";
import { localSession, SESSIONS } from "./local-session.ts";
import { quoteWord, rankTtlMs, shareRow, staleRank, type LocalHistory, type LocalMarket, type LocalRead, type LocalSort, type LocalSource, type LocalStatus } from "./local.ts";
import type { CandleRange } from "./trade.ts";

export { KR_RANK_ROWS, krCode };
export const KR_ID = "kr";
export const KR_NAME = "Naver";
const NOTE_BY_TURNOVER = "the 200 largest KOSPI shares by market value, ordered by today's turnover";
const NOTE_BY_MOVE = "the 200 largest KOSPI shares by market value, ordered by today's move";
const LIVE_SAID = "Naver · answering";
const UNAVAILABLE_SAID = "Naver is not answering: Korean shares cannot be read now";
const SEARCH_FAILED = "Naver's search did not answer";
const SEARCH_HEADERS = { accept: "application/json, text/plain, */*", "user-agent": "Mozilla/5.0 gravit-Symbol-Search" };

const hhmm = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const unavailable = (): Refusal => no("E_VENUE_UNREACHABLE", { venue: KR_ID, message: UNAVAILABLE_SAID });
const badAction = (message: string): Refusal => no("E_ACCOUNT_BAD_ACTION", { venue: KR_ID, message });
const round = (v: number, places: number): number => Math.round(v * 10 ** places) / 10 ** places;

type RankAnswer = { items: ExploreItem[]; read: LocalRead };

const rowOf = (r: { code: string; name: string; price: number | null; changePct: number | null; turnover: number | null }, quoteFrom: string): ExploreItem =>
  shareRow({ venue: "kr", venueName: KR_NAME, code: r.code, name: r.name, currency: "KRW", price: r.price, changePct: r.changePct, turnover: r.turnover, quoteFrom });

/** whole calendar months back from a bar's date, for the charts' ranges */
const MONTHS: Partial<Record<CandleRange, number>> = { "1M": 1, "3M": 3, "6M": 6, "1Y": 12, "5Y": 60 };

export function koreaSource(deps: { http?: CnHttp; clock?: () => number } = {}): LocalSource {
  const now = deps.clock ?? Date.now;
  const http = politeHosts(deps.http ?? realCnHttp, NAVER_HOSTS, deps.clock ? { clock: deps.clock } : {});
  let status: LocalStatus = { state: "unavailable", said: "Naver · not read yet" };

  async function get(url: string, timeoutMs: number, maxBytes: number, headers?: Record<string, string>): Promise<Uint8Array> {
    const reply = await retryOnce(() => http(url, { timeoutMs, maxBytes, ...(headers ? { headers } : {}) }));
    if (reply.status !== 200) throw new Error("http");
    return reply.bytes;
  }
  const utf8 = (bytes: Uint8Array): string => new TextDecoder("utf-8").decode(bytes);
  const keeper = <T>(ttl: (key: string, at: number) => number) => cnKeeper<T>(now, ttl);

  // ---- the ranking -----------------------------------------------------------------------------------------------------------------
  /** the one ranking read both sorts are made from: movers is the same rows re-sorted, so the host sees one read */
  type Base = { rows: KrRankRow[]; from: string; asOf: string; session: CnSession; status: LocalStatus };
  let last: { at: number; base: Base } | null = null;
  let kept: { until: number; base: Base } | null = null;
  let flight: Promise<Base | Refusal> | null = null;

  /** the two market-value pages, shares only, in turnover order; any page failing fails the read, and so does an empty one */
  async function naverRows(): Promise<{ rows: KrRankRow[]; from: string; lastTrade?: string }> {
    const pages = Math.ceil(KR_RANK_ROWS / KR_RANK_PAGE);
    const got = await Promise.all(Array.from({ length: pages }, async (_, i) => {
      const parsed = parseKrRank(utf8(await get(krRankUrl(i + 1), QUOTE_TIMEOUT_MS, KR_BODY_LIMIT)));
      if (!parsed) throw new Error("invalid ranking");
      return parsed;
    }));
    const seen = new Set<string>();
    const bySize = got.flatMap((p) => p.rows).filter((r) => !seen.has(r.code) && seen.add(r.code)).slice(0, KR_RANK_ROWS);
    if (!bySize.length) throw new Error("empty ranking");
    // stable: equal turnover keeps market-value order; a row without a turnover goes last
    const rows = [...bySize].sort((a, b) => (b.turnover ?? -1) - (a.turnover ?? -1));
    const lastTrade = bySize.find((r) => r.at !== null)?.at ?? undefined;
    const delay = bySize.find((r) => r.delayMin !== null)?.delayMin ?? null;
    return { rows, from: quoteWord(KR_NAME, delay), ...(lastTrade ? { lastTrade } : {}) };
  }

  async function readRank(): Promise<Base | Refusal> {
    const startedAt = now();
    let got: Awaited<ReturnType<typeof naverRows>> | null = null;
    try { got = await naverRows(); } catch { got = null; }
    if (got) {
      const asOf = new Date(now()).toISOString();
      status = { state: "live", said: LIVE_SAID, at: asOf };
      const base: Base = { rows: got.rows, from: got.from, asOf, status, session: localSession(SESSIONS.kr, startedAt, got.lastTrade) };
      last = { at: now(), base };
      kept = { until: now() + rankTtlMs(SESSIONS.kr, now(), RANK_TTL_MS), base };
      return base;
    }
    const old = last ? staleRank(last, now(), `Naver did not answer · Korea as of ${hhmm.format(new Date(last.at))} KST`) : null;
    if (old) { status = old.status; return old; }
    status = { state: "unavailable", said: UNAVAILABLE_SAID };
    return unavailable();
  }
  const answerOf = (base: Base, sort: LocalSort): RankAnswer => {
    const size = (r: KrRankRow): number => (r.changePct === null ? -1 : Math.abs(r.changePct));
    // movers: the turnover ranking, re-sorted by the size of the move (stable, so ties stay in turnover order)
    const rows = sort === "movers" ? [...base.rows].sort((a, b) => size(b) - size(a)) : base.rows;
    return { items: rows.map((r) => rowOf(r, base.from)),
      read: { venue: "kr", region: "kr", sort, total: base.rows.length, asOf: base.asOf, session: base.session, status: base.status,
        note: sort === "movers" ? NOTE_BY_MOVE : NOTE_BY_TURNOVER } };
  };
  async function rank(sort: LocalSort): Promise<RankAnswer | Refusal> {
    if (kept && now() < kept.until) return answerOf(kept.base, sort);
    flight ??= readRank().finally(() => { flight = null; });
    const base = await flight;
    return isRefusal(base) ? base : answerOf(base, sort);
  }

  // ---- quotes ----------------------------------------------------------------------------------------------------------------------
  /** a quote is kept 5 s in session, a minute in the 45 after the close, then until the next open (as the ranking, by when it was read) */
  const quoteKeeper = keeper<Map<string, LocalMarket>>((_, at) => rankTtlMs(SESSIONS.kr, at, QUOTES_TTL_MS));
  const isMarkets = (v: Map<string, LocalMarket> | Refusal): v is Map<string, LocalMarket> => v instanceof Map;

  async function readQuotes(codes: string[], said: boolean): Promise<Map<string, LocalMarket> | Refusal> {
    try {
      const parsed = parseKrQuotes(utf8(await get(krQuoteUrl(codes), QUOTE_TIMEOUT_MS, QUOTE_RESPONSE_LIMIT)));
      if (!parsed) throw new Error("invalid quotes");
      const at = now();
      if (said) status = { state: "live", said: LIVE_SAID, at: new Date(at).toISOString() };
      const markets = new Map<string, LocalMarket>();
      for (const [code, q] of parsed) {
        const session = localSession(SESSIONS.kr, at, q.asOf);
        const changed = q.price !== null && q.prevClose !== null;
        markets.set(code, {
          symbol: code, name: q.name ?? code, kind: "stock", base: code, quote: "KRW", currency: "KRW", open: false, types: [],
          ...(q.price !== null ? { price: q.price } : {}),
          ...(q.asOf !== null ? { quoteAt: q.asOf } : {}),
          quoteFrom: quoteWord(KR_NAME, q.delayMin),
          ...(changed ? { change24h: round(q.price! - q.prevClose!, 4), changePct24h: q.changePct ?? round((q.price! / q.prevClose! - 1) * 100, 2) } : {}),
          session: { open: session.phase === "trading" },
          local: { prevClose: q.prevClose, open: q.open, high: q.high, low: q.low, volume: q.volume, turnover: q.turnover,
            lastSession: session.lastSession, phase: session.phase,
            quoteStatus: q.delayMin === null ? "unsaid" : q.delayMin === 0 ? "live" : "delayed" },
        });
      }
      return markets;
    } catch {
      if (said) status = { state: "unavailable", said: UNAVAILABLE_SAID };
      return unavailable();
    }
  }
  async function quotes(asked: readonly string[], said = true): Promise<Map<string, LocalMarket> | Refusal> {
    const codes = [...new Set(asked.flatMap((s) => { const c = krCode(s); return c ? [c] : []; }))];
    if (codes.length > SEARCH_RESULTS) return badAction(`at most ${SEARCH_RESULTS} Korean shares are quoted at once`);
    if (!codes.length) return new Map();
    const got = await quoteKeeper.ask([...codes].sort().join(","), () => readQuotes(codes, said), isMarkets);
    if (!isMarkets(got)) return got;
    return new Map(codes.flatMap((c) => (got.has(c) ? [[c, got.get(c)!] as const] : [])));
  }

  // ---- history ---------------------------------------------------------------------------------------------------------------------
  type Bars = NonNullable<ReturnType<typeof parseKrChart>>;
  const histories = keeper<Bars>(() => BARS_TTL_MS);
  const isBars = (v: Bars | Refusal): v is Bars => Array.isArray(v);

  async function history(symbol: string, range: CandleRange): Promise<LocalHistory | Refusal> {
    const code = krCode(symbol);
    if (!code) return badAction("a Korean share is its code, six digits or letters");
    if (range === "1D" || range === "5D") return badAction("Korea's intraday chart is not read here");
    if (!Object.hasOwn(CN_BARS, range)) return badAction("no such Korean chart range");
    const url = krChartUrl(code);
    const got = await histories.ask(url, async () => {
      try {
        const bars = parseKrChart(utf8(await get(url, QUOTE_TIMEOUT_MS, HISTORY_BODY_LIMIT)), code);
        return bars ?? unavailable();
      } catch { return unavailable(); }
    }, isBars);
    if (!isBars(got)) return got;
    // the chart gives its day candles whole; a range is the window back from the latest bar, and a range longer than the bars is what there is
    let candles = got;
    if (candles.length && range !== "MAX") {
      const latest = new Date(candles.at(-1)!.t + 9 * 3_600_000);
      const from = range === "YTD"
        ? Date.UTC(latest.getUTCFullYear(), 0, 1) - 9 * 3_600_000
        : Date.UTC(latest.getUTCFullYear(), latest.getUTCMonth() - MONTHS[range]!, latest.getUTCDate()) - 9 * 3_600_000;
      candles = candles.filter((c) => c.t >= from);
    }
    return { venue: "kr", venueName: KR_NAME, symbol: code, range, candles, source: KR_NAME };
  }

  // ---- search ----------------------------------------------------------------------------------------------------------------------
  const searches = keeper<KrHit[]>(() => SEARCH_TTL_MS);
  const isHits = (v: KrHit[] | Refusal): v is KrHit[] => Array.isArray(v);

  async function search(q: string): Promise<ExploreItem[] | Refusal> {
    const query = q.trim();
    if (!query) return [];
    const key = query.toLocaleLowerCase("en-US");
    const hit = searches.kept.get(key);
    if (hit && now() - hit.at < SEARCH_TTL_MS) { searches.kept.delete(key); searches.kept.set(key, hit); }
    else if (!searches.flights.has(key) && searches.flights.size >= SEARCH_FLIGHTS) return badAction("too many Korean searches at once");
    const hits = await searches.ask(key, async () => {
      try {
        const parsed = parseKrSearch(utf8(await get(krSearchUrl(query), SEARCH_TIMEOUT_MS, SEARCH_RESPONSE_LIMIT, SEARCH_HEADERS)));
        return parsed ? parsed.slice(0, SEARCH_RESULTS) : no("E_VENUE_UNREACHABLE", { venue: KR_ID, message: SEARCH_FAILED });
      } catch { return no("E_VENUE_UNREACHABLE", { venue: KR_ID, message: SEARCH_FAILED }); }
    }, isHits);
    if (!isHits(hits)) return hits;
    while (searches.kept.size > SEARCH_KEEP) searches.kept.delete(searches.kept.keys().next().value!);
    if (!hits.length) return [];
    // a side read: its outcome is not Korea's status
    const priced = await quotes(hits.map((h) => h.code), false);
    const markets = isMarkets(priced) ? priced : new Map<string, LocalMarket>();
    return hits.map((h) => {
      const m = markets.get(h.code);
      return rowOf({ code: h.code, name: h.name, price: m?.price ?? null, changePct: m?.changePct24h ?? null, turnover: m?.local.turnover ?? null }, m?.quoteFrom ?? KR_NAME);
    });
  }

  return { venue: "kr", name: KR_NAME, rank, search, quotes: (symbols) => quotes(symbols), history, status: () => status };
}
