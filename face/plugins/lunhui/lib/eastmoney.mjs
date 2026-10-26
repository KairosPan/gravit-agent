// face/plugins/lunhui/lib/eastmoney.mjs
/**
 * The Lunhui Eastmoney layer (modules spec §5.3, A17, A28): the fetch core every Eastmoney request
 * goes through, and the parsers of the replies the freezes read - here the 涨停池, the 炸板池 and
 * 昨日涨停 from `push2ex.eastmoney.com`. The queries are the ones the installed AKShare sends
 * (`akshare/stock_feature/stock_ztb_em.py`: `stock_zt_pool_em`, `stock_zt_pool_zbgc_em`,
 * `stock_zt_pool_previous_em`), the page size cut to the 500-row bound; the row fields are those
 * functions' column renames, in English.
 *
 * The fetch core calls the plain hosts and follows one redirect, only to
 * `push2delay.eastmoney.com` and only for the same path and query (A28); it never calls a numbered
 * host. Every reply records the host that served it and whether its quotes are delayed. At most
 * four Eastmoney requests run at once across every caller (A17); the body is read through
 * `market.mjs`'s `fetchBytes` with its 7-second timeout and 512 KiB cap, and every failure is a
 * `LunhuiError` naming 东方财富: `UPSTREAM_TIMEOUT`, `UPSTREAM_TOO_LARGE`, `UPSTREAM_INVALID`, or
 * `NO_MARKET_DATA` for a pool that is null or empty.
 */
import { refuse, upstreamError } from "./errors.mjs";
import { fetchBytes } from "./market.mjs";

const PROVIDER = "东方财富";
const DELAY_HOST = "push2delay.eastmoney.com";
const REDIRECT_STATUSES = new Set([301, 302, 307, 308]);
const HEADERS = Object.freeze({ Accept: "application/json", Referer: "https://quote.eastmoney.com/" });
const MAX_IN_FLIGHT = 4;
const POOL_HOST = "https://push2ex.eastmoney.com";
const POOL_ROWS = 500;
const DATE = /^\d{8}$/;

/** @typedef {(url: string, init?: RequestInit) => Promise<Response>} FetchLike */

// ---- the limiter ----

let running = 0;
/** @type {Array<() => void>} */
const waiting = [];

/**
 * Run `fn` when fewer than four Eastmoney requests are running; the others wait in arrival order.
 * A finished task hands its slot straight to the first waiter.
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function inFlight(fn) {
  if (running < MAX_IN_FLIGHT) running += 1;
  else await new Promise((resolve) => waiting.push(/** @type {() => void} */ (resolve)));
  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  }
}

// ---- the fetch core ----

/** The refusal for a reply that failed its status, redirect, encoding or structure. */
function invalid(code) {
  return /** @type {Error} */ (upstreamError(Object.assign(new Error(code), { code }), PROVIDER));
}

/** One GET through `fetchBytes`, its provider codes thrown as refusals. */
async function get(url, fetchImpl, timeoutMs, maxBytes) {
  try {
    return await fetchBytes(url, fetchImpl, timeoutMs, { redirect: "manual", headers: HEADERS, maxBytes });
  } catch (error) {
    throw upstreamError(error, PROVIDER) ?? error;
  }
}

/**
 * The URL a redirect may be followed to: `location` resolved against the request, on https at
 * `push2delay.eastmoney.com` (no other port), with the request's own path and query.
 * @param {URL} asked
 * @param {string | null} location
 */
function delayTarget(asked, location) {
  let target;
  try {
    target = new URL(location ?? "", asked);
  } catch {
    throw invalid("PROVIDER_HTTP_ERROR");
  }
  const same = target.pathname === asked.pathname && target.search === asked.search;
  if (location === null || target.protocol !== "https:" || target.host !== DELAY_HOST || !same)
    throw invalid("PROVIDER_HTTP_ERROR");
  return target;
}

