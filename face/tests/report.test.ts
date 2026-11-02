// face/tests/report.test.ts
/** The pre-market report (src/report.ts): `builtin:report`'s block - the screen line from the strategy's Lunhui runs,
 * its status.yaml, its verified levels and one snapshot per market, each print judged on its own market's date - and
 * the strategy template's STANDING.md and levels.example.yml. Offline: a fake quote source priced from one table per
 * market, and fixtures under tests/tmp/report-<pid>/, removed afterwards. */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import fsPromises, { link, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLevels } from "../src/desk-book.ts";
import { HttpError } from "../src/http.ts";
import type { MarketQuote, MarketQuoteIdentity, MarketQuotePayload } from "../src/market-quotes.ts";
import type { ProducerInput } from "../src/producer.ts";
import {
  NO_SCREEN, SCREEN_RUNS_MAX, STATUS_NUMBERS_MAX, STATUS_TEXT_MAX, buildReport, previousSessionDate, readScreen, reportProducer,
  type Report, type Screen,
} from "../src/report.ts";
import { sha256Hex, STANDING_TEXT_MAX_BYTES } from "../src/standing.ts";
import type { Market } from "../src/symbols.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const ROOT = join(HERE, "tmp", `report-${process.pid}`);
const DEMO = join(ROOT, "strategies", "demo");

const ONE_LINE = "NVDA's breakout holds while the semis lead";
const STATUS = `status: researching\none_line: ${ONE_LINE}\nnext: re-test the stop after the earnings\nnumbers:\n  hit_rate: 0.54\n`;

before(async () => {
  await rm(ROOT, { recursive: true, force: true });
  await mkdir(DEMO, { recursive: true });
  await writeFile(join(DEMO, "status.yaml"), STATUS);
});
after(() => rm(ROOT, { recursive: true, force: true }));

/* ---------- the fake source ---------- */

/** A quote as the Market's read gives one, `fields` over a priceless default. */
function mq(id: string, fields: Partial<MarketQuote> = {}): MarketQuote {
  const [market, symbol] = id.split(":") as [Market, string];
  return {
    id, market, symbol, price: null, prev_close: null, change: null, change_pct: null, volume: null, as_of: null, received_at: null,
    volume_as_of: null, source: "market", feed: market === "cn" ? "tencent" : "robinhood", basis: "previous_close", quote_status: "live",
    market_status: "unknown", message: "", ...fields,
  };
}

/** A source priced from `table` by id, recording each snapshot's assets; a market in `reject` rejects with its error. */
function fakeSource(table: Record<string, Partial<MarketQuote>>, opts: { reject?: Partial<Record<Market, unknown>>; unavailable?: string } = {}) {
  const calls: MarketQuoteIdentity[][] = [];
  return {
    calls,
    ...(opts.unavailable === undefined ? {} : { unavailable: opts.unavailable }),
    async snapshot(assets: MarketQuoteIdentity[]): Promise<MarketQuotePayload> {
      calls.push(assets);
      const market = assets[0]?.market;
      if (market !== undefined && opts.reject?.[market] !== undefined) throw opts.reject[market];
      return {
        ok: true, generated_at: new Date(0).toISOString(), providers: [],
        quotes: assets.filter((a) => table[a.id] !== undefined).map((a) => mq(a.id, table[a.id])),
      };
    },
  };
}

const NOW = (): number => Date.parse("2026-11-27T13:00:05Z");

const LEVELS = [
  "- symbol: NVDA\n  kind: target\n  price: 180\n  when: cross_up\n  plan: sell a third, raise the stop\n  expires: 2026-12-31\n",
  "- symbol: AAPL\n  kind: buy_zone\n  range: [218, 222]\n  when: enter\n  plan: buy 10 shares\n  source: the October base\n  expires: 2026-12-31\n",
  "- symbol: IBM\n  kind: watch\n  price: 230\n  when: cross_up\n  plan: read the news\n  expires: 2026-12-31\n",
  '- symbol: "600519"\n  kind: stop\n  price: 1400\n  when: cross_down\n  plan: reread the thesis\n  expires: 2026-12-31\n',
].join("");

