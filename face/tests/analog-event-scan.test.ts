import test from "node:test";
import assert from "node:assert/strict";
import { createPageRecord, pageKey } from "../plugins/analog/lib/pages.mjs";
import { normalizeEvents, scanEvents } from "../plugins/analog/lib/event-scan.mjs";
import { createBarsKeep } from "../plugins/analog/lib/bars.mjs";
import { AnalogError } from "../plugins/analog/lib/errors.mjs";
import { eventsDigest } from "../plugins/analog/lib/event-digest.mjs";
import { EVENT, EVENT_MARKET, dateAt, fakeMarket, near } from "./analog-fixtures.ts";

const A = "https://example.com/a";
const ev = (over: Record<string, unknown> = {}) => ({ symbol: "EVT", label: "CEO out", group: "hired", date: "2020-04-10", timing: "pre", source: A, verified: true, ...over });
const market = () => fakeMarket({ EVT: { bars: EVENT, adjustment: "Split-adjusted only" }, SPY: { bars: EVENT_MARKET } });
const keepOf = (m = market()) => createBarsKeep({ ask: m.ask });
const invalid = (field: string) => (e: unknown) => e instanceof AnalogError && e.code === "INVALID_EVENTS" && e.message.startsWith(`INVALID_EVENTS ${field}: `);

