// face/plugins/readthrough/lib/args.mjs
/**
 * The check of `read_through`'s arguments: what the model proposes, trimmed and bounded, its symbols upper-cased, or
 * an `INVALID` refusal naming the first bad field. A text is one line within its limit in characters (code points),
 * not bytes.
 */
import { normalizeSymbol } from "../../analog/lib/chart-scan.mjs";
import { refuse } from "./errors.mjs";

/**
 * @typedef {{ symbol: string, basis: "company" | "reported", event: string, sources: string[], logic: string,
 *   peers: { symbol: string, reason: string }[], noDirection: string | null, counter: string | null,
 *   certainty: "high" | "medium" | "low" }} Direction
 */

/** Each text's limit in characters, and the most peers and sources a direction holds. */
export const LIMITS = Object.freeze({ event: 160, source: 160, logic: 200, reason: 80, counter: 160, noDirection: 160, peers: 3, sources: 3 });

const BASES = new Set(["company", "reported"]);
const CERTAINTIES = new Set(["high", "medium", "low"]);
/** Every line break a text may not hold. */
const BREAK = /[\n\r\v\f\u0085\u2028\u2029]/;

/**
 * A text trimmed, or `INVALID` when it is not a string, is empty, holds a line break or exceeds its limit.
 * @param {string} field
 * @param {unknown} raw
 * @param {number} limit
 * @returns {string}
 */
function text(field, raw, limit) {
  if (typeof raw !== "string") throw refuse.invalid(field, "a text is required");
  const value = raw.trim();
  if (value === "") throw refuse.invalid(field, "is empty");
  if (BREAK.test(value)) throw refuse.invalid(field, "is one line, with no line break");
  if ([...value].length > limit) throw refuse.invalid(field, `is at most ${limit} characters`);
  return value;
}

/**
 * A symbol as `normalizeSymbol` writes it, or `INVALID` with its reason.
 * @param {string} field
 * @param {unknown} raw
 * @returns {string}
 */
function symbolOf(field, raw) {
  try {
    return normalizeSymbol(raw);
  } catch (error) {
    const message = /** @type {any} */ (error)?.message;
    throw refuse.invalid(field, typeof message === "string" ? message.slice(message.indexOf(" ") + 1) : "not a ticker");
  }
}

/**
 * `read_through`'s arguments checked, as a direction.
 * @param {unknown} raw
 * @returns {Direction}
 */
export function checkArgs(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw refuse.invalid("arguments", "an object is required");
  const a = /** @type {Record<string, unknown>} */ (raw);

  const symbol = symbolOf("symbol", a.symbol);
  if (typeof a.basis !== "string" || !BASES.has(a.basis)) throw refuse.invalid("basis", "is company or reported");
  const basis = /** @type {Direction["basis"]} */ (a.basis);
  if (typeof a.certainty !== "string" || !CERTAINTIES.has(a.certainty)) throw refuse.invalid("certainty", "is high, medium or low");
  if (basis === "reported" && a.certainty === "high") throw refuse.invalid("certainty", "a reported event's certainty is medium or low");
  const certainty = /** @type {Direction["certainty"]} */ (a.certainty);

  const event = text("event", a.event, LIMITS.event);
  if (!Array.isArray(a.sources) || a.sources.length === 0 || a.sources.length > LIMITS.sources) {
    throw refuse.invalid("sources", `is a list of 1 to ${LIMITS.sources} sources`);
  }
  const sources = a.sources.map((s, i) => text(`sources[${i}]`, s, LIMITS.source));
  const logic = text("logic", a.logic, LIMITS.logic);

  if (!Array.isArray(a.peers) || a.peers.length > LIMITS.peers) throw refuse.invalid("peers", `is a list of at most ${LIMITS.peers} rivals`);
  /** @type {Direction["peers"]} */
  const peers = [];
  for (const [i, p] of a.peers.entries()) {
    if (p === null || typeof p !== "object") throw refuse.invalid(`peers[${i}]`, "is an object with symbol and reason");
    const peer = symbolOf(`peers[${i}].symbol`, p.symbol);
    if (peer === symbol) throw refuse.invalid(`peers[${i}].symbol`, "is the stricken company itself");
    if (peers.some((q) => q.symbol === peer)) throw refuse.invalid(`peers[${i}].symbol`, `${peer} is named twice`);
    peers.push({ symbol: peer, reason: text(`peers[${i}].reason`, p.reason, LIMITS.reason) });
  }

  const given = (/** @type {unknown} */ v) => v !== undefined && v !== null;
  if (peers.length === 0) {
    if (!given(a.no_direction)) throw refuse.invalid("no_direction", "is required when no rival is named");
    return { symbol, basis, event, sources, logic, peers, noDirection: text("no_direction", a.no_direction, LIMITS.noDirection), counter: null, certainty };
  }
  if (given(a.no_direction)) throw refuse.invalid("no_direction", "is given only when no rival is named");
  return { symbol, basis, event, sources, logic, peers, noDirection: null, counter: text("counter", a.counter, LIMITS.counter), certainty };
}
