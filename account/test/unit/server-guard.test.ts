import { mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseHosts, startPortfolioServer } from "../../src/portfolio/server.ts";
import { PortfolioService } from "../../src/portfolio/service.ts";

/** Only this machine's own pages and programs talk to the account: another site's request is turned away before any route sees it */
const home = mkdtempSync(join(tmpdir(), "server-guard-"));
afterAll(() => rmSync(home, { recursive: true, force: true }));

const service = () => PortfolioService.create({ home, venues: "frontline", real: true, liveDeps: { http: async () => ({ status: 599, body: undefined, text: "" }), price: async () => undefined } });

/** a request over node:http, whose headers are sent as given (fetch puts its own sec-fetch-mode on every request, and may not set Host) */
const rawOf = (base: string) => (path: string, headers: Record<string, string>) =>
  new Promise<number>((resolve, reject) => {
    const req = request(`${base}${path}`, { headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.end();
  });

describe("who the server answers", () => {
  it("local programs and pages; not another site's script, nor a request the browser marks as cross-site — a navigation from another site is refused like any cross-site request", async () => {
    const svc = await service();
    const srv = await startPortfolioServer({ port: 0, service: svc });
    try {
      const get = (path: string, headers: Record<string, string> = {}) => fetch(`${srv.url}${path}`, { headers }).then((r) => r.status);
      expect(await get("/api/account")).toBe(200);
      expect(await get("/api/account", { origin: srv.url })).toBe(200);
      expect(await get("/api/account", { origin: "https://evil.example" })).toBe(403);
      expect(await get("/api/account", { origin: "null" })).toBe(403);
      expect(await get("/api/account", { "sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors", "sec-fetch-dest": "image" })).toBe(403);
      expect(await get("/", { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" })).toBe(403);
      // a navigation from another site reaches no route: the Account serves no page, and a venue's sign-in comes back through the face's
      // own callback, which asks this one as a program does (asked over node:http: fetch puts its own sec-fetch-mode on every request)
      const raw = rawOf(srv.url);
      const navigation = { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" };
      expect(await raw("/api/account", navigation)).toBe(403);
      expect(await raw("/api/account/stream?client=tab-navigated-1", navigation)).toBe(403);
      expect(await raw("/", navigation)).toBe(403);
      expect(await raw("/api/account/signin/callback", navigation)).toBe(403);
      expect(await raw("/api/account/signin/callback", { "sec-fetch-site": "same-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" })).toBe(403);
      expect(await get("/api/account", { "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" })).toBe(200);
    } finally {
      await srv.close();
    }
  });
  it("an extra host named in hosts is local; anything else, and any foreign origin, is not", async () => {
    const svc = await service();
    const srv = await startPortfolioServer({ port: 0, service: svc, hosts: parseHosts(" account:4820 ,, http://evil:4820") });
    try {
      const raw = rawOf(srv.url);
      // Host header exactly as a compose peer sends it
      expect(await raw("/api/overview", { host: "account:4820" })).toBe(200);
      expect(await raw("/api/overview", { host: "account" })).toBe(403);
      expect(await raw("/api/overview", { host: "account:4820/" })).toBe(403);
      expect(await raw("/api/overview", { host: "evil:4820" })).toBe(403); // the scheme-carrying entry never matches a Host
      expect(await raw("/api/overview", { host: "account:4820", origin: "https://evil.example" })).toBe(403);
      expect(await raw("/api/overview", { host: "127.0.0.1:1" })).toBe(200); // the loopback rule still stands
      // the seat the page offers points at the first named host, the one a compose peer reaches
      expect(((await fetch(`${srv.url}/api/account`).then((r) => r.json())) as { agentSetup: { url: string } }).agentSetup.url).toBe("http://account:4820");
    } finally {
      await srv.close();
    }
  });
  it("/api/account/act answers 403 to another site's origin", async () => {
    const svc = await service();
    const srv = await startPortfolioServer({ port: 0, service: svc });
    try {
      const post = (headers: Record<string, string>) => fetch(`${srv.url}/api/account/act`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ action: { type: "setRouting", routing: "telegram", quietFrom: "", quietTo: "" } }) }).then((r) => r.status);
      expect(await post({ origin: "https://evil.example" })).toBe(403);
      expect(await post({ "sec-fetch-site": "cross-site" })).toBe(403);
      expect(await post({ "sec-fetch-site": "same-site" })).toBe(403);
      // a local program reaches the route: a body that is no action is the route's own 400, not the fence's 403
      expect(await fetch(`${srv.url}/api/account/act`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "x" }) }).then((r) => r.status)).toBe(400);
    } finally {
      await srv.close();
    }
  });
  it("parseHosts trims and drops empties", () => {
    expect(parseHosts(undefined)).toEqual([]);
    expect(parseHosts(" a:1 , ,b:2")).toEqual(["a:1", "b:2"]);
  });
  it("binds where told and keeps its origin on 127.0.0.1", async () => {
    const svc = await service();
    const srv = await startPortfolioServer({ port: 0, service: svc, bind: "0.0.0.0" });
    try {
      const raw = rawOf(srv.url);
      expect(srv.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(await raw("/api/overview", {})).toBe(200);
      expect(await raw("/api/overview", { host: "account:4820" })).toBe(403); // no hosts given: the default refuses it
      expect(((await fetch(`${srv.url}/api/account`).then((r) => r.json())) as { agentSetup: { url: string } }).agentSetup.url).toBe(srv.url);
    } finally {
      await srv.close();
    }
  });
});
