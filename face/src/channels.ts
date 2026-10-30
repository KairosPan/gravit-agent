/** Channels: the arena as the sidebar and the landing page see it.
 *
 * A channel is one directory given an identity by the host. The directory is
 * the truth of EXISTENCE — `readdir` decides what a channel is, so a channel
 * Gravit makes with a plain `mkdir` is a channel on the next listing and git
 * stays the ledger. The dsh workspace registry adds IDENTITY on top: a stable
 * UUID, a display title decoupled from the folder name, durable session
 * membership, and order. See docs/superpowers/specs/2026-09-03-channels-design.md.
 * @module
 */
import { constants } from "node:fs";
import { cp, lstat, open, readdir, readFile, realpath, stat, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { load } from "js-yaml";
import type { RouteRegistrar } from "./static.ts";
import { isBotId } from "./bots.ts";
import { FORBIDDEN, HttpError, isJsonBody, isTrustedDataRequest, readBody } from "./http.ts";
import { botsFor, logBotsWrite, logRosterWrite, rosterFor, seedRoster, setBots, setRoster } from "./roster.ts";
import { ROOM_CAPS } from "./room-rules.ts";

/** Diagnostic label, the same string every other `${BIN}:`-prefixed line in this
 * program uses (`roster.ts:24`, `main.ts:26`) - copied rather than imported,
 * because it is a label rather than a contract. */
const BIN = "gravit-face";

/** The copy source every new channel starts from, and never a channel. */
const TEMPLATE = "_template";

/** The repo root's channel name — it is not under `strategies/`, so every
 * listing adds it by hand. */
export const WORKBENCH = "workbench";

/** One channel's directory, before the registry has said anything about it. */
export interface ChannelDir {
  /** Directory basename, or {@link WORKBENCH} for the repo root. */
  name: string;
  /** Absolute directory. */
  dir: string;
  /** True for the repo root, which has no `strategies/` parent. */
  isRoot: boolean;
}

/**
 * The channel directories: the repo root first, then every directory under
 * `<root>/strategies` except the template and hidden names.
 * @param root - absolute workbench repo root.
 * @throws Error if `strategies` exists but is not a directory, or if access is denied.
 */
export async function listChannelDirs(root: string): Promise<ChannelDir[]> {
  const dirs: ChannelDir[] = [{ name: WORKBENCH, dir: root, isRoot: true }];
  let entries: import("node:fs").Dirent[] = [];
  try {
    entries = await readdir(join(root, "strategies"), { withFileTypes: true });
  } catch (err) {
    /* No arena yet is a real state: the workbench is still a channel. Any
     * OTHER readdir failure - EACCES, ENOTDIR - is NOT "no channels", and
     * reporting it as an empty list would make every channel vanish from
     * the sidebar with nothing saying why (charter Rule 5). Let it throw:
     * the route turns it into a failed listing, which the client degrades
     * on rather than rendering as zero channels. */
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return dirs;
  }
  const found: ChannelDir[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    /* the copy source is never a channel (same exclusion createChannel's
     * NAME_RE enforces on the write side, below) */
    if (entry.name === TEMPLATE || entry.name.startsWith(".") || entry.name.startsWith("__")) continue;
    found.push({ name: entry.name, dir: join(root, "strategies", entry.name), isRoot: false });
  }
  found.sort((a, b) => a.name.localeCompare(b.name));
  return [...dirs, ...found];
}

/** The one thing the old regex could read, kept as the floor a broken file
 * degrades to: first line-anchored `status:`, first non-space run. */
const STATUS_RE = /(?:^|\n)status:\s*(\S+)/;

/** The channel card's header, every key optional. A channel that fills none
 * of them behaves exactly as it did before this existed. */
export interface ChannelStatus {
  /** Lifecycle: idea | researching | validated | paper | retired. */
  status?: string;
  /** The current conclusion, one sentence. */
  one_line?: string;
  /** The next step. */
  next?: string;
  /** Free key-value figures, stringified for display. */
  numbers?: Record<string, string>;
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;

/**
 * Read `<dir>/status.yaml`. Absent or unreadable is `{}`; malformed YAML
 * falls back to the `status:` regex, because a hand-mangled file must never
 * remove a channel from the index — status is a badge, not a gate.
 */
export async function readChannelStatus(dir: string): Promise<ChannelStatus> {
  let text: string;
  try {
    text = await readFile(join(dir, "status.yaml"), "utf8");
  } catch {
    return {};
  }
  const floor: ChannelStatus = {};
  const word = STATUS_RE.exec(text)?.[1];
  if (word !== undefined) floor.status = word;

  let doc: unknown;
  try {
    doc = load(text);
  } catch {
    return floor; // malformed: the regex reading is all we honestly have
  }
  if (doc === null || typeof doc !== "object") return floor;

  const raw = doc as Record<string, unknown>;
  const out: ChannelStatus = {};
  const status = str(raw.status) ?? floor.status;
  if (status !== undefined) out.status = status;
  const one = str(raw.one_line);
  if (one !== undefined) out.one_line = one;
  const next = str(raw.next);
  if (next !== undefined) out.next = next;
  if (raw.numbers !== null && typeof raw.numbers === "object" && !Array.isArray(raw.numbers)) {
    const numbers: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw.numbers as Record<string, unknown>)) {
      if (v === null || typeof v === "object") continue;
      numbers[k] = String(v);
    }
    if (Object.keys(numbers).length > 0) out.numbers = numbers;
  }
  return out;
}

/** The template's H1 and its placeholder question, byte-exact. A channel
 * born from `_template` and never written is detected here so its page says
 * "no thesis yet" instead of presenting the placeholder as a thesis. */
const TEMPLATE_H1 = "# <strategy name>";
const TEMPLATE_BODY = "What market behavior does this capture, and why does it exist?";

/** A journal line: `- YYYY-MM-DD: text`. */
const JOURNAL_RE = /^-\s*(\d{4}-\d{2}-\d{2})\s*:\s*(.*)$/;

/** A dated backtest filename: `YYYY-MM-DD-<label>.json`. */
const BACKTEST_RE = /^(\d{4}-\d{2}-\d{2})-.*\.json$/;

/** A Lunhui research run's directory name under `analysis/`, exactly the form `newRunId` in
 * `face/plugins/lunhui/lib/runs.mjs` makes: the run's UTC second, `Z-`, then eight lowercase hex.
 * Stricter than that module's `RUN_ID_RE`, which `notes` or `2026-10-19` pass too, so a stray
 * directory beside the runs never lists as one. Copied, not imported: the face does not import
 * from `plugins/`; `tests/channels.test.ts` lists directories `openRun` made, which ties the copy
 * to its source. */
