// face/plugins/readthrough/lib/args.mjs
/**
 * The check of `read_through`'s arguments: what the model proposes, trimmed and bounded, its symbols upper-cased, or
 * an `INVALID` refusal naming the first bad field. A text is one line within its limit in characters (code points),
 * not bytes, with no control or format character, no invisible (default-ignorable) character and no space but the
 * plain one. A peer's reason holds only letters and digits of any script, plain spaces and the marks of `REASON_MARKS`,
 * so no bracket, no semicolon and no combining mark, and it never says `做多`, even spaced out or in a compatibility
 * form: the direction line the operator reads holds only the entries the face checked.
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
/** A control or format character (a bidi mark, a zero-width space among them), which no text may hold. */
const CONTROL = /[\p{Cc}\p{Cf}]/u;
/** An invisible character that is neither control nor format (U+034F, a variation selector, a Hangul filler), which
 * no text may hold. */
const IGNORABLE = /\p{Default_Ignorable_Code_Point}/u;
/** A space separator other than the plain space (U+00A0, U+3000, the U+2000 block), which no text may hold. */
const ODD_SPACE = /[\p{Zs}--[\u0020]]/v;
/** The marks a peer's reason may hold besides letters, digits and the plain space: `，、。·：,.:'’-–—/%+&`. */
const REASON_MARKS = "\uff0c\u3001\u3002\u00b7\uff1a,.:'\u2019-\u2013\u2014/%+&";
/** The first character a reason may not hold: anything but a letter, a digit, the plain space or a mark of
 * {@link REASON_MARKS}, so that a reason can never read as a second entry of the direction line
 * (`做多 AMD（…）；做多 …`). */
const NOT_REASON = new RegExp(`[^\\p{L}\\p{N} ${REASON_MARKS.replace(/[-/]/g, "\\$&")}]`, "u");
/** What a reason holds, as a refusal says it. */
const REASON_HOLDS = `a reason holds only letters, digits, plain spaces and ${[...REASON_MARKS].join(" ")}`;

/**
 * A text trimmed, or `INVALID` when it is not a string, is empty, holds a line break, a control or format character,
 * an invisible character or a space other than U+0020, or exceeds its limit.
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
  const control = CONTROL.exec(value)?.[0];
  if (control !== undefined) throw refuse.invalid(field, `holds a control or format character (${codeOf(control)}); remove it`);
  const ignorable = IGNORABLE.exec(value)?.[0];
  if (ignorable !== undefined) throw refuse.invalid(field, `holds an invisible character (${codeOf(ignorable)}); remove it`);
  const space = ODD_SPACE.exec(value)?.[0];
  if (space !== undefined) throw refuse.invalid(field, `holds a space other than the plain space (${codeOf(space)}); use a plain space`);
  if ([...value].length > limit) throw refuse.invalid(field, `is at most ${limit} characters`);
  return value;
}

/**
 * A character's code point as `U+XXXX`.
 * @param {string} c
 */
function codeOf(c) {
  return `U+${/** @type {number} */ (c.codePointAt(0)).toString(16).toUpperCase().padStart(4, "0")}`;
}

/**
 * A peer's reason: a text, or `INVALID` naming the first character it may not hold - quoted when it is a visible
 * punctuation mark or symbol, by its code point always - or saying it holds `做多` once compatibility forms are folded
 * (NFKC) and every space is dropped.
 * @param {string} field
 * @param {unknown} raw
 * @returns {string}
 */
function reasonText(field, raw) {
  const value = text(field, raw, LIMITS.reason);
  const bad = NOT_REASON.exec(value)?.[0];
  if (bad !== undefined) {
    const shown = /^[\p{P}\p{S}]$/u.test(bad) ? `"${bad}" (${codeOf(bad)})` : codeOf(bad);
    throw refuse.invalid(field, `holds ${shown}; ${REASON_HOLDS}: remove it and say the overlap in plain words`);
  }
  if (value.normalize("NFKC").replace(/\s/gu, "").includes("做多")) {
    throw refuse.invalid(field, `holds "做多"; a reason never says 做多, even spaced out: say the overlap in plain words`);
  }
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
    peers.push({ symbol: peer, reason: reasonText(`peers[${i}].reason`, p.reason) });
  }

  const given = (/** @type {unknown} */ v) => v !== undefined && v !== null;
  if (peers.length === 0) {
    if (!given(a.no_direction)) throw refuse.invalid("no_direction", "is required when no rival is named");
    return { symbol, basis, event, sources, logic, peers, noDirection: text("no_direction", a.no_direction, LIMITS.noDirection), counter: null, certainty };
  }
  if (given(a.no_direction)) throw refuse.invalid("no_direction", "is given only when no rival is named");
  return { symbol, basis, event, sources, logic, peers, noDirection: null, counter: text("counter", a.counter, LIMITS.counter), certainty };
}
