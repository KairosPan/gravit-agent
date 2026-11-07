/** The face's policy layer: the 0.1.1-rc.2 product defaults that dsh-base
 * 0.2.0-rc.2 and 0.2.1-rc.5 changed, restored in ONE reviewable place (PLAN
 * §2, S4).
 *
 * Everything here changes what Gravit can do or what leaves the machine, so
 * every entry is a DECISION the operator owns (PLAN §6), named by its id. The
 * default is always "keep 0.1.1's behaviour"; following upstream instead is a
 * one-row operator patch, not a code change.
 *
 * CITATIONS: `NEW`/`OLD` paths and `base :N` lines are the upstream sources the
 * 0.2.0-rc.2 entries were decided against (NEW = 0.2.0-rc.2, OLD = 0.1.1) and
 * are not re-cut at each bump. The two 0.2.1-rc.5 entries - D9's ralph insert
 * and D19 (spec 2026-11-02: B4, D19) - cite the installed packages by name and
 * line.
 *
 * WHERE IT COMPOSES (boot.ts `composeFace`): directly ABOVE the bundle layer
 * and BELOW everything the operator writes — the project rows, the profile's
 * `cordis.patch.yml`, the home layer. So an operator row with the same id wins
 * (the last write per row wins: NEW packages/bundle/base/cordis.patch.yml:1-4),
 * which is the opposite of the face's overlay rows, and on purpose: these are
 * defaults, not the face's contract.
 *
 * TWO PATCH RULES this file stands on (NEW vendor/include/src/index.ts:
 * 104-125): a non-insert patch overwrites ONLY the keys it names, so
 * `{ id, disabled }` keeps the row's config; but a named `config` REPLACES the
 * whole config, so a row whose config is patched is restated completely here
 * (`tool-web`, `web`). And a patch aimed at a row that is not there does
 * nothing, silently — hence every id patch is guarded on the row being in the
 * bundle composition, the absence is reported rather than swallowed, and
 * tests/policy.test.ts pins every id against the installed dsh-base.
 * @module
 */
import { LOCAL_FETCH_PROVIDER_ID } from "@deepseek-ai/dsh-web-fetch-http";
import type { FacePatchList } from "./boot.ts";

/** One id-targeted restoration: which decision it implements, and the patch. */
export interface PolicyIdPatch {
  /** The PLAN §6 decision id and a short name, e.g. `D4 session-log upload`. */
  readonly decision: string;
  readonly patch: {
    readonly id: string;
    readonly disabled?: boolean;
    readonly config?: Readonly<Record<string, unknown>>;
  };
}

/** One row the face inserts because dsh-base stopped mounting it. A `config`
 * is the row's WHOLE config: an inserted row inherits none from dsh-base. */
export interface PolicyInsert {
  readonly decision: string;
  readonly row: { readonly id: string; readonly name: string; readonly config?: Readonly<Record<string, unknown>> };
}

/** The id-targeted restorations, in composition order. Each comment cites the
 * NEW dsh-base row it targets and the upstream change it undoes. */
export const POLICY_ID_PATCHES: readonly PolicyIdPatch[] = [
  /* D3. Upstream flipped the row's default mode from DISABLED to FEEDBACK_ONLY:
   * after a `/feedback` (dsh-base mounts `command-feedback`, base :310) it
   * uploads a session-log prefix to dsh-otel-collector.deepseeksvc.com with the
   * home's `.anonymous-user-id` (base :188-212; commit 106e5ce0bc; OLD base
   * :148-151 had `'DISABLED'`). Nothing hard-injects its service, so the row
   * can go. `DSH_TELEMETRY_DISABLED` still works on top (boot.ts). */
  { decision: "D3 telemetry", patch: { id: "session-telemetry-otel", disabled: true } },
  /* D4. New in dsh-base: owns the `dsh_session_log` request field and sends up
   * to `maxBytes` (8 MiB) of Session events on every official DeepSeek request
   * (base :43-44; NEW packages/session/session-log-deepseek/src/index.ts:34-53,
   * 182-223). New egress relative to 0.1.1. A function plugin: no service. */
  { decision: "D4 session-log upload", patch: { id: "session-log-deepseek", disabled: true } },
  /* D5. New in dsh-base: sends the active plugin-package list on every
   * DeepSeek request (base :77-78; NEW packages/llm/
   * plugin-package-inventory-deepseek/src/index.ts:27-39, 188-193). A function
   * plugin: no service. */
  { decision: "D5 package inventory", patch: { id: "plugin-package-inventory-deepseek", disabled: true } },
  /* D6, two rows. Upstream enabled `web_fetch` by default (commit
   * 0a0f9e59ff): `tool-web.fetch: true` plus a new `web-fetch-http` provider
   * and `web.fetchProvider: http` (base :472-490). 0.1.1 shipped fetch OFF
   * (OLD base :404-418). `tool-web` registers `web_fetch` iff `fetch` is set
   * (NEW packages/web/tool-web/src/index.ts:83-95), so `fetch: false` keeps
   * the tree registering none: no global `web_fetch`, for Gravit, a bot or a
   * role. The `web-fetch-http` provider stays ON and `web` selects it
   * (`LOCAL_FETCH_PROVIDER_ID`, "http"), so the desk's own `web_fetch` - dsh's
   * tool, registered by the face in each desk agent's own layer
   * (src/desk-tools.ts `installDeskTools`, spec 2026-11-07 §5.6, charter R1
   * and D29) - can fetch. Both configs are restated WHOLE (a named config
   * replaces the row's); without `fetchProvider`, `web` would fall back to
   * `$DSH_WEB_FETCH_PROVIDER` (NEW packages/web/web/src/index.ts:90-94). */
  { decision: "D6 web_fetch", patch: { id: "tool-web", config: { fetch: false, searchTimeoutMs: 60000 } } },
  { decision: "D6 web_fetch", patch: { id: "web", config: { searchProvider: "deepseek-official", fetchProvider: LOCAL_FETCH_PROVIDER_ID } } },
  /* D7. New in dsh-base (commit e08468954a; base :492-493): three global
   * model-facing tools (`list_mcp_resources`, `list_mcp_resource_templates`,
   * `read_mcp_resource`, NEW packages/mcp/mcp-resources/src/tools.ts:31-64)
   * plus a prompt section, once any MCP server registers. mcp-client
   * hard-injects only `tools` (NEW packages/mcp/mcp-client/src/index.ts:34)
   * and reaches `mcpResources` through an optional `ctx.inject`
   * (server-context.ts:29-31), so disabling it strands nothing. (The
   * `mcp:<server>` instructions section beside it has no switch; it stays.) */
  { decision: "D7 MCP resource tools", patch: { id: "mcp-resources", disabled: true } },
  /* D19. New in dsh-base at 0.2.1: `tool-working-directory` gives EVERY agent a
   * `working_directory {cd}` tool (base 0.2.1-rc.5 :169-170; the tool is
   * @deepseek-ai/dsh-tool-working-directory lib/index.js:10-43) that moves the
   * calling session's current directory - reads, writes, bash and the
   * instruction chain follow it, the sandbox root does not (spec 2026-11-02,
   * D19). A channel IS a directory here and the contracts say "whose cwd is the
   * directory" (the desk's guard places a relative path against `header.cwd`),
   * so no agent moves its own: the tool row goes. Only the TOOL goes. The
   * `working-directory` row (base :166-167) stays: it is the service the tool
   * injects and the owner of the runtime context that tells the model its
   * directory on every request (`Current working directory: "<dir>".`,
   * @deepseek-ai/dsh-working-directory lib/index.js:41-47, 121-123), which is
   * what replaced the persona's `{{cwd}}` (D21, persona.ts). No other package
   * names the tool, so disabling it strands nothing. An operator row
   * `{ id: tool-working-directory, disabled: false }` brings it back. */
  { decision: "D19 working_directory", patch: { id: "tool-working-directory", disabled: true } },
];

