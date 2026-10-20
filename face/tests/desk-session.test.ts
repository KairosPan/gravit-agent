// face/tests/desk-session.test.ts
/** The desk session (src/desk-session.ts): the instruction-chain fence and its refusal line, the
 * provenance line, the desk's route, the ensure and create paths, and the supervisor every turn on
 * the session gets. Offline: a fake root context, a fake bus and a manual clock. The fence fixtures sit
 * INSIDE the repository, under tests/tmp/<pid>/, and are removed afterwards (spike 6: under $TMPDIR
 * the sandbox lets a desk write through, so the face's own fixtures stay where the desk's would). */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { DESK_PATH, readDesk } from "../src/cycle.ts";
import { appendEvent, readEvents } from "../src/desk.ts";
import { DESK_PRESET } from "../src/desk-preset.ts";
import {
  DESK_DEFAULT_ROUTE, FENCE_NAMES, createDeskAgent, deskJournalDir, ensureDeskSession, fenceRefusalLine, findDeskFenceViolation,
  findFenceViolation, provenanceLine, resolveDeskRoute, superviseDeskTurns,
  type CreateDeskAgentOptions, type DeskClock, type DeskSessionCtxLike, type DeskSessionDeps, type DeskTurnRecord,
  type SessionEventsOn, type SuperviseDeskTurnsDeps,
} from "../src/desk-session.ts";
import type { AgentCtxLike, AgentLike, ModelSelectionRefLike, ResumeMemberOptions, SessionLike } from "../src/room.ts";
import type { EventLike } from "../src/room-rules.ts";
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

test("findFenceViolation never follows a symlink, and returns the first violation in sorted order", async () => {
  const outside = await fixture("outside");
  await put(outside, "GRAVIT.md");
  const viaLink = await fixture("via-link");
  await symlink(outside, join(viaLink, "shared"));
  assert.equal(await findFenceViolation(viaLink), undefined);

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

test("findFenceViolation fails closed: a journal it cannot list is '.'", async () => {
  const file = join(await fixture("file-journal"), "journal");
  await writeFile(file, "a file where the journal should be");
  assert.equal(await findFenceViolation(file), ".");

  const loop = join(await fixture("loop-journal"), "journal");
  await symlink(loop, loop);
  assert.equal(await findFenceViolation(loop), ".", "ELOOP");
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
});

test("the desk contract names every fence name and the provenance forms the code writes", () => {
  const contract = readDesk(DESK_PATH);
  for (const name of FENCE_NAMES) assert.ok(contract.includes(name), `desk.md does not name ${name}`);
  assert.ok(contract.includes(provenanceLine({ kind: "telegram" }, new Date("2026-10-20T18:03:00Z"))), "the telegram line");
  assert.ok(contract.includes("[schedule · "), "the schedule prefix");
  assert.ok(contract.includes("[alert · "), "the alert prefix");
});

test("telegram, schedule and alert are message sources dsh-llm's createUserMessage accepts", () => {
  // The augmentation is what makes these three calls type-check (npm run typecheck covers tests/).
  const text = [{ type: "text" as const, text: "x" }];
  const sources = [
    createUserMessage({ content: text, source: { kind: "telegram", from: 42, chat: 42, messageId: 7 } }).source,
    createUserMessage({ content: text, source: { kind: "schedule", order: "preclose", firing: "preclose:2026-10-20", date: "2026-10-20" } }).source,
    createUserMessage({ content: text, source: { kind: "alert", alert: "a-0001", symbol: "NVDA" } }).source,
  ];
  assert.deepEqual(sources.map((s) => s.kind), ["telegram", "schedule", "alert"]);
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

/** The slice of a booted root the desk session reads, recording every call. A session's permission
 * preset is a durable fact here as in dsh: setup's pin, else this fake's user default ("read-only",
 * not the desk's) pinned at publication, and a resume finds whatever the log holds. */
class FakeDeskTree {
  readonly live = new Map<string, AgentLike>();
  readonly stored = new Map<string, string>();
  readonly created: CreateDeskAgentOptions[] = [];
  readonly resumed: ResumeMemberOptions[] = [];
  readonly mounts: string[] = [];
  readonly selections: ModelSelectionRefLike[] = [];
  readonly pins: { session: string; name: string; published: boolean }[] = [];
  readonly disposed: string[] = [];
  /** A preset some later announcement listener lays over the pin - the case the post-publication check exists for. */
  overrideAfterPublish: string | undefined;
  failDispose = false;

  private agentFor(id: string): AgentLike {
    const session: SessionLike = { id, header: {}, seq: 0, snapshotEvents: () => [], append: () => undefined };
    return { id, status: "idle", session, followup: () => {}, cancel: () => {} };
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
        const agent = this.agentFor(options.sessionId);
        await options.setup({ fakeAgentId: options.sessionId }, agent);
        this.live.set(options.sessionId, agent);
        if (!this.stored.has(options.sessionId)) this.stored.set(options.sessionId, "read-only");
        if (this.overrideAfterPublish !== undefined) this.stored.set(options.sessionId, this.overrideAfterPublish);
        return {
          agent,
          dispose: async () => {
            this.disposed.push(options.sessionId);
            if (this.failDispose) throw new Error("the loop would not stop");
            this.live.delete(options.sessionId);
          },
        };
      },
      resume: async (options) => {
        this.resumed.push(options);
        if (!this.stored.has(options.resumeSessionId)) throw new Error(`session "${options.resumeSessionId}" not found`);
        const agent = this.agentFor(options.resumeSessionId);
        await options.setup({ fakeAgentId: options.resumeSessionId }, agent);
        this.live.set(options.resumeSessionId, agent);
        return { agent };
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

test("ensureDeskSession refuses a desk session whose permission preset is not workspace-write", async () => {
  const root = await fixture("refuse-repo");
  const home = await fixture("refuse-home");
  const tree = new FakeDeskTree();
  const deps = sessionDeps(tree, root, home);

  // the operator switched the conversation to full access in the browser: neither the cold nor the live path prompts it
  await appendEvent(home, { t: "2026-10-20T13:00:00.000Z", kind: "desk-session", sessionId: "session-old", reason: "created" });
  tree.stored.set("session-old", "danger-full-access");
  await assert.rejects(ensureDeskSession(deps), /desk session session-old is "danger-full-access", not workspace-write/);
  assert.ok(tree.live.has("session-old"), "resumed, then refused");
  await assert.rejects(ensureDeskSession(deps), /desk session session-old is "danger-full-access", not workspace-write/);

  // a pin that does not hold after publication: refused, the new agent disposed, nothing recorded
  tree.overrideAfterPublish = "read-only";
  await assert.rejects(ensureDeskSession(deps, { fresh: true }), /is "read-only", not workspace-write/);
  assert.equal(tree.created.length, 1);
  assert.deepEqual(tree.disposed, [tree.created[0].sessionId]);
  assert.equal((await readEvents(home)).events.length, 1, "only the seeded record");
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
    sessionId: SID, turn: 1, source: "telegram", outcome: "timed-out",
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