const TABLE: Record<string, Partial<MarketQuote>> = {
  "us:NVDA": { price: 181.5, prev_close: 178.2, as_of: "2026-11-27T12:58:03Z" },
  "us:AAPL": { price: 236.1, prev_close: 234, as_of: "2026-11-25T20:59:58Z" },
  "us:IBM": { price: 231, prev_close: 229, as_of: "2026-11-24T20:59:58Z" },
  "cn:600519": { price: 1398.5, prev_close: 1420, as_of: "2026-11-27T07:00:03Z" },
};

const levelsOf = (text: string | null) => ({ file: "strategies/demo/levels.yml", sha256: text === null ? "none" : sha256Hex(Buffer.from(text)), text });

const INPUT: ProducerInput = {
  order: "demo-report", firing: "demo-report:2026-11-27", date: "2026-11-27", dir: "strategies/demo", market: "us",
  session: { open: "2026-11-27T14:30:00Z", close: "2026-11-27T18:00:00Z", early: true },
  levels: levelsOf(LEVELS),
};

async function report(deps: Parameters<typeof buildReport>[0], input: ProducerInput = INPUT): Promise<{ out: Awaited<ReturnType<typeof buildReport>>; r: Report; text: string }> {
  const out = await buildReport(deps, input);
  const text = (out as { text: string }).text;
  return { out, r: JSON.parse(text) as Report, text };
}

/* ---------- the block ---------- */

test("buildReport quotes both markets from one snapshot each, each print on its own market's date", async () => {
  const source = fakeSource(TABLE);
  const { out, r, text } = await report({ quotes: source, root: ROOT, now: NOW });
  assert.equal(out.ok, true);
  assert.deepEqual(source.calls.map((c) => c.map((a) => a.id)).sort(), [["cn:600519"], ["us:NVDA", "us:AAPL", "us:IBM"]]);
  assert.deepEqual(r.quotes, [
    { symbol: "NVDA", market: "us", feed: "robinhood", last: 181.5, at: "ROBINHOOD 07:58:03 ET", print: "pre-market", prevClose: 178.2, sinceClosePct: 1.85, status: "live" },
    { symbol: "AAPL", market: "us", feed: "robinhood", last: 236.1, at: "ROBINHOOD 2026-11-25 15:59:58 ET", print: "close", prevClose: null, sinceClosePct: null, status: "live" },
    { symbol: "IBM", market: "us", feed: "robinhood", last: 231, at: "ROBINHOOD 2026-11-24 15:59:58 ET", print: "earlier", prevClose: null, sinceClosePct: null, status: "live" },
    { symbol: "600519", market: "cn", feed: "tencent", last: 1398.5, at: "TENCENT 15:00:03 Beijing", print: "session", prevClose: 1420, sinceClosePct: -1.51, status: "live" },
  ]);
  assert.deepEqual(r.levels.rows.map((row) => [row.symbol, row.market, row.distancePct, row.closeDistancePct, row.crossedSinceClose]), [
    ["NVDA", "us", -0.83, 1.01, true], ["AAPL", "us", -5.97, -5.97, null], ["IBM", "us", -0.43, null, null], ["600519", "cn", 0.11, -1.41, true],
  ]);
  assert.deepEqual(r.levels.rows[1], {
    symbol: "AAPL", market: "us", kind: "buy_zone", range: [218, 222], when: "enter", plan: "buy 10 shares", source: "the October base", expires: "2026-12-31",
    distancePct: -5.97, closeDistancePct: -5.97, crossedSinceClose: null,
  });
  assert.equal(r.takenAt, "08:00:05 ET");
  assert.deepEqual(r.session, { open: "09:30 ET", close: "13:00 ET", early: true });
  assert.equal(r.market, "us");
  assert.equal(r.strategy, "strategies/demo");
  assert.equal(r.date, "2026-11-27");
  assert.equal(r.statusFile, "read");
  assert.equal(r.status.one_line, ONE_LINE);
  assert.deepEqual(r.screen, { wired: false, ran: null, line: NO_SCREEN });
  assert.equal(r.quotesError, undefined);
  assert.doesNotMatch(text, /Account/);

  const cn = await report({ quotes: fakeSource(TABLE), root: ROOT, now: NOW }, {
    ...INPUT, market: "cn", session: { open: "2026-11-27T01:30:00Z", close: "2026-11-27T07:00:00Z", early: false },
  });
  assert.deepEqual(cn.r.session, { open: "09:30 Beijing (20:30 ET)", close: "15:00 Beijing (02:00 ET)", early: false });
  assert.equal(cn.r.market, "cn");
  assert.deepEqual(cn.r.quotes.map((q) => q.print), ["pre-market", "close", "earlier", "session"], "each print on its own market, whatever the order's");

  const noMarket: ProducerInput = { ...INPUT };
  delete noMarket.market;
  assert.equal((await report({ quotes: fakeSource(TABLE), root: ROOT, now: NOW }, noMarket)).r.market, "us", "absent is us");
});

