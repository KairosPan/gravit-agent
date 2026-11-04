/** The market's five tools left the seat (plan A2 Task 4): portfolio_explore,
 * portfolio_candles, portfolio_book and portfolio_akshare are gone from the
 * Account seat, and nothing Gravit reads, no allow-list and no code names one.
 * The one line allowed is the role rule that still refuses an older seat's
 * AKShare passthrough by its raw name (src/roles.ts NEVER). */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const MOVED = /\bportfolio_(explore|candles|book|akshare)\b/;
/** roles.ts's AKShare rule, matched by its exact text. */
const ALLOWED = [
  { file: "face/src/roles.ts", line: `    names: [], prefixes: ["mcp__akshare__"], rawNames: ["portfolio_akshare", "market_akshare"] },` },
];
const ROOTS = ["GRAVIT.md", "dsh", "roles", "bots", "face/src", "face/plugins", "face/client/js", "account/src"];

function* files(path: string): Generator<string> {
  const stat = statSync(path);
  if (stat.isFile()) { yield path; return; }
  for (const name of readdirSync(path)) {
    if (name === "node_modules" || name === ".git") continue;
    yield* files(join(path, name));
  }
}

test("no prompt, allow-list or code names a tool that left the seat", () => {
  const hits: string[] = [];
  const allowedSeen = new Set<string>();
  for (const root of ROOTS) {
    for (const file of files(join(REPO, root))) {
      const rel = relative(REPO, file);
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (!MOVED.test(line)) return;
        const allowed = ALLOWED.find((a) => a.file === rel && a.line === line);
        if (allowed) { allowedSeen.add(allowed.file); return; }
        hits.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }
  }
  assert.deepEqual(hits, [], `names a tool that left the seat:\n${hits.join("\n")}`);
  assert.deepEqual([...allowedSeen], ALLOWED.map((a) => a.file), "the role rule's line is still there, word for word");
});
