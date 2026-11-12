// face/plugins/analog/lib/event-scan.mjs
/**
 * The event scan: a researched list of past events checked field by field, every company's daily history read through
 * the keep, each event measured from its day 0 against the market, and the view that holds what was measured, what
 * could not be, and why.
 *
 * The input is refused at its first bad field, named by its path. Each text (the title, a label, a group, a note) is
 * put on one line before it is measured, every run of whitespace and control characters one space, so a text from a
 * page cannot start a line of the digest; a source URL that carries a username or a password is refused. Every history
 * is read in one call to the keep under the scan's deadline; the market's (`SPY`) is always read fresh, and so is the
 * present case's company (`query`) when there is one, so a new session drops what the keep held; the past events'
 * companies may come from the keep. A market that does not answer with nothing read is a refusal; a company the market
 * refuses, one not read before the deadline, an event whose day 0 has not traded, and one with fewer than 20 sessions
 * before day 0 are kept as unmeasured cases with the words that say why, never left out. Without the market's own bars
 * the raw changes stay and every change against the market is null.
 *
 * `verified` is the reader's claim checked by the face: an event marked verified whose source no reader opened is
 * stored unverified and flagged `unopened`. The present case's anchors are measured like the events, and are in no
 * group.
 */
import {
  ELSEWHERE, ELSEWHERE_OVER, MIN_BEFORE, MIN_VOLUMES, NEIGHBOURS, QUIET, TIMINGS, VOLUME_BASE,
  dayZero, eventWindow, measureEvent, tapeCheck,
} from "./events.mjs";
import { groupPaths, orderCases, summarizeEvents } from "./event-summary.mjs";
import { SCAN_DEADLINE_MS, normalizeSymbol } from "./chart-scan.mjs";
import { MIN_GROUP } from "./summary.mjs";
import { POST, PRE, dateOf } from "./episodes.mjs";
import { refuse } from "./errors.mjs";

/**
 * @typedef {import("./selloff.mjs").Bar} Bar
 * @typedef {import("./events.mjs").When} When
 * @typedef {import("./events.mjs").Measure} Measure
 * @typedef {import("./events.mjs").Tape} Tape
 * @typedef {import("./event-summary.mjs").EventSummary} EventSummary
 * @typedef {import("./event-summary.mjs").Paths} Paths
 * @typedef {import("./chart-scan.mjs").Path} Path
 * @typedef {import("./bars.mjs").BarsKeep} BarsKeep
 * @typedef {import("./bars.mjs").History} History
 * @typedef {{ symbol: string, label: string, group: string, date: string, timing: When["timing"], source: string,
 *   verified: boolean, note: string | null }} EventIn
 * @typedef {{ label: string, date: string, timing: When["timing"] }} AnchorIn
 * @typedef {{ state: "measured" | "unmeasured", words: string | null, day0: string | null, measure: Measure | null,
 *   tape: Tape | null, flags: string[], window: Path | null, rel: Array<[number, number]> | null }} Measured
 * @typedef {{ id: string, symbol: string, label: string, group: string, date: string, timing: string, source: string,
 *   note: string | null, claimed: boolean, opened: boolean, verified: boolean } & Measured} EventCase
 * @typedef {{ id: string, label: string, date: string, timing: string } & Measured} Anchor
 * @typedef {{ kind: "events", version: 1, at: string, title: string,
 *   query: null | { symbol: string, readDate: string, latest: string | null, today: string | null,
 *     sessionOpen: boolean, words: string | null, anchors: Anchor[] },
 *   parameters: { minBefore: number, volumeBase: number, minVolumes: number, quiet: number, elsewhere: number,
 *     elsewhereOver: number, neighbours: number, minGroup: number, pre: number, post: number },
 *   coverage: { asked: number, measured: number, unmeasured: Array<{ id: string, symbol: string, words: string }>,
 *     verified: number, unverified: number, unopened: number, quiet: number, elsewhere: number, noContext: number,
 *     companies: { asked: number, read: number }, sources: Record<string, number>,
 *     short: Array<{ symbol: string, source: string, firstBar: string }>, adjustment: string[],
 *     market: { source: string | null, words: string | null }, readFrom: string | null, deadline: boolean },
 *   groups: { all: EventSummary, named: Array<{ name: string, summary: EventSummary, paths: Paths | null }> },
 *   cases: EventCase[], windowsDropped: 0 }} EventsView
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
const DEADLINE_WORDS = "not read before the deadline";
const NEW_YORK = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const EVENT_SHAPE = "an object with symbol, label, group, date, timing, source and verified";
const ANCHOR_SHAPE = "an object with label, date and timing";

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
 * One event, checked in the order symbol, label, group, date, timing, source, verified, note.
 * @param {unknown} raw @param {number} i
 * @returns {EventIn}
 */
