import test from "node:test";
import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ID_RE, RECORD_FILE, createRecord, newId } from "../plugins/readthrough/lib/record.mjs";

const print = (symbol: string) => ({ symbol, price: 100, changePct: -7.3, feed: "robinhood", asOf: "2026-11-09T09:03:10.000Z", traded: true });
const entry = (id: string, over: object = {}) => ({
  kind: "direction", id, t: "2026-11-09T09:04:00.000Z", caller: { kind: "annotation", pass: "p-1", sessionId: "s-1", ref: "2026-11-06" },
  symbol: "NVDA", basis: "company", event: "e", sources: ["s"], logic: "l", peers: [{ ...print("AMD"), reason: "r" }],
  stricken: print("NVDA"), spy: print("SPY"), counter: "c", noDirection: null, certainty: "medium", shut: false, ...over,
});
async function scratch(t: { after(fn: () => Promise<unknown>): unknown }) {
  const dir = join(await mkdtemp(join(tmpdir(), "readthrough-record-")), "readthrough");
  t.after(() => rm(join(dir, ".."), { recursive: true, force: true }));
  return dir;
}

test("an id is rt-, the ET date and eight hex digits", () => {
  const id = newId(new Date("2026-11-10T02:30:00.000Z"));   // 21:30 ET on 11-09
  assert.match(id, ID_RE);
  assert.ok(id.startsWith("rt-20261109-"));
});

test("with no file, given answers undefined and all answers none; the first append makes the directory", async (t) => {
  const record = createRecord(await scratch(t));
  assert.deepEqual([await record.given("NVDA", "2026-11-06"), await record.all()], [undefined, []]);
  await record.append(entry("rt-20261109-0000aaaa"));
  assert.equal((await record.given("NVDA", "2026-11-06"))?.id, "rt-20261109-0000aaaa");
});

test("given matches the symbol and the reference of an annotation's direction only", async (t) => {
  const record = createRecord(await scratch(t));
  await record.append(entry("rt-20261109-0000aaaa"));
  await record.append(entry("rt-20261109-0000bbbb", { symbol: "INTC" }));
  await record.append(entry("rt-20261109-0000cccc", { caller: { kind: "task", sessionId: "s-9" }, symbol: "CRWV" }));
  await record.sent("rt-20261109-0000aaaa", true, "2026-11-09T09:05:00.000Z");
  assert.equal((await record.given("NVDA", "2026-11-06"))?.id, "rt-20261109-0000aaaa");
  assert.equal(await record.given("NVDA", "2026-11-09"), undefined, "another reference close");
  assert.equal(await record.given("CRWV", "2026-11-06"), undefined, "a task's direction opens no event");
  assert.deepEqual((await record.all()).map((e) => e.kind), ["direction", "direction", "direction", "sent"]);
});

test("a no-direction counts as given", async (t) => {
  const record = createRecord(await scratch(t));
  await record.append(entry("rt-20261109-0000dddd", { peers: [], counter: null, noDirection: "n" }));
  assert.equal((await record.given("NVDA", "2026-11-06"))?.noDirection, "n");
});

test("a torn last line is skipped, and the next append is a whole line of its own", async (t) => {   // Review Focus 3
  const dir = await scratch(t);
  const record = createRecord(dir);
  await record.append(entry("rt-20261109-0000aaaa"));
  await appendFile(join(dir, RECORD_FILE), '{"kind":"direction","id":"rt-2026');   // a crash mid-append
  assert.equal((await record.all()).length, 1);
  await record.append(entry("rt-20261109-0000eeee", { symbol: "INTC" }));
  assert.equal((await record.given("INTC", "2026-11-06"))?.id, "rt-20261109-0000eeee");
  assert.equal((await readFile(join(dir, RECORD_FILE), "utf8")).endsWith("\n"), true);
});

test("two appends at once are two whole lines", async (t) => {
  const record = createRecord(await scratch(t));
  await Promise.all([record.append(entry("rt-20261109-00000001")), record.append(entry("rt-20261109-00000002", { symbol: "INTC" }))]);
  assert.equal((await record.all()).length, 2);
});
