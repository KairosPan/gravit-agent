/** The producer runner: what a standing order runs before its turn, and how (rulings P2-3, P2-14).
 *
 * A producer is `scripts/<file>.py`, a Python script directly under the repository's `scripts/` whose
 * bytes `arm` hash-pins, or `builtin:<name>`, a face-side builder with nothing to hash
 * ({@link BUILTIN_PRODUCERS}; an unknown name is refused). A script runs through a
 * {@link ProducerRunner}: `execFile` of an interpreter (`FACE_PYTHON || python3`, the caller's to
 * choose; the desk itself needs none - its market clock is Node, src/market-clock.ts) isolated (`-I`, {@link PYTHON_FLAGS}: no user
 * site, no `PYTHON*` variable, no script directory on `sys.path`), with no shell, the argv as given, cwd
 * the repository root, the {@link ProducerInput} as JSON on stdin, an environment cut to an allow-list
 * ({@link producerEnv}: never `DEEPSEEK_*` or `TELEGRAM_*`) and `SIGKILL` to its whole process group at
 * the deadline. Its stdout is the text the wake message quotes; its stderr never reaches the model - it
 * becomes one face log line of at most {@link STDERR_LOG_MAX} characters. Every producer's text, a
 * builtin's too, is cut at {@link PRODUCER_TEXT_MAX} by {@link capText}; the cut is the firing's step,
 * not this module's.
 *
 * The runner executes exactly the bytes it verified ({@link runPinnedScript}, which
 * {@link runScriptProducer} uses): it reads the script once, checks those bytes against the hash pinned
 * at arming, and runs a private copy
 * of them, never the file in `scripts/`, which another process could swap between the check and the
 * exec. The copy lives in a run base the caller names - a firing's is `<desk dir>/run`, under
 * `$DSH_HOME/face/desk/`, which neither the desk's sandbox nor a sandboxed workbench session can write
 * (both can write under `$TMPDIR`, so the copy never lives there). The residual: an unsandboxed process
 * running as the operator can still race the copy - and such a process can read the keys anyway.
 *
 * THE PIN COVERS THE SCRIPT'S BYTES, AND NOTHING IS IMPORTED FROM THE TREE. The repository holds no
 * Python (since 2026-10-24) and ships no script producer. This runner is the entry for a separate Python
 * research package: that package is INSTALLED into the interpreter the producer runs under (its
 * site-packages, which `-I` keeps), never imported from the repository tree - a producer puts nothing on
 * `sys.path`, so no module a workbench session can write under the root runs with the producer's
 * environment. `GRAVIT_ROOT` (the absolute repository root, also the cwd) is set so a producer can find
 * the files it reads, never as an import path. `-I` closes the interpreter's own routes in (the user
 * site, `PYTHONPATH`, the script's directory).
 *
 * Self-contained: it imports none of the face's modules and the pause switch (`npm run desk`) does not
 * load it.
 * @module
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants, lstat, mkdir, mkdtemp, open, realpath, rm, stat, writeFile, type FileHandle } from "node:fs/promises";
import { constants } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

const BIN = "gravit-face";

/* ---------- the environment ---------- */

/** The variables a face child keeps by exact name. */
const BASE_NAMES: ReadonlySet<string> = new Set(["PATH", "HOME", "LANG", "TZ"]);
/** ...and by prefix: the locale. */
const BASE_PREFIXES: readonly string[] = ["LC_"];
/** A producer's prefixes: the locale, then the Alpaca keys and the workbench's own settings. */
const PRODUCER_PREFIXES: readonly string[] = [...BASE_PREFIXES, "APCA_", "ALPACA_", "ALPHA_"];

/** `env` cut to {@link BASE_NAMES} and the names opening with one of `prefixes`, unset and empty values dropped. */
function allowed(env: NodeJS.ProcessEnv, prefixes: readonly string[]): NodeJS.ProcessEnv {
  const kept: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || value === "") continue;
    if (BASE_NAMES.has(name) || prefixes.some((prefix) => name.startsWith(prefix))) kept[name] = value;
  }
  return kept;
}

