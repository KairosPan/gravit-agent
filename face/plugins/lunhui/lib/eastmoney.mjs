// face/plugins/lunhui/lib/eastmoney.mjs
/**
 * The Lunhui Eastmoney layer (modules spec §5.3, A17, A20, A28): the fetch core every Eastmoney
 * request goes through, and the parsers of the replies the freezes read - the 涨停池, the 炸板池
 * and 昨日涨停 from `push2ex.eastmoney.com`; the concept boards, a board's members, the concept
 * boards' fund flow and the all-shares advance/decline counts from `push2.eastmoney.com`'s clist.
 * The queries are the ones the installed AKShare sends (`akshare/stock_feature/stock_ztb_em.py`:
 * `stock_zt_pool_em`, `stock_zt_pool_zbgc_em`, `stock_zt_pool_previous_em`;
 * `akshare/stock/stock_board_concept_em.py`; `akshare/stock/stock_fund_em.py`:
 * `stock_sector_fund_flow_rank`; `akshare/stock_feature/stock_hist_em.py`: `stock_zh_a_spot_em`),
 * each page size cut to its bound; the row fields are those functions' column renames, in English.
 *
 * The fetch core calls the plain hosts and follows one redirect, only to
 * `push2delay.eastmoney.com` and only for the same path and query (A28); it never calls a numbered
 * host. Every reply records the host that served it and whether its quotes are delayed. At most
 * four Eastmoney requests run at once across every caller (A17); the body is read through
 * `market.mjs`'s `fetchBytes` with its 7-second timeout and 512 KiB cap, and every failure is a
 * `LunhuiError` naming 东方财富: `UPSTREAM_TIMEOUT`, `UPSTREAM_TOO_LARGE`, `UPSTREAM_INVALID`, or
 * `NO_MARKET_DATA` for a 涨停池, a board list, a fund-flow list or a first count page that is null
 * or empty.
 */
import { createHash } from "node:crypto";
import { refuse, upstreamError } from "./errors.mjs";
import { fetchBytes } from "./market.mjs";
import { LunhuiError } from "./runs.mjs";

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
    throw invalid("REDIRECT_REFUSED");
  }
  const same = target.pathname === asked.pathname && target.search === asked.search;
  if (location === null || target.protocol !== "https:" || target.host !== DELAY_HOST || !same)
    throw invalid("REDIRECT_REFUSED");
  return target;
}

/**
 * One Eastmoney JSON reply, through the limiter: the request, at most one redirect to the delay
 * host, the body parsed as a JSON object.
 * @param {string} url
 * @param {{ fetchImpl?: FetchLike, timeoutMs?: number, maxBytes?: number }} [options]
 * @returns {Promise<{ json: Record<string, any>, host: string, delayed: boolean }>}
 */
export async function fetchEastmoneyJson(url, options = {}) {
  const { json, host, delayed } = await fetchEastmoneyReply(url, options);
  return { json, host, delayed };
}

/**
 * A shared stop for a batch of requests: once one fails, `error` holds its refusal, and every
 * request of the batch still waiting for a slot rejects with it without being sent.
 * @typedef {{ error: unknown }} Abort
 */

/**
 * `fetchEastmoneyJson` with the body's bytes as received beside the parsed reply, for a page hash,
 * and an optional `abort` shared by a batch: a request that gets its slot after `abort.error` is set
 * rejects with that error unsent, and a request that fails sets it. A request already running
 * finishes.
 * @param {string} url
 * @param {{ fetchImpl?: FetchLike, timeoutMs?: number, maxBytes?: number, abort?: Abort }} [options]
 * @returns {Promise<{ json: Record<string, any>, host: string, delayed: boolean, bytes: Uint8Array }>}
 */
function fetchEastmoneyReply(url, { fetchImpl = fetch, timeoutMs = 7000, maxBytes = 512 * 1024, abort } = {}) {
  return inFlight(async () => {
    if (abort?.error) throw abort.error;
    try {
      return await request(url, fetchImpl, timeoutMs, maxBytes);
    } catch (error) {
      if (abort) abort.error ??= error;
      throw error;
    }
  });
}

/** One request and its one redirect, the body parsed as a JSON object; the caller holds a slot. */
async function request(url, fetchImpl, timeoutMs, maxBytes) {
  const asked = new URL(url);
  let host = asked.host;
  let reply = await get(asked.href, fetchImpl, timeoutMs, maxBytes);
  if (REDIRECT_STATUSES.has(reply.status)) {
    const target = delayTarget(asked, reply.headers.get("location"));
    host = target.host;
    reply = await get(target.href, fetchImpl, timeoutMs, maxBytes);
    if (REDIRECT_STATUSES.has(reply.status)) throw invalid("REDIRECT_REFUSED");
  }
  let json;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(reply.bytes));
  } catch {
    throw invalid("INVALID_RESPONSE");
  }
  if (json === null || typeof json !== "object" || Array.isArray(json)) throw invalid("INVALID_RESPONSE");
  const delayed = host === DELAY_HOST || (typeof json.dlmkts === "string" && json.dlmkts !== "");
  return { json, host, delayed, bytes: reply.bytes };
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

