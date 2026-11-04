import { request } from "node:http";
import { describe, expect, it } from "vitest";
import { parseHosts, startMarketServer } from "../../src/server.ts";

/** Only this machine's own programs talk to the market: another site's request is turned away before any route sees it */

/** a request over node:http, whose headers are sent as given (fetch puts its own sec-fetch-mode on every request, and may not set Host) */
const rawOf = (base: string) => (path: string, headers: Record<string, string>) =>
  new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const req = request(`${base}${path}`, { headers }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => (text += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : undefined }));
    });
    req.on("error", reject);
    req.end();
  });

const REFUSED = { ok: false, error: "this server answers only programs on this machine" };

describe("who the market answers", () => {
  it("refuses market:4821 by default, admits it when MARKET_HOSTS names it, refuses evil:4821 still", async () => {
    const plain = await startMarketServer({ port: 0 });
    try {
      const got = await rawOf(plain.url)("/api/health", { host: "market:4821" });
      expect(got.status).toBe(403);
      expect(got.body).toEqual(REFUSED);
      expect((await rawOf(plain.url)("/api/health", { host: "127.0.0.1:1" })).status).toBe(200); // the loopback rule stands
    } finally {
      await plain.close();
    }
    const named = await startMarketServer({ port: 0, hosts: ["market:4821"] });
    try {
      const raw = rawOf(named.url);
      expect(await raw("/api/health", { host: "market:4821" })).toEqual({ status: 200, body: { ok: true, service: "market" } });
      expect((await raw("/api/health", { host: "market" })).status).toBe(403);
      expect((await raw("/api/health", { host: "evil:4821" })).status).toBe(403);
      expect((await raw("/api/health", { host: "market:4821", origin: "https://evil.example" })).status).toBe(403);
    } finally {
      await named.close();
    }
  });
  it("refuses a foreign Origin and a cross-site or same-site fetch", async () => {
    const srv = await startMarketServer({ port: 0 });
    try {
      const get = (headers: Record<string, string>) => fetch(`${srv.url}/api/health`, { headers }).then(async (r) => ({ status: r.status, body: await r.json() }));
      expect((await get({})).status).toBe(200);
      expect((await get({ origin: srv.url })).status).toBe(200);
      expect(await get({ origin: "http://evil.example" })).toEqual({ status: 403, body: REFUSED });
      expect((await get({ origin: "null" })).status).toBe(403);
      expect(await get({ "sec-fetch-site": "cross-site" })).toEqual({ status: 403, body: REFUSED });
      expect(await get({ "sec-fetch-site": "same-site" })).toEqual({ status: 403, body: REFUSED });
      expect((await get({ "sec-fetch-site": "same-origin" })).status).toBe(200);
      // a navigation from another site reaches no route either
      expect((await rawOf(srv.url)("/", { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" })).status).toBe(403);
    } finally {
      await srv.close();
    }
  });
  it("parseHosts trims, drops empties and changes nothing else", () => {
    expect(parseHosts(undefined)).toEqual([]);
    expect(parseHosts(" market:4821, ,Other:1 ")).toEqual(["market:4821", "Other:1"]);
  });
  it("a close that throws rejects once, then closes quietly, and frees the port", async () => {
    const srv = await startMarketServer({ port: 0, close: async () => { throw new Error("boom"); } });
    const port = Number(new URL(srv.url).port);
    await expect(srv.close()).rejects.toThrow("boom");
    await expect(srv.close()).resolves.toBeUndefined();
    await expect(srv.close()).resolves.toBeUndefined();
    const again = await startMarketServer({ port });
    try {
      expect((await fetch(`${again.url}/api/health`)).status).toBe(200);
    } finally {
      await again.close();
    }
  });
});
