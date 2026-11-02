// face/tests/desk-weight.test.ts
/** The pause switch stays light (P1's Task 5 ruling; the P2 plan's Global Constraints, "Module weight"): `npm run
 * desk` and scripts/service.ts import src/desk.ts, and a pause or a resume must load no more than it did before the
 * standing orders - no js-yaml, no role library, no desk preset, no desk session, none of P2's new modules. The face
 * loads the clock row (src/schedule.ts) on first use, from src/desk.ts `installDesk`, and src/standing.ts on `arm`'s
 * first use, from scripts/desk.ts. Measured, not grepped: a child node with tsx and a resolve hook
 * (`module.registerHooks`) imports both files and prints every URL it resolved. */
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const FACE = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Every URL a fresh node resolves while it imports `files` (paths under face/), in the order resolved. */
async function resolvedBy(files: readonly string[]): Promise<string[]> {
  const code = [
    'import { registerHooks } from "node:module";',
    'import { pathToFileURL } from "node:url";',
    "const seen = [];",
    "registerHooks({ resolve(specifier, context, next) { const resolved = next(specifier, context); seen.push(resolved.url); return resolved; } });",
    `for (const file of ${JSON.stringify(files)}) await import(pathToFileURL(${JSON.stringify(`${FACE}/`)} + file).href);`,
    'process.stdout.write(seen.join("\\n"));',
  ].join("\n");
  const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { cwd: FACE, timeout: 60_000 });
  return stdout.split("\n").filter((line) => line !== "");
}

/** What a pause must never load: js-yaml, the role library and its graph, the desk preset and the desk session, and
 * every module P2 added to src/. */
const HEAVY = [
  "/node_modules/js-yaml/",
  "/src/roles.ts", "/src/bots.ts", "/src/channels.ts", "/src/desk-preset.ts", "/src/desk-session.ts",
  "/src/producer.ts", "/src/market-clock.ts", "/src/standing.ts", "/src/desk-book.ts", "/src/brief.ts", "/src/firing.ts", "/src/schedule.ts",
  "/src/channel-name.ts",
  "/src/xshg-clock.ts",
] as const;
const heavyOf = (urls: readonly string[]): string[] => urls.filter((url) => HEAVY.some((part) => url.includes(part)));

test("the pause switch stays light: importing src/desk.ts and scripts/desk.ts loads none of the heavy modules", async () => {
  const urls = await resolvedBy(["src/desk.ts", "scripts/desk.ts"]);
  assert.ok(urls.some((url) => url.endsWith("/src/desk.ts")) && urls.some((url) => url.endsWith("/scripts/desk.ts")), "the probe saw both files load");
  assert.ok(urls.some((url) => url.endsWith("/src/desk-conversation.ts")), "and what they do load");
  assert.deepEqual(heavyOf(urls), []);

  /* the probe sees what a module loads: the clock row brings the whole of it */
  const clockRow = heavyOf(await resolvedBy(["src/schedule.ts"]));
  for (const part of ["/node_modules/js-yaml/", "/src/firing.ts", "/src/standing.ts", "/src/market-clock.ts", "/src/desk-session.ts", "/src/desk-preset.ts", "/src/brief.ts", "/src/xshg-clock.ts"]) {
    assert.ok(clockRow.some((url) => url.includes(part)), `src/schedule.ts loads ${part}`);
  }
});
