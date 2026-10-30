/**
 * The Lunhui run-directory contract, `plugins/lunhui/lib/runs.mjs` (graft spec D4, D5, §5.1
 * "Anchoring"): stage 0's six cases - the strategy grammar is the face's channel grammar; a
 * strategy is refused without a readable THESIS.md, as a symbolic link and as an escape;
 * `analysis/` is made once and a run is created once; a run is refused by a bad id, as unknown and
 * as a link; a new file is never overwritten and the analysis lands by rename; the run id has its
 * documented form - then six on the same rule, that a link, symbolic or hard, is refused and never
 * followed: an `analysis/` that is a link or a file; `readText` on a link or a socket;
 * `writeMetrics` over a link; `writeAnalysis` with a link or a directory at its names; a strategy
 * directory swapped for a link after `resolveStrategy`; a run directory swapped for a link after
 * `createRun` - and `readText`'s 256 KiB cap. Then the run's states (modules spec §5.1, A4, A7,
 * A26): open, add evidence, seal; `snapshot_id` over the evidence bytes; one file per source; the
 * 256 KiB and 2 MiB bounds; another strategy's run; `readRun`'s fail-open metrics. Every case
 * builds its own tree under `mkdtemp`, with real `symlink`, `link` and socket calls, and removes
 * it when the case ends.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { link, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import {
  LunhuiError, RUN_ID_RE, STRATEGY_NAME_RE, addEvidence, createRun, evidenceId, newRunId, openRun, readEvidence, readRun, readText,
  resolveRun, resolveStrategy, sealRun, writeAnalysis, writeArtifact, writeMetrics, writeNew,
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

// The run's states (spec §5.1, A4, A7, A26): open, add evidence, seal, read back.

/** The meta of one source's reply, as a freeze row hands it to `addEvidence`. */
const meta = { received_at: "2026-10-23T07:00:01Z", session: "2026-10-23", host: "push2ex.eastmoney.com", delayed: false, truncated: false };

/** A strategies root holding `a` and `b`, each with its THESIS.md; the two strategies' resolved directories. */
async function twoStrategies(t: Cleanup): Promise<{ a: string, b: string }> {
  const root = await tempDir(t);
  for (const name of ["a", "b"]) {
    await mkdir(join(root, name));
    await writeFile(join(root, name, "THESIS.md"), `# ${name}\n`);
  }
  return { a: (await resolveStrategy(root, "a")).dir, b: (await resolveStrategy(root, "b")).dir };
}

