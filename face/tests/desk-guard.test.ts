// face/tests/desk-guard.test.ts
/** The desk's write guard (src/desk-tools.ts), offline: which calls `deskWriteDecision` judges and what it
 * answers, the root `tools/pre-execute` listener `installDeskWriteGuard` registers, and how `installDesk`
 * carries it. Every context, agent and call here is a fake. The path arguments are the ones the installed
 * dsh 0.2.0-rc.2 tools take - tests/desk-smoke.test.ts reads them off a real tree's schemas - and that a real
 * tree denies a desk turn's write of GRAVIT.md, and nobody else's, is the smokes' to prove. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DESK_PRESET, FENCE_NAMES, type FenceName } from "../src/desk-names.ts";
import { DESK_ALLOW } from "../src/desk-preset.ts";
import { installDesk } from "../src/desk.ts";
import {
  DESK_WRITE_PATH_ARGS, DESK_WRITE_TOOLS, deskWriteDecision, installDeskWriteGuard,
  type DeskGuardExecution, type DeskPreDecision, type DeskWriteGuardCtxLike,
} from "../src/desk-tools.ts";
import type { QuotePayload } from "../src/quote-types.ts";
import { recorder } from "./route-recorder.ts";

/** The desk session's cwd, as src/desk-session.ts `deskJournalDir` makes it: no name on it is a fence name. */
const CWD = "/repo/desk/journal";

const denied = (name: FenceName) => ({ kind: "deny", reason: `the desk never writes ${name}: it would steer every desk turn after it` });
const UNCHECKED = { kind: "deny", reason: "the desk could not check this write's path; nothing was written" };

/** A well-formed call's arguments to `tool`, its path argument `arg` set to `path`: only the path varies. */
function argsFor(tool: string, arg: string, path: unknown): Record<string, unknown> {
  const rest: Record<string, Record<string, unknown>> = {
    write: { content: "x\n" },
    edit: { old_string: "a", new_string: "b" },
    str_replace_editor: { command: "create", file_text: "x\n" },
  };
  return { ...rest[tool], [arg]: path };
}

/** Every (tool, path argument) pair the guard reads. */
const PATH_ARGS: readonly (readonly [string, string])[] = DESK_WRITE_TOOLS.flatMap((tool) => DESK_WRITE_PATH_ARGS[tool].map((arg) => [tool, arg] as const));
/** The tests that loop over {@link PATH_ARGS} first make sure it holds the three pairs, so none passes on an empty loop. */
const assertThreePairs = (): void => assert.deepEqual(PATH_ARGS, [["write", "file_path"], ["edit", "file_path"], ["str_replace_editor", "path"]]);

test("DESK_WRITE_TOOLS are DESK_ALLOW's writers, each with the path arguments the installed dsh tools take", () => {
  assert.deepEqual([...DESK_WRITE_TOOLS], ["write", "edit", "str_replace_editor"]);
  assert.ok(Object.isFrozen(DESK_WRITE_TOOLS));
  /* dsh-tool-fs: `write` and `edit` take `file_path`; dsh-tool-str-replace-editor takes `path`, for every command. */
  assert.deepEqual(DESK_WRITE_PATH_ARGS, { write: ["file_path"], edit: ["file_path"], str_replace_editor: ["path"] });
  assert.ok(Object.isFrozen(DESK_WRITE_PATH_ARGS) && Object.values(DESK_WRITE_PATH_ARGS).every((args) => Object.isFrozen(args)));
  for (const tool of DESK_WRITE_TOOLS) assert.ok(DESK_ALLOW.includes(tool), `${tool} is one of the desk's tools`);
  /* The tripwire: every other name the desk may call writes no file. A name added to DESK_ALLOW lands here, to be
   * judged a reader or added to DESK_WRITE_TOOLS before it reaches an unattended desk turn. */
  assert.deepEqual(DESK_ALLOW.filter((name) => !(DESK_WRITE_TOOLS as readonly string[]).includes(name)), [
    "read", "read_image", "glob", "grep", "skill", "web_search", "todo_write",
    "mcp__*__earnings", "mcp__*__daily_bars", "mcp__*__calendar", "mcp__*__corp_actions",
  ]);
});

