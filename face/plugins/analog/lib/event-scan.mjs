// face/plugins/analog/lib/event-scan.mjs
/**
 * The event scan: a researched list of past events checked field by field, every company's daily history read through
 * the keep, each event measured from the call's base at its horizons against its benchmark, and the view (version 2)
 * that holds what was measured, what could not be, and why.
 *
 * The input is refused at its first bad field, named by its path. Each text (the title, a label, a group, a note) is
 * put on one line before it is measured, every run of whitespace and control characters one space, so a text from a
 * page cannot start a line of the digest; a source URL that carries a username or a password is refused. Every history
 * is read in one call to the keep under the scan's deadline; the market's (`SPY`) is always read fresh, and so are the
 * benchmark and the present case's company (`query`) when there is one, so a new session drops what the keep held; the
 * past events' companies may come from the keep. A market that does not answer with nothing read is a refusal; a
 * company the market refuses, one not read before the deadline, an event whose day 0 has not traded, one whose day 0
 * SPY's sessions do not confirm, a price that cannot be tied to the bars and a base that cannot be had are kept as
 * unmeasured cases with the words that say why, never left out. Without the benchmark's own bars (refused, or `none`)
 * the view is raw: every change against it is null, the summaries read the raw changes, and each path is the stock's
 * own. The view says where the present case's, the market's and the benchmark's bars came from, where they start and
 * whether they were read short, and how many of the companies' histories end on a bar built from the session's minutes.
 *
 * `verified` is the reader's claim checked by the face: an event marked verified whose source no reader opened is
 * stored unverified and flagged `unopened`; a split record whose page no reader opened is stored unverified and
 * flagged `splitsUnopened`, and still measured, the bars having confirmed its factor. The present case's anchors are
 * measured like the events, are in no group, and may carry a source, `verified` and a note, checked the same way; an
 * anchor's source may be left out.
 */
import {
  BASES, DEFAULT_HORIZONS, DEFAULT_HORIZONS_DAY0_CLOSE, ELSEWHERE, ELSEWHERE_OVER, HORIZONS_MAX, HORIZON_MAX,
  MIN_VOLUMES, NEIGHBOURS, QUIET, TIMINGS, VOLUME_BASE, baseOf, casePaths, dayZero, measureCase, tapeCheck,
} from "./events.mjs";
import { SPLITS_MAX, TIE_TOLERANCE, tiePrice } from "./price-tie.mjs";
import { CALENDAR_DAYS, checkDayZero } from "./sessions.mjs";
import { groupPaths, orderCases, summarizeEvents } from "./event-summary.mjs";
import { normalizeSymbol } from "./symbols.mjs";
import { MIN_GROUP } from "./stats.mjs";
import { POST, PRE, dateOf } from "./windows.mjs";
import { refuse } from "./errors.mjs";