/**
 * The environment a face child needs and nothing more: `PATH`, `HOME`, `LANG`, `TZ` and `LC_*`. An
 * allow-list, so the face's keys (`DEEPSEEK_*`, `TELEGRAM_BOT_TOKEN`), the variables that steer an
 * interpreter (`PYTHONPATH`, `NODE_OPTIONS`) and the harness's own (`DSH_HOME`) never pass. Names are
 * matched exactly, case and all.
 * @param env - the environment to cut, usually `process.env`; read, never changed.
 * @returns a new object with the kept names whose values are non-empty.
 */
export function baseEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return allowed(env, BASE_PREFIXES);
}

/**
 * A script producer's environment: {@link baseEnv}'s, plus `APCA_*`, `ALPACA_*` and `ALPHA_*` - the
 * Alpaca keys and the workbench's settings (`ALPHA_DATA_FEED`) a capture reads (ruling P2-3).
 * @param env - the environment to cut, usually `process.env`; read, never changed.
 * @returns a new object with the kept names whose values are non-empty.
 */
export function producerEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return allowed(env, PRODUCER_PREFIXES);
}

/* ---------- the grammar ---------- */

/** The built-in producers: face-side builders, nothing to hash. `brief` is the pre-close brief. */
export const BUILTIN_PRODUCERS = ["brief"] as const;

/** A built-in producer's name. */
export type BuiltinName = (typeof BUILTIN_PRODUCERS)[number];

/** A parsed producer: a script by its repo-relative path (`scripts/<file>.py`), or a builtin by name. */
export type ProducerSpec = { kind: "script"; script: string } | { kind: "builtin"; name: BuiltinName };

/** One `.py` file directly under `scripts/`, its name opening with a letter or a digit. */
const SCRIPT_RE = /^scripts\/[A-Za-z0-9][A-Za-z0-9_-]*\.py$/;
/** A builtin's name, the same shape; whether it is a KNOWN one is a separate refusal. */
const BUILTIN_RE = /^builtin:([A-Za-z0-9][A-Za-z0-9_-]*)$/;
/** The refusal of anything that is neither. */
const GRAMMAR = "producer must be scripts/<file>.py or builtin:<name>";

/** Whether `name` is one of {@link BUILTIN_PRODUCERS}. */
function isBuiltinName(name: string): name is BuiltinName {
  return (BUILTIN_PRODUCERS as readonly string[]).includes(name);
}

/**
 * Parse a producer as `standing.yml` and `npm run desk -- arm --producer` spell it. Nothing is trimmed,
 * and a script is one `.py` file directly under `scripts/`: no other directory, no subdirectory, no
 * `..`, no leading dot, no interpreter words before it.
 * @param text - the producer as written: any parsed YAML value may be passed, but only a string parses
 *   (a list such as `[scripts/x.py]` would otherwise pass the pattern as its own text).
 * @returns the spec, or `{ error }`: `unknown builtin "<name>"` for a well-formed name that is not in
 *   {@link BUILTIN_PRODUCERS}, else `producer must be scripts/<file>.py or builtin:<name>`.
 */
export function parseProducer(text: unknown): ProducerSpec | { error: string } {
  if (typeof text !== "string") return { error: GRAMMAR };
  if (SCRIPT_RE.test(text)) return { kind: "script", script: text };
  const builtin = BUILTIN_RE.exec(text);
  if (builtin === null) return { error: GRAMMAR };
  const name = builtin[1];
  return isBuiltinName(name) ? { kind: "builtin", name } : { error: `unknown builtin "${name}"` };
}

/**
 * Spell a spec as {@link parseProducer} reads it: `scripts/<file>.py` or `builtin:<name>`.
 * @param spec - a parsed producer.
 * @returns its text; `parseProducer(formatProducer(spec))` is `spec` again.
 */
export function formatProducer(spec: ProducerSpec): string {
  return spec.kind === "script" ? spec.script : `builtin:${spec.name}`;
}

/**
 * Find a script producer's file: a regular file whose real path lies under the real path of
 * `<root>/scripts`, so a link inside `scripts/` may point elsewhere inside it, never out. The file this
 * names is the one `arm` hashes and a firing hashes again.
 * @param root - the repository root.
 * @param script - the spec's repo-relative path, `scripts/<file>.py`.
 * @returns `{ path }`, the file's real path, or `{ error }`: `<script> is missing` (nothing there, a
 *   dangling link, no `scripts/` at all), `<script> leaves scripts/` or `<script> is not a regular file`.
 */
