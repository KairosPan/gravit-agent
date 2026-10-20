/** The order gate, drilled on a REAL composed tree.
 *
 * `orders.test.ts` proves the decision logic in isolation. This proves the part
 * isolation cannot: that the listener is actually REGISTERED on a booted face,
 * that it is outermost enough to decide, and that it leaves every other tool
 * alone. The two fail independently — a perfect pure function that `bootFace`
 * forgot to wire is exactly the shape of the `ask_user_question` outage this
 * codebase already lived through once.
 *
 * WHY A STAND-IN NAME, NOT THE REAL TOOL. `face/README.md` forbids drilling
 * with the order tools: arming `ALPACA_KIT_ENABLE_ORDERS` to exercise Gate 2
 * disarms Gate 1 to do it. The gate matches on the RAW name suffix, so
 * `mcp__drill__place_order` exercises the identical code path with nothing
 * behind it — no keys, no broker, no order. This is a better drill than the
 * real tool, not a weaker one.
 *
 * WHAT THIS DOES NOT PROVE: that the approval CARD renders, or that an
 * APPROVED order dispatches. The card needs a human looking at a browser: with
 * `dsh-api-remotes` mounted and no `$events` client connected, an ask blocks
 * rather than denying (the gateway keeps the event pending and replays it to
 * the next client, NEW `packages/api/gateway/src/index.ts:512-516, 599-602`),
 * so it cannot be automated here - that half is the operator drill in
 * `face/README.md`. The approved path (a stand-in answerer returning
 * `allowed-once`, the body RUNS) is `order-gate-smoke.test.ts`.
 *
 * THE HIDDEN ORDER TOOL (spike 3). dsh runs `tools/pre-execute` before it
 * resolves whether the calling scope can see the tool, so the listener asks
 * the registry itself and refuses an order tool the caller cannot see, with
 * no card. Drilled offline on a bare cordis tree, and on the real one by the
 * subtest at the end: a `gravit-desk` session, whose mask never admits an
 * order tool, names the stand-in and is refused in the gate's words with no
 * `approval/asked`, while Gravit's session, on the same tool, gets its card.
 *
 * Gated behind `FACE_SMOKE=1` and in its own FILE for the reason `smoke.test.ts`
 * states: `bootFace` sets `process.env.DSH_HOME` permanently, so one boot per
 * process, and `node --test` gives each file its own.
 * @module
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Service } from "@deepseek-ai/cordis";
import { setupFaceProfile } from "../src/setup.ts";
import { armOrderGate, bootFace } from "../src/boot.ts";
import { DESK_PRESET } from "../src/desk-preset.ts";
import {
  OPERATOR_GATED_MARKER, orderGuardReasonForSession, unreadableSessionLogReason, type PreToolDecision,
} from "../src/orders.ts";
import { mountClient, remote, signIn } from "./remote.ts";

const gated = process.env.FACE_SMOKE !== "1";

/** The listener's refusal of `mcp__drill__place_order` from a caller that
 * cannot see it, verbatim (src/orders.ts orderApprovalDecision). */
const HIDDEN_PLACE_ORDER =
  "mcp__drill__place_order is not available in this session - its preset hides it - so no approval card is raised and the order does not run";

/** An empty session exactly as the REAL `ApprovalService.overrideOf` reads
 * one at dsh 0.2.0: it walks `session.seq - 1` down to 0 through
 * `session.eventAt(seq)` (NEW `packages/interaction/user-approval/src/index.ts:252-259`).
 * The 0.1.1 stub was `{events: []}`; against 0.2.0 that still "passed" only
 * because `undefined - 1` is NaN and the loop never ran - the stated reason
 * ("overrideOf reads exactly session.events") had silently become false. This
 * stub is the shape the service really reads, so the gate calls the REAL
 * service's public surface - `overrideOf` and `config.policy` - rather than the
 * hand-made literals the unit tests use. That is what turns `orders.ts`'s claim
 * about the private `effectivePolicy` from prose the author read into an
 * assertion this tree makes. It deliberately has NO `snapshotEvents`: the
 * listener never reads the log, only the guard does (see the guard case below). */
const emptySession = () => ({ seq: 0, eventAt: (): undefined => undefined });

/** One pending call, shaped as `tools/pre-execute` receives it. */
const pending = (name: string, args?: unknown) => ({
  name,
  callId: `drill-${name}`,
  arguments: args,
  agent: { session: emptySession() },
  signal: new AbortController().signal,
});