/**
 * @typedef {import("./bars.mjs").Bar} Bar
 * @typedef {import("./events.mjs").When} When
 * @typedef {import("./events.mjs").Measure} Measure
 * @typedef {import("./events.mjs").Tape} Tape
 * @typedef {import("./event-summary.mjs").EventSummary} EventSummary
 * @typedef {import("./event-summary.mjs").Paths} Paths
 * @typedef {import("./windows.mjs").Path} Path
 * @typedef {import("./bars.mjs").BarsKeep} BarsKeep
 * @typedef {import("./bars.mjs").History} History
 * @typedef {import("./events.mjs").Base} Base
 * @typedef {import("./price-tie.mjs").Split} Split
 * @typedef {{ price: number | null, statedOpen: number | null, splits: Split[] | null, splitsSource: string | null }}
 *   PriceIn a case's stated price, the first-day open its source states and the splits after it, under `base: price`
 *   only; all null under any other base
 * @typedef {{ symbol: string, label: string, group: string, date: string, timing: When["timing"], source: string,
 *   verified: boolean, note: string | null } & PriceIn} EventIn
 * @typedef {{ label: string, date: string, timing: When["timing"], source: string | null, verified: boolean,
 *   note: string | null } & PriceIn} AnchorIn
 * @typedef {import("./event-summary.mjs").Against} Against
 * @typedef {{ list: Split[], factor: number, source: string, opened: boolean, verified: boolean }} SplitRecord the
 *   splits a case's price was divided by, their factor and the page that lists them, `verified` when a reader opened it
 * @typedef {{ state: "measured" | "unmeasured", words: string | null, day0: string | null, measure: Measure | null,
 *   tape: Tape | null, tapeRan: boolean, flags: string[], window: Path | null, rel: Array<[number, number]> | null,
 *   relOf: "benchmark" | "self" | null, factor: number | null, splits: SplitRecord | null, listed: boolean,
 *   skipped: number }} Measured `tapeRan` false when the tape check had too few volumes before day 0; `relOf` what
 *   `rel` is against (`self`: the stock's own path); `factor` the split factor a price was divided by, under `price`
 * @typedef {{ price: number | null, statedOpen: number | null }} PriceOut a case's stated price and first-day open,
 *   as given (null under any base but `price`)
 * @typedef {{ id: string, symbol: string, label: string, group: string, date: string, timing: string, source: string,
 *   note: string | null, claimed: boolean, opened: boolean, verified: boolean } & PriceOut & Measured} EventCase
 * @typedef {{ claimed: boolean, opened: boolean, verified: boolean }} Checked
 * @typedef {{ id: string, label: string, date: string, timing: string, source: string | null, note: string | null }
 *   & Checked & PriceOut & Measured} Anchor
 * @typedef {{ symbol: string | null, source: string | null, words: string | null, firstBar: string | null,
 *   short: boolean }} BenchmarkRead
 * @typedef {{ kind: "events", version: 2, at: string, title: string,
 *   query: null | { symbol: string, readDate: string, latest: string | null, today: string | null,
 *     sessionOpen: boolean, words: string | null, source: string | null, short: boolean, firstBar: string | null,
 *     anchors: Anchor[] },
 *   parameters: { base: Base, horizons: number[], benchmark: string | null, against: Against, volumeBase: number,
 *     minVolumes: number, quiet: number, elsewhere: number, elsewhereOver: number, neighbours: number,
 *     minGroup: number, pre: number, post: number, tieTolerance: number, calendarDays: number },
 *   coverage: { asked: number, measured: number, unmeasured: Array<{ id: string, symbol: string, words: string }>,
 *     verified: number, unverified: number, unopened: number, quiet: number, elsewhere: number, noContext: number,
 *     companies: { asked: number, read: number }, sources: Record<string, number>,
 *     short: Array<{ symbol: string, source: string, firstBar: string }>, adjustment: string[],
 *     market: { source: string | null, words: string | null, firstBar: string | null, short: boolean },
 *     benchmark: BenchmarkRead, skipped: number, listed: number,
 *     sessionBars: number, readFrom: string | null, deadline: boolean },
 *   groups: { all: EventSummary, named: Array<{ name: string, summary: EventSummary, paths: Paths | null }> },
 *   cases: EventCase[], windowsDropped: 0 }} EventsView `against` is `benchmark` when a benchmark was asked and its
 *   history read, else `raw`; `market` is SPY's read, `benchmark` the benchmark's; `noContext` counts the measured
 *   cases whose first change has no figure against the benchmark; `skipped` and `listed` count cases
 */

/** The most events one scan takes. */
export const EVENTS_MAX = 40;
/** The most groups the events fall in. */
export const GROUPS_MAX = 4;
/** The most anchors the present case has. */
export const ANCHORS_MAX = 3;
/** The longest each text field may be, in characters. */
export const LIMITS = { title: 120, label: 80, group: 24, note: 160, source: 500 };

/** The market's own symbol: the context every change is measured against. */
const MARKET_SYMBOL = "SPY";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** How long a scan reads the companies' histories before it answers with what it has. */
export const SCAN_DEADLINE_MS = 480_000;
const DEADLINE_WORDS = "not read before the deadline";
const NEW_YORK = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const EVENT_SHAPE = "an object with symbol, label, group, date, timing, source and verified";
const HORIZONS_WORDS = `1 to ${HORIZONS_MAX} whole numbers of sessions from 0 to ${HORIZON_MAX}, each larger than the one before`;
/** A case's price fields as the tool names them, in the order they are checked. */
const PRICE_FIELDS = ["price", "stated_open", "splits", "splits_source"];
/** @type {PriceIn} */
const NO_PRICE = { price: null, statedOpen: null, splits: null, splitsSource: null };
const ANCHOR_SHAPE = "an object with label, date and timing, and optionally source, verified and note";

