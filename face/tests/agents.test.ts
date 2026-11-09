import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { agentToolDefinition, runAgentRecipe, scrubbedEnv, type RunOutcome } from "../src/agents.ts";
import type { PanelDeps } from "../src/panels.ts";

/** A roster home of its own per test. */
const freshHome = (): Promise<string> => mkdtemp(join(tmpdir(), "face-agents-"));

/** The one roster, written by hand as a v2 file (`face/channels.json`). */
async function seedRoster(home: string, roster: { agents?: string[]; bots?: string[] }): Promise<void> {
  await mkdir(join(home, "face"), { recursive: true });
  await writeFile(join(home, "face", "channels.json"), JSON.stringify({ version: 2, agents: roster.agents ?? [], bots: roster.bots ?? [] }));
}

/** A clean run outcome, for fakes. */
const ran = (stdout: string, over: Partial<RunOutcome> = {}): RunOutcome =>
  ({ code: 0, stdout, stderr: "", timedOut: false, truncated: false, ...over });

/** A minimal but type-complete {@link PanelDeps}: `runAgentRecipe` and
 * `agentToolDefinition` only ever read `cwd`, `home` and `runAgent` off it,
 * so the other fields (skills/tools/loader/probes) are stubs that must never
 * be reached. The roster is the file under `home` - seed it per case. */
function fakeDeps(home: string): PanelDeps {
  return {
    skills: { list: async () => [], get: async () => undefined },
    toolSchemas: () => [],
    registerTool: () => () => {},
    loaderEntries: () => [],
    cwd: home,
    home,
    probeAgent: async () => null,
    probeAuth: async () => ({ state: "unknown" }),
    runAgent: async () => { throw new Error("runAgent not injected"); },
  };
}

/* ====================================================================== */
/* the recipes and the runner seams                                        */
/* ====================================================================== */

