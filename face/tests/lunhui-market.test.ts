/**
 * The Lunhui market module, `plugins/lunhui/lib/market.mjs` (spec D2, D3). Ported under their source
 * names from the source branch (evolving-alpha `codex/lunhui-agent-design` @ 2ae4df0): the 16
 * cases of `frontend/test/market-provider.test.mjs`, the 9 of `frontend/test/market-calendar.test.mjs`
 * and the 4 cases of `frontend/test/market-service.test.mjs` that need no cache, those against the
 * exported pure functions; then `freezeSample` on the synthetic fixtures in `fixtures/lunhui/`.
 * The bodies are the source's; the TypeScript adaptations are type-level only (a cast where a case
 * passes a deliberately wrong type, `?.` on fetch's optional `init`, a holder for a value a
 * closure assigns), except where a comment says otherwise.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  assessQuote, exchangeOf, fetchDailyBars, fetchMinutes, fetchQuotes, freezeSample, getMarketSession,
  limitPrices, limitRate, MINUTES_URL, minuteIndex, minuteItems, minuteLabel, normalizeQuotes,
  parseTencentKlines, parseTencentMinutes, parseTencentQuotes, validateSymbols,
} from "../plugins/lunhui/lib/market.mjs";
import { fixtureFetch } from "./fixtures/lunhui/fetch.ts";

// ---- frontend/test/market-provider.test.mjs ----

// Synthetic protocol fixtures: no network response or market prices are persisted in tests.
function quote(symbol = "sz000001", overrides: Record<number, string> = {}): string {
  const fields: string[] = Array(55).fill("");
  Object.assign(fields, {
    0: "51",
    1: "测试股份",
    2: symbol.slice(2),
    3: "12.50",
    4: "12.00",
    5: "12.10",
    6: "123.45",
    30: "20260930150000",
    31: "0.50",
    32: "4.17",
    33: "12.60",
    34: "11.90",
    37: "15.25",
    ...overrides,
  });
  return `v_${symbol}="${fields.join("~")}";`;
}

function kline(
  symbol: string,
  key = "qfqday",
  rows: unknown[] = [["2026-09-30", "12.1", "12.5", "12.6", "11.9", "123.45"]],
) {
  return { code: 0, data: { [symbol]: { [key]: rows } } };
}

test("quotes preserve provider fields, signed changes, currency/volume units and Chinese names", () => {
  const [q] = parseTencentQuotes(quote());
  assert.deepEqual(q, {
    symbol: "sz000001",
    name: "测试股份",
    last: 12.5,
    previousClose: 12,
    open: 12.1,
    high: 12.6,
    low: 11.9,
    change: 0.5,
    changePercent: 4.17,
    volumeShares: 12345,
    amountCny: 152500,
    quotedAt: "2026-09-30T15:00:00+08:00",
    provider: "tencent",
    kind: "equity",
  });
  const [falling] = parseTencentQuotes(
    quote("sh000001", { 31: "-1.2", 32: "-0.1" }),
  );
  assert.equal(falling.kind, "index");
  assert.equal(falling.change, -1.2);
  assert.equal(falling.changePercent, -0.1);
  assert.equal(parseTencentQuotes(quote("sz399006"))[0].kind, "index");
});

test("requested order and filtering are stable; absent quotes are null rather than fabricated zeros", () => {
  const result = parseTencentQuotes(
    `${quote("sh600519")}\n${quote("sz000001")}`,
    ["sz000001", "sz000333", "sz000001"],
  );
  assert.deepEqual(
    result.map((q) => q.symbol),
    ["sz000001", "sz000333"],
  );
  for (const field of [
    "name",
    "last",
    "open",
    "volumeShares",
    "amountCny",
    "quotedAt",
  ]) {
    assert.equal(result[1][field], null);
  }
  assert.deepEqual(parseTencentQuotes(""), []);
  assert.equal(
    parseTencentQuotes('v_pv_none_match="1";', ["sh600519"])[0].last,
    null,
  );
  assert.equal(
    parseTencentQuotes(quote("sh600519", { 2: "000001" }), ["sh600519"])[0]
      .last,
    null,
  );
});

test("missing fields, malformed numbers and zero suspension prices remain null; actual zero volume remains zero", () => {
  const [q] = parseTencentQuotes(
    quote("sz000001", {
      3: "0",
      4: "",
      5: "--",
      6: "0",
      31: "NaN",
      32: "Infinity",
      33: "-1",
      34: "12abc",
      37: "0",
    }),
  );
  for (const field of [
    "last",
    "previousClose",
    "open",
    "high",
    "low",
    "change",
    "changePercent",
  ])
    assert.equal(q[field], null);
  assert.equal(q.volumeShares, 0);
  assert.equal(q.amountCny, 0);
  assert.equal(
    parseTencentQuotes(quote("sz000001", { 6: "", 37: "--" }))[0].volumeShares,
    null,
  );
  assert.equal(
    parseTencentQuotes(
      quote("sz000001", { 6: "-1", 37: "99999999999999999999" }),
    )[0].amountCny,
    null,
  );
});

test("provider timestamps validate calendar dates and time bounds without using the fetch clock", () => {
  for (const invalid of [
    "",
    "0",
    "20260230120000",
    "20261301120000",
    "20260930240000",
    "20260930126000",
    "20260930125960",
  ]) {
    assert.equal(
      parseTencentQuotes(quote("sz000001", { 30: invalid }))[0].quotedAt,
      null,
      invalid,
    );
  }
  assert.equal(
    parseTencentQuotes(quote("sz000001", { 30: "20240229123456" }))[0].quotedAt,
    "2024-02-29T12:34:56+08:00",
  );
});

test("quote and kline parsers do not execute provider-supplied JavaScript", () => {
  const scope = globalThis as typeof globalThis & { __tencentExecuted?: boolean };
  scope.__tencentExecuted = false;
  const attack = `globalThis.__tencentExecuted = true;\n${quote()}`;
  assert.equal(parseTencentQuotes(attack).length, 1);
  assert.equal(scope.__tencentExecuted, false);
  assert.throws(() =>
    parseTencentKlines(
      `globalThis.__tencentExecuted = true; ${JSON.stringify(kline("sz000001"))}`,
      "sz000001",
    ),
  );
  assert.equal(scope.__tencentExecuted, false);
  delete scope.__tencentExecuted;
});

test("all public entry points reject symbol injection before a network request", async () => {
  const fetchImpl = () => {
    assert.fail("invalid symbols must never reach fetch");
  };
  for (const symbol of [
    "SH600519",
    "sh60051",
    "sh600519&x=1",
    "sh600519,sz000001",
    "https://example.com",
    "__proto__",
    null,
  ]) {
    assert.throws(() => parseTencentQuotes("", [symbol]), {
      code: "INVALID_SYMBOL",
    });
    assert.throws(() => parseTencentKlines({}, symbol), {
      code: "INVALID_SYMBOL",
    });
    await assert.rejects(fetchQuotes([symbol], { fetchImpl }), {
      code: "INVALID_SYMBOL",
    });
    await assert.rejects(fetchDailyBars(symbol, { fetchImpl }), {
      code: "INVALID_SYMBOL",
    });
  }
  await assert.rejects(
    fetchQuotes(Array(101).fill("sh600519"), { fetchImpl }),
    { code: "INVALID_SYMBOLS" },
  );
  assert.deepEqual(await fetchQuotes([], { fetchImpl }), []);
});

test("fetchQuotes decodes GBK Chinese bytes through GB18030 and uses only the fixed HTTPS endpoint", async () => {
  // 测试 in GBK. Keep the ASCII protocol around these bytes independent of UTF-8 fixtures.
  const ascii = quote("sz000001", { 1: "NAME" });
  const [before, after] = ascii.split("NAME");
  const bytes = Buffer.concat([
    Buffer.from(before),
    Buffer.from([0xb2, 0xe2, 0xca, 0xd4]),
    Buffer.from(after),
  ]);
  const result = await fetchQuotes(["sz000001", "sz000001"], {
    fetchImpl: async (url: unknown, options?: RequestInit) => {
      assert.equal(url, "https://qt.gtimg.cn/q=sz000001");
      assert.equal(options?.redirect, "error");
      assert.ok(options?.signal instanceof AbortSignal);
      return new Response(bytes);
    },
  });
  assert.equal(result[0].name, "测试");
  assert.equal(result[0].quotedAt, "2026-09-30T15:00:00+08:00");
});

test("invalid GB18030 bytes are rejected rather than displayed with replacement characters", async () => {
  await assert.rejects(
    fetchQuotes(["sh600519"], {
      fetchImpl: async () => new Response(Uint8Array.of(0x81)),
    }),
    { code: "INVALID_ENCODING" },
  );
});

test("daily bars prefer qfqday, preserve OHLC order and convert lots to shares", () => {
  const payload = kline("sh600519");
  payload.data.sh600519.day = [["2026-09-30", "99", "99", "99", "99", "99"]];
  assert.deepEqual(parseTencentKlines(JSON.stringify(payload), "sh600519"), {
    symbol: "sh600519",
    adjustment: "qfq",
    provider: "tencent",
    bars: [
      {
        date: "2026-09-30",
        open: 12.1,
        close: 12.5,
        high: 12.6,
        low: 11.9,
        volumeShares: 12345,
      },
    ],
  });
  assert.equal(
    parseTencentKlines(kline("sh000001", "day"), "sh000001").adjustment,
    "none",
  );
});

test("daily bars sort/deduplicate dates, reject invalid dates and retain missing values as null", () => {
  const parsed = parseTencentKlines(
    kline("sh000001", "day", [
      ["2026-09-30", "10", "11", "12", "9", "100"],
      ["2026-09-29", "0", "--", "-2", "NaN", ""],
      ["2026-02-30", "10", "11", "12", "9", "100"],
      ["2026-09-30", "10", "11.5", "12", "9", "0"],
      null,
    ]),
    "sh000001",
  );
  assert.deepEqual(
    parsed.bars.map((b) => b.date),
    ["2026-09-29", "2026-09-30"],
  );
  assert.deepEqual(parsed.bars[0], {
    date: "2026-09-29",
    open: null,
    close: null,
    high: null,
    low: null,
    volumeShares: null,
  });
  assert.equal(parsed.bars[1].close, 11.5);
  assert.equal(parsed.bars[1].volumeShares, 0);
});

test("kline empty data is empty; malformed/provider-error responses are rejected", () => {
  assert.deepEqual(
    parseTencentKlines({ code: 0, data: {} }, "sh600519").bars,
    [],
  );
  assert.deepEqual(
    parseTencentKlines(kline("sh600519", "qfqday", []), "sh600519").bars,
    [],
  );
  for (const bad of [
    null,
    {},
    "<html>failure</html>",
    { data: [] },
    { data: { sh600519: "wrong" } },
    { data: { sh600519: { qfqday: {} } } },
  ]) {
    assert.throws(() => parseTencentKlines(bad, "sh600519"), {
      code: "INVALID_RESPONSE",
    });
  }
  assert.throws(() => parseTencentKlines({ code: -1, data: {} }, "sh600519"), {
    code: "PROVIDER_ERROR",
  });
});

test("fetchDailyBars requests 60 daily qfq bars and decodes UTF-8 JSON", async () => {
  const result = await fetchDailyBars("sh000001", {
    fetchImpl: async (url: unknown) => {
      const parsed = new URL(url as string);
      assert.equal(parsed.origin, "https://web.ifzq.gtimg.cn");
      assert.equal(parsed.searchParams.get("param"), "sh000001,day,,,60,qfq");
      return new Response(JSON.stringify(kline("sh000001", "day")));
    },
  });
  assert.equal(result.bars.length, 1);
  assert.equal(result.adjustment, "none");
});

test("HTTP and transport errors are not converted into synthetic prices", async () => {
  await assert.rejects(
    fetchQuotes(["sh600519"], {
      fetchImpl: async () => new Response("unavailable", { status: 503 }),
    }),
    { code: "PROVIDER_HTTP_ERROR" },
  );
  await assert.rejects(
    fetchDailyBars("sh600519", {
      fetchImpl: async () => {
        throw new Error("connection lost");
      },
    }),
    /connection lost/,
  );
  await assert.rejects(fetchQuotes(["sh600519"], { timeoutMs: 0 }), {
    code: "INVALID_OPTIONS",
  });
});

test("response size is bounded both by headers and while streaming", async () => {
  await assert.rejects(
    fetchQuotes(["sh600519"], {
      fetchImpl: async () =>
        new Response("", { headers: { "content-length": "524289" } }),
    }),
    { code: "RESPONSE_TOO_LARGE" },
  );
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(300000));
      controller.enqueue(new Uint8Array(300000));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    fetchDailyBars("sh600519", { fetchImpl: async () => new Response(body) }),
    { code: "RESPONSE_TOO_LARGE" },
  );
  assert.equal(cancelled, true);
});

test("timeout aborts fetch and rejects even if a fetch implementation ignores abort", async () => {
  const seen: { signal?: AbortSignal | null } = {};
  await assert.rejects(
    fetchQuotes(["sh600519"], {
      timeoutMs: 15,
      fetchImpl: async (_url: unknown, options?: RequestInit) => {
        seen.signal = options?.signal;
        return new Promise<Response>(() => {});
      },
    }),
    { code: "PROVIDER_TIMEOUT" },
  );
  assert.equal(seen.signal?.aborted, true);
});

test("timeout includes stalled response bodies and cancels their reader", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    fetchDailyBars("sh600519", {
      timeoutMs: 15,
      fetchImpl: async () => new Response(body),
    }),
    { code: "PROVIDER_TIMEOUT" },
  );
  assert.equal(cancelled, true);
});

// ---- frontend/test/market-calendar.test.mjs ----

const session = (localTime: string) => getMarketSession(new Date(`${localTime}+08:00`));

test("National Day preserves September 30 quotes and names October 8 reopening", () => {
  const actual = session("2026-10-02T10:00:00");
  assert.deepEqual(actual, {
    date: "2026-10-02",
    status: "holiday",
    label: "国庆节休市",
    expectedQuoteDate: "2026-09-30",
    isOpen: false,
    nextTradingDate: "2026-10-08",
    calendarCoverage: "2026",
    reason: "国庆节休市，报价日期应取最近已知交易日。",
    source:
      "https://www.sse.com.cn/disclosure/announcement/general/c/c_20260915_10832273.shtml",
  });
});

test("every announced holiday range is closed and resumes on its announced date", () => {
  const cases: Array<[string, string, string | null, string]> = [
    ["2026-01-01", "2026-01-03", null, "2026-01-05"],
    ["2026-02-15", "2026-02-23", "2026-02-13", "2026-02-24"],
    ["2026-04-04", "2026-04-06", "2026-04-03", "2026-04-07"],
    ["2026-05-01", "2026-05-05", "2026-04-30", "2026-05-06"],
    ["2026-06-19", "2026-06-21", "2026-06-18", "2026-06-22"],
    ["2026-09-25", "2026-09-27", "2026-09-24", "2026-09-28"],
    ["2026-10-01", "2026-10-07", "2026-09-30", "2026-10-08"],
  ];
  for (const [first, last, previous, next] of cases) {
    for (
      let cursor = Date.parse(`${first}T00:00:00Z`);
      cursor <= Date.parse(`${last}T00:00:00Z`);
      cursor += 86_400_000
    ) {
      const date = new Date(cursor).toISOString().slice(0, 10);
      const actual = session(`${date}T10:00:00`);
      assert.equal(actual.status, "holiday", date);
      assert.equal(actual.isOpen, false, date);
      assert.equal(actual.expectedQuoteDate, previous, date);
      assert.equal(actual.nextTradingDate, next, date);
    }
    assert.equal(session(`${next}T10:00:00`).status, "morning", next);
  }
});

test("ordinary and make-up-work weekends remain closed", () => {
  const cases: Array<[string, string | null, string]> = [
    ["2026-01-04", null, "2026-01-05"],
    ["2026-02-14", "2026-02-13", "2026-02-24"],
    ["2026-02-28", "2026-02-27", "2026-03-02"],
    ["2026-05-09", "2026-05-08", "2026-05-11"],
    ["2026-09-20", "2026-09-18", "2026-09-21"],
    ["2026-10-10", "2026-10-09", "2026-10-12"],
    ["2026-10-11", "2026-10-09", "2026-10-12"],
  ];
  for (const [date, previous, next] of cases) {
    const actual = session(`${date}T10:00:00`);
    assert.equal(actual.status, "weekend", date);
    assert.equal(actual.isOpen, false, date);
    assert.equal(actual.expectedQuoteDate, previous, date);
    assert.equal(actual.nextTradingDate, next, date);
  }
});

test("session boundaries are half-open and only active quote phases are open", () => {
  const cases: Array<[string, string, boolean, string]> = [
    ["00:00:00", "preopen", false, "2026-09-30"],
    ["09:14:59.999", "preopen", false, "2026-09-30"],
    ["09:15:00", "auction", true, "2026-10-08"],
    ["09:24:59.999", "auction", true, "2026-10-08"],
    ["09:25:00", "preopen", false, "2026-10-08"],
    ["09:29:59.999", "preopen", false, "2026-10-08"],
    ["09:30:00", "morning", true, "2026-10-08"],
    ["11:29:59.999", "morning", true, "2026-10-08"],
    ["11:30:00", "lunch", false, "2026-10-08"],
    ["12:59:59.999", "lunch", false, "2026-10-08"],
    ["13:00:00", "afternoon", true, "2026-10-08"],
    ["14:56:59.999", "afternoon", true, "2026-10-08"],
    ["14:57:00", "closing", true, "2026-10-08"],
    ["14:59:59.999", "closing", true, "2026-10-08"],
    ["15:00:00", "postmarket", false, "2026-10-08"],
    ["23:59:59.999", "postmarket", false, "2026-10-08"],
  ];
  for (const [time, status, open, expected] of cases) {
    const actual = session(`2026-10-08T${time}`);
    assert.equal(actual.status, status, time);
    assert.equal(actual.isOpen, open, time);
    assert.equal(actual.expectedQuoteDate, expected, time);
    assert.equal(actual.nextTradingDate, "2026-10-09", time);
  }
});

test("China date and session are independent of source timezone notation and host timezone", () => {
  const instant = "2026-10-08T01:30:00Z";
  const expected = session("2026-10-08T09:30:00");
  assert.deepEqual(getMarketSession(new Date(instant)), expected);
  assert.deepEqual(
    getMarketSession(new Date("2026-10-07T21:30:00-04:00")),
    expected,
  );
  const moduleURL = new URL("../plugins/lunhui/lib/market.mjs", import.meta.url).href;
  const script = `import { getMarketSession } from ${JSON.stringify(moduleURL)}; process.stdout.write(JSON.stringify(getMarketSession(new Date(${JSON.stringify(instant)}))));`;
  for (const timezone of ["UTC", "America/New_York", "Asia/Shanghai"]) {
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      {
        env: { ...process.env, TZ: timezone },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), expected, timezone);
  }
});

test("China midnight, month end, and weekend transitions select the right dates", () => {
  const beforeMidnight = getMarketSession(new Date("2026-09-30T15:59:59.999Z"));
  const afterMidnight = getMarketSession(new Date("2026-09-30T16:00:00Z"));
  assert.equal(beforeMidnight.date, "2026-09-30");
  assert.equal(beforeMidnight.status, "postmarket");
  assert.equal(afterMidnight.date, "2026-10-01");
  assert.equal(afterMidnight.status, "holiday");
  assert.equal(afterMidnight.expectedQuoteDate, "2026-09-30");
  assert.equal(session("2026-03-02T09:00:00").expectedQuoteDate, "2026-02-27");
  assert.equal(session("2026-04-30T15:01:00").nextTradingDate, "2026-05-06");
});

test("year-edge searches stop at verified coverage without inferring adjacent years", () => {
  const januaryPreopen = session("2026-01-05T09:00:00");
  assert.equal(januaryPreopen.status, "preopen");
  assert.equal(januaryPreopen.expectedQuoteDate, null);
  assert.equal(januaryPreopen.nextTradingDate, "2026-01-06");
  assert.equal(session("2026-01-05T09:15:00").expectedQuoteDate, "2026-01-05");
  const december = session("2026-12-31T15:00:00");
  assert.equal(december.expectedQuoteDate, "2026-12-31");
  assert.equal(december.nextTradingDate, null);
  assert.equal(
    getMarketSession(new Date("2025-12-31T16:00:00Z")).date,
    "2026-01-01",
  );
  assert.equal(
    getMarketSession(new Date("2026-12-31T16:00:00Z")).status,
    "unknown",
  );
});

test("uncovered years and invalid input return explicit unknown metadata", () => {
  for (const date of ["2025-12-31", "2027-01-04"]) {
    const actual = session(`${date}T10:00:00`);
    assert.equal(actual.date, date);
    assert.equal(actual.status, "unknown");
    assert.equal(actual.isOpen, false);
    assert.equal(actual.expectedQuoteDate, null);
    assert.equal(actual.nextTradingDate, null);
    assert.equal(actual.calendarCoverage, "2026");
    assert.match(actual.reason, /不在覆盖范围/);
  }
  for (const input of [
    new Date("invalid"),
    null,
    "2026-10-08T10:00:00+08:00",
  ]) {
    const actual = getMarketSession(input as Date);
    assert.equal(actual.status, "unknown");
    assert.equal(actual.date, null);
    assert.equal(actual.expectedQuoteDate, null);
    assert.equal(actual.nextTradingDate, null);
    assert.equal(actual.isOpen, false);
  }
});

test("default invocation is safe and does not mutate an injected Date", () => {
  assert.equal(getMarketSession().calendarCoverage, "2026");
  const injected = new Date("2026-10-08T01:30:00Z");
  const original = injected.getTime();
  getMarketSession(injected);
  assert.equal(injected.getTime(), original);
});

// ---- frontend/test/market-service.test.mjs: the four cases that need no cache ----
// The source drives these through createMarketService with an injected clock and session. Here
// the same quotes go through what its snapshot() composes on a fresh fetch: validateSymbols on
// the request, normalizeQuotes at the clock, then assessQuote per quote against the session with
// forcedStale false (a fresh fetch is never forced stale).

/** `validateSymbols`'s JS signature is inferred from its default list; the cases also pass strings and junk. */
const validate = validateSymbols as (input?: unknown) => string[];