test("runs: openRun writes run.json and metrics.json; addEvidence ids items and lists the file; sealRun fixes snapshot_id", async (t) => {
  const strategyDir = await oneStrategy(t);
  const { run, dir } = await openRun(strategyDir, "market", new Date("2026-10-23T07:00:00Z"));
  assert.match(run, /^\d{8}T\d{6}Z-[0-9a-f]{8}$/);
  assert.ok(run.startsWith("20261023T070000Z-"));
  assert.deepEqual((await readRun(dir)).manifest, {
    run, strategy: "s1", kind: "market", as_of: null, session: null, opened_at: "2026-10-23T07:00:00.000Z", sealed_at: null,
    snapshot_id: null, evidence: [], artifacts: [],
  });
  assert.deepEqual(JSON.parse(await readText(dir, "metrics.json")), { freezes: 0, calls: {}, rejections: {}, submitted: [] });

  const a = await addEvidence(dir, "limit-up", [{ code: "002982" }, { code: "600519" }], meta);
  assert.equal(a.ids.length, 2);
  assert.equal(a.ids[0], evidenceId({ code: "002982" }));
  assert.match(a.ids[1], /^ev_[0-9a-f]{24}$/);
  assert.equal(a.file, "evidence-limit-up.json");
  const text = await readText(dir, a.file);
  assert.equal(a.bytes, Buffer.byteLength(text));
  assert.equal(a.sha256, createHash("sha256").update(text).digest("hex"));
  assert.deepEqual(JSON.parse(text), {
    source: "limit-up", received_at: meta.received_at, session: "2026-10-23", host: meta.host, delayed: false, truncated: false,
    items: [{ code: "002982", id: a.ids[0] }, { code: "600519", id: a.ids[1] }],
  });
  assert.equal(await modeOf(join(dir, a.file)), 0o600);
  assert.deepEqual((await readRun(dir)).manifest.evidence, [
    { source: "limit-up", file: a.file, sha256: a.sha256, bytes: a.bytes, received_at: meta.received_at, session: "2026-10-23", host: meta.host, delayed: false },
  ]);

  const sealed = await sealRun(dir, new Date("2026-10-23T07:00:05Z"));
  assert.match(sealed.snapshot_id ?? "", /^snap_[0-9a-f]{64}$/);
  assert.equal(sealed.snapshot_id, `snap_${createHash("sha256").update(a.sha256).digest("hex")}`);
  assert.equal(sealed.as_of, "2026-10-23T07:00:01Z");
  assert.equal(sealed.session, "2026-10-23");
  assert.equal(sealed.sealed_at, "2026-10-23T07:00:05.000Z");
  assert.deepEqual((await readRun(dir)).manifest, sealed);
  await rejectsWith(addEvidence(dir, "boards", [{ code: "BK0715" }], meta), "RUN_SEALED");
  assert.deepEqual(await sealRun(dir), sealed); // idempotent
  assert.deepEqual((await readdir(dir)).sort(), ["evidence-limit-up.json", "metrics.json", "run.json"]);
  await assert.rejects(openRun(strategyDir, "both" as never), (error: unknown) => !(error instanceof LunhuiError));
});

test("runs: addEvidence admits an optional provider, fallback_from, query and reply_sha256 - into the evidence file, and provider and fallback_from into run.json; absent stays absent; a bad one is host code's bug", async (t) => {
  const { dir } = await openRun(await oneStrategy(t), "market");
  const plain = await addEvidence(dir, "quotes", [{ code: "600519" }], meta);
  const plainFile = JSON.parse(await readText(dir, plain.file));
  for (const key of ["provider", "fallback_from", "query", "reply_sha256"]) assert.equal(Object.hasOwn(plainFile, key), false, key);
  const eastmoney = await addEvidence(dir, "index", [{ code: "sh000001" }], { ...meta, provider: "东方财富" });
  assert.equal(JSON.parse(await readText(dir, eastmoney.file)).provider, "东方财富");
  const standIn = {
    ...meta, host: "quantapi.51ifind.com", provider: "同花顺问财", fallback_from: { provider: "东方财富" as const, code: "UPSTREAM_INVALID" },
    query: "A股 2026年10月23日涨跌幅 成交额 主力资金流向 所属概念", reply_sha256: "a".repeat(64),
  };
  const boards = await addEvidence(dir, "boards", [{ code: "THS:白酒概念" }], standIn);
  const text = JSON.parse(await readText(dir, boards.file));
  assert.deepEqual(
    [text.provider, text.fallback_from, text.query, text.reply_sha256],
    [standIn.provider, standIn.fallback_from, standIn.query, standIn.reply_sha256],
  );
  const entries = (await readRun(dir)).manifest.evidence as any[];
  assert.equal(Object.hasOwn(entries[0], "provider"), false);
  assert.equal(Object.hasOwn(entries[0], "fallback_from"), false);
  assert.equal(entries[1].provider, "东方财富");
  assert.equal(Object.hasOwn(entries[1], "fallback_from"), false);
  assert.equal(entries[2].provider, "同花顺问财");
  assert.deepEqual(entries[2].fallback_from, { provider: "东方财富", code: "UPSTREAM_INVALID" });
  assert.equal(Object.hasOwn(entries[2], "query"), false);
  assert.equal(Object.hasOwn(entries[2], "reply_sha256"), false);
  const other = await openRun(await oneStrategy(t), "market");
  for (const bad of [
    { provider: "" }, { provider: 1 }, { fallback_from: { provider: "腾讯行情", code: "X" } }, { fallback_from: { provider: "东方财富", code: "" } },
    { fallback_from: "东方财富" }, { query: 1 }, { reply_sha256: "abc" }, { reply_sha256: "A".repeat(64) },
  ]) {
    await assert.rejects(addEvidence(other.dir, "boards", [], { ...meta, ...bad } as any), (error: unknown) => error instanceof TypeError, JSON.stringify(bad));
  }
  assert.deepEqual((await readdir(other.dir)).sort(), ["metrics.json", "run.json"]);
});

