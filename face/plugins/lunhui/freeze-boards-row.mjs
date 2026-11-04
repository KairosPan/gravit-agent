// face/plugins/lunhui/freeze-boards-row.mjs
/**
 * `lunhui-freeze-boards` (modules spec §5.3, A20, A28): `lunhui_freeze_boards({ strategy, run?,
 * boards? })` freezes Eastmoney's concept boards - the top 30 by change (`fetchBoards`), each item
 * `kind: "board"` - then one `kind: "members"` item per constituent board (at most 100 members
 * each, `truncated` when the board has more), then the concept boards' fund-flow rank (`kind:
 * "flow"`), into a market run's `evidence-boards.json`, followed by `deriveBoards`' measures. The
 * constituent boards are `boards` when given (1-10 distinct codes, `BK` and four digits, else
 * `INVALID_SYMBOL`), else the first ten of the list. Each item carries the `host` and `delayed` of
 * the reply that served it (A28); the file's `host` joins the distinct hosts that served the replies; `delayed` is true when any reply was, `truncated` when any member list was cut.
 * `cn-market` only. The evidence meta names the provider, `东方财富`.
 *
 * The 问财 stand-in (boards stand-in spec S1, S4, S6, S9, S10, §5): when any of the three Eastmoney
 * reads refuses (`UPSTREAM_TIMEOUT`, `UPSTREAM_TOO_LARGE`, `UPSTREAM_INVALID`, `NO_MARKET_DATA`),
 * the whole file comes from one 同花顺问财 universe query instead, in the same call (counted once):
 * `deriveStandInBoards`' boards, members and flow, every item stamped `provider: "同花顺问财"`,
 * `taxonomy: "同花顺概念"`, `host: "quantapi.51ifind.com"`, `delayed: false`, a board also
 * `pct_basis: "equal_weight"`; the meta adds `fallback_from: { provider: "东方财富", code }`, the
 * query and the reply's hash, and the reply's summary the provider, the taxonomy, the refusal and,
 * when `boards` was given, `boards_ignored` - BK codes the stand-in cannot honour. The row holds
 * no iFinD credential and reads no environment: the token is the market's, and the query goes
 * through the row's fetch, for the market to ask with it. A market with no token
 * (`NOT_CONFIGURED` from the client) refuses with Eastmoney's code and the 备用未配置 sentence;
 * any other stand-in refusal does too, naming both reasons. Never the token: it is in no request
 * of this row, file, reply or refusal.
 */
import { refuse } from "./lib/errors.mjs";
import { deriveBoards } from "./lib/derive.mjs";
import { fetchBoardFundFlow, fetchBoardMembers, fetchBoards } from "./lib/eastmoney.mjs";
import { RUN_PARAMETERS, SHARED_BOUNDS, defineFreeze, freezeDeps, hostsOf, idsOf, sessionOf } from "./lib/freeze-tool.mjs";
import { LunhuiError } from "./lib/runs.mjs";
import { WENCAI_NOT_CONFIGURED, WENCAI_PROVIDER, fetchWencaiUniverse } from "./lib/wencai.mjs";
import { deriveStandInBoards } from "./lib/wencai-boards.mjs";

export const name = "lunhui-freeze-boards";
export const inject = ["tools", "lunhuiRuns"];

/** The constituent boards a freeze reads at most, and by default. */
const MAX_BOARDS = 10;
const BOARD_RE = /^BK\d{4}$/;

/** @param {{ boards?: unknown }} args */
function checkBoards({ boards }) {
  if (boards === undefined) return;
  if (
    !Array.isArray(boards) ||
    boards.length < 1 ||
    boards.length > MAX_BOARDS ||
    !boards.every((code) => typeof code === "string" && BOARD_RE.test(code)) ||
    new Set(boards).size !== boards.length
  )
    throw refuse.boardShape();
}

