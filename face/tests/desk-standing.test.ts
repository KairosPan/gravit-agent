/** The standing orders' card as the Desk panel reads it (client/desk-standing.js): the day's budget, why the
 * orders are stopped, an order's next anchor, pins and last firing, and the recent firings - New York's
 * times, wall time, tokens and files - and the firing sessions' names. Pure: a status in, words out.
 */
import assert from "node:assert/strict";
import test from "node:test";
// desk-standing.js is plain ESM JS (it ships to the browser); tsconfig `allowJs` lets this test import it.
import { NONE_ARMED, firingTitles, standingView } from "../client/desk-standing.js";

/** 11:00 ET on 2026-11-27, the early close after Thanksgiving. */
const NOW = "2026-11-27T16:00:00.000Z";

/** A turn's four buckets, summing to 1,234,567, and the route it ran on. */
const USAGE = { uncachedInputTokens: 34_567, outputTokens: 200_000, cacheReadTokens: 900_000, cacheWriteTokens: 100_000, routes: ["deepseek/deepseek-chat"] };

/** The day before's pre-close brief, delivered at 15:31 ET (src/standing.ts `FiringSummary`). */
const DELIVERED = {
  key: "preclose:2026-11-26", order: "preclose", date: "2026-11-26", kind: "finished", outcome: "delivered", t: "2026-11-26T20:31:40.000Z",
  sessionId: "session-26", wallMs: 252_000, usage: USAGE, files: 3,
};
/** This morning's: its text held while the desk was paused, nothing written. */
const HELD = {
  key: "brief:2026-11-27", order: "brief", date: "2026-11-27", kind: "finished", outcome: "undelivered (paused)", t: "2026-11-27T15:02:09.000Z",
  sessionId: "session-a", wallMs: 9_000, usage: { uncachedInputTokens: 1_000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0, routes: [] }, files: 0,
};
/** A missed one: no session, no wall time, no tokens, no files. */
const MISSED = { key: "weekly:2026-11-27", order: "weekly", date: "2026-11-27", kind: "missed", outcome: "missed", t: "2026-11-27T15:40:00.000Z" };

/** One order of the status (src/standing.ts `StandingStatus.orders`): the pre-close brief, every pin good. */
const PRECLOSE = {
  id: "preclose", dir: "desk", file: "STANDING.md", at: "close-30m", producer: "builtin:brief", wake: true, enabled: true,
  expires: "2026-12-31", expired: false, hash: "ok", nextAnchor: "2026-11-27T17:30:00.000Z", last: DELIVERED,
};
/** A channel's order whose text was edited after arming; its next session is Monday's. */
const WEEKLY = {
  id: "weekly", dir: "strategies/alpha", file: "WEEKLY.md", at: "open-15m", producer: "scripts/weekly.py", wake: true, enabled: true,
  expires: "2026-12-31", expired: false, hash: "changed", producerHash: "ok", nextAnchor: "2026-11-30T14:15:00.000Z",
};

