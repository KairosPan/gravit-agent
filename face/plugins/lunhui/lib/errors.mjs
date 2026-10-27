// face/plugins/lunhui/lib/errors.mjs
/**
 * The refusals every Lunhui row shares (modules spec §5.7, A23): the refusal table, the caller
 * gate, the provider-to-refusal mapping moved out of stage 0's retired `server.mjs`, and the last
 * catch a tool's `execute` throws through. A refusal is a thrown `LunhuiError` whose message opens
 * with its code word, which the model sees as `Error: <CODE> …`; none names a path. What an
 * unexpected error says goes to the face's stderr, the operator's log, and never into a result.
 */
import { LunhuiError, badRunId } from "./runs.mjs";

/** The freeze calls a run takes (spec A7). */
export const FREEZE_BUDGET = 8;

/** The calls one module takes on one run, reads and submits, the refused ones counted (spec A7). */
export const MODULE_BUDGET = 10;

/**
 * The refusal table, one maker per refusal a row throws itself. `runs.mjs` throws its own
 * `NOT_A_STRATEGY`, `BAD_RUN_ID`, `NO_SUCH_RUN`, `RUN_SEALED` and `SOURCE_FROZEN` under the same
 * codes; these are for the rows' own checks. The two refusals of a cited run (A5) read sessions and
 * a phrase the caller passes, never a path.
 */
