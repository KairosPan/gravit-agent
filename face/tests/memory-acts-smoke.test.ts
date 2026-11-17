// face/tests/memory-acts-smoke.test.ts
/** The owner's acts on the memory against a REAL Account and a REAL memory (src/memory-acts.ts,
 * src/memory-acts-routes.ts).
 *
 * WHAT IS REAL. The Account's own stand-in (helpers/standin.ts: the real Account over simulated venues, no network, a
 * fresh home under the temporary directory, a free port, never 4820 or 4821) with one paired device: the face's own
 * owner device under Node (helpers/owner-node.ts, paired with the code the stand-in printed). One `bootFace` boot on a
 * scratch harness home with the seat's row disabled, `FACE_ACCOUNT_URL` and `FACE_MARKET_URL` at the stand-in before
 * the boot; the Account's proxy, the memory's opener of the row the tree composed, the acts and their routes bound on
 * the booted web server as main.ts binds them. The memory is the real gravit-memory package over a home made by its
 * own `initHome` under the temporary directory, filled through its API: two unarmed card files, one recorded decision
 * and one waiting proposal.
 *
 * Every act goes over the wire as the page sends it: the face's prepare, the Account's prepare through the face, the
 * device's signature, the face's act. In turn: an arm done, the card armed with the hash answered and two rows in the
 * Account's ledger; the same body again refused as done, one arm line in owner.jsonl; an envelope signed by a key the
 * Account does not know refused with its 401, the memory untouched; a card whose file is edited after its prepare
 * signed, said yes to by the Account and refused by the face as changed, the card not armed; a decision voided with
 * the owner's words; a proposal rejected with words; a signed attest for another service and a signed instruction of
 * another type each a 400, the Account's ledger without a new row; a post with no envelope a 400.
 *
 * Gated behind `FACE_SMOKE=1` and an installed `account/`. ONE BOOT PER PROCESS (smoke.test.ts header): `bootFace`
 * sets `process.env.DSH_HOME`, so this is its own file; every home it makes is under the temporary directory.
 * @module
 */
import { DEAD_MARKET_URL } from "./helpers/no-market.ts";
import "./helpers/no-memory.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initHome, openMemory } from "gravit-memory";
import type { SeatEntryLike } from "../src/account-seat.ts";
import { registerAccountProxy } from "../src/account-proxy.ts";
import { bootFace } from "../src/boot.ts";
import { createMemoryActs } from "../src/memory-acts.ts";
import { registerMemoryActsRoutes } from "../src/memory-acts-routes.ts";
import { composedMemoryRow } from "../src/memory-row.ts";
import { memoryOpener } from "../src/memory.ts";
import { setupFaceProfile } from "../src/setup.ts";
import { kidOf, makeKey, publicJwkOf, signPrepared } from "../client/js/wire/owner-key.js";
import { makeBotsRoot } from "./bots-fixture.ts";
import { freePort, standinSkip, startStandin, stopStandin, type Standin } from "./helpers/standin.ts";
import { startOwnerNode, type OwnerAnswer, type OwnerNode } from "./helpers/owner-node.ts";

const skip = standinSkip();

/** The card armed, the card edited after its prepare, the waiting proposal's lesson. */
const ARMED = "acts-armed-card";
const EDITED = "acts-edited-card";
const WAITING = "acts-waiting-card";
const SERVICE = "gravit-memory";
const DONE = "this was done already";
const CHANGED = "it changed while it was shown: nothing was done";
const NOT_THIS = "the envelope is not an attest of this act";
const NOT_AN_ACT = "not an act the memory's screen takes";
const VOID_WORDS = "Recorded twice by the drill: this one is void.";
const REJECT_WORDS = "Not a lesson I keep.";

type Body = Record<string, unknown>;
type Prepared = { action: Body & { nonce: number }; shown: unknown[] };
type Envelope = { action: Body; nonce: number; signature: unknown };
const json = (v: unknown, n = 600): string => JSON.stringify(v).slice(0, n);

/** Every file under `dir` by its path inside it, with its bytes. */
async function filesOf(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    out.set(path.slice(dir.length), (await readFile(path)).toString("base64"));
  }
  return out;
}

/** Every row of the Account's ledgers in `home` (`portfolio/ledger-*.jsonl`), in file order. */
async function ledgerRows(home: string): Promise<Body[]> {
  const dir = join(home, "portfolio");
  const rows: Body[] = [];
  for (const name of (await readdir(dir)).sort()) {
    if (!/^ledger-.*\.jsonl$/.test(name)) continue;
    for (const line of (await readFile(join(dir, name), "utf8")).split("\n")) if (line.trim() !== "") rows.push(JSON.parse(line) as Body);
  }
  return rows;
}

