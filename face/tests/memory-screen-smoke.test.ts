// face/tests/memory-screen-smoke.test.ts
/** The memory screen's four reads on a REAL booted face (src/memory-screen.ts, src/memory-screen-routes.ts).
 *
 * WHAT IS REAL. Two `bootFace` boots, each on a scratch harness home with the Account seat's row disabled; the screen
 * built by `createMemoryScreen` over the face's own opener of the row the tree composed (src/memory.ts
 * `memoryOpener`, src/memory-row.ts `composedMemoryRow`) and its routes registered on the tree's webserver, as main.ts
 * binds them; each read asked over the wire with the face's cookie. The memory is the real gravit-memory package.
 *
 * THE FIRST BOOT stands over a home made with the package's own `initHome` and filled through the package's API - in
 * this test only: one card proposed, taken to `lessons/` and armed through `Memory.owner`; one card proposed and taken
 * to `lessons/` unarmed; one decision recorded as `gravit`; one proposal left waiting. The lessons read names both
 * cards with their states, the armed one's record and its retire command, and no record for the unarmed one; the
 * decisions read holds the decision, and none for another symbol; the review read holds the waiting proposal; the
 * status read names the home and five sound chains; a cross-site request is a 403; and every file under the home is
 * byte for byte what it was before the reads.
 *
 * THE SECOND BOOT stands over a home under the temporary directory that was never made: each of the four reads
 * answers `connected: false`, `why: "no home"`, and the home is still not there afterwards.
 *
 * Nothing reaches the Account, the Market or the network. Gated behind `FACE_SMOKE=1`, in its own file: `bootFace`
 * sets `process.env.DSH_HOME` for the process.
 * @module
 */
import "./helpers/no-market.ts";
import "./helpers/no-memory.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initHome, openMemory } from "gravit-memory";
import type { SeatEntryLike } from "../src/account-seat.ts";
import { bootFace } from "../src/boot.ts";
import { composedMemoryRow } from "../src/memory-row.ts";
import { NO_MEMORY_HERE, memoryOpener } from "../src/memory.ts";
import { commandOf, createMemoryScreen } from "../src/memory-screen.ts";
import { registerMemoryScreenRoutes } from "../src/memory-screen-routes.ts";
import { setupFaceProfile } from "../src/setup.ts";
import { makeBotsRoot } from "./bots-fixture.ts";
import { mountClient, signIn } from "./remote.ts";

const gated = process.env.FACE_SMOKE !== "1";

/** The armed card, the unarmed card and the waiting proposal's lesson. */
const ARMED = "screen-armed-card";
const UNARMED = "screen-unarmed-card";
const WAITING = "screen-waiting-card";
/** The decision's symbol, and another the memory holds no decision of. */
const SYMBOL = "NVDA";
const OTHER = "AMD";
/** The four reads' paths. */
const READS = ["/data/memory/lessons", "/data/memory/decisions", "/data/memory/review", "/data/memory/status"] as const;

type Body = Record<string, unknown> & { ok?: boolean; connected?: boolean };

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

/** A scratch harness home with the seat's row disabled, booted over `memoryHome`; the screen's routes bound on it. */
async function bootScreen(memoryHome: string, made: string[]): Promise<{
  read: (path: string, headers?: Record<string, string>) => Promise<{ status: number; body: Body }>;
  logged: string[];
  dispose: () => Promise<void>;
}> {
  const home = await mkdtemp(join(tmpdir(), "face-memory-screen-"));
  made.push(home);
  setupFaceProfile(home);
  const patchPath = join(home, "profiles", "face", "cordis.patch.yml");
  const patch = readFileSync(patchPath, "utf8").replace(/^\[\][ \t]*$/m, "");
  writeFileSync(patchPath, `${patch}\n- id: mcp-account\n  disabled: true\n`);
  process.env.FACE_MEMORY_HOME = memoryHome;
  const booted = await bootFace({ profileName: "face", port: 0, dshHome: home, botsRoot: await makeBotsRoot() });
  try {
    const { ctx } = booted;
    const loader = ctx.get("loader") as { entries(): Iterable<SeatEntryLike> };
    const screen = createMemoryScreen({ open: memoryOpener(composedMemoryRow(loader.entries())) });
    const logged: string[] = [];
    registerMemoryScreenRoutes(ctx.webServer, { screen: () => screen, log: (line) => { logged.push(line); } });
    const base = `http://127.0.0.1:${ctx.webServer.port}`;
    mountClient(ctx);
    const cookie = await signIn(ctx, base);
    const read = async (path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: Body }> => {
      const res = await fetch(`${base}${path}`, { headers: { cookie, ...headers } });
      return { status: res.status, body: (await res.json()) as Body };
    };
    return { read, logged, dispose: booted.dispose };
  } catch (error) {
    await booted.dispose();
    throw error;
  }
}

const made: string[] = [];
const envBefore = process.env.FACE_MEMORY_HOME;

