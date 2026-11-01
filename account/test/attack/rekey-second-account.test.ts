/** Attack on connecting a venue again with a new key — "Connect a new key" — when it is a SECOND account at an exchange:
 *
 *   rekey      "OKX Trading" (id okx-trading) reads its key from its own file. Connected again, the form used to start from the FIRST OKX
 *              account's file (credentials/okx/api-key.json): the check said "Ready." against that file, and the signed connectVenue made
 *              okx-trading read and trade the first account — its money counted twice, orders "at OKX Trading" landing in account one. The
 *              account now names each key-file venue's own file (venues[].keyFile, a path and never what is in it), so a form that
 *              connects it again can start from it
 *
 * The exchange library is a stand-in and the key files hold made-up values in a temporary home; nothing leaves the process. */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { isRefusal } from "../../src/core/errors.ts";
import { signOwner, simKey, type OwnerAction } from "../../src/portfolio/account/sign.ts";
import type { ExchangeClient, OpenExchange } from "../../src/portfolio/live/exchange.ts";
import type { LiveDeps } from "../../src/portfolio/live/index.ts";
import { PortfolioService } from "../../src/portfolio/service.ts";

type NoNonce<T> = T extends unknown ? Omit<T, "nonce"> : never;
const START = Date.parse("2026-10-06T10:00:00.000Z");
const owner = simKey("owner");
const homes: string[] = [];
afterAll(() => homes.forEach((h) => rmSync(h, { recursive: true, force: true })));

describe("the account names each key-file venue's own file", () => {
  it("two OKX accounts, each from its own file: venues[].keyFile is the file each was signed with — a path, not what is in it", async () => {
    const home = mkdtempSync(join(tmpdir(), "rekey-"));
    homes.push(home);
    const key = { apiKey: "made-up-key-0001", secret: "made-up-secret-0001", password: "made-up-passphrase" };
    for (const ref of ["credentials/okx/api-key.json", "credentials/okx2/key.json"]) {
      const path = join(home, ref);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(key));
      chmodSync(path, 0o600);
    }
    const client = { id: "okx", name: "OKX", requiredCredentials: { apiKey: true, secret: true, password: true }, markets: {}, loadMarkets: async () => ({}), fetchTime: async () => 1, fetchBalance: async () => ({ total: { USDT: 100 } }), fetchTickers: async () => ({}), privateGetAccountConfig: async () => ({ data: [{ perm: "read_only", ip: "", acctLv: "2" }] }) } as unknown as ExchangeClient;
    const open: OpenExchange = async (id) => (id === "okx" ? client : undefined);
    const liveDeps: Partial<LiveDeps> = { openExchange: open, clock: () => START, http: async () => ({ status: 599, body: undefined, text: "no network in tests" }), price: async () => undefined };
    let n = 0;
    const svc = await PortfolioService.create({ home, now: () => new Date(START).toISOString(), venues: "frontline", real: true, liveDeps, publicMarkets: [], account: { owners: [{ id: owner.address, kind: "eoa" as const, label: "owner", addedAt: new Date(START).toISOString() }] } });
    await svc.restoring;
    const own = async (a: NoNonce<OwnerAction>) => svc.exchange(await signOwner(owner, { ...a, nonce: START + ++n } as OwnerAction));
    for (const [venue, label, credentialRef] of [["okx", "OKX", ""], ["okx-trading", "OKX Trading", "credentials/okx2/key.json"]] as const) {
      const r = await own({ type: "connectVenue", venue, connector: "live:exchange:okx", label, credentialRef });
      if (isRefusal(r)) throw new Error(r.message);
    }
    const page = (await svc.accountView())!;
    expect(page.venues.filter((v) => v.live).map((v) => [v.id, v.connector, v.keyFile])).toEqual([
      ["okx", "live:exchange:okx", "credentials/okx/api-key.json"],
      ["okx-trading", "live:exchange:okx", "credentials/okx2/key.json"],
    ]);
    expect(JSON.stringify(page)).not.toContain("made-up");
  });
});
