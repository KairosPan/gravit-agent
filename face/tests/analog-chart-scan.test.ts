// face/tests/analog-chart-scan.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { createBarsKeep } from "../plugins/analog/lib/bars.mjs";
import { normalizeSymbol, scanChart } from "../plugins/analog/lib/chart-scan.mjs";
import { DIGEST_MAX, chartDigest } from "../plugins/analog/lib/digest.mjs";
import { AnalogError } from "../plugins/analog/lib/errors.mjs";
import { UNIVERSE, UNIVERSE_AS_OF, UNIVERSE_RULE } from "../plugins/analog/lib/universe.mjs";
import { MARKET, PAST, SELLOFF, barsFrom, fakeMarket, flat, near } from "./analog-fixtures.ts";

const NOW = () => new Date("2020-11-26T20:00:00Z");
const held = () => ({ QRY: { bars: SELLOFF }, PAST: { bars: PAST }, SPY: { bars: MARKET } });
const scan = (over: object = {}, histories: Record<string, any> = held()) => {
  const market = fakeMarket(histories);
  return scanChart({ symbol: "QRY", universe: ["PAST"], keep: createBarsKeep({ ask: market.ask }), now: NOW, ...over });
};
const code = (c: string) => (e: unknown) => e instanceof AnalogError && e.code === c && e.message.startsWith(`${c} `);

test("the scan of the fixture", async () => {
  const view = await scan();
  assert.deepEqual([view.kind, view.version, view.queryGroup, view.windowsDropped], ["chart", 1, "calm", 0]);
  const q = view.query;
  assert.deepEqual([q.symbol, q.date, q.readDate, q.asOf, q.sessionOpen, q.peakDate, q.gapDate, q.days, q.close, q.peak], ["QRY", "2020-11-26", "2020-11-26", null, false, "2020-11-06", "2020-11-23", 20, 70, 100]);
  near(q.depth, -0.30); near(q.last5, -0.125); near(q.gap, -0.06); near(q.volume, 4);
  assert.deepEqual(q.market, { change: 0, group: "calm" }); assert.equal(q.path.length, 31); assert.deepEqual(q.path[30], [0, 101.43, 101.43, 100, 100, 1000]);
  assert.deepEqual(view.parameters.dropped, []);
  assert.deepEqual(view.coverage, { asked: 2, read: 2, sources: { Nasdaq: 2 }, short: [], refused: [], stockDays: 527, episodes: 2, underWay: 1, short60: 0, noContext: 0, weeks: 1, deadline: false });
  assert.deepEqual(view.cases.map((c) => [c.id, c.state, c.market.group, c.sameWeek]), [["PAST:2020-11-21", "underWay", "calm", 0], ["PAST:2020-05-04", "past", "down", 0]]);
  assert.equal(view.cases[1]!.window!.length, 91); near(view.cases[1]!.after.r60, 0.25);
  assert.deepEqual([view.groups.all.n, view.groups.all.summarized, view.groups.own.n, view.groups.calm.n, view.groups.down.n], [1, false, 0, 0, 1]);
  assert.deepEqual(view.leading, { own: [], others: [{ id: "PAST:2020-05-04", standsFor: 1 }] });
});

test("a symbol is read as people type it", async () => {
  assert.equal(normalizeSymbol(" nvda "), "NVDA"); assert.equal(normalizeSymbol("brk.b"), "BRK.B");
  for (const bad of ["", "1ABC", "TOO-LONG-TICKER", "A B", 7, null]) assert.throws(() => normalizeSymbol(bad), code("BAD_SYMBOL"));
  assert.equal((await scan({ symbol: " qry " })).query.symbol, "QRY");
});

test("the query's own stock in the list is scanned once, and SPY never", async () => {
  const view = await scan({ universe: ["QRY", "PAST", "SPY"], also: ["PAST", "qry", "spy"] });
  assert.deepEqual([view.coverage.asked, view.coverage.read, view.coverage.stockDays], [2, 2, 527]);
  await assert.rejects(scan({ also: Array.from({ length: 21 }, (_, i) => `T${i}`) }), code("BAD_ALSO"));
});

