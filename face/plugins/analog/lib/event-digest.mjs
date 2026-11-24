// face/plugins/analog/lib/event-digest.mjs
/**
 * The digest of an event view (version 2): the few lines the model reads instead of the view, at most 2,048 bytes.
 * Coverage first, then the title, the measurement line (the base, the benchmark, or `raw` and why, the horizons), one
 * line per anchor of the present case, where the benchmark's bars start when they were read short (a benchmark that
 * could not be read is said once, with its words, on the measurement line), the header and one row per group and
 * `all` with one figure per horizon, the measured cases in the view's order with one figure per horizon, the
 * unmeasured ones with the words that say why (or, cut, by their reason), what the flags mean, under `price` the price
 * sentence, and the fixed sentences. Every figure is the change against the benchmark, or the raw change when the view
 * is raw (`valueOf`).
 *
 * When it is over the bound, each step below is taken in turn while it still is:
 * (1) every note goes;
 * (2) the unmeasured cases are said by their reason instead of their words, each reason on its own line once with the
 *     companies it holds (`unmeasured, needs a split record: DDD (bars ×4)`); a reason the market gave in its own words
 *     is those words with the case's symbol taken out, so every company refused alike shares one line, clipped to 80;
 * (3) case lines leave from the middle of the order, so the first and the last stay longest, with `… and N more in
 *     the view` where they left; before the last one goes, the anchors take their short form (step 7) and then the
 *     texts their clipped one (step 6);
 * (4) each reason's companies are cut from its end to `+N more`, the reason showing the most first, down to `N cases`
 *     only where that is shorter than what it replaces;
 * (5) the line that explains `quiet` and `elsewhere` goes (it is never there while no case line shown carries either);
 * (6) texts are clipped, all at once, by code point with `…` where they were clipped (the title to 20 characters, each
 *     anchor's label to 12, each group's name to 8 wherever it is printed, the words on an anchor's line, the
 *     benchmark's words on the measurement line and the source on the benchmark's line to 80);
 * (7) each measured anchor's line takes a short form without its gap and its volume, with its first and its last
 *     horizon only;
 * (8) the unmeasured cases are named alone on one line (`unmeasured: AAA, BBB`), their reasons gone;
 * (9) they are said as one count (`unmeasured: N cases`).
 * (10) Then, within the bound, what the steps freed comes back while it fits: a reason's companies that step 4 cut,
 *     then the case lines that left, the earliest and the latest of them in turn, so the kept ones are still the two
 *     ends of the order; the `… and N more` line says how many are still out and goes when none is.
 * (11) A digest still over the bound is refused (`INTERNAL`), never returned.
 * Line 1, the measurement line, the header, each row's numbers and the fixed sentences are never cut. Numbers are
 * written as `format.mjs` writes them. The view is not changed.
 */
import { DIGEST_MAX, pct, ratio, whole } from "./format.mjs";
import { factorWords } from "./price-tie.mjs";
import { valueOf } from "./event-summary.mjs";
import { refuse } from "./errors.mjs";

/** @typedef {import("./event-scan.mjs").EventsView} EventsView */
/** @typedef {import("./event-scan.mjs").EventCase} EventCase */
/** @typedef {import("./event-scan.mjs").Anchor} Anchor */
/** @typedef {import("./event-summary.mjs").EventSummary} EventSummary */
/** @typedef {import("./event-summary.mjs").Against} Against */
/** @typedef {import("./events.mjs").Base} Base */

/** The sentences every event digest ends with. */
export const EVENT_SENTENCES =
  "A company whose stock no longer trades cannot be measured, so the list leans favourable. " +
  "These are the events one search found, not every such event, and an unverified date was not checked against a source. " +
  "No lookahead guard: never evidence for a trade.";
/** The sentence a digest under `base: price` adds before the fixed ones. */
export const PRICE_SENTENCE =
  "A price is its source's figure, checked as its date is, and divided by a split only when the company's record and the bars both show it.";
const FLAGS = "quiet: day 0 under 1.5× its usual volume. elsewhere: a busier session within two sessions.";
/** The line above the cases, naming the first horizon they are ordered by. @param {number[]} horizons */
const casesLine = (horizons) => `cases, by group, the most negative ${horizonName(horizons[0] ?? 0)} first:`;
/** A case's label is cut to this many characters. */
const LABEL_MAX = 40;
/** What clipping leaves of each text, in characters, when the digest still does not fit. */
const CLIP = { title: 20, anchor: 12, group: 8, words: 80 };
/** What each base is measured from, as the measurement line says it. @type {Record<Base, string>} */
const FROM = {
  prior_close: "the close before day 0",
  price: "each case's price",
  day0_open: "day 0's open (the benchmark from its 09:30 open)",
  day0_close: "day 0's close",
};

