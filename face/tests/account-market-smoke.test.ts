/** The Market half and Rules on a real boot (plan 4a Task 6): the Account's own stand-in (no network, a fresh temp home),
 * the face booted in a scratch home with the seat row off and the proxy registered on its web server with the stand-in's
 * URL — the boot of `account-graft-smoke` — and every call to the face's own port, never the stand-in's.
 *
 * As the page reads them: the ETH perpetual's asset sheet under `assetKeyOf` (the Account's own page's key rule), the book
 * and latest trades at the line the page follows (`followOf`), and funding read once with no venue (the market page's one
 * read). Then the face's own owner device (`client/js/host/owner.js` under Node, `helpers/owner-node.ts`), paired with the
 * code the stand-in printed, signs what the screens' sheets draft — each draft built by the client's own pure modules from
 * the rows the page reads (`amendSeedOf`/`closeSeedOf`/`leverageSeedOf` + `marketDraftOf`, `rulesDraftOf`): a Change of
 * the stand-in's resting SOL limit buy, 3x on the ETH perpetual, a Close of half its long; and the Rules: Guard unsigned
 * through `/data/account/guard` (whatever body the browser posts, the Account receives `{"mode":"guard"}`), the cap, the
 * session, the agents' leverage and Beast signed, and Guard again. The fences: a foreign origin's Guard and a fetch of the
 * OAuth callback are 403; a top-level navigation to the callback is the Account's page under the face's headers. Nothing of
 * a body (the pairing code, a signature sent) is in what the face's process wrote.
 *
 * Skipped unless `FACE_SMOKE=1` and the repo's `account/` is installed. ONE BOOT PER PROCESS (smoke.test.ts header):
 * `bootFace` sets `process.env.DSH_HOME`, so this is its own file; the scratch home is a `mkdtemp` directory, never `~/.dsh`;
 * the stand-in takes a free port, never 4820, and nothing is written under `~/.buyer-agent-demo`. */
import { DEAD_MARKET_URL } from "./helpers/no-market.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { setupFaceProfile } from "../src/setup.ts";
import { bootFace } from "../src/boot.ts";
import { registerAccountProxy } from "../src/account-proxy.ts";
import { registerMarketProxy } from "../src/market-proxy.ts";
import { makeBotsRoot } from "./bots-fixture.ts";
import { freePort, standinSkip, startStandin, stopStandin, type Standin } from "./helpers/standin.ts";
import { startOwnerNode, type OwnerAnswer, type OwnerNode } from "./helpers/owner-node.ts";
import { followOf } from "../client/js/host/market-view.js";
import { joinExplore } from "../client/js/host/explore-join.js";
import { venuesOf } from "../client/js/host/account-view.js";
import { assetKeyOf, hereOf } from "../client/js/host/market-depth-view.js";
import { openOrdersOf, positionsOf, writesOn } from "../client/js/host/account-view.js";
import { amendSeedOf, closeSeedOf, leverageSeedOf, marketDraftOf } from "../client/js/host/sheet-market.js";
import { rulesDraftOf } from "../client/js/host/sheet-rules.js";
import { rulesOf } from "../client/js/host/rules-view.js";
import { BOOK_DEPTH, FUNDING_LIMIT, TRADES_LIMIT } from "../client/js/host/markets.js";

const skip = standinSkip();

/** The stand-in's ETH perpetual at its exchange, where it seeds 5x and a long of 0.05 (ui-standin.ts). */
const ETH_PERP = "ETH/USDT:USDT";
/** The stand-in's exchange: its venue id. */
const EXCHANGE = "ex";

