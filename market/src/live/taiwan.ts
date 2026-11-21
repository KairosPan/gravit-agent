/** The Taiwan source: TWSE-listed shares from TWSE's own keyless endpoints, shaped like the Hong Kong and Korea sources (hongkong.ts, korea.ts):
 * the same keeps (`cnKeeper`), the same status, the same stale rule, every row view-only and priced in TWD. The universe is the 200 busiest
 * shares (exchange-traded products, codes starting "00", left out) by trade value in the day table (`STOCK_DAY_ALL`, read once per close). In the
 * session the 200 are priced from MIS in `ceil(200 / MIS_BATCH)` asks and sorted by today's turnover or the size of the move, from one read;
 * outside it the day table's own numbers are the list and MIS is not asked. In session a row's turnover is price x volume (MIS gives none) and
 * its volume is MIS's lots of 1,000 shares x 1,000; outside it is the day table's `TradeValue`. An empty ranking is a failure. A refusal carries
 * the market's own words, never a source's text, a URL or a thrown message. */
import { isRefusal, type Refusal } from "../core/errors.ts";
import { no } from "../refuse.ts";
import { HISTORY_BODY_LIMIT } from "./cn-history.ts";
import type { CnSession } from "./cn-session.ts";
import { realCnHttp, type CnHttp } from "./cn-http.ts";
import { QUOTE_RESPONSE_LIMIT, QUOTE_TIMEOUT_MS } from "./cn-quotes.ts";
import { SEARCH_RESULTS } from "./cn-search.ts";
import { BARS_TTL_MS, cnKeeper, QUOTES_TTL_MS, STALE_KEEP_MS } from "./china.ts";
import type { ExploreItem } from "./explore.ts";
import { politeHosts, retryOnce, TWSE_HOSTS } from "./local-http.ts";
import { localSession, SESSIONS } from "./local-session.ts";
import { quoteWord, rankTtlMs, shareRow, type LocalHistory, type LocalMarket, type LocalRead, type LocalSort, type LocalSource, type LocalStatus } from "./local.ts";
import {
  MIS_BATCH, parseDayAll, parseMis, parseStockDay, TW_BODY_LIMIT, TW_UNIVERSE, twCode, twDayAllUrl, twMisUrl, twStockDayUrl,
  type DayRow, type DayTable, type MisQuote,
} from "./tw-parse.ts";
import type { CandleRange } from "./trade.ts";

export { TW_UNIVERSE, MIS_BATCH, twCode };
export const TW_ID = "tw";
export const TW_NAME = "TWSE";
const NOTE_CLOSE = "the 200 busiest TWSE shares at the last close";
const NOTE_LIVE_TURNOVER = "the 200 busiest TWSE shares at the last close, priced live, ordered by today's turnover";
const NOTE_LIVE_MOVE = "the 200 busiest TWSE shares at the last close, priced live, ordered by today's move";
const NOTE_CLOSE_MOVE = "the 200 busiest TWSE shares at the last close, ordered by the move";
const LIVE_SAID = "TWSE · answering";
const UNAVAILABLE_SAID = "TWSE is not answering: Taiwan shares cannot be read now";
const FROM_MIS = quoteWord(TW_NAME, 0);
const FROM_CLOSE = `${TW_NAME} · last close`;
const RANK_LIVE_MS = 30_000;
/** a day table that is older than the last session (the close's table is not out yet, or the day was a holiday) is read again after this */
const DAY_RETRY_MS = 300_000;
const MONTH_NOW_TTL_MS = 600_000;
const QUARTER_MS = 900_000;
const TAIPEI_MS = 8 * 3_600_000;

const hhmm = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const unavailable = (): Refusal => no("E_VENUE_UNREACHABLE", { venue: TW_ID, message: UNAVAILABLE_SAID });
const badAction = (message: string): Refusal => no("E_ACCOUNT_BAD_ACTION", { venue: TW_ID, message });
const round = (v: number, places: number): number => Math.round(v * 10 ** places) / 10 ** places;

/** a row on its way to the page */
interface TwRow { code: string; name: string; price: number | null; changePct: number | null; turnover: number | null; from: string }
type RankAnswer = { items: ExploreItem[]; read: LocalRead };

const rowOf = (r: TwRow): ExploreItem =>
  shareRow({ venue: "tw", venueName: TW_NAME, code: r.code, name: r.name, currency: "TWD", price: r.price, changePct: r.changePct, turnover: r.turnover, quoteFrom: r.from });

