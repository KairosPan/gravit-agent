/** The Desk panel (client/desk-panel.js): the status sections, the Pause control and the desk
 * sessions, drawn into a fake DOM the way tests/answer-traces.test.ts draws the trace disclosure -
 * only the operations the module uses, a node moved on append, text read back through `textContent`.
 * The panel's data is a fake of chat.js's `panelData`: every call is recorded, and each answer is the
 * test's to give.
 */
import assert from "node:assert/strict";
import test from "node:test";
// desk-panel.js is plain ESM JS (it ships to the browser); tsconfig `allowJs` lets this test import it.
import {
  DESK_GLYPHS, DESK_POLL_MS, PAUSE_CHOICES, RESUME_COMMAND, RESUME_LINE, createDeskPanel, deskLineNode, deskLineText, deskSessionsOf,
  deskTime, deskTitle, phoneWhoNode,
} from "../client/desk-panel.js";

/** The DOM operations the panel uses, and nothing else. */
class Element {
  readonly tagName: string;
  children: Element[] = [];
  parent: Element | null = null;
  className = "";
  title = "";
  hidden = false;
  disabled = false;
  value = "";
  selected = false;
  type = "";
  tabIndex = -1;
  dataset: Record<string, string> = {};
  /** How often the node was taken off its parent - removed, moved, or cleared out by `replaceChildren` - as a
   * browser would drop its focus and close its dropdown. */
  detaches = 0;
  private own = "";
  private attributes = new Map<string, string>();
  private listeners = new Map<string, ((event: unknown) => void)[]>();
  constructor(tag: string) { this.tagName = tag.toLowerCase(); }
  get textContent(): string { return this.own + this.children.map((child) => child.textContent).join(""); }
  set textContent(text: string) { this.replaceChildren(); this.own = String(text); }
  classList = {
    add: (...names: string[]) => { for (const name of names) if (!this.hasClass(name)) this.className = `${this.className} ${name}`.trim(); },
    remove: (...names: string[]) => { this.className = this.className.split(/\s+/).filter((c) => c !== "" && !names.includes(c)).join(" "); },
    toggle: (name: string, force?: boolean) => {
      const on = force ?? !this.hasClass(name);
      if (on) this.classList.add(name); else this.classList.remove(name);
      return on;
    },
    contains: (name: string) => this.hasClass(name),
  };
  hasClass(name: string): boolean { return this.className.split(/\s+/).includes(name); }
  setAttribute(name: string, value: string) { this.attributes.set(name, String(value)); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  append(...nodes: Element[]) {
    for (const node of nodes) { node.remove(); node.parent = this; this.children.push(node); }
  }
  replaceChildren(...nodes: Element[]) {
    for (const child of this.children) {
      child.parent = null;
      child.detaches += 1;
    }
    this.children = [];
    this.own = "";
    this.append(...nodes);
  }
  remove() {
    if (this.parent) {
      this.parent.children.splice(this.parent.children.indexOf(this), 1);
      this.detaches += 1;
    }
    this.parent = null;
  }
  /** Put `node` before `before`, a child of this node, or last when `before` is `null`; the node is moved, as a browser moves it. */
  insertBefore(node: Element, before: Element | null) {
    node.remove();
    node.parent = this;
    const at = before === null ? -1 : this.children.indexOf(before);
    if (at < 0) this.children.push(node);
    else this.children.splice(at, 0, node);
    return node;
  }
  get nextSibling(): Element | null {
    if (this.parent === null) return null;
    return this.parent.children[this.parent.children.indexOf(this) + 1] ?? null;
  }
  get parentNode(): Element | null { return this.parent; }
  addEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  /** Fire `type` at this node's own listeners; `prevented` says whether one called `preventDefault`. */
  fire(type: string, fields: Record<string, unknown> = {}): { prevented: boolean } {
    const out = { prevented: false };
    for (const listener of this.listeners.get(type) ?? []) listener({ ...fields, target: this, preventDefault: () => { out.prevented = true; } });
    return out;
  }
}

/** Every node under `root`, `root` first, that `match` accepts. */
function all(root: Element, match: (node: Element) => boolean): Element[] {
  const out: Element[] = [];
  const walk = (node: Element) => { if (match(node)) out.push(node); for (const child of node.children) walk(child); };
  walk(root);
  return out;
}
const byClass = (root: Element, name: string): Element[] => all(root, (node) => node.hasClass(name));
const one = (root: Element, match: (node: Element) => boolean, what: string): Element => {
  const found = all(root, match);
  assert.equal(found.length, 1, `exactly one ${what}`);
  return found[0];
};

/** The section cards, in order, by their `data-section`. */
const sectionIds = (panel: Element): string[] => panel.children.map((card) => card.dataset.section ?? `<${card.className}>`);
const section = (panel: Element, id: string): Element => one(panel, (node) => node.dataset.section === id, `section ${id}`);
/** The value of a card's `label → value` row, or `undefined` when the card has no such row. */
const kvValue = (card: Element, label: string): string | undefined =>
  byClass(card, "sp-kv").find((row) => row.children[0]?.textContent === label)?.children[1]?.textContent;
/** The pause line in the desk section. */
const pauseLine = (panel: Element): string => one(section(panel, "desk"), (node) => node.hasClass("desk-pause-line"), "pause line").textContent;

/** Run `body` with `document` faked; the panel's element is handed in. */
async function withDOM(body: (panel: Element) => Promise<void> | void): Promise<void> {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: (tag: string) => new Element(tag) } });
  try {
    await body(new Element("div"));
  } finally {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else Reflect.deleteProperty(globalThis, "document");
  }
}

/** A promise and the hands that settle it. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (err: unknown) => void } {
  let resolve!: (value: T) => void; let reject!: (err: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** Let every queued continuation run. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** 14:00 ET on 2026-10-20. */
const AT = Date.parse("2026-10-20T18:00:00Z");

