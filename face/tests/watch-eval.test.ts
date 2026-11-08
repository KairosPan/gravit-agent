// face/tests/watch-eval.test.ts
/** The watch's evaluator (src/watch-eval.ts), pure: which prints are judged in each market's session (rulings 1, 2),
 * crossings and the once-a-session `gap`, the gap rule's 30 minutes from its market's open, cooldown repeats, the
 * gate (OFF, then MUTE, then the hourly cap) and the cap's batch, the `alerts.jsonl` records, and the day rebuilt
 * from them. US S: 2026-11-30 14:30Z-21:00Z; CN C: 2026-12-01 01:30Z-07:00Z (09:30-15:00 Beijing). Offline. */
import test from "node:test";
import assert from "node:assert/strict";
import type { Level, LevelKind, Rule } from "../src/desk-book.ts";
import { nyInstant, type MarketSession } from "../src/market-clock.ts";
import type { MarketQuote } from "../src/market-quotes.ts";
import {
  ALERTS_PER_HOUR, GAP_RULE_WINDOW_MS, HOUR_MS, REBUILD_WINDOW_MS, THIN_ALONE_MS, THIN_SECOND_MS, THIN_STALE_MS,
  ALERT_REPLAY_MS, alertId, batchDue, batchId, emptyDay, evaluatePass, findOrphans, gate, isAlertRecord, judgedDate, passId, pastOf, priceKeys, rebuildDay, snapOf,
  takeBatch, referenceOf, usPhaseOf, watchQuoteOf,
  type AlertHit, type PriceKey, type UsSession, type WatchDay, type WatchQuote, type WatchSessions,
} from "../src/watch-eval.ts";

const S: UsSession = { date: "2026-11-30", open: "2026-11-30T14:30:00Z", close: "2026-11-30T21:00:00Z", early: false, prev: "2026-11-27" };
const C: MarketSession = { date: "2026-12-01", open: "2026-12-01T01:30:00Z", close: "2026-12-01T07:00:00Z", early: false };
const BOTH: WatchSessions = { us: S, cn: C };
const T = (iso: string): number => Date.parse(iso);
/** The XNYS session of `date` as the watch hands it over, `prev` the session before it. */
function usSession(date: string, prev: string, early = false): UsSession {
  return { date, open: nyInstant(date, 9, 30), close: nyInstant(date, early ? 13 : 16, 0), early, prev };
}

/** A live US print on the nasdaq feed; its change from `prev` when there is one. */
function u(symbol: string, price: number | null, asOf: string, prev?: number): WatchQuote {
  return {
    market: "us", symbol, price, prevClose: prev ?? null, changePct: prev !== undefined && price !== null ? ((price - prev) / prev) * 100 : null,
    asOf, receivedAt: asOf, feed: "nasdaq", status: "live", phase: null,
  };
}
/** A live A-share print on the tencent feed, in `phase`. */
function c(symbol: string, price: number | null, asOf: string, phase: WatchQuote["phase"], prev?: number): WatchQuote {
  return { ...u(symbol, price, asOf, prev), market: "cn", feed: "tencent", phase };
}

/** A level as the book loads one: a price with `cross_up`/`cross_down`, or a range with `enter`. */
function level(symbol: string, kind: LevelKind, at: number | [number, number], when: Level["when"], extra: Partial<Level> = {}): Level {
  return {
    file: "desk/levels.yml", index: 0, symbol, market: /^\d{6}$/.test(symbol) ? "cn" : "us", kind,
    ...(typeof at === "number" ? { price: at } : { range: at }), when, plan: `plan for ${symbol}`, expires: "2026-12-31", annotate: true, cooldownMs: 1_800_000,
    ...extra,
  };
}
function moveRule(id: string, symbols: string[], movePct: number, cooldownMs = 1_800_000, sessions: "all" | "regular" = "all"): Rule {
  return { file: "desk/rules.yml", index: 0, id, symbols: { holdings: false, levels: false, symbols }, annotate: false, urgent: false, kind: "move_pct", movePct, sessions, cooldownMs };
}
function gapRule(id: string, symbols: string[], gapPct: number): Rule {
  return { file: "desk/rules.yml", index: 1, id, symbols: { holdings: false, levels: false, symbols }, annotate: false, urgent: false, kind: "gap", gapPct };
}
const keysOf = (book: { levels?: Level[]; rules?: Rule[] }): PriceKey[] => priceKeys({ levels: book.levels ?? [], rules: book.rules ?? [], holdings: [] });

test("watchQuoteOf reads a Market quote: its feed and status, and an A share's phase", () => {
  const base: MarketQuote = {
    id: "cn:600519", market: "cn", symbol: "600519", price: 1401, prev_close: 1390, change: 11, change_pct: 0.79, volume: 10, as_of: "2026-12-01T02:00:00Z",
    received_at: "2026-12-01T02:00:01Z", volume_as_of: null, source: "market", feed: "tencent", basis: "previous_close", quote_status: "live",
    market_status: "open", message: "", cn: { phase: "trading", lastSession: "2026-11-30" },
  };
  assert.deepEqual(watchQuoteOf(base), {
    market: "cn", symbol: "600519", price: 1401, prevClose: 1390, changePct: 0.79, asOf: "2026-12-01T02:00:00Z", receivedAt: "2026-12-01T02:00:01Z",
    feed: "tencent", status: "live", phase: "trading",
  });
  const { cn: _cn, ...us } = { ...base, id: "us:NVDA", market: "us" as const, symbol: "NVDA", feed: "nasdaq", quote_status: "delayed" as const };
  assert.equal(watchQuoteOf(us).phase, null, "a US quote has no phase");
  assert.equal(watchQuoteOf(us).status, "delayed");
});

test("priceKeys: one key per level and per resolved rule symbol, with the market, the old key strings and the first of a repeat", () => {
  const keys = priceKeys({
    levels: [level("NVDA", "stop", 170, "cross_down"), level("NVDA", "buy_zone", [218, 222], "enter", { source: "desk note" }), level("NVDA", "stop", 170, "cross_down", { plan: "second" })],
    rules: [moveRule("big-move", ["600519"], 4), { ...gapRule("opening-gap", [], 2), symbols: { holdings: true, levels: true, symbols: [] } }],
    holdings: [{ symbol: "AAPL", market: "us", qty: 10, avgCost: 200 }],
  });
  assert.deepEqual(keys.map((k) => [k.key, k.market, k.label, k.cooldownMs]), [
    ["level:desk/levels.yml:NVDA:stop:170:cross_down", "us", "stop", 1_800_000],
    ["level:desk/levels.yml:NVDA:buy_zone:218-222:enter", "us", "buy_zone", 1_800_000],
    ["rule:big-move:600519", "cn", "big-move", 1_800_000],
    ["rule:opening-gap:AAPL", "us", "opening-gap", 0],
    ["rule:opening-gap:NVDA", "us", "opening-gap", 0],
  ]);
  assert.equal(keys[0].plan, "plan for NVDA", "a repeated key keeps its first");
  assert.deepEqual(keys[1].trigger, { type: "level", kind: "buy_zone", range: [218, 222], when: "enter", levelSource: "desk note" });
  assert.deepEqual(keys[2].trigger, { type: "move", rule: "big-move", pct: 4 });
  assert.equal(keys[2].plan, null, "a rule with no plan has none");
});

