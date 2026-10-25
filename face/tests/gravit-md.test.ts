import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const GRAVIT_MD = fileURLToPath(new URL("../../GRAVIT.md", import.meta.url));
/** Spec §4.2: the budget of the one file every dsh agent in the tree reads on its first request. */
const BUDGET_BYTES = 4500;

test("GRAVIT.md fits its budget and contains no template group", () => {
  const text = readFileSync(GRAVIT_MD, "utf8");
  assert.ok(Buffer.byteLength(text, "utf8") <= BUDGET_BYTES, `GRAVIT.md is ${Buffer.byteLength(text, "utf8")} bytes; the budget is ${BUDGET_BYTES}`);
  assert.equal(text.includes("{{"), false, "the system prompt is a strict template with no escape");
});

test("GRAVIT.md names the Account seat and its rule (spec 2026-10-20 §7)", () => {
  const text = readFileSync(GRAVIT_MD, "utf8");
  assert.match(text, /mcp__account__/);
  assert.match(text, /paper venues only/);
  assert.match(text, /portfolio_wait/);
  assert.match(text, /account-seat-guide/);
  assert.doesNotMatch(text, /Account seat \(`mcp__account__\*`\) tools are public/, "only the seat's market reads are unguarded queries; its writes are gated");
});

test("GRAVIT.md states facts, not identity: it never tells the reader who it is", () => {
  const text = readFileSync(GRAVIT_MD, "utf8");
  assert.equal(/^You are /m.test(text), false);
});

/* Since 2026-10-24 the tree has no Python package, no point-in-time beds and no lookahead guard
 * (spec 2026-10-22 account-graft §12): nothing every agent reads may point at them. */
test("GRAVIT.md names nothing of the removed layer and states that no read is guarded", () => {
  const text = readFileSync(GRAVIT_MD, "utf8");
  for (const gone of ["alpaca_kit", "replay_days", "data/pit"]) assert.equal(text.includes(gone), false, gone);
  assert.match(text, /no lookahead guard/);
});
