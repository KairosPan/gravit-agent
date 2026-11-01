// face/src/echo.ts
/** How the desk echoes text it did not write into a refusal line that may reach the phone: cut to a few characters,
 * every control, line-separator and direction character written as its `\uXXXX` escape, so each echo is one plain
 * line (desk-book.ts's book refusals, standing.ts's parser line). A leaf: it imports nothing.
 * @module
 */

/** What an echo writes as its escape: a control character other than a tab (C0, DEL, C1), the line and paragraph
 * separators, and a direction embedding, override or isolate (U+202A to U+202E, U+2066 to U+2069). */
export const UNSAFE_ECHO_RE = /[\x00-\x08\x0a-\x1f\x7f-\x9f\u{2028}\u{2029}\u{202a}-\u{202e}\u{2066}-\u{2069}]/gu;

/** The most characters of a value, or of a parser's line, a refusal quotes. */
export const SHOWN_MAX = 60;

/** `text` cut to `max` characters (code points), the last a `…` when it is cut. */
export function cut(text: string, max: number = SHOWN_MAX): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("")}…`;
}

/** `text` with each character {@link UNSAFE_ECHO_RE} matches written as its `\uXXXX` escape: the only form in which a
 * refusal echoes one. */
export function escaped(text: string): string {
  return text.replace(UNSAFE_ECHO_RE, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
