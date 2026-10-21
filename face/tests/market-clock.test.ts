// face/tests/market-clock.test.ts
/** The market clock (src/market-clock.ts): reading the clock's JSON, a window's sessions and closed days,
 * running the clock (its argv, its keyless environment, its deadline, how each failure reads and the tail of
 * a failed run's stderr), and the calendar's cache - one ask per New York date, shared by concurrent calls, a
 * failed ask answered from a window that still covers the date and asked again every ten minutes until a
 * window holds it. Offline: a fake runner and a fake ask, except one test that runs scripts/market_clock.py
 * under the face's interpreter and skips when that interpreter has no pandas_market_calendars. */
import test from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CALENDAR_DAYS, CALENDAR_RETRY_MS, MARKET_CLOCK_TIMEOUT_MS, createMarketCalendar, parseMarketWindow, pythonMarketClock, sessionFor, windowCovers,
  type DayAnswer, type MarketClock, type MarketSession, type MarketWindow,
} from "../src/market-clock.ts";
import { baseEnv, type ProducerRunner, type RunResult } from "../src/producer.ts";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const S = (date: string, open: string, close: string, early = false): MarketSession => ({ date, open, close, early });
const FULL = (date: string): MarketSession => S(date, `${date}T14:30:00Z`, `${date}T21:00:00Z`);

/** What scripts/market_clock.py prints for `sessions --from 2026-11-24 --days 10`. */
const WINDOW = {
  ok: true,
  calendar: "XNYS",
  source: "pandas_market_calendars 5.4.0",
  python: "/x/bin/python3",
  from: "2026-11-24",
  days: 10,
  sessions: [
    FULL("2026-11-24"), FULL("2026-11-25"), S("2026-11-27", "2026-11-27T14:30:00Z", "2026-11-27T18:00:00Z", true),
    FULL("2026-11-30"), FULL("2026-12-01"), FULL("2026-12-02"), FULL("2026-12-03"),
  ],
};

/** WINDOW with `edit` applied to a deep copy, as the clock's stdout. */
function edited(edit: (w: any) => void): string {
  const copy = structuredClone(WINDOW);
  edit(copy);
  return JSON.stringify(copy);
}

const at = (iso: string): number => Date.parse(iso);

/* ---------- reading the clock ---------- */