const ANALYSIS_RUN_RE = /^\d{8}T\d{6}Z-[0-9a-f]{8}$/;

/** The most runs the channel page lists, the newest by id. */
const ANALYSIS_RUNS_CAP = 50;

/** The caps on a run's files the card reads, each measured on the compact JSON as
 * {@link readBoundedJson} does (modules spec §5.11): `run.json` - the manifest, a few hundred bytes
 * per evidence entry and at most eight freezes - and one module artifact. */
const RUN_MANIFEST_MAX_BYTES = 8 * 1024;
const RUN_ARTIFACT_MAX_BYTES = 24 * 1024;

/** The Lunhui modules in a run's order, each with its artifact's file in the run directory and
 * the headline fields the card shows of it: `MODULES` in `face/plugins/lunhui/lib/modules.mjs`,
 * copied as the run-id form is - the server owns its table, and `tests/channels.test.ts` holds
 * this copy equal to it field for field. */
export const MODULE_HEADLINES: readonly { name: string; file: string; headline: readonly string[] }[] = [
  { name: "environment", file: "environment.json", headline: ["index_state", "liquidity_state", "cycle_anchor"] },
  { name: "sentiment", file: "sentiment.json", headline: ["state", "money_effect", "freeze_type"] },
  { name: "theme", file: "theme.json", headline: ["mainline_candidates", "theme_stage", "rotation"] },
  { name: "leader", file: "leader.json", headline: ["leader_candidates", "top_pattern_flags"] },
  { name: "mode", file: "mode.json", headline: ["mode", "preconditions", "research_only_matches", "expectation", "expectation_review"] },
  { name: "counterevidence", file: "counterevidence.json", headline: ["items"] },
];

/** The most the newest dated backtest may weigh and still be parsed into the latest-evidence
 * block, measured on the compact JSON the page is sent. A results file records a window, the
 * parameters and a handful of statistics, so a megabyte leaves room for a series without letting
 * one file swell the page. */
export const BACKTEST_MAX_BYTES = 1024 * 1024;

/** The most of a backtest file read from disk: four times {@link BACKTEST_MAX_BYTES}, because a
 * pretty-printed file (`indent=2`) spreads most series two to four times (a daily series about
 * twice, a list of small numbers about three and a half) - so most files at the compact cap still
 * parse. A denser or deeper one spreads further and is refused below the cap, still listed; no
 * file is ever read past this. */
export const BACKTEST_MAX_DISK_BYTES = 4 * BACKTEST_MAX_BYTES;

/** How deep a JSON file the page reads - a run file or the newest backtest - may nest and still
 * count as parsed. The Lunhui artifacts nest a handful of levels and a backtest's statistics a few;
 * the overview's `JSON.stringify` throws from about 7,000, which would leave the whole channel
 * page with nothing but an error. */
const JSON_FILE_MAX_DEPTH = 32;

/** One accepted module artifact as a run's row carries it: its top-level `status`
 * (`"NOT_EVALUABLE"` for a module whose evidence was missing, spec §5.4), its `contract_version`
 * (A19), its headline fields that are present, by {@link MODULE_HEADLINES}, its `missing_sources`
 * (`[]` unless an array of strings only) and its `market_run` (null unless a string). */
export interface RunArtifact {
  accepted: true;
  status: string | null;
  contractVersion: string | null;
  headline: Record<string, unknown>;
  missingSources: string[];
  marketRun: string | null;
}

/** One Lunhui research run under `analysis/` (modules spec A14). `asOf`, `session`, `snapshotId`,
 * `sealed` and `kind` come from `run.json`, null (`sealed` false) when it is absent, not a regular
 * one-link file, unparseable, over its cap, nested too deep, or the field is off its type; `asOf`
 * is the wall clock the newest evidence came in, `session` the trading day it belongs to.
 * `artifacts` holds each module that `run.json`'s `artifacts` names (A10: what a submit landed)
 * whose file is a regular one-link file and parses within its cap and depth as an object; any
 * other is left out, so a run.json that cannot be read accepts none. `marketRun` is the accepted
 * `mode.json`'s `market_run`, else null. `bytes` is every regular one-link file directly in the
 * run directory, by its size - evidence included, its content never read. `openedAt` and
 * `sealedAt` are `run.json`'s `opened_at` and `sealed_at` when strings, and `frozen` the string
 * `source` of each object in its `evidence` array, in order, `[]` when it is not an array. */
export interface RunRow {
  run: string;
  asOf: string | null;
  session: string | null;
  snapshotId: string | null;
  sealed: boolean;
  kind: "market" | "strategy" | null;
  artifacts: { [module: string]: RunArtifact };
  marketRun: string | null;
  bytes: number;
  openedAt: string | null;
  sealedAt: string | null;
  frozen: string[];
  /** The `provider` of `run.json`'s evidence entry whose `source` is `boards` (`"东方财富"` or
   * `"同花顺问财"`); null when absent, an older run, or not a string. */
  boardsProvider: string | null;
}

/** The first `boards` evidence entry's `provider`, when a string; null otherwise. */
function boardsProviderOf(evidence: unknown): string | null {
  if (!Array.isArray(evidence)) return null;
  const entry = evidence.find((e) => isRecord(e) && e.source === "boards");
  return isRecord(entry) && typeof entry.provider === "string" ? entry.provider : null;
}

/** The newest listed run that is sealed and holds an accepted artifact, each artifact whole beside
 * its headline. */
export interface LatestRun {
  run: string;
  asOf: string | null;
  session: string | null;
  snapshotId: string | null;
  artifacts: { [module: string]: { headline: Record<string, unknown>; json: Record<string, unknown> } };
  marketRun: string | null;
}

/** Everything the landing page derives from a channel's own files. */
export interface ChannelBody {
  thesis: { markdown: string; isTemplate: boolean } | null;
  journal: { date: string; text: string }[];
  /** The regular files directly under a real `backtests/` directory, never a link, dated
   * `YYYY-MM-DD-*.json` newest first, then the rest by name; a `backtests` link lists nothing. */
  backtests: { file: string; bytes: number }[];
  /** The newest dated backtest, parsed; null when there is none, or when it is not a regular
   * one-link file, does not parse, is over {@link BACKTEST_MAX_BYTES} or nests deeper than
   * {@link JSON_FILE_MAX_DEPTH} ({@link readBoundedJson}). It still lists in `backtests`. */
  latest: { file: string; json: unknown } | null;
  files: { name: string; bytes: number; mtime: string }[];
  /** The Lunhui research runs under a real `analysis/` directory, newest first, at most
   * {@link ANALYSIS_RUNS_CAP}. */
  runs: RunRow[];
  /** How many run directories the cap left out of `runs`, 0 when every one is listed. */
  runsOmitted: number;
  latestRun: LatestRun | null;
}

