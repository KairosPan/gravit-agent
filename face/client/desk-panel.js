/** The Desk panel: the always-on desk at a glance, in the chat page's sidebar
 * (`#panel-desk`, the rail's first item) - what `GET /data/desk/status`
 * answers, drawn as named sections; the Pause control, which posts
 * `POST /data/desk/pause`; the desk's sessions, which open in place, each with
 * the waiting chip while a card waits in it; and the badge on the rail's Desk
 * item while another panel is shown. Also the desk's marks in the transcript
 * that chat.js places: the glyphs of its three message sources
 * ({@link DESK_GLYPHS}), the who-line over a phone message
 * ({@link phoneWhoNode}), and a firing's or an alert's line and its words
 * ({@link deskLineNode}, {@link deskLineText}).
 *
 * WHY A MODULE OF ITS OWN. Another branch replaces `face/client` with a new
 * client, and whichever of the two lands second ports the Desk panel - so
 * everything the panel is lives here, and chat.js only hooks it in
 * ({@link createDeskPanel}): it hands over `panelData`, the session list, the
 * session on screen, `openSession`, whether a card waits in a session
 * (`needsYou`), whether a session is archived and the rail's Desk item; and it
 * calls `show` and `hide` as the panel comes on screen and goes, `syncSessions`
 * when the list moves - a gate's arrival or settling schedules that too - and
 * `mark` when the session on screen changes.
 *
 * NAMED SECTIONS. The status is drawn as one card per entry of
 * {@link SECTIONS}, in order: the desk (on or off, up how long, the pause and
 * its control), the Telegram bridge, the desk conversation, today's desk turns
 * and their tokens, the standing orders and the day's budget, and the desk's
 * sessions. A later block - P3's watch - is one more entry there. A section
 * that reads the status is left out while there is none, so a status that
 * cannot be read still leaves the desk's own section - its Pause control - and
 * the sessions on screen; the standing orders' card is left out, too, while the
 * status carries neither the day's budget nor the standing orders. Each card is
 * kept across redraws, and stays on the page when the
 * sections around it come and go; the desk's own card keeps its Pause row
 * itself, built once, so neither a redraw of the sessions when the list moves
 * nor the status read again every {@link DESK_POLL_MS} while the panel is shown
 * touches the control under the operator's hand.
 *
 * THE STANDING ORDERS. Their card (desk-standing.js puts it in words) lists
 * the recent firings, and one that woke a session opens it in place, where its
 * last message is read. A firing's session is one of the desk's sessions, and
 * the panel names it `<order> · <date>` from the last status read
 * ({@link deskTitle}) - the page too, through the panel's `titles`.
 *
 * THE PAUSE. The panel only pauses, as the phone does: 30 minutes, 2 hours,
 * 1 day, or until a resume (no `until`). A pause from here never shortens one in
 * force (src/desk.ts `writeOff`), so what the panel shows after a click is the
 * pause the face ANSWERED with - possibly a longer one that stood - never the
 * one asked for. Only a terminal resumes (`npm run desk -- resume`): while the
 * desk is paused the panel says so in one line, and it offers no resume.
 *
 * Times are New York's, as the desk shows them everywhere (src/et.ts): `14:03 ET`
 * on the same New York date as now, dated on any other - written through
 * desk-time.js, which the standing orders' card writes its times through too,
 * and whose {@link deskTime} this module hands on. Every string reaches
 * the page through `textContent`; nothing here parses HTML.
 * @module
 */
import { NONE_ARMED, firingTitles, standingView } from "./desk-standing.js";
import { EM, deskTime, isRecord, isTime, nyDate } from "./desk-time.js";
import { isDeskPreset } from "./speaker.js";

/** The panel's times, from desk-time.js: the page and the tests read them here. */
export { deskTime };

/** The glyph each of the desk's message sources carries in the transcript: the
 * operator's phone over their own bubble, the face's clock and watch on a desk line. */
export const DESK_GLYPHS = Object.freeze({ telegram: "☎", schedule: "⧗", alert: "⚑" });

/** The pause lengths the panel offers, as `POST /data/desk/pause` spells them;
 * `""` is until a resume, sent with no `until` at all. The first is the default. */
export const PAUSE_CHOICES = Object.freeze([
  Object.freeze({ until: "30m", label: "30 minutes" }),
  Object.freeze({ until: "2h", label: "2 hours" }),
  Object.freeze({ until: "1d", label: "1 day" }),
  Object.freeze({ until: "", label: "until resumed" }),
]);

/** The terminal command that lifts a pause - the only thing that does. */
export const RESUME_COMMAND = "npm run desk -- resume";

/** The words before it on the resume line. */
const RESUME_PREFIX = "a terminal resumes it: ";

