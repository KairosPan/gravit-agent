import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerRosterRoutes } from "../src/roster-routes.ts";
import { ensureRoster, readRoster } from "../src/roster.ts";
import { recorder } from "./route-recorder.ts";

async function mounted(seed?: readonly string[]): Promise<{ home: string; routes: ReturnType<typeof recorder> }> {
  const home = await mkdtemp(join(tmpdir(), "face-roster-routes-"));
  if (seed !== undefined) await ensureRoster(home, seed);
  const routes = recorder();
  registerRosterRoutes(routes, { home });
  return { home, routes };
}

const answer = (text: string): { status: number; body: Record<string, unknown> } => JSON.parse(text);

test("the routes are the two the plan names", async () => {
  const { routes } = await mounted();
  assert.deepEqual(routes.paths(), ["/data/roster.json", "/data/roster"]);
});

test("GET /data/roster.json answers the roster", async () => {
  const { routes } = await mounted(["claude", "codex"]);
  assert.deepEqual(answer(await routes.call("/data/roster.json")), {
    status: 200, body: { ok: true, agents: ["claude", "codex"], bots: [] },
  });
});

test("GET /data/roster.json says a file it cannot read is corrupt", async () => {
  const { home, routes } = await mounted();
  await mkdir(join(home, "face"), { recursive: true });
  await writeFile(join(home, "face", "channels.json"), JSON.stringify({ version: 3, agents: [], bots: [] }));
  assert.deepEqual(answer(await routes.call("/data/roster.json")).body, { ok: false, corrupt: true });
});

test("GET /data/roster.json refuses an untrusted request", async () => {
  const { routes } = await mounted(["claude"]);
  assert.equal(answer(await routes.call("/data/roster.json", { host: "evil.example" })).status, 403);
  assert.equal(answer(await routes.call("/data/roster.json", { headers: { "sec-fetch-site": "cross-site" } })).status, 403);
});

test("POST /data/roster switches, logs through logAvailable and answers the new roster", async () => {
  const { home, routes } = await mounted(["claude"]);
  assert.deepEqual(answer(await routes.call("/data/roster", { method: "POST", json: { kind: "bot", id: "drill-bull", on: true } })), {
    status: 200, body: { ok: true, agents: ["claude"], bots: ["drill-bull"] },
  });
  assert.deepEqual(answer(await routes.call("/data/roster", { method: "POST", json: { kind: "agent", id: "claude", on: false } })), {
    status: 200, body: { ok: true, agents: [], bots: ["drill-bull"] },
  });
  assert.deepEqual((await readRoster(home)).roster, { agents: [], bots: ["drill-bull"] });
  const log = (await readFile(join(home, "face", "roster.log"), "utf8")).trim().split("\n");
  assert.equal(log.length, 2);
  assert.match(log[0]!, / available bot drill-bull = on$/);
  assert.match(log[1]!, / available agent claude = off$/);
});

test("POST /data/roster refuses an untrusted request and a non-JSON body, writing nothing", async () => {
  const { home, routes } = await mounted(["claude"]);
  const json = { kind: "agent", id: "codex", on: true };
  assert.equal(answer(await routes.call("/data/roster", { method: "POST", json, host: "evil.example" })).status, 403);
  assert.equal(answer(await routes.call("/data/roster", {
    method: "POST", json, headers: { origin: "http://evil.example" },
  })).status, 403);
  assert.equal(answer(await routes.call("/data/roster", { method: "GET" })).status, 405);
  assert.equal(answer(await routes.call("/data/roster", {
    method: "POST", body: JSON.stringify(json), headers: { "content-type": "text/plain" },
  })).status, 415);
  assert.equal(answer(await routes.call("/data/roster", {
    method: "POST", body: "{not json", headers: { "content-type": "application/json" },
  })).status, 400);
  assert.deepEqual((await readRoster(home)).roster, { agents: ["claude"], bots: [] });
});

test("POST /data/roster refuses a bad kind, id or on with 400", async () => {
  const { home, routes } = await mounted(["claude"]);
  const bad: unknown[] = [
    { kind: "role", id: "codex", on: true },
    { id: "codex", on: true },
    { kind: "agent", id: "", on: true },
    { kind: "agent", id: "x".repeat(65), on: true },
    { kind: "agent", id: 7, on: true },
    { kind: "agent", id: "codex", on: "true" },
    { kind: "agent", id: "codex" },
    { kind: "bot", id: "gravit", on: true },
  ];
  for (const json of bad) {
    assert.equal(answer(await routes.call("/data/roster", { method: "POST", json })).status, 400, JSON.stringify(json));
  }
  assert.deepEqual((await readRoster(home)).roster, { agents: ["claude"], bots: [] });
  assert.equal(answer(await routes.call("/data/roster", {
    method: "POST", json: { kind: "agent", id: "x".repeat(64), on: true },
  })).status, 200, "64 characters is the longest id taken");
});

test("POST /data/roster over a corrupt or absent file is a 409 naming the file", async () => {
  const { home, routes } = await mounted();
  const reply = answer(await routes.call("/data/roster", { method: "POST", json: { kind: "agent", id: "codex", on: true } }));
  assert.equal(reply.status, 409);
  assert.ok(String(reply.body.error).includes(join(home, "face", "channels.json")));
});
