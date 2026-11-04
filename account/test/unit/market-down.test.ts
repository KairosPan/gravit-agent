/** THE MARKET IS DOWN (plan A1 task 5): an account on the market's link whose market stops answering. Its paper holdings are still shown,
 * at their last price, and marked old in the account's one sentence for it (MARKET_DOWN); a prepare that needs a price refuses in those
 * words; a resting paper order the mirror's last quote crosses does not fill, since nobody confirms that price now; no net-worth point is
 * taken at an old price. Once the market answers again the mark goes, the order fills on the live quote, and a paper account's price
 * answers again within seconds — not after the account's twenty-second hold of a venue that did not answer. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isRefusal, type Refusal } from "../../src/core/errors.ts";
import type { Outcome } from "../../src/portfolio/account/exchange.ts";
import { signOwner, simKey, type OwnerAction } from "../../src/portfolio/account/sign.ts";
import { MARKET_DOWN } from "../../src/portfolio/market/client.ts";
import { connectMarket, type MarketLink } from "../../src/portfolio/market/link.ts";
import { startPortfolioServer, type PortfolioServerHandle } from "../../src/portfolio/server.ts";
import { PortfolioService } from "../../src/portfolio/service.ts";
import type { MarketServerHandle } from "../../../market/src/server.ts";
import { createMarketCore, fakeHub, fakeSource, freePort, listing, startMarket } from "../market-fakes.ts";

type NoNonce<T> = T extends unknown ? Omit<T, "nonce"> : never;
const START = Date.parse("2026-10-14T15:00:00Z");
const SRC = "coinbase";
const SYM = "BTC/USD";
const QTY = 0.1;
const owner = simKey("owner");
const homes: string[] = [];
afterAll(() => {
  for (const h of homes) rmSync(h, { recursive: true, force: true });
});

const until = async (ok: () => boolean | Promise<boolean>, ms = 6_000): Promise<void> => {
  const t0 = Date.now();
  while (!(await ok())) {
    if (Date.now() - t0 > ms) throw new Error("timed out");
    await new Promise((go) => setTimeout(go, 25));
  }
};
const rows = () => [listing(SYM, 100, { bid: 99.5, ask: 100 })];
const price = async (asset: string) => (asset === "BTC" ? 100 : undefined);

/** a market on `port` over a fresh fake hub (a market process started again counts its seqs from 0) */
async function marketOn(port: number) {
  const hub = fakeHub();
  const m = await startMarket(createMarketCore({ sources: [fakeSource({ id: SRC, rows: rows() })], hub: hub.hub, price }), port);
  return { hub, m };
}

/** an account on `link`, its paper account connected, served — its paper clock the real one moved by `shift.ms` */
async function accountOn(link: MarketLink, shift: { ms: number }) {
  const home = mkdtempSync(join(tmpdir(), "market-down-"));
  homes.push(home);
  const svc = await PortfolioService.create({
    home,
    now: () => new Date(START).toISOString(),
    venues: "frontline",
    real: true,
    publicMarkets: () => link.sources(),
    streams: link.hub,
    marketOld: () => link.marketOld(),
    liveDeps: { clock: () => Date.now() + shift.ms, http: async () => ({ status: 599, body: undefined, text: "" }), price: link.price },
    liveWrites: { capUsd: 100, pairingCode: "K7QX-M2PA" },
    account: { owners: [{ id: owner.address, kind: "eoa", label: "owner", addedAt: new Date(START).toISOString() }] },
  });
  let n = 0;
  const own = async (a: NoNonce<OwnerAction>): Promise<Outcome | Refusal> => svc.exchange(await signOwner(owner, { ...a, nonce: START + ++n } as OwnerAction));
  const r = await own({ type: "connectVenue", venue: "paper-1", connector: "live:paper", label: "", credentialRef: "" });
  if (isRefusal(r)) throw new Error(r.message);
  const order = async (draft: Record<string, unknown>) => {
    const p = await svc.account!.prepare({ type: "liveOrder", venue: "paper-1", ...draft });
    if (isRefusal(p)) throw new Error(p.message);
    const { nonce: _n, ...rest } = p.action as Extract<OwnerAction, { type: "liveOrder" }>;
    const done = await own(rest as NoNonce<OwnerAction>);
    if (isRefusal(done) || done.kind !== "order") throw new Error(`expected an order, got ${isRefusal(done) ? done.message : done.kind}`);
    return done.order;
  };
  const srv = await startPortfolioServer({ port: 0, service: svc, snapshotMs: 0, market: link });
  svc.watchStreams();
  return { svc, srv, order };
}

