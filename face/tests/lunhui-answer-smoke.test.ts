/** Gravit's composed answer drawn end to end on a real boot (run view plan 3, Task 6): a sealed
 * market run on disk, read by the booted `lunhui-runs` row, served by the view route over HTTP
 * with the signed-in cookie, then drawn by the client's own modules - an ok `lunhui_present` call
 * and result lifted through `host/kinds.js`, the fetched view landed with `lunhuiViewLoaded`, the
 * thread rendered. Pinned: the seven kinds' labels in the call's order, the follow-ups, the footer
 * with Open run, the stock links, and the stock drawer of a ladder name with its minute chart.
 *
 * ONE BOOT PER PROCESS (smoke.test.ts header): `bootFace` sets `process.env.DSH_HOME`, so this is
 * its own file. The scratch home is a `mkdtemp` directory, never `~/.dsh`; AKShare and the
 * Account seat are disabled, and `lunhui-runs` is replaced by a row over a scratch strategies
 * root (a replacement restates `strategiesRoot`, src/lunhui.ts) holding `cn-market` and the
 * synthetic sealed 10-27 run (`syntheticSealedRun`), written as the run's own files. A bare
 * `bootFace` mounts no `/data` route, so the view route is registered here as `src/main.ts`
 * registers it, and the page is mounted for the sign-in (`mountClient`). No model is called. Gated by FACE_SMOKE=1. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupFaceProfile } from "../src/setup.ts";
import { bootFace } from "../src/boot.ts";
import { isTrustedDataRequest } from "../src/http.ts";
import { registerLunhuiViewRoute, type LunhuiViewService } from "../src/lunhui-view.ts";
// allowJs (tsconfig): the browser modules are imported as they ship, untranspiled.
import { mapFrame } from "../client/js/wire/mapper.js";
import { createStore } from "../client/js/store.js";
import { reducers } from "../client/js/reducers/index.js";
import { emptyState } from "../client/js/data/empty.js";
import { rememberCall, toMessages } from "../client/js/host/kinds.js";
import { viewOf, viewPath } from "../client/js/host/lunhui.js";
import { renderThread } from "../client/js/render/thread.js";
import { stockDrawerHtml } from "../client/js/render/lunhui/stock.js";
import { syntheticSealedRun } from "./lunhui-view-fixtures.ts";
import { makeBotsRoot } from "./bots-fixture.ts";
import { mountClient, signIn } from "./remote.ts";

const gated = process.env.FACE_SMOKE !== "1";

/** Write a sealed run as the run's own files: `run.json`, `metrics.json`, one `evidence-<source>.json` each, `<module>.json` each. */
function writeSealedRun(root: string, sealed: ReturnType<typeof syntheticSealedRun>): void {
  const strategy = join(root, sealed.strategy);
  const dir = join(strategy, "analysis", sealed.run);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(strategy, "THESIS.md"), `# ${sealed.strategy}\n`);
  writeFileSync(join(dir, "run.json"), `${JSON.stringify(sealed.manifest, null, 2)}\n`);
  writeFileSync(join(dir, "metrics.json"), JSON.stringify(sealed.metrics));
  for (const e of sealed.evidence) {
    writeFileSync(join(dir, `evidence-${e.source}.json`), JSON.stringify({
      source: e.source, received_at: "2026-10-27T20:16:30.000Z", session: e.session, host: "fixture", delayed: false, truncated: false, items: e.items,
    }));
  }
  for (const [module, artifact] of Object.entries(sealed.artifacts)) writeFileSync(join(dir, `${module}.json`), `${JSON.stringify(artifact, null, 2)}\n`);
}

/** The seven kinds, in the call's order, each with the face's own label it opens with. */
const KINDS: [string, string][] = [
  ["verdicts", "This run · "], ["breadth", "Breadth · "], ["indices", "Indices"], ["ladder", "Limit-up ladder · "],
  ["yesterday", "Yesterday's limit-ups"], ["signals", "Sentiment signals"], ["sources", "Sources"],
];
const MODULES = ["environment", "sentiment", "theme", "counterevidence"];

