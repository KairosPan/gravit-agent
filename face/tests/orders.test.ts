import test from "node:test";
import assert from "node:assert/strict";
import {
  auditOrderTools, describeOrder, effectiveApprovalPolicy, hasApprovalGrant,
  isOrderTool, isSeatWriteTool, orderApprovalDecision, orderGuardReason, orderGuardReasonForSession,
  unreadableSessionLogReason, type PreToolDecision,
} from "../src/orders.ts";

/* --- which tools the gate claims ------------------------------------------ */

test("isOrderTool: the alpaca-kit pair is no longer an order tool, raw or as dsh minted it", () => {
  for (const raw of ["place_order", "cancel_order"]) {
    assert.equal(isOrderTool(raw), false, raw);
    assert.equal(isOrderTool(`mcp__alpaca-kit__${raw}`), false, `mcp__alpaca-kit__${raw}`);
  }
});

test("isOrderTool: a server rename cannot slip a seat write past", () => {
  // The serverName is the operator's, in their cordis patch, not this repo's.
  assert.equal(isOrderTool("mcp__broker__portfolio_live_order"), true);
  assert.equal(isOrderTool("mcp__broker_prod__portfolio_live_cancel"), true);
});

test("isOrderTool: a name that merely mentions an order is NOT gated", () => {
  // The trap a substring test for "order" would fall into.
  assert.equal(isOrderTool("orders"), false);
  assert.equal(isOrderTool("mcp__x__orders"), false);
  assert.equal(isOrderTool("mcp__x__portfolio_live_order_book"), false);
  assert.equal(isOrderTool("mcp__account__portfolio_live_positions"), false);
});

/* --- the decision --------------------------------------------------------- */

test("orderApprovalDecision: anything that is not an order tool is none of our business", () => {
  // null, not allow: the caller must delegate to next(), leaving other
  // listeners' decisions intact rather than overriding them with an allow.
  assert.equal(orderApprovalDecision("mcp__account__portfolio_account", "ask"), null);
  assert.equal(orderApprovalDecision("mcp__alpaca-kit__place_order", "ask"), null);
  assert.equal(orderApprovalDecision("bash", "ask"), null);
});

test("orderApprovalDecision: an order under policy `ask` raises a card", () => {
  const decision = orderApprovalDecision("mcp__account__portfolio_live_order", "ask");
  assert.equal(decision?.kind, "ask");
});

test("orderApprovalDecision: under policy `never` it denies ITSELF, and says nobody was asked", () => {
  // Returning `ask` here would be worse than useless: ApprovalService
  // short-circuits on `never` before any answerer runs, and dsh-tools renders
  // that as `the user rejected tool "..."` - false, because nobody was asked.
  const decision = orderApprovalDecision("mcp__account__portfolio_live_order", "never");
  assert.equal(decision?.kind, "deny");
  const reason = decision?.kind === "deny" ? decision.reason : "";
  assert.match(reason, /nobody was asked/i);
  assert.doesNotMatch(reason, /the user rejected/i);
  // It must name the way out, or the operator is stuck with a refusal they cannot explain.
  assert.match(reason, /danger-full-access/);
});

/* --- the policy this all turns on ----------------------------------------- */

test("effectiveApprovalPolicy: override wins, then config, then `ask`", () => {
  const session = {};
  assert.equal(
    effectiveApprovalPolicy({ overrideOf: () => "never", config: { policy: "ask" } }, session),
    "never",
  );
  assert.equal(
    effectiveApprovalPolicy({ overrideOf: () => undefined, config: { policy: "never" } }, session),
    "never",
  );
  assert.equal(effectiveApprovalPolicy({ overrideOf: () => undefined }, session), "ask");
});

test("effectiveApprovalPolicy: a runtime switch to danger-full-access disarms the card, so it denies", () => {
  // The whole reason the policy is read per call rather than once at boot.
  const approval = { overrideOf: () => "never" as const, config: { policy: "ask" as const } };
  const policy = effectiveApprovalPolicy(approval, {});
  assert.equal(orderApprovalDecision("mcp__account__portfolio_live_order", policy)?.kind, "deny");
});

/* --- the registry cross-check --------------------------------------------- */

test("a market read raises no card, and the seat's two connected reads are reads", () => {
  for (const name of ["mcp__market__market_book", "mcp__market__market_explore", "mcp__market__market_candles", "mcp__market__market_quotes", "mcp__market__market_akshare"]) {
    assert.equal(isOrderTool(name), false, name);
    assert.equal(orderApprovalDecision(name, "ask"), null, name);
  }
  for (const name of ["mcp__account__portfolio_live_book", "mcp__account__portfolio_live_candles"]) {
    assert.equal(isOrderTool(name), false, `${name} is classified a read`);
    assert.equal(orderApprovalDecision(name, "ask"), null, name);
  }
  /* the four that left the seat are no longer classified: one an older seat still registers is carded */
  for (const raw of ["portfolio_explore", "portfolio_candles", "portfolio_book", "portfolio_akshare"]) assert.equal(isOrderTool(`mcp__account__${raw}`), true, raw);
  const audit = auditOrderTools([{ name: "mcp__market__market_book" }, { name: "mcp__account__portfolio_live_book" }, { name: "mcp__account__portfolio_live_order" }]);
  assert.deepEqual(audit.gated, ["mcp__account__portfolio_live_order"]);
  assert.deepEqual(audit.uncovered, []);
});