test("as_of cuts every history first", async () => {
  const view = await scan({ asOf: "2020-11-22" });
  assert.deepEqual([view.query.date, view.query.asOf, view.query.days], ["2020-11-22", "2020-11-22", 16]);
  near(view.query.depth, -0.21);
  assert.deepEqual(view.parameters.dropped, ["gap", "volume"]);
  assert.deepEqual(view.cases.map((c) => [c.id, c.state, c.after.sessionsAfter]), [["PAST:2020-11-17", "underWay", 5], ["PAST:2020-04-29", "past", 207]]);
  near(view.cases[1]!.distance, 0.477498, 1e-6); near(view.cases[1]!.after.low60, -0.135802, 1e-6);
  assert.equal((await scan({ asOf: "2021-06-01" })).query.date, "2020-11-26"); // after the latest bar: the latest bar
  await assert.rejects(scan({ asOf: "2020-03-01" }), code("NO_HISTORY"));        // 61 bars: fewer than 120
  await assert.rejects(scan({ asOf: "last week" }), code("BAD_AS_OF"));
});

test("what the scan refuses", async () => {
  await assert.rejects(scan({ symbol: "CALM" }, { ...held(), CALM: { bars: barsFrom(flat(331, 50)) } }), code("NOT_A_SELLOFF"));
  await assert.rejects(scan({ symbol: "NONE" }), code("NO_HISTORY"));
  await assert.rejects(scan({ symbol: "NEW" }, { ...held(), NEW: { bars: SELLOFF.slice(-100) } }), code("NO_HISTORY"));
  const down = async () => ({ status: 0, body: { ok: false, refusal: { code: "E_MARKET_DOWN", message: "the market at http://127.0.0.1:9 did not answer" } } });
  const started = Date.now();
  await assert.rejects(scanChart({ symbol: "QRY", universe: ["PAST"], keep: createBarsKeep({ ask: down }), now: NOW }), code("MARKET_UNREACHABLE"));
  assert.ok(Date.now() - started < 1000, "a market that is down refuses at once");
  const blowOff = barsFrom(flat(130, 100), { 129: { o: 130 } }); // the latest bar's own high is the 60-session high: 23% down inside one session
  await assert.rejects(scan({ symbol: "SPIKE" }, { ...held(), SPIKE: { bars: blowOff } }), (e: unknown) => code("NOT_A_SELLOFF")(e) && (e as Error).message.includes("its latest bar"));
});

test("what could not be read is counted", async () => {
  const noMarket = await scan({}, { QRY: { bars: SELLOFF }, PAST: { bars: PAST } });
  assert.deepEqual([noMarket.query.market, noMarket.queryGroup, noMarket.coverage.noContext], [{ change: null, group: "unknown" }, "unknown", 2]);
  const short = await scan({}, { ...held(), PAST: { bars: PAST, source: "Cboe · PAST" } });
  assert.deepEqual([short.coverage.short, short.coverage.sources], [[{ symbol: "PAST", source: "Cboe · PAST", firstBar: "2020-01-01" }], { Nasdaq: 1, Cboe: 1 }]);
  const refused = await scan({ universe: ["PAST", "GONE"] });
  assert.deepEqual([refused.coverage.asked, refused.coverage.read, refused.coverage.refused], [3, 2, [{ symbol: "GONE", words: "Nasdaq keeps no daily bars of GONE" }]]);
  const late = await scan({ deadlineMs: -1 });
  assert.deepEqual([late.coverage.deadline, late.coverage.read, late.cases.length], [true, 1, 0]);
  assert.equal(late.coverage.refused[0]!.words, "not read before the deadline");
});

test("the digest", async () => {
  const view = { ...(await scan()), id: "an-20201126-0a1b2c3d" };
  const text = chartDigest(view);
  const lines = text.split("\n");
  assert.ok(Buffer.byteLength(text) <= DIGEST_MAX); assert.equal(DIGEST_MAX, 2048);
  assert.equal(lines[0], "read 2 of 2 companies (0 refused, 0 read short) · 527 stock-days · view an-20201126-0a1b2c3d");
  assert.equal(lines[1], "QRY as of 2020-11-26: −30.0% from the high of 2020-11-06 in 20 sessions; last 5 −12.5%; worst gap −6.0%; volume 4.0×; market 0.0% (calm)");
  assert.equal(lines[2], "matched 1 past sell-off in 1 week; 1 under way now; 0 short of 60 sessions; 0 without market context");
  assert.match(text, /^all +1 +too few to summarize$/m); assert.match(text, /^down +1 +too few to summarize$/m); assert.match(text, /^calm \* +0 +too few to summarize$/m);
  assert.ok(text.includes("PAST 2020-05-04 −28.0%/24d → +60 +25.0%, low −2.8% (4)"));
  assert.ok(text.includes("under way now: PAST 2020-11-21"));
  assert.ok(text.endsWith("These are today's large companies: failed and delisted ones are missing, so the picture leans favourable. One market crash appears once per company: the cases are not independent. No lookahead guard: never evidence for a trade."));
  const dropped = chartDigest({ ...(await scan({ asOf: "2020-11-22" })), id: "an-20201126-0a1b2c3d" });
  assert.ok(dropped.includes("; dropped: gap, volume")); assert.ok(dropped.split("\n")[1]!.startsWith("QRY as of 2020-11-22 (as asked): −21.0%"));
});

