// face/tests/market-clock.test.ts
/** The market clock (src/market-clock.ts): the builtin XNYS rules - the cases the retired pytest of
 * scripts/market_clock.py held (a ten-day window, empty windows, the 2026 count and early closes, both DST
 * changes, no weekend session, the year's end, refused arguments), ported to Node, plus every 2026 and 2027
 * NYSE holiday and early close against the exchange's published schedule - a window's sessions and closed
 * days, and the calendar's cache: one ask per New York date, shared by concurrent calls, a failed ask
 * answered from a window that still covers the date and asked again every ten minutes until a window holds
 * it. Offline and pure: no interpreter, no network, no file. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { etDate } from "../src/et.ts";
import {
  CALENDAR_DAYS, CALENDAR_RETRY_MS, MAX_WINDOW_DAYS, XNYS_AD_HOC_CLOSURES, XNYS_CLOCK, builtinMarketClock, createMarketCalendar, easterSunday,
  sessionFor, windowCovers, xnysEarlyCloses, xnysHolidays, xnysWindow,
  type DayAnswer, type MarketClock, type MarketSession, type MarketWindow,
} from "../src/market-clock.ts";

const S = (date: string, open: string, close: string, early = false): MarketSession => ({ date, open, close, early });
const FULL = (date: string): MarketSession => S(date, `${date}T14:30:00Z`, `${date}T21:00:00Z`);

/** The ten days from 2026-11-24, as the retired script printed them. */
const WINDOW: MarketWindow = {
  from: "2026-11-24",
  days: 10,
  source: "a stand-in clock",
  sessions: [
    FULL("2026-11-24"), FULL("2026-11-25"), S("2026-11-27", "2026-11-27T14:30:00Z", "2026-11-27T18:00:00Z", true),
    FULL("2026-11-30"), FULL("2026-12-01"), FULL("2026-12-02"), FULL("2026-12-03"),
  ],
};

const at = (iso: string): number => Date.parse(iso);

/** Every session from `from` through `to` inclusive, asked as windows of at most 31 days. */
function sessionsThrough(from: string, to: string): MarketSession[] {
  const out: MarketSession[] = [];
  let start = from;
  while (start <= to) {
    const span = Math.min(MAX_WINDOW_DAYS, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1);
    const window = xnysWindow(start, span);
    out.push(...window.sessions);
    start = new Date(Date.parse(`${start}T00:00:00Z`) + span * 86_400_000).toISOString().slice(0, 10);
  }
  return out;
}

/* ---------- the rules (the retired pytest's cases, ported) ---------- */

test("xnysWindow: ten days from 2026-11-24 - Thanksgiving closed, the day after closing early at 18:00Z, the weekends closed", () => {
  assert.deepEqual(xnysWindow("2026-11-24", 10), { ...WINDOW, source: XNYS_CLOCK });
});

test("xnysWindow: a closed stretch is an empty window - Thanksgiving alone, a weekend", () => {
  assert.deepEqual(xnysWindow("2026-11-26", 1), { from: "2026-11-26", days: 1, source: XNYS_CLOCK, sessions: [] });
  assert.deepEqual(xnysWindow("2026-11-28", 2), { from: "2026-11-28", days: 2, source: XNYS_CLOCK, sessions: [] });
});

test("2026 has 251 sessions and two early closes, both at 18:00Z", () => {
  const sessions = sessionsThrough("2026-01-01", "2026-12-31");
  assert.equal(sessions.length, 251);
  assert.deepEqual(sessions.filter((s) => s.early).map((s) => [s.date, s.close]), [["2026-11-27", "2026-11-27T18:00:00Z"], ["2026-12-24", "2026-12-24T18:00:00Z"]]);
});

