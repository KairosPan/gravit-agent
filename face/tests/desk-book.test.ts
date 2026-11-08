// face/tests/desk-book.test.ts
/** The desk's book (src/desk-book.ts): `holdings.yml` and `levels.yml` read under CORE_SCHEMA. Each bad entry
 * is refused by its index with one reason and the rest load; past a cap, one refusal names the entries; a
 * missing file is `missing`, and an oversized, irregular, unreadable, non-UTF-8, non-YAML or non-list file is
 * an `error` with no entries. A link - symbolic or hard - is refused unopened, so nothing of another file is
 * ever echoed; what a refusal does echo is one line, bounded, with no raw control or direction character, and a
 * plan, a source or a broker holding one is refused. The tracked examples load with no refusal. `rules.yml` is
 * read the same way: each bad rule refused by index, a halt refused, an A share refused from a filing rule, and
 * the tracked `desk/rules.yml` loads clean. Offline; the
 * fixtures sit under tests/tmp/desk-book-<pid>/ and are removed afterwards. */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fsPromises, { chmod, link, lstat, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_LEVEL_COOLDOWN_MS, DESK_FILE_MAX_BYTES, FILING_FORMS, HOLDINGS_MAX, LEVELS_PER_FILE, PLAN_MAX_CHARS, RULE_KINDS, RULE_PCT_MAX,
  RULES_MAX, SOURCE_MAX_CHARS, SYMBOL_RE,
  levelDistancePct, loadHoldings, loadLevels, loadRules, parseLevels, readDeskFile, resolveSymbols, type Holding, type Level, type LoadRefusal, type Rule,
} from "../src/desk-book.ts";
import { readDeskYaml, sha256Hex } from "../src/standing.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const TEST_DIR = join(HERE, "tmp", `desk-book-${process.pid}`);
after(() => rm(TEST_DIR, { recursive: true, force: true }));

/** The labels the fixtures load under. */
const LEVELS = "desk/levels.yml";
const HOLDINGS = "desk/holdings.yml";
/** The ET date the levels are judged on. */
const TODAY = "2026-10-20";

let made = 0;
/** A fresh fixture file holding `content`; its path. */
async function fixture(content: string | Uint8Array): Promise<string> {
  await mkdir(TEST_DIR, { recursive: true });
  made += 1;
  const path = join(TEST_DIR, `book-${made}.yml`);
  await writeFile(path, content);
  return path;
}

/** A level that loads: `watch` at `price`, `cross_up`, with a plan and an expiry. */
const goodLevel = (symbol: string, price: number): string =>
  `- symbol: ${symbol}\n  kind: watch\n  price: ${price}\n  when: cross_up\n  plan: read the news\n  expires: 2026-12-31\n`;

test("the limits are the brief's", () => {
  assert.equal(DESK_FILE_MAX_BYTES, 65_536);
  assert.equal(LEVELS_PER_FILE, 40);
  assert.equal(HOLDINGS_MAX, 60);
  assert.equal(PLAN_MAX_CHARS, 300);
  assert.equal(SOURCE_MAX_CHARS, 200);
  assert.equal(DEFAULT_LEVEL_COOLDOWN_MS, 1_800_000);
  for (const symbol of ["A", "NVDA", "BRK.B", "BF-B", "ABCDEFGHIJ"]) assert.ok(SYMBOL_RE.test(symbol), symbol);
  for (const symbol of ["", "nvda", "1A", ".A", "ABCDEFGHIJK", "NV DA", "NVDA\n"]) assert.ok(!SYMBOL_RE.test(symbol), JSON.stringify(symbol));
});

test("the shipped examples load with no refusal", async () => {
  const holdingsPath = join(REPO, "desk", "holdings.example.yml");
  const h = await loadHoldings(holdingsPath, "desk/holdings.example.yml");
  assert.equal(h.error, undefined);
  assert.deepEqual(h.refusals, []);
  assert.ok(h.entries.length >= 2);
  assert.deepEqual(h.entries.map((e) => [e.symbol, e.qty, e.avgCost]), [["NVDA", 100, 120.5], ["SPY", 20, 560]]);

  const levelsPath = join(REPO, "desk", "levels.example.yml");
  const l = await loadLevels(levelsPath, "desk/levels.example.yml", "2026-10-20");
  assert.equal(l.error, undefined);
  assert.deepEqual(l.refusals, []);
  assert.deepEqual(new Set(l.entries.map((e) => e.kind)), new Set(["stop", "buy_zone", "target", "watch"]));
  assert.ok(l.entries.every((e) => e.expires === "2026-12-31"));

  /* Each opens with a two-line comment and, between its entries, uses every key the loader takes. */
  const keys = async (path: string): Promise<{ head: string[]; used: Set<string> }> => {
    const text = await readFile(path, "utf8");
    const list = readDeskYaml(text) as Record<string, unknown>[];
    return { head: text.split("\n").slice(0, 3), used: new Set(list.flatMap((entry) => Object.keys(entry))) };
  };
  const hk = await keys(holdingsPath);
  assert.ok(hk.head[0].startsWith("# ") && hk.head[1].startsWith("# ") && !hk.head[2].startsWith("#"), hk.head.join("|"));
  assert.deepEqual(hk.used, new Set(["symbol", "qty", "avg_cost", "opened", "broker"]));
  const lk = await keys(levelsPath);
  assert.ok(lk.head[0].startsWith("# ") && lk.head[1].startsWith("# ") && !lk.head[2].startsWith("#"), lk.head.join("|"));
  assert.deepEqual(lk.used, new Set(["symbol", "kind", "price", "range", "when", "plan", "source", "expires", "annotate", "cooldown"]));
});

