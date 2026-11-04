// face/tests/watch-eval.test.ts
/** The watch's evaluator (src/watch-eval.ts), pure: which prints are judged in each market's session (rulings 1, 2),
 * crossings and the once-a-session `gap`, the gap rule's 30 minutes from its market's open, cooldown repeats, the
 * gate (OFF, then MUTE, then the hourly cap) and the cap's batch, the `alerts.jsonl` records, and the day rebuilt
 * from them. US S: 2026-11-30 14:30Z-21:00Z; CN C: 2026-12-01 01:30Z-07:00Z (09:30-15:00 Beijing). Offline. */
import test from "node:test";
import assert from "node:assert/strict";
import type { Level, LevelKind, Rule } from "../src/desk-book.ts";
import type { MarketSession } from "../src/market-clock.ts";
import type { MarketQuote } from "../src/market-quotes.ts";
import {
  ALERTS_PER_HOUR, GAP_RULE_WINDOW_MS, HOUR_MS,
  ALERT_REPLAY_MS, alertId, batchDue, batchId, emptyDay, evaluatePass, findOrphans, gate, isAlertRecord, judgedDate, passId, pastOf, priceKeys, rebuildDay, snapOf,
  takeBatch, watchQuoteOf,
  type AlertHit, type PriceKey, type WatchDay, type WatchQuote, type WatchSessions,
} from "../src/watch-eval.ts";