/** The first `max` code points of `text`; clipped ones end with `…`. @param {string} text @param {number} max */
function clip(text, max) {
  const points = Array.from(text);
  return points.length <= max ? text : `${points.slice(0, max).join("")}…`;
}

/**
 * The reason an unmeasured case gives, said once for every case that gives it, and what this case adds to it: the
 * reasons the face writes by their kind, any other (the market's own words) as its words with the case's own symbol
 * taken out (`Nasdaq keeps no daily bars of …`), so every company refused alike shares one reason, clipped.
 * @param {string} words @param {string} symbol @returns {{ reason: string, detail: string | null }}
 */
function reasonOf(words, symbol) {
  /** @type {RegExpExecArray | null} */
  let m;
  if (/: there is no close before it; /.test(words)) {
    return { reason: "no close before a first bar (use price, day0_open or day0_close)", detail: null };
  }
  if ((m = /^its bars are adjusted about ×(\S+) since day 0 .*: a split record is needed$/.exec(words))) {
    return { reason: "needs a split record", detail: `bars ×${m[1]}` };
  }
  if ((m = /^its split record gives ×(\S+), its bars ×(\S+)$/.exec(words))) {
    return { reason: "split record and bars disagree", detail: `record ×${m[1]}, bars ×${m[2]}` };
  }
  if (words.startsWith("no first-day open from its source")) return { reason: "no first-day open from its source", detail: null };
  if (/: the date's session is not in its bars$|: its bars do not cover the date$|^no session (on or )?after \S+ in its bars, which end /.test(words)) {
    return { reason: "date not in its bars", detail: null };
  }
  const own = symbol === "" ? null : new RegExp(`(?<![A-Za-z0-9.])${symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`, "g");
  return { reason: clip(own === null ? words : words.replace(own, "…"), CLIP.words), detail: null };
}

/**
 * An unmeasured case as a list names it: its symbol, with its date when the symbol is unmeasured more than once.
 * @param {EventCase[]} cases @returns {(k: EventCase) => string}
 */
function namer(cases) {
  const count = new Map();
  for (const k of cases) count.set(k.symbol, (count.get(k.symbol) ?? 0) + 1);
  return (k) => `${k.symbol}${count.get(k.symbol) > 1 ? ` ${k.date}` : ""}`;
}

/**
 * The unmeasured cases by reason, each reason in the order it first comes, with its entries: the case's name and what
 * the case adds to the reason.
 * @param {EventCase[]} cases @returns {Array<{ reason: string, entries: string[] }>}
 */
function byReason(cases) {
  const name = namer(cases);
  /** @type {Map<string, string[]>} */
  const reasons = new Map();
  for (const k of cases) {
    const { reason, detail } = reasonOf(String(k.words), k.symbol);
    const entry = `${name(k)}${detail === null ? "" : ` (${detail})`}`;
    reasons.set(reason, [...(reasons.get(reason) ?? []), entry]);
  }
  return [...reasons].map(([reason, entries]) => ({ reason, entries }));
}

/** @param {number} n */
const howMany = (n) => (n === 1 ? "1 case" : `${n} cases`);

/** A horizon as the digest names it. @param {number} k */
const horizonName = (k) => (k === 0 ? "day 0" : `+${k}`);

/** @param {number[]} horizons */
function header(horizons) {
  const first = horizonName(horizons[0] ?? 0);
  const last = horizonName(horizons.at(-1) ?? 0);
  return ["group", "n", ...horizons.map(horizonName), `[${last} quartiles]`, `below 0 at ${first}`, `at ${last}`].join("  ");
}

/** @param {string} name @param {EventSummary} s */
function groupRow(name, s) {
  if (s.at.every((h) => h.median === null)) return `${name}  ${s.n}  too few to summarize`;
  return [
    name, String(s.n), ...s.at.map((h) => pct(h.median)), `[${pct(s.q1)} … ${pct(s.q3)}]`,
    whole(s.at[0]?.down), whole(s.at.at(-1)?.down),
  ].join("  ");
}

/**
 * One figure per horizon: `day 0 −11.1%; +1 −16.0%; …`.
 * @param {NonNullable<EventCase["measure"]>} m @param {Against} against
 */
const figures = (m, against) => m.changes.map((ch) => `${horizonName(ch.k)} ${pct(valueOf(ch, against))}`).join("; ");

/**
 * One anchor of the present case, clipped and in short form when asked.
 * @param {string} symbol @param {Anchor} a @param {NonNullable<EventsView["query"]>} q @param {Against} against
 * @param {{ clipped: boolean, short: boolean }} how
 */
