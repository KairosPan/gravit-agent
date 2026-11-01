/** The Account grafted into the face, on a real boot (spec 2026-10-22 §10): the Account's own stand-in (no network,
 * a fresh temp home), the face booted with `FACE_ACCOUNT_URL` at it, and the screens' reads asked of the face's own
 * port as the page asks them — the Account's page, its markets, a query the whitelist refuses, its push channel, and
 * the seat box through the proxy's shared reader. Then the owner's half: the face's own owner device
 * (`client/js/host/owner.js`, run under Node by `helpers/owner-node.ts`) pairs with the code the stand-in printed,
 * signs a watch on a market the page does not watch and its removal, a market buy (its fill told on the stream
 * opened before it, the ETH it bought in the Portfolio), a resting limit buy and its cancel, and the approval of the
 * stand-in's seeded card — every call to the face's port, never the stand-in's; a foreign origin's exchange is
 * fenced; and nothing of a body (the pairing code, a signature sent) is in what the face's process wrote.
 *
 * Skipped unless `FACE_SMOKE=1` and the repo's `account/` is installed (`npm ci` there; `FACE_ACCOUNT_SEAT_DIR` names
 * another install), as `account-seat-smoke` is: the install is read, never written; the
 * stand-in takes a free port, never the real Account's 4820. `bootFace` registers no `/data` route (`main.ts` does,
 * after it), so this test registers the proxy and the seat route on the booted web server itself, as `main.ts` does
 * with the composed seat row's URL. The seat row itself is disabled here: no seat process is spawned, so nothing is
 * written under the operator's `~/.buyer-agent-demo`.
 *
 * ONE BOOT PER PROCESS (smoke.test.ts header): `bootFace` sets `process.env.DSH_HOME`, so this is its own file. The
 * scratch home is a `mkdtemp` directory, never `~/.dsh`, and AKShare is disabled. This is the canary for the
 * Account's reads moving under the face, beside `account-seat-smoke`'s for its seat. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupFaceProfile } from "../src/setup.ts";
import { bootFace } from "../src/boot.ts";
import { registerAccountProxy } from "../src/account-proxy.ts";
import { registerSeatRoute, type SeatView } from "../src/seat.ts";
import { makeBotsRoot } from "./bots-fixture.ts";
import { freePort, standinSkip, startStandin, stopStandin, type Standin } from "./helpers/standin.ts";
import { startOwnerNode, type OwnerAnswer, type OwnerNode } from "./helpers/owner-node.ts";

const skip = standinSkip();

/** The stand-in's seeded agent, the seat the box looks for (`account-seat-smoke` admits it under this name). */
const SEEDED_AGENT_NAME = "Claude Code";
/** This reader's name on the stream, in the Account's grammar (8 to 48 letters, digits, dashes or underscores). */
const STREAM_CLIENT = "face-smoke0000000000000000";
/** How long the stream has to tell its first frame. */
const FIRST_FRAME_MS = 5_000;
/** How long the stream has to tell a frame the owner's action caused (a fill, a card answered). */
const ACTION_FRAME_MS = 10_000;
/** A liveOrder draft's optional fields, every one empty, as the Trade ticket sends them (the owner-path map §3.1). */
const ORDER_BLANKS = {
  limitPrice: "", stopPrice: "", tif: "", postOnly: "", reduceOnly: "", extendedHours: "", trailPercent: "", trailPrice: "", takeProfit: "", stopLoss: "",
} as const;

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

/** A frame the stream told: its `event:` name and its `data:` parsed (undefined when it is not JSON). */
interface Frame { event: string; data: unknown }
/** Every named frame an open stream tells, collected as it comes, until the stream ends or is aborted. */
function collectFrames(res: Response): Frame[] {
  const frames: Frame[] = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let heard = "";
  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        heard += decoder.decode(value, { stream: true });
        const blocks = heard.split("\n\n");
        heard = blocks.pop() ?? "";
        for (const block of blocks) {
          const event = /^event: ?(.*)$/m.exec(block)?.[1];
          if (event === undefined) continue;
          const raw = /^data: ?(.*)$/m.exec(block)?.[1] ?? "";
          let data: unknown;
          try { data = JSON.parse(raw); } catch { data = undefined; }
          frames.push({ event, data });
        }
      }
    } catch {
      /* aborted: the collection ends */
    }
  })();
  return frames;
}

