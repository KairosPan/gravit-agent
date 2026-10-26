// face/plugins/lunhui/lib/market.mjs
/**
 * The Lunhui market layer (spec D2, D3): the public Tencent quote and daily-bar adapters, the
 * verified 2026 SSE calendar and the pure quote and history assessment whose output the research
 * context is built from, ported into one module from the source branch (evolving-alpha
 * `codex/lunhui-agent-design` @ 2ae4df0), plus `freezeSample`, the one new function, which
 * composes them into the frozen sample `freeze_market_snapshot` builds a run from (spec §5.1).
 *
 * Three sections are ported verbatim, source comments and the SSE notice URLs kept:
 * `frontend/market-provider.mjs` whole, `frontend/market-calendar.mjs` whole, and of
 * `frontend/market-service.mjs` the five pure functions `validateSymbols`, `normalizeQuotes`,
 * `completedSessionBoundary`, `assessQuote` and `normalizeHistory` with the constants and
 * helpers they call, all five exported here (the last four are module-private there). The
 * service's cache, `createMarketService`, is not ported: a frozen sample is fetched once, so its
 * snapshot's `cache.state` is always "fresh" (spec D3), and only a history whose fetch failed or
 * whose reply held no bar carries the service's "unavailable" failure shape. Besides those
 * exports and that cut, making one module of three takes two edits: the service's imports are
 * dropped, and the three module-private provider names the service declares again are renamed
 * in the provider section - `validateSymbols` to `validateProviderSymbols`, `validDate` to
 * `validProviderDate`, `quoteTime` to `providerQuoteTime` - so the five service functions keep
 * their bodies unchanged.
 * `DEFAULT_SYMBOLS`, exported by the service, is `validateSymbols`'s default and stays private.
 *
 * The response cap is the provider's `MAX_RESPONSE_BYTES` (512 KiB) and the request timeout
 * `fetchQuotes`' and `fetchDailyBars`' `timeoutMs` (7,000 ms by default). This file imports only
 * `./calendar.mjs`: `fetch`, `TextDecoder`, `AbortController`, `URL` and `Intl` are Node 22 globals.
 *
 * Since plan 1 Task 2 the calendar section no longer hard-codes 2026: its constants and holiday
 * ranges moved, unchanged, into `calendar/2026.json`, read through `loadCalendars()` once at
 * module load; `isCovered`, `holidayOn` and `isTradingDate` read those tables, the coverage field
 * and the uncovered reasons name the covered years, and `getMarketSession` is otherwise verbatim.
 */
import { coverageOf, holidayOn as tableHolidayOn, isTradingDay, isWeekend, loadCalendars } from "./calendar.mjs";

// -------------------------------------------------------------------------------------------------
// frontend/market-provider.mjs (verbatim; three private names renamed, see the header)
// -------------------------------------------------------------------------------------------------

// Public Tencent quote and daily-bar adapters. Provider responses are data, never JS.
// Field order was checked against both endpoints on 2026-10-02:
// https://qt.gtimg.cn/q=sh000001,sh600519
// https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh600519,day,,,60,qfq
// Daily OHLCV order also matches AKShare's stock_zh_index_daily_tx implementation:
// https://github.com/akfamily/akshare/blob/main/akshare/index/index_stock_zh.py

const SYMBOL = /^(sh|sz)\d{6}$/;
const MAX_SYMBOLS = 100;
const MAX_RESPONSE_BYTES = 512 * 1024;
const QUOTE_URL = "https://qt.gtimg.cn/q=";
const DAILY_URL = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get";

function providerError(code, message) {
  return Object.assign(new Error(message), { code });
}

function validateSymbol(symbol) {
  if (typeof symbol !== "string" || !SYMBOL.test(symbol)) {
    throw providerError(
      "INVALID_SYMBOL",
      "证券代码必须为 sh 或 sz 加六位数字。",
    );
  }
  return symbol;
}

function validateProviderSymbols(symbols) {
  if (!Array.isArray(symbols) || symbols.length > MAX_SYMBOLS) {
    throw providerError(
      "INVALID_SYMBOLS",
      `每次最多查询 ${MAX_SYMBOLS} 个证券代码。`,
    );
  }
  return [...new Set(symbols.map(validateSymbol))];
}