test("each write tool is denied for every fence name at any depth, case-folded", () => {
  /* The brief's six, relative to the journal and absolute. */
  const named: readonly (readonly [string, FenceName])[] = [
    ["GRAVIT.md", "GRAVIT.md"],
    ["notes/gravit.md", "GRAVIT.md"],
    [".git/config", ".git"],
    ["a/.dsh/skills/x/SKILL.md", ".dsh"],
    [".agents", ".agents"],
    ["GRAVIT.local.md", "GRAVIT.local.md"],
  ];
  /* And the spellings around them: deeper, folded as the volume folds (the long s too), with a trailing slash,
   * above the journal, out of it, through a `..` that leaves the fenced name behind, and at a backslash. */
  const around: readonly (readonly [string, FenceName])[] = [
    ["a/b/c/d/e/f/GRAVIT.md", "GRAVIT.md"],
    ["./Gravit.MD", "GRAVIT.md"],
    ["GRAVIT.md/", "GRAVIT.md"],
    ["gravit.LOCAL.md", "GRAVIT.local.md"],
    ["a/b/c/.GIT/HEAD", ".git"],
    [".dſh/skills/x/SKILL.md", ".dsh"],
    [".AGENTS/skills/x/SKILL.md", ".agents"],
    ["../GRAVIT.md", "GRAVIT.md"],
    ["../../.agents/skills/x/SKILL.md", ".agents"],
    ["notes/../GRAVIT.md", "GRAVIT.md"],
    [".git/../notes.md", ".git"],
    ["~/.dsh/skills/x/SKILL.md", ".dsh"],
    ["/Users/op/.dsh/skills/x/SKILL.md", ".dsh"],
    ["/elsewhere/gravit.md", "GRAVIT.md"],
    ["notes\\GRAVIT.md", "GRAVIT.md"],
  ];
  const cases = [...named, ...named.map(([path, name]) => [join(CWD, path), name] as const), ...around];
  assertThreePairs();
  for (const [tool, arg] of PATH_ARGS) {
    for (const [path, name] of cases) {
      assert.deepEqual(deskWriteDecision(tool, argsFor(tool, arg, path), CWD), denied(name), `${tool} ${arg}: ${JSON.stringify(path)}`);
    }
  }
  /* Each FENCE_NAMES entry, as itself, is named in its own spelling. */
  for (const name of FENCE_NAMES) assert.deepEqual(deskWriteDecision("write", argsFor("write", "file_path", name), CWD), denied(name));
});

test("ordinary journal writes pass", () => {
  const ordinary = [
    "notes/today.md", "GRAVIT.md.bak", "gravitas.md", "reports/x.md",
    "x.GRAVIT.md", "GRAVIT", "GRAVIT.md.d/x.md", ".gitignore", ".github/x.yml", "git/config", "dsh/notes.md", "agents/x.md",
    `${CWD}/notes/today.md`, "../journal/notes.md", "/tmp/desk-scratch.md",
  ];
  assertThreePairs();
  for (const [tool, arg] of PATH_ARGS) {
    for (const path of ordinary) assert.equal(deskWriteDecision(tool, argsFor(tool, arg, path), CWD), null, `${tool} ${arg}: ${path}`);
  }
});

test("a write tool with no string path fails closed", () => {
  assertThreePairs();
  for (const [tool, arg] of PATH_ARGS) {
    const malformed: unknown[] = [
      undefined, null, "GRAVIT.md", 42, [], ["GRAVIT.md"],
      {}, argsFor(tool, arg, undefined), argsFor(tool, arg, null), argsFor(tool, arg, 42), argsFor(tool, arg, ["GRAVIT.md"]),
      argsFor(tool, arg, { toString: () => "notes/today.md" }),
      /* the other tools' path argument, in place of this one's */
      argsFor(tool, arg === "path" ? "file_path" : "path", "notes/today.md"),
    ];
    for (const args of malformed) {
      assert.deepEqual(deskWriteDecision(tool, args, CWD), UNCHECKED, `${tool}: ${JSON.stringify(args) ?? String(args)}`);
    }
  }
  /* And a cwd that is not one: a relative path could not be placed. */
  assert.deepEqual(deskWriteDecision("write", argsFor("write", "file_path", "notes/today.md"), undefined as unknown as string), UNCHECKED);
});

test("non-write tools are never judged", () => {
  const readers = [
    "read", "grep", "glob", "desk_quotes", "desk_state", "read_image", "skill", "web_search", "todo_write", "mcp__alpaca-kit__earnings",
    /* names that only look like a writer's */
    "Write", "WRITE", "write ", "mcp__x__write", "",
  ];
  for (const tool of readers) {
    for (const args of [{ file_path: "GRAVIT.md" }, { path: `${CWD}/.git/config` }, {}, undefined, null, "GRAVIT.md"]) {
      assert.equal(deskWriteDecision(tool, args, CWD), null, `${JSON.stringify(tool)}: ${JSON.stringify(args)}`);
    }
  }
});