const EASTMONEY = "东方财富";
/** The Eastmoney refusals the stand-in answers (S1); any other error passes through as it is. */
const FALLBACK_CODES = new Set(["UPSTREAM_TIMEOUT", "UPSTREAM_TOO_LARGE", "UPSTREAM_INVALID", "NO_MARKET_DATA"]);
const STAND_IN_STAMPS = Object.freeze({ provider: WENCAI_PROVIDER, taxonomy: "同花顺概念", host: "quantapi.51ifind.com", delayed: false });

/**
 * Eastmoney first; on one of its refusals, the 问财 stand-in.
 * @param {import("./lib/freeze-tool.mjs").FetchLike} fetchImpl
 * @param {{ boards?: string[] }} args checked
 * @param {() => Date} now
 * @returns {Promise<import("./lib/freeze-tool.mjs").Frozen>}
 */
async function freeze(fetchImpl, args, now) {
  try {
    return await freezeEastmoney(fetchImpl, args, now);
  } catch (error) {
    if (!(error instanceof LunhuiError) || !FALLBACK_CODES.has(error.code)) throw error;
    return await freezeStandIn(fetchImpl, args, now, error);
  }
}

/**
 * The reason a refusal gives, without its code word and its closing "nothing written" clause.
 * @param {LunhuiError} error
 */
function reasonOf(error) {
  return error.message.slice(`${error.code}: `.length).replace(/[；;]?本次未写入任何文件。?$/, "").replace(/。$/, "");
}

/**
 * The stand-in's boards, members and flow from one 问财 universe, stamped (S6). Refusals carry
 * Eastmoney's code, the one the model retries on, and both providers' reasons (S10).
 * @param {import("./lib/freeze-tool.mjs").FetchLike} fetchImpl
 * @param {{ boards?: string[] }} args checked
 * @param {() => Date} now
 * @param {LunhuiError} refused Eastmoney's refusal
 * @returns {Promise<import("./lib/freeze-tool.mjs").Frozen>}
 */
async function freezeStandIn(fetchImpl, args, now, refused) {
  const code = refused.code;
  const session = sessionOf(now());
  let universe;
  try {
    universe = await fetchWencaiUniverse({ session, fetchImpl });
  } catch (error) {
    if (!(error instanceof LunhuiError)) throw error;
    if (error.code === WENCAI_NOT_CONFIGURED) {
      throw new LunhuiError(code, `${EASTMONEY}板块请求失败（${code}）；${WENCAI_PROVIDER}备用未配置；本次未写入任何文件。`);
    }
    throw new LunhuiError(code, `${EASTMONEY}板块请求失败（${code}：${reasonOf(refused)}）；${WENCAI_PROVIDER}备用也失败（${error.code}：${reasonOf(error)}）；本次未写入任何文件。`);
  }
  const derivedLists = deriveStandInBoards(universe.rows);
  const boards = derivedLists.boards.map((board) => ({ kind: "board", ...board, ...STAND_IN_STAMPS, pct_basis: "equal_weight" }));
  const memberItems = derivedLists.members.map((entry) => ({
    kind: "members", board: entry.board, truncated: entry.truncated, members: entry.members, ...STAND_IN_STAMPS,
  }));
  const items = [...boards, ...memberItems, ...derivedLists.flow.map((row) => ({ kind: "flow", ...row, ...STAND_IN_STAMPS }))];
  const derived = deriveBoards(boards, memberItems, idsOf(boards, (board) => ["board", board.code]));
  const fallback_from = { provider: /** @type {"东方财富"} */ (EASTMONEY), code };
  return {
    items,
    derived,
    meta: {
      received_at: now().toISOString(),
      session,
      host: universe.host,
      delayed: false,
      truncated: memberItems.some((item) => item.truncated),
      provider: WENCAI_PROVIDER,
      fallback_from,
      query: universe.query,
      reply_sha256: universe.sha256,
    },
    summary: {
      provider: WENCAI_PROVIDER,
      taxonomy: STAND_IN_STAMPS.taxonomy,
      fallback_from,
      ...(args.boards === undefined ? {} : { boards_ignored: args.boards }),
    },
  };
}

