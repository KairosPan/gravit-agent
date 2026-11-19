import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const allow = new Set([join(root, "src/styles/tokens.css")]);
const hex = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g;

/** @param {string} text @returns {string[]} */
export function hexHits(text) {
  return [...text.matchAll(hex)].map((match) => match[0]);
}

function filesUnder(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) filesUnder(path, out);
    else if (/\.(?:tsx?|css|html)$/.test(name)) out.push(path);
  }
  return out;
}

/** @returns {{ file: string, hits: string[] }[]} */
export function lintHex() {
  const failures = [];
  for (const file of filesUnder(join(root, "src"))) {
    if (allow.has(file)) continue;
    const hits = hexHits(readFileSync(file, "utf8"));
    if (hits.length) failures.push({ file: relative(root, file), hits });
  }
  const index = join(root, "index.html");
  const indexHits = hexHits(readFileSync(index, "utf8"));
  if (indexHits.length) failures.push({ file: "index.html", hits: indexHits });
  return failures;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const failures = lintHex();
  if (failures.length === 0) {
    console.log("no raw hex outside src/styles/tokens.css");
  } else {
    for (const failure of failures) {
      console.error(`${failure.file}: ${failure.hits.join(", ")}`);
    }
    console.error("Raw hex belongs in src/styles/tokens.css.");
    process.exit(1);
  }
}
