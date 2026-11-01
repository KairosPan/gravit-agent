import { mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { createAkshare, type Akshare, type AkshareAnswer, type AkshareCall, type AkshareTool, type AkshareWord } from "../../src/portfolio/live/akshare.ts";
import { startPortfolioServer } from "../../src/portfolio/server.ts";
import { PortfolioService } from "../../src/portfolio/service.ts";

const FIXTURE = fileURLToPath(new URL("../fixtures/fake-akshare-mcp.mjs", import.meta.url));
const home = mkdtempSync(join(tmpdir(), "akshare-routes-"));
afterAll(() => rmSync(home, { recursive: true, force: true }));

const service = () => PortfolioService.create({ home, venues: "frontline", real: true, liveDeps: { http: async () => ({ status: 599, body: undefined, text: "" }), price: async () => undefined } });
const readOnlyService = () => PortfolioService.create({ home: mkdtempSync(join(tmpdir(), "akshare-routes-ro-")), venues: "frontline", real: true, liveDeps: { http: async () => ({ status: 599, body: undefined, text: "" }), price: async () => undefined } });

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
  it("the call route passes the tool's answer through", async () => {
    const s = stub();
    const srv = await startPortfolioServer({ port: 0, service: await service(), akshare: s.akshare });
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
    const srv = await startPortfolioServer({ port: 0, service: await service(), akshare: s.akshare });
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
      const srv = await startPortfolioServer({ port: 0, service: await service(), akshare: s.akshare });
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
    const srv = await startPortfolioServer({ port: 0, service: await service(), akshare: s.akshare });
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
    const srv = await startPortfolioServer({ port: 0, service: await service() });
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
    const srv = await startPortfolioServer({ port: 0, service: await service(), akshare: s.akshare });
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
    const srv = await startPortfolioServer({ port: 0, service: await readOnlyService(), akshare: s.akshare });
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
    const srv = await startPortfolioServer({ port: 0, service: await service(), akshare });
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
    const srv = await startPortfolioServer({ port: 0, service: await service(), akshare });
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
