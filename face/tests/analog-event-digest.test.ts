import test from "node:test";
import assert from "node:assert/strict";
import { scanEvents } from "../plugins/analog/lib/event-scan.mjs";
import { EVENT_SENTENCES, PRICE_SENTENCE, eventsDigest } from "../plugins/analog/lib/event-digest.mjs";
import { createBarsKeep } from "../plugins/analog/lib/bars.mjs";
import { AnalogError } from "../plugins/analog/lib/errors.mjs";
import { EVENT, EVENT_MARKET, LISTED, dateAt, fakeMarket } from "./analog-fixtures.ts";

const A = "https://example.com/a";
const ID = "an-20200619-0000abcd";
const ev = (over: Record<string, unknown> = {}) => ({ symbol: "EVT", label: "CEO out", group: "hired", date: "2020-04-10", timing: "pre", source: A, verified: true, ...over });
const market = () => fakeMarket({ EVT: { bars: EVENT, adjustment: "Split-adjusted only" }, SPY: { bars: EVENT_MARKET } });
const keepOf = (m = market()) => createBarsKeep({ ask: m.ask });

test("the first lines carry coverage, the title and the present case", async () => {
  const view = await scanEvents({
    title: "CEO scandals",
    events: [ev(), ev({ symbol: "GONE", date: "2018-07-27", source: "https://example.com/gone", verified: false }), ev({ date: "2020-01-11", source: "https://example.com/early" }), ev({ date: "2020-06-19", timing: "post", source: "https://example.com/late", verified: false })],
    keep: keepOf(), opened: (url) => url === A, now: () => new Date("2020-06-19T21:00:00Z"),
  });
  const before = JSON.stringify(view);
  const text = eventsDigest({ ...view, id: ID });
  // 2020-01-11 is measured now: day 0 needs no 20 sessions before it, only the close before it (Task 6)
  assert.ok(text.startsWith(`measured 2 of 4 events (2 unmeasured) · 1 verified, 3 unverified, 1 marked verified without an opened source · view ${ID}\nCEO scandals\n`), text);
  assert.ok(text.includes("hired  2  too few to summarize"), text);
  assert.equal(text.split("\n")[2], "measured from the close before day 0, against SPY: day 0 +1 +5 +20 +60");
  assert.ok(text.includes("\nhired: EVT 2020-04-10 CEO out day 0 −11.1%; +1 −16.0%; +5 −8.0%; +20 −8.0%; +60 −5.9%\n"), text);
  assert.ok(text.includes("unmeasured: GONE 2018-07-27 (Nasdaq keeps no daily bars of GONE); "), text);
  assert.ok(text.endsWith(EVENT_SENTENCES), text);
  assert.equal(JSON.stringify(view), before); // the view is left as it was
});

test("an anchor's line", async () => {
  const m = fakeMarket({ EVT: { bars: EVENT, today: true }, OLD: { bars: EVENT }, SPY: { bars: EVENT_MARKET } });
  const view = await scanEvents({ title: "t", events: [ev({ symbol: "OLD" })], query: { symbol: "evt", anchors: [{ label: "first report", date: "2020-04-10", timing: "open" }, { label: "admission", date: "2020-06-19", timing: "post" }] }, keep: createBarsKeep({ ask: m.ask }), now: () => new Date("2020-06-19T15:00:00Z") });
  const lines = eventsDigest({ ...view, id: ID }).split("\n");
  assert.ok(lines.includes("EVT first report 2020-04-10 open → day 0 2020-04-10: day 0 −11.1%; +1 −16.0%; +5 −8.0%; +20 −8.0%; +60 −5.9%; gap −10.0%; volume 5.0×; 70 sessions since"), lines.join("\n"));
  assert.ok(lines.includes("EVT admission 2020-06-19 post: unmeasured (no session after 2020-06-19 in its bars, which end 2020-06-19)"), lines.join("\n"));
});

test("the header and a group row follow the horizons", async () => {
  const view = await scanEvents({ title: "t", events: Array.from({ length: 8 }, (_, i) => ev({ date: dateAt(92 + i) })), keep: keepOf() });
  const lines = eventsDigest({ ...view, id: ID }).split("\n");
  assert.ok(lines.includes("group  n  day 0  +1  +5  +20  +60  [+60 quartiles]  below 0 at day 0  at +60"), lines.join("\n"));
  const row = lines.find((l) => l.startsWith("hired  "));
  assert.ok(row !== undefined);
  const fields = row.split("  ");
  assert.equal(fields.length, 2 + 5 + 1 + 2, row); // the name and n, one per horizon, the quartiles, two shares
  assert.equal(fields[2], "0.0%");
  assert.match(fields[7]!, /^\[.+ … .+\]$/);
  assert.deepEqual(fields.slice(-2), ["0%", "100%"]);

  const other = await scanEvents({ title: "t", horizons: [0, 5, 20, 60, 120, 250], events: Array.from({ length: 8 }, (_, i) => ev({ date: dateAt(92 + i) })), keep: keepOf() });
  const otherLines = eventsDigest({ ...other, id: ID }).split("\n");
  assert.ok(otherLines.includes("group  n  day 0  +5  +20  +60  +120  +250  [+250 quartiles]  below 0 at day 0  at +250"), otherLines.join("\n"));
  assert.equal(otherLines.find((l) => l.startsWith("hired  "))!.split("  ").length, 2 + 6 + 1 + 2);
});

