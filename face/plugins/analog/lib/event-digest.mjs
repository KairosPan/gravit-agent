// face/plugins/analog/lib/event-digest.mjs
/**
 * The digest of an event view: the few lines the model reads instead of the view, at most 2,048 bytes. Coverage first,
 * then the title, one line per anchor of the present case, the market's refusal when its bars were not read, one row
 * per group and `all` against the market, the measured cases in the view's order, the unmeasured ones with the words
 * that say why, what the flags mean, and the fixed sentences.
 *
 * When it is over the bound, each step below is taken in turn while it still is: (1) every note goes; (2) every
 * unmeasured entry loses its words and reads `<SYMBOL> <date>`; (3) case lines leave from the middle of the order, so
 * the first and the last stay longest, with `… and N more in the view` where they left; (4) the unmeasured line is cut
 * from its end to `+N more`; (5) the line that explains `quiet` and `elsewhere` goes; (6) texts are clipped, all at
 * once, by code point with `…` where they were clipped (the title to 20 characters, each anchor's label to 12, each
 * group's name to 8 wherever it is printed, the market's words on an anchor's line or the SPY line to 80); (7) each
 * measured anchor's line takes a short form without its gap, its +1 and its volume. (8) Whenever step 6 or 7 was taken,
 * the case lines that left come back while the digest stays within the bound, the earliest and the latest of them in
 * turn, so the kept ones are still the two ends of the order; the `… and N more` line says how many are still out and
 * goes when none is. (9) A digest still over the bound is refused (`INTERNAL`), never returned. Line 1, the header,
 * each row's numbers and the fixed sentences are never cut. Numbers are written as the chart digest writes them. The
 * view is not changed.
 */
import { DIGEST_MAX, pct, ratio, whole } from "./digest.mjs";
import { refuse } from "./errors.mjs";

/** @typedef {import("./event-scan.mjs").EventsView} EventsView */
/** @typedef {import("./event-scan.mjs").EventCase} EventCase */
/** @typedef {import("./event-scan.mjs").Anchor} Anchor */
/** @typedef {import("./event-summary.mjs").EventSummary} EventSummary */

/** The sentences every event digest ends with. */
export const EVENT_SENTENCES =
  "A company whose stock no longer trades cannot be measured, so the list leans favourable. " +
  "These are the events one search found, not every such event, and an unverified date was not checked against a source. " +
  "No lookahead guard: never evidence for a trade.";
const HEADER = "group  n  day 0  +1  +5  +20  +60  [+60 quartiles]  below 0 at day 0  at +60 · all against the market";
const FLAGS = "quiet: day 0 under 1.5× its usual volume. elsewhere: a busier session within two sessions.";
const CASES = "cases, by group, the most negative day 0 first:";
/** A case's label is cut to this many characters. */
const LABEL_MAX = 40;
/** What clipping leaves of each text, in characters, when the digest still does not fit. */
const CLIP = { title: 20, anchor: 12, group: 8, words: 80 };

/** The first `max` code points of `text`; clipped ones end with `…`. @param {string} text @param {number} max */
function clip(text, max) {
  const points = Array.from(text);
  return points.length <= max ? text : `${points.slice(0, max).join("")}…`;
}

/** @param {string} name @param {EventSummary} s */
function groupRow(name, s) {
  if (s.x0 === null) return `${name}  ${s.n}  too few to summarize`;
  return [
    name, String(s.n), pct(s.x0), pct(s.x1), pct(s.x5), pct(s.x20), pct(s.x60), `[${pct(s.x60q1)} … ${pct(s.x60q3)}]`,
    whole(s.down0), whole(s.down60),
  ].join("  ");
}

/**
 * One anchor of the present case, clipped and in short form when asked.
 * @param {string} symbol @param {Anchor} a @param {NonNullable<EventsView["query"]>} q
 * @param {{ clipped: boolean, short: boolean }} how
 */