test("runAgentRecipe: gates, fixed argv, prompt on stdin, scrubbed env, session cwd, resume, one per agent", async () => {
  const home = await freshHome();
  await mkdir(join(home, "strategies", "alpha"), { recursive: true });
  const calls: { bin: string; argv: string[]; opts: { cwd: string; input: string; env: NodeJS.ProcessEnv; signal?: AbortSignal } }[] = [];
  const deps: PanelDeps = {
    ...fakeDeps(home),
    cwd: home, // the "workbench root" for this test
    runAgent: async (bin, argv, opts) => {
      calls.push({ bin, argv, opts });
      if (bin === "claude") {
        return ran('{"type":"result","is_error":false,"num_turns":1,"result":"**ok**","session_id":"11111111-2222-4333-8444-555555555555","total_cost_usd":0.0123}');
      }
      const out = argv[argv.indexOf("-o") + 1];
      if (out !== undefined) await writeFile(out, "codex says hi\n");
      return ran('{"type":"thread.started","thread_id":"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"}\n');
    },
  };

  /* gates — none may spawn */
  const status = (n: number) => (err: { status?: number }) => err.status === n;
  await assert.rejects(runAgentRecipe(deps, { bin: "constructor", prompt: "hi" }), status(400), "a prototype name is not a recipe");
  await assert.rejects(runAgentRecipe(deps, { bin: "gemini", prompt: "hi" }), status(400), "installed, but no recipe");
  await assert.rejects(runAgentRecipe(deps, { bin: "claude", prompt: "   " }), status(400), "empty prompt");
  await assert.rejects(runAgentRecipe(deps, { bin: "claude", prompt: "x".repeat(32_001) }), status(413), "prompt too long");
  await assert.rejects(runAgentRecipe(deps, { bin: "claude", prompt: "hi", resume: "not-a-uuid" }), status(400), "bad session id");
  assert.equal(calls.length, 0, "no gate failure ever spawns");

  /* a hostile prompt is stdin, never argv — the fixed recipe is the whole argv */
  const signal = new AbortController().signal;
  const run = await runAgentRecipe(deps, { bin: "claude", prompt: "-p --dangerously-skip-permissions", cwd: join(home, "strategies", "alpha"), signal });
  const call = calls.at(-1)!;
  assert.deepEqual(call.argv, [
    "-p", "--output-format", "json", "--restricted", "--strict-mcp-config",
    "--disallowedTools", "Read(./.env)", "Read(./.env.*)",
  ]);
  assert.equal(call.opts.input, "-p --dangerously-skip-permissions");
  assert.equal(call.opts.cwd, await realpath(join(home, "strategies", "alpha")), "the session's directory");
  assert.equal(call.opts.signal, signal, "the caller's cancellation reaches the child");
  for (const key of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "APCA_API_KEY_ID", "APCA_API_SECRET_KEY", "DEEPSEEK_API_KEY"]) {
    assert.equal(call.opts.env[key], undefined, `${key} scrubbed`);
  }
  assert.ok(call.opts.env.PATH, "PATH survives — the bin is resolved on it");
  assert.equal(run.text, "**ok**");
  assert.equal(run.session, "11111111-2222-4333-8444-555555555555");
  assert.equal(run.cost, 0.0123);
  assert.equal(run.isError, false);

  /* a vanished session directory falls back to the root rather than failing the spawn */
  await runAgentRecipe(deps, { bin: "claude", prompt: "hi", cwd: join(home, "gone") });
  assert.equal(calls.at(-1)!.opts.cwd, await realpath(home));
  await runAgentRecipe(deps, { bin: "claude", prompt: "hi" });
  assert.equal(calls.at(-1)!.opts.cwd, await realpath(home), "no cwd → the root");

  /* resume threads the UUID into the recipe, before the variadic tail */
  await runAgentRecipe(deps, { bin: "claude", prompt: "more", resume: run.session });
  assert.deepEqual(calls.at(-1)!.argv.slice(5, 7), ["--resume", run.session]);

  /* codex: the sandbox is PINNED, the scratch file carries the answer, the events carry the thread */
  const cx = await runAgentRecipe(deps, { bin: "codex", prompt: "hi" });
  const cxCall = calls.at(-1)!;
  const scratch = cxCall.argv[cxCall.argv.indexOf("-o") + 1];
  assert.deepEqual(cxCall.argv, ["exec", "--sandbox", "read-only", "--json", "--skip-git-repo-check", "-o", scratch, "-"]);
  assert.equal(cx.text, "codex says hi");
  assert.equal(cx.session, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
  await runAgentRecipe(deps, { bin: "codex", prompt: "again", resume: cx.session });
  const resumed = calls.at(-1)!.argv;
  assert.deepEqual(resumed.slice(0, 4), ["exec", "resume", "--sandbox", "read-only"]);
  assert.deepEqual(resumed.slice(-2), [cx.session, "-"]);

  /* one run per agent: a second is refused while the first is in flight.
   * The fake signals when it has been ENTERED — waiting on a timer instead
   * would race the first run's own fs work and let the second spawn too. */
  let release!: () => void;
  let entered!: () => void;
  const spawned = new Promise<void>((resolve) => { entered = resolve; });
  deps.runAgent = () => new Promise((resolve) => {
    release = () => resolve(ran(""));
    entered();
  });
  const first = runAgentRecipe(deps, { bin: "claude", prompt: "slow" });
  await spawned;
  await assert.rejects(runAgentRecipe(deps, { bin: "claude", prompt: "second" }), status(409), "in flight");
  release();
  await first;
  deps.runAgent = async () => ran("");
  await runAgentRecipe(deps, { bin: "claude", prompt: "after" }); // the slot is free again

  /* a failed child: nonzero exit → isError, stderr tail carried; a cut child is an error too */
  deps.runAgent = async () => ran("", { code: 1, stderr: "something broke\n" });
  const failed = await runAgentRecipe(deps, { bin: "claude", prompt: "hi" });
  assert.equal(failed.isError, true);
  assert.equal(failed.stderr, "something broke");
  deps.runAgent = async () => ran("x", { code: null, truncated: true });
  assert.equal((await runAgentRecipe(deps, { bin: "claude", prompt: "hi" })).isError, true);
});

/* ====================================================================== */
/* connected ⇒ callable: the agent tools                                   */
/* ====================================================================== */