/** @param {unknown} raw @returns {raw is Record<string, unknown>} */
const isObject = (raw) => typeof raw === "object" && raw !== null && !Array.isArray(raw);

/** Every run of whitespace and control characters (U+0000 to U+001F, U+007F, U+2028, U+2029). */
const BREAKS = /[\s\u0000-\u001f\u007f\u2028\u2029]+/gu;

/**
 * `text` on one line: every run of whitespace and control characters one space, then trimmed.
 * @param {string} text
 */
const oneLine = (text) => text.replace(BREAKS, " ").trim();

/**
 * A text of 1 to `max` characters on one line ({@link oneLine}), or the refusal of `field`.
 * @param {unknown} raw @param {string} field @param {number} max
 * @returns {string}
 */
function textOf(raw, field, max) {
  const text = typeof raw === "string" ? oneLine(raw) : "";
  if (text === "" || text.length > max) throw refuse.invalidEvents(field, `text of 1 to ${max} characters`);
  return text;
}

/**
 * A real `YYYY-MM-DD` date, or the refusal of `field`.
 * @param {unknown} raw @param {string} field
 * @returns {string}
 */
function dateIn(raw, field) {
  const date = typeof raw === "string" ? raw.trim() : "";
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!DATE.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw refuse.invalidEvents(field, "a date YYYY-MM-DD");
  }
  return date;
}

/**
 * One of the four timings, or the refusal of `field`.
 * @param {unknown} raw @param {string} field
 * @returns {When["timing"]}
 */
function timingIn(raw, field) {
  const timing = typeof raw === "string" ? raw.trim() : "";
  if (!TIMINGS.includes(timing)) throw refuse.invalidEvents(field, `one of ${TIMINGS.join(", ")}`);
  return /** @type {When["timing"]} */ (timing);
}

/**
 * A ticker, or the refusal of `field`.
 * @param {unknown} raw @param {string} field
 * @returns {string}
 */
function symbolIn(raw, field) {
  try {
    return normalizeSymbol(raw);
  } catch {
    throw refuse.invalidEvents(field, "a ticker like NVDA or BRK.B");
  }
}

/**
 * An `http:` or `https:` URL of at most 500 characters with no username or password, as written but trimmed, or the
 * refusal of `field`.
 * @param {unknown} raw @param {string} field
 * @returns {string}
 */
function sourceIn(raw, field) {
  const source = typeof raw === "string" ? raw.trim() : "";
  let ok = source.length <= LIMITS.source;
  if (ok) {
    try {
      const { protocol, username, password } = new URL(source);
      ok = (protocol === "http:" || protocol === "https:") && username === "" && password === "";
    } catch {
      ok = false;
    }
  }
  if (!ok) throw refuse.invalidEvents(field, `an http(s) URL without credentials, at most ${LIMITS.source} characters`);
  return source;
}

/**
 * An optional note on one line ({@link oneLine}) of at most `LIMITS.note` characters, null when left out or blank, or
 * the refusal of `field`.
 * @param {unknown} raw @param {string} field
 * @returns {string | null}
 */
function noteIn(raw, field) {
  if (raw === null || raw === undefined) return null;
  const note = typeof raw === "string" ? oneLine(raw) : null;
  if (note === null || note.length > LIMITS.note) throw refuse.invalidEvents(field, `text of at most ${LIMITS.note} characters, or left out`);
  return note === "" ? null : note;
}

/**
 * The reader's claim checked by the face: `verified` only when claimed and its source opened; a claim whose source no
 * reader opened adds `unopened` to a copy of `measured`'s flags.
 * @param {boolean} claimed @param {string | null} source @param {(url: string) => boolean} opened @param {Measured} measured
 * @returns {Checked & { flags: string[] }}
 */
function checkClaim(claimed, source, opened, measured) {
  const isOpened = source !== null && opened(source);
  const flags = claimed && !isOpened ? [...measured.flags, "unopened"] : measured.flags;
  return { claimed, opened: isOpened, verified: claimed && isOpened, flags };
}

/** @param {unknown} raw */
const given = (raw) => raw !== null && raw !== undefined;
/** @param {unknown} raw @returns {raw is number} */
const isPositive = (raw) => typeof raw === "number" && Number.isFinite(raw) && raw > 0;

/**
 * A positive finite number, or the refusal of `field`.
 * @param {unknown} raw @param {string} field
 * @returns {number}
 */