test("auditOrderTools: reports the covered seat writes", () => {
  const audit = auditOrderTools([
    { name: "mcp__account__portfolio_live_order", description: "Place an order at a venue the owner connected live" },
    { name: "mcp__account__portfolio_live_cancel", description: "Cancel an order" },
    { name: "mcp__account__portfolio_holdings", description: "What is held" },
    { name: "bash", description: "run a command" },
  ]);
  assert.deepEqual(audit.gated, ["mcp__account__portfolio_live_order", "mcp__account__portfolio_live_cancel"]);
  assert.deepEqual(audit.uncovered, []);
});

test("auditOrderTools: a seat whose writes the gate covers none of is reported uncovered, not silently missed", () => {
  // The failure the boot assertion exists for: the seat is mounted under an
  // operator's server name - its reads are there - but the Account renamed its
  // writes, so the gate would cover nothing while the face came up healthy.
  const audit = auditOrderTools([
    { name: "mcp__broker__portfolio_account", description: "Who this seat is" },
    { name: "mcp__broker__portfolio_holdings", description: "What is held" },
    { name: "mcp__broker__portfolio_place", description: "Place an order (renamed at the Account)" },
  ]);
  assert.deepEqual(audit.gated, []);
  assert.deepEqual(audit.uncovered, ["mcp__broker__"]);
});

test("auditOrderTools: under the face's own seat prefix a renamed write is carded, so the seat is covered", () => {
  const audit = auditOrderTools([
    { name: "mcp__account__portfolio_account", description: "Who this seat is" },
    { name: "mcp__account__portfolio_place", description: "Place an order (renamed at the Account)" },
  ]);
  assert.deepEqual(audit.gated, ["mcp__account__portfolio_place"]);
  assert.deepEqual(audit.uncovered, []);
});

test("auditOrderTools: an empty registry is empty, not an error; a retired order tool is reported under any server name", () => {
  // No seat mounted is the normal case of a scratch home, and it must not trip
  // the boot assertion.
  assert.deepEqual(auditOrderTools([]), { gated: [], uncovered: [], retired: [] });
  // An operator's home still mounting an alpaca-kit install outside this tree:
  // the seat is the only order path, so the boot is refused on these.
  assert.deepEqual(
    auditOrderTools([
      { name: "mcp__alpaca-kit__place_order", description: "submit a PAPER order (operator-gated)" },
      { name: "mcp__broker__cancel_order", description: "cancel" },
      { name: "mcp__alpaca-kit__account", description: "account snapshot" },
      { name: "mcp__alpaca-kit__orders", description: "list orders" },
    ]),
    { gated: [], uncovered: [], retired: ["mcp__alpaca-kit__place_order", "mcp__broker__cancel_order"] },
  );
});

/* --- the grant check: a sighting is not an approval ----------------------- */

const asked = (id: string, callId: string, toolName = "mcp__x__portfolio_live_order") =>
  ({ type: "approval/asked", data: { id, callId, toolName } });
const decided = (id: string, outcome: string) => ({ type: "approval/decided", data: { id, outcome } });

test("hasApprovalGrant: a logged allowed-once for THIS call is a grant", () => {
  assert.equal(hasApprovalGrant([asked("a1", "c1"), decided("a1", "allowed-once")], "c1"), true);
});

test("hasApprovalGrant: an ask with no decision yet is not a grant", () => {
  assert.equal(hasApprovalGrant([asked("a1", "c1")], "c1"), false);
});

test("hasApprovalGrant: a rejection is not a grant, and neither is a cancellation", () => {
  for (const outcome of ["rejected", "cancelled", "unavailable"]) {
    assert.equal(hasApprovalGrant([asked("a1", "c1"), decided("a1", outcome)], "c1"), false, outcome);
  }
});

test("hasApprovalGrant: a grant for a DIFFERENT call does not carry over", () => {
  // The whole point of matching on callId: one approval, one dispatch.
  const events = [asked("a1", "c1"), decided("a1", "allowed-once")];
  assert.equal(hasApprovalGrant(events, "c2"), false);
});

test("hasApprovalGrant: an unrelated decided event cannot satisfy it", () => {
  // A sandbox escalation approved in the same turn must not license an order.
  const events = [asked("other", "c9"), decided("other", "allowed-once")];
  assert.equal(hasApprovalGrant(events, "c1"), false);
});

test("hasApprovalGrant: no callId is never a grant", () => {
  assert.equal(hasApprovalGrant([asked("a1", "c1"), decided("a1", "allowed-once")], undefined), false);
});

/* --- the card has to be readable ------------------------------------------ */

test("describeOrder: the card names the order, not just the tool", () => {
  const line = describeOrder("mcp__account__portfolio_live_order", {
    venue: "paper-1", symbol: "AAPL", qty: 10, side: "buy", orderType: "limit", limitPrice: 195.5,
  });
  for (const fragment of ["AAPL", "qty=10", "side=buy", "limit", "195.5", "venue=paper-1"]) {
    assert.match(line, new RegExp(fragment.replace(".", "\\.")), fragment);
  }
});

test("describeOrder: an unknown field is shown, not dropped", () => {
  // Rule 5: a tool that grows a field must not grow a silent one.
  assert.match(describeOrder("t", { symbol: "X", time_in_force: "gtc" }), /time_in_force=gtc/);
});

test("describeOrder: a nested object is shown one level deep, as a batch's legs are", () => {
  assert.equal(describeOrder("t", { nested: { a: 1 } }), "t: nested={a=1}");
});

test("describeOrder: odd arguments degrade to the tool name, never throw", () => {
  for (const args of [undefined, null, "text", 42, []]) {
    assert.equal(describeOrder("mcp__x__portfolio_live_order", args), "mcp__x__portfolio_live_order");
  }
  assert.equal(describeOrder("t", {}), "t");
  assert.equal(describeOrder("t", { nested: { a: 1 } }), "t: nested={a=1}");
});

