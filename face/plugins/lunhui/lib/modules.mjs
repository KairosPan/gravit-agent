// face/plugins/lunhui/lib/modules.mjs
/**
 * The Lunhui modules (modules spec §5.4): the five chapters' modules and the reviewer's
 * counterevidence, in the order a run takes them, each with its artifact's file name in the run
 * directory and its headline fields - what `lunhui_read_run` and the runs card show of an
 * artifact. The server owns this table; the face's channel reader copies the pairs.
 */

/** @typedef {{ name: string, file: string, headline: readonly string[] }} LunhuiModule */

/** @param {string} name @param {string[]} headline @returns {LunhuiModule} */
const lunhuiModule = (name, headline) => Object.freeze({ name, file: `${name}.json`, headline: Object.freeze(headline) });

/** @type {readonly LunhuiModule[]} */
export const MODULES = Object.freeze([
  lunhuiModule("environment", ["index_state", "liquidity_state", "cycle_anchor"]),
  lunhuiModule("sentiment", ["state", "money_effect", "freeze_type"]),
  lunhuiModule("theme", ["mainline_candidates", "theme_stage", "rotation"]),
  lunhuiModule("leader", ["leader_candidates", "top_pattern_flags"]),
  lunhuiModule("mode", ["mode", "preconditions", "research_only_matches", "expectation", "expectation_review"]),
  lunhuiModule("counterevidence", ["items"]),
]);
