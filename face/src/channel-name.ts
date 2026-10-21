/** A channel's name: the one rule channels.ts creates `strategies/<name>` by and standing.ts reads an order's
 * `dir: strategies/<name>` by. A leaf - it imports nothing - so a reader of the rule loads none of
 * channels.ts's routes, bots or roster.
 * @module
 */

/** Exactly a channel directory name: one path segment of letters and digits
 * in ANY script (a Chinese name is a name) plus `-` and `_`, 1-41 code
 * points, opening with a letter or digit - so `.`/`..`, dotfiles, separators,
 * spaces and control characters never reach a path. Compared and created in
 * NFC, so one word typed in two normalizations is one directory. */
export const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}\p{M}_-]{0,40}$/u;
