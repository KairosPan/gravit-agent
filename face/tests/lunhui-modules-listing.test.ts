/* GET /data/modules.json and readModulesChannels: every channel's Lunhui runs, in the shape the
 * Discover module cards read (Lunhui module cards spec 2026-10-28, plan 1 Task 2). */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { WebRoute } from "@deepseek-ai/dsh-host-webserver";
import {
  MARKET_CHANNEL, MODULES_RUNS_CAP, readModulesChannels, registerChannelRoutes, WORKBENCH,
  type ChannelRow,
} from "../src/channels.ts";
import { addEvidence, openRun, sealRun } from "../plugins/lunhui/lib/runs.mjs";

/* ---------- fixtures ---------- */

/** A realpath'd temp workbench root with `strategies/<name>` for each name. */
async function makeRoot(names: string[]): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "face-modules-")));
  for (const name of names) await mkdir(join(root, "strategies", name), { recursive: true });
  return root;
}

/** One channel row as the reconcile hands it. */
function channelRow(root: string, name: string, extra: Partial<ChannelRow> = {}): ChannelRow {
  return {
    workspaceId: `ws-${name}`, name, title: name,
    dir: name === WORKBENCH ? root : join(root, "strategies", name),
    isRoot: name === WORKBENCH, missingDir: false, sessionIds: [], ...extra,
  };
}

/** One run as the server makes it - copied from tests/channels.test.ts makeRun, with the frozen
 * sources chosen: `openRun` at `now`, one freeze per source carrying a marker the listing must
 * never forward, sealed a second later unless `open`, then the artifacts hand-written and named in
 * `run.json`. */
async function makeRun(
  dir: string, now: Date,
  opts: { kind?: "market" | "strategy"; open?: boolean; sources?: string[]; artifacts?: Record<string, unknown> } = {},
): Promise<{ run: string; runDir: string }> {
  const { run, dir: runDir } = await openRun(dir, opts.kind ?? "strategy", now);
  for (const source of opts.sources ?? ["quotes"]) {
    await addEvidence(runDir, source, [{ symbol: "sh600000", note: "EVIDENCE-ONLY" }], {
      received_at: now.toISOString(), session: now.toISOString().slice(0, 10), host: "example.invalid", delayed: false, truncated: false,
    });
  }
  if (opts.open !== true) await sealRun(runDir, new Date(now.getTime() + 1000));
  const files = Object.keys(opts.artifacts ?? {});
  for (const file of files) await writeFile(join(runDir, file), `${JSON.stringify(opts.artifacts![file], null, 2)}\n`);
  if (files.length > 0) {
    const manifest = JSON.parse(await readFile(join(runDir, "run.json"), "utf8"));
    const named = files.map((file) => file.replace(/\.json$/, ""));
    await writeFile(join(runDir, "run.json"), `${JSON.stringify({ ...manifest, artifacts: named }, null, 2)}\n`);
  }
  return { run, runDir };
}

const ENVIRONMENT = {
  module: "environment", contract_version: "2", status: "OK",
  index_state: "WEAK", liquidity_state: "STABLE", cycle_anchor: "x", reasoning: "not a headline field",
};
const THEME = {
  module: "theme", contract_version: "2", status: "NOT_EVALUABLE", missing_sources: ["boards"],
  mainline_candidates: [], theme_stage: "UNKNOWN", rotation: "UNKNOWN",
};

/** The three channels of the first test: cn-market with a sealed and a newer open run,
 * lunhui-s01-repair with one sealed run reading the market's, lunhui-s02-rotation with no
 * analysis/ at all. */
