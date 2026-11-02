// face/tests/filings.test.ts
/** The filings' decisions (src/filings.ts), pure: the baseline (a symbol's first good poll seeds silently, a later
 * unseen accession is fresh, a failed symbol stays unseeded), the `filings.jsonl` records, every-symbol refusal, the
 * 07:00-20:00 ET window on XNYS session days, the 5-minute poll, and the symbols polled - US only, holdings first, at
 * most 60. 2026-11-30 is a Monday on EST (UTC-5); 2026-11-28 a Saturday. Offline. */
import test from "node:test";
import assert from "node:assert/strict";
import type { Holding, Level, Rule } from "../src/desk-book.ts";
import type { Filing } from "../src/edgar.ts";
import type { DayAnswer } from "../src/market-clock.ts";
import {
  FILINGS_ABORT_MS, FILINGS_LOOKBACK_DAYS, FILINGS_POLL_MS, FILINGS_STOP_AFTER_MS, FILINGS_SYMBOLS_MAX, FILINGS_WINDOW_MIN,
  allRefused, baselineFrom, diffFilings, filingSymbols, inFilingWindow, isFilingRecord, pollDue, seenKey,
  type FilingRecord,
} from "../src/filings.ts";

const T = (iso: string): number => Date.parse(iso);
const MON: DayAnswer = {
  ok: true, date: "2026-11-30", source: "builtin",
  session: { date: "2026-11-30", open: "2026-11-30T14:30:00Z", close: "2026-11-30T21:00:00Z", early: false },
};
const SAT: DayAnswer = { ok: true, date: "2026-11-28", session: "closed", source: "builtin" };

function filing(symbol: string, accession: string, over: Partial<Filing> = {}): Filing {
  return {
    symbol, cik: 1, accession, form: "8-K", filingDate: "2026-11-30", accepted: "2026-11-30T10:05:12-05:00", items: "2.02",
    primaryDocument: "d.htm", url: `https://www.sec.gov/Archives/edgar/data/1/${accession}/d.htm`, ...over,
  };
}

test("the constants", () => {
  assert.equal(FILINGS_POLL_MS, 300_000);
  assert.equal(FILINGS_STOP_AFTER_MS, 90_000);
  assert.equal(FILINGS_ABORT_MS, 120_000);
  assert.equal(FILINGS_LOOKBACK_DAYS, 7);
  assert.deepEqual(FILINGS_WINDOW_MIN, [420, 1200]);
  assert.equal(FILINGS_SYMBOLS_MAX, 60);
});

test("the first poll of a symbol seeds silently; a later unseen accession is fresh; a failed symbol stays unseeded", () => {
  const empty = baselineFrom([]);
  const first = diffFilings(empty, { filings: [filing("NVDA", "a-1"), filing("NVDA", "a-2")], errors: [{ symbol: "AAPL", error: "HTTP 500" }] }, ["NVDA", "AAPL", "MSFT"]);
  assert.deepEqual(first, { seed: [{ symbol: "NVDA", accessions: ["a-1", "a-2"] }, { symbol: "MSFT", accessions: [] }], fresh: [] });

  const records: FilingRecord[] = [
    ...first.seed.map((s) => ({ t: "2026-11-30T15:00:00Z", kind: "seeded" as const, ...s })),
  ];
  const base = baselineFrom(records);
  assert.deepEqual([...base.seeded].sort(), ["MSFT", "NVDA"]);
  assert.ok(base.seen.has(seenKey("NVDA", "a-1")));

  const next = diffFilings(base, {
    filings: [filing("NVDA", "a-3"), filing("NVDA", "a-3"), filing("NVDA", "a-1"), filing("MSFT", "m-1"), filing("AAPL", "p-1"), filing("TSLA", "t-1")],
    errors: [],
  }, ["NVDA", "AAPL", "MSFT"]);
  assert.deepEqual(next.seed, [{ symbol: "AAPL", accessions: ["p-1"] }], "AAPL's first good poll seeds it; TSLA is not polled");
  assert.deepEqual(next.fresh.map((f) => [f.symbol, f.accession]), [["NVDA", "a-3"], ["MSFT", "m-1"]]);

  // a seen record keeps its accession out of the next diff; another symbol's filing of the same accession is its own
  const seen = baselineFrom([...records, { t: "2026-11-30T15:05:00Z", kind: "seen", symbol: "NVDA", accession: "a-3", form: "8-K",
    filingDate: "2026-11-30", accepted: null, items: null, url: "u" }]);
  const third = diffFilings(seen, { filings: [filing("NVDA", "a-3"), filing("MSFT", "a-3")], errors: [] }, ["NVDA", "MSFT"]);
  assert.deepEqual(third.fresh.map((f) => [f.symbol, f.accession]), [["MSFT", "a-3"]]);
  // a seeded symbol that fails this poll yields nothing
  assert.deepEqual(diffFilings(seen, { filings: [], errors: [{ symbol: "NVDA", error: "deadline" }] }, ["NVDA"]), { seed: [], fresh: [] });
});

