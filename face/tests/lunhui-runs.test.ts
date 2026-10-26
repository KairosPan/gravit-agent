/**
 * The Lunhui run-directory contract, `plugins/lunhui/runs.mjs` (spec D4, D5, §5.1 "Anchoring"): the
 * plan's six cases - the strategy grammar is the face's channel grammar; a strategy is refused
 * without a readable THESIS.md, as a symbolic link and as an escape; `analysis/` is made once and a
 * run is created once; a run is refused by a bad id, as unknown and as a link; a new file is never
 * overwritten and the analysis lands by rename; the run id has its documented form - then six on
 * the same rule, that a link, symbolic or hard, is refused and never followed: an `analysis/` that
 * is a link or a file; `readText` on a link or a socket; `writeMetrics` over a link; `writeAnalysis`
 * with a link or a directory at its names; a strategy directory swapped for a link after
 * `resolveStrategy`; a run directory swapped for a link after `createRun` - and `readText`'s
 * 256 KiB cap. Every case builds its own tree under `mkdtemp`, with real `symlink`, `link` and
 * socket calls, and removes it when the case ends.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { link, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LunhuiError, RUN_ID_RE, STRATEGY_NAME_RE, createRun, newRunId, readText, resolveRun, resolveStrategy, writeAnalysis,
  writeMetrics, writeNew,
} from "../plugins/lunhui/lib/runs.mjs";

/** The case context, as far as these helpers use it. */
type Cleanup = { after(fn: () => Promise<unknown>): unknown };

/** A fresh directory under the system temp directory, removed when the case ends. */
async function tempDir(t: Cleanup): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "lunhui-runs-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** A strategies root holding one strategy, `s1`, with its THESIS.md; the strategy's resolved directory. */
async function oneStrategy(t: Cleanup): Promise<string> {
  const root = await tempDir(t);
  await mkdir(join(root, "s1"));
  await writeFile(join(root, "s1", "THESIS.md"), "# s1\n");
  return (await resolveStrategy(root, "s1")).dir;
}

/** The permission bits of `path`. */
async function modeOf(path: string): Promise<number> {
  return (await stat(path)).mode & 0o777;
}

/** `promise` rejects with a `LunhuiError` carrying `code`, and the message opens with the code; returns the refusal. */
async function rejectsWith(promise: Promise<unknown>, code: string): Promise<LunhuiError> {
  let refusal: unknown;
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof LunhuiError, `a LunhuiError, not ${String(error)}`);
    assert.equal(error.code, code);
    assert.ok(error.message.startsWith(`${code}: `), error.message);
    refusal = error;
    return true;
  });
  assert.ok(refusal instanceof LunhuiError);
  return refusal;
}

test("the strategy grammar is the channel grammar", async () => {
  for (const ok of ["lunhui-s01-repair", "市场情绪", "a", "x".repeat(41)]) assert.ok(STRATEGY_NAME_RE.test(ok), ok);
  for (const bad of ["a b", "x.y", "..", "-lead", "x".repeat(42), ""]) assert.equal(STRATEGY_NAME_RE.test(bad), false, bad);
  // The face's grammar also takes a combining mark after the first character (हिन्दी carries
  // three), never one first; the two grammars are one expression, the literal in channels.ts.
  assert.ok(STRATEGY_NAME_RE.test("हिन्दी"));
  assert.equal(STRATEGY_NAME_RE.test("\u0301a"), false);
  const channels = await readFile(fileURLToPath(new URL("../src/channels.ts", import.meta.url)), "utf8");
  assert.ok(
    channels.includes(`const NAME_RE = ${STRATEGY_NAME_RE};`),
    "face/src/channels.ts NAME_RE changed: change STRATEGY_NAME_RE with it",
  );
});

