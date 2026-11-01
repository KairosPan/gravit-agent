/** The wallet half on a real boot (plan 4b Task 7): the Account's own stand-in (no network, a fresh temp home), the face
 * booted in a scratch home with the seat row off and the proxy registered on its web server with the stand-in's URL — the
 * boot of `account-market-smoke` — and every call to the face's own port, never the stand-in's.
 *
 * The client's own hosts run under Node over one client store: the owner device (`helpers/owner-node.ts`, paired with the
 * code the stand-in printed), the Account host (`host/account.js` startAccount: Receive, Close to agents, Guard, Earn's read),
 * the sheet engine (`host/sheet.js` startSheet: every signed sheet opened on the seed its screen gives it, its fields changed
 * as the operator would, prepared, What you sign, signed) and Sell many (`host/sell-many.js`). In turn: Receive — the stand-in
 * exchange, which takes nothing sent from here, refused in the Account's words, and the agent wallet's USDC on Base answering
 * an address for that very key; a move between the exchange's own ledgers; 10 USDT put into its flexible product, then all of
 * it taken out; what can be sold read past the cache, two holdings picked, each prepared and signed as Sell many does;
 * Stand-in Predictions closed to agents (unsigned) and reopened (signed); the stand-in's two asks — the bigger budget granted
 * as a limit, the venue declined; an agent wallet for Claude Code keeping up to $20; Claude Code's limit to move money between
 * the owner's accounts; a browser wallet's challenge through the face, its sentence for the face's own host (a fake EIP-1193
 * provider, never a real wallet); and Settings' sign-out in Beast with Guard first — Guard, then the sign-out — after which the
 * device no longer signs and the mode is Guard. Nothing of a body (the pairing code, a signature sent) is in what the face's
 * process wrote.
 *
 * Skipped unless `FACE_SMOKE=1` and the repo's `account/` is installed. ONE BOOT PER PROCESS (smoke.test.ts header):
 * `bootFace` sets `process.env.DSH_HOME`, so this is its own file; the scratch home is a `mkdtemp` directory, never `~/.dsh`;
 * the stand-in takes a free port, never 4820, and nothing is written under `~/.buyer-agent-demo`. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupFaceProfile } from "../src/setup.ts";
import { bootFace } from "../src/boot.ts";
import { registerAccountProxy } from "../src/account-proxy.ts";
import { makeBotsRoot } from "./bots-fixture.ts";
import { freePort, standinSkip, startStandin, stopStandin, type Standin } from "./helpers/standin.ts";
import { startOwnerNode, type OwnerNode } from "./helpers/owner-node.ts";
import { postVia } from "../client/js/host/owner.js";
import { startAccount } from "../client/js/host/account.js";
import { startSheet } from "../client/js/host/sheet.js";
import { startSellMany } from "../client/js/host/sell-many.js";
import { getJsonVia } from "../client/js/app.js";
import { receiveRowsOf } from "../client/js/host/money-view.js";
import { earnSeedOf, moveSeedOf, subWalletSeedOf } from "../client/js/host/sheet-money.js";
import { grantOf, limitSeedOf, signOutSeedOf } from "../client/js/host/sheet-view.js";
import { asksOf, venuesOf, writesOn } from "../client/js/host/account-view.js";
import { proveWallet } from "../client/js/wire/wallet.js";

const skip = standinSkip();

/** The stand-in's exchange, its prediction market, and its agent (ui-standin.ts). */
const EXCHANGE = "ex";
const PREDICTIONS = "predict";
const AGENT = "Claude Code";

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
type Sheet = { kind: string; status: string; fields: Array<{ name: string; value: unknown; options?: Array<{ value: string }> }>; prepared: { action: Body } | null; message: string | null; said?: string; words?: string; asked?: string | null };
const json = (v: unknown, n = 600): string => JSON.stringify(v).slice(0, n);

