// face/plugins/analog/lib/event-digest.mjs
/**
 * The digest of an event view: the few lines the model reads instead of the view, at most 2,048 bytes. Coverage first,
 * then the title, one line per anchor of the present case, the market's refusal when its bars were not read, one row
 * per group and `all` against the market, the measured cases in the view's order, the unmeasured ones with the words
 * that say why, what the flags mean, and the fixed sentences.
 *
 * When it does not fit, every note goes first; then the unmeasured line is cut from its end to `+N more`; then case
 * lines leave from the middle of the order, so the first and the last stay longest, with `… and N more in the view`
 * where they left; then the flags' line goes. Coverage, the title, the anchors, the market's refusal, the group rows
 * and the fixed sentences are never cut. Numbers are written as the chart digest writes them. The view is not changed.
 */
import { DIGEST_MAX, pct, ratio, whole } from "./digest.mjs";

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

/** @param {string} name @param {EventSummary} s */
function groupRow(name, s) {
  if (s.x0 === null) return `${name}  ${s.n}  too few to summarize`;
  return [
    name, String(s.n), pct(s.x0), pct(s.x1), pct(s.x5), pct(s.x20), pct(s.x60), `[${pct(s.x60q1)} … ${pct(s.x60q3)}]`,
    whole(s.down0), whole(s.down60),
  ].join("  ");
}

/**
 * One anchor of the present case.
 * @param {string} symbol @param {Anchor} a @param {NonNullable<EventsView["query"]>} q
 */
function anchorLine(symbol, a, q) {
  const head = `${symbol} ${a.label} ${a.date} ${a.timing}`;
  if (a.state !== "measured" || a.measure === null) return `${head}: unmeasured (${a.words})`;
  const m = a.measure;
  const open = a.day0 === q.latest && q.sessionOpen ? " (session still open)" : "";
  return `${head} → day 0 ${a.day0}${open}: gap ${pct(m.gap)}; day 0 ${pct(m.r0)} (${pct(m.x0)} vs market); ` +
    `+1 ${pct(m.x1)}; +5 ${pct(m.x5)}; volume ${ratio(a.tape?.vol0)}; ${m.sessionsAfter} sessions since`;
}

/**
 * One measured case, with its note when `withNote`.
 * @param {EventCase} c @param {boolean} withNote
 */
function caseLine(c, withNote) {
  const m = /** @type {NonNullable<EventCase["measure"]>} */ (c.measure);
  const label = Array.from(c.label).slice(0, LABEL_MAX).join("");
  return `${c.group}: ${c.symbol} ${c.day0} ${label} day 0 ${pct(m.x0)}; +5 ${pct(m.x5)}; +60 ${pct(m.x60)}` +
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
  const anchors = q === null ? [] : q.anchors.map((a) => anchorLine(q.symbol, a, q));
  const spy = c.market.words !== null ? [`SPY could not be read: ${c.market.words}`] : [];
  const rows = [...view.groups.named.map((g) => groupRow(g.name, g.summary)), groupRow("all", view.groups.all)];

  const measured = view.cases.filter((k) => k.state === "measured" && k.measure !== null);
  const unmeasured = view.cases.filter((k) => k.state === "unmeasured").map((k) => `${k.symbol} ${k.date} (${k.words})`);
  const flagged = measured.some((k) => k.flags.includes("quiet") || k.flags.includes("elsewhere"));

  let notes = true;
  let unmeasuredShown = unmeasured.length;
  // The case lines shown are the first `head` and the last `tail` of the order; the ones between have left.
  let head = Math.ceil(measured.length / 2);
  let tail = measured.length - head;
  let flagsShown = flagged;

  const compose = () => {
    const lines = measured.map((k) => caseLine(k, notes));
    const cut = measured.length - head - tail;
    const cases = measured.length === 0 ? [] : [
      CASES, ...lines.slice(0, head), ...(cut > 0 ? [`… and ${cut} more in the view`] : []), ...lines.slice(lines.length - tail),
    ];
    const more = unmeasured.length - unmeasuredShown;
    const unmeasuredLine = unmeasured.length === 0 ? [] : [
      `unmeasured: ${[...unmeasured.slice(0, unmeasuredShown), ...(more > 0 ? [`+${more} more`] : [])].join("; ")}`,
    ];
    return [
      first, view.title, ...anchors, ...spy, HEADER, ...rows, ...cases, ...unmeasuredLine,
      ...(flagsShown ? [FLAGS] : []), EVENT_SENTENCES,
    ].join("\n");
  };
  let text = compose();
  const over = () => Buffer.byteLength(text) > DIGEST_MAX;
  if (over()) { notes = false; text = compose(); }
  while (over() && unmeasuredShown > 0) { unmeasuredShown--; text = compose(); }
  while (over() && head + tail > 0) {
    if (head > tail) head--; else tail--;
    text = compose();
  }
  if (over() && flagsShown) { flagsShown = false; text = compose(); }
  return text;
}