/** The one line the panel shows while the desk is paused - the phone's words for it
 * (src/telegram.ts `RESUMES`): the page has no resume control. Drawn with the
 * command in an element of its own, which chat.css keeps from wrapping at `--`. */
export const RESUME_LINE = `${RESUME_PREFIX}${RESUME_COMMAND}`;

/** How often the status is read again while the Desk panel is shown: often enough that a
 * pause past its `until` stops showing as one, the face's status having dropped it. */
export const DESK_POLL_MS = 30_000;

/* ---------- the desk's sessions and lines ---------- */

/**
 * The desk's sessions in a session list, in its order: every row whose
 * `agentPreset` (restored by summaries.js) is the desk's - the desk
 * conversation, the conversations before it, and the desk's firings - but an
 * archived one, which the strategy list's archived bucket lists instead
 * (grouping.js: archived comes before the desk), so it is listed once.
 * @param {unknown[]} sessions - chat.js's `lastSessions`.
 * @param {(sessionId: string) => boolean} [archived] - whether a session is archived; none is by default.
 * @returns {Record<string, any>[]}
 */
export function deskSessionsOf(sessions, archived = () => false) {
  return (Array.isArray(sessions) ? sessions : []).filter((s) =>
    s !== null && typeof s === "object" && typeof s.sessionId === "string" && isDeskPreset(s.agentPreset) && !archived(s.sessionId));
}

/**
 * A desk session's name: a firing's `<order> · <date>` when `titles` names it
 * (desk-standing.js `firingTitles`), else its title, else `Desk · <YYYY-MM-DD>` -
 * the New York date of its last update, the one date a list row carries (it has
 * no creation time) - else `Desk`. The firing's name comes first because dsh
 * titles every fresh session from its first message, so a firing's session
 * always has a title - the wake message's leading words, then a model's summary
 * of them - and a name after it would never show.
 * @param {Record<string, any>} summary - a list row.
 * @param {Record<string, string>} [titles] - the firing sessions' names, by session id; none by default.
 * @returns {string}
 */
export function deskTitle(summary, titles = {}) {
  const id = summary?.sessionId;
  if (typeof id === "string" && Object.hasOwn(titles, id)) return titles[id];
  const title = summary?.projections?.values?.title;
  if (typeof title === "string" && title !== "") return title;
  const at = typeof summary?.updatedAt === "number" ? new Date(summary.updatedAt) : undefined;
  return isTime(at) ? `Desk · ${nyDate(/** @type {Date} */ (at))}` : "Desk";
}

/**
 * The words of a desk line (mapper.js `desk-line`): `schedule · <order> · <date>`
 * for a firing, `alert · <SYMBOL> · <alert id>` for an alert - a field the
 * source lacked left out.
 * @param {Record<string, any>} view @returns {string}
 */
export function deskLineText(view) {
  const line = typeof view?.line === "string" && view.line !== "" ? view.line : "desk";
  const parts = line === "schedule" ? [view.order, view.date] : line === "alert" ? [view.symbol, view.alert] : [];
  return [line, ...parts.filter((part) => typeof part === "string" && part !== "")].join(" · ");
}

/* ---------- drawing ---------- */

/**
 * Build one element. Text goes through `textContent` only.
 * @param {string} tag @param {string|null} [cls] @param {string} [text] @returns {any}
 */
function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** @param {string} text @param {boolean} [bad] @returns {any} one panel note. */
const note = (text, bad = false) => el("div", bad ? "sp-note err" : "sp-note", text);

/** @param {string} text @param {string} cls @param {() => void} onClick @returns {any} */
function button(text, cls, onClick) {
  const node = el("button", cls, text);
  node.type = "button";
  node.addEventListener("click", () => onClick());
  return node;
}

/** A card's title row: the title, then whatever the section puts beside it.
 * @param {any} card @param {string} title @param {...any} extras @returns {any} */
function head(card, title, ...extras) {
  const row = el("div", extras.length > 0 ? "sp-title sp-title-row" : "sp-title");
  row.append(el("span", null, title), ...extras);
  card.append(row);
  return row;
}

/** One `label → value` line, `tone` a class on the value (`bad`).
 * @param {any} card @param {string} label @param {string} value @param {string} [hint] @param {string} [tone] */
function kv(card, label, value, hint, tone) {
  const row = el("div", "sp-kv");
  if (hint) row.title = hint;
  row.append(el("span", "sp-k", label), el("span", tone ? `sp-v ${tone}` : "sp-v", value));
  card.append(row);
}

/** @param {string} text @param {string} [hint] @param {string} [cls] @returns {any} one status chip. */
function chip(text, hint, cls) {
  const node = el("span", cls ? `chip ${cls}` : "chip", text);
  if (hint) node.title = hint;
  return node;
}

/** The sidebar's "this session is waiting on you" chip (chat.js `waitingChip`'s look). @returns {any} */
const waitingChip = () => chip("waiting", "a card is waiting on you in this session", "waiting");