test("pastOf: the three level readings, the change rules, and no reading without a price or a previous close", () => {
  const [down, up, enter] = keysOf({ levels: [level("NVDA", "stop", 170, "cross_down"), level("NVDA", "target", 210, "cross_up"), level("NVDA", "buy_zone", [218, 222], "enter")] });
  const [move] = keysOf({ rules: [moveRule("m", ["NVDA"], 4)] });
  assert.equal(pastOf(down, u("NVDA", 170, S.open)), true, "170 exactly is past a 170 stop");
  assert.equal(pastOf(down, u("NVDA", 170.01, S.open)), false);
  assert.equal(pastOf(up, u("NVDA", 210, S.open)), true);
  assert.equal(pastOf(enter, u("NVDA", 222, S.open)), true, "the range's edges are inside");
  assert.equal(pastOf(enter, u("NVDA", 222.5, S.open)), false);
  assert.equal(pastOf(down, u("NVDA", null, S.open)), undefined);
  assert.equal(pastOf({ ...enter, trigger: { type: "level", kind: "buy_zone", when: "enter" } }, u("NVDA", 220, S.open)), undefined, "an enter level with no range");
  assert.equal(pastOf(move, u("NVDA", 160, S.open, 170)), true);
  assert.equal(pastOf(move, u("NVDA", 168, S.open, 170)), false);
  assert.equal(pastOf(move, u("NVDA", 160, S.open)), undefined, "no previous close, no reading");
  assert.equal(pastOf(move, { ...u("NVDA", 160, S.open, 170), changePct: null }), true, "a missing change is read from the previous close");
});

test("a crossing between two judged prints fires, and only a crossing", () => {
  const [stop, up, enter] = keysOf({ levels: [level("NVDA", "stop", 170, "cross_down"), level("TSLA", "target", 210, "cross_up"), level("AAPL", "buy_zone", [218, 222], "enter")] });
  const day = emptyDay();
  assert.deepEqual(evaluatePass(day, [stop], [u("NVDA", 171, "2026-11-30T15:00:00Z")], BOTH, T("2026-11-30T15:00:00Z")), []);
  const hits = evaluatePass(day, [stop], [u("NVDA", 169.9, "2026-11-30T15:01:00Z")], BOTH, T("2026-11-30T15:01:00Z"));
  assert.equal(hits.length, 1);
  assert.equal(hits[0].gap, false);
  assert.equal(hits[0].date, "2026-11-30");
  assert.equal(hits[0].key, stop);
  assert.deepEqual(evaluatePass(day, [stop], [u("NVDA", 169, "2026-11-30T15:02:00Z")], BOTH, T("2026-11-30T15:02:00Z")), [], "still past: no crossing");

  assert.deepEqual(evaluatePass(day, [up], [u("TSLA", 209, "2026-11-30T15:00:00Z")], BOTH, T("2026-11-30T15:00:00Z")), []);
  assert.equal(evaluatePass(day, [up], [u("TSLA", 210.5, "2026-11-30T15:01:00Z")], BOTH, T("2026-11-30T15:01:00Z"))[0].gap, false);

  assert.deepEqual(evaluatePass(day, [enter], [u("AAPL", 225, "2026-11-30T15:00:00Z")], BOTH, T("2026-11-30T15:00:00Z")), []);
  assert.equal(evaluatePass(day, [enter], [u("AAPL", 221, "2026-11-30T15:01:00Z")], BOTH, T("2026-11-30T15:01:00Z")).length, 1);

  const again = emptyDay();
  const [stop2, enter2] = keysOf({ levels: [level("NVDA", "stop", 170, "cross_down"), level("AAPL", "buy_zone", [218, 222], "enter")] });
  evaluatePass(again, [stop2, enter2], [u("NVDA", 171, "2026-11-30T15:00:00Z"), u("AAPL", 225, "2026-11-30T15:00:00Z")], BOTH, T("2026-11-30T15:00:00Z"));
  const both = evaluatePass(again, [stop2, enter2], [u("NVDA", 170, "2026-11-30T15:01:00Z"), u("AAPL", 222, "2026-11-30T15:01:00Z")], BOTH, T("2026-11-30T15:01:00Z"));
  assert.deepEqual(both.map((h) => [h.key.symbol, h.gap]), [["NVDA", false], ["AAPL", false]], "170 exactly crosses down; 222 is inside; hits in key order");
});

test("past at the first judged observation fires once as gap - a level, a move rule - and a gap rule only within 30 minutes of its open", () => {
  const [stop] = keysOf({ levels: [level("NVDA", "stop", 170, "cross_down")] });
  const day = emptyDay();
  const first = evaluatePass(day, [stop], [u("NVDA", 168.5, "2026-11-30T14:30:01Z")], BOTH, T("2026-11-30T14:30:02Z"));
  assert.deepEqual(first.map((h) => h.gap), [true]);
  assert.deepEqual(evaluatePass(day, [stop], [u("NVDA", 168, "2026-11-30T14:31:00Z")], BOTH, T("2026-11-30T14:31:00Z")), []);

  const [move] = keysOf({ rules: [moveRule("m", ["AMD"], 4)] });
  assert.deepEqual(evaluatePass(day, [move], [u("AMD", 95, "2026-11-30T14:40:00Z")], BOTH, T("2026-11-30T14:40:00Z")), [], "no previous close: not judged");
  assert.equal(day.keys.get(move.key)?.side, undefined, "and its side stays unknown");
  assert.deepEqual(evaluatePass(day, [move], [u("AMD", 95, "2026-11-30T14:41:00Z", 100)], BOTH, T("2026-11-30T14:41:00Z")).map((h) => h.gap), [true], "-5% against 4");

  const [gap, late] = keysOf({ rules: [gapRule("g", ["META"], 2), gapRule("h", ["ORCL"], 2)] });
  assert.deepEqual(evaluatePass(day, [gap], [u("META", 97, "2026-11-30T14:45:00Z", 100)], BOTH, T("2026-11-30T14:45:00Z")).map((h) => h.gap), [true]);
  assert.deepEqual(evaluatePass(day, [late], [u("ORCL", 97, "2026-11-30T15:01:00Z", 100)], BOTH, T("2026-11-30T15:01:00Z")), [], "first seen after 30 minutes");
  assert.deepEqual(evaluatePass(day, [late], [u("ORCL", 103, "2026-11-30T15:02:00Z", 100)], BOTH, T("2026-11-30T15:02:00Z")), [], "and nothing that day");
  assert.equal(GAP_RULE_WINDOW_MS, 1_800_000);

  /* the A shares, from their own open */
  const [cnStop] = keysOf({ levels: [level("600519", "stop", 1400, "cross_down")] });
  assert.deepEqual(evaluatePass(day, [cnStop], [c("600519", 1390, "2026-12-01T01:31:00Z", "trading")], BOTH, T("2026-12-01T01:31:00Z")).map((h) => [h.gap, h.date]), [[true, "2026-12-01"]]);
  const [cnGap, cnLate] = keysOf({ rules: [gapRule("cg", ["000001"], 2), gapRule("cl", ["601318"], 2)] });
  assert.equal(evaluatePass(day, [cnGap], [c("000001", 9.7, "2026-12-01T01:35:00Z", "trading", 10)], BOTH, T("2026-12-01T01:35:00Z")).length, 1, "09:35 Beijing");
  assert.deepEqual(evaluatePass(day, [cnLate], [c("601318", 48, "2026-12-01T02:01:00Z", "trading", 50)], BOTH, T("2026-12-01T02:01:00Z")), [], "10:01 Beijing");
});