test("resolveStrategy refuses a missing THESIS.md, a symlink and an escape", async (t) => {
  const root = await tempDir(t);
  const away = await tempDir(t);
  await mkdir(join(root, "real"));
  await writeFile(join(root, "real", "THESIS.md"), "# real\n");
  await mkdir(join(root, "bare")); // no THESIS.md
  await writeFile(join(root, "plain"), "# plain\n"); // a regular file, not a directory
  await symlink(join(root, "real"), join(root, "link")); // a link to the real one
  await writeFile(join(away, "THESIS.md"), "# away\n");
  await symlink(away, join(root, "away")); // a link out of the root
  await mkdir(join(root, "linked-thesis"));
  await symlink(join(root, "real", "THESIS.md"), join(root, "linked-thesis", "THESIS.md"));
  await mkdir(join(root, "folder-thesis", "THESIS.md"), { recursive: true });
  await mkdir(join(root, "caf\u00e9")); // made in NFC, as the face makes a channel
  await writeFile(join(root, "caf\u00e9", "THESIS.md"), "# caf\u00e9\n");
  await mkdir(join(root, "\u00e9".repeat(21)));
  await writeFile(join(root, "\u00e9".repeat(21), "THESIS.md"), "# \u00e9\n");

  const realRoot = await realpath(root);
  assert.deepEqual(await resolveStrategy(root, "real"), { name: "real", dir: join(realRoot, "real") });
  // Compared in NFC, as the face compares a channel name: the decomposed spelling is the same
  // strategy, and its length is counted composed (42 code points decomposed, 21 in NFC).
  assert.deepEqual(await resolveStrategy(root, "cafe\u0301"), { name: "caf\u00e9", dir: join(realRoot, "caf\u00e9") });
  assert.equal((await resolveStrategy(root, "e\u0301".repeat(21))).name, "\u00e9".repeat(21));
  for (const name of ["bare", "plain", "link", "away", "linked-thesis", "folder-thesis", "missing", "../etc", "real/..", "", 42]) {
    await rejectsWith(resolveStrategy(root, name), "NOT_A_STRATEGY");
  }
  if (process.getuid?.() !== 0) {
    // an unreadable THESIS.md (root reads any file, so the case needs another user)
    await mkdir(join(root, "sealed"));
    await writeFile(join(root, "sealed", "THESIS.md"), "# sealed\n", { mode: 0o000 });
    await rejectsWith(resolveStrategy(root, "sealed"), "NOT_A_STRATEGY");
  }
});

test("createRun makes analysis/ once and refuses a second create of the same run", async (t) => {
  const strategy = await oneStrategy(t);
  const analysis = join(strategy, "analysis");
  const first = newRunId(new Date("2026-10-13T01:00:22Z"));
  const second = newRunId(new Date("2026-10-13T01:00:23Z"));
  assert.equal(await createRun(strategy, first), join(analysis, first));
  assert.equal(await modeOf(analysis), 0o700);
  assert.equal(await modeOf(join(analysis, first)), 0o700);
  assert.equal(await createRun(strategy, second), join(analysis, second)); // the existing analysis/ is reused
  await rejectsWith(createRun(strategy, first), "RUN_EXISTS");
  await rejectsWith(createRun(strategy, "../escape"), "BAD_RUN_ID");
  assert.deepEqual((await readdir(analysis)).sort(), [first, second]);
});

test("resolveRun refuses a bad id, an unknown run and a symlinked run", async (t) => {
  const strategy = await oneStrategy(t);
  await rejectsWith(resolveRun(strategy, newRunId()), "NO_SUCH_RUN"); // no analysis/ yet
  const run = newRunId();
  const dir = await createRun(strategy, run);
  assert.deepEqual(await resolveRun(strategy, run), { run, dir });
  for (const bad of ["a/b", "x".repeat(65), "", "..", "a.b", 7]) await rejectsWith(resolveRun(strategy, bad), "BAD_RUN_ID");
  await rejectsWith(resolveRun(strategy, "20261013T010022Z-00000000"), "NO_SUCH_RUN"); // no such directory
  await symlink(dir, join(strategy, "analysis", "linked")); // a link to a real run
  await rejectsWith(resolveRun(strategy, "linked"), "NO_SUCH_RUN");
  await writeFile(join(strategy, "analysis", "plain"), ""); // a file, not a directory
  await rejectsWith(resolveRun(strategy, "plain"), "NO_SUCH_RUN");
});

