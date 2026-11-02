// face/tests/desk-session.test.ts
/** The desk session (src/desk-session.ts): the instruction-chain fence and its refusal line, the
 * provenance line, the desk's route, the ensure and create paths, and the supervisor every turn on
 * the session gets. Offline: a fake root context, a fake bus and a manual clock. The fence fixtures sit
 * INSIDE the repository, under tests/tmp/<pid>/, and are removed afterwards (spike 6: under $TMPDIR
 * the sandbox lets a desk write through, so the face's own fixtures stay where the desk's would). */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fsp, { chmod, mkdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { DESK_PATH, readDesk } from "../src/cycle.ts";
import { appendEvent, readEvents } from "../src/desk.ts";
import { AGENT_FILE_NAMES } from "../src/desk-names.ts";
import { DESK_PRESET } from "../src/desk-preset.ts";
import {
  DESK_DEFAULT_ROUTE, FENCE_NAMES, cancelKeepingQueue, createDeskAgent, deskJournalDir, ensureDeskSession, fenceRefusalLine, findChainViolation,
  findDeskFenceViolation, findFenceViolation, provenanceLine, resolveDeskRoute, superviseDeskTurns,
  type CreateDeskAgentOptions, type DeskClock, type DeskSessionCtxLike, type DeskSessionDeps, type DeskTurnRecord,
  type SessionEventsOn, type SuperviseDeskTurnsDeps,
} from "../src/desk-session.ts";
import type { AgentCtxLike, AgentLike, ModelSelectionRefLike, ResumeMemberOptions, SessionLike } from "../src/room.ts";
import type { EventLike, MessageLike } from "../src/room-rules.ts";
import { InboxModel } from "./inbox-fake.ts";
import { FakeClock } from "./room-fake.ts";

/* ---------- fixtures, inside the repository ---------- */

const TMP = join(dirname(fileURLToPath(import.meta.url)), "tmp", String(process.pid));
let made = 0;
/** A fresh directory under tests/tmp/<pid>/. */
async function fixture(label: string): Promise<string> {
  const dir = join(TMP, `${++made}-${label}`);
  await mkdir(dir, { recursive: true });
  return dir;
}
after(() => rm(TMP, { recursive: true, force: true }));

/** Make `rel` under `dir`: a directory when it ends in "/", else a file, its parents made first. */
async function put(dir: string, rel: string): Promise<void> {
  const path = join(dir, rel);
  if (rel.endsWith("/")) {
    await mkdir(path, { recursive: true });
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "x\n");
}

/** chmod cannot shut root out, so the unreadable cases are skipped when the suite runs as root. */
const AS_ROOT = process.getuid?.() === 0 ? "root reads past a mode of 000" : false;

/* ---------- the fence ---------- */

test("findFenceViolation finds each fence name at any depth and nothing else", async () => {
  const notes = await fixture("notes");
  await put(notes, "notes.md");
  await put(notes, "briefs/2026-10-20-preclose.md");
  assert.equal(await findFenceViolation(notes), undefined);

  const deep = await fixture("deep");
  await put(deep, "notes.md");
  await put(deep, "a/b/GRAVIT.md");
  assert.equal(await findFenceViolation(deep), "a/b/GRAVIT.md");

  for (const name of FENCE_NAMES) {
    const alone = await fixture("alone");
    await put(alone, name.endsWith(".md") ? name : `${name}/`);
    assert.equal(await findFenceViolation(alone), name, name);
  }

  const gitFile = await fixture("git-file"); // a worktree's `.git` is a file, and still a root marker
  await put(gitFile, "x/.git");
  assert.equal(await findFenceViolation(gitFile), "x/.git");

  const link = await fixture("link");
  await symlink(join(link, "nowhere"), join(link, ".git"));
  assert.equal(await findFenceViolation(link), ".git", "a symlink named like a fence name counts, dangling or not");

  const near = await fixture("near-misses");
  for (const rel of ["GRAVIT.md.bak", "old-GRAVIT.md", "x.dsh", "agents/", "git/"]) await put(near, rel);
  assert.equal(await findFenceViolation(near), undefined);

  assert.equal(await findFenceViolation(join(TMP, "no-such-journal")), undefined, "a missing journal holds nothing");
});

test("findFenceViolation counts every symlink, whatever its name, and returns the first violation in sorted order", async () => {
  const outside = await fixture("outside");
  await put(outside, "notes.md");
  const viaLink = await fixture("via-link");
  await put(viaLink, "a.md");
  await symlink(outside, join(viaLink, "shared"));
  assert.equal(await findFenceViolation(viaLink), "shared", "a symlinked directory is never followed: it is the violation");

  const fileLink = await fixture("file-link");
  await put(fileLink, "notes/2026-10-20.md");
  await symlink(join(fileLink, "notes", "2026-10-20.md"), join(fileLink, "notes", "today.md"));
  assert.equal(await findFenceViolation(fileLink), "notes/today.md", "so is a link to a plain note");

  const order = await fixture("order");
  await put(order, "b/GRAVIT.md");
  await put(order, "a/z.md");
  await put(order, "a/c/.dsh/");
  assert.equal(await findFenceViolation(order), "a/c/.dsh");
});

test("findFenceViolation matches names the way a case-insensitive volume opens them", async () => {
  // macOS's APFS folds case: dsh's probe stat("<dir>/GRAVIT.md") opens Gravit.md too (measured).
  for (const name of ["gravit.md", "Gravit.Local.MD", ".GIT", ".Dsh", ".AGENTS", ".dſh"]) {
    const dir = await fixture("folded");
    await put(dir, `notes/${name}`);
    assert.equal(await findFenceViolation(dir), `notes/${name}`, name);
  }
});

test("findFenceViolation fails closed: a journal it cannot list, or one that is a symlink, is '.'", async () => {
  const file = join(await fixture("file-journal"), "journal");
  await writeFile(file, "a file where the journal should be");
  assert.equal(await findFenceViolation(file), ".");

  const loop = join(await fixture("loop-journal"), "journal");
  await symlink(loop, loop);
  assert.equal(await findFenceViolation(loop), ".", "a link to itself");

  const target = await fixture("real-journal");
  await put(target, "notes.md");
  const linked = join(await fixture("linked-journal"), "journal");
  await symlink(target, linked);
  assert.equal(await findFenceViolation(linked), ".", "depth 0: the journal itself is no symlink either");
});

test("findFenceViolation skips a child that vanished or changed type since the listing; any other child error fails closed", async (t) => {
  const dir = await fixture("raced");
  for (const rel of ["gone/notes.md", "swapped/notes.md", "zz/GRAVIT.md"]) await put(dir, rel);
  // The race, staged: these children are listed as directories, then fail when the walk descends.
  const failing = new Map<string, string>([[join(dir, "gone"), "ENOENT"], [join(dir, "swapped"), "ENOTDIR"]]);
  const real = fsp.readdir as unknown as (path: unknown, options: unknown) => Promise<unknown>;
  t.mock.method(fsp, "readdir", ((path: unknown, options: unknown) => {
    const code = failing.get(String(path));
    return code === undefined ? real(path, options) : Promise.reject(Object.assign(new Error(`${code}: ${String(path)}`), { code }));
  }) as unknown as typeof fsp.readdir);
  syncBuiltinESMExports();
  try {
    assert.equal(await findFenceViolation(dir), "zz/GRAVIT.md", "both skipped, and the walk goes on past them");
    failing.set(join(dir, "gone"), "EIO");
    assert.equal(await findFenceViolation(dir), "gone");
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test("findFenceViolation fails closed: an entry it cannot read is the violation", { skip: AS_ROOT }, async () => {
  const dir = await fixture("locked-entry");
  await put(dir, "a.md");
  await put(dir, "locked/inner.md");
  await chmod(join(dir, "locked"), 0o000);
  try {
    assert.equal(await findFenceViolation(dir), "locked");
  } finally {
    await chmod(join(dir, "locked"), 0o755);
  }

  const root = await fixture("locked-journal");
  await chmod(root, 0o000);
  try {
    assert.equal(await findFenceViolation(root), ".");
  } finally {
    await chmod(root, 0o755);
  }
});

test("findDeskFenceViolation checks desk/ itself, then the journal, and answers repo-relative", async () => {
  assert.equal(await findDeskFenceViolation(await fixture("repo-without-desk")), undefined, "no desk/ is no violation");

  const clean = await fixture("repo-clean");
  for (const rel of ["desk/levels.yml", "desk/STANDING.md", "desk/journal/notes.md"]) await put(clean, rel);
  assert.equal(await findDeskFenceViolation(clean), undefined);

  const deskMd = await fixture("repo-desk-md");
  await put(deskMd, "desk/GRAVIT.md");
  await put(deskMd, "desk/journal/.git/");
  assert.equal(await findDeskFenceViolation(deskMd), "desk/GRAVIT.md", "desk/ is checked before the journal");

  const deskGit = await fixture("repo-desk-git");
  await put(deskGit, "desk/.git/");
  assert.equal(await findDeskFenceViolation(deskGit), "desk/.git");

  const deskLink = await fixture("repo-desk-link");
  await mkdir(join(deskLink, "desk"));
  await symlink(join(deskLink, "nowhere"), join(deskLink, "desk", ".agents"));
  assert.equal(await findDeskFenceViolation(deskLink), "desk/.agents", "lstat: a dangling symlink counts");

  const journal = await fixture("repo-journal");
  await put(journal, "desk/journal/a/GRAVIT.local.md");
  assert.equal(await findDeskFenceViolation(journal), "desk/journal/a/GRAVIT.local.md");

  const journalFile = await fixture("repo-journal-file");
  await put(journalFile, "desk/journal");
  assert.equal(await findDeskFenceViolation(journalFile), "desk/journal", "an unlistable journal is the journal");

  const deskFile = await fixture("repo-desk-file");
  await put(deskFile, "desk");
  assert.equal(await findDeskFenceViolation(deskFile), "desk", "ENOTDIR is not ENOENT");
});

test("findDeskFenceViolation refuses a symlinked desk/ or journal, and the repository's own skill roots", async () => {
  const deskTarget = await fixture("desk-target");
  await put(deskTarget, "journal/notes.md");
  const deskLinked = await fixture("repo-desk-symlink");
  await symlink(deskTarget, join(deskLinked, "desk"));
  assert.equal(await findDeskFenceViolation(deskLinked), "desk");

  const journalTarget = await fixture("journal-target");
  await put(journalTarget, "notes.md");
  const journalLinked = await fixture("repo-journal-symlink");
  await mkdir(join(journalLinked, "desk"));
  await symlink(journalTarget, join(journalLinked, "desk", "journal"));
  assert.equal(await findDeskFenceViolation(journalLinked), "desk/journal");

  // dsh treats <root>/.dsh/skills and <root>/.agents/skills as skill roots for every session in the repository
  for (const name of [".dsh", ".agents"]) {
    const repo = await fixture("repo-skill-root");
    await put(repo, `${name}/`);
    await put(repo, "desk/journal/notes.md");
    assert.equal(await findDeskFenceViolation(repo), name);
  }
  const linkedRoot = await fixture("repo-skill-root-link");
  await symlink(join(linkedRoot, "nowhere"), join(linkedRoot, ".agents"));
  assert.equal(await findDeskFenceViolation(linkedRoot), ".agents", "present by lstat, dangling or not");

  const first = await fixture("repo-skill-root-first");
  await put(first, ".agents/");
  await put(first, "desk/GRAVIT.md");
  assert.equal(await findDeskFenceViolation(first), ".agents", "the repository's roots are checked before desk/");
});

test("findDeskFenceViolation fails closed on a desk/ it cannot search", { skip: AS_ROOT }, async () => {
  const repo = await fixture("repo-locked-desk");
  await put(repo, "desk/journal/notes.md");
  await chmod(join(repo, "desk"), 0o000);
  try {
    assert.equal(await findDeskFenceViolation(repo), "desk");
  } finally {
    await chmod(join(repo, "desk"), 0o755);
  }
});

/* P2: the same fence for any cwd strictly inside the repository - a firing's in desk/journal, a strategy's in strategies/<name>. */

test("findChainViolation: the root's skill roots, every directory down to the cwd, the five names between, and the cwd's tree", async () => {
  const demo = (root: string): string => join(root, "strategies", "demo");

  /* The root's own GRAVIT.md, GRAVIT.local.md and .git are the repository's; a sibling channel's GRAVIT.md is off the chain. */
  const clean = await fixture("chain-clean");
  for (const rel of ["GRAVIT.md", "GRAVIT.local.md", ".git/", "strategies/README.md", "strategies/other/GRAVIT.md", "strategies/demo/levels.yml", "strategies/demo/notes/a.md"]) {
    await put(clean, rel);
  }
  assert.equal(await findChainViolation(clean, demo(clean)), undefined);
  assert.equal(await findChainViolation(clean, `${demo(clean)}/`), undefined, "a trailing slash is the same cwd");

  for (const name of [".agents", ".dsh"]) {
    const repo = await fixture("chain-skill-root");
    await put(repo, `${name}/`);
    await put(repo, "strategies/demo/levels.yml");
    assert.equal(await findChainViolation(repo, demo(repo)), name);
  }

  /* Between the root and the cwd, the five names case-folded, each answered as it is named on disk. */
  for (const name of ["GRAVIT.md", "Gravit.md", "GRAVIT.local.md", ".git", ".GIT", ".dsh", ".agents"]) {
    const repo = await fixture("chain-between");
    await put(repo, name.endsWith(".md") ? `strategies/${name}` : `strategies/${name}/`);
    await put(repo, "strategies/demo/levels.yml");
    assert.equal(await findChainViolation(repo, demo(repo)), `strategies/${name}`, name);
  }
  const desk = await fixture("chain-desk");
  await put(desk, "desk/.git/");
  await put(desk, "desk/journal/notes.md");
  assert.equal(await findChainViolation(desk, deskJournalDir(desk)), "desk/.git");

  /* Every directory on the chain by lstat: a symlinked cwd, or one above it, is the violation. */
  const linkedCwd = await fixture("chain-linked-cwd");
  await put(linkedCwd, "elsewhere/levels.yml");
  await mkdir(join(linkedCwd, "strategies"));
  await symlink(join(linkedCwd, "elsewhere"), demo(linkedCwd));
  assert.equal(await findChainViolation(linkedCwd, demo(linkedCwd)), "strategies/demo");
  const linkedBetween = await fixture("chain-linked-between");
  await put(linkedBetween, "elsewhere/demo/levels.yml");
  await symlink(join(linkedBetween, "elsewhere"), join(linkedBetween, "strategies"));
  assert.equal(await findChainViolation(linkedBetween, demo(linkedBetween)), "strategies");

  /* The cwd's tree: a fence name at any depth, and any symlink. */
  const deep = await fixture("chain-deep");
  await put(deep, "strategies/demo/a/.agents/");
  assert.equal(await findChainViolation(deep, demo(deep)), "strategies/demo/a/.agents");
  const noted = await fixture("chain-link-in-cwd");
  await put(noted, "strategies/demo/levels.yml");
  await symlink(join(noted, "strategies", "demo", "levels.yml"), join(noted, "strategies", "demo", "notes"));
  assert.equal(await findChainViolation(noted, demo(noted)), "strategies/demo/notes");

  /* A level's names come before the level below it, as P1's desk fence answered: desk/GRAVIT.md before a symlinked journal. */
  const order = await fixture("chain-order");
  await put(order, "desk/GRAVIT.md");
  await put(order, "elsewhere/notes.md");
  await symlink(join(order, "elsewhere"), join(order, "desk", "journal"));
  assert.equal(await findChainViolation(order, deskJournalDir(order)), "desk/GRAVIT.md");
  assert.equal(await findDeskFenceViolation(order), "desk/GRAVIT.md");

  /* A chain not there yet holds nothing; a directory that cannot be listed is the violation, by its path. */
  const none = await fixture("chain-none");
  assert.equal(await findChainViolation(none, demo(none)), undefined, "no strategies/");
  const partial = await fixture("chain-partial");
  await put(partial, "strategies/README.md");
  assert.equal(await findChainViolation(partial, demo(partial)), undefined, "strategies/ without demo/");
  const fileBetween = await fixture("chain-file-between");
  await put(fileBetween, "strategies");
  assert.equal(await findChainViolation(fileBetween, demo(fileBetween)), "strategies", "a file where a directory between should be cannot be searched");
  const fileCwd = await fixture("chain-file-cwd");
  await put(fileCwd, "strategies/demo");
  assert.equal(await findChainViolation(fileCwd, demo(fileCwd)), "strategies/demo", "nor can a cwd that is a file be listed");

  /* The cwd must be strictly inside the root: anything else is the caller's TypeError, before the disk is touched. */
  const root = join(TMP, "no-such-root");
  for (const cwd of [root, `${root}/`, join(root, ".."), `${root}-sibling/strategies/demo`, join(root, "strategies", "..", "..", "x"), "relative/strategies/demo"]) {
    await assert.rejects(findChainViolation(root, cwd), TypeError, cwd);
  }
});

test("findChainViolation: a directory between that vanished since its lstat holds nothing; one it cannot list is the violation", async (t) => {
  const repo = await fixture("chain-raced");
  await put(repo, "strategies/demo/levels.yml");
  const between = join(repo, "strategies");
  let code = "ENOENT";
  const real = fsp.readdir as unknown as (path: unknown, options: unknown) => Promise<unknown>;
  t.mock.method(fsp, "readdir", ((path: unknown, options: unknown) =>
    (String(path) === between ? Promise.reject(Object.assign(new Error(`${code}: ${String(path)}`), { code })) : real(path, options))) as unknown as typeof fsp.readdir);
  syncBuiltinESMExports();
  try {
    assert.equal(await findChainViolation(repo, join(between, "demo")), undefined, "ENOENT: gone, so it holds nothing; the levels below decide");
    code = "EIO";
    assert.equal(await findChainViolation(repo, join(between, "demo")), "strategies");
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test("findChainViolation: a level gone or no directory any more since the level above was listed ends the check clean; one that cannot be read is the violation", async (t) => {
  const repo = await fixture("chain-raced-level");
  await put(repo, "strategies/demo/levels.yml");
  const cwd = join(repo, "strategies", "demo");
  let code = "ENOTDIR";
  const real = fsp.lstat as unknown as (path: unknown) => Promise<unknown>;
  t.mock.method(fsp, "lstat", ((path: unknown) =>
    (String(path) === cwd ? Promise.reject(Object.assign(new Error(`${code}: ${String(path)}`), { code })) : real(path))) as unknown as typeof fsp.lstat);
  syncBuiltinESMExports();
  try {
    assert.equal(await findChainViolation(repo, cwd), undefined, "ENOTDIR: strategies/ became a file, so nothing is below it");
    code = "ENOENT";
    assert.equal(await findChainViolation(repo, cwd), undefined);
    code = "EIO";
    assert.equal(await findChainViolation(repo, cwd), "strategies/demo");
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test("findChainViolation fails closed on a directory between it cannot search", { skip: AS_ROOT }, async () => {
  const repo = await fixture("chain-locked");
  await put(repo, "strategies/demo/levels.yml");
  await chmod(join(repo, "strategies"), 0o000);
  try {
    assert.equal(await findChainViolation(repo, join(repo, "strategies", "demo")), "strategies");
  } finally {
    await chmod(join(repo, "strategies"), 0o755);
  }
});

test("fenceRefusalLine names the repo-relative path in the plan's wording", () => {
  assert.equal(
    fenceRefusalLine("desk/journal/a/.git"),
    "refused: desk/journal/a/.git exists; it would steer every later desk turn. Remove it, then write again.",
  );
  assert.equal(
    fenceRefusalLine("desk/GRAVIT.md"),
    "refused: desk/GRAVIT.md exists; it would steer every later desk turn. Remove it, then write again.",
  );
});

/* ---------- provenance, sources and the contract ---------- */

test("provenanceLine renders the three forms in ET", () => {
  const at = new Date("2026-10-20T18:03:00Z");
  assert.equal(provenanceLine({ kind: "telegram" }, at), "[telegram · operator · 14:03 ET]");
  assert.equal(provenanceLine({ kind: "schedule", order: "preclose", date: "2026-10-20" }, at), "[schedule · preclose · 2026-10-20]");
  assert.equal(provenanceLine({ kind: "alert", symbol: "NVDA", rule: "buy_zone" }, at), "[alert · NVDA · buy_zone]");
  assert.equal(provenanceLine({ kind: "telegram" }, new Date("2026-12-01T19:03:00Z")), "[telegram · operator · 14:03 ET]", "EST reads ET too");
  assert.equal(provenanceLine({ kind: "telegram", at: Date.parse("2026-10-20T13:30:00Z") }, at), "[telegram · operator · 09:30 ET]",
    "a phone's time is when the operator wrote it, not when it arrived");
  assert.equal(provenanceLine({ kind: "telegram", at: Date.parse("2026-10-20T03:30:00Z") }, at), "[telegram · operator · 2026-10-19 23:30 ET]",
    "dated when it was written on another New York day");
});

test("provenanceLine renders the alerts and the state forms", () => {
  assert.equal(provenanceLine({ kind: "alerts", count: 3 }, new Date("2026-11-30T14:30:04Z")), "[alerts · 3 · 09:30 ET]");
  assert.equal(provenanceLine({ kind: "state" }, new Date("2026-10-20T18:03:00Z")), "[desk · state · 14:03 ET]");
});

test("the desk contract names every fence name and the provenance forms the code writes", () => {
  const contract = readDesk(DESK_PATH);
  const names = `${FENCE_NAMES.slice(0, -1).join(", ")} or ${FENCE_NAMES.at(-1)}`;
  const lines = contract.split("\n").filter((line) => line.includes(names));
  assert.deepEqual(lines, [`- Never a ${names} under your directory: the face refuses every desk turn while one exists.`], "one line lists the fence names, all of them, in order");
  assert.ok(contract.includes(provenanceLine({ kind: "telegram" }, new Date("2026-10-20T18:03:00Z"))), "the telegram line");
  assert.ok(contract.includes("[schedule · "), "the schedule prefix");
  assert.ok(contract.includes("[alert · "), "the alert prefix");
  assert.ok(contract.includes("[alerts · "), "the batch's prefix");
  assert.ok(contract.includes(provenanceLine({ kind: "state" }, new Date("2026-10-20T18:03:00Z")).replace("14:03 ET]", "")), "the state's prefix");
  /* and the write guard's other refusals: every other agent's instruction file, in order, and the dot-files */
  const agents = `${AGENT_FILE_NAMES.slice(0, -1).join(", ")} or ${AGENT_FILE_NAMES.at(-1)}`;
  assert.deepEqual(contract.split("\n").filter((line) => line.includes(agents)),
    [`- Never a dot-file, nor a ${agents}, anywhere: git and the operator's other agents obey them, and the guard refuses the write.`],
    "one line lists them, all of them, in order");
});

test("telegram, schedule, alert and desk are message sources dsh-llm's createUserMessage accepts", () => {
  // The augmentation is what makes these four calls type-check (npm run typecheck covers tests/).
  const text = [{ type: "text" as const, text: "x" }];
  const sources = [
    createUserMessage({ content: text, source: { kind: "telegram", from: 42, chat: 42, messageId: 7 } }).source,
    createUserMessage({ content: text, source: { kind: "schedule", order: "preclose", firing: "preclose:2026-10-20", date: "2026-10-20" } }).source,
    createUserMessage({ content: text, source: { kind: "alert", alert: "a-0001", symbol: "NVDA" } }).source,
    createUserMessage({ content: text, source: { kind: "desk", form: "state" } }).source,
  ];
  assert.deepEqual(sources.map((s) => s.kind), ["telegram", "schedule", "alert", "desk"]);
});

/* ---------- the route ---------- */

test("resolveDeskRoute takes FACE_DESK_MODEL when the tree serves it, else the default selection and one line", async () => {
  const served = new Set(["deepseek-official/deepseek-flash", "stub/echo"]);
  const ctx = {
    agentDefaultModel: { currentSelection: () => ({ provider: "deepseek-official", model: "deepseek-pro" }) },
    llm: {
      resolveCallConfig: async (config: { provider: string; model: string }) => {
        if (!served.has(`${config.provider}/${config.model}`)) throw new Error(`no adapter serves ${config.provider}/${config.model}`);
        return config;
      },
    },
  };
  const lines: string[] = [];
  const log = (line: string): void => { lines.push(line); };
  assert.equal(DESK_DEFAULT_ROUTE, "deepseek-official/deepseek-flash");
  assert.deepEqual(await resolveDeskRoute(ctx, undefined, log), { provider: "deepseek-official", model: "deepseek-flash" });
  assert.deepEqual(await resolveDeskRoute(ctx, "", log), { provider: "deepseek-official", model: "deepseek-flash" });
  assert.deepEqual(await resolveDeskRoute(ctx, "stub/echo", log), { provider: "stub", model: "echo" });
  assert.deepEqual(lines, []);
  const fallback = { provider: "deepseek-official", model: "deepseek-pro" };
  assert.deepEqual(await resolveDeskRoute(ctx, "flash", log), fallback);
  assert.deepEqual(await resolveDeskRoute(ctx, "a/b/c", log), fallback);
  assert.deepEqual(await resolveDeskRoute(ctx, "nope/model", log), fallback);
  served.delete("deepseek-official/deepseek-flash");
  assert.deepEqual(await resolveDeskRoute(ctx, undefined, log), fallback);
  assert.deepEqual(lines, [
    "gravit-face: desk: model route flash is not usable (not one provider/model route); the desk uses the default deepseek-official/deepseek-pro",
    "gravit-face: desk: model route a/b/c is not usable (not one provider/model route); the desk uses the default deepseek-official/deepseek-pro",
    "gravit-face: desk: model route nope/model is not usable (no adapter serves nope/model); the desk uses the default deepseek-official/deepseek-pro",
    "gravit-face: desk: model route deepseek-official/deepseek-flash is not usable (no adapter serves deepseek-official/deepseek-flash); the desk uses the default deepseek-official/deepseek-pro",
  ]);
});

/* ---------- ensure and create ---------- */

/** The slice of a booted root the desk session reads, recording every call. A session's header and its
 * permission preset are durable facts here as in dsh: the header is what creation's `meta` said, and the
 * preset is setup's pin, else this fake's user default ("read-only", not the desk's) pinned at
 * publication; a resume finds both as the log holds them. Disposing a handle - a create's or a resume's
 * - is recorded by session id. */
class FakeDeskTree {
  readonly live = new Map<string, AgentLike>();
  readonly stored = new Map<string, string>();
  readonly headers = new Map<string, SessionLike["header"]>();
  readonly created: CreateDeskAgentOptions[] = [];
  readonly resumed: ResumeMemberOptions[] = [];
  readonly mounts: string[] = [];
  readonly selections: ModelSelectionRefLike[] = [];
  readonly pins: { session: string; name: string; published: boolean }[] = [];
  readonly disposed: string[] = [];
  /** A preset some later announcement listener lays over the pin - the case the post-publication check exists for. */
  overrideAfterPublish: string | undefined;
  failDispose = false;

  private agentFor(id: string, header: SessionLike["header"]): AgentLike {
    const session: SessionLike = { id, header, seq: 0, snapshotEvents: () => [], append: () => undefined };
    return { id, status: "idle", session, followup: () => {}, cancel: () => {} };
  }

  private handle(id: string, agent: AgentLike): { agent: AgentLike; dispose(): Promise<void> } {
    return {
      agent,
      dispose: async () => {
        this.disposed.push(id);
        if (this.failDispose) throw new Error("the loop would not stop");
        this.live.delete(id);
      },
    };
  }

  /** A session on disk: the header its log opens with and the permission preset it holds. */
  persist(id: string, header: SessionLike["header"], preset = "workspace-write"): void {
    this.headers.set(id, header);
    this.stored.set(id, preset);
  }

  /** A session on disk and live in the registry - someone else's agent, as far as the face knows. */
  goLive(id: string, header: SessionLike["header"], preset = "workspace-write"): void {
    this.persist(id, header, preset);
    this.live.set(id, this.agentFor(id, header));
  }

  readonly install = (_agentCtx: AgentCtxLike, ref: ModelSelectionRefLike): (() => void) => {
    this.selections.push(ref);
    return () => {};
  };

  readonly ctx: DeskSessionCtxLike = {
    agents: {
      get: (id) => this.live.get(id),
      create: async (options) => {
        this.created.push(options);
        const header = { cwd: options.meta.cwd, agentPreset: options.meta.agentPreset };
        this.headers.set(options.sessionId, header);
        const agent = this.agentFor(options.sessionId, header);
        await options.setup({ fakeAgentId: options.sessionId }, agent);
        this.live.set(options.sessionId, agent);
        if (!this.stored.has(options.sessionId)) this.stored.set(options.sessionId, "read-only");
        if (this.overrideAfterPublish !== undefined) this.stored.set(options.sessionId, this.overrideAfterPublish);
        return this.handle(options.sessionId, agent);
      },
      resume: async (options) => {
        this.resumed.push(options);
        const header = this.headers.get(options.resumeSessionId);
        if (header === undefined || !this.stored.has(options.resumeSessionId)) throw new Error(`session "${options.resumeSessionId}" not found`);
        const agent = this.agentFor(options.resumeSessionId, header);
        await options.setup({ fakeAgentId: options.resumeSessionId }, agent);
        this.live.set(options.resumeSessionId, agent);
        return this.handle(options.resumeSessionId, agent);
      },
    },
    agentPresets: {
      mount: async (_agentCtx, id) => {
        this.mounts.push(id);
        return { id };
      },
    },
    permissionPresets: {
      set: (session, name) => {
        this.pins.push({ session: session.id, name, published: this.live.has(session.id) });
        this.stored.set(session.id, name);
      },
      current: (session) => this.stored.get(session.id) ?? "read-only",
    },
  };
}

const ROUTE = { provider: "deepseek-official", model: "deepseek-flash" };
const AT = Date.parse("2026-10-20T18:03:00.000Z");
const SESSION_ID = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function sessionDeps(tree: FakeDeskTree, root: string, home: string, lines: string[] = []): DeskSessionDeps {
  return { ctx: tree.ctx, root, home, route: ROUTE, installModelSelection: tree.install, now: () => AT, log: (line) => { lines.push(line); } };
}

test("ensureDeskSession: live, cold, missing and fresh paths; records only creations; pins workspace-write", async () => {
  const root = await fixture("ensure-repo");
  const home = await fixture("ensure-home");
  const tree = new FakeDeskTree();
  const lines: string[] = [];
  const deps = sessionDeps(tree, root, home, lines);

  // missing: no ledger yet - create in the journal, made first
  const first = await ensureDeskSession(deps);
  assert.equal(first.created, true);
  assert.match(first.sessionId, SESSION_ID);
  assert.equal(first.agent.id, first.sessionId);
  assert.ok((await stat(deskJournalDir(root))).isDirectory(), "the journal is made (mkdir -p)");
  assert.equal(deskJournalDir(root), join(root, "desk", "journal"));
  assert.deepEqual(tree.created.map((c) => ({ sessionId: c.sessionId, meta: c.meta, agentOptions: c.agentOptions })), [
    { sessionId: first.sessionId, meta: { cwd: deskJournalDir(root), agentPreset: DESK_PRESET }, agentOptions: ROUTE },
  ]);
  assert.deepEqual(tree.selections, [{ current: ROUTE, assembled: undefined }]);
  assert.deepEqual(tree.mounts, [DESK_PRESET]);
  assert.deepEqual(tree.pins, [{ session: first.sessionId, name: "workspace-write", published: false }], "pinned inside setup, before publication");
  assert.deepEqual((await readEvents(home)).events, [{ t: "2026-10-20T18:03:00.000Z", kind: "desk-session", sessionId: first.sessionId, reason: "created" }]);

  // live: the ledger's session is in the registry - taken as it is, nothing recorded
  const live = await ensureDeskSession(deps);
  assert.deepEqual({ sessionId: live.sessionId, created: live.created }, { sessionId: first.sessionId, created: false });
  assert.equal(live.agent, first.agent);
  assert.equal(tree.created.length, 1);
  assert.equal(tree.resumed.length, 0);

  // cold: on disk, not live - resumed on the route with the desk's setup, never re-pinned
  tree.live.delete(first.sessionId);
  const cold = await ensureDeskSession(deps);
  assert.deepEqual({ sessionId: cold.sessionId, created: cold.created }, { sessionId: first.sessionId, created: false });
  assert.deepEqual(tree.resumed.map((r) => ({ resumeSessionId: r.resumeSessionId, agentOptions: r.agentOptions })), [
    { resumeSessionId: first.sessionId, agentOptions: ROUTE },
  ]);
  assert.deepEqual(tree.mounts, [DESK_PRESET, DESK_PRESET]);
  assert.deepEqual(tree.selections, [{ current: ROUTE, assembled: undefined }, { current: ROUTE, assembled: undefined }]);
  assert.equal(tree.pins.length, 1, "a resume never pins");

  // fresh: another conversation even though one is live, recorded as "new"
  const fresh = await ensureDeskSession(deps, { fresh: true });
  assert.equal(fresh.created, true);
  assert.notEqual(fresh.sessionId, first.sessionId);
  assert.ok(tree.live.has(first.sessionId), "the old conversation is left alone");

  // a failed resume: a new conversation, recorded as "created", and one line
  tree.live.delete(fresh.sessionId);
  tree.stored.delete(fresh.sessionId);
  const replaced = await ensureDeskSession(deps);
  assert.equal(replaced.created, true);
  assert.deepEqual(lines, [`gravit-face: desk: desk session ${fresh.sessionId} could not be resumed (session "${fresh.sessionId}" not found); opening a new one`]);

  const recorded = (await readEvents(home)).events.map((e) => (e.kind === "desk-session" ? [e.sessionId, e.reason] : [e.kind]));
  assert.deepEqual(recorded, [[first.sessionId, "created"], [fresh.sessionId, "new"], [replaced.sessionId, "created"]], "only creations are recorded");
  assert.deepEqual(tree.pins.map((p) => [p.session, p.name, p.published]), [
    [first.sessionId, "workspace-write", false], [fresh.sessionId, "workspace-write", false], [replaced.sessionId, "workspace-write", false],
  ]);
});

test("ensureDeskSession refuses a desk session whose permission preset is not workspace-write, disposing only what it resumed", async () => {
  const root = await fixture("refuse-repo");
  const home = await fixture("refuse-home");
  const tree = new FakeDeskTree();
  const deps = sessionDeps(tree, root, home);
  const desk = { cwd: deskJournalDir(root), agentPreset: DESK_PRESET };
  const refused = /desk session session-old is "danger-full-access", not workspace-write/;

  // the operator switched the conversation to full access in the browser: neither the cold nor the live path prompts it
  await appendEvent(home, { t: "2026-10-20T13:00:00.000Z", kind: "desk-session", sessionId: "session-old", reason: "created" });
  tree.persist("session-old", desk, "danger-full-access");
  await assert.rejects(ensureDeskSession(deps), refused);
  assert.equal(tree.resumed.length, 1);
  assert.deepEqual(tree.disposed, ["session-old"], "the face resumed it, so the face disposes it again");
  assert.equal(tree.live.has("session-old"), false);

  tree.goLive("session-old", desk, "danger-full-access");
  await assert.rejects(ensureDeskSession(deps), refused);
  assert.deepEqual(tree.disposed, ["session-old"], "a live agent is someone else's: refused, never disposed");
  assert.ok(tree.live.has("session-old"));

  // a pin that does not hold after publication: refused, the new agent disposed, nothing recorded
  tree.overrideAfterPublish = "read-only";
  await assert.rejects(ensureDeskSession(deps, { fresh: true }), /is "read-only", not workspace-write/);
  assert.equal(tree.created.length, 1);
  assert.deepEqual(tree.disposed, ["session-old", tree.created[0].sessionId]);
  assert.equal((await readEvents(home)).events.length, 1, "only the seeded record");
});

test("ensureDeskSession opens a new desk session when the ledger's is not one, disposing only what it resumed", async () => {
  const cases: { label: string; live: boolean; header: (journal: string) => SessionLike["header"]; why: RegExp }[] = [
    { label: "a resumed session of another preset", live: false, header: (j) => ({ cwd: j, agentPreset: "gravit" }), why: /its preset is "gravit", not gravit-desk/ },
    { label: "a resumed session in another directory", live: false, header: (j) => ({ cwd: dirname(j), agentPreset: DESK_PRESET }), why: /its cwd is ".*\/desk", not .*\/desk\/journal/ },
    { label: "a live session of another preset", live: true, header: (j) => ({ cwd: j, agentPreset: "gravit" }), why: /its preset is "gravit", not gravit-desk/ },
    { label: "a live session with no cwd", live: true, header: () => ({ agentPreset: DESK_PRESET }), why: /its cwd is unset, not .*\/desk\/journal/ },
  ];
  for (const c of cases) {
    const root = await fixture("identity-repo");
    const home = await fixture("identity-home");
    const tree = new FakeDeskTree();
    const lines: string[] = [];
    await appendEvent(home, { t: "2026-10-20T13:00:00.000Z", kind: "desk-session", sessionId: "session-other", reason: "created" });
    const header = c.header(deskJournalDir(root));
    if (c.live) tree.goLive("session-other", header);
    else tree.persist("session-other", header);

    const opened = await ensureDeskSession(sessionDeps(tree, root, home, lines));
    assert.equal(opened.created, true, c.label);
    assert.notEqual(opened.sessionId, "session-other", c.label);
    assert.equal(tree.resumed.length, c.live ? 0 : 1, c.label);
    assert.deepEqual(tree.disposed, c.live ? [] : ["session-other"], `${c.label}: only an agent the face resumed is disposed`);
    assert.equal(tree.live.has("session-other"), c.live, c.label);
    assert.equal(lines.length, 1, c.label);
    assert.match(lines[0], /^gravit-face: desk: session session-other, the ledger's desk conversation, is not a desk session \(/, c.label);
    assert.match(lines[0], c.why, c.label);
    assert.match(lines[0], /\); opening a new one$/, c.label);
    const last = (await readEvents(home)).events.at(-1);
    assert.deepEqual(last, { t: "2026-10-20T18:03:00.000Z", kind: "desk-session", sessionId: opened.sessionId, reason: "created" }, c.label);
  }
});

test("createDeskAgent opens a desk agent in its cwd with the desk's setup and records nothing", async () => {
  const root = await fixture("firing-repo");
  const home = await fixture("firing-home");
  const tree = new FakeDeskTree();
  const cwd = deskJournalDir(root);

  const firing = await createDeskAgent(sessionDeps(tree, root, home), { cwd, route: { provider: "stub", model: "echo" } });
  assert.match(firing.sessionId, SESSION_ID);
  assert.equal(firing.agent.id, firing.sessionId);
  assert.ok((await stat(cwd)).isDirectory(), "its cwd is made first: agents.create does not make it");
  assert.deepEqual(tree.created.map((c) => ({ meta: c.meta, agentOptions: c.agentOptions })), [
    { meta: { cwd, agentPreset: DESK_PRESET }, agentOptions: { provider: "stub", model: "echo" } },
  ]);
  assert.deepEqual(tree.selections, [{ current: { provider: "stub", model: "echo" }, assembled: undefined }]);
  assert.deepEqual(tree.mounts, [DESK_PRESET]);
  assert.deepEqual(tree.pins, [{ session: firing.sessionId, name: "workspace-write", published: false }]);

  const plain = await createDeskAgent(sessionDeps(tree, root, home), { cwd });
  assert.deepEqual(tree.created[1].agentOptions, ROUTE, "without a route of its own it takes the desk's");
  assert.notEqual(plain.sessionId, firing.sessionId);
  assert.deepEqual(await readEvents(home), { events: [], skipped: 0 }, "a firing is never the phone conversation");
});

test("createDeskAgent's dispose disposes the handle once, never throws, and logs a failure", async () => {
  const root = await fixture("dispose-repo");
  const home = await fixture("dispose-home");
  const tree = new FakeDeskTree();
  const lines: string[] = [];
  const deps = sessionDeps(tree, root, home, lines);

  const firing = await createDeskAgent(deps, { cwd: deskJournalDir(root) });
  await firing.dispose();
  await firing.dispose();
  await Promise.all([firing.dispose(), firing.dispose()]);
  assert.deepEqual(tree.disposed, [firing.sessionId]);
  assert.equal(tree.live.has(firing.sessionId), false);
  assert.deepEqual(lines, []);

  tree.failDispose = true;
  const stuck = await createDeskAgent(deps, { cwd: deskJournalDir(root) });
  await stuck.dispose();
  await stuck.dispose();
  assert.deepEqual(tree.disposed, [firing.sessionId, stuck.sessionId]);
  assert.deepEqual(lines, [`gravit-face: desk: desk session ${stuck.sessionId} could not be disposed: the loop would not stop`]);
});

/* ---------- supervision ---------- */

const SID = "session-desk";
const iso = (ms: number): string => new Date(ms).toISOString();

/** A manual clock that also keeps what it armed and what is still armed. */
function deskClock(): { clock: DeskClock; fake: FakeClock; armed: number[]; pending: Set<unknown> } {
  const fake = new FakeClock();
  const armed: number[] = [];
  const pending = new Set<unknown>();
  const clock: DeskClock = {
    now: () => fake.now(),
    setTimeout: (fn, ms) => {
      armed.push(ms);
      let handle: unknown;
      handle = fake.setTimeout(() => { pending.delete(handle); fn(); }, ms);
      pending.add(handle);
      return handle;
    },
    clearTimeout: (handle) => {
      pending.delete(handle);
      fake.clearTimeout(handle);
    },
  };
  return { clock, fake, armed, pending };
}

interface Harness {
  time: ReturnType<typeof deskClock>;
  /** One event on the root bus, for `sessionId` (default the desk's). */
  emit(type: string, data?: unknown, sessionId?: string): void;
  cancels: unknown[][];
  records: DeskTurnRecord[];
  lines: string[];
  listeners: Set<unknown>;
  dispose(): void;
}

function supervise(over: Partial<SuperviseDeskTurnsDeps> = {}): Harness {
  const time = deskClock();
  const listeners = new Set<(session: { id: string }, event: EventLike) => void>();
  const on: SessionEventsOn = (_name, listener) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  };
  const cancels: unknown[][] = [];
  const records: DeskTurnRecord[] = [];
  const lines: string[] = [];
  const agent = { cancel: (...args: unknown[]) => { cancels.push(args); } } as unknown as AgentLike;
  const dispose = superviseDeskTurns({
    on, sessionId: SID, agent, deadlineMs: 300_000, clock: time.clock,
    onTurnEnd: (record) => { records.push(record); }, log: (line) => { lines.push(line); }, ...over,
  });
  let seq = 0;
  return {
    time, cancels, records, lines, listeners, dispose,
    emit(type, data, sessionId = SID) {
      const event = { type, seq: seq++, data };
      for (const listener of [...listeners]) listener({ id: sessionId }, event);
    },
  };
}

const say = (text: string): { type: "text"; text: string }[] => [{ type: "text", text }];
const phone = (text: string) => createUserMessage({ content: say(`[telegram · operator · 14:03 ET]\n${text}`), source: { kind: "telegram", from: 42, chat: 42, messageId: 7 } });
const alert = () => createUserMessage({ content: say("[alert · NVDA · buy_zone]\nNVDA 181.50"), source: { kind: "alert", alert: "a-0001", symbol: "NVDA" } });
const firing = () => createUserMessage({ content: say("[schedule · preclose · 2026-10-20]\nrun the pre-close"), source: { kind: "schedule", order: "preclose", firing: "preclose:2026-10-20", date: "2026-10-20" } });
/** dsh-tool-jobs' wake: `{kind: "tool-jobs", form: "notice", summary}` (lib 276-281). */
const jobNotice = () => ({ id: "m-job", role: "user", content: say("job-1 finished"), source: { kind: "tool-jobs", form: "notice", summary: "job-1 finished" } });

/** The usage the stub reports per call in spike 2, and what one such attempt records. */
const USAGE = { inputTokens: 1200, outputTokens: 34, cacheReadTokens: 1000, cacheWriteTokens: 0, totalTokens: 2234 };
const RECORDED = { uncachedInputTokens: 1200, outputTokens: 34, cacheReadTokens: 1000, cacheWriteTokens: 0, routes: ["stub/echo"] };

/** An assistant message as the loop logs it, with the attempt's usage and route. */
function reply(turn: number, step: number, text: string, usage: object | undefined = USAGE, route = { provider: "stub", model: "echo" }) {
  return {
    turn, step,
    message: { id: `a-${turn}-${step}`, role: "assistant", content: say(text), source: { kind: "model", ...route } },
    ...(usage === undefined ? {} : { usage }),
  };
}

/** A turn's opening as the loop logs it: `turn/start`, `step/start`, then the claimed message, if any. */
function startTurn(h: Harness, turn: number, message?: unknown): void {
  h.emit("turn/start", { turn });
  h.emit("step/start", { turn, step: 1 });
  if (message !== undefined) h.emit("user/message", message);
}
/** Step `step` answers `text` and ends. */
function answer(h: Harness, turn: number, text: string, step = 1): void {
  h.emit("assistant/message", reply(turn, step, text));
  h.emit("step/end", { turn, step });
}
function endTurn(h: Harness, turn: number, reason: object = { kind: "completed" }): void {
  h.emit("turn/end", { turn, reason });
}
const ABORTED = { kind: "aborted", reason: { kind: "hook", reason: "desk deadline" } };
const DEADLINE_CANCEL = [{ kind: "hook", reason: "desk deadline" }, { keepInbox: true }];
const FENCE_CANCEL = [{ kind: "hook", reason: "desk fence" }, { keepInbox: true }];

test("superviseDeskTurns cancels at the deadline even with a card pending, and reports the final text and usage", async () => {
  const h = supervise();
  const t0 = h.time.clock.now();
  startTurn(h, 1, phone("note NVDA's close in the journal"));
  h.emit("assistant/message", reply(1, 1, "NVDA closed at 181.50 (IEX 15:59:58 ET); noting it."));
  h.emit("tool/call", { turn: 1, step: 1, callId: "c1", name: "write", arguments: "{}" });
  h.emit("approval/asked", { id: "ap-1", turn: 1, toolName: "write" }); // a card: the turn parks on it
  await h.time.fake.advance(299_999);
  assert.deepEqual(h.cancels, [], "not before the deadline");
  await h.time.fake.advance(1);
  assert.deepEqual(h.cancels, [DEADLINE_CANCEL], "at exactly the deadline, the card notwithstanding");
  await h.time.fake.advance(600_000);
  assert.equal(h.cancels.length, 1, "one cancel per turn; the deadline is never re-armed or extended");
  h.emit("step/end", { turn: 1, step: 1 });
  endTurn(h, 1, ABORTED);
  await h.time.fake.flush();
  assert.deepEqual(h.records, [{
    sessionId: SID, turn: 1, source: "telegram", message: { kind: "telegram", from: 42, chat: 42, messageId: 7 }, outcome: "timed-out",
    finalText: "NVDA closed at 181.50 (IEX 15:59:58 ET); noting it.", usage: RECORDED,
    startedAt: iso(t0), wallMs: 900_000, deadlineMs: 300_000,
  }]);
  assert.equal(h.time.pending.size, 0);
});

test("a second followup during a turn is supervised as its own turn", async () => {
  const h = supervise();
  const t0 = h.time.clock.now();
  startTurn(h, 1, phone("first"));
  await h.time.fake.advance(100_000);
  h.emit("agent/inbox/spliced", { target: "next-turn", start: 0, inserted: [phone("second")] }); // queued: no turn opens
  await h.time.fake.advance(20_000);
  answer(h, 1, "first answer");
  endTurn(h, 1);
  assert.equal(h.time.pending.size, 0, "turn 1's timer is cleared at its end, not left to fire on turn 2");
  startTurn(h, 2, phone("second")); // the loop claims the queued text straight away, at t0 + 120 s
  await h.time.fake.advance(250_000); // t0 + 370 s: past where turn 1's deadline would have fallen
  assert.deepEqual(h.cancels, [], "turn 1's deadline ended with turn 1");
  answer(h, 2, "second answer");
  endTurn(h, 2);
  startTurn(h, 3, phone("third"));
  await h.time.fake.advance(299_999);
  assert.deepEqual(h.cancels, []);
  await h.time.fake.advance(1);
  assert.deepEqual(h.cancels, [DEADLINE_CANCEL], "turn 3 is cut at its own deadline");
  endTurn(h, 3, ABORTED);
  await h.time.fake.flush();
  assert.deepEqual(h.records.map((r) => [r.turn, r.source, r.outcome, r.finalText, r.startedAt, r.wallMs]), [
    [1, "telegram", "ended", "first answer", iso(t0), 120_000],
    [2, "telegram", "ended", "second answer", iso(t0 + 120_000), 250_000],
    [3, "telegram", "timed-out", "", iso(t0 + 370_000), 300_000],
  ]);
  assert.deepEqual(h.time.armed, [300_000, 300_000, 300_000], "one timer per turn, each the full deadline");
  assert.equal(h.time.pending.size, 0);
});

/** The face's view of the desk, injected before a phone's text (src/desk-conversation.ts): context, never the turn's name. */
const deskState = () => createUserMessage({ content: say('[desk · state · 14:03 ET]\n{"holdings":[]}'), source: { kind: "desk", form: "state" } });

test("a turn is named by its first message that is not desk state, and its deadline asked there", async () => {
  const asked: string[] = [];
  const h = supervise({ deadlineFor: (kind) => { asked.push(kind); return kind === "alert" ? 90_000 : undefined; } });
  startTurn(h, 1, deskState());
  assert.deepEqual(asked, [], "the state names nothing");
  h.emit("user/message", phone("NVDA now?"));
  answer(h, 1, "NVDA 181.50");
  endTurn(h, 1);
  startTurn(h, 2, deskState());
  h.emit("user/message", alert());
  await h.time.fake.advance(90_000);
  assert.deepEqual(h.cancels, [DEADLINE_CANCEL], "the alert's own deadline, asked at the alert");
  endTurn(h, 2, ABORTED);
  startTurn(h, 3, phone("first"));
  h.emit("user/message", deskState());
  endTurn(h, 3);
  startTurn(h, 4, deskState());
  endTurn(h, 4);
  await h.time.fake.flush();
  assert.deepEqual(asked, ["telegram", "alert", "telegram"], "once per turn, at its first message that is not desk state");
  assert.deepEqual(h.records.map((r) => [r.turn, r.source, r.message, r.deadlineMs]), [
    [1, "telegram", { kind: "telegram", from: 42, chat: 42, messageId: 7 }, 300_000],
    [2, "alert", { kind: "alert", alert: "a-0001", symbol: "NVDA" }, 90_000],
    [3, "telegram", { kind: "telegram", from: 42, chat: 42, messageId: 7 }, 300_000],
    [4, "wake", undefined, 300_000],
  ]);
  assert.equal("message" in h.records[3], false, "no message key when only the state was claimed");
});

test("a turn opened by a tool-jobs notice reports source wake", async () => {
  const asked: string[] = [];
  const h = supervise({ deadlineFor: (kind) => { asked.push(kind); return undefined; } });
  startTurn(h, 1, jobNotice());
  answer(h, 1, "The backtest finished; the results are in the journal.");
  endTurn(h, 1);
  startTurn(h, 2); // a turn that claims no message at all
  endTurn(h, 2);
  startTurn(h, 3, firing());
  endTurn(h, 3);
  await h.time.fake.flush();
  assert.deepEqual(h.records.map((r) => r.source), ["wake", "wake", "schedule"]);
  assert.deepEqual(asked, ["wake", "schedule"], "the deadline is asked by the name the record reports");
});

test("usage: four buckets and provider/model routes; a missing bucket is 0, missing routes are []; none when the turn cannot be accounted", async () => {
  const h = supervise();
  startTurn(h, 1, phone("two routes"));
  answer(h, 1, "step one");
  h.emit("step/start", { turn: 1, step: 2 });
  h.emit("assistant/message", reply(1, 2, "step two", { inputTokens: 300, outputTokens: 6, cacheReadTokens: 2000, cacheWriteTokens: 100, totalTokens: 2406 }, { provider: "deepseek-official", model: "deepseek-flash" }));
  h.emit("step/end", { turn: 1, step: 2 });
  endTurn(h, 1);

  startTurn(h, 2, phone("no cache buckets, no route"));
  h.emit("assistant/message", reply(2, 1, "bare", { inputTokens: 10, outputTokens: 2, totalTokens: 12 }, { provider: "", model: "" }));
  h.emit("step/end", { turn: 2, step: 1 });
  endTurn(h, 2);

  startTurn(h, 3, phone("cut before the step closed"));
  h.emit("assistant/message", reply(3, 1, "half"));
  endTurn(h, 3, ABORTED); // no step/end: the attempt cannot be proven, so no usage at all

  await h.time.fake.flush();
  assert.deepEqual(h.records[0].usage, { uncachedInputTokens: 1500, outputTokens: 40, cacheReadTokens: 3000, cacheWriteTokens: 100, routes: ["stub/echo", "deepseek-official/deepseek-flash"] });
  assert.equal(h.records[0].finalText, "step one\n\nstep two");
  assert.deepEqual(h.records[1].usage, { uncachedInputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, routes: [] });
  assert.equal("usage" in h.records[2], false);
});

test("the fence runs at every turn's start and refuses a turn that starts over a violation", async () => {
  let violation: string | undefined;
  let checks = 0;
  const h = supervise({ fence: async () => { checks += 1; return violation; } });
  startTurn(h, 1, phone("clean"));
  await h.time.fake.flush();
  assert.deepEqual(h.cancels, []);
  answer(h, 1, "fine");
  endTurn(h, 1);

  violation = "desk/journal/.git";
  startTurn(h, 2, phone("over a planted .git"));
  await h.time.fake.flush();
  assert.deepEqual(h.cancels, [FENCE_CANCEL]);
  await h.time.fake.advance(300_000);
  assert.equal(h.cancels.length, 1, "a refused turn is not cancelled again at its deadline");
  endTurn(h, 2, { kind: "aborted", reason: { kind: "hook", reason: "desk fence" } });
  await h.time.fake.flush();

  assert.equal(checks, 2);
  assert.deepEqual(h.records.map((r) => [r.turn, r.outcome, r.violation]), [[1, "ended", undefined], [2, "refused", "desk/journal/.git"]]);
  assert.equal("violation" in h.records[0], false);
});

test("a fence check that settles after its turn ended leaves the turn recorded as it ended", async () => {
  let settle: (path: string | undefined) => void = () => {};
  const h = supervise({ fence: () => new Promise((resolve) => { settle = resolve; }) });
  startTurn(h, 1, phone("quick"));
  answer(h, 1, "done");
  endTurn(h, 1);
  await h.time.fake.flush();
  settle("desk/GRAVIT.md");
  await h.time.fake.flush();
  assert.deepEqual(h.cancels, []);
  assert.deepEqual(h.records.map((r) => [r.outcome, r.violation]), [["ended", undefined]]);
});

test("a fence check that rejects refuses the turn as desk/journal, with one line", async () => {
  const h = supervise({ fence: async () => { throw new Error("EACCES: permission denied, scandir"); } });
  startTurn(h, 4, phone("hello"));
  await h.time.fake.flush();
  assert.deepEqual(h.cancels, [FENCE_CANCEL]);
  endTurn(h, 4, { kind: "aborted" });
  await h.time.fake.flush();
  assert.deepEqual(h.records.map((r) => [r.outcome, r.violation]), [["refused", "desk/journal"]]);
  assert.equal(h.lines.length, 1);
  assert.match(h.lines[0], /^gravit-face: desk: .*turn 4.*EACCES: permission denied, scandir/);
});

test("a turn that ends on an error or a blocked pre-step is recorded as failed, with why", async () => {
  const h = supervise();
  const long = `HTTP 429: rate limited ${"x".repeat(300)}`;
  startTurn(h, 1, phone("NVDA now?"));
  endTurn(h, 1, { kind: "error", error: { message: `${long}\nretry-after: 30\n{"error":"too many requests"}`, code: "RATE_LIMITED", status: 429 } });
  startTurn(h, 2, phone("again"));
  endTurn(h, 2, { kind: "blocked" });
  startTurn(h, 3, phone("emoji"));
  endTurn(h, 3, { kind: "error", error: { message: "😀".repeat(250), code: "UNKNOWN" } });
  startTurn(h, 4, phone("no message"));
  endTurn(h, 4, { kind: "error", error: { message: "", code: "AUTH_FAILED" } });
  startTurn(h, 5, phone("fine"));
  answer(h, 5, "all good");
  endTurn(h, 5);
  startTurn(h, 6, phone("revoked"));
  endTurn(h, 6, { kind: "error", error: { message: "HTTP 401: the API key was revoked\n    at DeepSeekAdapter.request (lib/index.js:1993)\n    at async Agent.step", code: "AUTH_FAILED", status: 401 } });
  await h.time.fake.flush();
  assert.deepEqual(h.records.map((r) => [r.turn, r.outcome, r.error]), [
    [1, "failed", long.slice(0, 200)],
    [2, "failed", "blocked"],
    [3, "failed", "😀".repeat(200)],
    [4, "failed", "AUTH_FAILED"],
    [5, "ended", undefined],
    [6, "failed", "HTTP 401: the API key was revoked"],
  ]);
  assert.equal("error" in h.records[4], false, "an ended turn carries no error");
});

test("a deadline that cut the turn wins over the error its cancel ended in, and so does the fence", async () => {
  const late = supervise();
  startTurn(late, 1, phone("slow"));
  await late.time.fake.advance(300_000);
  assert.deepEqual(late.cancels, [DEADLINE_CANCEL]);
  endTurn(late, 1, { kind: "error", error: { message: "the request was aborted", code: "UNKNOWN" } });

  const fenced = supervise({ fence: async () => "desk/journal/.git" });
  startTurn(fenced, 1, phone("over a .git"));
  await fenced.time.fake.flush();
  assert.deepEqual(fenced.cancels, [FENCE_CANCEL]);
  endTurn(fenced, 1, { kind: "error", error: { message: "the request was aborted", code: "UNKNOWN" } });

  await late.time.fake.flush();
  await fenced.time.fake.flush();
  assert.deepEqual(late.records.map((r) => [r.outcome, r.error]), [["timed-out", undefined]]);
  assert.deepEqual(fenced.records.map((r) => [r.outcome, r.violation, r.error]), [["refused", "desk/journal/.git", undefined]]);
});

test("a fence check that rejects after its turn ended changes nothing and says nothing", async () => {
  let fail: (err: Error) => void = () => {};
  const h = supervise({ fence: () => new Promise((_resolve, reject) => { fail = reject; }) });
  startTurn(h, 1, phone("quick"));
  answer(h, 1, "done");
  endTurn(h, 1);
  await h.time.fake.flush();
  fail(new Error("EIO: i/o error, scandir"));
  await h.time.fake.flush();
  assert.deepEqual(h.cancels, []);
  assert.deepEqual(h.lines, [], "no line about a turn that is over");
  assert.deepEqual(h.records.map((r) => [r.outcome, r.violation]), [["ended", undefined]]);
});

test("deadlineFor shortens a turn's deadline by its source and never lengthens it", async () => {
  const deadlineFor = (kind: string): number | undefined => (kind === "alert" ? 90_000 : kind === "schedule" ? 400_000 : undefined);

  const cut = supervise({ deadlineFor });
  startTurn(cut, 1, alert());
  await cut.time.fake.advance(89_999);
  assert.deepEqual(cut.cancels, []);
  await cut.time.fake.advance(1);
  assert.deepEqual(cut.cancels, [DEADLINE_CANCEL], "an alert annotation is cut at 90 s");
  endTurn(cut, 1, ABORTED);

  const phoned = supervise({ deadlineFor });
  startTurn(phoned, 1, phone("NVDA now?"));
  await phoned.time.fake.advance(299_999);
  assert.deepEqual(phoned.cancels, [], "a phone turn under the same map runs on");
  await phoned.time.fake.advance(1);
  assert.deepEqual(phoned.cancels, [DEADLINE_CANCEL]);
  endTurn(phoned, 1, ABORTED);

  const longer = supervise({ deadlineFor });
  startTurn(longer, 1, firing());
  await longer.time.fake.advance(299_999);
  assert.deepEqual(longer.cancels, []);
  await longer.time.fake.advance(1);
  assert.deepEqual(longer.cancels, [DEADLINE_CANCEL], "400 s asked, 300 s given: the default is the ceiling");
  endTurn(longer, 1, ABORTED);

  for (const h of [cut, phoned, longer]) await h.time.fake.flush();
  assert.deepEqual([cut, phoned, longer].map((h) => h.records.map((r) => [r.source, r.outcome, r.deadlineMs, r.wallMs])), [
    [["alert", "timed-out", 90_000, 90_000]],
    [["telegram", "timed-out", 300_000, 300_000]],
    [["schedule", "timed-out", 300_000, 300_000]],
  ]);
  assert.deepEqual(cut.time.armed, [300_000, 90_000], "armed at the default at turn/start, re-armed from the turn's start once its source is known");
});

test("deadlineMs must be a whole number of ms a timer can hold; an invalid deadlineFor answer is ignored, with one line", async () => {
  for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648]) {
    assert.throws(() => supervise({ deadlineMs: bad }), /deadlineMs must be a whole number of milliseconds in 1\.\.2147483647/, String(bad));
  }
  supervise({ deadlineMs: 1 }).dispose();
  supervise({ deadlineMs: 2_147_483_647 }).dispose();

  for (const bad of [0, -5, 50.5, 3_000_000_000]) {
    const h = supervise({ deadlineFor: () => bad });
    startTurn(h, 1, alert());
    assert.equal(h.lines.length, 1, String(bad));
    assert.match(h.lines[0], /^gravit-face: desk: .*alert turn.*not a whole number of milliseconds in 1\.\.2147483647/, String(bad));
    await h.time.fake.advance(299_999);
    assert.deepEqual(h.cancels, [], String(bad));
    await h.time.fake.advance(1);
    assert.deepEqual(h.cancels, [DEADLINE_CANCEL], `${bad}: the default deadline stands`);
    endTurn(h, 1, ABORTED);
    await h.time.fake.flush();
    assert.equal(h.records[0].deadlineMs, 300_000);
  }

  const silent = supervise({ deadlineFor: () => Number.NaN });
  startTurn(silent, 1, alert());
  assert.deepEqual(silent.lines, [], "a non-finite answer changes nothing, as no answer does");
  silent.dispose();
});

test("a deadlineFor that throws leaves the turn on the default deadline, with one line", async () => {
  const h = supervise({ deadlineFor: () => { throw new Error("no deadline map"); } });
  startTurn(h, 1, alert());
  assert.equal(h.lines.length, 1);
  assert.match(h.lines[0], /^gravit-face: desk: .*alert turn.*no deadline map/);
  await h.time.fake.advance(299_999);
  assert.deepEqual(h.cancels, []);
  await h.time.fake.advance(1);
  assert.deepEqual(h.cancels, [DEADLINE_CANCEL]);
  endTurn(h, 1, ABORTED);
  await h.time.fake.flush();
  assert.deepEqual(h.records.map((r) => [r.source, r.outcome, r.deadlineMs]), [["alert", "timed-out", 300_000]]);
});

test("a source deadline already past when the turn's first message lands cancels at once", async () => {
  const h = supervise({ deadlineFor: () => 50 });
  startTurn(h, 1);
  await h.time.fake.advance(100); // the prompt's assembly took 100 ms
  h.emit("user/message", alert());
  assert.deepEqual(h.cancels, [], "never from inside the session's own append");
  await h.time.fake.flush();
  assert.deepEqual(h.cancels, [DEADLINE_CANCEL]);
  assert.equal(h.time.pending.size, 0, "the default timer is gone");
  endTurn(h, 1, ABORTED);
  await h.time.fake.flush();
  assert.deepEqual(h.records.map((r) => [r.outcome, r.deadlineMs]), [["timed-out", 50]]);
});

test("onTurnEnd runs after the append that ended the turn, and a throw from it is one line", async () => {
  const seen: number[] = [];
  const h = supervise({ onTurnEnd: (record) => { seen.push(record.turn); throw new Error("ledger exploded"); } });
  startTurn(h, 1, phone("hi"));
  answer(h, 1, "hello");
  assert.doesNotThrow(() => endTurn(h, 1));
  assert.deepEqual(seen, [], "not inside the bus listener");
  await h.time.fake.flush();
  assert.deepEqual(seen, [1]);
  assert.equal(h.lines.length, 1);
  assert.match(h.lines[0], /^gravit-face: desk: .*ledger exploded/);
});

test("an async onTurnEnd that rejects is one line, never an unhandled rejection", async () => {
  const unhandled: unknown[] = [];
  const probe = (reason: unknown): void => { unhandled.push(reason); };
  process.on("unhandledRejection", probe);
  try {
    const h = supervise({ onTurnEnd: async () => { throw new Error("the ledger is full"); } });
    startTurn(h, 1, phone("hi"));
    answer(h, 1, "hello");
    endTurn(h, 1);
    await h.time.fake.flush();
    await new Promise((done) => setTimeout(done, 20)); // past the process's check for unhandled rejections
    assert.deepEqual(unhandled, [], "the face exits on an unhandled rejection (main.ts installFailLoud)");
    assert.equal(h.lines.length, 1);
    assert.match(h.lines[0], /^gravit-face: desk: .*the ledger is full/);
  } finally {
    process.off("unhandledRejection", probe);
  }
});

test("an agent.cancel that throws is one line, never an exception out of the deadline's timer", async () => {
  const h = supervise({ agent: { cancel: () => { throw new Error("the loop is gone"); } } as unknown as AgentLike });
  startTurn(h, 1, phone("hi"));
  await h.time.fake.advance(300_000); // the timer fires and the cancel throws inside it
  assert.equal(h.lines.length, 1);
  assert.match(h.lines[0], /^gravit-face: desk: turn 1 on desk session session-desk could not be cancelled: the loop is gone$/);
  endTurn(h, 1);
  await h.time.fake.flush();
  assert.deepEqual(h.records.map((r) => [r.turn, r.outcome]), [[1, "timed-out"]], "the deadline fired: the record says so");
});

test("a turn/start while a turn is still open drops the open turn, with one line, and supervises the new one", async () => {
  const h = supervise();
  startTurn(h, 1, phone("first")); // its turn/end never reaches the bus
  await h.time.fake.advance(10_000);
  startTurn(h, 2, phone("second"));
  assert.equal(h.lines.length, 1);
  assert.match(h.lines[0], /^gravit-face: desk: turn 1 on desk session session-desk saw no turn\/end before turn 2 began; it goes unrecorded$/);
  assert.equal(h.time.pending.size, 1, "turn 1's timer went with it");
  await h.time.fake.advance(299_999);
  assert.deepEqual(h.cancels, [], "turn 2's deadline runs from turn 2's start");
  answer(h, 2, "two");
  endTurn(h, 2);
  endTurn(h, 1); // a late end for the dropped turn
  await h.time.fake.flush();
  assert.deepEqual(h.records.map((r) => [r.turn, r.finalText, r.wallMs]), [[2, "two", 299_999]]);
});

/* ---------- cuts: what is kept, what is recorded, what the phone is told ---------- */

/** A desk agent whose inbox and wake behave as dsh's (tests/inbox-fake.ts): what it was asked to cancel and to send. */
function inboxAgent(opts: { failFollowup?: (message: MessageLike) => boolean } = {}) {
  const model = new InboxModel();
  const cancels: unknown[][] = [];
  const followups: MessageLike[] = [];
  const agent = {
    id: SID,
    get status(): "idle" | "running" { return model.running ? "running" : "idle"; },
    inbox: model.inbox,
    followup(message: MessageLike): void {
      if (opts.failFollowup?.(message) === true) throw new Error("the session is closed");
      followups.push(message);
      model.send(message);
    },
    cancel(...args: unknown[]): void {
      cancels.push(args);
      model.cancel(args[1] as { keepInbox?: boolean } | undefined);
    },
  };
  return { agent: agent as unknown as AgentLike, model, cancels, followups };
}
const queued = (text: string): MessageLike => phone(text) as unknown as MessageLike;
const STOPPED = { kind: "hook", reason: "stopped from the phone" } as const;

test("cancelKeepingQueue cuts the turn under way, keeps the inbox, and sends each queued message again so the agent wakes for them, in order", () => {
  const second = queued("second");
  const third = queued("third");
  const { agent, model, cancels, followups } = inboxAgent();
  model.running = true;
  agent.followup(second);
  agent.followup(third);
  const lines: string[] = [];
  assert.equal(cancelKeepingQueue(agent, STOPPED, (line) => { lines.push(line); }), 2, "two messages sent again");
  assert.deepEqual(cancels, [[STOPPED, { keepInbox: true }]]);
  assert.deepEqual(model.pending.map((m) => m.id), [second.id, third.id], "both still queued, in the order they were sent");
  assert.deepEqual(followups.map((m) => m.id), [second.id, third.id, second.id, third.id], "each sent again after the cancel");
  assert.equal(model.converge(), true, "so the driver wakes for them once the cut turn has unwound");
  assert.deepEqual([model.claim()?.id, model.claim()?.id], [second.id, third.id]);
  assert.deepEqual(lines, []);

  /* The control: dsh's cancel keeping the inbox, and nothing more, leaves them queued and the driver asleep. */
  const bare = inboxAgent();
  bare.model.running = true;
  bare.agent.followup(queued("parked"));
  bare.agent.cancel(STOPPED, { keepInbox: true });
  assert.equal(bare.model.pending.length, 1, "kept");
  assert.equal(bare.model.converge(), false, "but nothing wakes the driver for it");
});

test("cancelKeepingQueue with nothing queued, or an agent with no inbox, only cancels; a message it cannot send again is one line", () => {
  const empty = inboxAgent();
  empty.model.running = true;
  assert.equal(cancelKeepingQueue(empty.agent, STOPPED, () => assert.fail("no line")), 0);
  assert.deepEqual(empty.cancels, [[STOPPED, { keepInbox: true }]]);
  assert.deepEqual(empty.followups, []);
  assert.equal(empty.model.converge(), false, "nothing to wake for");

  const cancels: unknown[][] = [];
  const bare = { id: SID, status: "running", cancel: (...args: unknown[]) => { cancels.push(args); } } as unknown as AgentLike;
  assert.equal(cancelKeepingQueue(bare, STOPPED, () => assert.fail("no line")), 0);
  assert.deepEqual(cancels, [[STOPPED, { keepInbox: true }]]);

  /* The second of three cannot be sent again: one line, and the first and the third are still answered. */
  const [first, second, third] = [queued("one"), queued("two"), queued("three")];
  const failing = inboxAgent({ failFollowup: (message) => message.id === second.id && failing.model.aborted });
  failing.model.running = true;
  for (const message of [first, second, third]) failing.agent.followup(message);
  const lines: string[] = [];
  assert.equal(cancelKeepingQueue(failing.agent, STOPPED, (line) => { lines.push(line); }), 2);
  assert.deepEqual(failing.model.pending.map((m) => m.id), [first.id, third.id]);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^gravit-face: desk: a message queued on desk session session-desk could not be queued again after the cut, and is lost: the session is closed$/);
  assert.equal(failing.model.converge(), true);

  /* A cancel that throws is the caller's: nothing is sent again. */
  const throwing = { id: SID, status: "running", followup: () => assert.fail("nothing sent"), cancel: () => { throw new Error("the loop is gone"); } } as unknown as AgentLike;
  assert.throws(() => cancelKeepingQueue(throwing, STOPPED, () => {}), /the loop is gone/);
});

test("the deadline's cut keeps the operator's later messages and wakes the agent for them; the fence's leaves them parked", async () => {
  const late = inboxAgent();
  const h = supervise({ agent: late.agent });
  late.model.running = true;
  startTurn(h, 1, phone("first"));
  late.agent.followup(queued("second")); // sent while turn 1 runs: it waits for a turn of its own
  await h.time.fake.advance(300_000);
  assert.deepEqual(late.cancels, [DEADLINE_CANCEL]);
  assert.deepEqual(late.model.pending.map((m) => m.content[0]?.text), ["[telegram · operator · 14:03 ET]\nsecond"]);
  assert.equal(late.model.converge(), true, "the timed-out turn leaves no later phone message queued in silence");

  const fenced = inboxAgent();
  const f = supervise({ agent: fenced.agent, fence: async () => "desk/journal/GRAVIT.md" });
  fenced.model.running = true;
  startTurn(f, 1, phone("first"));
  fenced.agent.followup(queued("second"));
  await f.time.fake.flush();
  assert.deepEqual(fenced.cancels, [FENCE_CANCEL]);
  assert.equal(fenced.followups.length, 1, "nothing sent again: a turn would open over the violation before its own check");
  assert.equal(fenced.model.pending.length, 1, "kept");
  assert.equal(fenced.model.converge(), false, "and left for the next post, which the owner's fence check refuses first");
});

test("a turn something else cancelled is recorded cancelled, with why; the supervisor's own cuts keep their outcomes", async () => {
  const h = supervise();
  const reasons: readonly object[] = [
    { kind: "aborted", reason: { kind: "hook", reason: "stopped from the phone" } },
    { kind: "aborted", reason: { kind: "hook", reason: "shutdown" } },
    { kind: "aborted", reason: { kind: "user" } },
    { kind: "aborted", reason: { kind: "disposed" } },
    { kind: "aborted", reason: { kind: "parent" } },
    { kind: "aborted" },
  ];
  for (const [i, reason] of reasons.entries()) {
    startTurn(h, i + 1, phone(`turn ${i + 1}`));
    endTurn(h, i + 1, reason);
  }
  await h.time.fake.flush();
  assert.deepEqual(h.records.map((r) => [r.turn, r.outcome, r.cancel, r.error]), [
    [1, "cancelled", "stopped from the phone", undefined],
    [2, "cancelled", "shutdown", undefined],
    [3, "cancelled", "stopped in the browser", undefined],
    [4, "cancelled", "its agent was disposed", undefined],
    [5, "cancelled", "its parent cancelled it", undefined],
    [6, "cancelled", "unknown", undefined],
  ]);

  /* The deadline's and the fence's own cuts are timed-out and refused, with no cancel. */
  const late = supervise();
  startTurn(late, 1, phone("slow"));
  await late.time.fake.advance(300_000);
  endTurn(late, 1, ABORTED);
  const fenced = supervise({ fence: async () => "desk/journal/.git" });
  startTurn(fenced, 1, phone("over a .git"));
  await fenced.time.fake.flush();
  endTurn(fenced, 1, { kind: "aborted", reason: { kind: "hook", reason: "desk fence" } });
  await late.time.fake.flush();
  await fenced.time.fake.flush();
  assert.deepEqual([...late.records, ...fenced.records].map((r) => [r.outcome, "cancel" in r]), [["timed-out", false], ["refused", false]]);
});

test("a turn cut mid-answer is marked interrupted: its final text ends in the message the cut interrupted", async () => {
  const h = supervise();
  /* the phone's /stop lands while the model is still writing */
  startTurn(h, 1, phone("tell me about NVDA"));
  h.emit("assistant/message", { ...reply(1, 1, "NVDA is trading at 18"), interrupted: true });
  endTurn(h, 1, { kind: "aborted", reason: { kind: "hook", reason: "stopped from the phone" } });
  /* the deadline lands mid-stream, after a tool has answered */
  startTurn(h, 2, phone("the filing?"));
  h.emit("assistant/message", reply(2, 1, "Let me read the filing."));
  h.emit("tool/result", { turn: 2, step: 1, callId: "c1" });
  h.emit("assistant/message", { ...reply(2, 2, "The 10-Q says revenue"), interrupted: true });
  await h.time.fake.advance(300_000);
  endTurn(h, 2, ABORTED);
  /* a text that was whole when the cut came - the turn then waited on a card - is no cut answer */
  startTurn(h, 3, phone("note it"));
  answer(h, 3, "Noting it.");
  await h.time.fake.advance(300_000);
  endTurn(h, 3, ABORTED);
  /* an interruption with no text of its own leaves the turn's text as it was: whole */
  startTurn(h, 4, phone("think hard"));
  h.emit("assistant/message", { turn: 4, step: 1, message: { id: "a-4-1", role: "assistant", content: [{ type: "thinking", thinking: "hm" }], source: { kind: "model", provider: "stub", model: "echo" } }, interrupted: true });
  endTurn(h, 4, { kind: "aborted", reason: { kind: "user" } });
  await h.time.fake.flush();
  assert.deepEqual(h.records.map((r) => [r.turn, r.outcome, r.finalText, r.interrupted]), [
    [1, "cancelled", "NVDA is trading at 18", true],
    [2, "timed-out", "The 10-Q says revenue", true],
    [3, "timed-out", "Noting it.", undefined],
    [4, "cancelled", "", undefined],
  ]);
  assert.equal("interrupted" in h.records[2], false, "no key on a turn whose text was whole");
});

test("another session's turns are not supervised, and the disposer clears every timer and the listener", async () => {
  const h = supervise();
  startTurn(h, 1, phone("here"));
  h.emit("turn/start", { turn: 9 }, "session-other");
  assert.deepEqual(h.time.armed, [300_000], "one timer: the desk's turn only");
  assert.equal(h.listeners.size, 1);
  h.dispose();
  assert.equal(h.listeners.size, 0);
  assert.equal(h.time.pending.size, 0);
  await h.time.fake.advance(600_000);
  assert.deepEqual(h.cancels, []);
  endTurn(h, 1);
  await h.time.fake.flush();
  assert.deepEqual(h.records, []);
  h.dispose();
});
