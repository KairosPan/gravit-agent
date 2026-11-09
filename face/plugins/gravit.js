// face/plugins/gravit.js
/**
 * `gravit` - the face-owned plugin Gravit's own preset mounts, and the first
 * row of the composition the face renders for that preset (src/roles.ts
 * `gravitRows`; `bots/gravit/agent.cordis.yml` is the render's generated
 * mirror). It holds what only Gravit is told: the date (`deployment:today`),
 * the list of its roles (`gravit:roles`, from the `roles` config key, which
 * `gravitRows` fills from `roles/`), the research-cycle contract
 * (`gravit:cycle`, from the `cycle` config key, which `composeFace` fills from
 * `dsh/profile/cycle.md` through src/cycle.ts), the run protocols (one
 * section per entry of the `protocols` config key, which `composeFace` fills
 * from `dsh/profile/` through src/protocols.ts: `lunhui:run` and `lunhui:module`),
 * and the desk's contract (`gravit:desk`, from the `desk` config key; THE DESK, below).
 *
 * WHY A DATE. The 2026-10-10 prompt trace found no date anywhere in the
 * assembled prompt, so Gravit could not tell a fresh bar from a stale one or
 * resolve "yesterday" and "this week". `deployment:today` closes that.
 *
 * The text is a FUNCTION, not a string. dsh resolves a section's text at every
 * assembly - `typeof section.text === "function" ? section.text(context) :
 * section.text` (dsh-system-prompt README "Sections carry static or
 * context-resolved text"; `assemble` in the installed lib) - so a session that
 * runs past midnight is told the new day on its next request, and the date is
 * never frozen at the mount. The zone is the process's own, named in the
 * sentence so "today" is never ambiguous; a `TZ` Intl cannot format in (empty,
 * or not a zone name) is rendered in UTC and labelled `(UTC)` - see
 * {@link resolveZone}.
 *
 * This file imports nothing ON PURPOSE, like plugins/bot.js: the rendered
 * composition names it by an absolute `file:` URL (src/roles.ts
 * `GRAVIT_PLUGIN_URL`; the mirror spells the relative path
 * `../../face/plugins/gravit.js`, which `definitionFor` in src/bot-presets.ts
 * rebases to that same URL), and a file URL is all the loader needs.
 *
 * THE ROLE LIST. The `role_<id>` tools are registered by the sibling
 * `plugins/role.mjs` rows, one per role (D20): this section is where Gravit reads
 * what each role is for - a sentence on what a role is, that the call returns
 * the role's report, why that report is a claim to check and that a role child
 * is never messaged, then one line per entry of the `roles` config,
 * `- <tool> — <summary>`. It sits one
 * past dsh's own subagent section (`TOOL_SUBAGENT` + 1), so it reads straight
 * after the delegation tool it extends. A `roles: []` config mounts the section
 * and renders nothing: dsh drops an empty section from the prompt.
 *
 * GATED ON WHAT THE ASSEMBLING SCOPE CAN CALL, AND ON WHO IS ASSEMBLING. A role
 * child composes its own `role-<id>` preset, whose `gravit` row carries no roles,
 * no cycle and no desk (src/roles.ts `rolePresetDefinition`); a fork or a plain
 * `subagent` child still JOINS Gravit's preset, so a scoped section reaches it
 * too, and an allow list removes tools but cannot remove a sentence. The three
 * sections this plugin gates - the role list, the cycle contract and the desk contract -
 * are therefore functions of the assembly context, and each resolves to `""` for
 * a delegated child that is not a fork: the role list and the cycle by
 * `canCall(ctx, context, name) && isRootOrFork(context)`, the desk contract by
 * `isRootOrFork(context)` alone (THE DESK, below).
 * {@link canCall} is the registry lookup dsh-tool-web and dsh-tool-subagent gate
 * their own sections with; {@link isRootOrFork} reads the header
 * (`context.agent.session.header`: no `origin`, or `origin: "subagent"` with
 * `isSeeded`). A `subagent_fork` child - seeded and unrestricted - passes both,
 * so it gets Gravit's text unchanged and the system prompt its inherited history
 * was cached under stays byte-identical. A plain `subagent` spawn, a workflow or
 * a ralph worker is unrestricted too and passes the visibility half, but it
 * inherits no prefix and cannot open a goal (`create_goal` needs a direct human
 * turn on a top-level agent), so the header half blanks each of them for it. A
 * role child gets `""` either way: its own preset registers none of these
 * sections, and its allow list removes the `role_<id>` tools and the goal
 * tools. roles-smoke pins the fork, the spawn and the role child on a real
 * boot. In the role list, a role whose tool never registered (a row that did
 * not mount) is not advertised; the `spawn` provider is the tool's check at
 * call time (plugins/role.mjs). The date is left on for every child.
 *
 * THE CYCLE. `gravit:cycle` carries `dsh/profile/cycle.md` - how to run one
 * research cycle, from the single batched question to the verdict - at
 * `DEPLOYMENT_PERSONA_SUFFIX - 50` (installed: 10150, the suffix being 10200),
 * after every dsh-ordered tool and policy section and just before the persona
 * suffix. Its probe is `create_goal`: the contract is written for the session
 * that opens a goal. The face's cycle contract is withheld from a role child
 * (its allow list removed the goal tools: a role never carries them,
 * src/roles.ts) and from every other delegated child that is not a fork; dsh's
 * global `tool:goal` paragraph still reaches them all, as dsh's other generic
 * tool-policy paragraphs do. The text is the file's, not a template:
 * `interpolate: false`, so a brace in it is literal.
 *
 * THE DESK. `gravit:desk` carries `dsh/profile/desk.md` (src/cycle.ts
 * `readDesk`) - how Gravit behaves on the desk: it informs and never orders -
 * in the cycle's slot, `DEPLOYMENT_PERSONA_SUFFIX - 50`; a preset carries one
 * contract or the other, never both, and {@link validateGravitConfig} refuses a
 * row that carries the two. It has NO tool gate, unlike the role list
 * and the cycle: the contract binds a desk session whatever its allow list
 * leaves it, so the text reads the header alone (`""` for a delegated child
 * that is not a fork) and never looks a tool up. Its text is literal, like the
 * cycle's.
 *
 * THE CONVERSATION. `gravit:router` carries `dsh/profile/router.md` (src/cycle.ts
 * `readRouter`) - how Gravit answers or starts a task in the operator's one
 * conversation - in the same slot, gated as the desk's is, by the header alone.
 * Its config is `{ text, root }`: every `<REPO>` in the text becomes `root`, the
 * repository's absolute path, at mount. It carries no cycle and no desk, and
 * {@link validateGravitConfig} refuses a row that carries it beside either; the
 * `gravit-router` preset (src/router-preset.ts) mounts it.
 *
 * SCOPED, NOT GLOBAL. `ctx.systemPrompt.section` registers into the CALLING
 * context's scope, the preset revision's standing layer, so each section
 * reaches every session joined to the preset that mounted the row, and nobody
 * else: the `gravit` preset (and its `kairos` alias, which declares the same
 * rows), or the `gravit-desk` preset (src/desk-preset.ts), whose row carries
 * the desk's contract alone - so Gravit's sessions never read `gravit:desk`,
 * and a desk session never reads the role list or the cycle. A bot is its own
 * preset and sees none of them. tests/bots-smoke.test.ts pins Gravit's half
 * and a bot's on a real boot.
 *
 * It masks nothing. `inject` names `tools` only to READ the registry's view of
 * the assembling scope; this plugin never registers or restricts a tool: the
 * `role_<id>` tools come from the sibling rows (bots-smoke S3 pins the roster).
 *
 * THE PROTOCOLS. Each entry of `protocols` - `{ name, probe, text }` - is a
 * section named `name` at `DEPLOYMENT_PERSONA_SUFFIX - 60 + index` (its index
 * in the list), just before the cycle, gated as the cycle is but on its own
 * probe: `isRootOrFork(context) && canCall(ctx, context, probe)`. Two ship:
 * `lunhui:run` (`dsh/profile/lunhui-run.md`, modules spec A9, §5.10) and, one
 * step after it, `lunhui:module` (`dsh/profile/lunhui-module.md`, modules-cards
 * spec G4), both probed on `lunhui_read_run`. The Lunhui tools are registered tree-wide, so the probe
 * only says the Lunhui rows mounted: the preset scope keeps the section from a
 * bot, the header from a spawn child, and the allow list (no `lunhui_read_run`)
 * with the header from a role child.
 *
 * `interpolate: false` on every section because their text is prose, not a
 * template: the dsh system prompt is a strict `{{...}}` template with no
 * escape. The date's order is the persona slot's + 1, so the date follows
 * identity - harness identity, the persona prefix, then the date - and
 * precedes every centrally ordered policy and tool section.
 */
