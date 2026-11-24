import test from "node:test";
import assert from "node:assert/strict";
import { createPageRecord, pageKey } from "../plugins/analog/lib/pages.mjs";
import { LIMITS, normalizeEvents, scanEvents } from "../plugins/analog/lib/event-scan.mjs";
import { createBarsKeep } from "../plugins/analog/lib/bars.mjs";
import { AnalogError } from "../plugins/analog/lib/errors.mjs";
import { eventsDigest } from "../plugins/analog/lib/event-digest.mjs";
import { EVENT, EVENT_MARKET, LISTED, dateAt, fakeMarket, near } from "./analog-fixtures.ts";

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
  assert.deepEqual(got.events[0], { symbol: "EVT", label: "x", group: "hired", date: "2020-04-10", timing: "pre", source: A, verified: true, note: null, price: null, statedOpen: null, splits: null, splitsSource: null });
  assert.deepEqual(got.query, { symbol: "EVT", anchors: [{ label: "first report", date: "2020-04-10", timing: "open", source: null, verified: false, note: null, price: null, statedOpen: null, splits: null, splitsSource: null }] });
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
const refusedAs = (args: Record<string, unknown>, message: string) =>
  assert.throws(() => normalizeEvents({ title: "t", events: [ev()], ...args } as Parameters<typeof normalizeEvents>[0]),
    (e: unknown) => e instanceof AnalogError && e.code === "INVALID_EVENTS" && e.message === `INVALID_EVENTS ${message}`, message);
