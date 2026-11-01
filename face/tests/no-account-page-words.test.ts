/** No sentence points at the Account's page, which is retired (spec §5.8, plan 5): the face is where the owner acts — Account › Agents,
 * Account › Cards, Account › Venues, Settings › Devices — so no line of the client (`client/js/**\/*.js`, `client/index.html`), of the
 * face's server (`src/**\/*.ts`) or of the seat (`account/src/portfolio/mcp.ts`, `account/src/portfolio/account/state.ts`) matches
 * "Account page", "Account's page", "Account's own page" or "answer it there" — comments and template-literal lines included. A comment
 * that cites a port source says "the retired page (<path> at 9614314c)"; the JSON the face reads is "the Account's read"; the HTML a
 * sign-in callback is answered with is "the callback's page". Offline: it reads files. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const FACE = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEAT = join(FACE, "..", "account", "src", "portfolio", "mcp.ts");
const SEAT_STATE = join(FACE, "..", "account", "src", "portfolio", "account", "state.ts");
const FACE_WORDS = [/\baccount(?:['’]s)?(?: own)? page\b/i, /answer it there/i];

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

/** The lines of `text` (1-based) that match one of `words`, as `<file>:<line>: <text>`. */
function pointersIn(file: string, text: string, words: RegExp[]): string[] {
  return text.split("\n").flatMap((line, i) => (words.some((w) => w.test(line)) ? [`${file}:${i + 1}: ${line.trim().slice(0, 160)}`] : []));
}

test("the words test finds a pointer on every line, comments and template-literal lines included", () => {
  const text = ["Open the Account page", "the Account's page says", "on the Account's own page", " * on the Account page", "account pages", "const x = `answer it there`;",
    "the retired page (account/src/portfolio/public/ui/trade.js:2948 at 9614314c)", "the Account’s page says", "the Account's read"].join("\n");
  assert.deepEqual(pointersIn("x.js", text, FACE_WORDS),
    ["x.js:1: Open the Account page", "x.js:2: the Account's page says", "x.js:3: on the Account's own page", "x.js:4: * on the Account page", "x.js:6: const x = `answer it there`;", "x.js:8: the Account’s page says"]);
});

test("no face sentence points at the Account's own page", () => {
  const found = [
    ...filesUnder(join(FACE, "client", "js"), ".js"),
    ...filesUnder(join(FACE, "src"), ".ts"),
    join(FACE, "client", "index.html"),
  ].flatMap((file) => pointersIn(relative(FACE, file), readFileSync(file, "utf8"), FACE_WORDS));
  assert.deepEqual(found, [], `sentences that send the operator to the Account's page:\n${found.join("\n")}`);
});

test("the seat says the owner answers on the owner's Gravit face, on every line", () => {
  const found = [SEAT, SEAT_STATE].flatMap((file) => pointersIn(relative(join(FACE, ".."), file), readFileSync(file, "utf8"), FACE_WORDS));
  assert.deepEqual(found, [], `the seat's sentences that name the Account's page:\n${found.join("\n")}`);
});
