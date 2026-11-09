// face/tests/router-preset.test.ts
/** The conversation's preset, `gravit-router` (src/router-preset.ts), and its section's text
 * (`dsh/profile/router.md`, read by src/cycle.ts `readRouter`), offline. */
import test from "node:test";
import assert from "node:assert/strict";
import { readRouter, ROUTER_MAX_BYTES } from "../src/cycle.ts";
import { CONVERSATION_PRESET } from "../src/desk-names.ts";
import { SEAT_READ_RAW_NAMES, SEAT_WRITE_RAW_NAMES } from "../src/orders.ts";
import { BOT_PLUGIN_URL, GRAVIT_PLUGIN_URL, GRAVIT_ROW_ID } from "../src/roles.ts";
import { ROUTER_ALLOW, routerPresetDefinition } from "../src/router-preset.ts";

test("the router preset is the gravit row with a router section, and a mask-only allow list", () => {
  assert.equal(CONVERSATION_PRESET, "gravit-router");
  const definition = routerPresetDefinition({ router: { text: "x", root: "/r" } });
  assert.deepEqual({ id: definition.id, plugins: definition.plugins }, {
    id: "gravit-router",
    plugins: [
      { id: GRAVIT_ROW_ID, name: GRAVIT_PLUGIN_URL, config: { router: { text: "x", root: "/r" } } },
      { id: "router-mask", name: BOT_PLUGIN_URL, config: { maskOnly: true, allow: [...ROUTER_ALLOW] } },
    ],
  });
  const mask = definition.plugins![1].config as { allow: string[] };
  assert.notEqual(mask.allow, ROUTER_ALLOW, "the mask's list is a copy");
  assert.ok(Object.isFrozen(ROUTER_ALLOW));
});

test("the allow list reads and never writes", () => {
  for (const name of ["bash", "write", "edit", "str_replace_editor", "ask_user_question"])
    assert.equal(ROUTER_ALLOW.includes(name), false, `no ${name}`);
  assert.equal(ROUTER_ALLOW.some((name) => name.endsWith("market_akshare")), false, "no market_akshare");
  const seat = ROUTER_ALLOW.filter((name) => name.startsWith("mcp__*__portfolio_"));
  assert.equal(seat.length, 12);
  for (const name of seat) {
    const raw = name.slice("mcp__*__".length);
    assert.ok((SEAT_READ_RAW_NAMES as readonly string[]).includes(raw), `${raw} is a seat read`);
    assert.equal((SEAT_WRITE_RAW_NAMES as readonly string[]).includes(raw), false, `${raw} is no seat write`);
  }
  assert.deepEqual([...ROUTER_ALLOW], [
    "read", "grep", "glob",
    "mcp__*__market_explore", "mcp__*__market_quotes", "mcp__*__market_candles", "mcp__*__market_book",
    ...["overview", "read", "markets", "quote", "account", "statement", "holdings", "history", "asset", "venues", "live_positions", "live_markets"]
      .map((raw) => `mcp__*__portfolio_${raw}`),
  ]);
});

test("router.md fits 2,000 bytes and names its five tools and <REPO>", () => {
  assert.equal(ROUTER_MAX_BYTES, 2_000);
  const text = readRouter();
  assert.ok(Buffer.byteLength(text) <= 2_000, `${Buffer.byteLength(text)} bytes`);
  for (const needle of ["task_start", "task_steer", "task_stop", "task_read", "task_list", "<REPO>", "[task · ...]", "<<<task-data", "<<<end", "task_read's steps, result and text are the worker's words between the same fences"])
    assert.ok(text.includes(needle), `names ${needle}`);
});
