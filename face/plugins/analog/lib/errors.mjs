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

/** The refusal table, one maker per refusal. */
export const refuse = {
  marketUnreachable: (/** @type {string} */ words) =>
    new AnalogError("MARKET_UNREACHABLE", `${words}; the scan reads every history through the market, which must be running`),
  badSymbol: () =>
    new AnalogError("BAD_SYMBOL", "a symbol is a ticker of 1 to 10 letters, digits and dots starting with a letter, such as NVDA or BRK.B"),
  /** The events' input refused at its first bad field, named by its path (`events[2].date`). */
  invalidEvents: (/** @type {string} */ field, /** @type {string} */ reason) =>
    new AnalogError("INVALID_EVENTS", `${field}: ${reason}`),
  notGravit: () =>
    new AnalogError(
      "NOT_GRAVIT",
      "the analog tool is called by Gravit alone (a root session or its fork); a delegated child cannot call it: tell Gravit what to measure",
    ),
  badViewId: () => new AnalogError("BAD_VIEW_ID", "a view id is an- followed by a date YYYYMMDD, a dash and 8 hex digits"),
  noSuchView: () => new AnalogError("NO_SUCH_VIEW", "no view is kept under this id"),
  /** An event digest that no cut brings within its bound: the texts the caller gave are too long to retry as they are. */
  digestOverBound: () =>
    new AnalogError(
      "INTERNAL",
      "the answer does not fit the 2,048 bytes a digest may hold; shorten the title, the labels or the group names and call again",
    ),
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