function anchorLine(symbol, a, q, against, { clipped, short }) {
  const head = `${symbol} ${clipped ? clip(a.label, CLIP.anchor) : a.label} ${a.date} ${a.timing}`;
  if (a.state !== "measured" || a.measure === null) {
    const words = String(a.words);
    return `${head}: unmeasured (${clipped ? clip(words, CLIP.words) : words})`;
  }
  const m = a.measure;
  const open = a.day0 === q.latest && q.sessionOpen ? " (session still open)" : "";
  const since = `${m.sessionsAfter} sessions since`;
  if (short) {
    const ends = m.changes.length > 1 ? [m.changes[0], m.changes[m.changes.length - 1]] : m.changes;
    return `${head} → day 0 ${a.day0}${open}: ${figures({ ...m, changes: ends }, against)}; ${since}`;
  }
  const gap = m.gap === null ? "" : `; gap ${pct(m.gap)}`;
  const volume = a.tapeRan ? `volume ${ratio(a.tape?.vol0)}` : "no volume check";
  return `${head} → day 0 ${a.day0}${open}: ${figures(m, against)}${gap}; ${volume}; ${since}`;
}

/**
 * One measured case, with its note when `withNote`, its group's name as given. The extras, in order: the raw change
 * when the view is against a benchmark and the case has no figure against it at the first horizon, the price, the
 * split factor, the listing day, the sessions skipped, the tape's flags, no volume check (unless a listing day, which
 * has none), unverified, a source and a
 * split record not opened, the note.
 * @param {EventCase} c @param {string} group @param {Against} against @param {boolean} withNote
 */
function caseLine(c, group, against, withNote) {
  const m = /** @type {NonNullable<EventCase["measure"]>} */ (c.measure);
  const label = Array.from(c.label).slice(0, LABEL_MAX).join("");
  const first = m.changes[0];
  return `${group}: ${c.symbol} ${c.day0} ${label} ${figures(m, against)}` +
    (against === "benchmark" && valueOf(first, "benchmark") === null ? ` · raw ${pct(valueOf(first, "raw"))}` : "") +
    (c.price !== null ? ` · price ${c.price}` : "") +
    (c.factor !== null && c.factor !== 1 ? ` · split ×${factorWords(c.factor)}` : "") +
    (c.listed ? " · listing day" : "") +
    (c.skipped > 0 ? ` · skipped ${c.skipped} sessions` : "") +
    (c.flags.includes("quiet") ? " · quiet" : "") +
    (c.flags.includes("elsewhere") ? " · elsewhere" : "") +
    (c.tapeRan || c.listed ? "" : " · no volume check") +
    (c.verified ? "" : " · unverified") +
    (c.flags.includes("unopened") ? " · source not opened" : "") +
    (c.flags.includes("splitsUnopened") ? " · split record not opened" : "") +
    (withNote && c.note !== null ? ` · note: ${c.note}` : "");
}

/**
 * The digest of a stored event view.
 * @param {EventsView & { id: string }} view
 * @returns {string}
 */