async function makeTree(): Promise<{ root: string; marketSealed: string; marketOpen: string; strategyRun: string }> {
  const root = await makeRoot([MARKET_CHANNEL, "lunhui-s01-repair", "lunhui-s02-rotation"]);
  const market = join(root, "strategies", MARKET_CHANNEL);
  const sealed = await makeRun(market, new Date("2026-10-27T01:00:00Z"), {
    kind: "market", sources: ["index", "limit-up"], artifacts: { "environment.json": ENVIRONMENT, "theme.json": THEME },
  });
  const open = await makeRun(market, new Date("2026-10-28T01:00:00Z"), { kind: "market", open: true, sources: ["index"] });
  const strategy = await makeRun(join(root, "strategies", "lunhui-s01-repair"), new Date("2026-10-27T02:00:00Z"), {
    artifacts: {
      "leader.json": { module: "leader", contract_version: "2", status: "OK", market_run: sealed.run, leader_candidates: [], top_pattern_flags: [] },
      "counterevidence.json": { module: "counterevidence", contract_version: "2", status: "OK", items: [] },
      "mode.json": {
        module: "mode", contract_version: "2", mode: "WAIT", preconditions: [], research_only_matches: [],
        expectation: null, expectation_review: null, market_run: sealed.run,
      },
    },
  });
  return { root, marketSealed: sealed.run, marketOpen: open.run, strategyRun: strategy.run };
}

/* ---------- readModulesChannels ---------- */

test("readModulesChannels: cn-market is market, the rest strategy; the root and a missing directory are skipped; runs carry status, missing sources, headline and market run", async () => {
  const { root, marketSealed, marketOpen, strategyRun } = await makeTree();
  const rows = [
    channelRow(root, WORKBENCH),
    channelRow(root, MARKET_CHANNEL),
    channelRow(root, "lunhui-s01-repair"),
    channelRow(root, "lunhui-s02-rotation"),
    channelRow(root, "gone", { missingDir: true }),
  ];
  const out = await readModulesChannels(rows);
  assert.deepEqual(out.map((c) => [c.channel, c.kind, c.runs.length, c.runsOmitted]), [
    ["cn-market", "market", 2, 0], ["lunhui-s01-repair", "strategy", 1, 0], ["lunhui-s02-rotation", "strategy", 0, 0],
  ]);
  assert.deepEqual(out.map((c) => c.workspaceId), ["ws-cn-market", "ws-lunhui-s01-repair", "ws-lunhui-s02-rotation"]);
  assert.ok(out.every((c) => !("unreadable" in c)), "a channel with no analysis/ yet is not unreadable");

  assert.deepEqual(out[0].runs.map((r) => r.run), [marketOpen, marketSealed], "newest first");
  const market = out[0].runs[1];
  assert.equal(market.run, marketSealed);
  assert.deepEqual(market.frozen, ["index", "limit-up"]);
  assert.equal(market.openedAt, "2026-10-27T01:00:00.000Z");
  assert.equal(market.sealedAt, "2026-10-27T01:00:01.000Z");
  assert.equal(market.session, "2026-10-27");
  assert.equal(typeof market.asOf, "string");
  assert.equal(market.artifacts.environment.status, "OK");
  assert.deepEqual(market.artifacts.environment.missingSources, []);
  assert.deepEqual(market.artifacts.environment.headline, { index_state: "WEAK", liquidity_state: "STABLE", cycle_anchor: "x" });
  assert.equal(market.artifacts.environment.marketRun, null);
  assert.equal(market.artifacts.theme.status, "NOT_EVALUABLE");
  assert.deepEqual(market.artifacts.theme.missingSources, ["boards"]);
  assert.deepEqual(Object.keys(market.artifacts.theme).sort(), ["headline", "marketRun", "missingSources", "status"]);

  const open = out[0].runs[0];
  assert.equal(open.sealedAt, null);
  assert.equal(open.asOf, null);
  assert.deepEqual(open.frozen, ["index"]);
  assert.deepEqual(open.artifacts, {});

  const strategy = out[1].runs[0];
  assert.equal(strategy.run, strategyRun);
  assert.equal(strategy.artifacts.leader.marketRun, market.run);
  assert.equal(strategy.artifacts.mode.headline.mode, "WAIT");
  assert.equal(strategy.artifacts.mode.status, null, "a mode artifact with no status reads null");
  assert.deepEqual(strategy.artifacts.counterevidence.headline, { items: [] });

  assert.deepEqual(Object.keys(market).sort(), ["artifacts", "asOf", "boardsProvider", "frozen", "openedAt", "run", "sealedAt", "session"]);
  assert.equal("bytes" in market, false, "the listing's row is the card's shape, not the runs card's");
  assert.doesNotMatch(JSON.stringify(out), /EVIDENCE-ONLY/);
  assert.doesNotMatch(JSON.stringify(out), /not a headline field/);
});

