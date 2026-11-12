import test from "node:test";
import assert from "node:assert/strict";
import { scanEvents } from "../plugins/analog/lib/event-scan.mjs";
import { EVENT_SENTENCES, eventsDigest } from "../plugins/analog/lib/event-digest.mjs";
import { createBarsKeep } from "../plugins/analog/lib/bars.mjs";
import { AnalogError } from "../plugins/analog/lib/errors.mjs";
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

// A view at the input's limits, built by hand as the scan never builds one this full.
const MEAS = { base: 50, gap: -0.1234, r0: -0.1234, r1: -0.1234, r5: -0.1234, r20: -0.1234, r60: -0.1234, x0: -0.1234, x1: -0.1234, x5: -0.1234, x20: -0.1234, x60: -0.1234, low60: -0.2, lowAt: 3, sessionsAfter: 1234 };
const SUM = { n: 40, n0: 40, n1: 40, n5: 40, n20: 40, n60: 40, x0: -0.1234, x1: -0.1234, x5: -0.1234, x20: -0.1234, x60: -0.1234, x60q1: -0.1234, x60q3: -0.1234, down0: 1, down1: 1, down5: 1, down20: 1, down60: 1, worst0: null };
const FIRST = `measured 40 of 42 events (2 unmeasured) · 0 verified, 42 unverified, 40 marked verified without an opened source · view ${ID} · stopped at the deadline`;
function fullView({ title = "T".repeat(120), anchorLabel = "a".repeat(80), groupName = (i: number) => `${"g".repeat(23)}${i}`, symbol = "ABCDEFGHIJ", marketWords = "Nasdaq keeps no daily bars of SPY" } = {}) {
  const anchor = (i: number) => ({ id: `q-${i + 1}`, label: anchorLabel, date: "2020-06-19", timing: "pre", state: "measured", words: null, day0: "2020-06-19", measure: MEAS, tape: { vol0: 12.3, busiest: null, flags: [] }, flags: [], window: null, rel: null });
  const measured = Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, symbol: "ABCDEFGHIJ", label: "l".repeat(80), group: groupName(i % 4), date: dateAt(30 + i), timing: "pre", source: A, note: "n".repeat(160), claimed: true, opened: false, verified: false, state: "measured", words: null, day0: dateAt(30 + i), measure: MEAS, tape: { vol0: 1, busiest: null, flags: ["quiet", "elsewhere"] }, flags: ["quiet", "elsewhere", "unopened"], window: null, rel: null }));
  const gone = ["GONEA", "GONEB"].map((s) => ({ id: `ev-${s}`, symbol: s, label: "x", group: groupName(0), date: "2018-07-27", timing: "pre", source: A, note: null, claimed: false, opened: false, verified: false, state: "unmeasured", words: `Nasdaq keeps no daily bars of ${s}`, day0: null, measure: null, tape: null, flags: [], window: null, rel: null }));
  return {
    kind: "events", version: 1, at: "2020-06-19T15:00:00.000Z", title, id: ID,
    query: { symbol, readDate: "2020-06-19", latest: "2020-06-19", today: "Today so far", sessionOpen: true, words: null, anchors: [0, 1, 2].map(anchor) },
    coverage: { asked: 42, measured: 40, unmeasured: gone.map((g) => ({ id: g.id, symbol: g.symbol, words: g.words })), verified: 0, unverified: 42, unopened: 40, quiet: 40, elsewhere: 40, noContext: 0, companies: { asked: 3, read: 1 }, sources: {}, short: [], adjustment: [], market: { source: null, words: marketWords }, readFrom: null, deadline: true },
    groups: { all: SUM, named: [0, 1, 2, 3].map((i) => ({ name: groupName(i), summary: SUM, paths: null })) },
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
  // Clipping alone fits Chinese title, labels and groups (1,978 bytes); the market's words in Chinese push it to the
  // anchors' short form.
  const text = eventsDigest(fullView({ title: "题".repeat(120), anchorLabel: "锚".repeat(80), groupName: (i) => `${"组".repeat(23)}${i}`, marketWords: "市".repeat(60) }));
  assert.ok(Buffer.byteLength(text) <= 2048, String(Buffer.byteLength(text)));
  const lines = text.split("\n");
  assert.equal(lines[1], `${"题".repeat(20)}…`);
  const anchors = lines.filter((l) => l.startsWith("ABCDEFGHIJ "));
  assert.equal(anchors.length, 3);
  for (const l of anchors) {
    assert.ok(l.includes(`${"锚".repeat(12)}…`), l);
    assert.ok(!l.includes("gap ") && !l.includes("volume "), l);
  }
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
  assert.ok(lines.some((l) => l.startsWith("unmeasured: GONE 2018-07-27")), text);
  const measured = view.cases.filter((c) => c.state === "measured");
  assert.ok(text.includes(`hired: EVT ${measured[0]!.day0} ${measured[0]!.label} `), text);
  assert.ok(text.includes(`hired: EVT ${measured.at(-1)!.day0} ${measured.at(-1)!.label} `), text);
  assert.match(text, /^… and \d+ more in the view$/m);
});

