/* The client's six module cards' static table (face/client/js/host/modules-view.js MODULES) held in
 * step with the server's: MODULE_HEADLINES, the rows' modules.mjs, the roles' names and the Lunhui
 * tool names (Lunhui module cards spec 2026-10-28 §5.1, §6). */
import test from "node:test";
import assert from "node:assert/strict";
import { MODULES } from "../client/js/host/modules-view.js";
import { MODULE_HEADLINES } from "../src/channels.ts";
import { LUNHUI_TOOL_NAMES } from "../src/lunhui.ts";
import { readRoles, ROLES_ROOT } from "../src/roles.ts";
import { MODULES as LUNHUI_MODULES } from "../plugins/lunhui/lib/modules.mjs";

test("the client's MODULES table is in step with the server's MODULE_HEADLINES, modules.mjs and the roles", () => {
  assert.deepEqual(MODULES.map((m) => [m.name, m.file, [...m.headline]]), MODULE_HEADLINES.map((m) => [m.name, m.file, [...m.headline]]));
  assert.deepEqual(MODULES.map((m) => m.name), [...LUNHUI_MODULES.map((m) => m.name)]);
  const roles = new Map(readRoles(ROLES_ROOT).map((r) => [r.id, r.name]));
  for (const m of MODULES) assert.equal(roles.get(m.roleId), m.role, m.name);
  const tools: readonly string[] = LUNHUI_TOOL_NAMES;
  for (const m of MODULES) assert.ok(tools.includes(m.tools[0]) && tools.includes(m.tools[1]), m.name);
  assert.equal(new Set(MODULES.map((m) => m.icon)).size, 6, "six distinct glyphs");
});
