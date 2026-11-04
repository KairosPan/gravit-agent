import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSearchIndex, openSearchIndexOrFresh, SEARCH_INDEX_VERSION, snippetAround, validQuery, type SearchIndex } from "../src/search-index.ts";

const MARK = { revision: "r1", readCount: 1 };
const ids = (r: { items: { sessionId: string }[] }) => r.items.map((i) => i.sessionId);

test("finds a Chinese word of one, two and four characters inside a sentence", () => {
  const idx = openSearchIndex(":memory:");
  idx.append("a", MARK, [{ seq: 1, at: 1, text: "贵州茅台的估值很高，宁德时代下跌了" }]);
  for (const q of ["茅", "茅台", "估值很高"]) assert.deepEqual(ids(idx.query(q)), ["a"], q);
  idx.close();
});

test("finds an English word in any case and a number", () => {
  const idx = openSearchIndex(":memory:");
  idx.append("a", MARK, [{ seq: 1, at: 1, text: "Lunhui market read for 600519" }]);
  for (const q of ["MARKET", "600519"]) assert.deepEqual(ids(idx.query(q)), ["a"], q);
  idx.close();
});

test("one hit per conversation, its newest line, newest conversation first", () => {
  const idx = openSearchIndex(":memory:");
  idx.append("old", MARK, [
    { seq: 1, at: 100, text: "alpha first old" },
    { seq: 2, at: 200, text: "alpha newest old" },
  ]);
  idx.append("new", MARK, [
    { seq: 1, at: 300, text: "alpha first new" },
    { seq: 2, at: 400, text: "alpha newest new" },
  ]);
  const r = idx.query("alpha");
  assert.deepEqual(ids(r), ["new", "old"]);
  assert.equal(r.hasMore, false);
  assert.ok(r.items[0]!.snippet.includes("newest new"));
  assert.ok(r.items[1]!.snippet.includes("newest old"));
  assert.equal(r.items[0]!.at, 400);
  idx.close();
});

test("twenty at most, and hasMore past them", () => {
  const idx = openSearchIndex(":memory:");
  for (let i = 0; i < 21; i++) idx.append(`s${i}`, MARK, [{ seq: 1, at: i, text: "common phrase" }]);
  const r = idx.query("common");
  assert.equal(r.items.length, 20);
  assert.equal(r.hasMore, true);
  idx.close();
});

test("a query that looks like syntax is literal", () => {
  const idx = openSearchIndex(":memory:");
  const cases: [string, string][] = [
    ['a"b', "q1"], ["50%", "q2"], ["x_y", "q3"], ["\\", "q4"], ["NEAR(", "q5"], ["-x", "q6"], ["*", "q7"],
  ];
  const lines = ['a"b', "50% off", "x_y", "back\\slash", "NEAR(a b)", "-x", "*star"];
  lines.forEach((text, i) => idx.append(cases[i]![1], MARK, [{ seq: 1, at: i + 1, text }]));
  idx.append("plain", MARK, [{ seq: 1, at: 99, text: "plain" }]);
  for (const [q, sid] of cases) assert.deepEqual(ids(idx.query(q)), [sid], q);
  idx.close();
});

test("the snippet holds the match within 240 characters", () => {
  const idx = openSearchIndex(":memory:");
  const text = "x".repeat(500) + "needle" + "y".repeat(494);
  assert.equal([...text].length, 1000);
  idx.append("a", MARK, [{ seq: 1, at: 1, text }]);
  const hit = idx.query("needle").items[0]!;
  assert.ok([...hit.snippet].length <= 240);
  assert.ok(hit.snippet.startsWith("…") && hit.snippet.endsWith("…"));
  assert.equal(hit.snippet.slice(...hit.match).toLowerCase(), "needle");
  idx.close();
});

test("the snippet never splits a surrogate pair", () => {
  const bad = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  const unit = "😀中😀文";
  for (let pad = 0; pad < 12; pad++) {
    const text = unit.repeat(120 + pad) + "NeEdLe" + unit.repeat(130) + "😀".repeat(pad);
    const r = snippetAround(text, "needle")!;
    assert.ok(r, "found");
    assert.ok(!bad.test(r.snippet), `pad ${pad}`);
    assert.equal(r.snippet.slice(...r.match).toLowerCase(), "needle");
    assert.ok([...r.snippet].length <= 240);
  }
  // a short query hitting an emoji
  const r = snippetAround("中".repeat(300) + "😀" + "文".repeat(300), "😀")!;
  assert.ok(!bad.test(r.snippet));
  assert.equal(r.snippet.slice(...r.match), "😀");
});

test("validQuery refuses the empty, the over-long and the NUL", () => {
  assert.equal(validQuery("  "), null);
  assert.equal(validQuery("a".repeat(501)), null);
  assert.equal(validQuery("😀".repeat(501)), null);
  assert.equal(validQuery("a\u0000b"), null);
  assert.equal(validQuery("  x "), "x");
  assert.equal(validQuery("😀".repeat(500)), "😀".repeat(500));
  const idx = openSearchIndex(":memory:");
  for (const q of ["  ", "a".repeat(501), "a\u0000b"]) assert.throws(() => idx.query(q), RangeError);
  idx.close();
});