test("a US print is judged on as_of inside its own session's three phases, not on the clock", () => {
  const at = (asOf: string, sessions: WatchSessions = BOTH) => judgedDate(u("NVDA", 100, asOf), sessions);
  const phase = (asOf: string, s: UsSession = S) => usPhaseOf(T(asOf), s);
  assert.equal(at("2026-11-30T08:59:59Z"), undefined, "before 04:00 ET");
  assert.equal(phase("2026-11-30T09:00:00Z"), "pre", "04:00 ET");
  assert.equal(phase("2026-11-30T14:29:59Z"), "pre", "a print before the open, read after it");
  assert.equal(at("2026-11-30T14:29:59Z"), "2026-11-30");
  assert.equal(phase("2026-11-30T14:30:00Z"), "regular");
  assert.equal(phase("2026-11-30T20:59:59Z"), "regular");
  assert.equal(phase("2026-11-30T21:00:00Z"), "after", "the close starts after-hours");
  assert.equal(phase("2026-12-01T00:59:59Z"), "after", "19:59:59 ET");
  assert.equal(at("2026-12-01T00:59:59Z"), "2026-11-30", "judged on its session's date");
  assert.equal(phase("2026-12-01T01:00:00Z"), undefined, "20:00 ET is outside");
  assert.equal(at("2026-11-30T15:00:00Z", { cn: C }), undefined, "no US session, no judgement");
  assert.equal(at("2026-12-01T15:00:00Z"), undefined, "another ET date");
  const nov2 = usSession("2026-11-02", "2026-10-30");
  assert.equal(nov2.open, "2026-11-02T14:30:00Z");
  assert.equal(phase("2026-11-02T13:45:00Z", nov2), "pre", "09:45 had DST held; 08:45 EST");
  assert.equal(phase("2026-11-02T08:59:00Z", nov2), undefined, "03:59 EST");
  assert.equal(phase("2026-11-02T14:30:00Z", nov2), "regular");
  const nov27 = usSession("2026-11-27", "2026-11-25", true);
  assert.equal(phase("2026-11-27T17:59:00Z", nov27), "regular");
  assert.equal(phase("2026-11-27T18:05:00Z", nov27), "after", "after the early close");

  const [stop] = keysOf({ levels: [level("NVDA", "stop", 170, "cross_down")] });
  const day = emptyDay();
  assert.deepEqual(evaluatePass(day, [stop], [u("NVDA", 168, "2026-11-30T14:29:59Z")], BOTH, T("2026-11-30T14:30:05Z")), [], "the clock is in the session, the print is not");
  assert.equal(day.keys.has(stop.key), false, "and it is no observation for a level");
});

test("an A-share print is judged only inside 09:30-11:30 and 13:00-15:00 Beijing with the phase trading", () => {
  const at = (asOf: string, phase: WatchQuote["phase"], sessions: WatchSessions = BOTH) => judgedDate(c("600519", 1400, asOf, phase), sessions);
  assert.equal(at("2026-12-01T01:20:00Z", "trading"), undefined, "09:20, the auction");
  assert.equal(at("2026-12-01T01:30:00Z", "trading"), "2026-12-01");
  assert.equal(at("2026-12-01T03:29:59Z", "trading"), "2026-12-01");
  assert.equal(at("2026-12-01T03:30:00Z", "trading"), undefined, "11:30");
  assert.equal(at("2026-12-01T03:45:00Z", "midday"), undefined);
  assert.equal(at("2026-12-01T03:45:00Z", "trading"), undefined, "the break, whatever the phase says");
  assert.equal(at("2026-12-01T05:00:00Z", "trading"), "2026-12-01", "13:00");
  assert.equal(at("2026-12-01T06:59:59Z", "trading"), "2026-12-01");
  assert.equal(at("2026-12-01T02:00:00Z", "closed"), undefined, "a closed phase in the morning");
  assert.equal(at("2026-12-01T02:00:00Z", null), undefined, "no phase");
  assert.equal(at("2026-11-30T02:00:00Z", "trading"), undefined, "an as_of on 2026-11-30 Beijing while C is 2026-12-01");
  assert.equal(at("2026-12-01T02:00:00Z", "trading", { us: S }), undefined, "no A-share session");

  /* past the table the phase makes the day a session, and the bands and the close print still judge its prints */
  const uncovered: WatchSessions = { cn: { date: "2027-01-04", open: "2027-01-04T01:30:00Z", close: "2027-01-04T07:00:00Z", early: false, uncovered: true } };
  assert.equal(at("2027-01-04T01:20:00Z", "trading", uncovered), undefined, "09:20, the auction, though the Market says trading");
  assert.equal(at("2027-01-04T01:22:00Z", "trading", uncovered), undefined, "09:22, still the auction");
  assert.equal(at("2027-01-04T01:30:00Z", "trading", uncovered), "2027-01-04");
  assert.equal(at("2027-01-04T03:45:00Z", "midday", uncovered), undefined);
  assert.equal(at("2027-01-04T03:45:00Z", "trading", uncovered), undefined, "the break");
  assert.equal(at("2027-01-04T07:00:02Z", "closed", uncovered), "2027-01-04", "a 15:00:02 close print");
  assert.equal(at("2027-01-04T07:00:31Z", "closed", uncovered), undefined);
  assert.equal(at("2027-01-03T23:00:00Z", "trading", uncovered), undefined, "07:00 Beijing on the 4th is before the open");
  assert.equal(at("2027-01-03T02:00:00Z", "trading", uncovered), undefined, "10:00 Beijing on the 3rd is another date");
});

test("an A-share print stamped 15:00:01 Beijing with phase closed is judged once; at 15:00:31 it is not", () => {
  const [stop] = keysOf({ levels: [level("600519", "stop", 1400, "cross_down")] });
  const day = emptyDay();
  assert.deepEqual(evaluatePass(day, [stop], [c("600519", 1401, "2026-12-01T06:59:50Z", "trading")], BOTH, T("2026-12-01T06:59:51Z")), []);
  const close = c("600519", 1398.5, "2026-12-01T07:00:01Z", "closed");
  assert.equal(judgedDate(close, BOTH), "2026-12-01");
  assert.deepEqual(evaluatePass(day, [stop], [close], BOTH, T("2026-12-01T07:00:05Z")).map((h) => h.gap), [false], "the crossing hits");
  assert.equal(day.keys.get(stop.key)?.lastAsOf, "2026-12-01T07:00:01Z");
  /* the same as_of on the next poll is not judged again, whatever it carries */
  assert.deepEqual(evaluatePass(day, [stop], [{ ...close, price: 1401 }], BOTH, T("2026-12-01T07:00:15Z")), []);
  assert.equal(day.keys.get(stop.key)?.side, true, "not re-read");
  assert.equal(judgedDate(c("600519", 1398.5, "2026-12-01T07:00:30Z", "closed"), BOTH), "2026-12-01", "15:00:30 is the window's last second");
  assert.equal(judgedDate(c("600519", 1398.5, "2026-12-01T07:00:31Z", "closed"), BOTH), undefined);
  assert.equal(judgedDate(c("600519", 1398.5, "2026-12-01T07:00:00Z", "trading"), BOTH), "2026-12-01", "15:00:00 itself, any phase");
});

test("a gap rule whose first judged prints have no previous close fires on the first with one inside 30 minutes, and not after", () => {
  const [gap] = keysOf({ rules: [gapRule("g", ["NVDA"], 2)] });
  const day = emptyDay();
  assert.deepEqual(evaluatePass(day, [gap], [u("NVDA", 169.82, "2026-11-30T14:30:05Z")], BOTH, T("2026-11-30T14:30:05Z")), []);
  assert.deepEqual(evaluatePass(day, [gap], [u("NVDA", 169.82, "2026-11-30T14:40:00Z")], BOTH, T("2026-11-30T14:40:00Z")), []);
  const hit = evaluatePass(day, [gap], [u("NVDA", 169.82, "2026-11-30T14:45:00Z", 174.05)], BOTH, T("2026-11-30T14:45:00Z"));
  assert.deepEqual(hit.map((h) => h.gap), [true]);

  const [later] = keysOf({ rules: [gapRule("g", ["NVDA"], 2)] });
  const other = emptyDay();
  evaluatePass(other, [later], [u("NVDA", 169.82, "2026-11-30T14:31:00Z")], BOTH, T("2026-11-30T14:31:00Z"));
  assert.deepEqual(evaluatePass(other, [later], [u("NVDA", 169.82, "2026-11-30T15:01:00Z", 174.05)], BOTH, T("2026-11-30T15:01:00Z")), []);
  assert.equal(other.keys.get(later.key)?.side, true, "its side is set, so it never fires that session");
  assert.deepEqual(evaluatePass(other, [later], [u("NVDA", 169.82, "2026-11-30T15:02:00Z", 174.05)], BOTH, T("2026-11-30T15:02:00Z")), []);
});

