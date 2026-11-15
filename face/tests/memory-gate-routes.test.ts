/** src/memory-gate-routes.ts: the memory gate's two routes - the kept view of an order card's check, and the owner's
 * override of its red line - on a stub gate and the route recorder: every answer by its status, the fence, and no
 * echo of what the caller sent. */
import test from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import type { GateView, MemoryGate } from "../src/memory-gate.ts";
import { registerMemoryGateRoutes } from "../src/memory-gate-routes.ts";
import { recorder } from "./route-recorder.ts";

const VIEW: GateView = { callId: "call_1", state: "checked", lines: [], redLine: true, overridden: false };

/** A stub gate: `view` knows `call_1` alone; `override` answers `answer` and records what it was given. */
function stubGate(answer: ReturnType<MemoryGate["override"]> = "kept") {
  const overrides: Array<[string, unknown]> = [];
  const gate: MemoryGate = {
    check: async () => undefined,
    view: (callId) => (callId === "call_1" ? structuredClone(VIEW) : undefined),
    override: (callId, body) => { overrides.push([callId, body]); return answer; },
    redLineReason: () => undefined,
    answered: () => {},
    settled: () => {},
    idle: async () => {},
    dispose: () => {},
  };
  return { gate, overrides };
}

/** The routes over `gate`, with a fence that refuses one Host. */
function routes(gate: MemoryGate | undefined) {
  const rec = recorder();
  const isTrusted = (req: IncomingMessage): boolean => req.headers.host !== "evil.example.com";
  registerMemoryGateRoutes(rec, { gate: () => gate, isTrusted });
  const call = async (path: string, options: Parameters<typeof rec.call>[1] = {}) =>
    JSON.parse(await rec.call(path, options)) as { status: number; body: Record<string, unknown> };
  return { rec, call };
}

const post = (json: unknown) => ({ method: "POST", json });

test("the two paths, in order", () => {
  assert.deepEqual(routes(stubGate().gate).rec.paths(), ["/data/memory/gate", "/data/memory/gate/override"]);
});

test("GET /data/memory/gate: the kept view; a bad callId 400; an unknown one 404; the fence 403; no gate 404", async () => {
  const { call } = routes(stubGate().gate);
  assert.deepEqual(await call("/data/memory/gate?callId=call_1"), { status: 200, body: { ok: true, gate: VIEW } });
  const bad = await call("/data/memory/gate?callId=call%201");
  assert.equal(bad.status, 400);
  assert.doesNotMatch(JSON.stringify(bad.body), /call 1|call%201/, "nothing the caller sent is echoed");
  assert.equal((await call("/data/memory/gate")).status, 400);
  assert.equal((await call("/data/memory/gate?callId=a&callId=b")).status, 400);
  assert.equal((await call(`/data/memory/gate?callId=${"x".repeat(129)}`)).status, 400);
  const unknown = await call("/data/memory/gate?callId=call_9");
  assert.equal(unknown.status, 404);
  assert.doesNotMatch(JSON.stringify(unknown.body), /call_9/);
  assert.equal((await call("/data/memory/gate?callId=call_1", { host: "evil.example.com" })).status, 403);
  assert.equal((await routes(undefined).call("/data/memory/gate?callId=call_1")).status, 404);
});

test("POST /data/memory/gate/override: kept, the reason trimmed; wrongIf optional", async () => {
  const { gate, overrides } = stubGate();
  const { call } = routes(gate);
  assert.deepEqual(await call("/data/memory/gate/override", post({ callId: "call_1", reason: "  Earnings are out and the gap filled.  " })),
    { status: 200, body: { ok: true } });
  assert.deepEqual(await call("/data/memory/gate/override", post({ callId: "call_1", reason: "r".repeat(500), wrongIf: " it gaps down " })),
    { status: 200, body: { ok: true } });
  assert.deepEqual(overrides, [
    ["call_1", { reason: "Earnings are out and the gap filled." }],
    ["call_1", { reason: "r".repeat(500), wrongIf: "it gaps down" }],
  ]);
});

test("POST /data/memory/gate/override: every refusal by its status, and the gate never asked", async () => {
  const { gate, overrides } = stubGate();
  const { call } = routes(gate);
  for (const [body, label] of [
    [{ callId: "call_1" }, "no reason"],
    [{ callId: "call_1", reason: "   " }, "an empty reason"],
    [{ callId: "call_1", reason: 7 }, "a reason not a string"],
    [{ callId: "call_1", reason: "r".repeat(501) }, "a reason of 501 characters"],
    [{ callId: "call_1", reason: "why", wrongIf: 3 }, "a wrongIf not a string"],
    [{ callId: "call_1", reason: "why", wrongIf: null }, "a wrongIf of null"],
    [{ callId: "call_1", reason: "why", wrongIf: "w".repeat(501) }, "a wrongIf of 501 characters"],
    [{ callId: "call 1", reason: "why" }, "a callId with a space"],
    [{ reason: "why" }, "no callId"],
  ] as const) {
    const answer = await call("/data/memory/gate/override", post(body));
    assert.equal(answer.status, 400, label);
    assert.doesNotMatch(JSON.stringify(answer.body), /call 1|rrrrr|wwwww/, `${label}: nothing echoed`);
  }
  assert.deepEqual(overrides, []);
  assert.equal((await call("/data/memory/gate/override", { ...post({ callId: "call_1", reason: "why" }), host: "evil.example.com" })).status, 403);
  assert.equal((await call("/data/memory/gate/override", { method: "POST", body: "{}", headers: { "content-type": "text/plain" } })).status, 415);
  assert.deepEqual(overrides, []);
});

test("POST /data/memory/gate/override: no such card 404, no red line and answered 409, no gate 404", async () => {
  const body = post({ callId: "call_1", reason: "why" });
  assert.equal((await routes(stubGate("no such card").gate).call("/data/memory/gate/override", body)).status, 404);
  assert.equal((await routes(stubGate("no red line").gate).call("/data/memory/gate/override", body)).status, 409);
  assert.equal((await routes(stubGate("answered").gate).call("/data/memory/gate/override", body)).status, 409);
  assert.equal((await routes(undefined).call("/data/memory/gate/override", body)).status, 404);
});