/** The three blocks of {@link ChannelBody} the runs card reads from `analysis/`. */
export type AnalysisRuns = Pick<ChannelBody, "runs" | "runsOmitted" | "latestRun">;

/** Whether a parsed JSON value nests at most `levels` arrays or objects deep. It stops at the
 * bound, so it never recurses past it however deep the value goes. */
function nestsWithin(value: unknown, levels: number): boolean {
  if (value === null || typeof value !== "object") return true;
  if (levels === 0) return false;
  for (const child of Object.values(value)) if (!nestsWithin(child, levels - 1)) return false;
  return true;
}

/**
 * One JSON file the channel page reads - a Lunhui run file or the newest backtest: its size, and
 * its JSON when that parses within `cap` and {@link JSON_FILE_MAX_DEPTH} levels - otherwise
 * `parsed: false`, the size still counted.
 *
 * The file is opened without following a link (O_NOFOLLOW) or waiting on a FIFO (O_NONBLOCK), and
 * read only when the handle is a regular file with one link, as runs.mjs reads its own files.
 * Anything else, or a file that cannot be opened, is null. The cap is measured on the compact
 * JSON - as the Lunhui server measures its files, and as the page is sent - while files on disk
 * are often pretty-printed. So the file is read only up to `diskCap`, and a larger one is never
 * read at all: twice the cap by default; a caller whose files spread more passes its own.
 */
async function readBoundedJson(path: string, cap: number, diskCap = 2 * cap): Promise<{ bytes: number; parsed: boolean; json: unknown } | null> {
  let handle: FileHandle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    return null; // absent, a link, or not openable
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1) return null;
    const unparsed = { bytes: info.size, parsed: false, json: undefined };
    if (info.size > diskCap) return unparsed;
    /* one byte past the size: a file still growing is not one the server finished */
    const raw = Buffer.alloc(info.size + 1);
    let length = 0;
    while (length < raw.length) {
      const { bytesRead } = await handle.read(raw, length, raw.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > info.size) return unparsed;
    let json: unknown;
    try {
      json = JSON.parse(raw.toString("utf8", 0, length));
    } catch {
      return unparsed;
    }
    /* the depth first: JSON.stringify of a deeper value throws */
    if (!nestsWithin(json, JSON_FILE_MAX_DEPTH) || Buffer.byteLength(JSON.stringify(json)) > cap) return unparsed;
    return { bytes: info.size, parsed: true, json };
  } catch {
    return null; // the stat or a read failed
  } finally {
    await handle.close().catch(() => {});
  }
}

/** Whether a parsed JSON value is an object, not an array or null. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** A field that is a string, else null - nothing off the wire's types passes through. */
function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** A field that is an array of strings only, copied, else `[]` - one non-string member voids it. */
function stringsOrEmpty(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? [...value] : [];
}

/** The headline fields `fields` names that the artifact carries, in the table's order. */
function headlineOf(json: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const headline: Record<string, unknown> = {};
  for (const field of fields) if (Object.hasOwn(json, field)) headline[field] = json[field];
  return headline;
}

/** Whether `path` is still a real directory whose realpath is exactly `expected` - the listed
 * directory, not one swapped for a link since, nor reached through one (the idea of runs.mjs's
 * `stillResolved`). O_NOFOLLOW guards only a path's last component, so each directory a read
 * passes through is checked this way just before the read. Any failure is false. */
async function stillAt(path: string, expected: string): Promise<boolean> {
  try {
    return (await lstat(path)).isDirectory() && (await realpath(path)) === expected;
  } catch {
    return false;
  }
}

/** Every regular one-link file directly in a run directory, by its lstat size - no content read,
 * a link or a hard link counted as nothing, an entry gone since the listing skipped. Null when the
 * directory itself can no longer be listed - gone or unreadable since the listing. */
async function runBytes(runDir: string): Promise<number | null> {
  let names: string[];
  try {
    names = await readdir(runDir);
  } catch {
    return null;
  }
  let total = 0;
  for (const name of names) {
    try {
      const info = await lstat(join(runDir, name));
      if (info.isFile() && info.nlink === 1) total += info.size;
    } catch { /* gone since the listing */ }
  }
  return total;
}

/**
 * The runs card's blocks from a channel's `analysis/` (modules spec §5.11): run directories by the
 * id form, newest first, the newest `options.cap` (default {@link ANALYSIS_RUNS_CAP}) read and
 * listed and the rest counted. Only a real directory is read: an `analysis` link could point anywhere outside the
 * strategy, and what is read here reaches the page. Just before a run's reads, `analysis/` and the
 * run directory are checked to be still where the listing found them ({@link stillAt}); a run
 * that fails the check, or whose directory can no longer be listed, is skipped - not listed, not
 * counted. The evidence files are never opened. Throws when the strategy directory or
 * `analysis/` is absent (`ENOENT`) or cannot be read, and `ENOTDIR` when `analysis/` is a file or
 * a link rather than a real directory.
 */
