/** The standing orders and the day's token budget as the Desk panel shows them
 * (desk-panel.js draws the card): what `GET /data/desk/status` answers in -
 * its `budget` (src/desk.ts `BudgetState`) and, while their clock runs, its
 * `standing` (src/standing.ts `StandingStatus`) - and the card's words out.
 *
 * No DOM, no network, no state - a module apart from the panel for the reason
 * speaker.js and summaries.js are: the words have to be drillable without a
 * browser.
 *
 * THE WORDS are the terminal's and the phone's (src/desk.ts `budgetLine` and
 * `standingLines`), less the `standing orders` the card's title already says,
 * as the panel's pause line is the status line less its `desk:`. The budget
 * line whole; a banner, a line for each thing that stops every order or leaves
 * the day without a calendar; for each order its next anchor - or the state
 * that holds it - its pins, and its last firing; the recent firings, the
 * status's ten newest, each with its wall time, its tokens (the four buckets'
 * plain sum) and the files its turn wrote.
 *
 * THE NAMES ({@link firingTitles}). A firing's session is a desk session like
 * any other in the session list, and dsh titles it from its first message, the
 * wake message - so the panel and the page name it `<order> · <date>` from the
 * status, before its own title (desk-panel.js `deskTitle`).
 *
 * Times are New York's, as the desk shows them everywhere (src/et.ts): `14:03 ET`
 * on the same New York date as now, dated on any other - a recent firing's
 * `when` without its ` ET`, which the card adds. They are written through
 * desk-time.js, as the rest of the panel's are.
 * @module
 */
import { EM, deskStamp, deskTime, isRecord } from "./desk-time.js";

/** The card's line for a book with no order in it: the terminal's words, less their `standing orders:`. */
export const NONE_ARMED = "none armed (npm run desk -- arm)";

/** How many characters of a refused `standing.yml`'s errors the banner quotes, as its status line does. */
const REFUSED_SHOWN_MAX = 200;

/** The recent firings the card lists: the status's own bound (src/standing.ts `StandingStatus.recent`). */
const RECENT_MAX = 10;

/** A turn's four token buckets (src/desk.ts `TurnUsage`), whose plain sum is its tokens. */
const BUCKETS = Object.freeze(["uncachedInputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"]);

/* ---------- the parts ---------- */

/** @param {unknown} at @returns {Date|undefined} a time the status holds, ISO-8601, as a Date - no time for anything but a string. */
const dateOf = (at) => (typeof at === "string" ? new Date(at) : undefined);

/** @param {unknown} n @returns {n is number} a count: finite, not below zero. */
const isCount = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0;

/** @param {unknown} value @returns {any[]} `value` when it is a list, else none. */
const listOf = (value) => (Array.isArray(value) ? value : []);

/** @param {unknown} value @returns {string} `value` when it is a string, else `—`. */
const textOf = (value) => (typeof value === "string" ? value : EM);