test("a stale print is never pre-market or session, an unreadable time is no print, and a closed market date judges the close", async () => {
  const table: Record<string, Partial<MarketQuote>> = {
    ...TABLE,
    "us:NVDA": { ...TABLE["us:NVDA"], quote_status: "stale" },
    "us:AAPL": { price: 236.1, prev_close: 234, as_of: "not a time" },
  };
  const { r } = await report({ quotes: fakeSource(table), root: ROOT, now: NOW });
  assert.deepEqual(r.quotes[0], { symbol: "NVDA", market: "us", feed: "robinhood", last: 181.5, at: "ROBINHOOD 07:58:03 ET", print: "earlier", prevClose: null, sinceClosePct: null, status: "stale" });
  assert.deepEqual(r.quotes[1], { symbol: "AAPL", market: "us", feed: "robinhood", last: null, at: null, print: "none", prevClose: null, sinceClosePct: null, status: "live" });
  /* Saturday 2026-11-28 in both markets: Friday's prints are the close */
  const sat = (): number => Date.parse("2026-11-28T15:00:00Z");
  const weekend = await report({ quotes: fakeSource({ "us:NVDA": { price: 181.5, prev_close: 178.2, as_of: "2026-11-27T17:59:58Z" }, "cn:600519": TABLE["cn:600519"] }), root: ROOT, now: sat },
    { ...INPUT, date: "2026-11-28" });
  assert.deepEqual(weekend.r.quotes.map((q) => [q.symbol, q.print]), [["NVDA", "close"], ["AAPL", "none"], ["IBM", "none"], ["600519", "close"]]);
});

