// face/plugins/lunhui/runs-row.mjs
/**
 * `lunhui-runs` - the Lunhui backbone row (modules spec §5.2, A1). It provides the `lunhuiRuns`
 * service every other Lunhui row injects - strategy and run anchoring, the run's states, the
 * per-run write mutex and the freeze budget - and registers one tool, `lunhui_read_run`, the
 * Gravit-facing view of a run: its `run.json`, its counts and each artifact's headline, so Gravit
 * coordinates without reading files.
 *
 * For the module rows it reads a module's context - sealing the run on the first read (A4) - and
 * takes a module's one artifact (A10), each call counted against the module's budget (A7), and
 * remembers in this process which module read which run, the submit's `READ_FIRST` (§5.7).
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

export const name = "lunhui-runs";
export const inject = ["tools"];

/** The largest artifact `lunhui_read_run` reads a headline from, on the compact JSON (spec §5.11). */
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
 *   withRun<T>(strategyName: unknown, run: unknown, fn: (located: { strategy: string, run: string, dir: string }) => Promise<T>): Promise<T>,
 *   countFreeze(strategyName: unknown, run: unknown): Promise<number>,
 *   readContext<T>(strategyName: unknown, run: unknown, module: string, build: (input: ContextInput) => T | Promise<T>): Promise<T>,
 *   submit(strategyName: unknown, run: unknown, module: string, text: unknown, validate: (text: unknown) => unknown): Promise<{ accepted: true, module: string, run: string }>,
 * }} LunhuiRuns
 */

/**
 * What `readContext` hands a module's `build`: the sealed `run.json` and, in its order, each
 * evidence file it lists.
 * @typedef {{ manifest: import("./lib/runs.mjs").RunManifest, evidence: Array<{ source: string, session: string, items: any[] }> }} ContextInput
 */

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
     * Read `module`'s context of the run, under the run's mutex - the freezes' own - so a freeze
     * racing the first read lands before the seal or is `RUN_SEALED`: count the call, seal the run
     * when it is open (A4; a sealed run stays as it is), hand `build` the sealed manifest and every
     * evidence file it lists (`readEvidence`), and only once `build` has returned remember the read,
     * so an unusable evidence file or a `build` that throws leaves the submit `READ_FIRST`. What
     * `build` returns is returned. A module outside `MODULES` is host code's bug, a `TypeError`.
     */
    async readContext(strategyName, run, module, build) {
      return service.withRun(strategyName, run, async (located) => {
        await countCall(located.dir, module);
        const manifest = await runs.sealRun(located.dir);
        const evidence = [];
        for (const entry of manifest.evidence) {
          const file = await runs.readEvidence(located.dir, entry.source);
          evidence.push({ source: entry.source, session: entry.session, items: file.items });
        }
        const context = await build({ manifest, evidence });
        reads.add(`${located.strategy}/${located.run}/${module}`);
        return context;
      });
    },
    /**
     * Take `module`'s one artifact of the run, under the run's mutex, so two submits land one after
     * the other and the second is `ALREADY_SUBMITTED` (stage 0's `SUBMIT_IN_PROGRESS` is never
     * thrown): count the call; `ALREADY_SUBMITTED` when `run.json` `artifacts[]` names the module;
     * `READ_FIRST` unless this process read the module's context of the run; then `validate(text)`.
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
          artifact = await validate(text);
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
 * Each artifact present in the run, by `MODULES` order: its headline fields when `run.json`
 * `artifacts[]` names its module - the record a submit lands (A10, plan 1's §12 row) - and the file
 * parses to an object of at most 24 KiB compact, else listed unaccepted with no headline.
 * @param {string} dir the run directory
 * @param {unknown} named the manifest's `artifacts`
 */
async function artifactsOf(dir, named) {
  const accepted = new Set(Array.isArray(named) ? named : []);
  const present = new Set(await readdir(dir));
  const artifacts = [];
  for (const module of MODULES) {
    if (!present.has(module.file)) continue;
    let artifact;
    if (!accepted.has(module.name)) {
      artifacts.push({ module: module.name, accepted: false, headline: null });
      continue;
    }
    try {
      artifact = JSON.parse(await runs.readText(dir, module.file));
    } catch (error) {
      // The file unusable lists unaccepted; the run directory itself gone or swapped refuses the call.
      if (!(error instanceof SyntaxError || error?.unusableFile === module.file)) throw error;
    }
    const usable = artifact !== null && typeof artifact === "object" && !Array.isArray(artifact)
      && Buffer.byteLength(JSON.stringify(artifact), "utf8") <= ARTIFACT_MAX_BYTES;
    artifacts.push(usable
      ? { module: module.name, accepted: true, headline: Object.fromEntries(module.headline.filter((field) => Object.hasOwn(artifact, field)).map((field) => [field, artifact[field]])) }
      : { module: module.name, accepted: false, headline: null });
  }
  return artifacts;
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
    description: "读取一次研究运行的清单、计数与各模块工件的要点；参数是策略名与运行编号，不是路径。",
    parameters: {
      strategy: { type: "string", description: "策略名，即频道名（如 cn-market），不是路径。", required: true },
      run: { type: "string", description: "运行编号，即冻结工具返回的 run。", required: true },
    },
    output: {
      schema: { type: "string" },
      render: (_args, result) => [{ type: "text", text: result }],
    },
    async execute(args, _exec) {
      try {
        const { manifest, metrics } = await service.readRun(args.strategy, args.run);
        const strategy = await runs.resolveStrategy(strategiesRoot, args.strategy);
        const { dir } = await runs.resolveRun(strategy.dir, args.run);
        return JSON.stringify({ manifest, metrics, artifacts: await artifactsOf(dir, manifest.artifacts) });
      } catch (error) {
        throw asToolError(error);
      }
    },
  })));
}
