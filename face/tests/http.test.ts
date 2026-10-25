import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { WebRoute } from "@deepseek-ai/dsh-host-webserver";
import { FORBIDDEN, HttpError, isJsonBody, isLoopbackHost, isTrustedDataRequest, readBody } from "../src/http.ts";
import { createSymbolSearch, registerSymbolSearchRoute } from "../src/symbol-search.ts";

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
test("the producer routes and bars are gone", async () => {
  for (const file of ["src/data.ts", "src/bars.ts", "src/watchlist.ts", "client/market-catalog.js"]) {
    assert.equal(existsSync(join(FACE, file)), false, file);
  }
  const main = readFileSync(join(FACE, "src", "main.ts"), "utf8");
  assert.doesNotMatch(main, /registerDataRoutes|FACE_PYTHON|\.\/data\.ts/);
  assert.match(main, /registerSymbolSearchRoute\(/);

  const routes: WebRoute[] = [];
  const search = createSymbolSearch({ fetch: async () => new Response('v_hint="sh~603986~\\u5146\\u6613\\u521b\\u65b0~zycx~GP-A";') });
  const dispose = registerSymbolSearchRoute({ register: (route) => routes.push(route) }, search);
  assert.equal(typeof dispose, "function");
  assert.deepEqual(routes.map((route) => [route.kind, route.path]), [["exact", "/data/symbols/search"]]);
  for (const gone of ["/data/account.json", "/data/market.json", "/data/watchlist.json", "/data/bars"]) {
    assert.ok(!routes.some((route) => route.path === gone), gone);
  }

  const out = { status: 0, body: "" };
  const res = { writeHead(status: number) { out.status = status; }, end(body: string) { out.body = body; } } as unknown as ServerResponse;
  const req = { method: "GET", url: "/data/symbols/search?q=603986&market=cn", headers: { host: "127.0.0.1:3090" } } as unknown as IncomingMessage;
  await routes[0]!.handler(req, res);
  assert.equal(out.status, 200, out.body);
  assert.deepEqual((JSON.parse(out.body) as { assets: { id: string }[] }).assets.map((asset) => asset.id), ["cn:603986"]);
});