/** The first collected frame `matches` takes, waited for up to `ms`; undefined when none came. */
async function frameWithin(frames: Frame[], matches: (frame: Frame) => boolean, ms: number): Promise<Frame | undefined> {
  const deadline = Date.now() + ms;
  for (;;) {
    const found = frames.find(matches);
    if (found !== undefined || Date.now() >= deadline) return found;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const fieldOf = (data: unknown, name: string): unknown => (data !== null && typeof data === "object" ? (data as Record<string, unknown>)[name] : undefined);
/** An answer as the assertion message shows it: its status and the start of its body. */
const shown = (r: OwnerAnswer): string => `${r.status} ${JSON.stringify(r.body).slice(0, 600)}`;

/** The first frame the stream names (an `event:` line, its `data:` with it) within `ms`, or what came instead. */
async function firstFrame(res: Response, ms: number): Promise<{ event: string | undefined; data: string | undefined; heard: string }> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const timer = setTimeout(() => void reader.cancel(), ms);
  let heard = "";
  try {
    for (;;) {
      const blocks = heard.split("\n\n").slice(0, -1);
      const named = blocks.find((block) => /^event:/m.test(block));
      if (named !== undefined) return { event: /^event: ?(.*)$/m.exec(named)?.[1], data: /^data: ?(.*)$/m.exec(named)?.[1], heard };
      const { done, value } = await reader.read();
      if (done) return { event: undefined, data: undefined, heard };
      heard += decoder.decode(value, { stream: true });
    }
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => undefined);
  }
}

