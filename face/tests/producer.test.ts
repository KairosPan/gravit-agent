// face/tests/producer.test.ts
/** The producer runner (src/producer.ts): the two environment allow-lists, the producer grammar and its
 * inverse, the script resolver, the real runner, the script producer (the hash pin, the private copy it
 * runs, the run directory's end) over a fake runner and end to end, the text cap and the duration
 * words. Offline. The fixtures sit INSIDE the repository, under tests/tmp/producer-<pid>/, and are
 * removed afterwards; the runner's interpreter is node itself (process.execPath), so the fixture
 * programs are JavaScript and no Python is needed. There, repo/ stands in for the repository root and
 * home/run for a firing's run base, <desk dir>/run: a script producer's private copy is made in it, and
 * every test checks the copy's run directory is gone. */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUILTIN_PRODUCERS, PRODUCER_TEXT_MAX, PYTHON_FLAGS, SCRIPT_MAX_BYTES, STDERR_LOG_MAX, STDERR_OVER, STDOUT_OVER, baseEnv, capText,
  defaultProducerRunner, formatDuration, formatProducer, isOverflow, parseProducer, producerEnv, readFileBytes, readScriptBytes, resolveScript,
  runPinnedScript, runScriptProducer,
  type ProducerInput, type ProducerOutput, type ProducerRunner, type RunResult,
} from "../src/producer.ts";

/* ---------- fixtures, inside the repository ---------- */

const TEST_DIR = join(dirname(fileURLToPath(import.meta.url)), "tmp", `producer-${process.pid}`);
/** The repository root a producer is given: GRAVIT_ROOT and its cwd. */
const ROOT = join(TEST_DIR, "repo");
const SCRIPTS = join(ROOT, "scripts");
/** The run base, outside the repository like <desk dir>/run; its parent exists, and the first run makes it. */
const RUN_BASE = join(TEST_DIR, "home", "run");

/** Reads stdin to its end, then reports it, its argv, a variable the parent holds, its cwd; "TRACE" to stderr. */
const ECHO = `let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { stdin += chunk; });
process.stdin.on("end", () => {
  process.stderr.write("TRACE");
  process.stdout.write(JSON.stringify({ stdin, argv: process.argv.slice(2), secret: process.env.SECRET ?? null, cwd: process.cwd() }));
});
`;

/** A script producer for the end-to-end test: JavaScript under a .py name, which node runs as CommonJS from
 * its private copy (the fixture directory's package.json says so). It reports its input, the NAMES of the
 * key-shaped variables it can see (never a value), GRAVIT_ROOT, its cwd and its own path, and writes two
 * lines to stderr. */
const E2E = `let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { stdin += chunk; });
process.stdin.on("end", () => {
  const names = Object.keys(process.env).filter((name) => /^(DEEPSEEK|TELEGRAM|APCA|ALPACA|ALPHA)_/.test(name)).sort();
  process.stderr.write("line one\\nline two");
  process.stdout.write(JSON.stringify({ input: JSON.parse(stdin), names, root: process.env.GRAVIT_ROOT ?? null, cwd: process.cwd(), script: __filename }));
});
`;

/** A script producer that leaves `<root>/<marker>` behind and prints `out`: proof of which bytes ran. It finds
 * the root as the module doc tells a producer to, GRAVIT_ROOT else its own file's parent directory, so it
 * would mark the root even if it ran in place. */
const marking = (marker: string, out: string): string =>
  `const path = require("path");\n`
  + `const root = process.env.GRAVIT_ROOT || path.resolve(__dirname, "..");\n`
  + `require("fs").writeFileSync(path.join(root, ${JSON.stringify(marker)}), "ran");\n`
  + `process.stdout.write(${JSON.stringify(out)});\n`;

const FIXTURES: Record<string, string> = {
  "echo.mjs": ECHO,
  "sleep.mjs": "setTimeout(() => {}, 60_000);\n",
  "flood.mjs": 'process.stdout.write("x".repeat(2 * 1024 * 1024));\n',
  "flood-err.mjs": 'process.stderr.write("e".repeat(2 * 1024 * 1024));\n',
  "crash.mjs": 'process.kill(process.pid, "SIGKILL");\n',
  "exit3.mjs": 'process.stdout.write("half"); process.exit(3);\n',
  "deaf.mjs": "process.exit(0);\n",
  "e2e.py": E2E,
  "ok.py": 'process.stdout.write("OK");\n',
  "fail.py": 'process.stdout.write("half"); process.exit(3);\n',
  "slow.py": "setTimeout(() => {}, 60_000);\n",
  "p.py": "print('p')\n",
};

before(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
  await mkdir(SCRIPTS, { recursive: true });
  await mkdir(dirname(RUN_BASE));
  /* CommonJS for the .py fixtures, above both the run base and scripts/: they run from their copies, and
   * would run in place as well - a runner that ran the file in scripts/ instead of its verified copy would
   * run the swapped bytes, and the markers would show it. */
  await writeFile(join(TEST_DIR, "package.json"), '{ "type": "commonjs" }\n');
  for (const [name, text] of Object.entries(FIXTURES)) await writeFile(join(SCRIPTS, name), text);
  /* resolveScript's cases beside p.py: a link that stays inside, a directory, a link out, a dangling link */
  await symlink("p.py", join(SCRIPTS, "alias.py"));
  await mkdir(join(SCRIPTS, "dir.py"));
  await writeFile(join(ROOT, "outside.py"), "print('out')\n");
  await symlink(join("..", "outside.py"), join(SCRIPTS, "out.py"));
  await symlink("nowhere.py", join(SCRIPTS, "dangling.py"));
});
after(() => rm(TEST_DIR, { recursive: true, force: true }));