describe("the market is down", () => {
  const shift = { ms: 0 };
  let port: number;
  let link: MarketLink;
  let market: MarketServerHandle | undefined;
  /** the market's hub once it is started again */
  let backHub: ReturnType<typeof fakeHub> | undefined;
  let svc: PortfolioService;
  let srv: PortfolioServerHandle;
  let resting: { id: string };
  let release: () => void;
  /** when the mirror's last quote, ask 90, was seen at the market */
  let crossedAt: number;
  const holdings = async () => {
    const r = await fetch(`${srv.url}/api/account/holdings?paper=1`);
    return { status: r.status, body: (await r.json()) as { rows: Array<{ asset?: string; key?: string; usd: number; qty?: number }>; marketOld?: { since: string; message: string } } };
  };
  const status = async () => ((await (await fetch(`${srv.url}/api/account`)).json()) as { orders: Array<{ id: string; status: string; avgPrice?: number }> }).orders.find((x) => x.id === resting.id);

  beforeAll(async () => {
    port = await freePort();
    const up = await marketOn(port);
    market = up.m;
    link = connectMarket({ url: up.m.url });
    link.start();
    expect(await link.ready(3_000)).toBe(true);
    const a = await accountOn(link, shift);
    ({ svc, srv } = a);
    const order = a.order;
    // a paper buy at the market, filled at the market's 100
    const bought = await order({ symbol: SYM, side: "buy", orderType: "market", qty: String(QTY) });
    expect(bought).toMatchObject({ status: "filled", avgPrice: 100 });
    // a limit buy at 95 rests: the market asks 100
    resting = await order({ symbol: SYM, side: "buy", orderType: "limit", qty: String(QTY), limitPrice: "95" });
    expect(resting).toMatchObject({ status: "open" });
    release = link.hub.hold(SRC, SYM);
    await until(() => up.hub.seen.holds.includes(`${SRC}|${SYM}`));
    // the mirror's last quote crosses the limit (ask 90) — seen while the paper clock runs five seconds ahead, so it is too old to fill at
    // then; once the market is down the clock is put back to just after it, so its age would let it fill: only its being unconfirmed stops it
    shift.ms = 5_000;
    crossedAt = Date.now();
    up.hub.quote(SRC, SYM, { bid: 89.5, ask: 90, last: 100, at: crossedAt, recvAt: crossedAt, seenAt: crossedAt });
    await until(() => link.hub.quote(SRC, SYM)?.ask === 90);
    await new Promise((go) => setTimeout(go, 200));
    expect((await status())?.status).toBe("open");
    // the market stops
    await up.m.close();
    market = undefined;
    await until(() => link.hub.quote(SRC, SYM)?.live === false);
    shift.ms = 0;
  }, 30_000);
  afterAll(async () => {
    release?.();
    await srv?.close().catch(() => undefined);
    link?.close();
    await market?.close();
  });

  it("still shows the paper holdings while the market is down, at their last price, marked old", async () => {
    // the account learns the market is down on its first read that is not answered
    await until(async () => (await holdings()).body.marketOld !== undefined, 8_000);
    const { status: code, body } = await holdings();
    expect(code).toBe(200);
    const btc = body.rows.find((r) => r.asset === "BTC");
    expect(btc?.usd).toBeCloseTo(QTY * 100, 6);
    expect(body.marketOld?.message).toBe(MARKET_DOWN);
    expect(Number.isFinite(Date.parse(body.marketOld!.since))).toBe(true);
  });

  it("refuses a prepare that needs a price, in plain words", async () => {
    const prepare = () => fetch(`${srv.url}/api/account/prepare`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ draft: { type: "liveOrder", venue: "paper-1", symbol: SYM, side: "buy", qty: 1, orderType: "market" } }) });
    // the market's last line is kept its few seconds (a fill still takes only a price a second old); past them, nothing gives a price
    let r = await prepare();
    await until(async () => (r = await prepare()).status !== 200, 8_000);
    expect(r.status).toBe(409);
    const body = (await r.json()) as { refusal: Refusal };
    expect(body.refusal.message).toContain("market service is not answering");
  });

  it("takes no net-worth point while prices are old", async () => {
    const r = await svc.snapshot();
    expect(r).toMatchObject({ written: false });
    expect(Number.isFinite(Date.parse((r as { at: string }).at))).toBe(true);
  });

  it("fills no resting paper order while the market is down", async () => {
    // the paper clock just after the mirror's quote at ask 90: by its age it could fill, but the mirror is not live and nobody confirms it
    shift.ms = crossedAt + 100 - Date.now();
    for (let i = 0; i < 4; i++) {
      await svc.lookAtPaper();
      await new Promise((go) => setTimeout(go, 50));
      shift.ms = crossedAt + 100 - Date.now();
    }
    shift.ms = 0;
    expect((await status())?.status).toBe("open");
  });

  it("drops the mark once the market answers again", async () => {
    const back = await marketOn(port);
    market = back.m;
    backHub = back.hub;
    await until(async () => (await holdings()).body.marketOld === undefined, 8_000);
    expect(link.marketOld()).toBeUndefined();
  });

  it("fills it once the market is back", async () => {
    // the mirror's stream opens again and holds the market again; the market's live quote at ask 90 reaches the paper account
    await until(() => backHub!.seen.holds.includes(`${SRC}|${SYM}`), 10_000);
    await until(async () => {
      backHub!.quote(SRC, SYM, { bid: 89.5, ask: 90, last: 90 });
      await new Promise((go) => setTimeout(go, 100));
      return (await status())?.status === "filled";
    }, 6_000);
    const done = await status();
    expect(done?.status).toBe("filled");
    expect(done?.avgPrice).toBeLessThanOrEqual(95);
  }, 20_000);
});