test("parseMarketWindow reads the clock's JSON and refuses anything else", () => {
  const w = parseMarketWindow(JSON.stringify(WINDOW));
  assert.equal(w.sessions.length, 7);
  assert.deepEqual(w, { from: "2026-11-24", days: 10, source: "pandas_market_calendars 5.4.0", python: "/x/bin/python3", sessions: WINDOW.sessions });
  assert.deepEqual(parseMarketWindow(edited((c) => { c.extra = 1; c.sessions[0].extra = 2; })).sessions[0], FULL("2026-11-24"), "unknown keys are dropped");
  assert.deepEqual(parseMarketWindow(edited((c) => { c.sessions = []; })).sessions, [], "a window may hold no session");

  assert.throws(() => parseMarketWindow('{"ok":false,"error":"pandas_market_calendars is not importable in /x"}'),
    { message: "pandas_market_calendars is not importable in /x" });
  assert.throws(() => parseMarketWindow(JSON.stringify({ ok: false, error: `boom\n${"x".repeat(1_000)}` })),
    (e: Error) => !e.message.includes("\n") && e.message.startsWith("boom x") && e.message.endsWith("…") && [...e.message].length === 300,
    "the clock's own error is carried on one line, cut at 300 characters");
  assert.throws(() => parseMarketWindow('{"ok":false}'), { message: "the clock failed and gave no error" });

  const faults: [string, string][] = [
    ["", "not JSON"],
    ["nope", "not JSON"],
    ["null", "not a JSON object"],
    ["[]", "not a JSON object"],
    [edited((c) => { delete c.ok; }), "window has a bad ok"],
    [edited((c) => { c.calendar = "XLON"; }), "window has a bad calendar"],
    [edited((c) => { c.from = "2026-11-31"; }), "window has a bad from"],
    [edited((c) => { c.days = 0; }), "window has a bad days"],
    [edited((c) => { c.days = 32; }), "window has a bad days"],
    [edited((c) => { c.days = 9.5; }), "window has a bad days"],
    [edited((c) => { c.source = ""; }), "window has a bad source"],
    [edited((c) => { c.python = 3; }), "window has a bad python"],
    [edited((c) => { delete c.sessions; }), "sessions is not a list"],
    [edited((c) => { c.sessions = {}; }), "sessions is not a list"],
    [edited((c) => { c.sessions[1] = "2026-11-25"; }), "session 1 is not an object"],
    [edited((c) => { c.sessions[0].date = "2026-11-31"; }), "session 0 has a bad date"],
    [edited((c) => { c.sessions[0].close = "21:00"; }), "session 0 has a bad close"],
    [edited((c) => { c.sessions[0].open = "2026-11-24T14:30:00+00:00"; }), "session 0 has a bad open"],
    [edited((c) => { c.sessions[0].open = "2026-11-24T14:30:00.000Z"; }), "session 0 has a bad open"],
    [edited((c) => { c.sessions[0].open = "2026-11-25T14:30:00Z"; }), "session 0 has a bad open"],     // not its date
    [edited((c) => { c.sessions[0].open = "2026-11-24T04:30:00Z"; }), "session 0 has a bad open"],     // 23:30 ET the day before
    [edited((c) => { c.sessions[0].close = "2026-11-24T14:30:00Z"; }), "session 0 has a bad close"],   // not after its open
    [edited((c) => { c.sessions[0].close = "2026-11-25T05:30:00Z"; }), "session 0 has a bad close"],   // 00:30 ET the day after
    [edited((c) => { c.sessions[2].early = "yes"; }), "session 2 has a bad early"],
    [edited((c) => { [c.sessions[0], c.sessions[1]] = [c.sessions[1], c.sessions[0]]; }), "sessions are out of order"],
    [edited((c) => { c.sessions[1] = c.sessions[0]; }), "sessions are out of order"],
    [edited((c) => { c.sessions.push(FULL("2026-12-04")); }), "session 2026-12-04 is outside the window"],
    [edited((c) => { c.sessions.unshift(FULL("2026-11-23")); }), "session 2026-11-23 is outside the window"],
  ];
  for (const [stdout, message] of faults) assert.throws(() => parseMarketWindow(stdout), { message }, `${message} <- ${stdout.slice(0, 60)}`);
});

test("sessionFor: a session, closed inside the window, undefined outside it", () => {
  const w = parseMarketWindow(JSON.stringify(WINDOW));
  assert.equal((sessionFor(w, "2026-11-27") as MarketSession).early, true);
  assert.deepEqual(sessionFor(w, "2026-11-24"), FULL("2026-11-24"));
  assert.equal(sessionFor(w, "2026-11-26"), "closed"); assert.equal(sessionFor(w, "2026-11-28"), "closed");
  assert.equal(sessionFor(w, "2026-12-04"), undefined); assert.equal(sessionFor(w, "2026-11-23"), undefined);
  assert.equal(windowCovers(w, "2026-11-24"), true); assert.equal(windowCovers(w, "2026-12-03"), true);
  assert.equal(windowCovers(w, "2026-12-04"), false); assert.equal(windowCovers(w, "2026-11-23"), false);
  for (const bad of ["2026-11-24T00:00", "2026-11-31", "", "2026-11-2"]) assert.equal(sessionFor(w, bad), undefined, bad);
  const year = { ...w, from: "2026-12-28", days: 10, sessions: [] };
  assert.equal(windowCovers(year, "2027-01-06"), true, "a window runs across the year's end");
  assert.equal(windowCovers(year, "2027-01-07"), false);
});

/* ---------- running the clock ---------- */

