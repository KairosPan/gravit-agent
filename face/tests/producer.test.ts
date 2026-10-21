// face/tests/producer.test.ts
/** The producer runner (src/producer.ts): the two environment allow-lists, the producer grammar and its
 * inverse, the script resolver, the real runner, the script producer over a fake runner and end to end,
 * the text cap and the duration words. Offline. The fixtures sit INSIDE the repository, under
 * tests/tmp/producer-<pid>/, and are removed afterwards; the runner's interpreter is node itself
 * (process.execPath), so the fixture programs are JavaScript and no Python is needed. */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUILTIN_PRODUCERS, PRODUCER_TEXT_MAX, STDERR_LOG_MAX, baseEnv, capText, defaultProducerRunner, formatDuration, formatProducer,
  parseProducer, producerEnv, resolveScript, runScriptProducer,
  type ProducerInput, type ProducerRunner, type RunResult,
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

/** A script producer for the end-to-end test: JavaScript under a .py name, run by node as CommonJS (the
 * fixture root's package.json says so). It reports its input, the NAMES of the key-shaped variables it
 * can see (never a value), its cwd and its own path, and writes two lines to stderr. */
const E2E = `let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { stdin += chunk; });
process.stdin.on("end", () => {
  const names = Object.keys(process.env).filter((name) => /^(DEEPSEEK|TELEGRAM|APCA|ALPACA|ALPHA)_/.test(name)).sort();
  process.stderr.write("line one\\nline two");
  process.stdout.write(JSON.stringify({ input: JSON.parse(stdin), names, cwd: process.cwd(), script: __filename }));
});
`;

const FIXTURES: Record<string, string> = {
  "echo.mjs": ECHO,
  "sleep.mjs": "setTimeout(() => {}, 60_000);\n",
  "flood.mjs": 'process.stdout.write("x".repeat(2 * 1024 * 1024));\n',
  "flood-err.mjs": 'process.stderr.write("e".repeat(2 * 1024 * 1024));\n',
  "crash.mjs": 'process.kill(process.pid, "SIGKILL");\n',
  "exit3.mjs": 'process.stdout.write("half"); process.exit(3);\n',
  "deaf.mjs": "process.exit(0);\n",
  "e2e.py": E2E,
  "p.py": "print('p')\n",
};