test("a stale or unavailable print is never judged, in either market", () => {
  const [stop, cnStop] = keysOf({ levels: [level("NVDA", "stop", 170, "cross_down"), level("600519", "stop", 1400, "cross_down")] });
  const day = emptyDay();
  const stale = { ...u("NVDA", 168, "2026-11-30T14:31:00Z"), status: "stale" as const };
  const gone = { ...c("600519", 1390, "2026-12-01T01:31:00Z", "trading"), status: "unavailable" as const };
  assert.equal(judgedDate(stale, BOTH), undefined);
  assert.equal(judgedDate(gone, BOTH), undefined);
  assert.equal(judgedDate({ ...u("NVDA", 168, "2026-11-30T14:31:00Z"), status: "delayed" }, BOTH), "2026-11-30", "a delayed print is judged");
  assert.deepEqual(evaluatePass(day, [stop, cnStop], [stale, gone], BOTH, T("2026-12-01T01:31:00Z")), []);
  assert.equal(day.keys.size, 0, "no observation");
  assert.deepEqual(evaluatePass(day, [stop], [u("NVDA", 168, "2026-11-30T14:32:00Z")], BOTH, T("2026-11-30T14:32:00Z")).map((h) => h.gap), [true], "the next live print is the first observation");
});

test("a key's day is its session's: a US gap and an A-share gap on one evening are both first observations", () => {
  const [stop, cnStop] = keysOf({ levels: [level("NVDA", "stop", 170, "cross_down"), level("600519", "stop", 1400, "cross_down")] });
  const day = emptyDay();
  assert.equal(evaluatePass(day, [stop, cnStop], [u("NVDA", 168, "2026-11-30T20:00:00Z")], BOTH, T("2026-11-30T20:00:00Z"))[0].date, "2026-11-30");
  /* 20:31 New York on the 30th is 09:31 Beijing on the 1st */
  const cn = evaluatePass(day, [stop, cnStop], [u("NVDA", 168, "2026-11-30T20:59:00Z"), c("600519", 1390, "2026-12-01T01:31:00Z", "trading")], BOTH, T("2026-12-01T01:31:00Z"));
  assert.deepEqual(cn.map((h) => [h.key.symbol, h.gap, h.date]), [["600519", true, "2026-12-01"]]);
  assert.equal(day.keys.get(stop.key)?.ref, "2026-11-27", "a regular US print measures from the previous close");
  assert.equal(day.keys.get(cnStop.key)?.ref, "2026-12-01", "an A share keeps its Beijing session date");
  /* the next US session starts the US key afresh */
  const dec1 = usSession("2026-12-01", "2026-11-30");
  const next = evaluatePass(day, [stop, cnStop], [u("NVDA", 168, "2026-12-01T14:31:00Z")], { us: dec1, cn: C }, T("2026-12-01T14:31:00Z"));
  assert.deepEqual(next.map((h) => [h.key.symbol, h.gap, h.date]), [["NVDA", true, "2026-12-01"]]);
});

test("a repeat inside the cooldown is counted, not a hit; after it a crossing hits again", () => {
  const [stop] = keysOf({ levels: [level("NVDA", "stop", 170, "cross_down")] });
  const day = emptyDay();
  const pass = (price: number, iso: string) => evaluatePass(day, [stop], [u("NVDA", price, iso)], BOTH, T(iso)).length;
  assert.equal(pass(171, "2026-11-30T15:00:00Z"), 0);
  assert.equal(pass(169, "2026-11-30T15:01:00Z"), 1);
  assert.equal(day.keys.get(stop.key)?.lastHitAt, T("2026-11-30T15:01:00Z"));
  assert.equal(pass(171, "2026-11-30T15:05:00Z"), 0);
  assert.equal(pass(169, "2026-11-30T15:10:00Z"), 0, "inside 30 minutes");
  assert.equal(day.keys.get(stop.key)?.repeats, 1);
  assert.equal(day.keys.get(stop.key)?.lastHitAt, T("2026-11-30T15:01:00Z"), "a repeat moves no cooldown");
  assert.equal(pass(171, "2026-11-30T15:35:00Z"), 0);
  assert.equal(pass(169, "2026-11-30T15:40:00Z"), 1, "after it");
});

test("gate: OFF before MUTE before the cap, and the seventh send in a rolling hour is held for the batch", () => {
  const day = emptyDay();
  assert.deepEqual(gate(day, T("2026-11-30T15:00:00Z"), { off: true, muted: true }, "a-0"), { send: false, suppressed: "off" });
  assert.deepEqual(gate(day, T("2026-11-30T15:00:00Z"), { off: false, muted: true }, "a-0"), { send: false, suppressed: "muted" });
  assert.deepEqual(day.sends, [], "neither counts as a send");
  for (let i = 0; i < ALERTS_PER_HOUR; i++) assert.deepEqual(gate(day, T("2026-11-30T15:00:00Z") + i * 60_000, { off: false, muted: false }, `a-${i}`), { send: true });
  assert.deepEqual(gate(day, T("2026-11-30T15:20:00Z"), { off: false, muted: false }, "a-held"), { send: false, suppressed: "cap" });
  assert.deepEqual(day.pending, [{ id: "a-held", t: T("2026-11-30T15:20:00Z") }]);
  assert.equal(batchDue(day, T("2026-11-30T15:59:59Z")), false);
  assert.equal(batchDue(day, T("2026-11-30T16:00:05Z")), true, "a later ET hour");
  assert.deepEqual(takeBatch(day), ["a-held"]);
  assert.deepEqual(day.pending, []);
  assert.equal(batchDue(day, T("2026-11-30T17:00:00Z")), false, "nothing held, nothing due");
  assert.deepEqual(gate(day, T("2026-11-30T16:00:00Z"), { off: false, muted: false }, "a-later"), { send: true }, "the first send is an hour old");
  assert.equal(HOUR_MS, 3_600_000);
});

test("a burst of twelve gap hits sends six and holds six", () => {
  const symbols = ["AAPL", "AMD", "AMZN", "AVGO", "GOOG", "META", "MSFT", "NFLX", "NVDA", "ORCL", "PLTR", "TSLA"];
  const keys = keysOf({ levels: symbols.map((s) => level(s, "stop", 100, "cross_down")) });
  const day = emptyDay();
  const now = T("2026-11-30T14:30:05Z");
  const hits = evaluatePass(day, keys, symbols.map((s) => u(s, 90, "2026-11-30T14:30:01Z")), BOTH, now);
  assert.equal(hits.length, 12);
  assert.ok(hits.every((h) => h.gap));
  const gates = hits.map((_, i) => gate(day, now, { off: false, muted: false }, `a-${i}`));
  assert.equal(gates.filter((g) => g.send).length, 6);
  assert.equal(day.pending.length, 6);
  assert.deepEqual(takeBatch(day), ["a-6", "a-7", "a-8", "a-9", "a-10", "a-11"]);
});

/** An `alert` record as the watch appends one. */
function alertRecord(over: Partial<AlertHit>): AlertHit {
  return {
    t: "2026-11-30T14:30:02.000Z", kind: "alert", id: "a-000000000001", pass: "p-000000000001", date: "2026-11-30", key: "level:desk/levels.yml:NVDA:stop:170:cross_down",
    market: "us", symbol: "NVDA", label: "stop", trigger: { type: "level", kind: "stop", price: 170, when: "cross_down" }, gap: true,
    quote: { market: "us", price: 168, asOf: "2026-11-30T14:30:01Z", feed: "nasdaq", status: "live", prevClose: null, chgPct: null, receivedAt: "2026-11-30T14:30:01Z" },
    holding: null, plan: "sell half", source: { file: "desk/levels.yml", index: 0 }, decision: "send", annotate: false,
    ...over,
  };
}

