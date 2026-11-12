/** The analog rows on a real boot against a stub market: the running registry lists `analog_chart` and
 * `analog_events`, and `/data/plugins.json`'s listing shows the three rows active; the booted `analogViews` service scans `QRY` over a
 * universe of `PAST`, reading every history from the stub, and stores the view; the view route serves it with the
 * signed-in cookie, refuses with 403 a request that fails the fence (from another site's page), and answers 404 for
 * an unknown id; the stub saw only `/api/candles` on the
 * `cboe` venue; and neither the conversation's preset nor the desk's lists any `analog_` tool.
 *
 * ONE BOOT PER PROCESS (smoke.test.ts header): `bootFace` sets `process.env.DSH_HOME`, so this is its own file.
 * The scratch home is a `mkdtemp` directory, never `~/.dsh`; the Account seat is disabled, and `analog-views` is
 * replaced by a row over a scratch views directory, the stub's origin and a one-company universe. The stub is an
 * `http.createServer` on port 0 answering `/api/candles` from `fakeMarket` (analog-fixtures.ts); the boot's other
 * market readers keep the dead URL `helpers/no-market.ts` sets. A bare `bootFace` mounts no `/data` route, so the
 * view route is registered here as `src/main.ts` registers it, and the page is mounted for the sign-in
 * (`mountClient`). No model is called. Gated by FACE_SMOKE=1. */
import "./helpers/no-market.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupFaceProfile } from "../src/setup.ts";
import { bootFace } from "../src/boot.ts";
import { isTrustedDataRequest } from "../src/http.ts";
import { registerAnalogViewRoute, type AnalogViewService } from "../src/analog-view.ts";
import { panelDeps, pluginListing } from "../src/panels.ts";
import { ROUTER_ALLOW } from "../src/router-preset.ts";
import { DESK_ALLOW } from "../src/desk-preset.ts";
import { fakeMarket, MARKET, PAST, SELLOFF } from "./analog-fixtures.ts";
import { makeBotsRoot } from "./bots-fixture.ts";
import { mountClient, signIn } from "./remote.ts";

const gated = process.env.FACE_SMOKE !== "1";

/** The slice of the booted `analogViews` service this smoke calls. */
interface AnalogViews extends AnalogViewService {
  scanChart(args: { symbol: string }): Promise<{ query: { symbol: string }; coverage: Record<string, unknown> } & Record<string, unknown>>;
  writeView(view: unknown): Promise<{ id: string; bytes: number; windowsDropped: number; casesDropped: number }>;
}

