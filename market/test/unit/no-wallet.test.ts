import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** The market holds no wallet and writes nothing to disk: no home, no ledger, no key file, no signing library. The one exception to the
 * write rule is market-service.ts, the operator's LaunchAgent installer */
const SRC = fileURLToPath(new URL("../../src", import.meta.url));
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
const files = walk(SRC);
const text = (f: string) => readFileSync(f, "utf8");

const WALLET_FILES = ["home.ts", "credentials.ts", "keystore.ts", "sign.ts", "paper.ts", "metamask.ts", "writes.ts", "earn.ts", "polymarket-clob.ts", "wallet-bridge.ts", "ed25519.ts"];
const WRITES = /\b(writeFileSync|writeFile|appendFile|appendFileSync|mkdirSync|createWriteStream|rmSync|unlinkSync|renameSync)\b/;

describe("the market holds no wallet", () => {
  it("market/src holds no wallet file", () => {
    expect(files.length).toBeGreaterThan(0);
    expect(files.map((f) => basename(f)).filter((b) => WALLET_FILES.includes(b))).toEqual([]);
  });
  it("market/src imports no signing library and writes no file", () => {
    expect(files.filter((f) => /from "viem\/accounts"/.test(text(f)))).toEqual([]);
    expect(files.filter((f) => basename(f) !== "market-service.ts" && WRITES.test(text(f)))).toEqual([]);
    // market:mcp, Gravit's reads, writes nothing to disk either: no seat key, no home
    expect(WRITES.test(text(join(SRC, "mcp.ts")))).toBe(false);
  });
  it("market/src names no wallet home", () => {
    expect(files.filter((f) => /BUYER_HOME|\.buyer-agent-demo/.test(text(f)))).toEqual([]);
  });
  it("the market carries the keyless modules", () => {
    for (const f of ["public-markets","stream-hub","china","akshare","cn-relay","cn-ifind","prices","us-quotes","public-stocks","public-rwa","history-stocks"])
      expect(existsSync(join(SRC, "live", `${f}.ts`))).toBe(true);
  });
  it("the market's reads say nothing of an account", () => {
    // its answers' words and codes: no account's sentence, no account's or wallet's refusal code raised by the market's own checks
    for (const f of ["reads.ts", "follows.ts", "routes-cn.ts", "protocol.ts"]) expect(text(join(SRC, f)), f).not.toMatch(/this account|connected live|the account (reads|can read)|E_WALLET_ACCOUNT_UNKNOWN|E_ACCOUNT_|this Account/i);
    // anywhere in market/src: no sentence that says the account refuses for the market, and no route of the account's named as its own
    for (const f of files) expect(text(f), f).not.toMatch(/the account does not look for a way around it|this Account runs no|\/api\/account\/(explore|quotes|candles|book|trades|stream)\b/);
  });
  it("the README names the port, the scripts and the AKShare command", () => {
    const r = readFileSync(join(ROOT, "README.md"), "utf8");
    for (const s of ["127.0.0.1:4821", "npm run market", "npm run market:service", "MARKET_AKSHARE_BIN", "MARKET_BIND", "MARKET_HOSTS", "NOTICE"]) expect(r).toContain(s);
  });
});
