// face/tests/desk-guard.test.ts
/** The desk's guard (src/desk-tools.ts), offline: which calls `deskWriteDecision`, `deskReadDecision` and
 * `deskSecretDecision` judge and what they answer, the secrets `deskSecrets` takes, the root `tools/pre-execute`
 * listener and the `tools.guard` backstop `installDeskGuard` arms - judging a desk agent's call for a write, then a
 * read, then a secret - and how `installDesk` carries them. Every context, agent and call here is a fake, and
 * dsh-tools' order of judgment is played by {@link pipeline}. The read decision realpaths on the real volume: paths
 * under roots that do not exist (`/repo`, `/x/repo`), and scratch trees of symlinks under the system's temp
 * directory, itself reached through a symlink on macOS. The path arguments are the ones the installed dsh
 * 0.2.0-rc.2 tools take - tests/desk-smoke.test.ts reads them off a real tree's schemas, and drives the backstop
 * through the real waterfall - and that a real tree denies a desk turn's write of GRAVIT.md, its read of a key file
 * and its call carrying a secret, and nobody else's, is the smokes' to prove. Every secret here is made up. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DESK_PRESET, FENCE_NAMES, type FenceName } from "../src/desk-names.ts";
import { DESK_ALLOW } from "../src/desk-preset.ts";
import { installDesk } from "../src/desk.ts";
import {
  DESK_READ_CWD_TOOLS, DESK_READ_GLOB_ARGS, DESK_READ_PATH_ARGS, DESK_READ_TOOLS, DESK_WRITE_PATH_ARGS, DESK_WRITE_TOOLS,
  deskReadDecision, deskSecretDecision, deskSecrets, deskWriteDecision, installDeskGuard,
  type DeskGuardCtxLike, type DeskGuardExecution, type DeskGuardToolsLike, type DeskPreDecision,
} from "../src/desk-tools.ts";
import type { QuotePayload } from "../src/quote-types.ts";
import { recorder } from "./route-recorder.ts";

/** The repository root the face runs from (main.ts passes `process.cwd()` as `installDesk`'s `root`). */
const REPO = "/repo";
/** The desk session's cwd, as src/desk-session.ts `deskJournalDir` makes it: no name below the root is a fence name. */
const CWD = `${REPO}/desk/journal`;

const denied = (name: FenceName) => ({ kind: "deny", reason: `the desk never writes ${name}: it would steer every desk turn after it` });
const UNCHECKED = { kind: "deny", reason: "the desk could not check this write's path; nothing was written" };
const sitsUnder = (name: FenceName) => ({ kind: "deny", reason: `the desk does not write while its directory sits under ${name}` });

/** The read guard's refusals (src/desk-tools.ts `deskReadDecision`). */
const outside = (path: string) => ({ kind: "deny", reason: `the desk reads only inside the repository; ${path} is outside it` });
const keyRead = (name: string) => ({ kind: "deny", reason: `the desk never reads ${name}: it can hold a key` });
const DOT_FILES = { kind: "deny", reason: "the desk never searches dot-files" };
const READ_UNCHECKED = { kind: "deny", reason: "the desk could not check this read's path; nothing was read" };
/** The secret check's refusals (src/desk-tools.ts `deskSecretDecision`). */
const CARRIES_SECRET = { kind: "deny", reason: "the desk never sends a secret: this call carries one" };
const SECRET_UNCHECKED = { kind: "deny", reason: "the desk could not check this call for a secret; nothing was sent" };
/** A made-up secret: no key anywhere holds this value. */
const SECRET = "made-up-desk-secret-0001";

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

/** A call to each of DESK_READ_TOOLS whose path argument is `path`: the search tools with a pattern no rule refuses,
 * str_replace_editor as a view. */
const readerCalls = (path: unknown): (readonly [string, Record<string, unknown>])[] => [
  ["read", { file_path: path }],
  ["read_image", { file_path: path }],
  ["grep", { pattern: "KEY", path }],
  ["glob", { pattern: "**/*.md", path }],
  ["str_replace_editor", { command: "view", path }],
];

/** A scratch tree under the system's temp directory - reached through a symlink on macOS, `/var` being
 * `/private/var` - with a repository and its journal, removed after the test. */
async function scratch(t: { after(fn: () => Promise<void>): void }, label: string): Promise<{ base: string; root: string; journal: string }> {
  const base = await mkdtemp(join(tmpdir(), `face-desk-guard-${label}-`));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, "repo");
  const journal = join(root, "desk", "journal");
  await mkdir(journal, { recursive: true });
  return { base, root, journal };
}

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

test("DESK_READ_TOOLS are DESK_ALLOW's readers, each with the path argument the installed dsh tools take; the rest name no path", () => {
  assert.deepEqual([...DESK_READ_TOOLS], ["read", "read_image", "grep", "glob", "str_replace_editor"]);
  assert.ok(Object.isFrozen(DESK_READ_TOOLS));
  /* dsh-tool-fs: read and read_image take file_path; dsh-tool-fs-search: grep and glob take path, optional - ripgrep
   * then searches the session's cwd - and hand ripgrep include and pattern as --glob; dsh-tool-str-replace-editor
   * takes path, for every command. */
  assert.deepEqual(DESK_READ_PATH_ARGS, { read: ["file_path"], read_image: ["file_path"], grep: ["path"], glob: ["path"], str_replace_editor: ["path"] });
  assert.ok(Object.isFrozen(DESK_READ_PATH_ARGS) && Object.values(DESK_READ_PATH_ARGS).every((args) => Object.isFrozen(args)));
  assert.deepEqual([...DESK_READ_CWD_TOOLS], ["grep", "glob"]);
  assert.ok(Object.isFrozen(DESK_READ_CWD_TOOLS));
  assert.deepEqual(DESK_READ_GLOB_ARGS, { grep: "include", glob: "pattern" });
  assert.ok(Object.isFrozen(DESK_READ_GLOB_ARGS));
  for (const tool of DESK_READ_TOOLS) assert.ok(DESK_ALLOW.includes(tool), `${tool} is one of the desk's tools`);
  assert.deepEqual(readerCalls("x").map(([tool]) => tool), [...DESK_READ_TOOLS], "readerCalls calls every reader");
  /* The tripwire: every other name the desk may call names no path, and the secret check alone judges it. A name
   * added to DESK_ALLOW lands here, to be weighed before an unattended desk turn calls it. */
  const judged: readonly string[] = [...DESK_WRITE_TOOLS, ...DESK_READ_TOOLS];
  assert.deepEqual(DESK_ALLOW.filter((name) => !judged.includes(name)), [
    "skill", "web_search", "todo_write", "mcp__*__earnings", "mcp__*__daily_bars", "mcp__*__calendar", "mcp__*__corp_actions",
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
   * above the journal, out of the repository, through a `..` that leaves the fenced name behind, and at a
   * backslash. */
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
      assert.deepEqual(deskWriteDecision(tool, argsFor(tool, arg, path), CWD, REPO), denied(name), `${tool} ${arg}: ${JSON.stringify(path)}`);
    }
  }
  /* Each FENCE_NAMES entry, as itself, is named in its own spelling. */
  for (const name of FENCE_NAMES) assert.deepEqual(deskWriteDecision("write", argsFor("write", "file_path", name), CWD, REPO), denied(name));
});