type GuardListener = (exec: DeskGuardExecution, next: () => Promise<DeskPreDecision>) => Promise<DeskPreDecision>;

/** A root context as the guard and the desk tools see it: `on` records each event's listeners and the options
 * each came with; the preset registry reads a fake agent's preset off its context, counting the reads, and
 * throws `presetError` when one is given. */
function fakeRoot(options: { presetError?: Error } = {}) {
  const preExecute: GuardListener[] = [];
  const agentCreated: unknown[] = [];
  const registeredWith: unknown[] = [];
  let presetReads = 0;
  const ctx: DeskWriteGuardCtxLike = {
    on(name: string, listener: (...args: never[]) => unknown, opts?: { prepend?: boolean }) {
      const list: unknown[] = name === "tools/pre-execute" ? preExecute : name === "agent/created" ? agentCreated : assert.fail(`no listener on ${name}`);
      list.push(listener);
      if (name === "tools/pre-execute") registeredWith.push(opts);
      return () => {
        const at = list.indexOf(listener);
        if (at >= 0) list.splice(at, 1);
        return at >= 0;
      };
    },
    agents: { list: () => [] },
    agentPresets: {
      composedPreset(agentCtx) {
        presetReads += 1;
        if (options.presetError !== undefined) throw options.presetError;
        return (agentCtx as { preset?: string }).preset;
      },
    },
  };
  return { ctx, preExecute, agentCreated, registeredWith, presetReads: () => presetReads };
}

/** An agent joined to `preset` (none when `undefined`) whose session's header is `header` - by default, one
 * whose cwd is the journal. */
const agentOn = (preset: string | undefined, header: { cwd?: unknown } = { cwd: CWD }) => ({ id: `agent-${preset ?? "none"}`, ctx: { preset }, session: { header } });

const ALLOW: DeskPreDecision = { kind: "allow" };

/** Run `listener` on `exec` with a `next` that allows; what it answered and how often it handed the call on. */
async function judged(listener: GuardListener, exec: DeskGuardExecution): Promise<{ decision: DeskPreDecision; nexts: number }> {
  let nexts = 0;
  const decision = await listener(exec, async () => { nexts += 1; return ALLOW; });
  return { decision, nexts };
}