test("pythonMarketClock runs the clock with the face's interpreter, no market keys and a 30 s deadline", async () => {
  const calls: { argv: string[]; opts: Parameters<ProducerRunner>[1] }[] = [];
  let result: RunResult = { code: 0, stdout: JSON.stringify(WINDOW), stderr: "", timedOut: false };
  const run: ProducerRunner = async (argv, opts) => {
    calls.push({ argv, opts });
    return result;
  };
  const root = "/repo";
  const saved = process.env.APCA_API_KEY_ID;
  process.env.APCA_API_KEY_ID = "PK-TEST";
  try {
    const clock = pythonMarketClock({ root, python: "python3", run });
    assert.equal((await clock("2026-11-24", 10)).sessions.length, 7);
    assert.deepEqual(calls[0].argv, [join(root, "scripts", "market_clock.py"), "sessions", "--from", "2026-11-24", "--days", "10"]);
    assert.equal(calls[0].opts.cwd, root);
    assert.equal(calls[0].opts.timeoutMs, MARKET_CLOCK_TIMEOUT_MS);
    assert.equal(MARKET_CLOCK_TIMEOUT_MS, 30_000);
    assert.equal(calls[0].opts.stdin, undefined);
    assert.equal(calls[0].opts.env.APCA_API_KEY_ID, undefined, "no market key reaches the clock");
    assert.deepEqual(calls[0].opts.env, baseEnv(process.env));

    const rejects = async (r: RunResult, message: string): Promise<void> => {
      result = r;
      await assert.rejects(clock("2026-11-24", 10), { message }, message);
    };
    const ended = { stderr: "", timedOut: false };
    await rejects({ ...ended, code: 1, stdout: '{"ok": false, "error": "pandas_market_calendars is not importable in /x"}' },
      "pandas_market_calendars is not importable in /x");
    await rejects({ ...ended, code: 2, stdout: '{"ok": false, "error": "usage: market_clock.py sessions --from YYYY-MM-DD --days N (1-31)"}' },
      "usage: market_clock.py sessions --from YYYY-MM-DD --days N (1-31)");
    await rejects({ ...ended, code: 1, stdout: "", stderr: "Traceback (most recent call last):" }, "exit 1");
    await rejects({ ...ended, code: 137, stdout: JSON.stringify(WINDOW) }, "exit 137");
    await rejects({ code: null, stdout: "", stderr: "", timedOut: true }, "timed out after 30 s");
    await rejects({ ...ended, code: null, stdout: "", error: "ENOENT" }, "could not start python3: ENOENT");
    await rejects({ ...ended, code: null, stdout: "x", error: "stdout over 1 MiB" }, "stdout over 1 MiB");
    await rejects({ ...ended, code: null, stdout: "", error: "stderr over 1 MiB" }, "stderr over 1 MiB");
    await rejects({ ...ended, code: 0, stdout: "nope" }, "not JSON");
    await rejects({ ...ended, code: 0, stdout: '{"ok":false,"error":"the XNYS calendar failed: RuntimeError: x"}' },
      "the XNYS calendar failed: RuntimeError: x");

    const slow = pythonMarketClock({ root, python: "/opt/py/bin/python3", run, timeoutMs: 60_000 });
    result = { code: null, stdout: "", stderr: "", timedOut: true };
    await assert.rejects(slow("2026-11-24", 10), { message: "timed out after 1 min" });
    assert.equal(calls.at(-1)!.opts.timeoutMs, 60_000);
    result = { code: null, stdout: "", stderr: "", timedOut: false, error: "EACCES" };
    await assert.rejects(slow("2026-11-24", 10), { message: "could not start /opt/py/bin/python3: EACCES" });
  } finally {
    if (saved === undefined) delete process.env.APCA_API_KEY_ID;
    else process.env.APCA_API_KEY_ID = saved;
  }
});

test("pythonMarketClock over the real script: the face's interpreter answers ten days from 2026-11-24", async (t) => {
  const python = process.env.FACE_PYTHON || "python3";
  let window: MarketWindow;
  try {
    window = await pythonMarketClock({ root: REPO_ROOT, python })("2026-11-24", CALENDAR_DAYS);
  } catch (error) {
    const message = (error as Error).message;
    if (/is not importable in|^could not start/.test(message)) {
      t.skip(`no calendar in ${python}: ${message}`);
      return;
    }
    throw error;
  }
  assert.equal(window.from, "2026-11-24");
  assert.equal(window.days, 10);
  assert.match(window.source, /^pandas_market_calendars \d/);
  assert.deepEqual(window.sessions.map((s) => s.date), ["2026-11-24", "2026-11-25", "2026-11-27", "2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03"]);
  assert.deepEqual(sessionFor(window, "2026-11-27"), S("2026-11-27", "2026-11-27T14:30:00Z", "2026-11-27T18:00:00Z", true));
  assert.equal(sessionFor(window, "2026-11-26"), "closed");
});

/* ---------- the calendar ---------- */