test("the measurement line names the base, the benchmark and the horizons", async () => {
  const third = async (args: Record<string, unknown>, events = [ev()]) =>
    eventsDigest({ ...(await scanEvents({ title: "t", events, keep: keepOf(), ...args })), id: ID }).split("\n")[2];
  assert.equal(await third({}), "measured from the close before day 0, against SPY: day 0 +1 +5 +20 +60");
  assert.equal(await third({ base: "price", horizons: [0, 5, 20, 60, 120, 250] }, [ev({ price: 50, stated_open: 45 })]),
    "measured from each case's price, against SPY: day 0 +5 +20 +60 +120 +250");
  assert.equal(await third({ base: "day0_open" }), "measured from day 0's open (the benchmark from its 09:30 open), against SPY: day 0 +1 +5 +20 +60");
  assert.equal(await third({ base: "day0_close" }), "measured from day 0's close, against SPY: +1 +5 +20 +60");
  const closed = eventsDigest({ ...(await scanEvents({ title: "t", base: "day0_close", events: [ev()], keep: keepOf() })), id: ID });
  assert.ok(closed.includes("\ncases, by group, the most negative +1 first:\n"), closed);
  assert.equal(await third({ benchmark: "none" }), "measured from the close before day 0, raw, no benchmark: day 0 +1 +5 +20 +60");
  assert.equal(await third({ benchmark: "QQQ" }), "measured from the close before day 0, raw: QQQ could not be read (Nasdaq keeps no daily bars of QQQ): day 0 +1 +5 +20 +60");
});

test("a case line has one figure per horizon and says what is special", async () => {
  const S = "https://ir.example.com/splits";
  const listing = (opened: (u: string) => boolean) => scanEvents({
    title: "t", base: "price", keep: keepOf(fakeMarket({ IPO: { bars: LISTED }, SPY: { bars: EVENT_MARKET } })), opened,
    events: [ev({ symbol: "IPO", date: "2020-04-10", timing: "open", price: 160, stated_open: 180, splits: [{ date: "2020-05-01", new: 4, old: 1 }], splits_source: S })],
  }).then((v) => eventsDigest({ ...v, id: ID }).split("\n").find((l) => l.startsWith("hired: IPO "))!);
  const tied = await listing((u) => u === S || u === A);
  // a listing day has no volume check to make: the line does not say it twice
  assert.ok(tied.endsWith(" · price 160 · split ×4 · listing day"), tied);
  assert.ok(tied.startsWith("hired: IPO 2020-04-10 CEO out day 0 "), tied);
  const unopened = await listing((u) => u === A);
  assert.ok(unopened.endsWith(" · price 160 · split ×4 · listing day · split record not opened"), unopened);

  const halted = EVENT.filter((_, i) => i < 101 || i > 110);
  const view = await scanEvents({ title: "t", events: [ev({ date: "2020-04-11" })], opened: (u) => u === A, keep: keepOf(fakeMarket({ EVT: { bars: halted }, SPY: { bars: EVENT_MARKET } })) });
  const line = eventsDigest({ ...view, id: ID }).split("\n").find((l) => l.startsWith("hired: EVT "))!;
  assert.ok(line.includes(" · skipped 10 sessions · quiet · elsewhere"), line);
});

test("under no benchmark, day 0's open says nothing of the benchmark's open", async () => {
  const text = eventsDigest({ ...(await scanEvents({ title: "t", base: "day0_open", benchmark: "none", events: [ev()], keep: keepOf() })), id: ID });
  assert.equal(text.split("\n")[2], "measured from day 0's open, raw, no benchmark: day 0 +1 +5 +20 +60");
});

test("under price the price sentence goes before the fixed ones", async () => {
  const priced = await scanEvents({ title: "t", base: "price", events: [ev({ price: 50, stated_open: 45 })], keep: keepOf() });
  assert.ok(eventsDigest({ ...priced, id: ID }).endsWith(`\n${PRICE_SENTENCE}\n${EVENT_SENTENCES}`));
  assert.equal(PRICE_SENTENCE, "A price is its source's figure, checked as its date is, and divided by a split only when the company's record and the bars both show it.");
  for (const base of ["prior_close", "day0_open", "day0_close"]) {
    const text = eventsDigest({ ...(await scanEvents({ title: "t", base, events: [ev()], keep: keepOf() })), id: ID });
    assert.ok(!text.includes(PRICE_SENTENCE), base);
    assert.ok(text.endsWith(`\n${EVENT_SENTENCES}`), base);
  }
});