/** The open session the source's `harness()` injects, at its clock `OPEN_NOW`. */
const OPEN_NOW = new Date("2026-09-30T10:00:00+08:00");
function openSession() {
  return {
    date: "2026-09-30",
    status: "open",
    label: "交易中",
    expectedQuoteDate: "2026-09-30",
    isOpen: true,
    nextTradingDate: "2026-10-09",
    calendarCoverage: true,
    reason: null,
    source: "test",
  };
}
function stamp(date: Date): string {
  return new Date(date.getTime() + 8 * 3_600_000)
    .toISOString()
    .replace("Z", "+08:00");
}
/** The source's `quote(symbol, at, changes)`: one provider quote object, as `fetchQuotes` returns it. */
function providerQuote(symbol: string, at: Date, changes: Record<string, unknown> = {}) {
  return {
    symbol,
    name: `测试-${symbol}`,
    last: 12,
    previousClose: 11,
    open: 11.2,
    high: 12.1,
    low: 11.1,
    change: 1,
    changePercent: 9.09,
    volumeShares: 1200,
    amountCny: 14000,
    quotedAt: stamp(at),
    provider: "tencent",
    kind: "equity",
    ...changes,
  };
}
function snapshotQuotes(raw: unknown[], input: string, stub: ReturnType<typeof openSession>, nowMs: number) {
  const symbols = validate(input);
  return normalizeQuotes(raw, symbols, nowMs).map((item: unknown) => assessQuote(item, stub, nowMs, false));
}