/** A fake ask: records each call, answers `windows[from]` or rejects with `fail` when it is set. */
function fakeAsk(windows: Record<string, MarketWindow>): { ask: MarketClock; asks: [string, number][]; fail: string | undefined } {
  const state = {
    asks: [] as [string, number][],
    fail: undefined as string | undefined,
    ask: (async (from: string, days: number) => {
      state.asks.push([from, days]);
      if (state.fail !== undefined) throw new Error(state.fail);
      const window = windows[from];
      if (window === undefined) throw new Error(`no window from ${from}`);
      return window;
    }) as MarketClock,
  };
  return state;
}

const W24 = parseMarketWindow(JSON.stringify(WINDOW));
const W25 = parseMarketWindow(edited((c) => {
  c.from = "2026-11-25";
  c.source = "pandas_market_calendars 5.4.0 (25th)";
  c.sessions = c.sessions.slice(1);
}));
const W26 = parseMarketWindow(edited((c) => {
  c.from = "2026-11-26";
  c.source = "pandas_market_calendars 5.4.1";
  c.sessions = [...c.sessions.slice(2), FULL("2026-12-04")];
}));

test("createMarketCalendar asks once per ET date, falls back to a covering window, and asks a failed date again every ten minutes until a window holds it", async () => {
  assert.equal(CALENDAR_RETRY_MS, 600_000);
  const windows: Record<string, MarketWindow> = { "2026-11-24": W24, "2026-11-26": W26 };
  const fake = fakeAsk(windows);
  const cal = createMarketCalendar({ ask: fake.ask, python: "python3" });
  assert.equal(cal.python, "python3");
  assert.equal(cal.peek(), undefined);
  assert.equal(cal.window(), undefined);

  const first = await cal.today(at("2026-11-24T15:00:00Z"));
  assert.deepEqual(fake.asks, [["2026-11-24", 10]]);
  assert.deepEqual(first, { ok: true, date: "2026-11-24", session: FULL("2026-11-24"), source: "pandas_market_calendars 5.4.0" });
  assert.deepEqual(cal.peek(), first);
  assert.equal(cal.window(), W24);

  // 04:30Z on the 25th is still the 24th in New York: nothing is asked
  assert.deepEqual(await cal.today(at("2026-11-25T04:30:00Z")), first);
  assert.equal(fake.asks.length, 1);

  // 05:00Z is midnight in New York: the 25th asks, the ask fails, and the 24th's window still holds the 25th
  fake.fail = "pandas_market_calendars is not importable in /x";
  const stale = await cal.today(at("2026-11-25T05:00:00Z"));
  assert.deepEqual(fake.asks, [["2026-11-24", 10], ["2026-11-25", 10]]);
  assert.deepEqual(stale, {
    ok: true, date: "2026-11-25", session: FULL("2026-11-25"), source: "pandas_market_calendars 5.4.0",
    stale: { error: "pandas_market_calendars is not importable in /x" },
  });

  // inside ten minutes of the failed ask, nothing is asked; at ten it is asked again, fails again, and stays stale
  assert.deepEqual(await cal.today(at("2026-11-25T05:09:59Z")), stale);
  assert.equal(fake.asks.length, 2);
  assert.deepEqual(await cal.today(at("2026-11-25T05:10:00Z")), stale);
  assert.deepEqual(fake.asks, [["2026-11-24", 10], ["2026-11-25", 10], ["2026-11-25", 10]]);

  // the clock answers again: ten minutes on, the date takes its own window, and is never asked again that day
  fake.fail = undefined;
  windows["2026-11-25"] = W25;
  assert.deepEqual(await cal.today(at("2026-11-25T05:19:59Z")), stale, "not yet ten minutes since the last ask");
  assert.equal(fake.asks.length, 3);
  const fresh = await cal.today(at("2026-11-25T05:20:00Z"));
  assert.deepEqual(fresh, { ok: true, date: "2026-11-25", session: FULL("2026-11-25"), source: "pandas_market_calendars 5.4.0 (25th)" });
  assert.equal(fake.asks.length, 4);
  assert.deepEqual(await cal.today(at("2026-11-25T20:59:00Z")), fresh);
  assert.equal(fake.asks.length, 4);
  assert.deepEqual(cal.peek(), fresh);
  assert.equal(cal.window(), W25);

  // the next date asks again: Thanksgiving, closed, from the fresh window
  const closed = await cal.today(at("2026-11-26T15:00:00Z"));
  assert.deepEqual(fake.asks.at(-1), ["2026-11-26", 10]);
  assert.deepEqual(closed, { ok: true, date: "2026-11-26", session: "closed", source: "pandas_market_calendars 5.4.1" });
  assert.equal(cal.window(), W26);

  // a fresh calendar whose first ask fails: { ok: false } until an ask ten minutes on answers - a transient
  // failure at the first ask after a boot costs ten minutes, not the day's anchored orders
  const failing = fakeAsk({ "2026-11-24": W24, "2026-11-25": W25 });
  failing.fail = "timed out after 30 s";
  const lone = createMarketCalendar({ ask: failing.ask, python: "/opt/py/bin/python3", days: 7 });
  const none: DayAnswer = { ok: false, date: "2026-11-24", error: "timed out after 30 s" };
  assert.deepEqual(await lone.today(at("2026-11-24T15:00:00Z")), none);
  assert.deepEqual(await lone.today(at("2026-11-24T15:09:00Z")), none);
  assert.deepEqual(failing.asks, [["2026-11-24", 7]]);
  assert.deepEqual(lone.peek(), none);
  assert.equal(lone.window(), undefined);
  failing.fail = undefined;
  const answered = await lone.today(at("2026-11-24T15:10:00Z"));
  assert.deepEqual(answered, { ok: true, date: "2026-11-24", session: FULL("2026-11-24"), source: "pandas_market_calendars 5.4.0" });
  assert.deepEqual(failing.asks, [["2026-11-24", 7], ["2026-11-24", 7]]);
  assert.deepEqual(await lone.today(at("2026-11-24T21:30:00Z")), answered);
  assert.equal(failing.asks.length, 2, "a date its own ask answered is never asked again");
  assert.equal(lone.window(), W24);
  assert.deepEqual(await lone.today(at("2026-11-25T15:00:00Z")), { ok: true, date: "2026-11-25", session: FULL("2026-11-25"), source: "pandas_market_calendars 5.4.0 (25th)" });
  assert.deepEqual(failing.asks.at(-1), ["2026-11-25", 7]);

  // a re-ask under way is shared: two calls ten minutes on make one ask
  const flaky = fakeAsk({});
  flaky.fail = "exit 1";
  const shared = createMarketCalendar({ ask: flaky.ask, python: "python3" });
  await shared.today(at("2026-11-24T15:00:00Z"));
  const [one, two] = await Promise.all([shared.today(at("2026-11-24T15:10:00Z")), shared.today(at("2026-11-24T15:10:01Z"))]);
  assert.deepEqual(one, two);
  assert.equal(flaky.asks.length, 2);
  assert.deepEqual(await shared.today(at("2026-11-24T15:19:59Z")), one);
  assert.equal(flaky.asks.length, 2, "ten minutes from the re-ask, not from the first");
  await shared.today(at("2026-11-24T15:20:00Z"));
  assert.equal(flaky.asks.length, 3);
});