export async function readAnalysisRuns(strategyDir: string, options: { cap?: number } = {}): Promise<AnalysisRuns> {
  const cap = options.cap ?? ANALYSIS_RUNS_CAP;
  const out: AnalysisRuns = { runs: [], runsOmitted: 0, latestRun: null };
  const analysisDir = join(strategyDir, "analysis");
  const realAnalysis = join(await realpath(strategyDir), "analysis");
  /* a file or a link where analysis/ should be is not "no runs yet" but a channel that cannot be
   * read: ENOTDIR, which readChannelBody swallows and readModulesChannels lists unreadable */
  if (!(await lstat(analysisDir)).isDirectory()) throw Object.assign(new Error("analysis/ is not a directory"), { code: "ENOTDIR" });
  /* run directories only - a link, a file or a stray name is not a run - newest first by id,
   * which opens with the run's UTC second, so name order is time order */
  const runs = (await readdir(analysisDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && ANALYSIS_RUN_RE.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  out.runsOmitted = Math.max(0, runs.length - cap);
  for (const run of runs.slice(0, cap)) {
    const runDir = join(analysisDir, run);
    if (!(await stillAt(analysisDir, realAnalysis)) || !(await stillAt(runDir, join(realAnalysis, run)))) continue;
    const read = await readBoundedJson(join(runDir, "run.json"), RUN_MANIFEST_MAX_BYTES);
    const manifest = read?.parsed === true && isRecord(read.json) ? read.json : {};
    const named = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
    const artifacts: RunRow["artifacts"] = {};
    const whole: LatestRun["artifacts"] = {};
    for (const { name, file, headline: fields } of MODULE_HEADLINES) {
      if (!named.includes(name)) continue;
      const artifact = await readBoundedJson(join(runDir, file), RUN_ARTIFACT_MAX_BYTES);
      if (artifact?.parsed !== true || !isRecord(artifact.json)) continue;
      const headline = headlineOf(artifact.json, fields);
      artifacts[name] = {
        accepted: true, status: stringOrNull(artifact.json.status), contractVersion: stringOrNull(artifact.json.contract_version), headline,
        missingSources: stringsOrEmpty(artifact.json.missing_sources), marketRun: stringOrNull(artifact.json.market_run),
      };
      whole[name] = { headline, json: artifact.json };
    }
    const bytes = await runBytes(runDir);
    if (bytes === null) continue;
    const row: RunRow = {
      run,
      asOf: stringOrNull(manifest.as_of),
      session: stringOrNull(manifest.session),
      snapshotId: stringOrNull(manifest.snapshot_id),
      sealed: typeof manifest.sealed_at === "string" && manifest.sealed_at !== "",
      kind: manifest.kind === "market" || manifest.kind === "strategy" ? manifest.kind : null,
      artifacts,
      marketRun: stringOrNull(whole.mode?.json.market_run),
      bytes,
      openedAt: stringOrNull(manifest.opened_at),
      sealedAt: stringOrNull(manifest.sealed_at),
      frozen: Array.isArray(manifest.evidence)
        ? manifest.evidence.filter(isRecord).map((entry) => entry.source).filter((source): source is string => typeof source === "string")
        : [],
      boardsProvider: boardsProviderOf(manifest.evidence),
    };
    out.runs.push(row);
    if (out.latestRun === null && row.sealed && Object.keys(whole).length > 0) {
      out.latestRun = { run, asOf: row.asOf, session: row.session, snapshotId: row.snapshotId, artifacts: whole, marketRun: row.marketRun };
    }
  }
  return out;
}

/**
 * Read one channel directory into the landing page's payload. Every block is
 * independent: a missing or broken file yields that block's empty value and
 * never fails the others, so one bad artifact cannot blank a channel's page.
 */
export async function readChannelBody(dir: string): Promise<ChannelBody> {
  const body: ChannelBody = {
    thesis: null, journal: [], backtests: [], latest: null, files: [], runs: [], runsOmitted: 0, latestRun: null,
  };

  try {
    const markdown = await readFile(join(dir, "THESIS.md"), "utf8");
    const isTemplate = markdown.includes(TEMPLATE_H1) && markdown.includes(TEMPLATE_BODY);
    body.thesis = { markdown, isTemplate };
  } catch { /* no thesis yet */ }

  try {
    const text = await readFile(join(dir, "journal.md"), "utf8");
    for (const line of text.split("\n")) {
      const m = JOURNAL_RE.exec(line.trim());
      if (m !== null) body.journal.push({ date: m[1], text: m[2].trim() });
    }
    /* newest first; a stable sort keeps same-day entries in file order */
    body.journal.sort((a, b) => b.date.localeCompare(a.date));
  } catch { /* no journal yet */ }

  try {
    const backtestsDir = join(dir, "backtests");
    /* only a real directory: a `backtests` link could point anywhere outside the strategy, and the
     * newest file read here reaches the page - the runs card treats `analysis/` the same way */
    if (!(await lstat(backtestsDir)).isDirectory()) throw new Error("backtests/ is not a directory");
    const entries = await readdir(backtestsDir, { withFileTypes: true });
    const rows: { file: string; bytes: number; dated: string | null }[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith(".")) continue;
      /* lstat, not stat: an entry swapped for a link after the listing is skipped, never followed;
       * one that vanished since the listing is skipped, not allowed to empty the whole list */
      let info;
      try {
        info = await lstat(join(backtestsDir, entry.name));
      } catch {
        continue;
      }
      if (!info.isFile()) continue;
      rows.push({ file: entry.name, bytes: info.size, dated: BACKTEST_RE.exec(entry.name)?.[1] ?? null });
    }
    /* dated JSONs newest-first, then everything else by name */
    rows.sort((a, b) => {
      if (a.dated !== null && b.dated !== null) return b.dated.localeCompare(a.dated) || a.file.localeCompare(b.file);
      if (a.dated !== null) return -1;
      if (b.dated !== null) return 1;
      return a.file.localeCompare(b.file);
    });
    body.backtests = rows.map((r) => ({ file: r.file, bytes: r.bytes }));
    const newest = rows.find((r) => r.dated !== null);
    /* the directory checked again just before the read: one swapped for a link since the listing
     * is not followed */
    if (newest !== undefined && (await stillAt(backtestsDir, join(await realpath(dir), "backtests")))) {
      /* bounded as the run files are; anything unread still lists, only the summary is lost */
      const read = await readBoundedJson(join(backtestsDir, newest.file), BACKTEST_MAX_BYTES, BACKTEST_MAX_DISK_BYTES);
      if (read?.parsed === true) body.latest = { file: newest.file, json: read.json };
    }
  } catch { /* no backtests/ yet, or not a directory */ }

  try {
    Object.assign(body, await readAnalysisRuns(dir));
  } catch { /* no analysis/ yet, not a directory, or its listing failed */ }

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || entry.name === "__pycache__") continue;
      const info = await stat(join(dir, entry.name));
      body.files.push({ name: entry.name, bytes: info.size, mtime: info.mtime.toISOString() });
    }
    body.files.sort((a, b) => a.name.localeCompare(b.name));
  } catch { /* unreadable directory — the page still renders its header */ }

  return body;
}

/** One workspace as this module uses it - structural, matching
 * `@deepseek-ai/dsh-workspace`'s `Workspace` (NEW packages/workspace/workspace/
 * src/types.ts:63-144, unchanged in the members read here), so the tests drive
 * the reconcile without booting a harness. */
export interface WorkspaceLike {
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly sessionIds: readonly string[];
  attachSession(sessionId: string): Promise<void>;
  status(): Promise<"ok" | "missing-dir">;
}