test("ordinary journal writes pass", () => {
  const ordinary = [
    "notes/today.md", "GRAVIT.md.bak", "gravitas.md", "reports/x.md",
    "x.GRAVIT.md", "GRAVIT", "GRAVIT.md.d/x.md", ".gitignore", ".github/x.yml", "git/config", "dsh/notes.md", "agents/x.md",
    `${CWD}/notes/today.md`, "../journal/notes.md", "/tmp/desk-scratch.md",
  ];
  assertThreePairs();
  for (const [tool, arg] of PATH_ARGS) {
    for (const path of ordinary) assert.equal(deskWriteDecision(tool, argsFor(tool, arg, path), CWD, REPO), null, `${tool} ${arg}: ${path}`);
  }
});

test("the repository's own ancestors are never judged: names below the root, a path's names below its common ancestor with it, a relative path's own", () => {
  /* A checkout that sits under a fenced name: the root's ancestors are never the desk's to write, so they never count. */
  const repo = "/x/.git/repo";
  const under = `${repo}/desk/journal`;
  assertThreePairs();
  for (const [tool, arg] of PATH_ARGS) {
    /* str_replace_editor takes absolute paths only, and an absolute path carries every ancestor of the checkout. */
    const spell = (relative: string): string => (tool === "str_replace_editor" ? join(under, relative) : relative);
    assert.equal(deskWriteDecision(tool, argsFor(tool, arg, spell("notes/a.md")), under, repo), null, `${tool}: notes/a.md`);
    assert.equal(deskWriteDecision(tool, argsFor(tool, arg, join(under, "notes", "a.md")), under, repo), null, `${tool}: the same, absolute`);
    assert.equal(deskWriteDecision(tool, argsFor(tool, arg, `${under}/./notes/a.md`), under, repo), null, `${tool}: with a ./`);
    assert.equal(deskWriteDecision(tool, argsFor(tool, arg, `${repo}/strategies/s/notes.md`), under, repo), null, `${tool}: elsewhere in the repository`);
    assert.equal(deskWriteDecision(tool, argsFor(tool, arg, "/tmp/desk-scratch.md"), under, repo), null, `${tool}: a temp area`);
    const cases: readonly (readonly [string, FenceName])[] = [
      ["../GRAVIT.md", "GRAVIT.md"],
      ["../../.agents/skills/x/SKILL.md", ".agents"],
      [`${repo}/desk/GRAVIT.md`, "GRAVIT.md"],
      [`${repo}/.dsh/skills/x/SKILL.md`, ".dsh"],
      [`${repo}/.git/hooks/pre-commit`, ".git"],
      [`${under}/notes/.git/config`, ".git"],
      /* a `..` that leaves a fenced name behind still counts below the root */
      [`${under}/.git/../notes.md`, ".git"],
      ["~/.dsh/skills/x/SKILL.md", ".dsh"],
      ["~/.agents/skills/x/SKILL.md", ".agents"],
      ["~/.dsh/profiles/face/cordis.patch.yml", ".dsh"],
    ];
    for (const [path, name] of cases) {
      assert.deepEqual(deskWriteDecision(tool, argsFor(tool, arg, path), under, repo), denied(name), `${tool}: ${path}`);
    }
    /* The harness home, as an absolute path beside a checkout in the same home: the names below their common
     * ancestor with the root. */
    const home = "/Users/pan/Desktop/self-evolve/evolving-alpha-us";
    for (const [path, name] of [
      ["/Users/pan/.dsh/skills/x/SKILL.md", ".dsh"],
      ["/Users/pan/.agents/skills/x/SKILL.md", ".agents"],
      ["/Users/pan/.dsh/profiles/face/cordis.patch.yml", ".dsh"],
      [`${home}/.git/hooks/pre-commit`, ".git"],
      [`${home}/GRAVIT.local.md`, "GRAVIT.local.md"],
    ] as const) {
      assert.deepEqual(deskWriteDecision(tool, argsFor(tool, arg, path), `${home}/desk/journal`, home), denied(name), `${tool}: ${path}`);
    }
  }
});

test("a desk whose cwd sits under a fence name writes nothing at all; its views and a cwd off the fence still go", () => {
  assertThreePairs();
  const cwds: readonly (readonly [string, string, FenceName])[] = [
    ["/Users/pan/.dsh/desk/run", "/x/repo", ".dsh"],
    ["/Users/pan/.dsh", "/x/repo", ".dsh"],
    ["/Users/pan/.DSH/run", "/x/repo", ".dsh"],
    ["/Users/pan/.agents/work", "/x/repo", ".agents"],
    /* below the root too: a cwd inside a project root or under an instruction file's name */
    ["/x/repo/desk/.git/work", "/x/repo", ".git"],
    ["/x/repo/GRAVIT.md/journal", "/x/repo", "GRAVIT.md"],
  ];
  for (const [cwd, repo, name] of cwds) {
    for (const [tool, arg] of PATH_ARGS) {
      for (const path of [tool === "str_replace_editor" ? `${cwd}/notes/a.md` : "notes/a.md", "/tmp/desk-scratch.md", `${repo}/desk/journal/notes.md`, "GRAVIT.md"]) {
        assert.deepEqual(deskWriteDecision(tool, argsFor(tool, arg, path), cwd, repo), sitsUnder(name), `${tool} from ${cwd}: ${path}`);
      }
    }
    assert.equal(deskWriteDecision("str_replace_editor", { command: "view", path: `${cwd}/notes/a.md` }, cwd, repo), null, `a view from ${cwd} reads`);
    assert.equal(deskWriteDecision("read", { file_path: "notes/a.md" }, cwd, repo), null);
  }
  /* A cwd outside the repository that sits under no fence name writes as any other. */
  assert.equal(deskWriteDecision("write", argsFor("write", "file_path", "notes/a.md"), "/tmp/firing", "/x/repo"), null);
  assert.deepEqual(deskWriteDecision("write", argsFor("write", "file_path", "GRAVIT.md"), "/tmp/firing", "/x/repo"), denied("GRAVIT.md"));
  /* A cwd above the root, or the root itself, sits under nothing of the repository's own. */
  assert.equal(deskWriteDecision("write", argsFor("write", "file_path", "notes/a.md"), "/x/.git/repo", "/x/.git/repo"), null);
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
      assert.deepEqual(deskWriteDecision(tool, args, CWD, REPO), UNCHECKED, `${tool}: ${JSON.stringify(args) ?? String(args)}`);
    }
  }
  /* And a cwd, or a root, that is not one: a path could not be placed, nor judged. */
  assert.deepEqual(deskWriteDecision("write", argsFor("write", "file_path", "notes/today.md"), undefined as unknown as string, REPO), UNCHECKED);
  assert.deepEqual(deskWriteDecision("write", argsFor("write", "file_path", "notes/today.md"), CWD, undefined as unknown as string), UNCHECKED);
});