/**
 * One Eastmoney JSON reply, through the limiter: the request, at most one redirect to the delay
 * host, the body parsed as a JSON object.
 * @param {string} url
 * @param {{ fetchImpl?: FetchLike, timeoutMs?: number, maxBytes?: number }} [options]
 * @returns {Promise<{ json: Record<string, any>, host: string, delayed: boolean }>}
 */
export function fetchEastmoneyJson(url, { fetchImpl = fetch, timeoutMs = 7000, maxBytes = 512 * 1024 } = {}) {
  return inFlight(async () => {
    const asked = new URL(url);
    let host = asked.host;
    let reply = await get(asked.href, fetchImpl, timeoutMs, maxBytes);
    if (REDIRECT_STATUSES.has(reply.status)) {
      const target = delayTarget(asked, reply.headers.get("location"));
      host = target.host;
      reply = await get(target.href, fetchImpl, timeoutMs, maxBytes);
      if (REDIRECT_STATUSES.has(reply.status)) throw invalid("PROVIDER_HTTP_ERROR");
    }
    let json;
    try {
      json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(reply.bytes));
    } catch {
      throw invalid("INVALID_RESPONSE");
    }
    if (json === null || typeof json !== "object" || Array.isArray(json)) throw invalid("INVALID_RESPONSE");
    const delayed = host === DELAY_HOST || (typeof json.dlmkts === "string" && json.dlmkts !== "");
    return { json, host, delayed };
  });
}

// ---- the limit-up pools ----