test("orderApprovalDecision: the ask reason carries the order, so the card is decidable", () => {
  const decision = orderApprovalDecision("mcp__account__portfolio_live_order", "ask", {
    symbol: "TSLA", qty: 3, side: "sell",
  });
  assert.equal(decision?.kind, "ask");
  assert.match(decision?.kind === "ask" ? decision.reason ?? "" : "", /TSLA/);
});

/* --- the guard: the monotonic half --------------------------------------- */

const granted = [asked("g", "c1"), decided("g", "allowed-once")];

test("orderGuardReason: an approved order passes", () => {
  assert.equal(orderGuardReason("mcp__x__portfolio_live_order", granted, "c1"), undefined);
});

test("orderGuardReason: an order with NO grant is denied - a sighting is not an approval", () => {
  // The override case: a listener registered outside this gate takes our `ask`
  // and returns `allow`. The old witnessed-WeakSet guard waved that through,
  // having seen the call. Only the log proves a human said yes.
  const reason = orderGuardReason("mcp__x__portfolio_live_order", [], "c1");
  assert.match(reason ?? "", /without a logged allowed-once/);
});

test("orderGuardReason: a rejected order is denied", () => {
  const events = [asked("g", "c1"), decided("g", "rejected")];
  assert.notEqual(orderGuardReason("mcp__x__portfolio_live_order", events, "c1"), undefined);
});

test("orderGuardReason: a grant for another call does not let this one through", () => {
  assert.notEqual(orderGuardReason("mcp__x__portfolio_live_order", granted, "c2"), undefined);
});

test("orderGuardReason: a retired order tool is denied outright under any server name - nothing approves it, not even a logged grant", () => {
  for (const name of ["place_order", "cancel_order", "mcp__alpaca-kit__place_order", "mcp__drill__cancel_order"]) {
    const grant = [asked("r1", "c1", name), decided("r1", "allowed-once")];
    for (const events of [undefined, [], grant]) {
      const reason = orderGuardReason(name, events, "c1") ?? "";
      assert.match(reason, /is a retired order tool/, name);
      assert.match(reason, /nothing approves it/, name);
      assert.match(reason, /remove its MCP row/, name);
    }
    for (const session of [undefined, {}, { snapshotEvents: () => grant }, { snapshotEvents: () => { throw new Error("x"); } }]) {
      assert.match(orderGuardReasonForSession(name, session, "c1") ?? "", /is a retired order tool/, `${name} with any session`);
    }
  }
  for (const name of ["orders", "mcp__x__orders", "mcp__x__place_order_book"]) {
    assert.equal(orderGuardReason(name, [], "c1"), undefined, `${name} is no retired tool`);
  }
});

test("hasApprovalGrant: a grant won for ANOTHER tool cannot be replayed onto an order", () => {
  // callId is the model's own tool-call id, so it is not by itself proof of
  // WHICH tool a human approved.
  const events = [asked("a1", "c1", "bash"), decided("a1", "allowed-once")];
  assert.equal(hasApprovalGrant(events, "c1", "mcp__x__portfolio_live_order"), false);
  assert.equal(hasApprovalGrant(events, "c1", "bash"), true);
});

test("hasApprovalGrant: an id-less asked event cannot pair with an id-less decision", () => {
  const events = [
    { type: "approval/asked", data: { callId: "c1", toolName: "mcp__x__portfolio_live_order" } },
    { type: "approval/decided", data: { outcome: "allowed-once" } },
  ];
  assert.equal(hasApprovalGrant(events, "c1", "mcp__x__portfolio_live_order"), false);
});

test("describeOrder: a crafted field that is not a key field cannot run away with the operator's only line", () => {
  const line = describeOrder("t", { symbol: "X", note: "N".repeat(200) });
  assert.ok(line.length < 80, `card line must stay readable; got ${line.length} chars`);
  assert.match(line, /note=N{40}…/);
});

/* The fields the operator decides on — a venue, a symbol, an id, an address, a payee's URL — are shown WHOLE or not at
 * all: whole up to 120 characters, and a field the card cannot show whole is a denial, not a card with a cut that could
 * hide what matters. A payee's URL must be http or https, carry no userinfo, parse, and fit. */
test("describeOrder: a pay's URL and a key field are shown whole up to 120 characters", () => {
  const url = "https://api.example.com/v1/pay?item=42";
  assert.match(describeOrder("mcp__account__portfolio_pay", { url, maxAmount: 2, from: "agent-1" }), /: from=agent-1 url=https:\/\/api\.example\.com\/v1\/pay\?item=42 maxAmount=2$/);
  const addr = `0x${"a".repeat(20)}${"b".repeat(20)}`;
  assert.match(describeOrder("mcp__account__portfolio_live_move", { kind: "send", from: "wallet", asset: "USDC", amount: 5, to: addr }), new RegExp(`to=${addr}`));
  const id = `ord-${"9".repeat(100)}`;
  assert.match(describeOrder("mcp__account__portfolio_live_cancel", { venue: "paper-1", order: id }), new RegExp(`order=${id} venue=paper-1`));
});

