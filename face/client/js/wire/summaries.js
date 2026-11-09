/** Pure session-summary normalization: the one place a `session/list` row gets
 * back the `agentPreset` field the rest of the client reads.
 *
 * No DOM, no network, no state - one list row plus the face's own preset
 * hints in, one row out. Split out of chat.js for the same reason speaker.js
 * is: the decision has to be drillable without a browser.
 *
 * WHY IT EXISTS. dsh 0.1.1-rc.2's apiproxy summary carried `agentPreset`
 * directly. dsh 0.2.0-rc.2's `SessionSummary` does not (NEW
 * packages/api/session-controller/src/types.ts:177-188; list.ts:105-117,
 * 146-158): the preset now rides the row's projection block as
 * `projections.values.agentPreset` (the registry's `agentPreset` projection,
 * NEW packages/preset/agent-preset-registry/src/session.ts:35-43; the
 * upstream client reads it the same way). Without this fold every bot row,
 * every room member and every bot home session would silently read as the
 * host - the sidebar buckets, the member fold (room.js), the speaker label
 * (speaker.js) and the gate attribution all key on `summary.agentPreset`.
 *
 * PRECEDENCE. The projection value wins: it is the preset the session RUNS,
 * advanced by `agentPresets/select` (session.ts:38-41, and its module doc: the
 * header "names the preset a session STARTED with"), where the persisted header
 * only records the creation-time choice. The hint - `/data/channels.json`'s
 * `presets`, built by the face server from persisted and live session HEADERS
 * (src/channels.ts) - fills in when the block is absent or omits the key:
 * listing hints "remain partial: missing cells and cache rows are never
 * materialized" (list.ts:304-305), and a pre-upgrade v3 projection cache
 * record yields only the predecessor title (list.ts:283), so a cold
 * session opened before its first 0.2 resume has no projected preset at all.
 * An absent value stays absent: the row is never labelled with a guess.
 *
 * RC.5 (the face's B8). Two more things ride the 0.2.1-rc.5 wire, and this module
 * reads both so the host layer never touches the raw shapes:
 *   - a list row gains `formatStatus?: 'current' | 'migration-required'`
 *     (`SessionSummary`, node_modules/@deepseek-ai/dsh-api-session-controller/
 *     lib/types/types.d.ts): the persistence format status when the host reports
 *     one. `summaryOf` carries a known value and drops anything else.
 *   - `session/projections` answers `SessionProjectionsValue` (same file):
 *     `{kind:'sequenced', asOfSeq, values}` for a current log,
 *     `{kind:'migration-required', values}` - sequence-free cache hints, NO
 *     `asOfSeq` - for an older log, or `null` for no such session. Read raw,
 *     `cut.asOfSeq` is `undefined` on the middle shape and a pre-V4 session's
 *     page would fail to open. `readProjections` is the one reader; it lives
 *     here, beside `summaryOf`, because both fold a host answer's projection
 *     block into what the client reads.
 * @module
 */

/** @param {unknown} value @returns {value is Record<string, any>} a non-null, non-array object. */
const record = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * One list row with `agentPreset` restored when the host or the face knows it.
 * Idempotent: a row that already carries `agentPreset` (a second pass, or a
 * `session/create` answer, which still names it - NEW session-controller
 * src/types.ts:292-296) keeps it unless its projection names another.
 * @template {Record<string, any>} T
 * @param {T} row - a `SessionSummary` from `session/list` or an
 *   `api-session/added` notification.
 * @param {Record<string, unknown>|null|undefined} [presetHints] - sessionId → preset
 *   from the persisted/live headers (`/data/channels.json`'s `presets`).
 * @returns {T & {agentPreset?: string, formatStatus?: 'current'|'migration-required'}} a shallow copy; the input row is never mutated.
 */
export function summaryOf(row, presetHints) {
  if (!record(row)) return row;
  const projections = record(row.projections) ? row.projections : undefined;
  const values = record(projections?.values) ? projections.values : undefined;
  // `null` is the registry's "this deployment composes none" (agent-preset-registry
  // src/types.ts:55; session.ts:38 folds a header without one to null),
  // not a preset name: it defers to the hint like an absent key does.
  const projected = values?.agentPreset;
  const id = typeof row.sessionId === "string" ? row.sessionId : undefined;
  // Own keys only: a hint map is plain JSON, and a session id must never reach
  // an inherited Object.prototype member.
  const hinted = id !== undefined && record(presetHints) && Object.hasOwn(presetHints, id) ? presetHints[id] : undefined;
  const agentPreset = typeof projected === "string" && projected !== "" ? projected
    : typeof hinted === "string" && hinted !== "" ? hinted
      : undefined;
  const { formatStatus: reported, ...rest } = row;
  const formatStatus = reported === "current" || reported === "migration-required" ? reported : undefined;
  return { ...rest, ...(agentPreset === undefined ? {} : { agentPreset }), ...(formatStatus === undefined ? {} : { formatStatus }) };
}

/**
 * The one reader of a `session/projections` answer (rc.5's `SessionProjectionsValue`,
 * node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/types.d.ts):
 * `{kind:'sequenced', asOfSeq, values}`, `{kind:'migration-required', values}`
 * (no `asOfSeq`), or `null`. A 0.2.0-shaped `{asOfSeq, values}` with no `kind`
 * reads as sequenced. `asOfSeq` is the inclusive `throughSeq` a page request
 * carries (-1 is an empty log); it is `null` when there is no cut to page
 * against - a migration-required answer (`migrationRequired: true`: the log
 * needs its migration before it has a cut), `null` (no such session) or an
 * answer that is not a projections value at all (`migrationRequired: false`).
 * Callers keep their own `null` check for "no such session"; they decide what
 * each no-cut case means on their screen.
 * @param {unknown} value - the Remote's answer.
 * @returns {{asOfSeq: number|null, values: Record<string, any>, migrationRequired: boolean}}
 */
export function readProjections(value) {
  if (!record(value)) return { asOfSeq: null, values: {}, migrationRequired: false };
  const values = record(value.values) ? value.values : {};
  if (value.kind === "migration-required") return { asOfSeq: null, values, migrationRequired: true };
  const sequenced = value.kind === undefined || value.kind === "sequenced";
  return { asOfSeq: sequenced && Number.isSafeInteger(value.asOfSeq) ? value.asOfSeq : null, values, migrationRequired: false };
}