export async function resolveScript(root: string, script: string): Promise<{ path: string } | { error: string }> {
  let dir: string;
  let path: string;
  try {
    dir = await realpath(resolve(root, "scripts"));
    path = await realpath(resolve(root, script));
  } catch {
    return { error: `${script} is missing` };
  }
  const rel = relative(dir, path);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return { error: `${script} leaves scripts/` };
  try {
    if (!(await stat(path)).isFile()) return { error: `${script} is not a regular file` };
  } catch {
    return { error: `${script} is missing` };
  }
  return { path };
}

/* ---------- what a producer gets and gives ---------- */

/** What a producer is told: the JSON on a script's stdin, the argument to a builtin. */
export interface ProducerInput {
  /** The standing order's id. */
  order: string;
  /** The firing's key. */
  firing: string;
  /** The ET date the order fires for, `YYYY-MM-DD`. */
  date: string;
  /** The order's directory, repo-relative. */
  dir: string;
  /** That date's market session: its open, its close, and whether the close is early. */
  session: { open: string; close: string; early: boolean };
}

/** What a producer gives: its text, or why it failed - with the text it wrote, when that is worth quoting. */
export type ProducerOutput = { ok: true; text: string } | { ok: false; error: string; text?: string };

/** A face-side producer. It stops when `signal` aborts - the firing's deadline. */
export type BuiltinProducer = (input: ProducerInput, signal: AbortSignal) => Promise<ProducerOutput>;

/* ---------- the runner ---------- */

/**
 * How one run of a child ended. Exactly one of: an exit `code` (a death by a signal the face did not
 * send counts as the shell's 128 + n: 137 for `SIGKILL`); `timedOut` (killed at the deadline, `code`
 * null); or an `error` with `code` null - a spawn failure's code (`ENOENT`, `EACCES`, or a refused
 * argument such as `ERR_INVALID_ARG_VALUE`), `stdout over 1 MiB` or `stderr over 1 MiB`. `stdout` and
 * `stderr` hold what was read either way.
 */
export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  error?: string;
}

/** Run `argv` under an interpreter the runner was made with. Never rejects: every ending is a {@link RunResult}. */
export type ProducerRunner = (
  argv: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; stdin?: string },
) => Promise<RunResult>;

/** The most a child may write to either stream before it is killed: 1 MiB, in bytes. */
const STDIO_MAX_BYTES = 1_048_576;
/** The two overflow errors; neither is a spawn code, so {@link runScriptProducer} and the market clock report
 * them as they are ({@link isOverflow}). */
export const STDOUT_OVER = "stdout over 1 MiB";
export const STDERR_OVER = "stderr over 1 MiB";

/** Whether a {@link RunResult}'s `error` is one of the two overflows rather than a spawn code. */
export function isOverflow(error: string | undefined): boolean {
  return error === STDOUT_OVER || error === STDERR_OVER;
}

/** The interpreter's flags before every script the face runs: `-I`, isolated mode - no user site-packages, no
 * `PYTHON*` variable read, and neither the script's directory nor the cwd put on `sys.path`. */
export const PYTHON_FLAGS: readonly string[] = ["-I"];

/** A thrown or emitted error's code, as text. */
function codeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "unknown error";
}

/**
 * The real runner: `spawn` of `python` with `flags` before the argv - no shell, so the argv reaches the child
 * exactly as given - with the cwd, the environment (exactly as given; the caller cuts it, {@link producerEnv} or
 * {@link baseEnv}) and stdin from `opts`. Stdin is always ended, empty when `opts.stdin` is absent, so a child
 * that reads it never waits on the face. The child leads a process group of its own (`detached`), and at
 * `timeoutMs` that whole group gets `SIGKILL` - a process the script started dies with it, and one holding its
 * stdout open no longer keeps the run waiting; a deadline of zero or less kills at once, never "no deadline". A
 * child that writes more than 1 MiB to either stream is killed the same way, its group with it, what it wrote up
 * to the limit kept. Never rejects: a spawn failure, a refused argument and a broken stdin pipe all end in a
 * {@link RunResult}.
 * @param python - the interpreter: an absolute path, or a name looked up on the `PATH` of the environment
 *   each run is GIVEN (none there is `ENOENT`; both allow-lists keep `PATH`). The face passes
 *   `FACE_PYTHON || python3`.
 * @param flags - the interpreter's own arguments, before the argv: {@link PYTHON_FLAGS} (`-I`) by default;
 *   the tests, which run node as the interpreter, pass none.
 * @returns a {@link ProducerRunner}.
 */
