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
 * `cn-market` only.
 */
import { refuse } from "./lib/errors.mjs";
import { deriveBoards } from "./lib/derive.mjs";
import { fetchBoardFundFlow, fetchBoardMembers, fetchBoards } from "./lib/eastmoney.mjs";
import { RUN_PARAMETERS, SHARED_BOUNDS, defineFreeze, freezeDeps, hostsOf, idsOf, sessionOf } from "./lib/freeze-tool.mjs";

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

/**
 * @param {import("./lib/freeze-tool.mjs").FetchLike} fetchImpl
 * @param {{ boards?: string[] }} args checked
 * @param {() => Date} now
 * @returns {Promise<import("./lib/freeze-tool.mjs").Frozen>}
 */
async function freeze(fetchImpl, args, now) {
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
    },
  };
}

/**
 * @param {any} ctx the row's context, injecting `tools` and `lunhuiRuns`
 * @param {{ fetch?: string, now?: () => Date }} config
 */
export function apply(ctx, config) {
  const deps = freezeDeps(name, ctx, config);
  ctx.effect(() => ctx.tools.register(defineFreeze({
    name: "lunhui_freeze_boards",
    description:
      "冻结东方财富概念板块到一个市场运行的证据文件 evidence-boards.json：按涨跌幅排名前 30 的板块（涨跌幅、成交额、上涨与下跌家数、领涨股），" +
      "成分板块的成分股（每个板块至多 100 只，超出时标记 truncated），以及概念板块资金流排名；宿主同时算出每个板块的上涨占比（取板块自身的涨跌家数）与成交额占比，作为派生证据。" +
      "boards 可选，为 1–10 个不重复的板块代码（BK 加四位数字），省略则取排名前 10 的板块。只用于市场频道 cn-market，策略频道会被拒绝（WRONG_CHANNEL）。" +
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