/** @param {string} text @param {number} max @returns {string} `text` cut to `max` characters (code points), the last a `…` when it is cut. */
function cut(text, max) {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("")}…`;
}

/**
 * The budget line (src/desk.ts `budgetLine`): the tokens used today, against the
 * cap when there is one, `spent` once it is reached, and the ledger's error when
 * it could not be read; `budget: —` for a status that carries no budget.
 * @param {Record<string, any>|undefined} budget @returns {string}
 */
function budgetText(budget) {
  const total = budget?.used?.total;
  if (!isCount(total)) return `budget: ${EM}`;
  const used = total.toLocaleString("en-US");
  const cap = isCount(budget?.dailyTokens) ? budget.dailyTokens.toLocaleString("en-US") : undefined;
  const line = cap === undefined
    ? `budget: ${used} tokens today, cap not set (budget.dailyTokens in standing.yml)`
    : budget?.spent === true
      ? `budget: spent, ${used} of ${cap} tokens today; standing orders and phone turns wait for 00:00 ET`
      : `budget: ${used} of ${cap} tokens today`;
  return typeof budget?.error === "string" ? `${line} (ledger unreadable: ${budget.error})` : line;
}

/**
 * What stops every order, or leaves the day without a calendar, a line each - a
 * refused `standing.yml`, its errors cut at 200 characters; a firing ledger that
 * cannot be read; no calendar today - or `undefined` while none holds.
 * @param {Record<string, any>} standing @returns {string|undefined}
 */
function bannerOf(standing) {
  const lines = [];
  if (standing.file?.state === "refused") {
    const errors = listOf(standing.file.errors).filter((error) => typeof error === "string");
    lines.push(`stopped: standing.yml is refused: ${cut(errors.join("; "), REFUSED_SHOWN_MAX)}`);
  }
  if (isRecord(standing.ledger)) lines.push(`stopped: the firing ledger cannot be read (${standing.ledger.error})`);
  const calendar = standing.calendar;
  if (calendar?.state === "failed") lines.push(`no calendar today, ${calendar.python}: ${calendar.error ?? "no reason given"}`);
  return lines.length === 0 ? undefined : lines.join("\n");
}

/**
 * When an order next fires, or what holds it: its firing running, the order
 * disabled or expired, else its next anchor, or that the calendar's window holds
 * no session for it. A firing's key is `<id>:<date>`, and an id holds no `:`.
 * @param {Record<string, any>} order @param {unknown} running @param {Date} now @returns {string}
 */
function nextOf(order, running, now) {
  if (isRecord(running) && typeof running.key === "string" && running.key.startsWith(`${order.id}:`)) return `running since ${deskTime(dateOf(running.startedAt), now)}`;
  if (order.enabled === false) return "disabled";
  if (order.expired === true) return `expired after ${order.expires}`;
  if (typeof order.nextAnchor === "string") return `next ${deskTime(dateOf(order.nextAnchor), now)}`;
  return "no session in the calendar's window";
}

/**
 * An order's pins: `ok` while its text's - and its script's, when it runs one -
 * match the files; the first that moved or is gone, with the way back; `unknown`
 * while one is not checked yet, which claims nothing.
 * @param {Record<string, any>} order @returns {string}
 */
function hashOf(order) {
  const rearm = `changed since arming (npm run desk -- rearm ${order.id})`;
  const text = `${order.dir}/${order.file}`;
  if (order.hash === "changed") return `${text} ${rearm}`;
  if (order.hash === "missing") return `${text} is missing`;
  const script = typeof order.producer === "string" ? order.producer : "its producer";
  if (order.producerHash === "changed") return `${script} ${rearm}`;
  if (order.producerHash === "missing") return `${script} is missing`;
  return order.hash === "ok" && (order.producerHash === undefined || order.producerHash === "ok") ? "ok" : "unknown";
}

/** @param {unknown} ms @returns {string} a wall time: `42s`, `4m 12s`, `1h 2m`; `—` for none. */
function wallOf(ms) {
  if (!isCount(ms)) return EM;
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

/** @param {unknown} usage @returns {string} a turn's tokens, its four buckets' plain sum as `en-US` writes it; `—` for no usage. */
function tokensOf(usage) {
  if (!isRecord(usage)) return EM;
  return BUCKETS.reduce((sum, bucket) => sum + (isCount(usage[bucket]) ? usage[bucket] : 0), 0).toLocaleString("en-US");
}

/* ---------- the view ---------- */

/**
 * The standing orders' card in words.
 * @typedef {object} StandingView
 * @property {string} budget - the budget line, the terminal's and the phone's.
 * @property {boolean} spent - whether the day's cap is reached: the card says it in the needs-you colour.
 * @property {string} [banner] - what stops every order or leaves the day without a calendar, a line each; absent while none holds.
 * @property {{id: string, at: string, next: string, hash: string, last: string}[]} orders - the last good load's, in file order.
 * @property {{when: string, order: string, date: string, outcome: string, wall: string, tokens: string, files: string, sessionId?: string}[]} recent -
 *   the newest first, at most ten; `sessionId` present when the firing woke a session.
 */

/**
 * The standing orders' card from the desk's status: the budget line; the
 * banner; each order's anchor, next anchor or state (`next 12:30 ET`, `disabled`),
 * pins (`ok`, `unknown`, or the one that moved) and last firing (`last delivered
 * 15:31 ET`, or `no firing yet`); and the recent firings. A status without the
 * standing orders - no clock runs - is the budget line alone: no banner, no
 * orders, no firings.
 * @param {Record<string, any>} status - what `GET /data/desk/status` answered.
 * @param {string} nowIso - when it is read, ISO-8601: what today is in New York.
 * @returns {StandingView}
 */
export function standingView(status, nowIso) {
  const now = new Date(nowIso);
  const budget = isRecord(status?.budget) ? status.budget : undefined;
  const standing = isRecord(status?.standing) ? status.standing : undefined;
  const banner = standing === undefined ? undefined : bannerOf(standing);
  const orders = listOf(standing?.orders).filter((order) => isRecord(order) && typeof order.id === "string").map((order) => ({
    id: order.id,
    at: textOf(order.at),
    next: nextOf(order, standing?.running, now),
    hash: hashOf(order),
    last: isRecord(order.last) ? `last ${textOf(order.last.outcome)} ${deskTime(dateOf(order.last.t), now)}` : "no firing yet",
  }));
  const recent = listOf(standing?.recent).filter(isRecord).slice(0, RECENT_MAX).map((firing) => ({
    when: deskStamp(dateOf(firing.t), now),
    order: textOf(firing.order),
    date: textOf(firing.date),
    outcome: textOf(firing.outcome),
    wall: wallOf(firing.wallMs),
    tokens: tokensOf(firing.usage),
    files: isCount(firing.files) ? String(firing.files) : EM,
    ...(typeof firing.sessionId === "string" && firing.sessionId !== "" ? { sessionId: firing.sessionId } : {}),
  }));
  return { budget: budgetText(budget), spent: budget?.spent === true, ...(banner === undefined ? {} : { banner }), orders, recent };
}

/**
 * The firing sessions' names, `<order> · <date>`, by session id: every firing
 * the status names that woke a session - the recent ones, each order's last,
 * and the one running now (its key is `<order>:<date>`). A status without the
 * standing orders names none.
 * @param {unknown} standing - the status's `standing`.
 * @returns {Record<string, string>}
 */
export function firingTitles(standing) {
  if (!isRecord(standing)) return {};
  /** @param {unknown} id @returns {id is string} */
  const isId = (id) => typeof id === "string" && id !== "";
  const firings = [...listOf(standing.recent), ...listOf(standing.orders).map((order) => order?.last)];
  /** @type {[string, string][]} */
  const named = firings.flatMap((f) => (isRecord(f) && isId(f.sessionId) && typeof f.order === "string" && typeof f.date === "string"
    ? [[f.sessionId, `${f.order} · ${f.date}`]] : []));
  const running = standing.running;
  const colon = typeof running?.key === "string" ? running.key.indexOf(":") : -1;
  if (isRecord(running) && isId(running.sessionId) && colon > 0) named.push([running.sessionId, `${running.key.slice(0, colon)} · ${running.key.slice(colon + 1)}`]);
  return Object.fromEntries(named);
}