/* ---------- the transcript's desk marks (chat.js places them) ---------- */

/**
 * The who-line over a message from the operator's phone: the phone glyph and
 * `phone`, in the operator's lane, as a bot's avatar and name sit over its
 * answer. chat.js `bubbleNode` puts it over the bubble.
 * @returns {any}
 */
export function phoneWhoNode() {
  const who = el("div", "who phone-who");
  who.title = "sent from your phone, through the desk's Telegram bridge";
  const glyph = el("span", "phone-glyph", DESK_GLYPHS.telegram);
  glyph.setAttribute("aria-hidden", "true");
  who.append(glyph, el("span", "who-name", "phone"));
  return who;
}

/**
 * A firing of the desk's clock or an alert of its watch (mapper.js
 * `desk-line`): the face's words, no operator's, as one quiet line like a
 * room's - its glyph, {@link deskLineText}, and the message the desk was sent
 * on hover. chat.js `accept` places it.
 * @param {Record<string, any>} view @returns {any}
 */
export function deskLineNode(view) {
  const line = view?.line;
  const node = el("div", "room-line desk-line");
  const glyph = el("span", "desk-glyph", typeof line === "string" && Object.hasOwn(DESK_GLYPHS, line) ? DESK_GLYPHS[line] : "");
  glyph.setAttribute("aria-hidden", "true");
  node.append(glyph, el("span", "room-line-text", deskLineText(view)));
  node.title = typeof view?.text === "string" && view.text !== "" ? view.text : EM;
  return node;
}

/** @param {unknown} n @returns {string} a count, `—` when it is none. */
const count = (n) => (typeof n === "number" && Number.isFinite(n) ? String(n) : EM);

/** @param {unknown} n @returns {string} tokens as 812 / 4.1k / 236k (chat.js `fmtTokens`). */
function fmtTokens(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return EM;
  if (n < 1000) return String(n);
  const k = n / 1000;
  return `${k >= 100 ? Math.round(k) : k.toFixed(1)}k`;
}

/** @param {unknown} ms @returns {string} an uptime as `3h 12m`. */
function upFor(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return EM;
  return `${Math.floor(ms / 3_600_000)}h ${Math.floor(ms / 60_000) % 60}m`;
}

/** @param {unknown} err @returns {string} */
const messageOf = (err) => (err instanceof Error ? err.message : String(err));

/** Whether `value` is a pause as the face writes one (src/desk.ts `OffState`).
 * @param {any} value @returns {boolean} */
function isOffState(value) {
  return value !== null && typeof value === "object" && typeof value.setAt === "string" && typeof value.by === "string"
    && (value.until === undefined || typeof value.until === "string");
}

/**
 * The pause as the panel says it - the terminal's and the phone's words for it
 * (src/desk.ts `deskStatusLines`): `not paused`, or `paused since 14:03 ET by
 * page until 16:03 ET`, with no `until` for a pause that lasts until a resume.
 * @param {{setAt: string, by: string, until?: string}|undefined} off
 * @param {Date} now @returns {string}
 */
function pauseText(off, now) {
  if (off === undefined) return "not paused";
  const until = typeof off.until === "string" ? ` until ${deskTime(new Date(off.until), now)}` : "";
  return `paused since ${deskTime(new Date(off.setAt), now)} by ${off.by}${until}`;
}

/**
 * What a section draws from: the last status (`undefined` while there is none,
 * `error` saying why), the clock, the list and its desk sessions, the session on
 * screen, the Pause control's state, and the panel's actions.
 * @typedef {object} DrawContext
 * @property {Record<string, any>|undefined} status
 * @property {string|undefined} error
 * @property {Date} now
 * @property {Record<string, any>[]} list - the whole session list.
 * @property {Record<string, any>[]} sessions - its desk sessions, the archived ones left out.
 * @property {Record<string, string>} titles - the firing sessions' names, from the last status read ({@link deskTitle}).
 * @property {(sessionId: string) => boolean} waiting - whether a card waits on the operator in a session.
 * @property {string|null} active
 * @property {string} choice
 * @property {boolean} pausing
 * @property {string|undefined} pauseError
 * @property {Map<string, any>} rows - the session rows drawn, by session id.
 * @property {() => void} refresh
 * @property {() => void} pause
 * @property {(until: string) => void} choose
 * @property {(sessionId: string|null) => void} select
 * @property {(sessionId: string) => void} open
 */

/**
 * The desk section's parts, by its card, built on the card's first draw: its
 * title row, the status lines under it, the Pause row and the line under that.
 * `ctx` is the last draw's: the title's ↻ and the Pause row's handlers act
 * through it.
 * @type {WeakMap<any, {info: any, row: any, select: any, go: any, after: any, ctx: DrawContext}>}
 */
