// face/tests/watch-rules-status.test.ts
/** The watch's status lists its rules (src/watch.ts `rulesStatus`, `WatchStatus.rules`) and counts its levels
 * (`WatchStatus.levels`): a watch over a temp root, no quote source, a WallClock and a fake XNYS calendar; fixtures under
 * face/tests/tmp/watch-rules-<pid>/. Offline. */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { installWatch, rulesStatus, type WatchHandle } from "../src/watch.ts";
import type { Rule } from "../src/desk-book.ts";
import { fakeCalendar, WallClock } from "./desk-fakes.ts";

const TMP = join(dirname(fileURLToPath(import.meta.url)), "tmp", `watch-rules-${process.pid}`);
after(async () => { await rm(TMP, { recursive: true, force: true }); });

const RULES = [
  "- id: crwv-move\n  kind: move_pct\n  symbols: [CRWV]\n  move_pct: 8\n",
  "- id: book-move\n  kind: move_pct\n  symbols: holdings\n  move_pct: 4\n",
  "- id: filings\n  kind: filing\n  symbols: [NVDA]\n  forms: [8-K, 4]\n",
].join("");

const LEVEL = "- symbol: NVDA\n  kind: stop\n  price: 170\n  when: cross_down\n  plan: trim\n  expires: 2027-12-31\n";

let cases = 0;

/** A watch over `files` under a fresh root, its first read done. */
async function watchOver(files: Record<string, string>): Promise<WatchHandle> {
  const base = join(TMP, `case-${++cases}`);
  const root = join(base, "repo");
  for (const [file, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), text);
  }
  const wall = new WallClock("2026-11-30T15:20:45Z");
  const watch = installWatch({
    home: join(base, "home"), root, clock: wall,
    calendars: { us: fakeCalendar({ "2026-11-30": { date: "2026-11-30", open: "2026-11-30T14:30:00Z", close: "2026-11-30T21:00:00Z", early: false } }), cn: fakeCalendar({}) },
    deliver: async () => ({ sent: [] }),
    post: async () => ({ opened: true, sessionId: "s" }),
    budget: async () => ({ used: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, total: 0 }, spent: false }),
    pid: 4242, alive: (p) => p === 4242, log: () => {},
  });
  await wall.advance(0);
  const limit = Date.now() + 5_000;
  while (!watch.status().files.some((f) => f.kind === "rules" && f.loadedAt !== undefined)) {
    if (Date.now() > limit) throw new Error("timed out waiting for the rules' first read");
    await new Promise((done) => setTimeout(done, 5));
  }
  return watch;
}

test("the status lists each rule in file order, with its kind, its threshold or forms and what it follows; no levels counts 0", async () => {
  const watch = await watchOver({ "desk/rules.yml": RULES });
  assert.deepEqual(watch.status().rules, [
    { id: "crwv-move", kind: "move_pct", pct: 8, symbols: ["CRWV"], holdings: false, levels: false },
    { id: "book-move", kind: "move_pct", pct: 4, symbols: [], holdings: true, levels: false },
    { id: "filings", kind: "filing", forms: ["8-K", "4"], symbols: ["NVDA"], holdings: false, levels: false },
  ]);
  assert.equal(watch.status().levels, 0);
  await watch.dispose();
});

test("the status counts the levels loaded", async () => {
  const watch = await watchOver({ "desk/rules.yml": RULES, "desk/levels.yml": LEVEL });
  assert.equal(watch.status().levels, 1);
  await watch.dispose();
});

test("a gap rule's pct is its gap_pct, and a rule's own list is cut at 50 names", () => {
  const names = Array.from({ length: 60 }, (_, i) => `S${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`);
  const rules: Rule[] = [
    { file: "desk/rules.yml", index: 0, id: "gaps", symbols: { holdings: false, levels: true, symbols: names }, annotate: true, urgent: false, kind: "gap", gapPct: 3 },
  ];
  const [row] = rulesStatus(rules);
  assert.deepEqual({ ...row, symbols: row.symbols.length }, { id: "gaps", kind: "gap", pct: 3, symbols: 50, holdings: false, levels: true });
  assert.deepEqual(row.symbols, names.slice(0, 50));
});
