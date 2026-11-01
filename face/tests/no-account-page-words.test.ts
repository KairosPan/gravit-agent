/** No face sentence sends the operator to the Account's own page (spec §5.8, plan 4b Task 7): the face is where the owner
 * acts — Account › Agents, Account › Cards, Account › Venues, Settings › Devices — so every line of the client
 * (`client/js/**\/*.js`) and of the face's server (`src/**\/*.ts`) that is not a comment matches neither "Account page" nor
 * "answer it there". A comment may still cite the Account's page as the source a rule was ported from (a line whose trimmed
 * start is `//`, `*` or `/*`). And the seat (`account/src/portfolio/mcp.ts`), whose sentences Gravit reads, says where the
 * owner answers on the face: no line of it says "account page", but the `portfolio_memory` and `portfolio_desk`
 * registrations, which plan 5 settles with the page (§5.4). Offline: it reads files. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const FACE = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEAT = join(FACE, "..", "account", "src", "portfolio", "mcp.ts");
const FACE_WORDS = [/Account page/i, /answer it there/i];

/** Every file under `dir` whose name ends with `ext`, sorted. */
function filesUnder(dir: string, ext: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(path, ext));
    else if (entry.name.endsWith(ext)) out.push(path);
  }
  return out.sort();
}

/** A line that is a comment: its trimmed start is `//`, `*` or `/*`. */
const isComment = (line: string): boolean => /^(\/\/|\*|\/\*)/.test(line.trim());

/** The lines of `text` (1-based) that are not comments and match one of `words`, as `<file>:<line>: <text>`. */
function pointersIn(file: string, text: string, words: RegExp[]): string[] {
  return text.split("\n").flatMap((line, i) => (!isComment(line) && words.some((w) => w.test(line)) ? [`${file}:${i + 1}: ${line.trim().slice(0, 160)}`] : []));
}

/** The seat's lines (1-based) outside the `portfolio_memory` and `portfolio_desk` registrations that say "account page": a
 * registration runs from its `server.registerTool(` to the next one. */
function seatPointersIn(text: string): string[] {
  const lines = text.split("\n");
  let skipping = false;
  const out: string[] = [];
  lines.forEach((line, i) => {
    if (/^\s*server\.registerTool\(\s*$/.test(line)) {
      const name = lines.slice(i + 1).find((l) => l.trim() !== "")?.trim() ?? "";
      skipping = name === '"portfolio_memory",' || name === '"portfolio_desk",';
    }
    if (!skipping && /account page/i.test(line)) out.push(`mcp.ts:${i + 1}: ${line.trim().slice(0, 160)}`);
  });
  return out;
}

test("the words test finds a pointer on a code line and not on a comment", () => {
  assert.deepEqual(pointersIn("x.js", "// on the Account page\n * the Account page's rule\n/* Account page */\nconst a = 'Open the Account page';\nconst b = `answer it there`;", FACE_WORDS),
    ["x.js:4: const a = 'Open the Account page';", "x.js:5: const b = `answer it there`;"]);
  const seat = ['server.registerTool(', '  "portfolio_ask",', '  { description: "on the account page" },', ');', 'server.registerTool(', '  "portfolio_memory",',
    '  { description: "on the account page (Account › Memory)" },', ');', 'server.registerTool(', '  "portfolio_desk_say",', '  { description: "the account page" },', ');',
    '// a comment on the account page counts too'].join("\n");
  assert.deepEqual(seatPointersIn(seat), ['mcp.ts:3: { description: "on the account page" },', 'mcp.ts:11: { description: "the account page" },', "mcp.ts:13: // a comment on the account page counts too"]);
});

test("no face sentence points at the Account's own page", () => {
  const found = [
    ...filesUnder(join(FACE, "client", "js"), ".js"),
    ...filesUnder(join(FACE, "src"), ".ts"),
  ].flatMap((file) => pointersIn(relative(FACE, file), readFileSync(file, "utf8"), FACE_WORDS));
  assert.deepEqual(found, [], `sentences that send the operator to the Account's page:\n${found.join("\n")}`);
});

test("the seat says the owner answers on the owner's Gravit face, but for Memory and the Desk (plan 5)", () => {
  const found = seatPointersIn(readFileSync(SEAT, "utf8"));
  assert.deepEqual(found, [], `the seat's sentences that name the account page:\n${found.join("\n")}`);
});