/** The same call with nobody to ask - the other branch of the listener. */
const agentless = (name: string) => ({ name, signal: new AbortController().signal });

/** Run `tools/pre-execute` on `ctx` ending in the registry's own terminal:
 * whatever no listener claims is ALLOWED (NEW `packages/core/tools/src/index.ts:1505-1507`).
 * Passing the same terminal here means a decision can only have come from a
 * registered listener - the gate - and an `allow` can only mean nothing
 * claimed the call. */
const firePreExecute = (ctx: unknown, exec: object): Promise<PreToolDecision> =>
  (ctx as {
    waterfall(
      name: "tools/pre-execute",
      exec: object,
      next: () => Promise<PreToolDecision>,
    ): Promise<PreToolDecision>;
  }).waterfall("tools/pre-execute", exec, () => Promise.resolve({ kind: "allow" }));

/** A tool registry reduced to what Gate 2 reads (src/boot.ts armOrderGate):
 * the live lookup `get(name, scope)`, which resolves the names in `visible`
 * for every caller and nothing else, and the guard seam the other half arms
 * through - a no-op, since the offline case below fires the listener alone. */
class ListedTools extends Service {
  constructor(ctx: Context, readonly config: { visible: readonly string[] }) {
    super(ctx, "tools");
  }

  get(name: string): { description: string } | undefined {
    return this.config.visible.includes(name) ? { description: `drill stand-in ${OPERATOR_GATED_MARKER}` } : undefined;
  }

  guard(): () => void {
    return () => {};
  }
}

/** The approval service as the listener reads it: the public halves of its
 * private `effectivePolicy` (src/orders.ts effectiveApprovalPolicy), no override. */
class FakeApproval extends Service {
  constructor(ctx: Context, readonly config: { policy: "ask" | "never" }) {
    super(ctx, "approval");
  }

  overrideOf(): undefined {
    return undefined;
  }
}

/* The guard's session-level decision, offline (no FACE_SMOKE): the unit half of
 * "an unreadable log is not a missing grant". boot.ts's `tools.guard` hands
 * `exec.agent?.session` to this function (PLAN S7 item 1); the real-tree half
 * is the guard case at the end of the smoke below. */
test("guard: a session without snapshotEvents is denied with the distinct reason", () => {
  const reason = orderGuardReasonForSession("mcp__drill__place_order", undefined, emptySession(), "drill-guard");
  assert.equal(reason, unreadableSessionLogReason("mcp__drill__place_order"));
  assert.doesNotMatch(reason ?? "", /without a logged allowed-once/, "unreadable must never read as 'no grant'");
  // The same session WITH the log read passes the ordinary check.
  const readable = { ...emptySession(), snapshotEvents: () => [] };
  assert.match(orderGuardReasonForSession("mcp__drill__place_order", undefined, readable, "drill-guard") ?? "",
    /without a logged allowed-once/);
});

/* The listener's visibility lookup, offline (no FACE_SMOKE), on a bare cordis
 * tree: the listener `armOrderGate` really registers, over fakes of the two
 * services it reads. It looks the tool up through `ctx.get("tools")` at CALL
 * time and never injects `tools`, so a registry that comes, goes or is
 * replaced never re-arms it - the arming order-gate-midboot-smoke pins stays
 * as it was. The real-tree half is the subtest at the end of the smoke below. */