test("writeNew never overwrites and writeAnalysis lands atomically", async (t) => {
  const dir = await createRun(await oneStrategy(t), newRunId());
  await writeNew(dir, "snapshot.json", '{"n":1}');
  await assert.rejects(writeNew(dir, "snapshot.json", '{"n":2}'), { code: "EEXIST" });
  assert.equal(await readText(dir, "snapshot.json"), '{"n":1}');
  assert.equal(await modeOf(join(dir, "snapshot.json")), 0o600);
  await writeFile(join(dir, "analysis.pending.json"), "{"); // what an interrupted write leaves behind
  await writeAnalysis(dir, { conclusion: "WAIT" });
  assert.deepEqual(JSON.parse(await readText(dir, "analysis.json")), { conclusion: "WAIT" });
  assert.equal(await modeOf(join(dir, "analysis.json")), 0o600);
  assert.deepEqual((await readdir(dir)).sort(), ["analysis.json", "snapshot.json"]);
});

test("newRunId has the documented form", () => {
  const at = new Date("2026-10-13T01:00:22Z");
  assert.match(newRunId(at), /^20261013T010022Z-[0-9a-f]{8}$/);
  assert.notEqual(newRunId(at), newRunId(at)); // the same second, eight random hex apart
  assert.ok(RUN_ID_RE.test(newRunId()));
  assert.throws(() => newRunId(new Date(Number.NaN)), RangeError);
});

test("an analysis/ that is a link or a file holds no run and gets none", async (t) => {
  const root = await tempDir(t);
  const away = await tempDir(t);
  const run = newRunId();
  await mkdir(join(away, run)); // a run the link would reach
  for (const name of ["linked", "dangling", "filed"]) {
    await mkdir(join(root, name));
    await writeFile(join(root, name, "THESIS.md"), `# ${name}\n`);
  }
  await symlink(away, join(root, "linked", "analysis"));
  await symlink(join(away, "nowhere"), join(root, "dangling", "analysis"));
  await writeFile(join(root, "filed", "analysis"), "");
  for (const name of ["linked", "dangling", "filed"]) {
    const { dir } = await resolveStrategy(root, name);
    await rejectsWith(resolveRun(dir, run), "NO_SUCH_RUN");
    await rejectsWith(createRun(dir, newRunId()), "NOT_A_STRATEGY");
  }
  assert.deepEqual(await readdir(away), [run]); // nothing was made through a link
});

test("readText reads only a regular file with one link, never through a link", async (t) => {
  const dir = await createRun(await oneStrategy(t), newRunId());
  const secret = join(await tempDir(t), "secret.txt");
  await writeFile(secret, "outside secret");
  const snapshot = join(dir, "snapshot.json");

  await rejectsWith(readText(dir, "snapshot.json"), "NO_SUCH_RUN"); // missing
  await symlink(secret, snapshot);
  await rejectsWith(readText(dir, "snapshot.json"), "NO_SUCH_RUN"); // a symbolic link
  await assert.rejects(writeNew(dir, "snapshot.json", "{}"), { code: "EEXIST" }); // `wx` takes no link
  await rm(snapshot);
  await link(secret, snapshot);
  const refusal = await rejectsWith(readText(dir, "snapshot.json"), "NO_SUCH_RUN"); // a hard link
  assert.equal(refusal.message.includes("outside secret"), false);
  await mkdir(join(dir, "notes.json"));
  await rejectsWith(readText(dir, "notes.json"), "NO_SUCH_RUN"); // a directory
  // A Unix socket, which open() refuses with an errno of its own: bound by a name relative to the
  // run directory, so its path fits the platform's socket-path limit.
  const server = createServer();
  const cwd = process.cwd();
  try {
    process.chdir(dir);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen("sock.json", () => resolve());
    });
  } finally {
    process.chdir(cwd);
  }
  try {
    const socketRefusal = await rejectsWith(readText(dir, "sock.json"), "NO_SUCH_RUN");
    assert.equal(socketRefusal.message.includes("/"), false); // the path-free reason, not open()'s error
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await writeNew(dir, "context.json", '{"ok":true}');
  assert.equal(await readText(dir, "context.json"), '{"ok":true}');

  for (const name of ["../escape.json", "a/b.json", ".hidden", ""]) {
    await assert.rejects(writeNew(dir, name, "x"), TypeError);
    await assert.rejects(readText(dir, name), TypeError);
  }
});