const deskParts = new WeakMap();

/** The desk's own section: on or off, up how long, an unreadable ledger, the
 * pause in force, and the Pause control - drawn with or without a status.
 * It keeps its card ({@link SECTIONS}' `keeps`): the title row and the Pause
 * row are built on the card's first draw and never again - a redraw, the 30 s
 * poll's included, redraws the lines between and after them, and sets the
 * button's label and state and the select's value only where they changed, so
 * a dropdown the operator holds open stays open, and the focus stays where it is.
 * @param {any} card @param {DrawContext} ctx */
function drawDesk(card, ctx) {
  let parts = deskParts.get(card);
  if (parts === undefined) {
    const refresh = button("↻", "sp-title-btn desk-refresh", () => parts.ctx.refresh());
    refresh.title = "read the desk's status again";
    refresh.setAttribute("aria-label", "refresh the desk's status");
    head(card, "desk", refresh);
    const info = el("div", "desk-info");
    const row = el("div", "desk-pause");
    const select = el("select", "picker-input desk-pause-until");
    select.setAttribute("aria-label", "pause the desk for");
    for (const { until, label } of PAUSE_CHOICES) {
      const option = el("option", null, label);
      option.value = until;
      option.selected = until === ctx.choice;
      select.append(option);
    }
    select.value = ctx.choice;
    select.addEventListener("change", () => parts.ctx.choose(select.value));
    const go = button("Pause", "picker-btn desk-pause-btn", () => parts.ctx.pause());
    go.title = "pause the desk; only a terminal resumes it";
    row.append(select, go);
    const after = el("div", "desk-pause-after");
    card.append(info, row, after);
    parts = { info, row, select, go, after, ctx };
    deskParts.set(card, parts);
  }
  parts.ctx = ctx;
  const { info } = parts;
  info.replaceChildren();
  const { status } = ctx;
  if (status === undefined) {
    info.append(note(`desk status: ${ctx.error ?? "not read yet"}`, true));
  } else {
    const enabled = status.desk?.enabled;
    kv(info, "desk", enabled === true ? "on" : enabled === false ? "off (FACE_DESK=0)" : EM);
    kv(info, "up", upFor(status.uptimeMs), typeof status.bootedAt === "string" ? `since ${status.bootedAt}` : undefined);
    if (typeof status.ledgerError === "string") info.append(note(`ledger unreadable: ${status.ledgerError}`, true));
    const off = isOffState(status.off) ? status.off : undefined;
    info.append(el("div", off === undefined ? "desk-pause-line" : "desk-pause-line paused", pauseText(off, ctx.now)));
    if (off !== undefined) {
      const resume = el("div", "sp-note desk-resume");
      resume.append(el("span", null, RESUME_PREFIX), el("span", "desk-resume-cmd", RESUME_COMMAND));
      info.append(resume);
    }
  }
  if (parts.select.value !== ctx.choice) parts.select.value = ctx.choice;
  const label = ctx.pausing ? "pausing…" : "Pause";
  if (parts.go.textContent !== label) parts.go.textContent = label;
  if (parts.go.disabled !== ctx.pausing) parts.go.disabled = ctx.pausing;
  parts.after.replaceChildren(...(ctx.pauseError !== undefined ? [note(`pause: ${ctx.pauseError}`, true)] : []));
}

/** The Telegram bridge, as the status reports it (src/desk.ts `TelegramStatus`).
 * @param {any} card @param {DrawContext} ctx */
function drawTelegram(card, { status, now }) {
  head(card, "telegram");
  const t = status?.telegram;
  if (t === null || typeof t !== "object") {
    card.append(note("no bridge status"));
    return;
  }
  if (t.configured !== true) {
    card.append(note("not configured (TELEGRAM_BOT_TOKEN and TELEGRAM_OPERATOR_ID in $DSH_HOME/.env)"));
    return;
  }
  if (t.blocked === true) kv(card, "send", "blocked (403)", "Telegram refused the last send: the bot was blocked, or never started", "bad");
  kv(card, "bridge", t.polling === true ? "polling" : "not polling");
  kv(card, "last poll", typeof t.lastPollAt === "string" ? deskTime(new Date(t.lastPollAt), now) : "none yet");
  kv(card, "dropped", typeof t.lastDroppedFrom === "number" ? `${count(t.dropped)} · last from ${t.lastDroppedFrom}` : count(t.dropped),
    "updates refused as not the operator's private chat");
  kv(card, "queued", count(t.queued), "messages waiting in the outbox");
  if (typeof t.conflictAt === "string") kv(card, "conflict", deskTime(new Date(t.conflictAt), now), "the last time Telegram said another poller holds the token");
  const failing = t.pollFailing;
  if (failing !== null && typeof failing === "object" && typeof failing.since === "string" && typeof failing.reason === "string") {
    kv(card, "poll", `failing since ${deskTime(new Date(failing.since), now)}: ${failing.reason}`,
      "every poll since then has failed - a revoked or mistyped token fails them all; a poll that answers clears it", "bad");
  }
}

