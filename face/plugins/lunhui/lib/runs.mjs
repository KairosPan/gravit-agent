// face/plugins/lunhui/lib/runs.mjs
/**
 * The Lunhui run-directory contract (spec D4, D5, §5.1 "Anchoring"): the MCP server's only
 * file-system boundary. Every `strategy` and `run` argument a tool receives is resolved here, so a
 * model's argument names a strategy and a run, never a path. New in the graft, not a port: the
 * source plugin was handed one private run directory per process (spec D5).
 *
 * A strategy is a name in the face's channel grammar - `NAME_RE` in `face/src/channels.ts`,
 * compared in NFC as the face compares and creates channels - naming a real directory directly
 * under the strategies root that holds a readable, regular `THESIS.md`. A run is an id in
 * `RUN_ID_RE` naming a real directory under the strategy's own real `analysis/` directory. Each
 * check `lstat`s the entry, so a symbolic link is refused, never followed, and containment compares
 * `realpath`s, so the temp directory's own link on macOS (`/var` -> `/private/var`) is neither an
 * escape nor a false refusal. The returned names and directories are the on-disk ones, so on a
 * case-insensitive volume `foo` and `Foo` resolve to one strategy under one name. A directory this
 * module returned is checked again before every use: `createRun` and `resolveRun` check the strategy
 * directory, and every file operation checks the run directory it is given, that it still is that
 * real directory - its own realpath, not since swapped for a link, itself or above - before anything
 * is made, found, read or written under it.
 *
 * A refusal is a `LunhuiError` whose message opens with its stable code - `NOT_A_STRATEGY`,
 * `BAD_RUN_ID`, `NO_SUCH_RUN`, `RUN_EXISTS` - followed by a Chinese reason, like the tool
 * descriptions it reaches (spec D14), that names no path. Any other file-system failure is thrown
 * as Node raised it, absolute path included, so the server must not forward its message (spec
 * §5.1 "Errors").
 *
 * No write goes through an existing inode, so neither a symbolic nor a hard link carries one out of
 * the run. A new file is opened `wx` (O_EXCL, which no link survives). A replaced file -
 * `analysis.json`, `metrics.json` - is written fresh, `wx` and 0o600, under a staging name, then
 * renamed over the old one: `analysis.pending.json` for the analysis, as spec §5.1 names it, and a
 * unique `metrics.json.<hex>.tmp` for each metrics write, so concurrent writers never share one. A
 * link, a directory or any other non-file at one of those names is `NO_SUCH_RUN`. A read opens with
 * O_NOFOLLOW and O_NONBLOCK, as `src/bot-journal.ts` does, and reads from the opened handle only if
 * it is a regular file with exactly one link and at most `MAX_READ_BYTES`, 256 KiB: every file the
 * server reads it wrote itself, and what it reads goes to a remote model. Residuals: a check and the
 * use after it are two calls (Node has no `openat`), so a concurrent writer inside the strategy tree
 * can still race them; a hard-link copy of the tree (`cp -al`) cannot read its runs; a metrics
 * write killed between its staging write and its rename leaves its `metrics.json.<hex>.tmp`
 * behind - inside the run, mode 0o600, read by nothing - and it is not swept, since a sweep would
 * race a concurrent writer's staging file; and the order of two writes to one run - which metrics
 * write lands last, two submits at once - is the caller's.
 */

import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, mkdir, open, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";

/** A refusal with a stable code word; the message is `<code>: <reason>`. */
export class LunhuiError extends Error {
  /**
   * @param {string} code the stable code word the message opens with
   * @param {string} reason what was refused, naming no path
   */
  constructor(code, reason) {
    super(`${code}: ${reason}`);
    this.name = "LunhuiError";
    /** The stable code word the message opens with. */
    this.code = code;
  }
}

/**
 * A strategy name: exactly the face's channel-name grammar, the literal of `NAME_RE` in
 * `face/src/channels.ts` - a letter or digit in any script first, then letters, digits, combining
 * marks, `-` and `_`, at most 41 code points - so a strategy is any channel the face can create and
 * one segment that is never `.`, `..` or a separator. `resolveStrategy` tests it in NFC.
 */
export const STRATEGY_NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}\p{M}_-]{0,40}$/u;

/** A run id, as `newRunId` makes one and as a tool's `run` argument must be (spec D5). */
export const RUN_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** A file of a run: one plain segment, never dot-led. The names are the server's own, never a model's. */
const FILE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