test("forty long cases under six horizons still fit", async () => {
  const view = await scanEvents({
    title: "t", horizons: [0, 1, 5, 20, 60, 120],
    events: Array.from({ length: 40 }, (_, i) => ev({ date: dateAt(30 + i), label: `${String(i).padStart(2, "0")} ${"l".repeat(77)}`, note: "n".repeat(160) })),
    keep: keepOf(),
  });
  const text = eventsDigest({ ...view, id: ID });
  assert.ok(Buffer.byteLength(text) <= 2048, String(Buffer.byteLength(text)));
  assert.ok(text.endsWith(EVENT_SENTENCES));
  assert.ok(!text.includes(" · note: "));
  const first = view.cases[0]!, last = view.cases.at(-1)!;
  assert.ok(text.includes(`hired: EVT ${first.day0} `), text);
  assert.ok(text.includes(`hired: EVT ${last.day0} `), text);
  assert.match(text, /^… and \d+ more in the view$/m);
});

// A view at the input's limits, built by hand as the scan never builds one this full.
const HORIZONS = [0, 1, 5, 20, 60, 250];
const measOf = (horizons: number[]) => ({ base: 50, gap: -0.1234, changes: horizons.map((k) => ({ k, r: -0.1234, x: -0.1234 })), low: -0.2, lowAt: 3, sessionsAfter: 1234 });
const sumOf = (horizons: number[]) => ({ n: 40, against: "benchmark", at: horizons.map((k) => ({ k, n: 40, median: -0.1234, down: 1 })), q1: -0.1234, q3: -0.1234, worst: null });
const SUM = sumOf(HORIZONS);
const PARAMETERS = { volumeBase: 50, minVolumes: 20, quiet: 1.5, elsewhere: 3, elsewhereOver: 1.5, neighbours: 2, minGroup: 8, pre: 30, post: 60, tieTolerance: 0.02, calendarDays: 7 };
/** What a v2 case carries beyond v1's fields, as measured with nothing special. */
const PLAIN = { tapeRan: true, relOf: "benchmark", factor: null, splits: null, listed: false, skipped: 0, price: null, statedOpen: null };
const FIRST = `measured 40 of 42 events (2 unmeasured) · 0 verified, 42 unverified, 40 marked verified without an opened source · view ${ID} · stopped at the deadline`;
function fullView({ title = "T".repeat(120), anchorLabel = "a".repeat(80), groupName = (i: number) => `${"g".repeat(23)}${i}`, symbol = "ABCDEFGHIJ", marketWords = "Nasdaq keeps no daily bars of SPY" as string | null, marketSource = null as string | null, horizons = HORIZONS } = {}) {
  const MEAS = measOf(horizons);
  const SUM = sumOf(horizons);
  const against = marketWords === null ? "benchmark" : "raw";
  const anchor = (i: number) => ({ id: `q-${i + 1}`, label: anchorLabel, date: "2020-06-19", timing: "pre", source: null, note: null, claimed: false, opened: false, verified: false, state: "measured", words: null, day0: "2020-06-19", measure: MEAS, tape: { vol0: 12.3, busiest: null, flags: [] }, flags: [], window: null, rel: null, ...PLAIN });
  const measured = Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, symbol: "ABCDEFGHIJ", label: "l".repeat(80), group: groupName(i % 4), date: dateAt(30 + i), timing: "pre", source: A, note: "n".repeat(160), claimed: true, opened: false, verified: false, state: "measured", words: null, day0: dateAt(30 + i), measure: MEAS, tape: { vol0: 1, busiest: null, flags: ["quiet", "elsewhere"] }, flags: ["quiet", "elsewhere", "unopened"], window: null, rel: null, ...PLAIN }));
  const gone = ["GONEA", "GONEB"].map((s) => ({ id: `ev-${s}`, symbol: s, label: "x", group: groupName(0), date: "2018-07-27", timing: "pre", source: A, note: null, claimed: false, opened: false, verified: false, state: "unmeasured", words: `Nasdaq keeps no daily bars of ${s}`, day0: null, measure: null, tape: null, flags: [], window: null, rel: null, ...PLAIN, tapeRan: false, relOf: null }));
  const read = { source: marketSource, words: marketWords, firstBar: marketSource === null ? null : "2019-03-04", short: marketSource !== null };
  return {
    kind: "events", version: 2, at: "2020-06-19T15:00:00.000Z", title, id: ID,
    query: { symbol, readDate: "2020-06-19", latest: "2020-06-19", today: "Today so far", sessionOpen: true, words: null, source: "Nasdaq · ABCDEFGHIJ", short: false, firstBar: "2010-01-04", anchors: [0, 1, 2].map(anchor) },
    parameters: { base: "prior_close", horizons, benchmark: "SPY", against, ...PARAMETERS },
    coverage: { asked: 42, measured: 40, unmeasured: gone.map((g) => ({ id: g.id, symbol: g.symbol, words: g.words })), verified: 0, unverified: 42, unopened: 40, quiet: 40, elsewhere: 40, noContext: 0, companies: { asked: 3, read: 1 }, sources: {}, short: [], adjustment: [], market: read, benchmark: { symbol: "SPY", ...read }, skipped: 0, listed: 0, sessionBars: 0, readFrom: null, deadline: true },
    groups: { all: { ...SUM, against }, named: [0, 1, 2, 3].map((i) => ({ name: groupName(i), summary: { ...SUM, against }, paths: null })) },
    cases: [...measured, ...gone], windowsDropped: 0,
  } as unknown as Parameters<typeof eventsDigest>[0];
}