test("pythonMarketClock hands the tail of a failed run's stderr - its last 300 characters, on one line - to stderr", async () => {
  let result: RunResult = { code: 0, stdout: JSON.stringify(WINDOW), stderr: "", timedOut: false };
  const run: ProducerRunner = async () => result;
  const told: string[] = [];
  const clock = pythonMarketClock({ root: "/repo", python: "python3", run, stderr: (tail) => { told.push(tail); } });
  const fails = async (r: RunResult, message: string): Promise<void> => {
    result = r;
    await assert.rejects(clock("2026-11-24", 10), { message });
  };
  await fails({ code: 1, stdout: "", stderr: "Traceback (most recent call last):\n  File \"x\", line 1\nSystemError: boom\n", timedOut: false }, "exit 1");
  assert.deepEqual(told, ["Traceback (most recent call last): File \"x\", line 1 SystemError: boom"]);
  await fails({ code: 1, stdout: "", stderr: `${"a".repeat(1_000)}\nthe end\n`, timedOut: false }, "exit 1");
  const tail = told.at(-1) ?? "";
  assert.ok(tail.startsWith("…a") && tail.endsWith("a the end") && [...tail].length === 300, tail);
  await fails({ code: null, stdout: "", stderr: "still loading\n", timedOut: true }, "timed out after 30 s");
  await fails({ code: 0, stdout: "nope", stderr: "a warning\n", timedOut: false }, "not JSON");
  assert.deepEqual(told.slice(2), ["still loading", "a warning"], "any run that answers no window hands its stderr");
  await fails({ code: 1, stdout: '{"ok":false,"error":"pandas_market_calendars is not importable in /x"}', stderr: "", timedOut: false },
    "pandas_market_calendars is not importable in /x");
  await fails({ code: 1, stdout: "", stderr: " \n\t\n", timedOut: false }, "exit 1");
  assert.equal(told.length, 4, "no stderr, or only blanks: nothing");
  result = { code: 0, stdout: JSON.stringify(WINDOW), stderr: "DeprecationWarning: x\n", timedOut: false };
  assert.equal((await clock("2026-11-24", 10)).sessions.length, 7);
  assert.equal(told.length, 4, "a run that answered hands nothing");

  /* a hook that throws costs the ask nothing but the line: the ask still rejects with its own error */
  const throwing = pythonMarketClock({ root: "/repo", python: "python3", run, stderr: () => { throw new Error("a broken log"); } });
  result = { code: 1, stdout: "", stderr: "boom\n", timedOut: false };
  await assert.rejects(throwing("2026-11-24", 10), { message: "exit 1" });
});