/** the day table's row as it closed */
function closeRow(r: DayRow): TwRow {
  const prev = r.close !== null && r.change !== null && r.close - r.change > 0 ? r.close - r.change : null;
  return { code: r.code, name: r.name, price: r.close, changePct: prev !== null ? round((r.change! / prev) * 100, 2) : null, turnover: r.tradeValue, from: FROM_CLOSE };
}
/** MIS's price, move and turnover (price x shares so far), or no price where nothing has traded */
function misRow(day: DayRow, q: MisQuote | undefined): TwRow {
  const price = q?.price ?? null;
  const prev = q?.prevClose ?? null;
  return { code: day.code, name: day.name, price, changePct: price !== null && prev !== null ? round((price / prev - 1) * 100, 2) : null,
    turnover: price !== null && q?.lots != null ? round(price * q.lots * 1000, 0) : null, from: FROM_MIS };
}

/** the first moment after `nowMs` that a session ends (the close, 13:30 Taipei on a weekday) */
function nextCloseMs(nowMs: number): number {
  const start = Math.floor(nowMs / QUARTER_MS) * QUARTER_MS;
  for (let t = start + QUARTER_MS; t <= start + 9 * 86_400_000; t += QUARTER_MS) {
    if (localSession(SESSIONS.tw, t).phase === "closed" && localSession(SESSIONS.tw, t - QUARTER_MS).phase === "trading") return t;
  }
  return start + 86_400_000;
}

/** `YYYYMM` of the Taipei month `back` months before the one `nowMs` is in */
function monthOf(nowMs: number, back: number): string {
  const d = new Date(nowMs + TAIPEI_MS);
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1));
  return `${m.getUTCFullYear()}${String(m.getUTCMonth() + 1).padStart(2, "0")}`;
}
/** whole calendar months back for the ranges the source reads */
const MONTHS: Partial<Record<CandleRange, number>> = { "1M": 1, "3M": 3, "6M": 6, "1Y": 12 };