/** `ctx.workspaceRegistry`, narrowed to what the reconcile needs. NOTE:
 * `attachSession` and `resolveByPath` are service-only - neither is on the RPC
 * surface, which is why this runs in the face host and not in the browser. */
export interface RegistryLike {
  /**
   * Adopt a directory, or hand back the record that already owns it.
   *
   * The real signature takes a second `title`, and this one deliberately does
   * not narrow it in. That argument is honored ONLY when `create` MAKES the
   * record - "Repeated calls for the same canonical path return the existing
   * entity without changing its title"
   * (NEW packages/workspace/workspace/src/index.ts:220-236, where upstream now
   * marks the parameter itself for removal) - so a title passed from here
   * would land on a channel's very first listing and be silently ignored on
   * every listing after, for the whole life of the record.
   *
   * That fire-and-forget write is not worth having, because the title is not
   * the face's to set: it is a renameable display field decoupled from the
   * folder name (this module's header), the operator reaches it through the
   * `workspace/rename` Remote (NEW packages/api/workspace-controller/
   * src/index.ts:114-117) -> `Workspace.setTitle`, and the channel design
   * spells the listing rule `workspaceRegistry.create(path)` with no title at
   * all, recording the repo root's own title as "evolving-alpha-us" while
   * still calling it the workbench entry (the channels-design spec's section 2
   * "Existence rule", lines 63-82). The face's {@link WORKBENCH} names the
   * DIRECTORY side - `ChannelRow.name` - and the two fields may differ.
   *
   * The alternative - `setTitle` whenever title and name diverge - was
   * rejected: divergence is exactly what a rename produces, so correcting it
   * on every sidebar poll would overwrite the operator's own rename. The face
   * reads the title and never writes it.
   */
  create(path: string): Promise<WorkspaceLike>;
  list(): readonly WorkspaceLike[];
  readonly archivedSessionIds: readonly string[];
  /** Look up by canonical directory path without creating or mutating
   * anything — the same `fs.realpath` canonicalization `create` applies, but
   * a missing path rejects instead of being adopted as a new channel. This is
   * the lookup a session's cwd needs (panels.ts's `channelFor`): asking which
   * channel a directory belongs to must never conjure one into existence. */
  resolveByPath(path: string): Promise<WorkspaceLike | undefined>;
}

/** The header fields the face reads off a session: the reconcile's id and cwd,
 * and the preset the session was CREATED with, which becomes the client's
 * `presets` hint (see {@link presetHintsOf}). */
export interface SessionHeadLike {
  sessionId: string;
  cwd?: string;
  /** The header's `agentPreset` (NEW packages/core/session/src/types.ts:94-131),
   * when the session names one. Absent, not blank, when it does not. */
  agentPreset?: string;
}

/**
 * Union a persisted session listing with a live one, live winning on a
 * shared id. `sessions.list()` (dsh-session) answers only "All live
 * sessions, in creation order" (NEW packages/core/session/src/index.ts:1232-1235)
 * — sessions loaded into THIS process — never the durable history; feeding the
 * reconcile from that alone means a session attaches only if it happens to be
 * live at the moment the sidebar polls, which strands most of the operator's
 * past sessions in `ungrouped` (C1). `sessionPersistence.list()` is the seam
 * that answers the durable listing instead; at dsh 0.2 it returns SNAPSHOTS
 * `{header, revision, eventCount?, sizeBytes?}` rather than bare headers
 * (NEW packages/session/session-persistence/src/index.ts:50-58, 196-201), and
 * main.ts maps each `snapshot.header` to a head. `dsh-workspace`'s own
 * registry bootstrap reads both this way, live indexed after persisted so a
 * live header overrides a possibly-stale persisted one for the same id
 * (NEW packages/workspace/workspace/src/index.ts:207-214, 825-833).
 *
 * Order is `[...persisted, ...live]` folded through a `Map`, so live entries
 * — later in the array — overwrite a same-id persisted entry rather than the
 * reverse: a just-created session may not be flushed to persistence yet, and
 * a live header is never staler than a persisted one.
 * @param persisted - every materialized session (`sessionPersistence.list()`, mapped).
 * @param live - every session held live by this process (`sessions.list()`, mapped).
 */
export function mergeSessionHeads(
  persisted: readonly SessionHeadLike[],
  live: readonly SessionHeadLike[],
): SessionHeadLike[] {
  return [...new Map([...persisted, ...live].map((s) => [s.sessionId, s] as const)).values()];
}

/** The listing the reconcile runs on: the durable one unioned with the live one,
 * degrading to live-only if the durable read fails.
 *
 * `sessionPersistence.list()` can throw where `sessions.list()` never could - a
 * legacy flat layout, a corrupt header frame, an id collision. Unguarded, that
 * throw fails the whole reconcile, so `/data/channels.json` answers 500 and the
 * sidebar loses ALL grouping until the store is repaired. Falling back to the
 * live listing leaves grouping merely INCOMPLETE for this listing - which is
 * what the face saw before it read persisted sessions at all - and the failure
 * is reported rather than swallowed (charter Rule 5: what is never surfaced is
 * never governed).
 *
 * Cost, since this runs on every listing and the sidebar polls: the durable read
 * is O(sessions on disk across ALL projects), each costing a bounded header read,
 * and it only grows. Nothing caches it today; if that starts to bite, cache here
 * rather than making the reconcile conditional.
 * @param persisted - the durable listing, mapped.
 * @param live - this process's live listing, mapped. Read before the durable one
 *   so a throw cannot cost us the sessions we already had.
 * @param onPersistedError - told about a durable-read failure; never swallowed.
 */
export async function listSessionHeads(
  persisted: () => Promise<readonly SessionHeadLike[]>,
  live: () => readonly SessionHeadLike[],
  onPersistedError: (err: unknown) => void,
): Promise<SessionHeadLike[]> {
  const liveHeads = live();
  try {
    return mergeSessionHeads(await persisted(), liveHeads);
  } catch (err) {
    onPersistedError(err);
    return [...liveHeads];
  }
}