/** The desk conversation: the session the ledger names last, the one the phone
 * talks to - by its title when the list carries it, else by its id, and with
 * the waiting chip while a card waits on the operator in it.
 * @param {any} card @param {DrawContext} ctx */
function drawConversation(card, ctx) {
  const id = typeof ctx.status?.deskSession === "string" && ctx.status.deskSession !== "" ? ctx.status.deskSession : undefined;
  if (id === undefined) {
    head(card, "desk conversation");
    card.append(note("none yet - the desk opens one when it starts"));
    return;
  }
  const open = button("open", "sp-title-btn desk-open", () => ctx.open(id));
  open.title = "put the desk conversation on screen";
  head(card, "desk conversation", ...(ctx.waiting(id) ? [waitingChip()] : []), open);
  const summary = ctx.list.find((s) => s !== null && typeof s === "object" && s.sessionId === id);
  kv(card, "session", summary === undefined ? id : deskTitle(summary, ctx.titles), id);
}

/** Today's desk turns, from 00:00 New York time, and their tokens.
 * @param {any} card @param {DrawContext} ctx */
function drawTurns(card, { status }) {
  head(card, "turns today").title = "the desk's turns since 00:00 New York time, and their tokens";
  const turns = status?.turnsToday ?? {};
  const usage = turns.usage ?? {};
  kv(card, "turns", count(turns.count));
  kv(card, "input", fmtTokens(usage.uncachedInputTokens));
  kv(card, "output", fmtTokens(usage.outputTokens));
  kv(card, "cache read", fmtTokens(usage.cacheReadTokens));
  kv(card, "cache write", fmtTokens(usage.cacheWriteTokens));
}

/** Make `row` open the session `sessionId` in place, by click or by Enter or
 * Space, marking its desk session row first: a button to the keyboard and to a
 * screen reader. @param {any} row @param {string} sessionId @param {DrawContext} ctx */
function opensSession(row, sessionId, ctx) {
  row.setAttribute("role", "button");
  row.tabIndex = 0;
  const pick = () => {
    ctx.select(sessionId);
    ctx.open(sessionId);
  };
  row.addEventListener("click", pick);
  row.addEventListener("keydown", (/** @type {any} */ event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    pick();
  });
}

/** The desk's sessions, newest first as the list orders them: each a row that
 * opens it in place, named as {@link deskTitle} names it, and marked when a card
 * waits on the operator in it, when it is the desk conversation, and when it is
 * running.
 * @param {any} card @param {DrawContext} ctx */
function drawSessions(card, ctx) {
  head(card, "desk sessions", el("span", "sp-count", String(ctx.sessions.length)));
  ctx.rows.clear();
  if (ctx.sessions.length === 0) {
    card.append(note("no desk sessions yet"));
    return;
  }
  for (const summary of ctx.sessions) {
    const id = summary.sessionId;
    const row = el("div", "sp-row desk-row");
    row.dataset.sessionId = id;
    row.append(el("div", "sp-row-name", deskTitle(summary, ctx.titles)));
    const chips = [];
    if (ctx.waiting(id)) chips.push(waitingChip());
    if (id === ctx.status?.deskSession) chips.push(chip("current", "the desk conversation: the one the phone talks to"));
    if (summary.running === true) chips.push(chip("running"));
    if (chips.length > 0) {
      const sub = el("div", "desk-row-sub");
      sub.append(...chips);
      row.append(sub);
    }
    const updated = typeof summary.updatedAt === "number" ? `updated ${deskTime(new Date(summary.updatedAt), ctx.now)}` : "";
    row.title = [summary.cwd, id, updated].filter((part) => typeof part === "string" && part !== "").join("\n");
    row.classList.toggle("sel", id === ctx.active);
    opensSession(row, id, ctx);
    ctx.rows.set(id, row);
    card.append(row);
  }
}

/** One standing order: its name and anchor, beside when it next fires or what
 * holds it; under them, a pin that moved, in the error colour, and its last
 * firing or `no firing yet` - after `hash ok`, or `hash unknown`, while its
 * pins hold.
 * @param {{id: string, at: string, next: string, hash: string, last: string}} order @returns {any} */
function orderRow(order) {
  const row = el("div", "standing-order");
  const top = el("div", "standing-order-head");
  top.append(el("span", "standing-order-name", `${order.id} · ${order.at}`), el("span", "standing-order-next", order.next));
  row.append(top);
  const holds = order.hash === "ok" || order.hash === "unknown";
  if (!holds) row.append(el("div", "standing-order-sub bad", order.hash));
  row.append(el("div", "standing-order-sub", holds ? `hash ${order.hash} · ${order.last}` : order.last));
  return row;
}