test("createMarketCalendar: two concurrent today() calls share one ask", async () => {
  let release!: (w: MarketWindow) => void;
  const asks: string[] = [];
  const cal = createMarketCalendar({
    python: "python3",
    ask: (from) => {
      asks.push(from);
      return new Promise<MarketWindow>((resolve) => { release = resolve; });
    },
  });
  const a = cal.today(at("2026-11-24T15:00:00Z"));
  const b = cal.today(at("2026-11-24T15:00:01Z"));
  assert.deepEqual(asks, ["2026-11-24"]);
  release(W24);
  const [ra, rb] = await Promise.all([a, b]);
  assert.deepEqual(ra, rb);
  assert.equal((ra as { session: MarketSession }).session, W24.sessions[0]);
  assert.deepEqual(asks, ["2026-11-24"]);
});

test("createMarketCalendar: a throwing ask, a window that does not hold the date, and asks that settle out of order", async () => {
  // an ask that throws instead of rejecting is a failed ask like any other: today() still answers
  const throwing = createMarketCalendar({ python: "python3", ask: () => { throw new Error("spawn refused"); } });
  assert.deepEqual(await throwing.today(at("2026-11-24T15:00:00Z")), { ok: false, date: "2026-11-24", error: "spawn refused" });

  // a window that does not hold the date asked is refused, and the newest good window still serves
  const fake = fakeAsk({ "2026-11-24": W24, "2026-12-04": W24, "2026-12-05": W26 });
  const cal = createMarketCalendar({ ask: fake.ask, python: "python3" });
  await cal.today(at("2026-11-24T15:00:00Z"));
  assert.deepEqual(await cal.today(at("2026-12-04T15:00:00Z")), {
    ok: false, date: "2026-12-04", error: "the market clock answered a window from 2026-11-24 for 10 days, which does not hold 2026-12-04",
  });
  assert.equal(cal.window(), W24);
  assert.deepEqual(await cal.today(at("2026-12-05T15:00:00Z")), { ok: true, date: "2026-12-05", session: "closed", source: "pandas_market_calendars 5.4.1" });
  assert.equal(cal.window(), W26);

  // a long error is carried on one line, cut at 300 characters
  const noisy = createMarketCalendar({ python: "python3", ask: async () => { throw new Error(`line one\nline two ${"y".repeat(500)}`); } });
  const loud = await noisy.today(at("2026-11-24T15:00:00Z"));
  assert.equal(loud.ok, false);
  const error = (loud as { error: string }).error;
  assert.ok(error.startsWith("line one line two y") && error.endsWith("…") && [...error].length === 300, error);

  // the older date's ask settling last neither replaces the newer window nor what peek() says
  const gates: Record<string, (w: MarketWindow) => void> = {};
  const racing = createMarketCalendar({
    python: "python3",
    ask: (from) => new Promise<MarketWindow>((resolve) => { gates[from] = resolve; }),
  });
  const older = racing.today(at("2026-11-24T15:00:00Z"));
  const newer = racing.today(at("2026-11-26T15:00:00Z"));
  gates["2026-11-26"](W26);
  assert.equal((await newer).date, "2026-11-26");
  gates["2026-11-24"](W24);
  assert.deepEqual(await older, { ok: true, date: "2026-11-24", session: FULL("2026-11-24"), source: "pandas_market_calendars 5.4.0" });
  assert.equal(racing.window(), W26);
  assert.equal(racing.peek()?.date, "2026-11-26");
});