test("the screen line names the newest sealed run and whether it covers the previous session; links and torn runs are skipped", async () => {
  const now = Date.parse("2026-11-30T00:00:05Z");
  const dir = "strategies/screen";
  const analysis = join(ROOT, dir, "analysis");
  const write = async (id: string, manifest: unknown): Promise<void> => {
    await mkdir(join(analysis, id), { recursive: true });
    await writeFile(join(analysis, id, "run.json"), typeof manifest === "string" ? manifest : JSON.stringify(manifest));
  };
  const A1 = "20261127T081000Z-000000a1";
  const A0 = "20261126T081000Z-000000a0";
  await write(A0, { run: A0, kind: "market", session: "2026-11-26", sealed_at: "2026-11-26T08:10:00Z", artifacts: ["environment"] });
  assert.deepEqual(await readScreen(ROOT, dir, "cn", "2026-11-30", now), {
    wired: true, ran: false,
    line: `not run for the 2026-11-27 session: the last sealed Lunhui run is ${A0} (market), for the 2026-11-26 session, sealed 2026-11-26 03:10 ET`,
    run: { id: A0, kind: "market", session: "2026-11-26", sealedAt: "2026-11-26T08:10:00Z", artifacts: ["environment"] },
  });
  await write(A1, { run: A1, kind: "market", session: "2026-11-27", sealed_at: "2026-11-27T08:10:00Z", artifacts: ["environment", "sentiment"] });
  await write("20261128T010000Z-000000a2", { kind: "market", session: "2026-11-28", sealed_at: null });
  await mkdir(join(analysis, "20261128T020000Z-000000a3"));
  await symlink(join(analysis, A1, "run.json"), join(analysis, "20261128T020000Z-000000a3", "run.json"));
  await write("20261128T030000Z-000000a4", "{ torn");
  await mkdir(join(analysis, "notes"));
  await mkdir(join(analysis, "20261128T040000Z-000000a5")); // no run.json yet: ignored
  const screen: Screen = await readScreen(ROOT, dir, "cn", "2026-11-30", now);
  assert.deepEqual(screen, {
    wired: true, ran: true,
    line: `ran: Lunhui run ${A1} (market) sealed 2026-11-27 03:10 ET covers the 2026-11-27 session; artifacts: environment, sentiment`,
    run: { id: A1, kind: "market", session: "2026-11-27", sealedAt: "2026-11-27T08:10:00Z", artifacts: ["environment", "sentiment"] },
    skipped: 2,
  });
  assert.deepEqual(Object.keys(screen), ["wired", "ran", "line", "run", "skipped"]);

  /* a sealed_at that is no time counts as skipped; kind and session that are not strings are unknown */
  const odd = "strategies/screen-odd";
  await mkdir(join(ROOT, odd, "analysis", "20261127T090000Z-000000b1"), { recursive: true });
  await writeFile(join(ROOT, odd, "analysis", "20261127T090000Z-000000b1", "run.json"), JSON.stringify({ sealed_at: "yesterday" }));
  await mkdir(join(ROOT, odd, "analysis", "20261127T080000Z-000000b2"), { recursive: true });
  await writeFile(join(ROOT, odd, "analysis", "20261127T080000Z-000000b2", "run.json"), JSON.stringify({ sealed_at: "2026-11-27T08:00:00Z", kind: 7, artifacts: ["a", 1] }));
  assert.deepEqual(await readScreen(ROOT, odd, "cn", "2026-11-30", now), {
    wired: true, ran: false,
    line: "not run for the 2026-11-27 session: the last sealed Lunhui run is 20261127T080000Z-000000b2 (unknown), for the unknown session, sealed 2026-11-27 03:00 ET",
    run: { id: "20261127T080000Z-000000b2", kind: "unknown", session: "unknown", sealedAt: "2026-11-27T08:00:00Z", artifacts: [] },
    skipped: 1,
  });

  /* an empty analysis/; none; a link to one; a file */
  await mkdir(join(ROOT, "strategies", "screen-empty", "analysis"), { recursive: true });
  assert.deepEqual(await readScreen(ROOT, "strategies/screen-empty", "cn", "2026-11-30", now),
    { wired: true, ran: false, line: "not run: no Lunhui run in strategies/screen-empty/analysis/ is sealed" });
  await mkdir(join(ROOT, "strategies", "screen-none"), { recursive: true });
  assert.deepEqual(await readScreen(ROOT, "strategies/screen-none", "cn", "2026-11-30", now), { wired: false, ran: null, line: NO_SCREEN });
  await mkdir(join(ROOT, "strategies", "screen-link"), { recursive: true });
  await symlink(analysis, join(ROOT, "strategies", "screen-link", "analysis"));
  assert.deepEqual(await readScreen(ROOT, "strategies/screen-link", "cn", "2026-11-30", now), { wired: false, ran: null, line: NO_SCREEN });
  assert.deepEqual(await readScreen(ROOT, "strategies/gone", "cn", "2026-11-30", now), { wired: false, ran: null, line: NO_SCREEN });

  /* past the XSHG table */
  assert.deepEqual(await readScreen(ROOT, dir, "cn", "2027-01-04", now),
    { wired: true, ran: null, line: "cannot tell whether the screen ran: the A-share calendar does not cover 2027-01-03", skipped: 2 });
  assert.equal(SCREEN_RUNS_MAX, 200);
});

