// face/plugins/readthrough/lib/fence.mjs
/**
 * The fence: the names a direction may carry. They are the face's list of large companies and the US symbols of the
 * desk's files, less the stricken company itself and the index funds a direction never names.
 */

/** The symbols a direction never carries. */
export const NEVER = Object.freeze(["SPY", "QQQ"]);

/**
 * The fence of one stricken company.
 * @param {{ universe: readonly string[], desk: readonly string[], stricken: string }} args
 * @returns {Set<string>}
 */
export function fenceOf({ universe, desk, stricken }) {
  const fence = new Set([...universe, ...desk]);
  for (const symbol of [...NEVER, stricken]) fence.delete(symbol);
  return fence;
}
