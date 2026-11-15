/** The fence Gate 2 puts on a staged order, and the live-order name it stages. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isLiveOrderTool, reasonWithStaged } from "../src/order-stage.ts";

test("only a live order is staged, and the fence keeps the line a person reads", () => {
  assert.equal(isLiveOrderTool("mcp__account__portfolio_live_order"), true);
  assert.equal(isLiveOrderTool("portfolio_live_order"), true);
  assert.equal(isLiveOrderTool("mcp__account__portfolio_live_cancel"), false);
  const line = "Account seat - portfolio_live_order: side=buy symbol=AAPL";
  const reason = reasonWithStaged(line, { wouldBe: "card", id: "card-0001", hash: "0xab", order: { symbol: "AAPL" } });
  assert.equal(reason.startsWith(`${line}\n<<<staged `), true);
  assert.equal(reason.endsWith(">>>"), true);
  assert.equal(reasonWithStaged(line, undefined), line);
});