test("str_replace_editor's view passes the write decision; every other command is judged, a missing or unknown one too", () => {
  for (const path of [`${CWD}/GRAVIT.md`, `${REPO}/.git/config`, `${CWD}/.agents`]) {
    assert.equal(deskWriteDecision("str_replace_editor", { command: "view", path }, CWD, REPO), null, `view ${path} writes nothing`);
  }
  /* view is no write whatever its path says: the read decision judges it (see below). */
  assert.equal(deskWriteDecision("str_replace_editor", { command: "view" }, CWD, REPO), null);
  for (const command of ["create", "str_replace", "insert", "VIEW", "view ", "undo_edit", undefined, null, 42, ["view"]]) {
    assert.deepEqual(deskWriteDecision("str_replace_editor", { command, path: `${CWD}/GRAVIT.md`, file_text: "x" }, CWD, REPO), denied("GRAVIT.md"),
      `command ${JSON.stringify(command)} is judged`);
  }
  /* The exemption is str_replace_editor's: write and edit take no command. */
  assert.deepEqual(deskWriteDecision("write", { command: "view", file_path: "GRAVIT.md", content: "x" }, CWD, REPO), denied("GRAVIT.md"));
});

test("non-write tools are never judged by the write decision", () => {
  const readers = [
    "read", "grep", "glob", "desk_quotes", "desk_state", "read_image", "skill", "web_search", "todo_write", "mcp__alpaca-kit__earnings",
    /* names that only look like a writer's */
    "Write", "WRITE", "write ", "mcp__x__write", "",
  ];
  for (const tool of readers) {
    for (const args of [{ file_path: "GRAVIT.md" }, { path: `${CWD}/.git/config` }, {}, undefined, null, "GRAVIT.md"]) {
      assert.equal(deskWriteDecision(tool, args, CWD, REPO), null, `${JSON.stringify(tool)}: ${JSON.stringify(args)}`);
    }
  }
});

/* ---------- the read decision ---------- */

test("reads outside the repository are denied: the harness home, ~, a way up, another checkout, the volume's root", () => {
  const repo = "/x/repo";
  const cwd = `${repo}/desk/journal`;
  const paths = [
    /* dsh never expands ~ - no shell stands between the model and a tool - but a path spelled from it names the home */
    "~/.dsh/.env", "~/.ssh/id_ed25519", "~", "~/", "~pan/.ssh/id_rsa", "~/Desktop/self-evolve/evolving-alpha-us/strategies/x.md",
    "../../../outside.txt", "../../..", "notes/../../../../x/elsewhere.md",
    "/Users/op/.dsh/.env", "/Users/op/.dsh/.credentials.yaml", "/Users/op/.ssh/id_ed25519", "/Users/op/.config/gh/hosts.yml",
    "/etc/passwd", "/x/repo-other/notes.md", "/x", "/",
  ];
  for (const path of paths) {
    for (const [tool, args] of readerCalls(path)) {
      assert.deepEqual(deskReadDecision(tool, args, cwd, repo), outside(path), `${tool}: ${path}`);
    }
  }
  /* A desk session whose cwd sits outside the repository - a firing elsewhere - searches nothing with no path, and
   * reads nothing relative to it. */
  for (const tool of DESK_READ_CWD_TOOLS) {
    const args = tool === "grep" ? { pattern: "KEY" } : { pattern: "**/*.md" };
    assert.deepEqual(deskReadDecision(tool, args, "/tmp/firing", repo), outside("/tmp/firing"), `${tool} with no path from /tmp/firing`);
    assert.equal(deskReadDecision(tool, args, cwd, repo), null, `${tool} with no path from the journal searches the journal`);
  }
  assert.deepEqual(deskReadDecision("read", { file_path: "notes/a.md" }, "/tmp/firing", repo), outside("notes/a.md"));
});

test("a symlink cannot smuggle a read out of the repository: the volume's own walk is judged, a .. after a link included", async (t) => {
  const { base, root, journal } = await scratch(t, "out");
  await mkdir(join(base, "outside", "sub"), { recursive: true });
  await writeFile(join(base, "outside", "secret.txt"), "made-up\n");
  await symlink(join(base, "outside"), join(journal, "out"));
  await symlink(join(base, "outside", "sub"), join(journal, "deep"));
  await mkdir(join(root, "notes"), { recursive: true });
  await writeFile(join(root, "notes", "today.md"), "today\n");
  for (const path of ["out/secret.txt", "out", `${journal}/out/secret.txt`, "out/missing/deeper.md",
    /* the volume walks the link first and its .. after: <base>/outside/secret.txt, though the spelling's own .. would
     * stay in the journal */
    "deep/../secret.txt"]) {
    for (const [tool, args] of readerCalls(path)) assert.deepEqual(deskReadDecision(tool, args, journal, root), outside(path), `${tool}: ${path}`);
  }
  /* And the other way about: a link whose `..` the volume walks back inside, under a spelling whose own `..` leaves
   * the repository, is judged by the spelling as well - both placements must stay inside. */
  await mkdir(join(root, "a", "b", "c", "d"), { recursive: true });
  await symlink(join(root, "a", "b", "c", "d"), join(journal, "in"));
  for (const [tool, args] of readerCalls("in/../../../../x.md")) {
    assert.deepEqual(deskReadDecision(tool, args, journal, root), outside("in/../../../../x.md"), `${tool}: the spelling leaves the repository`);
  }
  /* The root, the cwd and the paths here are all spelled through the temp directory's own symlink on macOS, and an
   * ordinary read still lands inside: the root is judged by its realpath too. */
  for (const path of ["../../notes/today.md", `${root}/notes/today.md`, "today.md", ".", "in/../../x.md"]) {
    for (const [tool, args] of readerCalls(path)) assert.equal(deskReadDecision(tool, args, journal, root), null, `${tool}: ${path}`);
  }
});