/** What GET /data/desk/status answers (src/desk.ts `DeskStatus`): up 3 h 12 m, not paused. */
const status = (fields: Record<string, unknown> = {}): Record<string, any> => ({
  ok: true, pid: 11, version: "0.2.0-rc.2", bootedAt: "2026-10-20T14:48:00.000Z", uptimeMs: 3 * 3_600_000 + 12 * 60_000,
  desk: { enabled: true, dir: "/home/.dsh/face/desk" }, asleep: [], runs: [],
  deskSession: "session-desk-1",
  turnsToday: { count: 3, usage: { uncachedInputTokens: 8123, outputTokens: 2411, cacheReadTokens: 51200, cacheWriteTokens: 900 } },
  telegram: { configured: true, polling: true, lastPollAt: "2026-10-20T17:59:30.000Z", dropped: 2, lastDroppedFrom: 999, queued: 1 },
  ...fields,
});

/** The sidebar's list (chat.js `lastSessions`, normalized by summaries.js): two desk sessions among others. */
const SESSIONS = [
  { sessionId: "session-desk-1", agentPreset: "gravit-desk", cwd: "/repo/desk/journal", updatedAt: AT, running: true, projections: { values: {} } },
  { sessionId: "session-strategy", agentPreset: "gravit", cwd: "/repo/strategies/alpha", updatedAt: AT, projections: { values: { title: "alpha work" } } },
  { sessionId: "session-desk-0", agentPreset: "gravit-desk", cwd: "/repo/desk/journal", updatedAt: Date.parse("2026-10-19T15:00:00Z"), projections: { values: { title: "Monday's desk" } } },
  { sessionId: "session-bot", agentPreset: "buffett", cwd: "/repo/bots/buffett/journal", updatedAt: AT },
];

/** A fake interval timer: what was armed, at what period, and a hand to fire it. */
function fakeTimer() {
  const armed = new Map<number, { fn: () => void; ms: number }>();
  let next = 1;
  return {
    setInterval: (fn: () => void, ms: number): unknown => { const id = next++; armed.set(id, { fn, ms }); return id; },
    clearInterval: (id: unknown) => { armed.delete(id as number); },
    periods: () => [...armed.values()].map((t) => t.ms),
    fire: () => { for (const { fn } of [...armed.values()]) fn(); },
  };
}

/** A panel over `panel`, with every data call recorded and answered by `answer`, every open recorded.
 * `waiting` and `archived` are the sets the page's predicates read; `rail` is the Desk rail item. */
function harness(panel: Element, answer: (path: string, body?: Record<string, unknown>) => Promise<Record<string, any>>, opts: { sessions?: unknown[]; active?: string | null } = {}) {
  const calls: [string, Record<string, unknown> | undefined][] = [];
  const opened: string[] = [];
  const waiting = new Set<string>();
  const archived = new Set<string>();
  const rail = new Element("a");
  rail.setAttribute("aria-label", "Desk");
  const timer = fakeTimer();
  let sessions = opts.sessions ?? SESSIONS;
  const desk = createDeskPanel({
    panel: () => panel as any,
    data: (path: string, body?: Record<string, unknown>) => { calls.push([path, body]); return answer(path, body); },
    sessions: () => sessions as any[],
    activeSession: () => opts.active ?? null,
    open: (id: string) => { opened.push(id); },
    now: () => AT,
    waiting: (id: string) => waiting.has(id),
    archived: (id: string) => archived.has(id),
    rail: () => rail as any,
    setInterval: timer.setInterval,
    clearInterval: timer.clearInterval,
  });
  return { desk, calls, opened, waiting, archived, rail, timer, setSessions: (next: unknown[]) => { sessions = next; } };
}

/** The rail item's badge, when it carries one. */
const badgeOf = (rail: Element): Element | undefined => byClass(rail, "rail-badge")[0];

/** The Pause control's select and button. */
const pauseControl = (panel: Element) => ({
  select: one(panel, (node) => node.tagName === "select", "pause select"),
  button: one(panel, (node) => node.tagName === "button" && node.hasClass("desk-pause-btn"), "Pause button"),
});

test("deskSessionsOf keeps the desk's sessions in list order; deskTitle is the title, else Desk and the session's New York date", () => {
  assert.deepEqual(deskSessionsOf(SESSIONS).map((s: any) => s.sessionId), ["session-desk-1", "session-desk-0"]);
  assert.deepEqual(deskSessionsOf(undefined as any), []);
  assert.deepEqual(deskSessionsOf([null, {}, { agentPreset: "gravit" }] as any), []);
  assert.equal(deskTitle(SESSIONS[0]), "Desk · 2026-10-20");
  assert.equal(deskTitle(SESSIONS[2]), "Monday's desk", "a title the session has wins");
  assert.equal(deskTitle({ updatedAt: Date.parse("2026-10-21T02:30:00Z") }), "Desk · 2026-10-20", "still the 20th in New York");
  assert.equal(deskTitle({ updatedAt: AT, projections: { values: { title: "" } } }), "Desk · 2026-10-20", "a blank title is none");
  assert.equal(deskTitle({}), "Desk");
  assert.equal(deskTitle({ updatedAt: 1e20 }), "Desk", "a time no Date holds names no day");
});

test("deskTime writes New York's wall clock, dated only on another New York date than now's", () => {
  const now = new Date(AT);
  assert.equal(deskTime(new Date("2026-10-20T18:03:00Z"), now), "14:03 ET");
  assert.equal(deskTime(new Date("2026-10-20T04:00:00Z"), now), "00:00 ET", "midnight is 00, never 24");
  assert.equal(deskTime(new Date("2026-10-21T13:05:00Z"), now), "2026-10-21 09:05 ET");
  assert.equal(deskTime(new Date("2026-10-21T02:30:00Z"), now), "22:30 ET", "the 21st in UTC, the 20th in New York");
  assert.equal(deskTime(new Date("not a time"), now), "—");
});

