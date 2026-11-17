/** src/memory-screen-routes.ts: the memory screen's four GET routes on a stub screen and the route recorder - each
 * answer from its read, the fence, the method, the decisions' parameters checked, a fault and a late read as fixed
 * refusals with one log line, no screen bound, and no echo of what the caller sent. */
import test from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { ScreenFault, type MemoryScreen } from "../src/memory-screen.ts";
import { registerMemoryScreenRoutes } from "../src/memory-screen-routes.ts";
import { recorder } from "./route-recorder.ts";

const LESSONS = { connected: true as const, ownerChainBroken: false, lessons: [] };
const DECISIONS = { connected: true as const, items: [], more: false };
const WAITING = { connected: true as const, proposals: [], pastHorizon: [], withoutWrongIf: 0, command: "npx --no gravit-memory review --home /h" };
const HEALTH = { connected: true as const, home: "/h", lines: {}, partial: [], chains: [], prices: { url: "u" }, facts: [], commands: [] };

/** A stub screen answering the fixtures, or rejecting every read with `fail`; the decisions' filters recorded. */
function stubScreen(fail?: unknown) {
  const filters: unknown[] = [];
  const answer = <T>(value: T) => (fail === undefined ? Promise.resolve(value) : Promise.reject(fail));
  const screen = {
    lessons: () => answer(LESSONS),
    decisions: (filter: unknown) => { filters.push(filter); return answer(DECISIONS); },
    waiting: () => answer(WAITING),
    health: () => answer(HEALTH),
  } as unknown as MemoryScreen;
  return { screen, filters };
}

/** The routes over `screen`, with a fence that refuses one Host, and the lines logged. */
function routes(screen: MemoryScreen | undefined) {
  const rec = recorder();
  const lines: string[] = [];
  const isTrusted = (req: IncomingMessage): boolean => req.headers.host !== "evil.example.com";
  registerMemoryScreenRoutes(rec, { screen: () => screen, log: (line) => { lines.push(line); }, isTrusted });
  const call = async (path: string, options: Parameters<typeof rec.call>[1] = {}) =>
    JSON.parse(await rec.call(path, options)) as { status: number; body: Record<string, unknown> };
  return { rec, call, lines };
}

const PATHS = ["/data/memory/lessons", "/data/memory/decisions", "/data/memory/review", "/data/memory/status"];

test("the four paths, in order", () => {
  assert.deepEqual(routes(stubScreen().screen).rec.paths(), PATHS);
});

test("each route answers { ok: true, ... } from its read", async () => {
  const { call } = routes(stubScreen().screen);
  assert.deepEqual(await call("/data/memory/lessons"), { status: 200, body: { ok: true, ...LESSONS } });
  assert.deepEqual(await call("/data/memory/decisions"), { status: 200, body: { ok: true, ...DECISIONS } });
  assert.deepEqual(await call("/data/memory/review"), { status: 200, body: { ok: true, ...WAITING } });
  assert.deepEqual(await call("/data/memory/status"), { status: 200, body: { ok: true, ...HEALTH } });
});

test("not connected is answered as a state, with ok true", async () => {
  const off = { connected: false, why: "no home", say: "no memory here: run gravit-memory init", command: "npx --no gravit-memory init --home /h" };
  const screen = { lessons: async () => off } as unknown as MemoryScreen;
  assert.deepEqual(await routes(screen).call("/data/memory/lessons"), { status: 200, body: { ok: true, ...off } });
});

test("decisions: the filter from the query, each key only when given", async () => {
  const { screen, filters } = stubScreen();
  const { call } = routes(screen);
  assert.equal((await call("/data/memory/decisions?symbol=NVDA&limit=5")).status, 200);
  assert.equal((await call("/data/memory/decisions?before=d-20260302-0f3a9c21&limit=200")).status, 200);
  assert.equal((await call("/data/memory/decisions?limit=1")).status, 200);
  assert.equal((await call("/data/memory/decisions")).status, 200);
  assert.deepEqual(filters, [{ symbol: "NVDA", limit: 5 }, { before: "d-20260302-0f3a9c21", limit: 200 }, { limit: 1 }, {}]);
});

test("decisions: a limit out of 1 to 200 or not a number, a before or a symbol off its shape, a repeat or an unknown parameter is 400", async () => {
  const { screen, filters } = stubScreen();
  const { call } = routes(screen);
  const bad = [
    "limit=0", "limit=201", "limit=x", "limit=", "limit=05x", "limit=1.5", "limit=-1",
    "before=d-2026-0f3a9c21", "before=p-20260302-0f3a9c21", "before=", "symbol=NV%20DA", "symbol=", "symbol=%3Cscript%3E",
    "symbol=NVDA&symbol=AMD", "secret=planted-words", "limit=5&echo=planted-words", "symbol=%zz",
  ];
  for (const query of bad) {
    const answer = await call(`/data/memory/decisions?${query}`);
    assert.equal(answer.status, 400, query);
    assert.doesNotMatch(JSON.stringify(answer.body), /planted|script|NV DA|NV%20DA|0f3a9c21|%zz|AMD/, `${query}: nothing echoed`);
  }
  assert.deepEqual(filters, [], "no bad request reads the memory");
});

test("the other three routes take no parameter", async () => {
  const { call } = routes(stubScreen().screen);
  for (const path of ["/data/memory/lessons", "/data/memory/review", "/data/memory/status"]) {
    const answer = await call(`${path}?planted=words`);
    assert.equal(answer.status, 400, path);
    assert.doesNotMatch(JSON.stringify(answer.body), /planted|words/);
  }
});

test("the fence refuses with 403; a method other than GET is 405", async () => {
  const { call } = routes(stubScreen().screen);
  for (const path of PATHS) {
    assert.equal((await call(path, { host: "evil.example.com" })).status, 403, path);
    assert.equal((await call(path, { method: "POST", json: {} })).status, 405, path);
  }
});

test("a ScreenFault of fault is 502 with one log line in memoryFaultWords' words; of late, 504", async () => {
  const cause = Object.assign(new Error("owner.jsonl\nis not readable"), { code: "E_IO" });
  const faulted = routes(stubScreen(new ScreenFault("fault", cause)).screen);
  for (const path of PATHS) {
    assert.deepEqual(await faulted.call(path), { status: 502, body: { ok: false, error: "the memory could not be read" } }, path);
  }
  assert.equal(faulted.lines.length, PATHS.length, "one line a refusal");
  for (const line of faulted.lines) assert.match(line, /owner\.jsonl is not readable/);

  const late = routes(stubScreen(new ScreenFault("late")).screen);
  for (const path of PATHS) {
    assert.deepEqual(await late.call(path), { status: 504, body: { ok: false, error: "the memory did not answer in time" } }, path);
  }
  assert.equal(late.lines.length, PATHS.length);
});

test("anything else thrown is a 500 with a fixed word; no screen bound is 503", async () => {
  const thrown = routes(stubScreen(new Error("planted words")).screen);
  const answer = await thrown.call("/data/memory/lessons");
  assert.equal(answer.status, 500);
  assert.doesNotMatch(JSON.stringify(answer.body), /planted/);
  const none = await routes(undefined).call("/data/memory/lessons");
  assert.equal(none.status, 503);
  assert.equal(none.body.ok, false);
});