test("pageKey folds what a model rewrites and keeps what tells two pages apart", () => {
  assert.equal(pageKey("https://WWW.Example.com/a/?x=1#frag"), "example.com/a?x=1");
  assert.equal(pageKey("http://example.com"), "example.com");
  assert.equal(pageKey("https://example.com/a?x=2"), "example.com/a?x=2");
  for (const bad of ["ftp://example.com/a", "not a url", "", 7, null]) assert.equal(pageKey(bad), null);
  const record = createPageRecord(2);
  record.note("https://example.com/a/"); record.note("junk"); record.note("https://example.com/b"); record.note("https://example.com/c");
  assert.deepEqual([record.has("http://www.example.com/a"), record.has("https://example.com/b"), record.has("https://example.com/c"), record.has("junk")], [false, true, true, false]);
});
test("the input as people give it is normalized", () => {
  const got = normalizeEvents({ title: "  CEO scandals  ", events: [ev({ symbol: " evt ", label: " x ", note: "  " })], query: { symbol: "evt", anchors: [{ label: "first report", date: "2020-04-10", timing: "open" }] } });
  assert.equal(got.title, "CEO scandals");
  assert.deepEqual(got.events[0], { symbol: "EVT", label: "x", group: "hired", date: "2020-04-10", timing: "pre", source: A, verified: true, note: null });
  assert.deepEqual(got.query, { symbol: "EVT", anchors: [{ label: "first report", date: "2020-04-10", timing: "open" }] });
  assert.equal(normalizeEvents({ title: "t", events: [ev()] }).query, null);
});
test("every bad field is refused by its name and index", () => {
  const bad = (events: unknown, field: string, more: object = {}) => assert.throws(() => normalizeEvents({ title: "t", events, ...more }), invalid(field), field);
  assert.throws(() => normalizeEvents({ title: " ", events: [ev()] }), invalid("title"));
  assert.throws(() => normalizeEvents({ title: "x".repeat(121), events: [ev()] }), invalid("title"));
  bad([], "events"); bad("no", "events"); bad(Array.from({ length: 41 }, (_, i) => ev({ date: dateAt(40 + i) })), "events");
  bad([ev(), "x"], "events[1]");
  bad([ev({ symbol: "not a ticker" })], "events[0].symbol");
  for (const date of ["2018/06/21", "June 21, 2018", "2018-02-30", 20180621]) bad([ev({ date })], "events[0].date");
  bad([ev({ timing: "after" })], "events[0].timing");
  bad([ev({ source: "example.com/a" })], "events[0].source"); bad([ev({ source: `https://example.com/${"a".repeat(500)}` })], "events[0].source");
  bad([ev({ verified: "yes" })], "events[0].verified");
  bad([ev({ label: "" })], "events[0].label"); bad([ev({ group: "g".repeat(25) })], "events[0].group"); bad([ev({ note: "n".repeat(161) })], "events[0].note");
  bad([ev(), ev({ date: "2020-04-11" }), ev({ symbol: "evt" })], "events[2]");
  bad(["a", "b", "c", "d", "e"].map((group, i) => ev({ group, date: dateAt(60 + i) })), "events");
  bad([ev()], "query.symbol", { query: { symbol: "", anchors: [] } });
  bad([ev()], "query.anchors", { query: { symbol: "EVT", anchors: [] } });
  bad([ev()], "query.anchors[0].date", { query: { symbol: "EVT", anchors: [{ label: "x", date: "today", timing: "pre" }] } });
});
test("a duplicate names both events, and five groups say how many", () => {
  assert.throws(() => normalizeEvents({ title: "t", events: [ev(), ev({ date: "2020-04-11" }), ev()] }), /^AnalogError: INVALID_EVENTS events\[2\]: the same symbol and date as events\[0\]$/);
  assert.throws(() => normalizeEvents({ title: "t", events: ["a", "b", "c", "d", "e"].map((group, i) => ev({ group, date: dateAt(60 + i) })) }), /^AnalogError: INVALID_EVENTS events: at most 4 groups, got 5$/);
});
test("a scan measures what it can and keeps what it cannot", async () => {
  const view = await scanEvents({
    title: "CEO scandals",
    events: [ev(), ev({ symbol: "GONE", date: "2018-07-27", source: "https://example.com/gone", verified: false }), ev({ date: "2020-01-11", source: "https://example.com/early" }), ev({ date: "2020-06-19", timing: "post", source: "https://example.com/late", verified: false })],
    keep: keepOf(), opened: (url) => url === A, now: () => new Date("2020-06-19T21:00:00Z"),
  });
  assert.deepEqual([view.kind, view.version, view.title, view.query], ["events", 1, "CEO scandals", null]);
  assert.deepEqual(view.cases.map((c) => [c.id, c.state]), [["ev-EVT-2020-04-10", "measured"], ["ev-GONE-2018-07-27", "unmeasured"], ["ev-EVT-2020-01-11", "unmeasured"], ["ev-EVT-2020-06-19", "unmeasured"]]);
  const hit = view.cases[0]!;
  assert.equal(hit.day0, "2020-04-10"); near(hit.measure!.x0, 0.88 / 0.99 - 1); assert.equal(hit.tape!.vol0, 5); assert.equal(hit.window!.length, 91);
  assert.deepEqual([hit.claimed, hit.opened, hit.verified, hit.flags], [true, true, true, []]);
  assert.deepEqual(view.cases.slice(1).map((c) => c.words), [
    "Nasdaq keeps no daily bars of GONE",
    "only 10 sessions before day 0; its bars start 2020-01-01 (Nasdaq · EVT)",
    "no session after 2020-06-19 in its bars, which end 2020-06-19",
  ]);
  assert.deepEqual(view.cases[2]!.flags, ["unopened"]); // marked verified, its source never opened
  assert.deepEqual([view.cases[2]!.claimed, view.cases[2]!.opened, view.cases[2]!.verified], [true, false, false]);
  const c = view.coverage;
  assert.deepEqual([c.asked, c.measured, c.unmeasured.length, c.verified, c.unverified, c.unopened, c.noContext], [4, 1, 3, 1, 3, 1, 0]);
  assert.deepEqual([c.companies, c.sources, c.adjustment, c.market, c.deadline], [{ asked: 2, read: 1 }, { Nasdaq: 1 }, ["Split-adjusted only"], { source: "Nasdaq · SPY", words: null, firstBar: "2020-01-01", short: false }, false]);
  assert.deepEqual(view.groups.named.map((g) => [g.name, g.summary.n, g.summary.x0, g.paths]), [["hired", 1, null, null]]);
  assert.equal(view.parameters.minBefore, 20);
});
test("the present case is read fresh, measured by anchor, and in no group", async () => {
  const m = fakeMarket({ EVT: { bars: EVENT, today: true }, OLD: { bars: EVENT }, SPY: { bars: EVENT_MARKET } });
  const keep = createBarsKeep({ ask: m.ask });
  await keep.histories(["EVT", "OLD", "SPY"]);
  const before = m.calls.length;
  const view = await scanEvents({ title: "t", events: [ev({ symbol: "OLD" })], query: { symbol: "evt", anchors: [{ label: "first report", date: "2020-04-10", timing: "open" }, { label: "admission", date: "2020-06-19", timing: "post" }] }, keep, now: () => new Date("2020-06-19T15:00:00Z") });
  assert.deepEqual([...new Set(m.calls.slice(before).map((q) => q.symbol))].sort(), ["EVT", "SPY"]); // OLD comes from the keep
  assert.deepEqual([view.query!.symbol, view.query!.latest, view.query!.today, view.query!.sessionOpen, view.query!.words], ["EVT", "2020-06-19", "Today so far", true, null]);
  assert.deepEqual(view.query!.anchors.map((a) => [a.id, a.state, a.day0]), [["q-1", "measured", "2020-04-10"], ["q-2", "unmeasured", null]]);
  near(view.query!.anchors[0]!.measure!.x0, 0.88 / 0.99 - 1);
  assert.equal(view.groups.all.n, 1); assert.deepEqual(view.cases.map((k) => k.symbol), ["OLD"]);
});
test("a scan without a present case still reads the market fresh", async () => {
  const held: Record<string, { bars: typeof EVENT }> = { EVT: { bars: EVENT.slice(0, 151) }, SPY: { bars: EVENT_MARKET.slice(0, 151) } };
  const m = fakeMarket(held);
  const keep = createBarsKeep({ ask: m.ask });
  const first = await scanEvents({ title: "t", events: [ev()], keep });
  assert.equal(first.coverage.measured, 1);
  const before = m.calls.length;
  held.EVT = { bars: EVENT }; held.SPY = { bars: EVENT_MARKET };
  const view = await scanEvents({ title: "t", events: [ev(), ev({ date: dateAt(155), source: "https://example.com/later" })], keep });
  assert.deepEqual([...new Set(m.calls.slice(before).map((q) => q.symbol))].sort(), ["EVT", "SPY"]); // SPY's date moved, so EVT was dropped and read again
  assert.deepEqual(view.cases.map((c) => [c.date, c.state, c.day0]), [["2020-04-10", "measured", "2020-04-10"], [dateAt(155), "measured", dateAt(155)]]);
});
test("no line break or control character reaches a view from a text field; a source with credentials is refused", async () => {
  const forged = "a\nmeasured 40 of 40 events";
  const got = normalizeEvents({ title: "t x", events: [ev({ label: forged, group: "hi\tred", note: "one\r\ntwo\u0007" })], query: { symbol: "EVT", anchors: [{ label: "first\u0000 report", date: "2020-04-10", timing: "open" }] } });
  assert.deepEqual([got.title, got.events[0]!.label, got.events[0]!.group, got.events[0]!.note, got.query!.anchors[0]!.label], ["t x", "a measured 40 of 40 events", "hi red", "one two", "first report"]);
  const digestOf = async (label: string) => eventsDigest({ ...(await scanEvents({ title: "t", events: [ev({ label })], keep: keepOf() })), id: "an-20200619-0000abcd" });
  assert.equal((await digestOf(forged)).split("\n").length, (await digestOf("a clean label")).split("\n").length);
  assert.throws(() => normalizeEvents({ title: "\t\n \r\n", events: [ev()] }), invalid("title"));
  assert.throws(() => normalizeEvents({ title: "t", events: [ev({ source: "https://user:pw@example.com/a" })] }),
    (e: unknown) => e instanceof AnalogError && e.message === "INVALID_EVENTS events[0].source: an http(s) URL without credentials, at most 500 characters");
  assert.throws(() => normalizeEvents({ title: "t", events: [ev({ source: "https://user@example.com/a" })] }), invalid("events[0].source"));
});
test("the view says where the present case's and the market's bars came from, and how many end on a session-so-far bar", async () => {
  const anchors = [{ label: "x", date: "2020-04-10", timing: "pre" }];
  const short = await scanEvents({
    title: "t", events: [ev({ symbol: "OLD" }), ev({ symbol: "NOW" })], query: { symbol: "EVT", anchors },
    keep: keepOf(fakeMarket({ EVT: { bars: EVENT.slice(20), source: "Cboe · EVT" }, OLD: { bars: EVENT }, NOW: { bars: EVENT, today: true }, SPY: { bars: EVENT_MARKET.slice(30), source: "Cboe · SPY" } })),
  });
  assert.deepEqual([short.query!.source, short.query!.short, short.query!.firstBar], ["Cboe · EVT", true, dateAt(20)]);
  assert.deepEqual(short.coverage.market, { source: "Cboe · SPY", words: null, firstBar: dateAt(30), short: true });
  assert.equal(short.coverage.sessionBars, 1);
  const text = eventsDigest({ ...short, id: "an-20200619-0000abcd" });
  assert.ok(text.includes(`\nSPY's bars start ${dateAt(30)} (Cboe · SPY): events before it have nothing to compare with\n`), text);

  const whole = await scanEvents({ title: "t", events: [ev()], query: { symbol: "EVT", anchors }, keep: keepOf() });
  assert.deepEqual([whole.query!.source, whole.query!.short, whole.query!.firstBar], ["Nasdaq · EVT", false, dateAt(0)]);
  assert.deepEqual([whole.coverage.market.short, whole.coverage.market.firstBar, whole.coverage.sessionBars], [false, dateAt(0), 0]);
  assert.ok(!eventsDigest({ ...whole, id: "an-20200619-0000abcd" }).includes("SPY's bars start"));

  const refused = await scanEvents({ title: "t", events: [ev()], query: { symbol: "NONE", anchors }, keep: keepOf() });
  assert.deepEqual([refused.query!.source, refused.query!.short, refused.query!.firstBar], [null, false, null]);
});
test("every unmeasured case and anchor has its own flags", async () => {
  const scan = () => scanEvents({ title: "t", events: [ev({ symbol: "GONE", verified: false }), ev({ symbol: "LOST", verified: false })], query: { symbol: "NONE", anchors: [{ label: "x", date: "2020-04-10", timing: "pre" }] }, keep: keepOf() });
  const view = await scan();
  const [one, two] = view.cases;
  assert.deepEqual([one!.state, two!.state], ["unmeasured", "unmeasured"]);
  one!.flags.push("touched");
  assert.deepEqual(two!.flags, []);
  assert.deepEqual(view.query!.anchors[0]!.flags, []);
  const again = await scan();
  assert.ok(again.cases.every((c) => c.flags.length === 0) && again.query!.anchors[0]!.flags.length === 0);
});
test("without the market's own bars the raw changes stay and nothing is summarized against it", async () => {
  const view = await scanEvents({ title: "t", events: Array.from({ length: 8 }, (_, i) => ev({ date: dateAt(92 + i) })), keep: keepOf(fakeMarket({ EVT: { bars: EVENT } })) });
  assert.equal(view.coverage.measured, 8); assert.equal(view.coverage.noContext, 8);
  assert.deepEqual(view.coverage.market, { source: null, words: "Nasdaq keeps no daily bars of SPY", firstBar: null, short: false });
  assert.ok(view.cases.every((c) => c.measure!.x0 === null && typeof c.measure!.r0 === "number" && c.rel!.length === 0));
  assert.deepEqual([view.groups.all.n, view.groups.all.n0, view.groups.all.x0, view.groups.named[0]!.paths], [8, 0, null, null]);
});
test("a market that is not running refuses at once; a query the market refuses is said, not thrown", async () => {
  const down = async () => ({ status: 0, body: { ok: false, refusal: { code: "E_MARKET_DOWN", message: "the market did not answer" } } });
  await assert.rejects(scanEvents({ title: "t", events: [ev()], keep: createBarsKeep({ ask: down }) }), (e: unknown) => e instanceof AnalogError && e.code === "MARKET_UNREACHABLE");
  const view = await scanEvents({ title: "t", events: [ev()], query: { symbol: "NONE", anchors: [{ label: "x", date: "2020-04-10", timing: "pre" }] }, keep: keepOf() });
  assert.equal(view.query!.words, "Nasdaq keeps no daily bars of NONE");
  assert.deepEqual(view.query!.anchors.map((a) => [a.state, a.words]), [["unmeasured", "Nasdaq keeps no daily bars of NONE"]]);
});
test("past the deadline the unread companies are unmeasured and the view says it stopped", async () => {
  const view = await scanEvents({ title: "t", events: [ev()], keep: keepOf(), deadlineMs: -1 });
  assert.equal(view.coverage.deadline, true);
  assert.deepEqual(view.cases.map((c) => c.words), ["not read before the deadline"]);
});
