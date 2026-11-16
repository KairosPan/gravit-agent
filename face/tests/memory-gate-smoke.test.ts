// face/tests/memory-gate-smoke.test.ts
/** The memory gate on a REAL booted face (src/memory-gate.ts): the order card asks the owner's memory, Gate 2 refuses
 * a red line nobody overrode, and the owner's answer is registered by the face's own code.
 *
 * WHAT IS REAL. One `bootFace` on a scratch harness home with the Account seat's row disabled; Gate 2 as the boot arms
 * it (src/boot.ts `armOrderGate`); the gate built by `createMemoryGate` and bound into it as main.ts binds it -
 * `bindOrderRecall`, `followAnswers` over the root context, `registerMemoryGateRoutes` on the tree's webserver; the
 * memory as the real gravit-memory package over a home made with its own `initHome`, opened through the face's own
 * opener over the row the tree composed (src/memory.ts `memoryOpener`, src/memory-row.ts `composedMemoryRow`), the
 * environment naming that home for the boot. One lesson is armed there through `Memory.owner` - in this test only: a
 * `red-line` that says `dont` for `buy`, with no market or symbol scope.
 *
 * WHAT STANDS IN. The seat write is `mcp__drill__portfolio_live_order`, as tests/order-gate-smoke.test.ts registers
 * it: its body records its arguments and answers the seat's placed shape. The card is answered by an outermost
 * `approval/request` listener, as there; it reads the gate over the wire while the card is pending. The gate's Account
 * is a stub (flat, `kind: "stock"`, the paper venue the orders name) and its price facts a stub: nothing reaches the
 * Account, the Market or the network.
 *
 * THE FIVE STEPS. A buy is raised and `GET /data/memory/gate?callId=` shows the red line in the card's words; answered
 * `allowed-once` with no override, the tool's result is the guard's refusal word for word, the body did not run, and
 * the memory holds no owner's decision. A second buy: the override is posted over the wire, the card is answered
 * `allowed-once`, the body runs once, and the memory holds one decision `by: "gravit-face"`, `whose: "owner"`, `buy`,
 * with the override's words and the gate's recall. A third buy answered `rejected`: a `pass` naming its recall. A sell
 * of a symbol no lesson covers: no lesson on the card, the one-click answer passes, `short` is written.
 *
 * Gated behind `FACE_SMOKE=1`, in its own file: `bootFace` sets `process.env.DSH_HOME` for the process.
 * @module
 */
import "./helpers/no-market.ts";
import "./helpers/no-memory.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initHome, openMemory, type DecisionLine } from "gravit-memory";
import type { SeatEntryLike } from "../src/account-seat.ts";
import { bootFace } from "../src/boot.ts";
import { createMemoryGate, followAnswers, redLineRefusal, type GateAccount, type GateView } from "../src/memory-gate.ts";
import { registerMemoryGateRoutes } from "../src/memory-gate-routes.ts";
import { composedMemoryRow } from "../src/memory-row.ts";
import { FACE_MEMORY_NAME, memoryOpener } from "../src/memory.ts";
import { setupFaceProfile } from "../src/setup.ts";
import { makeBotsRoot } from "./bots-fixture.ts";
import { mountClient, remote, signIn } from "./remote.ts";

const gated = process.env.FACE_SMOKE !== "1";

/** The stand-in seat write: the raw name the gate reads, behind a server of its own. */
const NAME = "mcp__drill__portfolio_live_order";
/** The paper venue the orders name and the stub Account says is its paper venue. */
const VENUE = "paper-1";
/** The armed lesson. */
const LESSON = "no-buying-in-the-drill";
const LESSON_WORDS = "Do not buy anything in the drill: a red line.";
/** The owner's override, as the card's form would post it. */
const OVERRIDE = { reason: "The drill buys once to prove the override.", wrongIf: "The drill registers nothing." };

type Answer = "allowed-once" | "rejected";
type ToolResult = { isError: boolean; content?: { type?: string; text?: string }[] };

