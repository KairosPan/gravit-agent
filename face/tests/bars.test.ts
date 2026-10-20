/** `GET /data/bars` (bars.ts): daily bars for one us id, through the /data fence, a checked argv and a
 * per-key cache. The spawner is injected, so no Python process runs here. */
import test from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { WebRoute } from "@deepseek-ai/dsh-host-webserver";
import { BARS_CACHE_LIMIT, BARS_TIMEOUT_MS, BARS_TTL_MS, parseBarsRequest, registerBarsRoute } from "../src/bars.ts";
import { isTrustedDataRequest, registerDataRoutes, type Spawner } from "../src/data.ts";

function fakeRes(): { out: { status: number; body: string }; res: ServerResponse } {
  const out = { status: 0, body: "" };
  const res = {
    writeHead(status: number) { out.status = status; return res; },
    end(body?: string | Buffer) { out.body = String(body ?? ""); return res; },
  };
  return { out, res: res as unknown as ServerResponse };
}

const HOST = "127.0.0.1:3090";
/** A request as the browser sends it: these handlers read the url, the method and the Host. */
const req = (url: string, method = "GET", host: string | null = HOST): IncomingMessage =>
  ({ url, method, headers: host === null ? {} : { host } }) as unknown as IncomingMessage;

async function hit(route: WebRoute, r: IncomingMessage): Promise<{ status: number; body: string }> {
  const { out, res } = fakeRes();
  await route.handler(r, res);
  return out;
}

/** A spawner that records every argv and answers from `reply`. */
function recorder(reply: (argv: string[]) => Promise<{ stdout: string; code: number }>) {
  const calls: Array<{ argv: string[]; timeoutMs: number }> = [];
  const spawn: Spawner = (argv, timeoutMs) => {
    calls.push({ argv, timeoutMs });
    return reply(argv);
  };
  return { calls, spawn };
}

const good = (symbol: string, days: string): string =>
  JSON.stringify({ ok: true, id: `us:${symbol}`, symbol, source: "alpaca", feed: "iex", as_of: "2026-10-19", rows: [], days });

function barsRoute(spawn: Spawner, now: () => number = () => 0): WebRoute {
  const routes: WebRoute[] = [];
  registerBarsRoute({ register: (route) => routes.push(route) }, { isTrusted: isTrustedDataRequest, spawn, script: "/repo/scripts/face_bars.py", now });
  return routes[0]!;
}

test("a valid us id and day count spawn face_bars.py with exactly the script, the symbol and the days", async () => {
  const { calls, spawn } = recorder(async (argv) => ({ stdout: good(argv[1]!, argv[2]!), code: 0 }));
  const routes: WebRoute[] = [];
  registerDataRoutes({ register: (route) => routes.push(route) }, { spawn, now: () => 0 });
  const bars = routes.find((route) => route.path === "/data/bars")!;
  const out = await hit(bars, req("/data/bars?id=us:AAPL&days=60"));
  assert.equal(out.status, 200);
  assert.equal(calls.length, 1);
  assert.ok(calls[0]!.argv[0]!.endsWith("scripts/face_bars.py"), calls[0]!.argv[0]);
  assert.deepEqual(calls[0]!.argv.slice(1), ["AAPL", "60"]);
  assert.equal(calls[0]!.timeoutMs, BARS_TIMEOUT_MS);
  assert.equal(BARS_TIMEOUT_MS, 30_000);
  await hit(bars, req("/data/bars?id=us%3ABRK.B"));
  assert.deepEqual(calls[1]!.argv.slice(1), ["BRK.B", "120"], "days defaults to 120");
});

test("anything else is a 400 and never spawns", async () => {
  const { calls, spawn } = recorder(async () => ({ stdout: "{}", code: 0 }));
  const route = barsRoute(spawn);
  const urls = [
    "/data/bars", "/data/bars?id=us:AAPL&id=us:MSFT", "/data/bars?id=us:aapl", "/data/bars?id=cn:600519",
    "/data/bars?id=crypto:BTC%2FUSD", "/data/bars?id=us:A;rm", "/data/bars?id=us:-X", "/data/bars?id=us:AAPL&days=4",
    "/data/bars?id=us:AAPL&days=731", "/data/bars?id=us:AAPL&days=1.5", "/data/bars?id=us:AAPL&days=abc",
    "/data/bars?id=us:AAPL&days=60&days=90", "/data/bars?id=%ZZ", `/data/bars?id=us:AAPL&x=${"a".repeat(2049)}`,
  ];
  for (const url of urls) {
    const out = await hit(route, req(url));
    assert.equal(out.status, 400, url);
    assert.deepEqual(JSON.parse(out.body), { ok: false, error: "invalid bars request" }, url);
  }
  assert.equal(calls.length, 0);
  assert.deepEqual(parseBarsRequest("/data/bars?id=us:AAPL&days=730"), { symbol: "AAPL", days: 730 });
  assert.deepEqual(parseBarsRequest("/data/bars?id=us:AAPL&days=5"), { symbol: "AAPL", days: 5 });
});

