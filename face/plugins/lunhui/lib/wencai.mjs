// face/plugins/lunhui/lib/wencai.mjs
/**
 * The Lunhui 问财 client (boards stand-in spec S2, S9, S10, S11): when Eastmoney's concept-board
 * reads fail, the boards freeze derives its boards from one all-market query to iFinD's QuantAPI
 * `smart_stock_picking` - every A share with its change, turnover, main-fund net flow and concept
 * list. This module is only the client: the token exchange, the query and the parsed rows.
 *
 * - Credentials come from the caller's `env`: `IFIND_ACCESS_TOKEN` is used as it is; else
 *   `IFIND_REFRESH_TOKEN` is exchanged at `get_access_token` for an access token, cached in this
 *   module's memory for six days (never written anywhere). A query made with the CACHED token and
 *   answered with any nonzero errorcode (iFinD's token codes are not all known) forgets the cache,
 *   exchanges once and asks once more; a second nonzero answer refuses with its errorcode, or
 *   `凭据被拒` for a token code. A token freshly exchanged by this call, or a bare
 *   `IFIND_ACCESS_TOKEN`, has nothing to re-exchange: its nonzero answer refuses at once.
 * - The query is `A股 <YYYY年MM月DD日>涨跌幅 成交额 主力资金流向 所属概念`, the date the session's.
 *   Columns are matched by their prefix - the reply dates them (`涨跌幅:前复权[20261030]`).
 * - This source alone has a 15-second timeout and a 4 MiB cap (S11); `fetchBytes` is GET-only, so
 *   the POST is injected through a wrapping `fetch`.
 * - Every refusal is a `LunhuiError` naming 同花顺问财; none carries a token or any of the reply.
 */
import { hash } from "./contract-core.mjs";
import { upstreamError } from "./errors.mjs";
import { fetchBytes } from "./market.mjs";
import { LunhuiError } from "./runs.mjs";

export const WENCAI_PROVIDER = "同花顺问财";
const HOST = "quantapi.51ifind.com";
const BASE = `https://${HOST}/api/v1`;
const TOKEN_TTL_MS = 6 * 24 * 3600 * 1000;
/** QuantAPI errorcodes that mean the access token, not the query, was refused. */
const TOKEN_ERRORCODES = new Set([-1010, -1011, -1300, -1301, -1302, -1303]);
const REQUIRED = Object.freeze(["涨跌幅", "成交额", "主力资金流向", "所属概念"]);

/** @type {{ value: string, until: number } | null} */
let cached = null;

/** Forget the cached access token. For tests only: production code never needs it. */
export function resetWencaiToken() {
  cached = null;
}

/**
 * Whether `env` holds a credential the client can use.
 * @param {Record<string, string | undefined>} env
 */
export function hasWencaiCredentials(env) {
  return Boolean(env?.IFIND_ACCESS_TOKEN || env?.IFIND_REFRESH_TOKEN);
}

/** @param {string} reason */
function refuse(reason, code = "UPSTREAM_INVALID") {
  return new LunhuiError(code, `${WENCAI_PROVIDER}${reason}；本次未写入任何文件。`);
}

/**
 * One POST through `fetchBytes`, the reply parsed as a JSON object. HTTP 401/403 and a reply that
 * is not an object are `credentialStatus`-aware: the caller decides what a 401 means.
 * @returns {Promise<{ json: Record<string, any> | null, status: number }>}
 */
async function post(path, headers, body, fetchImpl, timeoutMs, maxBytes) {
  const asPost = (url, init) => fetchImpl(url, { ...init, method: "POST", body: JSON.stringify(body) });
  let bytes;
  try {
    ({ bytes } = await fetchBytes(`${BASE}/${path}`, asPost, timeoutMs, {
      headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
      maxBytes,
    }));
  } catch (error) {
    const code = error?.code;
    if (code === "PROVIDER_TIMEOUT") throw refuse(`请求超时（单次 ${Math.round(timeoutMs / 1000)} 秒）`, "UPSTREAM_TIMEOUT");
    if (code === "RESPONSE_TOO_LARGE") throw refuse(`响应过大（超过 ${Math.round(maxBytes / 1024)} KiB 上限）`, "UPSTREAM_TOO_LARGE");
    if (code === "PROVIDER_HTTP_ERROR" && /HTTP (401|403)\b/.test(String(error.message))) return { json: null, status: 401 };
    throw upstreamError(error, WENCAI_PROVIDER) ?? error;
  }
  try {
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return { json: parsed, status: 200 };
  } catch {
    /* falls through */
  }
  throw refuse("响应无效（不是 JSON 对象）");
}

/** Exchange the refresh token for an access token and cache it. */
async function exchange(refresh, fetchImpl, timeoutMs, maxBytes) {
  const { json, status } = await post("get_access_token", { refresh_token: refresh }, {}, fetchImpl, timeoutMs, maxBytes);
  const token = json?.data?.access_token;
  if (status !== 200 || json?.errorcode !== 0 || typeof token !== "string" || !token) throw refuse("凭据被拒（令牌换取未通过）");
  cached = { value: token, until: Date.now() + TOKEN_TTL_MS };
  return token;
}

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * The all-market universe for a session: one token exchange (unless cached) and one query.
 * @param {{ session: string, env: Record<string, string | undefined>, fetchImpl?: Function, timeoutMs?: number, maxBytes?: number }} options `session` is `YYYY-MM-DD`
 * @returns {Promise<{ rows: { code: string, name: string | null, pct: number | null, amount: number | null, mainNet: number | null, concepts: string[] }[], host: "quantapi.51ifind.com", query: string, sha256: string, dataVol: number }>}
 */
export async function fetchWencaiUniverse({ session, env, fetchImpl = fetch, timeoutMs = 15000, maxBytes = 4 * 1024 * 1024 }) {
  const [y, m, d] = String(session).split("-");
  const query = `A股 ${y}年${m}月${d}日涨跌幅 成交额 主力资金流向 所属概念`;
  const refresh = env?.IFIND_REFRESH_TOKEN || "";
  const direct = env?.IFIND_ACCESS_TOKEN || "";
  if (!direct && !refresh) throw refuse("未配置（缺少 IFIND_ACCESS_TOKEN 或 IFIND_REFRESH_TOKEN）");

  // Only a token from the cache may be stale: it alone earns one re-exchange and one more query.
  let fromCache = !direct && Boolean(cached && cached.until > Date.now());
  let token = direct || (fromCache ? cached.value : await exchange(refresh, fetchImpl, timeoutMs, maxBytes));
  let reply;
  for (;;) {
    ({ json: reply } = await post("smart_stock_picking", { access_token: token }, { searchstring: query, searchtype: "stock" }, fetchImpl, timeoutMs, maxBytes));
    if (reply !== null && reply.errorcode === 0) break;
    if (!fromCache) break;
    fromCache = false;
    cached = null;
    token = await exchange(refresh, fetchImpl, timeoutMs, maxBytes);
  }
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