test("key and git names are denied inside the repository, case-folded, as spelled and where a symlink lands", async (t) => {
  const repo = "/x/repo";
  const cwd = `${repo}/desk/journal`;
  const cases: readonly (readonly [string, string])[] = [
    [`${repo}/.env.alpaca`, ".env.alpaca"],
    [`${repo}/face/.ENV`, ".ENV"],
    [`${repo}/.git/config`, ".git"],
    ["notes/.env.local", ".env.local"],
    ["../../.env.deepseek", ".env.deepseek"],
    [".env", ".env"],
    [".Env.Deepseek", ".Env.Deepseek"],
    [".env.", ".env."],
    ["a/.ENV.x/b.md", ".ENV.x"],
    [".GIT/HEAD", ".GIT"],
    [`${repo}/.git`, ".git"],
    [`${repo}/strategies/x/.env`, ".env"],
    /* a `..` that leaves a key name behind still counts, as spelled */
    [".git/../notes.md", ".git"],
  ];
  for (const [path, name] of cases) {
    for (const [tool, args] of readerCalls(path)) assert.deepEqual(deskReadDecision(tool, args, cwd, repo), keyRead(name), `${tool}: ${path}`);
  }
  /* A key file reached through a name that is none: the link's target is judged. And one spelled in another case,
   * which the volume opens all the same. */
  const { root, journal } = await scratch(t, "keys");
  await writeFile(join(root, ".env.alpaca"), "FAKE_KEY=made-up\n");
  await mkdir(join(root, "strategies", "x"), { recursive: true });
  await symlink(join(root, ".env.alpaca"), join(root, "strategies", "x", "cfg"));
  await symlink(join(root, "strategies", "x", "cfg"), join(journal, "cfg-link"));
  for (const path of [join(root, "strategies", "x", "cfg"), "../../strategies/x/cfg", "cfg-link"]) {
    for (const [tool, args] of readerCalls(path)) assert.deepEqual(deskReadDecision(tool, args, journal, root), keyRead(".env.alpaca"), `${tool}: ${path}`);
  }
  assert.deepEqual(deskReadDecision("read", { file_path: join(root, ".ENV.ALPACA") }, journal, root), keyRead(".ENV.ALPACA"));
});

test("ordinary repository reads pass", () => {
  const repo = "/x/repo";
  const cwd = `${repo}/desk/journal`;
  const ordinary = [
    "notes/today.md", "../STANDING.md", `${repo}/strategies/x/status.yaml`, `${repo}/desk/levels.yml`, ".", "..", `${repo}`,
    /* names that only look like a key's */
    ".gitignore", ".github/workflows/x.yml", "notes.env", "env/notes.md", "x.git", ".environment", "GRAVIT.md", "dsh/notes.md",
  ];
  for (const path of ordinary) {
    for (const [tool, args] of readerCalls(path)) assert.equal(deskReadDecision(tool, args, cwd, repo), null, `${tool}: ${path}`);
  }
  /* grep and glob with no path search the journal; grep with no include searches every file there that is not hidden. */
  assert.equal(deskReadDecision("grep", { pattern: "levels" }, cwd, repo), null);
  assert.equal(deskReadDecision("glob", { pattern: "**/*.md" }, cwd, repo), null);
  assert.equal(deskReadDecision("read", { file_path: "notes/today.md", offset: 1, limit: 20 }, cwd, repo), null);
  assert.equal(deskReadDecision("str_replace_editor", { command: "view", path: `${repo}/desk/STANDING.md`, view_range: [1, 5] }, cwd, repo), null);
});

test("dot-file globs are denied: every segment of grep's include, a dot-led segment of glob's pattern", () => {
  const repo = "/x/repo";
  const cwd = `${repo}/desk/journal`;
  /* grep's include whitelists what it matches past ripgrep's hidden-file skip (rg 15.0.0: --glob=*.md searched
   * .hidden.md, --glob=*.alpaca searched .env.alpaca), so any segment led by a dot or a wildcard is denied. */
  for (const include of [".env*", "**/.env", "{.env,x}", "*", "*.md", "**/*.ts", "?env*", "[.]env*", "notes/*.md", "\\.env*", "/.env", "a//.x", "strategies/**/status.yaml"]) {
    assert.deepEqual(deskReadDecision("grep", { pattern: "KEY", include }, cwd, repo), DOT_FILES, `grep include ${JSON.stringify(include)}`);
    assert.deepEqual(deskReadDecision("grep", { pattern: "KEY", include, path: "notes" }, cwd, repo), DOT_FILES, `with a path too: ${include}`);
  }
  for (const include of ["notes*.md", "today.md", "report-*.md", "strategies/x/status.yaml", "\\*literal", "a{.b,c}"]) {
    assert.equal(deskReadDecision("grep", { pattern: "KEY", include }, cwd, repo), null, `grep include ${JSON.stringify(include)}`);
  }
  /* glob lists names, never contents: only a segment led by a dot - an escaped one too - is denied. */
  for (const pattern of [".*", "**/.env*", ".git/**", "notes/.hidden/*", "\\.env", "/.env", ".ENV"]) {
    assert.deepEqual(deskReadDecision("glob", { pattern }, cwd, repo), DOT_FILES, `glob pattern ${JSON.stringify(pattern)}`);
  }
  for (const pattern of ["**/*.md", "*", "*.yaml", "strategies/*/status.yaml", "notes*.md"]) {
    assert.equal(deskReadDecision("glob", { pattern }, cwd, repo), null, `glob pattern ${JSON.stringify(pattern)}`);
  }
  /* A path's refusal comes first. */
  assert.deepEqual(deskReadDecision("grep", { pattern: "KEY", include: ".env*", path: "~/.dsh" }, cwd, repo), outside("~/.dsh"));
});

test("every str_replace_editor command is judged as a read, view included", () => {
  const repo = "/x/repo";
  const cwd = `${repo}/desk/journal`;
  for (const command of ["view", "create", "str_replace", "insert", "VIEW", undefined]) {
    assert.deepEqual(deskReadDecision("str_replace_editor", { command, path: `${repo}/.env.deepseek`, file_text: "x" }, cwd, repo), keyRead(".env.deepseek"),
      `command ${JSON.stringify(command)}`);
    assert.deepEqual(deskReadDecision("str_replace_editor", { command, path: "/Users/op/.ssh/id_rsa" }, cwd, repo), outside("/Users/op/.ssh/id_rsa"));
    assert.equal(deskReadDecision("str_replace_editor", { command, path: `${repo}/desk/STANDING.md` }, cwd, repo), null);
  }
});

