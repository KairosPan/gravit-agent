// face/tests/helpers/tool-waterfall.ts
/** A fake booted root and fake agents for the face's tool fences - the desk's tools and guard (src/desk-tools.ts) and the
 * source reader's (src/source-reader.ts) - and one call played through them as dsh's tool registry plays it: the
 * `tools/pre-execute` waterfall, then the guards on an allowed call, then the `tools/execute` waterfall around the body.
 * Every root, agent and body here is a fake; tests/desk-tools.test.ts and tests/source-reader.test.ts drive them. */
import assert from "node:assert/strict";
import type { DeskAgentLike, DeskGuardCtxLike, DeskGuardExecution, DeskToolDefinition } from "../../src/desk-tools.ts";

type Listener = (event: { agent: DeskAgentLike }) => undefined;
/** A `tools/pre-execute` or `tools/execute` listener as the fake root holds one. */
type Waterfall = (exec: DeskGuardExecution, next: () => Promise<unknown>) => Promise<unknown>;

/** A root context with the event the desk tools listen to, the live agents `live`, and a preset registry
 * that reads a fake agent's preset off its context. `presetError` makes the registry throw and `listError`
 * the agent listing. `calls` records `on("agent/created")` and `list` in the order they came; `create` plays
 * one agent's creation through every listener and hands back what each answered. A guard lands apart - its
 * `tools/pre-execute` listener in `guards`, its backstop's `tools.guard`, armed through `inject`, in `backstops`, its
 * `tools/execute` listener in `executes`. {@link dispatch} plays one call through all three as dsh does. */
export function fakeRoot(options: { presetError?: Error; listError?: Error; live?: DeskAgentLike[] } = {}) {
  const listeners: Listener[] = [];
  const guards: Waterfall[] = [];
  const backstops: ((exec: DeskGuardExecution) => string | undefined)[] = [];
  const executes: Waterfall[] = [];
  const calls: string[] = [];
  const ctx: DeskGuardCtxLike = {
    on(name: string, listener: (...args: never[]) => unknown) {
      const list: unknown[] = name === "tools/pre-execute" ? guards : name === "tools/execute" ? executes : listeners;
      if (name !== "tools/pre-execute" && name !== "tools/execute") {
        calls.push("on");
        assert.equal(name, "agent/created");
      }
      list.push(listener);
      return () => {
        const at = list.indexOf(listener);
        if (at >= 0) list.splice(at, 1);
        return at >= 0;
      };
    },
    inject(_deps, callback) {
      const owned: ((exec: DeskGuardExecution) => string | undefined)[] = [];
      callback({ get: () => ({ guard: (check: (exec: DeskGuardExecution) => string | undefined) => { backstops.push(check); owned.push(check); return () => {}; } }) });
      return {
        dispose: async () => {
          for (const check of owned.splice(0)) backstops.splice(backstops.indexOf(check), 1);
        },
      };
    },
    agents: {
      list() {
        calls.push("list");
        if (options.listError !== undefined) throw options.listError;
        return options.live ?? [];
      },
    },
    agentPresets: {
      composedPreset(agentCtx) {
        if (options.presetError !== undefined) throw options.presetError;
        return (agentCtx as { preset?: string }).preset;
      },
    },
  };
  return {
    ctx, listeners, guards, backstops, executes, calls,
    create: (agent: DeskAgentLike): unknown[] => listeners.map((listener) => listener({ agent })),
  };
}

/** One call through the fake root as dsh's registry runs it: the `tools/pre-execute` waterfall (an `allow` when every
 * listener hands on), then the guards - only on an allowed call - and, only when both let it go, the `tools/execute`
 * waterfall around the tool's body. `ran` says whether the body was reached; `result` is what the waterfall answered.
 * `body` is the tool's body (default: one that answers `{ ok: true }`); a body that throws rejects the dispatch. */
export async function dispatch(
  root: ReturnType<typeof fakeRoot>,
  exec: DeskGuardExecution,
  body: () => unknown = () => ({ ok: true }),
): Promise<{ decision: unknown; ran: boolean; result?: unknown }> {
  const pre = [...root.guards];
  const decide = (at: number): Promise<unknown> => at < pre.length ? pre[at](exec, () => decide(at + 1)) : Promise.resolve({ kind: "allow" });
  const decision = await decide(0);
  if ((decision as { kind?: unknown }).kind !== "allow") return { decision, ran: false };
  for (const check of root.backstops) {
    const reason = check(exec);
    if (reason !== undefined) return { decision: { kind: "deny", reason }, ran: false };
  }
  let ran = false;
  const around = [...root.executes];
  const run = (at: number): Promise<unknown> => at < around.length ? around[at](exec, () => run(at + 1)) : (async () => { ran = true; return body(); })();
  const result = await run(0);
  return { decision, ran, result };
}

/** A call of `name` from an agent on `preset`, its session `sessionId` in the journal. */
export function callFrom(preset: string, name: string, args: unknown, sessionId = "desk-session-1"): DeskGuardExecution {
  return {
    name, arguments: args,
    agent: { id: `agent-${sessionId}`, ctx: { preset }, session: { header: { id: sessionId, cwd: "/repo/desk/journal", agentPreset: preset } } },
  };
}

/** An agent joined to `preset` (none when `undefined`), whose own tool layer records what is registered in it - the
 * desk tools, and `web_fetch`, which reaches it through a child plugin `inject`ing `web` (the agent's own context
 * reaches `tools` and `systemPrompt` but not `web`): `injected` records each such plugin's dependencies,
 * `sections` the prompt sections registered through it, and `fetched` the URLs its `web` was asked for. */
export function fakeAgent(id: string, preset: string | undefined) {
  const registered: DeskToolDefinition[] = [];
  const injected: string[][] = [];
  const sections: string[] = [];
  const fetched: string[] = [];
  const tools = {
    register(definition: DeskToolDefinition) { registered.push(definition); return () => {}; },
    get: (name: string) => registered.find((definition) => definition.name === name),
  };
  const web = {
    async fetch(request: { url: string }) {
      fetched.push(request.url);
      return { url: request.url, statusCode: 200, body: { kind: "text", content: "a page" }, truncated: false };
    },
  };
  const agent = {
    id,
    ctx: {
      preset,
      tools,
      inject(deps: ["web"], callback: (layer: never) => void) {
        injected.push(deps);
        const layer = {
          tools, web,
          systemPrompt: { section(section: { name: string }) { sections.push(section.name); return () => {}; }, getSectionOrder: () => 0 },
        };
        callback(layer as never);
        return { dispose: async () => {} };
      },
    },
  };
  return { agent, registered, injected, sections, fetched, names: () => registered.map((definition) => definition.name) };
}