test("validates, deduplicates and sorts a closed mainboard/index symbol set", () => {
  // Adapted: DEFAULT_SYMBOLS is module-private in the port, so its length is read through the
  // call without input, which validates and returns that default list.
  assert.equal(validate().length, 8);
  assert.deepEqual(validate("sz000001, sh600519 sz000001"), [
    "sh600519",
    "sz000001",
  ]);
  assert.deepEqual(validate([" SH600519 "]), ["sh600519"]);
  for (const invalid of [
    "",
    [],
    null,
    1,
    ["https://example.com"],
    ["sz300001"],
    ["sh688001"],
    ["sh000002"],
    ["sh600519?x=1"],
    [123],
  ]) {
    assert.throws(() => validate(invalid), RangeError);
  }
  assert.throws(
    () =>
      validate(
        Array.from(
          { length: 21 },
          (_, i) => `sh60${String(i).padStart(4, "0")}`,
        ),
      ),
    RangeError,
  );
  assert.equal(validate(Array(25).fill("sh600519")).length, 1);
});

test("open-market quality checks stale source time, future time and required fields", () => {
  const now = OPEN_NOW;
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ quotedAt: stamp(new Date(now.getTime() - 121_000)) }, "stale"],
    [{ quotedAt: stamp(new Date(now.getTime() + 61_000)) }, "invalid"],
    [{ quotedAt: "2026-09-31T10:00:00+08:00" }, "invalid"],
    [{ quotedAt: "2026-09-30 10:00:00" }, "invalid"],
    [{ quotedAt: null }, "missing"],
    [{ last: null }, "missing"],
    [{ last: -1 }, "invalid"],
    [{ last: Number.NaN }, "invalid"],
  ];
  for (const [changes, expected] of cases) {
    const raw = [
      providerQuote("sh600519", now, changes),
      providerQuote("sz000001", now),
    ];
    assert.equal(
      snapshotQuotes(raw, "sh600519,sz000001", openSession(), now.getTime())[0].quality,
      expected,
      JSON.stringify(changes),
    );
  }
});