test("at the input's limits the digest still fits", () => {
  const text = eventsDigest(fullView());
  assert.ok(Buffer.byteLength(text) <= 2048, String(Buffer.byteLength(text)));
  const lines = text.split("\n");
  assert.equal(lines[0], FIRST);
  assert.ok(text.endsWith(EVENT_SENTENCES));
  assert.ok(!text.includes(" · note: "));
  assert.equal(lines.filter((l) => /^g{8}…  40  /.test(l)).length, 4, text);
  assert.ok(lines.some((l) => l.startsWith("all  40  ")));
  assert.ok(!lines.some((l) => l.startsWith("quiet: ")));
});

test("Chinese text at the limits still fits", () => {
  // Clipping alone does not fit Chinese title, labels, groups and the benchmark's words under six horizons: the
  // anchors take their short form, the first and the last horizon only.
  const text = eventsDigest(fullView({ title: "题".repeat(120), anchorLabel: "锚".repeat(80), groupName: (i) => `${"组".repeat(23)}${i}`, marketWords: "市".repeat(60) }));
  assert.ok(Buffer.byteLength(text) <= 2048, String(Buffer.byteLength(text)));
  const lines = text.split("\n");
  assert.equal(lines[1], `${"题".repeat(20)}…`);
  const anchors = lines.filter((l) => l.startsWith("ABCDEFGHIJ "));
  assert.equal(anchors.length, 3);
  for (const l of anchors) {
    assert.ok(l.includes(`${"锚".repeat(12)}…`), l);
    assert.ok(!l.includes("gap ") && !l.includes("volume "), l);
    assert.ok(l.endsWith(": day 0 −12.3%; +250 −12.3%; 1234 sessions since"), l);
  }
});

test("the market's bars read short are said, their source clipped with the market's words", () => {
  const source = `Cboe · SPY ${"s".repeat(200)}`;
  const text = eventsDigest(fullView({ marketWords: null, marketSource: source }));
  assert.ok(Buffer.byteLength(text) <= 2048, String(Buffer.byteLength(text)));
  const lines = text.split("\n");
  const afterAnchors = lines.filter((l) => l.startsWith("ABCDEFGHIJ ")).length + 3; // the first line, the title, the measurement, the anchors
  assert.equal(lines[afterAnchors],`SPY's bars start 2019-03-04 (${Array.from(source).slice(0, 80).join("")}…): events before it have nothing to compare with`);
});

test("a view no cut can fit is refused, not returned", () => {
  assert.throws(() => eventsDigest(fullView({ symbol: "S".repeat(600) })), (e: unknown) => e instanceof AnalogError && e.code === "INTERNAL" &&
    e.message === "INTERNAL the answer does not fit the 2,048 bytes a digest may hold; shorten the title, the labels or the group names and call again");
});

test("an ordinary list still names the company that could not be measured", async () => {
  const view = await scanEvents({
    title: "CEO scandals",
    events: [
      ...Array.from({ length: 22 }, (_, i) => ev({ date: dateAt(30 + i), label: `CEO left after board inquiry no. ${i}`, source: `https://example.com/${i}` })),
      ev({ symbol: "GONE", date: "2018-07-27", source: "https://example.com/gone", verified: false }),
    ],
    keep: keepOf(),
  });
  const text = eventsDigest({ ...view, id: ID });
  assert.ok(Buffer.byteLength(text) <= 2048, String(Buffer.byteLength(text)));
  const lines = text.split("\n");
  assert.ok(lines.includes("unmeasured, Nasdaq keeps no daily bars of …: GONE"), text);
  const measured = view.cases.filter((c) => c.state === "measured");
  assert.ok(text.includes(`hired: EVT ${measured[0]!.day0} ${measured[0]!.label} `), text);
  assert.ok(text.includes(`hired: EVT ${measured.at(-1)!.day0} ${measured.at(-1)!.label} `), text);
  assert.match(text, /^… and \d+ more in the view$/m);
});

const TICKERS = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF", "GGG", "HHH", "III", "JJJ", "KKK", "LLL", "MMM", "NNN", "OOO", "PPP", "QQQ", "RRR", "SSS", "TTT"];
const listings = (n: number) => createBarsKeep({ ask: fakeMarket({ ...Object.fromEntries(TICKERS.slice(0, n).map((s) => [s, { bars: LISTED }])), SPY: { bars: EVENT_MARKET } }).ask });
const ipo = (s: string, over: Record<string, unknown> = {}) => ev({ symbol: s, label: `${s} IPO`, group: "IPO", date: "2020-04-10", timing: "open", source: `https://example.com/${s}`, ...over });

test("nineteen listings under prior_close keep their reason, said once", async () => {
  const names = TICKERS.slice(0, 19);
  const view = await scanEvents({ title: "Large IPOs", events: names.map((s) => ipo(s)), keep: listings(19) });
  const text = eventsDigest({ ...view, id: ID });
  assert.ok(Buffer.byteLength(text) <= 2048, String(Buffer.byteLength(text)));
  const line = text.split("\n").find((l) => l.startsWith("unmeasured"));
  assert.equal(line, `unmeasured, no close before a first bar (use price, day0_open or day0_close): ${names.join(", ")}`, text);
});

