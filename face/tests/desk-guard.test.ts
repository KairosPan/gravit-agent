// face/tests/desk-guard.test.ts
/** The desk's write guard (src/desk-tools.ts), offline: which calls `deskWriteDecision` judges and what it
 * answers, the root `tools/pre-execute` listener and the `tools.guard` backstop `installDeskWriteGuard`
 * arms, and how `installDesk` carries them. Every context, agent and call here is a fake, and dsh-tools' order
 * of judgment is played by {@link pipeline}. The path arguments are the ones the installed dsh 0.2.0-rc.2
 * tools take - tests/desk-smoke.test.ts reads them off a real tree's schemas, and drives the backstop through
 * the real waterfall - and that a real tree denies a desk turn's write of GRAVIT.md, and nobody else's, is
 * the smokes' to prove. */
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
  type DeskGuardExecution, type DeskGuardToolsLike, type DeskPreDecision, type DeskWriteGuardCtxLike,
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

test("the checkout's own ancestors are never judged: only names below the common ancestor with the cwd, and a relative path's own", () => {
  /* A checkout that sits under a fenced name: its own ancestors are never the desk's to write, so they never count. */
  const under = "/x/.git/repo/desk/journal";
  assertThreePairs();
  for (const [tool, arg] of PATH_ARGS) {
    /* str_replace_editor takes absolute paths only, and an absolute path carries every ancestor of the checkout. */
    const spell = (relative: string): string => (tool === "str_replace_editor" ? join(under, relative) : relative);
    assert.equal(deskWriteDecision(tool, argsFor(tool, arg, spell("notes/a.md")), under), null, `${tool}: notes/a.md`);
    assert.equal(deskWriteDecision(tool, argsFor(tool, arg, join(under, "notes", "a.md")), under), null, `${tool}: the same, absolute`);
    assert.equal(deskWriteDecision(tool, argsFor(tool, arg, "/x/.git/repo/desk/journal/./notes/a.md"), under), null, `${tool}: with a ./`);
    assert.equal(deskWriteDecision(tool, argsFor(tool, arg, "/tmp/desk-scratch.md"), under), null, `${tool}: a temp area`);
    const cases: readonly (readonly [string, FenceName])[] = [
      ["../GRAVIT.md", "GRAVIT.md"],
      ["../../.agents/skills/x/SKILL.md", ".agents"],
      ["/x/.git/repo/desk/GRAVIT.md", "GRAVIT.md"],
      ["/x/.git/repo/.dsh/skills/x/SKILL.md", ".dsh"],
      ["/x/.git/repo/desk/journal/notes/.git/config", ".git"],
      /* a `..` that leaves a fenced name behind still counts below the common ancestor */
      ["/x/.git/repo/desk/journal/.git/../notes.md", ".git"],
      ["~/.dsh/skills/x/SKILL.md", ".dsh"],
      ["~/.agents/skills/x/SKILL.md", ".agents"],
      ["~/.dsh/profiles/face/cordis.patch.yml", ".dsh"],
    ];
    for (const [path, name] of cases) {
      assert.deepEqual(deskWriteDecision(tool, argsFor(tool, arg, path), under), denied(name), `${tool}: ${path}`);
    }
    /* The harness home, as an absolute path beside a checkout in the same home. */
    const home = "/Users/op/work/repo/desk/journal";
    for (const [path, name] of [
      ["/Users/op/.dsh/skills/x/SKILL.md", ".dsh"],
      ["/Users/op/.agents/skills/x/SKILL.md", ".agents"],
      ["/Users/op/.dsh/profiles/face/cordis.patch.yml", ".dsh"],
      ["/Users/op/work/repo/.git/hooks/pre-commit", ".git"],
      ["/Users/op/work/repo/GRAVIT.local.md", "GRAVIT.local.md"],
    ] as const) {
      assert.deepEqual(deskWriteDecision(tool, argsFor(tool, arg, path), home), denied(name), `${tool}: ${path}`);
    }
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

test("str_replace_editor's view passes; every other command is judged, a missing or unknown one too", () => {
  for (const path of [`${CWD}/GRAVIT.md`, "/repo/.git/config", `${CWD}/.agents`]) {
    assert.equal(deskWriteDecision("str_replace_editor", { command: "view", path }, CWD), null, `view ${path} reads`);
  }
  /* view is a read whatever its path says: the tool refuses a path that is none. */
  assert.equal(deskWriteDecision("str_replace_editor", { command: "view" }, CWD), null);
  for (const command of ["create", "str_replace", "insert", "VIEW", "view ", "undo_edit", undefined, null, 42, ["view"]]) {
    assert.deepEqual(deskWriteDecision("str_replace_editor", { command, path: `${CWD}/GRAVIT.md`, file_text: "x" }, CWD), denied("GRAVIT.md"),
      `command ${JSON.stringify(command)} is judged`);
  }
  /* The exemption is str_replace_editor's: write and edit take no command. */
  assert.deepEqual(deskWriteDecision("write", { command: "view", file_path: "GRAVIT.md", content: "x" }, CWD), denied("GRAVIT.md"));
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
type GuardCheck = (exec: DeskGuardExecution) => string | undefined;

/**
 * A root context as the guard and the desk tools see it. `on` records each event's listeners in `prepend`
 * order - in front when asked, as cordis unshifts - and the options each came with. `inject(["tools"], callback)`
 * runs the callback at once with a context whose tools service records every guard in `guards`, owned by that
 * fiber: its `dispose` withdraws them, as cordis unloads a fiber's effects. The preset registry reads a fake
 * agent's preset off its context, counting the reads, and throws `presetError` when one is given.
 */
function fakeRoot(options: { presetError?: unknown } = {}) {
  const preExecute: GuardListener[] = [];
  const agentCreated: unknown[] = [];
  const registeredWith: unknown[] = [];
  const guards: GuardCheck[] = [];
  const injected: unknown[] = [];
  let presetReads = 0;
  const ctx: DeskWriteGuardCtxLike = {
    on(name: string, listener: (...args: never[]) => unknown, opts?: { prepend?: boolean }) {
      const list: unknown[] = name === "tools/pre-execute" ? preExecute : name === "agent/created" ? agentCreated : assert.fail(`no listener on ${name}`);
      if (opts?.prepend === true) list.unshift(listener);
      else list.push(listener);
      if (name === "tools/pre-execute") registeredWith.push(opts);
      return () => {
        const at = list.indexOf(listener);
        if (at >= 0) list.splice(at, 1);
        return at >= 0;
      };
    },
    inject(deps, callback) {
      injected.push(deps);
      const owned: GuardCheck[] = [];
      const tools: DeskGuardToolsLike = {
        guard(check) {
          guards.push(check);
          owned.push(check);
          return () => { guards.splice(guards.indexOf(check), 1); };
        },
      };
      callback({ get: (name: string) => (name === "tools" ? tools : undefined) });
      return {
        dispose: async () => {
          for (const check of owned.splice(0)) {
            const at = guards.indexOf(check);
            if (at >= 0) guards.splice(at, 1);
          }
        },
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
  return { ctx, preExecute, agentCreated, registeredWith, guards, injected, presetReads: () => presetReads };
}

/** An agent whose composition reads as `composed` (none when `undefined`) and whose session's header is `header` -
 * by default the header such an agent is created with: its cwd the journal, its preset `composed`. */
const agentOn = (composed: string | undefined, header: { cwd?: unknown; agentPreset?: unknown } = { cwd: CWD, agentPreset: composed }) =>
  ({ id: `agent-${composed ?? "none"}`, ctx: { preset: composed }, session: { header } });

const ALLOW: DeskPreDecision = { kind: "allow" };

/** Run `listener` on `exec` with a `next` that allows; what it answered and how often it handed the call on. */
async function judged(listener: GuardListener, exec: DeskGuardExecution): Promise<{ decision: DeskPreDecision; nexts: number }> {
  let nexts = 0;
  const decision = await listener(exec, async () => { nexts += 1; return ALLOW; });
  return { decision, nexts };
}

/** A call to `name` with `args` from `agent`. */
const call = (name: string, args: unknown, agent?: object): DeskGuardExecution =>
  ({ name, arguments: args, ...(agent === undefined ? {} : { agent }) }) as DeskGuardExecution;
const write = (file_path: unknown, agent?: object): DeskGuardExecution => call("write", { file_path, content: "x\n" }, agent);

/**
 * dsh-tools' order of judgment for one call, as `prepareExecution` runs it (dsh-tools lib/index.js:3225-3241):
 * the `tools/pre-execute` waterfall, outermost first, each listener free to answer without calling `next`; then,
 * only when the waterfall allowed, every guard, the first reason denying. What was denied, and with what.
 */
async function pipeline(listeners: readonly GuardListener[], guards: readonly GuardCheck[], exec: DeskGuardExecution): Promise<string | undefined> {
  const waiting = [...listeners];
  const next = (): Promise<DeskPreDecision> => (waiting.shift() ?? (async () => ALLOW))(exec, next);
  const gate = await next();
  if (gate.kind === "deny") return gate.reason;
  for (const guard of guards) {
    const reason = guard(exec);
    if (reason !== undefined) return reason;
  }
  return undefined;
}

test("the listener judges only gravit-desk agents and never throws", async () => {
  const root = fakeRoot();
  const lines: string[] = [];
  const dispose = installDeskWriteGuard(root.ctx, { log: (line) => lines.push(line) });
  assert.equal(root.preExecute.length, 1, "one root tools/pre-execute listener");
  assert.deepEqual(root.registeredWith, [{ prepend: true }], "registered in front, as Gate 2's is");
  const listener = root.preExecute[0];

  /* Nobody else's call is judged: Gravit's, a bot's, an agent with no preset, a call with no agent. */
  for (const agent of [agentOn("gravit"), agentOn("drill-bull"), agentOn(undefined), undefined]) {
    const { decision, nexts } = await judged(listener, write("GRAVIT.md", agent));
    assert.equal(decision, ALLOW, `${agent?.id ?? "no agent"}: the call is handed on, unjudged`);
    assert.equal(nexts, 1);
  }

  /* A desk agent is one whose composition reads gravit-desk, or whose session was created as one - either alone
   * will do. Its write of a fence name is denied, and nothing behind the guard runs. */
  const desk = agentOn(DESK_PRESET);
  const desks = [desk, agentOn("gravit", { cwd: CWD, agentPreset: DESK_PRESET }), agentOn(DESK_PRESET, { cwd: CWD, agentPreset: "gravit" })];
  for (const agent of desks) assert.deepEqual(await judged(listener, write("GRAVIT.md", agent)), { decision: denied("GRAVIT.md"), nexts: 0 });
  assert.deepEqual(await judged(listener, call("str_replace_editor", { command: "create", path: `${CWD}/.git/config`, file_text: "x" }, desk)),
    { decision: denied(".git"), nexts: 0 });
  assert.deepEqual(await judged(listener, call("edit", { file_path: "../../.agents/skills/x/SKILL.md", old_string: "a", new_string: "b" }, desk)),
    { decision: denied(".agents"), nexts: 0 });
  /* Its ordinary write is handed on; so is its view and its read of anything - and a reader never costs a registry read. */
  assert.deepEqual(await judged(listener, write("notes/today.md", desk)), { decision: ALLOW, nexts: 1 });
  assert.deepEqual(await judged(listener, call("str_replace_editor", { command: "view", path: `${CWD}/GRAVIT.md` }, desk)), { decision: ALLOW, nexts: 1 });
  const reads = root.presetReads();
  assert.deepEqual(await judged(listener, call("read", { file_path: "GRAVIT.md" }, desk)), { decision: ALLOW, nexts: 1 });
  assert.equal(root.presetReads(), reads, "a tool that writes nothing never asks the preset registry");
  /* The desk's write with no path is the model's malformed call: denied, closed, and no line - nothing failed. */
  assert.deepEqual(await judged(listener, write(undefined, desk)), { decision: UNCHECKED, nexts: 0 });
  assert.deepEqual(lines, []);

  /* A session with no cwd, or one that cannot be read, is the face's failure: closed, and one line each. */
  assert.deepEqual(await judged(listener, write("notes/today.md", agentOn(DESK_PRESET, { agentPreset: DESK_PRESET }))), { decision: UNCHECKED, nexts: 0 });
  const unreadable = { id: "agent-unreadable", ctx: { preset: DESK_PRESET }, get session(): never { throw new Error("the session is gone"); } };
  assert.deepEqual(await judged(listener, write("notes/today.md", unreadable)), { decision: UNCHECKED, nexts: 0 });
  assert.equal(lines.length, 2);
  for (const line of lines) assert.match(line, /^gravit-face: desk: /);
  assert.match(lines[1], /the session is gone/);
  /* Even a call whose line cannot be built, and a log that throws: the denial stands, and nothing rejects. */
  const anonymous = { get id(): never { throw new Error("no id"); }, ctx: {}, get session(): never { throw new Error("no session"); } };
  assert.deepEqual(await judged(listener, write("notes/today.md", anonymous)), { decision: UNCHECKED, nexts: 0 });
  assert.equal(lines.at(-1), "gravit-face: desk: the write guard could not judge a call, and denied it");
  const loud = fakeRoot();
  installDeskWriteGuard(loud.ctx, { log: () => { throw new Error("the log is gone"); } });
  assert.deepEqual(await judged(loud.preExecute[0], write("notes/today.md", unreadable)), { decision: UNCHECKED, nexts: 0 });
  assert.equal(loud.guards[0](write("notes/today.md", unreadable)), UNCHECKED.reason, "the backstop too");
  assert.deepEqual(await judged(loud.preExecute[0], write("notes/today.md", anonymous)), { decision: UNCHECKED, nexts: 0 });

  /* A registry that throws leaves the session's own word: a session created as the desk's fails closed, with one
   * line; Gravit's write goes on, with one line too. */
  const broken = fakeRoot({ presetError: new Error("the registry is gone") });
  const brokenLines: string[] = [];
  installDeskWriteGuard(broken.ctx, { log: (line) => brokenLines.push(line) });
  assert.deepEqual(await judged(broken.preExecute[0], write("notes/today.md", desk)), { decision: UNCHECKED, nexts: 0 });
  assert.equal(brokenLines.length, 1);
  assert.match(brokenLines[0], /^gravit-face: desk: .*the registry is gone/);
  assert.deepEqual(await judged(broken.preExecute[0], write("notes/today.md", agentOn("gravit"))), { decision: ALLOW, nexts: 1 });
  assert.equal(brokenLines.length, 2);
  assert.match(brokenLines[1], /^gravit-face: desk: .*the registry is gone/);
  assert.deepEqual(await judged(broken.preExecute[0], call("grep", { pattern: "x" }, agentOn("gravit"))), { decision: ALLOW, nexts: 1 });
  assert.equal(brokenLines.length, 2, "a reader never reaches the broken registry");
  /* A thrown value that is no Error, whose message cannot even be shown, still leaves Gravit's write going on. */
  const odd = fakeRoot({ presetError: { toString() { throw new Error("unshowable"); } } });
  const oddLines: string[] = [];
  installDeskWriteGuard(odd.ctx, { log: (line) => oddLines.push(line) });
  assert.deepEqual(await judged(odd.preExecute[0], write("notes/today.md", agentOn("gravit"))), { decision: ALLOW, nexts: 1 });
  assert.equal(oddLines.length, 1);

  await dispose();
  assert.equal(root.preExecute.length, 0, "the disposer removes the listener");
  assert.equal(root.guards.length, 0, "and the backstop");
  await dispose();
});

test("the backstop re-judges the call as the waterfall left it, for gravit-desk agents only, and never throws", async () => {
  const root = fakeRoot();
  const lines: string[] = [];
  const dispose = installDeskWriteGuard(root.ctx, { log: (line) => lines.push(line) });
  assert.deepEqual(root.injected, [["tools"]], "armed through inject([\"tools\"]), as Gate 2's guard is");
  assert.equal(root.guards.length, 1, "one tools.guard");
  const backstop = root.guards[0];
  const desk = agentOn(DESK_PRESET);

  assert.equal(backstop(write("GRAVIT.md", desk)), denied("GRAVIT.md").reason);
  assert.equal(backstop(call("str_replace_editor", { command: "insert", path: "/repo/.agents/skills/x/SKILL.md", new_str: "x", insert_line: 1 }, desk)), denied(".agents").reason);
  for (const exec of [write("notes/today.md", desk), write("GRAVIT.md", agentOn("gravit")), write("GRAVIT.md"),
    call("str_replace_editor", { command: "view", path: `${CWD}/GRAVIT.md` }, desk)]) {
    assert.equal(backstop(exec), undefined);
  }
  /* A tool that writes nothing costs a name check and nothing else: no registry read, whatever the call holds. */
  const reads = root.presetReads();
  for (const exec of [call("read", { file_path: "GRAVIT.md" }, desk), call("grep", null, desk), call("glob", undefined)]) assert.equal(backstop(exec), undefined);
  assert.equal(root.presetReads(), reads);
  /* It judges the call as it reaches the guards: a listener behind the guard that swaps the name or the arguments
   * after the guard's listener handed it on cannot borrow that verdict. */
  const swapped = call("read", { file_path: "notes/today.md" }, desk) as { name: string; arguments: unknown };
  const swapper: GuardListener = async (exec, next) => {
    const live = exec as { name: string; arguments: unknown };
    live.name = "write";
    live.arguments = { file_path: "GRAVIT.md", content: "x\n" };
    return next();
  };
  assert.equal(await pipeline([root.preExecute[0], swapper], root.guards, swapped as DeskGuardExecution), denied("GRAVIT.md").reason);
  /* A failure to judge is the could-not-check reason, never a raw error, and one line. */
  const unreadable = { id: "agent-unreadable", ctx: { preset: DESK_PRESET }, get session(): never { throw new Error("the session is gone"); } };
  assert.equal(backstop(write("notes/today.md", unreadable)), UNCHECKED.reason);
  assert.equal(backstop(null as unknown as DeskGuardExecution), undefined, "a call with no name writes nothing");
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^gravit-face: desk: .*the session is gone/);

  await dispose();
  assert.equal(root.guards.length, 0, "the disposer withdraws the backstop");
});

test("a later prepend listener answering allow cannot lift a desk write's deny", async () => {
  const root = fakeRoot();
  const dispose = installDeskWriteGuard(root.ctx, { log: () => {} });
  /* Registered after the guard and in front of it, it answers allow without calling next: the guard's listener
   * never runs. */
  let swallowed = 0;
  const offSwallower = root.ctx.on("tools/pre-execute", async () => { swallowed += 1; return ALLOW; }, { prepend: true });
  assert.equal(root.preExecute.length, 2);
  const deskWrite = write("GRAVIT.md", agentOn(DESK_PRESET));
  /* The control: on the listener alone, the swallower lifts the deny. */
  assert.equal(await pipeline(root.preExecute, [], deskWrite), undefined, "without the backstop, the write would run");
  /* With the backstop, it is denied after all. */
  assert.equal(await pipeline(root.preExecute, root.guards, deskWrite), denied("GRAVIT.md").reason);
  assert.equal(swallowed, 2);
  /* An ordinary desk write, and Gravit's, still go. */
  assert.equal(await pipeline(root.preExecute, root.guards, write("notes/today.md", agentOn(DESK_PRESET))), undefined);
  assert.equal(await pipeline(root.preExecute, root.guards, write("GRAVIT.md", agentOn("gravit"))), undefined);
  offSwallower();
  await dispose();
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
  const deskWrite = write("GRAVIT.md", agentOn(DESK_PRESET));
  for (const enabled of [false, true]) {
    const root = fakeRoot();
    const desk = installDesk(recorder(), { home: await home(), enabled, watch, ctx: root.ctx, hub });
    assert.equal(root.preExecute.length, 1, `the guard's listener is installed (enabled: ${enabled})`);
    assert.equal(root.guards.length, 1, `and its backstop (enabled: ${enabled})`);
    assert.equal(root.agentCreated.length, 1, `beside the tools' listener (enabled: ${enabled})`);
    assert.deepEqual(await judged(root.preExecute[0], deskWrite), { decision: denied("GRAVIT.md"), nexts: 0 });
    assert.equal(root.guards[0](deskWrite), denied("GRAVIT.md").reason);
    await desk.dispose(0);
    assert.equal(root.preExecute.length, 0, `dispose removes the listener (enabled: ${enabled})`);
    assert.equal(root.guards.length, 0, `and the backstop (enabled: ${enabled})`);
    assert.equal(root.agentCreated.length, 0);
  }
  /* Given the context alone, the guard - which needs no hub - is installed, and the tools are not. */
  const root = fakeRoot();
  const desk = installDesk(recorder(), { home: await home(), enabled: false, ctx: root.ctx });
  assert.equal(root.preExecute.length, 1);
  assert.equal(root.guards.length, 1);
  assert.equal(root.agentCreated.length, 0);
  await desk.dispose(0);
  assert.equal(root.preExecute.length, 0);
  assert.equal(root.guards.length, 0);
});