test("reset drops a conversation; marks round-trip; a file index survives a reopen", () => {
  const dir = mkdtempSync(join(tmpdir(), "search-index-"));
  try {
    const path = join(dir, "search.sqlite");
    const a = openSearchIndex(path);
    a.append("s1", { revision: "rev-7", readCount: 12 }, [{ seq: 1, at: 5, text: "persisted words" }]);
    a.append("s1", { revision: "rev-8", readCount: 13 }, [{ seq: 2, at: 6, text: "more words" }]);
    a.close();
    const b = openSearchIndex(path);
    assert.deepEqual(b.marks().get("s1"), { revision: "rev-8", readCount: 13 });
    assert.deepEqual(ids(b.query("words")), ["s1"]);
    b.reset("s1");
    assert.equal(b.marks().size, 0);
    assert.deepEqual(b.query("words").items, []);
    b.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A fresh temp dir for one test, removed after it. */
function withDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "search-index-"));
  try { fn(dir); } finally { chmodSync(dir, 0o700); rmSync(dir, { recursive: true, force: true }); }
}

test("a mark keeps the log's size; an unsized mark has none", () => {
  const idx = openSearchIndex(":memory:");
  idx.append("a", { revision: "r", readCount: 2, size: 4096 }, []);
  idx.append("b", { revision: "r", readCount: 2 }, []);
  assert.deepEqual(idx.marks().get("a"), { revision: "r", readCount: 2, size: 4096 });
  assert.deepEqual(idx.marks().get("b"), { revision: "r", readCount: 2 });
  idx.close();
});

test("a second close does nothing", () => {
  const idx = openSearchIndex(":memory:");
  idx.close();
  assert.doesNotThrow(() => idx.close());
});

test("a file index is stamped with the schema version and is 0600", () => withDir((dir) => {
  const path = join(dir, "search.sqlite");
  openSearchIndex(path).close();
  assert.equal(statSync(path).mode & 0o777, 0o600);
  const db = new DatabaseSync(path);
  assert.equal((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, SEARCH_INDEX_VERSION);
  db.close();
}));

test("a garbage file opens as a fresh empty index, with one line said", () => withDir((dir) => {
  const path = join(dir, "search.sqlite");
  writeFileSync(path, "this is not a database ".repeat(200));
  writeFileSync(path + "-wal", "junk");
  assert.throws(() => openSearchIndex(path));
  const lines: string[] = [];
  const idx = openSearchIndexOrFresh(path, (l) => lines.push(l))!;
  assert.ok(idx);
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /rebuilding it$/);
  assert.equal(idx.marks().size, 0);
  idx.append("a", MARK, [{ seq: 1, at: 1, text: "fresh words" }]);
  assert.deepEqual(ids(idx.query("fresh")), ["a"]);
  idx.close();
}));

test("a file with another schema version is replaced; an unstamped one too", () => withDir((dir) => {
  for (const stamp of [SEARCH_INDEX_VERSION + 1, 0]) {
    const path = join(dir, `v${stamp}.sqlite`);
    const db = new DatabaseSync(path);
    db.exec("CREATE TABLE marks (session_id TEXT PRIMARY KEY, revision TEXT NOT NULL, read_count INTEGER NOT NULL);" +
      "INSERT INTO marks VALUES ('old', 'r', 9);" + `PRAGMA user_version = ${stamp};`);
    db.close();
    assert.throws(() => openSearchIndex(path), /schema/);
    const lines: string[] = [];
    const idx = openSearchIndexOrFresh(path, (l) => lines.push(l))!;
    assert.equal(lines.length, 1, String(stamp));
    assert.equal(idx.marks().size, 0, "the old marks are gone");
    idx.append("a", { revision: "r", readCount: 1, size: 10 }, []);
    assert.deepEqual(idx.marks().get("a"), { revision: "r", readCount: 1, size: 10 });
    idx.close();
  }
}));

test("when even a fresh index will not open, the answer is undefined and two lines are said", () => withDir((dir) => {
  const lines: string[] = [];
  let calls = 0;
  const failing = (_p: string): SearchIndex => { calls += 1; throw new Error("disk says no"); };
  assert.equal(openSearchIndexOrFresh(join(dir, "x.sqlite"), (l) => lines.push(l), failing), undefined);
  assert.equal(calls, 2);
  assert.equal(lines.length, 2);
  assert.match(lines[1]!, /search is off until a restart$/);

  // the real opener, over a folder it may not write
  const locked = join(dir, "locked");
  mkdirSync(locked, 0o500);
  const real: string[] = [];
  assert.equal(openSearchIndexOrFresh(join(locked, "search.sqlite"), (l) => real.push(l)), undefined);
  assert.equal(existsSync(join(locked, "search.sqlite")), false);
  assert.equal(real.length, 2);
  chmodSync(locked, 0o700);
}));
