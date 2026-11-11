// face/tests/analog-view-route.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { WebRoute } from "@deepseek-ai/dsh-host-webserver";
import { isTrustedDataRequest } from "../src/http.ts";
import { ANALOG_VIEW_ID_RE, registerAnalogViewRoute, type AnalogViewService } from "../src/analog-view.ts";
import { VIEW_ID_RE } from "../plugins/analog/lib/views.mjs";
import { refuse } from "../plugins/analog/lib/errors.mjs";

const ID = "an-20261110-0a1b2c3d";
function routeFor(views: () => AnalogViewService | undefined): WebRoute {
  const routes: WebRoute[] = [];
  registerAnalogViewRoute({ register: (route) => routes.push(route) }, { isTrusted: isTrustedDataRequest, views });
  assert.deepEqual(routes.map((r) => [r.kind, r.path]), [["exact", "/data/analog/view"]]);
  return routes[0]!;
}
async function call(route: WebRoute, url: string, init: { method?: string; host?: string } = {}): Promise<{ status: number; body: any }> {
  const out = { status: 0, body: "" };
  const res = { writeHead(status: number) { out.status = status; return res; }, end(chunk?: string) { out.body = String(chunk ?? ""); return res; } };
  await route.handler({ url, method: init.method ?? "GET", headers: { host: init.host ?? "127.0.0.1:3090" } } as IncomingMessage, res as unknown as ServerResponse);
  return { status: out.status, body: JSON.parse(out.body) };
}
const held = (views: Record<string, unknown>): AnalogViewService => ({
  async readView(id) { if (!(id in views)) throw refuse.noSuchView(); return views[id]; },
});

test("the id pattern is the plugin's", () => assert.equal(ANALOG_VIEW_ID_RE.source, VIEW_ID_RE.source));

test("a stored view is served by its id", async () => {
  const route = routeFor(() => held({ [ID]: { kind: "chart", id: ID } }));
  assert.deepEqual(await call(route, `/data/analog/view?id=${ID}`), { status: 200, body: { ok: true, view: { kind: "chart", id: ID } } });
});

test("what the route refuses, in fixed words", async () => {
  const route = routeFor(() => held({}));
  assert.deepEqual(await call(route, `/data/analog/view?id=${ID}`), { status: 404, body: { ok: false, error: "no such view" } });
  for (const url of ["/data/analog/view", `/data/analog/view?id=${ID}&id=${ID}`]) assert.deepEqual(await call(route, url), { status: 400, body: { ok: false, error: "id is required once" } });
  for (const bad of ["an-1", "..%2Fx", "an-20261110-0A1B2C3D"]) assert.deepEqual(await call(route, `/data/analog/view?id=${bad}`), { status: 400, body: { ok: false, error: "bad view id" } });
  assert.equal((await call(route, `/data/analog/view?id=${ID}`, { method: "POST" })).status, 405);
  assert.equal((await call(route, `/data/analog/view?id=${ID}`, { host: "evil.example" })).status, 403);
  assert.deepEqual(await call(routeFor(() => undefined), `/data/analog/view?id=${ID}`), { status: 503, body: { ok: false, error: "analog not mounted" } });
  const broken = routeFor(() => ({ async readView() { throw new Error("disk /secret/path"); } }));
  assert.deepEqual(await call(broken, `/data/analog/view?id=${ID}`), { status: 500, body: { ok: false, error: "view failed" } });
});