describe("the market comes back", () => {
  it("a paper account's price answers again within seconds of the market's answering, not after a twenty-second hold", async () => {
    // the read cache's short keep of a market-down refusal (service.ts ReadCache: marketWasDown → MARKET_DOWN_HOLD_MS), over a paper venue
    const port = await freePort();
    let m: MarketServerHandle | undefined = (await marketOn(port)).m;
    const link = connectMarket({ url: m.url });
    link.start();
    expect(await link.ready(3_000)).toBe(true);
    const { svc, srv } = await accountOn(link, { ms: 0 });
    const priced = async () => {
      const q = await svc.connectedQuotes([{ venue: "paper-1", symbol: SYM }]);
      if (isRefusal(q)) throw new Error(q.message);
      return q[0]!.market !== undefined;
    };
    try {
      expect(await priced()).toBe(true);
      await m.close();
      m = undefined;
      // asked while the market is down: the paper account's price is refused in the market-down sentence, and the account holds the
      // source back — for MARKET_DOWN_HOLD_MS only (service.ts ReadCache: marketWasDown), not a venue's twenty seconds
      await until(async () => !(await priced()), 15_000);
      m = (await marketOn(port)).m;
      const t0 = Date.now();
      await until(() => priced(), 15_000);
      expect(Date.now() - t0).toBeLessThan(3_500);
    } finally {
      await srv.close().catch(() => undefined);
      link.close();
      await m?.close();
    }
  }, 60_000);
});
