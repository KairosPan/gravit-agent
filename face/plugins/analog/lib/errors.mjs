// face/plugins/analog/lib/errors.mjs
/**
 * The refusals the analog rows share, the caller gate, and the last catch a tool's `execute` throws through. A
 * refusal is a thrown `AnalogError` whose message opens with its code word and a space, which the model sees as
 * `Error: <CODE> …`; none names a path. What an unexpected error says goes to the face's stderr, the operator's log,
 * and never into a result.
 */
export { callerIsChild } from "../../lunhui/lib/errors.mjs";

export class AnalogError extends Error {
  /**
   * @param {string} code the stable code word the message opens with
   * @param {string} reason what was refused, naming no path
   */
  constructor(code, reason) {
    super(`${code} ${reason}`);
    this.name = "AnalogError";
    /** The stable code word the message opens with. */
    this.code = code;
  }
}

/**
 * A fraction as a percentage with one decimal, U+2212 for a negative.
 * @param {number} v
 */
const percent = (v) => `${(v * 100).toFixed(1).replace("-", "−")}%`;

/** The refusal table, one maker per refusal. */
export const refuse = {
  /** A query whose depth is above −10%: version 1 matches sell-offs only. */
  notASelloff: (/** @type {string} */ symbol, /** @type {number} */ depth, /** @type {string} */ peakDate) =>
    new AnalogError(
      "NOT_A_SELLOFF",
      `${symbol} is ${percent(depth)} from its 60-session high of ${peakDate}: a sell-off is a fall of 10% or more from that high`,
    ),
  /** A query whose 60-session high is its own latest bar: daily bars cannot time a fall inside one session. */
  highIsLatest: (/** @type {string} */ symbol, /** @type {string} */ date) =>
    new AnalogError(
      "NOT_A_SELLOFF",
      `${symbol} made its 60-session high on ${date}, its latest bar: daily bars cannot time a fall inside one session`,
    ),
  /** The query's history refused by the market (its words), or too short to scan. */
  noHistory: (/** @type {string} */ symbol, /** @type {string | undefined} */ words) =>
    new AnalogError(
      "NO_HISTORY",
      words === undefined
        ? `${symbol} has fewer than 120 daily bars, too few to scan`
        : `no daily history of ${symbol} to scan: ${words}`,
    ),
  marketUnreachable: (/** @type {string} */ words) =>
    new AnalogError("MARKET_UNREACHABLE", `${words}; the scan reads every history through the market, which must be running`),
  badSymbol: () =>
    new AnalogError("BAD_SYMBOL", "a symbol is a ticker of 1 to 10 letters, digits and dots starting with a letter, such as NVDA or BRK.B"),
  badAsOf: () => new AnalogError("BAD_AS_OF", "as_of is a date YYYY-MM-DD, or left out for the latest bar"),
  badAlso: () => new AnalogError("BAD_ALSO", "also is a list of at most 20 tickers, each like NVDA or BRK.B"),
  notGravit: () =>
    new AnalogError(
      "NOT_GRAVIT",
      "the analog tools are called by Gravit alone (a root session or its fork); a delegated child cannot call them: tell Gravit what to scan",
    ),
  badViewId: () => new AnalogError("BAD_VIEW_ID", "a view id is an- followed by a date YYYYMMDD, a dash and 8 hex digits"),
  noSuchView: () => new AnalogError("NO_SUCH_VIEW", "no view is kept under this id"),
  internal: () =>
    new AnalogError("INTERNAL", "an internal error; its detail goes to the face's log only. Retry once; if it fails again, tell the operator"),
};

/**
 * What a tool's `execute` throws for an error that reached it: an `AnalogError` as it is; anything else `INTERNAL`,
 * after its stack is written to stderr.
 * @param {unknown} error
 * @returns {AnalogError}
 */
export function asToolError(error) {
  if (error instanceof AnalogError) return error;
  process.stderr.write(`analog: internal error: ${/** @type {any} */ (error)?.stack ?? String(error)}\n`);
  return refuse.internal();
}
