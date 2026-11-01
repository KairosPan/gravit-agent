#!/usr/bin/env node
// The import closure of a set of entry files in a TypeScript tree that imports with the extension
// as written (`./x.ts`).
//
//   node account/scripts/import-closure.mjs <sourceRoot> [--copy <dest>] <entry>...
//
// stdout: the sorted source-relative paths of every file reached from the kept entries.
// stderr: one line per entry excluded, naming the first import that reached a dropped directory.
// Followed: relative specifiers in `import … from "…"`, `export … from "…"`, `import "…"` and
// `import("…")`, resolved against the importing file; a bare specifier is a package, not followed.
// A `src/` entry reaching a dropped directory is an error (exit 2); a `test/` entry reaching one is
// excluded, and nothing of its closure is listed on its account. `--copy` copies every listed file
// to <dest>, keeping its relative path.
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const DROPPED = [
  "src/runner",
  "src/control-room",
  "src/venues",
  "src/wallet",
  "src/plugins",
  "scripts",
  "site",
  "docs",
  "examples",
];

const SPECIFIERS = [
  /\b(?:import|export)\s[^'";]*?\bfrom\s*['"]([^'"\n]+)['"]/g,
  /\bimport\s*['"]([^'"\n]+)['"]/g,
  /\bimport\(\s*['"]([^'"\n]+)['"]\s*\)/g,
];

function usage(message) {
  if (message) process.stderr.write(`${message}\n`);
  process.stderr.write("usage: node import-closure.mjs <sourceRoot> [--copy <dest>] <entry>...\n");
  process.exit(1);
}

const args = process.argv.slice(2);
const root = args.shift();
if (!root) usage();
const ROOT = resolve(root);
let dest = null;
const entries = [];
while (args.length) {
  const a = args.shift();
  if (a === "--copy") {
    dest = args.shift();
    if (!dest) usage("--copy needs a destination");
  } else entries.push(a);
}
if (!entries.length) usage("no entries");

const toRel = (abs) => relative(ROOT, abs).split(sep).join("/");
const droppedOf = (rel) => DROPPED.find((d) => rel === d || rel.startsWith(`${d}/`));

function specifiersOf(abs) {
  const text = readFileSync(abs, "utf8");
  const found = [];
  for (const re of SPECIFIERS) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) found.push(m[1]);
  }
  return found.filter((s) => s.startsWith("./") || s.startsWith("../"));
}

// The closure of one entry: { files } or { reach: { from, specifier, to } } at the first dropped hit.
function closureOf(entryRel) {
  const files = new Set();
  const stack = [entryRel];
  while (stack.length) {
    const rel = stack.pop();
    if (files.has(rel)) continue;
    const abs = join(ROOT, rel);
    if (!existsSync(abs) || !statSync(abs).isFile()) throw new Error(`missing file: ${rel}`);
    files.add(rel);
    for (const spec of specifiersOf(abs)) {
      const to = toRel(resolve(dirname(abs), spec));
      if (to.startsWith("../")) throw new Error(`${rel} imports outside the source root: ${spec}`);
      if (droppedOf(to)) return { reach: { from: rel, specifier: spec, to } };
      if (!files.has(to)) stack.push(to);
    }
  }
  return { files };
}

const listed = new Set();
let failed = false;
for (const entry of entries) {
  const rel = entry.split(sep).join("/").replace(/^\.\//, "");
  let result;
  try {
    result = closureOf(rel);
  } catch (e) {
    process.stderr.write(`error: ${rel}: ${e.message}\n`);
    failed = true;
    continue;
  }
  if (result.reach) {
    const { from, specifier, to } = result.reach;
    const line = `${rel}: ${from} imports "${specifier}" (${droppedOf(to)})`;
    if (rel.startsWith("src/")) {
      process.stderr.write(`error: ${line}\n`);
      failed = true;
    } else process.stderr.write(`excluded ${line}\n`);
    continue;
  }
  for (const f of result.files) listed.add(f);
}
if (failed) process.exit(2);

const sorted = [...listed].sort();
process.stdout.write(sorted.map((f) => `${f}\n`).join(""));

if (dest) {
  const DEST = resolve(dest);
  for (const f of sorted) {
    const to = join(DEST, f);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(ROOT, f), to);
  }
}