test("runs: snapshot_id depends on the evidence bytes, not on the order the sources were added", async (t) => {
  const strategyDir = await oneStrategy(t);
  const later = { ...meta, received_at: "2026-10-23T07:00:03Z" };
  const snapshot = async (order: string[], quote = "600519") => {
    const { dir } = await openRun(strategyDir, "market");
    for (const source of order) {
      await addEvidence(dir, source, source === "quotes" ? [{ code: quote }] : [{ code: "BK0715" }], source === "quotes" ? later : meta);
    }
    return sealRun(dir);
  };
  const one = await snapshot(["quotes", "boards"]);
  const two = await snapshot(["boards", "quotes"]);
  assert.equal(one.snapshot_id, two.snapshot_id);
  assert.equal(one.as_of, "2026-10-23T07:00:03Z"); // the latest received_at, whichever source came first
  assert.equal(two.as_of, "2026-10-23T07:00:03Z");
  assert.notEqual((await snapshot(["quotes", "boards"], "000001")).snapshot_id, one.snapshot_id);
});

test("runs: sealRun's session is the latest evidence session, null for a run with no evidence", async (t) => {
  const strategyDir = await oneStrategy(t);
  const { dir } = await openRun(strategyDir, "market");
  await addEvidence(dir, "index", [{ code: "sh000001" }], { ...meta, session: "2026-10-23" });
  await addEvidence(dir, "quotes", [{ code: "600519" }], { ...meta, received_at: "2026-10-26T00:30:00Z", session: "2026-10-26" });
  await addEvidence(dir, "boards", [{ code: "BK0715" }], { ...meta, session: "2026-10-22" });
  assert.deepEqual((await readRun(dir)).manifest.evidence.map((entry) => entry.session), ["2026-10-23", "2026-10-26", "2026-10-22"]);
  assert.equal((await readRun(dir)).manifest.session, null); // open: no session yet
  const sealed = await sealRun(dir);
  assert.equal(sealed.session, "2026-10-26");
  assert.equal(sealed.as_of, "2026-10-26T00:30:00Z");
  const empty = await openRun(strategyDir, "strategy");
  assert.equal((await sealRun(empty.dir)).session, null);
});

test("runs: a second file for one source is SOURCE_FROZEN; a new source on the same run lands; a source name off the grammar throws a plain Error (host code's bug, never a LunhuiError)", async (t) => {
  const { dir } = await openRun(await oneStrategy(t), "strategy");
  await addEvidence(dir, "quotes", [{ code: "600519" }], meta);
  await rejectsWith(addEvidence(dir, "quotes", [{ code: "000001" }], meta), "SOURCE_FROZEN");
  // A stray file at the source's name, not listed in run.json, is refused the same way and left alone.
  await writeFile(join(dir, "evidence-index.json"), "{}");
  await rejectsWith(addEvidence(dir, "index", [{ code: "sh000001" }], meta), "SOURCE_FROZEN");
  await addEvidence(dir, "boards", [{ code: "BK0715" }], meta);
  assert.deepEqual((await readRun(dir)).manifest.evidence.map((entry) => entry.source), ["quotes", "boards"]);
  assert.equal(await readText(dir, "evidence-index.json"), "{}");
  for (const bad of ["Quotes", "1x", "a_b", "", "x".repeat(32), "../x", "a.b"]) {
    await assert.rejects(addEvidence(dir, bad, [], meta), (error: unknown) => error instanceof Error && !(error instanceof LunhuiError), bad);
  }
  await addEvidence(dir, "x".repeat(31), [], meta); // the longest name the grammar takes
});