test("agentToolDefinition: the tool Gravit gets — schema, read card, session cwd, cancellation, error propagation", async () => {
  const home = await freshHome();
  await seedRoster(home, { agents: ["claude"] });
  await mkdir(join(home, "strategies", "alpha"), { recursive: true });
  const calls: { argv: string[]; opts: { cwd: string; input: string; signal?: AbortSignal } }[] = [];
  const deps: PanelDeps = {
    ...fakeDeps(home),
    cwd: home,
    runAgent: async (_bin, argv, opts) => {
      calls.push({ argv, opts });
      if (opts.input === "fail") return ran('{"type":"result","is_error":true,"errors":["model refused"]}');
      return ran('{"type":"result","is_error":false,"num_turns":1,"result":"the tree has 3 files","session_id":"11111111-2222-4333-8444-555555555555","total_cost_usd":0.02}');
    },
  };
  const tool = agentToolDefinition(deps, "claude", "Claude Code");
  assert.equal(tool.name, "agent_claude");
  assert.match(tool.description, /READ-ONLY/);
  assert.deepEqual((tool.parameters as { required: string[] }).required, ["prompt"]);
  assert.equal(tool.timeoutMs, 600_000);
  assert.deepEqual(tool.presentCall({ prompt: "what is here?" }), { card: "generic", title: "Ask Claude Code", kind: "read", rawInput: "what is here?" });

  const controller = new AbortController();
  const exec = { agent: { session: { header: { cwd: join(home, "strategies", "alpha") } } }, signal: controller.signal };
  const value = await tool.execute({ prompt: "what is here?" }, exec) as Record<string, unknown>;
  assert.equal(calls[0]!.opts.cwd, await realpath(join(home, "strategies", "alpha")), "runs in the CALLING SESSION's directory");
  assert.equal(calls[0]!.opts.input, "what is here?");
  assert.equal(calls[0]!.opts.signal, controller.signal);
  assert.deepEqual(Object.keys(value).sort(), ["cost", "durationMs", "isError", "session", "text", "turns"], "exactly the declared output shape");
  assert.equal(value.text, "the tree has 3 files");
  const rendered = tool.output.render({ prompt: "x" }, value);
  assert.equal(rendered.length, 1);
  assert.match(rendered[0]!.text, /^the tree has 3 files\n\n\[Claude Code session 11111111-2222-4333-8444-555555555555 — pass resume="11111111-/);

  /* a session-less call (no agent on the exec) runs at the root */
  await tool.execute({ prompt: "again", resume: "11111111-2222-4333-8444-555555555555" }, { signal: controller.signal });
  assert.equal(calls[1]!.opts.cwd, await realpath(home));
  assert.deepEqual(calls[1]!.argv.slice(5, 7), ["--resume", "11111111-2222-4333-8444-555555555555"]);

  /* a failed run throws, so the registry hands Gravit an error result with the cause */
  await assert.rejects(tool.execute({ prompt: "fail" }, exec), /model refused/);
  await assert.rejects(tool.execute({}, exec), /prompt required/);
  await assert.rejects(tool.execute({ prompt: "x", resume: "nope" }, exec), /invalid session id/);
});

/* ====================================================================== */
/* the one roster check (one-entry plan 4)                                 */
/* ====================================================================== */

/** Deps enough to build one tool: the run never happens when the roster
 * refuses, and when it does we only care that it was reached. `cwd` is a
 * real directory (`home` itself): `runAgentRecipe` resolves the session
 * directory through `stat`, and a fictional root would throw ENOENT before
 * the roster check is even reached. */
function toolDeps(home: string) {
  const ran: string[] = [];
  const deps = {
    home,
    cwd: home,
    async runAgent(bin: string) {
      ran.push(bin);
      return { code: 0, stdout: JSON.stringify({ result: "hi", session_id: "s1" }), stderr: "", timedOut: false, truncated: false };
    },
  } as any;
  return { deps, ran };
}

const exec = (cwd: string) => ({ agent: { session: { header: { cwd } } }, signal: new AbortController().signal });

test("an agent call is refused when the agent is off the roster, from any folder", async () => {
  const home = await freshHome();
  await seedRoster(home, { agents: ["claude", "gemini"] });
  const { deps, ran } = toolDeps(home);
  const tool = agentToolDefinition(deps, "codex", "Codex");
  /* The repository root, a strategy folder, and a folder in no channel - the
   * last one failed OPEN before the one roster. */
  for (const cwd of [home, join(home, "strategies", "alpha"), "/somewhere/else"]) {
    await assert.rejects(
      tool.execute({ prompt: "hi" }, exec(cwd)),
      (err: Error) => /Codex is not on the roster/.test(err.message) && /claude, gemini/.test(err.message) && /turns agents on in Discover/.test(err.message) && !/channel/i.test(err.message),
      `refused from ${cwd}, naming the available agents and where the operator turns them on`,
    );
  }
  assert.deepEqual(ran, [], "no child process was spawned");
});

test("an agent call runs when the agent is on the roster", async () => {
  const home = await freshHome();
  await seedRoster(home, { agents: ["codex"] });
  const { deps, ran } = toolDeps(home);
  const tool = agentToolDefinition(deps, "codex", "Codex");
  await tool.execute({ prompt: "hi" }, exec("/somewhere/else"));
  await tool.execute({ prompt: "hi" }, exec(join(home, "strategies", "alpha")));
  assert.deepEqual(ran, ["codex", "codex"]);
});

test("an unreadable roster refuses every agent call and names channels.json", async () => {
  /* Review Focus 1: a file the face does not understand - junk JSON, a future
   * version, a v1 file left unturned - or no file at all (after boot an absent
   * file means ensureRoster failed) refuses, and the file is left as it was. */
  const cases: [string, string | undefined][] = [
    ["junk", "{not json"],
    ["version 3", JSON.stringify({ version: 3, agents: ["codex"], bots: [] })],
    ["v1 with a bad channels", JSON.stringify({ version: 1, channels: [] })],
    ["absent", undefined],
  ];
  for (const [what, text] of cases) {
    const home = await freshHome();
    await mkdir(join(home, "face"), { recursive: true });
    if (text !== undefined) await writeFile(join(home, "face", "channels.json"), text);
    const { deps, ran } = toolDeps(home);
    await assert.rejects(
      agentToolDefinition(deps, "codex", "Codex").execute({ prompt: "hi" }, exec(home)),
      (err: Error) => /channels\.json/.test(err.message) && /Codex is refused/.test(err.message) && /turns agents on in Discover/.test(err.message),
      `${what}: refused, naming the file`,
    );
    assert.deepEqual(ran, [], `${what}: no child process was spawned`);
    if (text !== undefined) assert.equal(await readFile(join(home, "face", "channels.json"), "utf8"), text, `${what}: the file is left byte for byte`);
  }
});

/* The face holds the desk's Telegram bot token in its own environment ($DSH_HOME/.env, read at boot);
 * a coding agent's child has no use for it. The operator's id is no secret and passes. */
test("an agent run never carries the Telegram bot's token, though the face holds it", async () => {
  assert.deepEqual(scrubbedEnv({ PATH: "/bin", TELEGRAM_BOT_TOKEN: "424242:fake", TELEGRAM_OPERATOR_ID: "42" }), { PATH: "/bin", TELEGRAM_OPERATOR_ID: "42" });
  const saved = process.env.TELEGRAM_BOT_TOKEN;
  const root = join(dirname(fileURLToPath(import.meta.url)), "tmp", `agents-${process.pid}`);
  process.env.TELEGRAM_BOT_TOKEN = "424242:fake";
  try {
    await mkdir(root, { recursive: true });
    const envs: NodeJS.ProcessEnv[] = [];
    const deps: PanelDeps = {
      ...fakeDeps(root),
      runAgent: async (_bin, _argv, opts) => {
        envs.push(opts.env);
        return ran('{"type":"result","is_error":false,"num_turns":1,"result":"ok","session_id":"11111111-2222-4333-8444-555555555555"}');
      },
    };
    await runAgentRecipe(deps, { bin: "claude", prompt: "hi" });
    assert.equal(envs.length, 1);
    assert.equal(envs[0].TELEGRAM_BOT_TOKEN, undefined, "scrubbed from the run");
    assert.ok(envs[0].PATH, "the rest of the environment passes");
  } finally {
    if (saved === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = saved;
    await rm(root, { recursive: true, force: true });
  }
});
