// face/tests/analog-bars.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { AT_ONCE, createBarsKeep, marketAsk, readHistory } from "../plugins/analog/lib/bars.mjs";
import { MARKET, PAST, SELLOFF, barsFrom, dateAt, fakeMarket, flat } from "./analog-fixtures.ts";

const refusal = (code: string, message: string, native: object = {}) => ({ refusal: { code, message, native } });

test("a history is asked for until more is false, oldest first", async () => {
  const long = barsFrom(flat(6200, 50));
  const market = fakeMarket({ LONG: { bars: long } });
  const h = await readHistory(market.ask, "LONG", () => 7);
  assert.ok(!("refused" in h));
  assert.equal(h.bars.length, 6200); assert.equal(h.bars[0]!.t, long[0]!.t); assert.equal(h.firstBar, dateAt(0));
  assert.deepEqual([h.source, h.short, h.sessionOpen, h.readAt], ["Nasdaq · LONG", false, false, 7]);
  assert.deepEqual(market.calls, [
    { venue: "cboe", symbol: "LONG", interval: "1d", range: "MAX", limit: "5000" },
    { venue: "cboe", symbol: "LONG", interval: "1d", before: String(long[1200]!.t), limit: "1000" },
    { venue: "cboe", symbol: "LONG", interval: "1d", before: String(long[200]!.t), limit: "1000" },
  ]);
});

test("a history from another source is read short; a session-so-far bar says the session is open", async () => {
  const market = fakeMarket({ X: { bars: PAST, source: "Cboe · X", today: true } });
  const h = await readHistory(market.ask, "X");
  assert.ok(!("refused" in h));
  assert.deepEqual([h.short, h.sessionOpen], [true, true]);
});

test("a refusal keeps the market's words and says how long its source is held", async () => {
  const market = fakeMarket({
    A: refusal("E_VENUE_UNREACHABLE", "Nasdaq could not be reached"),
    B: refusal("E_VENUE_RATE_LIMITED", "Nasdaq is rate-limiting", { status: 429 }),
    C: refusal("E_VENUE_GEOBLOCKED", "Nasdaq does not serve this location"),
  });
  assert.deepEqual(await readHistory(market.ask, "A"), { symbol: "A", refused: "Nasdaq could not be reached", holdMs: 20_000, down: false });
  assert.deepEqual(await readHistory(market.ask, "B"), { symbol: "B", refused: "Nasdaq is rate-limiting", holdMs: 60_000, down: false });
  assert.deepEqual(await readHistory(market.ask, "C"), { symbol: "C", refused: "Nasdaq does not serve this location", holdMs: 600_000, down: false });
  assert.deepEqual(await readHistory(market.ask, "NONE"), { symbol: "NONE", refused: "Nasdaq keeps no daily bars of NONE", holdMs: null, down: false });
});

test("a market that does not answer is down, at once", async () => {
  const ask = marketAsk("http://127.0.0.1:9", async () => { throw new TypeError("fetch failed"); });
  assert.deepEqual(await readHistory(ask, "NVDA"), { symbol: "NVDA", refused: "the market at http://127.0.0.1:9 did not answer", holdMs: null, down: true });
  const slept: number[] = [];
  const keep = createBarsKeep({ ask, sleep: async (ms) => { slept.push(ms); } });
  const got = await keep.histories(["NVDA", "SPY"], { fresh: ["NVDA", "SPY"] });
  assert.deepEqual([got.down, got.read.size, slept], [true, 0, []]);
});

test("marketAsk asks the market's candles route and nothing else", async () => {
  const seen: string[] = [];
  const ask = marketAsk("http://127.0.0.1:4821", async (url) => { seen.push(String(url)); return Response.json({ ok: true, candles: [], more: false, source: "Nasdaq · X" }); });
  assert.equal((await ask({ venue: "cboe", symbol: "X", interval: "1d", range: "MAX", limit: "5000" })).status, 200);
  assert.deepEqual(seen, ["http://127.0.0.1:4821/api/candles?venue=cboe&symbol=X&interval=1d&range=MAX&limit=5000"]);
  assert.throws(() => marketAsk("http://127.0.0.1:4821/api"), /an origin alone/);
});

test("the keep reads four at a time, keeps what it read, and reads the fresh ones again", async () => {
  const names = ["QRY", "SPY", "P1", "P2", "P3", "P4", "P5"];
  const market = fakeMarket(Object.fromEntries(names.map((n) => [n, { bars: n === "QRY" ? SELLOFF : n === "SPY" ? MARKET : PAST }])));
  let open = 0, most = 0;
  const ask = async (query: Record<string, string>) => { open++; most = Math.max(most, open); await new Promise((r) => setTimeout(r, 5)); open--; return market.ask(query); };
  const keep = createBarsKeep({ ask });
  const first = await keep.histories(names, { fresh: ["QRY", "SPY"] });
  assert.equal(first.read.size, 7); assert.equal(most, AT_ONCE); assert.equal(market.calls.length, 7);
  await keep.histories(names, { fresh: ["QRY", "SPY"] });
  assert.deepEqual(market.calls.slice(7).map((c) => c.symbol).sort(), ["QRY", "SPY"]);
});

