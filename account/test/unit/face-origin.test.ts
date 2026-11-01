import { mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Http, HttpReply } from "../../src/portfolio/live/types.ts";
import { faceOriginOf, startPortfolioServer } from "../../src/portfolio/server.ts";
import { PortfolioService } from "../../src/portfolio/service.ts";

/** The face tells the Account the browser's own origin on it (x-gravit-face-origin): the sign-in's redirect and the wallet sentence are built
 * on it — and only on a loopback http:// origin, since any program on this machine can send the header */
const homes: string[] = [];
afterAll(() => { for (const h of homes) rmSync(h, { recursive: true, force: true }); });

const ISSUER = "https://agent.robinhood.com/mcp/trading";
const json = (body: unknown, status = 200): HttpReply => ({ status, body, text: JSON.stringify(body) });
type Asked = { url: string; method: string; body?: string | undefined };

/** Robinhood's sign-in as its metadata describes it, with made-up tokens; every request remembered */
function robinhood(): Http & { asked: Asked[] } {
  const asked: Asked[] = [];
  const http = (async (url: string, init: { method?: string; body?: string } = {}) => {
    const a = { url, method: init.method ?? "GET", body: init.body };
    asked.push(a);
    if (url === "https://agent.robinhood.com/.well-known/oauth-protected-resource/mcp/trading") return json({ authorization_servers: [ISSUER], resource: "https://agent.robinhood.com/mcp/trading", scopes_supported: ["internal"] });
    if (url === "https://agent.robinhood.com/.well-known/oauth-authorization-server/mcp/trading")
      return json({ issuer: ISSUER, authorization_endpoint: "https://robinhood.com/oauth", token_endpoint: "https://api.robinhood.com/oauth2/token/", registration_endpoint: "https://agent.robinhood.com/oauth/trading/register", code_challenge_methods_supported: ["S256"], scopes_supported: ["internal"], token_endpoint_auth_methods_supported: ["none"], authorization_response_iss_parameter_supported: true });
    if (url === "https://agent.robinhood.com/oauth/trading/register" && a.method === "POST") return json({ client_id: "client-made-up-1" }, 201);
    if (url === "https://api.robinhood.com/oauth2/token/" && a.method === "POST") return json({ access_token: "access-made-up-1", refresh_token: "refresh-made-up-1", expires_in: 3600, token_type: "Bearer" });
    return { status: 599, body: undefined, text: "no network in tests" };
  }) as Http & { asked: Asked[] };
  http.asked = asked;
  return http;
}

async function boot() {
  const home = mkdtempSync(join(tmpdir(), "face-origin-"));
  homes.push(home);
  const http = robinhood();
  const svc = await PortfolioService.create({ home, venues: "frontline", real: true, liveDeps: { http, price: async () => undefined } });
  const srv = await startPortfolioServer({ port: 0, service: svc });
  return { http, srv };
}

/** a POST over node:http, whose headers are sent as given (an array is one header given more than once) */
const post = (base: string, path: string, body: unknown, headers: Record<string, string | string[]> = {}) =>
  new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    const req = request(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown> }));
    });
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });

const H = "x-gravit-face-origin";
const FACE = "http://127.0.0.1:3090";

