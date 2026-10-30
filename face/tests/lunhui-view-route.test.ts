import test from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { WebRoute } from "@deepseek-ai/dsh-host-webserver";
import { isTrustedDataRequest } from "../src/http.ts";
import { LUNHUI_VIEW_MODULES, registerLunhuiViewRoute } from "../src/lunhui-view.ts";
import { VIEW_MODULES } from "../plugins/lunhui/lib/view.mjs";

type Runs = { view(strategy: string, run: string, options?: { modules?: string[] }): Promise<unknown> };

const RUN = "20261030T010000Z-0123abcd";

function routeFor(runs: () => Runs | undefined): WebRoute {
  const routes: WebRoute[] = [];
  registerLunhuiViewRoute({ register: (route) => routes.push(route) }, { isTrusted: isTrustedDataRequest, runs });
  assert.equal(routes.length, 1, "one route");
  assert.equal(routes[0]!.kind, "exact");
  assert.equal(routes[0]!.path, "/data/lunhui/view");
  return routes[0]!;
}

async function call(route: WebRoute, url: string, host = "127.0.0.1:3090"): Promise<{ status: number; body: any }> {
  const out = { status: 0, body: "" };
  const res = {
    writeHead(status: number) { out.status = status; return res; },
    end(chunk?: string) { out.body = String(chunk ?? ""); return res; },
  };
  await route.handler({ url, method: "GET", headers: { host } } as IncomingMessage, res as unknown as ServerResponse);
  return { status: out.status, body: JSON.parse(out.body) };
}

function refusing(code: string): Runs {
  return { async view() { throw Object.assign(new Error(`${code}: refused`), { code }); } };
}

const url = (query: string) => `/data/lunhui/view?${query}`;

test("the route's module list is a copy of the plugin's VIEW_MODULES", () => {
  assert.deepEqual([...LUNHUI_VIEW_MODULES], [...VIEW_MODULES]);
});

test("GET /data/lunhui/view: an untrusted request is refused first", async () => {
  let asked = 0;
  const route = routeFor(() => { asked += 1; return refusing("NO_SUCH_RUN"); });
  const out = await call(route, url(`strategy=cn-market&run=${RUN}`), "evil.example.com");
  assert.equal(out.status, 403);
  assert.deepEqual(out.body, { ok: false, error: "forbidden" });
  assert.equal(asked, 0, "the service is not reached");
});

test("GET /data/lunhui/view: no lunhuiRuns service is a 503", async () => {
  const out = await call(routeFor(() => undefined), url(`strategy=cn-market&run=${RUN}`));
  assert.equal(out.status, 503);
  assert.deepEqual(out.body, { ok: false, error: "lunhui not mounted" });
});

test("GET /data/lunhui/view: a missing or repeated strategy or run, or an unknown module, is a 400", async () => {
  let asked = 0;
  const route = routeFor(() => ({ async view() { asked += 1; return {}; } }));
  for (const query of [
    `run=${RUN}`,
    "strategy=cn-market",
    `strategy=cn-market&strategy=other&run=${RUN}`,
    `strategy=cn-market&run=${RUN}&run=${RUN}`,
    `strategy=cn-market&run=${RUN}&modules=environment,leader`,
    `strategy=cn-market&run=${RUN}&modules=`,
    `strategy=cn-market&run=${RUN}&modules=environment&modules=theme`,
  ]) {
    const out = await call(route, url(query));
    assert.equal(out.status, 400, query);
    assert.equal(out.body.ok, false, query);
  }
  assert.equal(asked, 0, "the service is not reached");
});

test("GET /data/lunhui/view: the service's refusals map to statuses", async () => {
  for (const [code, status] of [["NOT_A_STRATEGY", 404], ["NO_SUCH_RUN", 404], ["BAD_RUN_ID", 400]] as const) {
    const out = await call(routeFor(() => refusing(code)), url(`strategy=cn-market&run=${RUN}`));
    assert.equal(out.status, status, code);
    assert.equal(out.body.ok, false, code);
  }
  const open = await call(routeFor(() => refusing("MISSING_EVIDENCE")), url(`strategy=cn-market&run=${RUN}`));
  assert.equal(open.status, 409);
  assert.deepEqual(open.body, { ok: false, error: "run not sealed" });
});

test("GET /data/lunhui/view: anything else thrown is a fixed 500 that echoes nothing", async () => {
  const out = await call(routeFor(() => ({ async view() { throw new Error("EACCES /secret/path"); } })), url(`strategy=cn-market&run=${RUN}`));
  assert.equal(out.status, 500);
  assert.equal(JSON.stringify(out.body).includes("secret"), false);
});

test("GET /data/lunhui/view: a sealed run answers 200 with its view, modules split on commas", async () => {
  const seen: unknown[] = [];
  const view = { run: RUN, modules: [] };
  const route = routeFor(() => ({ async view(...args: unknown[]) { seen.push(args); return view; } }));
  const out = await call(route, url(`strategy=cn-market&run=${RUN}&modules=environment,counterevidence`));
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { ok: true, view });
  assert.deepEqual(seen, [["cn-market", RUN, { modules: ["environment", "counterevidence"] }]]);

  seen.length = 0;
  const all = await call(route, url(`strategy=cn-market&run=${RUN}`));
  assert.equal(all.status, 200);
  assert.deepEqual(seen, [["cn-market", RUN, {}]], "no modules parameter passes no modules");
});