test("readAnalysisRuns throws ENOENT for a channel with no analysis/, which the listing reads as no runs yet", async () => {
  const { readAnalysisRuns } = await import("../src/channels.ts");
  const root = await makeRoot(["bare"]);
  await assert.rejects(readAnalysisRuns(join(root, "strategies", "bare")), (err: NodeJS.ErrnoException) => err.code === "ENOENT");
});

test("readModulesChannels: a channel whose read throws ENOENT has no runs yet; one that throws anything else is unreadable; the others answer", async () => {
  const root = await makeRoot([MARKET_CHANNEL, "lunhui-s01-repair", "lunhui-s02-rotation"]);
  const enoent = Object.assign(new Error("no analysis"), { code: "ENOENT" });
  const seen: { dir: string; cap: number }[] = [];
  const out = await readModulesChannels(
    [channelRow(root, MARKET_CHANNEL), channelRow(root, "lunhui-s01-repair"), channelRow(root, "lunhui-s02-rotation")],
    async (dir, options) => {
      seen.push({ dir, cap: options.cap });
      if (dir.endsWith(MARKET_CHANNEL)) throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
      if (dir.endsWith("lunhui-s02-rotation")) throw enoent;
      return { runs: [], runsOmitted: 0, latestRun: null };
    },
  );
  assert.deepEqual(out.map((c) => [c.channel, c.runs, c.runsOmitted, c.unreadable === true]), [
    ["cn-market", [], 0, true], ["lunhui-s01-repair", [], 0, false], ["lunhui-s02-rotation", [], 0, false],
  ]);
  assert.equal("unreadable" in out[2], false);
  assert.ok(seen.every((s) => s.cap === MODULES_RUNS_CAP));
  assert.doesNotMatch(JSON.stringify(out), /EACCES|permission/, "nothing from the error reaches the listing");

  // a throw with no code at all is unreadable too
  const plain = await readModulesChannels([channelRow(root, MARKET_CHANNEL)], async () => { throw new Error("boom"); });
  assert.equal(plain[0].unreadable, true);
});

test("readModulesChannels: a file or a link where analysis/ should be lists the channel unreadable", async () => {
  const root = await makeRoot(["filed", "linked"]);
  await writeFile(join(root, "strategies", "filed", "analysis"), "not a directory");
  const outside = await realpath(await mkdtemp(join(tmpdir(), "face-modules-outside-")));
  await makeRun(outside, new Date("2026-10-27T01:00:00Z"), { artifacts: { "environment.json": { ...ENVIRONMENT, cycle_anchor: "OUTSIDE-ONLY" } } });
  await symlink(join(outside, "analysis"), join(root, "strategies", "linked", "analysis"));
  const out = await readModulesChannels([channelRow(root, "filed"), channelRow(root, "linked")]);
  assert.deepEqual(out.map((c) => [c.channel, c.runs, c.runsOmitted, c.unreadable]), [
    ["filed", [], 0, true], ["linked", [], 0, true],
  ]);
  assert.doesNotMatch(JSON.stringify(out), /OUTSIDE-ONLY/);
  const { readAnalysisRuns } = await import("../src/channels.ts");
  await assert.rejects(readAnalysisRuns(join(root, "strategies", "filed")), (err: NodeJS.ErrnoException) => err.code === "ENOTDIR");
});

test("readModulesChannels: the cap is MODULES_RUNS_CAP", async () => {
  const root = await makeRoot(["busy"]);
  const dir = join(root, "strategies", "busy");
  for (let i = 0; i < 13; i += 1) await makeRun(dir, new Date(Date.UTC(2026, 9, 27, 1, 0, i * 2)));
  const out = await readModulesChannels([channelRow(root, "busy")]);
  assert.equal(out[0].runs.length, MODULES_RUNS_CAP);
  assert.equal(out[0].runsOmitted, 1);
  assert.equal(MODULES_RUNS_CAP, 12);
});

test("MARKET_CHANNEL is the freeze rows' MARKET_CHANNEL", async () => {
  const { MARKET_CHANNEL: rows } = await import("../plugins/lunhui/lib/freeze-tool.mjs");
  assert.equal(MARKET_CHANNEL, rows);
});