test("isFilingRecord takes the two records and nothing else; baselineFrom skips the rest", () => {
  const seeded = { t: "2026-11-30T15:00:00Z", kind: "seeded", symbol: "NVDA", accessions: ["a-1"] };
  const seen = { t: "2026-11-30T15:00:00Z", kind: "seen", symbol: "NVDA", accession: "a-2", form: "4", filingDate: "2026-11-30",
    accepted: "2026-11-30T10:05:12-05:00", items: null, url: "u" };
  assert.ok(isFilingRecord(seeded));
  assert.ok(isFilingRecord(seen));
  assert.ok(isFilingRecord({ ...seen, accepted: null, items: "2.02" }));
  for (const bad of [
    null, "x", [], { ...seeded, kind: "other" }, { ...seeded, t: 1 }, { ...seeded, accessions: [1] }, { ...seeded, accessions: "a-1" },
    { ...seeded, symbol: "" }, { ...seen, accession: undefined }, { ...seen, accepted: 3 }, { ...seen, items: undefined }, { ...seen, url: null },
  ]) assert.equal(isFilingRecord(bad), false, JSON.stringify(bad));
  const base = baselineFrom([seeded, seen, { kind: "seen" }, 7]);
  assert.deepEqual([...base.seeded], ["NVDA"]);
  assert.deepEqual([...base.seen].sort(), [seenKey("NVDA", "a-1"), seenKey("NVDA", "a-2")].sort());
});

test("allRefused names the error only when every symbol was refused", () => {
  const refused = { symbol: "NVDA", error: "refused: HTTP 403" };
  assert.equal(allRefused({ filings: [], errors: [refused, { symbol: "AAPL", error: "refused: HTTP 401" }] }, ["NVDA", "AAPL"]), "refused: HTTP 403");
  assert.equal(allRefused({ filings: [], errors: [refused] }, ["NVDA", "AAPL"]), undefined, "AAPL answered");
  assert.equal(allRefused({ filings: [], errors: [refused, { symbol: "AAPL", error: "deadline" }] }, ["NVDA", "AAPL"]), undefined);
  assert.equal(allRefused({ filings: [], errors: [] }, []), undefined);
  assert.equal(allRefused({ filings: [], errors: [] }, ["NVDA"]), undefined);
});