test("rebuildDay restores the day across both markets' session dates", () => {
  const nvda = "level:desk/levels.yml:NVDA:stop:170:cross_down";
  const cnKey = "level:desk/levels.yml:600519:stop:1400:cross_down";
  const records: unknown[] = [
    alertRecord({ t: "2026-11-30T14:30:02.000Z", key: nvda, id: "a-nvda", ref: "2026-11-27", phase: "regular" }),
    alertRecord({ t: "2026-12-01T01:00:00.000Z", key: "rule:m:AAPL", symbol: "AAPL", id: "a-aapl", decision: "suppressed", suppressed: "cap" }),
    alertRecord({ t: "2026-11-30T14:41:00.000Z", key: "rule:m:IBM", symbol: "IBM", id: "a-stale-cap", decision: "suppressed", suppressed: "cap" }),
    alertRecord({ t: "2026-11-30T14:20:00.000Z", key: "rule:m:AMD", symbol: "AMD", id: "a-old-cap", decision: "suppressed", suppressed: "cap" }),
    { t: "2026-11-30T15:00:00.000Z", kind: "batch", id: "b-1", date: "2026-11-30", alerts: ["a-old-cap"] },
    alertRecord({ t: "2026-11-30T14:50:00.000Z", key: nvda, id: "a-nvda-repeat", ref: "2026-11-27", phase: "regular", decision: "suppressed", suppressed: "cooldown" }),
    alertRecord({ t: "2026-12-01T01:30:05.000Z", key: cnKey, id: "a-cn", market: "cn", symbol: "600519", date: "2026-12-01" }),
    alertRecord({ t: "2026-11-25T20:00:00.000Z", key: "rule:m:MSFT", symbol: "MSFT", id: "a-ancient", date: "2026-11-25" }),
    /* its t is bent to 2026-11-29 so the 11-27 record and the 11-30 one are both read and the newer date must win */
    alertRecord({ t: "2026-11-29T23:00:00.000Z", key: "rule:g:TSLA", symbol: "TSLA", id: "a-tsla-27", date: "2026-11-27", decision: "suppressed", suppressed: "muted" }),
    alertRecord({ t: "2026-11-30T14:35:00.000Z", key: "rule:g:TSLA", symbol: "TSLA", id: "a-tsla-30", date: "2026-11-30", decision: "suppressed", suppressed: "muted" }),
    "a torn line", { kind: "alert" }, null,
  ];
  const now = T("2026-12-01T01:35:00Z");
  const day = rebuildDay(records, now);
  assert.deepEqual(day.keys.get(nvda), { ref: "2026-11-27", alerted: true, repeats: 0, lastHitAt: T("2026-11-30T14:30:02Z") }, "the cooldown repeat is no hit");
  assert.equal(day.keys.get(cnKey)?.ref, "2026-12-01");
  assert.equal(day.keys.get(cnKey)?.alerted, true);
  assert.equal(day.keys.has("rule:m:MSFT"), false, "a record older than five days is ignored");
  assert.equal(day.keys.get("rule:g:TSLA")?.ref, "2026-11-30", "a key's newest date");
  assert.deepEqual(day.sends, [T("2026-12-01T01:30:05Z")], "the sends within the hour");
  assert.deepEqual(day.pending, [{ id: "a-aapl", t: T("2026-12-01T01:00:00Z") }], "the caps no batch lists, held within the hour; a-stale-cap is not restored");
  assert.equal(day.keys.get("rule:m:IBM")?.ref, "2026-11-30", "though its key keeps its crossing");

  /* NVDA still past against its reference close: no second gap; the A share likewise */
  const keys = keysOf({ levels: [level("NVDA", "stop", 170, "cross_down"), level("600519", "stop", 1400, "cross_down")] });
  assert.deepEqual(evaluatePass(day, keys, [u("NVDA", 168, "2026-11-30T20:00:00Z"), c("600519", 1390, "2026-12-01T01:34:00Z", "trading")], BOTH, now), []);
  assert.equal(day.keys.get(nvda)?.side, true, "the side is read afresh");
  assert.deepEqual(rebuildDay([], now), emptyDay());

  /* a rebuilt cooldown swallows a crossing after the restart */
  const restarted = rebuildDay([alertRecord({ t: "2026-11-30T15:00:00.000Z", key: nvda, id: "a-before", gap: false, ref: "2026-11-27" })], T("2026-11-30T15:05:00Z"));
  const [stop] = keys;
  assert.deepEqual(evaluatePass(restarted, [stop], [u("NVDA", 171, "2026-11-30T15:06:00Z")], BOTH, T("2026-11-30T15:06:00Z")), []);
  assert.deepEqual(evaluatePass(restarted, [stop], [u("NVDA", 169, "2026-11-30T15:10:00Z")], BOTH, T("2026-11-30T15:10:00Z")), [], "inside 30 minutes of the last hit");
  assert.equal(restarted.keys.get(nvda)?.repeats, 1);
  assert.equal(evaluatePass(restarted, [stop], [u("NVDA", 171, "2026-11-30T15:35:00Z")], BOTH, T("2026-11-30T15:35:00Z")).length, 0);
  assert.equal(evaluatePass(restarted, [stop], [u("NVDA", 169, "2026-11-30T15:40:00Z")], BOTH, T("2026-11-30T15:40:00Z")).length, 1, "and after it a crossing hits");
});

/* ---------- pre-market and after-hours: the reference close, thin prints, the long weekend ---------- */

/** One pass of `keys` over one US print at its own as_of, or at `now`. */
const passAt = (day: WatchDay, keys: PriceKey[], q: WatchQuote, sessions: WatchSessions, now = T(q.asOf as string)) => evaluatePass(day, keys, [q], sessions, now);
/** The hits as [symbol, gap, ref, phase]. */
const shape = (hits: { key: PriceKey; gap: boolean; ref: string; phase?: string }[]) => hits.map((h) => [h.key.label, h.gap, h.ref, h.phase]);

test("a US move key judges pre-market, regular and after-hours prints; a sessions: regular key, a level and a gap key judge only the regular session", () => {
  assert.equal(THIN_SECOND_MS, 20_000);
  assert.equal(THIN_ALONE_MS, 120_000);
  const keys = keysOf({
    levels: [level("NVDA", "stop", 170, "cross_down")],
    rules: [moveRule("all", ["NVDA"], 4), moveRule("reg", ["NVDA"], 4, 1_800_000, "regular"), gapRule("gap", ["NVDA"], 2)],
  });
  assert.deepEqual(keys.map((k) => [k.label, k.sessions]), [["stop", "regular"], ["all", "all"], ["reg", "regular"], ["gap", "regular"]]);
  /* pre-market: only the all-sessions key observes, and fires on the second print */
  const pre = emptyDay();
  assert.deepEqual(passAt(pre, keys, u("NVDA", 160, "2026-11-30T13:00:00Z", 180), BOTH), []);
  assert.deepEqual([...pre.keys.keys()], ["rule:all:NVDA"]);
  assert.deepEqual(shape(passAt(pre, keys, u("NVDA", 159, "2026-11-30T13:00:30Z", 180), BOTH)), [["all", true, "2026-11-27", "pre"]]);
  /* the regular session: all four */
  const reg = emptyDay();
  assert.deepEqual(shape(passAt(reg, keys, u("NVDA", 160, "2026-11-30T14:45:00Z", 180), BOTH)), [
    ["stop", true, "2026-11-27", "regular"], ["all", true, "2026-11-27", "regular"], ["reg", true, "2026-11-27", "regular"], ["gap", true, "2026-11-27", "regular"],
  ]);
  /* after-hours: the all-sessions key alone */
  const after = emptyDay();
  assert.deepEqual(passAt(after, keys, u("NVDA", 150, "2026-11-30T21:30:00Z", 160), BOTH), []);
  assert.deepEqual([...after.keys.keys()], ["rule:all:NVDA"]);
  assert.deepEqual(shape(passAt(after, keys, u("NVDA", 150, "2026-11-30T21:31:00Z", 160), BOTH)), [["all", true, "2026-11-30", "after"]]);
  /* outside 04:00-20:00 ET nothing */
  const out = emptyDay();
  assert.deepEqual(passAt(out, keys, u("NVDA", 150, "2026-12-01T01:00:00Z", 160), BOTH), []);
  assert.equal(out.keys.size, 0);
});