export function eventsDigest(view) {
  const { coverage: c, query: q, parameters: p } = view;
  const against = p.against;
  const bench = c.benchmark;
  const first = `measured ${c.measured} of ${c.asked} events (${c.unmeasured.length} unmeasured) · ` +
    `${c.verified} verified, ${c.unverified} unverified` +
    (c.unopened > 0 ? `, ${c.unopened} marked verified without an opened source` : "") +
    ` · view ${view.id}${c.deadline ? " · stopped at the deadline" : ""}`;

  const measured = view.cases.filter((k) => k.state === "measured" && k.measure !== null);
  const unmeasured = view.cases.filter((k) => k.state === "unmeasured");
  const columns = header(p.horizons);
  const flagged = measured.some((k) => k.flags.includes("quiet") || k.flags.includes("elsewhere"));

  let notes = true;
  /** How the unmeasured cases are said: with their words, by reason, as names alone (step 9), as one count (step 10). */
  let said = /** @type {"words" | "reasons" | "names" | "count"} */ ("words");
  const reasons = byReason(unmeasured);
  const names = unmeasured.map(namer(unmeasured));
  // How many entries each reason still shows (step 4).
  const reasonShown = reasons.map((r) => r.entries.length);
  // The case lines shown are the first `head` and the last `tail` of the order; the ones between have left.
  let head = Math.ceil(measured.length / 2);
  let tail = measured.length - head;
  let flagsShown = flagged;
  let clipped = false;
  let short = false;

  const compose = () => {
    /** @param {string} name */
    const group = (name) => (clipped ? clip(name, CLIP.group) : name);
    const anchors = q === null ? [] : q.anchors.map((a) => anchorLine(q.symbol, a, q, against, { clipped, short }));
    /** @param {string} text */
    const words = (text) => (clipped ? clip(text, CLIP.words) : text);
    // A benchmark that could not be read is said once, with its words, on the measurement line.
    const relative = bench.symbol === null
      ? "raw, no benchmark"
      : bench.words !== null ? `raw: ${bench.symbol} could not be read (${words(bench.words)})` : `against ${bench.symbol}`;
    const from = p.base === "day0_open" && bench.symbol === null ? "day 0's open" : FROM[p.base];
    const measurement = `measured from ${from}, ${relative}: ${p.horizons.map(horizonName).join(" ")}`;
    const benchShort = bench.symbol !== null && bench.words === null && bench.short && bench.source !== null
      ? [`${bench.symbol}'s bars start ${bench.firstBar} (${words(bench.source)}): events before it have nothing to compare with`]
      : [];
    const rows = [...view.groups.named.map((g) => groupRow(group(g.name), g.summary)), groupRow("all", view.groups.all)];
    const lines = measured.map((k) => caseLine(k, group(k.group), against, notes));
    const cut = measured.length - head - tail;
    const shown = [...lines.slice(0, head), ...lines.slice(lines.length - tail)];
    const cases = measured.length === 0 ? [] : [
      casesLine(p.horizons), ...shown.slice(0, head), ...(cut > 0 ? [`… and ${cut} more in the view`] : []), ...shown.slice(head),
    ];
    // what the flags mean is said while a case line shown carries one
    const explained = flagsShown && shown.some((l) => / · (quiet|elsewhere)( · |$)/.test(l));
    /** @type {string[]} */
    let unmeasuredLine = [];
    if (unmeasured.length === 0) unmeasuredLine = [];
    else if (said === "words") unmeasuredLine = [`unmeasured: ${unmeasured.map((k) => `${k.symbol} ${k.date} (${k.words})`).join("; ")}`];
    else if (said === "names") unmeasuredLine = [`unmeasured: ${names.join(", ")}`];
    else if (said === "count") unmeasuredLine = [`unmeasured: ${howMany(unmeasured.length)}`];
    else {
      unmeasuredLine = reasons.map((r, i) => {
        const shown = reasonShown[i];
        const more = r.entries.length - shown;
        const list = shown === 0 ? howMany(r.entries.length) : [...r.entries.slice(0, shown), ...(more > 0 ? [`+${more} more`] : [])].join(", ");
        return `unmeasured, ${r.reason}: ${list}`;
      });
    }
    return [
      first, clipped ? clip(view.title, CLIP.title) : view.title, measurement, ...anchors, ...benchShort, columns, ...rows,
      ...cases, ...unmeasuredLine, ...(explained ? [FLAGS] : []), ...(p.base === "price" ? [PRICE_SENTENCE] : []),
      EVENT_SENTENCES,
    ].join("\n");
  };
  let text = compose();
  const over = () => Buffer.byteLength(text) > DIGEST_MAX;
  if (over()) { notes = false; text = compose(); }
  if (over()) { said = "reasons"; text = compose(); }
  while (over() && head + tail > 0) {
    // before the last case line goes, the anchors take their short form, then the texts are clipped
    if (head + tail === 1 && !short) short = true;
    else if (head + tail === 1 && !clipped) clipped = true;
    else if (head > tail) head--; else tail--;
    text = compose();
  }
  // the reason that shows the most entries gives up its last one, while that makes the text shorter ("AAA" is shorter
  // than "1 case": a cut that would lengthen it is not taken, and that reason keeps what it shows)
  const held = reasons.map(() => false);
  while (over()) {
    const open = reasonShown.map((n, i) => (held[i] || n === 0 ? -1 : n));
    const i = open.indexOf(Math.max(...open));
    if (open[i] <= 0) break;
    const before = text;
    reasonShown[i]--;
    text = compose();
    if (Buffer.byteLength(text) >= Buffer.byteLength(before)) { reasonShown[i]++; text = before; held[i] = true; }
  }
  if (over() && flagsShown) { flagsShown = false; text = compose(); }
  if (over()) { clipped = true; text = compose(); }
  if (over()) { short = true; text = compose(); }
  if (over() && unmeasured.length > 0) { said = "names"; text = compose(); }
  if (over() && unmeasured.length > 0) { said = "count"; text = compose(); }
  if (!over()) {
    // Whatever the last steps freed comes back while it fits: the reasons' entries that were cut first, then the cases.
    for (let i = 0; said === "reasons" && i < reasons.length; i++) {
      while (reasonShown[i] < reasons[i].entries.length) {
        reasonShown[i]++;
        const before = text;
        text = compose();
        if (over()) { reasonShown[i]--; text = before; break; }
      }
    }
    // The cases that left come back, the earliest and the latest of them in turn.
    for (let earliest = true; head + tail < measured.length; earliest = !earliest) {
      const before = { head, tail, text };
      if (earliest) head++; else tail++;
      text = compose();
      if (over()) { ({ head, tail, text } = before); break; }
    }
  }
  if (over()) throw refuse.digestOverBound();
  return text;
}