export function defaultProducerRunner(python: string, flags: readonly string[] = PYTHON_FLAGS): ProducerRunner {
  return (argv, opts) => new Promise<RunResult>((done) => {
    let child: ChildProcess;
    try {
      child = spawn(python, [...flags, ...argv], { cwd: opts.cwd, env: opts.env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) {
      /* A synchronous refusal (a NUL in an argument): nothing started. */
      done({ code: null, stdout: "", stderr: "", timedOut: false, error: codeOf(error) });
      return;
    }
    let timedOut = false;
    let overflow: string | undefined;
    let settled = false;
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const sizes = { out: 0, err: 0 };
    /** SIGKILL to the child's group, the child included; a group already gone is no failure. */
    const killGroup = (): void => {
      const pid = child.pid;
      if (pid === undefined) return;
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
          /* gone */
        }
      }
    };
    /* A zero, negative or non-finite deadline is a deadline at once, never "none". */
    const ms = Number.isFinite(opts.timeoutMs) ? Math.max(1, Math.ceil(opts.timeoutMs)) : 1;
    const deadline = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, ms);
    const finish = (result: Omit<RunResult, "stdout" | "stderr">): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      done({ ...result, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") });
    };
    /** One stream's chunk kept, up to the limit; past it the child is killed as an overflow. */
    const keep = (which: "out" | "err", into: Buffer[], over: string) => (chunk: Buffer): void => {
      if (overflow !== undefined) return;
      const room = STDIO_MAX_BYTES - sizes[which];
      if (chunk.length > room) {
        into.push(chunk.subarray(0, room));
        sizes[which] = STDIO_MAX_BYTES;
        overflow = over;
        killGroup();
        return;
      }
      into.push(chunk);
      sizes[which] += chunk.length;
    };
    child.stdout?.on("data", keep("out", out, STDOUT_OVER));
    child.stderr?.on("data", keep("err", err, STDERR_OVER));
    child.on("error", (error) => {
      /* a spawn that failed (ENOENT, EACCES) has no pid and no exit to wait for */
      if (child.pid === undefined) finish({ code: null, timedOut: false, error: codeOf(error) });
    });
    child.on("close", (code, signal) => {
      if (timedOut) finish({ code: null, timedOut: true });
      else if (overflow !== undefined) finish({ code: null, timedOut: false, error: overflow });
      else if (typeof code === "number") finish({ code, timedOut: false });
      /* a signal the face never sent - a crash, an outside kill - reads as the shell's 128 + n */
      else finish({ code: 128 + (signal === null ? 0 : constants.signals[signal] ?? 0), timedOut: false });
    });
    const stdin = child.stdin;
    if (stdin === null) return;
    /* A child that exits without reading its input breaks the pipe (EPIPE): unhandled, that error would end
     * the face. Its exit is reported by `close`, which this cannot affect. */
    stdin.on("error", () => {});
    try {
      if (opts.stdin === undefined) stdin.end();
      else stdin.end(opts.stdin);
    } catch {
      /* the same broken pipe, met synchronously; `close` still reports the exit */
    }
  });
}

/* ---------- the cap and the words ---------- */

/** The most of a producer's text a wake message quotes, in UTF-16 units. */
export const PRODUCER_TEXT_MAX = 32_768;

/** The most of a producer's stderr its one log line holds, in UTF-16 units. */
export const STDERR_LOG_MAX = 2_000;

/**
 * Cut `text` to at most `max` UTF-16 units, never between the halves of a surrogate pair (the cut moves
 * back one unit instead), and mark the cut on a line of its own: `…[cut: <n> more characters]`, `n` in
 * the same units.
 * @param text - the text to cap.
 * @param max - the most units kept; {@link PRODUCER_TEXT_MAX} by default.
 * @returns the text (marked when `cut`) and `length`, the ORIGINAL's length in units.
 */
export function capText(text: string, max: number = PRODUCER_TEXT_MAX): { text: string; cut: boolean; length: number } {
  if (text.length <= max) return { text, cut: false, length: text.length };
  let end = Math.max(0, max);
  const high = text.charCodeAt(end - 1);
  const low = text.charCodeAt(end);
  if (high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff) end -= 1;
  return { text: `${text.slice(0, end)}\n…[cut: ${text.length - end} more characters]`, cut: true, length: text.length };
}