test("the owner's acts against a real Account and a real memory: done on the Account's yes, once, and only when nothing changed", {
  skip, timeout: 300_000,
}, async () => {
  const made: string[] = [];
  const envBefore = { account: process.env.FACE_ACCOUNT_URL, memory: process.env.FACE_MEMORY_HOME };
  let standin: Standin | undefined;
  let dispose: (() => Promise<void>) | undefined;
  let disposeProxy: (() => void) | undefined;
  let device: OwnerNode | undefined;
  try {
    standin = await startStandin(await freePort());
    const said = `\nstand-in:\n${standin.log()}`;

    /* The memory's home, made and filled through the package's own API. */
    const memoryHome = join(mkdtempSync(join(tmpdir(), "face-memory-acts-home-")), "home");
    made.push(join(memoryHome, ".."));
    assert.equal((await initHome(memoryHome)).created, true, "the package made the home");
    const memory = openMemory(memoryHome);
    for (const [id, verb] of [[ARMED, "buy"], [EDITED, "sell"]] as const) {
      const p = await memory.propose("drill-proposer", {
        what: "new", lesson: id, reason: `A card the acts' drill arms: ${id}.`,
        card: { id, says: "dont", actions: [verb], strength: "caveat", words: `Do not ${verb} on the acts' drill.` },
      });
      await memory.owner.edit(p.id);
    }
    const waiting = await memory.propose("drill-proposer", {
      what: "new", lesson: WAITING, reason: "A card that waits for the owner.",
      card: { id: WAITING, says: "dont", actions: ["short"], strength: "caveat", words: "Do not short on the acts' drill." },
    });
    const decision = await memory.record("gravit", {
      action: "buy", whose: "agent", thesis: "The acts' drill buys once.", market: "us", symbol: "NVDA",
      price: 100, price_source: "the drill's stub quote",
    });
    const stateOf = async (id: string): Promise<{ state: string; armed?: { sha256: string } } | undefined> =>
      (await memory.lessons()).lessons.find((v) => v.id === id);
    assert.equal((await stateOf(ARMED))?.state, "unarmed");
    assert.equal((await stateOf(EDITED))?.state, "unarmed");

    /* A scratch face home, the seat's row off, the stand-in as its Account and market, the made home as its memory. */
    const home = mkdtempSync(join(tmpdir(), "face-memory-acts-"));
    made.push(home);
    setupFaceProfile(home);
    const patchPath = join(home, "profiles", "face", "cordis.patch.yml");
    writeFileSync(patchPath, `${readFileSync(patchPath, "utf8").replace(/^\[\][ \t]*$/m, "")}\n- id: mcp-account\n  disabled: true\n`);
    process.env.FACE_ACCOUNT_URL = standin.url;
    process.env.FACE_MARKET_URL = standin.marketUrl;
    process.env.FACE_MEMORY_HOME = memoryHome;
    const booted = await bootFace({ profileName: "face", port: 0, dshHome: home, botsRoot: await makeBotsRoot() });
    dispose = booted.dispose;
    const { ctx } = booted;
    const proxy = registerAccountProxy(ctx.webServer, { url: standin.url });
    disposeProxy = proxy.dispose;
    const loader = ctx.get("loader") as { entries(): Iterable<SeatEntryLike> };
    const logged: string[] = [];
    const acts = createMemoryActs({ open: memoryOpener(composedMemoryRow(loader.entries())), exchange: proxy.exchange, log: (line) => { logged.push(line); } });
    registerMemoryActsRoutes(ctx.webServer, { acts: () => acts, log: (line) => { logged.push(line); } });
    const base = `http://127.0.0.1:${ctx.webServer.port}`;
    const post = async (path: string, body: unknown): Promise<{ status: number; body: Body }> => {
      const res = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      return { status: res.status, body: (await res.json()) as Body };
    };

    /* The owner's device, paired with the code the stand-in printed. */
    device = startOwnerNode(base);
    const { owner } = device;
    await owner.ready(standin.code);
    assert.equal(device.standing().role, "signs", `the device signs: ${json(device.standing())}${said}`);
    const sign = (owner as unknown as { sign(p: Prepared): Promise<{ ok: boolean; envelope?: Envelope; said?: string }> }).sign;

    /** The Account's preparation of `draft`, through the face. */
    const prepareAtAccount = async (draft: Body): Promise<Prepared> => {
      const p: OwnerAnswer = await owner.prepare(draft);
      assert.equal(p.status, 200, `the Account prepared ${json(draft)}: ${json(p.body)}${said}`);
      assert.ok(Array.isArray(p.body.shown), json(p.body));
      return p.body as unknown as Prepared;
    };
    /** The device's envelope for a preparation. */
    const signed = async (prepared: Prepared): Promise<Envelope> => {
      const s = await sign(prepared);
      assert.equal(s.ok, true, `signed: ${json(s)}`);
      return s.envelope!;
    };
    /** The face's prepare of an act, then the Account's, signed by the device: the body to post, and the face's show. */
    const signedAct = async (act: string, subject: string, words?: string): Promise<{ body: Body; show: Body; prepared: Prepared }> => {
      const asked = await post("/data/memory/prepare", words === undefined ? { act, subject } : { act, subject, words });
      assert.equal(asked.status, 200, `the face prepared ${act} ${subject}: ${json(asked.body)}`);
      const draft = asked.body.draft as Body;
      assert.deepEqual([draft.type, draft.service, draft.act, draft.subject], ["attest", SERVICE, act, subject]);
      const prepared = await prepareAtAccount(draft);
      const envelope = await signed(prepared);
      return { body: { act, subject, ...(words === undefined ? {} : { words }), envelope }, show: asked.body.show as Body, prepared };
    };

    /* 1. Arm: the card's text shown, signed, done with its hash; armed with that hash; the ledger's two rows. */
    const armedFile = readFileSync(join(memoryHome, "lessons", `${ARMED}.md`), "utf8");
    const arm = await signedAct("arm", ARMED);
    assert.deepEqual([arm.show.kind, arm.show.lesson, arm.show.state, arm.show.text], ["card", ARMED, "unarmed", armedFile]);
    const rowsBeforeArm = (await ledgerRows(standin.home)).length;
    const armed = await post("/data/memory/act", arm.body);
    assert.equal(armed.status, 200, json(armed.body));
    assert.equal(armed.body.ok, true);
    assert.match(String(armed.body.sha256), /^[0-9a-f]{64}$/);
    const armedView = await stateOf(ARMED);
    assert.equal(armedView?.state, "armed");
    assert.equal(armedView?.armed?.sha256, armed.body.sha256, "armed with the hash the act answered");
    const armRows = (await ledgerRows(standin.home)).slice(rowsBeforeArm).filter((r) => r.tool === "attest");
    assert.deepEqual(armRows.map((r) => r.outcome), ["taken", "ok"], json(armRows));
    assert.equal(armRows[1]!.reason, `the owner attested arm ${ARMED} for ${SERVICE}`);
    assert.deepEqual(logged, [`memory: the owner's arm of ${ARMED} is done`]);

    /* 2. The same body again: done already; one arm line. */
    const again = await post("/data/memory/act", arm.body);
    assert.deepEqual([again.status, again.body], [409, { ok: false, error: DONE }]);
    const ownerLines = readFileSync(join(memoryHome, "owner.jsonl"), "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as Body);
    assert.equal(ownerLines.filter((l) => l.act === "arm" && l.lesson === ARMED).length, 1, json(ownerLines));

    /* 3. Signed by a key the Account does not know: its 401, the memory untouched. */
    const untouched = await filesOf(memoryHome);
    const strangerAsk = await post("/data/memory/prepare", { act: "arm", subject: EDITED });
    const strangerPrepared = await prepareAtAccount(strangerAsk.body.draft as Body);
    const subtle = globalThis.crypto.subtle;
    const strangerKey = await makeKey(subtle);
    const strangerKid = await kidOf(subtle, await publicJwkOf(subtle, strangerKey));
    const strangerSignature = await signPrepared(subtle, strangerKey.privateKey, strangerKid, strangerPrepared as never);
    const stranger = await post("/data/memory/act", {
      act: "arm", subject: EDITED,
      envelope: { action: strangerPrepared.action, nonce: strangerPrepared.action.nonce, signature: strangerSignature },
    });
    assert.equal(stranger.status, 401, json(stranger.body));
    assert.equal(stranger.body.ok, false);
    assert.equal((stranger.body.refusal as Body | undefined)?.code, "E_ACCOUNT_BAD_SIGNATURE", json(stranger.body));
    assert.deepEqual(await filesOf(memoryHome), untouched, "the memory is untouched");
    assert.equal((await stateOf(EDITED))?.state, "unarmed");

    /* 4. A card edited after its prepare: the Account says yes, the face says it changed, the card is not armed. */
    const edit = await signedAct("arm", EDITED);
    const editedPath = join(memoryHome, "lessons", `${EDITED}.md`);
    const before = readFileSync(editedPath, "utf8");
    const after = before.replace("Do not sell on the acts' drill.", "Do not sell twice on the acts' drill.");
    assert.notEqual(after, before, "the card's words are edited");
    writeFileSync(editedPath, after);
    const rowsBeforeEdit = (await ledgerRows(standin.home)).length;
    const changed = await post("/data/memory/act", edit.body);
    assert.deepEqual([changed.status, changed.body], [409, { ok: false, error: CHANGED }]);
    const editRows = (await ledgerRows(standin.home)).slice(rowsBeforeEdit).filter((r) => r.tool === "attest");
    assert.deepEqual(editRows.map((r) => [r.outcome, r.reason ?? null]).at(-1), ["ok", `the owner attested arm ${EDITED} for ${SERVICE}`], "the Account said yes");
    assert.equal((await stateOf(EDITED))?.state, "unarmed", "the edited card is not armed");

    /* 5. Void with the owner's words: void with that reason, by the owner. */
    const voidAct = await signedAct("void", decision.id, VOID_WORDS);
    const voided = await post("/data/memory/act", voidAct.body);
    assert.equal(voided.status, 200, json(voided.body));
    const shown = await memory.show(decision.id);
    assert.ok("decision" in shown);
    assert.equal(shown.decision.void, true);
    const amend = shown.decision.amends.at(-1) as Body | undefined;
    assert.deepEqual([amend?.what, amend?.reason, amend?.by], ["void", VOID_WORDS, "owner"]);

    /* 6. Reject the proposal with words: it no longer waits. */
    assert.ok((await memory.review()).proposals.some((p) => p.id === waiting.id), "the proposal waits");
    const rejectAct = await signedAct("reject", waiting.id, REJECT_WORDS);
    const rejected = await post("/data/memory/act", rejectAct.body);
    assert.equal(rejected.status, 200, json(rejected.body));
    assert.ok(!(await memory.review()).proposals.some((p) => p.id === waiting.id), "the proposal no longer waits");

    /* 7. A signed attest for another service, a signed instruction of another type: 400 each, no row at the Account. */
    const otherService = await signed(await prepareAtAccount({ type: "attest", service: "another-service", act: "arm", subject: EDITED, digest: "0".repeat(64) }));
    const otherType = await signed(await prepareAtAccount({ type: "setPolicy", change: "mode", value: "guard" }));
    const rowsBefore = (await ledgerRows(standin.home)).length;
    for (const envelope of [otherService, otherType]) {
      const answer = await post("/data/memory/act", { act: "arm", subject: EDITED, envelope });
      assert.deepEqual([answer.status, answer.body], [400, { ok: false, error: NOT_THIS }], json(envelope.action));
    }
    assert.equal((await ledgerRows(standin.home)).length, rowsBefore, "the Account's ledger gained no row");

    /* 8. A plain post with no envelope: 400. */
    const bare = await post("/data/memory/act", { act: "arm", subject: EDITED });
    assert.deepEqual([bare.status, bare.body], [400, { ok: false, error: NOT_AN_ACT }]);
    assert.equal((await stateOf(EDITED))?.state, "unarmed");

    assert.deepEqual(logged, [
      `memory: the owner's arm of ${ARMED} is done`,
      `memory: the owner's void of ${decision.id} is done`,
      `memory: the owner's reject of ${waiting.id} is done`,
    ]);
  } finally {
    device?.close();
    /* The web server first, then the proxy's open pipes (main.ts's order), then the stand-in and the homes. */
    if (dispose) await dispose();
    disposeProxy?.();
    if (envBefore.account === undefined) delete process.env.FACE_ACCOUNT_URL; else process.env.FACE_ACCOUNT_URL = envBefore.account;
    if (envBefore.memory === undefined) delete process.env.FACE_MEMORY_HOME; else process.env.FACE_MEMORY_HOME = envBefore.memory;
    process.env.FACE_MARKET_URL = DEAD_MARKET_URL;
    if (standin) await stopStandin(standin);
    for (const dir of made) if (existsSync(dir)) await rm(dir, { recursive: true, force: true });
  }
});
