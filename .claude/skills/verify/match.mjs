// The verify skill's matcher: which items of checklist.md a change owes. No dependencies; Node 22.
//   node .claude/skills/verify/match.mjs                the working tree, the index and untracked files against HEAD
//   node .claude/skills/verify/match.mjs --base main    plus everything committed since main
//   node .claude/skills/verify/match.mjs -- <path> ...  these paths alone, from the repo root
// It prints each item a changed path triggers, with the paths that did. Exit 2: checklist.md has an
// item it cannot read; exit 1: git failed.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { isAbsolute, relative } from "node:path";
import { fileURLToPath } from "node:url";

const CHECKLIST = new URL("./checklist.md", import.meta.url);

/** A glob's regular-expression body: `**` any depth, `*` and `?` within one path segment, `{a,b}` either. */
function globBody(glob) {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      i += 1;
      if (glob[i + 1] === "/") { i += 1; out += "(?:.*/)?"; } else out += ".*";
    } else if (c === "*") out += "[^/]*";
    else if (c === "?") out += "[^/]";
    else if (c === "{") {
      const end = glob.indexOf("}", i);
      if (end < 0) throw new Error(`unclosed "{" in ${glob}`);
      out += `(?:${glob.slice(i + 1, end).split(",").map(globBody).join("|")})`;
      i = end;
    } else out += c.replace(/[.+^$()|[\]\\}]/, "\\$&");
  }
  return out;
}
export const globToRegExp = (glob) => new RegExp(`^${globBody(glob)}$`);

/** The items of checklist.md, and what is wrong with any of them. */
export function readChecklist(text) {
  const items = [];
  const problems = [];
  let item = null;
  for (const line of text.split("\n")) {
    const head = /^### (\S+) — (.+)$/.exec(line);
    if (head) {
      item = { id: head[1], title: head[2], when: [], kind: "", text: "", why: "" };
      items.push(item);
      continue;
    }
    const field = item && /^- (when|check|owed|why): (.+)$/.exec(line);
    if (!field) continue;
    const [, name, value] = field;
    if (name === "when") item.when = [...value.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    else if (name === "why") item.why = value;
    else if (item.kind) problems.push(`${item.id}: both check and owed`);
    else { item.kind = name; item.text = value; }
  }
  const seen = new Set();
  for (const it of items) {
    if (seen.has(it.id)) problems.push(`${it.id}: the id is used twice`);
    seen.add(it.id);
    if (it.when.length === 0) problems.push(`${it.id}: no when`);
    if (!it.kind) problems.push(`${it.id}: no check and no owed`);
    if (!it.why) problems.push(`${it.id}: no why`);
    it.patterns = [];
    for (const glob of it.when) {
      try { it.patterns.push(globToRegExp(glob)); } catch (e) { problems.push(`${it.id}: ${e.message}`); }
    }
  }
  return { items, problems };
}

/** Which items the paths trigger, each with the paths that triggered it, in checklist order. */
export function matchItems(items, paths) {
  const owed = [];
  for (const it of items) {
    const hits = paths.filter((p) => it.patterns.some((re) => re.test(p)));
    if (hits.length > 0) owed.push({ ...it, hits });
  }
  return owed;
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 }).split("\n").filter(Boolean);
}

function changedPaths(argv) {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const dash = argv.indexOf("--");
  if (dash >= 0) {
    return argv.slice(dash + 1).map((p) => (isAbsolute(p) ? relative(root, p) : p).replace(/^\.\//, ""));
  }
  const paths = new Set([...git(root, ["diff", "--name-only", "HEAD"]), ...git(root, ["ls-files", "--others", "--exclude-standard"])]);
  const base = argv.indexOf("--base");
  if (base >= 0) {
    if (!argv[base + 1]) throw new Error("--base needs a ref");
    for (const p of git(root, ["diff", "--name-only", `${argv[base + 1]}...HEAD`])) paths.add(p);
  }
  return [...paths].sort();
}

function main(argv) {
  const { items, problems } = readChecklist(readFileSync(CHECKLIST, "utf8"));
  if (problems.length > 0) {
    for (const p of problems) process.stderr.write(`checklist.md: ${p}\n`);
    return 2;
  }
  let paths;
  try { paths = changedPaths(argv); } catch (e) { process.stderr.write(`${e.message}\n`); return 1; }
  const owed = matchItems(items, paths);
  const lines = [`${paths.length} changed path${paths.length === 1 ? "" : "s"}; ${owed.length} item${owed.length === 1 ? "" : "s"} owed.`];
  for (const it of owed) {
    const shown = it.hits.slice(0, 4).join(", ") + (it.hits.length > 4 ? `, and ${it.hits.length - 4} more` : "");
    lines.push("", `${it.kind.padEnd(5)}  ${it.id} — ${it.title}`, `       paths: ${shown}`, `       ${it.kind === "check" ? "do:   " : "owed: "} ${it.text}`, `       why:   ${it.why}`);
  }
  if (owed.length > 0) lines.push("", "Each item goes under Verified, Not run or Owed in the report (SKILL.md, section 4).");
  process.stdout.write(lines.join("\n") + "\n");
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv.slice(2));
