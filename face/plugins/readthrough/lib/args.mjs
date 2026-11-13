// face/plugins/readthrough/lib/args.mjs
/**
 * The check of `read_through`'s arguments: what the model proposes, trimmed and bounded, its symbols upper-cased, or
 * an `INVALID` refusal naming the first bad field. A text is one line within its limit in characters (code points),
 * not bytes, with no control or format character, no invisible (default-ignorable) character, no Braille blank, no
 * lone surrogate, no space but the plain one and never two of those in a row, and none of the block's own labels
 * (`block.mjs` `LABELS`: `推演`, and `事件：`, `逻辑：`, `方向：`, `盘面：`, `反方：`, `来源：`), even split by a mark.
 * Each text is also an allow-list. The event, each source, the logic, the counter-case and no_direction hold only
 * common Chinese characters (U+4E00-U+9FA5), printable ASCII and the marks of `TEXT_MARKS` (the tape's own minus
 * U+2212 among them); a peer's reason, narrower, only common Chinese characters, ASCII letters and digits, single
 * plain spaces and the marks of `REASON_MARKS` - so no bracket, double quotation mark or semicolon of any script. No
 * text says `做多`, the direction line's own word, even split by a space or a mark. So no text holds a letter of
 * another script drawn as a bracket or a colon, a combining mark, or a character a phone's font draws as a blank: no
 * line the operator reads can pass for one the face wrote.
 */
import { normalizeSymbol } from "../../analog/lib/symbols.mjs";
import { LABELS } from "./block.mjs";
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
/** The Braille blank (U+2800), drawn as a space but no space, and a surrogate standing alone: no text holds either. */
const BLANK = /[\u2800\p{Cs}]/u;
const { head: HEAD, ...COLON_LABELS } = LABELS;
/** The block's own labels (`block.mjs` `LABELS`): its head word, and each other label followed by a colon. No text may
 * hold one, or a line of it could pass for one of the block's. Matched on {@link labelFold}'s text. */
const LABEL = new RegExp(`(?:${Object.values(COLON_LABELS).join("|")}):|${HEAD}`, "u");
/** The block's labels as a refusal names them. */
const LABEL_LIST = [HEAD, ...Object.values(COLON_LABELS).map((l) => `${l}：`)].join(", ");
/** What {@link labelFold} drops: everything but a letter, a digit and the colon - spaces, brackets, quotes,
 * semicolons, dashes and every other mark a text may hold, and a combining mark - so that `方 向：`, `方·向：`,
 * `方向（）：`, `方向”：` and `方\u302a向：` read as `方向:`, while `技术方向，客户重叠` keeps no colon after its `方向`. */
const LABEL_DROPS = /[^\p{L}\p{N}:]/gu;

/**
 * A text as the label check reads it: NFKC-folded, so a full-width, small or vertical colon is `:` and a
 * compatibility form is its plain one, then with {@link LABEL_DROPS} dropped.
 * @param {string} value
 */
function labelFold(value) {
  return value.normalize("NFKC").replace(LABEL_DROPS, "");
}
/*
 * The two allow-lists, each defined here alone. A reason sits inside the face's own parentheses on the direction line
 * (`做多 AMD（<reason>）；做多 …`), so it may hold no bracket, quote or semicolon at all; the other texts sit on lines of
 * their own after a label the face wrote, so they may hold the brackets, quotes and semicolons of plain prose.
 */
/** The marks a peer's reason may hold besides letters, digits and the plain space: `，、。·：,.:'’-–—/%+&`. */
export const REASON_MARKS = "\uff0c\u3001\u3002\u00b7\uff1a,.:'\u2019-\u2013\u2014/%+&";
/** The marks the other texts may hold besides common Chinese characters and printable ASCII:
 * `−，、。·：；（）！？「」『』《》“”‘’—–…→←↑↓％±×` - the first, U+2212, the minus the face prints on the tape. */