/**
 * sessionId → the preset its header names, for every head that names one: the
 * `presets` field of `/data/channels.json`.
 *
 * WHY THE CLIENT NEEDS IT. dsh 0.2's `session/list` summary dropped the
 * `agentPreset` field 0.1.1's carried (NEW packages/api/session-controller/
 * src/types.ts:177-188); the value now rides the row's projection block,
 * which a COLD row may lack or omit - listing hints are "partial: missing
 * cells and cache rows are never materialized" (list.ts:304-305), and a cache
 * record written by 0.1.1 yields only the predecessor title (list.ts:283). The
 * header still records the creation-time preset, so the client's intake
 * (client/summaries.js) falls back to this map when the projection is silent -
 * otherwise every cold bot or member row would silently read as the host.
 * A blank or non-string value is no preset and is left out.
 * @param heads - the merged persisted + live heads the reconcile already read.
 */
export function presetHintsOf(heads: readonly SessionHeadLike[]): Record<string, string> {
  // fromEntries defines own data properties, so no session id - not even
  // `__proto__` - can reach the object's prototype the way an assignment would.
  return Object.fromEntries(heads
    .filter((head): head is SessionHeadLike & { agentPreset: string } => typeof head.agentPreset === "string" && head.agentPreset !== "")
    .map((head) => [head.sessionId, head.agentPreset]));
}

/** One channel as the sidebar and the picker see it. */
export interface ChannelRow {
  workspaceId: string;
  /** Directory basename (or "workbench") - the git-visible identity. */
  name: string;
  /** The registry's display title: the operator's field, defaulting to the
   * basename at create and changed only through the `workspace/rename` Remote.
   * Read here, never written - see {@link RegistryLike.create}. */
  title: string;
  dir: string;
  isRoot: boolean;
  status?: string;
  /** The directory is gone but the record remains - greyed, never deleted. */
  missingDir: boolean;
  sessionIds: string[];
}

/**
 * Make the registry match the directories, then answer with the channel list.
 *
 * Idempotent by construction: `create` returns an existing record for a
 * canonical path and is passed no title to change, `attachSession` early-outs
 * on membership before any validation, and `seedRoster` is a no-op once an
 * entry exists. Safe on every listing; in the steady state it performs no
 * writes.
 *
 * A workspace whose directory has vanished is REPORTED, never deleted -
 * deleting it would silently drop the operator's history.
 */
export async function reconcileChannels(deps: {
  registry: RegistryLike;
  root: string;
  home: string;
  sessions: readonly SessionHeadLike[];
  connectedBins: readonly string[];
}): Promise<{ channels: ChannelRow[]; ungrouped: SessionHeadLike[] }> {
  const { registry, root, home, sessions, connectedBins } = deps;

  const dirs = await listChannelDirs(root);
  /* The real registry canonicalizes `path` (e.g. via fs.realpath) on create,
   * so the record it hands back can spell a directory differently than the
   * string we walked (a symlinked tmp dir or mount point, `..` segments,
   * ...) - macOS alone does this for every `os.tmpdir()` path. Track BOTH
   * spellings for every adopted channel: neither the attach match nor the
   * orphan scan below may assume the two are the same string. */
  const knownPaths = new Set<string>();
  const rows: ChannelRow[] = [];
  const claimed = new Set<string>();

  for (const d of dirs) {
    let ws: WorkspaceLike;
    try {
      ws = await registry.create(d.dir); // the directory only; the title is the operator's
    } catch {
      /* the directory vanished between readdir and create - the next listing
       * sees it as gone, which is already a defined state */
      continue;
    }
    const paths = new Set([d.dir, ws.path]);
    for (const p of paths) knownPaths.add(p);

    for (const session of sessions) {
      if (session.cwd === undefined || !paths.has(session.cwd)) continue; // the channel dir itself, never a subdirectory
      try {
        await ws.attachSession(session.sessionId);
        /* Claimed only once the attach actually lands. The real host
         * validates the session header's cwd against the workspace path and
         * REJECTS a mismatch without writing (caught below) - marking the
         * session claimed before that call, as an earlier version of this
         * function did, would silently drop a refused session from every
         * surface: not in `sessionIds`, not in `ungrouped` either. Falling
         * through to `ungrouped` on rejection is the correct report
         * (charter Rule 5: what is never surfaced is never governed). */
        claimed.add(session.sessionId);
      } catch { /* the host validates the header cwd and refuses; not ours to force */ }
    }
    await seedRoster(home, ws.id, connectedBins);
    const status = await readChannelStatus(d.dir);
    const row: ChannelRow = {
      workspaceId: ws.id, name: d.name, title: ws.title, dir: d.dir, isRoot: d.isRoot,
      missingDir: (await ws.status()) === "missing-dir",
      sessionIds: [...ws.sessionIds],
    };
    if (status.status !== undefined) row.status = status.status;
    rows.push(row);
  }

  /* Registered workspaces whose directory is no longer a channel: keep them
   * visible so nothing the operator made disappears silently. */
  for (const ws of registry.list()) {
    if (knownPaths.has(ws.path)) continue;
    for (const id of ws.sessionIds) claimed.add(id);
    rows.push({
      workspaceId: ws.id,
      name: ws.path.split("/").filter((p) => p !== "").pop() ?? ws.title,
      title: ws.title, dir: ws.path, isRoot: false,
      missingDir: (await ws.status()) === "missing-dir",
      sessionIds: [...ws.sessionIds],
    });
  }

  /* Rule 5: what is never surfaced is never governed. Sessions belonging to
   * no channel are RETURNED and counted, not filtered away. */
  const ungrouped = sessions.filter((s) => !claimed.has(s.sessionId));
  return { channels: rows, ungrouped };
}

/* ---------- creating a channel, and the four routes over all of the above
 * (Task 7) ---------- */

/** Exactly a channel directory name: one path segment of letters and digits
 * in ANY script (a Chinese name is a name) plus `-` and `_`, 1-41 code
 * points, opening with a letter or digit - so `.`/`..`, dotfiles, separators,
 * spaces and control characters never reach a path. Compared and created in
 * NFC, so one word typed in two normalizations is one directory. */
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}\p{M}_-]{0,40}$/u;

/** Birth `strategies/<name>` from the template. Refuses a malformed name, a
 * taken name, and a missing template - never overwrites anything. */
export async function createChannel(root: string, rawName: unknown): Promise<ChannelDir> {
  const name = typeof rawName === "string" ? rawName.normalize("NFC") : rawName;
  if (typeof name !== "string" || !NAME_RE.test(name) || name === TEMPLATE) {
    throw new HttpError(400, "invalid channel name (letters or digits in any script, plus - and _; no spaces, dots or slashes; up to 41 characters)");
  }
  const template = join(root, "strategies", TEMPLATE);
  try {
    await stat(template);
  } catch {
    throw new HttpError(500, "strategies/_template missing");
  }
  const target = join(root, "strategies", name);
  let exists = true;
  try {
    await stat(target);
  } catch {
    exists = false;
  }
  if (exists) throw new HttpError(409, "channel already exists");
  await cp(template, target, { recursive: true, filter: (src) => !src.includes("__pycache__") });
  return { name, dir: target, isRoot: false };
}