test("each bad level is refused by index and the rest load", async () => {
  const path = await fixture(`- symbol: NVDA
  kind: stop
  price: 170
  when: cross_down
  plan: sell half at the next open
  source: the August swing low
  expires: 2026-12-31
- symbol: AAPL
  kind: watch
  price: 230
  when: cross_up
  expires: 2026-12-31
- symbol: MSFT
  kind: watch
  price: 400
  when: cross_up
  plan: read the news
- symbol: AMD
  kind: watch
  price: 150
  when: cross_up
  plan: read the news
  expires: 2026-10-01
- symbol: TSLA
  kind: watch
  price: 250
  trigger: 250
  plan: read the news
  expires: 2026-12-31
- symbol: META
  kind: watch
  price: 600
  when: sideways
  plan: read the news
  expires: 2026-12-31
- symbol: GOOG
  kind: buy_zone
  price: 160
  range: [158, 162]
  when: enter
  plan: buy ten shares
  expires: 2026-12-31
- symbol: AMZN
  kind: watch
  price: 190
  when: cross_up
  plan: |
    read the news
    then decide
  expires: 2026-12-31
- symbol: NFLX
  kind: watch
  price: 700
  when: cross_up
  plan: ${"x".repeat(301)}
  expires: 2026-12-31
- symbol: AVGO
  kind: watch
  price: 1700
  when: enter
  plan: read the news
  expires: 2026-12-31
- symbol: nvda
  kind: watch
  price: 180
  when: cross_up
  plan: read the news
  expires: 2026-12-31
- symbol: ORCL
  kind: watch
  price: 120
  when: cross_up
  plan: read the news
  expires: 2026-12-31
  annotate: yes
- symbol: CRM
  kind: watch
  price: 250
  when: cross_up
  plan: read the news
  expires: 2026-12-31
  cooldown: 2h
- symbol: SPY
  kind: buy_zone
  range: [550, 560]
  when: enter
  plan: >
    add five shares
    if breadth holds
  expires: 2026-10-20
`);
  const l = await loadLevels(path, LEVELS, TODAY);
  assert.equal(l.error, undefined);
  assert.equal(l.missing, undefined);
  const refusal = (index: number, symbol: string | undefined, reason: string): LoadRefusal =>
    ({ file: LEVELS, index, ...(symbol === undefined ? {} : { symbol }), reason });
  assert.deepEqual(l.refusals, [
    refusal(1, "AAPL", "a level without a plan is refused: write what to do when it is reached"),
    refusal(2, "MSFT", "a level without an expiry is refused: write expires: YYYY-MM-DD, the last day it holds"),
    refusal(3, "AMD", "expired 2026-10-01"),
    refusal(4, "TSLA", 'unknown key "trigger"'),
    refusal(5, "META", 'when must be cross_up, cross_down or enter (got "sideways")'),
    refusal(6, "GOOG", "price and range are both set; a level takes one or the other"),
    refusal(7, "AMZN", "plan must be one line"),
    refusal(8, "NFLX", "plan is 301 characters; the limit is 300"),
    refusal(9, "AVGO", "when: enter takes a range; with a price, when is cross_up or cross_down"),
    refusal(10, undefined, 'symbol must be a US ticker (NVDA, BRK.B) or six digits for an A share (600519) (got "nvda")'),
    refusal(11, "ORCL", 'annotate must be true or false (got "yes")'),
    refusal(12, "CRM", 'cooldown must be <n>m, from 1m to 1440m (got "2h")'),
  ]);
  const want: Level[] = [
    {
      file: LEVELS, index: 0, symbol: "NVDA", market: "us", kind: "stop", price: 170, when: "cross_down", plan: "sell half at the next open",
      source: "the August swing low", expires: "2026-12-31", annotate: true, cooldownMs: 1_800_000,
    },
    /* A folded plan is one line once its final newline is trimmed; an expiry of today still holds. */
    {
      file: LEVELS, index: 13, symbol: "SPY", market: "us", kind: "buy_zone", range: [550, 560], when: "enter", plan: "add five shares if breadth holds",
      expires: "2026-10-20", annotate: true, cooldownMs: 1_800_000,
    },
  ];
  assert.deepEqual(l.entries, want);
});

test("the other faults of a level, one refusal each, the first fault in key order", async () => {
  const entries: [string, string][] = [
    ["- just a ticker\n", "a level must be a mapping: symbol, kind, price or range, when, plan, source, expires, annotate, cooldown"],
    ["- kind: watch\n  price: 1\n  when: cross_up\n  plan: p\n  expires: 2026-12-31\n", "symbol is missing"],
    ["- symbol: A\n  price: 1\n  when: cross_up\n  plan: p\n  expires: 2026-12-31\n", "kind is missing"],
    ["- symbol: A\n  kind: support\n  price: 1\n  when: cross_up\n  plan: p\n  expires: 2026-12-31\n", 'kind must be buy_zone, stop, target or watch (got "support")'],
    ["- symbol: A\n  kind: watch\n  when: cross_up\n  plan: p\n  expires: 2026-12-31\n", "a level needs a price or a range"],
    ["- symbol: A\n  kind: watch\n  price: 0\n  when: cross_up\n  plan: p\n  expires: 2026-12-31\n", "price must be a number above 0 (got 0)"],
    ["- symbol: A\n  kind: watch\n  price: \"170\"\n  when: cross_up\n  plan: p\n  expires: 2026-12-31\n", 'price must be a number above 0 (got "170")'],
    ["- symbol: A\n  kind: watch\n  price: .inf\n  when: cross_up\n  plan: p\n  expires: 2026-12-31\n", "price must be a number above 0 (got Infinity)"],
    ["- symbol: A\n  kind: buy_zone\n  range: [222, 218]\n  when: enter\n  plan: p\n  expires: 2026-12-31\n", "range must be [low, high] with 0 < low < high (got [222, 218])"],
    ["- symbol: A\n  kind: buy_zone\n  range: [0, 218]\n  when: enter\n  plan: p\n  expires: 2026-12-31\n", "range must be [low, high] with 0 < low < high (got [0, 218])"],
    ["- symbol: A\n  kind: buy_zone\n  range: [1, 2, 3]\n  when: enter\n  plan: p\n  expires: 2026-12-31\n", "range must be [low, high] with 0 < low < high (got [1, 2, 3])"],
    ["- symbol: A\n  kind: buy_zone\n  range: 218\n  when: enter\n  plan: p\n  expires: 2026-12-31\n", "range must be [low, high] with 0 < low < high (got 218)"],
    ["- symbol: A\n  kind: buy_zone\n  range: [218, 222]\n  when: cross_up\n  plan: p\n  expires: 2026-12-31\n", "when: cross_up takes a price; with a range, when is enter"],
    ["- symbol: A\n  kind: watch\n  price: 1\n  plan: p\n  expires: 2026-12-31\n", "when is missing: cross_up or cross_down with a price, enter with a range"],
    ["- symbol: A\n  kind: watch\n  price: 1\n  when: cross_up\n  plan: \"  \"\n  expires: 2026-12-31\n", "a level without a plan is refused: write what to do when it is reached"],
    ["- symbol: A\n  kind: watch\n  price: 1\n  when: cross_up\n  plan: 42\n  expires: 2026-12-31\n", "plan must be one line of text, at most 300 characters (got 42)"],
    ["- symbol: A\n  kind: watch\n  price: 1\n  when: cross_up\n  plan: p\n  source: \"a\\nb\"\n  expires: 2026-12-31\n", "source must be one line"],
    [`- symbol: A\n  kind: watch\n  price: 1\n  when: cross_up\n  plan: p\n  source: ${"s".repeat(201)}\n  expires: 2026-12-31\n`, "source is 201 characters; the limit is 200"],
    ["- symbol: A\n  kind: watch\n  price: 1\n  when: cross_up\n  plan: p\n  expires: 2026-11-31\n", 'expires must be a date, YYYY-MM-DD (got "2026-11-31")'],
    ["- symbol: A\n  kind: watch\n  price: 1\n  when: cross_up\n  plan: p\n  expires:\n", "a level without an expiry is refused: write expires: YYYY-MM-DD, the last day it holds"],
    ["- symbol: A\n  kind: watch\n  price: 1\n  when: cross_up\n  plan: p\n  expires: 2026-12-31\n  cooldown: 0m\n", 'cooldown must be <n>m, from 1m to 1440m (got "0m")'],
    ["- symbol: A\n  kind: watch\n  price: 1\n  when: cross_up\n  plan: p\n  expires: 2026-12-31\n  cooldown: 1441m\n", 'cooldown must be <n>m, from 1m to 1440m (got "1441m")'],
    ["- symbol: A\n  kind: watch\n  price: 1\n  when: cross_up\n  plan: p\n  expires: 2026-12-31\n  cooldown: 30\n", "cooldown must be <n>m, from 1m to 1440m (got 30)"],
    /* Two faults: the unknown key comes first, then the keys in order. */
    ["- symbol: A\n  kind: nope\n  when: sideways\n  plan: p\n  expires: 2026-12-31\n  extra: 1\n", 'unknown key "extra"'],
    ["- symbol: A\n  kind: nope\n  when: sideways\n  plan: p\n  expires: 2026-12-31\n", 'kind must be buy_zone, stop, target or watch (got "nope")'],
  ];
  const l = await loadLevels(await fixture(entries.map(([yaml]) => yaml).join("")), LEVELS, TODAY);
  assert.deepEqual(l.entries, []);
  assert.deepEqual(l.refusals.map((r) => [r.index, r.reason]), entries.map(([, reason], index) => [index, reason]));
  /* A refusal names the symbol only when it is a ticker: not for the bare string, nor for the entry without one. */
  assert.deepEqual(l.refusals.map((r) => r.symbol), entries.map((_, index) => (index < 2 ? undefined : "A")));
});