test("analog smoke: analog_chart's rows on a real boot scan a stub market, store the view and serve it over the route", {
  skip: gated && "set FACE_SMOKE=1", timeout: 90_000,
}, async () => {
  const market = fakeMarket({ QRY: { bars: SELLOFF }, PAST: { bars: PAST }, SPY: { bars: MARKET } });
  const seen: Array<{ method: string; path: string }> = [];
  const stub = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://stub");
    seen.push({ method: req.method ?? "", path: url.pathname });
    if (req.method !== "GET" || url.pathname !== "/api/candles") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false }));
      return;
    }
    void market.ask(Object.fromEntries(url.searchParams)).then(({ status, body }) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;

  const home = mkdtempSync(join(tmpdir(), "face-analog-smoke-"));
  setupFaceProfile(home);
  const patchPath = join(home, "profiles", "face", "cordis.patch.yml");
  const patch = readFileSync(patchPath, "utf8").replace(/^\[\][ \t]*$/m, "");
  // This smoke owns a scratch profile: no seat.
  writeFileSync(patchPath, `${patch}\n- id: mcp-account\n  disabled: true\n`);
  let dispose: (() => Promise<void>) | undefined;
  let disposeView: (() => void) | undefined;
  try {
    const booted = await bootFace({
      profileName: "face", port: 0, dshHome: home, botsRoot: await makeBotsRoot(),
      extraPatches: [{ id: "analog-views", config: { viewsDir: join(home, "views"), market: origin, universe: ["PAST"] } }],
    });
    const { ctx } = booted;
    dispose = booted.dispose;
    disposeView = registerAnalogViewRoute(ctx.webServer, {
      isTrusted: isTrustedDataRequest,
      views: () => ctx.get("analogViews") as AnalogViewService | undefined,
    });
    mountClient(ctx);
    const base = `http://127.0.0.1:${ctx.webServer.port}`;
    const cookie = await signIn(ctx, base);

    // 1. both tools registered, the three rows listed active and enabled
    const tools = ctx.get("tools") as { schemas(): { name: string }[] } | undefined;
    assert.ok(tools !== undefined, "the tools service must be in the composed tree");
    const toolNames = tools.schemas().map((schema) => schema.name);
    for (const name of ["analog_chart", "analog_events"]) {
      assert.ok(toolNames.includes(name), `${name} must be registered; saw ${toolNames.join(", ")}`);
    }
    const listedRows = pluginListing(panelDeps(ctx, process.cwd(), home)).rows;
    for (const id of ["analog-views", "analog-chart", "analog-events"]) {
      const row = listedRows.find((r) => r.id.endsWith(`:${id}`));
      assert.ok(row, `${id} must be listed; saw ${listedRows.map((r) => r.id).join(", ")}`);
      assert.equal(row.phase, "active", id);
      assert.equal(row.enabled, true, id);
    }

    // 2. the service scans QRY over the stub and stores the view
    const views = ctx.get("analogViews") as AnalogViews | undefined;
    assert.ok(views !== undefined, "analogViews must be provided");
    const view = await views.scanChart({ symbol: "QRY" });
    assert.equal(view.query.symbol, "QRY");
    assert.deepEqual(
      [view.coverage.asked, view.coverage.read, view.coverage.stockDays, view.coverage.episodes, view.coverage.underWay],
      [2, 2, 527, 2, 1],
    );
    const written = await views.writeView(view);
    assert.match(written.id, /^an-\d{8}-[0-9a-f]{8}$/);

    // 3. the route: the stored view with the cookie, refused without it, 404 for an unknown id
    const res = await fetch(`${base}/data/analog/view?id=${written.id}`, { headers: { cookie } });
    assert.equal(res.status, 200);
    const body = await res.json() as { ok: boolean; view: { query: { symbol: string } } };
    assert.equal(body.ok, true);
    assert.equal(body.view.query.symbol, "QRY");
    /* `/data` is fence-only, no cookie (smoke.test.ts step 8, PLAN D8): what refuses a request without the
     * cookie is the fence, so the request without it comes from another site's page. */
    const bare = await fetch(`${base}/data/analog/view?id=${written.id}`, { headers: { origin: "http://evil.example.com" } });
    assert.equal(bare.status, 403, "from another site's page the fence refuses");
    await bare.arrayBuffer();
    const unknown = await fetch(`${base}/data/analog/view?id=an-20200101-00000000`, { headers: { cookie } });
    assert.equal(unknown.status, 404);
    await unknown.arrayBuffer();

    // 4. the stub saw only GET /api/candles, every one on the cboe venue
    assert.ok(seen.length > 0, "the stub must have been read");
    assert.deepEqual(seen.filter((s) => s.method !== "GET" || s.path !== "/api/candles"), []);
    assert.deepEqual(market.calls.filter((q) => q.venue !== "cboe"), []);

    // 5. neither the conversation's preset nor the desk's lists an analog tool
    assert.deepEqual(ROUTER_ALLOW.filter((name) => name.startsWith("analog_")), []);
    assert.deepEqual(DESK_ALLOW.filter((name) => name.startsWith("analog_")), []);
  } finally {
    disposeView?.();
    await dispose?.();
    await new Promise<void>((resolve) => stub.close(() => resolve()));
  }
});