test("after-hours measures from that day's close and starts a new crossing: a 6% fall in the session and another after the close alert twice, each with its ref", () => {
  assert.equal(referenceOf("pre", S), "2026-11-27");
  assert.equal(referenceOf("regular", S), "2026-11-27");
  assert.equal(referenceOf("after", S), "2026-11-30");
  const [move] = keysOf({ rules: [moveRule("m", ["INTC"], 5)] });
  const day = emptyDay();
  assert.deepEqual(passAt(day, [move], u("INTC", 99, "2026-11-30T14:31:00Z", 100), BOTH), []);
  const first = passAt(day, [move], u("INTC", 94, "2026-11-30T15:00:00Z", 100), BOTH);
  assert.deepEqual(shape(first), [["m", false, "2026-11-27", "regular"]]);
  assert.equal(first[0].date, "2026-11-30");
  /* the close is 94; after-hours reads its change from it */
  assert.deepEqual(passAt(day, [move], u("INTC", 88, "2026-11-30T21:30:00Z", 94), BOTH), []);
  const second = passAt(day, [move], u("INTC", 87.5, "2026-11-30T21:30:40Z", 94), BOTH);
  assert.deepEqual(shape(second), [["m", true, "2026-11-30", "after"]], "a new reference, a new crossing, inside the old cooldown too");
  assert.equal(second[0].date, "2026-11-30");
  assert.equal(day.keys.get(move.key)?.ref, "2026-11-30");
});

test("one event alerts once across after-hours, the next pre-market and the next session", () => {
  const [move] = keysOf({ rules: [moveRule("m", ["INTC"], 5, 0)] });
  const day = emptyDay();
  passAt(day, [move], u("INTC", 88, "2026-11-30T21:30:00Z", 94), BOTH);
  assert.equal(passAt(day, [move], u("INTC", 88, "2026-11-30T21:30:30Z", 94), BOTH).length, 1);
  const dec1: WatchSessions = { us: usSession("2026-12-01", "2026-11-30") };
  assert.deepEqual(passAt(day, [move], u("INTC", 86, "2026-12-01T09:00:00Z", 94), dec1), [], "04:00 ET, still past the 11-30 close");
  assert.deepEqual(passAt(day, [move], u("INTC", 86, "2026-12-01T09:00:30Z", 94), dec1), []);
  assert.deepEqual(passAt(day, [move], u("INTC", 85, "2026-12-01T14:31:00Z", 94), dec1), [], "09:31 ET, still past");
  /* and after a restart, from the ledger */
  const ledger = [alertRecord({ t: "2026-11-30T21:30:31.000Z", key: move.key, symbol: "INTC", label: "m", id: "a-intc", ref: "2026-11-30", phase: "after", gap: true })];
  const restarted = rebuildDay(ledger, T("2026-12-01T09:00:00Z"));
  assert.deepEqual(passAt(restarted, [move], u("INTC", 86, "2026-12-01T09:00:10Z", 94), dec1), []);
  assert.deepEqual(passAt(restarted, [move], u("INTC", 86, "2026-12-01T09:00:40Z", 94), dec1), []);
  assert.deepEqual(passAt(restarted, [move], u("INTC", 86, "2026-12-01T09:00:40Z", 94), dec1, T("2026-12-01T09:05:00Z")), [], "and no lone print fires");
  assert.deepEqual(passAt(restarted, [move], u("INTC", 85, "2026-12-01T14:31:00Z", 94), dec1), []);
  /* the next after-hours is a new reference */
  passAt(restarted, [move], u("INTC", 80, "2026-12-01T21:30:00Z", 85), dec1);
  assert.deepEqual(shape(passAt(restarted, [move], u("INTC", 80, "2026-12-01T21:30:30Z", 85), dec1)), [["m", true, "2026-12-01", "after"]]);
});

test("a key first judged already past its threshold hits at that print with gap: true, its ref and its phase", () => {
  const [move] = keysOf({ rules: [moveRule("m", ["CRWV"], 8)] });
  const reg = emptyDay();
  const q = u("CRWV", 90, "2026-11-30T15:00:00Z", 100);
  const hits = passAt(reg, [move], q, BOTH);
  assert.deepEqual(shape(hits), [["m", true, "2026-11-27", "regular"]]);
  assert.equal(hits[0].quote, q);
  assert.equal(hits[0].onePrint, undefined);
  /* outside the session it waits for its second print, and still says gap */
  const pre = emptyDay();
  passAt(pre, [move], u("CRWV", 90, "2026-11-30T12:00:00Z", 100), BOTH);
  const second = u("CRWV", 89, "2026-11-30T12:00:20Z", 100);
  const late = passAt(pre, [move], second, BOTH);
  assert.deepEqual(shape(late), [["m", true, "2026-11-27", "pre"]]);
  assert.equal(late[0].quote, second, "the hit reads the second print");
  /* an A share has no phase; its ref is its session date */
  const [cnMove] = keysOf({ rules: [moveRule("c", ["600519"], 4)] });
  assert.deepEqual(shape(passAt(emptyDay(), [cnMove], c("600519", 1300, "2026-12-01T01:31:00Z", "trading", 1400), BOTH)), [["c", true, "2026-12-01", undefined]]);
});

test("outside the regular session a move hits on a second distinct print 20 s or more after the first; a print back under the threshold clears the first; the same as_of again does not count", () => {
  const [move] = keysOf({ rules: [moveRule("m", ["NVDA"], 5)] });
  const day = emptyDay();
  assert.deepEqual(passAt(day, [move], u("NVDA", 90, "2026-11-30T12:00:00Z", 100), BOTH), []);
  assert.equal(day.keys.get(move.key)?.pending?.asOf, "2026-11-30T12:00:00Z");
  assert.deepEqual(passAt(day, [move], u("NVDA", 90, "2026-11-30T12:00:10Z", 100), BOTH), [], "10 s after the first");
  assert.equal(day.keys.get(move.key)?.pending?.asOf, "2026-11-30T12:00:00Z", "the first stays pending");
  assert.equal(passAt(day, [move], u("NVDA", 90, "2026-11-30T12:00:25Z", 100), BOTH).length, 1, "25 s after the first");
  assert.equal(day.keys.get(move.key)?.pending, undefined);

  const back = emptyDay();
  passAt(back, [move], u("NVDA", 90, "2026-11-30T12:00:00Z", 100), BOTH);
  assert.deepEqual(passAt(back, [move], u("NVDA", 97, "2026-11-30T12:00:30Z", 100), BOTH), [], "back under 5%");
  assert.equal(back.keys.get(move.key)?.pending, undefined, "the first is cleared");
  assert.equal(back.keys.get(move.key)?.side, false);
  assert.deepEqual(passAt(back, [move], u("NVDA", 90, "2026-11-30T12:01:00Z", 100), BOTH), [], "a new first");
  assert.deepEqual(passAt(back, [move], u("NVDA", 90, "2026-11-30T12:01:00Z", 100), BOTH, T("2026-11-30T12:01:40Z")), [], "the same as_of on a later poll does not count");
  const hits = passAt(back, [move], u("NVDA", 89, "2026-11-30T12:01:30Z", 100), BOTH);
  assert.deepEqual(shape(hits), [["m", false, "2026-11-27", "pre"]], "a crossing, the side having been read");
  assert.equal(hits[0].onePrint, undefined);
});

test("a lone print past the threshold hits alone after 2 minutes with onePrint: true", () => {
  const [move] = keysOf({ rules: [moveRule("m", ["NVDA"], 5)] });
  const day = emptyDay();
  const first = u("NVDA", 90, "2026-11-30T21:40:00Z", 100);
  assert.deepEqual(passAt(day, [move], first, BOTH, T("2026-11-30T21:40:05Z")), []);
  assert.deepEqual(passAt(day, [move], first, BOTH, T("2026-11-30T21:42:04Z")), [], "1:59 after it was first seen");
  const alone = passAt(day, [move], first, BOTH, T("2026-11-30T21:42:05Z"));
  assert.deepEqual(shape(alone), [["m", true, "2026-11-30", "after"]]);
  assert.equal(alone[0].onePrint, true);
  assert.equal(alone[0].quote, first);
  assert.equal(alone[0].date, "2026-11-30");
  assert.deepEqual(passAt(day, [move], first, BOTH, T("2026-11-30T21:45:00Z")), [], "once");
  assert.deepEqual(passAt(day, [move], u("NVDA", 89, "2026-11-30T21:45:00Z", 100), BOTH), [], "still past");
});

