import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { WebRoute } from "@deepseek-ai/dsh-host-webserver";
import { FORBIDDEN, HttpError, fencedGet, fencedPost, isJsonBody, isLoopbackHost, isTrustedDataRequest, isTrustedNavigation, readBody, send } from "../src/http.ts";
import { registerLunhuiViewRoute } from "../src/lunhui-view.ts";
import { recorder } from "./route-recorder.ts";

const FACE = join(dirname(fileURLToPath(import.meta.url)), "..");

function bodyReq(text: string): IncomingMessage {
  return Readable.from([Buffer.from(text)]) as unknown as IncomingMessage;
}

test("readBody returns the whole body under the limit", async () => {
  assert.equal(await readBody(bodyReq('{"name":"x"}')), '{"name":"x"}');
});

test("readBody refuses a body over the limit with a 413 HttpError", async () => {
  await assert.rejects(
    readBody(bodyReq("x".repeat(5000))),
    (err: HttpError) => err instanceof HttpError && err.status === 413,
  );
});

test("readBody honours a caller's own limit", async () => {
  assert.equal(await readBody(bodyReq("abc"), 3), "abc");
  await assert.rejects(readBody(bodyReq("abcd"), 3), (err: HttpError) => err.status === 413);
});

test("FORBIDDEN is fixed text that echoes nothing", () => {
  assert.equal(FORBIDDEN, '{"ok":false,"error":"forbidden"}');
});

test("send writes JSON: the content type, a string body as it is, anything else stringified", () => {
  const out: { status: number; headers: Record<string, string>; body: string }[] = [];
  const res = {
    writeHead(status: number, headers: Record<string, string>) { out.push({ status, headers, body: "" }); return res; },
    end(chunk: string) { out[out.length - 1]!.body = chunk; return res; },
  } as unknown as ServerResponse;
  send(res, 403, FORBIDDEN);
  send(res, 200, { ok: true, n: 1 });
  assert.deepEqual(out, [
    { status: 403, headers: { "content-type": "application/json; charset=utf-8" }, body: FORBIDDEN },
    { status: 200, headers: { "content-type": "application/json; charset=utf-8" }, body: '{"ok":true,"n":1}' },
  ]);
});

test("fencedGet: the fence first, then the read under ok:true; an HttpError answers its status, anything else a fixed 500", async () => {
  const rec = recorder();
  const reads: Record<string, () => Promise<object> | object> = {
    "/refused": () => { throw new Error("read before the fence"); },
    "/ok": async () => ({ a: 1 }),
    "/missing": () => { throw new HttpError(404, "x"); },
    "/broken": () => { throw new Error("EIO: /a/private/path"); },
  };
  for (const [path, read] of Object.entries(reads)) {
    rec.register({ kind: "exact", path, handler: fencedGet(() => path !== "/refused", read) });
  }
  const call = async (path: string): Promise<unknown> => JSON.parse(await rec.call(path));
  assert.deepEqual(await call("/refused"), { status: 403, body: { ok: false, error: "forbidden" } }, "refused before the read runs");
  assert.deepEqual(await call("/ok"), { status: 200, body: { ok: true, a: 1 } });
  assert.deepEqual(await call("/missing"), { status: 404, body: { ok: false, error: "x" } });
  assert.deepEqual(await call("/broken"), { status: 500, body: { ok: false, error: "request failed" } }, "no error text reaches the body");
});

