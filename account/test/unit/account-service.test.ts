import { describe, expect, it } from "vitest";
import { codeLine, LABEL, plan } from "../../src/portfolio/account-service.ts";

/** The LaunchAgent that keeps the account up for agents: what launchd is told to run, and what it is not given */
describe("the account as a background service", () => {
  const p = plan(["--live-cap", "20", "--port", "4820"], { node: "/opt/homebrew/bin/node", root: "/Users/me/demo", home: "/Users/me/.buyer-agent-demo", env: { PATH: "/Users/me/demo/node_modules/.bin:/opt/homebrew/lib/node_modules/npm/node_modules/@npmcli/run-script/lib/node-gyp-bin:/opt/homebrew/bin:/usr/bin", HOME: "/Users/me", PORTFOLIO_RPC_BASE: "https://rpc.example", SECRET_TOKEN: "x" } });

  it("runs this folder's server under node and tsx by their full paths, with the options given", () => {
    expect(p.args).toEqual(["/opt/homebrew/bin/node", "/Users/me/demo/node_modules/tsx/dist/cli.mjs", "/Users/me/demo/src/portfolio/server.ts", "--live-cap", "20", "--port", "4820"]);
    expect(p.plist).toContain(`<key>Label</key><string>${LABEL}</string>`);
    expect(p.plist).toContain("<key>WorkingDirectory</key><string>/Users/me/demo</string>");
  });

  it("starts at login, starts again only after an exit by accident, and logs where only the user can read", () => {
    expect(p.plist).toMatch(/<key>RunAtLoad<\/key><true\/>/);
    expect(p.plist).toMatch(/<key>KeepAlive<\/key>\s*<dict>\s*<key>SuccessfulExit<\/key><false\/>/);
    expect(p.plist).toContain("<key>Umask</key><integer>63</integer>");
    expect([p.log, p.errLog]).toEqual(["/Users/me/.buyer-agent-demo/logs/account.log", "/Users/me/.buyer-agent-demo/logs/account.err.log"]);
  });

  it("keeps the user's PATH, HOME and RPC settings — not npm's own folders, and nothing else from the environment", () => {
    expect(p.plist).toContain("<key>PATH</key><string>/opt/homebrew/bin:/usr/bin</string>");
    expect(p.plist).toContain("<key>PORTFOLIO_RPC_BASE</key><string>https://rpc.example</string>");
    expect(p.plist).not.toContain("SECRET_TOKEN");
    expect(p.plist).not.toContain("node_modules/.bin");
  });

  it("writes what it is given as XML text", () => {
    expect(plan(["--home", "/tmp/a&b<c>"], { node: "/n", root: "/r", home: "/h", env: {} }).plist).toContain("<string>/tmp/a&amp;b&lt;c&gt;</string>");
  });

  it("`code` shows the pairing code of the run that is up now — the last one it said: a new one replaces the code it started with once the last browser signs out — never an earlier run's", () => {
    const earlier = "TRADING IS ON · real orders …\n  pairing code: AAAA-BBBB — the first browser becomes the owner only with this code, typed on the page";
    const started = "TRADING IS ON · real orders …\n  pairing code: CCCC-DDDD — the first browser becomes the owner only with this code, typed on the page";
    const signedOut = "signed out: no browser signs for the account now\n  pairing code: EEEE-FFFF — the next browser becomes the owner only with this code, typed on the page (the code before it no longer works)";
    expect(codeLine(`${earlier}\nyour account at …\n${started}\nyour account at …`)).toBe("pairing code: CCCC-DDDD — the first browser becomes the owner only with this code, typed on the page");
    expect(codeLine(`${earlier}\n${started}\n${signedOut}\n${signedOut.replace("EEEE-FFFF", "GGGG-HHHH")}`)).toBe("pairing code: GGGG-HHHH — the next browser becomes the owner only with this code, typed on the page (the code before it no longer works)");
    // a run that started owned said no code: an earlier run's is not this run's
    expect(codeLine(`${earlier}\nTRADING IS ON · real orders …\nyour account at …`)).toBeUndefined();
    expect(codeLine("")).toBeUndefined();
  });
});
