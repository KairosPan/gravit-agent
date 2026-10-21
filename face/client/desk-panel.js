/** The Desk panel: the always-on desk at a glance, in the chat page's sidebar
 * (`#panel-desk`, the rail's first item) - what `GET /data/desk/status`
 * answers, drawn as named sections; the Pause control, which posts
 * `POST /data/desk/pause`; and the desk's sessions, which open in place. Also
 * the desk's marks in the transcript that chat.js draws: the glyphs of its
 * three message sources, and the words of a desk line.
 *
 * WHY A MODULE OF ITS OWN. Another branch replaces `face/client` with a new
 * client, and whichever of the two lands second ports the Desk panel - so
 * everything the panel is lives here, and chat.js only hooks it in: it hands
 * over `panelData`, the session list, the session on screen and `openSession`,
 * and calls `refresh` when the panel opens, `syncSessions` when the list moves
 * and `mark` when the session on screen changes.
 *
 * NAMED SECTIONS. The status is drawn as one card per entry of
 * {@link SECTIONS}, in order: the desk (on or off, up how long, the pause and
 * its control), the Telegram bridge, the desk conversation, today's desk turns
 * and their tokens, and the desk's sessions. A later block - P2's standing
 * orders, P3's watch - is one more entry there. A section that reads the status
 * is left out while there is none, so a status that cannot be read still
 * leaves the desk's own section - its Pause control - and the sessions on
 * screen. Each card is kept across redraws, so a redraw of the sessions when
 * the list moves leaves the Pause control under the operator's hand alone.
 *
 * THE PAUSE. The panel only pauses, as the phone does: 30 minutes, 2 hours,
 * 1 day, or until a resume (no `until`). A pause from here never shortens one in
 * force (src/desk.ts `writeOff`), so what the panel shows after a click is the
 * pause the face ANSWERED with - possibly a longer one that stood - never the
 * one asked for. Only a terminal resumes (`npm run desk -- resume`): while the
 * desk is paused the panel says so in one line, and it offers no resume.
 *
 * Times are New York's, as the desk shows them everywhere (src/et.ts): `14:03 ET`
 * on the same New York date as now, dated on any other. Every string reaches
 * the page through `textContent`; nothing here parses HTML.
 * @module
 */
import { isDeskPreset } from "./speaker.js";

/** Rendered in place of a value the face did not give. */
const EM = "—";

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

/** The one line the panel shows while the desk is paused - the phone's words for it
 * (src/telegram.ts `RESUMES`): the page has no resume control. */
export const RESUME_LINE = "a terminal resumes it: npm run desk -- resume";

/* ---------- time, New York's ---------- */

/** One formatter for both helpers: `hourCycle: "h23"`, so midnight is `00`, never `24`. */
const NY = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** @param {Date} d @returns {Record<string, string>} `d` in New York, field by field. */
function nyParts(d) {
  /** @type {Record<string, string>} */
  const parts = {};
  for (const { type, value } of NY.formatToParts(d)) parts[type] = value;
  return parts;
}

/** @param {unknown} d @returns {boolean} whether `d` is a Date that holds a time. */
const isTime = (d) => d instanceof Date && !Number.isNaN(d.getTime());

/** @param {Date} d @returns {string} the date in New York: `2026-10-20`. */
function nyDate(d) {
  const { year, month, day } = nyParts(d);
  return `${year}-${month}-${day}`;
}

/**
 * A time as the desk shows it (src/desk.ts `deskTime`): `14:03 ET` on the same
 * New York date as `now`, `2026-10-21 14:03 ET` on any other; `—` for no time.
 * @param {Date} at @param {Date} now @returns {string}
 */
export function deskTime(at, now) {
  if (!isTime(at)) return EM;
  const { hour, minute } = nyParts(at);
  const time = `${hour}:${minute} ET`;
  return isTime(now) && nyDate(at) === nyDate(now) ? time : `${nyDate(at)} ${time}`;
}

/* ---------- the desk's sessions and lines ---------- */

/**
 * The desk's sessions in a session list, in its order: every row whose
 * `agentPreset` (restored by summaries.js) is the desk's - the desk
 * conversation, the conversations before it, and the desk's firings.
 * @param {unknown[]} sessions - chat.js's `lastSessions`.
 * @returns {Record<string, any>[]}
 */
export function deskSessionsOf(sessions) {
  return (Array.isArray(sessions) ? sessions : []).filter((s) =>
    s !== null && typeof s === "object" && typeof s.sessionId === "string" && isDeskPreset(s.agentPreset));
}

/**
 * A desk session's name: its title, else `Desk · <YYYY-MM-DD>` - the New York
 * date of its last update, the one date a list row carries (it has no creation
 * time) - else `Desk`.
 * @param {Record<string, any>} summary - a list row.
 * @returns {string}
 */