test("fencedPost: the fence, the method and the media type, in that order, each refused before the body is read", async () => {
  const rec = recorder();
  const acted: unknown[] = [];
  rec.register({ kind: "exact", path: "/act", handler: fencedPost((req) => req.headers.host === "127.0.0.1:3090", (body) => { acted.push(body); return { echoed: body }; }) });
  const call = async (options: Parameters<typeof rec.call>[1]): Promise<unknown> => JSON.parse(await rec.call("/act", options));
  assert.deepEqual(await call({ method: "POST", json: { a: 1 }, host: "evil.example.com" }), { status: 403, body: { ok: false, error: "forbidden" } }, "the fence first, with the fixed body");
  assert.deepEqual(await call({ method: "GET" }), { status: 405, body: { ok: false, error: "POST only" } });
  assert.deepEqual(await call({ method: "POST", body: '{"a":1}', headers: { "content-type": "text/plain" } }), { status: 415, body: { ok: false, error: "application/json only" } }, "a cross-site simple POST's media type");
  assert.deepEqual(await call({ method: "POST", body: '{"a":1}' }), { status: 415, body: { ok: false, error: "application/json only" } }, "no content type at all");
  assert.deepEqual(acted, [], "none of them reached the action");
});

test("fencedPost refuses before it reads: a forged Host with an oversized body is a 403, a GET with a body a 405 - never readBody's 413 or 400", async () => {
  const rec = recorder();
  const acted: unknown[] = [];
  rec.register({ kind: "exact", path: "/act", handler: fencedPost((req) => req.headers.host === "127.0.0.1:3090", (body) => { acted.push(body); return {}; }) });
  const json = { "content-type": "application/json" };
  const oversized = "x".repeat(5000);
  assert.deepEqual(JSON.parse(await rec.call("/act", { method: "POST", body: oversized, headers: json, host: "evil.example.com" })),
    { status: 403, body: { ok: false, error: "forbidden" } }, "the fence answers before a byte is read: 403, not 413");
  assert.deepEqual(JSON.parse(await rec.call("/act", { method: "GET", body: oversized, headers: json })),
    { status: 405, body: { ok: false, error: "POST only" } }, "the method answers before a byte is read: 405, not 413");
  assert.deepEqual(JSON.parse(await rec.call("/act", { method: "GET", json: { until: "2h" } })),
    { status: 405, body: { ok: false, error: "POST only" } }, "a GET with a good JSON body is still a 405");
  assert.deepEqual(acted, []);
});

test("fencedPost: a body that is no JSON object is a 400, whatever it is instead", async () => {
  const rec = recorder();
  const acted: unknown[] = [];
  rec.register({ kind: "exact", path: "/act", handler: fencedPost(() => true, (body) => { acted.push(body); return {}; }) });
  const json = { "content-type": "application/json; charset=utf-8" };
  for (const body of ["", "{", "not json", "null", "[]", "[1,2]", "7", '"text"', "true"]) {
    assert.deepEqual(JSON.parse(await rec.call("/act", { method: "POST", body, headers: json })),
      { status: 400, body: { ok: false, error: "body must be a JSON object" } }, JSON.stringify(body));
  }
  assert.deepEqual(acted, []);
  assert.deepEqual(JSON.parse(await rec.call("/act", { method: "POST", body: "x".repeat(5000), headers: json })),
    { status: 413, body: { ok: false, error: "body too large" } }, "readBody's own limit, as its HttpError");
});

test("fencedPost: the action's answer under ok:true; an HttpError answers its status, anything else a fixed 500", async () => {
  const rec = recorder();
  const acts: Record<string, (body: Record<string, unknown>) => Promise<object> | object> = {
    "/ok": async (body) => ({ got: body, n: 1 }),
    "/sync": () => ({ done: true }),
    "/refused": () => { throw new HttpError(400, "until must look like 30m, 2h or 1d"); },
    "/broken": async () => { throw new Error("EACCES: /a/private/path"); },
  };
  for (const [path, act] of Object.entries(acts)) rec.register({ kind: "exact", path, handler: fencedPost(() => true, act) });
  const call = async (path: string, json: unknown = {}): Promise<unknown> => JSON.parse(await rec.call(path, { method: "POST", json }));
  assert.deepEqual(await call("/ok", { until: "2h" }), { status: 200, body: { ok: true, got: { until: "2h" }, n: 1 } }, "the parsed object reaches the action");
  assert.deepEqual(await call("/sync"), { status: 200, body: { ok: true, done: true } });
  assert.deepEqual(await call("/refused"), { status: 400, body: { ok: false, error: "until must look like 30m, 2h or 1d" } });
  assert.deepEqual(await call("/broken"), { status: 500, body: { ok: false, error: "request failed" } }, "no error text reaches the body");
});