test("the DST instants: the last EST Friday, the first EDT Monday, the last EDT Friday, the first EST Monday; July 2 is a full day", () => {
  const by = new Map(sessionsThrough("2026-01-01", "2026-12-31").map((s) => [s.date, s]));
  assert.deepEqual(["2026-03-06", "2026-03-09", "2026-10-30", "2026-11-02"].map((d) => by.get(d)?.open),
    ["2026-03-06T14:30:00Z", "2026-03-09T13:30:00Z", "2026-10-30T13:30:00Z", "2026-11-02T14:30:00Z"]);
  assert.deepEqual(["2026-03-06", "2026-03-09"].map((d) => by.get(d)?.close), ["2026-03-06T21:00:00Z", "2026-03-09T20:00:00Z"]);
  assert.deepEqual(by.get("2026-07-02"), S("2026-07-02", "2026-07-02T13:30:00Z", "2026-07-02T20:00:00Z"));
  for (const holiday of ["2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25"]) {
    assert.equal(by.has(holiday), false, holiday);
  }
});

test("2026 and 2027: 502 sessions, none on a weekend, every open and close on its own New York date; the DST changes fall on Sundays", () => {
  const sessions = sessionsThrough("2026-01-01", "2027-12-31");
  assert.equal(sessions.length, 502);
  assert.deepEqual(sessions.filter((s) => [0, 6].includes(new Date(`${s.date}T12:00:00Z`).getUTCDay())), []);
  for (const s of sessions) {
    assert.equal(etDate(new Date(s.open)), s.date, `${s.date} open`);
    assert.equal(etDate(new Date(s.close)), s.date, `${s.date} close`);
    assert.ok(Date.parse(s.close) > Date.parse(s.open), s.date);
  }
  /* where New York's offset at 00:00 and at 23:00 differ - read from Intl, not from the module's own rule */
  const offset = (iso: string): string => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "shortOffset" }).formatToParts(new Date(iso)).find((p) => p.type === "timeZoneName")!.value;
  const changes: string[] = [];
  for (let ms = Date.parse("2026-01-01T12:00:00Z"); ms < Date.parse("2028-01-01T12:00:00Z"); ms += 86_400_000) {
    const day = new Date(ms).toISOString().slice(0, 10);
    if (offset(`${day}T05:30:00Z`) !== offset(`${day}T23:59:00Z`)) changes.push(day);
  }
  assert.deepEqual(changes, ["2026-03-08", "2026-11-01", "2027-03-14", "2027-11-07"]);
  for (const day of changes) assert.equal(new Date(`${day}T12:00:00Z`).getUTCDay(), 0, `${day} is a Sunday`);
  /* and the module's offsets agree with Intl's on every session */
  for (const s of sessions) {
    const [hh, mm] = new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(s.open)).split(":");
    assert.equal(`${hh}:${mm}`, "09:30", `${s.date} opens 09:30 in New York`);
  }
});

test("the year's end: the window runs across it, New Year's Day closed, and a Saturday New Year closes no Friday", () => {
  assert.deepEqual(xnysWindow("2026-12-28", 10).sessions.map((s) => s.date),
    ["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-04", "2027-01-05", "2027-01-06"]);
  /* 2028-01-01 is a Saturday: NYSE does not close the Friday before */
  assert.deepEqual(xnysWindow("2027-12-29", 6).sessions.map((s) => [s.date, s.early]),
    [["2027-12-29", false], ["2027-12-30", false], ["2027-12-31", false], ["2028-01-03", false]]);
});

test("xnysWindow refuses a malformed date and a day count outside 1 to 31, as the script's usage line did", () => {
  for (const days of [0, 32, 1.5, -1, Number.NaN]) {
    assert.throws(() => xnysWindow("2026-11-24", days), { message: `the market clock takes 1 to 31 days, not ${String(days)}` }, String(days));
  }
  for (const from of ["2026-13-01", "2026-02-30", "20261124", "", "2026-11-24T00:00"]) {
    assert.throws(() => xnysWindow(from, 10), /the market clock takes a YYYY-MM-DD date/, from);
  }
});