function eventIn(raw, i) {
  const at = `events[${i}]`;
  if (!isObject(raw)) throw refuse.invalidEvents(at, EVENT_SHAPE);
  const symbol = symbolIn(raw.symbol, `${at}.symbol`);
  const label = textOf(raw.label, `${at}.label`, LIMITS.label);
  const group = textOf(raw.group, `${at}.group`, LIMITS.group);
  const date = dateIn(raw.date, `${at}.date`);
  const timing = timingIn(raw.timing, `${at}.timing`);
  const source = sourceIn(raw.source, `${at}.source`);
  if (typeof raw.verified !== "boolean") throw refuse.invalidEvents(`${at}.verified`, "true or false");
  /** @type {string | null} */
  let note = null;
  if (raw.note !== null && raw.note !== undefined) {
    if (typeof raw.note !== "string") throw refuse.invalidEvents(`${at}.note`, `text of at most ${LIMITS.note} characters, or left out`);
    note = oneLine(raw.note);
    if (note.length > LIMITS.note) throw refuse.invalidEvents(`${at}.note`, `text of at most ${LIMITS.note} characters, or left out`);
    if (note === "") note = null;
  }
  return { symbol, label, group, date, timing, source, verified: raw.verified, note };
}

/**
 * The present case: its company and 1 to 3 anchors; null when left out.
 * @param {unknown} raw
 * @returns {{ symbol: string, anchors: AnchorIn[] } | null}
 */
function queryIn(raw) {
  if (raw === null || raw === undefined) return null;
  if (!isObject(raw)) throw refuse.invalidEvents("query", "an object with symbol and anchors, or left out");
  const symbol = symbolIn(raw.symbol, "query.symbol");
  const list = raw.anchors;
  if (!Array.isArray(list) || list.length === 0 || list.length > ANCHORS_MAX) {
    throw refuse.invalidEvents("query.anchors", `a list of 1 to ${ANCHORS_MAX} anchors, each ${ANCHOR_SHAPE}`);
  }
  const anchors = list.map((a, i) => {
    const at = `query.anchors[${i}]`;
    if (!isObject(a)) throw refuse.invalidEvents(at, ANCHOR_SHAPE);
    return { label: textOf(a.label, `${at}.label`, LIMITS.label), date: dateIn(a.date, `${at}.date`), timing: timingIn(a.timing, `${at}.timing`) };
  });
  return { symbol, anchors };
}

/**
 * The scan's input as people give it, checked and normalized; the first problem found is the refusal, in the order
 * title, events (the list, each event's fields, duplicates, groups), query.
 * @param {{ title: unknown, events: unknown, query?: unknown }} raw
 * @returns {{ title: string, events: EventIn[], query: { symbol: string, anchors: AnchorIn[] } | null }}
 */
export function normalizeEvents({ title: rawTitle, events: rawEvents, query: rawQuery }) {
  const title = textOf(rawTitle, "title", LIMITS.title);
  if (!Array.isArray(rawEvents) || rawEvents.length === 0 || rawEvents.length > EVENTS_MAX) {
    throw refuse.invalidEvents("events", `a list of 1 to ${EVENTS_MAX} events`);
  }
  const events = rawEvents.map(eventIn);
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
  return { title, events, query: queryIn(rawQuery) };
}

/**
 * An unmeasured case and the words that say why, with a `flags` array of its own.
 * @param {string} words
 * @returns {Measured}
 */
const unmeasured = (words) => ({ state: "unmeasured", words, day0: null, measure: null, tape: null, flags: [], window: null, rel: null });

/**
 * An event measured on its company's history, or the words that say why it cannot be.
 * @param {History} history @param {When} when @param {Bar[] | null} marketBars
 * @returns {Measured}
 */
function measureOn(history, when, marketBars) {
  const { bars } = history;
  const i0 = dayZero(bars, when);
  if (i0 === null) {
    const after = when.timing === "post" || when.timing === "closed" ? "after" : "on or after";
    return unmeasured(`no session ${after} ${when.date} in its bars, which end ${dateOf(bars[bars.length - 1].t)}`);
  }
  if (i0 < MIN_BEFORE) {
    return unmeasured(`only ${i0} sessions before day 0; its bars start ${history.firstBar} (${history.source})`);
  }
  const tape = tapeCheck(bars, i0);
  const { window, rel } = eventWindow(bars, i0, marketBars);
  return {
    state: "measured", words: null, day0: dateOf(bars[i0].t), measure: measureEvent(bars, i0, marketBars), tape,
    flags: [...tape.flags], window, rel,
  };
}