test("case lines come back when clipping makes room", () => {
  const text = eventsDigest(fullView());
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
const caseTail = (c: any) => `${c.symbol} ${c.day0} ${Array.from(c.label as string).slice(0, 40).join("")} day 0 ${pctOf(c.measure.x0)}; +5 ${pctOf(c.measure.x5)}; +60 ${pctOf(c.measure.x60)}` +
  (c.measure.x0 === null ? ` · raw ${pctOf(c.measure.r0)}` : "") + (c.flags.includes("quiet") ? " · quiet" : "") +
  (c.flags.includes("elsewhere") ? " · elsewhere" : "") + (c.verified ? "" : " · unverified") + (c.flags.includes("unopened") ? " · source not opened" : "");
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
  const groupNames = Array.from({ length: 1 + Math.floor(r() * 4) }, (_, i) => `${i}${text(23)}`);
  const measureOf = () => ({ base: 50, gap: num(), r0: num() ?? 0, r1: num(), r5: num(), r20: num(), r60: num(), x0: num(), x1: num(), x5: num(), x20: num(), x60: num(), low60: -0.2, lowAt: 3, sessionsAfter: Math.floor(r() * 3000) });
  const summary = () => {
    const n = Math.floor(r() * 41);
    if (r() < 0.3) return { ...SUM, n, x0: null };
    return { ...SUM, n, x0: num(), x1: num(), x5: num(), x20: num(), x60: num(), x60q1: num(), x60q3: num(), down0: r(), down60: r() };
  };
  const measured = Array.from({ length: 1 + Math.floor(r() * 40) }, (_, i) => {
    const flags = ["quiet", "elsewhere", "unopened"].filter(() => r() < 0.3);
    return { id: `c${i}`, symbol: symbol(), label: text(80), group: pick(groupNames), date: dateAt(30 + i), timing: "pre", source: A, note: r() < 0.6 ? text(160) : null, claimed: true, opened: false, verified: r() < 0.5, state: "measured", words: null, day0: dateAt(30 + i), measure: measureOf(), tape: { vol0: 1, busiest: null, flags: [] }, flags, window: null, rel: null };
  });
  const gone = Array.from({ length: Math.floor(r() * 6) }, (_, i) => ({ id: `u${i}`, symbol: symbol(), label: text(80), group: pick(groupNames), date: "2018-07-27", timing: "pre", source: A, note: null, claimed: false, opened: false, verified: false, state: "unmeasured", words: `Nasdaq keeps no daily bars of this one: ${"w".repeat(Math.floor(r() * 160))}`, day0: null, measure: null, tape: null, flags: [], window: null, rel: null }));
  const anchors = Array.from({ length: Math.floor(r() * 4) }, (_, i) => r() < 0.3
    ? { id: `q-${i + 1}`, label: text(80), date: "2020-06-19", timing: "post", state: "unmeasured", words: `no session after 2020-06-19 in its bars ${"w".repeat(Math.floor(r() * 120))}`, day0: null, measure: null, tape: null, flags: [], window: null, rel: null }
    : { id: `q-${i + 1}`, label: text(80), date: "2020-06-19", timing: "pre", state: "measured", words: null, day0: "2020-06-19", measure: measureOf(), tape: { vol0: 3.2, busiest: null, flags: [] }, flags: [], window: null, rel: null });
  const cases = [...measured, ...gone];
  const verified = cases.filter((c) => c.verified).length;
  const marketRefused = r() < 0.3;
  return {
    kind: "events", version: 1, at: "2020-06-19T15:00:00.000Z", title: `T${text(119)}`, id: ID,
    query: anchors.length === 0 ? null : { symbol: symbol(), readDate: "2020-06-19", latest: "2020-06-19", today: null, sessionOpen: r() < 0.5, words: null, anchors },
    coverage: { asked: cases.length, measured: measured.length, unmeasured: gone.map((g) => ({ id: g.id, symbol: g.symbol, words: g.words })), verified, unverified: cases.length - verified, unopened: measured.filter((c) => c.flags.includes("unopened")).length, quiet: 0, elsewhere: 0, noContext: 0, companies: { asked: 1, read: 1 }, sources: {}, short: [], adjustment: [], market: { source: marketRefused ? null : "Nasdaq · SPY", words: marketRefused ? `Nasdaq keeps no daily bars of SPY ${"w".repeat(Math.floor(r() * 200))}` : null }, readFrom: null, deadline: r() < 0.3 },
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
    const tails = new Set(view.cases.filter((k: any) => k.state === "measured").map(caseTail));
    const notes = new Map(view.cases.filter((k: any) => k.note !== null).map((k: any) => [caseTail(k), ` · note: ${k.note}`]));
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
  assert.ok(text.includes("SPY could not be read: Nasdaq keeps no daily bars of SPY"), text);
  assert.ok(text.split("\n").some((l) => l.startsWith("hired: ") && l.includes(" · raw ")), text);
});