export const name = "gravit";
export const inject = ["systemPrompt", "tools"];

/** The date section. Its own name: it shadows nothing, and nothing shadows it. */
export const TODAY_SECTION = "deployment:today";

/** The role list. Registered only when the config carries `roles`; its own name,
 *  like the date's. */
export const ROLES_SECTION = "gravit:roles";

/** The research-cycle contract. Registered only when the config carries `cycle`; its
 *  own name, like the date's. */
export const CYCLE_SECTION = "gravit:cycle";

/** The desk's contract. Registered only when the config carries `desk`; its own
 *  name, like the date's. */
export const DESK_SECTION = "gravit:desk";

/** The conversation's contract. Registered only when the config carries `router`; its own
 *  name, like the date's. */
export const ROUTER_SECTION = "gravit:router";
/** The run protocol's section name. src/protocols.ts `LUNHUI_RUN_SECTION` hands it in the config;
 *  this file imports nothing, so it is spelled here too, and tests/protocols.test.ts pins the two
 *  equal. */
export const LUNHUI_RUN_SECTION = "lunhui:run";

/** The module protocol's section name, spelled here as the run protocol's is; src/protocols.ts
 *  `LUNHUI_MODULE_SECTION` hands it in the config and tests/protocols.test.ts pins the two equal. */