test("a plan's and a source's limits count characters, not UTF-16 units; the edges load", async () => {
  const at = (plan: string, source: string): string =>
    `- symbol: A\n  kind: watch\n  price: 1\n  when: cross_up\n  plan: ${plan}\n  source: ${source}\n  expires: 2026-12-31\n  annotate: True\n  cooldown: 1440m\n`;
  const l = await loadLevels(await fixture(at("😀".repeat(300), "é".repeat(200)) + at("😀".repeat(301), "s")), LEVELS, TODAY);
  assert.equal(l.entries.length, 1);
  assert.equal([...l.entries[0].plan].length, 300);
  assert.equal(l.entries[0].annotate, true);
  assert.equal(l.entries[0].cooldownMs, 86_400_000);
  assert.deepEqual(l.refusals, [{ file: LEVELS, index: 1, symbol: "A", reason: "plan is 301 characters; the limit is 300" }]);
});

test("past 40 levels and past 60 holdings, one refusal each", async () => {
  const levels = (n: number): string => Array.from({ length: n }, (_, i) => goodLevel(`L${i}`, 100 + i)).join("");
  const at40 = await loadLevels(await fixture(levels(40)), LEVELS, TODAY);
  assert.equal(at40.entries.length, 40);
  assert.deepEqual(at40.refusals, []);
  const at45 = await loadLevels(await fixture(levels(45)), LEVELS, TODAY);
  assert.deepEqual(at45.entries.map((e) => e.symbol), Array.from({ length: 40 }, (_, i) => `L${i}`));
  assert.deepEqual(at45.refusals, [{ file: LEVELS, reason: "entries 41-45 are past the cap of 40 levels per file" }]);

  const holdings = (n: number): string => Array.from({ length: n }, (_, i) => `- symbol: H${i}\n  qty: 1\n  avg_cost: 10\n`).join("");
  const at60 = await loadHoldings(await fixture(holdings(60)), HOLDINGS);
  assert.equal(at60.entries.length, 60);
  assert.deepEqual(at60.refusals, []);
  const at62 = await loadHoldings(await fixture(holdings(62)), HOLDINGS);
  assert.equal(at62.entries.length, 60);
  assert.deepEqual(at62.refusals, [{ file: HOLDINGS, reason: "entries 61-62 are past the cap of 60 holdings" }]);

  /* The cap counts places in the file: a refused entry inside it still takes its place. */
  const mixed = await loadLevels(await fixture(`- symbol: bad\n${levels(41).slice("- symbol: L0\n".length)}`), LEVELS, TODAY);
  assert.equal(mixed.entries.length, 39);
  assert.deepEqual(mixed.refusals.map((r) => r.reason), [
    'symbol must be a US ticker (NVDA, BRK.B) or six digits for an A share (600519) (got "bad")',
    "entries 41-41 are past the cap of 40 levels per file",
  ]);
});

test("holdings: a duplicate, a lowercase symbol, a zero qty, a string avg_cost and an unknown key are refused", async () => {
  const path = await fixture(`- symbol: NVDA
  qty: 100
  avg_cost: 120.50
  opened: 2026-09-15
  broker: example-broker
- symbol: NVDA
  qty: 50
  avg_cost: 130
- symbol: aapl
  qty: 10
  avg_cost: 200
- symbol: MSFT
  qty: 0
  avg_cost: 400
- symbol: AMD
  qty: 5
  avg_cost: "150"
- symbol: TSLA
  qty: 3
  cost: 250
- symbol: SPY
  qty: -20
  avg_cost: 560
- symbol: BRK.B
  qty: 0.5
  avg_cost: 480.25
`);
  const h = await loadHoldings(path, HOLDINGS);
  assert.equal(h.error, undefined);
  assert.deepEqual(h.refusals, [
    { file: HOLDINGS, index: 1, symbol: "NVDA", reason: "NVDA is held twice; the first entry stands" },
    { file: HOLDINGS, index: 2, reason: 'symbol must be a US ticker (NVDA, BRK.B) or six digits for an A share (600519) (got "aapl")' },
    { file: HOLDINGS, index: 3, symbol: "MSFT", reason: "qty must be a number other than 0 (got 0)" },
    { file: HOLDINGS, index: 4, symbol: "AMD", reason: 'avg_cost must be a number above 0 (got "150")' },
    { file: HOLDINGS, index: 5, symbol: "TSLA", reason: 'unknown key "cost"' },
  ]);
  const want: Holding[] = [
    { symbol: "NVDA", market: "us", qty: 100, avgCost: 120.5, opened: "2026-09-15", broker: "example-broker" },
    { symbol: "SPY", market: "us", qty: -20, avgCost: 560 },
    { symbol: "BRK.B", market: "us", qty: 0.5, avgCost: 480.25 },
  ];
  assert.deepEqual(h.entries, want);

  /* A second entry for a symbol is refused even when the first is refused too: the book never guesses which. */
  const twice = await loadHoldings(await fixture("- symbol: NVDA\n  qty: 0\n  avg_cost: 120\n- symbol: NVDA\n  qty: 100\n  avg_cost: 125\n"), HOLDINGS);
  assert.deepEqual(twice.entries, []);
  assert.deepEqual(twice.refusals.map((r) => [r.index, r.reason]), [[0, "qty must be a number other than 0 (got 0)"], [1, "NVDA is held twice; neither entry loads"]]);
});

test("the other faults of a holding, one refusal each", async () => {
  const entries: [string, string][] = [
    ["- NVDA\n", "a holding must be a mapping: symbol, qty, avg_cost, opened, broker"],
    ["- qty: 1\n  avg_cost: 1\n", "symbol is missing"],
    ["- symbol: A\n  avg_cost: 1\n", "qty is missing"],
    ["- symbol: B\n  qty: .nan\n  avg_cost: 1\n", "qty must be a number other than 0 (got NaN)"],
    ["- symbol: C\n  qty: \"10\"\n  avg_cost: 1\n", 'qty must be a number other than 0 (got "10")'],
    ["- symbol: D\n  qty: 1\n", "avg_cost is missing"],
    ["- symbol: E\n  qty: 1\n  avg_cost: 0\n", "avg_cost must be a number above 0 (got 0)"],
    ["- symbol: F\n  qty: 1\n  avg_cost: -3\n", "avg_cost must be a number above 0 (got -3)"],
    ["- symbol: G\n  qty: 1\n  avg_cost: 1\n  opened: 2026-09-15T10:00:00Z\n", 'opened must be a date, YYYY-MM-DD (got "2026-09-15T10:00:00Z")'],
    [`- symbol: H\n  qty: 1\n  avg_cost: 1\n  broker: ${"b".repeat(41)}\n`, "broker is 41 characters; the limit is 40"],
    ["- symbol: I\n  qty: 1\n  avg_cost: 1\n  broker: 7\n", "broker must be one line of text, at most 40 characters (got 7)"],
  ];
  const h = await loadHoldings(await fixture(entries.map(([yaml]) => yaml).join("")), HOLDINGS);
  assert.deepEqual(h.entries, []);
  assert.deepEqual(h.refusals.map((r) => [r.index, r.reason]), entries.map(([, reason], index) => [index, reason]));
  assert.deepEqual(h.refusals.map((r) => r.symbol), [undefined, undefined, "A", "B", "C", "D", "E", "F", "G", "H", "I"]);
});