test("deskLineText names a firing's order and date, or an alert's symbol and id; the three glyphs are distinct", () => {
  assert.equal(deskLineText({ kind: "desk-line", line: "schedule", order: "preclose", firing: "preclose:2026-10-20", date: "2026-10-20" }), "schedule · preclose · 2026-10-20");
  assert.equal(deskLineText({ kind: "desk-line", line: "alert", alert: "a-0001", symbol: "NVDA" }), "alert · NVDA · a-0001");
  assert.equal(deskLineText({ kind: "desk-line", line: "schedule" }), "schedule", "a field the source lacked is left out");
  assert.deepEqual(Object.keys(DESK_GLYPHS).sort(), ["alert", "schedule", "telegram"]);
  assert.equal(new Set(Object.values(DESK_GLYPHS)).size, 3);
  assert.deepEqual(PAUSE_CHOICES.map((c: any) => c.until), ["30m", "2h", "1d", ""], "30m, 2h, 1d and open-ended, which sends no until");
});

test("the panel loads the status and draws its named sections in order: desk, telegram, desk conversation, turns today, desk sessions", () => withDOM(async (panel) => {
  const answer = deferred<Record<string, any>>();
  const { desk, calls } = harness(panel, () => answer.promise);
  const loading = desk.refresh();
  assert.match(panel.textContent, /loading/, "loading until the status lands");
  answer.resolve(status());
  await loading;
  assert.deepEqual(calls, [["/data/desk/status", undefined]]);
  assert.deepEqual(sectionIds(panel), ["desk", "telegram", "conversation", "turns", "sessions"]);

  const head = section(panel, "desk");
  assert.equal(kvValue(head, "desk"), "on");
  assert.equal(kvValue(head, "up"), "3h 12m");
  assert.equal(pauseLine(panel), "not paused");
  assert.equal(head.textContent.includes(RESUME_LINE), false, "no resume line while nothing is paused");

  const telegram = section(panel, "telegram");
  assert.equal(kvValue(telegram, "bridge"), "polling");
  assert.equal(kvValue(telegram, "last poll"), "13:59 ET");
  assert.equal(kvValue(telegram, "dropped"), "2 · last from 999");
  assert.equal(kvValue(telegram, "queued"), "1");
  assert.equal(kvValue(telegram, "send"), undefined, "no blocked row while sends go through");
  assert.equal(kvValue(telegram, "conflict"), undefined);

  assert.equal(kvValue(section(panel, "conversation"), "session"), "Desk · 2026-10-20", "the ledger's desk session, by its row's title");

  const turns = section(panel, "turns");
  assert.deepEqual(["turns", "input", "output", "cache read", "cache write"].map((label) => kvValue(turns, label)), ["3", "8.1k", "2.4k", "51.2k", "900"]);

  const rows = byClass(section(panel, "sessions"), "desk-row");
  assert.deepEqual(rows.map((row) => row.dataset.sessionId), ["session-desk-1", "session-desk-0"], "the desk's sessions only, in list order");
  assert.match(rows[0].textContent, /^Desk · 2026-10-20/);
  assert.match(rows[0].textContent, /current/, "the conversation the phone talks to");
  assert.match(rows[0].textContent, /running/);
  assert.match(rows[1].textContent, /^Monday's desk/);
  assert.doesNotMatch(rows[1].textContent, /current|running/);
}));

test("while paused the panel says since when, by whom and until when, and that a terminal resumes; it offers no resume", () => withDOM(async (panel) => {
  let next = status({ off: { setAt: "2026-10-20T17:00:00.000Z", by: "telegram", until: "2026-10-20T19:00:00.000Z" } });
  const { desk } = harness(panel, async () => next);
  await desk.refresh();
  assert.equal(pauseLine(panel), "paused since 13:00 ET by telegram until 15:00 ET");
  assert.ok(section(panel, "desk").textContent.includes(RESUME_LINE), "the one line saying how it lifts");
  assert.equal(RESUME_LINE, "a terminal resumes it: npm run desk -- resume");
  assert.deepEqual(all(panel, (node) => node.tagName === "button" && /resume/i.test(node.textContent)), [], "no resume control on the page");

  next = status({ off: { setAt: "2026-10-19T16:00:00.000Z", by: "terminal" } });
  await desk.refresh();
  assert.equal(pauseLine(panel), "paused since 2026-10-19 12:00 ET by terminal", "a pause set another day is dated; an open-ended one has no until");
  assert.ok(section(panel, "desk").textContent.includes(RESUME_LINE));
}));

test("Pause posts the chosen length, or none for open-ended, and shows the pause the face answered with", () => withDOM(async (panel) => {
  const posted = deferred<Record<string, any>>();
  let answerPause: () => Promise<Record<string, any>> = () => posted.promise;
  const { desk, calls } = harness(panel, async (path) => (path === "/data/desk/status" ? status() : answerPause()));
  await desk.refresh();
  let { select, button } = pauseControl(panel);
  assert.equal(select.value, "30m", "30 minutes unless the operator picks another");
  assert.deepEqual(select.children.map((option) => option.value), ["30m", "2h", "1d", ""]);
  assert.equal(button.textContent, "Pause");

  button.fire("click");
  assert.deepEqual(calls.at(-1), ["/data/desk/pause", { until: "30m" }]);
  ({ button } = pauseControl(panel));
  assert.equal(button.disabled, true, "one pause at a time");
  button.fire("click");
  assert.equal(calls.length, 2, "a second click while one is in flight posts nothing");
  // The face answers with the pause in force: a terminal's open-ended pause, which a 30 m one never shortens.
  posted.resolve({ ok: true, off: { setAt: "2026-10-19T16:00:00.000Z", by: "terminal" } });
  await settle();
  assert.equal(pauseLine(panel), "paused since 2026-10-19 12:00 ET by terminal", "the answered state, not the one asked for");
  assert.ok(section(panel, "desk").textContent.includes(RESUME_LINE));
  ({ select, button } = pauseControl(panel));
  assert.equal(button.disabled, false);

  answerPause = async () => ({ ok: true, off: { setAt: "2026-10-20T18:00:00.000Z", by: "page" } });
  select.value = "";
  select.fire("change");
  button.fire("click");
  await settle();
  assert.deepEqual(calls.at(-1), ["/data/desk/pause", {}], "open-ended sends no until");

  ({ select, button } = pauseControl(panel));
  assert.equal(select.value, "", "the choice survives the redraw");
  select.value = "5y";
  select.fire("change");
  select.value = "2h";
  select.fire("change");
  button.fire("click");
  await settle();
  assert.deepEqual(calls.at(-1), ["/data/desk/pause", { until: "2h" }]);
  ({ select } = pauseControl(panel));
  select.value = "5y";
  select.fire("change");
  ({ button } = pauseControl(panel));
  button.fire("click");
  await settle();
  assert.deepEqual(calls.at(-1), ["/data/desk/pause", { until: "2h" }], "a value that is no choice changes nothing");
}));

test("a pause the face refuses is said in the panel, and the button comes back", () => withDOM(async (panel) => {
  const { desk } = harness(panel, async (path) => {
    if (path === "/data/desk/status") return status();
    throw new Error("until must look like 30m, 2h or 1d");
  });
  await desk.refresh();
  pauseControl(panel).button.fire("click");
  await settle();
  const text = section(panel, "desk").textContent;
  assert.ok(text.includes("pause: until must look like 30m, 2h or 1d"), text);
  assert.equal(pauseLine(panel), "not paused", "the state on screen is still the last one read");
  const { button } = pauseControl(panel);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, "Pause");
}));