test("orderApprovalDecision: a key field the card cannot show whole is denied, not carded — too long, or a URL that is not http(s), carries userinfo or does not parse", () => {
  const deny = (args: Record<string, unknown>): string => {
    const d = orderApprovalDecision("mcp__account__portfolio_pay", "ask", args);
    return d?.kind === "deny" ? d.reason : String(d?.kind);
  };
  assert.match(deny({ url: "https://api.example.com/x", maxAmount: 1, from: `0x${"f".repeat(300)}` }), /its from is 302 characters, too long to show whole on a card, so nothing was asked/);
  assert.match(deny({ url: `https://api.example.com/${"p".repeat(200)}`, maxAmount: 1 }), /its url is 2\d\d characters/);
  assert.match(deny({ url: "ftp://files.example.com/x", maxAmount: 1 }), /its url is not http or https, so nothing was asked/);
  assert.match(deny({ url: "https://u:p@api.example.com/x", maxAmount: 1 }), /its url carries userinfo/);
  assert.match(deny({ url: "not a url", maxAmount: 1 }), /its url does not parse/);
  assert.equal(deny({ url: "https://api.example.com/x", maxAmount: 1 }), "ask");
  assert.equal(deny({ url: "https://api.example.com/x", maxAmount: 1, contentType: "c".repeat(500) }), "ask", "a long field that is not a key field is cut, not denied");
  const move = orderApprovalDecision("mcp__account__portfolio_live_move", "ask", { kind: "send", from: "wallet", asset: "USDC", amount: 5, to: `0x${"f".repeat(40)}` });
  assert.equal(move?.kind, "ask", "a 42-character address is shown whole and asked about");
});

/* A batch is several orders: the card describes every leg with the same words and the same whole-or-deny key fields (the
 * final review's Critical 1 — a card reading `legs=?` approved up to ten orders blind). A nested object is shown one level
 * deep; the Account takes at most ten legs, and a card shows no more. */
test("describeOrder: a batch's legs are each described on the card; a nested object is shown one level deep", () => {
  const legs = [
    { venue: "paper-1", symbol: "BTC/USD", side: "buy", usd: 10 },
    { venue: "paper-1", symbol: "ETH/USD", side: "buy", usd: 10, orderType: "limit", limitPrice: 2400 },
    { venue: "okx", symbol: "SOL/USDT", side: "sell", qty: 500 },
  ];
  assert.equal(describeOrder("mcp__account__portfolio_live_batch", { legs }),
    "mcp__account__portfolio_live_batch: legs=[1: side=buy usd=10 symbol=BTC/USD venue=paper-1; 2: side=buy usd=10 symbol=ETH/USD orderType=limit limitPrice=2400 venue=paper-1; 3: side=sell qty=500 symbol=SOL/USDT venue=okx]");
  assert.equal(describeOrder("mcp__account__portfolio_live_batch", { legs: "x" }), "mcp__account__portfolio_live_batch: legs=x");
  assert.equal(describeOrder("mcp__account__portfolio_live_batch", { legs: [] }), "mcp__account__portfolio_live_batch: legs=[]");
  assert.equal(describeOrder("mcp__account__portfolio_execute", { account: "acc-1", intent: { kind: "trade", symbol: "AAPL", side: "buy", qty: 1 } }),
    "mcp__account__portfolio_execute: account=acc-1 intent={side=buy qty=1 symbol=AAPL kind=trade}");
  assert.equal(describeOrder("t", { deep: { a: { b: 1 } }, list: [1, "two", null] }), "t: deep={a=?} list=[1: 1; 2: two; 3: ?]");
});

test("orderApprovalDecision: a batch leg's key field is whole or the call is denied, and more than ten legs is denied", () => {
  const legs = [{ venue: "paper-1", symbol: "BTC/USD", side: "buy", usd: 10 }, { venue: "okx", symbol: "S".repeat(130), side: "sell", qty: 1 }];
  const d = orderApprovalDecision("mcp__account__portfolio_live_batch", "ask", { legs });
  assert.equal(d?.kind, "deny");
  assert.match(d?.kind === "deny" ? d.reason : "", /its legs\[2\]\.symbol is 130 characters, too long to show whole on a card, so nothing was asked/);
  const many = orderApprovalDecision("mcp__account__portfolio_live_batch", "ask", { legs: Array.from({ length: 11 }, () => ({ venue: "paper-1", symbol: "BTC/USD", side: "buy", usd: 1 })) });
  assert.equal(many?.kind, "deny");
  assert.match(many?.kind === "deny" ? many.reason : "", /its legs has 11 entries, more than the ten a card shows/);
  const nested = orderApprovalDecision("mcp__account__portfolio_execute", "ask", { account: "acc-1", intent: { kind: "move", asset: "USDC", amount: 5, to: `0x${"e".repeat(200)}` } });
  assert.equal(nested?.kind, "deny");
  assert.match(nested?.kind === "deny" ? nested.reason : "", /its intent\.to is 202 characters/);
  const ok = orderApprovalDecision("mcp__account__portfolio_live_batch", "ask", { legs: [legs[0], { venue: "okx", symbol: "SOL/USDT", side: "sell", qty: 500 }] });
  assert.equal(ok?.kind, "ask");
  assert.match(ok?.kind === "ask" ? ok.reason ?? "" : "", /^Account seat - mcp__account__portfolio_live_batch: legs=\[1: side=buy usd=10 symbol=BTC\/USD venue=paper-1; 2: side=sell qty=500 symbol=SOL\/USDT venue=okx\]$/);
});

/* What a card would draw as `?` it must not approve: a value nested deeper than the one level a card shows is denied, and
 * a scalar inside a list is held to its parent key's rule — an address in `to: [...]` whole or denied, a URL in `url: [...]`
 * http(s) or denied — not cut at forty characters under a blank key. */