test("CORE_SCHEMA: an unquoted date stays a date string", async () => {
  const l = await loadLevels(await fixture(`- symbol: NVDA
  kind: target
  price: 210
  when: cross_up
  plan: sell a third
  expires: 2026-11-30
  annotate: false
`), LEVELS, TODAY);
  assert.deepEqual(l.refusals, []);
  assert.equal(l.entries[0].expires, "2026-11-30");
  assert.equal(l.entries[0].annotate, false);
  const h = await loadHoldings(await fixture("- symbol: NVDA\n  qty: 100\n  avg_cost: 120.5\n  opened: 2026-09-15\n"), HOLDINGS);
  assert.deepEqual(h.refusals, []);
  assert.equal(h.entries[0].opened, "2026-09-15");
});

test("a missing file, an oversized file and a file that is not a list", async () => {
  const absent = join(TEST_DIR, "absent.yml");
  assert.deepEqual(await loadLevels(absent, LEVELS, TODAY), { file: LEVELS, entries: [], refusals: [], missing: true });
  assert.deepEqual(await loadHoldings(absent, HOLDINGS), { file: HOLDINGS, entries: [], refusals: [], missing: true });

  /* 65,536 bytes of comment hold no entries; one byte more is refused unread. */
  const atCap = await fixture(`#${" ".repeat(DESK_FILE_MAX_BYTES - 2)}\n`);
  const capped = await loadLevels(atCap, LEVELS, TODAY);
  assert.equal(capped.error, undefined);
  assert.deepEqual(capped.entries, []);
  assert.deepEqual(capped.refusals, []);
  const over = await fixture(`#${" ".repeat(DESK_FILE_MAX_BYTES - 1)}\n`);
  assert.deepEqual(await loadLevels(over, LEVELS, TODAY), { file: LEVELS, entries: [], refusals: [], error: "desk/levels.yml is 65,537 bytes; the limit is 65,536" });
  assert.deepEqual(await loadHoldings(over, HOLDINGS), { file: HOLDINGS, entries: [], refusals: [], error: "desk/holdings.yml is 65,537 bytes; the limit is 65,536" });

  /* Read in full, a file that is not a list keeps its hash and its time. */
  const mapping = await fixture("a: 1");
  const { mtime } = await stat(mapping);
  assert.deepEqual(await loadLevels(mapping, LEVELS, TODAY), {
    file: LEVELS, entries: [], refusals: [], error: "desk/levels.yml must be a list of entries", sha256: sha256Hex("a: 1"), mtime: mtime.toISOString(),
  });
  assert.equal((await loadHoldings(mapping, HOLDINGS)).error, "desk/holdings.yml must be a list of entries");
  assert.equal((await loadLevels(await fixture("just words"), LEVELS, TODAY)).error, "desk/levels.yml must be a list of entries");
});

test("a file that is not YAML, not UTF-8, not a regular file or not readable is an error with no entries", async () => {
  const twice = await loadLevels(await fixture("- symbol: A\n  symbol: B\n"), LEVELS, TODAY);
  assert.equal(twice.error, "desk/levels.yml is not YAML: duplicated mapping key (2:3)");
  assert.deepEqual(twice.entries, []);
  assert.equal((await loadHoldings(await fixture("- !!timestamp 2026-01-01\n"), HOLDINGS)).error, "desk/holdings.yml is not YAML: unknown tag !<tag:yaml.org,2002:timestamp> (1:25)");

  const latin = await loadHoldings(await fixture(Uint8Array.from([0x2d, 0x20, 0xff, 0x0a])), HOLDINGS);
  assert.equal(latin.error, "desk/holdings.yml is not UTF-8");
  assert.equal(latin.sha256, sha256Hex(Buffer.from([0x2d, 0x20, 0xff, 0x0a])));

  const dir = join(TEST_DIR, "a-directory.yml");
  await mkdir(dir, { recursive: true });
  assert.deepEqual(await loadLevels(dir, LEVELS, TODAY), { file: LEVELS, entries: [], refusals: [], error: "desk/levels.yml is not a regular file" });

  const underAFile = join(await fixture("- x\n"), "levels.yml");
  assert.deepEqual(await loadLevels(underAFile, LEVELS, TODAY), { file: LEVELS, entries: [], refusals: [], error: "desk/levels.yml cannot be read (ENOTDIR)" });
});

test("a FIFO is refused at once, never waited on", async (t) => {
  await mkdir(TEST_DIR, { recursive: true });
  const fifo = join(TEST_DIR, "a-fifo.yml");
  try {
    execFileSync("mkfifo", [fifo]);
  } catch {
    t.skip("no mkfifo here");
    return;
  }
  assert.deepEqual(await loadHoldings(fifo, HOLDINGS), { file: HOLDINGS, entries: [], refusals: [], error: "desk/holdings.yml is not a regular file" });
});

test("a link - symbolic or hard - is refused unopened, and nothing of its target is echoed", async () => {
  /* A fake key file a followed link would echo: js-yaml names an unidentified alias in its first line. */
  const keys = await fixture("FAKE_PASS: *FakeProbeAlias43\nFAKE_API_KEY=FakeProbeKey41\n");
  const book = await fixture(goodLevel("ZZLINK", 170));
  const toKeys = join(TEST_DIR, "to-keys.yml");
  const toBook = join(TEST_DIR, "to-book.yml");
  const dangling = join(TEST_DIR, "dangling.yml");
  await symlink(keys, toKeys);
  await symlink(book, toBook);
  await symlink(join(TEST_DIR, "nowhere.yml"), dangling);
  const irregular = (file: string): object => ({ file, entries: [], refusals: [], error: `${file} is not a regular file` });
  const results: object[] = [];
  for (const path of [toKeys, toBook, dangling]) {
    const l = await loadLevels(path, LEVELS, TODAY);
    const h = await loadHoldings(path, HOLDINGS);
    assert.deepEqual(l, irregular(LEVELS), path);
    assert.deepEqual(h, irregular(HOLDINGS), path);
    results.push(l, h);
  }
  /* A second name for the book is a hard link: the link is refused, and so is the first name, now one of two. */
  const hard = join(TEST_DIR, "hard.yml");
  await link(book, hard);
  for (const path of [hard, book]) {
    const l = await loadLevels(path, LEVELS, TODAY);
    assert.deepEqual(l, irregular(LEVELS), path);
    results.push(l);
  }
  for (const result of results) assert.ok(!/FakeProbe|FAKE_|ZZLINK|read the news/.test(JSON.stringify(result)), JSON.stringify(result));
});

test("a swap after the lstat is still refused: the open follows no link, waits on no FIFO, and judges the descriptor again", async (t) => {
  const plain = await lstat(await fixture(goodLevel("ZZPLAIN", 170)));
  /* A link to a plain file with one name: only the open's O_NOFOLLOW refuses it. */
  const toPlain = join(TEST_DIR, "swap-link.yml");
  await symlink(await fixture(goodLevel("ZZSWAP", 171)), toPlain);
  /* A file with a second name: only the descriptor's link count refuses it. */
  const second = join(TEST_DIR, "swap-hard.yml");
  await link(await fixture(goodLevel("ZZHARD", 172)), second);
  const refused = [toPlain, second];
  try {
    const fifo = join(TEST_DIR, "swap-fifo.yml");
    execFileSync("mkfifo", [fifo]);
    refused.push(fifo);
  } catch {
    /* no mkfifo here: the link and the hard link still run */
  }
  const removed = join(TEST_DIR, "swap-removed.yml");
  /* The lstat sees a plain file with one name at each path, as it would have just before a swap. */
  const seen = t.mock.method(fsPromises, "lstat", async () => plain);
  syncBuiltinESMExports();
  try {
    for (const path of refused) {
      assert.deepEqual(await loadLevels(path, LEVELS, TODAY), { file: LEVELS, entries: [], refusals: [], error: "desk/levels.yml is not a regular file" }, path);
    }
    assert.deepEqual(await loadLevels(removed, LEVELS, TODAY), { file: LEVELS, entries: [], refusals: [], missing: true });
    assert.equal(seen.mock.callCount(), refused.length + 1, "the loader's lstat is the stand-in");
  } finally {
    seen.mock.restore();
    syncBuiltinESMExports();
  }
});

