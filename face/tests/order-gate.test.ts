/** The order gate, drilled on a REAL composed tree.
 *
 * `orders.test.ts` proves the decision logic in isolation. This proves the part
 * isolation cannot: that the listener is actually REGISTERED on a booted face,
 * that it is outermost enough to decide, and that it leaves every other tool
 * alone. The two fail independently — a perfect pure function that `bootFace`
 * forgot to wire is exactly the shape of the `ask_user_question` outage this
 * codebase already lived through once.
 *
 * WHY A STAND-IN NAME, NOT THE REAL TOOL. The gate matches the seat's writes
 * on the RAW name suffix, so `mcp__drill__portfolio_live_order` exercises the
 * identical code path with nothing behind it — no seat, no Account, no venue,
 * no order. This is a better drill than the real tool, not a weaker one.
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
import { setupFaceProfile } from "../src/setup.ts";
import { bootFace } from "../src/boot.ts";
import {
  orderGuardReasonForSession, unreadableSessionLogReason, type PreToolDecision,
} from "../src/orders.ts";

const gated = process.env.FACE_SMOKE !== "1";

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

/* The guard's session-level decision, offline (no FACE_SMOKE): the unit half of
 * "an unreadable log is not a missing grant". boot.ts's `tools.guard` hands
 * `exec.agent?.session` to this function (PLAN S7 item 1); the real-tree half
 * is the guard case at the end of the smoke below. */
test("guard: a session without snapshotEvents is denied with the distinct reason", () => {
  const reason = orderGuardReasonForSession("mcp__drill__portfolio_live_order", emptySession(), "drill-guard");
  assert.equal(reason, unreadableSessionLogReason("mcp__drill__portfolio_live_order"));
  assert.doesNotMatch(reason ?? "", /without a logged allowed-once/, "unreadable must never read as 'no grant'");
  // The same session WITH the log read passes the ordinary check.
  const readable = { ...emptySession(), snapshotEvents: () => [] };
  assert.match(orderGuardReasonForSession("mcp__drill__portfolio_live_order", readable, "drill-guard") ?? "",
    /without a logged allowed-once/);
});