export const LUNHUI_MODULE_SECTION = "lunhui:module";

/** A protocol's section name: a namespace, a colon, a dashed name. */
const PROTOCOL_NAME = /^[a-z]+:[a-z-]+$/;

/** A probe: a tool name as dsh registers one. */
const TOOL_NAME = /^[a-z][a-z0-9_]*$/;

/** What a role is, said once above the list. The list's lines follow it. */
const ROLES_INTRO = "Roles. One-shot delegates on your team, each with its own persona and tools; call one by its tool name with a self-contained brief - the call returns the role's report, which you treat as a claim to check, never a result to copy; never send_message a role child. Every report carries four headings: status, what was measured, paths, limits.";

/** A role's tool name: the `role_` prefix keeps the roster's role tools apart
 *  from every host and MCP tool. */
const ROLE_TOOL = /^role_[a-z0-9_]+$/;

/** What would fail at mount or render, as a reason; `undefined` when the config
 *  is valid. `{}` is valid (no roles, no cycle, no protocols, no desk); the row in
 *  Gravit's own preset carries `roles`, `cycle` and `protocols`, the desk's row
 *  (src/desk-preset.ts) `desk` alone. Each is an optional key, checked here when
 *  present so a malformed value refuses the mount, loudly, instead of loading a
 *  silently dead config - and `cycle` and `desk` exclude each other: a preset
 *  carries one contract or the other. */