export const TEXT_MARKS = "\u2212\uff0c\u3001\u3002\u00b7\uff1a\uff1b\uff08\uff09\uff01\uff1f\u300c\u300d\u300e\u300f\u300a\u300b\u201c\u201d\u2018\u2019\u2014\u2013\u2026\u2192\u2190\u2191\u2193\uff05\u00b1\u00d7";
/** The first character any text but a reason may not hold. */
const NOT_TEXT = new RegExp(`[^\u4e00-\u9fa5\u0020-\u007e${TEXT_MARKS}]`, "u");
/** The first character a reason may not hold: anything but a common Chinese character (the base block, U+4E00 to
 * U+9FA5), an ASCII letter or digit, the plain space or a mark of {@link REASON_MARKS}, so that a reason can never read
 * as a second entry of the direction line (`做多 AMD（…）；做多 …`) - not even through a letter of another script drawn
 * as a bracket, or a run of ideographs a phone's font draws as blank cells. */
const NOT_REASON = new RegExp(`[^\u4e00-\u9fa5A-Za-z0-9 ${REASON_MARKS.replace(/[-/]/g, "\\$&")}]`, "u");
/** What a reason holds, as a refusal says it. */
const REASON_HOLDS = `a reason holds only common Chinese characters, ASCII letters and digits, single spaces and ${[...REASON_MARKS].join(" ")}`;
/** What the other texts hold, as a refusal says it. */
const TEXT_HOLDS = `a text holds only common Chinese characters, printable ASCII and ${[...TEXT_MARKS].join(" ")}`;
/** What a list's refusal says and what it refuses. */
const TEXT_LIST = Object.freeze({ not: NOT_TEXT, holds: TEXT_HOLDS, then: "remove it" });
const REASON_LIST = Object.freeze({ not: NOT_REASON, holds: REASON_HOLDS, then: "remove it and say the overlap in plain words" });

/**
 * A text trimmed, or `INVALID` when it is not a string, is empty, holds a line break, a control or format character,
 * an invisible character, the Braille blank, a lone surrogate, a space other than U+0020, two spaces in a row, one
 * of the block's own labels, a character outside its list or `做多`, or exceeds its limit.
 * @param {string} field
 * @param {unknown} raw
 * @param {number} limit
 * @param {{ not: RegExp, holds: string, then: string }} [list] the allow-list, {@link TEXT_LIST} unless a reason's
 * @returns {string}
 */
function text(field, raw, limit, list = TEXT_LIST) {
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
  const blank = BLANK.exec(value)?.[0];
  if (blank !== undefined) throw refuse.invalid(field, `holds ${codeOf(blank)}, which is not text; remove it`);
  if (value.includes("  ")) throw refuse.invalid(field, "holds two spaces in a row; use one");
  const label = LABEL.exec(labelFold(value))?.[0];
  if (label !== undefined) {
    const shown = label.endsWith(":") ? `${label.slice(0, -1)}：` : label;
    throw refuse.invalid(field, `holds "${shown}"; the block's own labels (${LABEL_LIST}) may not appear in a text: write what it says without the label${sourceNote(field)}`);
  }
  const bad = list.not.exec(value)?.[0];
  if (bad !== undefined) {
    const shown = /^[\p{P}\p{S}]$/u.test(bad) ? `"${bad}" (${codeOf(bad)})` : codeOf(bad);
    throw refuse.invalid(field, `holds ${shown}; ${list.holds}: ${list.then}${sourceNote(field)}`);
  }
  // after the list, so a compatibility ideograph is refused by name before NFKC could fold it into 做多
  if (value.normalize("NFKC").replace(/[^\p{L}\p{N}]/gu, "").includes("做多")) {
    throw refuse.invalid(field, `holds "做多"; 做多 is the direction line's own word, even split by a space or a mark: say it another way (for example 买盘转向 AMD)`);
  }
  if ([...value].length > limit) throw refuse.invalid(field, `is at most ${limit} characters`);
  return value;
}

/**
 * What a source's refusal adds: what a source is.
 * @param {string} field
 */
function sourceNote(field) {
  return field.startsWith("sources[") ? " (a source is the outlet and its time alone)" : "";
}

/**
 * A character's code point as `U+XXXX`.
 * @param {string} c
 */
function codeOf(c) {
  return `U+${/** @type {number} */ (c.codePointAt(0)).toString(16).toUpperCase().padStart(4, "0")}`;
}

/**
 * A peer's reason: a text on {@link REASON_LIST}.
 * @param {string} field
 * @param {unknown} raw
 * @returns {string}
 */
function reasonText(field, raw) {
  return text(field, raw, LIMITS.reason, REASON_LIST);
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