test("lunch, after-hours and holiday close quality use expected date, not elapsed wall time", () => {
  const stub = openSession();
  stub.isOpen = false;
  stub.status = "lunch";
  let now = Date.parse("2026-09-30T12:45:00+08:00");
  let sourceTime = "2026-09-30T11:30:00+08:00";
  const quality = () =>
    snapshotQuotes([providerQuote("sh600519", new Date(sourceTime))], "sh600519", stub, now)[0].quality;
  assert.equal(quality(), "close");
  now = Date.parse("2026-09-30T18:00:00+08:00");
  stub.status = "postmarket";
  sourceTime = "2026-09-30T15:00:00+08:00";
  assert.equal(quality(), "close");
  now = Date.parse("2026-10-02T10:00:00+08:00");
  stub.date = "2026-10-02";
  stub.status = "holiday";
  stub.expectedQuoteDate = "2026-09-30";
  assert.equal(quality(), "close");
  stub.expectedQuoteDate = "2026-10-01";
  assert.equal(quality(), "stale");
});

test("closed sessions require quotes near the completed session boundary", () => {
  const cases: Array<[string, string, string, string, string]> = [
    ["lunch", "2026-09-30T12:15:00+08:00", "2026-09-30", "09:30:00", "stale"],
    ["lunch", "2026-09-30T12:15:00+08:00", "2026-09-30", "11:27:59", "stale"],
    ["lunch", "2026-09-30T12:15:00+08:00", "2026-09-30", "11:28:00", "close"],
    [
      "postmarket",
      "2026-09-30T18:00:00+08:00",
      "2026-09-30",
      "09:30:00",
      "stale",
    ],
    [
      "postmarket",
      "2026-09-30T18:00:00+08:00",
      "2026-09-30",
      "14:57:59",
      "stale",
    ],
    [
      "postmarket",
      "2026-09-30T18:00:00+08:00",
      "2026-09-30",
      "14:58:00",
      "close",
    ],
    ["holiday", "2026-10-02T10:00:00+08:00", "2026-09-30", "09:30:00", "stale"],
    ["holiday", "2026-10-02T10:00:00+08:00", "2026-09-30", "14:58:00", "close"],
    ["preopen", "2026-09-30T09:00:00+08:00", "2026-09-29", "09:30:00", "stale"],
    ["preopen", "2026-09-30T09:00:00+08:00", "2026-09-29", "14:58:00", "close"],
    ["preopen", "2026-09-30T09:25:00+08:00", "2026-09-30", "09:22:59", "stale"],
    ["preopen", "2026-09-30T09:25:00+08:00", "2026-09-30", "09:23:00", "close"],
    ["preopen", "2026-09-30T09:29:59+08:00", "2026-09-30", "09:25:00", "close"],
  ];
  for (const [
    status,
    nowTime,
    expectedDate,
    sourceClock,
    expectedQuality,
  ] of cases) {
    const stub = openSession();
    Object.assign(stub, {
      date: nowTime.slice(0, 10),
      status,
      isOpen: false,
      expectedQuoteDate: expectedDate,
    });
    const raw = [
      providerQuote("sh600519", new Date(`${expectedDate}T${sourceClock}+08:00`)),
    ];
    const [result] = snapshotQuotes(raw, "sh600519", stub, Date.parse(nowTime));
    assert.equal(
      result.quality,
      expectedQuality,
      `${status} ${sourceClock}`,
    );
    assert.equal(
      result.validity.sessionBoundaryMet,
      expectedQuality === "close",
    );
  }
});

