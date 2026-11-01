/** The Account serves no page (plan 5 of the Account's two parts): its owner's screens are Gravit's face. Every request outside /api/ that
 * passes the fence is 404 with one sentence naming the face, with the account layer or without it (--classic keeps its API, loses its
 * page), and every answer is no-store. A real server on port 0 over a scratch home; nothing leaves the process. */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NO_PAGE, startPortfolioServer, type PortfolioServerHandle } from "../../src/portfolio/server.ts";
import { PortfolioService } from "../../src/portfolio/service.ts";

const homes: string[] = [];
const noNetwork = async () => ({ status: 599, body: undefined, text: "" });
const home = () => {
  const h = mkdtempSync(join(tmpdir(), "server-no-page-"));
  homes.push(h);
  return h;
};
let server: PortfolioServerHandle;
let classic: PortfolioServerHandle;

beforeAll(async () => {
  const svc = await PortfolioService.create({ home: home(), venues: "frontline", real: true, liveDeps: { http: noNetwork, price: async () => undefined } });
  server = await startPortfolioServer({ port: 0, service: svc, snapshotMs: 0 });
  const plain = await PortfolioService.create({ home: home() });
  classic = await startPortfolioServer({ port: 0, service: plain, snapshotMs: 0 });
}, 30_000);

afterAll(async () => {
  await server?.close();
  await classic?.close();
  homes.forEach((h) => rmSync(h, { recursive: true, force: true }));
});

const noPage = async (base: string, path: string) => {
  const r = await fetch(`${base}${path}`);
  expect(r.status, path).toBe(404);
  expect(r.headers.get("content-type"), path).toMatch(/^application\/json/);
  expect(await r.json(), path).toEqual({ ok: false, error: NO_PAGE });
};

describe("the Account serves no page", () => {
  it("names the face in one sentence", () => {
    expect(NO_PAGE).toBe("The Account serves no page: its owner's screens are Gravit's face (Markets, Trade, Account). This address answers its API under /api/.");
  });

  it("GET / answers 404 with NO_PAGE as JSON", async () => {
    await noPage(server.url, "/");
  });

  it("/account, /account.css, /owner.js, /portfolio.js, /portfolio.css, /ui/core.js, /ui/core.js?v=0123456789abcdef and /fonts/manrope-v20-latin.woff2 are 404 and say NO_PAGE", async () => {
    for (const path of ["/account", "/account.css", "/owner.js", "/portfolio.js", "/portfolio.css", "/ui/core.js", "/ui/core.js?v=0123456789abcdef", "/fonts/manrope-v20-latin.woff2"]) await noPage(server.url, path);
  });

  it("a service without the account layer answers / with 404 too", async () => {
    await noPage(classic.url, "/");
    await noPage(classic.url, "/portfolio.js");
    expect((await fetch(`${classic.url}/api/overview`)).status).toBe(200);
  });

  it("every answer, /api/now and / alike, is no-store", async () => {
    for (const path of ["/api/now", "/"]) expect((await fetch(`${server.url}${path}`)).headers.get("cache-control"), path).toBe("no-store");
  });

  it("src/portfolio/public is not on disk", () => {
    expect(existsSync(fileURLToPath(new URL("../../src/portfolio/public", import.meta.url)))).toBe(false);
  });
});