test("the call's choices are normalized", () => {
  const plain = normalizeEvents({ title: "t", events: [ev()] });
  assert.deepEqual([plain.base, plain.horizons, plain.benchmark], ["prior_close", [0, 1, 5, 20, 60], "SPY"]);
  const close = normalizeEvents({ title: "t", events: [ev()], base: "day0_close" });
  assert.deepEqual([close.base, close.horizons, close.benchmark], ["day0_close", [1, 5, 20, 60], "SPY"]);
  const chosen = normalizeEvents({ title: "t", events: [ev()], base: " day0_open ", horizons: [0, 250], benchmark: " qqq " });
  assert.deepEqual([chosen.base, chosen.horizons, chosen.benchmark], ["day0_open", [0, 250], "QQQ"]);
  for (const benchmark of ["none", "None", " NONE "]) assert.equal(normalizeEvents({ title: "t", events: [ev()], benchmark }).benchmark, null, benchmark);
  assert.deepEqual(normalizeEvents({ title: "t", events: [ev()], base: "day0_close", horizons: [1, 2, 3, 4, 5, 6] }).horizons, [1, 2, 3, 4, 5, 6]);
});
test("each bad choice is refused by name", () => {
  refusedAs({ base: "close" }, "base: one of prior_close, price, day0_open, day0_close");
  refusedAs({ base: 1 }, "base: one of prior_close, price, day0_open, day0_close");
  for (const horizons of [[], [0, 1, 2, 3, 4, 5, 6], [5, 5], [60, 5], [251], [-1], [1.5], "5", [Number.NaN]]) {
    refusedAs({ horizons }, "horizons: 1 to 6 whole numbers of sessions from 0 to 250, each larger than the one before");
  }
  refusedAs({ base: "day0_close", horizons: [0, 5] }, "horizons[0]: 0 is day 0's close itself under day0_close; start at 1");
  for (const benchmark of ["not a ticker", "", 7]) refusedAs({ benchmark }, "benchmark: a ticker like SPY or QQQ, or none");
  // the call's choices are checked before the events
  assert.throws(() => normalizeEvents({ title: "t", events: [], base: "close" }), invalid("base"));
});
test("a price's fields come only with base price", () => {
  for (const [field, value] of [["price", 83], ["stated_open", 83], ["splits", [{ date: "2015-03-19", new: 4, old: 1 }]], ["splits_source", "https://ex.com/s"]] as const) {
    refusedAs({ events: [ev({ [field]: value })] }, `events[0].${field}: only with base price`);
    refusedAs({ base: "day0_open", events: [ev({ [field]: value })] }, `events[0].${field}: only with base price`);
    refusedAs({ query: { symbol: "EVT", anchors: [{ label: "x", date: "2020-04-10", timing: "pre", [field]: value }] } }, `query.anchors[0].${field}: only with base price`);
  }
});
test("under base price a case states its price, and its splits with the page that lists them", () => {
  const p = (over: Record<string, unknown>, message: string) => refusedAs({ base: "price", events: [ev({ price: 44, ...over })] }, message);
  refusedAs({ base: "price", events: [ev()] }, "events[0].price: a positive price, as its source states it, under base price");
  for (const price of [0, -1, "83", Number.POSITIVE_INFINITY]) p({ price }, "events[0].price: a positive number");
  p({ stated_open: -1 }, "events[0].stated_open: a positive number");
  p({ stated_open: "56.5" }, "events[0].stated_open: a positive number");
  const S = "https://investor.visa.com/x";
  for (const splits of [[], "4:1", Array.from({ length: 21 }, () => ({ date: "2015-03-19", new: 4, old: 1 }))]) {
    p({ splits, splits_source: S }, "events[0].splits: a list of 1 to 20 splits, each {date, new, old}");
  }
  p({ splits: ["4:1"], splits_source: S }, "events[0].splits[0]: a split {date, new, old}");
  p({ splits: [{ date: "2015-02-30", new: 4, old: 1 }], splits_source: S }, "events[0].splits[0].date: a date YYYY-MM-DD");
  p({ splits: [{ date: "2015-03-19", new: 1.5, old: 1 }], splits_source: S }, "events[0].splits[0].new: a whole number above 0");
  p({ splits: [{ date: "2015-03-19", new: 4, old: 0 }], splits_source: S }, "events[0].splits[0].old: a whole number above 0");
  p({ splits: [{ date: "2015-03-19", new: 4, old: 1 }] }, "events[0].splits_source: the URL of the page that lists the splits, given with splits");
  p({ splits_source: S }, "events[0].splits: given with splits_source");
  p({ splits: [{ date: "2015-03-19", new: 4, old: 1 }], splits_source: "https://u:p@investor.visa.com/x" }, "events[0].splits_source: an http(s) URL without credentials, at most 500 characters");
  refusedAs({ base: "price", query: { symbol: "EVT", anchors: [{ label: "x", date: "2020-04-10", timing: "pre" }] }, events: [ev({ price: 44 })] }, "query.anchors[0].price: a positive price, as its source states it, under base price");

  const got = normalizeEvents({ title: "t", base: "price", events: [ev({ price: 44, stated_open: 56.5, splits: [{ date: " 2015-03-19 ", new: 4, old: 1 }], splits_source: ` ${S} ` })],
    query: { symbol: "EVT", anchors: [{ label: "x", date: "2020-04-10", timing: "pre", price: 7 }] } });
  assert.deepEqual(got.events[0], { symbol: "EVT", label: "CEO out", group: "hired", date: "2020-04-10", timing: "pre", source: A, verified: true, note: null,
    price: 44, statedOpen: 56.5, splits: [{ date: "2015-03-19", new: 4, old: 1 }], splitsSource: S });
  assert.deepEqual(got.query!.anchors[0], { label: "x", date: "2020-04-10", timing: "pre", source: null, verified: false, note: null, price: 7, statedOpen: null, splits: null, splitsSource: null });
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
  assert.deepEqual([view.kind, view.version, view.title, view.query], ["events", 2, "CEO scandals", null]);
  assert.deepEqual(view.cases.map((c) => [c.id, c.state]), [["ev-EVT-2020-04-10", "measured"], ["ev-EVT-2020-01-11", "measured"], ["ev-GONE-2018-07-27", "unmeasured"], ["ev-EVT-2020-06-19", "unmeasured"]]);
  const hit = view.cases[0]!;
  assert.equal(hit.day0, "2020-04-10"); near(hit.measure!.changes[0]!.x, 0.88 / 0.99 - 1); assert.equal(hit.tape!.vol0, 5); assert.equal(hit.window!.length, 91);
  assert.deepEqual(hit.measure!.changes.map((c) => c.k), [0, 1, 5, 20, 60]); // in the call's order: summaries read them by position
  assert.deepEqual([hit.claimed, hit.opened, hit.verified, hit.flags, hit.tapeRan, hit.relOf], [true, true, true, [], true, "benchmark"]);
  assert.deepEqual([hit.price, hit.statedOpen, hit.factor, hit.splits, hit.listed, hit.skipped], [null, null, null, null, false, 0]);
  const early = view.cases[1]!; // 10 sessions before day 0: measured from the close before it, with no volume check
  assert.deepEqual([early.day0, early.measure!.base, early.tapeRan, early.tape!.vol0], ["2020-01-11", 50, false, null]);
  assert.deepEqual(early.flags, ["unopened"]); // marked verified, its source never opened
  assert.deepEqual([early.claimed, early.opened, early.verified], [true, false, false]);
  assert.deepEqual(view.cases.slice(2).map((c) => c.words), [
    "Nasdaq keeps no daily bars of GONE",
    "no session after 2020-06-19 in its bars, which end 2020-06-19",
  ]);
  const c = view.coverage;
  assert.deepEqual([c.asked, c.measured, c.unmeasured.length, c.verified, c.unverified, c.unopened, c.noContext, c.skipped, c.listed], [4, 2, 2, 1, 3, 1, 0, 0, 0]);
  assert.deepEqual([c.companies, c.sources, c.adjustment, c.market, c.deadline], [{ asked: 2, read: 1 }, { Nasdaq: 1 }, ["Split-adjusted only"], { source: "Nasdaq · SPY", words: null, firstBar: "2020-01-01", short: false }, false]);
  assert.deepEqual(c.benchmark, { symbol: "SPY", source: "Nasdaq · SPY", words: null, firstBar: "2020-01-01", short: false });
  assert.deepEqual(view.groups.named.map((g) => [g.name, g.summary.n, g.summary.against, g.summary.at[0]!.median, g.paths]), [["hired", 2, "benchmark", null, null]]);
  const p = view.parameters as Record<string, unknown>;
  assert.deepEqual([p.base, p.horizons, p.benchmark, p.against, p.tieTolerance, p.calendarDays], ["prior_close", [0, 1, 5, 20, 60], "SPY", "benchmark", 0.02, 7]);
  assert.ok(!("minBefore" in p));
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
  near(view.query!.anchors[0]!.measure!.changes[0]!.x, 0.88 / 0.99 - 1);
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
test("without the market's own bars the raw changes stay and everything is summarized raw", async () => {
  const view = await scanEvents({ title: "t", events: Array.from({ length: 8 }, (_, i) => ev({ date: dateAt(92 + i) })), keep: keepOf(fakeMarket({ EVT: { bars: EVENT } })) });
  assert.equal(view.coverage.measured, 8); assert.equal(view.coverage.noContext, 8);
  assert.deepEqual(view.coverage.market, { source: null, words: "Nasdaq keeps no daily bars of SPY", firstBar: null, short: false });
  assert.deepEqual(view.coverage.benchmark, { symbol: "SPY", source: null, words: "Nasdaq keeps no daily bars of SPY", firstBar: null, short: false });
  assert.equal(view.parameters.against, "raw");
  assert.ok(view.cases.every((c) => c.measure!.changes.every((ch) => ch.x === null) && typeof c.measure!.changes[0]!.r === "number" && c.relOf === "self" && c.rel!.find(([k]) => k === -1)![1] === 100));
  assert.deepEqual([view.groups.all.n, view.groups.all.against, view.groups.all.at[0]!.n, view.groups.all.at[0]!.median], [8, "raw", 8, 0]);
  assert.equal(view.groups.named[0]!.paths!.median.length, 61); // day 0 to the last horizon, 60
});
test("a group's path runs only to the last horizon", async () => {
  const view = await scanEvents({ title: "t", horizons: [0, 5], events: Array.from({ length: 8 }, (_, i) => ev({ date: dateAt(92 + i) })), keep: keepOf() });
  assert.equal(view.cases[0]!.rel!.at(-1)![0], 60); // rel runs to the larger of 60 and the last horizon
  const paths = view.groups.named[0]!.paths!;
  assert.deepEqual([paths.median.length, paths.q1.length, paths.q3.length], [6, 6, 6]);
});
test("a listing under base price, tied with no split", async () => {
  const S = "https://ir.example.com/splits";
  const listing = (over: Record<string, unknown>, opened: (u: string) => boolean = () => false) => scanEvents({
    title: "t", base: "price", keep: keepOf(fakeMarket({ IPO: { bars: LISTED }, SPY: { bars: EVENT_MARKET } })), opened,
    events: [ev({ symbol: "IPO", date: "2020-04-10", timing: "open", ...over })],
  }).then((v) => v.cases[0]!);
  const plain = await listing({ price: 40, stated_open: 45 });
  assert.deepEqual([plain.state, plain.factor, plain.splits, plain.listed, plain.price, plain.statedOpen, plain.tapeRan], ["measured", 1, null, true, 40, 45, false]);
  assert.equal(plain.measure!.changes[0]!.k, 0); near(plain.measure!.changes[0]!.r, 44 / 40 - 1);
  near(plain.measure!.changes[0]!.x, (44 / 40) / (396 / 400) - 1); // SPY's base: its close on the last bar before day 0

  const split = { price: 160, stated_open: 180, splits: [{ date: "2020-05-01", new: 4, old: 1 }], splits_source: S };
  const tied = await listing(split, (u) => u === S || u === A);
  assert.deepEqual([tied.state, tied.factor, tied.flags], ["measured", 4, []]);
  assert.deepEqual(tied.splits, { list: [{ date: "2020-05-01", new: 4, old: 1 }], factor: 4, source: S, opened: true, verified: true });
  near(tied.measure!.changes[0]!.r, 44 / 40 - 1);

  const unopened = await listing(split, (u) => u === A);
  assert.deepEqual([unopened.state, unopened.flags], ["measured", ["splitsUnopened"]]);
  assert.deepEqual([unopened.splits!.opened, unopened.splits!.verified], [false, false]);

  const untied = await listing({ price: 160, stated_open: 180 });
  assert.deepEqual([untied.state, untied.words, untied.measure], ["unmeasured", "its bars are adjusted about ×4 since day 0 (its source's open 180.00, the bars' 45.00): a split record is needed", null]);

  // a record whose splits are all on or before day 0 divides the price by nothing: no split stored, no flag
  const before = await listing({ price: 40, stated_open: 45, splits: [{ date: "2019-01-02", new: 2, old: 1 }, { date: "2020-04-10", new: 3, old: 1 }], splits_source: S }, (u) => u === A);
  assert.deepEqual([before.state, before.factor, before.splits, before.flags, before.verified], ["measured", 1, null, [], true]);
});
test("prior_close on a listing is unmeasured with its words; day0_close measures it", async () => {
  const scan = (base?: string) => scanEvents({
    title: "t", base, keep: keepOf(fakeMarket({ IPO: { bars: LISTED }, SPY: { bars: EVENT_MARKET } })),
    events: [ev({ symbol: "IPO", date: "2020-04-10", timing: "open" })],
  }).then((v) => v.cases[0]!);
  const prior = await scan();
  assert.deepEqual([prior.state, prior.words], ["unmeasured", "day 0 is its first bar (2020-04-10): there is no close before it; measure a listing from its price, day 0's open or day 0's close"]);
  const close = await scan("day0_close");
  assert.deepEqual([close.state, close.listed, close.measure!.changes.map((c) => c.k)], ["measured", true, [1, 5, 20, 60]]);
  near(close.measure!.changes[0]!.r, 42 / 44 - 1);
});
test("a news event three sessions after a listing is measured from the close before it, with no volume check", async () => {
  const view = await scanEvents({
    title: "t", base: "prior_close", keep: keepOf(fakeMarket({ IPO: { bars: LISTED }, SPY: { bars: EVENT_MARKET } })),
    events: [ev({ symbol: "IPO", date: "2020-04-13", timing: "pre" })],
  });
  const c = view.cases[0]!;
  assert.deepEqual([c.state, c.day0, c.measure!.base, c.tapeRan, c.listed, c.skipped], ["measured", "2020-04-13", 43, false, false, 0]);
});
test("a halt is measured and flagged", async () => {
  const halted = EVENT.filter((_, i) => i < 101 || i > 110);
  const view = await scanEvents({ title: "t", events: [ev({ date: "2020-04-11" })], keep: keepOf(fakeMarket({ EVT: { bars: halted }, SPY: { bars: EVENT_MARKET } })) });
  const c = view.cases[0]!;
  assert.deepEqual([c.state, c.day0, c.skipped, c.listed, c.measure!.base], ["measured", dateAt(111), 10, false, 44]);
  assert.ok(c.flags.includes("skipped"));
  assert.equal(view.coverage.skipped, 1);
});
test("another benchmark is read fresh beside SPY", async () => {
  const m = fakeMarket({ EVT: { bars: EVENT }, SPY: { bars: EVENT_MARKET }, QQQ: { bars: EVENT_MARKET } });
  const keep = createBarsKeep({ ask: m.ask });
  await keep.histories(["EVT", "SPY", "QQQ"]);
  const before = m.calls.length;
  const view = await scanEvents({ title: "t", events: [ev()], benchmark: "QQQ", keep });
  assert.deepEqual([...new Set(m.calls.slice(before).map((q) => q.symbol))].sort(), ["QQQ", "SPY"]);
  assert.deepEqual(view.coverage.benchmark, { symbol: "QQQ", source: "Nasdaq · QQQ", words: null, firstBar: "2020-01-01", short: false });
  assert.deepEqual([view.parameters.benchmark, view.parameters.against], ["QQQ", "benchmark"]);
  near(view.cases[0]!.measure!.changes[0]!.x, 0.88 / 0.99 - 1);
});
test("a benchmark the market refuses leaves the view raw", async () => {
  const view = await scanEvents({ title: "t", benchmark: "QQQ", events: Array.from({ length: 8 }, (_, i) => ev({ date: dateAt(92 + i) })), keep: keepOf() });
  assert.equal(view.parameters.against, "raw");
  assert.equal(view.coverage.benchmark.words, "Nasdaq keeps no daily bars of QQQ");
  assert.equal(view.coverage.benchmark.symbol, "QQQ");
  assert.ok(view.cases.every((c) => c.measure!.changes.every((ch) => ch.x === null) && c.relOf === "self"));
  assert.deepEqual([view.groups.all.against, view.groups.all.at[0]!.median], ["raw", 0]);
  assert.equal(view.coverage.noContext, 8);
});
test("benchmark none measures raw and draws the stock's own path", async () => {
  const view = await scanEvents({ title: "t", benchmark: "none", events: [ev()], keep: keepOf() });
  assert.deepEqual([view.parameters.benchmark, view.parameters.against], [null, "raw"]);
  assert.deepEqual(view.coverage.benchmark, { symbol: null, source: null, words: null, firstBar: null, short: false });
  const c = view.cases[0]!;
  assert.deepEqual([c.state, c.relOf, c.measure!.changes[0]!.x], ["measured", "self", null]);
  near(c.measure!.changes[0]!.r, 44 / 50 - 1);
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
test("an anchor's source is checked against the page record like an event's", async () => {
  const anchors = [
    { label: "first report", date: "2020-04-10", timing: "pre", source: "https://ex.com/a", verified: true },
    { label: "admission", date: "2020-04-10", timing: "open", source: "https://ex.com/b", verified: true },
    { label: "no source", date: "2020-04-10", timing: "pre" },
  ];
  const view = await scanEvents({ title: "t", events: [ev()], query: { symbol: "EVT", anchors }, keep: keepOf(), opened: (u) => u === "https://ex.com/a" });
  const [a, b, c] = view.query!.anchors;
  assert.deepEqual([a!.source, a!.claimed, a!.opened, a!.verified, a!.flags.includes("unopened")], ["https://ex.com/a", true, true, true, false]);
  assert.deepEqual([b!.source, b!.claimed, b!.opened, b!.verified, b!.flags.includes("unopened")], ["https://ex.com/b", true, false, false, true]);
  assert.deepEqual([c!.source, c!.claimed, c!.opened, c!.verified, c!.note, c!.flags], [null, false, false, false, null, []]);
  assert.equal(a!.state, "measured");
  assert.equal(view.coverage.unopened, 1, "the coverage counts the cases, not the anchors");
});
test("an anchor's note is one line and bounded like an event's", () => {
  const q = (note: unknown) => ({ symbol: "EVT", anchors: [{ label: "x", date: "2020-04-10", timing: "pre", note }] });
  assert.equal(normalizeEvents({ title: "t", events: [ev()], query: q("one\r\ntwo") }).query!.anchors[0]!.note, "one two");
  assert.equal(normalizeEvents({ title: "t", events: [ev()], query: q("  ") }).query!.anchors[0]!.note, null);
  assert.throws(() => normalizeEvents({ title: "t", events: [ev()], query: q("x".repeat(LIMITS.note + 1)) }), invalid("query.anchors[0].note"));
  assert.throws(() => normalizeEvents({ title: "t", events: [ev()], query: q(7) }), invalid("query.anchors[0].note"));
});
test("an anchor's source must be http(s) without credentials", () => {
  const q = (over: object) => ({ symbol: "EVT", anchors: [{ label: "x", date: "2020-04-10", timing: "pre", ...over }] });
  for (const source of ["ftp://x", "https://u:p@x"]) {
    assert.throws(() => normalizeEvents({ title: "t", events: [ev()], query: q({ source }) }), invalid("query.anchors[0].source"), source);
  }
  assert.throws(() => normalizeEvents({ title: "t", events: [ev()], query: q({ verified: "yes" }) }), invalid("query.anchors[0].verified"));
});
