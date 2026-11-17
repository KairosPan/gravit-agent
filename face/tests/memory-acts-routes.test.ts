/** src/memory-acts-routes.ts: the two POST routes of the owner's acts on the memory on stub acts and the route
 * recorder - each body handed to its method and its answer sent with its status, the fence, the method, the body's
 * media type, shape and size refused before a method runs, no acts bound, a method that throws, and no echo of what
 * the caller sent or of what was thrown. */
import test from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import type { MemoryActs } from "../src/memory-acts.ts";
import { registerMemoryActsRoutes } from "../src/memory-acts-routes.ts";
import { recorder } from "./route-recorder.ts";

const PREPARE = "/data/memory/prepare";
const ACT = "/data/memory/act";

const PREPARED = {
  ok: true as const,
  show: { kind: "card" as const, lesson: "gap-fill", state: "proposed", text: "Wait for the gap to fill." },
  draft: { type: "attest" as const, service: "gravit-memory", act: "arm" as const, subject: "gap-fill", digest: "a".repeat(64) },
};
const PERFORMED = { ok: true as const, act: "arm" as const, subject: "gap-fill", sha256: "b".repeat(64) };

type Answer = Awaited<ReturnType<MemoryActs["prepare"]>> | Awaited<ReturnType<MemoryActs["perform"]>>;

/** Stub acts: each method records the body it was given and answers `answer`, or throws `thrown` when one is set. */
function stubActs(answers: { prepare?: Answer; perform?: Answer } = {}, thrown?: unknown) {
  const calls: Array<[string, unknown]> = [];
  const run = (name: string, answer: Answer) => async (body: unknown) => {
    calls.push([name, body]);
    if (thrown !== undefined) throw thrown;
    return answer;
  };
  const acts = {
    prepare: run("prepare", answers.prepare ?? PREPARED),
    perform: run("perform", answers.perform ?? PERFORMED),
  } as unknown as MemoryActs;
  return { acts, calls };
}

/** The routes over `acts`, with a fence that refuses one Host, and the lines logged. */
function routes(acts: MemoryActs | undefined) {
  const rec = recorder();
  const lines: string[] = [];
  const isTrusted = (req: IncomingMessage): boolean => req.headers.host !== "evil.example.com";
  registerMemoryActsRoutes(rec, { acts: () => acts, isTrusted, log: (line) => { lines.push(line); } });
  const call = async (path: string, options: Parameters<typeof rec.call>[1] = {}) =>
    JSON.parse(await rec.call(path, options)) as { status: number; body: Record<string, unknown> };
  return { rec, call, lines };
}

const post = (json: unknown) => ({ method: "POST", json });

test("the two paths, in order", () => {
  assert.deepEqual(routes(stubActs().acts).rec.paths(), [PREPARE, ACT]);
});

test("each route hands its parsed body to its method and answers its success with 200", async () => {
  const { acts, calls } = stubActs();
  const { call } = routes(acts);
  const asked = { act: "arm", subject: "gap-fill" };
  assert.deepEqual(await call(PREPARE, post(asked)), { status: 200, body: PREPARED });
  const signed = { act: "arm", subject: "gap-fill", envelope: { action: { type: "attest" }, nonce: "n", signature: "s" } };
  assert.deepEqual(await call(ACT, post(signed)), { status: 200, body: PERFORMED });
  assert.deepEqual(calls, [["prepare", asked], ["perform", signed]]);
});

test("a method's refusal is answered with its own status and sentence, and the Account's refusal passed on", async () => {
  for (const status of [400, 401, 404, 409, 502, 503, 504] as const) {
    const refused = { ok: false as const, status, error: "this was done already" };
    const { call } = routes(stubActs({ prepare: refused, perform: refused }).acts);
    assert.deepEqual(await call(PREPARE, post({})), { status, body: { ok: false, error: "this was done already" } }, `prepare ${status}`);
    assert.deepEqual(await call(ACT, post({})), { status, body: { ok: false, error: "this was done already" } }, `act ${status}`);
  }
  const refusal = { kind: "owner", reason: "this device is not one of the owner's" };
  const { call } = routes(stubActs({ perform: { ok: false, status: 401, error: "the Account refused it: nothing was done", refusal } }).acts);
  assert.deepEqual(await call(ACT, post({})),
    { status: 401, body: { ok: false, error: "the Account refused it: nothing was done", refusal } });
  const changed = routes(stubActs({ perform: { ok: false, status: 409, error: "it changed while it was shown: nothing was done", changed: true } }).acts);
  assert.deepEqual(await changed.call(ACT, post({})),
    { status: 409, body: { ok: false, error: "it changed while it was shown: nothing was done", changed: true } }, "a refusal for content found changed carries changed: true");
});