/* ---------- the route ---------- */

/* fakeRes, getReq and fakeRegistry as tests/channels.test.ts has them, cut to what this file uses */

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

/** A registry standing in for ctx.workspaceRegistry, as tests/channels.test.ts fakeRegistry:
 * realpath canonicalization, create idempotence, a status that checks the directory. */
function fakeRegistry(): any {
  const byRealPath = new Map<string, any>();
  let next = 0;
  return {
    archivedSessionIds: [] as string[],
    list: () => [...byRealPath.values()],
    async create(path: string) {
      const real = await realpath(path);
      if (!(await stat(real)).isDirectory()) throw new Error(`not a directory: ${path}`);
      const had = byRealPath.get(real);
      if (had !== undefined) return had;
      const ws = {
        id: `ws-${++next}`, path: real, title: real.split("/").pop(), sessionIds: [] as string[],
        async setTitle(title: string) { ws.title = title; },
        async attachSession(sessionId: string) { if (!ws.sessionIds.includes(sessionId)) ws.sessionIds.push(sessionId); },
        async status() {
          try { return (await stat(ws.path)).isDirectory() ? "ok" as const : "missing-dir" as const; } catch { return "missing-dir" as const; }
        },
      };
      byRealPath.set(real, ws);
      return ws;
    },
  };
}

async function modulesRoute(root: string, opts: { mounted?: boolean; registry?: any } = {}): Promise<WebRoute> {
  const routes: WebRoute[] = [];
  registerChannelRoutes({ register: (route) => routes.push(route) }, {
    registry: opts.registry ?? fakeRegistry(), root,
    listSessions: async () => [],
    lunhuiMounted: () => opts.mounted ?? true,
  });
  const route = routes.find((r) => r.path === "/data/modules.json");
  assert.ok(route !== undefined, "the route is registered");
  assert.equal(route.kind, "exact");
  return route;
}

test("GET /data/modules.json: the fence, the shape, mounted from the dep; a reconcile failure is a fixed 500", async () => {
  const root = await makeRoot([MARKET_CHANNEL, "lunhui-s01-repair"]);
  await makeRun(join(root, "strategies", MARKET_CHANNEL), new Date("2026-10-27T01:00:00Z"), { kind: "market", artifacts: { "environment.json": ENVIRONMENT } });
  const route = await modulesRoute(root);

  const forged = fakeRes();
  await route.handler(getReq("evil.example.com"), forged.res);
  assert.equal(forged.out.status, 403);
  assert.equal(forged.out.body, '{"ok":false,"error":"forbidden"}');

  const ok = fakeRes();
  await route.handler(getReq("127.0.0.1:3090"), ok.res);
  assert.equal(ok.out.status, 200);
  const body = JSON.parse(ok.out.body);
  assert.deepEqual(Object.keys(body).sort(), ["channels", "mounted", "ok", "root"]);
  assert.equal(body.ok, true);
  assert.equal(body.mounted, true);
  assert.equal(body.root, root);
  assert.deepEqual(body.channels.map((c: { channel: string }) => c.channel), ["cn-market", "lunhui-s01-repair"], "the root is not a module channel");
  assert.ok(body.channels.every((c: { workspaceId: unknown }) => typeof c.workspaceId === "string" && c.workspaceId !== ""));
  assert.deepEqual(body.channels.map((c: { kind: string; runs: unknown[] }) => [c.kind, c.runs.length]), [["market", 1], ["strategy", 0]]);
  assert.equal(body.channels[0].runs[0].artifacts.environment.status, "OK");

  const unmounted = fakeRes();
  await (await modulesRoute(root, { mounted: false })).handler(getReq("127.0.0.1:3090"), unmounted.res);
  assert.equal(unmounted.out.status, 200);
  assert.equal(JSON.parse(unmounted.out.body).mounted, false);

  const broken = fakeRegistry();
  broken.list = () => { throw new Error("EACCES /secret/path"); };
  const failed = fakeRes();
  await (await modulesRoute(root, { registry: broken })).handler(getReq("127.0.0.1:3090"), failed.res);
  assert.equal(failed.out.status, 500);
  assert.deepEqual(JSON.parse(failed.out.body), { ok: false, error: "listing failed" });
});
