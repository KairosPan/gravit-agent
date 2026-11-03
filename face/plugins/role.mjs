// face/plugins/role.mjs
/**
 * `gravit-role` - the face's role tool: one row per role in Gravit's composition (src/roles.ts
 * `gravitRows`; `bots/gravit/agent.cordis.yml` is the render's generated mirror), each registering
 * `role_<id>`, which hands a brief to a one-shot child on the role's own preset and returns the
 * child's report as the tool result.
 *
 * WHY THE FACE OWNS IT (D20). At dsh 0.2.1 `@deepseek-ai/dsh-tool-subagent` starts a managed child,
 * returns `started subagent <id>` at once and reports through a parent notice when the child settles
 * (installed dsh-tool-subagent `lib/index.js`, its `execute` and `delivery: "parent"`). A role is a
 * bounded piece of work whose report Gravit checks before it goes on, so this tool is one call, one
 * report: it starts the activation with `delivery: "caller"` - no parent notice, the result handed to
 * the caller alone (dsh-subagent README "Managed delegation") - awaits `result`, and returns the
 * child's closing text. `isConcurrencySafe` is false, so two role calls in one assistant message run
 * one after the other, never side by side. No `timeoutMs`: a role runs as long as it runs, and the
 * operator's Stop cancels it through `exec.signal`.
 *
 * THE SEAM. `ctx.subagents.startActivation({ provider: "spawn", label, request, signal, delivery })`
 * (installed dsh-subagent `lib/types/types.d.ts` `SubagentActivationSpec`), the request built as
 * dsh-tool-subagent builds its own: the brief as one text block, `parent: exec.agent`, the role's
 * preset, its route, and the depth the `subagent` settings resolve. The call's signal cancels only
 * unpublished work; after publication the caller owns cancellation, so an abort of `exec.signal`
 * disposes the activation at once (its result then settles `aborted`), and every other path disposes it
 * in `finally`; either way it is disposed exactly once, `finally` awaiting the abort's disposal rather
 * than starting a second one (roles-smoke's abort case runs that path), so a teardown failure is warned
 * once. It is logged without replacing a result already captured, as dsh-subagent keeps a captured
 * result over a failed cleanup.
 *
 * WHAT THE PRESET SUPPLIES. The persona and the mask are the role's own preset, `role-<id>` (src/roles.ts
 * `rolePresetDefinition`, B1), which the face declares after boot; this row only names it. A role child
 * composes that preset, never Gravit's: the tool registered here sits in Gravit's preset layer, out of a
 * role child's scope chain.
 *
 * WHAT THE TOOL CHECKS ITSELF, before any child exists: a calling agent; every `allow` name in the
 * tree's global view (a role whose MCP server has gone is refused naming the missing tools, instead of
 * a child that cannot do its work); the `spawn` provider; and, when the role names a route, that the
 * tree serves it (`llm.resolveCallConfig`, as src/room.ts `selectionFor` checks a bot's), since
 * dsh-subagent never preflights a route and a bad one would fail only inside the created child.
 * WHAT DSH ENFORCES: the depth limit, the preset - resolved when the child is created, so a role
 * called before its preset is declared fails that call, never Gravit's creation - `maxActiveSubagents`,
 * and the route itself when the child's agent options are applied.
 *
 * A child that ends other than `completed` is an error naming the stop reason and the provider's
 * diagnostic; dsh's tool pipeline hands the model `Error: <message>` with `isError`, as it does for
 * the Lunhui rows' refusals.
 */
import { defineTool } from "@deepseek-ai/dsh-tools";

export const name = "gravit-role";
export const inject = ["tools", "subagents", "llm"];

/** A role's tool name, as plugins/gravit.js `ROLE_TOOL` and src/roles.ts `toolNameFor` spell it. */
const ROLE_TOOL = /^role_[a-z0-9_]+$/;
/** A role's preset id: src/bots.ts `ROLE_PRESET_PREFIX` and a role id. The prefix is what the Lunhui
 *  role gate reads (plugins/lunhui/lib/errors.mjs `callerIsRole`). */
const ROLE_PRESET = /^role-[a-z0-9][a-z0-9-]*$/;
/** One `<provider>/<model>` route: src/bots.ts `MODEL_ROUTE_RE`, restated because this file imports
 *  no face module; tests/role-plugin.test.ts pins the two to the same grammar. */
const MODEL_ROUTE = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.:-]*$/;
/** The provider a role child runs on: a fresh child, not a fork of Gravit's history. */
const PROVIDER = "spawn";
/** A completed child with no closing text, in dsh-subagent's own words for its parent notice. */
const NO_CLOSING = "It left no closing message.";

const nonBlank = (value) => typeof value === "string" && value.trim() !== "";
const messageOf = (error) => error instanceof Error ? error.message : String(error);