/* ---------- the published schedule ---------- */

/* NYSE's published 2026 and 2027 holidays and early closes, hard-coded here from the exchange's schedule as
 * known when this test was written (not fetched), so the rules are checked against an independent list. */
const PUBLISHED: Record<number, { holidays: string[]; early: string[] }> = {
  2026: {
    holidays: ["2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25"],
    early: ["2026-11-27", "2026-12-24"],
  },
  2027: {
    holidays: ["2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24"],
    early: ["2027-11-26"],
  },
};

test("every 2026 and 2027 NYSE holiday and early close matches the published schedule", () => {
  for (const [year, published] of Object.entries(PUBLISHED)) {
    assert.deepEqual(xnysHolidays(Number(year)), published.holidays, `${year} holidays`);
    assert.deepEqual(xnysEarlyCloses(Number(year)), published.early, `${year} early closes`);
    const sessions = sessionsThrough(`${year}-01-01`, `${year}-12-31`);
    const dates = new Set(sessions.map((s) => s.date));
    for (const day of published.holidays) assert.equal(dates.has(day), false, `${day} has no session`);
    assert.deepEqual(sessions.filter((s) => s.early).map((s) => s.date), published.early, `${year}: the early sessions`);
    for (const s of sessions.filter((x) => x.early)) assert.equal(etDate(new Date(s.close)) === s.date && s.close.slice(11, 16), "18:00", `${s.date} closes 13:00 EST`);
  }
});

test("Easter by the computus, Good Friday two days before it, and the ad-hoc closures closed", () => {
  assert.deepEqual([2024, 2025, 2026, 2027, 2028, 2029].map(easterSunday), ["2024-03-31", "2025-04-20", "2026-04-05", "2027-03-28", "2028-04-16", "2029-04-01"]);
  assert.ok(xnysHolidays(2025).includes("2025-04-18"));
  for (const day of Object.keys(XNYS_AD_HOC_CLOSURES)) assert.deepEqual(xnysWindow(day, 1).sessions, [], day);
  assert.deepEqual(xnysWindow("2025-01-08", 3).sessions.map((s) => s.date), ["2025-01-08", "2025-01-10"], "the Carter day of mourning");
  /* Juneteenth from 2022 only, and July 3 early only when it falls Monday to Thursday */
  assert.equal(xnysHolidays(2021).some((d) => d.endsWith("-06-18") || d.endsWith("-06-19")), false);
  assert.deepEqual(xnysEarlyCloses(2025), ["2025-07-03", "2025-11-28", "2025-12-24"]);
  assert.deepEqual(xnysEarlyCloses(2024), ["2024-07-03", "2024-11-29", "2024-12-24"]);
});

test("the clock is Node alone: market-clock.ts imports only et.ts, spawns nothing and fetches nothing", async () => {
  const src = await readFile(fileURLToPath(new URL("../src/market-clock.ts", import.meta.url)), "utf8");
  const imports = [...src.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ["./et.ts"]);
  for (const word of ["spawn", "execFile", "fetch(", "child_process", "process.env"]) assert.equal(src.includes(word), false, word);
  assert.deepEqual(await builtinMarketClock()("2026-11-24", 10), xnysWindow("2026-11-24", 10));
});

/* ---------- a window ---------- */

