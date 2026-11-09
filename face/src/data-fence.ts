// face/src/data-fence.ts
/** The face's data fence, in a leaf module that imports nothing: src/desk-conversation.ts loads only types and leaves
 * at module load (its MODULE WEIGHT), and a phone reply's context is fenced there; src/task-relay.ts re-exports it for
 * the task relay, `task_read` and the desk's lines in the conversation. Its nonce comes from the global Web Crypto.
 * @module
 */

/** `text` quoted as data between `<<<<tag> NONCE>>>` and `<<<end NONCE>>>` lines, with a fresh random nonce per call,
 * so the words inside cannot close the quote; a line of the text - split at every line break, `\r`, U+2028 and U+2029
 * included - that starts with `<<<` or with one of `heads` gets a leading space, so the text cannot forge a fence or a
 * head either. Nothing is cut: the caller cuts first. The task relay's quote (src/task-relay.ts `fenceTaskData`), the
 * desk's lines in the conversation (src/conversation.ts `noteMessage`, tag `desk-data`, every line starting `[`) and a
 * phone reply's context (src/desk-conversation.ts `phoneContent`, the same tag and head) use it.
 * @param text - the words to quote.
 * @param opts - `tag`, the opening fence's word; `heads`, the line starts that are quoted; `nonce`, the fence's - a
 *   fresh 16-hex-digit one when omitted (tests pass their own). */
export function fenceData(text: string, opts: { tag: string; heads: readonly string[]; nonce?: string }): string {
  const nonce = opts.nonce ?? freshNonce();
  const body = text
    .split(/\r\n|\r|\n|\u2028|\u2029/)
    .map((line) => (line.startsWith("<<<") || opts.heads.some((head) => line.startsWith(head)) ? ` ${line}` : line))
    .join("\n");
  return `<<<${opts.tag} ${nonce}>>>\n${body}\n<<<end ${nonce}>>>`;
}

/** Sixteen random hex digits. */
function freshNonce(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