/**
 * The three pools, in the order `zt`, `zb`, `yesterday`: endpoint path, AKShare's sort, row
 * parser, and whether a null or empty reply refuses. Only the 涨停池 does: a day with no 炸板 is a
 * market state, and a holiday or a pre-market date already refuses through its 涨停池.
 */
const POOLS = [
  ["/getTopicZTPool", "fbt:asc", ztRow, true],
  ["/getTopicZBPool", "fbt:asc", zbRow, false],
  ["/getYesterdayZTPool", "zs:desc", yesterdayRow, false],
];

/** A pool row is an object whose code is six digits; anything else makes the reply invalid. */
function isPoolRow(raw) {
  return raw !== null && typeof raw === "object" && typeof raw.c === "string" && /^\d{6}$/.test(raw.c);
}

async function fetchPool(path, sort, parse, required, date, fetchImpl, timeoutMs) {
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
  const pool = json.data === null ? [] : json.data?.pool;
  if (!Array.isArray(pool)) throw invalid("INVALID_RESPONSE");
  if (pool.length === 0 && required) throw refuse.noMarketData(PROVIDER);
  const kept = pool.slice(0, POOL_ROWS);
  if (!kept.every(isPoolRow)) throw invalid("INVALID_RESPONSE");
  // With `pagesize` at the bound the server sends at most 500 rows; its total `tc` tells a cut pool.
  const total = json.data?.tc;
  const truncated = pool.length > POOL_ROWS || (Number.isInteger(total) && total > kept.length);
  return { rows: kept.map(parse), host, delayed, truncated };
}

/**
 * The 涨停池, 炸板池 and 昨日涨停 of the session `date`, each at most 500 rows. `host` is the
 * serving host the three share, or their distinct hosts joined with "," when they differ;
 * `delayed` and `truncated` are true when any pool's is. A 涨停池 whose `data` is null or whose pool
 * is empty refuses `NO_MARKET_DATA`; the same reply for the 炸板池 or 昨日涨停 is an empty list.
 * Any pool that fails otherwise fails the whole call.
 * @param {{ date: string, fetchImpl?: FetchLike, timeoutMs?: number }} options `date` as `YYYYMMDD`
 */