export function validateGravitConfig(config) {
  if (config === null || typeof config !== "object" || Array.isArray(config)) return "config must be an object";
  const { cycle, desk, router, roles, protocols } = config;
  if (cycle !== undefined && (typeof cycle !== "string" || cycle.trim() === "")) return "cycle must be a non-empty string";
  if (desk !== undefined && (typeof desk !== "string" || desk.trim() === "")) return "desk must be a non-empty string";
  if (cycle !== undefined && desk !== undefined) return "a preset carries the cycle contract or the desk contract, not both";
  if (router !== undefined) {
    if (router === null || typeof router !== "object" || Array.isArray(router)
      || typeof router.text !== "string" || router.text.trim() === ""
      || typeof router.root !== "string" || router.root.trim() === "") return "router must be { text, root }, both non-empty strings";
    if (cycle !== undefined || desk !== undefined) return "a preset carries the router contract alone, not the cycle's or the desk's";
  }
  if (roles !== undefined) {
    if (!Array.isArray(roles)) return "roles must be an array of { tool, summary }";
    for (const [index, role] of roles.entries()) {
      if (role === null || typeof role !== "object" || Array.isArray(role)) return `roles[${index}] must be an object with tool and summary`;
      if (typeof role.tool !== "string" || !ROLE_TOOL.test(role.tool)) return `roles[${index}].tool must match ${ROLE_TOOL}`;
      if (typeof role.summary !== "string" || role.summary.trim() === "") return `roles[${index}].summary must be a non-empty string`;
    }
  }
  if (protocols !== undefined) {
    if (!Array.isArray(protocols)) return "protocols must be an array of { name, probe, text }";
    const seen = new Set();
    for (const [index, protocol] of protocols.entries()) {
      if (protocol === null || typeof protocol !== "object" || Array.isArray(protocol)) return `protocols[${index}] must be an object with name, probe and text`;
      if (typeof protocol.name !== "string" || !PROTOCOL_NAME.test(protocol.name)) return `protocols[${index}].name must match ${PROTOCOL_NAME}`;
      if ([TODAY_SECTION, ROLES_SECTION, CYCLE_SECTION, DESK_SECTION, ROUTER_SECTION].includes(protocol.name)) return `protocols[${index}].name ${protocol.name} is one of this plugin's own sections`;
      if (seen.has(protocol.name)) return `protocols[${index}].name ${protocol.name} is given twice`;
      seen.add(protocol.name);
      if (typeof protocol.probe !== "string" || !TOOL_NAME.test(protocol.probe)) return `protocols[${index}].probe must be a tool name matching ${TOOL_NAME}`;
      if (typeof protocol.text !== "string" || protocol.text.trim() === "") return `protocols[${index}].text must be a non-empty string`;
    }
  }
  return undefined;
}

/** `Today is YYYY-MM-DD, Weekday (Zone).` - the LOCAL date in `timeZone`, not
 *  UTC's: at 03:00Z on the 18th it is still the 17th in New York. The two
 *  formatters pin their own locales, so the ISO date order and the English
 *  weekday hold whatever locale the process runs in. */
export function todayText(now, timeZone) {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(now);
  return `Today is ${date}, ${weekday} (${timeZone}).`;
}

/** The zone the sentence names: the process's own when Intl will format in it,
 *  `"UTC"` when it will not. `Intl.DateTimeFormat().resolvedOptions().timeZone`
 *  is NOT always usable - measured on Node 22, `TZ=` (empty) resolves to
 *  `"Etc/Unknown"`, which `new Intl.DateTimeFormat(locale, { timeZone })` refuses
 *  with a RangeError, and `TZ=Foo/Bar` or `TZ=:/etc/localtime` resolve to
 *  `undefined`. `apply` never calls the text function, so the mount would
 *  succeed and every Gravit prompt would then fail at assembly; the fallback
 *  keeps the date sentence total. */
export function resolveZone() {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof zone !== "string" || zone === "" || zone === "Etc/Unknown") return "UTC";
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return "UTC";
  }
}

/** Whether the scope whose prompt is being assembled can call `name`: the
 *  registry's view of that scope resolves it. The lookup is the one dsh-tool-web
 *  and dsh-tool-subagent gate their own sections with -
 *  `ctx.tools.get(name, context.scope) === void 0` - and `get` applies every
 *  restriction on the scope's chain, so a tool a child's allow list removed reads
 *  as absent. `assembleContextFor` sets `scope` to the agent; a context without
 *  one reads the global view, where no preset-scoped tool lives. */
export function canCall(ctx, context, name) {
  return ctx.tools.get(name, context?.scope) !== undefined;
}

/** Whether the session whose prompt is being assembled is one Gravit's own sections are written
 *  for: a root session, or a `subagent_fork` child. Read from the assembly context's
 *  `agent.session.header` (`assembleContextFor` sets `agent` beside `scope`): a delegated child
 *  (`origin: "subagent"`) that is not seeded - a plain `subagent` spawn, a workflow or ralph
 *  worker, a role child - is not one, whatever its scope can call. A context with no agent (the
 *  global view) reads as a root. */