test("an analysis/ that cannot be read says so", async (t) => {
  if (process.getuid?.() === 0) {
    t.skip("root reads anything");
    return;
  }
  const dir = "strategies/screen-locked";
  const { chmod } = await import("node:fs/promises");
  await mkdir(join(ROOT, dir, "analysis"), { recursive: true });
  await chmod(join(ROOT, dir, "analysis"), 0o000);
  try {
    assert.deepEqual(await readScreen(ROOT, dir, "us", "2026-11-27", NOW()),
      { wired: true, ran: null, line: "cannot tell whether the screen ran: strategies/screen-locked/analysis/ cannot be read (EACCES)" });
  } finally {
    await chmod(join(ROOT, dir, "analysis"), 0o700);
  }
});

test("the newest sealed run is chosen by instant, not by string, and a later-sealed older-session run does not hide a covering one", async () => {
  const dir = "strategies/screen-instant";
  const runs: Record<string, object> = {
    "20261127T013000Z-000000b1": { kind: "market", session: "2026-11-27", sealed_at: "2026-11-27T09:30:00+08:00" },
    "20261127T020000Z-000000b2": { kind: "market", session: "2026-11-27", sealed_at: "2026-11-27T02:00:00Z" },
    "20261127T030000Z-000000b3": { kind: "market", session: "2026-11-26", sealed_at: "2026-11-27T03:00:00Z" },
  };
  for (const [id, manifest] of Object.entries(runs)) {
    await mkdir(join(ROOT, dir, "analysis", id), { recursive: true });
    await writeFile(join(ROOT, dir, "analysis", id, "run.json"), JSON.stringify(manifest));
  }
  const screen = await readScreen(ROOT, dir, "cn", "2026-11-30", Date.parse("2026-11-30T00:00:05Z"));
  assert.equal(screen.ran, true);
  assert.equal(screen.run?.id, "20261127T020000Z-000000b2");
  assert.equal(screen.line, "ran: Lunhui run 20261127T020000Z-000000b2 (market) sealed 2026-11-26 21:00 ET covers the 2026-11-27 session; artifacts: none");
});

test("previousSessionDate walks back over weekends and holidays, and refuses past the XSHG table", () => {
  assert.equal(previousSessionDate("cn", "2026-10-08"), "2026-09-30");
  assert.equal(previousSessionDate("us", "2026-11-30"), "2026-11-27");
  assert.equal(previousSessionDate("us", "2026-11-27"), "2026-11-25");
  assert.equal(previousSessionDate("cn", "2026-11-30"), "2026-11-27");
  assert.deepEqual(previousSessionDate("cn", "2027-01-04"), { error: "the A-share calendar does not cover 2027-01-03" });
  assert.deepEqual(previousSessionDate("cn", "2026-01-01"), { error: "the A-share calendar does not cover 2025-12-31" });
});

test("the screen leads the block, and a full levels file with a 5,000-character next keeps it inside the cap", async () => {
  const dir = "strategies/full";
  await mkdir(join(ROOT, dir), { recursive: true });
  const numbers = Array.from({ length: 25 }, (_, i) => `  k${i}: ${i}`).join("\n");
  await writeFile(join(ROOT, dir, "status.yaml"), `status: researching\nnext: ${"n".repeat(5_000)}\nnumbers:\n${numbers}\n`);
  const levels = Array.from({ length: 40 }, (_, i) =>
    `- symbol: NVDA\n  kind: watch\n  price: ${100 + i}\n  when: cross_up\n  plan: ${"p".repeat(300)}\n  source: ${"s".repeat(200)}\n  expires: 2026-12-31\n`).join("");
  const { r, text } = await report({ quotes: fakeSource(TABLE), root: ROOT, now: NOW }, { ...INPUT, dir, levels: { ...levelsOf(levels), file: `${dir}/levels.yml` } });
  assert.deepEqual(Object.keys(r), ["strategy", "market", "date", "takenAt", "session", "screen", "statusFile", "status", "quotes", "levels"]);
  assert.ok(text.slice(0, 32_768).includes('"screen":{"wired":'));
  assert.equal(r.status.next?.length, STATUS_TEXT_MAX);
  assert.ok(r.status.next?.endsWith("…"));
  assert.equal(Object.keys(r.status.numbers ?? {}).length, STATUS_NUMBERS_MAX + 1);
  assert.equal(r.status.numbers?.["…"], "5 more");
  assert.equal(r.status.numbers?.k19, "19");
  assert.equal(r.levels.rows.length, 40);
});