export async function fetchLimitUpPools({ date, fetchImpl = fetch, timeoutMs = 7000 }) {
  if (typeof date !== "string" || !DATE.test(date))
    throw new TypeError(`lunhui: a pool date is YYYYMMDD, not ${JSON.stringify(date)}`);
  const replies = await Promise.all(
    POOLS.map(([path, sort, parse, required]) => fetchPool(path, sort, parse, required, date, fetchImpl, timeoutMs)),
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

// ---- the clist: boards, members, fund flow, the all-shares counts ----

const CLIST = "https://push2.eastmoney.com/api/qt/clist/get";
/** The `ut` AKShare sends with the board, member and all-shares queries. */
const CLIST_UT = "bd1d9ddb04089700cf9c27f6f7426281";
const BOARD_CODE = /^BK\d{4}$/;
const STOCK_CODE = /^\d{6}$/;
/** AKShare's `stock_zh_a_spot_em` filter: the Shanghai, Shenzhen and Beijing A shares. */
const ALL_SHARES_FS = "m:0 t:6,m:0 t:80,m:1 t:2,m:1 t:23,m:0 t:81 s:2048";
/**
 * The change, in percent, at or past which an all-shares row counts as limit-up or limit-down:
 * the main board's 10% with room for rounding. A research candidate - a 20% or 30% board's row at
 * +9.9% is counted, a 5% ST row at its limit is not.
 */
export const LIMIT_UP_PCT = 9.9;
export const LIMIT_DOWN_PCT = -9.9;

/** A name: a non-empty string other than Eastmoney's "-" placeholder, or null. */
function label(value) {
  const t = text(value);
  return t === "-" ? null : t;
}

/** The clist URL for `params`, in the order given. */
function clistUrl(params) {
  const url = new URL(CLIST);
  url.search = new URLSearchParams(params).toString();
  return url.href;
}

/**
 * A clist reply's rows: `[]` for a `data` that is null, else `data.diff`, which must be a list of
 * objects whose `f12` matches `code` when one is given; `total` is `data.total` (0 for null data).
 * @param {Record<string, any>} json
 * @param {RegExp | null} code
 */
function clistRows(json, code) {
  if (json.data === null) return { rows: [], total: 0 };
  const diff = json.data?.diff;
  const total = json.data?.total;
  if (!Array.isArray(diff) || !Number.isInteger(total) || total < 0) throw invalid("INVALID_RESPONSE");
  const valid = (raw) =>
    raw !== null && typeof raw === "object" && (code === null || (typeof raw.f12 === "string" && code.test(raw.f12)));
  if (!diff.every(valid)) throw invalid("INVALID_RESPONSE");
  return { rows: diff, total };
}

/** A concept board. */
function boardRow(raw) {
  return {
    code: raw.f12, // 板块代码
    name: label(raw.f14), // 板块名称
    pct: num(raw.f3), // 涨跌幅
    amount: num(raw.f6), // 成交额
    advancers: num(raw.f104), // 上涨家数
    decliners: num(raw.f105), // 下跌家数
    leader: label(raw.f128), // 领涨股票
  };
}

/**
 * The concept boards by change, the top `top`: AKShare's `stock_board_concept_name_em` query
 * sorted by 涨跌幅 (`fid=f3`, descending) instead of by code, its fields cut to the seven kept. Not
 * by 成交额: ranked by turnover the list leads with membership and screen boards (融资融券,
 * 昨日高振幅, 深股通, 基金增仓, 富时罗素 on a live check 2026-10-25), not 题材. `amount` stays in
 * every row, so a board's turnover share is still derivable. A reply whose
 * `data` is null or whose list is empty refuses `NO_MARKET_DATA`.
 * @param {{ fetchImpl?: FetchLike, top?: number, timeoutMs?: number }} [options]
 */
export async function fetchBoards({ fetchImpl = fetch, top = 30, timeoutMs = 7000 } = {}) {
  const url = clistUrl({
    pn: "1", pz: String(top), po: "1", np: "1", ut: CLIST_UT, fltt: "2", invt: "2", fid: "f3",
    fs: "m:90 t:3 f:!50", fields: "f12,f14,f3,f6,f104,f105,f128",
  });
  const { json, host, delayed } = await fetchEastmoneyJson(url, { fetchImpl, timeoutMs });
  const { rows } = clistRows(json, BOARD_CODE);
  if (rows.length === 0) throw refuse.noMarketData(PROVIDER);
  return { boards: rows.slice(0, top).map(boardRow), host, delayed };
}

/** A board member. */
function memberRow(raw) {
  return {
    code: raw.f12, // 代码
    name: label(raw.f14), // 名称
    pct: num(raw.f3), // 涨跌幅
  };
}

/**
 * The members of the board `code`, at most `max`: AKShare's `stock_board_concept_cons_em` query,
 * one page, its fields cut to code, name and change. `truncated` is true when the board has more
 * members than were kept. An empty board is an empty list. A `code` off the `BK` and four digits
 * grammar refuses `UPSTREAM_INVALID` before any request.
 * @param {string} code
 * @param {{ fetchImpl?: FetchLike, max?: number, timeoutMs?: number }} [options]
 */
export async function fetchBoardMembers(code, { fetchImpl = fetch, max = 100, timeoutMs = 7000 } = {}) {
  if (typeof code !== "string" || !BOARD_CODE.test(code))
    throw new LunhuiError("UPSTREAM_INVALID", `${PROVIDER}板块代码无效（须为 BK 加四位数字）；本次未请求，也未写入任何文件。`);
  const url = clistUrl({
    pn: "1", pz: String(max), po: "1", np: "1", ut: CLIST_UT, fltt: "2", invt: "2", fid: "f12",
    fs: `b:${code} f:!50`, fields: "f12,f14,f3",
  });
  const { json, host, delayed } = await fetchEastmoneyJson(url, { fetchImpl, timeoutMs });
  const { rows, total } = clistRows(json, STOCK_CODE);
  const kept = rows.slice(0, max);
  return { members: kept.map(memberRow), truncated: rows.length > max || total > kept.length, host, delayed };
}

/** A concept board's fund flow today. */
function flowRow(raw) {
  return {
    code: raw.f12, // 代码
    name: label(raw.f14), // 名称
    pct: num(raw.f3), // 今日涨跌幅
    mainNet: num(raw.f62), // 今日主力净流入-净额
    mainShare: num(raw.f184), // 今日主力净流入-净占比
  };
}

/**
 * The concept boards' fund flow today, the top `top` by main net inflow: the query
 * `stock_sector_fund_flow_rank("今日", "概念资金流")` sends, one page, without its `_` cache-buster.
 * A reply whose `data` is null or whose list is empty refuses `NO_MARKET_DATA`.
 * @param {{ fetchImpl?: FetchLike, top?: number, timeoutMs?: number }} [options]
 */
export async function fetchBoardFundFlow({ fetchImpl = fetch, top = 30, timeoutMs = 7000 } = {}) {
  const url = clistUrl({
    pn: "1", pz: String(top), po: "1", np: "1", ut: "b2884a393a59ad64002292a3e90d46a5", fltt: "2", invt: "2",
    fid0: "f62", fs: "m:90 t:3", stat: "1",
    fields: "f12,f14,f2,f3,f62,f184,f66,f69,f72,f75,f78,f81,f84,f87,f204,f205,f124", rt: "52975239",
  });
  const { json, host, delayed } = await fetchEastmoneyJson(url, { fetchImpl, timeoutMs });
  const { rows } = clistRows(json, BOARD_CODE);
  if (rows.length === 0) throw refuse.noMarketData(PROVIDER);
  return { rows: rows.slice(0, top).map(flowRow), host, delayed };
}

/** The URL of all-shares page `pn`. */
function countsUrl(pn, pageSize) {
  return clistUrl({
    pn: String(pn), pz: String(pageSize), po: "1", np: "1", ut: CLIST_UT, fltt: "2", invt: "2", fid: "f12",
    fs: ALL_SHARES_FS, fields: "f3,f2",
  });
}

/**
 * The all-A-shares advance/decline counts: AKShare's `stock_zh_a_spot_em` query with the change
 * and price fields only, `pageSize` rows a page. The clist serves at most 100 rows a page whatever
 * `pz` asks (measured 2026-10-25: `pz=1000` answered `total` 5925 with 100 rows), hence the
 * default of 100 and 64 pages. Page 1 is read first for its `data.total`; the remaining
 * `ceil(total / pageSize) - 1` pages, at most `maxPages` in all, are then asked together, the
 * limiter keeping four in flight. No row is kept: only the counts, and each page's sha256 over its
 * response bytes as received, in page order. A row whose change is "-" (suspended) counts in none
 * of advancers, decliners and unchanged. `partial` is true when a page's `total` differs from page
 * 1's or the rows read fall short of it. A page 1 whose `data` is null or whose list is empty
 * refuses `NO_MARKET_DATA`; any page that fails otherwise fails the whole call with that page's
 * refusal, and the pages still waiting for a slot are never sent, so a failed read does not hold
 * the shared limiter for its remaining pages.
 * @param {{ fetchImpl?: FetchLike, pageSize?: number, maxPages?: number, timeoutMs?: number }} [options]
 */
export async function fetchMarketCounts({ fetchImpl = fetch, pageSize = 100, maxPages = 64, timeoutMs = 7000 } = {}) {
  /** @type {Abort} */
  const abort = { error: null };
  const read = async (pn) => {
    const reply = await fetchEastmoneyReply(countsUrl(pn, pageSize), { fetchImpl, timeoutMs, abort });
    try {
      return { ...clistRows(reply.json, null), reply };
    } catch (error) {
      abort.error ??= error;
      throw error;
    }
  };
  const first = await read(1);
  if (first.rows.length === 0) throw refuse.noMarketData(PROVIDER);
  const { total } = first;
  const pageCount = Math.min(Math.ceil(total / pageSize), maxPages);
  let rest;
  try {
    rest = await Promise.all(Array.from({ length: Math.max(pageCount - 1, 0) }, (_, i) => read(i + 2)));
  } catch (error) {
    throw abort.error ?? error;
  }
  const pages = [first, ...rest];
  const counts = { advancers: 0, decliners: 0, unchanged: 0, limitUp: 0, limitDown: 0 };
  let rows = 0;
  for (const page of pages) {
    rows += page.rows.length;
    for (const raw of page.rows) {
      const pct = num(raw.f3);
      if (pct === null) continue;
      if (pct > 0) counts.advancers += 1;
      else if (pct < 0) counts.decliners += 1;
      else counts.unchanged += 1;
      if (pct >= LIMIT_UP_PCT) counts.limitUp += 1;
      if (pct <= LIMIT_DOWN_PCT) counts.limitDown += 1;
    }
  }
  return {
    ...counts,
    total,
    pages: pages.length,
    pageHashes: pages.map((page) => createHash("sha256").update(page.reply.bytes).digest("hex")),
    partial: rows < total || pages.some((page) => page.total !== total),
    host: [...new Set(pages.map((page) => page.reply.host))].join(","),
    delayed: pages.some((page) => page.reply.delayed),
  };
}