// ---- freezeSample: the frozen sample buildAnalysisContext consumes ----

test("freezeSample on fixtures yields the snapshot shape buildAnalysisContext consumes", async () => {
  const { snapshot, histories } = await freezeSample({ symbols: ["sh000001", "sh600519"], fetchImpl: fixtureFetch, now: new Date("2026-10-13T01:00:33.165Z") });
  assert.equal(snapshot.provider, "tencent");
  assert.deepEqual(snapshot.cache, { state: "fresh" });
  assert.deepEqual(snapshot.quotes.map((q) => q.symbol), ["sh000001", "sh600519"]);
  assert.equal(histories.length, 2);
  assert.equal(snapshot.servedAt, "2026-10-13T01:00:33.165Z");
  assert.ok(snapshot.quotes.every((q) => q.quality === "close"));
  assert.ok(histories.every((h) => h.provider === "tencent" && Array.isArray(h.bars)));
  assert.deepEqual(histories.map((h) => [h.symbol, h.adjustment]), [["sh000001", "none"], ["sh600519", "qfq"]]);
});
test("freezeSample never calls fetch for a refused symbol list", async () => {
  let calls = 0;
  await assert.rejects(freezeSample({ symbols: ["sh688001"], fetchImpl: async () => { calls += 1; throw new Error("unreachable"); } }), /INVALID_SYMBOL/);
  assert.equal(calls, 0);
});
test("freezeSample without now stamps after the quote reply and assesses at that stamp", async () => {
  // The real clock: the fixture quotes (2026-10-12) must precede it, as they do from that day on.
  const seen: { quoteReplyAt?: Date } = {};
  const fetchImpl = async (url: string | URL, init?: RequestInit) => {
    const response = await fixtureFetch(url, init);
    if (new URL(url).host === "qt.gtimg.cn") {
      await new Promise((resolve) => setTimeout(resolve, 20)); // the reply lands a moment after the call
      seen.quoteReplyAt = new Date();
    }
    return response;
  };
  const { snapshot, histories } = await freezeSample({ symbols: ["sh000001", "sh600519"], fetchImpl });
  const replyMs = seen.quoteReplyAt?.getTime() ?? Number.NaN;
  assert.ok(Date.parse(snapshot.servedAt) >= replyMs, `servedAt ${snapshot.servedAt} precedes the quote reply`);
  assert.ok(Date.parse(snapshot.receivedAt) >= replyMs, `receivedAt ${snapshot.receivedAt} precedes the quote reply`);
  // The same instant dates the session and the assessment, and stamps every history.
  const stampMs = Date.parse(snapshot.servedAt);
  const atStamp = getMarketSession(new Date(stampMs));
  for (const q of snapshot.quotes) {
    assert.equal(q.validity.sourceAgeMs, stampMs - Date.parse(q.quotedAt ?? ""), q.symbol);
    assert.equal(q.validity.expectedQuoteDate, atStamp.expectedQuoteDate, q.symbol);
  }
  assert.ok(histories.length > 0 && histories.every((h) => h.receivedAt === snapshot.receivedAt));
});

