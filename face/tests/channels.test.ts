import test from "node:test";
import assert from "node:assert/strict";
import fsPromises, { lstat, mkdtemp, mkdir, readdir, readFile, rename, writeFile, realpath, stat, rm, symlink, link } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { WebRoute } from "@deepseek-ai/dsh-host-webserver";
import {
  BACKTEST_MAX_BYTES, BACKTEST_MAX_DISK_BYTES, createChannel, listChannelDirs, listSessionHeads, mergeSessionHeads,
  MODULE_HEADLINES, presetHintsOf, readAnalysisRuns, readChannelStatus, readChannelBody, reconcileChannels, registerChannelRoutes, WORKBENCH,
} from "../src/channels.ts";
import { rosterFor, setRoster } from "../src/roster.ts";
import { HttpError } from "../src/http.ts";
import { MODULES } from "../plugins/lunhui/lib/modules.mjs";
import { addEvidence, openRun, sealRun } from "../plugins/lunhui/lib/runs.mjs";

/** A throwaway workbench root: strategies/{_template, alpha, 市场情绪,
 * .hidden, __pycache__} plus a stray FILE that must never list. */
export async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "face-channels-"));
  for (const name of ["_template", "alpha", "市场情绪", ".hidden", "__pycache__"]) {
    await mkdir(join(root, "strategies", name), { recursive: true });
  }
  await writeFile(join(root, "strategies", "loose.txt"), "not a channel");
  await writeFile(join(root, "strategies", "alpha", "status.yaml"), "status: researching  # comment\n");
  return root;
}

test("listChannelDirs: repo root first, then strategies; template, dotted, __ and files excluded", async () => {
  const root = await makeRoot();
  const dirs = await listChannelDirs(root);
  assert.deepEqual(dirs.map((d) => d.name), ["workbench", "alpha", "市场情绪"]);
  assert.equal(dirs[0].isRoot, true);
  assert.equal(dirs[0].dir, root);
  assert.equal(dirs[1].isRoot, false);
  assert.equal(dirs[1].dir, join(root, "strategies", "alpha"));
});

test("listChannelDirs: a missing strategies/ still yields the workbench", async () => {
  const root = await mkdtemp(join(tmpdir(), "face-empty-"));
  assert.deepEqual((await listChannelDirs(root)).map((d) => d.name), ["workbench"]);
});

test("listChannelDirs: strategies as a file (not directory) throws ENOTDIR", async () => {
  const root = await mkdtemp(join(tmpdir(), "face-enotdir-"));
  await writeFile(join(root, "strategies"), "not a directory");
  await assert.rejects(
    () => listChannelDirs(root),
    (err: NodeJS.ErrnoException) => err.code === "ENOTDIR",
  );
});

async function statusDir(text: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "face-status-"));
  await writeFile(join(dir, "status.yaml"), text);
  return dir;
}

test("readChannelStatus reads the optional headline keys", async () => {
  const dir = await statusDir([
    "status: researching   # idea | researching | validated",
    "one_line: 存储涨价周期仍在早期",
    "next: 等 11 月合约价",
    "numbers:",
    "  样本天数: 526",
    "  最大回撤: -18.98%",
    "",
  ].join("\n"));
  const s = await readChannelStatus(dir);
  assert.equal(s.status, "researching");
  assert.equal(s.one_line, "存储涨价周期仍在早期");
  assert.equal(s.next, "等 11 月合约价");
  assert.deepEqual(s.numbers, { 样本天数: "526", 最大回撤: "-18.98%" });
});

test("readChannelStatus: today's one-line file still works, and unknown keys are ignored", async () => {
  const s = await readChannelStatus(await statusDir("status: idea   # idea | researching\nmystery: 7\n"));
  assert.deepEqual(s, { status: "idea" });
});

test("readChannelStatus: malformed YAML degrades to the regex — a badge, not a gate", async () => {
  const s = await readChannelStatus(await statusDir("status: paper\n  bad: [unclosed\n"));
  assert.equal(s.status, "paper", "the status word still comes through");
  assert.equal(s.one_line, undefined);
});

test("readChannelStatus: no file at all is an empty reading, never a throw", async () => {
  assert.deepEqual(await readChannelStatus(await mkdtemp(join(tmpdir(), "face-nostatus-"))), {});
});

test("readChannelStatus: numbers is stringified, and a non-object numbers is dropped", async () => {
  assert.deepEqual((await readChannelStatus(await statusDir("numbers:\n  n: 526\n"))).numbers, { n: "526" });
  assert.equal((await readChannelStatus(await statusDir("numbers: 7\n"))).numbers, undefined);
});

const TEMPLATE_THESIS = "# <strategy name>\n\n**Status:** idea\n\n## Thesis\n\nWhat market behavior does this capture, and why does it exist?\n";

test("readChannelBody: an untouched template thesis is flagged, not presented as content", async () => {
  const dir = await mkdtemp(join(tmpdir(), "face-body-"));
  await writeFile(join(dir, "THESIS.md"), TEMPLATE_THESIS);
  const body = await readChannelBody(dir);
  assert.equal(body.thesis?.isTemplate, true);
});

test("readChannelBody: a written thesis is not flagged", async () => {
  const dir = await mkdtemp(join(tmpdir(), "face-body2-"));
  await writeFile(join(dir, "THESIS.md"), "# 市场情绪\n\n## Thesis\n\nBreadth leads price.\n");
  const body = await readChannelBody(dir);
  assert.equal(body.thesis?.isTemplate, false);
  assert.match(body.thesis?.markdown ?? "", /Breadth leads price/);
});

test("readChannelBody: no THESIS.md is null, not an empty string", async () => {
  assert.equal((await readChannelBody(await mkdtemp(join(tmpdir(), "face-body3-")))).thesis, null);
});

test("readChannelBody: journal entries parse newest first, prose without a date is ignored", async () => {
  const dir = await mkdtemp(join(tmpdir(), "face-body4-"));
  await writeFile(join(dir, "journal.md"), [
    "# Journal",
    "",
    "- 2026-09-01: built the composite.",
    "- 2026-09-02: falsified; cold +0.82%.",
    "some loose prose",
    "",
  ].join("\n"));
  const body = await readChannelBody(dir);
  assert.deepEqual(body.journal.map((e) => e.date), ["2026-09-02", "2026-09-01"]);
  assert.equal(body.journal[0].text, "falsified; cold +0.82%.");
});

test("readChannelBody: the newest backtest by FILENAME date is picked and parsed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "face-body5-"));
  await mkdir(join(dir, "backtests"), { recursive: true });
  await writeFile(join(dir, "backtests", "2026-09-02-sentiment.json"), JSON.stringify({ n_days: 526 }));
  await writeFile(join(dir, "backtests", "2026-08-11-run.json"), JSON.stringify({ n_days: 1 }));
  await writeFile(join(dir, "backtests", "sentiment_series.csv"), "day,score\n");
  await writeFile(join(dir, "backtests", ".gitkeep"), "");
  const body = await readChannelBody(dir);
  assert.deepEqual(body.backtests.map((b) => b.file), ["2026-09-02-sentiment.json", "2026-08-11-run.json", "sentiment_series.csv"]);
  assert.equal(body.latest?.file, "2026-09-02-sentiment.json");
  assert.deepEqual(body.latest?.json, { n_days: 526 });
});

test("readChannelBody: an unparseable backtest never throws — latest is null, the file still lists", async () => {
  const dir = await mkdtemp(join(tmpdir(), "face-body6-"));
  await mkdir(join(dir, "backtests"), { recursive: true });
  await writeFile(join(dir, "backtests", "2026-09-02-broken.json"), "{not json");
  const body = await readChannelBody(dir);
  assert.equal(body.latest, null);
  assert.deepEqual(body.backtests.map((b) => b.file), ["2026-09-02-broken.json"]);
});

test("a strategy without backtests draws no backtests section", async () => {
  const dir = await mkdtemp(join(tmpdir(), "face-body-nobt-"));
  await writeFile(join(dir, "THESIS.md"), "# alpha\n\n## Thesis\n\nBreadth leads price.\n");
  await writeFile(join(dir, "journal.md"), "# Journal\n\n- 2026-10-24: created from _template.\n");
  await writeFile(join(dir, "status.yaml"), "status: idea\n");
  const body = await readChannelBody(dir);
  assert.deepEqual(body.backtests, []);
  assert.equal(body.latest, null);
  assert.equal(body.thesis?.isTemplate, false);
  assert.deepEqual(body.journal, [{ date: "2026-10-24", text: "created from _template." }]);
  assert.deepEqual(body.files.map((f) => f.name).sort(), ["THESIS.md", "journal.md", "status.yaml"]);
});

test("readChannelBody: the file list skips __pycache__ and directories", async () => {
  const dir = await mkdtemp(join(tmpdir(), "face-body7-"));
  await mkdir(join(dir, "__pycache__"), { recursive: true });
  await mkdir(join(dir, "notes"), { recursive: true });
  await writeFile(join(dir, "THESIS.md"), "# alpha\n");
  const body = await readChannelBody(dir);
  assert.deepEqual(body.files.map((f) => f.name), ["THESIS.md"]);
});