test("a digest of a large view still fits, and says a group's numbers once it has eight", async () => {
  const view = { ...(await scan()), id: "an-20201126-0a1b2c3d" };
  const base = view.cases[1]!;
  const many = Array.from({ length: 400 }, (_, k) => ({ ...base, id: `S${k}:2010-01-01`, symbol: `S${k}`, date: `20${10 + (k % 10)}-0${1 + (k % 9)}-15`, distance: k / 100 }));
  const summary = { n: 400, n60: 400, summarized: true, r5: 0.018, r20: 0.021, r60: 0.103, r60q1: -0.121, r60q3: 0.276, low60: -0.129, lowAt: 19, lower5: 0.77, lower10: 0.62, lower20: 0.31, up20: 0.57, up60: 0.61 };
  const text = chartDigest({ ...view, cases: many, groups: { ...view.groups, all: summary }, leading: { own: [], others: many.slice(0, 8).map((c) => ({ id: c.id, standsFor: 3 })) } });
  assert.ok(Buffer.byteLength(text) <= DIGEST_MAX);
  assert.match(text, /^all +400 +\+1\.8% +\+2\.1% +\+10\.3% +\[−12\.1% … \+27\.6%\] +−12\.9% \(19\) +62% +61%$/m);
  assert.ok(text.includes(" · stands for 3"));
});

test("the universe is a list with its date and its rule", () => {
  assert.ok(UNIVERSE.length >= 30 && UNIVERSE.length <= 100); assert.equal(new Set(UNIVERSE).size, UNIVERSE.length);
  assert.ok(!UNIVERSE.includes("SPY")); assert.match(UNIVERSE_AS_OF, /^\d{4}-\d{2}-\d{2}$/); assert.ok(UNIVERSE_RULE.length > 20);
  for (const symbol of UNIVERSE) assert.equal(normalizeSymbol(symbol), symbol);
});

test("an as_of on or after an open session's date still says the session is open", async () => {
  const open = { ...held(), QRY: { bars: SELLOFF, today: true } };
  const id = "an-20201126-0a1b2c3d";
  const today = await scan({ asOf: "2020-11-26" }, open);
  assert.deepEqual([today.query.date, today.query.asOf, today.query.sessionOpen], ["2020-11-26", "2020-11-26", true]);
  assert.ok(chartDigest({ ...today, id }).split("\n")[1]!.startsWith("QRY as of 2020-11-26 (as asked; session still open): −30.0%"));
  assert.equal((await scan({ asOf: "2021-06-01" }, open)).query.sessionOpen, true); // after the latest bar: the latest bar, still open
  const earlier = await scan({ asOf: "2020-11-22" }, open);
  assert.equal(earlier.query.sessionOpen, false);
  assert.ok(chartDigest({ ...earlier, id }).split("\n")[1]!.startsWith("QRY as of 2020-11-22 (as asked): −21.0%"));
  assert.ok(chartDigest({ ...(await scan({}, open)), id }).split("\n")[1]!.startsWith("QRY as of 2020-11-26 (session still open): −30.0%"));
});

test("SPY asked about is scanned as the query's own stock", async () => {
  const view = await scan({ symbol: "spy" }, { SPY: { bars: SELLOFF }, PAST: { bars: PAST } });
  assert.deepEqual([view.query.symbol, view.coverage.asked, view.coverage.read, view.coverage.stockDays], ["SPY", 2, 2, 527]);
  assert.equal(view.query.market.group, "down"); near(view.query.market.change, -0.30);
  assert.equal((await scan({ universe: ["PAST", "SPY"], also: ["spy"] })).coverage.asked, 2); // as another company SPY is still never scanned
});
