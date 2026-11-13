// face/plugins/readthrough/lib/block.mjs
/**
 * The read-through's Chinese text block: the direction under an alert, or in a task with its event and sources, its
 * tape stamped by feed and New York minute - and by New York date too, `MM-DD`, for a print of another day than now;
 * and the one line a later alert writes for a direction already given, re-pricing each rival from the print recorded
 * with it, dated the same way when it was given on an earlier day.
 */

/**
 * What the block reads of a direction (`args.mjs`'s `Direction`); its certainty is one of `high`, `medium` and `low`,
 * as `checkArgs` let it through.
 * @typedef {Pick<import("./args.mjs").Direction, "event" | "sources" | "logic" | "peers" | "noDirection" | "counter">
 *   & { certainty: string }} Shown
 */
/** @typedef {{ symbol: string, changePct: number | null, feed: string, asOf: string | null, traded: boolean }} Print */

/**
 * Every label the block and the later line write: `head`, the word that opens them (`推演`), and the others, each
 * followed by a full-width colon at a line's start. The one list: `args.mjs` refuses each in every text from it, so a
 * label added here is refused there with no second edit.
 */
export const LABELS = Object.freeze({ head: "推演", event: "事件", logic: "逻辑", direction: "方向", tape: "盘面", counter: "反方", sources: "来源" });

const MINUS = "−";
/** @type {Readonly<Record<string, string>>} */
const CERTAINTY = Object.freeze({ high: "高", medium: "中", low: "低" });
const MINUTE = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

/**
 * A percentage with one decimal, `+` or U+2212 in front, and `0.0%` with no sign.
 * @param {number} x
 * @returns {string}
 */
export function pctText(x) {
  // Rounded half away from zero on twelve significant digits, so that 1.25 computed as 1.2499999999999998 is 1.3.
  const digits = (Math.round(Number(Math.abs(x).toPrecision(12)) * 10) / 10).toFixed(1);
  if (digits === "0.0") return "0.0%";
  return `${x < 0 ? MINUS : "+"}${digits}%`;
}

/**
 * An instant's New York minute, 24-hour (`04:03`).
 * @param {string} iso
 * @returns {string}
 */
export function etMinute(iso) {
  return MINUTE.format(new Date(iso));
}

/**
 * An instant's New York time as a stamp shows it: its minute (`04:03`), after its date (`11-06 19:58`) when its New
 * York day is not `now`'s.
 * @param {string} iso
 * @param {string} now
 */
function etWhen(iso, now) {
  const day = DAY.format(new Date(iso));
  return day === DAY.format(new Date(now)) ? etMinute(iso) : `${day.slice(5)} ${etMinute(iso)}`;
}

/**
 * A print's stamp: its feed upper-cased and, when it has one, its New York time, dated when of another day than now.
 * @param {Print} p
 * @param {string} now
 */
function stamp(p, now) {
  return p.asOf === null ? p.feed.toUpperCase() : `${p.feed.toUpperCase()} ${etWhen(p.asOf, now)} ET`;
}

/**
 * The tape line's body: each print with its figure when it traded, `未成交` otherwise; one stamp at the end when every
 * print has a figure of the same feed and minute, else each figure its own.
 * @param {Print[]} tape
 * @param {boolean} shut
 * @param {string} now
 */
function tapeText(tape, shut, now) {
  if (shut) return "休市，事件之后还没有成交";
  const figured = (/** @type {Print} */ p) => p.traded && typeof p.changePct === "number";
  const stamps = new Set(tape.map((p) => (figured(p) ? stamp(p, now) : null)));
  const shared = tape.length > 0 && stamps.size === 1 && !stamps.has(null);
  const entries = tape.map((p) => {
    if (!figured(p)) return `${p.symbol} 未成交`;
    const figure = `${p.symbol} ${pctText(/** @type {number} */ (p.changePct))}`;
    return shared ? figure : `${figure}（${stamp(p, now)}）`;
  });
  return shared ? `${entries.join(" · ")}（${[...stamps][0]}）` : entries.join(" · ");
}

/**
 * The block: under an alert, the head, logic, direction, tape and counter; for a task, the event after the head and
 * the sources last. A direction with no rival is one line, with the event and sources after it for a task. `now`, an ISO
 * instant, is the day a print's stamp is dated against.
 * @param {{ direction: Shown, tape: Print[], shut: boolean, forTask: boolean, now: string }} args
 * @returns {string}
 */
export function renderBlock({ direction: d, tape, shut, forTask, now }) {
  const event = `· ${LABELS.event}：${d.event}`;
  const sources = `${LABELS.sources}：${d.sources.join(" · ")}`;
  if (d.peers.length === 0) {
    const line = `${LABELS.head}：没有方向 —— ${d.noDirection}`;
    return (forTask ? [line, event, sources] : [line]).join("\n");
  }
  const lines = [
    `${LABELS.head} · Gravit 的推断，不是下单 · 确定度 ${CERTAINTY[d.certainty]}`,
    ...(forTask ? [event] : []),
    `· ${LABELS.logic}：${d.logic}`,
    `· ${LABELS.direction}：${d.peers.map((p) => `做多 ${p.symbol}（${p.reason}）`).join("；")}`,
    `· ${LABELS.tape}：${tapeText(tape, shut, now)}`,
    `· ${LABELS.counter}：${d.counter}`,
    ...(forTask ? [sources] : []),
  ];
  return lines.join("\n");
}

/**
 * A later alert's line for a direction already given: each rival with its move since the print recorded with it,
 * no figure without both prints; null when the direction named no rival. When it was given is dated when of another New
 * York day than `now`, an ISO instant.
 * @param {{ givenAt: string, now: string, peers: { symbol: string, then: number | null, now: number | null }[] }} args
 * @returns {string | null}
 */
export function renderLater({ givenAt, now: at, peers }) {
  if (peers.length === 0) return null;
  const parts = peers.map(({ symbol, then, now }) =>
    typeof then === "number" && then > 0 && typeof now === "number"
      ? `做多 ${symbol}，此后 ${pctText((now / then - 1) * 100)}`
      : `做多 ${symbol}`,
  );
  return `${LABELS.head}（${etWhen(givenAt, at)} ET 已给）：${parts.join("；")}`;
}