/**
 * Eastmoney's three reads.
 * @param {import("./lib/freeze-tool.mjs").FetchLike} fetchImpl
 * @param {{ boards?: string[] }} args checked
 * @param {() => Date} now
 * @returns {Promise<import("./lib/freeze-tool.mjs").Frozen>}
 */
async function freezeEastmoney(fetchImpl, args, now) {
  const list = await fetchBoards({ fetchImpl });
  const codes = args.boards ?? list.boards.slice(0, MAX_BOARDS).map((board) => board.code);
  const [members, flow] = await Promise.all([
    Promise.all(codes.map((code) => fetchBoardMembers(code, { fetchImpl }))),
    fetchBoardFundFlow({ fetchImpl }),
  ]);
  // Every item stamped with the reply that served it (A28), before its id is computed.
  const served = ({ host, delayed }) => ({ host, delayed });
  const boards = list.boards.map((board) => ({ kind: "board", ...board, ...served(list) }));
  const memberItems = members.map((reply, i) => ({
    kind: "members", board: codes[i], truncated: reply.truncated, members: reply.members, ...served(reply),
  }));
  const items = [...boards, ...memberItems, ...flow.rows.map((row) => ({ kind: "flow", ...row, ...served(flow) }))];
  const derived = deriveBoards(boards, memberItems, idsOf(boards, (board) => ["board", board.code]));
  const replies = [list, ...members, flow];
  const at = now();
  return {
    items,
    derived,
    meta: {
      received_at: at.toISOString(),
      session: sessionOf(at),
      host: hostsOf(replies.map((reply) => reply.host)),
      delayed: replies.some((reply) => reply.delayed),
      truncated: members.some((reply) => reply.truncated),
      provider: EASTMONEY,
    },
    // The reply names its source on either path (G2): Eastmoney's day says 东方财富.
    summary: { provider: EASTMONEY },
  };
}

/**
 * @param {any} ctx the row's context, injecting `tools` and `lunhuiRuns`
 * @param {{ fetch?: string, market?: string, now?: () => Date }} config test-only keys; an `env` is refused
 */
export function apply(ctx, config) {
  if (config !== null && typeof config === "object" && Object.hasOwn(config, "env")) {
    throw new Error(`${name}: env is gone - the iFinD token is the market's (IFIND_* in the market's environment)`);
  }
  const deps = freezeDeps(name, ctx, config);
  ctx.effect(() => ctx.tools.register(defineFreeze({
    name: "lunhui_freeze_boards",
    description:
      "冻结东方财富概念板块到一个市场运行的证据文件 evidence-boards.json：按涨跌幅排名前 30 的板块（涨跌幅、成交额、上涨与下跌家数、领涨股），" +
      "成分板块的成分股（每个板块至多 100 只，超出时标记 truncated），以及概念板块资金流排名；宿主同时算出每个板块的上涨占比（取板块自身的涨跌家数）与成交额占比，作为派生证据。" +
      "boards 可选，为 1–10 个不重复的板块代码（BK 加四位数字），省略则取排名前 10 的板块。只用于市场频道 cn-market，策略频道会被拒绝（WRONG_CHANNEL）。" +
      "东方财富板块请求失败时改用同花顺问财（同花顺概念，涨跌幅为成分股等权平均），回复写明来源。" +
      SHARED_BOUNDS,
    parameters: {
      ...RUN_PARAMETERS,
      boards: {
        type: "array",
        items: { type: "string" },
        description: "可选：1–10 个不重复的板块代码，每个为 BK 加四位数字；省略则取涨幅前 10 的板块。",
      },
    },
    source: "boards",
    kind: "market",
    check: checkBoards,
    freeze,
    ...deps,
  })));
}