test("lunhui answer smoke: a sealed run's view over the real route, drawn as Gravit's composed answer with links, follow-ups and the stock drawer", {
  skip: gated && "set FACE_SMOKE=1", timeout: 90_000,
}, async () => {
  const home = mkdtempSync(join(tmpdir(), "face-lunhui-answer-"));
  const strategies = mkdtempSync(join(tmpdir(), "face-lunhui-answer-strategies-"));
  const sealed = syntheticSealedRun();
  writeSealedRun(strategies, sealed);
  setupFaceProfile(home);
  const patchPath = join(home, "profiles", "face", "cordis.patch.yml");
  const patch = readFileSync(patchPath, "utf8").replace(/^\[\][ \t]*$/m, "");
  // This smoke owns a scratch profile: no data server, no seat, and the backbone over the scratch root.
  writeFileSync(patchPath, `${patch}\n- id: mcp-akshare\n  disabled: true\n- id: mcp-account\n  disabled: true\n- id: lunhui-runs\n  config:\n    strategiesRoot: ${JSON.stringify(strategies)}\n`);
  const { ctx, dispose } = await bootFace({ profileName: "face", port: 0, dshHome: home, botsRoot: await makeBotsRoot() });
  const disposeView = registerLunhuiViewRoute(ctx.webServer, {
    isTrusted: isTrustedDataRequest,
    runs: () => ctx.get("lunhuiRuns") as LunhuiViewService | undefined,
  });
  try {
    mountClient(ctx);
    const base = `http://127.0.0.1:${ctx.webServer.port}`;
    const cookie = await signIn(ctx, base);

    // 1. Gravit's call and its ok result, lifted as the live layer lifts them
    const args = {
      strategy: sealed.strategy, run: sealed.run, summary: "弱势日，上海九百五连板仍在。",
      blocks: KINDS.map(([kind]) => ({ kind, title: `${kind} 标题` })),
      choices: [{ label: "看看上海九百", stock: "600001" }, { label: "说说炸板率" }],
    };
    const frame = (event: Record<string, unknown>) => ({ type: "session/event", sessionId: "s1", event });
    const calls = new Map();
    rememberCall(calls, frame({ type: "tool/call", seq: 40, time: 1756512200000, data: { turn: 4, step: 1, callId: "k1", name: "lunhui_present", arguments: JSON.stringify(args) } }));
    const result = { ok: true, blocks: KINDS.map(([kind]) => kind), modules: MODULES };
    const lifted = toMessages(mapFrame(frame({
      type: "tool/result", seq: 41, time: 1756512201000, surfaceOp: "append",
      data: { turn: 4, step: 1, message: { id: "m-41", role: "tool", source: { kind: "tool", callId: "k1" }, toolCallId: "k1", content: [{ type: "text", text: JSON.stringify(result) }], isError: false } },
    })), calls, Date.now());
    const answer = lifted.find((m: { kind: string }) => m.kind === "composed");
    assert.ok(answer, "the ok present result lifts a composed answer");
    const want = viewOf(answer);

    // 2. the view, fetched over the real route as the client's own path asks it
    const res = await fetch(base + viewPath(want), { headers: { cookie } });
    assert.equal(res.status, 200);
    const body = await res.json() as { ok: boolean; view: { strategy: string; run: string; stocks: Record<string, unknown> } };
    assert.equal(body.ok, true);
    assert.equal(body.view.run, sealed.run);
    assert.ok(Object.hasOwn(body.view.stocks, "600001"));

    // 3. the client's store and thread
    const conv = { id: "s1", kind: "gravit", title: "cn-market", loaded: true, live: true, messages: lifted };
    const store = createStore({
      initial: { ...emptyState(), route: { screen: "messages", id: "s1" }, conversations: [conv], channels: [{ name: sealed.strategy, workspaceId: "w1" }] },
      reducers,
    });
    store.dispatch("lunhuiViewLoaded", { key: want.key, view: body.view });
    const html = renderThread(conv, store.get(), Date.now());

    let at = -1;
    for (const [kind, label] of KINDS) {
      const i = html.indexOf(`<div class="lh-label">${label.replace("'", "&#39;")}`, at + 1);
      assert.ok(i > at, `${kind}'s label "${label}" after the one before it`);
      at = i;
    }
    assert.match(html, /<div class="lh-foot">Evidence [\s\S]*Open run ›<\/button><\/div>/, "the footer with Open run");
    assert.ok(html.indexOf('class="lh-choices"') < html.indexOf('class="lh-foot"'), "the follow-ups before the footer");
    assert.match(html, /data-action="lunhuiChoice"[^>]*data-code="600001">看看上海九百<\/button>/);
    assert.match(html, /data-action="lunhuiChoice"[^>]*>说说炸板率<\/button>/);
    assert.match(html, /class="lh-stock"[^>]*data-action="lunhuiStock"[^>]*data-code="600001">上海九百<\/button>/, "a pool name is a stock link");

    // 4. the drawer of a ladder name, its minute line against the limit
    store.dispatch("lunhuiStockOpen", { key: want.key, code: "600001" });
    const drawer = stockDrawerHtml(store.get());
    assert.match(drawer, /<aside class="drawer stock" aria-label="上海九百">/);
    assert.match(drawer, /<svg[\s\S]*class="lh-limit up"/, "the minute chart with its limit-up line");
  } finally {
    disposeView();
    await dispose();
  }
});