test("readText refuses a file over 256 KiB, spec §8's bound on a run, and reads one at the cap", async (t) => {
  const dir = await createRun(await oneStrategy(t), newRunId());
  const cap = 256 * 1024;
  await writeNew(dir, "context.json", "x".repeat(cap));
  assert.equal((await readText(dir, "context.json")).length, cap);
  await writeNew(dir, "snapshot.json", "x".repeat(cap + 1));
  const refusal = await rejectsWith(readText(dir, "snapshot.json"), "NO_SUCH_RUN");
  assert.match(refusal.message, /256 KiB/);
});

test("writeMetrics puts a fresh 0o600 file over metrics.json and never writes through a link", async (t) => {
  const dir = await createRun(await oneStrategy(t), newRunId());
  const victim = join(await tempDir(t), "victim.txt");
  await writeFile(victim, "victim", { mode: 0o644 });
  const metrics = join(dir, "metrics.json");

  await writeMetrics(dir, { toolCalls: 1 }); // no metrics.json yet: it is created
  assert.deepEqual(JSON.parse(await readText(dir, "metrics.json")), { toolCalls: 1 });
  assert.equal(await modeOf(metrics), 0o600);

  await rm(metrics);
  await writeFile(metrics, "{}", { mode: 0o644 }); // one another hand made, 0o644
  await writeMetrics(dir, { toolCalls: 2 });
  assert.equal(await modeOf(metrics), 0o600);

  await rm(metrics);
  await link(victim, metrics); // a hard link to a file outside the run
  const victimInode = (await stat(victim)).ino;
  await writeMetrics(dir, { toolCalls: 9 });
  assert.equal(await readFile(victim, "utf8"), "victim");
  assert.notEqual((await stat(metrics)).ino, victimInode);
  assert.equal(await modeOf(metrics), 0o600);
  assert.deepEqual(JSON.parse(await readText(dir, "metrics.json")), { toolCalls: 9 });

  // concurrent writers each land a whole file and leave no temporary file behind
  await Promise.all(Array.from({ length: 8 }, (_, i) => writeMetrics(dir, { toolCalls: 10 + i })));
  assert.ok(JSON.parse(await readText(dir, "metrics.json")).toolCalls >= 10);
  assert.deepEqual(await readdir(dir), ["metrics.json"]);

  await rm(metrics);
  await symlink(victim, metrics);
  await rejectsWith(writeMetrics(dir, { toolCalls: 3 }), "NO_SUCH_RUN"); // a symbolic link
  await rm(metrics);
  await mkdir(metrics);
  await rejectsWith(writeMetrics(dir, { toolCalls: 4 }), "NO_SUCH_RUN"); // a directory
  assert.equal(await readFile(victim, "utf8"), "victim");
});

test("writeAnalysis refuses a link or a directory at either of its names", async (t) => {
  const dir = await createRun(await oneStrategy(t), newRunId());
  const outside = join(await tempDir(t), "outside.txt");
  await writeFile(outside, "outside");
  for (const name of ["analysis.pending.json", "analysis.json"]) {
    for (const plant of [() => mkdir(join(dir, name)), () => symlink(outside, join(dir, name))]) {
      await plant();
      await rejectsWith(writeAnalysis(dir, { conclusion: "WAIT" }), "NO_SUCH_RUN");
      assert.deepEqual(await readdir(dir), [name]); // nothing else was written
      await rm(join(dir, name), { recursive: true });
    }
  }
  assert.equal(await readFile(outside, "utf8"), "outside");
  await writeAnalysis(dir, { conclusion: "WATCH" }); // with both names clear it lands
  assert.deepEqual(JSON.parse(await readText(dir, "analysis.json")), { conclusion: "WATCH" });
});