test("account wallet smoke: through the face's port, the owner receives, moves, earns, sells many, closes and reopens to agents, opens an agent wallet, gives limits, answers asks, and signs out with Guard first", {
  skip, timeout: 300_000,
}, async () => {
  const standin: Standin = await startStandin(await freePort());
  const home = mkdtempSync(join(tmpdir(), "face-wallet-home-"));
  const wasUrl = process.env.FACE_ACCOUNT_URL;
  let dispose: (() => Promise<void>) | undefined;
  let disposeProxy: (() => void) | undefined;
  let device: OwnerNode | undefined;
  let closeHosts = (): void => {};
  const output = captureOutput();
  try {
    /* A scratch face home, the seat row off; the face booted with the stand-in as its Account. */
    setupFaceProfile(home);
    const patchPath = join(home, "profiles", "face", "cordis.patch.yml");
    writeFileSync(patchPath, `${readFileSync(patchPath, "utf8").replace(/^\[\][ \t]*$/m, "")}\n- id: mcp-account\n  disabled: true\n`);
    process.env.FACE_ACCOUNT_URL = standin.url;
    const booted = await bootFace({ profileName: "face", port: 0, dshHome: home, botsRoot: await makeBotsRoot() });
    dispose = booted.dispose;
    const proxy = registerAccountProxy(booted.ctx.webServer, { url: standin.url });
    disposeProxy = proxy.dispose;
    const facePort = booted.ctx.webServer.port;
    const base = `http://127.0.0.1:${facePort}`;
    const said = `\nstand-in:\n${standin.log()}`;
    const toFace = (path: string, init?: RequestInit): Promise<Response> => fetch(`${base}${path}`, init);
    const getJson = getJsonVia(toFace) as (path: string) => Promise<Body>;
    const post = postVia(toFace as typeof fetch) as (path: string, body?: unknown) => Promise<{ status: number; body: Body }>;
    const pageNow = async (): Promise<Body> => {
      const page = await getJson("/data/account?fresh=1");
      return page;
    };

    /* 1. Paired with the code the stand-in printed; the client's hosts over the device's own store. */
    device = startOwnerNode(base);
    const { owner, store } = device;
    await owner.ready(standin.code);
    assert.equal(device.standing().role, "signs", `the device signs: ${json(device.standing())}${said}`);
    const schedule = (fn: () => void, ms: number): ReturnType<typeof setTimeout> => setTimeout(fn, ms);
    const cancelTimer = (t: ReturnType<typeof setTimeout>): void => clearTimeout(t);
    /* the door's post as the client hands it (`postVia`: `{ status, body }`, never throwing); the JS defaults type it narrower */
    const account = startAccount({ store, getJson, post: post as never, now: Date.now, schedule, cancelTimer });
    const taken: string[] = [];
    const sheet = startSheet({
      store, owner, schedule, cancelTimer, now: Date.now, afterAction: (kind: string) => { taken.push(kind); },
      // app.js's: Guard (unsigned) before a sign-out in Beast with its box ticked; refused, nothing signed
      beforeSign: (async (): Promise<string | null> => {
        let r: { taken?: boolean; message?: string | null } | null;
        try { r = await account.guard(); } catch { r = null; }
        return r?.taken === true ? null : `Not signed out: Guard was refused — ${r?.message || "no answer"}`;
      }) as never,
    });
    const sellMany = startSellMany({ store, getJson, owner, walletSend: { order: async () => undefined }, now: Date.now });
    closeHosts = () => { sellMany.close(); sheet.close(); account.close(); };
    const page0 = await pageNow();
    assert.ok(writesOn(page0), `the stand-in takes writes: ${json(page0.connectLive)}`);

    /** A sheet opened on its seed, its fields changed as the operator would (each a value the field offers), prepared, and
     *  signed: the sheet as it stands once the Account answered. */
    const signSheet = async (kind: string, seed: Body, changes: Array<[string, unknown]> = []): Promise<Sheet> => {
      await sheet.open(kind, seed);
      for (const [name, value] of changes) {
        const field = (store.get().sheet as Sheet).fields.find((f) => f.name === name);
        assert.ok(field, `${kind}: a field ${name} among ${json((store.get().sheet as Sheet).fields.map((f) => f.name))}`);
        if (field.options && typeof value === "string") assert.ok(field.options.some((o) => o.value === value), `${kind}: ${name} offers ${value}: ${json(field.options)}`);
        sheet.change(name, value);
      }
      await sheet.prepareNow();
      const ready = store.get().sheet as Sheet;
      assert.equal(ready.status, "ready", `${kind} prepared: ${ready.status} ${ready.words ?? ""} ${ready.message ?? ""}${said}`);
      await sheet.submit();
      const done = store.get().sheet as Sheet;
      assert.equal(done.status, "done", `${kind} signed: ${done.status} ${done.message ?? ""}`);
      sheet.close();
      return done;
    };

    /* 2. Receive, as the Money tab's rows ask it. The stand-in exchange takes nothing sent from here (its `liveCan.receive` is
     * false), so it has no row, and asked anyway it is refused in the Account's words; the row the page offers — the agent
     * wallet, USDC on Base — answers an address, for that very key. */
    type Received = { status: string; data?: Body | null; message?: string | null };
    const receivedAt = (key: string): Received | undefined => (store.get().account as { receive: Record<string, Received> }).receive[key];
    const rows = receiveRowsOf(page0) as Array<{ venue: string; network: string; asset: string; kind: string }>;
    assert.ok(!rows.some((r) => r.venue === EXCHANGE), `no Receive row at ${EXCHANGE}: ${json(rows)}`);
    await account.receive({ venue: EXCHANGE, asset: "USDC", network: "Base" });
    const atExchange = receivedAt(`${EXCHANGE}|USDC|Base`);
    assert.equal(atExchange?.status, "error", json(atExchange));
    assert.match(String(atExchange?.message), /takes nothing sent from here/, json(atExchange));
    const row = rows.find((r) => r.network === "Base" && r.asset === "USDC");
    assert.ok(row, `a Receive row for USDC on Base: ${json(rows)}`);
    await account.receive({ venue: row.venue, asset: "USDC", network: "Base" });
    const received = receivedAt(`${row.venue}|USDC|Base`);
    assert.equal(received?.status, "ready", `the receive landed: ${json(received)}`);
    assert.match(String(received?.data?.address), /^0x[0-9a-fA-F]{40}$/, json(received));
    for (const [k, v] of [["venue", row.venue], ["asset", "USDC"], ["network", "Base"]] as const) {
      if (typeof received?.data?.[k] === "string") assert.equal(String(received.data[k]).toLowerCase(), v.toLowerCase(), `the answer is for ${k} ${v}`);
    }

    /* 3. Move: USDT from the exchange's spot ledger to its futures ledger, as the move sheet drafts a transfer. */
    const moved = await signSheet("move", moveSeedOf(page0, { from: EXCHANGE, kind: "transfer" }), [["fromLedger", "spot"], ["toLedger", "futures"], ["asset", "USDT"], ["amount", "10"]]);
    assert.deepEqual([moved.prepared?.action.type, moved.prepared?.action.kind, moved.prepared?.action.fromLedger, moved.prepared?.action.toLedger], ["liveMove", "transfer", "spot", "futures"]);

    /* 4. Earn: 10 USDT into the exchange's flexible product, then all of it out. */
    await account.loadEarn({ fresh: true });
    const earnOf = (): Body => (store.get().account as { earn: { data: Body } }).earn.data;
    assert.ok(earnOf(), `earn read: ${json((store.get().account as { earn: unknown }).earn)}`);
    const supplied = await signSheet("earn", earnSeedOf(earnOf(), await pageNow(), { venue: EXCHANGE, side: "supply", product: "flex:USDT" }), [["amount", "10"]]);
    assert.deepEqual([supplied.prepared?.action.type, supplied.prepared?.action.kind, supplied.prepared?.action.product, supplied.prepared?.action.amount], ["liveEarn", "supply", "flex:USDT", "10"]);
    await account.loadEarn({ fresh: true });
    const withdrawn = await signSheet("earn", earnSeedOf(earnOf(), await pageNow(), { venue: EXCHANGE, side: "withdraw", product: "flex:USDT" }), [["all", true]]);
    /* the sheet drafts `all`; the Account's preparation says how much that is */
    assert.equal((JSON.parse(String(withdrawn.asked)) as Body).amount, "all");
    assert.equal(withdrawn.prepared?.action.kind, "withdraw");
    assert.ok(Number(withdrawn.prepared?.action.amount) >= 10, `all of it, the 10 put in among it: ${json(withdrawn.prepared?.action)}`);

    /* 5. Sell many: what can be sold read past the cache, two holdings at the exchange picked (an order each, at market), each
     * prepared and signed in turn. */
    await sellMany.open(EXCHANGE);
    type Leg = { state: string; why: string; item: Body };
    const sm = (): { status: string; items: Body[]; legs: Leg[]; said: string | null; message: string | null } => store.get().sellMany as never;
    assert.equal(sm().status, "picking", json(sm()));
    assert.ok(sm().items.length >= 2, `at least two holdings to sell at ${EXCHANGE}: ${json(sm())}`);
    const two = sm().items.map((item, i) => [item, i] as const).filter(([item]) => item.action !== "close").slice(0, 2);
    assert.equal(two.length, 2, `two holdings that sell at market: ${json(sm().items)}`);
    /* each sale under the stand-in's $250 cap on one order: about $100 of it, typed in the drawer's qty box (in 0.0001s) */
    for (const [item, i] of two) {
      assert.ok(sellMany.toggle(i));
      const usd = Number(item.usd), qty = Number(item.sellQty);
      if (usd > 200 && qty > 0) sellMany.setQty(i, String(Math.floor((qty * 100 / usd) * 10_000) / 10_000));
    }
    await sellMany.review();
    assert.deepEqual(sm().legs.map((l) => l.state), ["ready", "ready"], `both legs prepared: ${json(sm().legs.map((l) => [l.state, l.why, l.item.symbol]))}`);
    await sellMany.run();
    assert.deepEqual(sm().legs.map((l) => l.state), ["sold", "sold"], `both legs sold: ${json(sm().legs.map((l) => [l.state, l.why]))}`);
    assert.equal(sm().said, "Sell many: 2 of 2 sales went through");
    sellMany.close();

    /* 6. Close to agents (unsigned): Stand-in Predictions in the dial's revoked; Reopen… signed takes it out. */
    const revokedOf = (page: Body): unknown[] => ((page.dial as { revoked?: unknown[] } | undefined)?.revoked ?? []);
    await account.revoke(PREDICTIONS);
    const closing = (store.get().account as { closing: Record<string, { status: string; message?: string }> }).closing[PREDICTIONS];
    assert.equal(closing?.status, "said", json(closing));
    assert.ok(revokedOf(await pageNow()).includes(PREDICTIONS), `revoked: ${json((await pageNow()).dial)}`);
    assert.ok(venuesOf(await pageNow()).find((v: { id: string }) => v.id === PREDICTIONS)?.closedToAgents, "the Venues row reads Closed to agents");
    const reopened = await signSheet("reopen", { venue: PREDICTIONS, name: "Stand-in Predictions" });
    assert.deepEqual(reopened.prepared?.action, { ...reopened.prepared?.action, type: "setPolicy", change: "restore", value: PREDICTIONS });
    assert.ok(!revokedOf(await pageNow()).includes(PREDICTIONS), `reopened: ${json((await pageNow()).dial)}`);

    /* 7. The asks, before any other limit answers them: the bigger budget granted as a limit (Cards' Grant) — the signed limit
     * at the venue it names answers the ask, which leaves Cards — and the venue declined (answerAsk). */
    const page7 = await pageNow();
    const asks = asksOf(page7) as Array<{ id: string; kind: string; usd: string; venue: string }>;
    const bigger = asks.find((k) => k.kind === "limit");
    const venueAsk = asks.find((k) => k.kind === "venue");
    assert.ok(bigger && venueAsk, `the two seeded asks: ${json(asks)}`);
    const grant = grantOf(bigger, page7) as { kind: string; seed: Body } | null;
    assert.equal(grant?.kind, "limit", json(grant));
    const granted = await signSheet(grant.kind, grant.seed);
    assert.deepEqual([granted.prepared?.action.type, granted.prepared?.action.scope, granted.prepared?.action.budget], ["approveSpend", "trade", "1000"]);
    const declined = await signSheet("declineAsk", { ask: venueAsk.id });
    assert.deepEqual(declined.prepared?.action, { ...declined.prepared?.action, type: "answerAsk", ask: venueAsk.id, decision: "decline" });
    const asksAfter = asksOf(await pageNow()) as Array<{ id: string }>;
    assert.ok(!asksAfter.some((k) => k.id === bigger.id), "the granted ask is answered: gone from Cards");
    assert.ok(!asksAfter.some((k) => k.id === venueAsk.id), "the declined ask is gone from Cards");

    /* 8. An agent wallet for Claude Code, keeping up to $20. */
    const page8 = await pageNow();
    const claude = ((page8.keys ?? []) as Array<{ address: string; name: string; status: string }>).find((k) => k.name === AGENT && k.status === "ok");
    assert.ok(claude, `${AGENT} is let in: ${json(page8.keys)}`);
    const wallet = await signSheet("subWallet", subWalletSeedOf(page8, { agent: claude.address }), [["name", "Scout"], ["float", "20"]]);
    assert.deepEqual(wallet.prepared?.action, { ...wallet.prepared?.action, type: "createSubAccount", name: "Scout", agent: claude.address.toLowerCase(), float: "20" });
    const scout = ((await pageNow()).subAccounts as Array<{ name: string; agent: string }>).find((w) => w.name === "Scout");
    assert.equal(scout?.agent, claude.address.toLowerCase(), "the wallet pays for Claude Code");

    /* 9. Claude Code's limit to move money between the owner's accounts (scope venues), the standing one as the sheet starts it. */
    const venuesLimit = await signSheet("limit", limitSeedOf(await pageNow(), claude.address, AGENT, "venues"));
    assert.deepEqual([venuesLimit.prepared?.action.type, venuesLimit.prepared?.action.scope], ["approveSpend", "venues"]);
    assert.ok(((await pageNow()).spend as Array<{ agent: string; scope: string; expired?: boolean }>).some((s) => s.scope === "venues" && s.agent.toLowerCase() === claude.address.toLowerCase()), "a venues limit stands");

    /* 10. A browser wallet's challenge through the face (a fake EIP-1193 provider): the sentence names the face's own host,
     * never the Account's. Its signature is no wallet's, so the proof is refused in the Account's words. */
    const asked: string[] = [];
    const fakeWallet = {
      name: "Fake Wallet",
      provider: {
        request: async ({ method, params }: { method: string; params?: unknown[] }): Promise<unknown> => {
          if (method === "eth_requestAccounts" || method === "eth_accounts") return ["0x1111111111111111111111111111111111111111"];
          if (method === "eth_chainId") return "0x2105";
          if (method === "personal_sign") { asked.push(Buffer.from(String(params?.[0]).slice(2), "hex").toString("utf8")); return `0x${"ab".repeat(65)}`; }
          throw new Error(`the fake wallet does not do ${method}`);
        },
      },
    };
    await assert.rejects(proveWallet(fakeWallet, post), (err: Error) => err.message.length > 0);
    assert.equal(asked.length, 1, "the wallet was asked to sign one sentence");
    const domain = asked[0].split("\n")[0];
    assert.equal(domain, `127.0.0.1:${facePort} wants you to sign in with your Ethereum account:`, asked[0]);
    assert.ok(!asked[0].includes(new URL(standin.url).host), `the stand-in's own host is not in the sentence: ${asked[0]}`);

    /* 11. Settings' sign-out in Beast, Guard first: Beast signed (the Rules tab's sheet), then the sign-out with its box ticked —
     * Guard, then the signature; the device no longer signs, and the mode is Guard. */
    await signSheet("beast", {});
    assert.equal((await pageNow()).mode, "open");
    const outSeed = signOutSeedOf(await pageNow(), device.standing()) as Body;
    assert.equal(outSeed.mode, "open");
    const out = await signSheet("signOut", outSeed, [["guard", true]]);
    assert.match(String(out.said), / Guard is on\.$/, `the done line: ${out.said}`);
    assert.equal(device.standing().role, "signed-out", json(device.standing()));
    const after = await pageNow();
    assert.equal(after.mode, "guard");
    assert.ok(!((after.signers as { owners?: Array<{ id: string }> } | undefined)?.owners ?? []).some((o) => o.id === `device:${device!.standing().kid}`), `the device is no owner: ${json(after.signers)}`);
    const refused = await owner.act({ type: "setPolicy", change: "mode", value: "open" });
    assert.ok(!(refused.status === 200 && refused.body.ok !== false), `a signed-out device signs nothing: ${refused.status} ${json(refused.body)}`);

    /* 12. Nothing of a body in what the face said: neither the pairing code nor a signature. */
    const heard = output.text();
    assert.ok(!heard.includes(standin.code), "the pairing code is not in the face's output");
    const signatures = device.signatures();
    /* move, earn in, earn out, two sales, reopen, grant, decline, wallet, venues limit, Beast, sign-out */
    assert.equal(signatures.length, 12, `twelve signatures sent; ${signatures.length} kept`);
    assert.ok(signatures.every((signature) => !heard.includes(signature)), "no signature sent is in the face's output");
    assert.ok(!heard.includes("ab".repeat(65)), "the wallet's signature is not in the face's output");
    assert.deepEqual(taken, ["move", "earn", "earn", "reopen", "limit", "declineAsk", "subWallet", "limit", "beast", "signOut"], "every sheet's action was taken");
  } finally {
    output.restore();
    closeHosts();
    device?.close();
    /* The web server first, then the proxy's open pipes (main.ts's order), then the stand-in and the homes. */
    if (dispose) await dispose();
    disposeProxy?.();
    if (wasUrl === undefined) delete process.env.FACE_ACCOUNT_URL; else process.env.FACE_ACCOUNT_URL = wasUrl;
    await stopStandin(standin);
    await rm(home, { recursive: true, force: true });
  }
});