test("the parser's reason is its first line, cut at 60 characters and cleaned: no snippet, no long name, no raw control", async () => {
  /* The offending line holds a fake secret, which js-yaml shows only in the snippet below its first line. */
  const snippet = (await loadLevels(await fixture("- symbol: NVDA\n  plan: FakeSnippetSecret77: more\n"), LEVELS, TODAY)).error ?? "";
  assert.equal(snippet, "desk/levels.yml is not YAML: bad indentation of a mapping entry (2:28)");
  assert.ok(!snippet.includes("\n") && !snippet.includes("FakeSnippetSecret77"), snippet);
  /* A tag or an alias name of 5,000 characters is cut to 60, the last the marker. */
  const tag = (await loadHoldings(await fixture(`- !${"T".repeat(5_000)}\n`), HOLDINGS)).error ?? "";
  assert.equal(tag, `desk/holdings.yml is not YAML: unknown tag !<!${"T".repeat(44)}…`);
  const alias = (await loadLevels(await fixture(`- *${"A".repeat(5_000)}\n`), LEVELS, TODAY)).error ?? "";
  assert.equal(alias, `desk/levels.yml is not YAML: unidentified alias "${"A".repeat(39)}…`);
  /* A direction override in an alias's name is echoed as an escape, never raw. */
  const rlo = (await loadLevels(await fixture(`- *a${String.fromCodePoint(0x202e)}b\n`), LEVELS, TODAY)).error ?? "";
  assert.equal(rlo, 'desk/levels.yml is not YAML: unidentified alias "a\\u202eb" (1:7)');
});

test("a plan, a source or a broker holding a control or direction character is refused; a tab is not", async () => {
  /* YAML's double-quoted escapes put each character in: a C0 control, DEL, a C1 control, an override, an isolate. */
  const level = (plan: string, source = "s"): string =>
    `- symbol: A\n  kind: watch\n  price: 1\n  when: cross_up\n  plan: ${plan}\n  source: ${source}\n  expires: 2026-12-31\n`;
  const l = await loadLevels(await fixture([
    level('"a\\x01b"'), level('"a\\x7fb"'), level('"a\\x9bb"'), level('"a\\u202Eb"'), level("p", '"s\\u2066x"'), level('"a\\tb"'),
  ].join("")), LEVELS, TODAY);
  assert.deepEqual(l.refusals.map((r) => [r.index, r.reason]), [
    [0, "plan holds a control or direction character"],
    [1, "plan holds a control or direction character"],
    [2, "plan holds a control or direction character"],
    [3, "plan holds a control or direction character"],
    [4, "source holds a control or direction character"],
  ]);
  assert.deepEqual(l.entries.map((e) => [e.index, e.plan]), [[5, "a\tb"]]);
  const h = await loadHoldings(await fixture('- symbol: A\n  qty: 1\n  avg_cost: 1\n  broker: "b\\u202Dx"\n'), HOLDINGS);
  assert.deepEqual(h.refusals.map((r) => r.reason), ["broker holds a control or direction character"]);
});

test("a value a refusal echoes carries no raw control, separator or direction character", async () => {
  const l = await loadLevels(await fixture([
    '- symbol: A\n  kind: "\\u202Ewatch\\x85\\u2028"\n  price: 1\n  when: cross_up\n  plan: p\n  expires: 2026-12-31\n',
    '- symbol: A\n  "\\u2066k": 1\n',
  ].join("")), LEVELS, TODAY);
  assert.deepEqual(l.refusals.map((r) => r.reason), [
    'kind must be buy_zone, stop, target or watch (got "\\u202ewatch\\u0085\\u2028")',
    'unknown key "\\u2066k"',
  ]);
});

test("a blank optional key is absent: one left empty, and an empty source or broker", async () => {
  const l = await loadLevels(await fixture(
    "- symbol: A\n  kind: watch\n  price: 1\n  when: cross_up\n  plan: p\n  source:\n  expires: 2026-12-31\n  annotate:\n  cooldown:\n"
    + '- symbol: B\n  kind: watch\n  price: 2\n  when: cross_up\n  plan: p\n  source: ""\n  expires: 2026-12-31\n',
  ), LEVELS, TODAY);
  assert.deepEqual(l.refusals, []);
  assert.deepEqual(l.entries, [
    { file: LEVELS, index: 0, symbol: "A", market: "us", kind: "watch", price: 1, when: "cross_up", plan: "p", expires: "2026-12-31", annotate: true, cooldownMs: 1_800_000 },
    { file: LEVELS, index: 1, symbol: "B", market: "us", kind: "watch", price: 2, when: "cross_up", plan: "p", expires: "2026-12-31", annotate: true, cooldownMs: 1_800_000 },
  ]);
  const h = await loadHoldings(await fixture('- symbol: A\n  qty: 1\n  avg_cost: 1\n  opened:\n  broker:\n- symbol: B\n  qty: 2\n  avg_cost: 2\n  broker: ""\n'), HOLDINGS);
  assert.deepEqual(h.refusals, []);
  assert.deepEqual(h.entries, [{ symbol: "A", market: "us", qty: 1, avgCost: 1 }, { symbol: "B", market: "us", qty: 2, avgCost: 2 }]);
});

test("a loaded file carries its bytes' sha256 and its mtime; an empty one holds no entries", async () => {
  const text = goodLevel("NVDA", 170);
  const path = await fixture(text);
  const l = await loadLevels(path, LEVELS, TODAY);
  assert.equal(l.sha256, sha256Hex(text));
  assert.equal(l.mtime, (await stat(path)).mtime.toISOString());
  assert.equal(l.entries.length, 1);

  for (const empty of ["", "# nothing yet\n"]) {
    const e = await loadHoldings(await fixture(empty), HOLDINGS);
    assert.equal(e.error, undefined);
    assert.equal(e.missing, undefined);
    assert.deepEqual([e.entries, e.refusals, e.sha256], [[], [], sha256Hex(empty)]);
  }
});

test("loadLevels takes today as a real date", async () => {
  const path = await fixture(goodLevel("NVDA", 170));
  await assert.rejects(loadLevels(path, LEVELS, "2026-02-30"), TypeError);
  await assert.rejects(loadLevels(path, LEVELS, "today"), TypeError);
});

test("levels and holdings carry their market; an unquoted 600519 is refused, not coerced", async () => {
  const l = await loadLevels(await fixture(
    '- symbol: "600519"\n  kind: watch\n  price: 1400\n  when: cross_down\n  plan: reread the note\n  expires: 2026-12-31\n'
    + "- symbol: 600519\n  kind: watch\n  price: 1400\n  when: cross_down\n  plan: reread the note\n  expires: 2026-12-31\n"
    + goodLevel("NVDA", 170),
  ), LEVELS, TODAY);
  assert.deepEqual(l.entries.map((e) => [e.index, e.symbol, e.market]), [[0, "600519", "cn"], [2, "NVDA", "us"]]);
  assert.deepEqual(l.refusals, [
    { file: LEVELS, index: 1, reason: "symbol must be a US ticker (NVDA, BRK.B) or six digits for an A share (600519) (got 600519)" },
  ]);
  const h = await loadHoldings(await fixture('- symbol: "000001"\n  qty: 100\n  avg_cost: 11.2\n- symbol: AAPL\n  qty: 1\n  avg_cost: 200\n- symbol: "60051"\n  qty: 1\n  avg_cost: 1\n'), HOLDINGS);
  assert.deepEqual(h.entries.map((e) => [e.symbol, e.market]), [["000001", "cn"], ["AAPL", "us"]]);
  assert.deepEqual(h.refusals.map((r) => r.reason), ['symbol must be a US ticker (NVDA, BRK.B) or six digits for an A share (600519) (got "60051")']);
  /* a refusal names an A share's code as it names a ticker */
  const bad = await loadLevels(await fixture('- symbol: "600519"\n  kind: watch\n'), LEVELS, TODAY);
  assert.equal(bad.refusals[0]?.symbol, "600519");
});

