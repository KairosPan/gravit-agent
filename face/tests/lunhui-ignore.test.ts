/**
 * The Lunhui ignore lines (spec 2026-10-25 §6, A26, D11): a run's evidence files and the corpus
 * stay out of the public repository; a run's `run.json`, `metrics.json` and artifacts do not.
 * Asked of git itself, `git check-ignore -q` from the repository root (exit 0 ignored, 1 not).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Whether git ignores `path`, relative to the repository root; any other exit is thrown. */
function ignored(path: string): boolean {
  try {
    execFileSync("git", ["check-ignore", "-q", path], { cwd: ROOT, stdio: "ignore" });
    return true;
  } catch (err) {
    if ((err as { status?: number }).status === 1) return false;
    throw err;
  }
}

test("ignore: a run's evidence files are ignored; run.json, metrics.json and an artifact are not; the corpus is", () => {
  assert.equal(ignored("strategies/cn-market/analysis/20261023T070000Z-0123abcd/evidence-limit-up.json"), true);
  for (const f of ["run.json", "metrics.json", "sentiment.json"]) assert.equal(ignored(`strategies/cn-market/analysis/20261023T070000Z-0123abcd/${f}`), false);
  assert.equal(ignored("docs/research/lunhui/corpus/x.md"), true);
});