const INPUT: ProducerInput = {
  order: "preclose", firing: "preclose:2026-10-21", date: "2026-10-21", dir: "desk",
  session: { open: "2026-10-21T13:30:00.000Z", close: "2026-10-21T20:00:00.000Z", early: false },
};

const GRAMMAR = "producer must be scripts/<file>.py or builtin:<name>";

/** The hex SHA-256 of a file's bytes: what `arm` pins. */
async function shaOf(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

/** Set `values` in process.env for the length of `body`, then put back exactly what was there. */
async function withEnv(values: Record<string, string>, body: () => Promise<void>): Promise<void> {
  const held = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
  Object.assign(process.env, values);
  try {
    await body();
  } finally {
    for (const [name, value] of Object.entries(held)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

/* ---------- the environment ---------- */

test("baseEnv and producerEnv keep their names and prefixes and nothing else", () => {
  const all = { PATH: "/bin", HOME: "/h", LANG: "en_US.UTF-8", LC_ALL: "C", TZ: "America/New_York", APCA_API_KEY_ID: "k", ALPACA_X: "a",
    ALPHA_DATA_FEED: "iex", DEEPSEEK_API_KEY: "d", TELEGRAM_BOT_TOKEN: "t", FACE_PYTHON: "p", PYTHONPATH: "/evil", NODE_OPTIONS: "--x", DSH_HOME: "/dsh", APCA_EMPTY: "" };
  assert.deepEqual(Object.keys(producerEnv(all)).sort(), ["ALPACA_X", "ALPHA_DATA_FEED", "APCA_API_KEY_ID", "HOME", "LANG", "LC_ALL", "PATH", "TZ"]);
  assert.deepEqual(Object.keys(baseEnv(all)).sort(), ["HOME", "LANG", "LC_ALL", "PATH", "TZ"]);
  assert.equal(producerEnv(all).APCA_API_KEY_ID, "k", "a kept value passes unchanged");
  assert.deepEqual(baseEnv({ PATH: "/bin", HOME: undefined, LANG: "" }), { PATH: "/bin" }, "unset and empty both drop");
  assert.deepEqual(producerEnv({ lc_all: "C", "APCA-X": "x", ALPHAX: "y", XAPCA_Y: "z", PATHS: "/p", HOMEDIR: "/h", GRAVIT_ROOT: "/elsewhere" }), {},
    "names are exact and prefixes whole, case and all; GRAVIT_ROOT is the runner's to set, never inherited");
});

/* ---------- the grammar ---------- */

test("parseProducer: one .py script under scripts/, a known builtin, nothing else", () => {
  assert.deepEqual(parseProducer("scripts/desk_capture.py"), { kind: "script", script: "scripts/desk_capture.py" });
  assert.deepEqual(parseProducer("builtin:brief"), { kind: "builtin", name: "brief" });
  assert.deepEqual(parseProducer("builtin:report"), { kind: "builtin", name: "report" });
  assert.deepEqual(parseProducer("builtin:nope"), { error: 'unknown builtin "nope"' });
  for (const bad of ["", "builtin:", "python scripts/x.py", "/abs/x.py", "scripts/../x.py", "scripts/sub/x.py", "desk/x.py", "scripts/",
    "scripts/.x.py", "scripts/x.mjs", "scripts/x"]) assert.deepEqual(parseProducer(bad), { error: GRAMMAR }, bad);
  for (const bad of ["scripts/x.py\n", " scripts/x.py", "scripts/x.py ", "scripts/x y.py", "scripts/-x.py", "scripts/x.PY", "./scripts/x.py",
    "builtin: brief", "builtin:brief extra", "builtin:../brief", "Builtin:brief"]) assert.deepEqual(parseProducer(bad), { error: GRAMMAR }, JSON.stringify(bad));
  for (const notText of [["scripts/x.py"], ["builtin:brief"], 7, null, undefined, { script: "scripts/x.py" }]) {
    assert.deepEqual(parseProducer(notText), { error: GRAMMAR }, `a YAML ${JSON.stringify(notText) ?? "undefined"} is not a producer`);
  }
  assert.deepEqual(BUILTIN_PRODUCERS, ["brief", "report"]);
});

test("formatProducer is parseProducer's inverse", () => {
  for (const text of ["scripts/desk_capture.py", "scripts/A-1.py", "builtin:brief"]) {
    const spec = parseProducer(text);
    if ("error" in spec) throw new Error(`${text}: ${spec.error}`);
    assert.equal(formatProducer(spec), text);
  }
});

/* ---------- the resolver ---------- */

test("resolveScript refuses a missing file, a directory and a link that leaves scripts/", async () => {
  const p = await realpath(join(SCRIPTS, "p.py"));
  assert.deepEqual(await resolveScript(ROOT, "scripts/p.py"), { path: p });
  assert.deepEqual(await resolveScript(ROOT, "scripts/alias.py"), { path: p }, "a link that stays inside scripts/ resolves to its target");
  assert.deepEqual(await resolveScript(ROOT, "scripts/nope.py"), { error: "scripts/nope.py is missing" });
  assert.deepEqual(await resolveScript(ROOT, "scripts/dangling.py"), { error: "scripts/dangling.py is missing" });
  assert.deepEqual(await resolveScript(ROOT, "scripts/dir.py"), { error: "scripts/dir.py is not a regular file" });
  assert.deepEqual(await resolveScript(ROOT, "scripts/out.py"), { error: "scripts/out.py leaves scripts/" });
  assert.deepEqual(await resolveScript(join(ROOT, "no-such-root"), "scripts/p.py"), { error: "scripts/p.py is missing" }, "no scripts/ at all");
});

/* ---------- the real runner ---------- */

test("defaultProducerRunner: no shell, argv as given, stdin in, env as given, stderr apart", async () => {
  const run = defaultProducerRunner(process.execPath, []);
  const echo = join(SCRIPTS, "echo.mjs");
  const cwd = await realpath(ROOT);
  await withEnv({ SECRET: "in the parent only" }, async () => {
    const r = await run([echo, "a b; rm -rf x"], { cwd: ROOT, env: { PATH: process.env.PATH }, timeoutMs: 10_000, stdin: '{"x":1}' });
    assert.equal(r.code, 0);
    assert.equal(r.timedOut, false);
    assert.equal(r.error, undefined);
    assert.deepEqual(JSON.parse(r.stdout), { stdin: '{"x":1}', argv: ["a b; rm -rf x"], secret: null, cwd });
    assert.equal(r.stderr, "TRACE");
    const given = await run([echo], { cwd: ROOT, env: { SECRET: "given" }, timeoutMs: 10_000 });
    assert.deepEqual(JSON.parse(given.stdout), { stdin: "", argv: [], secret: "given", cwd }, "a given variable arrives; no stdin is an ended, empty one");
  });
});

test("defaultProducerRunner never rejects: SIGKILL at the deadline, no interpreter, a flood, a signal, an unread stdin, a refused argv", async () => {
  const run = defaultProducerRunner(process.execPath, []);
  const at = (name: string) => join(SCRIPTS, name);
  const opts = { cwd: ROOT, env: {}, timeoutMs: 10_000 };

  const t0 = Date.now();
  assert.deepEqual(await run([at("sleep.mjs")], { ...opts, timeoutMs: 300 }), { code: null, stdout: "", stderr: "", timedOut: true });
  assert.ok(Date.now() - t0 < 5_000, "killed at the deadline");
  assert.deepEqual(await run([at("sleep.mjs")], { ...opts, timeoutMs: 0 }), { code: null, stdout: "", stderr: "", timedOut: true },
    "a zero deadline kills at once; it is never 'no deadline'");

  assert.deepEqual(await defaultProducerRunner("/no/such/python", [])([at("echo.mjs")], { ...opts, stdin: "{}" }),
    { code: null, stdout: "", stderr: "", timedOut: false, error: "ENOENT" });

  const flood = await run([at("flood.mjs")], opts);
  assert.equal(flood.error, "stdout over 1 MiB");
  assert.equal(flood.code, null);
  assert.equal(flood.timedOut, false);
  assert.equal(flood.stdout.length, 1_048_576, "what was read up to the limit");
  const floodErr = await run([at("flood-err.mjs")], opts);
  assert.equal(floodErr.error, "stderr over 1 MiB");
  assert.equal(floodErr.code, null);

  assert.deepEqual(await run([at("exit3.mjs")], opts), { code: 3, stdout: "half", stderr: "", timedOut: false });
  assert.deepEqual(await run([at("crash.mjs")], opts), { code: 137, stdout: "", stderr: "", timedOut: false },
    "a death by a signal it was not sent is the shell's 128 + n");
  assert.deepEqual(await run([at("deaf.mjs")], { ...opts, stdin: "y".repeat(4 * 1024 * 1024) }), { code: 0, stdout: "", stderr: "", timedOut: false },
    "a producer that never reads its stdin breaks the pipe, not the face");
  assert.deepEqual(await run(["a\0b"], opts), { code: null, stdout: "", stderr: "", timedOut: false, error: "ERR_INVALID_ARG_VALUE" });
});

/* ---------- the script producer ---------- */

test("runScriptProducer runs a private copy of the verified bytes, passes its input, keeps stderr out of the output and logs it once", async () => {
  const pinned = await shaOf(join(SCRIPTS, "p.py"));
  const calls: Array<{ argv: string[]; opts: Parameters<ProducerRunner>[1]; bytes: string; dirMode: number; fileMode: number }> = [];
  const fake = (result: Partial<RunResult>): ProducerRunner => async (argv, opts) => {
    calls.push({ argv, opts, bytes: await readFile(argv[0], "utf8"),
      dirMode: (await stat(dirname(argv[0]))).mode & 0o777, fileMode: (await stat(argv[0])).mode & 0o777 });
    return { code: 0, stdout: "", stderr: "", timedOut: false, ...result };
  };
  const logs: string[] = [];
  const log = (line: string): void => { logs.push(line); };
  const ticks = [1_000, 1_250];

  const r = await runScriptProducer({ root: ROOT, script: "scripts/p.py", sha256: pinned, runBase: RUN_BASE, input: INPUT, timeoutMs: 300_000, log,
    now: () => ticks.shift() ?? 0, run: fake({ stdout: '{"n":1}', stderr: "APCA_API_SECRET_KEY=s3cr3t\nTraceback" }) });
  assert.deepEqual(r, { output: { ok: true, text: '{"n":1}' }, code: 0, timedOut: false, wallMs: 250, chars: 7 });
  assert.deepEqual(logs, ["gravit-face: desk: producer scripts/p.py wrote to stderr: APCA_API_SECRET_KEY=s3cr3t⏎Traceback"]);
  assert.equal(JSON.stringify(r).includes("s3cr3t"), false, "stderr never reaches the output");
  assert.equal(calls.length, 1);
  const [call] = calls;
  const copy = call.argv[0];
  assert.equal(call.argv.length, 1);
  assert.equal(basename(copy), "p.py", "the copy keeps the script's name");
  assert.ok(basename(dirname(copy)).startsWith("gravit-producer-"), copy);
  assert.equal(dirname(dirname(copy)), RUN_BASE, "the run directory is made in the run base, never the system's temporary directory");
  assert.equal(call.bytes, "print('p')\n", "the copy holds the verified bytes");
  assert.equal(call.dirMode, 0o700);
  assert.equal(call.fileMode, 0o400);
  assert.deepEqual(call.opts, { cwd: ROOT, env: { ...producerEnv(process.env), GRAVIT_ROOT: ROOT }, timeoutMs: 300_000, stdin: JSON.stringify(INPUT) });
  assert.equal(existsSync(dirname(copy)), false, "the run directory is gone");
  assert.equal(existsSync(RUN_BASE), true, "the run base stays");

  const outputOf = async (result: Partial<RunResult>, timeoutMs = 300_000) =>
    (await runScriptProducer({ root: ROOT, script: "scripts/p.py", sha256: pinned, runBase: RUN_BASE, input: INPUT, timeoutMs, log, run: fake(result) })).output;
  assert.deepEqual(await outputOf({ code: 3, stdout: '{"ok":false,"error":"no keys"}' }), { ok: false, error: "exit 3", text: '{"ok":false,"error":"no keys"}' });
  assert.deepEqual(await outputOf({ code: null, timedOut: true, stdout: "partial" }), { ok: false, error: "timed out after 5 min" });
  assert.deepEqual(await outputOf({ code: null, timedOut: true }, 90_000), { ok: false, error: "timed out after 90 s" });
  assert.deepEqual(await outputOf({ code: null, error: "ENOENT" }), { ok: false, error: "could not start: ENOENT" });
  assert.deepEqual(await outputOf({ code: null, error: "stdout over 1 MiB", stdout: "x".repeat(10) }), { ok: false, error: "stdout over 1 MiB" });
  assert.deepEqual(await outputOf({ code: null, error: "stderr over 1 MiB" }), { ok: false, error: "stderr over 1 MiB" });
  assert.equal(logs.length, 1, "no stderr, no line");
  assert.ok(calls.every((c) => !existsSync(dirname(c.argv[0]))), "every run directory is gone");

  const before = calls.length;
  assert.deepEqual(await runScriptProducer({ root: ROOT, script: "../outside.py", sha256: pinned, runBase: RUN_BASE, input: INPUT, timeoutMs: 300_000, log, run: fake({}) }),
    { output: { ok: false, error: GRAMMAR }, code: null, timedOut: false, wallMs: 0, chars: 0 });
  assert.equal(calls.length, before, "a script outside the grammar never runs");
});

test("a script changed after its hash was taken is refused, and never runs", async () => {
  const path = join(SCRIPTS, "swap.py");
  await writeFile(path, marking("ran-armed", "ARMED"));
  const pinned = await shaOf(path);
  await writeFile(path, marking("ran-swapped", "SWAPPED"));
  const real = defaultProducerRunner(process.execPath, []);
  const runs: string[][] = [];
  const run: ProducerRunner = (argv, opts) => { runs.push(argv); return real(argv, opts); };
  const logs: string[] = [];
  const at = (sha256: string) => runScriptProducer({ root: ROOT, script: "scripts/swap.py", sha256, runBase: RUN_BASE, run, input: INPUT, timeoutMs: 10_000,
    log: (line) => { logs.push(line); }, now: () => 0 });

  assert.deepEqual(await at(pinned),
    { output: { ok: false, error: "scripts/swap.py changed since arming" }, code: null, timedOut: false, wallMs: 0, chars: 0, refused: "hash" });
  assert.deepEqual(runs, [], "nothing reached the runner");
  assert.equal(existsSync(join(ROOT, "ran-swapped")), false, "the changed script never ran");
  assert.equal(existsSync(join(ROOT, "ran-armed")), false);
  assert.deepEqual(logs, []);

  const repinned = await at(await shaOf(path));
  assert.deepEqual(repinned.output, { ok: true, text: "SWAPPED" }, "pinned again, the same file runs");
  assert.equal(existsSync(join(ROOT, "ran-swapped")), true);
});

test("the bytes run are the ones verified, even when the file changes between the read and the exec", async () => {
  const path = join(SCRIPTS, "race.py");
  await writeFile(path, marking("ran-verified", "VERIFIED"));
  const pinned = await shaOf(path);
  const real = defaultProducerRunner(process.execPath, []);
  /* the swap lands after the runner's check and its copy, just before the exec */
  const run: ProducerRunner = async (argv, opts) => {
    await writeFile(path, marking("ran-rewritten", "REWRITTEN"));
    return real(argv, opts);
  };
  const r = await runScriptProducer({ root: ROOT, script: "scripts/race.py", sha256: pinned, runBase: RUN_BASE, run, input: INPUT, timeoutMs: 10_000, log: () => {} });
  assert.deepEqual(r.output, { ok: true, text: "VERIFIED" });
  assert.equal(r.refused, undefined);
  assert.equal(existsSync(join(ROOT, "ran-verified")), true);
  assert.equal(existsSync(join(ROOT, "ran-rewritten")), false, "the rewritten original never ran");
  assert.equal(await readFile(path, "utf8"), marking("ran-rewritten", "REWRITTEN"), "the original was rewritten");
});

test("the run directory is gone afterwards: after an exit 0, a non-zero exit and a timeout", async () => {
  const real = defaultProducerRunner(process.execPath, []);
  const cases: Array<[script: string, timeoutMs: number, output: ProducerOutput]> = [
    ["scripts/ok.py", 10_000, { ok: true, text: "OK" }],
    ["scripts/fail.py", 10_000, { ok: false, error: "exit 3", text: "half" }],
    ["scripts/slow.py", 300, { ok: false, error: "timed out after 0.3 s" }],
  ];
  for (const [script, timeoutMs, output] of cases) {
    const copies: string[] = [];
    const run: ProducerRunner = (argv, opts) => { copies.push(argv[0]); return real(argv, opts); };
    const r = await runScriptProducer({ root: ROOT, script, sha256: await shaOf(join(ROOT, script)), runBase: RUN_BASE, run, input: INPUT, timeoutMs,
      log: () => {} });
    assert.deepEqual(r.output, output, script);
    assert.equal(copies.length, 1, script);
    assert.ok(basename(dirname(copies[0])).startsWith("gravit-producer-"), copies[0]);
    assert.equal(dirname(dirname(copies[0])), RUN_BASE, copies[0]);
    assert.equal(existsSync(dirname(copies[0])), false, `${script}: the run directory is gone`);
  }
});

test("a script that is missing, linked out, not a regular file or unreadable is refused as missing; a wrong pin as a hash; nothing runs", async () => {
  const runs: string[][] = [];
  const run: ProducerRunner = async (argv) => { runs.push(argv); return { code: 0, stdout: "", stderr: "", timedOut: false }; };
  const at = (script: string, sha256: string) =>
    runScriptProducer({ root: ROOT, script, sha256, runBase: RUN_BASE, run, input: INPUT, timeoutMs: 10_000, log: () => {}, now: () => 0 });
  const refusal = (refused: "hash" | "missing", error: string) =>
    ({ output: { ok: false, error }, code: null, timedOut: false, wallMs: 0, chars: 0, refused });
  const p = await shaOf(join(SCRIPTS, "p.py"));
  assert.deepEqual(await at("scripts/nope.py", p), refusal("missing", "scripts/nope.py is missing"));
  assert.deepEqual(await at("scripts/dangling.py", p), refusal("missing", "scripts/dangling.py is missing"));
  assert.deepEqual(await at("scripts/out.py", await shaOf(join(ROOT, "outside.py"))), refusal("missing", "scripts/out.py leaves scripts/"),
    "a link out of scripts/ is refused even when its target's bytes are the pinned ones");
  assert.deepEqual(await at("scripts/dir.py", p), refusal("missing", "scripts/dir.py is not a regular file"));
  const locked = join(SCRIPTS, "locked.py");
  await writeFile(locked, "print('locked')\n");
  const lockedSha = await shaOf(locked);
  await chmod(locked, 0o000);
  try {
    assert.deepEqual(await at("scripts/locked.py", lockedSha), refusal("missing", "scripts/locked.py is missing"),
      "a script that cannot be read cannot be verified: refused as missing, though its pin is right");
  } finally {
    await chmod(locked, 0o600);
  }
  assert.deepEqual(await at("scripts/p.py", "0".repeat(64)), refusal("hash", "scripts/p.py changed since arming"));
  assert.deepEqual(runs, [], "nothing reached the runner");
});

test("the run base: made 0700 when missing, refused when it is a symlink, a start failure when it cannot be made", async () => {
  const runs: string[][] = [];
  const run: ProducerRunner = async (argv) => { runs.push(argv); return { code: 0, stdout: "OK", stderr: "", timedOut: false }; };
  const p = await shaOf(join(SCRIPTS, "p.py"));
  const at = (runBase: string) =>
    runScriptProducer({ root: ROOT, script: "scripts/p.py", sha256: p, runBase, run, input: INPUT, timeoutMs: 10_000, log: () => {}, now: () => 0 });
  const startFailure = (error: string) => ({ output: { ok: false, error }, code: null, timedOut: false, wallMs: 0, chars: 0 });

  const fresh = join(TEST_DIR, "fresh", "run");
  await mkdir(dirname(fresh));
  assert.deepEqual((await at(fresh)).output, { ok: true, text: "OK" });
  assert.equal((await stat(fresh)).mode & 0o777, 0o700, "a missing run base is made 0700");
  assert.equal(dirname(dirname(runs[0][0])), fresh);

  const target = join(TEST_DIR, "elsewhere");
  await mkdir(target);
  const linked = join(TEST_DIR, "linked-run");
  await symlink(target, linked);
  assert.deepEqual(await at(linked), startFailure(`could not start: ${linked} is a symlink`));
  const dangling = join(TEST_DIR, "dangling-run");
  await symlink(join(TEST_DIR, "nowhere"), dangling);
  assert.deepEqual(await at(dangling), startFailure(`could not start: ${dangling} is a symlink`), "a dangling link is refused, not followed and made");
  assert.equal(existsSync(join(TEST_DIR, "nowhere")), false);

  assert.deepEqual(await at(join(TEST_DIR, "no-such-home", "run")), startFailure("could not start: ENOENT"), "no parents are made");
  const file = join(TEST_DIR, "a-file");
  await writeFile(file, "");
  assert.deepEqual(await at(file), startFailure("could not start: ENOTDIR"));
  assert.equal(runs.length, 1, "only the usable run base ran anything");
});

test("a run directory that cannot be removed is one log line, and the output stands", async () => {
  const logs: string[] = [];
  let runDir = "";
  /* the directory loses its write bit during the run, so the 0400 copy inside cannot be unlinked */
  const run: ProducerRunner = async (argv) => {
    runDir = dirname(argv[0]);
    await chmod(runDir, 0o500);
    return { code: 0, stdout: "OK", stderr: "", timedOut: false };
  };
  try {
    const r = await runScriptProducer({ root: ROOT, script: "scripts/p.py", sha256: await shaOf(join(SCRIPTS, "p.py")), runBase: RUN_BASE, input: INPUT,
      timeoutMs: 60_000, log: (line) => { logs.push(line); }, run });
    assert.deepEqual(r.output, { ok: true, text: "OK" });
    assert.deepEqual(logs, [`gravit-face: desk: producer scripts/p.py left its run directory ${runDir} behind: EACCES`]);
  } finally {
    if (runDir !== "") {
      await chmod(runDir, 0o700);
      await rm(runDir, { recursive: true, force: true });
    }
  }
});

test("a producer's stderr is one log line, cut at 2,000 characters", async () => {
  const logs: string[] = [];
  const run: ProducerRunner = async () => ({ code: 0, stdout: "ok", stderr: `a\r\nb\rc${"d".repeat(2_500)}`, timedOut: false });
  await runScriptProducer({ root: ROOT, script: "scripts/p.py", sha256: await shaOf(join(SCRIPTS, "p.py")), runBase: RUN_BASE, input: INPUT, timeoutMs: 60_000,
    log: (line) => { logs.push(line); }, run });
  assert.deepEqual(logs, [`gravit-face: desk: producer scripts/p.py wrote to stderr: a⏎b⏎c${"d".repeat(1_994)}⏎…[cut: 506 more characters]`]);
  assert.equal(STDERR_LOG_MAX, 2_000);
});

test("a script producer end to end: the real runner, the allow-listed environment and GRAVIT_ROOT, stdin JSON, stderr only in the log", async () => {
  await withEnv({ DEEPSEEK_API_KEY: "fake-deepseek", TELEGRAM_BOT_TOKEN: "fake-telegram", APCA_API_KEY_ID: "fake-apca" }, async () => {
    const logs: string[] = [];
    const r = await runScriptProducer({ root: ROOT, script: "scripts/e2e.py", sha256: await shaOf(join(SCRIPTS, "e2e.py")), runBase: RUN_BASE,
      run: defaultProducerRunner(process.execPath, []), input: INPUT, timeoutMs: 10_000, log: (line) => { logs.push(line); } });
    if (!r.output.ok) throw new Error(`the producer failed: ${r.output.error}`);
    const seen = JSON.parse(r.output.text) as { input: unknown; names: string[]; root: string | null; cwd: string; script: string };
    assert.deepEqual(seen.input, INPUT);
    assert.ok(seen.names.includes("APCA_API_KEY_ID"), "the market keys pass");
    assert.ok(!seen.names.includes("DEEPSEEK_API_KEY") && !seen.names.includes("TELEGRAM_BOT_TOKEN"), "the model's and the phone's keys never do");
    assert.equal(seen.root, ROOT, "GRAVIT_ROOT reaches the producer");
    assert.equal(seen.cwd, await realpath(ROOT));
    assert.equal(basename(seen.script), "e2e.py");
    assert.ok(basename(dirname(seen.script)).startsWith("gravit-producer-"), `it ran from its private copy: ${seen.script}`);
    assert.equal(dirname(dirname(seen.script)), await realpath(RUN_BASE), "in the run base");
    assert.equal(existsSync(dirname(seen.script)), false, "and the copy is gone");
    assert.equal(r.code, 0);
    assert.equal(r.chars, r.output.text.length);
    assert.equal(r.output.text.includes("line one"), false);
    assert.deepEqual(logs, ["gravit-face: desk: producer scripts/e2e.py wrote to stderr: line one⏎line two"]);
  });
});

/* ---------- the cap and the words ---------- */

test("capText cuts a long text once and never inside a surrogate pair", () => {
  const out = capText("x" + "😀".repeat(20_000));
  assert.equal(out.length, 40_001);
  assert.equal(out.cut, true);
  assert.ok(out.text.startsWith("x" + "😀".repeat(16_383) + "\n…[cut: "), "the kept part is 32,767 units: the pair at the cap is not split");
  assert.equal(out.text, "x" + "😀".repeat(16_383) + "\n…[cut: 7234 more characters]");
  assert.equal(PRODUCER_TEXT_MAX, 32_768);
  assert.deepEqual(capText("😀".repeat(20_000)), { text: "😀".repeat(16_384) + "\n…[cut: 7232 more characters]", cut: true, length: 40_000 },
    "a cap on a pair's boundary gives nothing up");
  assert.deepEqual(capText("y".repeat(32_768)), { text: "y".repeat(32_768), cut: false, length: 32_768 }, "at the cap nothing is cut");
  assert.deepEqual(capText("abcdef", 4), { text: "abcd\n…[cut: 2 more characters]", cut: true, length: 6 });
  assert.deepEqual(capText("", 4), { text: "", cut: false, length: 0 });
});

test("formatDuration: whole minutes in min, anything else in s", () => {
  assert.equal(formatDuration(300_000), "5 min");
  assert.equal(formatDuration(60_000), "1 min");
  assert.equal(formatDuration(10_800_000), "180 min");
  assert.equal(formatDuration(90_000), "90 s");
  assert.equal(formatDuration(30_000), "30 s");
  assert.equal(formatDuration(10_000), "10 s");
});

/* ---------- the fix wave: the process group, the interpreter's flags, the run base's spelling, the size bound ---------- */

test("the deadline kills the child's whole process group: a grandchild holding stdout dies with it", async () => {
  const pidFile = join(TEST_DIR, "grandchild.pid");
  /* the child starts a grandchild that inherits its stdout - so the pipe stays open after the child is gone - and sleeps */
  await writeFile(join(SCRIPTS, "spawner.mjs"), [
    'import { spawn } from "node:child_process";',
    'import { writeFileSync } from "node:fs";',
    'const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "inherit" });',
    "writeFileSync(process.argv[2], String(grandchild.pid));",
    'process.stdout.write("started");',
    "setTimeout(() => {}, 60_000);",
    "",
  ].join("\n"));
  const run = defaultProducerRunner(process.execPath, []);
  const t0 = Date.now();
  const r = await run([join(SCRIPTS, "spawner.mjs"), pidFile], { cwd: ROOT, env: { PATH: process.env.PATH }, timeoutMs: 1_000 });
  assert.ok(Date.now() - t0 < 10_000, "the run ends at its deadline, though a grandchild held the pipe");
  assert.equal(r.timedOut, true);
  assert.equal(r.code, null);
  assert.equal(r.stdout, "started", "what it wrote before the deadline is kept");
  const pid = Number(await readFile(pidFile, "utf8"));
  const alive = (): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  for (let i = 0; i < 40 && alive(); i++) await new Promise((done) => setTimeout(done, 50));
  assert.equal(alive(), false, `the grandchild ${pid} died with its group`);
});

test("defaultProducerRunner puts the interpreter's flags before the argv: -I by default, none when told", async () => {
  assert.deepEqual(PYTHON_FLAGS, ["-I"]);
  /* node as the interpreter: --no-warnings is a flag node takes, shown in process.execArgv */
  const shown = join(SCRIPTS, "flags.mjs");
  await writeFile(shown, "process.stdout.write(JSON.stringify({ execArgv: process.execArgv, argv: process.argv.slice(2) }));\n");
  const flagged = await defaultProducerRunner(process.execPath, ["--no-warnings"])([shown, "a"], { cwd: ROOT, env: {}, timeoutMs: 10_000 });
  assert.deepEqual(JSON.parse(flagged.stdout), { execArgv: ["--no-warnings"], argv: ["a"] });
  const bare = await defaultProducerRunner(process.execPath, [])([shown], { cwd: ROOT, env: {}, timeoutMs: 10_000 });
  assert.deepEqual(JSON.parse(bare.stdout), { execArgv: [], argv: [] });
});

test("a script producer runs isolated under the face's python: -I, no PYTHONPATH, no script directory on sys.path", async (t) => {
  const python = process.env.FACE_PYTHON || "python3";
  const probe = await defaultProducerRunner(python)(["-c", "print(1)"], { cwd: ROOT, env: baseEnv(process.env), timeoutMs: 30_000 });
  if (probe.code !== 0) {
    t.skip(`no ${python} to run`);
    return;
  }
  const path = join(SCRIPTS, "isolated.py");
  await writeFile(path, [
    "import json, os, sys",
    'print(json.dumps({"isolated": sys.flags.isolated, "path": sys.path, "root": os.environ.get("GRAVIT_ROOT")}))',
    "",
  ].join("\n"));
  await withEnv({ PYTHONPATH: join(TEST_DIR, "planted") }, async () => {
    const r = await runScriptProducer({ root: ROOT, script: "scripts/isolated.py", sha256: await shaOf(path), runBase: RUN_BASE,
      run: defaultProducerRunner(python), input: INPUT, timeoutMs: 30_000, log: () => {} });
    if (!r.output.ok) throw new Error(`the producer failed: ${r.output.error}`);
    const seen = JSON.parse(r.output.text) as { isolated: number; path: string[]; root: string };
    assert.equal(seen.isolated, 1, "isolated mode");
    assert.equal(seen.root, ROOT, "GRAVIT_ROOT is still given");
    assert.ok(!seen.path.some((entry) => entry.includes("planted") || entry.includes("gravit-producer-") || entry === ""),
      `neither PYTHONPATH, the copy's directory nor the cwd is on sys.path: ${seen.path.join(" ")}`);
  });
});

test("the run base is resolved first: a trailing slash cannot pass a symlinked one, and a relative one lands where it names", async () => {
  const runs: string[][] = [];
  const run: ProducerRunner = async (argv) => { runs.push(argv); return { code: 0, stdout: "OK", stderr: "", timedOut: false }; };
  const p = await shaOf(join(SCRIPTS, "p.py"));
  const at = (runBase: string) =>
    runScriptProducer({ root: ROOT, script: "scripts/p.py", sha256: p, runBase, run, input: INPUT, timeoutMs: 10_000, log: () => {}, now: () => 0 });
  const target = join(TEST_DIR, "slash-target");
  await mkdir(target);
  const linked = join(TEST_DIR, "slash-run");
  await symlink(target, linked);
  assert.deepEqual((await at(`${linked}/`)).output, { ok: false, error: `could not start: ${linked} is a symlink` },
    "lstat of the spelling with a slash would follow the link");
  assert.deepEqual(runs, []);
  const relativeBase = relative(process.cwd(), join(TEST_DIR, "relative-run"));
  assert.ok(!isAbsolute(relativeBase), relativeBase);
  assert.deepEqual((await at(relativeBase)).output, { ok: true, text: "OK" });
  assert.equal(dirname(dirname(runs[0][0])), join(TEST_DIR, "relative-run"), "the copy is made under the absolute run base");
});

test("a script over 1 MiB is never read whole: refused as changed since arming, nothing run", async () => {
  assert.equal(SCRIPT_MAX_BYTES, 1_048_576);
  const big = join(SCRIPTS, "big.py");
  await writeFile(big, `# ${"x".repeat(SCRIPT_MAX_BYTES)}\n`);
  assert.equal(await readScriptBytes(await realpath(big)), "oversized");
  assert.equal(await readScriptBytes(join(SCRIPTS, "p.py"), 5), "oversized", "the bound is the caller's");
  assert.deepEqual(await readScriptBytes(join(SCRIPTS, "p.py"), 11), Buffer.from("print('p')\n"), "a file at the bound reads");
  const runs: string[][] = [];
  const run: ProducerRunner = async (argv) => { runs.push(argv); return { code: 0, stdout: "", stderr: "", timedOut: false }; };
  const r = await runScriptProducer({ root: ROOT, script: "scripts/big.py", sha256: await shaOf(big), runBase: RUN_BASE, run, input: INPUT,
    timeoutMs: 10_000, log: () => {}, now: () => 0 });
  assert.deepEqual(r, { output: { ok: false, error: "scripts/big.py changed since arming" }, code: null, timedOut: false, wallMs: 0, chars: 0, refused: "hash" });
  assert.deepEqual(runs, []);
});

test("runPinnedScript: the copy path the clock shares - its arguments after the copy, its own words for a moved pin, its label", async () => {
  const calls: Array<{ argv: string[]; opts: Parameters<ProducerRunner>[1] }> = [];
  const run: ProducerRunner = async (argv, opts) => { calls.push({ argv, opts }); return { code: 0, stdout: "{}", stderr: "", timedOut: false }; };
  const p = await shaOf(join(SCRIPTS, "p.py"));
  const base = { root: ROOT, script: "scripts/p.py", runBase: RUN_BASE, run, cwd: ROOT, env: { PATH: "/bin" }, timeoutMs: 5_000, label: "the clock", log: () => {} };
  const ran = await runPinnedScript({ ...base, sha256: p, args: ["sessions", "--days", "10"] });
  assert.deepEqual(ran, { ran: { code: 0, stdout: "{}", stderr: "", timedOut: false } });
  assert.deepEqual(calls[0].argv.slice(1), ["sessions", "--days", "10"]);
  assert.equal(basename(calls[0].argv[0]), "p.py");
  assert.deepEqual(calls[0].opts, { cwd: ROOT, env: { PATH: "/bin" }, timeoutMs: 5_000 }, "no stdin given, none passed");
  assert.deepEqual(await runPinnedScript({ ...base, sha256: "0".repeat(64), changed: "changed since this face was built" }),
    { refused: "hash", error: "scripts/p.py changed since this face was built" });
  assert.deepEqual(await runPinnedScript({ ...base, script: "scripts/nope.py", sha256: p }), { refused: "missing", error: "scripts/nope.py is missing" });
  assert.deepEqual(await runPinnedScript({ ...base, sha256: p, runBase: join(TEST_DIR, "no-such-home", "run") }), { failed: "ENOENT" });
  assert.equal(calls.length, 1);
  assert.equal(isOverflow(STDOUT_OVER) && isOverflow(STDERR_OVER), true);
  assert.equal(isOverflow("ENOENT") || isOverflow(undefined), false);
});

test("an aborted run kills the producer's whole group", async () => {
  const pidFile = join(TEST_DIR, "abort.pids");
  /* the child starts a sleeping grandchild that holds its stdout, prints both pids, and sleeps */
  await writeFile(join(SCRIPTS, "abort-spawner.mjs"), [
    'import { spawn } from "node:child_process";',
    'import { writeFileSync } from "node:fs";',
    'const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "inherit" });',
    "writeFileSync(process.argv[2], JSON.stringify([process.pid, grandchild.pid]));",
    'process.stdout.write("started");',
    "setTimeout(() => {}, 60_000);",
    "",
  ].join("\n"));
  const run = defaultProducerRunner(process.execPath, []);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 200);
  const t0 = Date.now();
  const r = await run([join(SCRIPTS, "abort-spawner.mjs"), pidFile], { cwd: ROOT, env: { PATH: process.env.PATH }, timeoutMs: 30_000, signal: controller.signal });
  assert.ok(Date.now() - t0 < 2_000, "the run ends at the abort, though a grandchild held the pipe");
  assert.deepEqual({ code: r.code, timedOut: r.timedOut, error: r.error }, { code: null, timedOut: false, error: "aborted" });
  const pids = JSON.parse(await readFile(pidFile, "utf8")) as number[];
  const alive = (pid: number): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      assert.equal((error as NodeJS.ErrnoException).code, "ESRCH");
      return false;
    }
  };
  for (let i = 0; i < 40 && pids.some(alive); i++) await new Promise((done) => setTimeout(done, 50));
  for (const pid of pids) assert.equal(alive(pid), false, `${pid} died with its group`);

  /* a signal already aborted starts nothing that outlives it */
  const gone = new AbortController();
  gone.abort();
  const r2 = await run([join(SCRIPTS, "sleep.mjs")], { cwd: ROOT, env: { PATH: process.env.PATH }, timeoutMs: 30_000, signal: gone.signal });
  assert.deepEqual({ code: r2.code, timedOut: r2.timedOut, error: r2.error }, { code: null, timedOut: false, error: "aborted" });
});

test("an aborted script producer is { ok: false, error: aborted }, and runPinnedScript passes the signal on", async () => {
  const seen: Array<AbortSignal | undefined> = [];
  const run: ProducerRunner = async (_argv, opts) => {
    seen.push(opts.signal);
    return { code: null, stdout: "half", stderr: "", timedOut: false, error: "aborted" };
  };
  const controller = new AbortController();
  const ok = await shaOf(join(SCRIPTS, "ok.py"));
  const r = await runScriptProducer({ root: ROOT, script: "scripts/ok.py", sha256: ok, runBase: RUN_BASE, run, input: INPUT, timeoutMs: 5_000, log: () => {},
    signal: controller.signal });
  assert.deepEqual(r.output, { ok: false, error: "aborted" });
  assert.equal(seen[0], controller.signal);
  await runScriptProducer({ root: ROOT, script: "scripts/ok.py", sha256: ok, runBase: RUN_BASE, run, input: INPUT, timeoutMs: 5_000, log: () => {} });
  assert.equal(seen.length, 2);
  assert.equal(seen[1], undefined, "no signal given, none passed");
});

test("readFileBytes keeps the failure's code; readScriptBytes still reads it as missing", async () => {
  const dir = join(TEST_DIR, "bytes");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "f.txt"), "hello");
  await symlink("f.txt", join(dir, "link.txt"));
  assert.deepEqual(await readFileBytes(join(dir, "f.txt"), 5), Buffer.from("hello"));
  assert.equal(await readFileBytes(join(dir, "f.txt"), 4), "oversized");
  assert.equal(await readFileBytes(join(dir, "link.txt"), 100), "irregular");
  assert.equal(await readFileBytes(dir, 100), "irregular");
  assert.deepEqual(await readFileBytes(join(dir, "nope.txt"), 100), { errno: "ENOENT" });
  assert.deepEqual(await readFileBytes(join(dir, "f.txt", "below"), 100), { errno: "ENOTDIR" });
  assert.equal(await readScriptBytes(join(dir, "nope.txt")), "missing");
  assert.equal(await readScriptBytes(join(dir, "link.txt")), "irregular");
});