const S: MarketSession = { date: "2026-11-30", open: "2026-11-30T14:30:00Z", close: "2026-11-30T21:00:00Z", early: false };
const C: MarketSession = { date: "2026-12-01", open: "2026-12-01T01:30:00Z", close: "2026-12-01T07:00:00Z", early: false };
const BOTH: WatchSessions = { us: S, cn: C };
const T = (iso: string): number => Date.parse(iso);

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
function moveRule(id: string, symbols: string[], movePct: number, cooldownMs = 1_800_000): Rule {
  return { file: "desk/rules.yml", index: 0, id, symbols: { holdings: false, levels: false, symbols }, annotate: false, urgent: false, kind: "move_pct", movePct, cooldownMs };
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

test("a US print is judged on as_of inside its own session, not on the clock", () => {
  const at = (asOf: string, sessions: WatchSessions = BOTH) => judgedDate(u("NVDA", 100, asOf), sessions);
  assert.equal(at("2026-11-30T14:29:59Z"), undefined, "a print before the open, read after it");
  assert.equal(at("2026-11-30T14:30:00Z"), "2026-11-30");
  assert.equal(at("2026-11-30T20:59:59Z"), "2026-11-30");
  assert.equal(at("2026-11-30T21:00:00Z"), undefined, "the close is outside");
  assert.equal(at("2026-11-30T15:00:00Z", { cn: C }), undefined, "no US session, no judgement");
  assert.equal(at("2026-12-01T15:00:00Z"), undefined, "another ET date");
  const nov2: MarketSession = { date: "2026-11-02", open: "2026-11-02T14:30:00Z", close: "2026-11-02T21:00:00Z", early: false };
  assert.equal(at("2026-11-02T13:45:00Z", { us: nov2 }), undefined, "09:45 had DST held; 08:45 EST");
  assert.equal(at("2026-11-02T14:30:00Z", { us: nov2 }), "2026-11-02");
  const nov27: MarketSession = { date: "2026-11-27", open: "2026-11-27T14:30:00Z", close: "2026-11-27T18:00:00Z", early: true };
  assert.equal(at("2026-11-27T17:59:00Z", { us: nov27 }), "2026-11-27");
  assert.equal(at("2026-11-27T18:05:00Z", { us: nov27 }), undefined, "after the early close");

  const [stop] = keysOf({ levels: [level("NVDA", "stop", 170, "cross_down")] });
  const day = emptyDay();
  assert.deepEqual(evaluatePass(day, [stop], [u("NVDA", 168, "2026-11-30T14:29:59Z")], BOTH, T("2026-11-30T14:30:05Z")), [], "the clock is in the session, the print is not");
  assert.equal(day.keys.has(stop.key), false, "and it is no observation");
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
  assert.equal(day.keys.get(stop.key)?.date, "2026-11-30");
  assert.equal(day.keys.get(cnStop.key)?.date, "2026-12-01");
  /* the next US session starts the US key afresh */
  const dec1: MarketSession = { date: "2026-12-01", open: "2026-12-01T14:30:00Z", close: "2026-12-01T21:00:00Z", early: false };
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
    alertRecord({ t: "2026-11-30T14:30:02.000Z", key: nvda, id: "a-nvda" }),
    alertRecord({ t: "2026-11-30T14:41:00.000Z", key: "rule:m:AAPL", symbol: "AAPL", id: "a-aapl", decision: "suppressed", suppressed: "cap" }),
    alertRecord({ t: "2026-11-30T14:20:00.000Z", key: "rule:m:AMD", symbol: "AMD", id: "a-old-cap", decision: "suppressed", suppressed: "cap" }),
    { t: "2026-11-30T15:00:00.000Z", kind: "batch", id: "b-1", date: "2026-11-30", alerts: ["a-old-cap"] },
    alertRecord({ t: "2026-11-30T14:50:00.000Z", key: nvda, id: "a-nvda-repeat", decision: "suppressed", suppressed: "cooldown" }),
    alertRecord({ t: "2026-12-01T01:30:05.000Z", key: cnKey, id: "a-cn", market: "cn", symbol: "600519", date: "2026-12-01" }),
    alertRecord({ t: "2026-11-28T14:30:00.000Z", key: "rule:m:MSFT", symbol: "MSFT", id: "a-ancient", date: "2026-11-27" }),
    /* its t is bent to 2026-11-29 so the 11-27 record stays inside the 36 h window and the newer date must win */
    alertRecord({ t: "2026-11-29T23:00:00.000Z", key: "rule:g:TSLA", symbol: "TSLA", id: "a-tsla-27", date: "2026-11-27", decision: "suppressed", suppressed: "muted" }),
    alertRecord({ t: "2026-11-30T14:35:00.000Z", key: "rule:g:TSLA", symbol: "TSLA", id: "a-tsla-30", date: "2026-11-30", decision: "suppressed", suppressed: "muted" }),
    "a torn line", { kind: "alert" }, null,
  ];
  const now = T("2026-12-01T01:35:00Z");
  const day = rebuildDay(records, now);
  assert.deepEqual(day.keys.get(nvda), { date: "2026-11-30", alerted: true, repeats: 0, lastHitAt: T("2026-11-30T14:30:02Z") }, "the cooldown repeat is no hit");
  assert.equal(day.keys.get(cnKey)?.date, "2026-12-01");
  assert.equal(day.keys.get(cnKey)?.alerted, true);
  assert.equal(day.keys.has("rule:m:MSFT"), false, "a record older than 36 h is ignored");
  assert.equal(day.keys.get("rule:g:TSLA")?.date, "2026-11-30", "a key's newest date");
  assert.deepEqual(day.sends, [T("2026-12-01T01:30:05Z")], "the sends within the hour");
  assert.deepEqual(day.pending, [{ id: "a-aapl", t: T("2026-11-30T14:41:00Z") }], "the caps no batch lists");

  /* NVDA still past on its date: no second gap; the A share likewise */
  const keys = keysOf({ levels: [level("NVDA", "stop", 170, "cross_down"), level("600519", "stop", 1400, "cross_down")] });
  assert.deepEqual(evaluatePass(day, keys, [u("NVDA", 168, "2026-11-30T20:00:00Z"), c("600519", 1390, "2026-12-01T01:34:00Z", "trading")], BOTH, now), []);
  assert.equal(day.keys.get(nvda)?.side, true, "the side is read afresh");
  assert.deepEqual(rebuildDay([], now), emptyDay());

  /* a rebuilt cooldown swallows a crossing after the restart */
  const restarted = rebuildDay([alertRecord({ t: "2026-11-30T15:00:00.000Z", key: nvda, id: "a-before", gap: false })], T("2026-11-30T15:05:00Z"));
  const [stop] = keys;
  assert.deepEqual(evaluatePass(restarted, [stop], [u("NVDA", 171, "2026-11-30T15:06:00Z")], BOTH, T("2026-11-30T15:06:00Z")), []);
  assert.deepEqual(evaluatePass(restarted, [stop], [u("NVDA", 169, "2026-11-30T15:10:00Z")], BOTH, T("2026-11-30T15:10:00Z")), [], "inside 30 minutes of the last hit");
  assert.equal(restarted.keys.get(nvda)?.repeats, 1);
  assert.equal(evaluatePass(restarted, [stop], [u("NVDA", 171, "2026-11-30T15:35:00Z")], BOTH, T("2026-11-30T15:35:00Z")).length, 0);
  assert.equal(evaluatePass(restarted, [stop], [u("NVDA", 169, "2026-11-30T15:40:00Z")], BOTH, T("2026-11-30T15:40:00Z")).length, 1, "and after it a crossing hits");
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
  assert.equal(isAlertRecord({ t: "2026-11-30T14:30:03.000Z", kind: "delivered", id: "a-1", delivery: { sent: [12] }, latency: { tradeMs: 2000, receivedMs: 1500 } }), true);
  assert.equal(isAlertRecord({ t: "2026-11-30T16:00:05.000Z", kind: "batch", id: "b-1", date: "2026-11-30", alerts: ["a-1"], dropped: "muted" }), true);
  assert.equal(isAlertRecord({ t: "2026-11-30T14:31:00.000Z", kind: "annotation", pass: "p-1", alerts: ["a-1"], result: "opened", sessionId: "s-1" }), true);
  for (const bad of [
    null, "x", 3, [], {}, { kind: "alert" }, { t: "2026-11-30T14:30:02.000Z" }, { t: "2026-11-30T14:30:02.000Z", kind: "pong" },
    { t: 1, kind: "batch", id: "b-1", date: "2026-11-30", alerts: [] }, { t: "2026-11-30T16:00:05.000Z", kind: "batch", id: "b-1", date: "2026-11-30", alerts: [1] },
    { ...alertRecord({}), decision: "maybe" }, { ...alertRecord({}), key: undefined },
    { t: "2026-11-30T14:31:00.000Z", kind: "annotation", pass: "p-1", alerts: ["a-1"], result: "lost" },
    { t: "2026-11-30T14:30:03.000Z", kind: "delivered", id: "a-1" },
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
