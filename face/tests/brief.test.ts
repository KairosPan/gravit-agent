// face/tests/brief.test.ts
/** The pre-close brief (src/brief.ts), `builtin:brief`, and the order it serves (desk/STANDING.md). The brief reads
 * the operator's book through the desk's loaders, takes ONE snapshot from the quote hub over the index ETFs, the
 * sector ETFs, the holdings and the levels' symbols, and prices the book from it: every price carries the feed and
 * New York's time, nothing is computed that the snapshot does not hold, and a file that is missing, refused or
 * unreadable - or a hub that throws - is named in the brief, never skipped. Every hub here is a fake. Offline; the
 * fixture roots sit under tests/tmp/brief-<pid>/ and are removed afterwards. */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BRIEF_INDEXES, BRIEF_SECTORS, NEAR_PCT, briefProducer, buildBrief, type Brief } from "../src/brief.ts";
import { loadHoldings, loadLevels } from "../src/desk-book.ts";
import { HttpError } from "../src/http.ts";
import type { ProducerInput, ProducerOutput } from "../src/producer.ts";
import type { LiveQuote, QuoteIdentity, QuotePayload } from "../src/quote-types.ts";
import { STANDING_TEXT_MAX_BYTES } from "../src/standing.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const TEST_DIR = join(HERE, "tmp", `brief-${process.pid}`);
after(() => rm(TEST_DIR, { recursive: true, force: true }));

/** The firing the brief is built for: the 2026-10-20 session, 09:30-16:00 ET. */
const INPUT: ProducerInput = {
  order: "preclose",
  firing: "preclose:2026-10-20",
  date: "2026-10-20",
  dir: "desk",
  session: { open: "2026-10-20T13:30:00Z", close: "2026-10-20T20:00:00Z", early: false },
};

/** 15:30:05 ET on the 20th: the brief is taken then. */
const NOW = Date.parse("2026-10-20T19:30:05Z");
/** 15:21:03 ET on the 20th: the snapshot's quotes are from then unless a test says otherwise. */
const AS_OF = "2026-10-20T19:21:03Z";