test("cases that need a split record are named under that reason while case lines leave", async () => {
  const S = "https://ir.example.com/splits";
  const split = new Set(["DDD", "KKK", "SSS"]);
  const events = TICKERS.map((s) => ipo(s, s === "TTT"
    ? { price: 40, stated_open: 180, splits: [{ date: "2020-05-01", new: 16, old: 1 }], splits_source: S }
    : { price: 40, stated_open: split.has(s) ? 180 : 45, label: `${s} IPO priced at the top of its range, upsized` }));
  const view = await scanEvents({ title: "Large IPOs", base: "price", horizons: [0, 5, 20, 60, 120, 250], events, keep: listings(20) });
  const text = eventsDigest({ ...view, id: ID });
  assert.ok(Buffer.byteLength(text) <= 2048, String(Buffer.byteLength(text)));
  assert.match(text, /^… and \d+ more in the view$/m);
  const lines = text.split("\n");
  assert.ok(lines.includes("unmeasured, needs a split record: DDD (bars ×4), KKK (bars ×4), SSS (bars ×4)"), text);
  assert.ok(lines.includes("unmeasured, split record and bars disagree: TTT (record ×16, bars ×4)"), text);
});

test("each reason is its own line; the market's own words are one reason each, clipped", () => {
  const view = fullView();
  const gone = view.cases.filter((k: any) => k.state === "unmeasured") as any[];
  gone[0].words = `Nasdaq keeps no daily bars of GONEA ${"w".repeat(120)}`;
  const text = eventsDigest(view);
  assert.ok(Buffer.byteLength(text) <= 2048, String(Buffer.byteLength(text)));
  const lines = text.split("\n").filter((l) => l.startsWith("unmeasured"));
  assert.equal(lines.length, 2, text);
  // the case's own symbol is taken out of the market's words, so companies refused alike share a reason
  assert.equal(lines[0], `unmeasured, ${Array.from(`Nasdaq keeps no daily bars of … ${"w".repeat(120)}`).slice(0, 80).join("")}…: GONEA`);
  assert.equal(lines[1], "unmeasured, Nasdaq keeps no daily bars of …: GONEB");
});

test("sixteen companies the market refused share one reason, and case lines still show", async () => {
  const refused = Array.from({ length: 16 }, (_, i) => `GON${String.fromCharCode(65 + i)}`);
  const view = await scanEvents({
    title: "CEO departures under investigation", horizons: [0, 5, 20, 60, 120, 250],
    events: [
      ...Array.from({ length: 24 }, (_, i) => ev({ date: dateAt(30 + i), group: i % 2 ? "hired" : "founder", label: "CEO steps down amid probe", source: `https://example.com/${i}` })),
      ...refused.map((s) => ev({ symbol: s, date: "2018-07-27", source: `https://example.com/${s}` })),
    ],
    query: { symbol: "evt", anchors: [{ label: "CEO out", date: "2020-04-10", timing: "open" }] },
    keep: keepOf(),
  });
  const text = eventsDigest({ ...view, id: ID });
  assert.ok(Buffer.byteLength(text) <= 2048, String(Buffer.byteLength(text)));
  const lines = text.split("\n");
  assert.ok(lines.includes(`unmeasured, Nasdaq keeps no daily bars of …: ${refused.join(", ")}`), text);
  assert.ok(lines.some((l) => /^(hired|founder): EVT /.test(l)), text);
});

/** A view whose present case's symbol is `width` long (never clipped) over three anchors, two short cases and three
 *  unmeasured of three reasons: the anchors take most of the bound, so the unmeasured lines are what is cut. */
function tightView(width: number) {
  const H = [0, 1, 5, 20, 60, 250];
  const MEAS = measOf(H);
  const words = ["no first-day open from its source: its price cannot be tied to the bars", "its bars are adjusted about ×4 since day 0 (its source's open 180.00, the bars' 45.00): a split record is needed", "day 0 would be 2020-01-10, 9 days after 2020-01-01: its bars do not cover the date"];
  const base = { source: A, note: null, claimed: false, opened: false, verified: true, window: null, rel: null, tape: { vol0: 2, busiest: null, flags: [] }, flags: [], ...PLAIN };
  const gone = words.map((w, i) => ({ ...base, id: `u${i}`, symbol: `AA${i}`, label: "x", group: "g", date: "2018-07-27", timing: "pre", verified: false, state: "unmeasured", words: w, day0: null, measure: null, tape: null, tapeRan: false, relOf: null }));
  const measured = [1, 2].map((i) => ({ ...base, id: `c${i}`, symbol: "ABC", label: "l".repeat(80), group: "g", date: `2020-01-0${i}`, timing: "pre", state: "measured", words: null, day0: `2020-01-0${i}`, measure: MEAS }));
  const anchors = [1, 2, 3].map((i) => ({ ...base, id: `q-${i}`, label: "a", date: "2020-06-19", timing: "pre", state: "measured", words: null, day0: "2020-06-19", measure: MEAS }));
  return {
    kind: "events", version: 2, at: "2020-06-19T15:00:00.000Z", title: "t", id: ID,
    query: { symbol: "S".repeat(width), readDate: "2020-06-19", latest: "2020-06-19", today: null, sessionOpen: false, words: null, source: "Nasdaq · S", short: false, firstBar: "2010-01-04", anchors },
    parameters: { base: "prior_close", horizons: H, benchmark: "SPY", against: "benchmark", ...PARAMETERS },
    coverage: { asked: 5, measured: 2, unmeasured: gone.map((g) => ({ id: g.id, symbol: g.symbol, words: g.words })), verified: 2, unverified: 3, unopened: 0, quiet: 0, elsewhere: 0, noContext: 0, companies: { asked: 4, read: 1 }, sources: {}, short: [], adjustment: [], market: { source: "Nasdaq · SPY", words: null, firstBar: "2019-03-04", short: false }, benchmark: { symbol: "SPY", source: "Nasdaq · SPY", words: null, firstBar: "2019-03-04", short: false }, skipped: 0, listed: 0, sessionBars: 0, readFrom: null, deadline: false },
    groups: { all: sumOf(H), named: [{ name: "g", summary: sumOf(H), paths: null }] },
    cases: [...measured, ...gone], windowsDropped: 0,
  } as unknown as Parameters<typeof eventsDigest>[0];
}