export function deskTitle(summary) {
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

/** @param {string} text @param {string} [hint] @returns {any} one status chip. */
function chip(text, hint) {
  const node = el("span", "chip", text);
  if (hint) node.title = hint;
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
 * @property {Record<string, any>[]} sessions - its desk sessions.
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

/** The desk's own section: on or off, up how long, an unreadable ledger, the
 * pause in force, and the Pause control - drawn with or without a status.
 * @param {any} card @param {DrawContext} ctx */
function drawDesk(card, ctx) {
  const refresh = button("↻", "sp-title-btn desk-refresh", ctx.refresh);
  refresh.title = "read the desk's status again";
  refresh.setAttribute("aria-label", "refresh the desk's status");
  head(card, "desk", refresh);
  const { status } = ctx;
  if (status === undefined) {
    card.append(note(`desk status: ${ctx.error ?? "not read yet"}`, true));
  } else {
    const enabled = status.desk?.enabled;
    kv(card, "desk", enabled === true ? "on" : enabled === false ? "off (FACE_DESK=0)" : EM);
    kv(card, "up", upFor(status.uptimeMs), typeof status.bootedAt === "string" ? `since ${status.bootedAt}` : undefined);
    if (typeof status.ledgerError === "string") card.append(note(`ledger unreadable: ${status.ledgerError}`, true));
    const off = isOffState(status.off) ? status.off : undefined;
    card.append(el("div", off === undefined ? "desk-pause-line" : "desk-pause-line paused", pauseText(off, ctx.now)));
    if (off !== undefined) card.append(note(RESUME_LINE));
  }
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
  select.addEventListener("change", () => ctx.choose(select.value));
  const go = button(ctx.pausing ? "pausing…" : "Pause", "picker-btn desk-pause-btn", ctx.pause);
  go.disabled = ctx.pausing;
  go.title = "pause the desk; only a terminal resumes it";
  row.append(select, go);
  card.append(row);
  if (ctx.pauseError !== undefined) card.append(note(`pause: ${ctx.pauseError}`, true));
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
}

/** The desk conversation: the session the ledger names last, the one the phone
 * talks to - by its title when the list carries it, else by its id.
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
  head(card, "desk conversation", open);
  const summary = ctx.list.find((s) => s !== null && typeof s === "object" && s.sessionId === id);
  kv(card, "session", summary === undefined ? id : deskTitle(summary), id);
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

/** The desk's sessions, newest first as the list orders them: each a row that
 * opens it in place, marked when it is the desk conversation or running.
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
    row.setAttribute("role", "button");
    row.tabIndex = 0;
    row.append(el("div", "sp-row-name", deskTitle(summary)));
    const chips = [];
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
    const pick = () => {
      ctx.select(id);
      ctx.open(id);
    };
    row.addEventListener("click", pick);
    row.addEventListener("keydown", (/** @type {any} */ event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      pick();
    });
    ctx.rows.set(id, row);
    card.append(row);
  }
}

/**
 * The panel's sections, in order. `needsStatus`: drawn only while a status is
 * read. `readsSessions`: drawn again when the session list moves
 * ({@link createDeskPanel}'s `syncSessions`). P2's standing orders and P3's
 * watch are one more entry each.
 * @type {ReadonlyArray<{id: string, needsStatus: boolean, readsSessions: boolean, draw: (card: any, ctx: DrawContext) => void}>}
 */
const SECTIONS = Object.freeze([
  Object.freeze({ id: "desk", needsStatus: false, readsSessions: false, draw: drawDesk }),
  Object.freeze({ id: "telegram", needsStatus: true, readsSessions: false, draw: drawTelegram }),
  Object.freeze({ id: "conversation", needsStatus: true, readsSessions: true, draw: drawConversation }),
  Object.freeze({ id: "turns", needsStatus: true, readsSessions: false, draw: drawTurns }),
  Object.freeze({ id: "sessions", needsStatus: false, readsSessions: true, draw: drawSessions }),
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
 */

/**
 * The Desk panel over `deps.panel()`.
 *
 * `refresh` reads the status and draws every section - "loading…" until the
 * first read settles; an answer that lands after a later read began, or after a
 * pause the panel made, is dropped. `syncSessions` draws again only the sections
 * that read the session list, with no read. `mark` marks the row of the session
 * on screen. A click on Pause posts the chosen length and draws the pause the
 * face answered with; while it is in flight the button is disabled, and a
 * refusal is one line under it. A pause made while no status is read reads it.
 * @param {DeskPanelDeps} deps
 * @returns {{refresh: () => Promise<void>, syncSessions: () => void, mark: (sessionId: string|null) => void}}
 */
export function createDeskPanel(deps) {
  const now = deps.now ?? Date.now;
  /** @type {Record<string, any>|undefined} the last status read; `undefined` while none is. */
  let status;
  /** @type {string|undefined} why the last read failed. */
  let error;
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

  /** @returns {DrawContext} */
  function context() {
    const listed = deps.sessions();
    const list = Array.isArray(listed) ? listed : [];
    return {
      status, error, now: new Date(now()), list, sessions: deskSessionsOf(list), active: deps.activeSession(),
      choice, pausing, pauseError, rows,
      refresh: () => { void refresh(); },
      pause: () => { void pause(); },
      choose: (until) => { if (PAUSE_CHOICES.some((c) => c.until === until)) choice = until; },
      select: mark,
      open: (id) => deps.open(id),
    };
  }

  /** Draw the sections named in `ids`, every one when absent. The cards are
   * rebuilt only when the set of sections shown changes. @param {string[]} [ids] */
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
    const shown = SECTIONS.filter((s) => !s.needsStatus || status !== undefined);
    const ids0 = [...cards.keys()];
    if (drawnInto !== panel || ids0.length !== shown.length || shown.some((s, i) => ids0[i] !== s.id)) {
      cards = new Map(shown.map((s) => {
        const card = el("section", "sp-card desk-section");
        card.dataset.section = s.id;
        return [s.id, card];
      }));
      panel.replaceChildren(...cards.values());
      drawnInto = panel;
      ids = undefined;
    }
    const ctx = context();
    for (const s of shown) {
      if (ids !== undefined && !ids.includes(s.id)) continue;
      const card = cards.get(s.id);
      card.replaceChildren();
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

  return {
    refresh,
    syncSessions: () => { if (loaded) draw(SECTIONS.filter((s) => s.readsSessions).map((s) => s.id)); },
    mark,
  };
}