test("an answer with no pause in it is a failure, never a pause shown", () => withDOM(async (panel) => {
  const { desk } = harness(panel, async (path) => (path === "/data/desk/status" ? status() : { ok: true }));
  await desk.refresh();
  pauseControl(panel).button.fire("click");
  await settle();
  assert.match(section(panel, "desk").textContent, /pause: the face answered without the pause in force/);
  assert.equal(pauseLine(panel), "not paused");
}));

test("a status that cannot be read is said; the Pause control and the desk sessions stay, and a pause then reads the status again", () => withDOM(async (panel) => {
  let statusAnswer: () => Promise<Record<string, any>> = async () => { throw new Error("HTTP 500"); };
  const { desk, calls } = harness(panel, async (path) => (path === "/data/desk/status" ? statusAnswer() : { ok: true, off: { setAt: "2026-10-20T18:00:00.000Z", by: "page", until: "2026-10-20T18:30:00.000Z" } }));
  await desk.refresh();
  assert.deepEqual(sectionIds(panel), ["desk", "sessions"], "nothing drawn from a status there is none of");
  const text = section(panel, "desk").textContent;
  assert.ok(text.includes("desk status: HTTP 500"), text);
  assert.deepEqual(byClass(section(panel, "desk"), "desk-pause-line"), [], "an unread switch is not reported either way");
  pauseControl(panel);
  assert.equal(byClass(section(panel, "sessions"), "desk-row").length, 2);

  statusAnswer = async () => status({ off: { setAt: "2026-10-20T18:00:00.000Z", by: "page", until: "2026-10-20T18:30:00.000Z" } });
  pauseControl(panel).button.fire("click");
  await settle();
  await settle();
  assert.deepEqual(calls.map(([path]) => path), ["/data/desk/status", "/data/desk/pause", "/data/desk/status"]);
  assert.deepEqual(sectionIds(panel), ["desk", "telegram", "conversation", "turns", "sessions"]);
  assert.equal(pauseLine(panel), "paused since 14:00 ET by page until 14:30 ET");
}));

test("a newer status wins: an answer that lands after a later one is dropped, and so is one a pause overtook", () => withDOM(async (panel) => {
  const answers = [deferred<Record<string, any>>(), deferred<Record<string, any>>(), deferred<Record<string, any>>()];
  let n = 0;
  const { desk } = harness(panel, async (path) => (path === "/data/desk/status" ? answers[n++].promise : { ok: true, off: { setAt: "2026-10-20T18:00:00.000Z", by: "page" } }));
  const first = desk.refresh();
  const second = desk.refresh();
  answers[1].resolve(status({ turnsToday: { count: 7, usage: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } } }));
  await second;
  answers[0].resolve(status({ turnsToday: { count: 1, usage: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } } }));
  await first;
  assert.equal(kvValue(section(panel, "turns"), "turns"), "7", "the later read stands");

  const stale = desk.refresh(); // started before the pause, lands after it
  pauseControl(panel).button.fire("click");
  await settle();
  assert.equal(pauseLine(panel), "paused since 14:00 ET by page");
  answers[2].resolve(status());
  await stale;
  assert.equal(pauseLine(panel), "paused since 14:00 ET by page", "the status read before the pause does not undo it on screen");
}));

test("a desk session row opens in place, by click or by key, and the session on screen is marked", () => withDOM(async (panel) => {
  const { desk, opened } = harness(panel, async () => status(), { active: "session-desk-0" });
  await desk.refresh();
  const rows = () => byClass(section(panel, "sessions"), "desk-row");
  assert.deepEqual(rows().map((row) => row.hasClass("sel")), [false, true], "the session on screen when drawn");
  const [current, older] = rows();
  assert.equal(current.getAttribute("role"), "button");
  assert.equal(current.tabIndex, 0);
  assert.ok(current.title.includes("/repo/desk/journal") && current.title.includes("session-desk-1"), current.title);

  current.fire("click");
  assert.deepEqual(opened, ["session-desk-1"]);
  assert.deepEqual(rows().map((row) => row.hasClass("sel")), [true, false]);
  assert.equal(older.fire("keydown", { key: "Enter" }).prevented, true);
  assert.equal(older.fire("keydown", { key: " " }).prevented, true);
  older.fire("keydown", { key: "a" });
  assert.deepEqual(opened, ["session-desk-1", "session-desk-0", "session-desk-0"]);

  desk.mark("session-desk-1");
  assert.deepEqual(rows().map((row) => row.hasClass("sel")), [true, false]);
  desk.mark(null);
  assert.deepEqual(rows().map((row) => row.hasClass("sel")), [false, false], "a session elsewhere marks none");
}));