/* ---------- the module cards' listing: /data/modules.json (Lunhui module cards spec 2026-10-28) ---------- */

/** How many runs per channel `/data/modules.json` lists, newest first. */
export const MODULES_RUNS_CAP = 12;

/** The market read's channel - the same string as `MARKET_CHANNEL` in
 * `plugins/lunhui/lib/freeze-tool.mjs` (a test pins the two equal). */
export const MARKET_CHANNEL = "cn-market";

/** One run as a module card reads it: {@link RunRow} without the runs card's `bytes`, `sealed`,
 * `snapshotId`, `kind`, `marketRun` and each artifact's `accepted` and `contractVersion`. */
export interface ModuleRunRow {
  run: string;
  session: string | null;
  asOf: string | null;
  openedAt: string | null;
  sealedAt: string | null;
  frozen: string[];
  boardsProvider: string | null;
  artifacts: { [module: string]: { status: string | null; missingSources: string[]; headline: Record<string, unknown>; marketRun: string | null } };
}

/** One channel's runs for the module cards. `unreadable` is set only when its `analysis/` could not
 * be read for a reason other than not existing yet; its runs are then empty. */
export interface ModulesChannel {
  channel: string;
  workspaceId: string;
  kind: "market" | "strategy";
  runs: ModuleRunRow[];
  runsOmitted: number;
  unreadable?: true;
}

function moduleRunRow(row: RunRow): ModuleRunRow {
  const artifacts: ModuleRunRow["artifacts"] = {};
  for (const [name, a] of Object.entries(row.artifacts)) {
    artifacts[name] = { status: a.status, missingSources: a.missingSources, headline: a.headline, marketRun: a.marketRun };
  }
  return {
    run: row.run, session: row.session, asOf: row.asOf, openedAt: row.openedAt, sealedAt: row.sealedAt,
    frozen: row.frozen, boardsProvider: row.boardsProvider, artifacts,
  };
}

/**
 * Every channel but the root and a missing directory, in the order given, with its newest
 * {@link MODULES_RUNS_CAP} runs. `kind` is `"market"` for {@link MARKET_CHANNEL}, else
 * `"strategy"`. A `read` that throws `ENOENT` (no `analysis/` yet) is a channel with no runs; any
 * other throw lists the channel `unreadable`, its runs empty - nothing from the error is kept, and
 * one channel's failure never fails the others.
 */
export async function readModulesChannels(
  rows: readonly ChannelRow[],
  read: (dir: string, options: { cap: number }) => Promise<AnalysisRuns> = readAnalysisRuns,
): Promise<ModulesChannel[]> {
  const out: ModulesChannel[] = [];
  for (const row of rows) {
    if (row.isRoot || row.missingDir) continue;
    const channel: ModulesChannel = {
      channel: row.name, workspaceId: row.workspaceId, kind: row.name === MARKET_CHANNEL ? "market" : "strategy",
      runs: [], runsOmitted: 0,
    };
    try {
      const { runs, runsOmitted } = await read(row.dir, { cap: MODULES_RUNS_CAP });
      channel.runs = runs.map(moduleRunRow);
      channel.runsOmitted = runsOmitted;
    } catch (err) {
      if ((err as NodeJS.ErrnoException | null)?.code !== "ENOENT") channel.unreadable = true;
    }
    out.push(channel);
  }
  return out;
}

/** What the routes need of the booted tree. Injected so the tests drive them
 * without a harness. */
export interface ChannelRouteDeps {
  registry: RegistryLike;
  /** Absolute workbench repo root. */
  root: string;
  /** The harness home holding `face/channels.json`. */
  home: string;
  /** Every persisted and live session's id, cwd and header preset - main.ts
   * maps `sessionPersistence.list()` snapshots and `sessions.list()` through
   * {@link listSessionHeads}. */
  listSessions(): Promise<SessionHeadLike[]>;
  /** The bins a newly adopted channel's roster is seeded from. */
  connectedBins(): Promise<string[]>;
  /** Every bot directory with dsh's view merged in (`listBots` in bots.ts, narrowed). */
  listBots(): Promise<{ id: string; name: string; broken?: string; listed: boolean }[]>;
  /** Whether the Lunhui runs row is mounted (`lunhuiMounted` in panels.ts over the loader's entries). */
  lunhuiMounted(): boolean;
}

/** Mount the channel routes and the module cards' listing. Same trust posture as every `/data` route: http.ts's fence
 * runs FIRST on every route, the refusal body is fixed text, and nothing
 * attacker-controlled is ever echoed. A workspace id from a body is only ever
 * COMPARED against the reconciled list - it never becomes a path. */
