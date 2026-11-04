// Copy of account/test/unit/akshare-routes.test.ts at cb4930c4 (account split, plan A1), retargeted to the market's server: every assertion
// stays. The market has no service and no read-only mode: each server is the market's own over a core holding the sidecar, and the
// close that may throw before the sidecar's end is the hub's (the core's close: hub, then AKShare) where the account's was its paper flush
import { request } from "node:http";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createAkshare, type Akshare, type AkshareAnswer, type AkshareCall, type AkshareTool, type AkshareWord } from "../../src/live/akshare.ts";
import type { MarketHub } from "../../src/live/stream-hub.ts";
import { createMarketCore } from "../../src/core.ts";
import { mountCn } from "../../src/routes-cn.ts";
import { startMarketServer } from "../../src/server.ts";

const FIXTURE = fileURLToPath(new URL("../fixtures/fake-akshare-mcp.mjs", import.meta.url));

/** the market's server over a core holding `akshare` (absent: none), the routes mounted as the main mounts them, its close the core's */
function startAkServer(o: { akshare?: Akshare; hub?: MarketHub } = {}) {
  const core = createMarketCore({ akshare: o.akshare, hub: o.hub });
  return startMarketServer({ port: 0, mount: (app) => { mountCn(app, core); }, close: () => core.close() });
}

const TOOLS: AkshareTool[] = [{ name: "akshare_stock_a", description: "A-share methods", inputSchema: { type: "object" } }];
const OK_CALL: AkshareAnswer<AkshareCall> = { kind: "ok", value: { isError: false, content: [{ type: "text", text: "{\"row_count\":1}" }] } };