test("an unavailable source says so; a rejected market stands alone; a strategy with no levels calls no source", async () => {
  const unwired = fakeSource(TABLE, { unavailable: "no Market read is wired" });
  const u = await report({ quotes: unwired, root: ROOT, now: NOW });
  assert.deepEqual({ ok: u.out.ok, error: (u.out as { error?: string }).error }, { ok: false, error: "quotes unavailable: no Market read is wired" });
  assert.equal(unwired.calls.length, 0);
  assert.equal(u.r.quotesError, "quotes unavailable: no Market read is wired");
  assert.ok(u.r.quotes.every((q) => q.last === null && q.print === "none" && q.status === "unavailable" && q.feed === ""));
  assert.ok(u.r.levels.rows.every((row) => row.distancePct === null && row.closeDistancePct === null && row.crossedSinceClose === null));

  const cnBusy = await report({ quotes: fakeSource(TABLE, { reject: { cn: new HttpError(429, "busy") } }), root: ROOT, now: NOW });
  assert.equal(cnBusy.out.ok, true);
  assert.equal(cnBusy.r.quotesError, "A-share quotes unavailable: busy");
  assert.deepEqual(cnBusy.r.quotes[3], { symbol: "600519", market: "cn", feed: "", last: null, at: null, print: "none", prevClose: null, sinceClosePct: null, status: "unavailable" });
  assert.equal(cnBusy.r.quotes[0].last, 181.5);

  const usDown = await report({ quotes: fakeSource(TABLE, { reject: { us: new Error("the Account is not reachable") } }), root: ROOT, now: NOW });
  assert.equal(usDown.out.ok, true);
  assert.equal(usDown.r.quotesError, "US quotes unavailable: the Account is not reachable");
  assert.equal(usDown.r.quotes[3].last, 1398.5);

  const both = await report({ quotes: fakeSource(TABLE, { reject: { us: new HttpError(429, "x"), cn: new Error("timed out") } }), root: ROOT, now: NOW });
  assert.deepEqual({ ok: both.out.ok, error: (both.out as { error?: string }).error },
    { ok: false, error: "US quotes unavailable: busy; A-share quotes unavailable: timed out" });

  const priceless = await report({ quotes: fakeSource({ "us:NVDA": { quote_status: "unavailable" } }), root: ROOT, now: NOW });
  assert.deepEqual({ ok: priceless.out.ok, error: (priceless.out as { error?: string }).error },
    { ok: false, error: "quotes unavailable: the Market's read has no price for any symbol" });
  assert.equal(priceless.r.quotesError, "quotes unavailable: the Market's read has no price for any symbol");
  assert.deepEqual(priceless.r.quotes[0], { symbol: "NVDA", market: "us", feed: "robinhood", last: null, at: null, print: "none", prevClose: null, sinceClosePct: null, status: "unavailable" });
  assert.deepEqual(priceless.r.quotes[1], { symbol: "AAPL", market: "us", feed: "", last: null, at: null, print: "none", prevClose: null, sinceClosePct: null, status: "unavailable" });

  const quiet = fakeSource(TABLE);
  const none = await report({ quotes: quiet, root: ROOT, now: NOW }, { ...INPUT, levels: levelsOf(null) });
  assert.equal(none.out.ok, true);
  assert.equal(quiet.calls.length, 0);
  assert.deepEqual(none.r.quotes, []);
  assert.deepEqual(none.r.levels, { file: "strategies/demo/levels.yml", rows: [], refusals: [], missing: true });
});