test("syncSessions redraws the conversation and the sessions only: the Pause control on screen stays the same element", () => withDOM(async (panel) => {
  const { desk, calls, setSessions } = harness(panel, async () => status());
  await desk.refresh();
  const { select } = pauseControl(panel);
  select.value = "1d";
  select.fire("change");
  setSessions([{ sessionId: "session-desk-2", agentPreset: "gravit-desk", cwd: "/repo/desk/journal", updatedAt: AT + 3_600_000 }, ...SESSIONS]);
  desk.syncSessions();
  assert.equal(pauseControl(panel).select, select, "not rebuilt under the operator's hand");
  assert.deepEqual(byClass(section(panel, "sessions"), "desk-row").map((row) => row.dataset.sessionId), ["session-desk-2", "session-desk-1", "session-desk-0"]);
  assert.equal(calls.length, 1, "no status read for a list that moved");
  await desk.refresh();
  assert.equal(pauseControl(panel).select, select, "nor by a full redraw");
  assert.equal(pauseControl(panel).select.value, "1d", "which keeps the operator's choice");
}));

/* The poll redraws every 30 s while the panel is shown: a Pause row rebuilt under the operator's hand would close its
 * open dropdown and drop its focus. */
test("the 30 s poll redraws the status and leaves the Pause row alone: the same nodes, never taken off the page, a failed read between included", () => withDOM(async (panel) => {
  let next: () => Promise<Record<string, any>> = async () => status();
  const { desk, timer, calls } = harness(panel, () => next());
  await desk.show();
  const { select, button } = pauseControl(panel);
  const row = select.parent!;
  const card = section(panel, "desk");
  select.value = "1d";
  select.fire("change"); // the operator's hand on the dropdown
  const kept = [card, row, select, button];
  const detaches = (): number[] => kept.map((node) => node.detaches);
  const before = detaches();

  next = async () => status({ off: { setAt: "2026-10-20T17:00:00.000Z", by: "telegram" }, uptimeMs: 4 * 3_600_000 });
  timer.fire();
  await settle();
  assert.equal(pauseLine(panel), "paused since 13:00 ET by telegram", "the status is drawn again");
  assert.equal(kvValue(section(panel, "desk"), "up"), "4h 0m");
  assert.equal(pauseControl(panel).select, select, "the same select");
  assert.equal(pauseControl(panel).button, button, "the same button");
  assert.equal(select.value, "1d", "holding the operator's choice");
  assert.deepEqual(detaches(), before, "none of them taken off the page");

  /* A read that fails takes the status's sections away, and one that answers brings them back - around the desk card. */
  next = async () => { throw new Error("HTTP 500"); };
  timer.fire();
  await settle();
  assert.deepEqual(sectionIds(panel), ["desk", "sessions"]);
  next = async () => status();
  timer.fire();
  await settle();
  assert.deepEqual(sectionIds(panel), ["desk", "telegram", "conversation", "turns", "sessions"]);
  assert.equal(section(panel, "desk"), card);
  assert.equal(pauseControl(panel).select, select);
  assert.deepEqual(detaches(), before, "still never taken off the page");

  /* And it still pauses, with the operator's choice. */
  button.fire("click");
  assert.deepEqual(calls.at(-1), ["/data/desk/pause", { until: "1d" }]);
  assert.equal(button.textContent, "pausing…");
  assert.equal(button.disabled, true);
}));

test("the quiet cases: no desk session yet, no Telegram, the desk off, an unreadable ledger, a blocked bot", () => withDOM(async (panel) => {
  let next = status({ deskSession: undefined, telegram: { configured: false, polling: false, dropped: 0, queued: 0 }, desk: { enabled: false, dir: "/d" }, ledgerError: "EISDIR" });
  const { desk } = harness(panel, async () => next, { sessions: [] });
  await desk.refresh();
  assert.equal(kvValue(section(panel, "desk"), "desk"), "off (FACE_DESK=0)");
  assert.match(section(panel, "desk").textContent, /ledger unreadable: EISDIR/);
  assert.equal(section(panel, "telegram").textContent.includes("not configured (TELEGRAM_BOT_TOKEN and TELEGRAM_OPERATOR_ID in $DSH_HOME/.env)"), true);
  assert.match(section(panel, "conversation").textContent, /none yet/);
  assert.deepEqual(all(section(panel, "conversation"), (node) => node.tagName === "button"), [], "nothing to open");
  assert.match(section(panel, "sessions").textContent, /no desk sessions yet/);

  next = status({ deskSession: "session-gone", telegram: {
    configured: true, polling: false, dropped: 0, queued: 3, blocked: true, conflictAt: "2026-10-20T17:00:00.000Z",
    pollFailing: { since: "2026-10-20T17:30:00.000Z", reason: "HTTP 401 Unauthorized" },
  } });
  await desk.refresh();
  const telegram = section(panel, "telegram");
  assert.equal(kvValue(telegram, "send"), "blocked (403)");
  assert.equal(kvValue(telegram, "bridge"), "not polling");
  assert.equal(kvValue(telegram, "last poll"), "none yet");
  assert.equal(kvValue(telegram, "dropped"), "0");
  assert.equal(kvValue(telegram, "conflict"), "13:00 ET");
  assert.equal(kvValue(telegram, "poll"), "failing since 13:30 ET: HTTP 401 Unauthorized", "a failing poll, since when and why");
  assert.equal(kvValue(section(panel, "conversation"), "session"), "session-gone", "a session the list does not carry is named by its id");
}));

test("the desk conversation opens from its own card", () => withDOM(async (panel) => {
  const { desk, opened } = harness(panel, async () => status());
  await desk.refresh();
  one(section(panel, "conversation"), (node) => node.tagName === "button", "open button").fire("click");
  assert.deepEqual(opened, ["session-desk-1"]);
}));

test("the desk card's ↻ reads the status again", () => withDOM(async (panel) => {
  let count = 3;
  const { desk, calls } = harness(panel, async () => status({ turnsToday: { count: count++, usage: {} } }));
  await desk.refresh();
  assert.equal(kvValue(section(panel, "turns"), "turns"), "3");
  const again = one(section(panel, "desk"), (node) => node.hasClass("desk-refresh"), "refresh button");
  assert.equal(again.getAttribute("aria-label"), "refresh the desk's status");
  again.fire("click");
  await settle();
  assert.deepEqual(calls.map(([path]) => path), ["/data/desk/status", "/data/desk/status"]);
  assert.equal(kvValue(section(panel, "turns"), "turns"), "4");
  assert.equal(kvValue(section(panel, "turns"), "input"), "—", "a usage the status lacks is a dash, never a zero");
}));

