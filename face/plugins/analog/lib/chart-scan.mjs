// face/plugins/analog/lib/chart-scan.mjs
/**
 * The chart scan: the query's sell-off measured on its latest bar (or on `asOf`), every company of the list searched
 * for past sell-offs inside the query's bands, and the view that holds what was found and what could not be read.
 *
 * The query's history and the market's (`SPY`) are read first and fresh; the query refused, too short, not a sell-off
 * or a fall inside its own latest session is a refusal, and nothing else is read. The rest of the list is read through
 * the keep under the scan's deadline, and whatever was not read is counted, never silently left out. With `asOf`,
 * every history, the market's included, keeps only its bars dated on or before it, so no number reads a later bar.
 * `query.sessionOpen` says whether day 0 is the bar of a session still open, `asOf` or not.
 *
 * `SPY` is the market's context and never one of the other companies scanned; asked about itself, it is the query's
 * own stock, scanned like any query's and measured against its own history for context.
 */
import { MIN_BARS, LOOKBACK, SCALE, SELLOFF_DEPTH, bandsFor, featuresAt } from "./selloff.mjs";
import {
  CONTEXT_CUT, UNDER_WAY, aftermathOf, contextOf, dateOf, episodesOf, leadingCases, windowOf, withClusters,
} from "./episodes.mjs";
import { MIN_GROUP, summarize } from "./summary.mjs";
import { UNIVERSE } from "./universe.mjs";
import { refuse } from "./errors.mjs";

/**
 * @typedef {import("./selloff.mjs").Bar} Bar
 * @typedef {import("./selloff.mjs").Bands} Bands
 * @typedef {import("./episodes.mjs").After} After
 * @typedef {import("./summary.mjs").Summary} Summary
 * @typedef {import("./bars.mjs").BarsKeep} BarsKeep
 * @typedef {Array<[number, number, number, number, number, number]>} Path
 * @typedef {{ change: number | null, group: "calm" | "down" | "unknown" }} Context
 * @typedef {{ id: string, symbol: string, date: string, peakDate: string, distance: number, depth: number,
 *   days: number, last5: number, gap: number, volume: number | null, fromHigh: boolean | null, market: Context,
 *   sameWeek: number, state: "past" | "underWay", after: After, window: Path | null }} Case
 * @typedef {{ kind: "chart", version: 1, at: string,
 *   query: { symbol: string, date: string, readDate: string, asOf: string | null, sessionOpen: boolean, close: number,
 *     peak: number, peakDate: string, depth: number, days: number, last5: number, gap: number, gapDate: string,
 *     volume: number | null, fromHigh: boolean | null, market: Context, path: Path },
 *   parameters: { lookback: number, bands: Bands, dropped: string[], scale: typeof SCALE, contextCut: number,
 *     minGroup: number },
 *   coverage: { asked: number, read: number, sources: Record<string, number>,
 *     short: Array<{ symbol: string, source: string, firstBar: string }>,
 *     refused: Array<{ symbol: string, words: string }>, stockDays: number, episodes: number, underWay: number,
 *     short60: number, noContext: number, weeks: number, deadline: boolean },
 *   groups: { all: Summary, own: Summary, calm: Summary, down: Summary },
 *   queryGroup: "calm" | "down" | "unknown",
 *   leading: { own: string[], others: Array<{ id: string, standsFor: number }> },
 *   cases: Case[], windowsDropped: number }} ChartView
 */

/** How long a scan reads the list before it answers with what it has. */
export const SCAN_DEADLINE_MS = 480_000;
/** The most tickers `also` adds. */
const ALSO_MAX = 20;
/** The query's own last sessions are its sell-off, never a candidate. */
const OWN_SKIP = 15;
/** The market's own symbol: read for context, never scanned as another company. */
const MARKET_SYMBOL = "SPY";
const SYMBOL = /^[A-Z][A-Z0-9.]{0,9}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DEADLINE_WORDS = "not read before the deadline";
const NEW_YORK = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

/**
 * A ticker as people type it, trimmed and upper-cased; anything that is not a ticker is `BAD_SYMBOL`.
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeSymbol(raw) {
  if (typeof raw !== "string") throw refuse.badSymbol();
  const symbol = raw.trim().toUpperCase();
  if (!SYMBOL.test(symbol)) throw refuse.badSymbol();
  return symbol;
}

/**
 * `asOf` as given when it is a real `YYYY-MM-DD` date, null when left out; anything else `BAD_AS_OF`.
 * @param {unknown} raw
 * @returns {string | null}
 */
function normalizeAsOf(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string" || !DATE.test(raw)) throw refuse.badAsOf();
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) throw refuse.badAsOf();
  return raw;
}

/**
 * `also` normalized: at most 20 tickers; anything else `BAD_ALSO`.
 * @param {unknown} raw
 * @returns {string[]}
 */
function normalizeAlso(raw) {
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > ALSO_MAX) throw refuse.badAlso();
  try {
    return raw.map(normalizeSymbol);
  } catch {
    throw refuse.badAlso();
  }
}

/**
 * The Monday of a `YYYY-MM-DD` date's ISO week: one key per ISO week.
 * @param {string} date
 */
function weekOf(date) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/**
 * The scan of one query.
 * @param {{ symbol: string, asOf?: string | null, also?: string[], universe?: readonly string[], keep: BarsKeep,
 *   now?: () => Date, deadlineMs?: number }} args
 * @returns {Promise<ChartView>}
 */