export function taiwanSource(deps: { http?: CnHttp; clock?: () => number } = {}): LocalSource {
  const now = deps.clock ?? Date.now;
  const http = politeHosts(deps.http ?? realCnHttp, TWSE_HOSTS, deps.clock ? { clock: deps.clock } : {});
  let status: LocalStatus = { state: "unavailable", said: "TWSE · not read yet" };

  async function get(url: string, timeoutMs: number, maxBytes: number): Promise<string> {
    const reply = await retryOnce(() => http(url, { timeoutMs, maxBytes }));
    if (reply.status !== 200) throw new Error("http");
    return new TextDecoder("utf-8").decode(reply.bytes);
  }
  const keeper = <T>(ttl: (key: string) => number) => cnKeeper<T>(now, ttl);

  // ---- the day table: one read per close ------------------------------------------------------------------------------------------
  let table: { until: number; day: DayTable } | null = null;
  let tableFlight: Promise<DayTable> | null = null;

  /** the table, kept until the next session's close (a table older than the last session is read again soon); a failure throws */
  async function dayTable(): Promise<DayTable> {
    if (table && now() < table.until) return table.day;
    tableFlight ??= (async () => {
      const at = now();
      const day = parseDayAll(await get(twDayAllUrl(), QUOTE_TIMEOUT_MS, TW_BODY_LIMIT));
      if (!day) throw new Error("invalid day table");
      const s = localSession(SESSIONS.tw, at);
      table = { day, until: s.phase !== "trading" && s.lastSession !== null && day.date < s.lastSession ? at + DAY_RETRY_MS : nextCloseMs(at) };
      return day;
    })().finally(() => { tableFlight = null; });
    return tableFlight;
  }
  /** the table for a read that can do without a fresh one: the kept table, whatever its age, when TWSE does not answer */
  async function dayOrOld(): Promise<DayTable | null> {
    try { return await dayTable(); } catch { return table?.day ?? null; }
  }
  /** the shares of the table (no exchange-traded products), busiest first */
  const universeOf = (day: DayTable): DayRow[] =>
    day.rows.filter((r) => !r.code.startsWith("00")).sort((a, b) => (b.tradeValue ?? -1) - (a.tradeValue ?? -1));

  // ---- the ranking ------------------------------------------------------------------------------------------------------------------
  /** the one ranking read both sorts are made from: movers is the same rows re-sorted, so the host sees one read */
  type Base = { rows: TwRow[]; live: boolean; asOf: string; session: CnSession; status: LocalStatus };
  let last: { at: number; base: Base } | null = null;
  let kept: { until: number; base: Base } | null = null;
  let flight: Promise<Base | Refusal> | null = null;

  /** MIS's quotes for the codes, `MIS_BATCH` to an ask, one after another; any ask failing fails the read */
  async function misQuotes(codes: string[]): Promise<Map<string, MisQuote>> {
    const all = new Map<string, MisQuote>();
    for (let i = 0; i < codes.length; i += MIS_BATCH) {
      const got = parseMis(await get(twMisUrl(codes.slice(i, i + MIS_BATCH)), QUOTE_TIMEOUT_MS, QUOTE_RESPONSE_LIMIT));
      if (!got) throw new Error("invalid quotes");
      for (const [c, q] of got) all.set(c, q);
    }
    return all;
  }

  async function readRank(): Promise<Base | Refusal> {
    const startedAt = now();
    let got: { rows: TwRow[]; live: boolean; lastTrade: string } | null = null;
    try {
      const day = await dayTable();
      const universe = universeOf(day).slice(0, TW_UNIVERSE);
      if (!universe.length) throw new Error("empty ranking");
      if (localSession(SESSIONS.tw, startedAt).phase === "trading") {
        const quotes = await misQuotes(universe.map((r) => r.code));
        const lastTrade = [...quotes.values()].find((q) => q.date !== null)?.date ?? day.date;
        got = { rows: universe.map((r) => misRow(r, quotes.get(r.code))), live: true, lastTrade };
      } else {
        got = { rows: universe.map(closeRow), live: false, lastTrade: day.date };
      }
    } catch { got = null; }
    if (got) {
      const asOf = new Date(now()).toISOString();
      status = { state: "live", said: LIVE_SAID, at: asOf };
      const session = localSession(SESSIONS.tw, startedAt, got.lastTrade);
      const base: Base = { rows: got.rows, live: got.live, asOf, status, session };
      last = { at: now(), base };
      // a ranking priced in session is kept 30 s (five minutes when the day proves a holiday); one made from the table, until the next open
      // (five minutes while the table is still the one before the last session's, which is on a holiday too)
      const clockSession = localSession(SESSIONS.tw, now());
      const ttl = got.live ? (session.phase === "trading" ? RANK_LIVE_MS : DAY_RETRY_MS)
        : table && clockSession.lastSession !== null && table.day.date < clockSession.lastSession ? DAY_RETRY_MS : rankTtlMs(SESSIONS.tw, now(), RANK_LIVE_MS);
      kept = { until: now() + ttl, base };
      return base;
    }
    const old = last && now() - last.at < STALE_KEEP_MS ? last : null;
    if (old) {
      status = { state: "stale", said: `TWSE did not answer · Taiwan as of ${hhmm.format(new Date(old.at))} CST`, at: old.base.asOf };
      return { ...old.base, status };
    }
    status = { state: "unavailable", said: UNAVAILABLE_SAID };
    return unavailable();
  }
  const answerOf = (base: Base, sort: LocalSort): RankAnswer => {
    const size = (r: TwRow): number => (r.changePct === null ? -1 : Math.abs(r.changePct));
    const byTurnover = (a: TwRow, b: TwRow): number => (b.turnover ?? -1) - (a.turnover ?? -1);
    // volume: today's turnover in session (the table is already in trade-value order outside it); movers: the size of the move, ties in turnover order
    const ordered = base.live ? [...base.rows].sort(byTurnover) : base.rows;
    const rows = sort === "movers" ? [...ordered].sort((a, b) => size(b) - size(a)) : ordered;
    const note = base.live ? (sort === "movers" ? NOTE_LIVE_MOVE : NOTE_LIVE_TURNOVER) : sort === "movers" ? NOTE_CLOSE_MOVE : NOTE_CLOSE;
    return { items: rows.map(rowOf),
      read: { venue: "tw", region: "tw", sort, total: base.rows.length, asOf: base.asOf, session: base.session, status: base.status, note } };
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

  async function readQuotes(codes: string[]): Promise<Map<string, LocalMarket> | Refusal> {
    try {
      const parsed = parseMis(await get(twMisUrl(codes), QUOTE_TIMEOUT_MS, QUOTE_RESPONSE_LIMIT));
      if (!parsed) throw new Error("invalid quotes");
      const at = now();
      status = { state: "live", said: LIVE_SAID, at: new Date(at).toISOString() };
      const markets = new Map<string, LocalMarket>();
      for (const [code, q] of parsed) {
        const session = localSession(SESSIONS.tw, at, q.date);
        const changed = q.price !== null && q.prevClose !== null;
        const shares = q.lots !== null ? q.lots * 1000 : null;
        markets.set(code, {
          symbol: code, name: q.name ?? code, kind: "stock", base: code, quote: "TWD", currency: "TWD", open: false, types: [],
          ...(q.price !== null ? { price: q.price } : {}),
          ...(q.asOf !== null ? { quoteAt: q.asOf } : {}),
          quoteFrom: FROM_MIS,
          ...(changed ? { change24h: round(q.price! - q.prevClose!, 4), changePct24h: round((q.price! / q.prevClose! - 1) * 100, 2) } : {}),
          session: { open: session.phase === "trading" },
          local: { prevClose: q.prevClose, open: q.open, high: q.high, low: q.low, volume: shares,
            turnover: q.price !== null && shares !== null ? round(q.price * shares, 0) : null,
            lastSession: session.lastSession, phase: session.phase, quoteStatus: "live" },
        });
      }
      return markets;
    } catch {
      status = { state: "unavailable", said: UNAVAILABLE_SAID };
      return unavailable();
    }
  }
  async function quotes(asked: readonly string[]): Promise<Map<string, LocalMarket> | Refusal> {
    const codes = [...new Set(asked.flatMap((s) => { const c = twCode(s); return c ? [c] : []; }))];
    if (codes.length > SEARCH_RESULTS) return badAction(`at most ${SEARCH_RESULTS} Taiwan shares are quoted at once`);
    if (!codes.length) return new Map();
    const got = await quoteKeeper.ask([...codes].sort().join(","), () => readQuotes(codes), isMarkets);
    if (!isMarkets(got)) return got;
    return new Map(codes.flatMap((c) => (got.has(c) ? [[c, got.get(c)!] as const] : [])));
  }

  // ---- history ---------------------------------------------------------------------------------------------------------------------
  type Bars = NonNullable<ReturnType<typeof parseStockDay>>;
  /** a month is kept for the life of the process once it is past, ten minutes while it is the current one (the key says which, as it was asked) */
  const months = keeper<Bars>((key) => (key.endsWith("|now") ? MONTH_NOW_TTL_MS : Number.POSITIVE_INFINITY));
  const isBars = (v: Bars | Refusal): v is Bars => Array.isArray(v);

  async function history(symbol: string, range: CandleRange): Promise<LocalHistory | Refusal> {
    const code = twCode(symbol);
    if (!code) return badAction("a Taiwan share is its code, four to six digits or letters");
    if (range === "1D" || range === "5D") return badAction("Taiwan's intraday chart is not read here");
    if (range === "5Y" || range === "MAX") return badAction("Taiwan's history is read up to one year");
    if (range !== "YTD" && !Object.hasOwn(MONTHS, range)) return badAction("no such Taiwan chart range");
    const at = now();
    const today = new Date(at + TAIPEI_MS);
    const back = range === "YTD" ? today.getUTCMonth() : MONTHS[range]!;
    const bars = new Map<number, Bars[number]>();
    // the months, newest first, one ask each and one after another; a month failing fails the read
    for (let i = 0; i <= back; i++) {
      const url = twStockDayUrl(code, monthOf(at, i));
      const got = await months.ask(`${url}|${i === 0 ? "now" : "past"}`, async () => {
        try { return parseStockDay(await get(url, QUOTE_TIMEOUT_MS, HISTORY_BODY_LIMIT)) ?? unavailable(); } catch { return unavailable(); }
      }, isBars);
      if (!isBars(got)) return got;
      for (const b of got) bars.set(b.t, b);
    }
    const from = range === "YTD" ? Date.UTC(today.getUTCFullYear(), 0, 1) - TAIPEI_MS
      : Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - back, today.getUTCDate()) - TAIPEI_MS;
    const candles = [...bars.values()].filter((b) => b.t >= from).sort((a, b) => a.t - b.t);
    if (!candles.length) return badAction("TWSE has no daily bars for that code");
    return { venue: "tw", venueName: TW_NAME, symbol: code, range, candles, source: TW_NAME };
  }

  // ---- search ----------------------------------------------------------------------------------------------------------------------
  /** within the day table (no network ask of its own, though the table is read if it is not kept): a code's start or a name's part */
  async function search(q: string): Promise<ExploreItem[] | Refusal> {
    const query = q.trim();
    if (!query) return [];
    const day = await dayOrOld();
    if (!day) return no("E_VENUE_UNREACHABLE", { venue: TW_ID, message: "TWSE's day table did not answer" });
    const code = query.toUpperCase(), name = query.toLocaleLowerCase("en-US");
    const shares = universeOf(day);
    const byCode = shares.filter((r) => r.code.startsWith(code));
    const byName = shares.filter((r) => !r.code.startsWith(code) && r.name.toLocaleLowerCase("en-US").includes(name));
    return [...byCode, ...byName].slice(0, SEARCH_RESULTS).map((r) => rowOf(closeRow(r)));
  }

  return { venue: "tw", name: TW_NAME, rank, search, quotes, history, status: () => status };
}
