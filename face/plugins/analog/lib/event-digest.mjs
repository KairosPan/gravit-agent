// face/plugins/analog/lib/event-digest.mjs
/**
 * The digest of an event view (version 2): the few lines the model reads instead of the view, at most 2,048 bytes.
 * Coverage first, then the title, the measurement line (the base, the benchmark, or `raw` and why, the horizons), one
 * line per anchor of the present case, where the benchmark's bars start when they were read short (a benchmark that
 * could not be read is said once, with its words, on the measurement line), the header and one row per group and
 * `all` with one figure per horizon, the measured cases in the view's order with one figure per horizon, the
 * unmeasured ones with the words that say why, what the flags mean, under `price` the price sentence, and the fixed
 * sentences. Every figure is the change against the benchmark, or the raw change when the view is raw (`valueOf`).
 *
 * When it is over the bound, each step below is taken in turn while it still is: (1) every note goes; (2) every
 * unmeasured entry loses its words and reads `<SYMBOL> <date>`; (3) case lines leave from the middle of the order, so
 * the first and the last stay longest, with `… and N more in the view` where they left; (4) the unmeasured line is cut
 * from its end to `+N more`; (5) the line that explains `quiet` and `elsewhere` goes; (6) texts are clipped, all at
 * once, by code point with `…` where they were clipped (the title to 20 characters, each anchor's label to 12, each
 * group's name to 8 wherever it is printed, the words on an anchor's line, the benchmark's words on the measurement
 * line and the source on the benchmark's line to 80); (7) each measured anchor's line takes a short form without its
 * gap and its volume, with its first and its last horizon only. (8) Whenever step 6 or 7 was taken, the case lines
 * that left come back while the digest stays within the bound, the earliest and the latest of them in turn, so the
 * kept ones are still the two ends of the order; the `… and N more` line says how many are still out and goes when
 * none is. (9) A digest still over the bound is refused (`INTERNAL`), never returned. Line 1, the measurement line,
 * the header, each row's numbers and the fixed sentences are never cut. Numbers are written as `format.mjs` writes
 * them. The view is not changed.
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
 * split factor, the listing day, the sessions skipped, the tape's flags, no volume check, unverified, a source and a
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
    (c.tapeRan ? "" : " · no volume check") +
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
  let unmeasuredWords = true;
  let unmeasuredShown = unmeasured.length;
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
    const measurement = `measured from ${FROM[p.base]}, ${relative}: ${p.horizons.map(horizonName).join(" ")}`;
    const benchShort = bench.symbol !== null && bench.words === null && bench.short && bench.source !== null
      ? [`${bench.symbol}'s bars start ${bench.firstBar} (${words(bench.source)}): events before it have nothing to compare with`]
      : [];
    const rows = [...view.groups.named.map((g) => groupRow(group(g.name), g.summary)), groupRow("all", view.groups.all)];
    const lines = measured.map((k) => caseLine(k, group(k.group), against, notes));
    const cut = measured.length - head - tail;
    const cases = measured.length === 0 ? [] : [
      casesLine(p.horizons), ...lines.slice(0, head), ...(cut > 0 ? [`… and ${cut} more in the view`] : []), ...lines.slice(lines.length - tail),
    ];
    const entries = unmeasured.map((k) => (unmeasuredWords ? `${k.symbol} ${k.date} (${k.words})` : `${k.symbol} ${k.date}`));
    const more = unmeasured.length - unmeasuredShown;
    const unmeasuredLine = unmeasured.length === 0 ? [] : [
      `unmeasured: ${[...entries.slice(0, unmeasuredShown), ...(more > 0 ? [`+${more} more`] : [])].join("; ")}`,
    ];
    return [
      first, clipped ? clip(view.title, CLIP.title) : view.title, measurement, ...anchors, ...benchShort, columns, ...rows,
      ...cases, ...unmeasuredLine, ...(flagsShown ? [FLAGS] : []), ...(p.base === "price" ? [PRICE_SENTENCE] : []),
      EVENT_SENTENCES,
    ].join("\n");
  };
  let text = compose();
  const over = () => Buffer.byteLength(text) > DIGEST_MAX;
  if (over()) { notes = false; text = compose(); }
  if (over()) { unmeasuredWords = false; text = compose(); }
  while (over() && head + tail > 0) {
    if (head > tail) head--; else tail--;
    text = compose();
  }
  while (over() && unmeasuredShown > 0) { unmeasuredShown--; text = compose(); }
  if (over() && flagsShown) { flagsShown = false; text = compose(); }
  if (over()) { clipped = true; text = compose(); }
  if (over()) { short = true; text = compose(); }
  if (clipped && !over()) {
    // Clipping made room: the cases that left come back, the earliest and the latest of them in turn, while they fit.
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