test("a strategy directory or its root swapped for a link after resolveStrategy is refused, and nothing is made through it", async (t) => {
  const root = await tempDir(t);
  const away = await tempDir(t);
  const run = newRunId();
  for (const name of ["s2", "s3"]) {
    await mkdir(join(root, name));
    await writeFile(join(root, name, "THESIS.md"), `# ${name}\n`);
  }
  await mkdir(join(away, "empty"));
  await mkdir(join(away, "with-run", "analysis", run), { recursive: true }); // a run the link would reach
  const s2 = (await resolveStrategy(root, "s2")).dir;
  const s3 = (await resolveStrategy(root, "s3")).dir;
  for (const [name, target] of [["s2", "empty"], ["s3", "with-run"]]) {
    await rename(join(root, name), join(root, `${name}-moved`));
    await symlink(join(away, target), join(root, name));
  }

  await rejectsWith(createRun(s2, newRunId()), "NOT_A_STRATEGY");
  assert.deepEqual(await readdir(join(away, "empty")), []); // not even analysis/ was made through the link
  await rejectsWith(resolveRun(s3, run), "NO_SUCH_RUN");
  await rejectsWith(createRun(s3, newRunId()), "NOT_A_STRATEGY");
  assert.deepEqual(await readdir(join(away, "with-run", "analysis")), [run]);

  await rm(join(root, "s2")); // and a strategy directory that is gone
  await rejectsWith(createRun(s2, newRunId()), "NOT_A_STRATEGY");
  await rejectsWith(resolveRun(s2, run), "NO_SUCH_RUN");

  // The strategies root itself swapped for a link: each strategy entry is still a real directory to
  // lstat, but its realpath is no longer the directory resolveStrategy returned.
  const parent = await tempDir(t);
  const swappedRoot = join(parent, "strategies");
  for (const name of ["s4", "s5"]) {
    await mkdir(join(swappedRoot, name), { recursive: true });
    await writeFile(join(swappedRoot, name, "THESIS.md"), `# ${name}\n`);
  }
  const s4 = (await resolveStrategy(swappedRoot, "s4")).dir;
  const s5 = (await resolveStrategy(swappedRoot, "s5")).dir;
  await mkdir(join(away, "root", "s4"), { recursive: true }); // no analysis/ for createRun to make
  await mkdir(join(away, "root", "s5", "analysis", run), { recursive: true }); // a run for resolveRun to reach
  await rename(swappedRoot, join(parent, "strategies-moved"));
  await symlink(join(away, "root"), swappedRoot);
  await rejectsWith(createRun(s4, newRunId()), "NOT_A_STRATEGY");
  assert.deepEqual(await readdir(join(away, "root", "s4")), []); // not even analysis/ was made through the link
  await rejectsWith(resolveRun(s5, run), "NO_SUCH_RUN");
  assert.deepEqual(await readdir(join(away, "root", "s5", "analysis")), [run]);
});

test("a run directory or its analysis/ swapped for a link after createRun is refused by every file operation", async (t) => {
  // The run directory itself swapped for a link to an outside directory holding a known file.
  const dir = await createRun(await oneStrategy(t), newRunId());
  const outside = await tempDir(t);
  await writeFile(join(outside, "snapshot.json"), "OUTSIDE");
  await rename(dir, `${dir}-moved`);
  await symlink(outside, dir);
  const refusal = await rejectsWith(readText(dir, "snapshot.json"), "NO_SUCH_RUN");
  assert.equal(refusal.message.includes("OUTSIDE"), false);
  await rejectsWith(writeNew(dir, "context.json", "{}"), "NO_SUCH_RUN");
  await rejectsWith(writeAnalysis(dir, { conclusion: "WAIT" }), "NO_SUCH_RUN");
  await rejectsWith(writeMetrics(dir, { toolCalls: 1 }), "NO_SUCH_RUN");
  assert.deepEqual(await readdir(outside), ["snapshot.json"]);
  assert.equal(await readFile(join(outside, "snapshot.json"), "utf8"), "OUTSIDE");

  // Its analysis/ swapped for a link to a tree that mirrors the run: the run directory is still a
  // real directory to lstat, but its realpath is no longer the one createRun returned.
  const strategy = await oneStrategy(t);
  const run = newRunId();
  const mirrored = await createRun(strategy, run);
  const mirror = await tempDir(t);
  await mkdir(join(mirror, run));
  await writeFile(join(mirror, run, "snapshot.json"), "OUTSIDE");
  await rename(join(strategy, "analysis"), join(strategy, "analysis-moved"));
  await symlink(mirror, join(strategy, "analysis"));
  await rejectsWith(readText(mirrored, "snapshot.json"), "NO_SUCH_RUN");
  await rejectsWith(writeNew(mirrored, "context.json", "{}"), "NO_SUCH_RUN");
  await rejectsWith(writeAnalysis(mirrored, { conclusion: "WAIT" }), "NO_SUCH_RUN");
  await rejectsWith(writeMetrics(mirrored, { toolCalls: 1 }), "NO_SUCH_RUN");
  assert.deepEqual(await readdir(join(mirror, run)), ["snapshot.json"]);
});
