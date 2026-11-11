// face/plugins/analog/lib/episodes.mjs
/**
 * A stock's past sell-offs that resemble the query, what came after each, the market around each, each one's window
 * of bars, and the cases a reader is shown first. Pure functions over daily bars, oldest first: no clock, no I/O.
 *
 * A sell-off is one episode: in-band days no more than 15 sessions apart are one episode, and its day 0 is its day
 * nearest the query. Calendar-day distances between two `YYYY-MM-DD` dates are whole days, the limit included.
 */
import { LOOKBACK, distance, featuresAt, inBand } from "./selloff.mjs";

/**
 * @typedef {import("./selloff.mjs").Bar} Bar
 * @typedef {import("./selloff.mjs").Features} Features
 * @typedef {import("./selloff.mjs").Bands} Bands
 * @typedef {{ id: string, symbol: string, i: number, date: string, peakDate: string, distance: number,
 *   depth: number, days: number, last5: number, gap: number, volume: number | null, fromHigh: boolean | null }} Episode
 * @typedef {{ r5: number | null, r20: number | null, r60: number | null, low60: number | null,
 *   lowAt: number | null, high60: number | null, sessionsAfter: number }} After
 */

/** An in-band day this many sessions or fewer after the previous one joins its episode. */
export const EPISODE_GAP = 15;
/** A case's window: this many sessions before day 0 and this many after. */
export const PRE = 30;
export const POST = 60;
/** A case with fewer sessions than this after day 0 is still under way. */
export const UNDER_WAY = 20;
/** Other companies' cases within this many calendar days are the same week. */
export const WEEK_DAYS = 7;
/** Other companies' cases within this many calendar days of an event's leading case are one market event. */
export const EVENT_DAYS = 10;
/** The market's change from the high to day 0 at or below this is a falling market. */
export const CONTEXT_CUT = -0.07;

const DAY_MS = 86_400_000;

/**
 * The `YYYY-MM-DD` date of a bar's `t` in UTC.
 * @param {number} t
 * @returns {string}
 */