export function isRootOrFork(context) {
  const header = context?.agent?.session?.header;
  return header?.origin !== "subagent" || header?.isSeeded === true;
}

/** The role list: `""` for no roles, else {@link ROLES_INTRO} and one line per
 *  role, `- <tool> — <summary>`. */
export function rolesText(roles) {
  if (roles.length === 0) return "";
  return [ROLES_INTRO, ...roles.map((role) => `- ${role.tool} — ${role.summary}`)].join("\n");
}

export function apply(ctx, config) {
  const problem = validateGravitConfig(config);
  if (problem !== undefined) throw new Error(`gravit: ${problem}`);
  /* The disposer `section` returns is what unregisters it, so unloading the
   * preset revision takes the date out of every prompt with it. */
  ctx.effect(() => ctx.systemPrompt.section({
    name: TODAY_SECTION,
    order: ctx.systemPrompt.getSectionOrder("DEPLOYMENT_PERSONA_PREFIX") + 1,
    interpolate: false,
    text: () => todayText(new Date(), resolveZone()),
  }));
  if (config.roles !== undefined) {
    ctx.effect(() => ctx.systemPrompt.section({
      name: ROLES_SECTION,
      order: ctx.systemPrompt.getSectionOrder("TOOL_SUBAGENT") + 1,
      interpolate: false,
      text: (context) => isRootOrFork(context) ? rolesText(config.roles.filter((role) => canCall(ctx, context, role.tool))) : "",
    }));
  }
  /* Just before the persona suffix, after every dsh-ordered section. `create_goal` is the
   * probe: visible to Gravit and to a fork child (the same text, the same cached prefix),
   * removed from a role child; a spawn, workflow or ralph child sees it but is no fork
   * (nothing). */
  if (config.cycle !== undefined) {
    ctx.effect(() => ctx.systemPrompt.section({
      name: CYCLE_SECTION,
      order: ctx.systemPrompt.getSectionOrder("DEPLOYMENT_PERSONA_SUFFIX") - 50,
      interpolate: false,
      text: (context) => isRootOrFork(context) && canCall(ctx, context, "create_goal") ? config.cycle : "",
    }));
  }
  /* The cycle's slot: a preset carries one contract or the other. No tool gate - the desk's
   * contract binds a desk session whatever its allow list leaves it - only the header: a
   * delegated child that is not a fork is told nothing, as with the cycle. */
  if (config.desk !== undefined) {
    ctx.effect(() => ctx.systemPrompt.section({
      name: DESK_SECTION,
      order: ctx.systemPrompt.getSectionOrder("DEPLOYMENT_PERSONA_SUFFIX") - 50,
      interpolate: false,
      text: (context) => isRootOrFork(context) ? config.desk : "",
    }));
  }
  /* The cycle's slot again, gated as the desk's is - by the header alone. The text names the repository
   * by a `<REPO>` placeholder, which the row's `root` fills, every occurrence, once at mount. */
  if (config.router !== undefined) {
    const text = config.router.text.replaceAll("<REPO>", config.router.root);
    ctx.effect(() => ctx.systemPrompt.section({
      name: ROUTER_SECTION,
      order: ctx.systemPrompt.getSectionOrder("DEPLOYMENT_PERSONA_SUFFIX") - 50,
      interpolate: false,
      text: (context) => isRootOrFork(context) ? text : "",
    }));
  }
  /* Ten before the cycle, in their listed order (the run protocol, then the module protocol, one
   * step after), each on its own probe: they read only where the Lunhui rows mounted, for Gravit
   * and a fork child (the same text, the same cached prefix). */
  for (const [index, protocol] of (config.protocols ?? []).entries()) {
    ctx.effect(() => ctx.systemPrompt.section({
      name: protocol.name,
      order: ctx.systemPrompt.getSectionOrder("DEPLOYMENT_PERSONA_SUFFIX") - 60 + index,
      interpolate: false,
      text: (context) => isRootOrFork(context) && canCall(ctx, context, protocol.probe) ? protocol.text : "",
    }));
  }
}