/** One recent firing: its order and session date beside its outcome; under
 * them New York's time, its wall time, its tokens and the files its turn wrote,
 * those it has. One that woke a session opens it in place.
 * @param {{when: string, order: string, date: string, outcome: string, wall: string, tokens: string, files: string, sessionId?: string}} firing
 * @param {DrawContext} ctx @returns {any} */
function firingRow(firing, ctx) {
  const row = el("div", "standing-firing");
  const top = el("div", "standing-firing-head");
  top.append(el("span", "standing-firing-name", `${firing.order} · ${firing.date}`), el("span", "standing-firing-outcome", firing.outcome));
  const parts = [
    firing.when === EM ? EM : `${firing.when} ET`,
    firing.wall,
    firing.tokens === EM ? EM : `${firing.tokens} tokens`,
    firing.files === EM ? EM : `${firing.files} ${firing.files === "1" ? "file" : "files"}`,
  ];
  row.append(top, el("div", "standing-firing-sub", parts.filter((part) => part !== EM).join(" · ")));
  const id = firing.sessionId;
  if (id === undefined) return row;
  row.classList.add("opens");
  row.title = `open the firing's session\n${id}`;
  opensSession(row, id, ctx);
  return row;
}

/** The standing orders and the day's budget, in desk-standing.js's words: the
 * budget line, in the needs-you colour once the day's cap is reached; the
 * banner, when something stops every order or the day has no calendar; an
 * order a row ({@link orderRow}) - or, for an empty book, how to arm one; and
 * the recent firings ({@link firingRow}). Without the standing orders - no
 * clock runs, as with the desk off - it is the budget line alone.
 * @param {any} card @param {DrawContext} ctx */
function drawStanding(card, ctx) {
  head(card, "standing orders");
  const view = standingView(ctx.status, ctx.now.toISOString());
  card.append(el("div", view.spent ? "standing-budget spent" : "standing-budget", view.budget));
  if (!isRecord(ctx.status?.standing)) return;
  if (view.banner !== undefined) {
    const banner = note(view.banner, true);
    banner.classList.add("standing-banner");
    card.append(banner);
  } else if (view.orders.length === 0) {
    card.append(note(NONE_ARMED));
  }
  for (const order of view.orders) card.append(orderRow(order));
  if (view.recent.length === 0) return;
  card.append(el("div", "standing-recent", "recent firings"));
  for (const firing of view.recent) card.append(firingRow(firing, ctx));
}

/** Whether the status carries what the standing orders' card draws: the day's
 * budget, or the standing orders. @param {Record<string, any>|undefined} status @returns {boolean} */
const carriesStanding = (status) => isRecord(status?.budget) || isRecord(status?.standing);

/**
 * The panel's sections, in order. `needsStatus`: drawn only while a status is
 * read. `shows`, when there is one: drawn only while it says the status carries
 * what the section draws. `readsSessions`: drawn again when the session list
 * moves ({@link createDeskPanel}'s `syncSessions`). `keeps`: the section keeps
 * what it drew in its card and redraws only what changes - the card is not
 * emptied before each draw. P3's watch is one more entry.
 * @type {ReadonlyArray<{id: string, needsStatus: boolean, shows?: (status: Record<string, any>|undefined) => boolean, readsSessions: boolean, keeps: boolean, draw: (card: any, ctx: DrawContext) => void}>}
 */
const SECTIONS = Object.freeze([
  Object.freeze({ id: "desk", needsStatus: false, readsSessions: false, keeps: true, draw: drawDesk }),
  Object.freeze({ id: "telegram", needsStatus: true, readsSessions: false, keeps: false, draw: drawTelegram }),
  Object.freeze({ id: "conversation", needsStatus: true, readsSessions: true, keeps: false, draw: drawConversation }),
  Object.freeze({ id: "turns", needsStatus: true, readsSessions: false, keeps: false, draw: drawTurns }),
  Object.freeze({ id: "standing", needsStatus: true, shows: carriesStanding, readsSessions: false, keeps: false, draw: drawStanding }),
  Object.freeze({ id: "sessions", needsStatus: false, readsSessions: true, keeps: false, draw: drawSessions }),
]);

