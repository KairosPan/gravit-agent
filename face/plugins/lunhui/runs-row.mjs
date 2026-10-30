// face/plugins/lunhui/runs-row.mjs
/**
 * `lunhui-runs` - the Lunhui backbone row (modules spec §5.2, A1). It provides the `lunhuiRuns`
 * service every other Lunhui row injects - strategy and run anchoring, the run's states, the
 * per-run write mutex and the freeze budget - and registers one tool, `lunhui_read_run`, the
 * Gravit-facing view of a run: its `run.json`, its counts and each artifact's headline, so Gravit
 * coordinates without reading files; without a run, the strategy's newest sealed runs, so Gravit
 * finds the market run a strategy run cites.
 *
 * For the module rows it reads a module's context - sealing the run on the first read (A4) - and
 * takes a module's one artifact (A10), each call counted against the module's budget (A7), and
 * remembers in this process which module read which run, the submit's `READ_FIRST` (§5.7). And it
 * reads a sealed run whole for a module citing it (A5, A27), `readSealedRun`, taking no lock; and,
 * for the mode (A11, A12), the strategy's newest earlier accepted artifact of a module,
 * `previousArtifact`, and its THESIS.md, `readThesis`, both lockless.
 *
 * The service takes strategy names and run ids, never paths, and returns none: every method
 * resolves its arguments under `config.strategiesRoot` through `runs.mjs` (D4′), whose refusals it
 * throws as they are. Both the service and the tool are registered inside `ctx.effect`, so a
 * reload of the row disposes them, as `gravit.js` registers its sections.
 */
import { statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { FREEZE_BUDGET, MODULE_BUDGET, asToolError, refuse } from "./lib/errors.mjs";
import { MODULES, MODULE_NAMES } from "./lib/modules.mjs";
import { repairFor } from "./lib/contract-core.mjs";
import * as runs from "./lib/runs.mjs";
import { buildView, evidenceView, viewDigest } from "./lib/view.mjs";

export const name = "lunhui-runs";
export const inject = ["tools"];

/** The largest artifact `lunhui_read_run` reads a headline from, or a module reads, on the compact JSON (spec §5.11). */
const ARTIFACT_MAX_BYTES = 24 * 1024;

/**
 * The `lunhuiRuns` service.
 * @typedef {{
 *   strategiesRoot: string,
 *   resolveStrategy(name: unknown): Promise<{ name: string }>,
 *   openRun(strategyName: unknown, kind: "market" | "strategy"): Promise<{ strategy: string, run: string }>,
 *   addEvidence(strategyName: unknown, run: unknown, source: string, items: unknown[], meta: { received_at: string, session: string, host: string, delayed: boolean, truncated: boolean }): Promise<{ file: string, sha256: string, bytes: number, ids: string[] }>,
 *   sealRun(strategyName: unknown, run: unknown): Promise<import("./lib/runs.mjs").RunManifest>,
 *   readRun(strategyName: unknown, run: unknown): Promise<{ manifest: import("./lib/runs.mjs").RunManifest, metrics: import("./lib/runs.mjs").RunMetrics, metricsReset: boolean }>,
 *   readSealedRun(strategyName: unknown, run: unknown): Promise<SealedRun>,
 *   view(strategyName: unknown, run: unknown, options?: { modules?: string[] }): Promise<import("./lib/view.mjs").View>,
 *   previousArtifact(strategyName: unknown, run: unknown, module: string): Promise<PreviousArtifact | null>,
 *   readThesis(strategyName: unknown): Promise<string | null>,
 *   withRun<T>(strategyName: unknown, run: unknown, fn: (located: { strategy: string, run: string, dir: string }) => Promise<T>): Promise<T>,
 *   countFreeze(strategyName: unknown, run: unknown): Promise<number>,
 *   recordRefusal(strategyName: unknown, run: unknown, source: string, code: string): Promise<void>,
 *   readContext<T>(strategyName: unknown, run: unknown, module: string, build: (input: ContextInput, located: { strategy: string, run: string }) => T | Promise<T>): Promise<T>,
 *   submit(strategyName: unknown, run: unknown, module: string, text: unknown, validate: (text: unknown, located: { strategy: string, run: string }) => unknown): Promise<{ accepted: true, module: string, run: string }>,
 * }} LunhuiRuns
 */

/**
 * What `readContext` hands a module's `build`: the sealed `run.json`, in its order each evidence
 * file it lists, and the run's accepted artifacts (`acceptedArtifacts`).
 * @typedef {{ manifest: import("./lib/runs.mjs").RunManifest, evidence: Array<{ source: string, session: string, items: any[] }>,
 *   artifacts: Record<string, Record<string, unknown>> }} ContextInput
 */

/**
 * What `readSealedRun` returns: the run's on-disk names, its sealed `run.json`, its evidence files
 * and its accepted artifacts, as `readContext` hands a `build` its own run's.
 * @typedef {{ strategy: string, run: string } & ContextInput} SealedRun
 */

/**
 * What `previousArtifact` returns: the earlier run's on-disk id, its snapshot id and session, and
 * the artifact.
 * @typedef {{ run: string, snapshot_id: string | null, session: string | null, artifact: Record<string, unknown> }} PreviousArtifact
 */

/** The earlier runs `previousArtifact` reads at most: the last 50 before the run. */
const PREVIOUS_RUNS = 50;

/**
 * Whether run `a` opened before run `b`: by `opened_at` - run ids order by the second, two runs of
 * one second by the random hex - then by run id.
 * @param {{ run: string, opened_at?: unknown }} a
 * @param {{ run: string, opened_at?: unknown }} b
 */
function openedBefore(a, b) {
  const [x, y] = [String(a.opened_at ?? ""), String(b.opened_at ?? "")];
  return x < y || (x === y && a.run < b.run);
}

/**
 * The service over one strategies root.
 * @param {string} strategiesRoot an absolute path to an existing directory
 * @returns {LunhuiRuns}
 */
export function createLunhuiRuns(strategiesRoot) {
  /** The run directory of `strategyName`'s run `run`, with both on-disk names. */
  const locate = async (strategyName, run) => {
    const strategy = await runs.resolveStrategy(strategiesRoot, strategyName);
    const resolved = await runs.resolveRun(strategy.dir, run);
    return { strategy: strategy.name, run: resolved.run, dir: resolved.dir };
  };
  /** Per `<strategy>/<run>`, the promise the next caller of `withRun` waits on. */
  const tails = new Map();
  /**
   * Each `<strategy>/<run>/<module>` whose context this process read: in memory only, so a restart
   * forgets the reads and keeps the counts (§5.7). One set per service.
   */
  const reads = new Set();
  /**
   * Per sealed `<strategy>/<run>`, its evidence files as read and their `evidenceView` - a sealed
   * run's evidence never changes. In memory only, one map per service. Views share these blocks by
   * reference and treat them as read-only.
   * @type {Map<string, { evidence: ContextInput["evidence"], half: ReturnType<typeof evidenceView> }>}
   */
  const evidenceCache = new Map();

  /**
   * Count one call of `module` on the run (A7): `calls[module]` plus one, written back through
   * `writeMetrics`, then `TOOL_BUDGET` past `MODULE_BUDGET`, the refused call counted. Called
   * inside `withRun`, before anything else the call does.
   * @param {string} dir
   * @param {string} module
   * @returns {Promise<import("./lib/runs.mjs").RunMetrics>} the metrics as written
   */
  const countCall = async (dir, module) => {
    if (!MODULE_NAMES.has(module)) throw new TypeError(`lunhui: a module is one of MODULES, not ${JSON.stringify(module)}`);
    const { metrics } = await runs.readRun(dir);
    const count = (Number.isInteger(metrics.calls[module]) ? metrics.calls[module] : 0) + 1;
    const counted = { ...metrics, calls: { ...metrics.calls, [module]: count } };
    await runs.writeMetrics(dir, counted);
    if (count > MODULE_BUDGET) throw refuse.moduleBudget(module);
    return counted;
  };

  /** @type {LunhuiRuns} */
  const service = {
    strategiesRoot,
    async resolveStrategy(strategyName) {
      return { name: (await runs.resolveStrategy(strategiesRoot, strategyName)).name };
    },
    async openRun(strategyName, kind) {
      const strategy = await runs.resolveStrategy(strategiesRoot, strategyName);
      const { run } = await runs.openRun(strategy.dir, kind);
      return { strategy: strategy.name, run };
    },
    /** `RUN_SEALED`, `SOURCE_FROZEN` and the size refusals are `runs.mjs`'s. */
    async addEvidence(strategyName, run, source, items, meta) {
      return runs.addEvidence((await locate(strategyName, run)).dir, source, items, meta);
    },
    async sealRun(strategyName, run) {
      return runs.sealRun((await locate(strategyName, run)).dir);
    },
    async readRun(strategyName, run) {
      return runs.readRun((await locate(strategyName, run)).dir);
    },
    /**
     * Read another run whole for a module citing it (A5, A27): its sealed `run.json`, every
     * evidence file it lists and its accepted artifacts. No lock is taken - a sealed run's evidence
     * no longer changes, and its `artifacts[]` is read once - so a module's `build` may call it
     * under its own run's mutex. `MISSING_EVIDENCE` for a run not yet sealed, which has no
     * snapshot to cite; nothing is counted or written.
     */
    async readSealedRun(strategyName, run) {
      const located = await locate(strategyName, run);
      const { manifest } = await runs.readRun(located.dir);
      if (!manifest.sealed_at) throw refuse.missingEvidence("引用的运行");
      return { strategy: located.strategy, run: located.run, ...(await contentsOf(located.dir, manifest)) };
    },
    /**
     * The run view of a sealed run (run view §5.5): `buildView` over the run's sealed `run.json`,
     * its `metrics.json`, its evidence and its accepted artifacts keyed by module (`acceptedArtifacts`
     * already keys them so). The evidence and its `evidenceView` are read once per run and cached;
     * the manifest, the metrics and the artifacts are read on every call. Refuses as
     * `readSealedRun` does - `MISSING_EVIDENCE` for an open run, nothing cached. No lock, nothing
     * counted or written.
     */
    async view(strategyName, run, { modules } = {}) {
      const located = await locate(strategyName, run);
      const { manifest, metrics } = await runs.readRun(located.dir);
      if (!manifest.sealed_at) throw refuse.missingEvidence("引用的运行");
      const key = `${located.strategy}/${located.run}`;
      let cached = evidenceCache.get(key);
      if (cached === undefined) {
        const { evidence } = await contentsOf(located.dir, manifest, { artifacts: false });
        cached = { evidence, half: evidenceView({ manifest, evidence }) };
        evidenceCache.set(key, cached);
      }
      const sealed = { strategy: located.strategy, run: located.run, manifest, metrics, evidence: cached.evidence, artifacts: await acceptedArtifacts(located.dir, manifest.artifacts) };
      return buildView(sealed, { modules, evidence: cached.half });
    },
    /**
     * The strategy's newest earlier accepted `module` artifact of an earlier session (A11, A12: the
     * mode's previous card), or null. Earlier is by the run-id order, ties within one second by
     * `opened_at`; of the last 50 runs before `run` - the run ids no later in their second - the
     * newest one that is sealed, names the module in `run.json` `artifacts[]` and whose `session` is
     * strictly before the run's own (a run of the same session is a re-run, not the next one) is
     * read through `readArtifact` and returned, whatever it holds - the caller judges it - or null
     * when its file is unusable. A run that is missing, unusable or gone is passed over; a run with
     * no session has no earlier one. No lock is taken: an earlier sealed run's `artifacts[]` only
     * grows, and an artifact lands whole by its rename. Nothing is counted or written.
     */
    async previousArtifact(strategyName, run, module) {
      const entry = MODULES.find((candidate) => candidate.name === module);
      if (entry === undefined) throw new TypeError(`lunhui: a module is one of MODULES, not ${JSON.stringify(module)}`);
      const strategy = await runs.resolveStrategy(strategiesRoot, strategyName);
      const current = await runs.resolveRun(strategy.dir, run);
      const { manifest: own } = await runs.readRun(current.dir);
      const self = { run: current.run, opened_at: own.opened_at };
      const session = typeof own.session === "string" ? own.session : null;
      if (session === null) return null;
      const second = (id) => id.slice(0, 16);
      const ids = (await runs.listRuns(strategy.dir))
        .filter((id) => id !== current.run && second(id) <= second(current.run))
        .sort()
        .reverse()
        .slice(0, PREVIOUS_RUNS);
      const earlier = [];
      for (const id of ids) {
        try {
          const located = await runs.resolveRun(strategy.dir, id);
          const { manifest } = await runs.readRun(located.dir);
          const named = Array.isArray(manifest.artifacts) && manifest.artifacts.includes(module);
          const at = { run: located.run, opened_at: manifest.opened_at };
          const before = typeof manifest.session === "string" && manifest.session < session;
          if (manifest.sealed_at && named && before && openedBefore(at, self)) earlier.push({ at, dir: located.dir, manifest });
        } catch (error) {
          if (!(error instanceof runs.LunhuiError)) throw error;
        }
      }
      earlier.sort((a, b) => (openedBefore(a.at, b.at) ? 1 : -1));
      if (earlier.length === 0) return null;
      const [{ at, dir, manifest }] = earlier;
      let artifact;
      try {
        artifact = await readArtifact(dir, entry);
      } catch (error) {
        if (!(error instanceof runs.LunhuiError)) throw error;
        return null;
      }
      return artifact === null ? null : { run: at.run, snapshot_id: manifest.snapshot_id ?? null, session: manifest.session ?? null, artifact };
    },
    /** The strategy's THESIS.md (`runs.mjs`'s `readThesis`): text, or null. `NOT_A_STRATEGY` as `resolveStrategy`. */
    async readThesis(strategyName) {
      return runs.readThesis((await runs.resolveStrategy(strategiesRoot, strategyName)).dir);
    },
    /**
     * Run `fn` alone on the run: one in-process mutex per `<strategy>/<run>`, keyed by the on-disk
     * names, so two freezes of one run land one after the other. The run must exist; `fn` is handed
     * its on-disk names and directory. Not reentrant: `fn` calling `withRun` on the same run waits
     * forever.
     */
    async withRun(strategyName, run, fn) {
      const located = await locate(strategyName, run);
      const key = `${located.strategy}/${located.run}`;
      const previous = tails.get(key) ?? Promise.resolve();
      let release = () => {};
      const tail = previous.then(() => new Promise((resolve) => { release = resolve; }));
      tails.set(key, tail);
      await previous;
      try {
        return await fn(located);
      } finally {
        release();
        if (tails.get(key) === tail) tails.delete(key);
      }
    },
    /**
     * Count one freeze on the run (A7): `metrics.freezes` plus one, written back through
     * `writeMetrics` - counts `readRun` reset, fail-open, start again from zero - then `TOOL_BUDGET`
     * when the count passes the budget, the refused call counted. Called inside `withRun`.
     * @returns {Promise<number>} the count
     */
    async countFreeze(strategyName, run) {
      const { dir } = await locate(strategyName, run);
      const { metrics } = await runs.readRun(dir);
      const freezes = metrics.freezes + 1;
      await runs.writeMetrics(dir, { ...metrics, freezes });
      if (freezes > FREEZE_BUDGET) throw refuse.toolBudget();
      return freezes;
    },
    /**
     * Record a refused freeze: append `code` to `metrics.refusals[source]`, written back through
     * `writeMetrics`. The key `refusals` is absent until the first refusal. Called inside `withRun`,
     * after `countFreeze`, so the refused call is already counted.
     */
    async recordRefusal(strategyName, run, source, code) {
      const { dir } = await locate(strategyName, run);
      const { metrics } = await runs.readRun(dir);
      const refusals = metrics.refusals !== null && typeof metrics.refusals === "object" && !Array.isArray(metrics.refusals) ? metrics.refusals : {};
      const recorded = Array.isArray(refusals[source]) ? refusals[source] : [];
      await runs.writeMetrics(dir, { ...metrics, refusals: { ...refusals, [source]: [...recorded, code] } });
    },
    /**
     * Read `module`'s context of the run, under the run's mutex - the freezes' own - so a freeze
     * racing the first read lands before the seal or is `RUN_SEALED`: count the call, seal the run
     * when it is open (A4; a sealed run stays as it is), hand `build` the sealed manifest and every
     * evidence file it lists (`readEvidence`), and only once `build` has returned remember the read,
     * so an unusable evidence file or a `build` that throws leaves the submit `READ_FIRST`. The run's
     * accepted artifacts come with the evidence (`acceptedArtifacts`). `build`
     * is also handed the run's on-disk `{ strategy, run }`, the names a module keys its digest by,
     * whatever letter case the caller spelled them in. What `build` returns is returned. A module outside `MODULES` is host code's bug, a `TypeError`.
     */
    async readContext(strategyName, run, module, build) {
      return service.withRun(strategyName, run, async (located) => {
        await countCall(located.dir, module);
        const manifest = await runs.sealRun(located.dir);
        const context = await build(await contentsOf(located.dir, manifest), { strategy: located.strategy, run: located.run });
        reads.add(`${located.strategy}/${located.run}/${module}`);
        return context;
      });
    },
    /**
     * Take `module`'s one artifact of the run, under the run's mutex, so two submits land one after
     * the other and the second is `ALREADY_SUBMITTED` (stage 0's `SUBMIT_IN_PROGRESS` is never
     * thrown): count the call; `ALREADY_SUBMITTED` when `run.json` `artifacts[]` names the module;
     * `READ_FIRST` unless this process read the module's context of the run; then `validate(text,
     * { strategy, run })`, the run's on-disk names as `readContext` hands `build`.
     * A rejection carrying a `category` (`validateEnvelope`'s) is recorded in
     * `metrics.rejections[module]` and thrown `INVALID_ANALYSIS` with its repair (`repairFor` its
     * category when it carries none); any other error
     * the validator throws is thrown as it is. An accepted artifact - the validator's return - is
     * written by `writeArtifact` and the module pushed to `metrics.submitted`.
     */
    async submit(strategyName, run, module, text, validate) {
      return service.withRun(strategyName, run, async (located) => {
        const metrics = await countCall(located.dir, module);
        const { manifest } = await runs.readRun(located.dir);
        if (Array.isArray(manifest.artifacts) && manifest.artifacts.includes(module)) throw refuse.alreadySubmitted(module);
        if (!reads.has(`${located.strategy}/${located.run}/${module}`)) throw refuse.readFirst(module);
        let artifact;
        try {
          artifact = await validate(text, { strategy: located.strategy, run: located.run });
        } catch (error) {
          if (typeof error?.category !== "string") throw error;
          const recorded = Array.isArray(metrics.rejections[module]) ? metrics.rejections[module] : [];
          await runs.writeMetrics(located.dir, { ...metrics, rejections: { ...metrics.rejections, [module]: [...recorded, error.category] } });
          throw refuse.rejected(error.category, error.message, error.repair ?? repairFor(error.category));
        }
        await runs.writeArtifact(located.dir, module, artifact);
        await runs.writeMetrics(located.dir, { ...metrics, submitted: [...metrics.submitted, module] });
        return { accepted: true, module, run: located.run };
      });
    },
  };
  return service;
}

/**
 * A module's artifact file in the run, parsed: an object of at most 24 KiB compact, else null - the
 * file missing, unusable (`readText`), not JSON, not an object or too large. The run directory
 * itself gone or swapped still refuses (`NO_SUCH_RUN`).
 * @param {string} dir the run directory
 * @param {import("./lib/modules.mjs").LunhuiModule} module
 * @returns {Promise<Record<string, unknown> | null>}
 */
async function readArtifact(dir, module) {
  let artifact;
  try {
    artifact = JSON.parse(await runs.readText(dir, module.file));
  } catch (error) {
    if (!(error instanceof SyntaxError || error?.unusableFile === module.file)) throw error;
    return null;
  }
  const usable = artifact !== null && typeof artifact === "object" && !Array.isArray(artifact)
    && Buffer.byteLength(JSON.stringify(artifact), "utf8") <= ARTIFACT_MAX_BYTES;
  return usable ? artifact : null;
}

/**
 * The run's accepted artifacts by module: those `run.json` `artifacts[]` names (A10) whose file
 * `readArtifact` can use; any other is left out, as `lunhui_read_run` lists it unaccepted.
 * @param {string} dir the run directory
 * @param {unknown} named the manifest's `artifacts`
 * @returns {Promise<Record<string, Record<string, unknown>>>}
 */
async function acceptedArtifacts(dir, named) {
  const accepted = new Set(Array.isArray(named) ? named : []);
  /** @type {Record<string, Record<string, unknown>>} */
  const artifacts = {};
  for (const module of MODULES) {
    if (!accepted.has(module.name)) continue;
    const artifact = await readArtifact(dir, module);
    if (artifact !== null) artifacts[module.name] = artifact;
  }
  return artifacts;
}

/**
 * A sealed run's contents, as a module reads them: the manifest, in its order each evidence file
 * it lists (`readEvidence`), and the accepted artifacts.
 * @param {string} dir the run directory
 * @param {import("./lib/runs.mjs").RunManifest} manifest the sealed `run.json`
 * @param {{ artifacts?: boolean }} [options] `artifacts: false` skips the artifacts, `{}` (the view reads them itself)
 * @returns {Promise<ContextInput>}
 */
async function contentsOf(dir, manifest, { artifacts = true } = {}) {
  const evidence = [];
  for (const entry of manifest.evidence) {
    const file = await runs.readEvidence(dir, entry.source);
    evidence.push({ source: entry.source, session: entry.session, items: file.items });
  }
  return { manifest, evidence, artifacts: artifacts ? await acceptedArtifacts(dir, manifest.artifacts) : {} };
}

/**
 * Each artifact present in the run, by `MODULES` order: its headline fields when `run.json`
 * `artifacts[]` names its module - the record a submit lands (A10, plan 1's §12 row) - and the file
 * parses to an object of at most 24 KiB compact (`readArtifact`), else listed unaccepted with no
 * headline.
 * @param {string} dir the run directory
 * @param {unknown} named the manifest's `artifacts`
 */
async function artifactsOf(dir, named) {
  const accepted = new Set(Array.isArray(named) ? named : []);
  const present = new Set(await readdir(dir));
  const artifacts = [];
  for (const module of MODULES) {
    if (!present.has(module.file)) continue;
    const artifact = accepted.has(module.name) ? await readArtifact(dir, module) : null;
    artifacts.push(artifact !== null
      ? { module: module.name, accepted: true, headline: Object.fromEntries(module.headline.filter((field) => Object.hasOwn(artifact, field)).map((field) => [field, artifact[field]])) }
      : { module: module.name, accepted: false, headline: null });
  }
  return artifacts;
}

/** The sealed runs `lunhui_read_run` lists without a run: the newest five. */
const RECENT_RUNS = 5;

/**
 * `lunhui_read_run` without a run (A5: Gravit finds the day's, or the previous trading day's,
 * cn-market run from a strategy channel): the strategy's newest sealed runs, at most
 * `RECENT_RUNS`, newest first by run id, each `{ run, session, sealed_at, snapshot_id, artifacts }`
 * - `artifacts` the modules `run.json` names accepted. Of the last `PREVIOUS_RUNS` run ids only,
 * each resolved and read as one run is (`resolveRun`, `readRun`); a run that is missing, a link or
 * unusable, or still open, is passed over. No lock is taken - a sealed run's `run.json` changes only
 * by an artifact landing whole - and nothing is counted or written. `NOT_A_STRATEGY` as
 * `resolveStrategy`.
 * @param {string} strategiesRoot
 * @param {unknown} strategyName
 */
async function recentSealedRuns(strategiesRoot, strategyName) {
  const strategy = await runs.resolveStrategy(strategiesRoot, strategyName);
  const ids = (await runs.listRuns(strategy.dir)).sort().reverse().slice(0, PREVIOUS_RUNS);
  const listed = [];
  for (const id of ids) {
    if (listed.length === RECENT_RUNS) break;
    try {
      const located = await runs.resolveRun(strategy.dir, id);
      const { manifest } = await runs.readRun(located.dir);
      if (!manifest.sealed_at) continue;
      listed.push({
        run: located.run, session: manifest.session ?? null, sealed_at: manifest.sealed_at, snapshot_id: manifest.snapshot_id ?? null,
        artifacts: Array.isArray(manifest.artifacts) ? manifest.artifacts.filter((module) => MODULE_NAMES.has(module)) : [],
      });
    } catch (error) {
      if (!(error instanceof runs.LunhuiError)) throw error;
    }
  }
  return { strategy: strategy.name, runs: listed };
}

/**
 * @param {any} ctx the row's context, injecting `tools`
 * @param {{ strategiesRoot?: unknown }} config
 */
export function apply(ctx, config) {
  const strategiesRoot = config?.strategiesRoot;
  if (typeof strategiesRoot !== "string" || !isAbsolute(strategiesRoot) || !statSync(strategiesRoot, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error("lunhui-runs: strategiesRoot must be an absolute path to an existing directory");
  }
  const service = createLunhuiRuns(strategiesRoot);
  ctx.effect(() => ctx.provide("lunhuiRuns", service));
  ctx.effect(() => ctx.tools.register(defineTool({
    name: "lunhui_read_run",
    description: "读取研究运行，参数是策略名与运行编号，不是路径。带 run：返回该运行的清单、计数与各模块工件的要点。不带 run：列出该策略最近至多 5 个已封存的运行（运行编号、session、sealed_at、snapshot_id、已接受的工件），新的在前，用来找当日或前一个交易日的 cn-market 运行。带 run 时另附 view：face 画图用的同一份数字的摘要；作答时标题与结论里的数字只取自这里。",
    parameters: {
      strategy: { type: "string", description: "策略名，即频道名（如 cn-market），不是路径。", required: true },
      run: { type: "string", description: "可选：运行编号，即冻结工具返回的 run；省略则列出最近已封存的运行。" },
    },
    output: {
      schema: { type: "string" },
      render: (_args, result) => [{ type: "text", text: result }],
    },
    async execute(args, _exec) {
      try {
        if (args.run === undefined) return JSON.stringify(await recentSealedRuns(strategiesRoot, args.strategy));
        const { manifest, metrics } = await service.readRun(args.strategy, args.run);
        const strategy = await runs.resolveStrategy(strategiesRoot, args.strategy);
        const { dir } = await runs.resolveRun(strategy.dir, args.run);
        const artifacts = await artifactsOf(dir, manifest.artifacts);
        const view = manifest.sealed_at ? viewDigest(await service.view(args.strategy, args.run)) : null;
        return JSON.stringify({ manifest, metrics, artifacts, view });
      } catch (error) {
        throw asToolError(error);
      }
    },
  })));
}
