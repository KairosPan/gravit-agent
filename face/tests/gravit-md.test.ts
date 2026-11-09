import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ROLES_ROOT, readRoles } from "../src/roles.ts";

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

test("GRAVIT.md tells Gravit to answer a Lunhui market run with lunhui_present", () => {
  assert.ok(readFileSync(GRAVIT_MD, "utf8").includes("lunhui_present"));
});

test("GRAVIT.md reaches AKShare through the market row, not the seat", () => {
  const text = readFileSync(GRAVIT_MD, "utf8");
  assert.ok(Buffer.byteLength(text, "utf8") <= 4500);
  assert.match(text, /mcp__market__market_akshare/);
  assert.equal(text.includes("portfolio_akshare"), false);
  assert.match(text, /akshare_discover/);
  assert.equal(text.includes("mcp__akshare__"), false);
});

/* dsh UI port spec §5.6, O8: Gravit's shell reads a PDF's text with pdftotext, renders a page whose layout
 * matters with pdftoppm into the temp directory (never the tree), and hands the PNG to a shipped role. */
test("GRAVIT.md reads a PDF with Poppler and hands a layout page to a shipped role", () => {
  const text = readFileSync(GRAVIT_MD, "utf8");
  for (const needle of ["pdftotext -layout", "pdftoppm -png", "${TMPDIR:-/tmp}"]) assert.ok(text.includes(needle), needle);
  const named = [...new Set(text.match(/\brole_[a-z0-9_]+/g) ?? [])];
  assert.ok(named.includes("role_pdf_page_reader"), "it names the PDF page reader");
  const shipped = readRoles(ROLES_ROOT).map((role) => role.tool);
  for (const tool of named) assert.ok(shipped.includes(tool), `${tool} is a shipped role's tool`);
});

/* One entry's plan 4 task 6: no rooms - a task's worker hosts bots from the one roster with dispatch, read-only. */
test("GRAVIT.md states debates, not rooms", () => {
  const text = readFileSync(GRAVIT_MD, "utf8");
  assert.ok(text.includes("## Debates") && !text.includes("## Rooms"), "the section is Debates");
  assert.match(text, /`dispatch`/);
  assert.match(text, /read-only/);
  assert.equal(text.includes("@<bot>"), false, "the operator's @ in a room has no surface left");
});
