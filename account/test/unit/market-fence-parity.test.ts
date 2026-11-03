import { mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MARKET_NO_PAGE, startMarketServer, type MarketServerHandle } from "../../../market/src/server.ts";
import { NO_PAGE, startPortfolioServer, type PortfolioServerHandle } from "../../src/portfolio/server.ts";
import { PortfolioService } from "../../src/portfolio/service.ts";

/** The market's fence, no-page answer and cache header are copies of the account's (two packages, no shared module): the same requests
 * get the same status and the same body shape at both, so the copies cannot drift apart unseen. The no-page sentences differ by design */
const home = mkdtempSync(join(tmpdir(), "fence-parity-"));
let account: PortfolioServerHandle;
let market: MarketServerHandle;

beforeAll(async () => {
  const svc = await PortfolioService.create({ home, venues: "frontline", real: true, liveDeps: { http: async () => ({ status: 599, body: undefined, text: "" }), price: async () => undefined } });
  account = await startPortfolioServer({ port: 0, service: svc, hosts: ["account:4820"] });
  market = await startMarketServer({ port: 0, hosts: ["market:4821"] });
}, 60_000);
afterAll(async () => {
  await account?.close();
  await market?.close();
  rmSync(home, { recursive: true, force: true });
});

interface Answer {
  status: number;
  cache: string | undefined;
  body: unknown;
}
/** a request over node:http, whose headers are sent as given (fetch may not set Host, and puts its own sec-fetch-mode on every request) */
const raw = (base: string, path: string, headers: Record<string, string>) =>
  new Promise<Answer>((resolve, reject) => {
    const req = request(`${base}${path}`, { headers }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => (text += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, cache: res.headers["cache-control"], body: text ? JSON.parse(text) : undefined }));
    });
    req.on("error", reject);
    req.end();
  });

/** each case at both servers: the account on one of its API paths, the market on its health; `{peer}` is each one's own named host */
const REFUSED = { ok: false, error: "this server answers only programs on this machine" };
const cases: { name: string; path?: string; headers: (peer: string) => Record<string, string>; status: number }[] = [
  { name: "a loopback Host", headers: () => ({ host: "127.0.0.1:1" }), status: 200 },
  { name: "a foreign Host", headers: () => ({ host: "evil.example:80" }), status: 403 },
  { name: "the exact named host", headers: (peer) => ({ host: peer }), status: 200 },
  { name: "the named host without its port", headers: (peer) => ({ host: peer.split(":")[0]! }), status: 403 },
  { name: "the named host with a foreign Origin", headers: (peer) => ({ host: peer, origin: "https://evil.example" }), status: 403 },
  { name: "a foreign Origin", headers: () => ({ origin: "http://evil.example" }), status: 403 },
  { name: "Sec-Fetch-Site cross-site", headers: () => ({ "sec-fetch-site": "cross-site" }), status: 403 },
  { name: "Sec-Fetch-Site same-site", headers: () => ({ "sec-fetch-site": "same-site" }), status: 403 },
  { name: "Sec-Fetch-Site same-origin", headers: () => ({ "sec-fetch-site": "same-origin" }), status: 200 },
  { name: "a path outside /api/", path: "/index.html", headers: () => ({}), status: 404 },
  { name: "a cross-site navigation to a page", path: "/", headers: () => ({ "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" }), status: 403 },
];

describe("the market's fence is the account's", () => {
  it("the no-page sentences are each package's own", () => {
    expect(MARKET_NO_PAGE).not.toBe(NO_PAGE);
  });
  for (const c of cases) {
    it(`${c.name}: the same status and body shape at both, never cached`, async () => {
      const a = await raw(account.url, c.path ?? "/api/overview", c.headers("account:4820"));
      const m = await raw(market.url, c.path ?? "/api/health", c.headers("market:4821"));
      expect(a.status).toBe(c.status);
      expect(m.status).toBe(c.status);
      expect(a.cache).toBe("no-store");
      expect(m.cache).toBe("no-store");
      if (c.status === 403) {
        expect(a.body).toEqual(REFUSED);
        expect(m.body).toEqual(REFUSED);
      }
      if (c.status === 404) {
        expect(a.body).toEqual({ ok: false, error: NO_PAGE });
        expect(m.body).toEqual({ ok: false, error: MARKET_NO_PAGE });
      }
      // let through, each reaches its route: a JSON object that is not the refusal (the account's statement has its own shape)
      if (c.status === 200) {
        for (const body of [a.body, m.body]) {
          expect(typeof body).toBe("object");
          expect(body).not.toEqual(REFUSED);
        }
        expect(m.body).toEqual({ ok: true, service: "market" });
      }
    });
  }
});