/** A fresh repository root under TEST_DIR holding `files` (repo-relative path → text); its path. */
async function makeRoot(name: string, files: Record<string, string>): Promise<string> {
  const root = join(TEST_DIR, name);
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

/** One price the fake hub knows: the last trade, the previous close, and the quote's time, feed and status. */
interface Priced {
  price: number;
  prev?: number;
  asOf?: string | null;
  feed?: string;
  status?: LiveQuote["quote_status"];
}

/** The hub's quote for `asset`: priced as `p` says - with a UI message the brief must leave out - or, without a
 * price, `unavailable` as the hub answers a symbol it has no trade for. */
function quoteOf(asset: QuoteIdentity, p: Priced | undefined): LiveQuote {
  const blank = {
    ...asset, transport: "poll" as const, change: null, change_pct: null, volume: null, received_at: null, volume_as_of: null,
    source: "Alpaca", basis: "previous_close" as const, market_status: "open" as const,
  };
  if (p === undefined) {
    return { ...blank, price: null, prev_close: null, as_of: null, feed: "iex", quote_status: "unavailable", message: "该标的暂无 Alpaca 行情" };
  }
  return {
    ...blank, price: p.price, prev_close: p.prev ?? null, as_of: p.asOf === undefined ? AS_OF : p.asOf, feed: p.feed ?? "iex",
    quote_status: p.status ?? "live", message: "最近成交时间较早，请留意行情时间。",
  };
}

/** A hub whose snapshot prices the symbols in `prices` (the rest have no price), recording each snapshot's assets;
 * with `fail`, every snapshot throws it after being recorded. */
function fakeHub(prices: Record<string, Priced>, fail?: Error) {
  const calls: QuoteIdentity[][] = [];
  const hub = {
    async snapshot(assets: QuoteIdentity[]): Promise<QuotePayload> {
      calls.push(assets);
      if (fail !== undefined) throw fail;
      return { ok: true, generated_at: "2026-10-20T19:30:05.000Z", quotes: assets.map((asset) => quoteOf(asset, prices[asset.symbol])), providers: [] };
    },
  };
  return { hub, calls };
}

/** The brief a producer output carries. */
function briefOf(out: ProducerOutput): Brief {
  assert.ok(out.text !== undefined, "the output carries the brief");
  return JSON.parse(out.text) as Brief;
}

/** A level entry as levels.yml spells it; `at` is `price: <n>` or `range: [<a>, <b>]`. */
const level = (symbol: string, kind: string, at: string, when: string, plan: string): string =>
  `- symbol: ${symbol}\n  kind: ${kind}\n  ${at}\n  when: ${when}\n  plan: ${plan}\n  expires: 2026-12-31\n`;

const HOLDINGS_YML = [
  "- symbol: NVDA", "  qty: 100", "  avg_cost: 120.5", "  opened: 2026-03-02", "  broker: IBKR",
  "- symbol: AAPL", "  qty: 10", "  avg_cost: 200", "",
].join("\n");

const LEVELS_YML = [
  level("NVDA", "stop", "price: 170", "cross_down", "if it closes below 170, sell half at the next open"),
  level("AAPL", "buy_zone", "price: 225", "cross_down", "buy 10 shares if SPY holds its 20-day average"),
  level("MSFT", "watch", "price: 400", "cross_up", "reread the thesis"),
].join("");

/** An index or sector ETF with no price, as the brief writes it. */
const unpriced = (symbol: string) => ({ symbol, last: null, chgPct: null, prevClose: null, at: null, status: "unavailable" });

test("the brief's constants are the plan's", () => {
  assert.deepEqual([...BRIEF_INDEXES], ["SPY", "QQQ", "IWM", "DIA"]);
  assert.deepEqual([...BRIEF_SECTORS], ["XLB", "XLC", "XLE", "XLF", "XLI", "XLK", "XLP", "XLRE", "XLU", "XLV", "XLY"]);
  assert.equal(NEAR_PCT, 2);
});

test("buildBrief prices indexes, sectors, holdings and near levels from one snapshot, labelled with the feed and the ET time", async () => {
  const root = await makeRoot("priced", { "desk/holdings.yml": HOLDINGS_YML, "desk/levels.yml": LEVELS_YML });
  /* edited at 09:05 ET the same day */
  await utimes(join(root, "desk", "holdings.yml"), new Date("2026-10-20T13:05:00Z"), new Date("2026-10-20T13:05:00Z"));
  const hub = fakeHub({ SPY: { price: 581.23, prev: 583.68 }, NVDA: { price: 181.2, prev: 179.05 }, AAPL: { price: 228.9 }, MSFT: { price: 420 } });

  const out = await buildBrief({ hub: hub.hub, root, now: () => NOW }, INPUT);

  assert.equal(hub.calls.length, 1, "one snapshot");
  assert.equal(hub.calls[0][0].symbol, "SPY");
  assert.deepEqual(hub.calls[0], [...BRIEF_INDEXES, ...BRIEF_SECTORS, "NVDA", "AAPL", "MSFT"].map((symbol) => ({ id: `us:${symbol}`, market: "us", symbol })),
    "indexes, sectors, holdings, then the levels' symbols, each once");
  assert.equal(out.ok, true);
  const b = briefOf(out);
  assert.deepEqual(b.indexes[0], { symbol: "SPY", last: 581.23, chgPct: -0.42, prevClose: 583.68, at: "IEX 15:21:03 ET", status: "live" });
  assert.equal(b.takenAt, "15:30:05 ET");
  assert.equal(b.notYet, "alerts, suppressed alerts and filings arrive with the watch (P3)");
  assert.deepEqual(b, {
    date: "2026-10-20",
    takenAt: "15:30:05 ET",
    session: { open: "09:30 ET", close: "16:00 ET", early: false },
    indexes: [
      { symbol: "SPY", last: 581.23, chgPct: -0.42, prevClose: 583.68, at: "IEX 15:21:03 ET", status: "live" },
      unpriced("QQQ"), unpriced("IWM"), unpriced("DIA"),
    ],
    sectors: BRIEF_SECTORS.map(unpriced),
    holdings: {
      file: "desk/holdings.yml",
      edited: "09:05 ET",
      rows: [
        {
          symbol: "NVDA", last: 181.2, chgPct: 1.2, prevClose: 179.05, at: "IEX 15:21:03 ET", status: "live",
          qty: 100, avgCost: 120.5, opened: "2026-03-02", broker: "IBKR", dayPnl: 215, openPnl: 6070,
          stop: { price: 170, distancePct: -6.18, file: "desk/levels.yml" }, target: null, noStop: false,
        },
        {
          symbol: "AAPL", last: 228.9, chgPct: null, prevClose: null, at: "IEX 15:21:03 ET", status: "live",
          qty: 10, avgCost: 200, dayPnl: null, openPnl: 289, stop: null, target: null, noStop: true,
        },
      ],
      refusals: [],
    },
    levels: {
      files: ["desk/levels.yml"],
      loaded: 3,
      near: [{
        symbol: "AAPL", kind: "buy_zone", price: 225, when: "cross_down", plan: "buy 10 shares if SPY holds its 20-day average",
        file: "desk/levels.yml", last: 228.9, at: "IEX 15:21:03 ET", distancePct: -1.7,
      }],
      refusals: [],
      errors: [],
    },
    notYet: "alerts, suppressed alerts and filings arrive with the watch (P3)",
  }, "MSFT's watch is 4.76% away, so it is not near; NVDA's stop is 6.18% away");
  assert.ok(!(out.text ?? "").includes("最近成交"), "the hub's UI message is left out");
});

test("a quote from another ET day is dated, and so is a holdings file edited on one", async () => {
  const root = await makeRoot("dated", { "desk/holdings.yml": "- symbol: SPY\n  qty: 20\n  avg_cost: 560\n" });
  /* 18:00 ET on the 19th */
  await utimes(join(root, "desk", "holdings.yml"), new Date("2026-10-19T22:00:00Z"), new Date("2026-10-19T22:00:00Z"));
  const hub = fakeHub({ SPY: { price: 583.68, prev: 580.1, asOf: "2026-10-19T19:59:58Z" } });
  const b = briefOf(await buildBrief({ hub: hub.hub, root, now: () => NOW }, INPUT));
  assert.equal(b.indexes[0].at, "IEX 2026-10-19 15:59:58 ET");
  assert.equal(b.holdings.edited, "2026-10-19 18:00 ET");
  assert.deepEqual(hub.calls[0].filter((asset) => asset.symbol === "SPY").length, 1, "a held index is asked for once");
  assert.equal(b.holdings.rows[0].at, "IEX 2026-10-19 15:59:58 ET", "the holding shares the index's quote");
  assert.equal(b.holdings.rows[0].dayPnl, 71.6);
});

test("the session is shown in New York's time, an early close included", async () => {
  const root = await makeRoot("early", {});
  const early: ProducerInput = {
    ...INPUT, firing: "preclose:2026-11-27", date: "2026-11-27",
    session: { open: "2026-11-27T14:30:00Z", close: "2026-11-27T18:00:00Z", early: true },
  };
  const b = briefOf(await buildBrief({ hub: fakeHub({}).hub, root, now: () => Date.parse("2026-11-27T17:30:04Z") }, early));
  assert.equal(b.date, "2026-11-27");
  assert.deepEqual(b.session, { open: "09:30 ET", close: "13:00 ET", early: true });
  assert.equal(b.takenAt, "12:30:04 ET");
});

test("a hub that throws still gives a block that says the prices are unavailable", async () => {
  const root = await makeRoot("throws", { "desk/holdings.yml": HOLDINGS_YML, "desk/levels.yml": LEVELS_YML });
  const hub = fakeHub({ SPY: { price: 581.23, prev: 583.68 } }, new HttpError(429, "busy"));

  const out = await buildBrief({ hub: hub.hub, root, now: () => NOW }, INPUT);

  assert.equal(hub.calls.length, 1, "asked once, never retried");
  assert.equal(out.ok, false);
  assert.equal((out as { error: string }).error, "quotes unavailable: busy");
  const b = briefOf(out);
  assert.equal(b.quotesError, "quotes unavailable: busy");
  for (const quote of [...b.indexes, ...b.sectors, ...b.holdings.rows]) {
    assert.equal(quote.last, null, quote.symbol);
    assert.equal(quote.at, null, quote.symbol);
    assert.equal(quote.status, "unavailable", quote.symbol);
  }
  assert.deepEqual(b.holdings.rows.map((row) => [row.symbol, row.dayPnl, row.openPnl, row.noStop]), [["NVDA", null, null, false], ["AAPL", null, null, true]],
    "the holdings rows are present: the files were still read");
  assert.deepEqual(b.holdings.rows[0].stop, { price: 170, distancePct: null, file: "desk/levels.yml" }, "a stop with no price to measure from");
  assert.deepEqual(b.levels.near, []);
  assert.equal(b.levels.loaded, 3);
  assert.equal(b.takenAt, "15:30:05 ET");
});

test("missing, broken and unlistable inputs are named, not invented", async () => {
  /* No holdings file; a levels file that is not a list. */
  const broken = await makeRoot("broken", { "desk/levels.yml": "a: 1\n" });
  const one = await buildBrief({ hub: fakeHub({}).hub, root: broken, now: () => NOW }, INPUT);
  assert.equal(one.ok, true, "the producer is still ok");
  const b1 = briefOf(one);
  assert.deepEqual(b1.holdings, { file: "desk/holdings.yml", edited: null, missing: true, rows: [], refusals: [] });
  assert.deepEqual(b1.levels, {
    files: ["desk/levels.yml"], loaded: 0, near: [], refusals: [],
    errors: [{ file: "desk/levels.yml", error: "desk/levels.yml must be a list of entries" }],
  });

  /* A file named strategies: the strategies cannot be listed. */
  const unlistable = await makeRoot("unlistable", { strategies: "not a directory\n" });
  const two = await buildBrief({ hub: fakeHub({}).hub, root: unlistable, now: () => NOW }, INPUT);
  assert.equal(two.ok, true, "the producer is still ok");
  assert.deepEqual(briefOf(two).levels, { files: [], loaded: 0, near: [], refusals: [], errors: [{ file: "strategies/", error: "ENOTDIR" }] });

  /* Refused entries ride along exactly as the loaders give them; an expired stop is no stop. */
  const refusing = await makeRoot("refusing", {
    "desk/holdings.yml": "- symbol: NVDA\n  qty: 100\n  avg_cost: 120.5\n- symbol: TSLA\n  qty: 0\n  avg_cost: 250\n",
    "desk/levels.yml": "- symbol: NVDA\n  kind: stop\n  price: 170\n  when: cross_down\n  plan: sell half\n  expires: 2026-10-01\n",
  });
  const b3 = briefOf(await buildBrief({ hub: fakeHub({ NVDA: { price: 181.2 } }).hub, root: refusing, now: () => NOW }, INPUT));
  const holdings = await loadHoldings(join(refusing, "desk", "holdings.yml"), "desk/holdings.yml");
  const levels = await loadLevels(join(refusing, "desk", "levels.yml"), "desk/levels.yml", INPUT.date);
  assert.equal(holdings.refusals.length, 1);
  assert.equal(levels.refusals.length, 1);
  assert.deepEqual(b3.holdings.refusals, holdings.refusals);
  assert.deepEqual(b3.levels.refusals, levels.refusals);
  assert.deepEqual(b3.holdings.rows.map((row) => [row.symbol, row.noStop, row.stop]), [["NVDA", true, null]]);
  assert.equal(b3.levels.loaded, 0);

  /* A date the levels loader refuses costs each levels file, never the brief: the holdings still price. */
  const misdated = briefOf(await buildBrief({ hub: fakeHub({ NVDA: { price: 181.2 } }).hub, root: refusing, now: () => NOW }, { ...INPUT, date: "2026-13-45" }));
  assert.deepEqual(misdated.levels.errors.map((error) => error.file), ["desk/levels.yml"]);
  assert.match(misdated.levels.errors[0].error, /2026-13-45/);
  assert.deepEqual(misdated.holdings.rows.map((row) => [row.symbol, row.last]), [["NVDA", 181.2]]);

  /* A holdings file that is not YAML is the block's error, with no rows. */
  const garbled = await makeRoot("garbled", { "desk/holdings.yml": "- symbol: NVDA\n\tqty: 1\n" });
  const b4 = briefOf(await buildBrief({ hub: fakeHub({}).hub, root: garbled, now: () => NOW }, INPUT));
  const garbledLoad = await loadHoldings(join(garbled, "desk", "holdings.yml"), "desk/holdings.yml");
  assert.ok(garbledLoad.error !== undefined);
  assert.equal(b4.holdings.error, garbledLoad.error);
  assert.deepEqual(b4.holdings.rows, []);
  assert.equal(b4.holdings.missing, undefined);
});

test("a strategy's levels.yml gives a holding its stop; the template, hidden directories and the root's are not read", async () => {
  const root = await makeRoot("strategy", {
    "desk/holdings.yml": "- symbol: NVDA\n  qty: 100\n  avg_cost: 120.5\n- symbol: AAPL\n  qty: 10\n  avg_cost: 200\n",
    "strategies/demo/levels.yml": level("NVDA", "stop", "price: 165", "cross_down", "sell all at the next open"),
    "strategies/_template/levels.yml": level("AAPL", "stop", "price: 210", "cross_down", "a template's stop"),
    "strategies/.hidden/levels.yml": level("AAPL", "stop", "price: 211", "cross_down", "a hidden stop"),
    "levels.yml": level("AAPL", "stop", "price: 212", "cross_down", "the root's stop"),
    "strategies/zeta/levels.yml": "x: 2\n",
  });
  const b = briefOf(await buildBrief({ hub: fakeHub({ NVDA: { price: 181.2 }, AAPL: { price: 228.9 } }).hub, root, now: () => NOW }, INPUT));
  const [nvda, aapl] = b.holdings.rows;
  assert.equal(nvda.noStop, false);
  assert.deepEqual(nvda.stop, { price: 165, distancePct: -8.94, file: "strategies/demo/levels.yml" });
  assert.equal(aapl.noStop, true);
  assert.equal(aapl.stop, null);
  assert.deepEqual(b.levels.files, ["strategies/demo/levels.yml", "strategies/zeta/levels.yml"], "desk/levels.yml is missing, which is no fault");
  assert.equal(b.levels.loaded, 1);
  assert.deepEqual(b.levels.errors, [{ file: "strategies/zeta/levels.yml", error: "strategies/zeta/levels.yml must be a list of entries" }]);
});

test("the nearest stop and target win, a range is measured to its nearest edge, and near levels come nearest first", async () => {
  const root = await makeRoot("nearest", {
    "desk/holdings.yml": "- symbol: NVDA\n  qty: 100\n  avg_cost: 120.5\n- symbol: MSFT\n  qty: -5\n  avg_cost: 440\n",
    "desk/levels.yml": [
      level("NVDA", "stop", "price: 160", "cross_down", "sell all"),
      level("NVDA", "target", "price: 185", "cross_up", "sell a tenth"),
      level("NVDA", "target", "price: 210", "cross_up", "sell a third"),
      level("TSLA", "watch", "range: [200, 210]", "enter", "read the delivery numbers"),
      level("AMD", "watch", "range: [150, 155]", "enter", "check the guidance"),
      level("MSFT", "stop", "range: [430, 435]", "enter", "cover the short"),
    ].join(""),
    "strategies/alpha/levels.yml": [
      level("NVDA", "stop", "price: 175", "cross_down", "sell half"),
      level("AAPL", "buy_zone", "range: [225, 230]", "enter", "buy 10 shares"),
    ].join(""),
    /* a tie with alpha's stop, in a later file, then the farthest stop last: neither wins */
    "strategies/beta/levels.yml": [
      level("NVDA", "stop", "price: 175", "cross_down", "sell a quarter"),
      level("NVDA", "stop", "price: 150", "cross_down", "sell the rest"),
    ].join(""),
  });
  const hub = fakeHub({ NVDA: { price: 181.2, prev: 179.05 }, MSFT: { price: 420, prev: 422 }, AAPL: { price: 228.9 }, AMD: { price: 158 }, TSLA: { price: 195 } });
  const b = briefOf(await buildBrief({ hub: hub.hub, root, now: () => NOW }, INPUT));

  const [nvda, msft] = b.holdings.rows;
  assert.deepEqual(nvda.stop, { price: 175, distancePct: -3.42, file: "strategies/alpha/levels.yml" },
    "the nearest of four stops, from any file; on a tie, the first file's");
  assert.deepEqual(nvda.target, { price: 185, distancePct: 2.1, file: "desk/levels.yml" }, "the nearer of two targets, though it comes first");
  assert.deepEqual(msft.stop, { range: [430, 435], distancePct: 2.38, file: "desk/levels.yml" }, "a range stop, to its nearest edge");
  assert.equal(msft.dayPnl, 10, "a short gains when the price falls");
  assert.equal(msft.openPnl, 100);
  assert.deepEqual(b.levels.near.map((near) => [near.symbol, near.distancePct]), [["AAPL", 0], ["AMD", -1.9]],
    "inside a range is 0; AMD is 1.9% under its range's top; TSLA (2.56%), NVDA's target (2.1%) and MSFT's stop (2.38%) are not near");
  assert.deepEqual(b.levels.near[0], {
    symbol: "AAPL", kind: "buy_zone", range: [225, 230], when: "enter", plan: "buy 10 shares",
    file: "strategies/alpha/levels.yml", last: 228.9, at: "IEX 15:21:03 ET", distancePct: 0,
  });
  assert.deepEqual(b.levels.files, ["desk/levels.yml", "strategies/alpha/levels.yml", "strategies/beta/levels.yml"]);
  assert.equal(b.levels.loaded, 10);
  assert.deepEqual(hub.calls[0].slice(BRIEF_INDEXES.length + BRIEF_SECTORS.length).map((asset) => asset.symbol), ["NVDA", "MSFT", "TSLA", "AMD", "AAPL"]);
});

test("the sector ETFs come strongest first, those without a move after them in their own order; the indexes keep theirs", async () => {
  const root = await makeRoot("sectors", {});
  const hub = fakeHub({
    SPY: { price: 99.5, prev: 100 }, QQQ: { price: 101, prev: 100 }, DIA: { price: 100.2, prev: 100 },
    XLK: { price: 101.5, prev: 100 }, XLE: { price: 97.9, prev: 100 }, XLF: { price: 100.3, prev: 100 }, XLV: { price: 99.5, prev: 100 },
    XLU: { price: 80 }, XLY: { price: 210, prev: 200, asOf: null, status: "unavailable" },
  });
  const b = briefOf(await buildBrief({ hub: hub.hub, root, now: () => NOW }, INPUT));
  assert.deepEqual(b.sectors.map((quote) => [quote.symbol, quote.chgPct]), [
    ["XLK", 1.5], ["XLF", 0.3], ["XLV", -0.5], ["XLE", -2.1],
    ["XLB", null], ["XLC", null], ["XLI", null], ["XLP", null], ["XLRE", null], ["XLU", null], ["XLY", null],
  ]);
  assert.equal(b.sectors.find((quote) => quote.symbol === "XLU")?.last, 80, "a price without a previous close has no move");
  assert.deepEqual(b.sectors.find((quote) => quote.symbol === "XLY"),
    { symbol: "XLY", last: null, chgPct: null, prevClose: 200, at: null, status: "unavailable" }, "a price that cannot name its time is not shown");
  assert.deepEqual(b.indexes.map((quote) => [quote.symbol, quote.chgPct]), [["SPY", -0.5], ["QQQ", 1], ["IWM", null], ["DIA", 0.2]]);
});

test("briefProducer is the brief as a builtin: it stops with its signal and never rejects", async () => {
  const root = await makeRoot("producer", { "desk/holdings.yml": HOLDINGS_YML, "desk/levels.yml": LEVELS_YML });
  const hub = fakeHub({ SPY: { price: 581.23, prev: 583.68 } });
  const produce = briefProducer({ hub: hub.hub, root, now: () => NOW });
  assert.deepEqual(await produce(INPUT, new AbortController().signal), await buildBrief({ hub: hub.hub, root, now: () => NOW }, INPUT));

  const aborted = new AbortController();
  aborted.abort(new Error("the producer's deadline"));
  const before = hub.calls.length;
  assert.deepEqual(await produce(INPUT, aborted.signal), { ok: false, error: "stopped: the producer's deadline" });
  assert.equal(hub.calls.length, before, "an aborted signal starts nothing");

  let asked = 0;
  const hanging = briefProducer({ hub: { snapshot: () => { asked += 1; return new Promise<QuotePayload>(() => {}); } }, root, now: () => NOW });
  const controller = new AbortController();
  const pending = hanging(INPUT, controller.signal);
  const waitUntil = Date.now() + 5_000;
  while (asked === 0 && Date.now() < waitUntil) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(asked, 1, "the brief read its files and reached its one snapshot");
  controller.abort();
  const stopped = await pending;
  assert.equal(stopped.ok, false);
  assert.match((stopped as { error: string }).error, /^stopped: /);

  const throwing = briefProducer({ hub: { snapshot: () => { throw new Error("no hub"); } }, root, now: () => NOW });
  const failed = await throwing(INPUT, new AbortController().signal);
  assert.equal(failed.ok, false);
  assert.equal((failed as { error: string }).error, "quotes unavailable: no hub", "a hub that throws at once is the same failure");

  const broken = briefProducer({ hub: hub.hub, root, now: () => { throw new Error("no clock"); } });
  assert.deepEqual(await broken(INPUT, new AbortController().signal), { ok: false, error: "the brief failed: no clock" }, "anything unexpected resolves, never rejects");
});

test("desk/STANDING.md is the pre-close order", () => {
  const bytes = readFileSync(join(REPO, "desk", "STANDING.md"));
  assert.ok(bytes.length <= STANDING_TEXT_MAX_BYTES);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  for (const phrase of ["before the close", "broker app", "desk_quotes", "1,500 characters", "no stop on file", "nothing else happened",
    "IEX 15:21:03 ET", "desk/holdings.yml", "Never recommend a trade", "briefs/<date>-preclose.md"]) assert.ok(text.includes(phrase), phrase);
  assert.ok(text.startsWith("# The pre-close brief\n\n"), "it opens with its title");
  assert.ok(text.endsWith("under your directory.\n"), "it ends with the save, and one newline");
});