test.after(async () => {
  if (envBefore === undefined) delete process.env.FACE_MEMORY_HOME;
  else process.env.FACE_MEMORY_HOME = envBefore;
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

test("the screen's four reads over a made home: the cards, the decision, the proposal, the health; nothing written", {
  skip: gated && "set FACE_SMOKE=1",
  timeout: 120_000,
}, async () => {
  /* The memory's home, made and filled through the package's own API. */
  const memoryHome = join(await mkdtemp(join(tmpdir(), "face-memory-screen-home-")), "home");
  made.push(join(memoryHome, ".."));
  assert.equal((await initHome(memoryHome)).created, true, "the package made the home");
  const memory = openMemory(memoryHome);
  const armedProposal = await memory.propose("drill-proposer", {
    what: "new", lesson: ARMED, reason: "A card the screen shows armed.",
    card: { id: ARMED, says: "dont", actions: ["buy"], strength: "caveat", words: "Do not buy on the screen's drill." },
  });
  await memory.owner.edit(armedProposal.id);
  await memory.owner.arm(ARMED);
  const unarmedProposal = await memory.propose("drill-proposer", {
    what: "new", lesson: UNARMED, reason: "A card the screen shows unarmed.",
    card: { id: UNARMED, says: "dont", actions: ["sell"], strength: "caveat", words: "Do not sell on the screen's drill." },
  });
  await memory.owner.edit(unarmedProposal.id);
  const waiting = await memory.propose("drill-proposer", {
    what: "new", lesson: WAITING, reason: "A card that waits for the owner.",
    card: { id: WAITING, says: "dont", actions: ["short"], strength: "caveat", words: "Do not short on the screen's drill." },
  });
  const decision = await memory.record("gravit", {
    action: "buy", whose: "agent", thesis: "The screen's drill buys once.", market: "us", symbol: SYMBOL,
    price: 100, price_source: "the drill's stub quote",
  });

  const face = await bootScreen(memoryHome, made);
  try {
    const before = await filesOf(memoryHome);
    assert.ok(before.size >= 5, "the home's ledgers are read before the reads");

    /* The lessons: both cards with their states, the armed one's record and retire command, no record unarmed. */
    const lessons = await face.read("/data/memory/lessons");
    assert.equal(lessons.status, 200);
    assert.equal(lessons.body.ok, true);
    assert.equal(lessons.body.connected, true);
    assert.equal(lessons.body.ownerChainBroken, false);
    assert.equal("reseal" in lessons.body, false, "no reseal while the owner's chain is sound");
    const rows = lessons.body.lessons as { id: string; state: string; record: { owner: { fired: number } } | null; commands: { retire?: string } }[];
    assert.deepEqual(rows.map((row) => [row.id, row.state]).sort(), [[ARMED, "armed"], [UNARMED, "unarmed"]]);
    const armed = rows.find((row) => row.id === ARMED);
    assert.ok(armed?.record !== null && armed?.record !== undefined, "the armed card carries its record");
    assert.equal(armed.record.owner.fired, 0);
    assert.equal(armed.commands.retire, commandOf(memoryHome, ["retire", ARMED, "--reason", "\"\u2026\""]));
    const unarmed = rows.find((row) => row.id === UNARMED);
    assert.equal(unarmed?.record, null, "an unarmed card carries no record");
    assert.equal(unarmed?.commands.retire, undefined, "an unarmed card has nothing to retire");

    /* The decisions: the one recorded, and none for another symbol. */
    const decisions = await face.read("/data/memory/decisions");
    assert.equal(decisions.status, 200);
    assert.equal(decisions.body.connected, true);
    const items = decisions.body.items as { view: { line: { id: string; by: string; symbol?: string } } }[];
    assert.deepEqual(items.map((item) => [item.view.line.id, item.view.line.by, item.view.line.symbol]), [[decision.id, "gravit", SYMBOL]]);
    assert.equal(decisions.body.more, false);
    const same = await face.read(`/data/memory/decisions?symbol=${SYMBOL}`);
    assert.equal((same.body.items as unknown[]).length, 1, "the decision's own symbol finds it");
    const other = await face.read(`/data/memory/decisions?symbol=${OTHER}`);
    assert.equal(other.status, 200);
    assert.deepEqual(other.body.items, [], "another symbol finds none");

    /* The review: the waiting proposal. */
    const review = await face.read("/data/memory/review");
    assert.equal(review.status, 200);
    assert.equal(review.body.connected, true);
    const proposals = review.body.proposals as { id: string; lesson: string }[];
    assert.ok(proposals.some((p) => p.id === waiting.id && p.lesson === WAITING), `the waiting proposal is held: ${JSON.stringify(proposals)}`);
    assert.equal(review.body.command, commandOf(memoryHome, ["review"]));

    /* The health: the home and five sound chains. */
    const status = await face.read("/data/memory/status");
    assert.equal(status.status, 200);
    assert.equal(status.body.connected, true);
    assert.equal(status.body.home, memoryHome);
    const chains = status.body.chains as { file: string; ok: boolean }[];
    assert.equal(chains.length, 5, JSON.stringify(chains));
    assert.ok(chains.every((chain) => chain.ok), JSON.stringify(chains));

    /* The routes stand behind the data fence. */
    for (const path of READS) {
      assert.equal((await face.read(path, { "sec-fetch-site": "cross-site" })).status, 403, `${path} refuses a cross-site request`);
    }

    /* The screen writes nothing. */
    assert.deepEqual(await filesOf(memoryHome), before, "the home is byte for byte what it was before the reads");
    assert.deepEqual(face.logged, [], "no read faulted");
  } finally {
    await face.dispose();
  }
});

test("a second boot over a home never made: each read answers not connected, and the face makes no home", {
  skip: gated && "set FACE_SMOKE=1",
  timeout: 120_000,
}, async () => {
  const parent = await mkdtemp(join(tmpdir(), "face-memory-screen-never-"));
  made.push(parent);
  const never = join(parent, "home");
  assert.equal(existsSync(never), false);
  const face = await bootScreen(never, made);
  try {
    for (const path of READS) {
      const answer = await face.read(path);
      assert.equal(answer.status, 200, path);
      assert.deepEqual(answer.body, {
        ok: true, connected: false, why: "no home", say: NO_MEMORY_HERE, command: commandOf(never, ["init"]),
      }, path);
    }
    assert.deepEqual(face.logged, [], "not connected is no fault");
  } finally {
    await face.dispose();
  }
  assert.equal(existsSync(never), false, "the face never makes the home");
});
