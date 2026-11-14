/** The memory row (memory plan 1, Task 2): the project-owned `mcp-memory` row that spawns
 * gravit-memory's stdio door as the agent `gravit` over the owner's home - no card -, the
 * composed standing the face follows, and the guard that keeps every test off a real memory. */
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MEMORY_ROW_ID, MEMORY_SERVER, MEMORY_TOOL_PREFIX, MEMORY_TOOLS, composedMemoryRow, memoryRowPatches,
} from "../src/memory-row.ts";
import { isOrderTool, orderApprovalDecision } from "../src/orders.ts";
import type { SeatEntryLike } from "../src/account-seat.ts";

const TESTS_DIR = fileURLToPath(new URL(".", import.meta.url));

const entry = (id: string, config: unknown, disabled: boolean | (() => boolean) = false): SeatEntryLike => ({
  options: { id, config },
  get disabled() { return typeof disabled === "function" ? disabled() : disabled; },
});

/** Every top-level test file of the face. */
async function testFiles(): Promise<string[]> {
  return (await readdir(TESTS_DIR)).filter((name) => name.endsWith(".test.ts")).map((name) => join(TESTS_DIR, name));
}

/** A source's import statements, each as its clause (`""` for a bare `import "…"`) and its specifier. Read from
 * statements that start a line, so a name in a comment or a string is not an import. */
function importsOf(src: string): { clause: string; from: string }[] {
  const out: { clause: string; from: string }[] = [];
  for (const m of src.matchAll(/^import\s+(?:([^;"']*?)\s+from\s+)?["']([^"']+)["']/gm)) out.push({ clause: (m[1] ?? "").trim(), from: m[2]! });
  return out;
}

/** Whether a source boots or composes a face: it imports `bootFace` or `composeFace` from the boot module as a value
 * (not `type`-only), or the whole module as a namespace, or the market helper every booting test imports. */
function bootsAFace(src: string): boolean {
  return importsOf(src).some(({ clause, from }) => {
    if (from === "./helpers/no-market.ts") return true;
    if (from !== "../src/boot.ts" || /^type\s/.test(clause)) return false;
    if (/^\*\s+as\s/.test(clause)) return true;
    const named = /\{([\s\S]*)\}/.exec(clause)?.[1] ?? "";
    return named.split(",").map((name) => name.trim()).some((name) => /^(bootFace|composeFace)(\s+as\s+\w+)?$/.test(name));
  });
}

/** Whether a source imports the memory helper. */
const importsNoMemory = (src: string): boolean => importsOf(src).some(({ from }) => from === "./helpers/no-memory.ts");

test("the row, exactly", () => {
  assert.deepEqual(memoryRowPatches("/opt/gravit-memory", join(tmpdir(), "m", "home")), [{ insert: [{ id: "mcp-memory",
    name: "@deepseek-ai/dsh-mcp-client", config: { transport: "stdio", serverName: "memory", command: process.execPath,
      args: [join("/opt/gravit-memory", "dist", "cli.js"), "mcp", "--as", "gravit", "--home", join(tmpdir(), "m", "home")],
      toolCallTimeoutMs: 60_000, failOnStartupError: false } }] }]);
});

test("the seven tools, under the server's prefix", () => {
  assert.equal(MEMORY_ROW_ID, "mcp-memory");
  assert.equal(MEMORY_SERVER, "memory");
  assert.equal(MEMORY_TOOL_PREFIX, "mcp__memory__");
  assert.deepEqual([...MEMORY_TOOLS], [
    "memory_recall", "memory_record", "memory_amend", "memory_propose", "memory_reconcile", "memory_review", "memory_status",
  ]);
});

test("a boot that forgot the helper is refused", () => {
  assert.throws(() => memoryRowPatches("/opt/gravit-memory", join(homedir(), ".gravit-memory")), /never opens a real memory/);
});

test("the composed row: disabled, re-pointed, absent", () => {
  const home = join(tmpdir(), "m", "home");
  const row = (memoryRowPatches("/opt/gravit-memory", home)[0] as unknown as { insert: { id: string; config: unknown }[] }).insert[0];
  assert.deepEqual(composedMemoryRow([entry("mcp-market", {}), entry(row.id, row.config)]), {
    disabled: false, dir: "/opt/gravit-memory", home,
  });
  assert.deepEqual(composedMemoryRow([entry(MEMORY_ROW_ID, row.config, true)]), { disabled: true }, "a patch's disabled: true");
  assert.deepEqual(composedMemoryRow([entry(MEMORY_ROW_ID, row.config, () => { throw new Error("!!js"); })]), { disabled: true }, "a disabled getter that throws");
  const otherHome = join(tmpdir(), "other", "home");
  const repointed = {
    ...(row.config as Record<string, unknown>),
    args: [join("/srv/memory", "dist", "cli.js"), "mcp", "--as", "gravit", "--home", otherHome],
  };
  assert.deepEqual(composedMemoryRow([entry(MEMORY_ROW_ID, repointed)]), { disabled: false, dir: "/srv/memory", home: otherHome }, "args patched to another home and install");
  assert.equal(composedMemoryRow([entry("mcp-market", {})]), undefined, "no such row");
});

test("what counts as booting a face: an import of bootFace or composeFace as a value, or of the market helper", () => {
  assert.equal(bootsAFace(`import { bootFace } from "../src/boot.ts";`), true);
  assert.equal(bootsAFace(`import {\n  armOrderGate,\n  composeFace as compose,\n} from "../src/boot.ts";`), true, "a multi-line import, renamed");
  assert.equal(bootsAFace(`import * as boot from "../src/boot.ts";`), true);
  assert.equal(bootsAFace(`import "./helpers/no-market.ts";`), true);
  assert.equal(bootsAFace(`import { DEAD_MARKET_URL } from "./helpers/no-market.ts";`), true);
  assert.equal(bootsAFace(`import type { BootedFace } from "../src/boot.ts";`), false, "a type-only import");
  assert.equal(bootsAFace(`import { type BootedFace, type FacePatchList } from "../src/boot.ts";`), false, "type-only names");
  assert.equal(bootsAFace(`import { globalInstructionAudit } from "../src/boot.ts";`), false, "another export of the module");
  assert.equal(bootsAFace(`/* bootFace serves unary /api */\n// composeFace spreads it\nconst s = "import { bootFace } from \\"../src/boot.ts\\"";`), false, "names in a comment or a string");
  assert.equal(importsNoMemory(`import "./helpers/no-memory.ts";`), true);
  assert.equal(importsNoMemory(`// import "./helpers/no-memory.ts";`), false);
});

test("every test that boots a face imports the helper", async () => {
  const booting: string[] = [];
  for (const f of await testFiles()) {
    const src = await readFile(f, "utf8");
    if (!bootsAFace(src)) continue;
    booting.push(f);
    assert.ok(importsNoMemory(src), `${f} boots or composes a face and does not import ./helpers/no-memory.ts`);
  }
  assert.ok(booting.length >= 37, `the matcher still finds the booting tests (${booting.length})`);
});

test("a memory tool is not the seat's: Gate 2 never cards it", () => {
  assert.equal(isOrderTool("mcp__memory__memory_record"), false);
  for (const raw of MEMORY_TOOLS) {
    const name = `${MEMORY_TOOL_PREFIX}${raw}`;
    assert.equal(isOrderTool(name), false, name);
    assert.equal(orderApprovalDecision(name, "ask"), null, name);
  }
});