/** What `GET /data/desk/status` carries of the standing orders while their clock runs. */
const standing = (fields: Record<string, unknown> = {}): Record<string, any> => ({
  file: { path: "/h/.dsh/face/desk/standing.yml", state: "loaded", loadedAt: "2026-11-27T15:59:30.000Z" },
  calendar: { python: "python3", state: "ok", today: { date: "2026-11-27", open: "2026-11-27T14:30:00.000Z", close: "2026-11-27T18:00:00.000Z", early: true } },
  orders: [PRECLOSE, WEEKLY], queued: [], recent: [MISSED, HELD, DELIVERED],
  ...fields,
});
const zeros = { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
/** The day's budget (src/desk.ts `BudgetState`): 1,234,567 tokens against a 2,000,000 cap. */
const BUDGET = { dailyTokens: 2_000_000, used: { ...zeros, outputTokens: 1_234_567, total: 1_234_567 }, spent: false };
const status = (fields: Record<string, unknown> = {}): Record<string, any> => ({ ok: true, budget: BUDGET, standing: standing(), ...fields });

test("standingView renders the orders, the budget and the recent firings in ET", () => {
  assert.deepEqual(standingView(status(), NOW), {
    budget: "budget: 1,234,567 of 2,000,000 tokens today",
    spent: false,
    orders: [
      { id: "preclose", at: "close-30m", next: "next 12:30 ET", hash: "ok", last: "delivered 2026-11-26 15:31 ET" },
      { id: "weekly", at: "open-15m", next: "next 2026-11-30 09:15 ET", hash: "strategies/alpha/WEEKLY.md changed since arming (npm run desk -- rearm weekly)", last: "none yet" },
    ],
    recent: [
      { when: "10:40", order: "weekly", date: "2026-11-27", outcome: "missed", wall: "—", tokens: "—", files: "—" },
      { when: "10:02", order: "brief", date: "2026-11-27", outcome: "undelivered (paused)", wall: "9s", tokens: "1,200", files: "0", sessionId: "session-a" },
      { when: "2026-11-26 15:31", order: "preclose", date: "2026-11-26", outcome: "delivered", wall: "4m 12s", tokens: "1,234,567", files: "3", sessionId: "session-26" },
    ],
  });
  const late = { ...DELIVERED, t: "2026-11-27T04:59:00.000Z", wallMs: 3_725_000 };
  assert.deepEqual(standingView(status({ standing: standing({ recent: [late] }) }), NOW).recent.map((r: any) => [r.when, r.wall]), [["2026-11-26 23:59", "1h 2m"]],
    "04:59 UTC on the 27th is still the 26th in New York; an hour or more is hours and minutes");
  const many = Array.from({ length: 12 }, (_, i) => ({ ...MISSED, key: `weekly:${i}`, date: `2026-11-${String(i + 1).padStart(2, "0")}` }));
  assert.equal(standingView(status({ standing: standing({ recent: many }) }), NOW).recent.length, 10, "the ten most recent");
});

test("the budget line is the terminal's and the phone's: no cap, spent, an unreadable ledger", () => {
  const line = (budget: unknown) => standingView(status({ budget }), NOW);
  assert.equal(line({ used: { ...zeros, total: 1_234_567 }, spent: false }).budget, "budget: 1,234,567 tokens today, cap not set (budget.dailyTokens in standing.yml)");
  const spent = line({ dailyTokens: 2_000_000, used: { ...zeros, total: 2_013_402 }, spent: true });
  assert.equal(spent.budget, "budget: spent, 2,013,402 of 2,000,000 tokens today; standing orders and phone turns wait for 00:00 ET");
  assert.equal(spent.spent, true, "the card styles it");
  assert.equal(line({ used: { ...zeros, total: 0 }, spent: false, error: "EACCES" }).budget,
    "budget: 0 tokens today, cap not set (budget.dailyTokens in standing.yml) (ledger unreadable: EACCES)");
  assert.deepEqual([line(undefined).budget, line(undefined).spent], ["budget: —", false], "a status with no budget says it has none");
});

test("the banner says why every order is stopped, or the day has no calendar, a line each; none while they run", () => {
  const errors = [
    'orders[0] (preclose): at must be an anchor - open, close, open-Nm, close-Nm or HH:MM - not "9:30"',
    "orders[1] (weekly): not armed: npm run desk -- arm strategies/alpha --id weekly …",
    'budget.dailyTokens must be a whole number above zero, not "lots"',
  ];
  const banner = (fields: Record<string, unknown>) => standingView(status({ standing: standing(fields) }), NOW).banner;
  assert.equal(banner({}), undefined);
  assert.equal(Object.hasOwn(standingView(status(), NOW), "banner"), false, "no key while the orders run");
  assert.equal(banner({ file: { path: "/h", state: "refused", errors }, orders: [] }),
    'stopped: standing.yml is refused: orders[0] (preclose): at must be an anchor - open, close, open-Nm, close-Nm or HH:MM - not "9:30"; '
    + "orders[1] (weekly): not armed: npm run desk -- arm strategies/alpha --id weekly …; budget.dailyToken…", "the errors cut at 200 characters, the last a …");
  assert.equal(banner({ file: { path: "/h", state: "refused", errors: errors.slice(0, 1) } }),
    'stopped: standing.yml is refused: orders[0] (preclose): at must be an anchor - open, close, open-Nm, close-Nm or HH:MM - not "9:30"');
  assert.equal(banner({ ledger: { error: "EISDIR" } }), "stopped: the firing ledger cannot be read (EISDIR)");
  assert.equal(banner({ calendar: { python: "/opt/py/bin/python3", state: "failed", error: "pandas_market_calendars is not importable in /opt/py/bin/python3" } }),
    "no calendar today, /opt/py/bin/python3: pandas_market_calendars is not importable in /opt/py/bin/python3");
  assert.equal(banner({ calendar: { python: "python3", state: "stale" } }), undefined, "a stale window still covers today");
  assert.equal(banner({ file: { path: "/h", state: "refused", errors: ["x"] }, ledger: { error: "EACCES" }, calendar: { python: "python3", state: "failed", error: "exit 1" } }),
    "stopped: standing.yml is refused: x\nstopped: the firing ledger cannot be read (EACCES)\nno calendar today, python3: exit 1", "every reason, a line each");
  assert.equal(NONE_ARMED, "none armed (npm run desk -- arm)", "what the card says for an empty book: the terminal's words");
});

test("an order's next anchor or the state that holds it, its pins and its last firing", () => {
  const order = (fields: Record<string, unknown>, more: Record<string, unknown> = {}) =>
    standingView(status({ standing: standing({ orders: [{ ...PRECLOSE, ...fields }], ...more }) }), NOW).orders[0];
  const running = { key: "preclose:2026-11-27", startedAt: "2026-11-27T17:30:04.000Z", sessionId: "session-run" };
  assert.equal(order({}, { running }).next, "running since 12:30 ET");
  assert.equal(order({}, { running: { ...running, key: "preclose-2:2026-11-27" } }).next, "next 12:30 ET", "another order's firing is not this one's");
  assert.equal(order({ enabled: false }).next, "disabled");
  assert.equal(order({ expired: true, expires: "2026-11-26" }).next, "expired after 2026-11-26");
  assert.equal(order({ nextAnchor: undefined }).next, "no session in the calendar's window");
  assert.equal(order({ hash: "missing" }).hash, "desk/STANDING.md is missing");
  assert.equal(order({ producer: "scripts/p.py", producerHash: "changed" }).hash, "scripts/p.py changed since arming (npm run desk -- rearm preclose)");
  assert.equal(order({ producer: "scripts/p.py", producerHash: "missing" }).hash, "scripts/p.py is missing");
  assert.equal(order({ hash: "changed", producer: "scripts/p.py", producerHash: "changed" }).hash, "desk/STANDING.md changed since arming (npm run desk -- rearm preclose)",
    "the text's pin before the script's");
  assert.equal(order({ hash: "unknown" }).hash, "unknown", "a pin not yet checked claims nothing");
  assert.equal(order({ producer: "scripts/p.py", producerHash: "unknown" }).hash, "unknown");
  assert.equal(order({ last: { ...DELIVERED, outcome: "refused (budget)", t: "2026-11-27T17:30:10.000Z" } }).last, "refused (budget) 12:30 ET");
});

test("without the standing orders' status the card is the budget line alone", () => {
  const view = standingView({ ok: true, budget: BUDGET }, NOW);
  assert.deepEqual(view, { budget: "budget: 1,234,567 of 2,000,000 tokens today", spent: false, orders: [], recent: [] });
  assert.deepEqual(standingView(undefined as any, NOW), { budget: "budget: —", spent: false, orders: [], recent: [] }, "nothing read, nothing claimed");
});

test("firingTitles names firing sessions from the ledger", () => {
  const today = { ...HELD, key: "preclose:2026-11-27", order: "preclose", date: "2026-11-27" };
  assert.deepEqual(firingTitles(standing({ orders: [], recent: [today, MISSED] })), { "session-a": "preclose · 2026-11-27" }, "a firing with no session names none");
  assert.deepEqual(firingTitles(standing()), { "session-a": "brief · 2026-11-27", "session-26": "preclose · 2026-11-26" });
  const older = { ...DELIVERED, key: "preclose:2026-11-20", date: "2026-11-20", sessionId: "session-20" };
  assert.deepEqual(firingTitles(standing({ orders: [{ ...PRECLOSE, last: older }], recent: [] })), { "session-20": "preclose · 2026-11-20" },
    "an order's last firing, gone from the recent ten");
  assert.deepEqual(firingTitles(standing({ orders: [], recent: [], running: { key: "weekly:2026-11-27", startedAt: "2026-11-27T15:40:00.000Z", sessionId: "session-run" } })),
    { "session-run": "weekly · 2026-11-27" }, "the firing running now");
  assert.deepEqual(firingTitles(undefined), {});
  assert.deepEqual(firingTitles(standing({ orders: [null], recent: [null, { order: "x", date: "y", sessionId: "" }], running: { key: "nocolon", sessionId: "s" } })), {});
});