test("the shipped levels.example.yml loads with no refusal and one A share", async () => {
  const l = await loadLevels(join(REPO, "desk", "levels.example.yml"), "desk/levels.example.yml", "2026-10-20");
  assert.deepEqual(l.refusals, []);
  assert.deepEqual(l.entries.map((e) => e.market), ["us", "us", "us", "cn"]);
  const moutai = l.entries[3];
  assert.deepEqual([moutai?.symbol, moutai?.kind, moutai?.price, moutai?.when, moutai?.expires], ["600519", "watch", 1400, "cross_down", "2026-12-31"]);
});

/* ---------- rules.yml ---------- */

const RULES = "desk/rules.yml";

test("the rules' limits and vocabulary", () => {
  assert.deepEqual(RULE_KINDS, ["move_pct", "gap", "filing"]);
  assert.deepEqual(FILING_FORMS, ["8-K", "8-K/A", "4"]);
  assert.equal(RULES_MAX, 20);
  assert.equal(RULE_PCT_MAX, 50);
});

test("the shipped desk/rules.yml loads with no refusal", async () => {
  const r = await loadRules(join(REPO, "desk", "rules.yml"), RULES);
  assert.equal(r.error, undefined);
  assert.equal(r.missing, undefined);
  assert.deepEqual(r.refusals, []);
  assert.deepEqual(r.entries.map((e) => [e.id, e.kind]), [
    ["holding-move", "move_pct"], ["index-move", "move_pct"], ["filing", "filing"], ["watch-crwv", "move_pct"], ["watch-intc", "move_pct"],
  ]);
  assert.deepEqual(r.entries[2].symbols, { holdings: true, levels: true, symbols: [] });
  assert.equal(r.entries[0].annotate, true);
  assert.equal((r.entries[0] as { cooldownMs: number }).cooldownMs, 3_600_000);
  const want: Rule[] = [
    { file: RULES, index: 0, id: "holding-move", symbols: { holdings: true, levels: false, symbols: [] }, annotate: true, urgent: false, kind: "move_pct", movePct: 4, sessions: "all", cooldownMs: 3_600_000 },
    { file: RULES, index: 1, id: "index-move", symbols: { holdings: false, levels: false, symbols: ["SPY", "QQQ"] }, annotate: true, urgent: false, kind: "move_pct", movePct: 1.5, sessions: "all", cooldownMs: 1_800_000 },
    { file: RULES, index: 2, id: "filing", symbols: { holdings: true, levels: true, symbols: [] }, annotate: false, urgent: false, kind: "filing", forms: ["8-K", "8-K/A", "4"], cooldownMs: 1_800_000 },
    { file: RULES, index: 3, id: "watch-crwv", symbols: { holdings: false, levels: false, symbols: ["CRWV"] }, annotate: true, urgent: false, kind: "move_pct", movePct: 8, sessions: "all", cooldownMs: 1_800_000 },
    { file: RULES, index: 4, id: "watch-intc", symbols: { holdings: false, levels: false, symbols: ["INTC"] }, annotate: true, urgent: false, kind: "move_pct", movePct: 5, sessions: "all", cooldownMs: 1_800_000 },
  ];
  assert.deepEqual(r.entries, want);
});

test("a move_pct rule takes sessions: regular, defaults to all, and refuses any other value", async () => {
  const path = await fixture(`- id: day-only
  kind: move_pct
  symbols: [CRWV]
  move_pct: 8
  sessions: regular
- id: unsaid
  kind: move_pct
  symbols: [INTC]
  move_pct: 5
- id: empty
  kind: move_pct
  symbols: [INTC]
  move_pct: 5
  sessions:
- id: said-all
  kind: move_pct
  symbols: [SPY]
  move_pct: 1.5
  sessions: all
- id: extended
  kind: move_pct
  symbols: [SPY]
  move_pct: 1.5
  sessions: [pre, post]
- id: numbered
  kind: move_pct
  symbols: [SPY]
  move_pct: 1.5
  sessions: 1
`);
  const r = await loadRules(path, RULES);
  assert.deepEqual(r.entries.map((e) => [e.id, e.kind === "move_pct" ? e.sessions : undefined]), [["day-only", "regular"], ["unsaid", "all"], ["empty", "all"]]);
  const reason = "sessions must be regular; leave it out for all three sessions";
  assert.deepEqual(r.refusals, [
    { file: RULES, index: 3, reason },
    { file: RULES, index: 4, reason },
    { file: RULES, index: 5, reason },
  ]);
});

test("sessions is not a key of a gap or filing rule", async () => {
  const path = await fixture(`- id: gap-sessions
  kind: gap
  symbols: holdings
  gap_pct: 2
  sessions: regular
- id: filing-sessions
  kind: filing
  symbols: holdings
  sessions: regular
- id: gap-empty
  kind: gap
  symbols: holdings
  gap_pct: 2
  sessions:
`);
  const r = await loadRules(path, RULES);
  assert.deepEqual(r.entries.map((e) => e.id), ["gap-empty"]);
  assert.deepEqual(r.refusals, [
    { file: RULES, index: 0, reason: "sessions is not a key of a gap rule" },
    { file: RULES, index: 1, reason: "sessions is not a key of a filing rule" },
  ]);
});

test("a move_pct or gap rule annotates by default and needs no plan; a filing rule's annotate: true still needs one", async () => {
  const path = await fixture(`- id: move
  kind: move_pct
  symbols: holdings
  move_pct: 4
- id: gap
  kind: gap
  symbols: holdings
  gap_pct: 2
- id: move-off
  kind: move_pct
  symbols: holdings
  move_pct: 4
  annotate: false
- id: gap-said
  kind: gap
  symbols: holdings
  gap_pct: 2
  annotate: true
- id: move-plan
  kind: move_pct
  symbols: holdings
  move_pct: 4
  plan: trim if it breaks the stop
- id: filing
  kind: filing
  symbols: holdings
- id: filing-plan
  kind: filing
  symbols: holdings
  annotate: true
  plan: read the 8-K before the open
- id: filing-no-plan
  kind: filing
  symbols: holdings
  annotate: true
`);
  const r = await loadRules(path, RULES);
  assert.deepEqual(r.entries.map((e) => [e.id, e.annotate, e.plan]), [
    ["move", true, undefined],
    ["gap", true, undefined],
    ["move-off", false, undefined],
    ["gap-said", true, undefined],
    ["move-plan", true, "trim if it breaks the stop"],
    ["filing", false, undefined],
    ["filing-plan", true, "read the 8-K before the open"],
  ]);
  assert.deepEqual(r.refusals, [{ file: RULES, index: 7, reason: "annotate: true needs a plan: write what the check is for" }]);
});