/** What would fail at mount or call, as a reason; `undefined` when the config is the row
 *  `gravitRows` renders: `{ tool, name, summary, agentPreset, allow, model? }`. */
export function validateRoleConfig(config) {
  if (config === null || typeof config !== "object" || Array.isArray(config)) return "config must be an object";
  const { tool, name: roleName, summary, agentPreset, allow, model } = config;
  if (typeof tool !== "string" || !ROLE_TOOL.test(tool)) return `tool must match ${ROLE_TOOL}`;
  if (!nonBlank(roleName)) return "name must be a non-empty string";
  if (!nonBlank(summary)) return "summary must be a non-empty string";
  if (typeof agentPreset !== "string" || !ROLE_PRESET.test(agentPreset)) return `agentPreset must match ${ROLE_PRESET}`;
  if (!Array.isArray(allow) || allow.length === 0 || allow.some((entry) => !nonBlank(entry))) return "allow must be a non-empty array of tool names";
  if (model !== undefined && (typeof model !== "string" || !MODEL_ROUTE.test(model))) return "model must be one <provider>/<model> route";
  return undefined;
}

/** The child's closing text: the text blocks of its last non-empty assistant message, reasoning left out. */
function reportOf(output) {
  const text = output.filter((block) => block.type === "text" && typeof block.text === "string").map((block) => block.text).join("\n");
  return text.trim() === "" ? NO_CLOSING : text;
}

export function apply(ctx, config) {
  const problem = validateRoleConfig(config);
  if (problem !== undefined) throw new Error(`gravit-role: ${problem}`);
  const { tool, agentPreset } = config;
  const route = config.model === undefined ? undefined : { provider: config.model.split("/")[0], model: config.model.split("/")[1] };
  const refuse = (reason, options) => new Error(`role ${tool}: ${reason}`, options);
  const warnTeardown = (error) => ctx.logger?.warn?.(`role ${tool}: the child's teardown failed: ${messageOf(error)}`);

  const definition = defineTool({
    name: tool,
    description: `${config.summary} Hands a self-contained brief to the ${config.name} role, a one-shot child with its own persona and tools; the call returns the role's report. Never send_message a role child.`,
    parameters: {
      prompt: { type: "string", required: true, description: "The brief: self-contained - the role sees nothing of this conversation." },
      description: { type: "string", description: "A short (3-5 word) label for the children list." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", required: true, const: "report" },
          text: { type: "string", required: true },
        },
      },
      render: (_args, value) => [{ type: "text", text: value.text }],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const parent = exec.agent;
      if (!parent) throw refuse("no calling agent (exec.agent was undefined); no child was created");
      const missing = config.allow.filter((entry) => ctx.tools.get(entry) === undefined);
      if (missing.length > 0) throw refuse(`the tree has no tool ${missing.join(", ")}; no child was created`);
      if (ctx.subagents.getProvider(PROVIDER) === undefined) throw refuse(`the ${PROVIDER} subagent provider is not registered; no child was created`);
      if (route !== undefined) {
        try {
          await ctx.llm.resolveCallConfig(route, exec.signal);
        } catch (error) {
          exec.signal.throwIfAborted();
          throw refuse(`the route ${config.model} is not served: ${messageOf(error)}; no child was created`, { cause: error });
        }
      }
      exec.signal.throwIfAborted();
      const maxDepth = ctx.subagents.resolveMaxDepth(undefined);
      const activation = await ctx.subagents.startActivation({
        provider: PROVIDER,
        label: typeof args.description === "string" && args.description.trim() !== "" ? args.description : config.name,
        request: {
          prompt: [{ type: "text", text: args.prompt }],
          parent,
          agentPreset,
          ...(route === undefined ? {} : { agentOptions: route }),
          ...(maxDepth === undefined ? {} : { maxDepth }),
        },
        signal: exec.signal,
        delivery: "caller",
      });
      /* Published: from here the caller owns cancellation. A signal that fired between publication and
       * this listener never calls it, so that case is disposed here directly. One disposal, shared: the
       * abort starts it and `finally` awaits it, so a teardown failure is warned once. */
      let disposal;
      const dispose = () => (disposal ??= activation.dispose().catch(warnTeardown));
      const onAbort = () => { void dispose(); };
      exec.signal.addEventListener("abort", onAbort, { once: true });
      if (exec.signal.aborted) onAbort();
      try {
        const result = await activation.result;
        if (result.stopReason !== "completed") throw new Error(`role ${tool} ${result.stopReason}: ${result.diagnostic ?? "no detail"}`);
        return { kind: "report", text: reportOf(result.output) };
      } finally {
        exec.signal.removeEventListener("abort", onAbort);
        await dispose();
      }
    },
  });
  ctx.effect(() => ctx.tools.register(definition));
}