/** Rows dsh-base no longer mounts at all, inserted when (and only when) the
 * bundle composition lacks them — a second same-id insert would silently
 * REPLACE base's row (NEW vendor/include/src/index.ts:93-100). */
export const POLICY_INSERTS: readonly PolicyInsert[] = [
  /* D9, half two. Upstream removed the row from dsh-base (commit 36a4665144,
   * "overlapping file editing interfaces"); the package is still published
   * and pinned in package.json. 0.1.1 mounted it with `maxOutputChars: 16000`
   * (OLD base :384-387), which is now the schema default (NEW packages/fs/
   * tool-str-replace-editor/src/index.ts:514-515), so the insert is
   * configless. Its injects (`tools`, `fs`) are dsh-base rows. */
  { decision: "D9 str_replace_editor", row: { id: "tool-str-replace-editor", name: "@deepseek-ai/dsh-tool-str-replace-editor" } },
  /* D9, half one (an id patch until 0.2.1). dsh-base dropped the `tool-ralph` row
   * at 0.2.1-alpha.3; the package is still published, now standalone
   * (@deepseek-ai/dsh-tool-ralph, upstream `packages/experimental/tool-ralph`),
   * and is declared in package.json, so the face mounts it itself - ralph stays,
   * as the operator decided at 0.2.0 (spec 2026-11-02, B4). Its injects (`tools`,
   * `workflowEngine`, `subagents`, `systemPrompt`; lib/index.js:11-16) are all
   * dsh-base rows (`workflowEngine` is `workflow-ptc`'s, base 0.2.1-rc.5 :400).
   * The config is restated whole: `subagentProvider: spawn` is the package's own
   * default, but `maxRounds: 64` is the value dsh-base's row carried (the
   * standalone default is 256; lib/index.js:19-20). An operator row
   * `{ id: tool-ralph, disabled: true }` still turns it off. */
  {
    decision: "D9 ralph",
    row: { id: "tool-ralph", name: "@deepseek-ai/dsh-tool-ralph", config: { subagentProvider: "spawn", maxRounds: 64 } },
  },
];

/**
 * The policy layer for one composition.
 * @param baseRows - the row ids the BUNDLE layer composes to (boot.ts:
 * `composedRowIds([bundlePatches])`) — what these patches are allowed to target.
 * @param onMissing - told, one line per restoration, when its target row is not
 * in the bundle composition. That is never expected at the pinned dsh-base
 * (tests/policy.test.ts), so it means the base moved under a pin bump: a RENAMED
 * row would otherwise carry its new default past this layer without a word.
 * @returns fresh patch objects, safe to compose and to mutate: every id patch
 * whose row exists, then one insert patch of the missing rows (omitted when
 * none is missing).
 */
export function facePolicyPatches(
  baseRows: ReadonlySet<string>,
  onMissing: (line: string) => void = () => {},
): FacePatchList {
  const out: FacePatchList = [];
  for (const { decision, patch } of POLICY_ID_PATCHES) {
    if (baseRows.has(patch.id)) out.push(structuredClone(patch) as FacePatchList[number]);
    else onMissing(`policy ${decision}: dsh-base composes no "${patch.id}" row, so there is nothing to restore - renamed upstream?`);
  }
  const inserts = POLICY_INSERTS.filter(({ row }) => !baseRows.has(row.id)).map(({ row }) => structuredClone(row));
  if (inserts.length > 0) out.push({ insert: inserts });
  return out;
}