async function waitFor(what: string, check: () => boolean | Promise<boolean>, ms = 15_000): Promise<void> {
  const until = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

const textOf = (result: ToolResult): string => (result.content ?? []).map((b) => b.text ?? "").join("\n");

test("the order card asks the memory: a red line refused, an override and a decline registered, a plain sell passes", {
  skip: gated && "set FACE_SMOKE=1",
}, async () => {
  const made: string[] = [];
  const envBefore = process.env.FACE_MEMORY_HOME;
  const lines: string[] = [];
  let stopFollowing: (() => void) | undefined;
  let gate: ReturnType<typeof createMemoryGate> | undefined;
  let dispose: (() => Promise<void>) | undefined;
  const cleanups: (() => void)[] = [];
  try {
    /* The memory's home, made by the package, with one red line armed by the owner's door. */
    const memoryHome = join(await mkdtemp(join(tmpdir(), "face-memory-gate-home-")), "home");
    made.push(join(memoryHome, ".."));
    assert.equal((await initHome(memoryHome)).created, true, "the package made the home");
    const owner = openMemory(memoryHome);
    const proposal = await owner.propose("drill-proposer", {
      what: "new", lesson: LESSON, reason: "A red line for the drill.",
      card: { id: LESSON, says: "dont", actions: ["buy"], strength: "red-line", words: LESSON_WORDS },
    });
    /* the owner takes the card to lessons/, then arms it */
    await owner.owner.edit(proposal.id);
    await owner.owner.arm(LESSON);

    /* A scratch harness home, the seat's row disabled; the environment names the memory's home for the boot. */
    const home = await mkdtemp(join(tmpdir(), "face-memory-gate-"));
    made.push(home);
    setupFaceProfile(home);
    const patchPath = join(home, "profiles", "face", "cordis.patch.yml");
    const patch = readFileSync(patchPath, "utf8").replace(/^\[\][ \t]*$/m, "");
    writeFileSync(patchPath, `${patch}\n- id: mcp-account\n  disabled: true\n`);
    process.env.FACE_MEMORY_HOME = memoryHome;
    const booted = await bootFace({ profileName: "face", port: 0, dshHome: home, botsRoot: await makeBotsRoot() });
    dispose = booted.dispose;
    const { ctx } = booted;

    /* The gate, bound as main.ts binds it, over the row the tree composed. */
    const loader = ctx.get("loader") as { entries(): Iterable<SeatEntryLike> };
    const open = memoryOpener(composedMemoryRow(loader.entries()));
    const account: GateAccount = {
      paperVenue: async () => VENUE,
      position: async () => null,
      kind: async () => "stock",
      approval: async () => undefined,
    };
    gate = createMemoryGate({
      open,
      facts: async () => ({ facts: { price: 100 }, sources: { price: "the drill's stub quote" } }),
      account,
      log: (line) => { lines.push(line); },
    });
    const bound = gate;
    booted.bindOrderRecall(bound);
    stopFollowing = followAnswers(ctx, bound);
    registerMemoryGateRoutes(ctx.webServer, { gate: () => bound });

    /* The stand-in seat write: its body records and answers as the seat does when an order is placed. */
    const tools = ctx.get("tools") as {
      register(definition: unknown): () => void;
      execute(exec: { callId: string; name: string; arguments: unknown; agent: object; signal: AbortSignal }): Promise<ToolResult>;
    };
    const ran: unknown[] = [];
    cleanups.push(tools.register({
      name: NAME,
      description: "place an order - drill stand-in, nothing behind it",
      parameters: {
        type: "object",
        properties: {
          venue: { type: "string" }, symbol: { type: "string" }, qty: { type: "number" }, side: { type: "string" },
          limitPrice: { type: "number" },
        },
      },
      output: { schema: { type: "object" }, render: (_args: unknown, value: unknown) => [{ type: "text", text: JSON.stringify(value) }] },
      execute: async (args: unknown) => {
        ran.push(args);
        return { ok: true, order: { id: `drill-${ran.length}`, status: "filled" } };
      },
    }));

    /* A session over the wire, its live agent, an open turn. */
    const base = `http://127.0.0.1:${ctx.webServer.port}`;
    mountClient(ctx);
    const cookie = await signIn(ctx, base);
    const created = await remote<{ sessionId: string }>(base, cookie, "session/create", { request: { cwd: home } });
    const agents = ctx.get("agents") as { get(id: string): { session: { append(type: string, data: object): unknown } } | undefined };
    const agent = agents.get(created.sessionId);
    assert.ok(agent, `session/create must leave a live agent for ${created.sessionId}`);
    agent.session.append("turn/start", { turn: 1 });

    /* The gate's two routes over the wire, behind the data fence. */
    const readGate = async (callId: string): Promise<{ status: number; gate?: GateView }> => {
      const res = await fetch(`${base}/data/memory/gate?callId=${encodeURIComponent(callId)}`, { headers: { cookie } });
      const body = (await res.json()) as { gate?: GateView };
      return { status: res.status, ...(body.gate === undefined ? {} : { gate: body.gate }) };
    };
    const postOverride = async (body: object, headers: Record<string, string> = {}): Promise<number> => {
      const res = await fetch(`${base}/data/memory/gate/override`, {
        method: "POST", headers: { "content-type": "application/json", cookie, ...headers }, body: JSON.stringify(body),
      });
      await res.arrayBuffer();
      return res.status;
    };

    /* The outermost answerer: per card, what the route showed while it was pending, an optional act, the answer. */
    const seen = new Map<string, GateView | undefined>();
    let answer: Answer = "allowed-once";
    let beforeAnswer: ((callId: string) => Promise<void>) | undefined;
    const on = ctx.on as unknown as (
      name: "approval/request",
      listener: (req: { callId?: unknown }, next: () => Promise<string>) => Promise<string>,
      options: { prepend: boolean },
    ) => () => void;
    cleanups.push(on.call(ctx, "approval/request", async (req) => {
      const callId = String(req.callId);
      seen.set(callId, (await readGate(callId)).gate);
      await beforeAnswer?.(callId);
      return answer;
    }, { prepend: true }));

    const place = (callId: string, order: object): Promise<ToolResult> =>
      tools.execute({ callId, name: NAME, arguments: order, agent, signal: new AbortController().signal });
    const ownersDecisions = async (): Promise<DecisionLine[]> =>
      (await owner.decisions({ limit: 20 })).items.map((item) => item.view.line).filter((line) => line.whose === "owner");
    const buy = { venue: VENUE, symbol: "NVDA", qty: 1, side: "buy", limitPrice: 100 };

    /* 1. A red-lined buy, approved with no override: the guard refuses it in the lesson's words. */
    const refusedResult = await place("mg-red-line", buy);
    const shown = seen.get("mg-red-line");
    assert.ok(shown, "the card's gate was read over the wire while it was pending");
    assert.equal(shown.state, "checked");
    assert.equal(shown.redLine, true, "the route shows the red line");
    assert.equal(shown.overridden, false);
    assert.equal(shown.lines.length, 1);
    assert.equal(shown.lines[0]?.order, "buy 1 NVDA · limit 100 · paper-1");
    assert.deepEqual(shown.lines[0]?.lessons.map((l) => [l.id, l.strength, l.says, l.words]),
      [[LESSON, "red-line", "dont", LESSON_WORDS]], "the card shows the lesson in its own words");
    assert.match(String(shown.lines[0]?.recall), /\S/, "the check holds a recall id");
    assert.equal(refusedResult.isError, true, `a red line with no override must not run; the tool said ${textOf(refusedResult)}`);
    /* dsh gives a guard's reason to the model behind its own `Error: ` */
    assert.equal(textOf(refusedResult), `Error: ${redLineRefusal(LESSON_WORDS)}`, "the tool's result is the guard's refusal word for word");
    assert.deepEqual(ran, [], "the stand-in body did not run");
    await bound.idle();
    assert.deepEqual(await ownersDecisions(), [], "the memory holds no owner's decision");
    assert.equal((await readGate("mg-red-line")).gate?.lines[0]?.registered, "not registered: the seat refused the order",
      "the refused call's result reached the gate through the root's tool results");
    assert.deepEqual(lines, ["memory gate: mg-red-line: buy 1 NVDA · limit 100 · paper-1: not registered: the seat refused the order"]);

    /* 2. A red-lined buy, overridden over the wire, then approved: the body runs, the owner's approval is written. */
    beforeAnswer = async (callId) => {
      assert.equal(await postOverride({ callId, ...OVERRIDE }, { "sec-fetch-site": "cross-site" }), 403,
        "the override route stands behind the data fence");
      assert.equal(await postOverride({ callId, ...OVERRIDE }), 200, "the override is kept");
    };
    const overriddenResult = await place("mg-overridden", buy);
    beforeAnswer = undefined;
    assert.equal(overriddenResult.isError, false, `an overridden red line runs; the tool said ${textOf(overriddenResult)}`);
    assert.deepEqual(JSON.parse(textOf(overriddenResult)), { ok: true, order: { id: "drill-1", status: "filled" } },
      "the result is the seat's placed shape");
    assert.deepEqual(ran, [buy], "the body ran once");
    const overridden = seen.get("mg-overridden");
    assert.equal(overridden?.redLine, true);
    await waitFor("the owner's approval in the memory", async () => (await ownersDecisions()).length === 1);
    const [approval] = await ownersDecisions();
    assert.equal(approval?.by, FACE_MEMORY_NAME);
    assert.equal(approval?.whose, "owner");
    assert.equal(approval?.action, "buy");
    assert.equal(approval?.thesis, "Approved Gravit's order card: buy 1 NVDA · limit 100 · paper-1.");
    assert.equal(approval?.words, OVERRIDE.reason);
    assert.equal(approval?.wrong_if, OVERRIDE.wrongIf);
    assert.equal(approval?.recall, overridden?.lines[0]?.recall, "the decision names the gate's recall");
    assert.equal(approval?.symbol, "NVDA");
    assert.equal(approval?.price, 100);
    assert.equal(approval?.price_source, "the order card's limit price");
    assert.equal((await readGate("mg-overridden")).gate?.lines[0]?.registered, "registered: buy");

    /* 3. A red-lined buy declined: `pass`, naming its recall. */
    answer = "rejected";
    const declinedResult = await place("mg-declined", buy);
    assert.equal(declinedResult.isError, true, "a declined order does not run");
    assert.deepEqual(ran, [buy], "the body did not run again");
    await waitFor("the owner's decline in the memory", async () => (await ownersDecisions()).length === 2);
    const [decline] = await ownersDecisions();
    assert.equal(decline?.by, FACE_MEMORY_NAME);
    assert.equal(decline?.action, "pass");
    assert.equal(decline?.thesis, "Declined Gravit's order card: buy 1 NVDA · limit 100 · paper-1.");
    assert.equal(decline?.recall, seen.get("mg-declined")?.lines[0]?.recall, "the decline names its recall");

    /* 4. A sell no lesson covers, from flat: no lesson, the one-click answer passes, `short` is written. */
    answer = "allowed-once";
    const sell = { venue: VENUE, symbol: "AAPL", qty: 2, side: "sell" };
    const sold = await place("mg-plain-sell", sell);
    assert.equal(sold.isError, false, `a sell no lesson covers runs; the tool said ${textOf(sold)}`);
    assert.deepEqual(ran, [buy, sell]);
    const plain = seen.get("mg-plain-sell");
    assert.equal(plain?.state, "checked");
    assert.equal(plain?.redLine, false);
    assert.deepEqual(plain?.lines[0]?.lessons, [], "no lesson on the card");
    await waitFor("the owner's sell in the memory", async () => (await ownersDecisions()).length === 3);
    const [short] = await ownersDecisions();
    assert.equal(short?.action, "short");
    assert.equal(short?.symbol, "AAPL");
    assert.equal(short?.by, FACE_MEMORY_NAME);

    /* The read route: an id the gate holds no view of is a 404, a malformed one a 400. */
    assert.equal((await readGate("mg-never-raised")).status, 404);
    assert.equal((await readGate("bad id")).status, 400);
    agent.session.append("turn/end", { turn: 1, reason: { kind: "completed" } });
  } finally {
    for (const off of cleanups.reverse()) {
      try { off(); } catch { /* disposal below tears the tree down regardless */ }
    }
    stopFollowing?.();
    gate?.dispose();
    await dispose?.();
    if (envBefore === undefined) delete process.env.FACE_MEMORY_HOME;
    else process.env.FACE_MEMORY_HOME = envBefore;
    for (const dir of made) await rm(dir, { recursive: true, force: true });
  }
});