/** The fixture instant (2026-10-13 09:00:33 China time, pre-open) and the eight fixture symbols. */
const FREEZE_AT = new Date("2026-10-13T01:00:33.165Z");
const FIXTURE_SYMBOLS = ["sh000001", "sz399001", "sz399006", "sh000300", "sh600519", "sz000001", "sh601318", "sz000333"];

test("freezeSample calls a clock function once, after the quote reply", async () => {
  const seen: { replyAt?: number; calledAt?: number; calls: number } = { calls: 0 };
  const fetchImpl = async (url: string | URL, init?: RequestInit) => {
    const response = await fixtureFetch(url, init);
    if (new URL(url).host === "qt.gtimg.cn") {
      await new Promise((resolve) => setTimeout(resolve, 20)); // the reply lands a moment after the call
      seen.replyAt = Date.now();
    }
    return response;
  };
  const clock = () => {
    seen.calls += 1;
    seen.calledAt = Date.now();
    return FREEZE_AT;
  };
  const { snapshot } = await freezeSample({ symbols: ["sh000001", "sh600519"], fetchImpl, now: clock });
  assert.equal(seen.calls, 1);
  assert.ok((seen.calledAt ?? Number.NaN) >= (seen.replyAt ?? Number.NaN), "the clock was read before the quote reply resolved");
  assert.equal(snapshot.servedAt, FREEZE_AT.toISOString());
});