describe("the face's origin", () => {
  it("faceOriginOf takes a loopback http:// origin given once, with or without a port, and nothing else", () => {
    const of = (v?: string | string[]) => faceOriginOf({ headers: v === undefined ? {} : { [H]: v } } as never);
    for (const good of ["http://127.0.0.1:3090", "http://localhost:3090", "http://[::1]:3090", "http://127.0.0.53:3090", "http://localhost", "http://127.0.0.1"]) expect(of(good), good).toBe(good);
    for (const bad of [undefined, "", "https://127.0.0.1:3090", "http://evil.example:3090", "http://127.0.0.1.evil.example:3090", "http://127.0.0.1:3090/", "http://127.0.0.1:3090/account", "http://127.0.0.1:3090?x=1", "http://user@127.0.0.1:3090", "http://10.0.0.2:3090", "http://0.0.0.0:3090", "http://127.0.0.1:3090, http://127.0.0.1:3090", " http://127.0.0.1:3090"]) {
      expect(of(bad), String(bad)).toBeUndefined();
    }
    expect(of([FACE, FACE]), "given twice").toBeUndefined();
  });

  it("signin/start registers and sends the face's callback when the face names its origin; else its own", async () => {
    const { http, srv } = await boot();
    try {
      const redirectOf = async (headers: Record<string, string | string[]>) => {
        const r = await post(srv.url, "/api/account/signin/start", { connector: "robinhood" }, headers);
        expect(r.status, JSON.stringify(r.body)).toBe(200);
        return new URL(String(r.body.url)).searchParams.get("redirect_uri");
      };
      expect(await redirectOf({ [H]: FACE })).toBe(`${FACE}/data/account/signin/callback`);
      const registered = http.asked.filter((a) => a.url.endsWith("/register")).map((a) => (JSON.parse(a.body!) as { redirect_uris: string[] }).redirect_uris);
      expect(registered).toEqual([[`${FACE}/data/account/signin/callback`]]);
      const own = `${srv.url}/api/account/signin/callback`;
      expect(own).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/api\/account\/signin\/callback$/);
      expect(await redirectOf({})).toBe(own);
      for (const bad of ["http://evil.example:3090", "https://127.0.0.1:3090", "http://127.0.0.1:3090/x"]) expect(await redirectOf({ [H]: bad }), bad).toBe(own);
      expect(await redirectOf({ [H]: [FACE, FACE] }), "given twice").toBe(own);
    } finally { await srv.close(); }
  });

  it("wallet/challenge writes the face's domain and URI, and the new sentence", async () => {
    const { srv } = await boot();
    try {
      const address = "0x00000000000000000000000000000000000000a1";
      const withFace = await post(srv.url, "/api/account/wallet/challenge", { address, wallet: "MetaMask", chainId: 1 }, { [H]: FACE });
      expect(withFace.status).toBe(200);
      const m = String(withFace.body.message);
      expect(m.split("\n")[0]).toBe("127.0.0.1:3090 wants you to sign in with your Ethereum account:");
      expect(m).toContain("\nURI: http://127.0.0.1:3090/\n");
      expect(m).toContain("\nShow this wallet's balances on my account. Read-only: this is not a transaction and it lets nothing be moved.\n");
      expect(m).not.toContain("account page");
      const own = await post(srv.url, "/api/account/wallet/challenge", { address, wallet: "MetaMask", chainId: 1 }, { [H]: "https://evil.example" });
      const host = new URL(srv.url).host;
      expect(String(own.body.message).split("\n")[0]).toBe(`${host} wants you to sign in with your Ethereum account:`);
      expect(String(own.body.message)).toContain(`\nURI: http://${host}/account\n`);
    } finally { await srv.close(); }
  });

  it("the callback's pages say Go back to Gravit, never the account page", async () => {
    const { srv } = await boot();
    try {
      const started = await post(srv.url, "/api/account/signin/start", { connector: "robinhood" }, { [H]: FACE });
      const state = String(started.body.state);
      const done = await fetch(`${srv.url}/api/account/signin/callback?state=${state}&code=code-made-up&iss=${encodeURIComponent(ISSUER)}`);
      expect(done.status).toBe(200);
      const page = await done.text();
      expect(page).toContain("Go back to Gravit: it carries on from here. This tab can be closed.");
      expect(page).not.toContain("account page");
      const unknown = await fetch(`${srv.url}/api/account/signin/callback?state=made-up`);
      expect(unknown.status).toBe(400);
      const refused = await unknown.text();
      expect(refused).toContain("this sign-in is not one this server started, or it ran out: start it again from Gravit, under Account › Venues");
      expect(refused).not.toContain("account page");
    } finally { await srv.close(); }
  });
});
