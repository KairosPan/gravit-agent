/** The page the face serves at `/` is gravit-ui's, and it loads every asset
 * through the `/client` prefix (static.ts serves nothing else) — the one
 * mounting rule a relative `./js/app.js` would silently break with a 404. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const page = readFileSync(join(import.meta.dirname, "..", "client", "index.html"), "utf8");

test("index.html loads its assets under /client/ and speaks English", () => {
  const refs = [...page.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 3, `expected the stylesheet, the fonts and the script, got ${refs.length}`);
  for (const ref of refs) assert.ok(ref.startsWith("/client/") || ref.startsWith("https://fonts.g"), ref);
  assert.match(page, /<html lang="en">/);
  assert.match(page, /<title>Gravit<\/title>/);
});