test("sessionFor: a session, closed inside the window, undefined outside it", () => {
  const w = WINDOW;
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


const W24: MarketWindow = WINDOW;
const W25: MarketWindow = { ...WINDOW, from: "2026-11-25", source: "a stand-in clock (25th)", sessions: WINDOW.sessions.slice(1) };
const W26: MarketWindow = { ...WINDOW, from: "2026-11-26", source: "a stand-in clock (26th)", sessions: [...WINDOW.sessions.slice(2), FULL("2026-12-04")] };

test("createMarketCalendar asks once per ET date, falls back to a covering window, and asks a failed date again every ten minutes until a window holds it", async () => {
  assert.equal(CALENDAR_RETRY_MS, 600_000);
  const windows: Record<string, MarketWindow> = { "2026-11-24": W24, "2026-11-26": W26 };
  const fake = fakeAsk(windows);
  const cal = createMarketCalendar({ ask: fake.ask, clock: "a stand-in clock" });
  assert.equal(cal.clock, "a stand-in clock");
  assert.equal(cal.peek(), undefined);
  assert.equal(cal.window(), undefined);

  const first = await cal.today(at("2026-11-24T15:00:00Z"));
  assert.deepEqual(fake.asks, [["2026-11-24", 10]]);
  assert.deepEqual(first, { ok: true, date: "2026-11-24", session: FULL("2026-11-24"), source: "a stand-in clock" });
  assert.deepEqual(cal.peek(), first);
  assert.equal(cal.window(), W24);

  // 04:30Z on the 25th is still the 24th in New York: nothing is asked
  assert.deepEqual(await cal.today(at("2026-11-25T04:30:00Z")), first);
  assert.equal(fake.asks.length, 1);

  // 05:00Z is midnight in New York: the 25th asks, the ask fails, and the 24th's window still holds the 25th
  fake.fail = "the clock is down";
  const stale = await cal.today(at("2026-11-25T05:00:00Z"));
  assert.deepEqual(fake.asks, [["2026-11-24", 10], ["2026-11-25", 10]]);
  assert.deepEqual(stale, {
    ok: true, date: "2026-11-25", session: FULL("2026-11-25"), source: "a stand-in clock",
    stale: { error: "the clock is down" },
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
  assert.deepEqual(fresh, { ok: true, date: "2026-11-25", session: FULL("2026-11-25"), source: "a stand-in clock (25th)" });
  assert.equal(fake.asks.length, 4);
  assert.deepEqual(await cal.today(at("2026-11-25T20:59:00Z")), fresh);
  assert.equal(fake.asks.length, 4);
  assert.deepEqual(cal.peek(), fresh);
  assert.equal(cal.window(), W25);

  // the next date asks again: Thanksgiving, closed, from the fresh window
  const closed = await cal.today(at("2026-11-26T15:00:00Z"));
  assert.deepEqual(fake.asks.at(-1), ["2026-11-26", 10]);
  assert.deepEqual(closed, { ok: true, date: "2026-11-26", session: "closed", source: "a stand-in clock (26th)" });
  assert.equal(cal.window(), W26);

  // a fresh calendar whose first ask fails: { ok: false } until an ask ten minutes on answers - a transient
  // failure at the first ask after a boot costs ten minutes, not the day's anchored orders
  const failing = fakeAsk({ "2026-11-24": W24, "2026-11-25": W25 });
  failing.fail = "timed out after 30 s";
  const lone = createMarketCalendar({ ask: failing.ask, clock: "another clock", days: 7 });
  const none: DayAnswer = { ok: false, date: "2026-11-24", error: "timed out after 30 s" };
  assert.deepEqual(await lone.today(at("2026-11-24T15:00:00Z")), none);
  assert.deepEqual(await lone.today(at("2026-11-24T15:09:00Z")), none);
  assert.deepEqual(failing.asks, [["2026-11-24", 7]]);
  assert.deepEqual(lone.peek(), none);
  assert.equal(lone.window(), undefined);
  failing.fail = undefined;
  const answered = await lone.today(at("2026-11-24T15:10:00Z"));
  assert.deepEqual(answered, { ok: true, date: "2026-11-24", session: FULL("2026-11-24"), source: "a stand-in clock" });
  assert.deepEqual(failing.asks, [["2026-11-24", 7], ["2026-11-24", 7]]);
  assert.deepEqual(await lone.today(at("2026-11-24T21:30:00Z")), answered);
  assert.equal(failing.asks.length, 2, "a date its own ask answered is never asked again");
  assert.equal(lone.window(), W24);
  assert.deepEqual(await lone.today(at("2026-11-25T15:00:00Z")), { ok: true, date: "2026-11-25", session: FULL("2026-11-25"), source: "a stand-in clock (25th)" });
  assert.deepEqual(failing.asks.at(-1), ["2026-11-25", 7]);

  // a re-ask under way is shared: two calls ten minutes on make one ask
  const flaky = fakeAsk({});
  flaky.fail = "exit 1";
  const shared = createMarketCalendar({ ask: flaky.ask, clock: "a stand-in clock" });
  await shared.today(at("2026-11-24T15:00:00Z"));
  const [one, two] = await Promise.all([shared.today(at("2026-11-24T15:10:00Z")), shared.today(at("2026-11-24T15:10:01Z"))]);
  assert.deepEqual(one, two);
  assert.equal(flaky.asks.length, 2);
  assert.deepEqual(await shared.today(at("2026-11-24T15:19:59Z")), one);
  assert.equal(flaky.asks.length, 2, "ten minutes from the re-ask, not from the first");
  await shared.today(at("2026-11-24T15:20:00Z"));
  assert.equal(flaky.asks.length, 3);
});

test("createMarketCalendar: two concurrent today() calls share one ask", async () => {
  let release!: (w: MarketWindow) => void;
  const asks: string[] = [];
  const cal = createMarketCalendar({
    clock: "a stand-in clock",
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
  const throwing = createMarketCalendar({ clock: "a stand-in clock", ask: () => { throw new Error("spawn refused"); } });
  assert.deepEqual(await throwing.today(at("2026-11-24T15:00:00Z")), { ok: false, date: "2026-11-24", error: "spawn refused" });

  // a window that does not hold the date asked is refused, and the newest good window still serves
  const fake = fakeAsk({ "2026-11-24": W24, "2026-12-04": W24, "2026-12-05": W26 });
  const cal = createMarketCalendar({ ask: fake.ask, clock: "a stand-in clock" });
  await cal.today(at("2026-11-24T15:00:00Z"));
  assert.deepEqual(await cal.today(at("2026-12-04T15:00:00Z")), {
    ok: false, date: "2026-12-04", error: "the market clock answered a window from 2026-11-24 for 10 days, which does not hold 2026-12-04",
  });
  assert.equal(cal.window(), W24);
  assert.deepEqual(await cal.today(at("2026-12-05T15:00:00Z")), { ok: true, date: "2026-12-05", session: "closed", source: "a stand-in clock (26th)" });
  assert.equal(cal.window(), W26);

  // a long error is carried on one line, cut at 300 characters
  const noisy = createMarketCalendar({ clock: "a stand-in clock", ask: async () => { throw new Error(`line one\nline two ${"y".repeat(500)}`); } });
  const loud = await noisy.today(at("2026-11-24T15:00:00Z"));
  assert.equal(loud.ok, false);
  const error = (loud as { error: string }).error;
  assert.ok(error.startsWith("line one line two y") && error.endsWith("…") && [...error].length === 300, error);

  // the older date's ask settling last neither replaces the newer window nor what peek() says
  const gates: Record<string, (w: MarketWindow) => void> = {};
  const racing = createMarketCalendar({
    clock: "a stand-in clock",
    ask: (from) => new Promise<MarketWindow>((resolve) => { gates[from] = resolve; }),
  });
  const older = racing.today(at("2026-11-24T15:00:00Z"));
  const newer = racing.today(at("2026-11-26T15:00:00Z"));
  gates["2026-11-26"](W26);
  assert.equal((await newer).date, "2026-11-26");
  gates["2026-11-24"](W24);
  assert.deepEqual(await older, { ok: true, date: "2026-11-24", session: FULL("2026-11-24"), source: "a stand-in clock" });
  assert.equal(racing.window(), W26);
  assert.equal(racing.peek()?.date, "2026-11-26");
});