export const refuse = {
  notAStrategy: () => new LunhuiError("NOT_A_STRATEGY", "strategy 须是策略根目录下一个策略的名字（频道名），不是路径。"),
  badRunId,
  noSuchRun: () => new LunhuiError("NO_SUCH_RUN", "这个策略下没有这个运行目录（不存在、是符号链接，或不是目录）。"),
  runSealed: () =>
    new LunhuiError("RUN_SEALED", "这个运行已封存（已读过上下文），不再接受证据；不带 run 冻结即开启新运行。"),
  sourceFrozen: () => new LunhuiError("SOURCE_FROZEN", "这个运行已冻结过这一来源；每个来源每个运行只冻结一次。"),
  /** A reply that held no usable row: a holiday, a pre-market call, an empty pool. */
  noMarketData: (provider) =>
    new LunhuiError("NO_MARKET_DATA", `${provider}没有返回任何可用数据（缺少正价格或行情时间，或为空）；本次未写入任何文件。`),
  /** A dated reply of another session than the one asked for, both named: the distribution answers its latest session (spec §16). */
  otherSession: (provider, got, wanted) =>
    new LunhuiError("NO_MARKET_DATA", `${provider}返回的数据属于交易日 ${got}，不是本次会话 ${wanted}；本次未写入任何文件。`),
  /** A distribution in which no share is up or down: a session with no prices yet, or one not populated (spec §17). */
  noMarketMove: (provider) =>
    new LunhuiError("NO_MARKET_DATA", `${provider}的涨跌分布里没有任何一只股票上涨或下跌（本会话尚无成交价，或分布未填充）；本次未写入任何文件。`),
  /** The stop instruction rides in the text, as stage 0's did. */
  toolBudget: () =>
    new LunhuiError(
      "TOOL_BUDGET",
      `这个运行的冻结调用已达上限（共 ${FREEZE_BUDGET} 次）；不要再冻结这个运行；需要重做时不带 run 冻结即开启新运行。`,
    ),
  notGravit: () =>
    new LunhuiError("NOT_GRAVIT", "冻结工具只由 Gravit 调用（根会话或其分叉）；委派的子代理不能冻结证据，请把需要的来源告诉 Gravit。"),
  notARole: () =>
    new LunhuiError("NOT_A_ROLE", "模块工件只由委派的角色子代理提交；Gravit 的根会话或分叉不能提交，请委派对应的角色。"),
  /** A submit with no context read of its module in this process (spec §5.7). */
  readFirst: (module) =>
    new LunhuiError(
      "READ_FIRST",
      `提交 ${module} 工件前须先在本进程读取它的上下文（lunhui_read_${module}_context）；face 重启后须重新读取，再按新上下文提交。`,
    ),
  alreadySubmitted: (module) =>
    new LunhuiError("ALREADY_SUBMITTED", `这个运行已接受过 ${module} 模块的工件；每个模块每个运行只提交一次，不要再提交。`),
  /** A module's budget on a run; the stop instruction rides in the text, as `toolBudget`'s does. */
  moduleBudget: (module) =>
    new LunhuiError(
      "TOOL_BUDGET",
      `这个运行的 ${module} 模块调用已达上限（读取与提交合计 ${MODULE_BUDGET} 次）；停止调用本模块的工具，向 Gravit 报告受阻（blocked）并说明缺什么。`,
    ),
  /** A validation rejection, as stage 0 worded one: its category, the validator's reason, the category's repair. */
  rejected: (category, reason, repair) => new LunhuiError("INVALID_ANALYSIS", `[${category}] ${reason}\n修复：${repair}`),
  calendarUncovered: () =>
    new LunhuiError("CALENDAR_UNCOVERED", "交易日历未覆盖今天（中国时间）；本次未写入任何文件，请告知操作者补充日历表。"),
  internal: () => new LunhuiError("INTERNAL", "内部错误；细节只记入 face 的日志，不回传。可重试一次，仍失败请告知操作者。"),
  /**
   * A market freeze outside `cn-market`, a market module's tool outside it, a strategy-only tool
   * inside it (A27), or a `market_run` given to a module that reads `cn-market` without one.
   */
  wrongChannel: (kind) =>
    kind === "marketRun"
      ? new LunhuiError("WRONG_CHANNEL", "市场频道 cn-market 的运行本身就是市场运行，这里读取时不带 market_run；只有策略频道的运行以 market_run 引用一个市场运行。")
      : kind === "strategy"
      ? new LunhuiError("WRONG_CHANNEL", "这个工具只用于策略频道，不用于市场频道 cn-market。")
      : kind === "module"
        ? new LunhuiError("WRONG_CHANNEL", "这个模块只用于市场频道 cn-market 的运行，不用于策略频道。")
        : new LunhuiError("WRONG_CHANNEL", "这个冻结只用于市场频道 cn-market；策略频道只冻结个股行情（lunhui_freeze_quotes）。"),
  /** A cited cn-market run whose session is neither the strategy run's nor the trading day before it (A5). */
  staleMarketRun: (strategySession, marketSession) =>
    new LunhuiError(
      "STALE_MARKET_RUN",
      `引用的市场运行交易日为 ${marketSession ?? "无"}，本运行交易日为 ${strategySession ?? "无"}；` +
        "只能引用同一交易日或前一个交易日的已封存 cn-market 运行。请引用更新的市场运行，或先完成一次新的市场运行。",
    ),
  /** A cited run not yet sealed: it has no snapshot to cite (A5, A27). */
  missingEvidence: (what) =>
    new LunhuiError(
      "MISSING_EVIDENCE",
      `${what}尚未封存（还没有模块读取过它的上下文），没有可引用的快照、证据与工件；请先完成那个运行的模块分析，或引用一个已封存的运行。`,
    ),
  /**
   * A read of `module` (the mode's by default, or the reviewer's) citing another market run than the
   * run's accepted leader artifact cites (A5, A27): one market run per strategy run.
   */
  marketRunDiffers: (leaderRun, module = "mode") =>
    new LunhuiError(
      "MISSING_EVIDENCE",
      `本运行已接受的 leader 工件引用的市场运行是 ${leaderRun ?? "无"}，与这次给出的 market_run 不同；` +
        `leader 与 ${module} 须引用同一个市场运行：请以 leader 引用的市场运行读取 ${module}，或开一个新的策略运行。`,
    ),
  /** A strategy run's read of a module whose `market_run` the schema leaves optional - the reviewer's - given none (A22). */
  marketRunMissing: (module) =>
    new LunhuiError(
      "MISSING_EVIDENCE",
      `策略频道的运行读取 ${module} 上下文须给 market_run：本运行 leader 工件引用的那个已封存 cn-market 运行；没有它就没有可审查的市场证据与工件。`,
    ),
  // The quotes freeze's symbol list, stage 0's four refusals (its `checkSymbols`).
  symbolShape: () =>
    new LunhuiError("INVALID_SYMBOL", "symbols 须为 1–8 个证券代码组成的数组，每个代码是 sh 或 sz 加六位数字。"),
  symbolDuplicate: () => new LunhuiError("INVALID_SYMBOL", "symbols 不得含重复代码。"),
  symbolSet: () =>
    new LunhuiError(
      "INVALID_SYMBOL",
      "仅支持四个指定指数（sh000001、sz399001、sz399006、sh000300）及沪深主板个股（sh60xxxx、sz00xxxx）。",
    ),
  symbolMix: () => new LunhuiError("INVALID_SYMBOL", "一次至多四个指数和四只个股。"),
  /** The boards freeze's `boards` list. */
  boardShape: () =>
    new LunhuiError("INVALID_SYMBOL", "boards 须为 1–10 个不重复的板块代码组成的数组，每个代码是 BK 加四位数字；省略则取涨幅前 10 的板块。"),
};

/**
 * Whether the caller is a delegated child: a `subagent` session that is not a seeded fork - the
 * mirror of `gravit.js`'s `isRootOrFork`, reading the header as `src/agents.ts` reads the caller.
 * A freeze refuses such a caller `NOT_GRAVIT` (A23).
 * @param {any} exec the tool's execution context
 */