test("a reason's last company is cut only where the count is shorter, then names alone come before a count", () => {
  const unmeasuredOf = (width: number) => {
    const text = eventsDigest(tightView(width));
    assert.ok(Buffer.byteLength(text) <= 2048, String(Buffer.byteLength(text)));
    return text.split("\n").filter((l) => l.startsWith("unmeasured"));
  };
  // "AA0" is shorter than "1 case": kept; "AA1 (bars ×4)" is longer: cut
  assert.deepEqual(unmeasuredOf(282), [
    "unmeasured, no first-day open from its source: AA0", "unmeasured, needs a split record: 1 case", "unmeasured, date not in its bars: AA2",
  ]);
  // a little tighter: the names alone, never a bare count while they fit
  assert.deepEqual(unmeasuredOf(284), ["unmeasured: AA0, AA1, AA2"]);
});

test("case lines come back when clipping makes room", () => {
  // under six horizons the full anchors leave no room for a case line; under four, clipping makes room for some
  const text = eventsDigest(fullView({ horizons: [0, 5, 20, 60] }));
  assert.ok(Buffer.byteLength(text) <= 2048, String(Buffer.byteLength(text)));
  assert.ok(text.split("\n").some((l) => l.startsWith(`${"g".repeat(8)}…: ABCDEFGHIJ ${dateAt(30)} `)), text);
});