function positiveIn(raw, field) {
  if (!isPositive(raw)) throw refuse.invalidEvents(field, "a positive number");
  return raw;
}

/**
 * A case's split record: 1 to `SPLITS_MAX` splits, each a real date and `new` shares for `old`, both positive whole
 * numbers, kept in the order given; or the refusal of the first bad one.
 * @param {unknown} raw @param {string} field
 * @returns {Split[]}
 */
function splitsIn(raw, field) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > SPLITS_MAX) {
    throw refuse.invalidEvents(field, `a list of 1 to ${SPLITS_MAX} splits, each {date, new, old}`);
  }
  return raw.map((split, j) => {
    const at = `${field}[${j}]`;
    if (!isObject(split)) throw refuse.invalidEvents(at, "a split {date, new, old}");
    const date = dateIn(split.date, `${at}.date`);
    for (const key of ["new", "old"]) {
      const n = split[key];
      if (!Number.isSafeInteger(n) || /** @type {number} */ (n) <= 0) throw refuse.invalidEvents(`${at}.${key}`, "a whole number above 0");
    }
    return { date, new: /** @type {number} */ (split.new), old: /** @type {number} */ (split.old) };
  });
}

/**
 * A case's price fields: under any base but `price` each is refused when given and all are null; under `price` the
 * price is required, the stated open optional, and the splits and the page that lists them come together.
 * @param {Record<string, unknown>} raw @param {string} at @param {Base} base
 * @returns {PriceIn}
 */
function priceIn(raw, at, base) {
  if (base !== "price") {
    const stray = PRICE_FIELDS.find((key) => given(raw[key]));
    if (stray !== undefined) throw refuse.invalidEvents(`${at}.${stray}`, "only with base price");
    return { ...NO_PRICE };
  }
  if (!given(raw.price)) throw refuse.invalidEvents(`${at}.price`, "a positive price, as its source states it, under base price");
  const price = positiveIn(raw.price, `${at}.price`);
  const statedOpen = given(raw.stated_open) ? positiveIn(raw.stated_open, `${at}.stated_open`) : null;
  let splits = null;
  let splitsSource = null;
  if (given(raw.splits)) {
    splits = splitsIn(raw.splits, `${at}.splits`);
    if (!given(raw.splits_source)) {
      throw refuse.invalidEvents(`${at}.splits_source`, "the URL of the page that lists the splits, given with splits");
    }
    splitsSource = sourceIn(raw.splits_source, `${at}.splits_source`);
  } else if (given(raw.splits_source)) {
    throw refuse.invalidEvents(`${at}.splits`, "given with splits_source");
  }
  return { price, statedOpen, splits, splitsSource };
}

/**
 * One event, checked in the order symbol, label, group, date, timing, source, verified, note, then its price's fields
 * ({@link priceIn}).
 * @param {unknown} raw @param {number} i @param {Base} base
 * @returns {EventIn}
 */
function eventIn(raw, i, base) {
  const at = `events[${i}]`;
  if (!isObject(raw)) throw refuse.invalidEvents(at, EVENT_SHAPE);
  const symbol = symbolIn(raw.symbol, `${at}.symbol`);
  const label = textOf(raw.label, `${at}.label`, LIMITS.label);
  const group = textOf(raw.group, `${at}.group`, LIMITS.group);
  const date = dateIn(raw.date, `${at}.date`);
  const timing = timingIn(raw.timing, `${at}.timing`);
  const source = sourceIn(raw.source, `${at}.source`);
  if (typeof raw.verified !== "boolean") throw refuse.invalidEvents(`${at}.verified`, "true or false");
  const note = noteIn(raw.note, `${at}.note`);
  return { symbol, label, group, date, timing, source, verified: raw.verified, note, ...priceIn(raw, at, base) };
}

/**
 * One anchor of the present case, checked in the order label, date, timing, source, verified, note, then its price's
 * fields ({@link priceIn}); the source may be left out, and `verified` is false when left out.
 * @param {unknown} raw @param {number} i @param {Base} base
 * @returns {AnchorIn}
 */
