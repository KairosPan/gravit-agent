import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { answers, LABEL, plan } from "../../src/market-service.ts";

/** The LaunchAgent that keeps the market up: what launchd is told to run, and what it is not given */
describe("the market as a background service", () => {
  const env = {
    PATH: "/r/market/node_modules/.bin:/opt/homebrew/lib/node_modules/npm/node_modules/@npmcli/run-script/lib/node-gyp-bin:/opt/homebrew/bin:/usr/bin",
    HOME: "/Users/me",
    MARKET_AKSHARE_BIN: "/opt/x/akshare-mcp",
    MARKET_BIND: "0.0.0.0",
    IFIND_ACCESS_TOKEN: "ifind-fixture-token",
    SECRET_TOKEN: "secret-fixture-value",
  };
  const p = plan(["--port", "4821"], { node: "/opt/homebrew/bin/node", root: "/r/market", logs: "/l", env });

  it("runs this folder's market server under node and tsx by their full paths", () => {
    expect(p.args).toEqual(["/opt/homebrew/bin/node", "--env-file-if-exists=/r/.env.ifind", "/r/market/node_modules/tsx/dist/cli.mjs", "/r/market/src/server.ts", "--port", "4821"]);
    expect(LABEL).toBe("com.gravit.market");
    expect(p.plist).toContain("<key>Label</key><string>com.gravit.market</string>");
    expect(p.plist).toContain("<key>WorkingDirectory</key><string>/r/market</string>");
    expect(p.path.endsWith("/Library/LaunchAgents/com.gravit.market.plist")).toBe(true);
  });

  it("loads the iFinD token by its file's path at each start, never by value", () => {
    expect(p.plist).toContain("<string>--env-file-if-exists=/r/.env.ifind</string>");
    expect(p.plist).not.toContain("ifind-fixture-token");
    expect(plan([], { node: "/n", root: "/r/market", repo: "/elsewhere", logs: "/l", env }).args[1]).toBe("--env-file-if-exists=/elsewhere/.env.ifind");
  });

  it("starts at login, again only after an exit by accident, logs only the user can read", () => {
    expect(p.plist).toMatch(/<key>RunAtLoad<\/key><true\/>/);
    expect(p.plist).toMatch(/<key>KeepAlive<\/key>\s*<dict>\s*<key>SuccessfulExit<\/key><false\/>/);
    expect(p.plist).toContain("<key>Umask</key><integer>63</integer>");
    expect([p.log, p.errLog]).toEqual(["/l/market.log", "/l/market.err.log"]);
    expect(p.plist).toContain("<key>StandardOutPath</key><string>/l/market.log</string>");
    expect(p.plist).toContain("<key>StandardErrorPath</key><string>/l/market.err.log</string>");
  });

  it("keeps PATH, HOME and the AKShare command; never the bind, a token or anything else", () => {
    expect(p.plist).toContain("<key>PATH</key><string>/opt/homebrew/bin:/usr/bin</string>");
    expect(p.plist).toContain("<key>HOME</key><string>/Users/me</string>");
    expect(p.plist).toContain("<key>MARKET_AKSHARE_BIN</key><string>/opt/x/akshare-mcp</string>");
    for (const s of ["MARKET_BIND", "0.0.0.0", "IFIND_ACCESS_TOKEN", "ifind-fixture-token", "SECRET_TOKEN", "secret-fixture-value", "node_modules/.bin"]) expect(p.plist).not.toContain(s);
  });

  it("writes what it is given as XML text", () => {
    expect(plan(["--x", "/tmp/a&b<c>"], { node: "/n", root: "/r/market", logs: "/l", env: {} }).plist).toContain("<string>/tmp/a&amp;b&lt;c&gt;</string>");
  });

  it("status counts only a market as answering", async () => {
    let reply: { status: number; body: unknown } = { status: 200, body: { ok: true, service: "account" } };
    const stub = createServer((_req, res) => {
      res.writeHead(reply.status, { "content-type": "application/json" });
      res.end(JSON.stringify(reply.body));
    });
    await new Promise<void>((go) => stub.listen(0, "127.0.0.1", go));
    const port = (stub.address() as AddressInfo).port;
    try {
      expect(await answers(port)).toBe(false);
      reply = { status: 200, body: { ok: true, service: "market" } };
      expect(await answers(port)).toBe(true);
      reply = { status: 500, body: { ok: true, service: "market" } };
      expect(await answers(port)).toBe(false);
    } finally {
      await new Promise<void>((go) => stub.close(() => go()));
    }
    // nothing listening: not answering
    expect(await answers(port)).toBe(false);
  });
});
