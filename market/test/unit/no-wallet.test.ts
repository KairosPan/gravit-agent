import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** The market holds no wallet and writes nothing to disk: no home, no ledger, no key file, no signing library. The one exception to the
 * write rule is market-service.ts, the operator's LaunchAgent installer */
const SRC = fileURLToPath(new URL("../../src", import.meta.url));
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
  });
  it("market/src names no wallet home", () => {
    expect(files.filter((f) => /BUYER_HOME|\.buyer-agent-demo/.test(text(f)))).toEqual([]);
  });
});