test("a waiting print 10 minutes old is dropped: never fired alone, never confirmed, and the next past print waits afresh", () => {
  assert.equal(THIN_STALE_MS, 600_000);
  const [move] = keysOf({ rules: [moveRule("m", ["NVDA"], 5)] });
  /* the same as_of, first polled 10 minutes ago (the watch was asleep between) */
  const day = emptyDay();
  const first = u("NVDA", 90, "2026-11-30T21:40:00Z", 100);
  passAt(day, [move], first, BOTH, T("2026-11-30T21:40:05Z"));
  assert.deepEqual(passAt(day, [move], first, BOTH, T("2026-11-30T21:50:05Z")), []);
  assert.equal(day.keys.get(move.key)?.pending, undefined, "dropped");
  /* last night's waiting print, and the next morning's first pre-market print on the same reference */
  const night = emptyDay();
  passAt(night, [move], u("NVDA", 90, "2026-12-01T00:59:50Z", 100), BOTH);
  const dec1: WatchSessions = { us: usSession("2026-12-01", "2026-11-30") };
  assert.deepEqual(passAt(night, [move], u("NVDA", 89, "2026-12-01T09:00:10Z", 100), dec1), [], "not confirmed");
  assert.equal(night.keys.get(move.key)?.ref, "2026-11-30", "the same reference");
  assert.equal(night.keys.get(move.key)?.pending?.asOf, "2026-12-01T09:00:10Z", "a new waiting print");
  assert.equal(passAt(night, [move], u("NVDA", 89, "2026-12-01T09:00:40Z", 100), dec1).length, 1, "which its own second confirms");
});

test("a waiting print over 2 minutes old is settled by a new print first: back under clears it, past confirms it", () => {
  const [move] = keysOf({ rules: [moveRule("m", ["NVDA"], 5)] });
  const back = emptyDay();
  passAt(back, [move], u("NVDA", 90, "2026-11-30T12:00:00Z", 100), BOTH);
  assert.deepEqual(passAt(back, [move], u("NVDA", 97, "2026-11-30T12:03:00Z", 100), BOTH), [], "back under: no hit");
  assert.equal(back.keys.get(move.key)?.pending, undefined);
  const on = emptyDay();
  passAt(on, [move], u("NVDA", 90, "2026-11-30T12:00:00Z", 100), BOTH);
  const hits = passAt(on, [move], u("NVDA", 89, "2026-11-30T12:03:00Z", 100), BOTH);
  assert.deepEqual(shape(hits), [["m", true, "2026-11-27", "pre"]]);
  assert.equal(hits[0].onePrint, undefined, "a confirmed hit, not a lone one");
  assert.equal(hits[0].quote.asOf, "2026-11-30T12:03:00Z");
});

test("a waiting print fires alone on a pass with no print its key judges", () => {
  const [move] = keysOf({ rules: [moveRule("m", ["NVDA"], 5)] });
  const day = emptyDay();
  const first = u("NVDA", 90, "2026-11-30T21:40:00Z", 100);
  passAt(day, [move], first, BOTH, T("2026-11-30T21:40:05Z"));
  assert.deepEqual(evaluatePass(day, [move], [], BOTH, T("2026-11-30T21:41:00Z")), [], "no print, too soon");
  const stale = { ...u("NVDA", 90, "2026-11-30T21:42:00Z", 100), status: "stale" as const };
  const hits = evaluatePass(day, [move], [stale], BOTH, T("2026-11-30T21:42:10Z"));
  assert.deepEqual(shape(hits), [["m", true, "2026-11-30", "after"]]);
  assert.equal(hits[0].onePrint, true);
  assert.equal(hits[0].quote, first);
});

test("a gap rule never judges a pre-market print", () => {
  const [gap] = keysOf({ rules: [gapRule("g", ["NVDA"], 2)] });
  const day = emptyDay();
  assert.deepEqual(passAt(day, [gap], u("NVDA", 90, "2026-11-30T14:00:00Z", 100), BOTH), []);
  assert.deepEqual(passAt(day, [gap], u("NVDA", 90, "2026-11-30T14:00:30Z", 100), BOTH, T("2026-11-30T14:05:00Z")), []);
  assert.equal(day.keys.size, 0, "no observation");
  assert.deepEqual(shape(passAt(day, [gap], u("NVDA", 90, "2026-11-30T14:31:00Z", 100), BOTH)), [["g", true, "2026-11-27", "regular"]], "its first observation is the open's");
});

test("rebuildDay keeps a crossing from Friday's after-hours to Monday's pre-market, and from Wednesday's after-hours across Thanksgiving to Friday's early close", () => {
  assert.equal(REBUILD_WINDOW_MS, 432_000_000);
  const [move] = keysOf({ rules: [moveRule("m", ["INTC"], 5, 0)] });
  const rec = (t: string, ref: string) => alertRecord({ t, key: move.key, symbol: "INTC", label: "m", id: `a-${ref}`, date: ref, ref, phase: "after", gap: true });
  /* Friday 2026-11-20 16:05 ET; a restart at Monday 04:00 ET */
  const monday = rebuildDay([rec("2026-11-20T21:05:30.000Z", "2026-11-20")], T("2026-11-23T09:00:00Z"));
  assert.deepEqual(monday.keys.get(move.key), { ref: "2026-11-20", alerted: true, repeats: 0, lastHitAt: T("2026-11-20T21:05:30Z") });
  const mon: WatchSessions = { us: usSession("2026-11-23", "2026-11-20") };
  assert.deepEqual(passAt(monday, [move], u("INTC", 85, "2026-11-23T09:00:05Z", 94), mon), []);
  assert.deepEqual(passAt(monday, [move], u("INTC", 85, "2026-11-23T09:00:40Z", 94), mon), []);
  assert.deepEqual(passAt(monday, [move], u("INTC", 85, "2026-11-23T09:00:40Z", 94), mon, T("2026-11-23T09:10:00Z")), []);
  assert.deepEqual(passAt(monday, [move], u("INTC", 85, "2026-11-23T14:31:00Z", 94), mon), [], "nor at Monday's open");
  /* Wednesday 2026-11-25 16:10 ET; Thursday closed; a restart at Friday 04:00 ET, Friday closing at 13:00 */
  const friday = rebuildDay([rec("2026-11-25T21:10:30.000Z", "2026-11-25")], T("2026-11-27T09:00:00Z"));
  const fri: WatchSessions = { us: usSession("2026-11-27", "2026-11-25", true) };
  assert.deepEqual(passAt(friday, [move], u("INTC", 85, "2026-11-27T09:00:05Z", 94), fri), []);
  assert.deepEqual(passAt(friday, [move], u("INTC", 85, "2026-11-27T09:00:40Z", 94), fri), []);
  assert.deepEqual(passAt(friday, [move], u("INTC", 85, "2026-11-27T14:31:00Z", 94), fri), []);
  /* Friday's after-hours measures from Friday's 13:00 close: a new reference */
  assert.deepEqual(passAt(friday, [move], u("INTC", 80, "2026-11-27T18:30:00Z", 85), fri), []);
  assert.deepEqual(shape(passAt(friday, [move], u("INTC", 80, "2026-11-27T18:30:30Z", 85), fri)), [["m", true, "2026-11-27", "after"]]);
});