/**
 * A duration as the desk's lines spell it: `5 min` for a whole number of minutes, else seconds (`90 s`).
 * @param ms - the duration in milliseconds.
 */
export function formatDuration(ms: number): string {
  return ms > 0 && ms % 60_000 === 0 ? `${ms / 60_000} min` : `${ms / 1_000} s`;
}

/* ---------- the script producer ---------- */

/** Text on one log line: each line break - `\r\n`, `\r` or `\n` - becomes `⏎`. */
function oneLine(text: string): string {
  return text.replace(/\r\n|\r|\n/g, "⏎");
}

/** A finished run as the firing reads it. A spawn failure is the one `error` that is a code. */
function outputOf(result: RunResult, timeoutMs: number): ProducerOutput {
  if (result.timedOut) return { ok: false, error: `timed out after ${formatDuration(timeoutMs)}` };
  if (isOverflow(result.error)) return { ok: false, error: result.error as string };
  if (result.error !== undefined) return { ok: false, error: `could not start: ${result.error}` };
  if (result.code === 0) return { ok: true, text: result.stdout };
  return { ok: false, error: `exit ${result.code}`, text: result.stdout };
}

/** A script producer's run as the firing reads it. `refused` means nothing ran, for want of the armed
 * bytes: `"missing"` when the script cannot be found or read as a regular file under `scripts/`, `"hash"`
 * when its bytes are not the ones pinned at arming. */
export interface RunScriptResult {
  output: ProducerOutput;
  code: number | null;
  timedOut: boolean;
  wallMs: number;
  chars: number;
  refused?: "hash" | "missing";
}

/** A run's private directory in the run base: this prefix and mkdtemp's six. */
const RUN_DIR_PREFIX = "gravit-producer-";

/** The most bytes a script the face runs may hold: 1 MiB. A larger one is never read whole. */
export const SCRIPT_MAX_BYTES = 1_048_576;

/** The hex SHA-256 of `bytes`, as `arm` pins a script. */
function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Read a resolved script's bytes once, from what is still a regular file at the checked path: the open
 * follows no link swapped in for it (`O_NOFOLLOW`; the path is a real path, so a link there is a swap) and
 * never waits on a FIFO (`O_NONBLOCK`), and the type and the size are checked on the descriptor that is read.
 * The firing's read ({@link runScriptProducer}), the market clock's and `npm run desk -- arm`'s, so a script is
 * hashed at arming exactly as strictly as it is read before it runs.
 * @param path - the script's real path, from {@link resolveScript}.
 * @param maxBytes - the most bytes it may hold, {@link SCRIPT_MAX_BYTES} by default; at most one byte past it is
 *   read, so a file that grows under the read is still refused.
 * @returns the bytes; `"irregular"` when the path now holds a link, a FIFO or anything but a regular file;
 *   `"oversized"` when it holds more than `maxBytes`; `"missing"` when it cannot be opened or read at all (gone,
 *   or no longer readable).
 */
export async function readScriptBytes(path: string, maxBytes: number = SCRIPT_MAX_BYTES): Promise<Buffer | "irregular" | "oversized" | "missing"> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
    const info = await handle.stat();
    if (!info.isFile()) return "irregular";
    if (info.size > maxBytes) return "oversized";
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
      if (length > maxBytes) return "oversized";
    }
    return buffer.subarray(0, length);
  } catch (error) {
    return codeOf(error) === "ELOOP" ? "irregular" : "missing";
  } finally {
    await handle?.close().catch(() => {});
  }
}

/**
 * Make sure the run base is a directory of the face's own before a run directory is made in it: created
 * (0700, no parents) when missing, refused when it is a symlink - it could point the copy anywhere.
 * @param runBase - the run base, an absolute path with no trailing separator (`resolve`d by the caller, so a
 *   trailing slash cannot make `lstat` follow a link).
 * @returns why the run base cannot be used - `<runBase> is a symlink`, or the code of a failed `mkdir` or
 *   `lstat` - or `undefined` when it can.
 */