test("ask listener: a hidden order tool is denied before any card; the registry is read per call, and without one the listener decides as before", async () => {
  const root = new Context();
  const gate = armOrderGate(root);
  const hooks = (): readonly object[] => root.events._hooks["tools/pre-execute"] ?? [];
  const order = { symbol: "AAPL", qty: 1, side: "buy" };
  try {
    await root.plugin(FakeApproval, { policy: "ask" });
    await gate.listener.await();
    const armed = hooks()[0];
    assert.ok(armed !== undefined && hooks().length === 1, "the listener armed on approval alone");

    /* No registry: nothing to look in, so the listener decides as it did
     * before it looked - a card. (The guard, waiting for tools, has not armed:
     * that order would still be denied at dispatch, with no logged grant.) */
    assert.equal((await firePreExecute(root, pending("mcp__drill__place_order", order))).kind, "ask");

    /* A registry that does not resolve the tool for this caller: refused in
     * the gate's own words, before any card could be raised. */
    const hiding = root.plugin(ListedTools, { visible: [] });
    await hiding;
    assert.deepEqual(await firePreExecute(root, pending("mcp__drill__place_order", order)),
      { kind: "deny", reason: HIDDEN_PLACE_ORDER });
    /* Only order tools are looked up: anything else still falls through. And
     * an agentless call keeps its own sentence - the session check comes first. */
    assert.equal((await firePreExecute(root, pending("bash"))).kind, "allow");
    const agentlessDecision = await firePreExecute(root, agentless("mcp__drill__place_order"));
    assert.match(agentlessDecision.kind === "deny" ? agentlessDecision.reason : "", /no session to ask in/);

    /* Replaced by a registry that resolves it: the very next call asks. The
     * listener read the live registry, and it did not re-arm to do so. */
    await hiding.dispose();
    const showing = root.plugin(ListedTools, { visible: ["mcp__drill__place_order"] });
    await showing;
    assert.equal((await firePreExecute(root, pending("mcp__drill__place_order", order))).kind, "ask");
    assert.equal(hooks().length, 1);
    assert.equal(hooks()[0], armed, "the same listener record throughout: tools is not in its inject list");
  } finally {
    await root.fiber.dispose();
  }
});

/** A live agent as the hidden-tool subtest drives it: its session's turn
 * markers and its log. */
interface LiveAgent {
  session: {
    append(type: string, data: object): unknown;
    snapshotEvents(): readonly { type: string; data?: { callId?: unknown; toolName?: unknown } }[];
  };
}