test("a rule takes urgent: true or false, and refuses any other value", async () => {
  const path = await fixture(`- id: loud
  kind: move_pct
  symbols: holdings
  move_pct: 4
  urgent: true
- id: quiet
  kind: filing
  symbols: holdings
  urgent: false
- id: unsaid
  kind: gap
  symbols: holdings
  gap_pct: 2
  urgent:
- id: yes-urgent
  kind: move_pct
  symbols: holdings
  move_pct: 4
  urgent: "yes"
- id: one-urgent
  kind: move_pct
  symbols: holdings
  move_pct: 4
  urgent: 1
`);
  const r = await loadRules(path, RULES);
  assert.deepEqual(r.entries.map((e) => [e.id, e.urgent]), [["loud", true], ["quiet", false], ["unsaid", false]]);
  assert.deepEqual(r.refusals, [
    { file: RULES, index: 3, reason: 'urgent must be true or false (got "yes")' },
    { file: RULES, index: 4, reason: "urgent must be true or false (got 1)" },
  ]);
});

test("each bad rule is refused by index with its reason, and the rest load", async () => {
  const path = await fixture(`- id: good-move
  kind: move_pct
  symbols: [NVDA, holdings, NVDA]
  move_pct: 3
  annotate: true
  plan: check the news before acting
- id: halt
  kind: halt
  symbols: holdings
- id: no-kind
  symbols: holdings
- id: other-kind
  kind: volume
  symbols: holdings
- id: on-key
  kind: move_pct
  on: holdings
  move_pct: 2
- id: odd-key
  kind: move_pct
  symbols: holdings
  move_pct: 2
  window: 5m
- id: wrong-kind-key
  kind: move_pct
  symbols: holdings
  gap_pct: 2
- id: gap-cooldown
  kind: gap
  symbols: holdings
  gap_pct: 2
  cooldown: 30m
- id: empty-symbols
  kind: move_pct
  symbols: []
  move_pct: 2
- just a line
- id: bad-move
  kind: move_pct
  symbols: holdings
  move_pct: 51
- id: no-move
  kind: move_pct
  symbols: holdings
- id: bad-gap
  kind: gap
  symbols: holdings
  gap_pct: 0
- id: bad-forms
  kind: filing
  symbols: holdings
  forms: [8-K, 10-Q]
- id: no-plan
  kind: filing
  symbols: levels
  annotate: true
- id: good-move
  kind: gap
  symbols: holdings
  gap_pct: 2
- id: good-gap
  kind: gap
  symbols: levels
  gap_pct: 2.5
  cooldown:
- id: Bad_Id
  kind: gap
  symbols: holdings
  gap_pct: 2
- kind: gap
  symbols: holdings
  gap_pct: 2
- id: bad-cooldown
  kind: filing
  symbols: holdings
  cooldown: 2h
`);
  const r = await loadRules(path, RULES);
  assert.equal(r.error, undefined);
  const refusal = (index: number, reason: string): LoadRefusal => ({ file: RULES, index, reason });
  assert.deepEqual(r.refusals, [
    refusal(1, "halts need a trading-status feed; the Market's read carries none"),
    refusal(2, "a rule needs kind: move_pct, gap or filing"),
    refusal(3, "kind must be move_pct, gap or filing"),
    refusal(4, 'unknown key "on": a rule names its symbols under symbols:'),
    refusal(5, 'unknown key "window"'),
    refusal(6, "gap_pct is not a key of a move_pct rule"),
    refusal(7, "cooldown is not a key of a gap rule"),
    refusal(8, "symbols must be holdings, levels or a list of tickers, holdings and levels"),
    refusal(9, "a rule must be a mapping: id, kind, symbols, move_pct, gap_pct, sessions, forms, cooldown, annotate, urgent, plan"),
    refusal(10, "move_pct must be a number above 0 and at most 50"),
    refusal(11, "move_pct must be a number above 0 and at most 50"),
    refusal(12, "gap_pct must be a number above 0 and at most 50"),
    refusal(13, "forms must be a list of 8-K, 8-K/A and 4"),
    refusal(14, "annotate: true needs a plan: write what the check is for"),
    refusal(15, "good-move is defined twice; the first stands"),
    refusal(17, 'id must be a-z, 0-9 and -, opening with a letter, at most 40 characters (got "Bad_Id")'),
    refusal(18, "id is missing"),
    refusal(19, 'cooldown must be <n>m, from 1m to 1440m (got "2h")'),
  ]);
  const want: Rule[] = [
    {
      file: RULES, index: 0, id: "good-move", symbols: { holdings: true, levels: false, symbols: ["NVDA"] }, annotate: true, urgent: false,
      plan: "check the news before acting", kind: "move_pct", movePct: 3, sessions: "all", cooldownMs: 1_800_000,
    },
    { file: RULES, index: 16, id: "good-gap", symbols: { holdings: false, levels: true, symbols: [] }, annotate: true, urgent: false, kind: "gap", gapPct: 2.5 },
  ];
  assert.deepEqual(r.entries, want);
});

test("a repeated id after a refused first rule loads neither; after a loaded one, the first stands", async () => {
  const r = await loadRules(await fixture(`- id: twice
  kind: move_pct
  symbols: holdings
  move_pct: 99
- id: twice
  kind: move_pct
  symbols: holdings
  move_pct: 2
- id: twice
  kind: gap
  symbols: levels
  gap_pct: 2
- id: once
  kind: gap
  symbols: levels
  gap_pct: 2
- id: once
  kind: gap
  symbols: levels
  gap_pct: 3
`), RULES);
  assert.deepEqual(r.refusals, [
    { file: RULES, index: 0, reason: "move_pct must be a number above 0 and at most 50" },
    { file: RULES, index: 1, reason: "twice is defined twice; neither entry loads" },
    { file: RULES, index: 2, reason: "twice is defined twice; neither entry loads" },
    { file: RULES, index: 4, reason: "once is defined twice; the first stands" },
  ]);
  assert.deepEqual(r.entries.map((e) => [e.index, e.id]), [[3, "once"]]);
});

test("past 20 rules, one refusal", async () => {
  const rule = (n: number): string => `- id: move-${n}\n  kind: move_pct\n  symbols: holdings\n  move_pct: 2\n`;
  const r = await loadRules(await fixture(Array.from({ length: 23 }, (_, i) => rule(i + 1)).join("")), RULES);
  assert.equal(r.entries.length, 20);
  assert.deepEqual(r.refusals, [{ file: RULES, reason: "entries 21-23 are past the cap of 20 rules" }]);
});

test("CORE_SCHEMA keeps 8-K a string and on: a key", async () => {
  const r = await loadRules(await fixture(`- id: forms
  kind: filing
  symbols: [AAPL]
  forms: [8-K, 4]
  cooldown: 15m
- id: on-holdings
  on: holdings
  kind: filing
`), RULES);
  assert.deepEqual(r.refusals, [{ file: RULES, index: 1, reason: 'unknown key "on": a rule names its symbols under symbols:' }]);
  const filing = r.entries[0];
  assert.equal(filing?.kind, "filing");
  assert.deepEqual((filing as Extract<Rule, { kind: "filing" }>).forms, ["8-K", "4"]);
  assert.equal((filing as Extract<Rule, { kind: "filing" }>).cooldownMs, 900_000);
  /* the parser itself: 8-K is text, on is a key, not YAML 1.1's true */
  assert.deepEqual(readDeskYaml("on: [8-K, 4]"), { on: ["8-K", 4] });
});