test("a malformed, a missing and an unreadable status.yaml are named, not invented", async () => {
  const statusOf = async (name: string, content?: string): Promise<Pick<Report, "statusFile" | "status">> => {
    const dir = join(ROOT, "strategies", name);
    await mkdir(dir, { recursive: true });
    if (content === "dir") await mkdir(join(dir, "status.yaml"));
    else if (content === "link") await symlink(join(DEMO, "status.yaml"), join(dir, "status.yaml"));
    else if (content === "hardlink") {
      await writeFile(join(dir, "elsewhere.yaml"), STATUS);
      await link(join(dir, "elsewhere.yaml"), join(dir, "status.yaml"));
    }
    else if (content !== undefined) await writeFile(join(dir, "status.yaml"), content);
    const { r } = await report({ quotes: fakeSource(TABLE), root: ROOT, now: NOW }, { ...INPUT, dir: `strategies/${name}`, levels: levelsOf(null) });
    return { statusFile: r.statusFile, status: r.status };
  };
  assert.deepEqual(await statusOf("st-torn", "status: researching\none_line: [unclosed\n"), { statusFile: "malformed", status: { status: "researching" } });
  assert.deepEqual(await statusOf("st-list", "- a\n- b\n"), { statusFile: "malformed", status: {} });
  assert.deepEqual(await statusOf("st-scalar", "just words\n"), { statusFile: "malformed", status: {} });
  assert.deepEqual(await statusOf("st-empty", ""), { statusFile: "read", status: {} });
  assert.deepEqual(await statusOf("st-comment", "# x\n"), { statusFile: "read", status: {} });
  assert.deepEqual(await statusOf("st-none"), { statusFile: "missing", status: {} });
  assert.deepEqual(await statusOf("st-dir", "dir"), { statusFile: "unreadable", status: {} });
  assert.deepEqual(await statusOf("st-link", "link"), { statusFile: "unreadable", status: {} }, "a link is never followed, so readChannelStatus never reads its target");
  assert.deepEqual(await statusOf("st-hard", "hardlink"), { statusFile: "unreadable", status: {} }, "a second name is refused");
  assert.deepEqual(await statusOf("st-template", readFileSync(join(REPO, "strategies", "_template", "status.yaml"), "utf8")), { statusFile: "read", status: { status: "idea" } });
});