test("a request the fence refuses is 403 and no method is called", async () => {
  const { acts, calls } = stubActs();
  const { call } = routes(acts);
  for (const path of [PREPARE, ACT]) {
    const answer = await call(path, { ...post({ act: "arm" }), host: "evil.example.com" });
    assert.deepEqual(answer, { status: 403, body: { ok: false, error: "forbidden" } });
  }
  assert.deepEqual(calls, []);
});

test("a method other than POST is 405 and no method is called", async () => {
  const { acts, calls } = stubActs();
  const { call } = routes(acts);
  for (const path of [PREPARE, ACT]) {
    assert.equal((await call(path)).status, 405);
    assert.equal((await call(path, { method: "PUT", json: {} })).status, 405);
  }
  assert.deepEqual(calls, []);
});

test("a body not JSON, not an object, of another media type or over 8,192 bytes is refused before the method", async () => {
  const { acts, calls } = stubActs();
  const { call } = routes(acts);
  for (const path of [PREPARE, ACT]) {
    for (const [body, label] of [["{not json", "not JSON"], ["[1,2]", "an array"], ["null", "null"], ["7", "a number"], ['"arm"', "a string"]] as const) {
      const answer = await call(path, { method: "POST", body, headers: { "content-type": "application/json" } });
      assert.equal(answer.status, 400, `${path}: ${label}`);
      assert.doesNotMatch(JSON.stringify(answer.body), /not json|arm/, `${path}: ${label}: nothing echoed`);
    }
    assert.equal((await call(path, { method: "POST", body: "{}", headers: { "content-type": "text/plain" } })).status, 415);
    const words = "w".repeat(8_192 - JSON.stringify({ words: "" }).length);
    assert.equal(Buffer.byteLength(JSON.stringify({ words })), 8_192);
    assert.equal((await call(path, post({ words }))).status, 200, `${path}: 8,192 bytes is taken`);
    const over = await call(path, post({ words: `${words}w` }));
    assert.equal(over.status, 413, `${path}: 8,193 bytes`);
    assert.doesNotMatch(JSON.stringify(over.body), /wwww/);
  }
  assert.deepEqual(calls.map(([name]) => name), ["prepare", "perform"], "only the two bodies of 8,192 bytes reached a method");
});

test("no acts bound is 503 on both routes", async () => {
  const { call } = routes(undefined);
  for (const path of [PREPARE, ACT]) {
    const answer = await call(path, post({ act: "arm", subject: "gap-fill" }));
    assert.equal(answer.status, 503);
    assert.deepEqual(answer.body, { ok: false, error: "the memory's acts are not ready" });
  }
});

test("a method that throws is 500 'the act failed', nothing of the throw echoed, and one line logged", async () => {
  const { acts } = stubActs({}, new Error("secret-detail at /Users/x"));
  const { call, lines } = routes(acts);
  for (const path of [PREPARE, ACT]) {
    const answer = await call(path, post({ act: "arm", subject: "planted-subject" }));
    assert.deepEqual(answer, { status: 500, body: { ok: false, error: "the act failed" } });
    assert.doesNotMatch(JSON.stringify(answer.body), /secret-detail|planted-subject/);
  }
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^memory acts: \/data\/memory\/prepare - the act failed: /);
  assert.match(lines[1], /^memory acts: \/data\/memory\/act - the act failed: /);
  for (const line of lines) assert.doesNotMatch(line, /planted-subject/, "the caller's body is not logged");
});