function numeric(value, { positive = false, nonnegative = false } = {}) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (
    typeof value === "string" &&
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())
  )
    return null;
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > Number.MAX_SAFE_INTEGER)
    return null;
  if (positive && number <= 0) return null;
  if (nonnegative && number < 0) return null;
  return number === 0 ? 0 : number;
}

function scaled(value, factor) {
  const number = numeric(value, { nonnegative: true });
  return number === null
    ? null
    : numeric(number * factor, { nonnegative: true });
}

function validProviderDate(year, month, day) {
  if (
    year < 1970 ||
    year > 9999 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  )
    return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function providerQuoteTime(value) {
  if (typeof value !== "string" || !/^\d{14}$/.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const hour = Number(value.slice(8, 10));
  const minute = Number(value.slice(10, 12));
  const second = Number(value.slice(12, 14));
  if (!validProviderDate(year, month, day) || hour > 23 || minute > 59 || second > 59)
    return null;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}+08:00`;
}

function dailyDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return null;
  const [year, month, day] = value.split("-").map(Number);
  return validProviderDate(year, month, day) ? value : null;
}

function emptyQuote(symbol) {
  return {
    symbol,
    name: null,
    last: null,
    previousClose: null,
    open: null,
    high: null,
    low: null,
    change: null,
    changePercent: null,
    volumeShares: null,
    amountCny: null,
    quotedAt: null,
    provider: "tencent",
    kind: /^(?:sh000|sz399)/.test(symbol) ? "index" : "equity",
  };
}

/** Parse already-decoded GB18030 text; requested symbols retain their order and missing fields. */
export function parseTencentQuotes(text, requestedSymbols = []) {
  const requested = validateProviderSymbols(requestedSymbols);
  if (typeof text !== "string")
    throw providerError("INVALID_RESPONSE", "报价响应必须为文本。");
  if (text.length > MAX_RESPONSE_BYTES)
    throw providerError("RESPONSE_TOO_LARGE", "报价响应超过大小限制。");
  const allowed = new Set(requested);
  const quotes = new Map();
  // Only accept literal assignments; no eval, Function, JSONP execution or escape interpretation.
  const records =
    /(?:^|[;\r\n])\s*(?:var\s+)?v_((?:sh|sz)\d{6})\s*=\s*"([^"\\\r\n]*)"\s*(?=;|$|[\r\n])/g;
  for (const match of text.matchAll(records)) {
    const [, symbol, payload] = match;
    if (requested.length && !allowed.has(symbol)) continue;
    const fields = payload.split("~");
    if (fields.length < 6 || fields[2] !== symbol.slice(2)) continue;
    const quote = emptyQuote(symbol);
    const name = fields[1]?.trim();
    quote.name =
      name && name.length <= 100 && !/[\u0000-\u001f\u007f\ufffd]/.test(name)
        ? name
        : null;
    quote.last = numeric(fields[3], { positive: true });
    quote.previousClose = numeric(fields[4], { positive: true });
    quote.open = numeric(fields[5], { positive: true });
    quote.high = numeric(fields[33], { positive: true });
    quote.low = numeric(fields[34], { positive: true });
    quote.change = numeric(fields[31]);
    quote.changePercent = numeric(fields[32]);
    quote.volumeShares = scaled(fields[6], 100); // Provider lots -> shares, including index aggregates.
    quote.amountCny = scaled(fields[37], 10000); // Provider ten-thousand CNY -> CNY.
    quote.quotedAt = providerQuoteTime(fields[30]); // Provider time; never replace it with fetch time.
    quotes.set(symbol, quote);
  }
  return requested.length
    ? requested.map((symbol) => quotes.get(symbol) ?? emptyQuote(symbol))
    : [...quotes.values()];
}

/** Parse JSON (or an already-decoded JSON object); no executable JSONP is accepted. */
export function parseTencentKlines(payload, symbol) {
  validateSymbol(symbol);
  let data = payload;
  if (typeof data === "string") {
    if (data.length > MAX_RESPONSE_BYTES)
      throw providerError("RESPONSE_TOO_LARGE", "日K响应超过大小限制。");
    try {
      data = JSON.parse(data.trim());
    } catch {
      throw providerError("INVALID_RESPONSE", "腾讯日K响应不是有效 JSON。");
    }
  }
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    !data.data ||
    typeof data.data !== "object" ||
    Array.isArray(data.data)
  ) {
    throw providerError("INVALID_RESPONSE", "腾讯日K响应结构无效。");
  }
  if (data.code !== undefined && data.code !== 0 && data.code !== "0") {
    throw providerError("PROVIDER_ERROR", "腾讯日K接口返回错误状态。");
  }
  const node = Object.hasOwn(data.data, symbol) ? data.data[symbol] : null;
  if (node !== null && (typeof node !== "object" || Array.isArray(node))) {
    throw providerError("INVALID_RESPONSE", "腾讯证券日K结构无效。");
  }
  const field = node && Object.hasOwn(node, "qfqday") ? "qfqday" : "day";
  const rows = node?.[field] ?? [];
  if (!Array.isArray(rows) || rows.length > 1000) {
    throw providerError("INVALID_RESPONSE", "腾讯日K列表结构或长度无效。");
  }
  const bars = new Map();
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const date = dailyDate(row[0]);
    if (!date) continue; // An untrusted date cannot be positioned on a time axis.
    bars.set(date, {
      date,
      open: numeric(row[1], { positive: true }),
      close: numeric(row[2], { positive: true }),
      high: numeric(row[3], { positive: true }),
      low: numeric(row[4], { positive: true }),
      volumeShares: scaled(row[5], 100),
    });
  }
  return {
    symbol,
    adjustment: field === "qfqday" ? "qfq" : "none",
    bars: [...bars.values()].sort((a, b) => a.date.localeCompare(b.date)),
    provider: "tencent",
  };
}

async function fetchBytes(url, fetchImpl, timeoutMs) {
  if (
    typeof fetchImpl !== "function" ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > 120000
  ) {
    throw providerError("INVALID_OPTIONS", "fetchImpl 或超时设置无效。");
  }
  const controller = new AbortController();
  const timeoutError = providerError("PROVIDER_TIMEOUT", "腾讯行情请求超时。");
  let reader;
  const cancelReader = () => {
    reader?.cancel(controller.signal.reason).catch(() => {});
  };
  controller.signal.addEventListener("abort", cancelReader, { once: true });
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(timeoutError);
      reject(timeoutError);
    }, timeoutMs);
  });
  const request = async () => {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      redirect: "error",
      headers: {
        Accept: "*/*",
        Referer: "https://gu.qq.com/",
        "User-Agent": "Lunhui-Market-Dashboard/1.0",
      },
    });
    if (!response?.ok)
      throw providerError(
        "PROVIDER_HTTP_ERROR",
        `腾讯行情 HTTP ${response?.status ?? "unknown"}。`,
      );
    const declaredLength = response.headers?.get?.("content-length");
    if (
      declaredLength &&
      /^\d+$/.test(declaredLength) &&
      Number(declaredLength) > MAX_RESPONSE_BYTES
    ) {
      await response.body?.cancel?.().catch(() => {});
      throw providerError("RESPONSE_TOO_LARGE", "腾讯行情响应超过大小限制。");
    }
    if (!response.body?.getReader) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > MAX_RESPONSE_BYTES)
        throw providerError("RESPONSE_TOO_LARGE", "腾讯行情响应超过大小限制。");
      return bytes;
    }
    reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        if (controller.signal.aborted) throw timeoutError;
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw providerError(
            "RESPONSE_TOO_LARGE",
            "腾讯行情响应超过大小限制。",
          );
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
      reader = undefined;
    }
    if (controller.signal.aborted) throw timeoutError;
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  };
  try {
    return await Promise.race([request(), timeout]);
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener("abort", cancelReader);
  }
}

export async function fetchQuotes(
  symbols,
  { fetchImpl = fetch, timeoutMs = 7000 } = {},
) {
  const requested = validateProviderSymbols(symbols);
  if (!requested.length) return [];
  const bytes = await fetchBytes(
    `${QUOTE_URL}${requested.join(",")}`,
    fetchImpl,
    timeoutMs,
  );
  let text;
  try {
    text = new TextDecoder("gb18030", { fatal: true }).decode(bytes);
  } catch {
    throw providerError("INVALID_ENCODING", "腾讯报价不是有效 GB18030 文本。");
  }
  return parseTencentQuotes(text, requested);
}

export async function fetchDailyBars(
  symbol,
  { fetchImpl = fetch, timeoutMs = 7000 } = {},
) {
  validateSymbol(symbol);
  const url = new URL(DAILY_URL);
  url.searchParams.set("param", `${symbol},day,,,60,qfq`);
  const bytes = await fetchBytes(url.href, fetchImpl, timeoutMs);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw providerError("INVALID_ENCODING", "腾讯日K不是有效 UTF-8 文本。");
  }
  return parseTencentKlines(text, symbol);
}

// -------------------------------------------------------------------------------------------------
// frontend/market-calendar.mjs (verbatim)
// -------------------------------------------------------------------------------------------------

// Read-only quote freshness metadata, not an order-admission calendar.
// Coverage is deliberately limited to the verified SSE notices in the per-year tables
// (`calendar/<year>.json`); a year without a table is uncovered, never guessed.
const tables = loadCalendars();
const CALENDAR_YEAR = [...tables.keys()].join(",");
const DAY_MS = 86_400_000;
const latestTable = [...tables.values()].at(-1);
const ANNUAL_SOURCE = latestTable?.source ?? "";
/** The annual notice of the date's own year when covered, else the latest table's. */
const annualSourceOf = (date) =>
  tables.get(String(date).slice(0, 4))?.source ?? ANNUAL_SOURCE;

const chinaClock = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  calendar: "gregory",
  numberingSystem: "latn",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const isCovered = (date) => coverageOf(date, tables) === "covered";
const holidayOn = (date) => tableHolidayOn(date, tables);
const utcDay = (date) => Date.parse(`${date}T00:00:00Z`);
const isTradingDate = (date) => isTradingDay(date, tables);

function adjacentTradingDate(date, direction) {
  let day = utcDay(date);
  for (;;) {
    day += direction * DAY_MS;
    const candidate = new Date(day).toISOString().slice(0, 10);
    if (!isCovered(candidate)) return null;
    if (isTradingDate(candidate)) return candidate;
  }
}

/**
 * Describe the ordinary A-share auction/continuous quote session in China time.
 * The provided Date is an absolute instant; the host's timezone is not used.
 *
 * `nextTradingDate` is strictly after `date`, even before today's opening.
 * `expectedQuoteDate` advances at 09:15, including the 09:25–09:30 pause.
 * A null adjacent date means it falls outside verified calendar coverage.
 * `isOpen` marks the configured ordinary quote-changing phases, not proof that
 * an individual security is trading. Post-close services and unscheduled market
 * closures are outside this freshness hint; it must not authorize an order.
 *
 * @param {Date} [now]
 * @returns {{date: string|null, status: string, label: string,
 * expectedQuoteDate: string|null, isOpen: boolean, nextTradingDate: string|null,
 * calendarCoverage: string, reason: string, source: string}} - `calendarCoverage` is the covered
 * years joined by `,` ('2026' today)
 */
export function getMarketSession(now = new Date()) {
  const result = {
    date: null,
    status: "unknown",
    label: "交易日历未知",
    expectedQuoteDate: null,
    isOpen: false,
    nextTradingDate: null,
    calendarCoverage: CALENDAR_YEAR,
    reason: "观测时间无效，无法判断报价日期。",
    source: ANNUAL_SOURCE,
  };
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return result;

  const parts = Object.fromEntries(
    chinaClock.formatToParts(now).map((part) => [part.type, part.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  result.date = date;
  if (!isCovered(date)) {
    result.reason = `只核实了 ${CALENDAR_YEAR} 年交易日历；当前中国日期不在覆盖范围内。`;
    return result;
  }
  result.source = annualSourceOf(date);

  result.nextTradingDate = adjacentTradingDate(date, 1);
  const holiday = holidayOn(date);
  if (holiday || isWeekend(date)) {
    result.status = holiday ? "holiday" : "weekend";
    result.label = holiday ? `${holiday.name}休市` : "周末休市";
    result.source = holiday?.source ?? annualSourceOf(date);
    result.expectedQuoteDate = adjacentTradingDate(date, -1);
    result.reason = holiday
      ? `${holiday.name}休市，报价日期应取最近已知交易日。`
      : "周末休市，调休工作日不改变证券市场周末休市安排。";
    return result;
  }

  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  result.expectedQuoteDate =
    minute < 555 ? adjacentTradingDate(date, -1) : date;
  if (minute < 555) {
    result.status = "preopen";
    result.label = "盘前";
    result.reason = "尚未进入 09:15 开盘集合竞价，报价应沿用最近已知交易日。";
  } else if (minute < 565) {
    result.status = "auction";
    result.label = "开盘集合竞价";
    result.reason = "处于开盘集合竞价观察时段，报价日期应为当日。";
    result.isOpen = true;
  } else if (minute < 570) {
    result.status = "preopen";
    result.label = "连续竞价前";
    result.reason =
      "开盘集合竞价已结束，等待 09:30 连续竞价；报价日期仍为当日。";
  } else if (minute < 690) {
    result.status = "morning";
    result.label = "上午连续竞价";
    result.reason = "处于上午连续竞价观察时段，报价日期应为当日。";
    result.isOpen = true;
  } else if (minute < 780) {
    result.status = "lunch";
    result.label = "午间休市";
    result.reason = "午间休市，保留当日上午报价日期。";
  } else if (minute < 897) {
    result.status = "afternoon";
    result.label = "下午连续竞价";
    result.reason = "处于下午连续竞价观察时段，报价日期应为当日。";
    result.isOpen = true;
  } else if (minute < 900) {
    result.status = "closing";
    result.label = "收盘集合竞价";
    result.reason = "处于收盘集合竞价观察时段，报价日期应为当日。";
    result.isOpen = true;
  } else {
    result.status = "postmarket";
    result.label = "常规竞价已结束";
    result.reason =
      "常规竞价观察时段已结束，保留当日报价日期；不判断盘后其他交易服务。";
  }
  if (result.expectedQuoteDate === null) {
    result.reason += ` 上一交易日超出已核实的 ${CALENDAR_YEAR} 年日历，未推测其日期。`;
  }
  return result;
}

// -------------------------------------------------------------------------------------------------
// frontend/market-service.mjs: the five pure functions and what they call (verbatim, exported)
// -------------------------------------------------------------------------------------------------

const INDEX_SYMBOLS = new Set(["sh000001", "sz399001", "sz399006", "sh000300"]);
const QUOTE_FIELDS = [
  "last",
  "previousClose",
  "open",
  "high",
  "low",
  "change",
  "changePercent",
  "volumeShares",
  "amountCny",
];
const REQUIRED_FIELDS = ["last", "quotedAt"];

const DEFAULT_SYMBOLS = Object.freeze([
  "sh000001",
  "sz399001",
  "sz399006",
  "sh000300",
  "sh600519",
  "sz000001",
  "sh601318",
  "sz000333",
]);

export function validateSymbols(input = DEFAULT_SYMBOLS) {
  const values =
    typeof input === "string" ? input.trim().split(/[\s,]+/) : input;
  if (!Array.isArray(values) || !values.length)
    throw new RangeError("请提供至少一个证券代码。");
  const result = [];
  for (const value of values) {
    if (typeof value !== "string")
      throw new RangeError("证券代码必须是字符串。");
    const symbol = value.trim().toLowerCase();
    if (
      !INDEX_SYMBOLS.has(symbol) &&
      !/^(?:sh60\d{4}|sz00\d{4})$/.test(symbol)
    ) {
      throw new RangeError("仅支持指定指数及沪深主板证券代码。");
    }
    if (!result.includes(symbol)) result.push(symbol);
    if (result.length > 20) throw new RangeError("一次最多查询 20 个证券。");
  }
  return result.sort();
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function chinaDate(ms) {
  return new Date(ms + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return (
    Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value
  );
}
function quoteTime(value) {
  if (typeof value !== "string") return null;
  const match =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (
    !match ||
    !validDate(match[1]) ||
    +match[2] > 23 ||
    +match[3] > 59 ||
    +match[4] > 59
  )
    return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function normalizeQuotes(raw, symbols, nowMs) {
  if (!Array.isArray(raw)) throw new Error("Invalid response");
  const bySymbol = Object.create(null);
  for (const item of raw) {
    if (item && typeof item === "object" && symbols.includes(item.symbol))
      bySymbol[item.symbol] = item;
  }
  if (!Object.keys(bySymbol).length) throw new Error("Empty response");
  const normalized = symbols.map((symbol) => {
    const item = bySymbol[symbol];
    const missingFields = [];
    const invalidFields = [];
    const quote = {
      symbol,
      name:
        typeof item?.name === "string" && item.name.trim()
          ? item.name.trim()
          : symbol,
      provider: "tencent",
      kind: INDEX_SYMBOLS.has(symbol) ? "index" : "equity",
    };
    for (const field of QUOTE_FIELDS) {
      const value = item?.[field];
      if (value == null) {
        missingFields.push(field);
        quote[field] = null;
      } else if (
        !finite(value) ||
        (["last", "previousClose", "open", "high", "low"].includes(field) &&
          value <= 0) ||
        (["volumeShares", "amountCny"].includes(field) && value < 0)
      ) {
        invalidFields.push(field);
        quote[field] = null;
      } else quote[field] = value;
    }
    quote.quotedAt = typeof item?.quotedAt === "string" ? item.quotedAt : null;
    if (item?.quotedAt == null || item.quotedAt === "")
      missingFields.push("quotedAt");
    else if (quoteTime(item.quotedAt) == null) invalidFields.push("quotedAt");
    return { quote, absent: !item, missingFields, invalidFields };
  });
  if (
    !normalized.some(({ quote }) => {
      const sourceMs = quoteTime(quote.quotedAt);
      return (
        finite(quote.last) &&
        quote.last > 0 &&
        sourceMs != null &&
        sourceMs - nowMs <= 60_000
      );
    })
  )
    throw new Error("No usable quotes");
  return normalized;
}

export function completedSessionBoundary(session, nowMs) {
  if (session.isOpen || !validDate(session.expectedQuoteDate)) return null;
  let threshold = "14:58:00";
  if (session.status === "lunch") threshold = "11:28:00";
  else if (
    session.status === "preopen" &&
    session.expectedQuoteDate === chinaDate(nowMs)
  ) {
    const local = new Date(nowMs + 8 * 3_600_000);
    const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
    if (minute >= 565 && minute < 570) threshold = "09:23:00";
  }
  return `${session.expectedQuoteDate}T${threshold}+08:00`;
}

export function assessQuote(item, session, nowMs, forcedStale) {
  const { quote, absent, missingFields, invalidFields } = item;
  const sourceMs = quoteTime(quote.quotedAt);
  const sourceDate = sourceMs == null ? null : chinaDate(sourceMs);
  const expectedDate = validDate(session.expectedQuoteDate)
    ? session.expectedQuoteDate
    : null;
  const minimumSourceTime = completedSessionBoundary(session, nowMs);
  const boundaryMs =
    minimumSourceTime == null ? null : Date.parse(minimumSourceTime);
  const issues = [];
  let quality;
  let qualityLabel;
  if (absent) {
    quality = "missing";
    qualityLabel = "未返回行情";
    issues.push("证券行情缺失");
  } else if (REQUIRED_FIELDS.some((field) => invalidFields.includes(field))) {
    quality = "invalid";
    qualityLabel = "行情字段无效";
    issues.push("价格或行情时间无效");
  } else if (REQUIRED_FIELDS.some((field) => missingFields.includes(field))) {
    quality = "missing";
    qualityLabel = "价格或时间缺失";
    issues.push("缺少价格或行情时间");
  } else if (sourceMs - nowMs > 60_000) {
    quality = "invalid";
    qualityLabel = "行情时间异常";
    issues.push("行情时间超前超过 60 秒");
  } else if (!expectedDate || sourceDate !== expectedDate) {
    quality = "stale";
    qualityLabel = expectedDate ? "行情日期不匹配" : "行情日期未核验";
    issues.push(
      expectedDate
        ? "行情日期与应有交易日不符"
        : "交易日历无法确定应有行情日期",
    );
  } else if (session.isOpen && nowMs - sourceMs > 120_000) {
    quality = "stale";
    qualityLabel = "行情延迟";
    issues.push("开市期间行情延迟超过 120 秒");
  } else if (session.isOpen) {
    quality = "current";
    qualityLabel = "时点有效";
  } else if (boundaryMs != null && sourceMs < boundaryMs) {
    quality = "stale";
    qualityLabel = "时段末行情缺失";
    issues.push("报价未覆盖最近已完成交易时段");
  } else {
    quality = "close";
    qualityLabel = "收盘/休市行情";
  }
  if (forcedStale && (quality === "current" || quality === "close")) {
    quality = "stale";
    qualityLabel = "上次成功行情";
  }
  if (forcedStale) issues.push("上游请求失败，当前为缓存数据");
  return {
    ...quote,
    quality,
    qualityLabel,
    validity: {
      quoteDate: sourceDate,
      expectedQuoteDate: expectedDate,
      sourceAgeMs: sourceMs == null ? null : nowMs - sourceMs,
      priceValid: finite(quote.last) && quote.last > 0,
      timeValid: sourceMs != null && sourceMs - nowMs <= 60_000,
      dateMatches: expectedDate != null && sourceDate === expectedDate,
      minimumSourceTime,
      sessionBoundaryMet:
        boundaryMs == null || sourceMs == null ? null : sourceMs >= boundaryMs,
      missingFields: [...missingFields],
      invalidFields: [...invalidFields],
      issues,
    },
  };
}

export function normalizeHistory(raw, symbol, today) {
  if (
    !raw ||
    raw.symbol !== symbol ||
    !["qfq", "none"].includes(raw.adjustment) ||
    !Array.isArray(raw.bars)
  ) {
    throw new Error("Invalid history response");
  }
  const byDate = Object.create(null);
  let rejected = 0;
  let duplicates = 0;
  for (const bar of raw.bars) {
    if (
      !bar ||
      !validDate(bar.date) ||
      bar.date > today ||
      !["open", "close", "high", "low"].every(
        (key) => finite(bar[key]) && bar[key] > 0,
      ) ||
      !finite(bar.volumeShares) ||
      bar.volumeShares < 0 ||
      bar.high < Math.max(bar.open, bar.close, bar.low) ||
      bar.low > Math.min(bar.open, bar.close, bar.high)
    ) {
      rejected += 1;
      continue;
    }
    if (byDate[bar.date]) duplicates += 1;
    byDate[bar.date] = {
      date: bar.date,
      open: bar.open,
      close: bar.close,
      high: bar.high,
      low: bar.low,
      volumeShares: bar.volumeShares,
    };
  }
  const bars = Object.values(byDate).sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  if (!bars.length) throw new Error("Empty history response");
  const warnings = [];
  if (rejected) warnings.push(`已剔除 ${rejected} 条无效或未来日期的日线。`);
  if (duplicates) warnings.push(`已合并 ${duplicates} 条同日重复日线。`);
  return { symbol, adjustment: raw.adjustment, bars, warnings };
}

// -------------------------------------------------------------------------------------------------
// freezeSample (new)
// -------------------------------------------------------------------------------------------------

/**
 * The frozen sample's shapes, for the TypeScript tests that import this module (it is never
 * type-checked itself). A quote is what `assessQuote` returns; a bar is what `normalizeHistory` keeps.
 *
 * @typedef {{ symbol: string, name: string, provider: "tencent", kind: "index" | "equity",
 *   last: number | null, previousClose: number | null, open: number | null, high: number | null,
 *   low: number | null, change: number | null, changePercent: number | null,
 *   volumeShares: number | null, amountCny: number | null, quotedAt: string | null,
 *   quality: "current" | "close" | "stale" | "missing" | "invalid", qualityLabel: string,
 *   validity: { quoteDate: string | null, expectedQuoteDate: string | null,
 *     sourceAgeMs: number | null, priceValid: boolean, timeValid: boolean, dateMatches: boolean,
 *     minimumSourceTime: string | null, sessionBoundaryMet: boolean | null,
 *     missingFields: string[], invalidFields: string[], issues: string[] } }} FrozenQuote
 * @typedef {{ provider: "tencent", servedAt: string, receivedAt: string,
 *   cache: { state: "fresh" }, quotes: FrozenQuote[] }} FrozenSnapshot
 * @typedef {{ date: string, open: number, close: number, high: number, low: number,
 *   volumeShares: number }} FrozenBar
 * @typedef {{ symbol: string, provider: "tencent", receivedAt: string | null,
 *   adjustment: "qfq" | "none" | null, bars: FrozenBar[],
 *   cache: { state: "fresh" | "unavailable" } }} FrozenHistory
 */

/** A freeze refusal, one style for every code: a RangeError whose message opens with the code. */
function freezeError(code, reason) {
  return Object.assign(new RangeError(`${code}: ${reason}`), { code });
}

/** A Date that holds an instant; `new Date("nope")` is a Date that does not. */
function isInstant(value) {
  return value instanceof Date && Number.isFinite(value.getTime());
}

/** The source service's no-cache failure: its `history()` minus the warnings the context does not read. */
function failedHistory(symbol) {
  return {
    symbol,
    provider: "tencent",
    receivedAt: null,
    adjustment: null,
    bars: [],
    cache: { state: "unavailable" },
  };
}

/**
 * Freeze one bounded research sample in the shapes `buildAnalysisContext(snapshot, { histories })`
 * consumes. `snapshot` carries the quotes as the source's `createMarketService().snapshot()`
 * builds them on a fresh fetch (`normalizeQuotes`, then `assessQuote` against
 * `getMarketSession`); each history is what its `history()` returns, `normalizeHistory`'s bars
 * under the Tencent provider. `symbols` passes `validateSymbols` before any request leaves the
 * process: a refused list rejects with `INVALID_SYMBOL` first in the message. The daily bars are
 * fetched first, four symbols at a time, and the quotes after them, as the source's analysis
 * service orders them; a failed quote fetch rejects.
 *
 * `now` fixes the one instant every stamp is. A Date is used as given. A function is called
 * exactly once, after the quote fetch returns, and returns it - the server passes its clock, so
 * a stamp is never taken before the fetch. Omitted, the system clock is read at that same point:
 * the source's order, because `buildAnalysisContext` counts a quote only if its provider time is
 * no later than `servedAt`, and a clock read before the fetch would mark a live quote
 * INSUFFICIENT. Anything else, an invalid Date included, rejects with `INVALID_NOW` first in the
 * message before any request; a function whose result is not a valid Date rejects the same way
 * once it is called. The instant also dates the session, the quote assessment and the history
 * cut-off.
 *
 * Histories keep the requested order, one per symbol. A history whose fetch rejects, or whose
 * reply yields no bar (`normalizeHistory` throws), takes the source service's no-cache failure
 * shape, as that service turns any loader throw into it - its `history()` without the warnings
 * the context does not read - `{ symbol, provider: "tencent", receivedAt: null, adjustment: null,
 * bars: [], cache: { state: "unavailable" } }`, so `buildAnalysisContext` names the exclusion.
 * The snapshot's `cache.state` is always "fresh": nothing is served from a cache (spec D3).
 *
 * @param {{ symbols: string[], fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>, now?: Date | (() => Date) }} options
 * @returns {Promise<{ snapshot: FrozenSnapshot, histories: FrozenHistory[] }>}
 */
export async function freezeSample({ symbols, fetchImpl, now }) {
  let requested;
  try {
    requested = validateSymbols(symbols);
  } catch (error) {
    throw freezeError("INVALID_SYMBOL", error.message);
  }
  if (now !== undefined && typeof now !== "function" && !isInstant(now))
    throw freezeError(
      "INVALID_NOW",
      "now must be a valid Date or a function that returns one.",
    );
  // Finish historical reads before freezing quote time; later evidence cannot enter this run.
  const daily = [];
  for (let i = 0; i < requested.length; i += 4) {
    const group = requested.slice(i, i + 4);
    const settled = await Promise.allSettled(
      group.map((symbol) => fetchDailyBars(symbol, { fetchImpl })),
    );
    settled.forEach((item, k) =>
      daily.push([group[k], item.status === "fulfilled" ? item.value : null]),
    );
  }
  const raw = await fetchQuotes(requested, { fetchImpl });
  const at =
    typeof now === "function" ? now() : now === undefined ? new Date() : now;
  if (!isInstant(at))
    throw freezeError(
      "INVALID_NOW",
      "the clock function must return a valid Date.",
    );
  const nowMs = at.getTime();
  const stamp = at.toISOString();
  const session = getMarketSession(at);
  const quotes = normalizeQuotes(raw, requested, nowMs).map((item) =>
    assessQuote(item, session, nowMs, false),
  );
  const histories = daily.map(([symbol, parsed]) => {
    if (parsed === null) return failedHistory(symbol);
    let history;
    try {
      history = normalizeHistory(parsed, symbol, chinaDate(nowMs));
    } catch {
      return failedHistory(symbol); // No valid bar: the service turns any loader throw into it.
    }
    return {
      symbol,
      provider: "tencent",
      receivedAt: stamp,
      adjustment: history.adjustment,
      bars: history.bars,
      cache: { state: "fresh" },
    };
  });
  return {
    snapshot: {
      provider: "tencent",
      servedAt: stamp,
      receivedAt: stamp,
      cache: { state: "fresh" },
      quotes,
    },
    histories,
  };
}