test("a filing rule refuses an A share it lists, and resolves holdings that hold one", async () => {
  const r = await loadRules(await fixture(`- id: cn-filing
  kind: filing
  symbols: [AAPL, "600519"]
- id: cn-move
  kind: move_pct
  symbols: ["600519", "000001"]
  move_pct: 5
- id: held-filing
  kind: filing
  symbols: holdings
- id: unquoted
  kind: move_pct
  symbols: [600519]
  move_pct: 5
- id: everything
  kind: move_pct
  symbols: everything
  move_pct: 5
`), RULES);
  assert.deepEqual(r.refusals, [
    { file: RULES, index: 0, reason: "filings are SEC's: 600519 is an A share" },
    { file: RULES, index: 3, reason: "symbols must be holdings, levels or a list of tickers, holdings and levels" },
    { file: RULES, index: 4, reason: "symbols must be holdings, levels or a list of tickers, holdings and levels" },
  ]);
  assert.deepEqual(r.entries.map((e) => [e.id, e.symbols]), [
    ["cn-move", { holdings: false, levels: false, symbols: ["600519", "000001"] }],
    ["held-filing", { holdings: true, levels: false, symbols: [] }],
  ]);
  /* the holdings that hold an A share resolve whole; filings.ts skips it and counts it */
  assert.deepEqual(resolveSymbols(r.entries[1].symbols, { holdings: ["600519", "AAPL"], levels: ["NVDA"] }), ["600519", "AAPL"]);
});

test("resolveSymbols takes the two words and the tickers, each once", () => {
  assert.deepEqual(resolveSymbols({ holdings: true, levels: false, symbols: ["SPY", "NVDA"] }, { holdings: ["NVDA", "AAPL"], levels: ["MSFT"] }), ["AAPL", "NVDA", "SPY"]);
  assert.deepEqual(resolveSymbols({ holdings: true, levels: true, symbols: [] }, { holdings: ["NVDA"], levels: ["NVDA", "MSFT", "MSFT"] }), ["MSFT", "NVDA"]);
  assert.deepEqual(resolveSymbols({ holdings: false, levels: false, symbols: ["QQQ"] }, { holdings: ["NVDA"], levels: ["MSFT"] }), ["QQQ"]);
});

test("levelDistancePct: a price, inside a range, outside it", () => {
  assert.ok(Math.abs(levelDistancePct({ price: 170 }, 181.2) - ((170 - 181.2) / 181.2) * 100) < 1e-12);
  assert.ok(Math.abs(levelDistancePct({ price: 170 }, 181.2) - -6.181) < 0.001);
  assert.equal(levelDistancePct({ range: [218, 222] }, 220), 0);
  assert.equal(levelDistancePct({ range: [218, 222] }, 218), 0);
  assert.ok(Math.abs(levelDistancePct({ range: [218, 222] }, 225) - -1.3333) < 0.001);
  assert.ok(Math.abs(levelDistancePct({ range: [218, 222] }, 210) - 3.8095) < 0.001);
});

/* ---------- readDeskFile and parseLevels (P4) ---------- */

test("readDeskFile: absent, a FIFO, a symlink and a hard link refused, oversize, not UTF-8, ok", async (t) => {
  const dir = join(TEST_DIR, "desk-file");
  await mkdir(dir, { recursive: true });
  assert.deepEqual(await readDeskFile(join(dir, "nope.yaml")), { state: "absent" });
  await writeFile(join(dir, "plain"), "x");
  assert.deepEqual(await readDeskFile(join(dir, "plain", "below")), { state: "absent" }, "ENOTDIR is absent too");
  await writeFile(join(dir, "ok.yaml"), "status: idea\n");
  assert.deepEqual(await readDeskFile(join(dir, "ok.yaml")), { state: "ok", bytes: Buffer.from("status: idea\n"), text: "status: idea\n" });
  await symlink("ok.yaml", join(dir, "link.yaml"));
  assert.deepEqual(await readDeskFile(join(dir, "link.yaml")), { state: "unreadable", reason: "not a regular file" });
  await link(join(dir, "ok.yaml"), join(dir, "hard.yaml"));
  assert.deepEqual(await readDeskFile(join(dir, "hard.yaml")), { state: "unreadable", reason: "not a regular file" }, "a second name is refused");
  await mkdir(join(dir, "sub.yaml"));
  assert.deepEqual(await readDeskFile(join(dir, "sub.yaml")), { state: "unreadable", reason: "not a regular file" });
  await writeFile(join(dir, "big.yaml"), "a".repeat(DESK_FILE_MAX_BYTES + 1));
  assert.deepEqual(await readDeskFile(join(dir, "big.yaml")), { state: "oversize", size: DESK_FILE_MAX_BYTES + 1 }, "the size is the descriptor's");
  await writeFile(join(dir, "full.yaml"), "a".repeat(DESK_FILE_MAX_BYTES));
  assert.equal((await readDeskFile(join(dir, "full.yaml"))).state, "ok", "exactly the cap reads");
  await writeFile(join(dir, "latin1.yaml"), Buffer.from([0x73, 0xe9, 0x0a]));
  assert.deepEqual(await readDeskFile(join(dir, "latin1.yaml")), { state: "unreadable", reason: "not UTF-8" });
  await writeFile(join(dir, "locked.yaml"), "x");
  await chmod(join(dir, "locked.yaml"), 0o000);
  try {
    const locked = await readDeskFile(join(dir, "locked.yaml"));
    if (process.getuid?.() !== 0) assert.deepEqual(locked, { state: "unreadable", reason: "EACCES" });
  } finally {
    await chmod(join(dir, "locked.yaml"), 0o600);
  }
  const fifo = join(dir, "fifo.yaml");
  try {
    execFileSync("mkfifo", [fifo]);
  } catch {
    t.skip("no mkfifo here");
    return;
  }
  assert.deepEqual(await readDeskFile(fifo), { state: "unreadable", reason: "not a regular file" }, "a FIFO is never waited on");
});

test("readDeskFile honours its cap", async () => {
  const dir = join(TEST_DIR, "desk-file-cap");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "ten"), "0123456789");
  assert.deepEqual(await readDeskFile(join(dir, "ten"), 9), { state: "oversize", size: 10 });
  assert.equal((await readDeskFile(join(dir, "ten"), 10)).state, "ok");
});

test("parseLevels is loadLevels without the read: the same entries, refusals and sha256 for one file", async () => {
  const text = `${goodLevel("NVDA", 180)}- symbol: AAPL\n  kind: stop\n  price: 200\n  when: cross_down\n  expires: 2026-12-31\n${goodLevel("600519", 1400).replace("600519", '"600519"')}`;
  const path = await fixture(text);
  const loaded = await loadLevels(path, LEVELS, TODAY);
  const sha = sha256Hex(Buffer.from(text));
  const parsed = parseLevels(text, LEVELS, TODAY, sha);
  assert.deepEqual(parsed.entries, loaded.entries);
  assert.deepEqual(parsed.refusals, loaded.refusals);
  assert.equal(parsed.sha256, loaded.sha256);
  assert.equal(parsed.sha256, sha);
  assert.equal(parsed.mtime, undefined, "no read, no mtime");
  assert.equal(parsed.entries.length, 2);
  assert.equal(parsed.entries[1].market, "cn");
  assert.equal(parsed.refusals.length, 1);
  /* the caller's pin, whatever it is; the cap measured on the text's UTF-8 */
  assert.equal(parseLevels(text, LEVELS, TODAY, "f".repeat(64)).sha256, "f".repeat(64));
  const big = parseLevels(`# ${"é".repeat(DESK_FILE_MAX_BYTES / 2)}\n`, LEVELS, TODAY, sha);
  assert.deepEqual(big.entries, []);
  assert.match(big.error ?? "", /^desk\/levels\.yml is 65,539 bytes; the limit is 65,536$/);
  assert.equal(parseLevels("", LEVELS, TODAY, sha).entries.length, 0);
  assert.match(parseLevels("{", LEVELS, TODAY, sha).error ?? "", /is not YAML/);
  assert.throws(() => parseLevels(text, LEVELS, "2026-13-01", sha), TypeError);
});