export function callerIsChild(exec) {
  return exec?.agent?.session?.header?.origin === "subagent" && exec.agent.session.header.isSeeded !== true;
}

/**
 * Whether the caller may submit a module's artifact: a delegated role child, exactly
 * `callerIsChild`; a root session or a seeded fork is refused `NOT_A_ROLE` (A23).
 * @param {any} exec the tool's execution context
 */
export function callerIsRole(exec) {
  return callerIsChild(exec);
}

/** The providers a freeze reads, by the name its refusals give them. */
const PROVIDERS = new Set(["腾讯行情", "东方财富"]);

/** `market.mjs`'s `normalizeQuotes` code-less errors, all meaning the reply held no usable quote. */
const NO_QUOTE_MESSAGES = new Set(["Invalid response", "Empty response", "No usable quotes"]);

/**
 * `market.mjs`'s codes for a reply that failed its HTTP status, encoding, structure or provider
 * status, and `eastmoney.mjs`'s `REDIRECT_REFUSED` for a redirect it would not follow.
 */
const INVALID_REPLY_CODES = new Set([
  "PROVIDER_HTTP_ERROR", "INVALID_RESPONSE", "INVALID_ENCODING", "PROVIDER_ERROR", "REDIRECT_REFUSED",
]);

/**
 * The refusal for an error a provider request rejected with (stage 0's `upstreamRefusal`): the
 * timeout and size codes as themselves, the other reply codes as `UPSTREAM_INVALID`, a reply that
 * cannot be assembled (`INVALID_CONTEXT`) as `UPSTREAM_INVALID` too. A `LunhuiError` is already a
 * refusal and passes through. Any other coded error is the host's own fault - a broken clock, a
 * broken fetch - and so null, which the caller rethrows through `asToolError` as `INTERNAL`. A
 * code-less one is `normalizeQuotes` finding no usable quote (`NO_MARKET_DATA`) or else the fetch
 * failing outright, which Node's `fetch` reports without a code: no
 * connection, a refused redirect, a dropped body. That one is `UPSTREAM_INVALID` to the model, a
 * fixed sentence; what failed - the message and its cause - goes to stderr.
 * @param {any} error
 * @param {"腾讯行情" | "东方财富"} provider the provider the texts name
 * @returns {LunhuiError | null}
 */
export function upstreamError(error, provider) {
  if (!PROVIDERS.has(provider)) throw new TypeError(`lunhui: a provider is 腾讯行情 or 东方财富, not ${JSON.stringify(provider)}`);
  if (error instanceof LunhuiError) return error;
  const code = error?.code;
  if (code === "PROVIDER_TIMEOUT") return new LunhuiError("UPSTREAM_TIMEOUT", `${provider}请求超时（单次 7 秒）；本次未写入任何文件，可稍后重试。`);
  if (code === "RESPONSE_TOO_LARGE") return new LunhuiError("UPSTREAM_TOO_LARGE", `${provider}响应超过 512 KiB 上限；本次未写入任何文件。`);
  if (INVALID_REPLY_CODES.has(code)) return new LunhuiError("UPSTREAM_INVALID", `${provider}响应无效（${code}）；本次未写入任何文件。`);
  if (code === "INVALID_CONTEXT") return new LunhuiError("UPSTREAM_INVALID", `${provider}的响应无法组装为研究证据；本次未写入任何文件。`);
  if (code !== undefined) return null;
  if (NO_QUOTE_MESSAGES.has(error?.message)) return refuse.noMarketData(provider);
  process.stderr.write(`lunhui: a ${provider} request did not complete: ${failureOf(error)}\n`);
  return new LunhuiError("UPSTREAM_INVALID", `${provider}请求未完成（连接失败或响应中断）；本次未写入任何文件。`);
}

/**
 * An error's message and its cause's, with the cause's code when it has one, for the stderr line.
 * @param {any} error
 */
function failureOf(error) {
  const text = (value) => String(value?.message ?? value);
  const cause = error?.cause;
  if (cause === undefined) return text(error);
  return `${text(error)}; cause: ${text(cause)}${cause?.code === undefined ? "" : ` (${cause.code})`}`;
}

/**
 * What a tool's `execute` throws for an error that reached it: a `LunhuiError` as it is; anything
 * else `INTERNAL`, after its stack is written to stderr.
 * @param {unknown} error
 * @returns {LunhuiError}
 */
export function asToolError(error) {
  if (error instanceof LunhuiError) return error;
  process.stderr.write(`lunhui: internal error: ${/** @type {any} */ (error)?.stack ?? String(error)}\n`);
  return refuse.internal();
}