test("order gate: registered on a real tree, asks for orders, leaves everything else alone", {
  skip: gated && "set FACE_SMOKE=1",
}, async () => {
  const home = mkdtempSync(join(tmpdir(), "face-ordergate-"));
  setupFaceProfile(home);
  const patchPath = join(home, "profiles", "face", "cordis.patch.yml");
  const patch = readFileSync(patchPath, "utf8").replace(/^\[\][ \t]*$/m, "");
  // This smoke owns a scratch profile and must not start the operator's data server.
  writeFileSync(patchPath, `${patch}\n- id: mcp-akshare\n  disabled: true\n- id: mcp-account\n  disabled: true\n`);
  const { ctx, dispose } = await bootFace({ profileName: "face", port: 0, dshHome: home });
  try {
    /* The registry's own terminal: whatever no listener claims is ALLOWED
     * (NEW `packages/core/tools/src/index.ts:1505-1507`). Passing the same terminal here means a
     * decision below can only have come from a registered listener - the gate -
     * and an `allow` can only mean nothing claimed the call. */
    const fire = (exec: object): Promise<PreToolDecision> =>
      (ctx as unknown as {
        waterfall(
          name: "tools/pre-execute",
          exec: object,
          next: () => Promise<PreToolDecision>,
        ): Promise<PreToolDecision>;
      }).waterfall("tools/pre-execute", exec, () => Promise.resolve({ kind: "allow" }));

    /* THE ASK PATH, against the real ApprovalService. This is the assertion the
     * whole change rests on: the listener is registered, it reaches the live
     * approval service, that service's default policy is `ask`, and the gate
     * therefore raises a card rather than denying or allowing. */
    const decision = await fire(pending("mcp__drill__portfolio_live_order", {
      venue: "paper-1", symbol: "AAPL", side: "buy", usd: 100,
    }));
    assert.equal(decision.kind, "ask", "a seat order under the default policy must raise a card");
    /* And the card must be decidable - a human approving a tool NAME is a
     * click-through, not an approval - and it is the seat's, never PAPER. */
    const reason = decision.kind === "ask" ? decision.reason ?? "" : "";
    assert.match(reason, /AAPL/, `the card must name the order; saw ${JSON.stringify(reason)}`);
    assert.match(reason, /side=buy/);
    assert.match(reason, /^Account seat - .*venue=paper-1/);

    assert.equal((await fire(pending("mcp__drill__portfolio_live_cancel", { venue: "paper-1", order: "x" }))).kind, "ask");
    assert.equal((await fire(pending("mcp__drill__portfolio_account", {}))).kind, "allow", "a seat read is never gated");

    /* No session, nobody to ask: deny in our own words rather than let the
     * registry report a refusal nobody made. */
    assert.equal((await fire(agentless("mcp__drill__portfolio_live_order"))).kind, "deny");

    /* A name that merely mentions an order must pass. This is the assertion
     * that would catch a substring match on "order" - gating a harmless query
     * is a real cost, and the kind of over-reach that gets a gate switched off
     * wholesale. The alpaca-kit pair is nobody's any more. */
    for (const name of ["mcp__drill__orders", "mcp__drill__portfolio_live_positions", "mcp__drill__place_order", "mcp__drill__cancel_order"]) {
      assert.equal((await fire(pending(name))).kind, "allow", name);
    }

    // And the rest of the toolset is untouched.
    for (const name of ["bash", "ask_user_question", "mcp__drill__account"]) {
      assert.equal((await fire(pending(name))).kind, "allow", name);
    }

    /* The gate is name-anchored, so an operator renaming their MCP server does
     * not open a hole. Drilled with a server name sharing no substring with the
     * real one. */
    assert.equal((await fire(pending("mcp__whatever_they_call_it__portfolio_pay"))).kind, "ask");

    /* THE GUARD, through the real pipeline. Registered AFTER boot on purpose:
     * that is the case the boot audit structurally cannot catch, and the one
     * `dsh-mcp-client` makes reachable by defaulting `failOnStartupError` to
     * false, so a server whose first connection failed still activates and
     * registers its tools later. An outer `tools/pre-execute` listener swallows
     * the gate's ask and ALLOWS - the override a sighting-based guard would wave
     * through - so the denial below can only have come from the guard (it runs
     * on every allow, NEW `packages/core/tools/src/index.ts:1519`), which asks
     * the session log for a grant rather than any listener. */
    const registry = ctx.get("tools") as {
      register(definition: unknown): () => void;
      execute(exec: object): Promise<{ isError: boolean; content?: { text?: string }[] }>;
    };
    const STAND_IN = "mcp__drill__portfolio_live_order";
    let bodyRan = false;
    const unregister = registry.register({
      name: STAND_IN,
      description: "place an order - drill stand-in, nothing behind it",
      parameters: {},
      output: { schema: { type: "object" }, render: () => [{ type: "text", text: "ok" }] },
      execute: async () => {
        bodyRan = true;
        return {};
      },
    });
    const swallow = (ctx.on as unknown as (
      name: "tools/pre-execute",
      listener: (exec: { callId?: string }, next: () => Promise<PreToolDecision>) => Promise<PreToolDecision>,
      options: { prepend: boolean },
    ) => () => void).call(ctx, "tools/pre-execute", (exec, next) =>
      exec.callId?.startsWith("drill-guard") === true ? Promise.resolve({ kind: "allow" }) : next(), { prepend: true });
    try {
      const result = await registry.execute({
        callId: "drill-guard",
        name: STAND_IN,
        arguments: {},
        signal: new AbortController().signal,
      });
      assert.equal(result.isError, true, "a seat write whose ask was swallowed must not dispatch");
      assert.equal(bodyRan, false, "the tool body must never run");
      assert.match(result.content?.[0]?.text ?? "", /without a logged allowed-once approval/);

      /* The same gated tool, called by an agent whose session cannot hand
       * over its log (no `snapshotEvents` - the dsh 0.2.0 drift shape). The
       * real guard must fail closed AND say why: "cannot read this session's
       * log", never the "no grant" sentence that hid the regression.
       * Integration half of the offline test above. */
      const unreadable = await registry.execute({
        callId: "drill-guard-unreadable",
        name: STAND_IN,
        arguments: {},
        agent: { session: emptySession() },
        signal: new AbortController().signal,
      });
      assert.equal(unreadable.isError, true);
      assert.equal(bodyRan, false, "the tool body must never run");
      assert.match(unreadable.content?.[0]?.text ?? "", /cannot read this session's log/);
    } finally {
      swallow();
      unregister();
    }
  } finally {
    await dispose();
  }
});
