// face/plugins/analog/lib/digest.mjs
/**
 * The digest of a chart view: the few lines the model reads instead of the view, at most 2,048 bytes. Coverage
 * first, then the query's numbers, the counts, one row per group, the leading cases in the order the page shows them,
 * the cases still under way, and the three fixed sentences. When it does not fit, the under-way line gives its names
 * without dates, then is cut from the end with `+N more`, then is left out (line 3 still counts the cases); only then
 * do leading-case lines go from the end, followed by `… and N more in the view`. The fixed sentences are never cut.
 *
 * A percentage has one decimal, U+2212 for a negative and `+` for a positive, bare when it rounds to 0.0%; a ratio has
 * one decimal and `×`; a number the view does not have is `n/a`.
 */

/** @typedef {import("./chart-scan.mjs").ChartView} ChartView */
/** @typedef {import("./summary.mjs").Summary} Summary */

/** The most bytes a digest holds. */
export const DIGEST_MAX = 2048;

const SENTENCES =
  "These are today's large companies: failed and delisted ones are missing, so the picture leans favourable. " +
  "One market crash appears once per company: the cases are not independent. No lookahead guard: never evidence for a trade.";
const HEADER = "group  n  +5  +20  +60  [+60 quartiles]  further low (session)  ≥10% lower  higher at +60";
const GROUPS = /** @type {const} */ (["all", "own", "calm", "down"]);

/** @param {number | null | undefined} v */
function pct(v) {
  if (typeof v !== "number") return "n/a";
  const s = (v * 100).toFixed(1);
  if (s === "0.0" || s === "-0.0") return "0.0%";
  return s.startsWith("-") ? `−${s.slice(1)}%` : `+${s}%`;
}

/** @param {number | null | undefined} v */
const ratio = (v) => (typeof v === "number" ? `${v.toFixed(1)}×` : "n/a");

/** @param {number | null | undefined} v */
const whole = (v) => (typeof v === "number" ? `${Math.round(v * 100)}%` : "n/a");

/** @param {number | null | undefined} v */
const session = (v) => (typeof v === "number" ? String(Math.round(v)) : "n/a");

/** @param {number} n @param {string} one @param {string} many */
const counted = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** @param {string} name @param {Summary} s */
function groupRow(name, s) {
  if (!s.summarized) return `${name}  ${s.n}  too few to summarize`;
  return [
    name, String(s.n), pct(s.r5), pct(s.r20), pct(s.r60), `[${pct(s.r60q1)} … ${pct(s.r60q3)}]`,
    `${pct(s.low60)} (${session(s.lowAt)})`, whole(s.lower10), whole(s.up60),
  ].join("  ");
}

/**
 * The digest of a stored view.
 * @param {ChartView & { id: string }} view
 * @returns {string}
 */
export function chartDigest(view) {
  const { query: q, coverage: c } = view;
  const first = `read ${c.read} of ${c.asked} companies (${c.refused.length} refused, ${c.short.length} read short) · ` +
    `${c.stockDays} stock-days · view ${view.id}${c.deadline ? " · stopped at the deadline" : ""}`;
  const note = q.asOf !== null ? (q.sessionOpen ? " (as asked; session still open)" : " (as asked)")
    : q.sessionOpen ? " (session still open)"
    : q.readDate !== q.date ? ` (latest bar; read ${q.readDate})`
    : "";
  const second = `${q.symbol} as of ${q.date}${note}: ${pct(q.depth)} from the high of ${q.peakDate} in ${q.days} sessions; ` +
    `last 5 ${pct(q.last5)}; worst gap ${pct(q.gap)}; volume ${ratio(q.volume)}; market ${pct(q.market.change)} (${q.market.group})`;
  const pastCount = c.episodes - c.underWay;
  const dropped = view.parameters.dropped;
  const third = `matched ${counted(pastCount, "past sell-off", "past sell-offs")} in ${counted(c.weeks, "week", "weeks")}; ` +
    `${c.underWay} under way now; ${c.short60} short of 60 sessions; ${c.noContext} without market context` +
    (dropped.length > 0 ? `; dropped: ${dropped.join(", ")}` : "");
  const rows = GROUPS.map((g) => groupRow(g === view.queryGroup ? `${g} *` : g, view.groups[g]));

  const byId = new Map(view.cases.map((k) => [k.id, k]));
  const standsFor = new Map(view.leading.others.map((o) => [o.id, o.standsFor]));
  const leading = [...view.leading.own, ...view.leading.others.map((o) => o.id)]
    .map((id) => byId.get(id))
    .filter((k) => k !== undefined)
    .map((k) => {
      const n = standsFor.get(k.id) ?? 1;
      return `${k.symbol} ${k.date} ${pct(k.depth)}/${k.days}d → +60 ${pct(k.after.r60)}, low ${pct(k.after.low60)} ` +
        `(${session(k.after.lowAt)})${n > 1 ? ` · stands for ${n}` : ""}`;
    });
  const underWayCases = view.cases.filter((k) => k.state === "underWay");
  let underWay = underWayCases.map((k) => `${k.symbol} ${k.date}`);
  let underWayCut = 0;
  let underWayShown = underWay.length > 0;
  let leadingCut = 0;

  const compose = () => [
    first, second, third, HEADER, ...rows,
    ...(leading.length > 0 || leadingCut > 0
      ? ["leading cases (own first, then one per market event):", ...leading,
        ...(leadingCut > 0 ? [`… and ${leadingCut} more in the view`] : [])]
      : []),
    ...(underWayShown ? [`under way now: ${underWay.join(", ")}${underWayCut > 0 ? ` +${underWayCut} more` : ""}`] : []),
    SENTENCES,
  ].join("\n");
  let text = compose();
  const over = () => Buffer.byteLength(text) > DIGEST_MAX;
  // The under-way line gives way first, a step at a time: its dates, then names from the end, then the line itself
  // (line 3 still counts them); only then are leading cases cut, and the digest says how many more the view holds.
  if (over() && underWayShown) { underWay = underWayCases.map((k) => k.symbol); text = compose(); }
  while (over() && underWayShown && underWay.length > 1) { underWay.pop(); underWayCut++; text = compose(); }
  if (over() && underWayShown) { underWayShown = false; text = compose(); }
  while (over() && leading.length > 0) { leading.pop(); leadingCut++; text = compose(); }
  return text;
}