test("runs: the limit-up source holds three full stamped pools under its own 1 MiB cap, and a file over 1 MiB still refuses", async (t) => {
  const { dir } = await openRun(await oneStrategy(t), "market");
  // A stamped pool row as the limit-up freeze writes one: about 390 bytes with its id.
  const row = (pool: string, i: number) => ({
    pool, c: String(600000 + i), m: 1, n: "示例电力", p: 5120, zdp: 10.04, amount: 412345678, ltsz: 6123456789.0,
    tshare: 6234567890.0, hs: 6.73, lbc: 3, fbt: 92500, lbt: 92500, fund: 185432100, zbc: 0, hybk: "电力",
    zttj: { days: 3, ct: 3 }, host: "push2ex.eastmoney.com", delayed: false,
  });
  const rows = ["zt", "zb", "yesterday"].flatMap((pool) => Array.from({ length: 500 }, (_, i) => row(pool, i)));
  const added = await addEvidence(dir, "limit-up", rows, meta);
  assert.ok(added.bytes > 256 * 1024 && added.bytes <= 1024 * 1024, String(added.bytes));
  assert.equal(JSON.parse(await readFile(join(dir, added.file), "utf8")).items.length, 1500);
  const other = await openRun(await oneStrategy(t), "market");
  await rejectsWith(addEvidence(other.dir, "limit-up", [{ blob: "x".repeat(1024 * 1024) }], meta), "EVIDENCE_TOO_LARGE");
  await assert.rejects(addEvidence(other.dir, "boards", rows, meta), (error: any) => {
    assert.equal(error.code, "EVIDENCE_TOO_LARGE");
    assert.match(error.message, /256 KiB/);
    assert.match(error.message, /没有写入/);
    assert.doesNotMatch(error.message, /缩小|范围/); // the freezes take no range to narrow
    return true;
  });
  assert.deepEqual((await readdir(other.dir)).sort(), ["metrics.json", "run.json"]);
});

test("runs: an evidence file over 256 KiB is EVIDENCE_TOO_LARGE; a run passing 2 MiB is RUN_TOO_LARGE; nothing is written in either case", async (t) => {
  const { dir } = await openRun(await oneStrategy(t), "market");
  const before = await readText(dir, "run.json");
  await rejectsWith(addEvidence(dir, "big", [{ blob: "x".repeat(256 * 1024) }], meta), "EVIDENCE_TOO_LARGE");
  assert.equal(await readText(dir, "run.json"), before);
  assert.deepEqual((await readdir(dir)).sort(), ["metrics.json", "run.json"]);
  // Eight files just under 256 KiB each pass 2 MiB at the ninth.
  const nearly = [{ blob: "x".repeat(255 * 1024) }];
  const sources = ["aa", "ab", "ac", "ad", "ae", "af", "ag", "ah"];
  for (const source of sources) await addEvidence(dir, source, nearly, meta);
  const full = await readText(dir, "run.json");
  const total = (await readRun(dir)).manifest.evidence.reduce((sum, entry) => sum + entry.bytes, 0);
  assert.ok(total <= 2 * 1024 * 1024 && total + 255 * 1024 > 2 * 1024 * 1024, String(total));
  await rejectsWith(addEvidence(dir, "ai", nearly, meta), "RUN_TOO_LARGE");
  assert.equal(await readText(dir, "run.json"), full);
  assert.equal((await readdir(dir)).filter((name) => name.startsWith("evidence-")).length, sources.length);
  await addEvidence(dir, "aj", [{ code: "600519" }], meta); // a small file still fits under the bound
});