test("a read whose path or glob cannot be checked fails closed", async (t) => {
  const repo = "/x/repo";
  const cwd = `${repo}/desk/journal`;
  /* The tools whose path is required: missing, or not a string. */
  for (const tool of ["read", "read_image", "str_replace_editor"]) {
    const arg = DESK_READ_PATH_ARGS[tool as "read"][0];
    for (const args of [undefined, null, "notes.md", 42, [], {}, { [arg]: undefined }, { [arg]: null }, { [arg]: 42 }, { [arg]: ["notes.md"] },
      { [arg]: { toString: () => "notes.md" } }, { [arg === "path" ? "file_path" : "path"]: "notes.md" }]) {
      assert.deepEqual(deskReadDecision(tool, args, cwd, repo), READ_UNCHECKED, `${tool}: ${JSON.stringify(args) ?? String(args)}`);
    }
  }
  /* grep and glob: a path that is there but no string; glob's pattern missing or no string; grep's include no string. */
  for (const tool of DESK_READ_CWD_TOOLS) {
    for (const path of [null, 42, ["notes"]]) {
      assert.deepEqual(deskReadDecision(tool, { pattern: "x", path }, cwd, repo), READ_UNCHECKED, `${tool} path ${JSON.stringify(path)}`);
    }
    assert.deepEqual(deskReadDecision(tool, null, cwd, repo), READ_UNCHECKED);
  }
  for (const args of [{}, { path: "notes" }, { pattern: 42 }, { pattern: null }, { pattern: ["*"] }]) {
    assert.deepEqual(deskReadDecision("glob", args, cwd, repo), READ_UNCHECKED, `glob ${JSON.stringify(args)}`);
  }
  for (const include of [42, null, ["*.md"]]) {
    assert.deepEqual(deskReadDecision("grep", { pattern: "x", include }, cwd, repo), READ_UNCHECKED, `grep include ${JSON.stringify(include)}`);
  }
  /* A cwd, or a root, that is not one. */
  assert.deepEqual(deskReadDecision("read", { file_path: "notes.md" }, undefined as unknown as string, repo), READ_UNCHECKED);
  assert.deepEqual(deskReadDecision("read", { file_path: "notes.md" }, cwd, undefined as unknown as string), READ_UNCHECKED);
  /* A path the volume cannot resolve: a NUL in it, a symlink that loops. */
  assert.deepEqual(deskReadDecision("read", { file_path: "notes/a\u0000b.md" }, cwd, repo), READ_UNCHECKED);
  const { root, journal } = await scratch(t, "loop");
  await symlink(join(journal, "loop"), join(journal, "loop"));
  for (const [tool, args] of readerCalls("loop/x.md")) assert.deepEqual(deskReadDecision(tool, args, journal, root), READ_UNCHECKED, `${tool}: a loop`);
  /* Tools that read nothing are never judged here. */
  for (const tool of ["write", "edit", "web_search", "desk_quotes", "todo_write", "Read", "READ", "read ", "mcp__x__read", ""]) {
    for (const args of [{ file_path: "/Users/op/.dsh/.env" }, { path: `${repo}/.env` }, {}, undefined, null]) {
      assert.equal(deskReadDecision(tool, args, cwd, repo), null, `${JSON.stringify(tool)}: ${JSON.stringify(args)}`);
    }
  }
});

/* ---------- the secret check ---------- */

test("a call carrying a secret is denied whatever the tool; the same call without it goes on", () => {
  const quoted = "made-up\"quoted\\key-5678";
  const secrets = [SECRET, quoted];
  const carrying: readonly unknown[] = [
    { query: `what is ${SECRET}` },
    { symbol: SECRET },
    { symbols: ["NVDA", SECRET] },
    { a: [{ b: { c: `x${SECRET}y` } }] },
    /* JSON escapes a quote and a backslash; the escaped spelling is the one the call carries */
    { query: quoted },
    /* and a URL encodes them */
    { url: `https://example.test/?k=${encodeURIComponent(quoted)}` },
    SECRET,
  ];
  for (const args of carrying) assert.deepEqual(deskSecretDecision(args, secrets), CARRIES_SECRET, JSON.stringify(args));
  const clean: readonly unknown[] = [{ query: "NVDA earnings date" }, { symbol: "NVDA" }, { query: SECRET.slice(0, 12) }, {}, [], undefined, null, 42, "plain"];
  for (const args of clean) assert.equal(deskSecretDecision(args, secrets), null, JSON.stringify(args) ?? String(args));
  /* No secrets, nothing to find; arguments JSON cannot write are no evidence of none. */
  assert.equal(deskSecretDecision({ query: SECRET }, []), null);
  assert.deepEqual(deskSecretDecision({ n: 1n }, secrets), SECRET_UNCHECKED);
});

test("deskSecrets takes the values of KEY, PASSWORD, SECRET and TOKEN names of 8+ characters, trimmed, each once", () => {
  const env: NodeJS.ProcessEnv = {
    APCA_API_KEY_ID: "PKMADEUPKEYID00001",
    APCA_API_SECRET_KEY: "madeUpSecretValue0001",
    TELEGRAM_BOT_TOKEN: "1234:MadeUpBotToken",
    DB_PASSWORD: "made-up-password",
    my_api_key: "made-up-lowercase-name",
    EIGHT_TOKEN: "12345678",
    SHORT_TOKEN: "1234567",
    PADDED_SECRET: "   made-up-padded   ",
    BLANK_KEY: "            ",
    UNSET_KEY: undefined,
    HOME: "/Users/op",
    PATH: "/usr/bin:/bin",
    DUPLICATE_TOKEN: "PKMADEUPKEYID00001",
  };
  assert.deepEqual(deskSecrets(env), [
    "PKMADEUPKEYID00001", "madeUpSecretValue0001", "1234:MadeUpBotToken", "made-up-password", "made-up-lowercase-name", "12345678", "made-up-padded",
  ]);
  assert.deepEqual(deskSecrets({}), []);
});