before(async () => {
  await rm(ROOT, { recursive: true, force: true });
  await mkdir(SCRIPTS, { recursive: true });
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
  assert.deepEqual(producerEnv({ lc_all: "C", "APCA-X": "x", ALPHAX: "y", XAPCA_Y: "z", PATHS: "/p", HOMEDIR: "/h" }), {},
    "names are exact and prefixes whole, case and all");
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

test("runScriptProducer passes its input, keeps stderr out of the output and logs it once", async () => {
  const calls: Array<{ argv: string[]; opts: Parameters<ProducerRunner>[1] }> = [];
  const fake = (result: Partial<RunResult>): ProducerRunner => async (argv, opts) => {
    calls.push({ argv, opts });
    return { code: 0, stdout: "", stderr: "", timedOut: false, ...result };
  };
  const logs: string[] = [];
  const log = (line: string): void => { logs.push(line); };
  const ticks = [1_000, 1_250];

  const r = await runScriptProducer({ root: ROOT, script: "scripts/p.py", input: INPUT, timeoutMs: 300_000, log, now: () => ticks.shift() ?? 0,
    run: fake({ stdout: '{"n":1}', stderr: "APCA_API_SECRET_KEY=s3cr3t\nTraceback" }) });
  assert.deepEqual(r, { output: { ok: true, text: '{"n":1}' }, code: 0, timedOut: false, wallMs: 250, chars: 7 });
  assert.deepEqual(logs, ["gravit-face: desk: producer scripts/p.py wrote to stderr: APCA_API_SECRET_KEY=s3cr3t⏎Traceback"]);
  assert.equal(JSON.stringify(r).includes("s3cr3t"), false, "stderr never reaches the output");
  assert.deepEqual(calls, [{ argv: [join(ROOT, "scripts", "p.py")],
    opts: { cwd: ROOT, env: producerEnv(process.env), timeoutMs: 300_000, stdin: JSON.stringify(INPUT) } }]);

  const outputOf = async (result: Partial<RunResult>, timeoutMs = 300_000) =>
    (await runScriptProducer({ root: ROOT, script: "scripts/p.py", input: INPUT, timeoutMs, log, run: fake(result) })).output;
  assert.deepEqual(await outputOf({ code: 3, stdout: '{"ok":false,"error":"no keys"}' }), { ok: false, error: "exit 3", text: '{"ok":false,"error":"no keys"}' });
  assert.deepEqual(await outputOf({ code: null, timedOut: true, stdout: "partial" }), { ok: false, error: "timed out after 5 min" });
  assert.deepEqual(await outputOf({ code: null, timedOut: true }, 90_000), { ok: false, error: "timed out after 90 s" });
  assert.deepEqual(await outputOf({ code: null, error: "ENOENT" }), { ok: false, error: "could not start: ENOENT" });
  assert.deepEqual(await outputOf({ code: null, error: "stdout over 1 MiB", stdout: "x".repeat(10) }), { ok: false, error: "stdout over 1 MiB" });
  assert.deepEqual(await outputOf({ code: null, error: "stderr over 1 MiB" }), { ok: false, error: "stderr over 1 MiB" });
  assert.equal(logs.length, 1, "no stderr, no line");

  const before = calls.length;
  assert.deepEqual(await runScriptProducer({ root: ROOT, script: "../outside.py", input: INPUT, timeoutMs: 300_000, log, run: fake({}) }),
    { output: { ok: false, error: GRAMMAR }, code: null, timedOut: false, wallMs: 0, chars: 0 });
  assert.equal(calls.length, before, "a script outside the grammar never runs");
});

test("a producer's stderr is one log line, cut at 2,000 characters", async () => {
  const logs: string[] = [];
  const run: ProducerRunner = async () => ({ code: 0, stdout: "ok", stderr: `a\r\nb\rc${"d".repeat(2_500)}`, timedOut: false });
  await runScriptProducer({ root: ROOT, script: "scripts/p.py", input: INPUT, timeoutMs: 60_000, log: (line) => { logs.push(line); }, run });
  assert.deepEqual(logs, [`gravit-face: desk: producer scripts/p.py wrote to stderr: a⏎b⏎c${"d".repeat(1_994)}⏎…[cut: 506 more characters]`]);
  assert.equal(STDERR_LOG_MAX, 2_000);
});

test("a script producer end to end: the real runner, the allow-listed environment, stdin JSON, stderr only in the log", async () => {
  await withEnv({ DEEPSEEK_API_KEY: "fake-deepseek", TELEGRAM_BOT_TOKEN: "fake-telegram", APCA_API_KEY_ID: "fake-apca" }, async () => {
    const logs: string[] = [];
    const r = await runScriptProducer({ root: ROOT, script: "scripts/e2e.py", run: defaultProducerRunner(process.execPath), input: INPUT,
      timeoutMs: 10_000, log: (line) => { logs.push(line); } });
    if (!r.output.ok) throw new Error(`the producer failed: ${r.output.error}`);
    const seen = JSON.parse(r.output.text) as { input: unknown; names: string[]; cwd: string; script: string };
    assert.deepEqual(seen.input, INPUT);
    assert.ok(seen.names.includes("APCA_API_KEY_ID"), "the market keys pass");
    assert.ok(!seen.names.includes("DEEPSEEK_API_KEY") && !seen.names.includes("TELEGRAM_BOT_TOKEN"), "the model's and the phone's keys never do");
    assert.equal(seen.cwd, await realpath(ROOT));
    assert.equal(seen.script, await realpath(join(SCRIPTS, "e2e.py")));
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
