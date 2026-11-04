/** THE EXPLORE JOIN SAYS WHAT THE ACCOUNT'S EXPLORE SAID (plan A2 Task 6, deleted again in Task 7 with the account's explore): the face's
 * client joins the market's explore (market/src/reads.ts) and the account's connected explore (service.ts connectedExplore) in its host
 * (face/client/js/host/explore-join.js). Over a public source and a paper venue, that join lists the same rows as the account's own
 * explore of both, each with the same lines — the moments and the order aside. Nothing leaves the process. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { isRefusal } from "../../src/core/errors.ts";
import { signOwner, simKey, type OwnerAction } from "../../src/portfolio/account/sign.ts";
import { PortfolioService } from "../../src/portfolio/service.ts";
import { createMarketCore } from "../../../market/src/core.ts";
import { marketReads } from "../../../market/src/reads.ts";
import { fakeSource } from "../../../market/test/fakes.ts";

type NoNonce<T> = T extends unknown ? Omit<T, "nonce"> : never;
type Line = { venue: string; symbol: string; connected: boolean };
type Row = { key: string; at?: Line[]; outcomes?: Array<{ at?: Line[] }> };
type Body = { items: Row[] };
type Join = (market: unknown, connected: unknown, o: { venues: Array<{ id: string; connector: string; paper: boolean }>; here: unknown[] }) => Body | null;

const START = Date.parse("2026-10-14T15:00:00Z");
const owner = simKey("owner");
const homes: string[] = [];
afterAll(() => {
  for (const h of homes) rmSync(h, { recursive: true, force: true });
});

// the face's plain-ESM module, asked by a path the type checker does not follow (the account's tsconfig takes no JS)
const JOIN_MODULE = "../../../face/client/js/host/explore-join.js";
const loadJoin = async (): Promise<Join> => ((await import(JOIN_MODULE as string)) as { joinExplore: Join }).joinExplore;

/** each row's key with its lines (an event's outcomes' among them), as `venue|symbol|connected`, in no order */
function linesByKey(body: Body): Map<string, string[]> {
  return new Map(body.items.map((r) => {
    const lines = [...(r.at ?? []), ...(r.outcomes ?? []).flatMap((o) => o.at ?? [])].map((l) => `${l.venue}|${l.symbol}|${l.connected}`);
    return [r.key, [...new Set(lines)].sort()];
  }));
}

describe("the explore join (face/client/js/host/explore-join.js) beside the account's explore", () => {
  it("the join of the market's explore and the connected explore lists what the account's explore lists", async () => {
    const home = mkdtempSync(join(tmpdir(), "explore-join-parity-"));
    homes.push(home);
    const svc = await PortfolioService.create({
      home,
      now: () => new Date(START).toISOString(),
      venues: "frontline",
      real: true,
      publicMarkets: [fakeSource()],
      liveDeps: { clock: () => Date.now(), http: async () => ({ status: 599, body: undefined, text: "" }), price: async () => undefined },
      liveWrites: { capUsd: 100, pairingCode: "K7QX-M2PA" },
      account: { owners: [{ id: owner.address, kind: "eoa", label: "owner", addedAt: new Date(START).toISOString() }] },
    });
    let n = 0;
    const own = async (a: NoNonce<OwnerAction>) => svc.exchange(await signOwner(owner, { ...a, nonce: START + ++n } as OwnerAction));
    const r = await own({ type: "connectVenue", venue: "paper-1", connector: "live:paper", label: "", credentialRef: "" });
    if (isRefusal(r)) throw new Error(r.message);
    const core = createMarketCore({ sources: [fakeSource()] });
    const joinExplore = await loadJoin();

    const old = await svc.explore({ q: "BTC" });
    const market = await marketReads(core).explore({ q: "BTC" });
    const connected = await svc.connectedExplore({ q: "BTC" });
    if (isRefusal(old) || isRefusal(market) || isRefusal(connected)) throw new Error("a read refused");
    // each half as its route answers it (answerOf: `ok: true` beside the exploration)
    const joined = joinExplore({ ok: true, ...market }, { ok: true, ...connected }, { venues: [{ id: "paper-1", connector: "live:paper", paper: true }], here: [] });
    expect(joined).not.toBeNull();

    const was = linesByKey(old as unknown as Body);
    const now = linesByKey(joined as Body);
    expect(was.size).toBeGreaterThan(0);
    expect([...now.keys()].sort()).toEqual([...was.keys()].sort());
    for (const [key, lines] of was) expect(now.get(key), key).toEqual(lines);
    // both a public line and the paper venue's: the join is of two halves, not one
    const all = [...now.values()].flat();
    expect(all.some((l) => l.endsWith("|true"))).toBe(true);
    expect(all.some((l) => l.endsWith("|false"))).toBe(true);
  });
});