/* The DNS-rebinding fence, the same one dsh-client-connection puts in front of
 * `/api` (its `isLoopbackHostname`, lib/index.js:100-104) - and the reason the
 * face binds 127.0.0.1 with an empty `trustedHosts`. A rebound page reaches
 * this socket while its Host header still names the ATTACKER's domain, and
 * `/data/account` (the Account proxy) carries the operator's positions and orders. Host is
 * the one header rebinding cannot forge. */
test("isTrustedDataRequest: the harness's /api fence restated — Host, Sec-Fetch-Site, Origin", () => {
  const req = (headers: Record<string, string>): IncomingMessage => ({ headers }) as unknown as IncomingMessage;
  assert.equal(isTrustedDataRequest(req({ host: "127.0.0.1:3090" })), true, "loopback, no Origin (curl, tests)");
  assert.equal(isTrustedDataRequest(req({ host: "127.0.0.1:3090", origin: "http://127.0.0.1:3090" })), true, "the face's own page");
  assert.equal(isTrustedDataRequest(req({ host: "localhost:3090", origin: "http://localhost:3090", "sec-fetch-site": "same-origin" })), true);
  assert.equal(isTrustedDataRequest(req({ host: "127.0.0.1:3090", origin: "http://evil.example.com" })), false, "a cross-origin page: the browser set the loopback Host itself");
  assert.equal(isTrustedDataRequest(req({ host: "127.0.0.1:3090", origin: "http://127.0.0.1:4000" })), false, "another local dev server is cross-origin too");
  assert.equal(isTrustedDataRequest(req({ host: "127.0.0.1:3090", "sec-fetch-site": "cross-site" })), false, "Fetch-Metadata says cross-site");
  assert.equal(isTrustedDataRequest(req({ host: "127.0.0.1:3090", origin: "not a url" })), false, "an unparsable Origin fails closed");
  assert.equal(isTrustedDataRequest(req({ host: "evil.example.com", origin: "http://evil.example.com" })), false, "a rebound Host fails first");
  assert.equal(isJsonBody(req({ "content-type": "application/json" })), true);
  assert.equal(isJsonBody(req({ "content-type": "Application/JSON; charset=utf-8" })), true);
  assert.equal(isJsonBody(req({ "content-type": "text/plain;charset=UTF-8" })), false, "the media type a no-preflight POST is stuck with");
  assert.equal(isJsonBody(req({})), false);
});