test("GET only, and the fence before anything", async () => {
  const { calls, spawn } = recorder(async () => ({ stdout: "{}", code: 0 }));
  const route = barsRoute(spawn);
  assert.equal((await hit(route, req("/data/bars?id=us:AAPL", "POST"))).status, 405);
  const forged = await hit(route, req("/data/bars?id=us:AAPL", "GET", "evil.example:3090"));
  assert.equal(forged.status, 403);
  assert.equal(forged.body, '{"ok":false,"error":"forbidden"}');
  assert.equal((await hit(route, req("/data/bars?id=us:AAPL", "POST", "evil.example:3090"))).status, 403, "the fence answers before the method check");
  assert.equal((await hit(route, req("/data/bars?id=us:AAPL", "GET", null))).status, 403);
  assert.equal(calls.length, 0);
});

test("one cache entry per symbol and day count, fresh for ten minutes, one flight per key", async () => {
  let clock = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const { calls, spawn } = recorder(async (argv) => {
    await gate;
    return { stdout: good(argv[1]!, argv[2]!), code: 0 };
  });
  const route = barsRoute(spawn, () => clock);
  const pending = [
    hit(route, req("/data/bars?id=us:AAPL&days=60")), hit(route, req("/data/bars?id=us:AAPL&days=60")),
    hit(route, req("/data/bars?id=us:MSFT&days=60")), hit(route, req("/data/bars?id=us:AAPL&days=90")),
  ];
  release();
  const outs = await Promise.all(pending);
  assert.deepEqual(outs.map((out) => out.status), [200, 200, 200, 200]);
  assert.equal(calls.length, 3, "AAPL:60 once for two requests; MSFT:60 and AAPL:90 their own");
  clock = BARS_TTL_MS - 1;
  await hit(route, req("/data/bars?id=us:AAPL&days=60"));
  assert.equal(calls.length, 3, "fresh within ten minutes");
  clock = BARS_TTL_MS;
  await hit(route, req("/data/bars?id=us:AAPL&days=60"));
  assert.equal(calls.length, 4, "read again once the ten minutes are up");
  assert.equal(BARS_TTL_MS, 600_000);
});

test("a failure after a good read serves the cached body marked stale; with nothing cached the producer's JSON is a 503 and the spawn-failure body carries no error text", async () => {
  let clock = 0;
  let mode: "good" | "fail" | "throw" = "good";
  const { spawn } = recorder(async (argv) => {
    if (mode === "throw") throw Object.assign(new Error("Command failed: SECRETVALUE"), { code: "ENOENT" });
    if (mode === "fail") return { stdout: '{"ok": false, "error": "no bar source"}', code: 1 };
    return { stdout: good(argv[1]!, argv[2]!), code: 0 };
  });
  const route = barsRoute(spawn, () => clock);
  assert.equal((await hit(route, req("/data/bars?id=us:AAPL"))).status, 200);
  clock = BARS_TTL_MS;
  mode = "fail";
  const stale = await hit(route, req("/data/bars?id=us:AAPL"));
  assert.equal(stale.status, 200);
  assert.equal(JSON.parse(stale.body).stale, true);
  mode = "throw";
  assert.equal(JSON.parse((await hit(route, req("/data/bars?id=us:AAPL"))).body).stale, true);
  const thrown = await hit(route, req("/data/bars?id=us:MSFT"));
  assert.equal(thrown.status, 503);
  assert.deepEqual(JSON.parse(thrown.body), { ok: false, error: "producer spawn failed", code: "ENOENT" });
  assert.doesNotMatch(thrown.body, /SECRETVALUE/);
  mode = "fail";
  const failed = await hit(route, req("/data/bars?id=us:NVDA"));
  assert.equal(failed.status, 503);
  assert.deepEqual(JSON.parse(failed.body), { ok: false, error: "no bar source" });
  const silent = recorder(async () => ({ stdout: "", code: 0 }));
  const empty = await hit(barsRoute(silent.spawn), req("/data/bars?id=us:AAPL"));
  assert.equal(empty.status, 503);
  assert.deepEqual(JSON.parse(empty.body), { ok: false, error: "producer failed" });
});

test("at most 64 keys are kept, the least recently used leaving first", async () => {
  const { calls, spawn } = recorder(async (argv) => ({ stdout: good(argv[1]!, argv[2]!), code: 0 }));
  const route = barsRoute(spawn);
  const sym = (i: number): string => `S${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`;
  for (let i = 0; i < BARS_CACHE_LIMIT; i++) await hit(route, req(`/data/bars?id=us:${sym(i)}`));
  assert.equal(calls.length, BARS_CACHE_LIMIT);
  await hit(route, req(`/data/bars?id=us:${sym(0)}`));
  assert.equal(calls.length, BARS_CACHE_LIMIT, "a fresh hit is served from the cache and becomes the most recent");
  await hit(route, req(`/data/bars?id=us:${sym(BARS_CACHE_LIMIT)}`));
  await hit(route, req(`/data/bars?id=us:${sym(0)}`));
  assert.equal(calls.length, BARS_CACHE_LIMIT + 1, "the most recent key stayed");
  await hit(route, req(`/data/bars?id=us:${sym(1)}`));
  assert.equal(calls.length, BARS_CACHE_LIMIT + 2, "the least recently used key left first and is read again");
  assert.equal(BARS_CACHE_LIMIT, 64);
});