test("account graft smoke: the Account's page and markets, a refused query, its push channel and the seat box; then, as the owner's device, a pairing, a watch, two orders and a cancel, a card answered — through the face's own port", {
  skip, timeout: 300_000,
}, async () => {
  const standin: Standin = await startStandin(await freePort());
  const home = mkdtempSync(join(tmpdir(), "face-graft-home-"));
  const wasUrl = process.env.FACE_ACCOUNT_URL;
  let dispose: (() => Promise<void>) | undefined;
  let disposeProxy: (() => void) | undefined;
  let device: OwnerNode | undefined;
  const ownerStream = new AbortController();
  /* What the face's process says, from its boot on: no pairing code and no signature may be in it. */
  const output = captureOutput();
  try {
    /* 1. A scratch face home, AKShare and the seat row off; the face booted with the stand-in as its Account. */
    setupFaceProfile(home);
    const patchPath = join(home, "profiles", "face", "cordis.patch.yml");
    writeFileSync(patchPath, `${readFileSync(patchPath, "utf8").replace(/^\[\][ \t]*$/m, "")}\n- id: mcp-akshare\n  disabled: true\n- id: mcp-account\n  disabled: true\n`);
    process.env.FACE_ACCOUNT_URL = standin.url;
    const booted = await bootFace({ profileName: "face", port: 0, dshHome: home, botsRoot: await makeBotsRoot() });
    dispose = booted.dispose;
    const proxy = registerAccountProxy(booted.ctx.webServer, { url: standin.url });
    disposeProxy = proxy.dispose;
    registerSeatRoute(booted.ctx.webServer, { url: standin.url, seatName: SEEDED_AGENT_NAME, reader: proxy.reader });
    const base = `http://127.0.0.1:${booted.ctx.webServer.port}`;
    const said = `\nstand-in:\n${standin.log()}`;

    /* 2. The Account's page, as the Account answers it. */
    const page = await fetch(`${base}/data/account`);
    const pageBody = await page.json() as { ok?: unknown; venues?: unknown };
    assert.equal(page.status, 200, JSON.stringify(pageBody).slice(0, 400) + said);
    assert.equal(pageBody.ok, true);
    assert.ok(Array.isArray(pageBody.venues) && pageBody.venues.length > 0, `the page names its venues: ${JSON.stringify(pageBody.venues)}`);

    /* 3. Its markets. */
    const explore = await fetch(`${base}/data/account/explore`);
    const exploreBody = await explore.json() as { ok?: unknown; items?: unknown };
    assert.equal(explore.status, 200, JSON.stringify(exploreBody).slice(0, 400));
    assert.ok(Array.isArray(exploreBody.items) && exploreBody.items.length > 0, "explore lists the Account's markets");

    /* 4. A query name the whitelist does not carry: refused by the face, never asked of the Account. */
    const forced = await fetch(`${base}/data/account/explore?force=1`);
    assert.equal(forced.status, 400);
    assert.deepEqual(await forced.json(), { ok: false, error: "invalid account request" });

    /* 5. The push channel, piped: an event stream, and a frame the Account names within 5 s. */
    const abort = new AbortController();
    try {
      const stream = await fetch(`${base}/data/account/stream?client=${STREAM_CLIENT}`, { headers: { accept: "text/event-stream" }, signal: abort.signal });
      if (stream.status !== 200) assert.fail(`the stream answered ${stream.status}: ${(await stream.text()).slice(0, 400)}`);
      assert.match(stream.headers.get("content-type") ?? "", /^text\/event-stream/);
      const frame = await firstFrame(stream, FIRST_FRAME_MS);
      assert.ok(frame.event !== undefined, `no named frame in ${FIRST_FRAME_MS / 1000} s; heard ${JSON.stringify(frame.heard.slice(0, 400))}`);
      assert.doesNotThrow(() => JSON.parse(frame.data ?? ""), `the ${frame.event} frame carries JSON: ${String(frame.data).slice(0, 200)}`);
    } finally {
      abort.abort();
    }

    /* 6. The seat box, read through the proxy's own reader: the Account reachable. */
    const seat = await fetch(`${base}/data/seat.json`);
    assert.equal(seat.status, 200);
    const view = await seat.json() as SeatView;
    assert.equal(view.reachable, true, JSON.stringify(view));

    /* THE OWNER'S HALF (spec §10): the face's own owner device — client/js/host/owner.js under Node, its key made with
     * Node's WebCrypto and kept in memory — paired, signing and answering, every call to the face's port, never the
     * stand-in's. */
    device = startOwnerNode(base);
    const { owner } = device;

    /* 7. Paired with the code the stand-in printed: the stand-in lets the first browser that types it sign. */
    await owner.ready(standin.code);
    assert.equal(device.standing().role, "signs", `the device signs: ${JSON.stringify(device.standing())}${said}`);
    assert.equal(device.standing().refusal, null);
    assert.match(device.standing().kid, /^[0-9a-f]{16}$/);

    /* 8. A watch, signed, on an `ex` market the page does not watch yet (the stand-in seeds some): taken, and the
     * Account's page lists it; signed off again, it is gone. */
    type WatchRow = { venue?: string; symbol?: string };
    const watchOf = async (): Promise<WatchRow[]> => ((await (await fetch(`${base}/data/account?fresh=1`)).json()) as { watch?: WatchRow[] }).watch ?? [];
    const watching = (rows: WatchRow[], symbol: string): boolean => rows.some((w) => w.venue === "ex" && w.symbol === symbol);
    const beforeWatch = await watchOf();
    const coins = await (await fetch(`${base}/data/account/explore?tab=crypto`)).json() as { items?: { at?: { venue?: string; symbol?: string }[] }[] };
    const unwatched = coins.items?.flatMap((item) => item.at ?? []).find((at) => at.venue === "ex" && typeof at.symbol === "string" && !watching(beforeWatch, at.symbol))?.symbol;
    assert.ok(unwatched, `an ex market the page does not watch: watch ${JSON.stringify(beforeWatch)}; explore ${JSON.stringify(coins.items?.map((i) => i.at)).slice(0, 600)}`);
    const watched = await owner.act({ type: "setWatch", venue: "ex", symbol: unwatched, on: "true" });
    assert.equal(watched.status, 200, shown(watched));
    assert.notEqual(watched.body.ok, false, shown(watched));
    const afterWatch = await watchOf();
    assert.ok(watching(afterWatch, unwatched), `the page watches ${unwatched} at ex: ${JSON.stringify(afterWatch)}`);
    const unwatchedAgain = await owner.act({ type: "setWatch", venue: "ex", symbol: unwatched, on: "" });
    assert.equal(unwatchedAgain.status, 200, shown(unwatchedAgain));
    assert.notEqual(unwatchedAgain.body.ok, false, shown(unwatchedAgain));
    const afterUnwatch = await watchOf();
    assert.ok(!watching(afterUnwatch, unwatched), `the page no longer watches ${unwatched} at ex: ${JSON.stringify(afterUnwatch)}`);

    /* 9. The stream opened first, then the owner's market buy of $25 of ETH: an order, and its fill on the stream. */
    const streamed = await fetch(`${base}/data/account/stream?client=${STREAM_CLIENT}`, { headers: { accept: "text/event-stream" }, signal: ownerStream.signal });
    if (streamed.status !== 200) assert.fail(`the owner's stream answered ${streamed.status}: ${(await streamed.text()).slice(0, 400)}`);
    const frames = collectFrames(streamed);
    /* The ETH the Portfolio counts from the account's own orders (its `crypto:ETH` cost basis, `coveredQty`), read
     * before the buy and again after its fill; the row must also show ETH held at `ex`. The venue line's own amount
     * is not compared: the Account keeps a venue's balance read for about thirty seconds, so it lags the fill and,
     * just after the stand-in's seeding, the seeds' own last buy too (measured: 1.8 before, 1.8 at once after the
     * fill, 1.8499 thirty seconds later — this fill and the seeded 0.04). */
    type Holdings = { rows?: { asset?: string; venues?: { venue?: string }[] }[]; cost?: { key?: string; coveredQty?: number }[] };
    const ethCounted = async (): Promise<number> => {
      const held = await (await fetch(`${base}/data/account/holdings?cost=1&fresh=1`)).json() as Holdings;
      const atEx = held.rows?.some((row) => row.asset === "ETH" && row.venues?.some((line) => line.venue === "ex"));
      assert.ok(atEx, `ETH at ex: ${JSON.stringify(held.rows?.map((r) => [r.asset, r.venues?.map((v) => v.venue)]))}`);
      const covered = held.cost?.find((c) => c.key === "crypto:ETH")?.coveredQty;
      assert.equal(typeof covered, "number", `ETH's cost basis: ${JSON.stringify(held.cost?.map((c) => [c.key, c.coveredQty]))}`);
      return covered as number;
    };
    const ethBefore = await ethCounted();
    const bought = await owner.act({ type: "liveOrder", venue: "ex", symbol: "ETH/USDT", side: "buy", orderType: "market", usd: "25", ...ORDER_BLANKS });
    assert.equal(bought.status, 200, shown(bought));
    assert.equal(bought.body.kind, "order", shown(bought));
    const boughtId = fieldOf(bought.body.order, "id");
    assert.equal(typeof boughtId, "string", shown(bought));
    const fill = await frameWithin(frames, (f) => f.event === "fill" && fieldOf(f.data, "order") === boughtId, ACTION_FRAME_MS);
    assert.ok(fill, `a fill for ${String(boughtId)} within ${ACTION_FRAME_MS / 1000} s; heard ${JSON.stringify(frames.map((f) => f.event))}`);
    assert.equal(fieldOf(fill.data, "symbol"), "ETH/USDT");

    /* 10. The Portfolio's ETH, as the account's orders count it, rose by what filled (to within a hundredth of it). */
    const filledQty = fieldOf(fill.data, "filledQty");
    assert.ok(typeof filledQty === "number" && filledQty > 0, `the fill's quantity: ${JSON.stringify(fill.data)}`);
    const ethAfter = await ethCounted();
    const rose = ethAfter - ethBefore;
    assert.ok(Math.abs(rose - filledQty) <= filledQty * 0.01, `ETH counted rose by ${rose} (${ethBefore} → ${ethAfter}); ${filledQty} filled`);

    /* 11. A limit buy of SOL 10 % under the ask rests open; cancelled, it is canceled. */
    const market = await (await fetch(`${base}/data/account/market?venue=ex&symbol=${encodeURIComponent("SOL/USDT")}`)).json() as { market?: { ask?: number; priceStep?: number } };
    const ask = market.market?.ask;
    assert.ok(typeof ask === "number" && ask > 0, `SOL/USDT's ask at ex: ${JSON.stringify(market).slice(0, 400)}`);
    const step = market.market?.priceStep ?? 0.01;
    const limitPrice = String(Number((Math.floor((ask * 0.9) / step) * step).toFixed(8)));
    const resting = await owner.act({ type: "liveOrder", venue: "ex", symbol: "SOL/USDT", side: "buy", orderType: "limit", qty: "0.5", ...ORDER_BLANKS, limitPrice });
    assert.equal(resting.status, 200, shown(resting));
    assert.equal(resting.body.kind, "order", shown(resting));
    assert.equal(fieldOf(resting.body.order, "status"), "open", shown(resting));
    const restingId = fieldOf(resting.body.order, "id");
    assert.equal(typeof restingId, "string", shown(resting));
    const cancelled = await owner.act({ type: "liveCancel", venue: "ex", order: String(restingId) });
    assert.equal(cancelled.status, 200, shown(cancelled));
    assert.equal(cancelled.body.kind, "order", shown(cancelled));
    assert.equal(fieldOf(cancelled.body.order, "id"), restingId, shown(cancelled));
    assert.equal(fieldOf(cancelled.body.order, "status"), "canceled", shown(cancelled));

    /* 12. The card Claude Code's market buy of ETH waits on, approved: taken, and the stream tells it approved. */
    const withCard = await (await fetch(`${base}/data/account?fresh=1`)).json() as { cards?: { id?: string; hash?: string }[] };
    const card = withCard.cards?.[0];
    assert.ok(card?.id && card.hash, `a card waits: ${JSON.stringify(withCard.cards)}`);
    const answered = await owner.act({ type: "approveCard", card: card.id, action: card.hash, decision: "approve" });
    assert.equal(answered.status, 200, shown(answered));
    const told = await frameWithin(frames, (f) => f.event === "card" && fieldOf(f.data, "id") === card.id && fieldOf(f.data, "outcome") === "approved", ACTION_FRAME_MS);
    assert.ok(told, `a card frame for ${card.id} approved within ${ACTION_FRAME_MS / 1000} s; heard ${JSON.stringify(frames.filter((f) => f.event === "card"))}`);

    /* 13. The fence: an exchange posted from a foreign origin is refused before the Account is asked. */
    const foreign = await fetch(`${base}/data/account/exchange`, {
      method: "POST", headers: { "content-type": "application/json", origin: "http://evil.example" }, body: "{}",
    });
    assert.equal(foreign.status, 403);

    /* 14. Nothing of a body in what the face said: neither the pairing code nor a signature. */
    const said14 = output.text();
    assert.ok(!said14.includes(standin.code), "the pairing code is not in the face's output");
    const signatures = device.signatures();
    /* the watch and its removal, the buy, the limit, the cancel, the card */
    assert.equal(signatures.length, 6, `six signatures sent; ${signatures.length} kept`);
    assert.ok(signatures.every((signature) => !said14.includes(signature)), "no signature sent is in the face's output");
  } finally {
    output.restore();
    device?.close();
    ownerStream.abort();
    /* The web server first, then the proxy's open pipes (main.ts's order), then the stand-in and the homes. */
    if (dispose) await dispose();
    disposeProxy?.();
    if (wasUrl === undefined) delete process.env.FACE_ACCOUNT_URL; else process.env.FACE_ACCOUNT_URL = wasUrl;
    await stopStandin(standin);
    await rm(home, { recursive: true, force: true });
  }
});