/**
 * What the panel needs from the page.
 * @typedef {object} DeskPanelDeps
 * @property {() => any} panel - the panel's element (`#panel-desk`), `null` when the page has none.
 * @property {(path: string, body?: Record<string, unknown>) => Promise<Record<string, any>>} data -
 *   chat.js's `panelData`: a GET without a body, a JSON POST with one; it rejects on anything but
 *   `{ok: true}`, with the face's own error text.
 * @property {() => any[]} sessions - the sidebar's last list, normalized (summaries.js).
 * @property {() => (string|null)} activeSession - the session on screen.
 * @property {(sessionId: string) => void} open - put a session on screen, in place (chat.js `openSession`).
 * @property {() => number} [now] - the clock times are shown against; default `Date.now`.
 * @property {(sessionId: string) => boolean} [waiting] - whether a card waits on the operator in a
 *   session (chat.js `needsYou`); none does by default.
 * @property {(sessionId: string) => boolean} [archived] - whether a session is archived; none is by default.
 * @property {() => any} [rail] - the rail's Desk item, which carries the badge; none by default.
 * @property {(fn: () => void, ms: number) => unknown} [setInterval] - the poll's timer; the global by default.
 * @property {(handle: unknown) => void} [clearInterval] - and its stop.
 */

/**
 * The Desk panel over `deps.panel()`.
 *
 * `show` is the panel coming on screen: it reads the status now and every
 * {@link DESK_POLL_MS} after, until `hide` - another panel on screen - stops
 * the reads. `refresh` reads the status and draws every section - "loading…"
 * until the first read settles; an answer that lands after a later read began,
 * or after a pause the panel made, is dropped. `syncSessions` draws again only
 * the sections that read the session list, with no read, once a read has
 * settled. `mark` marks the row of the session on screen. `titles` is the
 * firing sessions' names from the last status read - none before one, and a
 * read that fails keeps them - for the page to name those sessions as the panel
 * does ({@link deskTitle}). A click on Pause posts
 * the chosen length and draws the pause the face answered with; while it is in
 * flight the button is disabled, and a refusal is one line under it. A pause
 * made while no status is read reads it.
 *
 * THE BADGE. The desk's sessions have no rows in the strategy list, so their
 * waiting chips - a card parked on a desk session, the one nobody watches - live
 * in this panel; while another panel is shown, the rail's Desk item carries a
 * badge instead whenever a desk session the panel lists has a card waiting.
 * `show`, `hide` and `syncSessions` - which the page calls on every list
 * refresh, and a gate's arrival or settling schedules one - each set it.
 * @param {DeskPanelDeps} deps
 * @returns {{show: () => Promise<void>, hide: () => void, refresh: () => Promise<void>, syncSessions: () => void, mark: (sessionId: string|null) => void, titles: () => Record<string, string>}}
 */
