import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { FORBIDDEN, HttpError, fencedGet, fencedPost, readBody, send } from "../src/http.ts";
import { recorder } from "./route-recorder.ts";

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