/** A finite number, or null. */
function num(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A price in thousandths of a yuan, in yuan, as AKShare divides it. */
function price(value) {
  const n = num(value);
  return n === null ? null : n / 1000;
}

/** A non-empty string, or null. */
function text(value) {
  return typeof value === "string" && value !== "" ? value : null;
}

/** An `HHMMSS` integer as six digits, as AKShare zero-fills it; else null. */
function sealTime(value) {
  return Number.isInteger(value) && value >= 0 && value <= 235959 ? String(value).padStart(6, "0") : null;
}

/** `zttj`, the 涨停统计 `{ days, ct }`: limit-ups `count` within the last `days` days. */
function streak(value) {
  if (value === null || typeof value !== "object") return null;
  return { days: num(value.days), count: num(value.ct) };
}

/** A 涨停池 row. */
function ztRow(raw) {
  return {
    code: raw.c, // 代码
    name: text(raw.n), // 名称
    pct: num(raw.zdp), // 涨跌幅
    price: price(raw.p), // 最新价
    amount: num(raw.amount), // 成交额
    floatCap: num(raw.ltsz), // 流通市值
    totalCap: num(raw.tshare), // 总市值
    turnoverRate: num(raw.hs), // 换手率
    boards: num(raw.lbc), // 连板数
    firstSealAt: sealTime(raw.fbt), // 首次封板时间
    lastSealAt: sealTime(raw.lbt), // 最后封板时间
    sealFunds: num(raw.fund), // 封板资金
    breakCount: num(raw.zbc), // 炸板次数
    industry: text(raw.hybk), // 所属行业
    streak: streak(raw.zttj), // 涨停统计
  };
}

/** A 炸板池 row. */
function zbRow(raw) {
  return {
    code: raw.c, // 代码
    name: text(raw.n), // 名称
    price: price(raw.p), // 最新价
    limitPrice: price(raw.ztp), // 涨停价
    pct: num(raw.zdp), // 涨跌幅
    amount: num(raw.amount), // 成交额
    floatCap: num(raw.ltsz), // 流通市值
    totalCap: num(raw.tshare), // 总市值
    turnoverRate: num(raw.hs), // 换手率
    firstSealAt: sealTime(raw.fbt), // 首次封板时间
    breakCount: num(raw.zbc), // 炸板次数
    amplitude: num(raw.zf), // 振幅
    speed: num(raw.zs), // 涨速
    streak: streak(raw.zttj), // 涨停统计
    industry: text(raw.hybk), // 所属行业
  };
}

/** A 昨日涨停 row: yesterday's limit-up, today's move. */
function yesterdayRow(raw) {
  return {
    code: raw.c, // 代码
    name: text(raw.n), // 名称
    price: price(raw.p), // 最新价
    limitPrice: price(raw.ztp), // 涨停价
    pct: num(raw.zdp), // 涨跌幅
    amount: num(raw.amount), // 成交额
    floatCap: num(raw.ltsz), // 流通市值
    totalCap: num(raw.tshare), // 总市值
    turnoverRate: num(raw.hs), // 换手率
    amplitude: num(raw.zf), // 振幅
    speed: num(raw.zs), // 涨速
    yesterdaySealAt: sealTime(raw.yfbt), // 昨日封板时间
    yesterdayBoards: num(raw.ylbc), // 昨日连板数
    industry: text(raw.hybk), // 所属行业
    streak: streak(raw.zttj), // 涨停统计
  };
}

/** The three pools, in the order `zt`, `zb`, `yesterday`: endpoint path, AKShare's sort, row parser. */
const POOLS = [
  ["/getTopicZTPool", "fbt:asc", ztRow],
  ["/getTopicZBPool", "fbt:asc", zbRow],
  ["/getYesterdayZTPool", "zs:desc", yesterdayRow],
];

/** A pool row is an object whose code is six digits; anything else makes the reply invalid. */
function isPoolRow(raw) {
  return raw !== null && typeof raw === "object" && typeof raw.c === "string" && /^\d{6}$/.test(raw.c);
}

async function fetchPool(path, sort, parse, date, fetchImpl, timeoutMs) {
  const url = new URL(path, POOL_HOST);
  url.search = new URLSearchParams({
    ut: "7eea3edcaed734bea9cbfc24409ed989",
    dpt: "wz.ztzt",
    Pageindex: "0",
    pagesize: String(POOL_ROWS),
    sort,
    date,
  }).toString();
  const { json, host, delayed } = await fetchEastmoneyJson(url.href, { fetchImpl, timeoutMs });
  if (json.data === null) throw refuse.noMarketData(PROVIDER);
  const pool = json.data?.pool;
  if (!Array.isArray(pool)) throw invalid("INVALID_RESPONSE");
  if (pool.length === 0) throw refuse.noMarketData(PROVIDER);
  const kept = pool.slice(0, POOL_ROWS);
  if (!kept.every(isPoolRow)) throw invalid("INVALID_RESPONSE");
  return { rows: kept.map(parse), host, delayed, truncated: pool.length > POOL_ROWS };
}

/**
 * The 涨停池, 炸板池 and 昨日涨停 of the session `date`, each at most 500 rows. `host` is the
 * serving host the three share, or their distinct hosts joined with "," when they differ;
 * `delayed` and `truncated` are true when any pool's is. Any pool that fails fails the whole call.
 * @param {{ date: string, fetchImpl?: FetchLike, timeoutMs?: number }} options `date` as `YYYYMMDD`
 */
export async function fetchLimitUpPools({ date, fetchImpl = fetch, timeoutMs = 7000 }) {
  if (typeof date !== "string" || !DATE.test(date))
    throw new TypeError(`lunhui: a pool date is YYYYMMDD, not ${JSON.stringify(date)}`);
  const replies = await Promise.all(
    POOLS.map(([path, sort, parse]) => fetchPool(path, sort, parse, date, fetchImpl, timeoutMs)),
  );
  const [zt, zb, yesterday] = replies.map((reply) => reply.rows);
  return {
    zt,
    zb,
    yesterday,
    host: [...new Set(replies.map((reply) => reply.host))].join(","),
    delayed: replies.some((reply) => reply.delayed),
    truncated: replies.some((reply) => reply.truncated),
  };
}
