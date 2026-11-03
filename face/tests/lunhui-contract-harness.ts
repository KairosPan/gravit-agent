/**
 * The harness the Lunhui module contract tests share (environment, sentiment, theme): a module
 * row mounted on the stand-in scope of tests/lunhui-rows.test.ts beside a real `lunhui-runs`
 * service and the real index, quotes, limit-up and boards freeze rows over a temp copy of the
 * Tencent and Eastmoney fixtures, so every evidence item a context carries is the shape a freeze
 * writes. Nothing reaches the network.
 */
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { apply as applyRuns } from "../plugins/lunhui/runs-row.mjs";
import * as indexRow from "../plugins/lunhui/freeze-index-row.mjs";
import * as quotesRow from "../plugins/lunhui/freeze-quotes-row.mjs";
import * as limitUpRow from "../plugins/lunhui/freeze-limit-up-row.mjs";
import * as boardsRow from "../plugins/lunhui/freeze-boards-row.mjs";
import { LunhuiError } from "../plugins/lunhui/lib/runs.mjs";

export type Cleanup = { after(fn: () => unknown): unknown };
export type ToolDef = { name: string; description: string; parameters: any; execute(args: unknown, exec: unknown): Promise<string> };
export type Source = "index" | "quotes" | "limit-up" | "boards";
type ModuleRow = { apply(ctx: any, config: unknown): void };

const TENCENT = fileURLToPath(new URL("./fixtures/lunhui/", import.meta.url));
const EASTMONEY = fileURLToPath(new URL("./fixtures/lunhui-eastmoney/", import.meta.url));
/** Friday 2026-10-23, 15:00 in China: after the close of a covered trading day. */
const FRIDAY = new Date("2026-10-23T07:00:00.000Z");
/** A delegated role child's session header: a spawn child on a role's own preset. */
export const ROLE = { origin: "subagent", agentPreset: "role-cn-market-analyst" };
/** The boards the fixtures hold member lists for. */
export const BOARDS = ["BK0715", "BK1716"];

/** A strategies root holding `cn-market` and a strategy, `alpha`. */
export async function strategiesRoot(t: Cleanup): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lunhui-contract-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const strategy of ["cn-market", "alpha"]) {
    await mkdir(join(root, strategy));
    await writeFile(join(root, strategy, "THESIS.md"), `# ${strategy}\n`);
  }
  return root;
}

/** One directory holding both fixture sets. */
export async function fixtures(t: Cleanup): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "lunhui-contract-fixtures-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await cp(TENCENT, dir, { recursive: true });
  await cp(EASTMONEY, dir, { recursive: true });
  return dir;
}

export function fakeScope(extra: Record<string, unknown> = {}) {
  const provided: Array<[string, any]> = [];
  const tools: ToolDef[] = [];
  const ctx: any = {
    ...extra,
    effect(fn: () => unknown) { const d = fn(); assert.equal(typeof d, "function"); return d; },
    provide(key: string, value: unknown) { provided.push([key, value]); return () => {}; },
    tools: { register(def: ToolDef) { tools.push(def); return () => { tools.splice(tools.indexOf(def), 1); }; } },
  };
  return { ctx, provided, tools };
}

/**
 * The backbone, the four freezes over the fixtures - `prepare` may rewrite the temp copy first -
 * and `row`'s two tools, the read and the submit.
 */
export async function mount(t: Cleanup, row: ModuleRow, prepare?: (dir: string) => Promise<void>, boardsConfig: Record<string, unknown> = {}) {
  const root = await strategiesRoot(t);
  const dir = await fixtures(t);
  await prepare?.(dir);
  const backbone = fakeScope();
  applyRuns(backbone.ctx, { strategiesRoot: root });
  const service = backbone.provided[0][1];
  const freeze: Record<string, ToolDef> = {};
  for (const [source, freezeRow] of [["index", indexRow], ["quotes", quotesRow], ["limit-up", limitUpRow], ["boards", boardsRow]] as const) {
    const scope = fakeScope({ lunhuiRuns: service });
    freezeRow.apply(scope.ctx, { fetch: dir, now: () => FRIDAY, ...(source === "boards" ? boardsConfig : {}) });
    freeze[source] = scope.tools[0];
  }
  const scope = fakeScope({ lunhuiRuns: service });
  row.apply(scope.ctx, {});
  const [read, submit] = scope.tools;
  return { root, service, freeze, read, submit };
}

export function exec(header: Record<string, unknown> = {}) {
  return { agent: { session: { header } }, signal: new AbortController().signal };
}

export async function rejectsWith(promise: Promise<unknown>, code: string): Promise<LunhuiError> {
  let refusal: any;
  await assert.rejects(promise, (error: any) => {
    assert.ok(error instanceof LunhuiError, `a LunhuiError, not ${error?.stack ?? error}`);
    assert.equal(error.code, code);
    assert.match(error.message, new RegExp(`^${code}: `));
    refusal = error;
    return true;
  });
  return refusal;
}

/**
 * A cn-market run frozen through the real rows, the sources in order: quotes for `symbols`, boards
 * for `boards` (the fixtures' two by default; null for the freeze's own first ten).
 */
export async function frozenRun(
  freeze: Record<string, ToolDef>,
  sources: Source[],
  { symbols = ["sh000001", "sh600519"], boards = BOARDS }: { symbols?: string[]; boards?: string[] | null } = {},
) {
  let run: string | undefined;
  for (const source of sources) {
    const args = {
      strategy: "cn-market", ...(run === undefined ? {} : { run }),
      ...(source === "quotes" ? { symbols } : {}), ...(source === "boards" && boards ? { boards } : {}),
    };
    run = JSON.parse(await freeze[source].execute(args, exec())).run;
  }
  return run as string;
}

/** The context's rows by id, derived and evidence alike. */
export function rowsOf(context: any): any[] {
  return [...context.derived, ...context.evidence];
}

export function idWhere(context: any, test: (row: any) => boolean): string {
  const row = rowsOf(context).find(test);
  assert.ok(row, "the context carries the row the test cites");
  return row.id as string;
}