test("order gate: registered on a real tree, asks for orders, leaves everything else alone", {
  skip: gated && "set FACE_SMOKE=1",
}, async (t) => {
  const home = mkdtempSync(join(tmpdir(), "face-ordergate-"));
  setupFaceProfile(home);
  const patchPath = join(home, "profiles", "face", "cordis.patch.yml");
  const patch = readFileSync(patchPath, "utf8").replace(/^\[\][ \t]*$/m, "");
  // This smoke owns a scratch profile and must not start the operator's data server.
  writeFileSync(patchPath, `${patch}\n- id: mcp-akshare\n  disabled: true\n`);
  const { ctx, dispose } = await bootFace({ profileName: "face", port: 0, dshHome: home });
  try {
    /* The registry's own terminal (`firePreExecute`, above): a decision below
     * can only have come from a registered listener - the gate - and an
     * `allow` can only mean nothing claimed the call. */
    const fire = (exec: object): Promise<PreToolDecision> => firePreExecute(ctx, exec);
    const registry = ctx.get("tools") as {
      get(name: string, scope?: unknown): unknown;
      register(definition: unknown): () => void;
      execute(exec: object): Promise<{ isError: boolean; content?: { text?: string }[] }>;
    };

    /* THE STAND-INS. The listener asks only for an order tool the caller can
     * SEE - one the calling scope does not resolve is refused before any card
     * (the hidden-tool subtest below) - so the drill registers the order names
     * it fires, globally: the stub agents here see the global view, and so
     * does Gravit. Nothing is behind them; each body only records, and `ran`
     * must stay empty - nothing in this file dispatches an order. Left to the
     * tree's disposal, which takes every registration with it. */
    const ran: unknown[] = [];
    for (const name of ["mcp__drill__place_order", "mcp__drill__cancel_order", "mcp__whatever_they_call_it__place_order"]) {
      registry.register({
        name,
        description: `place or cancel a PAPER order - drill stand-in, nothing behind it ${OPERATOR_GATED_MARKER}`,
        parameters: {
          type: "object",
          properties: { symbol: { type: "string" }, qty: { type: "number" }, side: { type: "string" }, order_id: { type: "string" } },
        },
        output: { schema: { type: "object" }, render: () => [{ type: "text", text: "drill order recorded" }] },
        execute: async (args: unknown) => {
          ran.push(args);
          return { recorded: true };
        },
      });
    }

    /* THE ASK PATH, against the real ApprovalService. This is the assertion the
     * whole change rests on: the listener is registered, it reaches the live
     * approval service, that service's default policy is `ask`, and the gate
     * therefore raises a card rather than denying or allowing. */
    const decision = await fire(pending("mcp__drill__place_order", {
      symbol: "AAPL", qty: 1, side: "buy",
    }));
    assert.equal(decision.kind, "ask", "an order under the default policy must raise a card");
    /* And the card must be decidable - a human approving a tool NAME is a
     * click-through, not an approval. */
    const reason = decision.kind === "ask" ? decision.reason ?? "" : "";
    assert.match(reason, /AAPL/, `the card must name the order; saw ${JSON.stringify(reason)}`);
    assert.match(reason, /side=buy/);

    assert.equal((await fire(pending("mcp__drill__cancel_order", { order_id: "x" }))).kind, "ask");

    /* No session, nobody to ask: deny in our own words rather than let the
     * registry report a refusal nobody made. */
    assert.equal((await fire(agentless("mcp__drill__place_order"))).kind, "deny");

    /* The read-only listing must pass. This is the assertion that would catch a
     * substring match on "order" - gating a harmless query is a real cost, and
     * the kind of over-reach that gets a gate switched off wholesale. */
    assert.equal((await fire(pending("mcp__drill__orders"))).kind, "allow");

    // And the rest of the toolset is untouched.
    for (const name of ["bash", "ask_user_question", "mcp__drill__account"]) {
      assert.equal((await fire(pending(name))).kind, "allow", name);
    }

    /* The gate is name-anchored, so an operator renaming their MCP server does
     * not open a hole. Drilled with a server name sharing no substring with the
     * real one. */
    assert.equal((await fire(pending("mcp__whatever_they_call_it__place_order"))).kind, "ask");

    /* THE GUARD, through the real pipeline. Registered AFTER boot on purpose:
     * that is the case the boot audit structurally cannot catch, and the one
     * `dsh-mcp-client` makes reachable by defaulting `failOnStartupError` to
     * false, so a server whose first connection failed still activates and
     * registers its tools later. The name does not match, so the listener does
     * not claim it and the waterfall falls through to its terminal ALLOW - the
     * denial below can therefore only have come from the guard (it runs on
     * every allow, NEW `packages/core/tools/src/index.ts:1519`). */
    let bodyRan = false;
    const unregister = registry.register({
      name: "mcp__drill__submit_order",
      description: "submit a PAPER order (operator-gated)",
      parameters: {},
      output: { schema: { type: "object" }, render: () => [{ type: "text", text: "ok" }] },
      execute: async () => {
        bodyRan = true;
        return {};
      },
    });
    try {
      const result = await registry.execute({
        callId: "drill-guard",
        name: "mcp__drill__submit_order",
        arguments: {},
        signal: new AbortController().signal,
      });
      assert.equal(result.isError, true, "a marked tool the gate cannot name must not dispatch");
      assert.equal(bodyRan, false, "the tool body must never run");
      assert.match(result.content?.[0]?.text ?? "", /ORDER_RAW_NAMES/);

      /* The same gated tool, called by an agent whose session cannot hand
       * over its log (no `snapshotEvents` - the dsh 0.2.0 drift shape). The
       * real guard must fail closed AND say why: "cannot read this session's
       * log", never the "no grant" or "rename" sentence that hid the
       * regression. Integration half of the offline test above. */
      const unreadable = await registry.execute({
        callId: "drill-guard-unreadable",
        name: "mcp__drill__submit_order",
        arguments: {},
        agent: { session: emptySession() },
        signal: new AbortController().signal,
      });
      assert.equal(unreadable.isError, true);
      assert.equal(bodyRan, false, "the tool body must never run");
      assert.match(unreadable.content?.[0]?.text ?? "", /cannot read this session's log/);
    } finally {
      unregister();
    }

    /* THE HIDDEN ORDER TOOL (spike 3). dsh runs `tools/pre-execute` BEFORE it
     * resolves whether the calling scope can see the tool (dsh-tools
     * `prepareExecution`, then `dispatchToolBody`'s `ToolNotFoundError`), so a
     * session whose preset masks an order tool used to reach the listener and
     * raise a card - which, with no browser, parks, and which, approved, would
     * fail `unknown tool` at dispatch. The desk's preset is such a session:
     * its mask (src/desk-preset.ts DESK_ALLOW) never admits an order tool. A
     * subtest, not a second test: one boot per process. */
    await t.test("a masked preset's call to the stand-in order tool is denied with no approval/asked event", async () => {
      const base = `http://127.0.0.1:${ctx.webServer.port}`;
      mountClient(ctx);
      const cookie = await signIn(ctx, base);
      const agents = ctx.get("agents") as { get(id: string): LiveAgent | undefined };
      /** A real session over the Remote, as the browser opens one, and its live agent. */
      const open = async (agentPreset?: string): Promise<LiveAgent> => {
        const request = agentPreset === undefined ? { cwd: home } : { cwd: home, agentPreset };
        const created = await remote<{ sessionId: string; agentPreset?: string }>(base, cookie, "session/create", { request });
        assert.equal(created.agentPreset, agentPreset ?? "gravit");
        const agent = agents.get(created.sessionId);
        assert.ok(agent !== undefined, `session/create must leave a live agent for ${created.sessionId}`);
        return agent;
      };
      const NAME = "mcp__drill__place_order";
      const ORDER = { symbol: "AAPL", qty: 1, side: "buy" };
      const desk = await open(DESK_PRESET);
      const gravit = await open();
      /* The premise, from the registry itself: the same global stand-in is
       * hidden from the desk by its mask and visible to Gravit. */
      assert.equal(registry.get(NAME, desk), undefined, "the desk's mask hides the order stand-in");
      assert.notEqual(registry.get(NAME, gravit), undefined, "Gravit's composition does not");

      /* Every card raised from here on is recorded, and answered `rejected` at
       * once, outermost (prepend) so the gateway never parks it: a regression
       * fails this subtest instead of hanging it on a card nobody can answer. */
      const cards: { toolName?: unknown; callId?: unknown }[] = [];
      const on = ctx.on as unknown as (
        name: "approval/request",
        listener: (req: { toolName?: unknown; callId?: unknown }) => Promise<string>,
        options: { prepend: boolean },
      ) => () => void;
      const offCards = on.call(ctx, "approval/request", (req) => {
        cards.push({ toolName: req.toolName, callId: req.callId });
        return Promise.resolve("rejected");
      }, { prepend: true });
      try {
        /* THE DESK: its model names the hidden tool inside an open turn, and
         * the call goes through the real registry, as the agent loop sends it. */
        desk.session.append("turn/start", { turn: 1 });
        const refused = await registry.execute({
          callId: "drill-desk-hidden", name: NAME, arguments: ORDER, agent: desk, signal: new AbortController().signal,
        });
        desk.session.append("turn/end", { turn: 1, reason: { kind: "completed" } });
        assert.equal(refused.isError, true, "a hidden order tool must not dispatch");
        assert.equal(refused.content?.[0]?.text, `Error: ${HIDDEN_PLACE_ORDER}`,
          "refused in the gate's own words - not dsh's `unknown tool`, not a rejection nobody made");
        assert.deepEqual(cards, [], "no approval card was raised for it");
        assert.equal(desk.session.snapshotEvents().some((event) => event.type === "approval/asked"), false,
          "and no approval/asked is in the desk's log");
        /* The listener's own decision, isolated from the rest of the pipeline. */
        assert.deepEqual(await fire({ ...pending(NAME, ORDER), agent: desk }), { kind: "deny", reason: HIDDEN_PLACE_ORDER });

        /* GRAVIT, the same tool on the same tree: visible, so it still asks -
         * and through the registry the card is raised, logged and answered
         * (`rejected` by the recorder), never dispatched. */
        const asked = await fire({ ...pending(NAME, ORDER), agent: gravit });
        assert.equal(asked.kind, "ask", "a Gravit session calling the same tool still gets ask");
        assert.match(asked.kind === "ask" ? asked.reason ?? "" : "", /PAPER order - .*symbol=AAPL/);
        gravit.session.append("turn/start", { turn: 1 });
        const answered = await registry.execute({
          callId: "drill-gravit-visible", name: NAME, arguments: ORDER, agent: gravit, signal: new AbortController().signal,
        });
        gravit.session.append("turn/end", { turn: 1, reason: { kind: "completed" } });
        assert.match(answered.content?.[0]?.text ?? "", /the user rejected tool "mcp__drill__place_order"/);
        assert.deepEqual(cards, [{ toolName: NAME, callId: "drill-gravit-visible" }], "exactly one card was raised: Gravit's");
        assert.ok(gravit.session.snapshotEvents().some((event) =>
          event.type === "approval/asked" && event.data?.callId === "drill-gravit-visible"), "and it is in Gravit's log");
        assert.deepEqual(ran, [], "no order body ran in this file");
      } finally {
        offCards();
      }
    });
  } finally {
    await dispose();
  }
});
