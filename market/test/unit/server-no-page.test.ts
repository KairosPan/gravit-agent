import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MARKET_NO_PAGE, startMarketServer, type MarketServerHandle } from "../../src/server.ts";

/** The market serves no page: its screens are the face's. It answers its API under /api/, and nothing it says is stored by a browser */
let srv: MarketServerHandle;
beforeAll(async () => {
  srv = await startMarketServer({ port: 0 });
});
afterAll(() => srv.close());

describe("the market's answers", () => {
  it("answers 404 MARKET_NO_PAGE outside /api/", async () => {
    expect(MARKET_NO_PAGE).toBe("The market serves no page: its screens are Gravit's face (Markets). This address answers its API under /api/.");
    for (const path of ["/", "/index.html"]) {
      const r = await fetch(`${srv.url}${path}`);
      expect(r.status).toBe(404);
      expect(r.headers.get("cache-control")).toBe("no-store");
      expect(await r.json()).toEqual({ ok: false, error: MARKET_NO_PAGE });
    }
  });
  it("answers /api/health, never cached", async () => {
    const r = await fetch(`${srv.url}/api/health`);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toEqual({ ok: true, service: "market" });
  });
  it("an unreadable JSON body is one fixed sentence", async () => {
    const r = await fetch(`${srv.url}/api/health`, { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
    expect(r.status).toBe(400);
    const body = (await r.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/could not be read as JSON/);
    expect(body.error).not.toContain("{");
  });
  it("a mounted route answers behind the fence and the parser, and a close runs before the listener closes", async () => {
    const order: string[] = [];
    const m = await startMarketServer({
      port: 0,
      mount: (app) => app.post("/api/echo", (req, res) => void res.json({ ok: true, got: req.body as unknown })),
      close: async () => void order.push("close"),
    });
    const r = await fetch(`${m.url}/api/echo`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ a: 1 }) });
    expect(await r.json()).toEqual({ ok: true, got: { a: 1 } });
    expect((await fetch(`${m.url}/api/echo`, { method: "POST", headers: { "content-type": "application/json", origin: "http://evil.example" }, body: "{}" })).status).toBe(403);
    await m.close();
    expect(order).toEqual(["close"]);
    await expect(fetch(`${m.url}/api/health`)).rejects.toThrow();
  });
});