test("orderApprovalDecision: a value nested deeper than a card shows is denied; a list's scalars follow their parent key's rule", () => {
  const deny = (name: string, args: Record<string, unknown>): string => {
    const d = orderApprovalDecision(name, "ask", args);
    return d?.kind === "deny" ? d.reason : String(d?.kind);
  };
  assert.match(deny("mcp__account__portfolio_live_batch", { legs: [{ venue: "paper-1", symbol: "BTC/USD", side: "buy", usd: 10, extra: { a: 1 } }] }), /its legs\[1\]\.extra is nested deeper than a card shows, so nothing was asked/);
  assert.match(deny("mcp__account__portfolio_live_batch", { legs: [[1, 2]] }), /its legs\[1\] is nested deeper than a card shows/);
  assert.match(deny("mcp__account__portfolio_execute", { account: "a", intent: { kind: "trade", legs: [1] } }), /its intent\.legs is nested deeper than a card shows/);
  assert.match(deny("mcp__account__portfolio_sweep", { venue: "paper-1", to: [`0x${"f".repeat(300)}`] }), /its to\[1\] is 302 characters, too long to show whole on a card/);
  assert.match(deny("mcp__account__portfolio_sweep", { venue: "paper-1", url: ["https://api.example.com/x", "ftp://files.example.com/x"] }), /its url\[2\] is not http or https/);
  assert.equal(deny("mcp__account__portfolio_sweep", { venue: "paper-1", symbols: ["AAPL", "MSFT"], to: [`0x${"a".repeat(40)}`] }), "ask", "a list of key fields that fit, and a list under a plain key, are asked about");
  assert.equal(describeOrder("mcp__account__portfolio_sweep", { venue: "paper-1", to: [`0x${"a".repeat(40)}`], symbols: ["AAPL", "N".repeat(50)] }),
    `mcp__account__portfolio_sweep: venue=paper-1 to=[1: 0x${"a".repeat(40)}] symbols=[1: AAPL; 2: ${"N".repeat(40)}…]`, "a list's scalars draw by their parent key's rule: an address whole, a plain field cut");
});

test("orderGuardReason: everything else passes untouched", () => {
  for (const name of ["bash", "mcp__x__orders", "mcp__account__portfolio_holdings"]) {
    assert.equal(orderGuardReason(name, [], "c1"), undefined, name);
  }
});

/* --- dsh 0.2.0 shapes ------------------------------------------------------ */

test("PreToolDecision admits every NEW kind (tools/src/index.ts:607-611), so a passed-through inner decision types", () => {
  // Compile-time half: each literal must be assignable, or `npm run typecheck` fails.
  const decisions: PreToolDecision[] = [
    { kind: "allow" },
    { kind: "deny", reason: "r", info: { code: "X" } },
    { kind: "cancel" },
    { kind: "ask", reason: "r", displayReason: { en: "r", zh: "r" } },
  ];
  assert.deepEqual(decisions.map((d) => d.kind), ["allow", "deny", "cancel", "ask"]);
});

test("orderApprovalDecision: displayReason carries the same order line as reason", () => {
  // An upstream-style panel renders displayReason INSTEAD of reason when present
  // (ui-approval ApprovalPanel.tsx:17): both must name the order.
  const decision = orderApprovalDecision("mcp__account__portfolio_live_order", "ask", { symbol: "NVDA", qty: 2, side: "buy" });
  assert.equal(decision?.kind, "ask");
  if (decision?.kind !== "ask") return;
  assert.match(decision.reason ?? "", /NVDA/);
  assert.deepEqual(decision.displayReason, { en: decision.reason });
  // The never branch stays a plain deny - nothing to display, nobody asked.
  const never = orderApprovalDecision("mcp__account__portfolio_live_order", "never");
  assert.deepEqual(Object.keys(never ?? {}).sort(), ["kind", "reason"]);
});

/* --- the guard given a SESSION: an unreadable log is not a missing grant ---- */

const liveSession = (events: readonly { type: string; data?: object }[]) => ({ snapshotEvents: () => events });

test("orderGuardReasonForSession: a granted order passes through snapshotEvents()", () => {
  assert.equal(orderGuardReasonForSession("mcp__x__portfolio_live_order", liveSession(granted), "c1"), undefined);
});

test("orderGuardReasonForSession: no grant in a READABLE log is the ordinary 'no grant' denial", () => {
  const reason = orderGuardReasonForSession("mcp__x__portfolio_live_order", liveSession([]), "c1");
  assert.match(reason ?? "", /without a logged allowed-once/);
});

