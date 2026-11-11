import test from "node:test";
import assert from "node:assert/strict";
import { scanEvents } from "../plugins/analog/lib/event-scan.mjs";
import { EVENT_SENTENCES, eventsDigest } from "../plugins/analog/lib/event-digest.mjs";
import { createBarsKeep } from "../plugins/analog/lib/bars.mjs";
import { EVENT, EVENT_MARKET, dateAt, fakeMarket } from "./analog-fixtures.ts";

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
  assert.ok(text.startsWith(`measured 1 of 4 events (3 unmeasured) · 1 verified, 3 unverified, 1 marked verified without an opened source · view ${ID}\nCEO scandals\n`), text);
  assert.ok(text.includes("hired  1  too few to summarize"), text);
  assert.ok(text.includes("hired: EVT 2020-04-10 CEO out day 0 −11.1%; +5 −8.0%; +60 −5.9%"), text);
  assert.ok(text.includes("unmeasured: GONE 2018-07-27 (Nasdaq keeps no daily bars of GONE); "), text);
  assert.ok(text.endsWith(EVENT_SENTENCES), text);
  assert.equal(JSON.stringify(view), before); // the view is left as it was
});

test("an anchor's line", async () => {
  const m = fakeMarket({ EVT: { bars: EVENT, today: true }, OLD: { bars: EVENT }, SPY: { bars: EVENT_MARKET } });
  const view = await scanEvents({ title: "t", events: [ev({ symbol: "OLD" })], query: { symbol: "evt", anchors: [{ label: "first report", date: "2020-04-10", timing: "open" }, { label: "admission", date: "2020-06-19", timing: "post" }] }, keep: createBarsKeep({ ask: m.ask }), now: () => new Date("2020-06-19T15:00:00Z") });
  const lines = eventsDigest({ ...view, id: ID }).split("\n");
  assert.ok(lines.some((l) => l.startsWith("EVT first report 2020-04-10 open → day 0 2020-04-10: gap −10.0%; day 0 −12.0% (−11.1% vs market); +1 −16.0%; +5 −8.0%; volume 5.0×; 70 sessions since")), lines.join("\n"));
  assert.ok(lines.includes("EVT admission 2020-06-19 post: unmeasured (no session after 2020-06-19 in its bars, which end 2020-06-19)"), lines.join("\n"));
});

test("eight cases get a row of medians", async () => {
  const view = await scanEvents({ title: "t", events: Array.from({ length: 8 }, (_, i) => ev({ date: dateAt(92 + i) })), keep: keepOf() });
  const row = eventsDigest({ ...view, id: ID }).split("\n").find((l) => l.startsWith("hired  "));
  assert.ok(row !== undefined);
  const fields = row.split("  ");
  assert.equal(fields[2], "0.0%");
  assert.deepEqual(fields.slice(-2), ["0%", "100%"]);
});

test("forty long cases still fit", async () => {
  const view = await scanEvents({
    title: "t",
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

test("SPY refused is said", async () => {
  const view = await scanEvents({ title: "t", events: Array.from({ length: 8 }, (_, i) => ev({ date: dateAt(92 + i) })), keep: keepOf(fakeMarket({ EVT: { bars: EVENT } })) });
  const text = eventsDigest({ ...view, id: ID });
  assert.ok(text.includes("SPY could not be read: Nasdaq keeps no daily bars of SPY"), text);
  assert.ok(text.split("\n").some((l) => l.startsWith("hired: ") && l.includes(" · raw ")), text);
});