test("the listener judges only gravit-desk agents and never throws", async () => {
  const root = fakeRoot();
  const lines: string[] = [];
  const dispose = installDeskWriteGuard(root.ctx, { log: (line) => lines.push(line) });
  assert.equal(root.preExecute.length, 1, "one root tools/pre-execute listener");
  assert.deepEqual(root.registeredWith, [{ prepend: true }], "registered in front, as Gate 2's is");
  const listener = root.preExecute[0];
  const write = (file_path: unknown, agent?: object): DeskGuardExecution => ({ name: "write", arguments: { file_path, content: "x\n" }, ...(agent === undefined ? {} : { agent }) }) as DeskGuardExecution;

  /* Nobody else's call is judged: Gravit's, a bot's, an agent with no preset, a call with no agent. */
  for (const agent of [agentOn("gravit"), agentOn("drill-bull"), agentOn(undefined), undefined]) {
    const { decision, nexts } = await judged(listener, write("GRAVIT.md", agent));
    assert.equal(decision, ALLOW, `${agent?.id ?? "no agent"}: the call is handed on, unjudged`);
    assert.equal(nexts, 1);
  }

  /* The desk's write of a fence name is denied, and nothing behind the guard runs. */
  const desk = agentOn(DESK_PRESET);
  assert.deepEqual(await judged(listener, write("GRAVIT.md", desk)), { decision: denied("GRAVIT.md"), nexts: 0 });
  assert.deepEqual(await judged(listener, { name: "str_replace_editor", arguments: { command: "create", path: `${CWD}/.git/config`, file_text: "x" }, agent: desk } as DeskGuardExecution),
    { decision: denied(".git"), nexts: 0 });
  assert.deepEqual(await judged(listener, { name: "edit", arguments: { file_path: "../../.agents/skills/x/SKILL.md", old_string: "a", new_string: "b" }, agent: desk } as DeskGuardExecution),
    { decision: denied(".agents"), nexts: 0 });
  /* Its ordinary write is handed on; so is its read of anything - and a reader never costs a registry read. */
  assert.deepEqual(await judged(listener, write("notes/today.md", desk)), { decision: ALLOW, nexts: 1 });
  const reads = root.presetReads();
  assert.deepEqual(await judged(listener, { name: "read", arguments: { file_path: "GRAVIT.md" }, agent: desk } as DeskGuardExecution), { decision: ALLOW, nexts: 1 });
  assert.equal(root.presetReads(), reads, "a tool that writes nothing never asks the preset registry");
  /* The desk's write with no path is the model's malformed call: denied, closed, and no line - nothing failed. */
  assert.deepEqual(await judged(listener, write(undefined, desk)), { decision: UNCHECKED, nexts: 0 });
  assert.deepEqual(lines, []);

  /* A session with no cwd, or one that cannot be read, is the face's failure: closed, and one line each. */
  assert.deepEqual(await judged(listener, write("notes/today.md", agentOn(DESK_PRESET, {}))), { decision: UNCHECKED, nexts: 0 });
  const unreadable = { id: "agent-unreadable", ctx: { preset: DESK_PRESET }, get session(): never { throw new Error("the session is gone"); } };
  assert.deepEqual(await judged(listener, write("notes/today.md", unreadable)), { decision: UNCHECKED, nexts: 0 });
  assert.equal(lines.length, 2);
  for (const line of lines) assert.match(line, /^gravit-face: desk: /);
  assert.match(lines[1], /the session is gone/);

  /* A registry that throws cannot say whose write it is: denied, closed, with one line - but still no reader is judged. */
  const broken = fakeRoot({ presetError: new Error("the registry is gone") });
  const brokenLines: string[] = [];
  installDeskWriteGuard(broken.ctx, { log: (line) => brokenLines.push(line) });
  assert.deepEqual(await judged(broken.preExecute[0], write("notes/today.md", agentOn("gravit"))), { decision: UNCHECKED, nexts: 0 });
  assert.equal(brokenLines.length, 1);
  assert.match(brokenLines[0], /^gravit-face: desk: .*the registry is gone/);
  assert.deepEqual(await judged(broken.preExecute[0], { name: "grep", arguments: { pattern: "x" }, agent: agentOn("gravit") } as DeskGuardExecution), { decision: ALLOW, nexts: 1 });
  assert.equal(brokenLines.length, 1);

  dispose();
  assert.equal(root.preExecute.length, 0, "the disposer removes the listener");
  dispose();
});

test("installDesk installs the guard with the tools, whatever enabled says, and dispose removes it", async (t) => {
  const homes: string[] = [];
  t.after(async () => { for (const dir of homes) await rm(dir, { recursive: true, force: true }); });
  const home = async (): Promise<string> => {
    const made = await mkdtemp(join(tmpdir(), "face-desk-guard-"));
    homes.push(made);
    return made;
  };
  const watch = { setInterval: () => 1, clearInterval: () => {} };
  const hub = { snapshot: async (): Promise<QuotePayload> => ({ ok: true, generated_at: "2026-10-21T14:00:00.000Z", quotes: [], providers: [] }) };
  const deskWrite: DeskGuardExecution = { name: "write", arguments: { file_path: "GRAVIT.md", content: "x\n" }, agent: agentOn(DESK_PRESET) } as DeskGuardExecution;
  for (const enabled of [false, true]) {
    const root = fakeRoot();
    const desk = installDesk(recorder(), { home: await home(), enabled, watch, ctx: root.ctx, hub });
    assert.equal(root.preExecute.length, 1, `the guard is installed (enabled: ${enabled})`);
    assert.equal(root.agentCreated.length, 1, `beside the tools' listener (enabled: ${enabled})`);
    assert.deepEqual(await judged(root.preExecute[0], deskWrite), { decision: denied("GRAVIT.md"), nexts: 0 });
    await desk.dispose(0);
    assert.equal(root.preExecute.length, 0, `dispose removes the guard (enabled: ${enabled})`);
    assert.equal(root.agentCreated.length, 0);
  }
  /* Given the context alone, the guard - which needs no hub - is installed, and the tools are not. */
  const root = fakeRoot();
  const desk = installDesk(recorder(), { home: await home(), enabled: false, ctx: root.ctx });
  assert.equal(root.preExecute.length, 1);
  assert.equal(root.agentCreated.length, 0);
  await desk.dispose(0);
  assert.equal(root.preExecute.length, 0);
});