function anchorIn(raw, i, base) {
  const at = `query.anchors[${i}]`;
  if (!isObject(raw)) throw refuse.invalidEvents(at, ANCHOR_SHAPE);
  const label = textOf(raw.label, `${at}.label`, LIMITS.label);
  const date = dateIn(raw.date, `${at}.date`);
  const timing = timingIn(raw.timing, `${at}.timing`);
  const source = raw.source === null || raw.source === undefined ? null : sourceIn(raw.source, `${at}.source`);
  const verified = raw.verified ?? false;
  if (typeof verified !== "boolean") throw refuse.invalidEvents(`${at}.verified`, "true or false, or left out");
  const note = noteIn(raw.note, `${at}.note`);
  return { label, date, timing, source, verified, note, ...priceIn(raw, at, base) };
}

/**
 * The present case: its company and 1 to 3 anchors; null when left out.
 * @param {unknown} raw @param {Base} base
 * @returns {{ symbol: string, anchors: AnchorIn[] } | null}
 */
function queryIn(raw, base) {
  if (raw === null || raw === undefined) return null;
  if (!isObject(raw)) throw refuse.invalidEvents("query", "an object with symbol and anchors, or left out");
  const symbol = symbolIn(raw.symbol, "query.symbol");
  const list = raw.anchors;
  if (!Array.isArray(list) || list.length === 0 || list.length > ANCHORS_MAX) {
    throw refuse.invalidEvents("query.anchors", `a list of 1 to ${ANCHORS_MAX} anchors, each ${ANCHOR_SHAPE}`);
  }
  return { symbol, anchors: list.map((a, i) => anchorIn(a, i, base)) };
}

/**
 * The call's base: one of `BASES`, `prior_close` when left out.
 * @param {unknown} raw
 * @returns {Base}
 */
function baseIn(raw) {
  if (!given(raw)) return "prior_close";
  const base = typeof raw === "string" ? raw.trim() : "";
  if (!BASES.includes(base)) throw refuse.invalidEvents("base", `one of ${BASES.join(", ")}`);
  return /** @type {Base} */ (base);
}

/**
 * The call's horizons: 1 to `HORIZONS_MAX` whole numbers from 0 to `HORIZON_MAX`, strictly increasing; the default
 * when left out. Under `day0_close` the default starts at 1 and a 0 is refused, day 0's close being the base itself.
 * @param {unknown} raw @param {Base} base
 * @returns {number[]}
 */
function horizonsIn(raw, base) {
  if (!given(raw)) return [...(base === "day0_close" ? DEFAULT_HORIZONS_DAY0_CLOSE : DEFAULT_HORIZONS)];
  const ok = Array.isArray(raw) && raw.length >= 1 && raw.length <= HORIZONS_MAX
    && raw.every((k, i) => Number.isInteger(k) && k >= 0 && k <= HORIZON_MAX && (i === 0 || k > raw[i - 1]));
  if (!ok) throw refuse.invalidEvents("horizons", HORIZONS_WORDS);
  const horizons = /** @type {number[]} */ (raw);
  if (base === "day0_close" && horizons[0] === 0) {
    throw refuse.invalidEvents("horizons[0]", "0 is day 0's close itself under day0_close; start at 1");
  }
  return [...horizons];
}

/**
 * The call's benchmark: a ticker as `normalizeSymbol` writes it, null for `none` (in any case, trimmed), `SPY` when
 * left out.
 * @param {unknown} raw
 * @returns {string | null}
 */
function benchmarkIn(raw) {
  if (!given(raw)) return MARKET_SYMBOL;
  if (typeof raw === "string" && raw.trim().toLowerCase() === "none") return null;
  try {
    return normalizeSymbol(raw);
  } catch {
    throw refuse.invalidEvents("benchmark", "a ticker like SPY or QQQ, or none");
  }
}

/**
 * The scan's input as people give it, checked and normalized; the first problem found is the refusal, in the order
 * title, base, horizons, benchmark, events (the list, each event's fields then its price's, duplicates, groups), query
 * (each anchor the same).
 * @param {{ title: unknown, events: unknown, query?: unknown, base?: unknown, horizons?: unknown, benchmark?: unknown }} raw
 * @returns {{ title: string, events: EventIn[], query: { symbol: string, anchors: AnchorIn[] } | null, base: Base,
 *   horizons: number[], benchmark: string | null }}
 */