test("orderGuardReasonForSession: a session without snapshotEvents is denied with the DISTINCT reason", () => {
  /* Exactly the 0.1.1 session shape: the `events` getter, holding a real
   * grant. dsh 0.2.0 removed that getter (5660f44d29); a guard still reading
   * it saw `undefined` and reported every approved order as "no grant". This
   * is the assertion that would have caught the regression: the grant is
   * there, the log is unreadable, and the denial must SAY so. */
  const oldShape = { events: granted };
  const reason = orderGuardReasonForSession("mcp__x__portfolio_live_order", oldShape, "c1");
  assert.equal(reason, unreadableSessionLogReason("mcp__x__portfolio_live_order"));
  assert.match(reason ?? "", /cannot read this session's log/);
  assert.doesNotMatch(reason ?? "", /without a logged allowed-once/);
  /* The exact sentence the LIVE guard denies with: boot.ts's `tools.guard`
   * calls orderGuardReasonForSession itself, so there is one producer and
   * pinning its text here pins what the operator reads. */
  assert.equal(reason,
    "mcp__x__portfolio_live_order: cannot read this session's log to verify an allowed-once approval (dsh Session API changed: no snapshotEvents)");
});

test("orderGuardReasonForSession: a throwing or non-array snapshotEvents is unreadable, fail closed", () => {
  const throwing = { snapshotEvents: () => { throw new Error("log detached"); } };
  assert.equal(orderGuardReasonForSession("mcp__x__portfolio_live_order", throwing, "c1"),
    unreadableSessionLogReason("mcp__x__portfolio_live_order", "snapshotEvents threw"));
  const odd = { snapshotEvents: () => undefined };
  assert.equal(orderGuardReasonForSession("mcp__x__portfolio_live_order", odd, "c1"),
    unreadableSessionLogReason("mcp__x__portfolio_live_order", "snapshotEvents returned no event list"));
  // A non-object "session" cannot hold a log either.
  assert.equal(orderGuardReasonForSession("mcp__x__portfolio_live_order", 42, "c1"),
    unreadableSessionLogReason("mcp__x__portfolio_live_order"));
});

test("orderGuardReasonForSession: a seat write under a renamed server with an unreadable log is still denied", () => {
  const reason = orderGuardReasonForSession("mcp__broker__portfolio_pay", {}, "c1");
  assert.equal(reason, unreadableSessionLogReason("mcp__broker__portfolio_pay"));
});

test("orderGuardReasonForSession: an agentless call is 'no grant', not 'unreadable'", () => {
  const reason = orderGuardReasonForSession("mcp__x__portfolio_live_order", undefined, "c1");
  assert.match(reason ?? "", /without a logged allowed-once/);
});

test("orderGuardReasonForSession: a drifted Session API never bricks a tool the gate does not own", () => {
  for (const name of ["bash", "mcp__x__orders", "mcp__account__portfolio_holdings"]) {
    assert.equal(orderGuardReasonForSession(name, {}, "c1"), undefined, name);
    const throwing = { snapshotEvents: () => { throw new Error("never read for an ungated tool"); } };
    assert.equal(orderGuardReasonForSession(name, throwing, "c1"), undefined, name);
  }
});

/* --- the Account seat's writes (spec 2026-10-20 §5.2) ---------------------- */

/** The seat's twelve write tools, spelled here on purpose: an independent copy of the gate's list. */
const SEAT = [
  "portfolio_live_order", "portfolio_live_batch", "portfolio_live_amend", "portfolio_live_cancel", "portfolio_live_close",
  "portfolio_live_leverage", "portfolio_live_move", "portfolio_live_earn", "portfolio_pay",
  "portfolio_order", "portfolio_execute", "portfolio_transfer",
];

test("isOrderTool: the Account seat's twelve write tools match, raw and as dsh mints them; its reads, waits and words never", () => {
  for (const raw of SEAT) {
    assert.ok(isOrderTool(raw), raw);
    assert.ok(isOrderTool(`mcp__account__${raw}`), raw);
    assert.ok(isSeatWriteTool(`mcp__broker__${raw}`), `${raw} under a renamed server`);
  }
  for (const read of ["portfolio_account", "portfolio_holdings", "portfolio_venues", "portfolio_live_preview", "portfolio_live_markets",
    "portfolio_live_positions", "portfolio_wait", "portfolio_approval", "portfolio_ask", "portfolio_report", "portfolio_remember", "portfolio_desk_say"]) {
    assert.equal(isOrderTool(`mcp__account__${read}`), false, read);
    assert.equal(isSeatWriteTool(`mcp__account__${read}`), false, read);
  }
  assert.equal(isSeatWriteTool("mcp__alpaca-kit__place_order"), false, "an Alpaca order is not a seat write");
});

/* Review Focus 3 of stage 3: the alpaca half has left Gate 2, and the seat's half is exactly as it was. */
test("Gate 2 after the alpaca half leaves: a seat write raises Account seat, an unclassified seat tool raises a card, a seat read none", () => {
  const write = orderApprovalDecision("mcp__account__portfolio_live_order", "ask", { venue: "paper-1", symbol: "AAPL", side: "buy", usd: 100 });
  assert.equal(write?.kind, "ask");
  assert.match(write?.kind === "ask" ? write.reason ?? "" : "", /^Account seat - mcp__account__portfolio_live_order: side=buy usd=100 symbol=AAPL venue=paper-1$/);
  const unclassified = orderApprovalDecision("mcp__account__portfolio_sweep", "ask", { venue: "paper-1" });
  assert.equal(unclassified?.kind, "ask");
  assert.match(unclassified?.kind === "ask" ? unclassified.reason ?? "" : "", /^Account seat - mcp__account__portfolio_sweep: venue=paper-1$/);
  assert.equal(orderApprovalDecision("mcp__account__portfolio_holdings", "ask", {}), null, "a seat read raises nothing");
});

test("orderApprovalDecision: a retired order tool under the seat prefix raises no card - the guard denies it regardless", () => {
  const args = { venue: "paper-1", symbol: "AAPL", side: "buy", qty: 1 };
  for (const name of ["mcp__account__place_order", "mcp__account__cancel_order"]) {
    assert.equal(isOrderTool(name), true, `${name} is unclassified under the seat prefix`);
    assert.equal(orderApprovalDecision(name, "ask", args), null, name);
    assert.equal(orderApprovalDecision(name, "never", args), null, name);
    assert.match(orderGuardReason(name, [], "call-1") ?? "", /retired order tool/, name);
  }
});

test("no tool is a PAPER order any more", () => {
  const args = { venue: "paper-1", symbol: "AAPL", side: "buy", qty: 1 };
  const names = ["place_order", "cancel_order", "mcp__alpaca-kit__place_order", "mcp__drill__cancel_order",
    ...SEAT.map((raw) => `mcp__account__${raw}`), ...SEAT.map((raw) => `mcp__broker__${raw}`), "mcp__account__portfolio_sweep"];
  for (const name of names) {
    const decision = orderApprovalDecision(name, "ask", args);
    const reason = decision?.kind === "ask" ? decision.reason ?? "" : "";
    assert.doesNotMatch(reason, /^PAPER order/, name);
    if (decision !== null) assert.match(reason, /^Account seat - /, name);
  }
  assert.equal(orderApprovalDecision("mcp__alpaca-kit__place_order", "ask", args), null, "the alpaca pair raises no card at all");
});

test("describeOrder: a seat order reads side, size, symbol, type and venue in that order, then the rest", () => {
  assert.equal(
    describeOrder("mcp__account__portfolio_live_order", { venue: "paper-1", symbol: "AAPL", side: "buy", usd: 100, orderType: "market", tif: "day" }),
    "mcp__account__portfolio_live_order: side=buy usd=100 symbol=AAPL orderType=market venue=paper-1 tif=day",
  );
  assert.equal(describeOrder("mcp__account__portfolio_live_cancel", { venue: "paper-1", order: "ord-0001" }),
    "mcp__account__portfolio_live_cancel: order=ord-0001 venue=paper-1");
});

test("orderApprovalDecision: a seat tool's reason opens with Account seat, never PAPER", () => {
  const d = orderApprovalDecision("mcp__account__portfolio_live_order", "ask", { venue: "paper-1", symbol: "AAPL", side: "buy", usd: 100 });
  assert.equal(d?.kind, "ask");
  const reason = d?.kind === "ask" ? d.reason ?? "" : "";
  assert.match(reason, /^Account seat - mcp__account__portfolio_live_order: side=buy usd=100 symbol=AAPL venue=paper-1$/);
  assert.doesNotMatch(reason, /PAPER/);
  assert.deepEqual(d?.kind === "ask" ? d.displayReason : undefined, { en: reason });
});

test("auditOrderTools: the seat's write tools are gated, its reads are not, an unknown seat tool is gated until classified", () => {
  const audit = auditOrderTools([
    { name: "mcp__account__portfolio_live_order", description: "Place a REAL order at a venue the owner connected live" },
    { name: "mcp__account__portfolio_pay", description: "Pay for something at a URL" },
    { name: "mcp__account__portfolio_account", description: "Who this seat is" },
    { name: "mcp__account__portfolio_wait", description: "Wait on a card" },
    { name: "mcp__account__portfolio_sweep", description: "a tool the Account grew after the pin" },
  ]);
  assert.deepEqual(audit.gated, ["mcp__account__portfolio_live_order", "mcp__account__portfolio_pay", "mcp__account__portfolio_sweep"]);
  assert.deepEqual(audit.uncovered, []);
});

/* The Account moves fast (26 pull requests in the twelve days before the pin). A seat tool the face
 * has never classified is carded like a write until the read list grows — a card per call is the
 * safe default — and never refuses the boot. Only the face's own server name gets this: another
 * server's unknown tool is nobody's, and a renamed seat server keeps the twelve by raw suffix. */
test("isOrderTool: an unknown tool at the seat is carded until it is classified; a listed read is not; another server's unknown tool is nobody's", () => {
  assert.ok(isOrderTool("mcp__account__portfolio_sweep"));
  assert.ok(isSeatWriteTool("mcp__account__portfolio_sweep") === false, "unknown is not one of the twelve");
  assert.equal(isOrderTool("mcp__account__portfolio_holdings"), false);
  assert.equal(isOrderTool("mcp__account__portfolio_desk"), false);
  assert.equal(isOrderTool("mcp__other__portfolio_sweep"), false);
  const d = orderApprovalDecision("mcp__account__portfolio_sweep", "ask", { venue: "paper-1", all: true });
  assert.match(d?.kind === "ask" ? d.reason ?? "" : "", /^Account seat - mcp__account__portfolio_sweep: venue=paper-1 all=true$/);
});

/* --- the deferred minors of the final review, fixed 2026-10-21 ---------------- */

test("orderApprovalDecision: an earn product and a pay body are key fields - whole on the card, or the call denied", () => {
  const reasonOf = (d: ReturnType<typeof orderApprovalDecision>): string => (d?.kind === "ask" || d?.kind === "deny" ? d.reason ?? "" : String(d?.kind));
  const product = `okx-flexible-${"u".repeat(60)}`;
  const earn = orderApprovalDecision("mcp__account__portfolio_live_earn", "ask", { venue: "paper-1", kind: "supply", product, asset: "USDT", amount: 5 });
  assert.equal(earn?.kind, "ask");
  assert.ok(reasonOf(earn).includes(`product=${product}`), `the product id is shown whole: ${reasonOf(earn)}`);
  const body = JSON.stringify({ prompt: "x".repeat(80) });
  const pay = orderApprovalDecision("mcp__account__portfolio_pay", "ask", { url: "https://api.example.com/x", maxAmount: 1, from: "float-1", method: "POST", body });
  assert.equal(pay?.kind, "ask");
  assert.ok(reasonOf(pay).includes(`body=${JSON.stringify(body)}`), `a short body is shown whole, quoted since it carries quotes and spaces: ${reasonOf(pay)}`);
  const long = orderApprovalDecision("mcp__account__portfolio_pay", "ask", { url: "https://api.example.com/x", maxAmount: 1, from: "float-1", method: "POST", body: "x".repeat(121) });
  assert.equal(long?.kind, "deny");
  assert.match(reasonOf(long), /its body is 121 characters, too long to show whole on a card/);
});

test("orderGuardReason: a seat write with no grant is denied, with a logged allowed-once for this call it passes, a seat read needs none", () => {
  const write = "mcp__account__portfolio_live_order";
  assert.match(orderGuardReason(write, [], "c1") ?? "", /without a logged allowed-once/);
  const seatGrant = [asked("s1", "c1", write), decided("s1", "allowed-once")];
  assert.equal(orderGuardReason(write, seatGrant, "c1"), undefined);
  assert.notEqual(orderGuardReason(write, granted, "c1"), undefined, "a grant for another server's tool does not open the seat's");
  assert.equal(orderGuardReason("mcp__account__portfolio_account", [], "c1"), undefined);
  assert.equal(orderGuardReasonForSession(write, { snapshotEvents: () => seatGrant }, "c1"), undefined);
  assert.match(orderGuardReasonForSession(write, { snapshotEvents: () => [] }, "c1") ?? "", /without a logged allowed-once/);
});

/* The security review of 2026-10-21 (the client's card titled from this line): a value that carries whitespace, a
 * quote, a bracket or a semicolon is drawn as a JSON string, so the line parses back pair by pair and a value can never
 * pass itself off as another pair (`symbol="AAPL venue=okx" venue=paper-1`). */
test("describeOrder: a value with whitespace or a bracket is quoted, so the line parses back pair by pair", () => {
  assert.equal(describeOrder("mcp__account__portfolio_live_order", { venue: "paper-1", symbol: "AAPL venue=okx", side: "buy", usd: 10 }),
    'mcp__account__portfolio_live_order: side=buy usd=10 symbol="AAPL venue=okx" venue=paper-1');
  assert.equal(describeOrder("mcp__account__portfolio_pay", { url: "https://api.example.com/x?a=b&c=d", maxAmount: 2, from: "float-1", body: '{"q": 1}' }),
    'mcp__account__portfolio_pay: from=float-1 url=https://api.example.com/x?a=b&c=d maxAmount=2 body="{\\"q\\": 1}"');
  assert.equal(describeOrder("mcp__account__portfolio_live_batch", { legs: [{ venue: "ex", symbol: "BTC/USD", side: "buy", usd: 10, note: "a; b" }] }),
    'mcp__account__portfolio_live_batch: legs=[1: side=buy usd=10 symbol=BTC/USD venue=ex note="a; b"]');
  assert.equal(describeOrder("mcp__account__portfolio_sweep", { venue: "paper-1", memo: `${"m".repeat(30)} ${"n".repeat(30)}` }),
    `mcp__account__portfolio_sweep: venue=paper-1 memo="${"m".repeat(30)} ${"n".repeat(9)}…"`, "a cut value is cut first, then quoted");
});

/* The security review of 2026-10-21 (third): a key is written bare on the line, so a key that is not a name — `x venue`,
 * `a=b`, `legs;` — could pass itself off as another pair when the client reads the line back. Denied before any card,
 * at any depth, a batch's legs included. */
test("orderApprovalDecision: a key that is not a name is denied before a card, at any depth", () => {
  const deny = (name: string, args: Record<string, unknown>): string => {
    const d = orderApprovalDecision(name, "ask", args);
    return d?.kind === "deny" ? d.reason : String(d?.kind);
  };
  assert.match(deny("mcp__account__portfolio_live_order", { venue: "paper-1", "x venue": "okx", side: "buy", usd: 10 }), /its "x venue" is not a name a card can show, so nothing was asked/);
  assert.match(deny("mcp__account__portfolio_live_order", { venue: "paper-1", "a=b": 1 }), /its "a=b" is not a name a card can show/);
  assert.match(deny("mcp__account__portfolio_live_batch", { legs: [{ venue: "ex", symbol: "BTC/USD", "side usd": 5 }] }), /its legs\[1\]\."side usd" is not a name a card can show/);
  assert.match(deny("mcp__account__portfolio_sweep", { venue: "paper-1", intent: { "k;": 1 } }), /its intent\."k;" is not a name a card can show/);
  assert.match(deny("mcp__account__portfolio_sweep", { venue: "paper-1", "": 1 }), /its "" is not a name a card can show/);
  assert.equal(deny("mcp__account__portfolio_live_order", { venue: "paper-1", symbol: "AAPL", side: "buy", usd: 10, order_type: "market", _note: "x" }), "ask");
});

/* --- an order tool the caller cannot see (spike 3) ------------------------- */

test("a hidden order tool is denied in the gate's own words, before the policy", () => {
  const d = orderApprovalDecision("mcp__account__portfolio_live_order", "ask", { side: "buy" }, false);
  assert.deepEqual(d, { kind: "deny", reason: "mcp__account__portfolio_live_order is not available to this session - it is not registered here, or this session's preset hides it - so no approval card is raised and the order does not run" });
  assert.equal(orderApprovalDecision("mcp__account__portfolio_live_order", "ask", { side: "buy" }, true)?.kind, "ask");
  assert.equal(orderApprovalDecision("bash", "ask", {}, false), null);
});

test("orderApprovalDecision: a hidden order tool under policy `never` gets the hidden-tool sentence, not the policy one", () => {
  /* Visibility comes first: under `never` the policy sentence would send the operator to
   * DSH_PERMISSION_MODE for a tool no setting lets this session call. A cancel is refused
   * the same way, by name, like every order tool. */
  for (const name of ["mcp__account__portfolio_live_order", "mcp__account__portfolio_live_cancel"]) {
    assert.deepEqual(orderApprovalDecision(name, "never", undefined, false), {
      kind: "deny",
      reason: `${name} is not available to this session - it is not registered here, or this session's preset hides it - so no approval card is raised and the order does not run`,
    }, name);
  }
  /* A VISIBLE tool keeps both of today's answers, and `visible` defaults to true, so a caller
   * that does not pass it decides exactly as before. */
  const never = orderApprovalDecision("mcp__account__portfolio_live_order", "never", undefined, true);
  assert.match(never?.kind === "deny" ? never.reason : "", /approval policy is "never"/);
  assert.deepEqual(orderApprovalDecision("mcp__account__portfolio_live_order", "never"), never);
  assert.deepEqual(orderApprovalDecision("mcp__account__portfolio_live_order", "ask", { symbol: "AAPL" }),
    orderApprovalDecision("mcp__account__portfolio_live_order", "ask", { symbol: "AAPL" }, true));
});