/** The largest run file `readText` reads: spec §8 bounds a whole run at 256 KiB of JSON, and what is read reaches a model. */
const MAX_READ_BYTES = 256 * 1024;

const NOT_A_STRATEGY = {
  grammar: "策略名须合频道名规则：首字是任一文字的字母或数字，其后是字母、数字、- 或 _，至多 41 个字符。",
  directory: "策略根目录下没有这个策略的真实目录（不存在、是符号链接，或解析到根目录之外）。",
  thesis: "策略目录里没有可读的 THESIS.md。",
  analysis: "策略目录里的 analysis/ 不是真实目录（是文件或符号链接），不能存放运行。",
};

/** @returns {LunhuiError} */
function badRunId() {
  return new LunhuiError("BAD_RUN_ID", "运行编号须匹配 ^[A-Za-z0-9_-]{1,64}$，即 freeze_market_snapshot 返回的 run。");
}

/** @returns {LunhuiError} */
function noSuchRun() {
  return new LunhuiError("NO_SUCH_RUN", "这个策略下没有这个运行目录（不存在、是符号链接，或不是目录）。");
}

/**
 * A run file that is missing, is not a regular file the run wrote itself, or is too large to read.
 * @param {string} name
 * @returns {LunhuiError}
 */
function unusableFile(name) {
  return new LunhuiError(
    "NO_SUCH_RUN",
    `运行目录里没有可用的 ${name}：须是这个运行自己写下、不超过 ${MAX_READ_BYTES / 1024} KiB 的普通文件，不是符号链接、目录或另有硬链接的文件。`,
  );
}

/**
 * Whether `path` lies strictly inside `base`; both are realpaths.
 * @param {string} base
 * @param {string} path
 */
function within(base, path) {
  return path.startsWith(base.endsWith(sep) ? base : base + sep);
}

/**
 * The realpath of `path` when `lstat` finds a real directory there - never a link - whose realpath
 * lies inside `base`, itself a realpath; null when there is none.
 * @param {string} path
 * @param {string} base
 * @returns {Promise<string | null>}
 */
async function directoryInside(path, base) {
  try {
    if (!(await lstat(path)).isDirectory()) return null;
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
    throw error;
  }
  const real = await realpath(path);
  return within(base, real) ? real : null;
}

/**
 * Whether `dir`, a directory this module returned (`resolveStrategy`, `createRun`, `resolveRun`),
 * still is that directory: `lstat` finds a real directory there, not a link, and its realpath is
 * itself, so no part of it became a link.
 * @param {string} dir
 */
async function stillResolved(dir) {
  try {
    return (await lstat(dir)).isDirectory() && (await realpath(dir)) === dir;
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return false;
    throw error;
  }
}

/**
 * Whether `lstat` finds a regular file at `path` - never a link - that this process may read.
 * @param {string} path
 */