test("runs: a run id of another strategy resolves to NO_SUCH_RUN under this one", async (t) => {
  const { a, b } = await twoStrategies(t);
  const { run } = await openRun(a, "strategy");
  await openRun(b, "strategy"); // b has an analysis/ of its own
  await rejectsWith(resolveRun(b, run), "NO_SUCH_RUN");
  assert.equal((await resolveRun(a, run)).run, run);
});

test("runs: readRun reads back both files; a missing or corrupt metrics.json reads as zeroed counts with metricsReset true; a missing run.json is NO_SUCH_RUN", async (t) => {
  const { dir } = await openRun(await oneStrategy(t), "market");
  const zero = { freezes: 0, calls: {}, rejections: {}, submitted: [] };
  const counted = { freezes: 2, calls: { emotion: 1 }, rejections: { emotion: ["SCHEMA"] }, submitted: ["emotion"] };
  await writeMetrics(dir, counted);
  assert.deepEqual(await readRun(dir), { manifest: (await readRun(dir)).manifest, metrics: counted, metricsReset: false });
  for (const corrupt of ["{", "[]", '{"freezes":"two"}', '{"freezes":1,"calls":{},"rejections":{}}']) {
    await writeFile(join(dir, "metrics.json"), corrupt);
    const read = await readRun(dir);
    assert.deepEqual(read.metrics, zero, corrupt);
    assert.equal(read.metricsReset, true);
  }
  await rm(join(dir, "metrics.json"));
  const reset = await readRun(dir);
  assert.deepEqual([reset.metrics, reset.metricsReset], [zero, true]);
  await writeMetrics(dir, reset.metrics); // the next write mirrors the zeroed counts back
  assert.deepEqual([(await readRun(dir)).metrics, (await readRun(dir)).metricsReset], [zero, false]);
  await writeFile(join(dir, "run.json"), "{");
  await rejectsWith(readRun(dir), "NO_SUCH_RUN");
  await rejectsWith(addEvidence(dir, "quotes", [], meta), "NO_SUCH_RUN");
  await rm(join(dir, "run.json"));
  await rejectsWith(readRun(dir), "NO_SUCH_RUN");
  await rejectsWith(sealRun(dir), "NO_SUCH_RUN");
});

test("runs: an item that is no plain object or carries its own id, and a meta off its shape, throw a plain Error and write nothing", async (t) => {
  const { dir } = await openRun(await oneStrategy(t), "market");
  const before = await readText(dir, "run.json");
  const hostBug = (error: unknown) => error instanceof TypeError && !(error instanceof LunhuiError);
  class Row { code = "600519"; }
  for (const item of [[1], null, "600519", 7, new Row(), { code: "600519", id: "ev_mine" }]) {
    await assert.rejects(addEvidence(dir, "quotes", [{ code: "000001" }, item], meta), hostBug, JSON.stringify(item));
  }
  for (const bad of [
    { ...meta, host: "" }, { ...meta, host: undefined }, { ...meta, delayed: "no" }, { ...meta, truncated: undefined },
    { ...meta, received_at: "soon" }, { ...meta, session: undefined }, { ...meta, session: "2026-10-2" },
    { ...meta, session: "2026-10-23T00:00:00Z" }, { ...meta, session: "2026-13-01" }, undefined,
  ]) {
    await assert.rejects(addEvidence(dir, "quotes", [{ code: "000001" }], bad as never), hostBug, JSON.stringify(bad));
  }
  assert.equal(await readText(dir, "run.json"), before);
  assert.deepEqual((await readdir(dir)).sort(), ["metrics.json", "run.json"]);
  await addEvidence(dir, "quotes", [Object.assign(Object.create(null), { code: "000001" })], meta); // a null-prototype object is plain
});