test("no panel element is no drawing, and no failure", () => withDOM(async () => {
  const desk = createDeskPanel({
    panel: () => null,
    data: async () => status(),
    sessions: () => [],
    activeSession: () => null,
    open: () => {},
  });
  await desk.refresh();
  desk.syncSessions();
  desk.mark("session-desk-1");
  desk.hide();
}));

/** The chips a node carries, in order. */
const chipsOf = (node: Element): string[] => byClass(node, "chip").map((c) => c.textContent);

test("a desk session with a parked gate carries a waiting chip on its row and its conversation card, the rail's Desk item a badge while another panel is shown; both clear once the gate settles", () => withDOM(async (panel) => {
  const { desk, waiting, rail } = harness(panel, async () => status());
  const rows = () => byClass(section(panel, "sessions"), "desk-row");
  await desk.show();
  waiting.add("session-desk-1"); // a gate arrives; the list refresh it schedules follows
  desk.syncSessions();
  assert.deepEqual(chipsOf(rows()[0]), ["waiting", "current", "running"], "waiting first: it is the one that needs the operator");
  assert.equal(byClass(rows()[0], "waiting").length, 1, "the sidebar's own waiting chip");
  assert.deepEqual(chipsOf(rows()[1]), []);
  assert.deepEqual(chipsOf(section(panel, "conversation")), ["waiting"], "the desk conversation's card says it too");
  assert.equal(badgeOf(rail), undefined, "no badge while the Desk panel is shown: its chips say it");

  desk.hide(); // the operator moves to another panel
  assert.ok(badgeOf(rail), "the rail's Desk item is badged");
  assert.equal(rail.getAttribute("aria-label"), "Desk, waiting on you");
  desk.syncSessions();
  assert.equal(byClass(rail, "rail-badge").length, 1, "one badge however many refreshes");

  waiting.delete("session-desk-1"); // the gate settles; the list refresh it schedules follows
  desk.syncSessions();
  assert.equal(badgeOf(rail), undefined);
  assert.equal(rail.getAttribute("aria-label"), "Desk");
  assert.deepEqual(chipsOf(rows()[0]), ["current", "running"], "the hidden panel's rows clear too");
  assert.deepEqual(chipsOf(section(panel, "conversation")), []);

  waiting.add("session-desk-0"); // a gate on an older desk session, while another panel is shown
  desk.syncSessions();
  assert.ok(badgeOf(rail));
  await desk.show(); // the operator opens the Desk panel: its chips take over from the badge
  assert.equal(badgeOf(rail), undefined);
  assert.deepEqual(chipsOf(rows()[1]), ["waiting"]);
}));

test("the rail is badged before the Desk panel was ever opened: the badge reads the session list, not the status", () => withDOM(async (panel) => {
  const { desk, waiting, rail, calls } = harness(panel, async () => status());
  desk.hide(); // the page opened on another panel
  assert.equal(badgeOf(rail), undefined);
  waiting.add("session-desk-1");
  desk.syncSessions();
  assert.ok(badgeOf(rail));
  assert.deepEqual(calls, [], "no status read for it");
  assert.equal(panel.children.length, 0, "and nothing drawn into a panel never shown");
}));

test("an archived desk session is listed once, in the strategy list's archived bucket: the Desk panel leaves it out, and its gate does not badge the rail", () => withDOM(async (panel) => {
  const { desk, archived, waiting, rail } = harness(panel, async () => status());
  archived.add("session-desk-0");
  assert.deepEqual(deskSessionsOf(SESSIONS, (id: string) => archived.has(id)).map((s: any) => s.sessionId), ["session-desk-1"]);
  assert.deepEqual(deskSessionsOf(SESSIONS).map((s: any) => s.sessionId), ["session-desk-1", "session-desk-0"], "no predicate, nothing archived");
  await desk.show();
  assert.deepEqual(byClass(section(panel, "sessions"), "desk-row").map((row) => row.dataset.sessionId), ["session-desk-1"]);
  desk.hide();
  waiting.add("session-desk-0");
  desk.syncSessions();
  assert.equal(badgeOf(rail), undefined, "its waiting mark is the archived bucket's header's, where it is listed");
}));

test("while shown, the status is read again every 30 seconds - so a pause that lifted at its until stops showing - and hidden, never", () => withDOM(async (panel) => {
  let next = status({ off: { setAt: "2026-10-20T17:30:00.000Z", by: "page", until: "2026-10-20T18:00:30.000Z" } });
  const { desk, calls, timer } = harness(panel, async () => next);
  assert.equal(DESK_POLL_MS, 30_000);
  await desk.show();
  assert.deepEqual(timer.periods(), [30_000]);
  assert.equal(pauseLine(panel), "paused since 13:30 ET by page until 14:00 ET");
  next = status(); // past its until: the face's status no longer carries the pause
  timer.fire();
  await settle();
  assert.equal(pauseLine(panel), "not paused");
  assert.deepEqual(calls.map(([path]) => path), ["/data/desk/status", "/data/desk/status"]);

  await desk.show(); // shown again - the rail item clicked a second time: still one timer
  assert.deepEqual(timer.periods(), [30_000]);
  desk.hide();
  assert.deepEqual(timer.periods(), [], "hidden, it reads nothing");
  const before = calls.length;
  timer.fire();
  await settle();
  assert.equal(calls.length, before);
}));