test("readChannelBody: a newest backtest over the cap or nested past 32 levels is unread - it still lists, the body serializes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "face-bt-bounds-"));
  await writeFile(join(dir, "THESIS.md"), "# alpha\n\n## Thesis\n\nBreadth leads price.\n");
  await mkdir(join(dir, "backtests"));
  const frame = Buffer.byteLength(JSON.stringify({ summary: "" }));
  // exactly the cap, measured on the compact JSON the page is sent: parses
  const at = JSON.stringify({ summary: "x".repeat(BACKTEST_MAX_BYTES - frame) });
  assert.equal(Buffer.byteLength(at), BACKTEST_MAX_BYTES);
  await writeFile(join(dir, "backtests", "2026-10-01-at.json"), at);
  assert.equal((await readChannelBody(dir)).latest?.file, "2026-10-01-at.json");
  // one byte past it: listed with its size, never parsed
  const over = JSON.stringify({ summary: "x".repeat(BACKTEST_MAX_BYTES - frame + 1) });
  await writeFile(join(dir, "backtests", "2026-10-02-over.json"), over);
  let body = await readChannelBody(dir);
  assert.equal(body.latest, null);
  assert.deepEqual(body.backtests.map((b) => [b.file, b.bytes]), [
    ["2026-10-02-over.json", Buffer.byteLength(over)], ["2026-10-01-at.json", Buffer.byteLength(at)],
  ]);
  // far past it, never read whole
  await writeFile(join(dir, "backtests", "2026-10-03-huge.json"), JSON.stringify({ summary: "长".repeat(1_000_000) }));
  assert.equal((await readChannelBody(dir)).latest, null);
  // 10,000 levels in 20 KB: JSON.parse takes them, the overview's JSON.stringify would throw
  await writeFile(join(dir, "backtests", "2026-10-04-deep.json"), "[".repeat(10000) + "]".repeat(10000));
  body = await readChannelBody(dir);
  assert.equal(body.backtests[0].file, "2026-10-04-deep.json");
  assert.equal(body.latest, null);
  assert.doesNotThrow(() => JSON.stringify(body));
  assert.match(body.thesis?.markdown ?? "", /Breadth leads price/);

  // the depth bound itself: 32 levels parse, 33 do not
  const nested = (levels: number): string => `{"n":${"[".repeat(levels - 1)}${"]".repeat(levels - 1)}}`;
  const atDepth = await mkdtemp(join(tmpdir(), "face-bt-depth32-"));
  await mkdir(join(atDepth, "backtests"));
  await writeFile(join(atDepth, "backtests", "2026-10-05-d.json"), nested(32));
  assert.equal((await readChannelBody(atDepth)).latest?.file, "2026-10-05-d.json");
  const pastDepth = await mkdtemp(join(tmpdir(), "face-bt-depth33-"));
  await mkdir(join(pastDepth, "backtests"));
  await writeFile(join(pastDepth, "backtests", "2026-10-05-d.json"), nested(33));
  assert.equal((await readChannelBody(pastDepth)).latest, null);
});

test("readChannelBody: a backtest is read up to the disk ceiling - pretty-printed at the compact cap it parses, padded past the ceiling it does not", async () => {
  // JSON.stringify(x, null, 2) spreads a series of small numbers about 3.5 times: within the
  // compact cap, past twice it on disk
  const pretty = await mkdtemp(join(tmpdir(), "face-bt-pretty-"));
  await mkdir(join(pretty, "backtests"));
  const series = { series: new Array<number>(520_000).fill(1) };
  const onDisk = JSON.stringify(series, null, 2);
  assert.ok(Buffer.byteLength(JSON.stringify(series)) <= BACKTEST_MAX_BYTES);
  assert.ok(Buffer.byteLength(onDisk) > 2 * BACKTEST_MAX_BYTES && Buffer.byteLength(onDisk) <= BACKTEST_MAX_DISK_BYTES);
  await writeFile(join(pretty, "backtests", "2026-10-06-pretty.json"), onDisk);
  assert.equal((await readChannelBody(pretty)).latest?.file, "2026-10-06-pretty.json");
  // tiny compact JSON padded past the ceiling: never read, however small it would parse
  const padded = await mkdtemp(join(tmpdir(), "face-bt-padded-"));
  await mkdir(join(padded, "backtests"));
  const text = `{"n":1}${" ".repeat(BACKTEST_MAX_DISK_BYTES)}`;
  await writeFile(join(padded, "backtests", "2026-10-07-padded.json"), text);
  const body = await readChannelBody(padded);
  assert.equal(body.latest, null);
  assert.deepEqual(body.backtests, [{ file: "2026-10-07-padded.json", bytes: Buffer.byteLength(text) }]);
});

test("readChannelBody: a linked or hard-linked backtest is never read, and a linked backtests/ is never listed", async () => {
  // outside the strategy: content the page must never carry
  const outside = await mkdtemp(join(tmpdir(), "face-bt-outside-"));
  await writeFile(join(outside, "2026-10-09-secret.json"), JSON.stringify({ marker: "OUTSIDE-ONLY" }));
  const dir = await mkdtemp(join(tmpdir(), "face-bt-links-"));
  await mkdir(join(dir, "backtests"));
  await writeFile(join(dir, "backtests", "2026-10-01-run.json"), JSON.stringify({ n_days: 1 }));
  // a symbolic link to it: not listed, not read - the newest regular file is the evidence
  await symlink(join(outside, "2026-10-09-secret.json"), join(dir, "backtests", "2026-10-09-link.json"));
  let body = await readChannelBody(dir);
  assert.deepEqual(body.backtests.map((b) => b.file), ["2026-10-01-run.json"]);
  assert.deepEqual(body.latest, { file: "2026-10-01-run.json", json: { n_days: 1 } });
  // a hard link to it: listed by name and size, never read
  await link(join(outside, "2026-10-09-secret.json"), join(dir, "backtests", "2026-10-10-hard.json"));
  body = await readChannelBody(dir);
  assert.equal(body.backtests[0].file, "2026-10-10-hard.json");
  assert.equal(body.latest, null);
  assert.doesNotMatch(JSON.stringify(body), /OUTSIDE-ONLY/);
  // a backtests/ that is itself a link, wherever it points: nothing listed, nothing read
  const linked = await mkdtemp(join(tmpdir(), "face-bt-linkdir-"));
  await symlink(outside, join(linked, "backtests"));
  body = await readChannelBody(linked);
  assert.deepEqual(body.backtests, []);
  assert.equal(body.latest, null);
  assert.doesNotMatch(JSON.stringify(body), /OUTSIDE-ONLY/);
});

/* ---------- the runs card: analysis/<run>/ (Lunhui modules spec A14, §5.11) ---------- */

/** A strategy directory as `resolveStrategy` returns one: a realpath. */
async function strategyDir(prefix: string): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), prefix)));
}

/** Name `modules` in a run's `run.json` `artifacts[]`, as a module row's submit records what it
 * landed (spec A10). */
async function nameArtifacts(runDir: string, modules: string[]): Promise<void> {
  const manifest = JSON.parse(await readFile(join(runDir, "run.json"), "utf8"));
  await writeFile(join(runDir, "run.json"), `${JSON.stringify({ ...manifest, artifacts: modules }, null, 2)}\n`);
}

/** One run as the server makes it: `openRun` at `now`, one quotes freeze carrying a marker the card
 * must never forward, sealed a second later unless `open`, then the artifacts hand-written,
 * pretty-printed as a module row would, and named in `run.json` unless `unnamed`. */
