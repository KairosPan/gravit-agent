/** Pure speaker-label decision: whose name the transcript writes over a turn.
 *
 * No DOM, no network, no state — one session summary's `agentPreset` plus the
 * roster in, one display name out. Split out of chat.js for the same reason
 * grouping.js and channelName.js are: the decision has to be drillable without
 * a browser.
 *
 * THE BUG THIS CLOSES (R12). A bot's home session answered in the bot's
 * persona and the sidebar filed it under the bot's name, but the four surfaces
 * in `chat.js` that NAME the speaker each wrote a literal `Gravit`: the `who`
 * element over an assistant bubble, the ask card's `… asks` head, the composer
 * placeholder, and the status pulse. Four surfaces, one name, as many agents
 * as the operator had bots.
 *
 * WHAT IT IS NOT. It is not attribution. It reads the SESSION's own preset,
 * the same `agentPreset` field `botOf` (chat.js) buckets the sidebar by, so
 * the label and the bucket can never disagree — but it says nothing about
 * which agent produced any individual frame. Per-MESSAGE attribution, several
 * voices in one room log, is plan 3 and does not exist yet. (At dsh 0.2 the
 * raw summary carries no `agentPreset`; summaries.js restores it on every list
 * row - preset projection first, persisted header second - before it reaches here.)
 *
 * THE FALLBACK DIRECTION IS THE POINT. An unknown preset (a deleted bot, a
 * roster fetch that failed) degrades to the ID, never to `Gravit`. Labelling a
 * bot's words as the host's is the failure worth avoiding; an unlovely
 * `buffett-type` over a bubble is not. Fail-away-from-the-host.
 * @module
 */

/** The host agent's display name — the label for every session no bot owns. */
export const HOST_NAME = "Gravit"; // en-kept: the agent's name

/** The preset ids that ARE the host: `gravit`, and `kairos` — the same agent's
 *  id before the 2026-10-08 rename, which archived sessions still carry and the
 *  face declares as a hidden alias (rename spec 2026-10-18 §5.1). */
export const HOST_PRESETS = Object.freeze(["gravit", "kairos"]);

/** Whether a preset id is the host's.
 * @param {unknown} id @returns {boolean} */
export function isHostPreset(id) {
  return typeof id === "string" && HOST_PRESETS.includes(id);
}

/** The desk's preset: Gravit on the desk, informing from the phone and the
 *  clock (src/desk-names.ts spells the same id, and src/bots.ts reserves it, so
 *  no bot can take it). It speaks as Gravit, but it is NOT a host preset: the
 *  host-only controls - delegating a subtask (chat.js) - are no desk session's. */
export const DESK_PRESET = "gravit-desk";

/** Whether a preset id is the desk's.
 * @param {unknown} id @returns {boolean} */
export function isDeskPreset(id) {
  return id === DESK_PRESET;
}

/** The namespace of the role presets: a role child's session carries
 *  `role-<id>` (src/roles.ts `rolePresetId`; src/bots.ts spells the same
 *  prefix and refuses it as a bot id, so no roster row can name one). */
export const ROLE_PRESET_PREFIX = "role-";

/**
 * The voice a session speaks with: `Role · <id>` for a role child's preset
 * (B11: a role child's page shows its role, not Gravit and not the raw preset
 * id), a bot's display name when `agentPreset` names one (never a host id,
 * never the desk's, and never a blank string — a header field present but
 * empty is no preset at all), the bot's id when the roster has no name for
 * it, else Gravit - the host's sessions and the desk's.
 * @param {{agentPreset?: unknown}|null|undefined} summary - the session
 *   summary from `session/list` (normalized by summaries.js) or `session/create`,
 *   or `null` for no session.
 * @param {{id: string, name?: unknown}[]} bots - the `/data/bots.json` rows.
 * @returns {string} the display name to write over the session's turns.
 */
export function speakerFor(summary, bots) {
  const id = summary?.agentPreset;
  if (typeof id !== "string" || id.trim() === "" || isHostPreset(id) || isDeskPreset(id)) return HOST_NAME;
  if (id.startsWith(ROLE_PRESET_PREFIX) && id.length > ROLE_PRESET_PREFIX.length) return `Role · ${id.slice(ROLE_PRESET_PREFIX.length)}`;
  const bot = (Array.isArray(bots) ? bots : []).find((b) => b?.id === id);
  const name = typeof bot?.name === "string" ? bot.name.trim() : "";
  return name === "" ? id : name;
}