test("the transcript's desk marks: a phone message's who-line, and a firing's or an alert's line", () => withDOM(() => {
  const who = phoneWhoNode() as unknown as Element;
  assert.equal(who.className, "who phone-who");
  const [glyph, name] = who.children;
  assert.equal(glyph.textContent, DESK_GLYPHS.telegram);
  assert.equal(glyph.getAttribute("aria-hidden"), "true", "the glyph is decoration; the name is read");
  assert.equal(name.textContent, "phone");
  assert.match(who.title, /phone/);

  const text = "[schedule · preclose · 2026-10-20]\nCheck the book before the close.";
  const line = deskLineNode({ kind: "desk-line", line: "schedule", order: "preclose", firing: "preclose:2026-10-20", date: "2026-10-20", text }) as unknown as Element;
  assert.equal(line.className, "room-line desk-line", "drawn as a room's line is");
  assert.equal(line.children[0].textContent, DESK_GLYPHS.schedule);
  assert.equal(line.children[0].getAttribute("aria-hidden"), "true");
  assert.equal(line.children[1].className, "room-line-text");
  assert.equal(line.children[1].textContent, "schedule · preclose · 2026-10-20");
  assert.equal(line.title, text, "the message the desk was sent, on hover");

  const alert = deskLineNode({ kind: "desk-line", line: "alert", alert: "a-0001", symbol: "NVDA", text: "" }) as unknown as Element;
  assert.equal(alert.children[0].textContent, DESK_GLYPHS.alert);
  assert.equal(alert.children[1].textContent, "alert · NVDA · a-0001");
  assert.equal(alert.title, "—");
  const odd = deskLineNode({ kind: "desk-line", line: "constructor" }) as unknown as Element;
  assert.equal(odd.children[0].textContent, "", "a line with no glyph of its own gets none, never an inherited member");
}));

test("the resume line keeps its command whole", () => withDOM(async (panel) => {
  const { desk } = harness(panel, async () => status({ off: { setAt: "2026-10-20T17:00:00.000Z", by: "terminal" } }));
  await desk.refresh();
  assert.equal(RESUME_LINE, `a terminal resumes it: ${RESUME_COMMAND}`);
  assert.equal(RESUME_COMMAND, "npm run desk -- resume");
  const command = one(section(panel, "desk"), (node) => node.hasClass("desk-resume-cmd"), "resume command");
  assert.equal(command.textContent, RESUME_COMMAND, "one element, which the page keeps from wrapping at its --");
}));

/* P2: the standing orders and the day's budget (client/desk-standing.js reads them), and the firings' sessions by name. */

/** The day's budget (src/desk.ts `BudgetState`): spent, 2,013,402 of 2,000,000. */
const SPENT = { dailyTokens: 2_000_000, used: { uncachedInputTokens: 13_402, outputTokens: 0, cacheReadTokens: 2_000_000, cacheWriteTokens: 0, total: 2_013_402 }, spent: true };
const OPEN_BUDGET = { dailyTokens: 2_000_000, used: { uncachedInputTokens: 0, outputTokens: 1_234_567, cacheReadTokens: 0, cacheWriteTokens: 0, total: 1_234_567 }, spent: false };
/** Today's pre-close brief, delivered at 13:31 ET in the firing session `session-fire-1`. */
const FIRED = {
  key: "preclose:2026-10-20", order: "preclose", date: "2026-10-20", kind: "finished", outcome: "delivered", t: "2026-10-20T17:31:40.000Z", sessionId: "session-fire-1",
  wallMs: 252_000, usage: { uncachedInputTokens: 34_567, outputTokens: 200_000, cacheReadTokens: 900_000, cacheWriteTokens: 100_000, routes: [] }, files: 1,
};
/** Yesterday's, refused before it ran: no session. */
const REFUSED = { key: "preclose:2026-10-19", order: "preclose", date: "2026-10-19", kind: "refused", outcome: "refused (budget)", t: "2026-10-19T19:30:05.000Z" };
/** The standing orders while their clock runs (src/standing.ts `StandingStatus`): the brief, and a channel's order whose text moved. */
const standingStatus = (fields: Record<string, unknown> = {}): Record<string, any> => ({
  file: { path: "/home/.dsh/face/desk/standing.yml", state: "loaded" },
  calendar: { python: "python3", state: "ok" },
  orders: [
    { id: "preclose", dir: "desk", file: "STANDING.md", at: "close-30m", producer: "builtin:brief", wake: true, enabled: true, expires: "2026-12-31", expired: false,
      hash: "ok", nextAnchor: "2026-10-20T19:30:00.000Z", last: FIRED },
    { id: "weekly", dir: "strategies/alpha", file: "WEEKLY.md", at: "open-15m", wake: true, enabled: true, expires: "2026-12-31", expired: false,
      hash: "changed", nextAnchor: "2026-10-21T13:15:00.000Z" },
  ],
  queued: [], recent: [FIRED, REFUSED],
  ...fields,
});
/** The texts of the nodes under `root` that carry `cls`, in order. */
const textsOf = (root: Element, cls: string): string[] => byClass(root, cls).map((node) => node.textContent);
/** A firing's session among the desk's, as dsh titles it from its first message. */
const FIRING_SESSION = {
  sessionId: "session-fire-1", agentPreset: "gravit-desk", cwd: "/repo/desk/journal", updatedAt: AT - 1_000,
  projections: { values: { title: "[schedule · preclose · 2026-10-20] Standing order preclose," } },
};