test("status.yaml is opened once, by the guarded read: nothing re-reads its path", async (t) => {
  const original = fsPromises.readFile;
  const read: string[] = [];
  t.mock.method(fsPromises, "readFile", async (...args: unknown[]) => {
    read.push(String(args[0]));
    return (original as (...a: unknown[]) => Promise<unknown>)(...args);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const { r } = await report({ quotes: fakeSource(TABLE), root: ROOT, now: NOW });
  assert.equal(r.statusFile, "read");
  assert.equal(r.status.one_line, ONE_LINE, "the values come from the guarded bytes");
  assert.deepEqual(read.filter((path) => path.endsWith("status.yaml")), []);
});

test("refused and expired levels are listed, not quoted", async () => {
  const text = `${LEVELS}- symbol: NVDA\n  kind: stop\n  price: 168\n  when: cross_down\n  plan: sell\n  expires: 2026-11-26\n- symbol: NVDA\n  kind: stop\n  price: 160\n  when: cross_down\n  expires: 2026-12-31\n`;
  const { r } = await report({ quotes: fakeSource(TABLE), root: ROOT, now: NOW }, { ...INPUT, levels: levelsOf(text) });
  assert.equal(r.levels.rows.length, 4);
  assert.deepEqual(r.levels.refusals.map((x) => [x.index, x.symbol, x.reason]), [
    [4, "NVDA", "expired 2026-11-26"], [5, "NVDA", "a level without a plan is refused: write what to do when it is reached"],
  ]);
  const bad = await report({ quotes: fakeSource(TABLE), root: ROOT, now: NOW }, { ...INPUT, levels: levelsOf("{ not a list") });
  assert.match(bad.r.levels.error ?? "", /^strategies\/demo\/levels\.yml is not YAML/);
  assert.deepEqual(bad.r.quotes, []);
});

test("the report reads the verified bytes, never the file, and refuses what is not its own", async () => {
  await writeFile(join(DEMO, "levels.yml"), "- symbol: MSFT\n  kind: watch\n  price: 400\n  when: cross_up\n  plan: x\n  expires: 2026-12-31\n");
  const source = fakeSource(TABLE);
  const { r } = await report({ quotes: source, root: ROOT, now: NOW });
  assert.deepEqual(r.levels.rows.map((row) => row.symbol), ["NVDA", "AAPL", "IBM", "600519"]);
  assert.doesNotMatch(JSON.stringify(source.calls), /MSFT/);
  const noLevels: ProducerInput = { ...INPUT };
  delete noLevels.levels;
  assert.deepEqual(await buildReport({ quotes: source, root: ROOT, now: NOW }, noLevels), { ok: false, error: "the firing carried no verified levels.yml" });
  for (const dir of ["desk", "strategies/_template", "strategies/../desk", "elsewhere/demo"]) {
    assert.deepEqual(await buildReport({ quotes: source, root: ROOT, now: NOW }, { ...INPUT, dir }), { ok: false, error: "builtin:report runs only in strategies/<name>" }, dir);
  }
});

test("reportProducer stops at its signal and never rejects", async () => {
  const gone = new AbortController();
  gone.abort(new Error("the deadline"));
  assert.deepEqual(await reportProducer({ quotes: fakeSource(TABLE), root: ROOT, now: NOW })(INPUT, gone.signal), { ok: false, error: "stopped: the deadline" });
  const hanging = { snapshot: () => new Promise<MarketQuotePayload>(() => {}) };
  const live = new AbortController();
  const pending = reportProducer({ quotes: hanging, root: ROOT, now: NOW })(INPUT, live.signal);
  setTimeout(() => live.abort(new Error("dispose")), 20);
  assert.deepEqual(await pending, { ok: false, error: "stopped: dispose" });
  const ok = await reportProducer({ quotes: fakeSource(TABLE), root: ROOT, now: NOW })(INPUT, new AbortController().signal);
  assert.equal(ok.ok, true);
  const thrower = { get unavailable(): string { throw new Error("boom"); }, snapshot: () => Promise.reject(new Error("never")) };
  assert.deepEqual(await reportProducer({ quotes: thrower, root: ROOT, now: NOW })(INPUT, new AbortController().signal), { ok: false, error: "the report failed: boom" });
});

/* ---------- the template ---------- */

test("the template's STANDING.md is the pre-market order, the screen first", () => {
  const bytes = readFileSync(join(REPO, "strategies", "_template", "STANDING.md"));
  assert.ok(bytes.length <= STANDING_TEXT_MAX_BYTES);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  for (const phrase of ["before the open", "broker app", "desk_quotes", "1,500 characters", "crossedSinceClose", "sinceClosePct", "no print since",
    "ROBINHOOD 07:58:03 ET, TENCENT 15:00:03 Beijing", "Never recommend a trade", "reports/<date>-premarket.md", "nothing else to report",
    "screen.line", "closeDistancePct", "with its feed and time", "screen line, status, levels and prices"]) assert.ok(text.includes(phrase), phrase);
  assert.ok(text.indexOf("1. The screen") < text.indexOf("2. The strategy"));
  assert.doesNotMatch(text, /Account/);
});

test("the template's levels.example.yml loads with no refusal", async () => {
  const l = await loadLevels(join(REPO, "strategies", "_template", "levels.example.yml"), "strategies/_template/levels.example.yml", "2026-10-20");
  assert.deepEqual(l.refusals, []);
  assert.equal(l.error, undefined);
  assert.deepEqual(l.entries.map((e) => e.kind), ["buy_zone", "stop", "watch"]);
  assert.equal(l.entries[2].market, "cn");
  assert.equal(l.entries[2].symbol, "600519");
});