/**
 * The scan of a list of events and, when asked, the present case.
 * @param {{ title: unknown, events: unknown, query?: unknown, keep: BarsKeep, opened?: (url: string) => boolean,
 *   now?: () => Date, deadlineMs?: number }} args
 * @returns {Promise<EventsView>}
 */
export async function scanEvents({ title: rawTitle, events: rawEvents, query: rawQuery, keep, opened = () => false, now = () => new Date(), deadlineMs = SCAN_DEADLINE_MS }) {
  const { title, events, query } = normalizeEvents({ title: rawTitle, events: rawEvents, query: rawQuery });
  const companies = [...new Set(events.map((e) => e.symbol))];
  const got = await keep.histories(
    [...companies, ...(query === null ? [] : [query.symbol]), MARKET_SYMBOL],
    { fresh: query === null ? [MARKET_SYMBOL] : [query.symbol, MARKET_SYMBOL], deadlineMs },
  );
  if (got.down && got.read.size === 0) {
    throw refuse.marketUnreachable([...got.refused.values()][0] ?? "the market did not answer");
  }
  const timedOut = new Set(got.timedOut);
  /** @param {string} symbol @returns {string} */
  const wordsOf = (symbol) => got.refused.get(symbol) ?? DEADLINE_WORDS;
  const spy = got.read.get(MARKET_SYMBOL);
  const marketBars = spy === undefined ? null : spy.bars;
  /** @param {string} symbol @param {When} when @returns {Measured} */
  const measure = (symbol, when) => {
    const history = got.read.get(symbol);
    return history === undefined ? unmeasured(wordsOf(symbol)) : measureOn(history, when, marketBars);
  };

  /** @type {EventCase[]} */
  const given = events.map((e) => {
    const m = measure(e.symbol, e);
    const isOpened = opened(e.source);
    const unopened = e.verified && !isOpened;
    return {
      id: `ev-${e.symbol}-${e.date}`, symbol: e.symbol, label: e.label, group: e.group, date: e.date, timing: e.timing,
      source: e.source, note: e.note, claimed: e.verified, opened: isOpened, verified: e.verified && isOpened,
      ...m, flags: unopened ? [...m.flags, "unopened"] : m.flags,
    };
  });
  const cases = orderCases(given);
  const measured = cases.filter((c) => c.state === "measured");

  /** @type {History[]} every history the view was measured on */
  const used = [];
  /** @type {Record<string, number>} */
  const sources = {};
  /** @type {EventsView["coverage"]["short"]} */
  const short = [];
  let read = 0;
  for (const symbol of companies) {
    const h = got.read.get(symbol);
    if (h === undefined) continue;
    read++;
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
      anchors: query.anchors.map((a, i) => ({ id: `q-${i + 1}`, label: a.label, date: a.date, timing: a.timing, ...measure(query.symbol, a) })),
    };
  }
  if (spy !== undefined) used.push(spy);
  const adjustment = [...new Set(used.map((h) => h.adjustment).filter((a) => a !== null))];
  const readFrom = used.length === 0 ? null : new Date(Math.min(...used.map((h) => h.readAt))).toISOString();
  const groupNames = [...new Set(events.map((e) => e.group))];
  const verified = cases.filter((c) => c.verified).length;

  return {
    kind: "events",
    version: 1,
    at: now().toISOString(),
    title,
    query: present,
    parameters: {
      minBefore: MIN_BEFORE, volumeBase: VOLUME_BASE, minVolumes: MIN_VOLUMES, quiet: QUIET, elsewhere: ELSEWHERE,
      elsewhereOver: ELSEWHERE_OVER, neighbours: NEIGHBOURS, minGroup: MIN_GROUP, pre: PRE, post: POST,
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
      noContext: measured.filter((c) => c.measure?.x0 === null).length,
      companies: { asked: companies.length, read },
      sources,
      short,
      adjustment: /** @type {string[]} */ (adjustment),
      market: { source: spy === undefined ? null : spy.source, words: spy === undefined ? wordsOf(MARKET_SYMBOL) : null },
      readFrom,
      deadline: timedOut.size > 0,
    },
    groups: {
      all: summarizeEvents(cases),
      named: groupNames.map((name) => {
        const inGroup = cases.filter((c) => c.group === name);
        return { name, summary: summarizeEvents(inGroup), paths: groupPaths(inGroup) };
      }),
    },
    cases,
    windowsDropped: 0,
  };
}