/* ---------- the guard ---------- */

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
  const ctx: DeskGuardCtxLike = {
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
  const dispose = installDeskGuard(root.ctx, REPO, { log: (line) => lines.push(line), secrets: [SECRET] });
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
  /* A desk session whose cwd sits under a fence name writes nothing; Gravit's session in the same place is no desk's. */
  const homeDesk = agentOn(DESK_PRESET, { cwd: "/Users/pan/.dsh/desk/run", agentPreset: DESK_PRESET });
  assert.deepEqual(await judged(listener, write("notes/today.md", homeDesk)), { decision: sitsUnder(".dsh"), nexts: 0 });
  assert.deepEqual(await judged(listener, write("notes/today.md", agentOn("gravit", { cwd: "/Users/pan/.dsh/desk/run", agentPreset: "gravit" }))),
    { decision: ALLOW, nexts: 1 });
  /* Its ordinary write is handed on, and so are its view of a GRAVIT.md and its read of one: neither reads a key. */
  assert.deepEqual(await judged(listener, write("notes/today.md", desk)), { decision: ALLOW, nexts: 1 });
  assert.deepEqual(await judged(listener, call("str_replace_editor", { command: "view", path: `${CWD}/GRAVIT.md` }, desk)), { decision: ALLOW, nexts: 1 });
  assert.deepEqual(await judged(listener, call("read", { file_path: "GRAVIT.md" }, desk)), { decision: ALLOW, nexts: 1 });
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
  /* A read or a secret-carrying call from such a session fails closed with its own check's reason. */
  assert.deepEqual(await judged(listener, call("read", { file_path: "notes/today.md" }, agentOn(DESK_PRESET, { agentPreset: DESK_PRESET }))),
    { decision: READ_UNCHECKED, nexts: 0 });
  assert.deepEqual(await judged(listener, call("web_search", { query: SECRET }, unreadable)), { decision: SECRET_UNCHECKED, nexts: 0 });
  assert.equal(lines.length, 4);
  /* Even a call whose line cannot be built, and a log that throws: the denial stands, and nothing rejects. */
  const anonymous = { get id(): never { throw new Error("no id"); }, ctx: {}, get session(): never { throw new Error("no session"); } };
  assert.deepEqual(await judged(listener, write("notes/today.md", anonymous)), { decision: UNCHECKED, nexts: 0 });
  assert.equal(lines.at(-1), "gravit-face: desk: the desk guard could not judge a call, and denied it");
  const loud = fakeRoot();
  installDeskGuard(loud.ctx, REPO, { log: () => { throw new Error("the log is gone"); } });
  assert.deepEqual(await judged(loud.preExecute[0], write("notes/today.md", unreadable)), { decision: UNCHECKED, nexts: 0 });
  assert.equal(loud.guards[0](write("notes/today.md", unreadable)), UNCHECKED.reason, "the backstop too");
  assert.deepEqual(await judged(loud.preExecute[0], write("notes/today.md", anonymous)), { decision: UNCHECKED, nexts: 0 });

  /* A registry that throws leaves the session's own word: a session created as the desk's fails closed, with one
   * line - its write, its read and its secret alike, each with its check's reason; Gravit's calls go on, with one
   * line each. */
  const broken = fakeRoot({ presetError: new Error("the registry is gone") });
  const brokenLines: string[] = [];
  installDeskGuard(broken.ctx, REPO, { log: (line) => brokenLines.push(line), secrets: [SECRET] });
  assert.deepEqual(await judged(broken.preExecute[0], write("notes/today.md", desk)), { decision: UNCHECKED, nexts: 0 });
  assert.equal(brokenLines.length, 1);
  assert.match(brokenLines[0], /^gravit-face: desk: .*the registry is gone/);
  assert.deepEqual(await judged(broken.preExecute[0], call("read", { file_path: "notes/today.md" }, desk)), { decision: READ_UNCHECKED, nexts: 0 });
  assert.deepEqual(await judged(broken.preExecute[0], call("web_search", { query: SECRET }, desk)), { decision: SECRET_UNCHECKED, nexts: 0 });
  assert.equal(brokenLines.length, 3);
  assert.deepEqual(await judged(broken.preExecute[0], write("notes/today.md", agentOn("gravit"))), { decision: ALLOW, nexts: 1 });
  assert.equal(brokenLines.length, 4);
  assert.match(brokenLines[3], /^gravit-face: desk: .*the registry is gone/);
  assert.deepEqual(await judged(broken.preExecute[0], call("grep", { pattern: "x" }, agentOn("gravit"))), { decision: ALLOW, nexts: 1 });
  assert.equal(brokenLines.length, 5, "Gravit's read reaches the broken registry as its write does, and goes on with a line");
  assert.deepEqual(await judged(broken.preExecute[0], call("todo_write", { todos: [] }, agentOn("gravit"))), { decision: ALLOW, nexts: 1 });
  assert.equal(brokenLines.length, 5, "a call no check could deny never reaches the broken registry");
  /* A thrown value that is no Error, whose message cannot even be shown, still leaves Gravit's write going on. */
  const odd = fakeRoot({ presetError: { toString() { throw new Error("unshowable"); } } });
  const oddLines: string[] = [];
  installDeskGuard(odd.ctx, REPO, { log: (line) => oddLines.push(line) });
  assert.deepEqual(await judged(odd.preExecute[0], write("notes/today.md", agentOn("gravit"))), { decision: ALLOW, nexts: 1 });
  assert.equal(oddLines.length, 1);

  await dispose();
  assert.equal(root.preExecute.length, 0, "the disposer removes the listener");
  assert.equal(root.guards.length, 0, "and the backstop");
  await dispose();
});

test("the guard judges a desk agent's call in order - its write, its read, its secret - and leaves everyone else's alone", async () => {
  const root = fakeRoot();
  const lines: string[] = [];
  const dispose = installDeskGuard(root.ctx, REPO, { log: (line) => lines.push(line), secrets: [SECRET] });
  const listener = root.preExecute[0];
  const backstop = root.guards[0];
  const desk = agentOn(DESK_PRESET);
  /* Reads: a key file, a dot-file search, a way out of the repository. */
  const reads: readonly (readonly [DeskGuardExecution, unknown])[] = [
    [call("read", { file_path: `${REPO}/.env.alpaca` }, desk), keyRead(".env.alpaca")],
    [call("read_image", { file_path: "../../.git/x.png" }, desk), keyRead(".git")],
    [call("grep", { pattern: "KEY", include: ".env*" }, desk), DOT_FILES],
    [call("glob", { pattern: "**/*.md", path: "~/.dsh" }, desk), outside("~/.dsh")],
    [call("str_replace_editor", { command: "view", path: "/Users/op/.ssh/id_ed25519" }, desk), outside("/Users/op/.ssh/id_ed25519")],
  ];
  /* Secrets, in any tool: the search, a market read, the desk's own tool, a write. */
  const secrets: readonly (readonly [DeskGuardExecution, unknown])[] = [
    [call("web_search", { query: `what is ${SECRET}` }, desk), CARRIES_SECRET],
    [call("mcp__alpaca-kit__daily_bars", { symbol: SECRET }, desk), CARRIES_SECRET],
    [call("desk_quotes", { symbols: [SECRET] }, desk), CARRIES_SECRET],
    [call("write", { file_path: "notes/a.md", content: `key: ${SECRET}` }, desk), CARRIES_SECRET],
    [call("read", { file_path: `notes/${SECRET}.md` }, desk), CARRIES_SECRET],
  ];
  /* The order: a write deny before a read deny before a secret deny. */
  const ordered: readonly (readonly [DeskGuardExecution, unknown])[] = [
    [call("str_replace_editor", { command: "create", path: `${CWD}/GRAVIT.md`, file_text: SECRET }, desk), denied("GRAVIT.md")],
    [call("str_replace_editor", { command: "create", path: `${CWD}/.env.local`, file_text: SECRET }, desk), keyRead(".env.local")],
    [call("str_replace_editor", { command: "create", path: `${CWD}/notes.md`, file_text: SECRET }, desk), CARRIES_SECRET],
  ];
  for (const [exec, decision] of [...reads, ...secrets, ...ordered]) {
    assert.deepEqual(await judged(listener, exec), { decision, nexts: 0 }, `${exec.name} ${JSON.stringify(exec.arguments)}`);
    assert.equal(backstop(exec), (decision as { reason: string }).reason, `the backstop agrees: ${exec.name}`);
  }
  /* The desk's ordinary calls go on. */
  for (const exec of [call("read", { file_path: "notes/today.md" }, desk), call("grep", { pattern: "levels", include: "notes*.md" }, desk),
    call("web_search", { query: "NVDA earnings date" }, desk), call("mcp__alpaca-kit__daily_bars", { symbol: "NVDA" }, desk)]) {
    assert.deepEqual(await judged(listener, exec), { decision: ALLOW, nexts: 1 }, `${exec.name} goes on`);
    assert.equal(backstop(exec), undefined);
  }
  /* Gravit's, a bot's and an agentless call are never judged, whatever they read or carry. */
  for (const agent of [agentOn("gravit"), agentOn("drill-bull"), agentOn(undefined), undefined]) {
    for (const [exec] of [...reads, ...secrets, ...ordered]) {
      const theirs = call(exec.name, exec.arguments, agent);
      assert.deepEqual(await judged(listener, theirs), { decision: ALLOW, nexts: 1 }, `${agent?.id ?? "no agent"}: ${exec.name}`);
      assert.equal(backstop(theirs), undefined);
    }
  }
  assert.deepEqual(lines, [], "nothing failed: no line");
  await dispose();
});