export function createDeskPanel(deps) {
  const now = deps.now ?? Date.now;
  const waiting = deps.waiting ?? (() => false);
  const archived = deps.archived ?? (() => false);
  const startTimer = deps.setInterval ?? ((fn, ms) => setInterval(fn, ms));
  const stopTimer = deps.clearInterval ?? ((handle) => clearInterval(/** @type {any} */ (handle)));
  /** Whether the Desk panel is the face on screen. */
  let shown = false;
  /** The poll's timer while shown, else `null`. */
  let timer = null;
  /** The rail's badge, made on first need; and the rail item it is in, `null` while it is in none. */
  let badge = null;
  let badgedOn = null;
  /** @type {Record<string, any>|undefined} the last status read; `undefined` while none is. */
  let status;
  /** @type {string|undefined} why the last read failed. */
  let error;
  /** @type {Record<string, string>} the firing sessions' names from the last status read; a failed read keeps them. */
  let titles = {};
  /** Whether any read has settled. */
  let loaded = false;
  /** Read generation: a read whose number is no longer this one draws nothing. */
  let generation = 0;
  /** The pause length the select shows, kept across redraws. */
  let choice = PAUSE_CHOICES[0].until;
  let pausing = false;
  /** @type {string|undefined} */
  let pauseError;
  /** The panel element the cards were put in, and the cards, by section id, in order. */
  let drawnInto = null;
  /** @type {Map<string, any>} */
  let cards = new Map();
  /** @type {Map<string, any>} the session rows drawn, by session id. */
  const rows = new Map();

  /** @param {string|null} sessionId */
  function mark(sessionId) {
    for (const [id, row] of rows) row.classList.toggle("sel", id === sessionId);
  }

  /** @returns {Record<string, any>[]} the page's session list, as an array. */
  function listed() {
    const list = deps.sessions();
    return Array.isArray(list) ? list : [];
  }

  /** Badge the rail's Desk item while another panel is shown and a desk session the panel
   * lists has a card waiting; else take the badge off. Its label says so to a screen
   * reader too, the badge itself being a dot. */
  function syncRail() {
    const link = deps.rail?.() ?? null;
    const on = !shown && link !== null && deskSessionsOf(listed(), archived).some((s) => waiting(s.sessionId));
    if (badgedOn !== null && (!on || badgedOn !== link)) {
      badge.remove();
      badgedOn.setAttribute("aria-label", "Desk");
      badgedOn = null;
    }
    if (!on || badgedOn === link) return;
    if (badge === null) {
      badge = el("span", "rail-badge");
      badge.setAttribute("aria-hidden", "true");
    }
    link.append(badge);
    link.setAttribute("aria-label", "Desk, waiting on you");
    badgedOn = link;
  }

  /** @returns {DrawContext} */
  function context() {
    const list = listed();
    return {
      status, error, now: new Date(now()), list, sessions: deskSessionsOf(list, archived), titles, waiting, active: deps.activeSession(),
      choice, pausing, pauseError, rows,
      refresh: () => { void refresh(); },
      pause: () => { void pause(); },
      choose: (until) => { if (PAUSE_CHOICES.some((c) => c.until === until)) choice = until; },
      select: mark,
      open: (id) => deps.open(id),
    };
  }

  /** A section's card, empty. @param {string} id */
  function newCard(id) {
    const card = el("section", "sp-card desk-section");
    card.dataset.section = id;
    return card;
  }

  /** Draw the sections named in `ids`, every one when absent. When the set of
   * sections shown changes - a status read, or no longer read, or one carrying
   * what a section's `shows` asks for or no longer - the cards of the
   * sections that stay stay where they are, never taken off the page: only those
   * that come or go are put in or taken out, and every section is drawn. A card
   * that `keeps` is drawn into as it is; any other is emptied first.
   * @param {string[]} [ids] */
  function draw(ids) {
    const panel = deps.panel();
    if (panel === null || panel === undefined) return;
    if (!loaded) {
      drawnInto = null;
      cards = new Map();
      rows.clear();
      panel.replaceChildren(note("loading…"));
      return;
    }
    const drawable = SECTIONS.filter((s) => (!s.needsStatus || status !== undefined) && (s.shows === undefined || s.shows(status)));
    const ids0 = [...cards.keys()];
    if (drawnInto !== panel) {
      cards = new Map(drawable.map((s) => [s.id, newCard(s.id)]));
      panel.replaceChildren(...cards.values());
      drawnInto = panel;
      ids = undefined;
    } else if (ids0.length !== drawable.length || drawable.some((s, i) => ids0[i] !== s.id)) {
      const next = new Map(drawable.map((s) => [s.id, cards.get(s.id) ?? newCard(s.id)]));
      for (const [id, card] of cards) if (!next.has(id)) card.remove();
      /* from the last card back, each put before the one after it - unless it is there already */
      let after = null;
      for (const card of [...next.values()].reverse()) {
        if (card.parentNode !== panel || card.nextSibling !== after) panel.insertBefore(card, after);
        after = card;
      }
      cards = next;
      ids = undefined;
    }
    const ctx = context();
    for (const s of drawable) {
      if (ids !== undefined && !ids.includes(s.id)) continue;
      const card = cards.get(s.id);
      if (!s.keeps) card.replaceChildren();
      s.draw(card, ctx);
    }
  }

  async function refresh() {
    const token = ++generation;
    if (!loaded) draw();
    /** @type {Record<string, any>|undefined} */
    let next;
    /** @type {string|undefined} */
    let failure;
    try {
      next = await deps.data("/data/desk/status");
      if (next === null || typeof next !== "object") throw new Error("the face answered without a status");
    } catch (err) {
      failure = messageOf(err);
    }
    if (token !== generation) return;
    status = failure === undefined ? next : undefined;
    error = failure;
    if (status !== undefined) titles = firingTitles(status.standing);
    loaded = true;
    draw();
  }

  async function pause() {
    if (pausing) return;
    pausing = true;
    pauseError = undefined;
    draw(["desk"]);
    /** @type {Record<string, any>|undefined} */
    let answered;
    try {
      const body = await deps.data("/data/desk/pause", choice === "" ? {} : { until: choice });
      if (!isOffState(body?.off)) throw new Error("the face answered without the pause in force");
      answered = body.off;
    } catch (err) {
      pauseError = messageOf(err);
    }
    pausing = false;
    if (answered !== undefined) {
      generation += 1; // a read begun before this pause no longer speaks for the switch
      if (status !== undefined) status = { ...status, off: answered };
    }
    draw(["desk"]);
    if (answered !== undefined && status === undefined) void refresh();
  }

  /** The panel comes on screen: no badge, the status read now and every DESK_POLL_MS. */
  function show() {
    shown = true;
    if (timer === null) timer = startTimer(() => { void refresh(); }, DESK_POLL_MS);
    syncRail();
    return refresh();
  }

  /** Another panel is on screen: no more reads, and the badge stands in for the chips. */
  function hide() {
    shown = false;
    if (timer !== null) {
      stopTimer(timer);
      timer = null;
    }
    syncRail();
  }

  return {
    show,
    hide,
    refresh,
    syncSessions: () => {
      if (loaded) draw(SECTIONS.filter((s) => s.readsSessions).map((s) => s.id));
      syncRail();
    },
    mark,
    titles: () => titles,
  };
}