test("when the market's latest session moves on, everything kept is read again", async () => {
  const histories: Record<string, { bars: typeof PAST }> = { SPY: { bars: MARKET.slice(0, 330) }, P1: { bars: PAST.slice(0, 330) } };
  const market = fakeMarket(histories);
  const keep = createBarsKeep({ ask: market.ask });
  await keep.histories(["SPY", "P1"], { fresh: ["SPY"] });
  histories.SPY = { bars: MARKET }; histories.P1 = { bars: PAST };
  const again = await keep.histories(["SPY", "P1"], { fresh: ["SPY"] });
  assert.equal(again.read.get("P1")!.bars.length, 331);
});

test("two scans at once share one read of each company", async () => {
  const market = fakeMarket({ SPY: { bars: MARKET }, P1: { bars: PAST } });
  const keep = createBarsKeep({ ask: async (q) => { await new Promise((r) => setTimeout(r, 5)); return market.ask(q); } });
  await Promise.all([keep.histories(["SPY", "P1"], { fresh: ["SPY"] }), keep.histories(["SPY", "P1"], { fresh: ["SPY"] })]);
  assert.deepEqual(market.calls.map((c) => c.symbol).sort(), ["P1", "SPY"]);
});

test("a hold of a minute or less is waited out once; a longer one, and a second one, are not", async () => {
  let failing = 1;
  const market = fakeMarket({ SPY: { bars: MARKET }, P1: { bars: PAST }, P2: refusal("E_VENUE_GEOBLOCKED", "no service here") });
  const ask = async (q: Record<string, string>) => (q.symbol === "P1" && failing-- > 0 ? { status: 409, body: { ok: false, ...refusal("E_VENUE_UNREACHABLE", "Nasdaq could not be reached") } } : market.ask(q));
  const slept: number[] = [];
  const keep = createBarsKeep({ ask, sleep: async (ms) => { slept.push(ms); } });
  const got = await keep.histories(["SPY", "P1", "P2"], { fresh: ["SPY"] });
  assert.deepEqual(slept, [20_000]);
  assert.deepEqual([...got.read.keys()].sort(), ["P1", "SPY"]);
  assert.deepEqual([...got.refused], [["P2", "no service here"]]);
});

test("one wait serves every company the same hold refused, and no new read starts while it lasts", async () => {
  const market = fakeMarket({ SPY: { bars: MARKET }, P1: { bars: PAST }, P2: { bars: PAST }, P3: { bars: PAST }, P4: { bars: PAST }, P5: { bars: PAST }, P6: { bars: PAST } });
  let held = true;
  const asked: string[] = [];
  const ask = async (q: Record<string, string>) => {
    asked.push(q.symbol!);
    return held && (q.symbol === "P1" || q.symbol === "P2") ? { status: 409, body: { ok: false, ...refusal("E_VENUE_UNREACHABLE", "Nasdaq could not be reached") } } : market.ask(q);
  };
  const slept: number[] = [];
  let duringWait: string[] = ["never slept"];
  const keep = createBarsKeep({ ask, sleep: (ms) => {
    slept.push(ms);
    const before = asked.length;
    return new Promise<void>((done) => setTimeout(() => { duringWait = asked.slice(before); held = false; done(); }, 20));
  } });
  const got = await keep.histories(["SPY", "P1", "P2", "P3", "P4", "P5", "P6"], { fresh: ["SPY"] });
  assert.deepEqual(slept, [20_000]); // one wait, though two companies were refused
  assert.deepEqual(duringWait, [], "no read began while the hold was waited out");
  assert.deepEqual([got.read.size, got.refused.size], [7, 0]);
  assert.deepEqual([asked.filter((s) => s === "P1").length, asked.filter((s) => s === "P2").length], [2, 2], "both refused companies were asked once more");
  assert.deepEqual(asked.filter((s) => s === "P5" || s === "P6").sort(), ["P5", "P6"]);
});

test("past the deadline the unread companies are named, not waited for; the keep holds at most max histories", async () => {
  const market = fakeMarket({ SPY: { bars: MARKET }, P1: { bars: PAST }, P2: { bars: PAST } });
  let clock = 0;
  const keep = createBarsKeep({ ask: async (q) => { clock += 10; return market.ask(q); }, now: () => clock, max: 2 });
  const got = await keep.histories(["SPY", "P1", "P2"], { fresh: ["SPY"], deadlineMs: 5 }); // SPY's read takes the clock to 10
  assert.deepEqual([[...got.read.keys()], got.timedOut], [["SPY"], ["P1", "P2"]]);
  const full = await keep.histories(["SPY", "P1", "P2"], {});
  assert.equal(full.read.size, 3);
  const calls = market.calls.length;
  await keep.histories(["P2"], {});
  assert.equal(market.calls.length, calls, "the most recently read history is still kept");
  await keep.histories(["P1"], {});
  assert.equal(market.calls.length, calls + 1, "with max 2, P1 was dropped when P2 arrived, and is read again");
});
