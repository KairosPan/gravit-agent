// face/tests/producer.test.ts
/** The producer runner (src/producer.ts): the two environment allow-lists, the producer grammar and its
 * inverse, the script resolver, the real runner, the script producer (the hash pin, the private copy it
 * runs, the run directory's end) over a fake runner and end to end, the text cap and the duration
 * words. Offline. The fixtures sit INSIDE the repository, under tests/tmp/producer-<pid>/, and are
 * removed afterwards; the runner's interpreter is node itself (process.execPath), so the fixture
 * programs are JavaScript and no Python is needed. A script producer's private copy lives where the
 * module puts it, under the system's temporary directory, and every test checks it is gone. */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUILTIN_PRODUCERS, PRODUCER_TEXT_MAX, STDERR_LOG_MAX, baseEnv, capText, defaultProducerRunner, formatDuration, formatProducer,
  parseProducer, producerEnv, resolveScript, runScriptProducer,
  type ProducerInput, type ProducerOutput, type ProducerRunner, type RunResult,
} from "../src/producer.ts";

/* ---------- fixtures, inside the repository ---------- */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "tmp", `producer-${process.pid}`);
const SCRIPTS = join(ROOT, "scripts");

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
 * its private copy (no package.json lies above the temporary directory). It reports its input, the NAMES
 * of the key-shaped variables it can see (never a value), GRAVIT_ROOT, its cwd and its own path, and
 * writes two lines to stderr. */
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
  await rm(ROOT, { recursive: true, force: true });
  await mkdir(SCRIPTS, { recursive: true });
  /* CommonJS here too, so the .py fixtures would run in place as well: a runner that ran the file in
   * scripts/ instead of its verified copy would run the swapped bytes, and the markers would show it. */
  await writeFile(join(ROOT, "package.json"), '{ "type": "commonjs" }\n');
  for (const [name, text] of Object.entries(FIXTURES)) await writeFile(join(SCRIPTS, name), text);
  /* resolveScript's cases beside p.py: a link that stays inside, a directory, a link out, a dangling link */
  await symlink("p.py", join(SCRIPTS, "alias.py"));
  await mkdir(join(SCRIPTS, "dir.py"));
  await writeFile(join(ROOT, "outside.py"), "print('out')\n");
  await symlink(join("..", "outside.py"), join(SCRIPTS, "out.py"));
  await symlink("nowhere.py", join(SCRIPTS, "dangling.py"));
});
after(() => rm(ROOT, { recursive: true, force: true }));

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
  assert.deepEqual(parseProducer("builtin:report"), { error: 'unknown builtin "report"' });
  for (const bad of ["", "builtin:", "python scripts/x.py", "/abs/x.py", "scripts/../x.py", "scripts/sub/x.py", "desk/x.py", "scripts/",
    "scripts/.x.py", "scripts/x.mjs", "scripts/x"]) assert.deepEqual(parseProducer(bad), { error: GRAMMAR }, bad);
  for (const bad of ["scripts/x.py\n", " scripts/x.py", "scripts/x.py ", "scripts/x y.py", "scripts/-x.py", "scripts/x.PY", "./scripts/x.py",
    "builtin: brief", "builtin:brief extra", "builtin:../brief", "Builtin:brief"]) assert.deepEqual(parseProducer(bad), { error: GRAMMAR }, JSON.stringify(bad));
  for (const notText of [["scripts/x.py"], ["builtin:brief"], 7, null, undefined, { script: "scripts/x.py" }]) {
    assert.deepEqual(parseProducer(notText), { error: GRAMMAR }, `a YAML ${JSON.stringify(notText) ?? "undefined"} is not a producer`);
  }
  assert.deepEqual(BUILTIN_PRODUCERS, ["brief"]);
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
  const run = defaultProducerRunner(process.execPath);
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
  const run = defaultProducerRunner(process.execPath);
  const at = (name: string) => join(SCRIPTS, name);
  const opts = { cwd: ROOT, env: {}, timeoutMs: 10_000 };

  const t0 = Date.now();
  assert.deepEqual(await run([at("sleep.mjs")], { ...opts, timeoutMs: 300 }), { code: null, stdout: "", stderr: "", timedOut: true });
  assert.ok(Date.now() - t0 < 5_000, "killed at the deadline");
  assert.deepEqual(await run([at("sleep.mjs")], { ...opts, timeoutMs: 0 }), { code: null, stdout: "", stderr: "", timedOut: true },
    "a zero deadline kills at once; it is never 'no deadline'");

  assert.deepEqual(await defaultProducerRunner("/no/such/python")([at("echo.mjs")], { ...opts, stdin: "{}" }),
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
  const tmp = await realpath(tmpdir());
  const calls: Array<{ argv: string[]; opts: Parameters<ProducerRunner>[1]; bytes: string; dirMode: number; fileMode: number }> = [];
  const fake = (result: Partial<RunResult>): ProducerRunner => async (argv, opts) => {
    calls.push({ argv, opts, bytes: await readFile(argv[0], "utf8"),
      dirMode: (await stat(dirname(argv[0]))).mode & 0o777, fileMode: (await stat(argv[0])).mode & 0o777 });
    return { code: 0, stdout: "", stderr: "", timedOut: false, ...result };
  };
  const logs: string[] = [];
  const log = (line: string): void => { logs.push(line); };
  const ticks = [1_000, 1_250];

  const r = await runScriptProducer({ root: ROOT, script: "scripts/p.py", sha256: pinned, input: INPUT, timeoutMs: 300_000, log,
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
  assert.equal(await realpath(dirname(dirname(copy))), tmp, "the run directory sits in the system's temporary directory");
  assert.equal(call.bytes, "print('p')\n", "the copy holds the verified bytes");
  assert.equal(call.dirMode, 0o700);
  assert.equal(call.fileMode, 0o400);
  assert.deepEqual(call.opts, { cwd: ROOT, env: { ...producerEnv(process.env), GRAVIT_ROOT: ROOT }, timeoutMs: 300_000, stdin: JSON.stringify(INPUT) });
  assert.equal(existsSync(dirname(copy)), false, "the run directory is gone");

  const outputOf = async (result: Partial<RunResult>, timeoutMs = 300_000) =>
    (await runScriptProducer({ root: ROOT, script: "scripts/p.py", sha256: pinned, input: INPUT, timeoutMs, log, run: fake(result) })).output;
  assert.deepEqual(await outputOf({ code: 3, stdout: '{"ok":false,"error":"no keys"}' }), { ok: false, error: "exit 3", text: '{"ok":false,"error":"no keys"}' });
  assert.deepEqual(await outputOf({ code: null, timedOut: true, stdout: "partial" }), { ok: false, error: "timed out after 5 min" });
  assert.deepEqual(await outputOf({ code: null, timedOut: true }, 90_000), { ok: false, error: "timed out after 90 s" });
  assert.deepEqual(await outputOf({ code: null, error: "ENOENT" }), { ok: false, error: "could not start: ENOENT" });
  assert.deepEqual(await outputOf({ code: null, error: "stdout over 1 MiB", stdout: "x".repeat(10) }), { ok: false, error: "stdout over 1 MiB" });
  assert.deepEqual(await outputOf({ code: null, error: "stderr over 1 MiB" }), { ok: false, error: "stderr over 1 MiB" });
  assert.equal(logs.length, 1, "no stderr, no line");
  assert.ok(calls.every((c) => !existsSync(dirname(c.argv[0]))), "every run directory is gone");

  const before = calls.length;
  assert.deepEqual(await runScriptProducer({ root: ROOT, script: "../outside.py", sha256: pinned, input: INPUT, timeoutMs: 300_000, log, run: fake({}) }),
    { output: { ok: false, error: GRAMMAR }, code: null, timedOut: false, wallMs: 0, chars: 0 });
  assert.equal(calls.length, before, "a script outside the grammar never runs");
});

test("a script changed after its hash was taken is refused, and never runs", async () => {
  const path = join(SCRIPTS, "swap.py");
  await writeFile(path, marking("ran-armed", "ARMED"));
  const pinned = await shaOf(path);
  await writeFile(path, marking("ran-swapped", "SWAPPED"));
  const real = defaultProducerRunner(process.execPath);
  const runs: string[][] = [];
  const run: ProducerRunner = (argv, opts) => { runs.push(argv); return real(argv, opts); };
  const logs: string[] = [];
  const at = (sha256: string) => runScriptProducer({ root: ROOT, script: "scripts/swap.py", sha256, run, input: INPUT, timeoutMs: 10_000,
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
  const real = defaultProducerRunner(process.execPath);
  /* the swap lands after the runner's check and its copy, just before the exec */
  const run: ProducerRunner = async (argv, opts) => {
    await writeFile(path, marking("ran-rewritten", "REWRITTEN"));
    return real(argv, opts);
  };
  const r = await runScriptProducer({ root: ROOT, script: "scripts/race.py", sha256: pinned, run, input: INPUT, timeoutMs: 10_000, log: () => {} });
  assert.deepEqual(r.output, { ok: true, text: "VERIFIED" });
  assert.equal(r.refused, undefined);
  assert.equal(existsSync(join(ROOT, "ran-verified")), true);
  assert.equal(existsSync(join(ROOT, "ran-rewritten")), false, "the rewritten original never ran");
  assert.equal(await readFile(path, "utf8"), marking("ran-rewritten", "REWRITTEN"), "the original was rewritten");
});

test("the run directory is gone afterwards: after an exit 0, a non-zero exit and a timeout", async () => {
  const real = defaultProducerRunner(process.execPath);
  const cases: Array<[script: string, timeoutMs: number, output: ProducerOutput]> = [
    ["scripts/ok.py", 10_000, { ok: true, text: "OK" }],
    ["scripts/fail.py", 10_000, { ok: false, error: "exit 3", text: "half" }],
    ["scripts/slow.py", 300, { ok: false, error: "timed out after 0.3 s" }],
  ];
  for (const [script, timeoutMs, output] of cases) {
    const copies: string[] = [];
    const run: ProducerRunner = (argv, opts) => { copies.push(argv[0]); return real(argv, opts); };
    const r = await runScriptProducer({ root: ROOT, script, sha256: await shaOf(join(ROOT, script)), run, input: INPUT, timeoutMs, log: () => {} });
    assert.deepEqual(r.output, output, script);
    assert.equal(copies.length, 1, script);
    assert.ok(basename(dirname(copies[0])).startsWith("gravit-producer-"), copies[0]);
    assert.equal(existsSync(dirname(copies[0])), false, `${script}: the run directory is gone`);
  }
});

test("a missing, linked-out or non-regular script is refused as a hash failure; a copy that cannot be made is a start failure", async () => {
  const runs: string[][] = [];
  const run: ProducerRunner = async (argv) => { runs.push(argv); return { code: 0, stdout: "", stderr: "", timedOut: false }; };
  const at = (script: string, sha256: string) =>
    runScriptProducer({ root: ROOT, script, sha256, run, input: INPUT, timeoutMs: 10_000, log: () => {}, now: () => 0 });
  const refusal = (error: string) => ({ output: { ok: false, error }, code: null, timedOut: false, wallMs: 0, chars: 0, refused: "hash" });
  const p = await shaOf(join(SCRIPTS, "p.py"));
  assert.deepEqual(await at("scripts/nope.py", p), refusal("scripts/nope.py is missing"));
  assert.deepEqual(await at("scripts/dangling.py", p), refusal("scripts/dangling.py is missing"));
  assert.deepEqual(await at("scripts/out.py", await shaOf(join(ROOT, "outside.py"))), refusal("scripts/out.py leaves scripts/"),
    "a link out of scripts/ is refused even when its target's bytes are the pinned ones");
  assert.deepEqual(await at("scripts/dir.py", p), refusal("scripts/dir.py is not a regular file"));
  assert.deepEqual(await at("scripts/p.py", "0".repeat(64)), refusal("scripts/p.py changed since arming"));
  assert.deepEqual(runs, []);
  await withEnv({ TMPDIR: join(ROOT, "no-such-tmp") }, async () => {
    assert.deepEqual(await at("scripts/p.py", p), { output: { ok: false, error: "could not start: ENOENT" }, code: null, timedOut: false, wallMs: 0, chars: 0 });
  });
  assert.deepEqual(runs, [], "nothing runs without its copy");
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
    const r = await runScriptProducer({ root: ROOT, script: "scripts/p.py", sha256: await shaOf(join(SCRIPTS, "p.py")), input: INPUT, timeoutMs: 60_000,
      log: (line) => { logs.push(line); }, run });
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
  await runScriptProducer({ root: ROOT, script: "scripts/p.py", sha256: await shaOf(join(SCRIPTS, "p.py")), input: INPUT, timeoutMs: 60_000,
    log: (line) => { logs.push(line); }, run });
  assert.deepEqual(logs, [`gravit-face: desk: producer scripts/p.py wrote to stderr: a⏎b⏎c${"d".repeat(1_994)}⏎…[cut: 506 more characters]`]);
  assert.equal(STDERR_LOG_MAX, 2_000);
});

test("a script producer end to end: the real runner, the allow-listed environment and GRAVIT_ROOT, stdin JSON, stderr only in the log", async () => {
  await withEnv({ DEEPSEEK_API_KEY: "fake-deepseek", TELEGRAM_BOT_TOKEN: "fake-telegram", APCA_API_KEY_ID: "fake-apca" }, async () => {
    const logs: string[] = [];
    const r = await runScriptProducer({ root: ROOT, script: "scripts/e2e.py", sha256: await shaOf(join(SCRIPTS, "e2e.py")),
      run: defaultProducerRunner(process.execPath), input: INPUT, timeoutMs: 10_000, log: (line) => { logs.push(line); } });
    if (!r.output.ok) throw new Error(`the producer failed: ${r.output.error}`);
    const seen = JSON.parse(r.output.text) as { input: unknown; names: string[]; root: string | null; cwd: string; script: string };
    assert.deepEqual(seen.input, INPUT);
    assert.ok(seen.names.includes("APCA_API_KEY_ID"), "the market keys pass");
    assert.ok(!seen.names.includes("DEEPSEEK_API_KEY") && !seen.names.includes("TELEGRAM_BOT_TOKEN"), "the model's and the phone's keys never do");
    assert.equal(seen.root, ROOT, "GRAVIT_ROOT reaches the producer");
    assert.equal(seen.cwd, await realpath(ROOT));
    assert.equal(basename(seen.script), "e2e.py");
    assert.ok(basename(dirname(seen.script)).startsWith("gravit-producer-"), `it ran from its private copy: ${seen.script}`);
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