test("inFilingWindow and pollDue", () => {
  // inFilingWindow: accepted today inside 07:00-20:00 ET, on a session day; a null acceptance is judged at now
  const noon = T("2026-11-30T17:00:00Z");
  assert.equal(inFilingWindow("2026-11-30T10:05:12-05:00", MON, noon), true);
  assert.equal(inFilingWindow("2026-11-30T07:00:00-05:00", MON, noon), true);
  assert.equal(inFilingWindow("2026-11-30T06:30:00-05:00", MON, noon), false);
  assert.equal(inFilingWindow("2026-11-30T20:00:00-05:00", MON, T("2026-12-01T01:30:00Z")), false);
  assert.equal(inFilingWindow("2026-11-30T19:59:59-05:00", MON, T("2026-12-01T00:59:00Z")), true);
  assert.equal(inFilingWindow("2026-11-27T15:00:00-05:00", MON, noon), false, "yesterday");
  assert.equal(inFilingWindow("2026-11-28T10:00:00-05:00", SAT, T("2026-11-28T16:00:00Z")), false, "a Saturday");
  assert.equal(inFilingWindow(null, MON, T("2026-11-30T16:00:00Z")), true, "null at 11:00 ET");
  assert.equal(inFilingWindow(null, MON, T("2026-11-30T11:00:00Z")), false, "null at 06:00 ET");
  assert.equal(inFilingWindow("2026-11-30T10:05:12-05:00", { ok: false, date: "2026-11-30", error: "x" }, noon), false);
  assert.equal(inFilingWindow("2026-11-30T10:05:12-05:00", { ...MON, stale: { error: "x" } } as DayAnswer, noon), true);
  assert.equal(inFilingWindow("2026-11-30T10:05:12-05:00", undefined, noon), false);
  assert.equal(inFilingWindow("2026-11-30T10:05:12-05:00", { ...MON, date: "2026-11-27" } as DayAnswer, noon), false, "another date's answer");

  // pollDue: a session day, inside the window, 5 minutes after the last poll began
  const seven = T("2026-11-30T12:00:00Z");
  assert.equal(pollDue(seven - 60_000, undefined, MON), false, "06:59");
  assert.equal(pollDue(seven, undefined, MON), true, "07:00");
  assert.equal(pollDue(seven + 299_000, seven, MON), false, "4m59s later");
  assert.equal(pollDue(seven + 300_000, seven, MON), true);
  assert.equal(pollDue(T("2026-12-01T01:00:00Z"), undefined, MON), false, "20:00");
  assert.equal(pollDue(T("2026-11-28T15:00:00Z"), undefined, SAT), false, "a closed day");
  assert.equal(pollDue(seven, undefined, { ok: false, date: "2026-11-30", error: "x" }), false);
  assert.equal(pollDue(seven, undefined, undefined), false);
});

function holding(symbol: string): Holding {
  return { symbol, market: /^\d{6}$/.test(symbol) ? "cn" : "us", qty: 1, avgCost: 1 };
}
function level(symbol: string): Level {
  return { file: "desk/levels.yml", index: 0, symbol, market: "us", kind: "watch", price: 1, when: "cross_up", plan: "p", expires: "2026-12-31", annotate: false, cooldownMs: 0 };
}
function rule(kind: Rule["kind"], symbols: Partial<Rule["symbols"]>): Rule {
  const base = { file: "desk/rules.yml", index: 0, id: kind, symbols: { holdings: false, levels: false, symbols: [], ...symbols }, annotate: false };
  if (kind === "filing") return { ...base, kind, forms: ["8-K"], cooldownMs: 0 };
  if (kind === "gap") return { ...base, kind, gapPct: 3 };
  return { ...base, kind, movePct: 5, cooldownMs: 0 };
}

test("filingSymbols polls US symbols only, holdings first, at most 60", () => {
  const book = { holdings: [holding("TSLA"), holding("600519"), holding("AAPL")], levels: [level("NVDA"), level("AMD")] };
  const got = filingSymbols([
    rule("filing", { holdings: true, symbols: ["MSFT", "000001"] }),
    rule("filing", { levels: true, symbols: ["AAPL"] }),
    rule("move_pct", { symbols: ["IBM"] }),
  ], book);
  assert.deepEqual(got, { polled: ["TSLA", "AAPL", "AMD", "MSFT", "NVDA"], overCap: [], aShares: 2 });

  const many = Array.from({ length: 61 }, (_, i) => `S${String(i).padStart(2, "0")}`);
  const capped = filingSymbols([rule("filing", { holdings: true, symbols: many })], { holdings: [holding("ZZ")], levels: [] });
  assert.equal(capped.polled.length, 60);
  assert.equal(capped.polled[0], "ZZ");
  assert.deepEqual(capped.overCap, ["S59", "S60"]);
  const exact = filingSymbols([rule("filing", { symbols: many })], { holdings: [], levels: [] });
  assert.deepEqual(exact.overCap, ["S60"], "the 61st");
  assert.deepEqual(filingSymbols([], book), { polled: [], overCap: [], aShares: 0 });
});