export function registerChannelRoutes(webServer: RouteRegistrar, deps: ChannelRouteDeps): void {
  /** Serialize first, then write the head. A body JSON.stringify refuses - a value nested too
   * deep, a BigInt - answers one 500 with fixed text; written the other way round, the head went
   * out first, the throw reached the route's catch, its 500 could not be written any more, and the
   * page got a dead socket. */
  const send = (res: ServerResponse, status: number, body: unknown): void => {
    let code = status;
    let text: string;
    try {
      text = typeof body === "string" ? body : JSON.stringify(body);
    } catch {
      code = 500;
      text = JSON.stringify({ ok: false, error: "response could not be serialized" });
    }
    res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
    res.end(text);
  };

  /** One reconcile, plus the heads it ran on - the listing route answers the
   * clients' preset hints from the very same read. */
  const reconcile = async (): Promise<{ channels: ChannelRow[]; ungrouped: SessionHeadLike[]; heads: SessionHeadLike[] }> => {
    const heads = await deps.listSessions();
    const reconciled = await reconcileChannels({
      registry: deps.registry, root: deps.root, home: deps.home,
      sessions: heads, connectedBins: await deps.connectedBins(),
    });
    return { ...reconciled, heads };
  };

  /** The guard the three writing routes share. */
  const guardPost = (req: IncomingMessage, res: ServerResponse): boolean => {
    if (!isTrustedDataRequest(req)) { send(res, 403, FORBIDDEN); return false; }
    if (req.method !== "POST") { send(res, 405, { ok: false, error: "POST only" }); return false; }
    if (!isJsonBody(req)) { send(res, 415, { ok: false, error: "application/json only" }); return false; }
    return true;
  };

  const bodyOf = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
    try {
      const parsed: unknown = JSON.parse(await readBody(req));
      return parsed !== null && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(400, "body must be JSON");
    }
  };

  webServer.register({
    kind: "exact",
    path: "/data/channels.json",
    handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (!isTrustedDataRequest(req)) return send(res, 403, FORBIDDEN);
      try {
        const { channels, ungrouped, heads } = await reconcile();
        return send(res, 200, {
          ok: true, root: deps.root, channels, ungrouped,
          archived: [...deps.registry.archivedSessionIds],
          // sessionId → header preset: the client's fallback where a 0.2 list
          // row's projection block does not name one (presetHintsOf).
          presets: presetHintsOf(heads),
        });
      } catch {
        /* nothing from the filesystem error reaches the body */
        return send(res, 500, { ok: false, error: "listing failed" });
      }
    },
  });

  webServer.register({
    kind: "exact",
    path: "/data/modules.json",
    handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (!isTrustedDataRequest(req)) return send(res, 403, FORBIDDEN);
      try {
        const { channels } = await reconcile();
        return send(res, 200, {
          ok: true, mounted: deps.lunhuiMounted(), root: deps.root, channels: await readModulesChannels(channels),
        });
      } catch {
        /* nothing from the filesystem error reaches the body */
        return send(res, 500, { ok: false, error: "listing failed" });
      }
    },
  });

  webServer.register({
    kind: "exact",
    path: "/data/channels/overview",
    handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (!guardPost(req, res)) return;
      try {
        const { workspaceId } = await bodyOf(req);
        const { channels } = await reconcile();
        const channel = channels.find((c) => c.workspaceId === workspaceId);
        if (channel === undefined) return send(res, 404, { ok: false, error: "no such channel" });
        return send(res, 200, {
          ok: true, channel,
          status: await readChannelStatus(channel.dir),
          body: await readChannelBody(channel.dir),
          agents: await rosterFor(deps.home, channel.workspaceId) ?? [],
          bots: await botsFor(deps.home, channel.workspaceId) ?? [],
          allBots: await deps.listBots(),
        });
      } catch (err) {
        if (err instanceof HttpError) return send(res, err.status, { ok: false, error: err.message });
        return send(res, 500, { ok: false, error: "overview failed" });
      }
    },
  });

  webServer.register({
    kind: "exact",
    path: "/data/channels/agents",
    handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (!guardPost(req, res)) return;
      try {
        const { workspaceId, agents } = await bodyOf(req);
        const { channels } = await reconcile();
        if (!channels.some((c) => c.workspaceId === workspaceId)) return send(res, 404, { ok: false, error: "no such channel" });
        if (!Array.isArray(agents) || agents.some((a) => typeof a !== "string")) {
          return send(res, 400, { ok: false, error: "agents must be an array of bin names" });
        }
        const id = workspaceId as string;
        await setRoster(deps.home, id, agents as string[]);
        /* The roster is operator-owned, but the surface that writes it is an
         * unauthenticated loopback route (spec section 5, limit 3). What
         * cannot be prevented is at least made VISIBLE - Rule 5 - via a
         * dated line in a durable face log (I2; see roster.ts's
         * `logRosterWrite`), not just a bare, undated stdout line. */
        await logRosterWrite(deps.home, id, agents as string[]);
        return send(res, 200, { ok: true, agents: await rosterFor(deps.home, id) ?? [] });
      } catch (err) {
        if (err instanceof HttpError) return send(res, err.status, { ok: false, error: err.message });
        return send(res, 500, { ok: false, error: "roster write failed" });
      }
    },
  });

  webServer.register({
    kind: "exact",
    path: "/data/channels/bots",
    handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (!guardPost(req, res)) return;
      try {
        const { workspaceId, bots } = await bodyOf(req);
        const { channels } = await reconcile();
        if (!channels.some((c) => c.workspaceId === workspaceId)) return send(res, 404, { ok: false, error: "no such channel" });
        if (!Array.isArray(bots) || bots.some((b) => !isBotId(b))) {
          return send(res, 400, { ok: false, error: "bots must be an array of bot ids" });
        }
        const ids = [...new Set(bots as string[])];
        /* The cap is the room's, not the store's: six members is what one
         * operator message may cost (spec §4.6, P5). Refused here, before the
         * write, so the file never holds a roster the engine would refuse. */
        if (ids.length > ROOM_CAPS.maxMembers) {
          return send(res, 400, { ok: false, error: `a channel rosters at most ${ROOM_CAPS.maxMembers} bots` });
        }
        const id = workspaceId as string;
        await setBots(deps.home, id, ids);
        await logBotsWrite(deps.home, id, ids);
        return send(res, 200, { ok: true, bots: await botsFor(deps.home, id) ?? [] });
      } catch (err) {
        if (err instanceof HttpError) return send(res, err.status, { ok: false, error: err.message });
        return send(res, 500, { ok: false, error: "roster write failed" });
      }
    },
  });

  webServer.register({
    kind: "exact",
    path: "/data/channels",
    handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (!guardPost(req, res)) return;
      let made: ChannelDir;
      try {
        made = await createChannel(deps.root, (await bodyOf(req)).name);
      } catch (err) {
        if (err instanceof HttpError) return send(res, err.status, { ok: false, error: err.message });
        return send(res, 500, { ok: false, error: "create failed" });
      }
      /* I3: the directory is ON DISK once createChannel above returns - the
       * channel exists whether or not this reconcile succeeds. A throw here
       * (EACCES out of listChannelDirs, a withFileLock timeout in
       * seedRoster, an EIO in ws.status()) must NOT be reported as "create
       * failed": that would be a successful creation answered as a 500, the
       * client showing no row, and a retry hitting 409 "channel already
       * exists" - the face contradicting its own filesystem. Adoption and
       * roster-seeding are a convenience that also runs on every ordinary
       * listing, so a failure here just means the NEXT listing does the
       * adopting instead - never fatal to this response. */
      try {
        await reconcile(); // adopt it and seed its roster before the client asks
      } catch (err) {
        /* Not fatal to this response - the next listing adopts it instead - but
         * the codebase says a swallowed failure still gets a line. */
        console.warn(`${BIN}: created ${made.name}, but adopting it now failed; the next listing will:`, err);
      }
      return send(res, 200, { ok: true, ...made });
    },
  });
}