function stub(callAnswer: AkshareAnswer<AkshareCall> = OK_CALL, toolsAnswer: AkshareAnswer<AkshareTool[]> = { kind: "ok", value: TOOLS }) {
  const seen = { calls: [] as Array<{ tool: string; args: unknown; signal: AbortSignal | undefined }>, tools: 0, closed: 0 };
  const akshare: Akshare = {
    async tools() { seen.tools++; return toolsAnswer; },
    async call(tool, args, signal) { seen.calls.push({ tool, args, signal }); return callAnswer; },
    async close() { seen.closed++; },
  };
  return { akshare, seen };
}
const post = (base: string, body: unknown, headers: Record<string, string> = {}) => fetch(`${base}/api/akshare/call`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

describe("the AKShare routes", () => {
  it("close ends the sidecar even when the hub's close throws", async () => {
    const s = stub();
    const hub = { close: () => { throw new Error("flush failed"); } } as unknown as MarketHub;
    const srv = await startAkServer({ akshare: s.akshare, hub });
    await expect(srv.close()).rejects.toThrow("flush failed");
    expect(s.seen.closed).toBe(1);
  });

  it("the call route passes the tool's answer through", async () => {
    const s = stub();
    const srv = await startAkServer({ akshare: s.akshare });
    try {
      const r = await post(srv.url, { tool: "akshare_stock_a", arguments: { method: "stock_zh_a_spot_tx" } });
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ ok: true, tool: "akshare_stock_a", isError: false, content: [{ type: "text", text: "{\"row_count\":1}" }] });
      expect(s.seen.calls[0]!.tool).toBe("akshare_stock_a");
      expect(s.seen.calls[0]!.args).toEqual({ method: "stock_zh_a_spot_tx" });
      await post(srv.url, { tool: "akshare_discover" });
      expect(s.seen.calls[1]!.args).toBeUndefined();
    } finally { await srv.close(); }
  });

  it("the tools route lists the sidecar's tools", async () => {
    const s = stub();
    const srv = await startAkServer({ akshare: s.akshare });
    try {
      const r = await fetch(`${srv.url}/api/akshare/tools`);
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ ok: true, tools: TOOLS });
    } finally { await srv.close(); }
  });

  it("refusals carry their word and status", async () => {
    const table: Array<[AkshareWord, number]> = [["off", 503], ["unknown-tool", 400], ["bad-arguments", 400], ["unavailable", 503], ["timeout", 504], ["too-large", 502]];
    for (const [word, status] of table) {
      const s = stub({ kind: "refused", word, message: `m-${word}` }, { kind: "refused", word, message: `m-${word}` });
      const srv = await startAkServer({ akshare: s.akshare });
      try {
        const c = await post(srv.url, { tool: "akshare_stock_a" });
        expect(c.status).toBe(status);
        expect(await c.json()).toEqual({ ok: false, akshare: word, message: `m-${word}` });
        const t = await fetch(`${srv.url}/api/akshare/tools`);
        expect(t.status).toBe(status);
        expect(await t.json()).toEqual({ ok: false, akshare: word, message: `m-${word}` });
      } finally { await srv.close(); }
    }
    const s = stub();
    const srv = await startAkServer({ akshare: s.akshare });
    try {
      for (const body of [{ tool: 1 }, {}, { arguments: {} }]) {
        const r = await post(srv.url, body);
        expect(r.status).toBe(400);
        expect(((await r.json()) as { akshare: string }).akshare).toBe("bad-arguments");
      }
      expect(s.seen.calls.length).toBe(0);
    } finally { await srv.close(); }
  });

  it("without a sidecar both routes answer off, and nothing is spawned", async () => {
    const srv = await startAkServer();
    try {
      const t = await fetch(`${srv.url}/api/akshare/tools`);
      expect(t.status).toBe(503);
      expect(await t.json()).toMatchObject({ ok: false, akshare: "off" });
      const c = await post(srv.url, { tool: "akshare_stock_a" });
      expect(c.status).toBe(503);
      expect(await c.json()).toMatchObject({ ok: false, akshare: "off" });
    } finally { await srv.close(); }
  });

  it("are behind the fence", async () => {
    const s = stub();
    const srv = await startAkServer({ akshare: s.akshare });
    try {
      const evil = { origin: "https://evil.example" };
      expect((await post(srv.url, { tool: "akshare_stock_a" }, evil)).status).toBe(403);
      expect((await fetch(`${srv.url}/api/akshare/tools`, { headers: evil })).status).toBe(403);
      const hostile = (method: string, path: string) => new Promise<number>((resolve, reject) => {
        const req = request(`${srv.url}${path}`, { method, headers: { host: "evil.example:4820", "content-type": "application/json" } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
        req.on("error", reject);
        req.end(method === "POST" ? JSON.stringify({ tool: "akshare_stock_a" }) : undefined);
      });
      expect(await hostile("GET", "/api/akshare/tools")).toBe(403);
      expect(await hostile("POST", "/api/akshare/call")).toBe(403);
      expect(s.seen.calls.length + s.seen.tools).toBe(0);
    } finally { await srv.close(); }
  });

  it("answer on a read-only service", async () => {
    const s = stub();
    const srv = await startAkServer({ akshare: s.akshare });
    try {
      expect((await fetch(`${srv.url}/api/akshare/tools`)).status).toBe(200);
      expect((await post(srv.url, { tool: "akshare_stock_a" })).status).toBe(200);
    } finally { await srv.close(); }
  });

  it("a caller that goes away aborts the ask", async () => {
    let signal: AbortSignal | undefined;
    let entered!: () => void;
    const inCall = new Promise<void>((r) => { entered = r; });
    const akshare: Akshare = {
      async tools() { return { kind: "ok", value: [] }; },
      call(_t, _a, sg) { signal = sg; entered(); return new Promise(() => {}); },
      async close() {},
    };
    const srv = await startAkServer({ akshare });
    try {
      const req = request(`${srv.url}/api/akshare/call`, { method: "POST", headers: { "content-type": "application/json" } });
      req.on("error", () => {});
      req.end(JSON.stringify({ tool: "akshare_stock_a" }));
      await inCall;
      expect(signal!.aborted).toBe(false);
      req.destroy();
      const t0 = Date.now();
      while (!signal!.aborted && Date.now() - t0 < 2_000) await new Promise((r) => setTimeout(r, 20));
      expect(signal!.aborted).toBe(true);
    } finally { await srv.close(); }
  });

  it("the server's close ends the sidecar", async () => {
    const akshare = createAkshare({ command: process.execPath, args: [FIXTURE] });
    const srv = await startAkServer({ akshare });
    let pid = 0;
    try {
      const r = await post(srv.url, { tool: "akshare_discover", arguments: {} });
      expect(r.status).toBe(200);
      const body = (await r.json()) as { content: Array<{ text: string }> };
      pid = (JSON.parse(body.content[0]!.text) as { pid: number }).pid;
      expect(alive(pid)).toBe(true);
    } finally { await srv.close(); }
    const t0 = Date.now();
    while (alive(pid) && Date.now() - t0 < 2_000) await new Promise((r) => setTimeout(r, 50));
    expect(alive(pid)).toBe(false);
  });
});