/** Everything this process writes to stdout and stderr from now on — the face runs in it — still written through. */
function captureOutput(): { text: () => string; restore: () => void } {
  const heard: string[] = [];
  const tee = (stream: NodeJS.WriteStream): (() => void) => {
    const write = stream.write.bind(stream);
    stream.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
      heard.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return (write as (...args: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof stream.write;
    return () => { stream.write = write; };
  };
  const undo = [tee(process.stdout), tee(process.stderr)];
  return { text: () => heard.join(""), restore: () => { for (const back of undo) back(); } };
}

type Body = Record<string, unknown>;
/** An answer as the assertion message shows it: its status and the start of its body. */
const shown = (r: OwnerAnswer): string => `${r.status} ${JSON.stringify(r.body).slice(0, 600)}`;

test("account market smoke: through the face's port, the owner closes, changes and sets leverage, reads a market's depth, and rules the agents", {
  skip, timeout: 300_000,
}, async () => {
  const standin: Standin = await startStandin(await freePort());
  const home = mkdtempSync(join(tmpdir(), "face-market-home-"));
  const wasUrl = process.env.FACE_ACCOUNT_URL;
  let dispose: (() => Promise<void>) | undefined;
  let disposeProxy: (() => void) | undefined;
  let disposeMarket: (() => void) | undefined;
  let device: OwnerNode | undefined;
  const output = captureOutput();
  try {
    /* A scratch face home, the seat row off; the face booted with the stand-in as its Account. */
    setupFaceProfile(home);
    const patchPath = join(home, "profiles", "face", "cordis.patch.yml");
    writeFileSync(patchPath, `${readFileSync(patchPath, "utf8").replace(/^\[\][ \t]*$/m, "")}\n- id: mcp-account\n  disabled: true\n`);
    process.env.FACE_ACCOUNT_URL = standin.url;
    /* The mcp-market row, spawned at the boot, points at the stand-in's own market, never a live one on 4821. */
    process.env.FACE_MARKET_URL = standin.marketUrl;
    const booted = await bootFace({ profileName: "face", port: 0, dshHome: home, botsRoot: await makeBotsRoot() });
    dispose = booted.dispose;
    const proxy = registerAccountProxy(booted.ctx.webServer, { url: standin.url });
    disposeProxy = proxy.dispose;
    /* the market's half beside it, as main.ts registers it: the stand-in's own market */
    disposeMarket = registerMarketProxy(booted.ctx.webServer, { url: standin.marketUrl }).dispose;
    const base = `http://127.0.0.1:${booted.ctx.webServer.port}`;
    const said = `\nstand-in:\n${standin.log()}`;
    const get = async (path: string, init?: RequestInit): Promise<{ status: number; body: Body }> => {
      const res = await fetch(`${base}${path}`, init);
      const text = await res.text();
      let body: Body;
      try { body = JSON.parse(text) as Body; } catch { body = { text: text.slice(0, 400) }; }
      return { status: res.status, body };
    };
    const pageNow = async (): Promise<Body> => {
      const page = await get("/data/account?fresh=1");
      assert.equal(page.status, 200, JSON.stringify(page.body).slice(0, 400) + said);
      return page.body;
    };

    /* 1. Paired with the code the stand-in printed. */
    device = startOwnerNode(base);
    const { owner } = device;
    await owner.ready(standin.code);
    assert.equal(device.standing().role, "signs", `the device signs: ${JSON.stringify(device.standing())}${said}`);
    const page0 = await pageNow();
    assert.ok(writesOn(page0), `the stand-in takes writes: ${JSON.stringify(page0.connectLive)}`);

    /* 2. Reads, as a market's page asks them (plan A2 Task 6): the ETH perpetual from the perpetuals tab — the stand-in's
     * market's explore joined with the Account's connected explore, as the Markets host joins them — its asset sheet under the
     * Account's key, its book and latest trades at the line the page follows (a connected line's from the Account's connected
     * routes, a public one's from the market), and funding read once with no venue. */
    const perps = await get("/data/market/explore?tab=perps");
    assert.equal(perps.status, 200, JSON.stringify(perps.body).slice(0, 400));
    const connectedPerps = await get("/data/account/connected/explore?tab=perps");
    assert.equal(connectedPerps.status, 200, JSON.stringify(connectedPerps.body).slice(0, 400));
    const joined = joinExplore(perps.body, connectedPerps.body, { venues: venuesOf(page0), here: [] }) as Body | null;
    assert.ok(joined, "the two halves join");
    const items = (joined.items ?? []) as Body[];
    const ethPerp = items.find((item) => item.kind === "perp" && String(item.base).toUpperCase() === "ETH");
    assert.ok(ethPerp, `the ETH perpetual is listed: ${JSON.stringify(items.map((i) => [i.kind, i.base])).slice(0, 600)}`);
    const key = assetKeyOf(ethPerp);
    assert.equal(key, "crypto:ETH");
    const asset = await get(`/data/account/asset?key=${encodeURIComponent(key)}`);
    assert.equal(asset.status, 200, JSON.stringify(asset.body).slice(0, 600));
    assert.equal(asset.body.ok, true, JSON.stringify(asset.body).slice(0, 600));
    assert.ok(Array.isArray(asset.body.positions), `the asset sheet carries positions: ${JSON.stringify(asset.body).slice(0, 600)}`);
    const leg = followOf(ethPerp) as { venue: string; symbol: string } | null;
    assert.ok(leg, `a line the page follows: ${JSON.stringify(ethPerp.at)}`);
    const at = `venue=${encodeURIComponent(leg.venue)}&symbol=${encodeURIComponent(leg.symbol)}`;
    const half = (leg as { connected?: boolean }).connected ? "/data/account/connected" : "/data/market";
    const book = await get(`${half}/book?${at}&depth=${BOOK_DEPTH}`);
    assert.equal(book.status, 200, JSON.stringify(book.body).slice(0, 400));
    assert.equal(book.body.ok, true, JSON.stringify(book.body).slice(0, 400));
    const trades = await get(`${half}/trades?${at}&limit=${TRADES_LIMIT}`);
    assert.equal(trades.status, 200, JSON.stringify(trades.body).slice(0, 400));
    assert.equal(trades.body.ok, true, JSON.stringify(trades.body).slice(0, 400));
    /* Funding is one read with no venue (Task 4's ruling, the Account's own terminal's read); the brief's per-venue read
     * of the stand-in's exchange is asked too, and answers whatever the Account says of it, passed through. */
    const funding = await get(`/data/account/funding?limit=${FUNDING_LIMIT}`);
    assert.equal(funding.status, 200, JSON.stringify(funding.body).slice(0, 400));
    assert.equal(funding.body.ok, true, JSON.stringify(funding.body).slice(0, 400));
    assert.ok(Array.isArray(funding.body.lines), `funding carries lines: ${JSON.stringify(funding.body).slice(0, 400)}`);
    const fundingAtEx = await get(`/data/account/funding?venue=${EXCHANGE}`);
    assert.ok(fundingAtEx.status === 200 || fundingAtEx.status === 409, `funding at ${EXCHANGE}: ${fundingAtEx.status} ${JSON.stringify(fundingAtEx.body).slice(0, 400)}`);
    if (fundingAtEx.status === 200) assert.ok(Array.isArray(fundingAtEx.body.lines), JSON.stringify(fundingAtEx.body).slice(0, 400));

    /* 3. Change: the resting SOL limit buy the stand-in seeds, its limit moved 10 % lower (so it rests), drafted as Change… drafts it. */
    const solOrder = openOrdersOf(page0).find((o: { who: string; symbol: string; side: string; type: string; venue: string }) =>
      o.who === "You" && o.venue === EXCHANGE && o.symbol === "SOL/USDT" && o.side === "buy" && o.type === "limit");
    assert.ok(solOrder, `the seeded SOL limit buy rests: ${JSON.stringify(openOrdersOf(page0)).slice(0, 800)}`);
    const amendSeed = amendSeedOf(solOrder, page0);
    assert.ok(amendSeed, `the page offers Change… on ${solOrder.id}: ${JSON.stringify(page0.venues).slice(0, 600)}`);
    const wasLimit = solOrder.limitPrice;
    assert.ok(typeof wasLimit === "number" && wasLimit > 0, JSON.stringify(solOrder));
    const newLimit = String(Number((Math.floor(wasLimit * 0.9 * 100) / 100).toFixed(2)));
    const amendDraft = marketDraftOf("amend", { limitPrice: newLimit }, amendSeed);
    assert.equal(typeof amendDraft, "object", String(amendDraft));
    const amended = await owner.act(amendDraft as Body);
    assert.equal(amended.status, 200, shown(amended));
    assert.notEqual(amended.body.ok, false, shown(amended));
    const changed = openOrdersOf(await pageNow()).find((o: { id: string }) => o.id === solOrder.id);
    assert.ok(changed, `${solOrder.id} still rests after its Change`);
    assert.equal(changed.limitPrice, Number(newLimit), `the page's order shows the new price: ${JSON.stringify(changed)}`);

    /* The ETH perpetual's position, as the asset sheet (You here) and the Portfolio read it. */
    type Position = { venue: string; symbol: string; side: string; qty: number | null; leverage: number | null; kind: string };
    const ethPosition = async (): Promise<Position> => {
      const fresh = await get(`/data/account/asset?key=${encodeURIComponent(key)}&fresh=1`);
      assert.equal(fresh.body.ok, true, JSON.stringify(fresh.body).slice(0, 600));
      const here = hereOf(fresh.body, page0) as { positions: Position[] };
      const held = here.positions.find((p) => p.venue === EXCHANGE && p.symbol === ETH_PERP);
      assert.ok(held, `the ETH perpetual is held: ${JSON.stringify(here.positions)}`);
      return held;
    };
    const before = await ethPosition();
    assert.equal(before.kind, "perp");
    assert.equal(before.side, "long", JSON.stringify(before));

    /* 4. Leverage: 3x on the ETH perpetual, drafted as Leverage… drafts it; the position reads 3. */
    const leverageSeed = leverageSeedOf(before, page0);
    assert.ok(leverageSeed, `the page offers Leverage… on the ETH perpetual: ${JSON.stringify(before)}`);
    const leverageDraft = marketDraftOf("leverage", { leverage: "3" }, leverageSeed);
    assert.equal(typeof leverageDraft, "object", String(leverageDraft));
    const levered = await owner.act(leverageDraft as Body);
    assert.equal(levered.status, 200, shown(levered));
    assert.notEqual(levered.body.ok, false, shown(levered));
    const atThree = await ethPosition();
    assert.equal(atThree.leverage, 3, `the position's leverage: ${JSON.stringify(atThree)}`);

    /* 5. Close: half the long, drafted as Close… drafts it; the position's quantity is halved. The venue sizes the
     * perpetual in steps (its market read's `qtyStep`; 0.01 ETH on the stand-in), so half is taken down to a step, and
     * the position keeps what was not closed. */
    const ofQty = before.qty as number;
    assert.ok(typeof ofQty === "number" && ofQty > 0, JSON.stringify(before));
    const perpMarket = await get(`/data/account/market?venue=${EXCHANGE}&symbol=${encodeURIComponent(ETH_PERP)}`);
    const qtyStep = (perpMarket.body.market as { qtyStep?: unknown } | undefined)?.qtyStep;
    const step = typeof qtyStep === "number" && qtyStep > 0 ? qtyStep : 0.01;
    const halfQty = Number((Math.floor(ofQty / 2 / step + 1e-9) * step).toFixed(8));
    assert.ok(halfQty > 0, `half of ${ofQty} in steps of ${step}`);
    const closeDraft = marketDraftOf("close", { qty: String(halfQty) }, closeSeedOf(before));
    assert.equal(typeof closeDraft, "object", String(closeDraft));
    const closed = await owner.act(closeDraft as Body);
    assert.equal(closed.status, 200, shown(closed));
    assert.notEqual(closed.body.ok, false, shown(closed));
    const halved = await ethPosition();
    assert.ok(Math.abs((halved.qty as number) - (ofQty - halfQty)) <= step / 100, `the position is halved: ${ofQty} → ${halved.qty}, ${halfQty} closed`);

    /* 6. Rules. Guard, unsigned, with a body asking for Beast: the face sends the Account its fixed body, so the page reads
     * Guard. Then the cap, the session, the agents' leverage and Beast signed as the Rules tab's sheets draft them; Guard again. */
    const guard = (headers: Record<string, string> = {}): Promise<{ status: number; body: Body }> =>
      get("/data/account/guard", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: '{"mode":"open"}' });
    const guarded = await guard();
    assert.equal(guarded.status, 200, JSON.stringify(guarded.body));
    assert.equal((await pageNow()).mode, "guard");
    const sign = async (kind: string, fields: Body, seed: Body): Promise<Body> => {
      const draft = rulesDraftOf(kind, fields, seed);
      assert.equal(typeof draft, "object", `${kind}: ${String(draft)}`);
      const answer = await owner.act(draft as Body);
      assert.equal(answer.status, 200, `${kind}: ${shown(answer)}`);
      assert.notEqual(answer.body.ok, false, `${kind}: ${shown(answer)}`);
      return pageNow();
    };
    const capped = await sign("cap", { cap: "300" }, { capUsd: rulesOf(page0, Date.now()).cap?.usd });
    assert.equal((capped.connectLive as { writes?: { capUsd?: unknown } }).writes?.capUsd, 300, JSON.stringify(capped.connectLive));
    const renewed = await sign("session", {}, { ended: rulesOf(capped, Date.now()).session?.ended });
    assert.equal((renewed.dial as { sessionEnded?: unknown }).sessionEnded, false, JSON.stringify(renewed.dial));
    assert.equal(rulesOf(renewed, Date.now()).session?.ended, false);
    const levelled = await sign("leverageCap", { max: "3" }, { max: rulesOf(renewed, Date.now()).leverage?.max });
    assert.equal((levelled.dial as { maxLeverage?: unknown }).maxLeverage, 3, JSON.stringify(levelled.dial));
    const beast = await sign("beast", {}, {});
    assert.equal(beast.mode, "open");
    assert.equal(rulesOf(beast, Date.now()).mode, "open");
    const guardedAgain = await guard();
    assert.equal(guardedAgain.status, 200, JSON.stringify(guardedAgain.body));
    assert.equal((await pageNow()).mode, "guard", "Guard again: the fixed body went, not the browser's");

    /* 7. The fences: Guard from a foreign origin, and a fetch (not a navigation) of the OAuth callback, are refused before
     * the Account is asked; a top-level navigation to the callback is the Account's own page, under the face's headers. */
    const foreign = await guard({ origin: "https://evil.example" });
    assert.equal(foreign.status, 403, JSON.stringify(foreign.body));
    assert.equal((await pageNow()).mode, "guard");
    const fetched = await fetch(`${base}/data/account/signin/callback?state=smoke`, { headers: { "sec-fetch-mode": "cors" } });
    assert.equal(fetched.status, 403);
    await fetched.body?.cancel();
    /* Node's fetch always says `sec-fetch-mode: cors`, so the navigation a venue's redirect makes is sent with node:http. */
    const navigated = await new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; text: string }>((done, fail) => {
      const req = request(`${base}/data/account/signin/callback?state=smoke&code=nothing`, {
        headers: { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", "sec-fetch-site": "cross-site" },
      }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => { text += chunk; });
        res.on("end", () => done({ status: res.statusCode ?? 0, headers: res.headers, text }));
      });
      req.on("error", fail);
      req.end();
    });
    assert.notEqual(navigated.status, 403, navigated.text.slice(0, 400));
    assert.notEqual(navigated.status, 503, `the Account answered the callback: ${navigated.text.slice(0, 400)}`);
    assert.match(String(navigated.headers["content-type"]), /^text\/html/);
    assert.match(String(navigated.headers["content-security-policy"]), /default-src 'none'/);
    assert.equal(navigated.headers["cache-control"], "no-store");

    /* 8. Nothing of a body in what the face said: neither the pairing code nor a signature. */
    const heard = output.text();
    assert.ok(!heard.includes(standin.code), "the pairing code is not in the face's output");
    const signatures = device.signatures();
    /* the change, the leverage, the close, the cap, the session, the agents' leverage, Beast */
    assert.equal(signatures.length, 7, `seven signatures sent; ${signatures.length} kept`);
    assert.ok(signatures.every((signature) => !heard.includes(signature)), "no signature sent is in the face's output");
  } finally {
    output.restore();
    device?.close();
    /* The web server first, then the proxy's open pipes (main.ts's order), then the stand-in and the homes. */
    if (dispose) await dispose();
    disposeProxy?.();
    disposeMarket?.();
    if (wasUrl === undefined) delete process.env.FACE_ACCOUNT_URL; else process.env.FACE_ACCOUNT_URL = wasUrl;
    process.env.FACE_MARKET_URL = DEAD_MARKET_URL;
    await stopStandin(standin);
    await rm(home, { recursive: true, force: true });
  }
});