// A seeded generator of views (an LCG, no dependency): every text of random length up to its limit, in ASCII or
// Chinese, random flags, anchors, unmeasured cases, the market refused or not, the deadline or not.
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}
const clipTo = (text: string, max: number) => (Array.from(text).length <= max ? text : `${Array.from(text).slice(0, max).join("")}…`);
const pctOf = (v: number | null) => {
  if (v === null) return "n/a";
  const s = (v * 100).toFixed(1);
  return s === "0.0" || s === "-0.0" ? "0.0%" : s.startsWith("-") ? `−${s.slice(1)}%` : `+${s}%`;
};
/** A case's line after its group's name, as an uncut digest writes it, without its note. */
const caseTail = (c: any, against: "benchmark" | "raw") => {
  const first = c.measure.changes[0];
  return `${c.symbol} ${c.day0} ${Array.from(c.label as string).slice(0, 40).join("")} ` +
    c.measure.changes.map((ch: any) => `${ch.k === 0 ? "day 0" : `+${ch.k}`} ${pctOf(against === "raw" ? ch.r : ch.x)}`).join("; ") +
    (against === "benchmark" && first.x === null ? ` · raw ${pctOf(first.r)}` : "") +
    (c.price !== null ? ` · price ${c.price}` : "") + (c.factor !== null && c.factor !== 1 ? ` · split ×${c.factor}` : "") +
    (c.listed ? " · listing day" : "") + (c.skipped > 0 ? ` · skipped ${c.skipped} sessions` : "") +
    (c.flags.includes("quiet") ? " · quiet" : "") + (c.flags.includes("elsewhere") ? " · elsewhere" : "") +
    (c.tapeRan || c.listed ? "" : " · no volume check") + (c.verified ? "" : " · unverified") +
    (c.flags.includes("unopened") ? " · source not opened" : "") + (c.flags.includes("splitsUnopened") ? " · split record not opened" : "");
};
const BASE_LIST = ["prior_close", "price", "day0_open", "day0_close"] as const;
function randomView(seed: number) {
  const r = lcg(seed);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  const chinese = r() < 0.5;
  const full = r() < 0.4;
  const text = (max: number) => {
    const n = full ? max : 1 + Math.floor(r() * max);
    return Array.from({ length: n }, () => (chinese ? String.fromCodePoint(0x4e00 + Math.floor(r() * 2000)) : String.fromCharCode(97 + Math.floor(r() * 26)))).join("");
  };
  const num = () => (r() < 0.1 ? null : (r() - 0.6) * 0.8);
  const symbol = () => Array.from({ length: 1 + Math.floor(r() * 10) }, () => String.fromCharCode(65 + Math.floor(r() * 26))).join("");
  const base = pick(BASE_LIST);
  const pool = base === "day0_close" ? [1, 2, 5, 10, 20, 60, 120, 250] : [0, 1, 2, 5, 10, 20, 60, 120, 250];
  const horizons = full ? pool.slice(-6) : pool.filter(() => r() < 0.5).slice(0, 6);
  if (horizons.length === 0) horizons.push(pool[0]!);
  const benchmark = pick(["SPY", "QQQ", "IWM", null] as const);
  const market = r();
  const refused = benchmark !== null && market < 0.3;
  const short = benchmark !== null && market >= 0.3 && market < 0.6;
  const against = benchmark === null || refused ? "raw" : "benchmark";
  const groupNames = Array.from({ length: 1 + Math.floor(r() * 4) }, (_, i) => `${i}${text(23)}`);
  const measureOf = () => ({ base: 50, gap: base === "prior_close" || base === "price" ? num() : null, changes: horizons.map((k) => ({ k, r: num(), x: against === "raw" ? null : num() })), low: -0.2, lowAt: 3, sessionsAfter: Math.floor(r() * 3000) });
  const summary = () => {
    const n = Math.floor(r() * 41);
    if (r() < 0.3) return { n, against, at: horizons.map((k) => ({ k, n, median: null, down: null })), q1: null, q3: null, worst: null };
    return { n, against, at: horizons.map((k) => ({ k, n, median: num(), down: r() })), q1: num(), q3: num(), worst: null };
  };
  const special = () => {
    const priced = base === "price";
    const factor = priced ? pick([1, 1, 4, 1.5, 240]) : null;
    const splits = factor !== null && factor !== 1 ? { list: [{ date: "2021-01-04", new: 4, old: 1 }], factor, source: A, opened: r() < 0.5, verified: false } : null;
    return { tapeRan: r() < 0.7, relOf: against === "raw" ? "self" : "benchmark", factor, splits, listed: r() < 0.2, skipped: r() < 0.2 ? 1 + Math.floor(r() * 30) : 0, price: priced ? Math.round(r() * 50000) / 100 + 0.01 : null, statedOpen: priced ? 45 : null };
  };
  const measured = Array.from({ length: 1 + Math.floor(r() * 40) }, (_, i) => {
    const s = special();
    const flags = [...["quiet", "elsewhere", "unopened"].filter(() => r() < 0.3), ...(s.skipped > 0 ? ["skipped"] : []), ...(s.splits !== null && !s.splits.opened ? ["splitsUnopened"] : [])];
    return { id: `c${i}`, symbol: symbol(), label: text(80), group: pick(groupNames), date: dateAt(30 + i), timing: "pre", source: A, note: r() < 0.6 ? text(160) : null, claimed: true, opened: false, verified: r() < 0.5, state: "measured", words: null, day0: dateAt(30 + i), measure: measureOf(), tape: { vol0: 1, busiest: null, flags: [] }, flags, window: null, rel: null, ...s };
  });
  const gone = Array.from({ length: Math.floor(r() * 6) }, (_, i) => ({ id: `u${i}`, symbol: symbol(), label: text(80), group: pick(groupNames), date: "2018-07-27", timing: "pre", source: A, note: null, claimed: false, opened: false, verified: false, state: "unmeasured", words: `Nasdaq keeps no daily bars of this one: ${"w".repeat(Math.floor(r() * 160))}`, day0: null, measure: null, tape: null, flags: [], window: null, rel: null, ...PLAIN, tapeRan: false, relOf: null }));
  const anchors = Array.from({ length: Math.floor(r() * 4) }, (_, i) => r() < 0.3
    ? { id: `q-${i + 1}`, label: text(80), date: "2020-06-19", timing: "post", source: null, note: null, claimed: false, opened: false, verified: false, state: "unmeasured", words: `no session after 2020-06-19 in its bars ${"w".repeat(Math.floor(r() * 120))}`, day0: null, measure: null, tape: null, flags: [], window: null, rel: null, ...PLAIN, tapeRan: false, relOf: null }
    : { id: `q-${i + 1}`, label: text(80), date: "2020-06-19", timing: "pre", source: null, note: null, claimed: false, opened: false, verified: false, state: "measured", words: null, day0: "2020-06-19", measure: measureOf(), tape: { vol0: 3.2, busiest: null, flags: [] }, flags: [], window: null, rel: null, ...special() });
  const cases = [...measured, ...gone];
  const verified = cases.filter((c) => c.verified).length;
  const benchRead = benchmark === null
    ? { symbol: null, source: null, words: null, firstBar: null, short: false }
    : { symbol: benchmark, source: refused ? null : short ? `Cboe · ${benchmark} ${"s".repeat(Math.floor(r() * 200))}` : `Nasdaq · ${benchmark}`, words: refused ? `Nasdaq keeps no daily bars of ${benchmark} ${"w".repeat(Math.floor(r() * 200))}` : null, firstBar: refused ? null : "2019-03-04", short };
  return {
    kind: "events", version: 2, at: "2020-06-19T15:00:00.000Z", title: `T${text(119)}`, id: ID,
    query: anchors.length === 0 ? null : { symbol: symbol(), readDate: "2020-06-19", latest: "2020-06-19", today: null, sessionOpen: r() < 0.5, words: null, source: "Nasdaq · X", short: false, firstBar: "2010-01-04", anchors },
    parameters: { base, horizons, benchmark, against, ...PARAMETERS },
    coverage: { asked: cases.length, measured: measured.length, unmeasured: gone.map((g) => ({ id: g.id, symbol: g.symbol, words: g.words })), verified, unverified: cases.length - verified, unopened: measured.filter((c) => c.flags.includes("unopened")).length, quiet: 0, elsewhere: 0, noContext: 0, companies: { asked: 1, read: 1 }, sources: {}, short: [], adjustment: [], market: { source: "Nasdaq · SPY", words: null, firstBar: "2019-03-04", short: false }, benchmark: benchRead, skipped: 0, listed: 0, sessionBars: 0, readFrom: null, deadline: r() < 0.3 },
    groups: { all: summary(), named: groupNames.map((name) => ({ name, summary: summary(), paths: null })) },
    cases, windowsDropped: 0,
  } as any;
}

