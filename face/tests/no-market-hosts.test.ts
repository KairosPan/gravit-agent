import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/* China is the market's (market/src/live/cn-*.ts), reached through the Account: the face reads
 * it through the proxy and reaches no market host of its own, with no
 * direct-to-upstream fallback. Scoped to face/src and face/client on purpose:
 * face/plugins/ is Lunhui's, whose fetching moves in plan 2. */
const FACE = join(dirname(fileURLToPath(import.meta.url)), "..");
const MARKET_HOST = /gtimg\.cn|finance\.qq\.com|eastmoney\.com|51ifind\.com/;

function sources(dir: string): [string, string][] {
  const out: [string, string][] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") out.push(...sources(path));
    } else if (/\.(ts|js|mjs)$/.test(entry.name)) {
      out.push([relative(FACE, path), readFileSync(path, "utf8")]);
    }
  }
  return out;
}

test("the face's own source names no market host", async () => {
  const files = [...sources(join(FACE, "src")), ...sources(join(FACE, "client"))];
  assert.ok(files.length > 100, `walked ${files.length} files`);
  for (const [file, text] of files) assert.doesNotMatch(text, MARKET_HOST, file);
});

test("main.ts mounts no quote, search or China route", async () => {
  const main = readFileSync(join(FACE, "src", "main.ts"), "utf8");
  assert.doesNotMatch(main, /registerQuoteRoutes|registerSymbolSearchRoute|registerCnRankRoute|registerCnCandlesRoute/);
});