test("freezeSample rejects a now that is neither a Date nor a function before any fetch", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    throw new Error("unreachable");
  };
  for (const now of ["2026-10-13", new Date("nope")]) {
    await assert.rejects(freezeSample({ symbols: ["sh000001"], fetchImpl, now: now as Date }), { code: "INVALID_NOW", message: /^INVALID_NOW/ });
  }
  assert.equal(calls, 0);
});

test("freezeSample fetches every history before the quote, at most four at a time", async () => {
  const events: string[] = [];
  const kline = { inFlight: 0, maxInFlight: 0 };
  const fetchImpl = async (url: string | URL, init?: RequestInit) => {
    const isKline = new URL(url).host === "web.ifzq.gtimg.cn";
    events.push(isKline ? "kline:start" : "quote:start");
    if (isKline) kline.maxInFlight = Math.max(kline.maxInFlight, ++kline.inFlight);
    try {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return await fixtureFetch(url, init);
    } finally {
      if (isKline) kline.inFlight -= 1;
      events.push(isKline ? "kline:settled" : "quote:settled");
    }
  };
  const { histories } = await freezeSample({ symbols: FIXTURE_SYMBOLS, fetchImpl, now: FREEZE_AT });
  assert.equal(histories.length, 8);
  assert.equal(events.filter((event) => event === "quote:start").length, 1);
  const beforeQuote = events.slice(0, events.indexOf("quote:start"));
  assert.equal(beforeQuote.filter((event) => event === "kline:start").length, 8);
  assert.equal(beforeQuote.filter((event) => event === "kline:settled").length, 8);
  assert.equal(kline.maxInFlight, 4);
});

/** A `web.ifzq.gtimg.cn` daily-bar request for `symbol`. */
function isKlineFor(url: string | URL, symbol: string): boolean {
  const target = new URL(url);
  return target.host === "web.ifzq.gtimg.cn" && (target.searchParams.get("param") ?? "").startsWith(`${symbol},`);
}
/** The source service's no-cache failure for sh600519: its `history()` minus the warnings the context does not read. */
const SH600519_FAILED = {
  symbol: "sh600519",
  provider: "tencent",
  receivedAt: null,
  adjustment: null,
  bars: [],
  cache: { state: "unavailable" },
};

test("freezeSample keeps a failed history in the source failure shape", async () => {
  const fetchImpl = async (url: string | URL, init?: RequestInit) => {
    if (isKlineFor(url, "sh600519")) throw new Error("connection lost");
    return fixtureFetch(url, init);
  };
  const { histories } = await freezeSample({ symbols: ["sh000001", "sh600519"], fetchImpl, now: FREEZE_AT });
  assert.deepEqual(histories.map((h) => h.symbol), ["sh000001", "sh600519"]);
  assert.deepEqual(histories[1], SH600519_FAILED);
});

test("freezeSample turns an empty daily reply into the source failure shape", async () => {
  const fetchImpl = async (url: string | URL, init?: RequestInit) =>
    isKlineFor(url, "sh600519") ? new Response(JSON.stringify({ code: 0, data: {} })) : fixtureFetch(url, init);
  const { histories } = await freezeSample({ symbols: ["sh000001", "sh600519"], fetchImpl, now: FREEZE_AT });
  assert.deepEqual(histories.map((h) => h.symbol), ["sh000001", "sh600519"]);
  assert.deepEqual(histories[1], SH600519_FAILED);
});

// ---- the minute line, limits and exchange (run view plan 1 Task 1); synthetic replies only ----