export function normalizeEvents({ title: rawTitle, events: rawEvents, query: rawQuery, base: rawBase, horizons: rawHorizons, benchmark: rawBenchmark }) {
  const title = textOf(rawTitle, "title", LIMITS.title);
  const base = baseIn(rawBase);
  const horizons = horizonsIn(rawHorizons, base);
  const benchmark = benchmarkIn(rawBenchmark);
  if (!Array.isArray(rawEvents) || rawEvents.length === 0 || rawEvents.length > EVENTS_MAX) {
    throw refuse.invalidEvents("events", `a list of 1 to ${EVENTS_MAX} events`);
  }
  const events = rawEvents.map((e, i) => eventIn(e, i, base));
  /** @type {Map<string, number>} */
  const seen = new Map();
  events.forEach((e, i) => {
    const key = `${e.symbol} ${e.date}`;
    const first = seen.get(key);
    if (first !== undefined) throw refuse.invalidEvents(`events[${i}]`, `the same symbol and date as events[${first}]`);
    seen.set(key, i);
  });
  const groups = new Set(events.map((e) => e.group));
  if (groups.size > GROUPS_MAX) throw refuse.invalidEvents("events", `at most ${GROUPS_MAX} groups, got ${groups.size}`);
  return { title, events, query: queryIn(rawQuery, base), base, horizons, benchmark };
}

/**
 * An unmeasured case and the words that say why, with a `flags` array of its own; `listed` and `skipped` as day 0's
 * check found them, when it ran.
 * @param {string} words @param {{ listed: boolean, skipped: number }} [at]
 * @returns {Measured}
 */
const unmeasured = (words, { listed, skipped } = { listed: false, skipped: 0 }) => ({
  state: "unmeasured", words, day0: null, measure: null, tape: null, tapeRan: false, flags: [], window: null, rel: null,
  relOf: null, factor: null, splits: null, listed, skipped,
});

/**
 * Whether the tape check had the volumes it needs: `MIN_VOLUMES` of the `VOLUME_BASE` sessions before day `i0`.
 * @param {Bar[]} bars @param {number} i0
 */
function tapeRuns(bars, i0) {
  let count = 0;
  for (let i = Math.max(0, i0 - VOLUME_BASE); i < i0; i++) {
    const v = bars[i].v;
    if (typeof v === "number" && v > 0) count++;
  }
  return count >= MIN_VOLUMES;
}

/**
 * @typedef {{ base: Base, horizons: number[], bench: Bar[] | null, calendar: Bar[] | null,
 *   opened: (url: string) => boolean }} Measuring the call's base and horizons, the benchmark's bars (null when none
 *   was read), SPY's bars as day 0's calendar (null when not read), and the page record
 */

/**
 * An event measured on its company's history, or the words that say why it cannot be: day 0 by its timing, checked on
 * SPY's sessions; under `price` the price tied to the bars; the base; the changes at the horizons; the tape; the paths.
 * @param {History} history @param {When} when @param {PriceIn} price @param {Measuring} measuring
 * @returns {Measured}
 */
function measureOn(history, when, price, { base, horizons, bench, calendar, opened }) {
  const { bars } = history;
  const i0 = dayZero(bars, when);
  if (i0 === null) {
    const after = when.timing === "post" || when.timing === "closed" ? "after" : "on or after";
    return unmeasured(`no session ${after} ${when.date} in its bars, which end ${dateOf(bars[bars.length - 1].t)}`);
  }
  const day0 = dateOf(bars[i0].t);
  const check = checkDayZero(bars, i0, when, { calendar, short: history.short });
  if ("words" in check) return unmeasured(check.words);
  let value = null;
  /** @type {number | null} */
  let factor = null;
  /** @type {SplitRecord | null} */
  let splits = null;
  if (base === "price") {
    const tie = tiePrice({ day0Open: bars[i0].o, day0Date: day0, statedOpen: price.statedOpen, splits: price.splits });
    if ("words" in tie) return unmeasured(tie.words, check);
    factor = tie.factor;
    value = /** @type {number} */ (price.price) / factor;
    if (tie.splitFactor !== null && price.splits !== null && price.splitsSource !== null) {
      const isOpened = opened(price.splitsSource);
      splits = { list: price.splits, factor: tie.splitFactor, source: price.splitsSource, opened: isOpened, verified: isOpened };
    }
  }
  const based = baseOf(bars, i0, base, value, bench);
  if ("words" in based) return unmeasured(based.words, check);
  const tape = tapeCheck(bars, i0);
  const { window, rel, relOf } = casePaths(bars, i0, based, bench, Math.max(POST, horizons.at(-1) ?? 0));
  /** @type {string[]} */
  const flags = [...tape.flags];
  if (check.skipped > 0) flags.push("skipped");
  if (splits !== null && !splits.opened) flags.push("splitsUnopened");
  return {
    state: "measured", words: null, day0, measure: measureCase(bars, i0, base, based, horizons, bench), tape,
    tapeRan: tapeRuns(bars, i0), flags, window, rel, relOf, factor, splits, listed: check.listed, skipped: check.skipped,
  };
}

