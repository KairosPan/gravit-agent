import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { FORBIDDEN, HttpError, fencedGet, readBody, send } from "../src/http.ts";
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