test("on an early-close day after-hours runs 13:00 to 17:00 and measures from the 13:00 close", () => {
  const nov27 = usSession("2026-11-27", "2026-11-25", true);
  assert.equal(nov27.close, "2026-11-27T18:00:00Z");
  assert.equal(usPhaseOf(T("2026-11-27T17:59:59Z"), nov27), "regular");
  assert.equal(usPhaseOf(T("2026-11-27T18:00:00Z"), nov27), "after", "13:00 ET");
  assert.equal(usPhaseOf(T("2026-11-27T21:59:59Z"), nov27), "after");
  assert.equal(usPhaseOf(T("2026-11-27T22:00:00Z"), nov27), undefined, "17:00 ET");
  assert.equal(referenceOf("after", nov27), "2026-11-27");
  assert.equal(referenceOf("pre", nov27), "2026-11-25", "Thanksgiving had no session");
  const [move] = keysOf({ rules: [moveRule("m", ["NVDA"], 5)] });
  const day = emptyDay();
  const sessions: WatchSessions = { us: nov27 };
  passAt(day, [move], u("NVDA", 90, "2026-11-27T18:05:00Z", 100), sessions);
  assert.deepEqual(shape(passAt(day, [move], u("NVDA", 90, "2026-11-27T18:05:30Z", 100), sessions)), [["m", true, "2026-11-27", "after"]]);
  assert.deepEqual(passAt(emptyDay(), [move], u("NVDA", 90, "2026-11-27T22:00:00Z", 100), sessions), [], "17:00 ET is not judged");
});

test("a record without ref rebuilds by its date, as before", () => {
  const cnKey = "level:desk/levels.yml:600519:stop:1400:cross_down";
  const day = rebuildDay([
    alertRecord({ t: "2026-12-01T01:31:00.000Z", key: cnKey, id: "a-cn", market: "cn", symbol: "600519", date: "2026-12-01" }),
    alertRecord({ t: "2026-11-30T15:00:00.000Z", key: "rule:m:NVDA", symbol: "NVDA", id: "a-old", date: "2026-11-30" }),
  ], T("2026-12-01T01:40:00Z"));
  assert.equal(day.keys.get(cnKey)?.ref, "2026-12-01");
  assert.equal(day.keys.get("rule:m:NVDA")?.ref, "2026-11-30");
  const [cnStop] = keysOf({ levels: [level("600519", "stop", 1400, "cross_down")] });
  assert.deepEqual(evaluatePass(day, [cnStop], [c("600519", 1390, "2026-12-01T01:35:00Z", "trading")], BOTH, T("2026-12-01T01:35:00Z")), [], "still past on its date: no second gap");
  assert.equal(day.keys.get(cnKey)?.side, true);
});

/* ---------- the orphans: a send a restart caught before its delivered record (spec §16 H2) ---------- */

const ORPHANS_NOW = T("2026-11-30T15:00:00Z");
/** Each orphan case's alert key, one per id. */
const keyOf = (id: string): string => `rule:m:${id}`;
/** An alert record `id` at `at`, sent or suppressed. */
const hit = (id: string, at: number, decision: AlertHit["decision"]): AlertHit =>
  alertRecord({ t: new Date(at).toISOString(), id, key: keyOf(id), ...(decision === "send" ? {} : { decision, suppressed: "muted" as const }) });
/** The delivered record of alert `id`. */
const delivered = (id: string): unknown => ({ t: new Date(ORPHANS_NOW - 30_000).toISOString(), kind: "delivered", id, delivery: { sent: [1] }, latency: { tradeMs: null, receivedMs: null } });
const ORPHAN_RECORDS: unknown[] = [
  hit("a1", ORPHANS_NOW - 5 * 60_000, "send"), hit("a2", ORPHANS_NOW - 20 * 60_000, "send"),
  hit("a3", ORPHANS_NOW - 1 * 60_000, "send"), delivered("a3"), hit("a4", ORPHANS_NOW - 60_000, "suppressed"),
  hit("a5", ORPHANS_NOW - 37 * HOUR_MS, "send"),
];

test("findOrphans splits a send with no delivered record by its age", () => {
  assert.equal(ALERT_REPLAY_MS, 600_000);
  const { replay, lost } = findOrphans(ORPHAN_RECORDS, ORPHANS_NOW);
  assert.deepEqual(replay.map((r) => r.id), ["a1"]);
  assert.deepEqual(lost.map((r) => r.id), ["a2"], "a send past the 36 h window is no orphan");
  assert.deepEqual(findOrphans([hit("a6", ORPHANS_NOW - ALERT_REPLAY_MS, "send")], ORPHANS_NOW).lost.map((r) => r.id), ["a6"], "ten minutes old is lost");
});

test("rebuildDay leaves a lost send out of the hour's count and keeps its cooldown", () => {
  const day = rebuildDay(ORPHAN_RECORDS, ORPHANS_NOW, new Set(["a2"]));
  assert.equal(day.sends.length, 2, "a1 and a3, not a2");
  assert.equal(typeof day.keys.get(keyOf("a2"))?.lastHitAt, "number");
  assert.equal(rebuildDay(ORPHAN_RECORDS, ORPHANS_NOW).sends.length, 3, "without the set, a2 counts");
});

test("isAlertRecord accepts the four kinds and rejects a torn or kindless line", () => {
  assert.equal(isAlertRecord(alertRecord({})), true);
  assert.equal(isAlertRecord(alertRecord({ ref: "2026-11-30", phase: "after", onePrint: true })), true);
  assert.equal(isAlertRecord({ t: "2026-11-30T14:30:03.000Z", kind: "delivered", id: "a-1", delivery: { sent: [12] }, latency: { tradeMs: 2000, receivedMs: 1500 } }), true);
  assert.equal(isAlertRecord({ t: "2026-11-30T16:00:05.000Z", kind: "batch", id: "b-1", date: "2026-11-30", alerts: ["a-1"], dropped: "muted" }), true);
  assert.equal(isAlertRecord({ t: "2026-11-30T14:31:00.000Z", kind: "annotation", pass: "p-1", alerts: ["a-1"], result: "opened", sessionId: "s-1" }), true);
  for (const bad of [
    null, "x", 3, [], {}, { kind: "alert" }, { t: "2026-11-30T14:30:02.000Z" }, { t: "2026-11-30T14:30:02.000Z", kind: "pong" },
    { t: 1, kind: "batch", id: "b-1", date: "2026-11-30", alerts: [] }, { t: "2026-11-30T16:00:05.000Z", kind: "batch", id: "b-1", date: "2026-11-30", alerts: [1] },
    { ...alertRecord({}), decision: "maybe" }, { ...alertRecord({}), key: undefined },
    { t: "2026-11-30T14:31:00.000Z", kind: "annotation", pass: "p-1", alerts: ["a-1"], result: "lost" },
    { t: "2026-11-30T14:30:03.000Z", kind: "delivered", id: "a-1" },
    { ...alertRecord({}), ref: 20261127 }, { ...alertRecord({}), phase: "night" }, { ...alertRecord({}), onePrint: false },
  ]) assert.equal(isAlertRecord(bad), false, JSON.stringify(bad));
});

test("snapOf keeps the print's market, feed and status, and is null without a price or an as_of", () => {
  assert.deepEqual(snapOf(c("600519", 1390, "2026-12-01T01:31:00Z", "trading", 1400)), {
    market: "cn", price: 1390, asOf: "2026-12-01T01:31:00Z", feed: "tencent", status: "live", prevClose: 1400, chgPct: ((1390 - 1400) / 1400) * 100, receivedAt: "2026-12-01T01:31:00Z",
  });
  assert.equal(snapOf(u("NVDA", null, "2026-11-30T15:00:00Z")), null);
  assert.equal(snapOf({ ...u("NVDA", 100, "2026-11-30T15:00:00Z"), asOf: null }), null);
});

test("the ids: a-, p- and b- and 12 lowercase hex characters, each fresh", () => {
  assert.match(alertId(), /^a-[0-9a-f]{12}$/);
  assert.match(passId(), /^p-[0-9a-f]{12}$/);
  assert.match(batchId(), /^b-[0-9a-f]{12}$/);
  assert.notEqual(alertId(), alertId());
});

/* the WatchDay type is the module's own */
const _typed: WatchDay = emptyDay();
void _typed;
