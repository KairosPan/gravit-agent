// face/plugins/lunhui/lib/wencai.mjs
/**
 * The Lunhui 问财 client (boards stand-in spec S2, S9, S10, S11): when Eastmoney's concept-board
 * reads fail, the boards freeze derives its boards from one all-market query to iFinD's QuantAPI
 * `smart_stock_picking` - every A share with its change, turnover, main-fund net flow and concept
 * list. This module is only the client: the query and the parsed rows.
 *
 * - It holds no token, no cache and no environment: the token, its cache and its one re-exchange
 *   are the market's (`market/src/live/cn-ifind.ts`). Through the market adapter
 *   (`market-fetch.mjs`) this one POST goes to the market's iFinD route; the request here
 *   carries `Content-Type` and `Accept` only.
 * - The query is `A股 <YYYY年MM月DD日>涨跌幅 成交额 主力资金流向 所属概念`, the date the session's.
 *   Columns are matched by their prefix - the reply dates them (`涨跌幅:前复权[20261030]`).
 * - This source alone has a 15-second timeout and a 4 MiB cap (S11); `fetchBytes` is GET-only, so
 *   the POST is injected through a wrapping `fetch`.
 * - The market's two answers Lunhui words itself arrive as the adapter's codes: `IFIND_UNCONFIGURED`
 *   (the market holds no token) is `NOT_CONFIGURED`, which the boards row turns into its
 *   备用未配置 sentence; `IFIND_CREDENTIAL` (its exchange refused) is `凭据被拒（令牌换取未通过）`.
 *   An HTTP 401/403 or a token errorcode is `凭据被拒（访问令牌无效）`.
 * - Every refusal is a `LunhuiError` naming 同花顺问财; none carries a token or any of the reply.
 */
import { hash } from "./contract-core.mjs";
import { IFIND_CREDENTIAL, IFIND_UNCONFIGURED, WENCAI_QUERY_URL } from "./market-fetch.mjs";
import { upstreamError } from "./errors.mjs";
import { fetchBytes } from "./market.mjs";
import { LunhuiError } from "./runs.mjs";

export const WENCAI_PROVIDER = "同花顺问财";
/** The code of the refusal when the market holds no iFinD token; the boards row words it. */
export const WENCAI_NOT_CONFIGURED = "NOT_CONFIGURED";
const HOST = "quantapi.51ifind.com";
/** QuantAPI errorcodes that mean the access token, not the query, was refused. */
const TOKEN_ERRORCODES = new Set([-1010, -1011, -1300, -1301, -1302, -1303]);
const REQUIRED = Object.freeze(["涨跌幅", "成交额", "主力资金流向", "所属概念"]);

/** @param {string} reason */
function refuse(reason, code = "UPSTREAM_INVALID") {
  return new LunhuiError(code, `${WENCAI_PROVIDER}${reason}；本次未写入任何文件。`);
}

/**
 * The one POST through `fetchBytes`, the reply parsed as a JSON object; `null` for an HTTP 401/403.
 * @returns {Promise<Record<string, any> | null>}
 */
async function post(body, fetchImpl, timeoutMs, maxBytes) {
  const asPost = (url, init) => fetchImpl(url, { ...init, method: "POST", body: JSON.stringify(body) });
  let bytes;
  try {
    ({ bytes } = await fetchBytes(WENCAI_QUERY_URL, asPost, timeoutMs, {
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      maxBytes,
    }));
  } catch (error) {
    const code = error?.code;
    if (code === "PROVIDER_TIMEOUT") throw refuse(`请求超时（单次 ${Math.round(timeoutMs / 1000)} 秒）`, "UPSTREAM_TIMEOUT");
    if (code === "RESPONSE_TOO_LARGE") throw refuse(`响应过大（超过 ${Math.round(maxBytes / 1024)} KiB 上限）`, "UPSTREAM_TOO_LARGE");
    // Coded, so `upstreamError` would answer null (INTERNAL): Lunhui words these two itself.
    if (code === IFIND_UNCONFIGURED) throw new LunhuiError(WENCAI_NOT_CONFIGURED, `${WENCAI_PROVIDER}未配置（账户没有 iFinD 凭据）；本次未写入任何文件。`);
    if (code === IFIND_CREDENTIAL) throw refuse("凭据被拒（令牌换取未通过）");
    if (code === "PROVIDER_HTTP_ERROR" && /HTTP (401|403)\b/.test(String(error.message))) return null;
    throw upstreamError(error, WENCAI_PROVIDER) ?? error;
  }
  try {
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    /* falls through */
  }
  throw refuse("响应无效（不是 JSON 对象）");
}

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * The all-market universe for a session: one query.
 * @param {{ session: string, fetchImpl?: Function, timeoutMs?: number, maxBytes?: number }} options `session` is `YYYY-MM-DD`
 * @returns {Promise<{ rows: { code: string, name: string | null, pct: number | null, amount: number | null, mainNet: number | null, concepts: string[] }[], host: "quantapi.51ifind.com", query: string, sha256: string, dataVol: number }>}
 */
export async function fetchWencaiUniverse({ session, fetchImpl = fetch, timeoutMs = 15000, maxBytes = 4 * 1024 * 1024 }) {
  const [y, m, d] = String(session).split("-");
  const query = `A股 ${y}年${m}月${d}日涨跌幅 成交额 主力资金流向 所属概念`;
  const reply = await post({ searchstring: query, searchtype: "stock" }, fetchImpl, timeoutMs, maxBytes);
  if (reply === null || TOKEN_ERRORCODES.has(Number(reply.errorcode))) throw refuse("凭据被拒（访问令牌无效）");
  if (reply.errorcode !== 0) throw refuse(`查询失败（errorcode ${Number(reply.errorcode)}）`);

  const table = reply.tables?.[0]?.table;
  const column = (prefix) => {
    const key = table && typeof table === "object" ? Object.keys(table).find((k) => k.startsWith(prefix)) : undefined;
    return key !== undefined && Array.isArray(table[key]) ? table[key] : null;
  };
  const codes = column("股票代码");
  const names = column("股票简称");
  const [pct, amount, mainNet, concepts] = REQUIRED.map(column);
  if (!codes || !pct || !amount || !mainNet || !concepts) throw refuse("响应缺少列（股票代码、涨跌幅、成交额、主力资金流向、所属概念）");

  const rows = [];
  codes.forEach((raw, i) => {
    const code = /^(\d{6})(?:\.[A-Z]{2})?$/.exec(String(raw ?? ""))?.[1];
    if (!code) return;
    const list = typeof concepts[i] === "string" ? concepts[i].split(";").map((c) => c.trim()).filter(Boolean) : [];
    rows.push({
      code,
      name: typeof names?.[i] === "string" && names[i] ? names[i] : null,
      pct: num(pct[i]),
      amount: num(amount[i]),
      mainNet: num(mainNet[i]),
      concepts: list,
    });
  });
  if (rows.length === 0) throw refuse("响应没有可用行", "NO_MARKET_DATA");
  return { rows, host: HOST, query, sha256: hash(reply.tables), dataVol: num(reply.dataVol) ?? rows.length };
}