export function dateOf(t) {
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * The whole calendar day number of a `YYYY-MM-DD` date (days since 1970-01-01), `NaN` for a date that does not parse.
 * @param {string} date
 * @returns {number}
 */
function dayNumber(date) {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
}

/**
 * The episodes of one stock whose days fall in the query's bands, in date order, and how many days had numbers.
 * `skipLast` leaves out the stock's last sessions (the query's own stock leaves out its own sell-off).
 * @param {string} symbol @param {Bar[]} bars @param {Features} q @param {Bands} bands
 * @param {{ skipLast?: number }} [options]
 * @returns {{ episodes: Episode[], days: number }}
 */
export function episodesOf(symbol, bars, q, bands, options = {}) {
  const last = bars.length - 1 - (options.skipLast ?? 0);
  /** @type {Episode[]} */
  const episodes = [];
  let previousIn = -Infinity;
  let days = 0;
  for (let i = LOOKBACK; i <= last; i++) {
    const f = featuresAt(bars, i);
    if (f === null) continue;
    days++;
    if (!inBand(f, bands)) continue;
    const d = distance(f, q, bands);
    const fresh = i - previousIn > EPISODE_GAP;
    previousIn = i;
    if (!fresh && d >= episodes[episodes.length - 1].distance) continue;
    const date = dateOf(bars[i].t);
    /** @type {Episode} */
    const day0 = {
      id: `${symbol}:${date}`, symbol, i, date, peakDate: dateOf(bars[f.peakAt].t), distance: d,
      depth: f.depth, days: f.days, last5: f.last5, gap: f.gap, volume: f.volume, fromHigh: f.fromHigh,
    };
    if (fresh) episodes.push(day0);
    else episodes[episodes.length - 1] = day0;
  }
  return { episodes, days };
}

/**
 * What came after day `i`: the closes 5, 20 and 60 sessions on over day 0's close, minus one; the lowest low and the
 * highest high of the next 60 sessions (or as many as there are) on the same footing, and the session of that low
 * (the earliest on ties); every field null when no session follows.
 * @param {Bar[]} bars @param {number} i
 * @returns {After}
 */
export function aftermathOf(bars, i) {
  const last = bars.length - 1;
  const base = bars[i].c;
  /** @param {number} k */
  const ret = (k) => (i + k <= last ? bars[i + k].c / base - 1 : null);
  const sessionsAfter = last - i;
  if (sessionsAfter <= 0) {
    return { r5: null, r20: null, r60: null, low60: null, lowAt: null, high60: null, sessionsAfter: 0 };
  }
  let low = Infinity;
  let lowAt = 0;
  let high = -Infinity;
  for (let k = i + 1; k <= Math.min(i + POST, last); k++) {
    if (bars[k].l < low) { low = bars[k].l; lowAt = k - i; }
    if (bars[k].h > high) high = bars[k].h;
  }
  return {
    r5: ret(5), r20: ret(20), r60: ret(60), low60: low / base - 1, lowAt, high60: high / base - 1, sessionsAfter,
  };
}

/**
 * Each market series' bars by date (the first bar of a date), built on the first call that sees the series.
 * @type {WeakMap<Bar[], Map<string, Bar>>}
 */
const marketIndex = new WeakMap();

/**
 * The bars of a market series by date, built once per series.
 * @param {Bar[]} marketBars
 * @returns {Map<string, Bar>}
 */
function byDate(marketBars) {
  let index = marketIndex.get(marketBars);
  if (index === undefined) {
    index = new Map();
    for (const b of marketBars) {
      const date = dateOf(b.t);
      if (!index.has(date)) index.set(date, b);
    }
    marketIndex.set(marketBars, index);
  }
  return index;
}

/**
 * The market's change from a case's high to its day 0, rounded to six decimals, and its group: `down` at or below
 * −7%, `calm` above it, `unknown` when there are no market bars, either date is not one of them, or the change is not
 * a finite number (a close of 0 or missing).
 * @param {Bar[] | null} marketBars @param {string} peakDate @param {string} date
 * @returns {{ change: number | null, group: "calm" | "down" | "unknown" }}
 */
export function contextOf(marketBars, peakDate, date) {
  if (marketBars === null) return { change: null, group: "unknown" };
  const index = byDate(marketBars);
  const from = index.get(peakDate);
  const to = index.get(date);
  if (from === undefined || to === undefined) return { change: null, group: "unknown" };
  const raw = to.c / from.c - 1;
  if (!Number.isFinite(raw)) return { change: null, group: "unknown" };
  const change = Math.round(raw * 1e6) / 1e6 || 0;
  return { change, group: change <= CONTEXT_CUT ? "down" : "calm" };
}

/**
 * The bars from 30 sessions before day `i` to 60 after, as many as there are, each `[k, o, h, l, c, v]`: `k` the
 * session relative to day 0, prices a percentage of day 0's close to two decimals, `v` as it is (0 when missing).
 * @param {Bar[]} bars @param {number} i
 * @returns {Array<[number, number, number, number, number, number]>}
 */
export function windowOf(bars, i) {
  const base = bars[i].c;
  /** @param {number} p */
  const pct = (p) => Math.round((p / base) * 10_000) / 100;
  /** @type {Array<[number, number, number, number, number, number]>} */
  const out = [];
  for (let k = Math.max(0, i - PRE); k <= Math.min(bars.length - 1, i + POST); k++) {
    const b = bars[k];
    out.push([k - i, pct(b.o), pct(b.h), pct(b.l), pct(b.c), b.v ?? 0]);
  }
  return out;
}

/**
 * Sets `sameWeek` on each case: how many cases of another company fall within 7 calendar days of it. The cases are
 * swept once in date order with a window of 7 days either side; a case's count is the window's cases less those of
 * its own company (itself among them). A case whose date does not parse counts none and is counted by none.
 * @param {Array<{ symbol: string, date: string, sameWeek?: number }>} cases
 * @returns {void}
 */
export function withClusters(cases) {
  const days = cases.map((c) => dayNumber(c.date));
  const order = [];
  for (let k = 0; k < cases.length; k++) {
    if (Number.isFinite(days[k])) order.push(k);
    else cases[k].sameWeek = 0;
  }
  order.sort((a, b) => days[a] - days[b]);
  /** @type {Map<string, number>} */
  const inWindow = new Map();
  /** @param {number} k @param {number} by */
  const move = (k, by) => inWindow.set(cases[k].symbol, (inWindow.get(cases[k].symbol) ?? 0) + by);
  let lo = 0;
  let hi = 0;
  for (const k of order) {
    while (hi < order.length && days[order[hi]] <= days[k] + WEEK_DAYS) move(order[hi++], 1);
    while (days[order[lo]] < days[k] - WEEK_DAYS) move(order[lo++], -1);
    cases[k].sameWeek = hi - lo - (inWindow.get(cases[k].symbol) ?? 0);
  }
}

/**
 * The cases shown first: the stock's own nearest `own` (default 4), and the nearest `others` (default 8) market
 * events of other companies. Other companies' cases, nearest first, each join the first event whose leading case is
 * within 10 calendar days of it (that event `standsFor` one more case) or lead a new one. Ties in distance go to the
 * smaller id.
 * @param {Array<{ id: string, symbol: string, date: string, distance: number }>} cases
 * @param {string} symbol
 * @param {{ own?: number, others?: number }} [limits]
 * @returns {{ own: string[], others: Array<{ id: string, standsFor: number }> }}
 */
export function leadingCases(cases, symbol, limits = {}) {
  const nearest = [...cases].sort((a, b) => a.distance - b.distance || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const own = nearest.filter((c) => c.symbol === symbol).slice(0, limits.own ?? 4).map((c) => c.id);
  /** @type {Array<{ id: string, standsFor: number }>} */
  const events = [];
  // The first event led on each day number: the first event within 10 days of a case is the earliest of those led on
  // the 21 days around it.
  /** @type {Map<number, number>} */
  const firstLedOn = new Map();
  for (const c of nearest) {
    if (c.symbol === symbol) continue;
    const day = dayNumber(c.date);
    let first = Infinity;
    if (Number.isFinite(day)) {
      for (let d = day - EVENT_DAYS; d <= day + EVENT_DAYS; d++) first = Math.min(first, firstLedOn.get(d) ?? Infinity);
    }
    if (first !== Infinity) { events[first].standsFor++; continue; }
    if (Number.isFinite(day) && !firstLedOn.has(day)) firstLedOn.set(day, events.length);
    events.push({ id: c.id, standsFor: 1 });
  }
  return { own, others: events.slice(0, limits.others ?? 8).map(({ id, standsFor }) => ({ id, standsFor })) };
}