test("the bound holds for any view", () => {
  let refusedCount = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const view = randomView(seed);
    let text: string;
    try {
      text = eventsDigest(view);
    } catch (e) {
      assert.ok(e instanceof AnalogError && e.message === "INTERNAL the answer does not fit the 2,048 bytes a digest may hold; shorten the title, the labels or the group names and call again", `seed ${seed}: ${e}`);
      refusedCount++;
      continue;
    }
    const c = view.coverage;
    const first = `measured ${c.measured} of ${c.asked} events (${c.unmeasured.length} unmeasured) · ${c.verified} verified, ${c.unverified} unverified` +
      (c.unopened > 0 ? `, ${c.unopened} marked verified without an opened source` : "") + ` · view ${ID}${c.deadline ? " · stopped at the deadline" : ""}`;
    assert.ok(Buffer.byteLength(text) <= 2048, `seed ${seed}: ${Buffer.byteLength(text)} bytes`);
    const lines = text.split("\n");
    assert.equal(lines[0], first, `seed ${seed}`);
    assert.ok(text.endsWith(`\n${EVENT_SENTENCES}`), `seed ${seed}`);
    const shown = (name: string) => [name, clipTo(name, 8)];
    for (const g of view.groups.named) {
      assert.ok(lines.some((l) => shown(g.name).some((s) => l.startsWith(`${s}  ${g.summary.n}  `))), `seed ${seed}: no row for ${g.name}`);
    }
    assert.ok(lines.some((l) => l.startsWith(`all  ${view.groups.all.n}  `)), `seed ${seed}: no all row`);
    assert.ok(lines[2]!.startsWith("measured from "), `seed ${seed}: the measurement line`);
    if (view.parameters.base === "price") assert.ok(text.endsWith(`\n${PRICE_SENTENCE}\n${EVENT_SENTENCES}`), `seed ${seed}`);
    const tailOf = (k: any) => caseTail(k, view.parameters.against);
    const tails = new Set(view.cases.filter((k: any) => k.state === "measured").map(tailOf));
    const notes = new Map(view.cases.filter((k: any) => k.note !== null).map((k: any) => [tailOf(k), ` · note: ${k.note}`]));
    for (const l of lines) {
      const prefix = view.groups.named.flatMap((g: any) => shown(g.name)).find((s: string) => l.startsWith(`${s}: `));
      if (prefix === undefined) continue;
      const tail = l.slice(prefix.length + 2);
      const bare = [...notes].find(([t, note]) => tail === `${t}${note}`)?.[0] ?? tail;
      assert.ok(tails.has(bare), `seed ${seed}: a case line no uncut digest gives: ${l}`);
    }
  }
  assert.ok(refusedCount < 300);
});

test("SPY refused is said", async () => {
  const view = await scanEvents({ title: "t", events: Array.from({ length: 8 }, (_, i) => ev({ date: dateAt(92 + i) })), keep: keepOf(fakeMarket({ EVT: { bars: EVENT } })) });
  const text = eventsDigest({ ...view, id: ID });
  assert.equal(text.split("\n")[2], "measured from the close before day 0, raw: SPY could not be read (Nasdaq keeps no daily bars of SPY): day 0 +1 +5 +20 +60");
  // the measurement line says raw once; no case line repeats it
  assert.ok(!text.split("\n").some((l) => l.startsWith("hired: ") && l.includes(" · raw ")), text);
});

test("a case without a figure against the benchmark at the first horizon gives its raw change", async () => {
  // SPY's bars start after the event: the benchmark was read, so the view is against it, but this case has no figure
  const view = await scanEvents({ title: "t", events: [ev()], opened: (u) => u === A, keep: keepOf(fakeMarket({ EVT: { bars: EVENT }, SPY: { bars: EVENT_MARKET.slice(101) } })) });
  assert.equal(view.parameters.against, "benchmark");
  const line = eventsDigest({ ...view, id: ID }).split("\n").find((l) => l.startsWith("hired: EVT "))!;
  assert.ok(line.includes("day 0 n/a;") && line.endsWith(" · raw −12.0%"), line);
});