async function runBaseProblem(runBase: string): Promise<string | undefined> {
  try {
    await mkdir(runBase, { mode: 0o700 });
  } catch (error) {
    if (codeOf(error) !== "EEXIST") return codeOf(error);
  }
  try {
    return (await lstat(runBase)).isSymbolicLink() ? `${runBase} is a symlink` : undefined;
  } catch (error) {
    return codeOf(error);
  }
}

/** How {@link runPinnedScript} ended: the run's result; or nothing run - `refused` for want of the pinned bytes,
 * with why, or `failed`, a run base that cannot be used. */
export type PinnedRun =
  | { ran: RunResult }
  | { refused: "hash" | "missing"; error: string }
  | { failed: string };

/**
 * Run a script under `scripts/` on exactly the bytes pinned, the one copy path every script the face runs on its
 * own takes - a standing order's producer ({@link runScriptProducer}) and the market clock (market-clock.ts). The
 * script is found by {@link resolveScript} and its bytes read ONCE ({@link readScriptBytes}) and hashed. Nothing
 * runs when:
 * - the script cannot be found or read as a regular file under `scripts/`: `refused: "missing"`, the error
 *   `<script> is missing`, `<script> leaves scripts/` or `<script> is not a regular file`;
 * - its bytes are over {@link SCRIPT_MAX_BYTES} or do not hash to `sha256`: `refused: "hash"`, the error
 *   `<script> <changed>` (`changed` the caller's words, `changed since arming` by default);
 * - the run base cannot be used: `failed`, `<runBase> is a symlink` or the code of the failure.
 *
 * Verified bytes are written to a private copy - a fresh `gravit-producer-*` directory (0700) in the run base,
 * `resolve`d first, holding the script's file name (0400) - and `[<copy>, ...args]` runs under `run` with `cwd`,
 * `env`, `stdin` and the deadline as given. The run directory is removed afterwards whatever happened, and one that
 * cannot be is one `log` line naming `label`; the run base itself stays. A copy that cannot be made (a run base
 * that is not a directory, a full disk) or a runner that broke its never-reject contract ends as a run whose
 * `error` is the code. Never rejects.
 * @param opts - `root` the repository root; `script` the repo-relative `scripts/<file>.py`; `sha256` the hex pin;
 *   `changed` the refusal's words for a moved pin; `runBase` where the copy is made; `run` the runner; `args`
 *   after the copy's path; `cwd`, `env`, `stdin`, `timeoutMs` the run's; `label` the log line's subject; `log`.
 */
export async function runPinnedScript(opts: {
  root: string;
  script: string;
  sha256: string;
  changed?: string;
  runBase: string;
  run: ProducerRunner;
  args?: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin?: string;
  timeoutMs: number;
  label: string;
  log: (line: string) => void;
}): Promise<PinnedRun> {
  const changed = `${opts.script} ${opts.changed ?? "changed since arming"}`;
  const found = await resolveScript(opts.root, opts.script);
  if ("error" in found) return { refused: "missing", error: found.error };
  const bytes = await readScriptBytes(found.path);
  if (bytes === "missing") return { refused: "missing", error: `${opts.script} is missing` };
  if (bytes === "irregular") return { refused: "missing", error: `${opts.script} is not a regular file` };
  if (bytes === "oversized" || sha256Hex(bytes) !== opts.sha256) return { refused: "hash", error: changed };
  const runBase = resolve(opts.runBase);
  const baseProblem = await runBaseProblem(runBase);
  if (baseProblem !== undefined) return { failed: baseProblem };

  let dir: string | undefined;
  let result: RunResult;
  try {
    dir = await mkdtemp(join(runBase, RUN_DIR_PREFIX));
    const copy = join(dir, basename(opts.script));
    await writeFile(copy, bytes, { mode: 0o400, flag: "wx" });
    result = await opts.run([copy, ...(opts.args ?? [])], {
      cwd: opts.cwd,
      env: opts.env,
      timeoutMs: opts.timeoutMs,
      ...(opts.stdin === undefined ? {} : { stdin: opts.stdin }),
    });
  } catch (error) {
    /* The copy could not be made (a run base that is not a directory, a full disk), or a runner broke
     * its never-reject contract: nothing ran that could be reported. */
    result = { code: null, stdout: "", stderr: "", timedOut: false, error: codeOf(error) };
  } finally {
    if (dir !== undefined) {
      const runDir = dir;
      await rm(runDir, { recursive: true, force: true }).catch((error: unknown) => {
        opts.log(`${BIN}: desk: ${opts.label} left its run directory ${runDir} behind: ${codeOf(error)}`);
      });
    }
  }
  return { ran: result };
}