test("minuteIndex maps the session grid and nothing else", () => {
  assert.deepEqual(["0930", "1130", "1300", "1500"].map(minuteIndex), [0, 120, 121, 241]);
  assert.deepEqual(["0925", "1200", "1505"].map(minuteIndex), [null, null, null]);
  assert.deepEqual([0, 120, 121, 241].map(minuteLabel), ["09:30", "11:30", "13:00", "15:00"]);
});
test("parseTencentMinutes picks the session day, fills gaps, drops after-hours", () => {
  const reply = { code: 0, data: { sz000678: { data: [
    { date: "20261028", prec: "16.01", data: ["0930 16.50 100 165000.00"] },
    { date: "20261027", prec: "14.55", data: ["0930 15.24 1000 1524000.00", "0931 15.60 1500 2304000.00",
      "1500 16.01 4000 6300000.00", "1505 16.01 4100 6460000.00"] }] } } };
  const m = parseTencentMinutes(JSON.stringify(reply), "sz000678", "2026-10-27");
  assert.equal(m.prec, 14.55); assert.equal(m.through, "15:00"); assert.equal(m.price.length, 242);
  assert.deepEqual(m.price.slice(0, 3), [15.24, 15.6, 15.6]);
  assert.deepEqual(m.volume.slice(0, 3), [1000, 500, 0]);
  assert.equal(m.price[241], 16.01); assert.equal(m.volume[241], 2500); assert.equal(m.amount[1], 780000);
});
test("a mid-session day ends at through", () => {
  const rows = Array.from({ length: 40 }, (_, i) => `${minuteLabel(i).replace(":", "")} 10.00 ${100 * (i + 1)} ${1000 * (i + 1)}.00`);
  const m = parseTencentMinutes({ data: { sh600838: { data: [{ date: "20261028", prec: "13.31", data: rows }] } } }, "sh600838", "2026-10-28");
  assert.equal(m.through, "10:09"); assert.equal(m.price.length, 40);
});
test("a reply without the session's day is INVALID_RESPONSE", () => {
  assert.throws(() => parseTencentMinutes({ data: { sh600838: { data: [] } } }, "sh600838", "2026-10-27"),
    (e: any) => e.code === "INVALID_RESPONSE");
});
test("limits round half up to the fen", () => {
  assert.deepEqual(limitPrices(12.10, 0.1), { up: 13.31, down: 10.89 });
  assert.equal(limitPrices(8.95, 0.1).up, 9.85); assert.equal(limitPrices(14.55, 0.1).up, 16.01);
  assert.deepEqual(limitPrices(56.14, 0.2), { up: 67.37, down: 44.91 });
  assert.equal(limitPrices(77.76, 0.2).down, 62.21); assert.equal(limitPrices(3.33, 0.1).down, 3.00);
  assert.deepEqual([["600838", "上海九百"], ["301314", ""], ["688001", ""], ["000001", "*ST样本"], ["830001", ""]]
    .map(([c, n]) => limitRate(c, n)), [0.1, 0.2, 0.2, 0.05, 0.3]);
  assert.deepEqual(["600838", "000678", "301314", "830001", "920001"].map(exchangeOf), ["sh", "sz", "sz", null, null]);
});
test("minuteItems marks a code without an exchange and never fetches it", async () => {
  let calls = 0;
  const items = await minuteItems([{ code: "830001", symbol: null }], "2026-10-27", { fetchImpl: async () => { calls++; throw new Error("no"); } });
  assert.deepEqual(items, [{ kind: "minutes_missing", code: "830001", symbol: null, reason: "NO_EXCHANGE" }]);
  assert.equal(calls, 0);
});
test("fetchMinutes asks for code=<symbol> and minuteItems keeps entry order and failure codes", async () => {
  const urls: string[] = [];
  const day = (prec: string) => [{ date: "20261027", prec, data: ["0930 10.00 10 10000.00"] }];
  const fetchImpl = async (url: string) => {
    urls.push(url);
    const code = new URL(url).searchParams.get("code")!;
    if (code === "sz000002") return new Response("not json");
    return new Response(JSON.stringify({ code: 0, data: { [code]: { data: day("9.90") } } }));
  };
  const m = await fetchMinutes("sh600838", "2026-10-27", { fetchImpl: fetchImpl as any });
  assert.equal(urls[0], `${MINUTES_URL}?code=sh600838`);
  assert.equal(m.provider, "tencent"); assert.equal(m.through, "09:30"); assert.deepEqual(m.price, [10]);
  const items = await minuteItems([{ code: "600838", symbol: "sh600838" }, { symbol: "sz000002" }, { code: "830001", symbol: null }],
    "2026-10-27", { fetchImpl: fetchImpl as any, inFlight: 2 });
  assert.deepEqual(items.map((i: any) => [i.kind, i.code, i.symbol, i.reason]), [
    ["minutes", "600838", "sh600838", undefined], ["minutes_missing", undefined, "sz000002", "INVALID_RESPONSE"],
    ["minutes_missing", "830001", null, "NO_EXCHANGE"]]);
  assert.equal(Object.hasOwn(items[1], "code"), false);
  const plain = await minuteItems([{ symbol: "sh600838" }], "2026-10-27", { fetchImpl: (async () => { throw new Error("x"); }) as any });
  assert.equal((plain[0] as any).reason, "UNKNOWN");
  await assert.rejects(fetchMinutes("bj830001", "2026-10-27", { fetchImpl: fetchImpl as any }), (e: any) => e.code === "INVALID_SYMBOL");
});