async function readableFile(path) {
  try {
    if (!(await lstat(path)).isFile()) return false;
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * What `lstat` finds at `path`: a regular file, nothing, or another entry (a link, a directory, a FIFO).
 * @param {string} path
 * @returns {Promise<"file" | "none" | "other">}
 */
async function entryKind(path) {
  try {
    return (await lstat(path)).isFile() ? "file" : "other";
  } catch (error) {
    if (error?.code === "ENOENT") return "none";
    throw error;
  }
}

/**
 * `name` inside `dir`. The name is one plain segment; anything else is a host bug, not a refusal.
 * @param {string} dir
 * @param {string} name
 */
function fileIn(dir, name) {
  if (typeof name !== "string" || !FILE_NAME_RE.test(name)) {
    throw new TypeError(`lunhui: a run file name is one plain segment, not ${JSON.stringify(name)}`);
  }
  return join(dir, name);
}

/**
 * Replace `name` in the run directory `dir` with `text`: written fresh at `staging` - `wx`, mode
 * 0o600 - then renamed over `name`, so no write goes through an existing inode and a reader sees the
 * old file or the new one, whole. `NO_SUCH_RUN` when `dir` is no longer the run directory it was,
 * or anything but a regular file holds `name` or `staging`; a regular file an interrupted write left
 * at `staging` is removed first, and a failed write or rename removes the staging file it made.
 * @param {string} dir a run directory `createRun` or `resolveRun` returned
 * @param {string} name
 * @param {string} staging
 * @param {string} text
 * @returns {Promise<void>}
 */
async function replaceFile(dir, name, staging, text) {
  const target = fileIn(dir, name);
  const temp = fileIn(dir, staging);
  if (!(await stillResolved(dir))) throw noSuchRun();
  if ((await entryKind(target)) === "other") throw unusableFile(name);
  if ((await entryKind(temp)) === "other") throw unusableFile(staging);
  await rm(temp, { force: true });
  try {
    await writeFile(temp, text, { flag: "wx", mode: 0o600 });
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

/**
 * Resolve a tool's `strategy` argument under the strategies root (spec D4). `NOT_A_STRATEGY` when
 * the name fails the grammar, or the directory is missing, is a symbolic link, resolves outside the
 * root, or holds no readable, regular `THESIS.md`.
 * @param {string} root the strategies root, `LUNHUI_STRATEGIES_ROOT`
 * @param {unknown} name the tool's `strategy` argument
 * @returns {Promise<{ name: string, dir: string }>} the on-disk name and the directory's realpath
 */
export async function resolveStrategy(root, name) {
  const wanted = typeof name === "string" ? name.normalize("NFC") : "";
  if (!STRATEGY_NAME_RE.test(wanted)) throw new LunhuiError("NOT_A_STRATEGY", NOT_A_STRATEGY.grammar);
  const base = await realpath(resolve(root));
  const dir = await directoryInside(join(base, wanted), base);
  if (!dir) throw new LunhuiError("NOT_A_STRATEGY", NOT_A_STRATEGY.directory);
  if (!(await readableFile(join(dir, "THESIS.md")))) throw new LunhuiError("NOT_A_STRATEGY", NOT_A_STRATEGY.thesis);
  return { name: basename(dir), dir };
}

/**
 * A new run id, `YYYYMMDDTHHMMSSZ-xxxxxxxx`: the UTC second of `now`, then eight lowercase hex from
 * `crypto.randomBytes`, so ids sort by time and two freezes in one second get distinct ids (a 1 in
 * 2^32 collision is `createRun`'s `RUN_EXISTS`). An invalid date throws `RangeError`.
 * @param {Date} [now]
 * @returns {string}
 */
export function newRunId(now = new Date()) {
  const stamp = now.toISOString().slice(0, 19).replace(/[-:]/g, "");
  return `${stamp}Z-${randomBytes(4).toString("hex")}`;
}

/**
 * Resolve a tool's `run` argument under the strategy's `analysis/` (spec D5). `BAD_RUN_ID` when the
 * id fails `RUN_ID_RE`; `NO_SUCH_RUN` when the strategy directory is no longer the real directory
 * `resolveStrategy` returned, or `analysis/` or the run directory is missing, is a symbolic link or
 * is not a directory.
 * @param {string} strategyDir the directory `resolveStrategy` returned
 * @param {unknown} run the tool's `run` argument
 * @returns {Promise<{ run: string, dir: string }>} the on-disk id and the run directory's realpath
 */
export async function resolveRun(strategyDir, run) {
  if (typeof run !== "string" || !RUN_ID_RE.test(run)) throw badRunId();
  if (!(await stillResolved(strategyDir))) throw noSuchRun();
  const analysis = await directoryInside(join(strategyDir, "analysis"), strategyDir);
  const dir = analysis && (await directoryInside(join(analysis, run), analysis));
  if (!dir) throw noSuchRun();
  return { run: basename(dir), dir };
}

/**
 * Create a new run directory (spec §5.1): `analysis/` with `recursive: true` and mode 0o700 when it
 * is absent, then the run directory, mode 0o700, without `recursive`, so an existing one - a link
 * included - is `RUN_EXISTS`. `BAD_RUN_ID` when the id fails `RUN_ID_RE`; `NOT_A_STRATEGY` when the
 * strategy directory is no longer the real directory `resolveStrategy` returned, or `analysis/` is
 * a file or a symbolic link, since the strategy then cannot hold a run.
 * @param {string} strategyDir the directory `resolveStrategy` returned
 * @param {string} run a fresh `newRunId()`
 * @returns {Promise<string>} the run directory
 */
export async function createRun(strategyDir, run) {
  if (typeof run !== "string" || !RUN_ID_RE.test(run)) throw badRunId();
  // Before the mkdir, which would make analysis/ through a strategy directory swapped for a link.
  if (!(await stillResolved(strategyDir))) throw new LunhuiError("NOT_A_STRATEGY", NOT_A_STRATEGY.directory);
  const analysisPath = join(strategyDir, "analysis");
  // A file or a dangling link at analysis/ fails the mkdir and a link to a directory passes it;
  // the lstat that follows refuses all three.
  await mkdir(analysisPath, { recursive: true, mode: 0o700 }).catch((error) => {
    if (error?.code !== "EEXIST" && error?.code !== "ENOENT") throw error;
  });
  const analysis = await directoryInside(analysisPath, strategyDir);
  if (!analysis) throw new LunhuiError("NOT_A_STRATEGY", NOT_A_STRATEGY.analysis);
  const dir = join(analysis, run);
  try {
    await mkdir(dir, { mode: 0o700 });
  } catch (error) {
    if (error?.code === "EEXIST") throw new LunhuiError("RUN_EXISTS", "这个运行目录已存在；每次冻结使用新的运行编号。");
    throw error;
  }
  return dir;
}

/**
 * Write a new file into a run directory: flag `wx`, mode 0o600, never an overwrite. `NO_SUCH_RUN`
 * when `dir` is no longer the run directory it was; a name already taken - by a file or a link -
 * rejects with Node's `EEXIST`.
 * @param {string} dir a run directory `createRun` or `resolveRun` returned
 * @param {string} name a plain file name, e.g. `snapshot.json`
 * @param {string} text
 * @returns {Promise<void>}
 */
export async function writeNew(dir, name, text) {
  const file = fileIn(dir, name);
  if (!(await stillResolved(dir))) throw noSuchRun();
  await writeFile(file, text, { flag: "wx", mode: 0o600 });
}

/**
 * Read a run's file as UTF-8 text, from the handle it opened (O_NOFOLLOW, O_NONBLOCK) once that
 * handle is a regular file with exactly one link and at most `MAX_READ_BYTES`. `NO_SUCH_RUN` when
 * `dir` is no longer the run directory it was, or the file is missing, a symbolic link, a
 * directory, a socket or a FIFO, a file with another hard link, or larger than 256 KiB - refused
 * from the handle's `stat`, before a byte of it is read.
 * @param {string} dir a run directory `createRun` or `resolveRun` returned
 * @param {string} name a plain file name, e.g. `context.json`
 * @returns {Promise<string>}
 */
export async function readText(dir, name) {
  const file = fileIn(dir, name);
  if (!(await stillResolved(dir))) throw noSuchRun();
  if ((await entryKind(file)) !== "file") throw unusableFile(name);
  let handle;
  try {
    handle = await open(file, READ_FLAGS);
  } catch (error) {
    // removed, or swapped for a link, since the lstat
    if (error?.code === "ENOENT" || error?.code === "ELOOP") throw unusableFile(name);
    throw error;
  }
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || opened.size > MAX_READ_BYTES) throw unusableFile(name);
    return await handle.readFile({ encoding: "utf8" });
  } finally {
    await handle.close();
  }
}

/**
 * Land an accepted analysis: written fresh as `analysis.pending.json` (`wx`, 0o600), then renamed to
 * `analysis.json`, so a reader sees no analysis or the whole one. `NO_SUCH_RUN` when `dir` is no
 * longer the run directory it was, or a link or a directory holds either name; a regular file an
 * interrupted write left at `analysis.pending.json` is removed first. That a run is submitted once
 * is the caller's rule.
 * @param {string} dir a run directory `resolveRun` returned
 * @param {unknown} analysis the analysis `validateAnalysis` returned
 * @returns {Promise<void>}
 */
export async function writeAnalysis(dir, analysis) {
  await replaceFile(dir, "analysis.json", "analysis.pending.json", `${JSON.stringify(analysis, null, 2)}\n`);
}

/**
 * Write the run's `metrics.json`: created, or replaced, by a fresh 0o600 file under a unique
 * `metrics.json.<hex>.tmp` renamed over it, so a hard link at `metrics.json` is unlinked from the
 * run, never written through, and concurrent writers never tear it. `NO_SUCH_RUN` when `dir` is no
 * longer the run directory it was, or a link or a directory holds the name.
 * @param {string} dir a run directory `createRun` or `resolveRun` returned
 * @param {unknown} metrics `{ toolCalls, reads, submitted, validationRejections }` (spec §5.1)
 * @returns {Promise<void>}
 */
export async function writeMetrics(dir, metrics) {
  const staging = `metrics.json.${randomBytes(4).toString("hex")}.tmp`;
  await replaceFile(dir, "metrics.json", staging, JSON.stringify(metrics));
}