test("a call no check could deny never asks the preset registry", async () => {
  const root = fakeRoot();
  const dispose = installDeskGuard(root.ctx, REPO, { log: () => {}, secrets: [SECRET] });
  const desk = agentOn(DESK_PRESET);
  const before = root.presetReads();
  for (const exec of [call("todo_write", { todos: [] }, desk), call("desk_quotes", { symbols: ["NVDA"] }, desk), call("skill", { name: "x" }, desk),
    call("web_search", { query: "NVDA" }, agentOn("gravit")), call("mcp__alpaca-kit__earnings", {}, agentOn("gravit")), call("desk_state", undefined)]) {
    assert.deepEqual(await judged(root.preExecute[0], exec), { decision: ALLOW, nexts: 1 });
    assert.equal(root.guards[0](exec), undefined);
  }
  assert.equal(root.presetReads(), before, "a name check and a look for a secret, and nothing else");
  /* A write, a read, or a call carrying a secret asks it, from anyone. */
  for (const exec of [write("notes/a.md", agentOn("gravit")), call("read", { file_path: "notes/a.md" }, agentOn("gravit")),
    call("web_search", { query: SECRET }, agentOn("gravit"))]) {
    const reads = root.presetReads();
    assert.deepEqual(await judged(root.preExecute[0], exec), { decision: ALLOW, nexts: 1 });
    assert.equal(root.presetReads(), reads + 1, `${exec.name} asks the registry`);
  }
  await dispose();
});

test("a guard given no repository root denies every desk write and read, says so once, and judges nobody else's", async () => {
  const root = fakeRoot();
  const lines: string[] = [];
  const dispose = installDeskGuard(root.ctx, undefined, { log: (line) => lines.push(line), secrets: [SECRET] });
  assert.equal(lines.length, 1, "one line, at install");
  assert.match(lines[0], /^gravit-face: desk: the desk guard was given no repository root/);
  const desk = agentOn(DESK_PRESET);
  assert.deepEqual(await judged(root.preExecute[0], write("notes/today.md", desk)), { decision: UNCHECKED, nexts: 0 });
  assert.equal(root.guards[0](write("notes/today.md", desk)), UNCHECKED.reason);
  /* A view is a read, and no read can be judged without the root. */
  assert.deepEqual(await judged(root.preExecute[0], call("str_replace_editor", { command: "view", path: `${CWD}/notes/today.md` }, desk)),
    { decision: READ_UNCHECKED, nexts: 0 });
  assert.deepEqual(await judged(root.preExecute[0], call("grep", { pattern: "x" }, desk)), { decision: READ_UNCHECKED, nexts: 0 });
  /* The secret check needs no root. */
  assert.deepEqual(await judged(root.preExecute[0], call("web_search", { query: SECRET }, desk)), { decision: CARRIES_SECRET, nexts: 0 });
  assert.deepEqual(await judged(root.preExecute[0], call("web_search", { query: "NVDA" }, desk)), { decision: ALLOW, nexts: 1 });
  assert.deepEqual(await judged(root.preExecute[0], write("notes/today.md", agentOn("gravit"))), { decision: ALLOW, nexts: 1 });
  assert.deepEqual(await judged(root.preExecute[0], call("read", { file_path: ".env" }, agentOn("gravit"))), { decision: ALLOW, nexts: 1 });
  assert.equal(lines.length, 1, "and no line per call");
  await dispose();
});

test("the backstop re-judges the call as the waterfall left it, for gravit-desk agents only, and never throws", async () => {
  const root = fakeRoot();
  const lines: string[] = [];
  const dispose = installDeskGuard(root.ctx, REPO, { log: (line) => lines.push(line) });
  assert.deepEqual(root.injected, [["tools"]], "armed through inject([\"tools\"]), as Gate 2's guard is");
  assert.equal(root.guards.length, 1, "one tools.guard");
  const backstop = root.guards[0];
  const desk = agentOn(DESK_PRESET);

  assert.equal(backstop(write("GRAVIT.md", desk)), denied("GRAVIT.md").reason);
  assert.equal(backstop(call("str_replace_editor", { command: "insert", path: `${REPO}/.agents/skills/x/SKILL.md`, new_str: "x", insert_line: 1 }, desk)), denied(".agents").reason);
  assert.equal(backstop(write("notes/today.md", agentOn(DESK_PRESET, { cwd: "/Users/pan/.dsh", agentPreset: DESK_PRESET }))), sitsUnder(".dsh").reason);
  for (const exec of [write("notes/today.md", desk), write("GRAVIT.md", agentOn("gravit")), write("GRAVIT.md"),
    call("str_replace_editor", { command: "view", path: `${CWD}/GRAVIT.md` }, desk)]) {
    assert.equal(backstop(exec), undefined);
  }
  /* It judges reads too: a desk read of a key file, a malformed desk search; a call with no agent is nobody's. */
  assert.equal(backstop(call("read", { file_path: `${REPO}/.env.alpaca` }, desk)), keyRead(".env.alpaca").reason);
  assert.equal(backstop(call("grep", null, desk)), READ_UNCHECKED.reason);
  assert.equal(backstop(call("glob", undefined)), undefined);
  assert.equal(backstop(call("read", { file_path: "GRAVIT.md" }, desk)), undefined);
  /* It judges the call as it reaches the guards: a listener behind the guard that swaps the name or the arguments
   * after the guard's listener handed it on cannot borrow that verdict. */
  const swapped = call("todo_write", { todos: [] }, desk) as { name: string; arguments: unknown };
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
  assert.equal(backstop(null as unknown as DeskGuardExecution), undefined, "a call with no name writes, reads and carries nothing");
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^gravit-face: desk: .*the session is gone/);

  await dispose();
  assert.equal(root.guards.length, 0, "the disposer withdraws the backstop");
});