function anchorLine(symbol, a, q, { clipped, short }) {
  const head = `${symbol} ${clipped ? clip(a.label, CLIP.anchor) : a.label} ${a.date} ${a.timing}`;
  if (a.state !== "measured" || a.measure === null) {
    const words = String(a.words);
    return `${head}: unmeasured (${clipped ? clip(words, CLIP.words) : words})`;
  }
  const m = a.measure;
  const open = a.day0 === q.latest && q.sessionOpen ? " (session still open)" : "";
  if (short) {
    return `${head} → day 0 ${a.day0}${open}: day 0 ${pct(m.r0)} (${pct(m.x0)} vs market); +5 ${pct(m.x5)}; ` +
      `${m.sessionsAfter} sessions since`;
  }
  return `${head} → day 0 ${a.day0}${open}: gap ${pct(m.gap)}; day 0 ${pct(m.r0)} (${pct(m.x0)} vs market); ` +
    `+1 ${pct(m.x1)}; +5 ${pct(m.x5)}; volume ${ratio(a.tape?.vol0)}; ${m.sessionsAfter} sessions since`;
}

/**
 * One measured case, with its note when `withNote`, its group's name as given.
 * @param {EventCase} c @param {string} group @param {boolean} withNote
 */
function caseLine(c, group, withNote) {
  const m = /** @type {NonNullable<EventCase["measure"]>} */ (c.measure);
  const label = Array.from(c.label).slice(0, LABEL_MAX).join("");
  return `${group}: ${c.symbol} ${c.day0} ${label} day 0 ${pct(m.x0)}; +5 ${pct(m.x5)}; +60 ${pct(m.x60)}` +
    (m.x0 === null ? ` · raw ${pct(m.r0)}` : "") +
    (c.flags.includes("quiet") ? " · quiet" : "") +
    (c.flags.includes("elsewhere") ? " · elsewhere" : "") +
    (c.verified ? "" : " · unverified") +
    (c.flags.includes("unopened") ? " · source not opened" : "") +
    (withNote && c.note !== null ? ` · note: ${c.note}` : "");
}

/**
 * The digest of a stored event view.
 * @param {EventsView & { id: string }} view
 * @returns {string}
 */
export function eventsDigest(view) {
  const { coverage: c, query: q } = view;
  const first = `measured ${c.measured} of ${c.asked} events (${c.unmeasured.length} unmeasured) · ` +
    `${c.verified} verified, ${c.unverified} unverified` +
    (c.unopened > 0 ? `, ${c.unopened} marked verified without an opened source` : "") +
    ` · view ${view.id}${c.deadline ? " · stopped at the deadline" : ""}`;

  const measured = view.cases.filter((k) => k.state === "measured" && k.measure !== null);
  const unmeasured = view.cases.filter((k) => k.state === "unmeasured");
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
    const anchors = q === null ? [] : q.anchors.map((a) => anchorLine(q.symbol, a, q, { clipped, short }));
    const spy = c.market.words !== null
      ? [`SPY could not be read: ${clipped ? clip(c.market.words, CLIP.words) : c.market.words}`]
      : [];
    const rows = [...view.groups.named.map((g) => groupRow(group(g.name), g.summary)), groupRow("all", view.groups.all)];
    const lines = measured.map((k) => caseLine(k, group(k.group), notes));
    const cut = measured.length - head - tail;
    const cases = measured.length === 0 ? [] : [
      CASES, ...lines.slice(0, head), ...(cut > 0 ? [`… and ${cut} more in the view`] : []), ...lines.slice(lines.length - tail),
    ];
    const entries = unmeasured.map((k) => (unmeasuredWords ? `${k.symbol} ${k.date} (${k.words})` : `${k.symbol} ${k.date}`));
    const more = unmeasured.length - unmeasuredShown;
    const unmeasuredLine = unmeasured.length === 0 ? [] : [
      `unmeasured: ${[...entries.slice(0, unmeasuredShown), ...(more > 0 ? [`+${more} more`] : [])].join("; ")}`,
    ];
    return [
      first, clipped ? clip(view.title, CLIP.title) : view.title, ...anchors, ...spy, HEADER, ...rows, ...cases,
      ...unmeasuredLine, ...(flagsShown ? [FLAGS] : []), EVENT_SENTENCES,
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