/**
 * Run a script producer once, on exactly the bytes armed: {@link runPinnedScript} with the pin `sha256`, the
 * run base `runBase` and, as its arguments, none. Nothing runs - `code` null, `chars` 0 - when the script is
 * refused (`refused: "missing"` or `"hash"`, the error {@link runPinnedScript}'s, `<script> changed since arming`
 * for a moved pin) or the run base cannot be used (`could not start: <runBase> is a symlink`, or the code of the
 * failure).
 *
 * The copy runs under `opts.run`: cwd `root`, the environment {@link producerEnv} of the face's plus
 * `GRAVIT_ROOT` (the absolute `root`), stdin `JSON.stringify(input)`.
 *
 * Exit 0 is `{ ok: true, text: stdout }`. Another exit is `{ ok: false, error: "exit <code>", text: stdout }`,
 * as a producer's own failure report is worth quoting. A kill at the deadline is `timed out after
 * <duration>`, an overflow `stdout over 1 MiB` (or `stderr`), a spawn failure or a copy that could not be
 * made `could not start: <code>`; none of those carries text, since a killed or unstarted child's output
 * cannot be trusted. Any stderr is ONE `log` line, `gravit-face: desk: producer <script> wrote to
 * stderr: <its first 2,000 characters, line breaks as ⏎>`, and never in the output. The text is returned
 * whole: capping it is the firing's step. A `script` outside the producer grammar is refused at once,
 * without `refused` (no parsed spec can name one).
 * @param opts - `root` the repository root; `script` the spec's `scripts/<file>.py`; `sha256` the hex hash
 *   pinned at arming; `runBase` the directory a run's private directory is made in - a firing's is
 *   `<desk dir>/run` - made 0700 (no parents) when missing and refused when it is a symlink; `run` the
 *   runner; `input` what the producer is told; `timeoutMs` its deadline; `log` the face's log; `now` the
 *   clock for `wallMs` (`Date.now` by default).
 * @returns the output; the exit `code` and `timedOut` as the runner gave them; `wallMs`, the step's wall
 *   time, the checks and the copy included; `chars`, the length of everything it wrote to stdout;
 *   `refused` when nothing ran for want of the armed bytes.
 */
export async function runScriptProducer(opts: {
  root: string;
  script: string;
  sha256: string;
  runBase: string;
  run: ProducerRunner;
  input: ProducerInput;
  timeoutMs: number;
  log: (line: string) => void;
  now?: () => number;
}): Promise<RunScriptResult> {
  if (!SCRIPT_RE.test(opts.script)) return { output: { ok: false, error: GRAMMAR }, code: null, timedOut: false, wallMs: 0, chars: 0 };
  const now = opts.now ?? Date.now;
  const started = now();
  const notRun = (error: string, refused?: "hash" | "missing"): RunScriptResult => ({
    output: { ok: false, error }, code: null, timedOut: false, wallMs: now() - started, chars: 0, ...(refused === undefined ? {} : { refused }),
  });
  const pinned = await runPinnedScript({
    root: opts.root,
    script: opts.script,
    sha256: opts.sha256,
    runBase: opts.runBase,
    run: opts.run,
    cwd: opts.root,
    env: { ...producerEnv(process.env), GRAVIT_ROOT: resolve(opts.root) },
    stdin: JSON.stringify(opts.input),
    timeoutMs: opts.timeoutMs,
    label: `producer ${opts.script}`,
    log: opts.log,
  });
  if ("refused" in pinned) return notRun(pinned.error, pinned.refused);
  if ("failed" in pinned) return notRun(`could not start: ${pinned.failed}`);
  const result = pinned.ran;
  const wallMs = now() - started;
  if (result.stderr !== "") {
    opts.log(`${BIN}: desk: producer ${opts.script} wrote to stderr: ${oneLine(capText(result.stderr, STDERR_LOG_MAX).text)}`);
  }
  return { output: outputOf(result, opts.timeoutMs), code: result.code, timedOut: result.timedOut, wallMs, chars: result.stdout.length };
}