test("the standing orders card comes after today's turns: the budget line, in the needs-you colour once spent; why the orders stop; an order a row; the recent firings, opening their sessions in place", () => withDOM(async (panel) => {
  const { desk, opened } = harness(panel, async () => status({ budget: SPENT, standing: standingStatus({ ledger: { error: "EISDIR" } }) }), { sessions: [FIRING_SESSION, ...SESSIONS] });
  await desk.refresh();
  assert.deepEqual(sectionIds(panel), ["desk", "telegram", "conversation", "turns", "standing", "sessions"]);
  const card = section(panel, "standing");
  assert.match(card.children[0].textContent, /^standing orders$/);
  const budget = one(card, (node) => node.hasClass("standing-budget"), "budget line");
  assert.equal(budget.textContent, "budget: spent, 2,013,402 of 2,000,000 tokens today; standing orders and phone turns wait for 00:00 ET");
  assert.ok(budget.hasClass("spent"), "styled once the day's cap is reached");
  const banner = one(card, (node) => node.hasClass("standing-banner"), "banner");
  assert.equal(banner.textContent, "stopped: the firing ledger cannot be read (EISDIR)");
  assert.ok(banner.hasClass("err"));

  assert.deepEqual(textsOf(card, "standing-order-name"), ["preclose · close-30m", "weekly · open-15m"]);
  assert.deepEqual(textsOf(card, "standing-order-next"), ["next 15:30 ET", "next 2026-10-21 09:15 ET"]);
  const [preclose, weekly] = byClass(card, "standing-order");
  assert.deepEqual(textsOf(preclose, "standing-order-sub"), ["hash ok · last delivered 13:31 ET"]);
  assert.deepEqual(textsOf(weekly, "standing-order-sub"), ["strategies/alpha/WEEKLY.md changed since arming (npm run desk -- rearm weekly)", "last none yet"]);
  assert.ok(byClass(weekly, "standing-order-sub")[0].hasClass("bad"), "a moved pin is the operator's to review");

  assert.equal(one(card, (node) => node.hasClass("standing-recent"), "recent heading").textContent, "recent firings");
  const firings = byClass(card, "standing-firing");
  assert.deepEqual(firings.map((row) => textsOf(row, "standing-firing-name")[0]), ["preclose · 2026-10-20", "preclose · 2026-10-19"]);
  assert.deepEqual(firings.map((row) => textsOf(row, "standing-firing-outcome")[0]), ["delivered", "refused (budget)"]);
  assert.deepEqual(firings.map((row) => textsOf(row, "standing-firing-sub")[0]), ["13:31 ET · 4m 12s · 1,234,567 tokens · 1 file", "2026-10-19 15:30 ET"],
    "New York's time, the wall time, the four buckets' sum and the files written - what a firing has");

  const [fired, refused] = firings;
  assert.equal(fired.getAttribute("role"), "button");
  assert.equal(fired.tabIndex, 0);
  fired.fire("click");
  assert.deepEqual(opened, ["session-fire-1"], "its session opens in place, where its last message is read");
  assert.ok(byClass(section(panel, "sessions"), "desk-row").find((row) => row.dataset.sessionId === "session-fire-1")!.hasClass("sel"), "and its desk session row is marked");
  assert.equal(fired.fire("keydown", { key: "Enter" }).prevented, true);
  assert.deepEqual(opened, ["session-fire-1", "session-fire-1"]);
  assert.equal(refused.getAttribute("role"), null, "a firing that never ran has no session to open");
  refused.fire("click");
  assert.deepEqual(opened, ["session-fire-1", "session-fire-1"]);
}));

test("without the standing orders' status the card is the budget line alone; with neither field there is no card; an empty book says none armed", () => withDOM(async (panel) => {
  let next = status({ budget: OPEN_BUDGET });
  const { desk } = harness(panel, async () => next);
  await desk.refresh();
  assert.deepEqual(sectionIds(panel), ["desk", "telegram", "conversation", "turns", "standing", "sessions"]);
  let card = section(panel, "standing");
  assert.deepEqual(card.children.map((node) => node.textContent), ["standing orders", "budget: 1,234,567 of 2,000,000 tokens today"], "no clock runs: the budget line alone");
  assert.equal(byClass(card, "standing-budget")[0].hasClass("spent"), false);

  next = status();
  await desk.refresh();
  assert.deepEqual(sectionIds(panel), ["desk", "telegram", "conversation", "turns", "sessions"], "a status with neither: no card");

  next = status({ budget: OPEN_BUDGET, standing: standingStatus({ orders: [], recent: [] }) });
  await desk.refresh();
  card = section(panel, "standing");
  assert.deepEqual(card.children.map((node) => node.textContent).slice(2), ["none armed (npm run desk -- arm)"]);
  assert.equal(byClass(card, "standing-recent").length, 0, "no heading over no firings");

  next = status({ budget: OPEN_BUDGET, standing: standingStatus({ file: { path: "/s", state: "refused", errors: ["orders[0]: id is missing"] }, orders: [], recent: [] }) });
  await desk.refresh();
  card = section(panel, "standing");
  assert.deepEqual(card.children.map((node) => node.textContent).slice(2), ["stopped: standing.yml is refused: orders[0]: id is missing"], "a refused file is not an empty book");
}));

test("a firing's session is named <order> · <date> from the status, before its own title and Desk · <date>; titles() hands the names to the page and keeps them across a failed read", () => withDOM(async (panel) => {
  const titles = { "session-fire-1": "preclose · 2026-10-20" };
  assert.equal(deskTitle(FIRING_SESSION, titles), "preclose · 2026-10-20", "the ledger's name before the one dsh took from the first message");
  assert.equal(deskTitle(FIRING_SESSION), "[schedule · preclose · 2026-10-20] Standing order preclose,", "no names, the session's own title");
  assert.equal(deskTitle({ sessionId: "session-desk-9", updatedAt: AT }, titles), "Desk · 2026-10-20", "a session the names leave out");
  assert.equal(deskTitle({ sessionId: "constructor", updatedAt: AT }, {}), "Desk · 2026-10-20", "never an inherited member");

  let next: () => Promise<Record<string, any>> = async () => status({ budget: OPEN_BUDGET, standing: standingStatus() });
  const { desk } = harness(panel, () => next(), { sessions: [FIRING_SESSION, ...SESSIONS] });
  assert.deepEqual(desk.titles(), {}, "nothing read, no names");
  await desk.refresh();
  const names = () => byClass(section(panel, "sessions"), "desk-row").map((row) => textsOf(row, "sp-row-name")[0]);
  assert.deepEqual(names(), ["preclose · 2026-10-20", "Desk · 2026-10-20", "Monday's desk"]);
  assert.deepEqual(desk.titles(), titles, "the page names the session the same way (chat.js titleOf)");
  assert.equal(kvValue(section(panel, "conversation"), "session"), "Desk · 2026-10-20", "the desk conversation is no firing");

  next = async () => { throw new Error("HTTP 500"); };
  await desk.refresh();
  assert.deepEqual(desk.titles(), titles, "a failed read forgets no name");
  assert.deepEqual(names(), ["preclose · 2026-10-20", "Desk · 2026-10-20", "Monday's desk"]);

  next = async () => status();
  await desk.refresh();
  assert.deepEqual(desk.titles(), {}, "a status without the standing orders names none");
  assert.deepEqual(names(), ["[schedule · preclose · 2026-10-20] Standing order preclose,", "Desk · 2026-10-20", "Monday's desk"]);
}));