test("isTrustedNavigation: only a GET top-level document on a loopback Host", () => {
  const req = (headers: Record<string, string>, method = "GET"): IncomingMessage => ({ method, headers }) as unknown as IncomingMessage;
  const nav = { host: "127.0.0.1:3090", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" };
  for (const site of ["cross-site", "none", undefined]) {
    const headers: Record<string, string> = site === undefined ? { ...nav } : { ...nav, "sec-fetch-site": site };
    assert.equal(isTrustedNavigation(req(headers)), true, String(site));
  }
  assert.equal(isTrustedNavigation(req({ ...nav, host: "localhost:3090" })), true);
  assert.equal(isTrustedNavigation(req({ ...nav, host: "evil.example:3090" })), false, "a rebound Host");
  assert.equal(isTrustedNavigation(req({ ...nav, "sec-fetch-mode": "navigate", host: "" })), false, "an empty Host");
  assert.equal(isTrustedNavigation(req({ "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" })), false, "no Host");
  assert.equal(isTrustedNavigation(req({ ...nav, origin: "https://evil.example" })), false, "an Origin");
  assert.equal(isTrustedNavigation(req({ ...nav, origin: "http://127.0.0.1:3090" })), false, "even its own Origin: a navigation sends none");
  assert.equal(isTrustedNavigation(req({ ...nav, "sec-fetch-mode": "cors" })), false, "a fetch()");
  assert.equal(isTrustedNavigation(req({ ...nav, "sec-fetch-dest": "empty" })), false);
  assert.equal(isTrustedNavigation(req({ ...nav, "sec-fetch-dest": "iframe" })), false, "a frame is not top-level");
  assert.equal(isTrustedNavigation(req({ host: "127.0.0.1:3090" })), false, "no Fetch Metadata");
  assert.equal(isTrustedNavigation(req(nav, "POST")), false, "a POST");
});

test("isLoopbackHost accepts the loopback spellings and nothing else", () => {
  for (const good of ["127.0.0.1", "127.0.0.1:3090", "localhost", "localhost:3090", "LocalHost:3090", "[::1]", "[::1]:3090", "::1", "127.0.0.53:3090"]) {
    assert.equal(isLoopbackHost(good), true, good);
  }
  for (const bad of [undefined, "", "evil.example.com", "evil.example.com:3090", "127.0.0.1.evil.example.com", "localhost.evil.example.com", "0.0.0.0", "192.168.1.4:3090", "[::2]", "not a host"]) {
    assert.equal(isLoopbackHost(bad), false, String(bad));
  }
});

/* Stage 3 of the graft: the face's own producers (`/data/account.json`,
 * `/data/market.json`, `/data/watchlist.json`, spawned Python scripts) and
 * `/data/bars` were read by no screen since stage 1 and left with their
 * modules; the symbol search, which data.ts used to mount beside them, now
 * registers itself. The booted face's 404 for the four paths is drilled in
 * smoke.test.ts (FACE_SMOKE=1). */
test("the producer routes, bars and the face's own quote wire are gone", async () => {
  for (const file of ["src/data.ts", "src/bars.ts", "src/watchlist.ts", "client/market-catalog.js",
    "src/quotes.ts", "src/symbol-search.ts", "src/cn-rank.ts", "src/cn-candles.ts"]) {
    assert.equal(existsSync(join(FACE, file)), false, file);
  }
  const main = readFileSync(join(FACE, "src", "main.ts"), "utf8");
  assert.doesNotMatch(main, /registerDataRoutes|FACE_PYTHON|\.\/data\.ts/);
  assert.doesNotMatch(main, /registerQuoteRoutes|registerSymbolSearchRoute|registerCnRankRoute|registerCnCandlesRoute/);
  assert.match(main, /registerLunhuiViewRoute\(/);

  // `/data`'s example route, the one that stays: the Lunhui view, behind the same fence.
  const routes: WebRoute[] = [];
  const dispose = registerLunhuiViewRoute({ register: (route) => routes.push(route) }, {
    isTrusted: isTrustedDataRequest,
    runs: () => ({ async view() { return { ok: true }; } }),
  });
  assert.equal(typeof dispose, "function");
  assert.deepEqual(routes.map((route) => [route.kind, route.path]), [["exact", "/data/lunhui/view"]]);
  for (const gone of ["/data/account.json", "/data/market.json", "/data/watchlist.json", "/data/bars",
    "/data/quotes", "/data/symbols/search", "/data/cn/rank", "/data/cn/candles"]) {
    assert.ok(!routes.some((route) => route.path === gone), gone);
  }

  const send = async (host: string) => {
    const out = { status: 0, body: "" };
    const res = { writeHead(status: number) { out.status = status; }, end(body: string) { out.body = body; } } as unknown as ServerResponse;
    const req = { method: "GET", url: "/data/lunhui/view?strategy=cn-market&run=20990101T000000Z-00000000", headers: { host } } as unknown as IncomingMessage;
    await routes[0]!.handler(req, res);
    return out;
  };
  const trusted = await send("127.0.0.1:3090");
  assert.equal(trusted.status, 200, trusted.body);
  assert.equal((await send("evil.example.com")).status, 403);
});
