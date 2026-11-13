// face/plugins/readthrough/lib/errors.mjs
/**
 * The refusals the read-through shares, the caller gate, and the last catch a tool's `execute` throws through. A
 * refusal is a thrown `ReadThroughError` whose message opens with its code word and a space, which the model sees as
 * `Error: <CODE> …`; none names a path. What an unexpected error says goes to the face's stderr, the operator's log,
 * and never into a result.
 */

export { callerIsChild } from "../../lunhui/lib/errors.mjs";

export class ReadThroughError extends Error {
  /**
   * @param {string} code the stable code word the message opens with
   * @param {string} reason what was refused, naming no path
   */
  constructor(code, reason) {
    super(`${code} ${reason}`);
    this.name = "ReadThroughError";
    /** The stable code word the message opens with. */
    this.code = code;
  }
}

/** The refusal table, one maker per code. */
export const refuse = {
  /** An argument refused at its first bad field, named by its path (`peers[1].symbol`). */
  invalid: (/** @type {string} */ field, /** @type {string} */ reason) => new ReadThroughError("INVALID", `${field}: ${reason}`),
  /** A rival outside the fence; `asOf` is the date of the face's list of large companies. */
  outsideFence: (/** @type {string} */ symbol, /** @type {string} */ asOf) =>
    new ReadThroughError(
      "OUTSIDE_FENCE",
      `${symbol} is not a name a direction may carry: only the hundred large companies of the face's list (as of ${asOf}) ` +
        "or a US symbol in desk/rules.yml, desk/holdings.yml or desk/levels.yml. Call again without it; " +
        "the operator allows a name by adding it to one of those files",
    ),
  /** A stricken company that is not one of the message's alerts. */
  notAlerted: (/** @type {string} */ symbol, /** @type {readonly string[]} */ alerted) =>
    new ReadThroughError("NOT_ALERTED", `${symbol} is not an alert of this message; a direction here is for ${alerted.join(", ")}`),
  /** A second direction for the same company under the same close. */
  alreadyGiven: (/** @type {string} */ symbol, /** @type {string} */ ref) =>
    new ReadThroughError("ALREADY_GIVEN", `a direction for ${symbol} was already given under the ${ref} close; nothing was recorded`),
  alertOnly: () => new ReadThroughError("ALERT_ONLY", "a direction is given under an alert only"),
  noTape: (/** @type {string} */ symbol) =>
    new ReadThroughError("NO_TAPE", `the market gave no price and change for ${symbol}: a direction without its tape is not given`),
  /** The market's prices unreadable now; `words` say why. */
  notReady: (/** @type {string} */ words) =>
    new ReadThroughError("NOT_READY", `the market's prices cannot be read now (${words}); nothing was recorded`),
  notGravit: () =>
    new ReadThroughError(
      "NOT_GRAVIT",
      "read_through is called by Gravit alone (a root session or its fork); a delegated child cannot call it",
    ),
  internal: () =>
    new ReadThroughError("INTERNAL", "an internal error; its detail goes to the face's log only. Retry once; if it fails again, tell the operator"),
};

/**
 * What a tool's `execute` throws for an error that reached it: a `ReadThroughError` as it is; anything else
 * `INTERNAL`, after its stack is written to stderr.
 * @param {unknown} error
 * @returns {ReadThroughError}
 */
export function asToolError(error) {
  if (error instanceof ReadThroughError) return error;
  process.stderr.write(`readthrough: internal error: ${/** @type {any} */ (error)?.stack ?? String(error)}\n`);
  return refuse.internal();
}