/**
 * A group's paths cut to `sessions` entries, so they run from day 0 to the last horizon and no further.
 * @param {Paths | null} paths @param {number} sessions
 * @returns {Paths | null}
 */
const pathsTo = (paths, sessions) => paths === null ? null : {
  median: paths.median.slice(0, sessions), q1: paths.q1.slice(0, sessions), q3: paths.q3.slice(0, sessions),
};

/**
 * The scan of a list of events and, when asked, the present case, measured from the call's base at its horizons
 * against its benchmark.
 * @param {{ title: unknown, events: unknown, query?: unknown, base?: unknown, horizons?: unknown, benchmark?: unknown,
 *   keep: BarsKeep, opened?: (url: string) => boolean, now?: () => Date, deadlineMs?: number }} args
 * @returns {Promise<EventsView>}
 */
export async function scanEvents({
  title: rawTitle, events: rawEvents, query: rawQuery, base: rawBase, horizons: rawHorizons, benchmark: rawBenchmark,
  keep, opened = () => false, now = () => new Date(), deadlineMs = SCAN_DEADLINE_MS,
}) {
  const { title, events, query, base, horizons, benchmark } = normalizeEvents({
    title: rawTitle, events: rawEvents, query: rawQuery, base: rawBase, horizons: rawHorizons, benchmark: rawBenchmark,
  });
  const companies = [...new Set(events.map((e) => e.symbol))];
  /** @type {string[]} SPY always, the present case's company and the benchmark, each read fresh */
  const fresh = [...new Set([...(query === null ? [] : [query.symbol]), MARKET_SYMBOL, ...(benchmark === null ? [] : [benchmark])])];
  const got = await keep.histories([...new Set([...companies, ...fresh])], { fresh, deadlineMs });
  if (got.down && got.read.size === 0) {
    throw refuse.marketUnreachable([...got.refused.values()][0] ?? "the market did not answer");
  }
  const timedOut = new Set(got.timedOut);
  /** @param {string} symbol @returns {string} */
  const wordsOf = (symbol) => got.refused.get(symbol) ?? DEADLINE_WORDS;
  const spy = got.read.get(MARKET_SYMBOL);
  const benchHistory = benchmark === null ? undefined : got.read.get(benchmark);
  const bench = benchHistory === undefined ? null : benchHistory.bars;
  /** @type {Against} */
  const against = bench === null ? "raw" : "benchmark";
  /** @type {Measuring} */
  const measuring = { base, horizons, bench, calendar: spy === undefined ? null : spy.bars, opened };
  /** @param {string} symbol @param {When} when @param {PriceIn} price @returns {Measured} */
  const measure = (symbol, when, price) => {
    const history = got.read.get(symbol);
    return history === undefined ? unmeasured(wordsOf(symbol)) : measureOn(history, when, price, measuring);
  };

  /** @type {EventCase[]} */
  const asked = events.map((e) => {
    const m = measure(e.symbol, e, e);
    return {
      id: `ev-${e.symbol}-${e.date}`, symbol: e.symbol, label: e.label, group: e.group, date: e.date, timing: e.timing,
      source: e.source, note: e.note, price: e.price, statedOpen: e.statedOpen, ...m,
      ...checkClaim(e.verified, e.source, opened, m),
    };
  });
  const cases = orderCases(asked, against);
  const measured = cases.filter((c) => c.state === "measured");

  /** @type {History[]} every history the view was measured on */
  const used = [];
  /** @type {Record<string, number>} */
  const sources = {};
  /** @type {EventsView["coverage"]["short"]} */
  const short = [];
  let read = 0;
  let sessionBars = 0;
  for (const symbol of companies) {
    const h = got.read.get(symbol);
    if (h === undefined) continue;
    read++;
    if (h.today !== null) sessionBars++;
    used.push(h);
    const name = h.source.split(" · ")[0];
    sources[name] = (sources[name] ?? 0) + 1;
    if (h.short) short.push({ symbol, source: h.source, firstBar: h.firstBar });
  }

  /** @type {EventsView["query"]} */
  let present = null;
  if (query !== null) {
    const h = got.read.get(query.symbol);
    if (h !== undefined) used.push(h);
    present = {
      symbol: query.symbol, readDate: NEW_YORK.format(now()),
      latest: h === undefined ? null : dateOf(h.bars[h.bars.length - 1].t),
      today: h === undefined ? null : h.today, sessionOpen: h === undefined ? false : h.sessionOpen,
      words: h === undefined ? wordsOf(query.symbol) : null,
      source: h === undefined ? null : h.source, short: h === undefined ? false : h.short,
      firstBar: h === undefined ? null : h.firstBar,
      anchors: query.anchors.map((a, i) => {
        const m = measure(query.symbol, a, a);
        return {
          id: `q-${i + 1}`, label: a.label, date: a.date, timing: a.timing, source: a.source, note: a.note,
          price: a.price, statedOpen: a.statedOpen, ...m, ...checkClaim(a.verified, a.source, opened, m),
        };
      }),
    };
  }
  if (spy !== undefined) used.push(spy);
  if (benchHistory !== undefined && benchmark !== MARKET_SYMBOL) used.push(benchHistory);
  const adjustment = [...new Set(used.map((h) => h.adjustment).filter((a) => a !== null))];
  const readFrom = used.length === 0 ? null : new Date(Math.min(...used.map((h) => h.readAt))).toISOString();
  const groupNames = [...new Set(events.map((e) => e.group))];
  const verified = cases.filter((c) => c.verified).length;
  const sessions = (horizons.at(-1) ?? 0) + 1;

  return {
    kind: "events",
    version: 2,
    at: now().toISOString(),
    title,
    query: present,
    parameters: {
      base, horizons, benchmark, against, volumeBase: VOLUME_BASE, minVolumes: MIN_VOLUMES, quiet: QUIET,
      elsewhere: ELSEWHERE, elsewhereOver: ELSEWHERE_OVER, neighbours: NEIGHBOURS, minGroup: MIN_GROUP, pre: PRE,
      post: POST, tieTolerance: TIE_TOLERANCE, calendarDays: CALENDAR_DAYS,
    },
    coverage: {
      asked: cases.length,
      measured: measured.length,
      unmeasured: cases.filter((c) => c.state === "unmeasured").map((c) => ({ id: c.id, symbol: c.symbol, words: /** @type {string} */ (c.words) })),
      verified,
      unverified: cases.length - verified,
      unopened: cases.filter((c) => c.flags.includes("unopened")).length,
      quiet: measured.filter((c) => c.flags.includes("quiet")).length,
      elsewhere: measured.filter((c) => c.flags.includes("elsewhere")).length,
      noContext: measured.filter((c) => (c.measure?.changes[0]?.x ?? null) === null).length,
      companies: { asked: companies.length, read },
      sources,
      short,
      adjustment: /** @type {string[]} */ (adjustment),
      market: {
        source: spy === undefined ? null : spy.source, words: spy === undefined ? wordsOf(MARKET_SYMBOL) : null,
        firstBar: spy === undefined ? null : spy.firstBar, short: spy === undefined ? false : spy.short,
      },
      benchmark: {
        symbol: benchmark,
        source: benchHistory === undefined ? null : benchHistory.source,
        words: benchmark !== null && benchHistory === undefined ? wordsOf(benchmark) : null,
        firstBar: benchHistory === undefined ? null : benchHistory.firstBar,
        short: benchHistory === undefined ? false : benchHistory.short,
      },
      skipped: cases.filter((c) => c.skipped > 0).length,
      listed: cases.filter((c) => c.listed).length,
      sessionBars,
      readFrom,
      deadline: timedOut.size > 0,
    },
    groups: {
      all: summarizeEvents(cases, horizons, against),
      named: groupNames.map((name) => {
        const inGroup = cases.filter((c) => c.group === name);
        return { name, summary: summarizeEvents(inGroup, horizons, against), paths: pathsTo(groupPaths(inGroup), sessions) };
      }),
    },
    cases,
    windowsDropped: 0,
  };
}