export async function scanChart({ symbol: rawSymbol, asOf: rawAsOf, also: rawAlso, universe = UNIVERSE, keep, now = () => new Date(), deadlineMs = SCAN_DEADLINE_MS }) {
  const began = Date.now();
  const symbol = normalizeSymbol(rawSymbol);
  const asOf = normalizeAsOf(rawAsOf);
  const also = normalizeAlso(rawAlso);
  const list = [...new Set([symbol, ...[...universe, ...also].filter((s) => s !== MARKET_SYMBOL)])];
  /** @param {Bar[]} bars */
  const cut = (bars) => (asOf === null ? bars : bars.filter((b) => dateOf(b.t) <= asOf));

  const first = await keep.histories([symbol, MARKET_SYMBOL], { fresh: [symbol, MARKET_SYMBOL] });
  const history = first.read.get(symbol);
  if (history === undefined) {
    const words = first.refused.get(symbol);
    if (first.down && words !== undefined) throw refuse.marketUnreachable(words);
    throw refuse.noHistory(symbol, words ?? "the market answered nothing for it");
  }
  const queryBars = cut(history.bars);
  if (queryBars.length < MIN_BARS) throw refuse.noHistory(symbol);
  const day0 = queryBars.length - 1;
  const q = /** @type {import("./selloff.mjs").Features} */ (featuresAt(queryBars, day0));
  const date = dateOf(queryBars[day0].t);
  const peakDate = dateOf(queryBars[q.peakAt].t);
  if (q.depth > SELLOFF_DEPTH) throw refuse.notASelloff(symbol, q.depth, peakDate);
  if (q.days === 0) throw refuse.highIsLatest(symbol, date);
  const bands = bandsFor(q);
  const spy = first.read.get(MARKET_SYMBOL);
  const marketBars = spy === undefined ? null : cut(spy.bars);

  const rest = list.filter((s) => s !== symbol);
  const others = rest.length === 0
    ? { read: new Map(), refused: new Map(), timedOut: [], down: false }
    : await keep.histories(rest, { deadlineMs: deadlineMs - (Date.now() - began) });
  const timedOut = new Set(others.timedOut);

  /** @type {Record<string, number>} */
  const sources = {};
  /** @type {ChartView["coverage"]["short"]} */
  const short = [];
  /** @type {ChartView["coverage"]["refused"]} */
  const refused = [];
  /** @type {Case[]} */
  const cases = [];
  let read = 0;
  let stockDays = 0;
  for (const s of list) {
    const h = s === symbol ? history : others.read.get(s);
    if (h === undefined) {
      refused.push({ symbol: s, words: timedOut.has(s) ? DEADLINE_WORDS : others.refused.get(s) ?? DEADLINE_WORDS });
      continue;
    }
    read++;
    const name = h.source.split(" · ")[0];
    sources[name] = (sources[name] ?? 0) + 1;
    if (h.short) short.push({ symbol: s, source: h.source, firstBar: h.firstBar });
    const bars = s === symbol ? queryBars : cut(h.bars);
    const found = episodesOf(s, bars, q, bands, { skipLast: s === symbol ? OWN_SKIP : 0 });
    stockDays += found.days;
    for (const e of found.episodes) {
      const after = aftermathOf(bars, e.i);
      cases.push({
        id: e.id, symbol: e.symbol, date: e.date, peakDate: e.peakDate, distance: e.distance, depth: e.depth,
        days: e.days, last5: e.last5, gap: e.gap, volume: e.volume, fromHigh: e.fromHigh,
        market: contextOf(marketBars, e.peakDate, e.date), sameWeek: 0,
        state: after.sessionsAfter < UNDER_WAY ? "underWay" : "past", after, window: windowOf(bars, e.i),
      });
    }
  }
  withClusters(cases);
  cases.sort((a, b) => a.distance - b.distance || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const past = cases.filter((c) => c.state === "past");
  const market = contextOf(marketBars, peakDate, date);

  return {
    kind: "chart",
    version: 1,
    at: now().toISOString(),
    query: {
      symbol, date, readDate: NEW_YORK.format(now()), asOf,
      sessionOpen: history.sessionOpen && day0 === history.bars.length - 1,
      close: queryBars[day0].c, peak: queryBars[q.peakAt].h, peakDate, depth: q.depth, days: q.days,
      last5: q.last5, gap: q.gap, gapDate: dateOf(queryBars[q.gapAt].t), volume: q.volume, fromHigh: q.fromHigh,
      market, path: windowOf(queryBars, day0),
    },
    parameters: { lookback: LOOKBACK, bands, dropped: bands.dropped, scale: SCALE, contextCut: CONTEXT_CUT, minGroup: MIN_GROUP },
    coverage: {
      asked: list.length, read, sources, short, refused, stockDays, episodes: cases.length,
      underWay: cases.length - past.length, short60: past.filter((c) => c.after.r60 === null).length,
      noContext: cases.filter((c) => c.market.group === "unknown").length,
      weeks: new Set(past.map((c) => weekOf(c.date))).size, deadline: timedOut.size > 0,
    },
    groups: {
      all: summarize(cases),
      own: summarize(cases.filter((c) => c.symbol === symbol)),
      calm: summarize(cases.filter((c) => c.market.group === "calm")),
      down: summarize(cases.filter((c) => c.market.group === "down")),
    },
    queryGroup: market.group,
    leading: leadingCases(past, symbol),
    cases,
    windowsDropped: 0,
  };
}