test("runs: a run.json write that fails after the evidence file landed removes the file, and the run reads as before", async (t) => {
  const { dir } = await openRun(await oneStrategy(t), "market");
  const before = await readRun(dir);
  await mkdir(join(dir, "run.pending.json")); // replaceFile refuses a directory at its staging name
  await rejectsWith(addEvidence(dir, "quotes", [{ code: "600519" }], meta), "NO_SUCH_RUN");
  assert.deepEqual((await readdir(dir)).sort(), ["metrics.json", "run.json", "run.pending.json"]);
  assert.deepEqual(await readRun(dir), before);
  await rm(join(dir, "run.pending.json"), { recursive: true });
  await addEvidence(dir, "quotes", [{ code: "600519" }], meta); // the source is not frozen by the failed try
  assert.equal((await readRun(dir)).manifest.evidence.length, 1);
});

test("runs: readEvidence reads a 600 KiB limit-up file under its own cap, refuses one over 256 KiB of another source, and never reads through a link", async (t) => {
  const { dir } = await openRun(await oneStrategy(t), "market");
  const limitUp = { source: "limit-up", session: "2026-10-23", items: [{ blob: "x".repeat(600 * 1024), id: "ev_0" }] };
  await writeNew(dir, "evidence-limit-up.json", JSON.stringify(limitUp));
  assert.deepEqual(await readEvidence(dir, "limit-up"), limitUp);
  await writeNew(dir, "evidence-boards.json", JSON.stringify({ source: "boards", items: [{ blob: "x".repeat(257 * 1024) }] }));
  const refusal = await rejectsWith(readEvidence(dir, "boards"), "NO_SUCH_RUN");
  assert.match(refusal.message, /256 KiB/);
  await rm(join(dir, "evidence-limit-up.json"));
  await writeNew(dir, "evidence-limit-up.json", JSON.stringify({ blob: "x".repeat(1024 * 1024) }));
  assert.match((await rejectsWith(readEvidence(dir, "limit-up"), "NO_SUCH_RUN")).message, /1 MiB/);
  // A symbolic and a hard link at the evidence name are refused, the outside file never read.
  const secret = join(await tempDir(t), "secret.json");
  await writeFile(secret, JSON.stringify({ items: ["outside secret"] }));
  await symlink(secret, join(dir, "evidence-index.json"));
  await rejectsWith(readEvidence(dir, "index"), "NO_SUCH_RUN");
  await link(secret, join(dir, "evidence-quotes.json"));
  assert.equal((await rejectsWith(readEvidence(dir, "quotes"), "NO_SUCH_RUN")).message.includes("outside secret"), false);
  await writeNew(dir, "evidence-news.json", "{ not json");
  await rejectsWith(readEvidence(dir, "news"), "NO_SUCH_RUN");
  await assert.rejects(readEvidence(dir, "../x"), (error: unknown) => error instanceof TypeError);
});

test("runs: writeArtifact lands <module>.json by rename and names the module in run.json artifacts", async (t) => {
  const { dir } = await openRun(await oneStrategy(t), "market");
  await writeArtifact(dir, "environment", { module: "environment", status: "OK" });
  assert.deepEqual(JSON.parse(await readFile(join(dir, "environment.json"), "utf8")), { module: "environment", status: "OK" });
  assert.equal(await modeOf(join(dir, "environment.json")), 0o600);
  assert.deepEqual((await readRun(dir)).manifest.artifacts, ["environment"]);
  await writeArtifact(dir, "sentiment", { module: "sentiment" });
  assert.deepEqual((await readRun(dir)).manifest.artifacts, ["environment", "sentiment"]);
  assert.deepEqual((await readdir(dir)).sort(), ["environment.json", "metrics.json", "run.json", "sentiment.json"]);
  await assert.rejects(writeArtifact(dir, "nope", {}), (error: unknown) => error instanceof TypeError);
});