async function makeRun(
  dir: string, now: Date, opts: { kind?: "market" | "strategy"; open?: boolean; unnamed?: boolean; artifacts?: Record<string, unknown> } = {},
): Promise<{ run: string; runDir: string; manifest: { as_of: string | null; session: string | null; snapshot_id: string | null } | null }> {
  const { run, dir: runDir } = await openRun(dir, opts.kind ?? "strategy", now);
  await addEvidence(runDir, "quotes", [{ symbol: "sh600000", note: "EVIDENCE-ONLY" }], {
    received_at: now.toISOString(), session: now.toISOString().slice(0, 10), host: "qt.gtimg.cn", delayed: false, truncated: false,
  });
  const manifest = opts.open === true ? null : await sealRun(runDir, new Date(now.getTime() + 1000));
  for (const [file, value] of Object.entries(opts.artifacts ?? {})) {
    await writeFile(join(runDir, file), typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
  }
  const files = Object.keys(opts.artifacts ?? {});
  if (files.length > 0 && opts.unnamed !== true) await nameArtifacts(runDir, files.map((file) => file.replace(/\.json$/, "")));
  return { run, runDir, manifest };
}

/** Every regular one-link file's lstat size directly in a run directory - the row's `bytes`,
 * evidence included, by the implementation's rule. */
async function filesBytes(runDir: string): Promise<number> {
  let total = 0;
  for (const name of await readdir(runDir)) {
    const info = await lstat(join(runDir, name));
    if (info.isFile() && info.nlink === 1) total += info.size;
  }
  return total;
}

/** Hook `readdir` through the builtin's live ESM exports, so channels.ts's own named import sees
 * it: the first listing of `listed` returns, then `swap` runs - landing between the listing and
 * the reads that follow it. Restored after the test. */
function swapAfterListing(t: { mock: { method: Function; restoreAll(): void }; after(fn: () => void): void }, listed: string, swap: () => Promise<void>): void {
  const original = fsPromises.readdir;
  let fired = false;
  t.mock.method(fsPromises, "readdir", async (...args: unknown[]) => {
    const names = await (original as any)(...args);
    if (!fired && args[0] === listed) {
      fired = true;
      await swap();
    }
    return names;
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
}

const SENTIMENT = {
  module: "sentiment", contract_version: "sentiment-v1", status: "ACCEPTED", run: "r", as_of: "a",
  state: "冰点", money_effect: "weak", freeze_type: "pool", reasoning: "not a headline field",
};
const MODE = {
  module: "mode", contract_version: "mode-v1", mode: "WAIT", preconditions: ["环境未转好"], research_only_matches: [],
  expectation: { trigger: "放量", horizon: "T+1" }, expectation_review: null, market_run: "20261023T010000Z-0000abcd",
};
const ENVIRONMENT_NOT_EVALUABLE = {
  module: "environment", contract_version: "environment-v1", status: "NOT_EVALUABLE",
  index_state: null, liquidity_state: null, missing: ["index"],
};

test("readChannelBody: runs list newest first with sealed, snapshotId and the artifacts' headlines; an open run has snapshotId null", async () => {
  const dir = await strategyDir("face-runs-list-");
  const older = await makeRun(dir, new Date("2026-10-23T01:00:00Z"), { artifacts: { "sentiment.json": SENTIMENT, "mode.json": MODE } });
  const newer = await makeRun(dir, new Date("2026-10-24T01:00:00Z"), { kind: "market", open: true });
  const body = await readChannelBody(dir);
  assert.deepEqual(body.runs, [
    {
      run: newer.run, asOf: null, session: null, snapshotId: null, sealed: false, kind: "market", artifacts: {}, marketRun: null,
      bytes: await filesBytes(newer.runDir),
      openedAt: "2026-10-24T01:00:00.000Z", sealedAt: null, frozen: ["quotes"],
    },
    {
      run: older.run, asOf: older.manifest!.as_of, session: "2026-10-23", snapshotId: older.manifest!.snapshot_id, sealed: true, kind: "strategy",
      artifacts: {
        sentiment: {
          accepted: true, status: "ACCEPTED", contractVersion: "sentiment-v1", headline: { state: "冰点", money_effect: "weak", freeze_type: "pool" },
          missingSources: [], marketRun: null,
        },
        mode: {
          accepted: true, status: null, contractVersion: "mode-v1",
          headline: { mode: "WAIT", preconditions: ["环境未转好"], research_only_matches: [], expectation: MODE.expectation, expectation_review: null },
          missingSources: [], marketRun: "20261023T010000Z-0000abcd",
        },
      },
      marketRun: "20261023T010000Z-0000abcd",
      bytes: await filesBytes(older.runDir),
      openedAt: "2026-10-23T01:00:00.000Z", sealedAt: "2026-10-23T01:00:01.000Z", frozen: ["quotes"],
    },
  ]);
  assert.equal(body.runsOmitted, 0);
  assert.match(older.manifest!.snapshot_id ?? "", /^snap_[0-9a-f]{64}$/);
  // bytes counts the evidence file by its size; its content never reaches the page
  assert.ok(body.runs[0].bytes > (await stat(join(newer.runDir, "run.json"))).size);
  assert.doesNotMatch(JSON.stringify(body), /EVIDENCE-ONLY/);
});

test("readChannelBody: a module file counts as accepted only when run.json's artifacts names its module", async () => {
  const dir = await strategyDir("face-runs-named-");
  const made = await makeRun(dir, new Date("2026-10-23T01:00:00Z"), { unnamed: true, artifacts: { "sentiment.json": SENTIMENT, "mode.json": MODE } });
  let body = await readChannelBody(dir);
  assert.deepEqual(body.runs[0].artifacts, {});
  assert.equal(body.runs[0].marketRun, null);
  assert.equal(body.latestRun, null);
  await nameArtifacts(made.runDir, ["sentiment"]);
  body = await readChannelBody(dir);
  assert.deepEqual(Object.keys(body.runs[0].artifacts), ["sentiment"]);
  assert.deepEqual(Object.keys(body.latestRun?.artifacts ?? {}), ["sentiment"]);
  // a name off the table or a non-string in artifacts[] accepts nothing more
  await nameArtifacts(made.runDir, ["sentiment", "mode.json", 7 as never, "other"]);
  assert.deepEqual(Object.keys((await readChannelBody(dir)).runs[0].artifacts), ["sentiment"]);
});

test("readChannelBody: latestRun is the newest sealed run with an artifact; runs with none are listed but not latest", async () => {
  const dir = await strategyDir("face-runs-latest-");
  const withArtifacts = await makeRun(dir, new Date("2026-10-21T01:00:00Z"), {
    artifacts: { "environment.json": ENVIRONMENT_NOT_EVALUABLE, "mode.json": MODE },
  });
  const sealedBare = await makeRun(dir, new Date("2026-10-22T01:00:00Z"));
  const openWithArtifact = await makeRun(dir, new Date("2026-10-23T01:00:00Z"), { open: true, artifacts: { "sentiment.json": SENTIMENT } });
  const body = await readChannelBody(dir);
  assert.deepEqual(body.runs.map((r) => r.run), [openWithArtifact.run, sealedBare.run, withArtifacts.run]);
  assert.deepEqual(Object.keys(body.runs[0].artifacts), ["sentiment"]);
  assert.deepEqual(body.runs[1].artifacts, {});
  assert.equal(body.runs[2].artifacts.environment?.status, "NOT_EVALUABLE");
  assert.deepEqual(body.latestRun, {
    run: withArtifacts.run, asOf: withArtifacts.manifest!.as_of, session: "2026-10-21", snapshotId: withArtifacts.manifest!.snapshot_id,
    artifacts: {
      environment: { headline: { index_state: null, liquidity_state: null }, json: ENVIRONMENT_NOT_EVALUABLE },
      mode: {
        headline: { mode: "WAIT", preconditions: ["环境未转好"], research_only_matches: [], expectation: MODE.expectation, expectation_review: null },
        json: MODE,
      },
    },
    marketRun: "20261023T010000Z-0000abcd",
  });

  // no sealed run with an artifact at all: listed, never latest
  const none = await strategyDir("face-runs-latest-none-");
  await makeRun(none, new Date("2026-10-21T01:00:00Z"));
  await makeRun(none, new Date("2026-10-22T01:00:00Z"), { open: true, artifacts: { "mode.json": MODE } });
  const bare = await readChannelBody(none);
  assert.equal(bare.runs.length, 2);
  assert.equal(bare.latestRun, null);
});

test("readChannelBody: the listing stops at 50 and counts the rest in runsOmitted", async () => {
  const dir = await strategyDir("face-runs-cap-");
  // 51 runs a second apart, only the OLDEST sealed with an artifact, beside names that are not runs
  const made: string[] = [];
  for (let i = 0; i < 51; i += 1) {
    const now = new Date(Date.UTC(2026, 9, 23, 1, 0, i));
    made.push(i === 0
      ? (await makeRun(dir, now, { artifacts: { "mode.json": MODE } })).run
      : (await openRun(dir, "strategy", now)).run);
  }
  await mkdir(join(dir, "analysis", "notes"));
  await mkdir(join(dir, "analysis", "20261023T010000Z-AAAAAAAA"));
  await writeFile(join(dir, "analysis", "20261024T000000Z-cccccccc"), "{}");
  const body = await readChannelBody(dir);
  assert.equal(body.runs.length, 50);
  assert.deepEqual(body.runs.map((r) => r.run), made.slice(1).reverse());
  assert.equal(body.runsOmitted, 1); // run directories only: the stray names and the file are not counted
  assert.equal(body.latestRun, null); // the only sealed run with an artifact is past the cap

  // exactly 50: every one listed, none left out
  await rm(join(dir, "analysis", made[0]), { recursive: true });
  const full = await readChannelBody(dir);
  assert.equal(full.runs.length, 50);
  assert.equal(full.runsOmitted, 0);
});

test("readChannelBody: a linked analysis/, a linked run file and a hard-linked one are never read", async () => {
  // outside the strategy: a sealed run with an artifact the card must neither list nor forward
  const outside = await strategyDir("face-runs-outside-");
  const foreign = await makeRun(outside, new Date("2026-10-23T01:00:00Z"), { artifacts: { "mode.json": { ...MODE, mode: "OUTSIDE-ONLY" } } });
  const linkedAnalysis = await strategyDir("face-runs-linkdir-");
  await symlink(join(outside, "analysis"), join(linkedAnalysis, "analysis"));
  const none = await readChannelBody(linkedAnalysis);
  assert.deepEqual(none.runs, []);
  assert.equal(none.runsOmitted, 0);
  assert.equal(none.latestRun, null);

  const dir = await strategyDir("face-runs-links-");
  // a run directory that is a link: not a run
  await mkdir(join(dir, "analysis"));
  await symlink(foreign.runDir, join(dir, "analysis", "20261025T000000Z-dddddddd"));
  // a run whose run.json is a symbolic link to the foreign one: listed with nulls
  const linkedManifest = await makeRun(dir, new Date("2026-10-22T01:00:00Z"), { artifacts: { "sentiment.json": SENTIMENT } });
  await rm(join(linkedManifest.runDir, "run.json"));
  await symlink(join(foreign.runDir, "run.json"), join(linkedManifest.runDir, "run.json"));
  // a sealed run whose artifacts are a symbolic and a hard link to the foreign mode.json: neither read
  const linkedArtifacts = await makeRun(dir, new Date("2026-10-21T01:00:00Z"));
  await nameArtifacts(linkedArtifacts.runDir, ["mode", "theme"]); // named, so only the links keep them out
  const ownBytes = await filesBytes(linkedArtifacts.runDir);
  await symlink(join(foreign.runDir, "mode.json"), join(linkedArtifacts.runDir, "mode.json"));
  await link(join(foreign.runDir, "mode.json"), join(linkedArtifacts.runDir, "theme.json"));
  const body = await readChannelBody(dir);
  assert.deepEqual(body.runs.map((r) => r.run), [linkedManifest.run, linkedArtifacts.run]);
  const [first, second] = body.runs;
  assert.deepEqual([first.asOf, first.snapshotId, first.sealed, first.kind], [null, null, false, null]);
  assert.deepEqual(first.artifacts, {}); // a run.json lost names no artifact, so none is accepted
  assert.deepEqual(second.artifacts, {});
  assert.equal(second.marketRun, null);
  assert.equal(second.bytes, ownBytes); // a link, symbolic or hard, counts as nothing
  assert.equal(body.latestRun, null); // the one with an artifact is not known sealed
  assert.doesNotMatch(JSON.stringify(body), /OUTSIDE-ONLY/);
});

test("readChannelBody: a run directory swapped for a link after the listing is not listed, its files never read", async (t) => {
  const dir = await strategyDir("face-runs-swap-");
  const kept = await makeRun(dir, new Date("2026-10-22T01:00:00Z"), { artifacts: { "mode.json": MODE } });
  const swapped = await makeRun(dir, new Date("2026-10-23T01:00:00Z"));
  // elsewhere: a valid sealed run with an artifact the card must never forward
  const outside = await strategyDir("face-runs-swap-outside-");
  const foreign = await makeRun(outside, new Date("2026-10-23T01:00:00Z"), { artifacts: { "mode.json": { ...MODE, mode: "OUTSIDE-ONLY" } } });
  swapAfterListing(t, join(dir, "analysis"), async () => {
    await rename(swapped.runDir, `${swapped.runDir}-moved`);
    await symlink(foreign.runDir, swapped.runDir);
  });
  const body = await readChannelBody(dir);
  assert.deepEqual(body.runs.map((r) => r.run), [kept.run]);
  assert.equal(body.latestRun?.run, kept.run);
  assert.doesNotMatch(JSON.stringify(body), /OUTSIDE-ONLY/);
});

test("readChannelBody: an analysis/ swapped for a link after the listing lists nothing from it", async (t) => {
  const dir = await strategyDir("face-runs-swapdir-");
  const made = await makeRun(dir, new Date("2026-10-23T01:00:00Z"));
  const outside = await strategyDir("face-runs-swapdir-outside-");
  await mkdir(join(outside, "analysis", made.run), { recursive: true });
  await writeFile(join(outside, "analysis", made.run, "run.json"), JSON.stringify({ kind: "market", as_of: "OUTSIDE-ONLY", sealed_at: "x" }));
  swapAfterListing(t, join(dir, "analysis"), async () => {
    await rename(join(dir, "analysis"), join(dir, "analysis-moved"));
    await symlink(join(outside, "analysis"), join(dir, "analysis"));
  });
  const body = await readChannelBody(dir);
  assert.deepEqual(body.runs, []);
  assert.doesNotMatch(JSON.stringify(body), /OUTSIDE-ONLY/);
});

test("readChannelBody: a run directory gone between the listing and its read is skipped; the other runs still list", async (t) => {
  const dir = await strategyDir("face-runs-gone-");
  const kept = await makeRun(dir, new Date("2026-10-22T01:00:00Z"));
  const gone = await makeRun(dir, new Date("2026-10-23T01:00:00Z"));
  // removed after its own checks passed, just as its byte count lists it
  const original = fsPromises.readdir;
  t.mock.method(fsPromises, "readdir", async (...args: unknown[]) => {
    if (args[0] === gone.runDir) await rm(gone.runDir, { recursive: true });
    return (original as any)(...args);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const body = await readChannelBody(dir);
  assert.deepEqual(body.runs.map((r) => r.run), [kept.run]);
});

test("readChannelBody: a backtests/ swapped for a link after its listing has its newest file never read", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "face-bt-swap-"));
  await mkdir(join(dir, "backtests"));
  await writeFile(join(dir, "backtests", "2026-10-01-run.json"), JSON.stringify({ n_days: 1 }));
  const outside = await mkdtemp(join(tmpdir(), "face-bt-swap-outside-"));
  await writeFile(join(outside, "2026-10-01-run.json"), JSON.stringify({ marker: "OUTSIDE-ONLY" }));
  swapAfterListing(t, join(dir, "backtests"), async () => {
    await rename(join(dir, "backtests"), join(dir, "backtests-moved"));
    await symlink(outside, join(dir, "backtests"));
  });
  const body = await readChannelBody(dir);
  assert.equal(body.latest, null);
  assert.doesNotMatch(JSON.stringify(body), /OUTSIDE-ONLY/);
});

test("readChannelBody: an artifact over 24 KiB compact or nested past 32 is listed without a headline", async () => {
  const cap = 24 * 1024;
  const frame = Buffer.byteLength(JSON.stringify({ ...SENTIMENT, reasoning: "" }));
  const atCap = { ...SENTIMENT, reasoning: "x".repeat(cap - frame) };
  assert.equal(Buffer.byteLength(JSON.stringify(atCap)), cap);
  const overCap = { ...SENTIMENT, reasoning: "x".repeat(cap - frame + 1) };
  const nested = (levels: number): string => JSON.stringify({ ...MODE, deep: "@" }).replace('"@"', `${"[".repeat(levels - 1)}${"]".repeat(levels - 1)}`);

  // at the cap compact, pretty-printed larger on disk, and 32 levels deep: both accepted
  const dir = await strategyDir("face-runs-art-at-");
  const at = await makeRun(dir, new Date("2026-10-23T01:00:00Z"), { artifacts: { "sentiment.json": atCap, "mode.json": nested(32) } });
  let body = await readChannelBody(dir);
  assert.ok((await stat(join(at.runDir, "sentiment.json"))).size > cap);
  assert.deepEqual(Object.keys(body.runs[0].artifacts), ["sentiment", "mode"]);
  assert.equal(body.latestRun?.run, at.run);

  // one byte past the cap, 33 levels, far past the disk ceiling, and no JSON: none accepted, the run still listed
  const past = await strategyDir("face-runs-art-past-");
  const over = await makeRun(past, new Date("2026-10-23T01:00:00Z"), {
    artifacts: {
      "sentiment.json": overCap, "mode.json": nested(33), "theme.json": JSON.stringify({ items: "长".repeat(100_000) }),
      "leader.json": "{not json", "environment.json": "[".repeat(10000) + "]".repeat(10000),
    },
  });
  body = await readChannelBody(past);
  assert.deepEqual(body.runs.map((r) => [r.run, r.sealed, r.artifacts, r.marketRun]), [[over.run, true, {}, null]]);
  assert.equal(body.runs[0].bytes, await filesBytes(over.runDir)); // every unread file still counted
  assert.equal(body.latestRun, null);
  assert.doesNotThrow(() => JSON.stringify(body));

  // an artifact that parses but is not an object is no artifact either
  const odd = await strategyDir("face-runs-art-odd-");
  await makeRun(odd, new Date("2026-10-23T01:00:00Z"), { artifacts: { "mode.json": "[1,2]", "sentiment.json": "\"冰点\"" } });
  assert.deepEqual((await readChannelBody(odd)).runs[0].artifacts, {});
});

test("readChannelBody: run.json that does not parse lists the run with nulls and bytes still counted", async () => {
  const dir = await strategyDir("face-runs-manifest-");
  const broken = await makeRun(dir, new Date("2026-10-23T01:00:00Z"), { artifacts: { "mode.json": MODE } });
  await writeFile(join(broken.runDir, "run.json"), "{not json");
  const body = await readChannelBody(dir);
  // a manifest that does not parse names no artifact, so the mode.json beside it is not accepted
  assert.deepEqual(body.runs, [{
    run: broken.run, asOf: null, session: null, snapshotId: null, sealed: false, kind: null, artifacts: {}, marketRun: null,
    bytes: await filesBytes(broken.runDir), openedAt: null, sealedAt: null, frozen: [],
  }]);
  assert.equal(body.latestRun, null); // not known sealed

  // over its 8 KiB cap, or off the manifest's types: the same nulls
  const big = await makeRun(await strategyDir("face-runs-manifest-big-"), new Date("2026-10-23T01:00:00Z"));
  await writeFile(join(big.runDir, "run.json"), JSON.stringify({ run: big.run, kind: "strategy", sealed_at: "x", pad: "x".repeat(8 * 1024) }));
  const odd = await makeRun(await strategyDir("face-runs-manifest-odd-"), new Date("2026-10-23T01:00:00Z"));
  await writeFile(join(odd.runDir, "run.json"), JSON.stringify({ kind: "other", as_of: 20261023, snapshot_id: 7, sealed_at: true }));
  for (const runDir of [big.runDir, odd.runDir]) {
    const [row] = (await readChannelBody(join(runDir, "..", ".."))).runs;
    assert.deepEqual([row.asOf, row.snapshotId, row.sealed, row.kind], [null, null, false, null]);
  }
});

test("readAnalysisRuns: frozen is the evidence sources, in order, strings only; openedAt and sealedAt come from the manifest", async () => {
  const dir = await strategyDir("face-runs-frozen-");
  const sealed = await makeRun(dir, new Date("2026-10-25T01:00:00Z"));          // one quotes freeze, sealed a second later
  const open = await makeRun(dir, new Date("2026-10-26T01:00:00Z"), { open: true });
  const { runs } = await readAnalysisRuns(dir);
  assert.deepEqual(runs.map((r) => r.run), [open.run, sealed.run]);
  assert.deepEqual(runs[1].frozen, ["quotes"]);
  assert.equal(runs[1].openedAt, "2026-10-25T01:00:00.000Z");
  assert.equal(runs[1].sealedAt, "2026-10-25T01:00:01.000Z");
  assert.equal(runs[0].sealedAt, null);
  // a manifest whose evidence is not an array, or whose entries lack a string source: frozen is empty, the run still lists
  const manifest = JSON.parse(await readFile(join(open.runDir, "run.json"), "utf8"));
  await writeFile(join(open.runDir, "run.json"), JSON.stringify({ ...manifest, evidence: [{ source: 7 }, "x", { file: "evidence-index.json" }] }));
  assert.deepEqual((await readAnalysisRuns(dir)).runs[0].frozen, []);
  await writeFile(join(open.runDir, "run.json"), JSON.stringify({ ...manifest, evidence: "none" }));
  assert.deepEqual((await readAnalysisRuns(dir)).runs[0].frozen, []);
});

test("readAnalysisRuns: an artifact's missingSources and marketRun; malformed fields read as empty and null", async () => {
  const dir = await strategyDir("face-runs-artifact-fields-");
  const theme = { module: "theme", contract_version: "2", status: "NOT_EVALUABLE", missing_sources: ["boards"], mainline_candidates: [], theme_stage: "UNKNOWN", rotation: "UNKNOWN" };
  const leader = { module: "leader", contract_version: "2", status: "OK", market_run: "20261028T020953Z-f3b89ce6", leader_candidates: [], top_pattern_flags: [] };
  const { run } = await makeRun(dir, new Date("2026-10-28T02:15:00Z"), { artifacts: { "theme.json": theme, "leader.json": leader, "environment.json": ENVIRONMENT_NOT_EVALUABLE } });
  const row = (await readAnalysisRuns(dir)).runs[0];
  assert.equal(row.run, run);
  assert.deepEqual(row.artifacts.theme.missingSources, ["boards"]);
  assert.equal(row.artifacts.theme.marketRun, null);
  assert.equal(row.artifacts.leader.marketRun, "20261028T020953Z-f3b89ce6");
  assert.deepEqual(row.artifacts.environment.missingSources, [], "the old fixture's missing is not missing_sources");
  await writeFile(join(dir, "analysis", run, "leader.json"), JSON.stringify({ ...leader, market_run: 5, missing_sources: ["a", 1] }));
  const again = (await readAnalysisRuns(dir)).runs[0];
  assert.equal(again.artifacts.leader.marketRun, null);
  assert.deepEqual(again.artifacts.leader.missingSources, []);
});

test("readAnalysisRuns: the cap option limits the rows and counts the rest", async () => {
  const dir = await strategyDir("face-runs-cap-");
  for (const day of [21, 22, 23]) await makeRun(dir, new Date(`2026-10-${day}T01:00:00Z`));
  const capped = await readAnalysisRuns(dir, { cap: 2 });
  assert.equal(capped.runs.length, 2);
  assert.equal(capped.runsOmitted, 1);
  assert.equal((await readAnalysisRuns(dir)).runsOmitted, 0);
});

test("MODULE_HEADLINES equals the plugins' MODULES table, name for name and field for field", () => {
  assert.deepEqual(
    MODULE_HEADLINES.map((m) => ({ name: m.name, file: m.file, headline: [...m.headline] })),
    MODULES.map((m) => ({ name: m.name, file: m.file, headline: [...m.headline] })),
  );
});

/** A registry standing in for ctx.workspaceRegistry: the same path
 * canonicalization (via `fs.realpath`) and the same rejection of a
 * nonexistent/non-directory path that the real `create` has, the same
 * create idempotence, the same membership early-out on `attachSession`, and
 * a `status()` that genuinely checks the directory rather than being told
 * what to answer. `attachSession` additionally rejects any session id named
 * in `rejectSessionIds`, standing in for the real header-cwd-mismatch
 * rejection. `setTitle` is here because the real entity has it
 * (`dsh-workspace/lib/types/types.d.ts:49`)
 * and `/api/workspace.rename` is how the operator reaches it - a fake without
 * it could not tell "the reconcile does not rename" from "nothing can rename".
 * Exported because Task 7 reuses it. */
export function fakeRegistry(opts: { rejectSessionIds?: readonly string[] } = {}): { registry: any; attaches: string[] } {
  const rejectSessionIds = new Set(opts.rejectSessionIds ?? []);
  const byRealPath = new Map<string, any>();
  const attaches: string[] = [];
  let next = 0;
  const registry = {
    archivedSessionIds: [] as string[],
    list: () => [...byRealPath.values()],
    async create(path: string, title?: string) {
      // The real registry canonicalizes via fs.realpath and rejects a
      // nonexistent or non-directory path outright (it throws before ever
      // recording anything) - mirror both, so a reconcile racing a deleted
      // directory, or leaning on the raw `join()` spelling instead of the
      // canonical one, can't pass by accident here and only fail for real.
      const real = await realpath(path);
      if (!(await stat(real)).isDirectory()) throw new Error(`not a directory: ${path}`);
      const had = byRealPath.get(real);
      if (had !== undefined) return had; // idempotent; title unchanged
      const ws = {
        id: `ws-${++next}`,
        path: real,
        title: title ?? real.split("/").pop(),
        sessionIds: [] as string[],
        async setTitle(next: string) {
          ws.title = next;
        },
        async attachSession(sessionId: string) {
          if (ws.sessionIds.includes(sessionId)) return; // membership early-out
          if (rejectSessionIds.has(sessionId)) {
            throw new Error(`cwd mismatch: ${sessionId} does not belong to ${ws.path}`);
          }
          attaches.push(`${ws.id}:${sessionId}`);
          ws.sessionIds.push(sessionId);
        },
        async status() {
          // A workspace's directory can vanish after it was created; report
          // that instead of throwing, same as the real registry.
          try {
            return (await stat(ws.path)).isDirectory() ? "ok" as const : "missing-dir" as const;
          } catch {
            return "missing-dir" as const;
          }
        },
      };
      byRealPath.set(real, ws);
      return ws;
    },
  };
  return { registry, attaches };
}

test("reconcileChannels adopts every channel dir plus the repo root, and is idempotent", async () => {
  const root = await makeRoot();
  const home = await mkdtemp(join(tmpdir(), "face-home-"));
  const { registry, attaches } = fakeRegistry();
  const sessions = [
    { sessionId: "session-a", cwd: root },
    { sessionId: "session-b", cwd: join(root, "strategies", "alpha") },
    { sessionId: "session-c", cwd: "/Users/pan/Desktop/trend-dragon" },
  ];
  const first = await reconcileChannels({ registry, root, home, sessions, connectedBins: ["claude", "codex"] });

  assert.deepEqual(first.channels.map((c) => c.name), ["workbench", "alpha", "市场情绪"]);
  assert.deepEqual(first.ungrouped.map((s) => s.sessionId), ["session-c"], "a foreign session is counted, never dropped");
  assert.equal(attaches.length, 2, "session-a to the workbench, session-b to alpha");

  const second = await reconcileChannels({ registry, root, home, sessions, connectedBins: ["claude", "codex"] });
  assert.equal(attaches.length, 2, "a repeat listing attaches nothing new");
  assert.deepEqual(second.channels.map((c) => c.workspaceId), first.channels.map((c) => c.workspaceId), "ids are stable");
});

/* The reconcile names nothing. `title` is the operator's field, reachable
 * only through `/api/workspace.rename`; `name` is the directory's. These two
 * tests are the fence around that split - the first that the face never seeds
 * a title, the second that it never corrects one. */

test("reconcileChannels leaves the display title to the registry, so the repo root keeps the basename default", async () => {
  const root = await mkdtemp(join(tmpdir(), "face-title-"));
  const home = await mkdtemp(join(tmpdir(), "face-home-title-"));
  const { registry } = fakeRegistry();

  const out = await reconcileChannels({ registry, root, home, sessions: [], connectedBins: [] });
  const workbench = out.channels.find((c) => c.isRoot)!;

  assert.equal(workbench.name, WORKBENCH, "the directory-side identity is still the code's");
  assert.equal(
    workbench.title,
    (await realpath(root)).split("/").pop(),
    "the display title is the registry's own basename default - the face passes no title, because a title it passed would be honored on a first listing and silently dropped on every one after",
  );
});

test("reconcileChannels never overwrites a title the operator renamed", async () => {
  const root = await makeRoot();
  const home = await mkdtemp(join(tmpdir(), "face-home-rename-"));
  const { registry } = fakeRegistry();
  const first = await reconcileChannels({ registry, root, home, sessions: [], connectedBins: [] });
  const alpha = first.channels.find((c) => c.name === "alpha")!;

  // exactly what `/api/workspace.rename` does: Workspace.setTitle
  await registry.list().find((ws: { id: string }) => ws.id === alpha.workspaceId)!.setTitle("动量");

  const second = await reconcileChannels({ registry, root, home, sessions: [], connectedBins: [] });
  const renamed = second.channels.find((c) => c.name === "alpha")!;
  assert.equal(renamed.title, "动量", "a listing is a read of the title, never a write");
  assert.equal(renamed.name, "alpha", "and the rename never touched the directory-side name");
});

test("reconcileChannels seeds each channel's roster once, from the connected bins", async () => {
  const root = await makeRoot();
  const home = await mkdtemp(join(tmpdir(), "face-home2-"));
  const { registry } = fakeRegistry();
  const run = () => reconcileChannels({ registry, root, home, sessions: [], connectedBins: ["codex"] });
  const first = await run();
  const alpha = first.channels.find((c) => c.name === "alpha")!;
  assert.deepEqual(await rosterFor(home, alpha.workspaceId), ["codex"]);

  await setRoster(home, alpha.workspaceId, []);
  await run();
  assert.deepEqual(await rosterFor(home, alpha.workspaceId), [], "a second listing never re-seeds over the operator");
});

test("reconcileChannels carries status and reports a missing directory instead of deleting it", async () => {
  const root = await makeRoot();
  const home = await mkdtemp(join(tmpdir(), "face-home3-"));
  const { registry } = fakeRegistry();
  // A missing-dir workspace arises only by deleting a directory AFTER a
  // successful create - the real registry rejects `create` on a directory
  // that never existed, so that is the only honest way to set this up.
  const vanishedDir = join(root, "strategies", "vanished");
  await mkdir(vanishedDir, { recursive: true });
  await registry.create(vanishedDir);
  await rm(vanishedDir, { recursive: true, force: true });

  const out = await reconcileChannels({ registry, root, home, sessions: [], connectedBins: [] });
  assert.equal(out.channels.find((c) => c.name === "alpha")?.status, "researching");
  const gone = out.channels.find((c) => c.dir.endsWith("vanished"));
  assert.equal(gone?.missingDir, true, "a registered workspace whose directory is gone still lists, greyed");
});

test("reconcileChannels attaches only sessions whose cwd IS the channel directory", async () => {
  const root = await makeRoot();
  const home = await mkdtemp(join(tmpdir(), "face-home4-"));
  const { registry, attaches } = fakeRegistry();
  await reconcileChannels({
    registry, root, home, connectedBins: [],
    sessions: [{ sessionId: "session-deep", cwd: join(root, "strategies", "alpha", "notes") }],
  });
  assert.deepEqual(attaches, [], "a subdirectory is not the channel; the host would reject the attach anyway");
});

test("reconcileChannels: a session the host refuses to attach falls into ungrouped, not vanishes", async () => {
  const root = await makeRoot();
  const home = await mkdtemp(join(tmpdir(), "face-home6-"));
  const { registry, attaches } = fakeRegistry({ rejectSessionIds: ["session-bad"] });
  const sessions = [{ sessionId: "session-bad", cwd: join(root, "strategies", "alpha") }];

  const out = await reconcileChannels({ registry, root, home, sessions, connectedBins: [] });
  assert.deepEqual(attaches, [], "the host's rejection is not forced through");
  assert.deepEqual(
    out.ungrouped.map((s) => s.sessionId),
    ["session-bad"],
    "a session the host refuses to attach is reported, never silently dropped (Rule 5)",
  );
});

test("reconcileChannels: a directory vanishing between readdir and create skips only that channel", async () => {
  const root = await makeRoot();
  const home = await mkdtemp(join(tmpdir(), "face-home7-"));
  const { registry: base } = fakeRegistry();
  const alphaDir = join(root, "strategies", "alpha");
  // Simulate the readdir→create race the defensive catch exists for: by the
  // time `create` runs for this one directory, it is already gone.
  const registry = {
    ...base,
    create: async (path: string, title?: string) => {
      if (path === alphaDir) await rm(alphaDir, { recursive: true, force: true });
      return base.create(path, title);
    },
  };

  const out = await reconcileChannels({ registry, root, home, sessions: [], connectedBins: [] });
  assert.deepEqual(
    out.channels.map((c) => c.name),
    ["workbench", "市场情绪"],
    "the vanished channel is skipped; the rest of the listing still renders",
  );
});

/* ---------- C1: the reconcile must see persisted history, not only live
 * sessions (main.ts's `listSessions` now feeds it `mergeSessionHeads`) ---------- */

test("mergeSessionHeads: a persisted-only session is kept, and a live entry wins over a stale persisted one", () => {
  const persisted = [
    { sessionId: "persisted-only", cwd: "/repo/strategies/alpha" },
    { sessionId: "both", cwd: "/stale/cwd" },
  ];
  const live = [{ sessionId: "both", cwd: "/fresh/cwd" }];
  assert.deepEqual(mergeSessionHeads(persisted, live), [
    { sessionId: "persisted-only", cwd: "/repo/strategies/alpha" },
    { sessionId: "both", cwd: "/fresh/cwd" },
  ], "the persisted-only session survives, and the live cwd wins for the shared id");
});

test("listSessionHeads: a durable-read failure degrades to live-only, and is reported not swallowed", async () => {
  const boom = new Error("corrupt header frame");
  const seen: unknown[] = [];
  const heads = await listSessionHeads(
    () => Promise.reject(boom),
    () => [{ sessionId: "live-1", cwd: "/repo" }],
    (err) => seen.push(err),
  );
  // Grouping is INCOMPLETE, never absent: the live sessions still bucket.
  assert.deepEqual(heads, [{ sessionId: "live-1", cwd: "/repo" }]);
  // Rule 5: the failure is surfaced, not eaten.
  assert.deepEqual(seen, [boom]);
});

test("listSessionHeads: the durable listing is unioned in when it works, and nothing is reported", async () => {
  const seen: unknown[] = [];
  const heads = await listSessionHeads(
    () => Promise.resolve([{ sessionId: "old-1", cwd: "/repo/a" }]),
    () => [{ sessionId: "live-1", cwd: "/repo/b" }],
    (err) => seen.push(err),
  );
  assert.deepEqual(heads.map((h) => h.sessionId), ["old-1", "live-1"]);
  assert.equal(seen.length, 0);
});

test("mergeSessionHeads: neither list is favoured for ORDER, only live wins on a shared id", () => {
  assert.deepEqual(mergeSessionHeads([], []), []);
  assert.deepEqual(
    mergeSessionHeads([{ sessionId: "a", cwd: "/x" }], []),
    [{ sessionId: "a", cwd: "/x" }],
    "persisted alone still surfaces",
  );
  assert.deepEqual(
    mergeSessionHeads([], [{ sessionId: "a", cwd: "/x" }]),
    [{ sessionId: "a", cwd: "/x" }],
    "live alone still surfaces",
  );
});

test("reconcileChannels attaches a session that ONLY the persisted listing reports - exactly what main.ts now feeds it", async () => {
  const root = await makeRoot();
  const home = await mkdtemp(join(tmpdir(), "face-home8-"));
  const { registry, attaches } = fakeRegistry();
  const alphaDir = join(root, "strategies", "alpha");
  // Mirrors main.ts's real wiring: sessionPersistence.list() (durable
  // history) merged with sessions.list() (live only) via mergeSessionHeads.
  // Nothing is live here - the session is on disk only, which is exactly
  // the C1 gap: feeding the reconcile from `sessions.list()` alone would
  // report zero sessions and never attach it.
  const persistedOnly = mergeSessionHeads(
    [{ sessionId: "session-from-disk", cwd: alphaDir }],
    [],
  );
  const out = await reconcileChannels({ registry, root, home, sessions: persistedOnly, connectedBins: [] });
  const alpha = out.channels.find((c) => c.name === "alpha")!;
  assert.deepEqual(attaches, [`${alpha.workspaceId}:session-from-disk`], "a persisted-only session is attached");
  assert.deepEqual(out.ungrouped, [], "it is not left ungrouped just because it was never live");
});

/* ---------- the routes (Task 7) ---------- */

function fakeRes(): { out: { status: number; body: string }; res: ServerResponse } {
  const out = { status: 0, body: "" };
  const res = {
    writeHead(status: number) { out.status = status; return res; },
    end(body?: string | Buffer) { out.body = String(body ?? ""); return res; },
  };
  return { out, res: res as unknown as ServerResponse };
}

function getReq(host?: string): IncomingMessage {
  return { headers: host === undefined ? {} : { host }, method: "GET" } as unknown as IncomingMessage;
}

function postReq(body: string, host = "127.0.0.1:3090"): IncomingMessage {
  const req = Readable.from([Buffer.from(body)]) as unknown as IncomingMessage;
  (req as { headers: unknown }).headers = { host, "content-type": "application/json" };
  (req as { method: string }).method = "POST";
  return req;
}

async function routesFor(root: string, home: string): Promise<Map<string, WebRoute>> {
  const { registry } = fakeRegistry();
  const routes: WebRoute[] = [];
  registerChannelRoutes({ register: (route) => routes.push(route) }, {
    registry, root, home,
    listSessions: async () => [],
    connectedBins: async () => ["codex"],
    listBots: async () => [],
  });
  return new Map(routes.map((r) => [r.path, r]));
}

/** Read the listing and find one channel by name - several tests need an id. */
async function channelNamed(routes: Map<string, WebRoute>, name: string): Promise<{ workspaceId: string }> {
  const out = fakeRes();
  await routes.get("/data/channels.json")!.handler(getReq("127.0.0.1:3090"), out.res);
  const payload = JSON.parse(out.out.body) as { channels: { name: string; workspaceId: string }[] };
  return payload.channels.find((c) => c.name === name)!;
}

test("routes: exactly five paths, and every one refuses a forged Host FIRST", async () => {
  const routes = await routesFor(await makeRoot(), await mkdtemp(join(tmpdir(), "face-rt-")));
  assert.deepEqual([...routes.keys()].sort(), [
    "/data/channels", "/data/channels.json", "/data/channels/agents", "/data/channels/bots", "/data/channels/overview",
  ]);
  for (const [path, route] of routes) {
    const forged = fakeRes();
    await route.handler(postReq('{"name":"x"}', "evil.example.com"), forged.res);
    assert.equal(forged.out.status, 403, path);
    assert.equal(forged.out.body, '{"ok":false,"error":"forbidden"}', `${path} echoes nothing`);
  }
});

test("routes: the POSTs are POST-only and application/json-only", async () => {
  const routes = await routesFor(await makeRoot(), await mkdtemp(join(tmpdir(), "face-rt2-")));
  for (const path of ["/data/channels", "/data/channels/agents", "/data/channels/overview"]) {
    const wrongMethod = fakeRes();
    await routes.get(path)!.handler(getReq("127.0.0.1:3090"), wrongMethod.res);
    assert.equal(wrongMethod.out.status, 405, path);

    const req = postReq("{}");
    (req as unknown as { headers: Record<string, string> }).headers["content-type"] = "text/plain";
    const wrongType = fakeRes();
    await routes.get(path)!.handler(req, wrongType.res);
    assert.equal(wrongType.out.status, 415, path);
  }
});

test("routes: the listing carries channels, the ungrouped count, the archive set, and (empty) preset hints", async () => {
  const routes = await routesFor(await makeRoot(), await mkdtemp(join(tmpdir(), "face-rt3-")));
  const ok = fakeRes();
  await routes.get("/data/channels.json")!.handler(getReq("127.0.0.1:3090"), ok.res);
  assert.equal(ok.out.status, 200);
  const payload = JSON.parse(ok.out.body) as { ok: boolean; channels: { name: string }[]; ungrouped: unknown[]; archived: unknown[]; presets: unknown };
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.channels.map((c) => c.name), ["workbench", "alpha", "市场情绪"]);
  assert.deepEqual(payload.ungrouped, []);
  assert.deepEqual(payload.archived, []);
  assert.deepEqual(payload.presets, {}, "present even when no session names a preset");
});

/* ---------- the preset hints (dsh 0.2: the list summary lost `agentPreset`) ---------- */

test("presetHintsOf: every head that names a preset, by session id; blank and absent are left out", () => {
  assert.deepEqual(presetHintsOf([
    { sessionId: "room", cwd: "/c", agentPreset: "gravit" },
    { sessionId: "m1", cwd: "/c", agentPreset: "buffett" },
    { sessionId: "plain", cwd: "/c" },
    { sessionId: "blank", cwd: "/c", agentPreset: "" },
  ]), { room: "gravit", m1: "buffett" });
  assert.deepEqual(presetHintsOf([]), {});
});

test("presetHintsOf: a session id is a plain key, never the object's prototype", () => {
  const hints = presetHintsOf([{ sessionId: "__proto__", agentPreset: "buffett" }]);
  assert.equal(Object.getPrototypeOf(hints), Object.prototype);
  assert.equal(Object.hasOwn(hints, "__proto__"), true);
  assert.equal(JSON.parse(JSON.stringify(hints)).__proto__, "buffett");
});

test("routes: the listing's presets come from the same merged heads the reconcile ran on - live winning over persisted", async () => {
  const root = await makeRoot();
  const { registry } = fakeRegistry();
  const routes: WebRoute[] = [];
  registerChannelRoutes({ register: (route) => routes.push(route) }, {
    registry, root, home: await mkdtemp(join(tmpdir(), "face-rt-presets-")),
    // The shape main.ts feeds: persisted heads (from snapshot headers) merged with live ones.
    listSessions: () => listSessionHeads(
      async () => [
        { sessionId: "cold-bot", cwd: join(root, "strategies", "alpha"), agentPreset: "buffett" },
        { sessionId: "re-pointed", cwd: root, agentPreset: "gravit" },
      ],
      () => [{ sessionId: "re-pointed", cwd: root, agentPreset: "speculator" }, { sessionId: "live-host", cwd: root }],
      () => { throw new Error("the durable listing did not fail here"); },
    ),
    connectedBins: async () => [],
    listBots: async () => [],
  });
  const out = fakeRes();
  await routes.find((r) => r.path === "/data/channels.json")!.handler(getReq("127.0.0.1:3090"), out.res);
  assert.equal(out.out.status, 200);
  const payload = JSON.parse(out.out.body) as { presets: Record<string, string>; channels: { name: string; sessionIds: string[] }[] };
  assert.deepEqual(payload.presets, { "cold-bot": "buffett", "re-pointed": "speculator" });
  // The same read fed the reconcile: the cold bot session attached to its channel.
  assert.deepEqual(payload.channels.find((c) => c.name === "alpha")!.sessionIds, ["cold-bot"]);
});

test("routes: overview answers by workspace id, and a body value never becomes a path", async () => {
  const routes = await routesFor(await makeRoot(), await mkdtemp(join(tmpdir(), "face-rt4-")));
  const alpha = await channelNamed(routes, "alpha");

  const good = fakeRes();
  await routes.get("/data/channels/overview")!.handler(postReq(JSON.stringify({ workspaceId: alpha.workspaceId })), good.res);
  assert.equal(good.out.status, 200);
  assert.equal((JSON.parse(good.out.body) as { status: { status?: string } }).status.status, "researching");

  for (const bad of [{ workspaceId: "ws-nope" }, { workspaceId: "../../etc/passwd" }, { workspaceId: 7 }, {}]) {
    const out = fakeRes();
    await routes.get("/data/channels/overview")!.handler(postReq(JSON.stringify(bad)), out.res);
    assert.equal(out.out.status, 404, JSON.stringify(bad));
  }
});

test("routes: the overview carries the runs card inside body, on the same path", async () => {
  const root = await realpath(await makeRoot());
  const made = await makeRun(join(root, "strategies", "alpha"), new Date("2026-10-23T01:00:00Z"), { artifacts: { "mode.json": MODE } });
  const routes = await routesFor(root, await mkdtemp(join(tmpdir(), "face-rt-runs-")));
  const alpha = await channelNamed(routes, "alpha");
  const out = fakeRes();
  await routes.get("/data/channels/overview")!.handler(postReq(JSON.stringify({ workspaceId: alpha.workspaceId })), out.res);
  assert.equal(out.out.status, 200);
  const { body } = JSON.parse(out.out.body) as {
    body: { runs: { run: string; sealed: boolean }[]; runsOmitted: number; latestRun: { run: string; marketRun: string | null } | null };
  };
  assert.deepEqual(body.runs.map((r) => [r.run, r.sealed]), [[made.run, true]]);
  assert.equal(body.runsOmitted, 0);
  assert.deepEqual([body.latestRun?.run, body.latestRun?.marketRun], [made.run, MODE.market_run]);
});

test("routes: a body that cannot be serialized answers one clean 500 with fixed text, never a head and then a throw", async () => {
  const root = await makeRoot();
  const { registry } = fakeRegistry();
  const routes: WebRoute[] = [];
  registerChannelRoutes({ register: (route) => routes.push(route) }, {
    registry, root, home: await mkdtemp(join(tmpdir(), "face-rt-ser-")),
    listSessions: async () => [],
    connectedBins: async () => ["codex"],
    // a value JSON.stringify refuses, standing in for anything a block might one day carry
    listBots: async () => [{ id: "b", name: "b", listed: true, size: 1n }] as never,
  });
  const byPath = new Map(routes.map((r) => [r.path, r]));
  const ws = await channelNamed(byPath, "alpha");
  // a response that refuses a second head, as Node's does once the first is written
  const heads: number[] = [];
  let sent = "";
  const res = {
    writeHead(status: number) {
      if (heads.length > 0) throw Object.assign(new Error("Cannot write headers after they are sent"), { code: "ERR_HTTP_HEADERS_SENT" });
      heads.push(status);
      return res;
    },
    end(chunk?: string) { sent = String(chunk ?? ""); return res; },
  };
  await byPath.get("/data/channels/overview")!.handler(postReq(JSON.stringify({ workspaceId: ws.workspaceId })), res as unknown as ServerResponse);
  assert.deepEqual(heads, [500]);
  assert.deepEqual(JSON.parse(sent), { ok: false, error: "response could not be serialized" });
});

test("routes: the roster write replaces the set and refuses an unknown channel", async () => {
  const home = await mkdtemp(join(tmpdir(), "face-rt5-"));
  const routes = await routesFor(await makeRoot(), home);
  const alpha = await channelNamed(routes, "alpha");

  const set = fakeRes();
  await routes.get("/data/channels/agents")!.handler(
    postReq(JSON.stringify({ workspaceId: alpha.workspaceId, agents: ["codex", "codex"] })), set.res);
  assert.equal(set.out.status, 200);
  assert.deepEqual(await rosterFor(home, alpha.workspaceId), ["codex"]);

  const unknown = fakeRes();
  await routes.get("/data/channels/agents")!.handler(postReq(JSON.stringify({ workspaceId: "ws-nope", agents: [] })), unknown.res);
  assert.equal(unknown.out.status, 404);

  const junk = fakeRes();
  await routes.get("/data/channels/agents")!.handler(
    postReq(JSON.stringify({ workspaceId: alpha.workspaceId, agents: "codex" })), junk.res);
  assert.equal(junk.out.status, 400);
});

test("routes: POST /data/channels creates once, then conflicts; bad JSON is a 400", async () => {
  const root = await makeRoot();
  const routes = await routesFor(root, await mkdtemp(join(tmpdir(), "face-rt6-")));
  const create = routes.get("/data/channels")!;

  const first = fakeRes();
  await create.handler(postReq('{"name":"gamma"}'), first.res);
  assert.equal(first.out.status, 200);
  await stat(join(root, "strategies", "gamma"));

  const again = fakeRes();
  await create.handler(postReq('{"name":"gamma"}'), again.res);
  assert.equal(again.out.status, 409);

  const junkBody = fakeRes();
  await create.handler(postReq("not json"), junkBody.res);
  assert.equal(junkBody.out.status, 400);
});

test("routes: POST /data/channels stays 200 even when the reconcile AFTER creation fails (I3)", async () => {
  const root = await makeRoot();
  const { registry } = fakeRegistry();
  const routes: WebRoute[] = [];
  registerChannelRoutes({ register: (route) => routes.push(route) }, {
    registry, root, home: await mkdtemp(join(tmpdir(), "face-rt7-")),
    listSessions: async () => [],
    // Fails BEFORE reconcileChannels/registry.create ever runs (reconcile()
    // awaits this first) - simulates the EACCES/lock-timeout/EIO class I3
    // is about, entirely decoupled from directory creation itself.
    connectedBins: async () => { throw new Error("EACCES: permission denied"); },
    listBots: async () => [],
  });
  const create = new Map(routes.map((r) => [r.path, r])).get("/data/channels")!;

  const out = fakeRes();
  await create.handler(postReq('{"name":"delta"}'), out.res);
  assert.equal(out.out.status, 200, "the directory is already on disk; a reconcile failure must not be reported as create failed");
  assert.equal((JSON.parse(out.out.body) as { ok: boolean }).ok, true);
  await stat(join(root, "strategies", "delta")); // the channel really was created, not just claimed to be
});

/* The name-validation cases carry over from strategies.test.ts:36-72. The NUL
 * case is built with String.fromCharCode and the two normalizations with
 * escapes, so this file has no literal control characters. */

test("createChannel copies the template, skips __pycache__, never overwrites", async () => {
  const root = await makeRoot();
  const template = join(root, "strategies", "_template");
  await writeFile(join(template, "THESIS.md"), "# <strategy name>\n");
  await mkdir(join(template, "notes"), { recursive: true });
  await mkdir(join(template, "__pycache__"), { recursive: true });
  await writeFile(join(template, "__pycache__", "x.pyc"), "junk");

  const made = await createChannel(root, "beta-1");
  assert.equal(made.dir, join(root, "strategies", "beta-1"));
  await stat(join(made.dir, "THESIS.md"));
  await stat(join(made.dir, "notes"));
  await assert.rejects(stat(join(made.dir, "__pycache__")));
  await assert.rejects(createChannel(root, "beta-1"), (err: HttpError) => err.status === 409);
  await assert.rejects(createChannel(root, "alpha"), (err: HttpError) => err.status === 409);
});

test("createChannel refuses names outside the closed class", async () => {
  const root = await makeRoot();
  const NUL = String.fromCharCode(0);
  for (const bad of [
    "", "_template", "a b", "市场 情绪", "../evil", "a/../b", "市场/情绪",
    "a.b", ".hidden", "-lead", "_lead", `a${NUL}b`, "x".repeat(42), 42, null,
  ]) {
    await assert.rejects(createChannel(root, bad), (err: HttpError) => err.status === 400, JSON.stringify(bad));
  }
});

test("createChannel takes a name in any script and creates it in NFC", async () => {
  const root = await makeRoot();
  const NFD = `cafe${String.fromCharCode(0x301)}`; // e + combining acute
  const NFC = `caf${String.fromCharCode(0xe9)}`;   // precomposed e-acute
  assert.equal((await createChannel(root, NFD)).name, NFC, "created in NFC");
  await assert.rejects(createChannel(root, NFC), (err: HttpError) => err.status === 409, "one word, two normalizations, one directory");
  assert.equal((await createChannel(root, "Upper-Case_9")).name, "Upper-Case_9", "case is the operator's to choose");
  assert.equal((await createChannel(root, "存储超级周期")).name, "存储超级周期", "a Chinese name is a name");
});

test("the overview carries the bot roster and every preset the roster reports; POST /data/channels/bots writes it under the members cap", async () => {
  const root = await makeRoot();
  const home = await mkdtemp(join(tmpdir(), "face-home-"));
  const { registry } = fakeRegistry();
  const built: WebRoute[] = [];
  registerChannelRoutes({ register: (route) => built.push(route) }, {
    registry, root, home,
    listSessions: async () => [], connectedBins: async () => [],
    listBots: async () => [
      { id: "buffett", name: "巴菲特型", listed: true },
      { id: "cracked", name: "cracked", broken: "not a list", listed: true },
    ],
  });
  const routes = new Map(built.map((r) => [r.path, r]));
  const ws = await channelNamed(routes, "alpha");

  const ok = fakeRes();
  await routes.get("/data/channels/bots")!.handler(
    postReq(JSON.stringify({ workspaceId: ws.workspaceId, bots: ["buffett", "ghost"] })), ok.res);
  assert.equal(ok.out.status, 200);
  const okBody = JSON.parse(ok.out.body) as { bots: string[] };
  assert.deepEqual(okBody.bots, ["buffett", "ghost"], "an id the mount does not report is kept and shown (Rule 5), not dropped");

  const over = fakeRes();
  await routes.get("/data/channels/overview")!.handler(postReq(JSON.stringify({ workspaceId: ws.workspaceId })), over.res);
  const overBody = JSON.parse(over.out.body) as { bots: string[]; allBots: { id: string; broken?: string }[] };
  assert.deepEqual(overBody.bots, ["buffett", "ghost"]);
  assert.deepEqual(overBody.allBots.map((b) => b.id), ["buffett", "cracked"]);
  assert.equal(overBody.allBots[1].broken, "not a list");

  const tooMany = fakeRes();
  await routes.get("/data/channels/bots")!.handler(
    postReq(JSON.stringify({ workspaceId: ws.workspaceId, bots: ["a1", "a2", "a3", "a4", "a5", "a6", "a7"] })), tooMany.res);
  assert.equal(tooMany.out.status, 400);
  assert.match((JSON.parse(tooMany.out.body) as { error: string }).error, /6/);

  const junk = fakeRes();
  await routes.get("/data/channels/bots")!.handler(postReq(JSON.stringify({ workspaceId: ws.workspaceId, bots: ["Not Valid"] })), junk.res);
  assert.equal(junk.out.status, 400);

  const nowhere = fakeRes();
  await routes.get("/data/channels/bots")!.handler(postReq(JSON.stringify({ workspaceId: "ws-none", bots: [] })), nowhere.res);
  assert.equal(nowhere.out.status, 404);
});

test("the repository's strategies/cn-market lists as a channel, the market read's own directory", async () => {
  const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
  const dirs = await listChannelDirs(repoRoot);
  const market = dirs.find((d) => d.name === "cn-market");
  assert.ok(market, "cn-market is a channel");
  assert.equal(market.isRoot, false);
  assert.equal(market.dir, join(repoRoot, "strategies", "cn-market"));
  assert.equal((await readChannelStatus(market.dir)).status, "idea");
});