test("a later prepend listener answering allow cannot lift a desk write's deny", async () => {
  const root = fakeRoot();
  const dispose = installDeskGuard(root.ctx, REPO, { log: () => {} });
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

test("the backstop judges reads and secrets too: a later prepend listener answering allow lifts neither deny", async () => {
  const root = fakeRoot();
  const dispose = installDeskGuard(root.ctx, REPO, { log: () => {}, secrets: [SECRET] });
  const offSwallower = root.ctx.on("tools/pre-execute", async () => ALLOW, { prepend: true });
  const desk = agentOn(DESK_PRESET);
  const cases: readonly (readonly [DeskGuardExecution, string])[] = [
    [call("read", { file_path: `${REPO}/.env.alpaca` }, desk), keyRead(".env.alpaca").reason],
    [call("grep", { pattern: "KEY", include: "*" }, desk), DOT_FILES.reason],
    [call("str_replace_editor", { command: "view", path: "/Users/op/.dsh/.env" }, desk), outside("/Users/op/.dsh/.env").reason],
    [call("web_search", { query: SECRET }, desk), CARRIES_SECRET.reason],
    [call("mcp__alpaca-kit__daily_bars", { symbol: SECRET }, desk), CARRIES_SECRET.reason],
  ];
  for (const [exec, reason] of cases) {
    assert.equal(await pipeline(root.preExecute, [], exec), undefined, `the control: without the backstop, ${exec.name} would run`);
    assert.equal(await pipeline(root.preExecute, root.guards, exec), reason, `with it, ${exec.name} is denied`);
    assert.equal(await pipeline(root.preExecute, root.guards, call(exec.name, exec.arguments, agentOn("gravit"))), undefined, `Gravit's ${exec.name} goes on`);
  }
  offSwallower();
  await dispose();
});

test("the disposer never rejects: a listener that cannot be removed and a backstop that cannot be withdrawn cost a line each", async () => {
  const root = fakeRoot();
  const failing: DeskGuardCtxLike = {
    ...root.ctx,
    on: () => () => { throw new Error("the listener cannot be removed"); },
    inject: () => ({ dispose: async () => { throw new Error("the fiber cannot be disposed"); } }),
  };
  const lines: string[] = [];
  const dispose = installDeskGuard(failing, REPO, { log: (line) => lines.push(line) });
  await dispose();
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^gravit-face: desk: .*the listener cannot be removed/);
  assert.match(lines[1], /^gravit-face: desk: .*the fiber cannot be disposed/);
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
  const deskRead = call("read", { file_path: `${REPO}/.env.alpaca` }, agentOn(DESK_PRESET));
  for (const enabled of [false, true]) {
    const root = fakeRoot();
    const desk = installDesk(recorder(), { home: await home(), enabled, watch, ctx: root.ctx, hub, root: REPO });
    assert.equal(root.preExecute.length, 1, `the guard's listener is installed (enabled: ${enabled})`);
    assert.equal(root.guards.length, 1, `and its backstop (enabled: ${enabled})`);
    assert.equal(root.agentCreated.length, 1, `beside the tools' listener (enabled: ${enabled})`);
    assert.deepEqual(await judged(root.preExecute[0], deskWrite), { decision: denied("GRAVIT.md"), nexts: 0 });
    assert.equal(root.guards[0](deskWrite), denied("GRAVIT.md").reason);
    assert.deepEqual(await judged(root.preExecute[0], deskRead), { decision: keyRead(".env.alpaca"), nexts: 0 });
    assert.equal(root.guards[0](deskRead), keyRead(".env.alpaca").reason);
    /* installDesk's root is the guard's: a desk under the harness home writes nothing. */
    assert.deepEqual(await judged(root.preExecute[0], write("notes/a.md", agentOn(DESK_PRESET, { cwd: "/Users/pan/.dsh/desk/run", agentPreset: DESK_PRESET }))),
      { decision: sitsUnder(".dsh"), nexts: 0 });
    await desk.dispose(0);
    assert.equal(root.preExecute.length, 0, `dispose removes the listener (enabled: ${enabled})`);
    assert.equal(root.guards.length, 0, `and the backstop (enabled: ${enabled})`);
    assert.equal(root.agentCreated.length, 0);
  }
  /* Given the context alone, the guard - which needs no hub - is installed, and the tools are not. */
  const root = fakeRoot();
  const desk = installDesk(recorder(), { home: await home(), enabled: false, ctx: root.ctx, root: REPO });
  assert.equal(root.preExecute.length, 1);
  assert.equal(root.guards.length, 1);
  assert.equal(root.agentCreated.length, 0);
  await desk.dispose(0);
  assert.equal(root.preExecute.length, 0);
  assert.equal(root.guards.length, 0);
});

test("installDesk's guard takes its secrets from the environment once, at install", async (t) => {
  const made = await mkdtemp(join(tmpdir(), "face-desk-guard-env-"));
  t.after(() => rm(made, { recursive: true, force: true }));
  const NOW_SET = "FACE_DESK_GUARD_TEST_TOKEN";
  const LATER = "FACE_DESK_GUARD_LATE_TOKEN";
  assert.equal(process.env[NOW_SET], undefined);
  assert.equal(process.env[LATER], undefined);
  const root = fakeRoot();
  let desk: ReturnType<typeof installDesk> | undefined;
  try {
    process.env[NOW_SET] = "made-up-env-token-0001";
    desk = installDesk(recorder(), { home: made, enabled: false, ctx: root.ctx, root: REPO });
  } finally {
    delete process.env[NOW_SET];
  }
  try {
    process.env[LATER] = "made-up-late-token-0002";
    const deskAgent = agentOn(DESK_PRESET);
    assert.deepEqual(await judged(root.preExecute[0], call("web_search", { query: "made-up-env-token-0001" }, deskAgent)), { decision: CARRIES_SECRET, nexts: 0 },
      "a value in the environment at install is a secret, though it has left the environment since");
    assert.deepEqual(await judged(root.preExecute[0], call("web_search", { query: "made-up-late-token-0002" }, deskAgent)), { decision: ALLOW, nexts: 1 },
      "one set after install is not");
  } finally {
    delete process.env[LATER];
    await desk?.dispose(0);
  }
});
