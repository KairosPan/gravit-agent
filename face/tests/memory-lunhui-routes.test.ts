/** src/memory-lunhui-routes.ts: `GET /data/memory/lunhui`, a run's lessons through the store, its query checked and
 * every refusal a fixed text - nothing the caller sent and no error's message is echoed. */
import test from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import type { LunhuiLessons, LunhuiLessonsStore } from "../src/memory-lunhui.ts";
import { registerMemoryLunhuiRoute } from "../src/memory-lunhui-routes.ts";
import { recorder } from "./route-recorder.ts";

const PATH = "/data/memory/lunhui";
const CHECKED: LunhuiLessons = { state: "checked", strategy: "cn-market", run: "run-1", askedAt: "2026-11-16T07:30:00.000Z", leaders: [] };

/** The route over `get`, behind a fence that refuses a request whose host is not the face's own. */
function routeOf(get: LunhuiLessonsStore["get"] | undefined) {
  const r = recorder();
  const calls: Array<[string, string]> = [];
  const store: LunhuiLessonsStore | undefined = get === undefined ? undefined : {
    get: (strategy, run) => { calls.push([strategy, run]); return get(strategy, run); },
  };
  registerMemoryLunhuiRoute(r, {
    store: () => store,
    isTrusted: (req: IncomingMessage) => req.headers.host === "127.0.0.1:3090",
  });
  const call = async (path: string, options: { method?: string; host?: string } = {}) =>
    JSON.parse(await r.call(path, options)) as { status: number; body: unknown };
  return { r, call, calls };
}

const refusing = (code: string, message = "PLANTED-MESSAGE") => async (): Promise<LunhuiLessons> => {
  throw Object.assign(new Error(message), { code });
};

test("the route is registered at its path", () => {
  assert.deepEqual(routeOf(async () => CHECKED).r.paths(), [PATH]);
});

test("a run's lessons: { ok: true, lessons }", async () => {
  const { call, calls } = routeOf(async () => CHECKED);
  assert.deepEqual(await call(`${PATH}?strategy=cn-market&run=run-1`), { status: 200, body: { ok: true, lessons: CHECKED } });
  assert.deepEqual(calls, [["cn-market", "run-1"]]);
});

test("a strategy in another script reaches the store decoded", async () => {
  const { call, calls } = routeOf(async () => CHECKED);
  assert.equal((await call(`${PATH}?strategy=${encodeURIComponent("市场情绪")}&run=run-1`)).status, 200);
  assert.deepEqual(calls, [["市场情绪", "run-1"]]);
});

test("strategy or run missing or given twice, a bad percent or a URL over 8,192 characters: 400, the store not asked", async () => {
  const { call, calls } = routeOf(async () => CHECKED);
  const bad = [
    `${PATH}?run=run-1`, `${PATH}?strategy=cn-market`,
    `${PATH}?strategy=cn-market&strategy=PLANTED&run=run-1`, `${PATH}?strategy=cn-market&run=run-1&run=PLANTED`,
    `${PATH}?strategy=cn-market&run=run-1%zz`,
    `${PATH}?strategy=cn-market&run=run-1&pad=${"x".repeat(8192)}`,
  ];
  for (const path of bad) {
    const { status, body } = await call(path);
    assert.equal(status, 400, path.slice(0, 80));
    assert.ok(!JSON.stringify(body).includes("PLANTED"));
    assert.ok(!JSON.stringify(body).includes("zz"));
  }
  assert.deepEqual(calls, []);
});

test("the runs service's refusals: the view route's fixed texts", async () => {
  const table: Array<[string, number, string]> = [
    ["NOT_A_STRATEGY", 404, "no such strategy"],
    ["NO_SUCH_RUN", 404, "no such run"],
    ["BAD_RUN_ID", 400, "bad run id"],
    ["MISSING_EVIDENCE", 409, "run not sealed"],
    ["NOT_MOUNTED", 503, "lunhui not mounted"],
  ];
  for (const [code, status, error] of table) {
    const { call } = routeOf(refusing(code));
    assert.deepEqual(await call(`${PATH}?strategy=PLANTED&run=PLANTED`), { status, body: { ok: false, error } }, code);
  }
});

test("no store: 503 lunhui not mounted", async () => {
  const { call } = routeOf(undefined);
  assert.deepEqual(await call(`${PATH}?strategy=cn-market&run=run-1`), { status: 503, body: { ok: false, error: "lunhui not mounted" } });
});

test("any other throw: 500 lessons failed, the message not echoed", async () => {
  for (const get of [refusing("EACCES"), refusing("toString"), async (): Promise<LunhuiLessons> => { throw "PLANTED-MESSAGE"; }]) {
    const { call } = routeOf(get);
    assert.deepEqual(await call(`${PATH}?strategy=PLANTED&run=PLANTED`), { status: 500, body: { ok: false, error: "lessons failed" } });
  }
});

test("a method other than GET: 405; a request the fence refuses: 403; neither asks the store", async () => {
  const { call, calls } = routeOf(async () => CHECKED);
  assert.equal((await call(`${PATH}?strategy=cn-market&run=run-1`, { method: "POST" })).status, 405);
  const refused = await call(`${PATH}?strategy=cn-market&run=run-1`, { host: "evil.example:3090" });
  assert.equal(refused.status, 403);
  assert.ok(!JSON.stringify(refused.body).includes("evil"));
  assert.deepEqual(calls, []);
});
