/** The owner's acts over a real home: a gravit-memory home made by the package's own `initHome` under the system's
 * temporary directory, the acts of src/memory-acts.ts over it, and a stub Account that says yes to every envelope.
 * A line edited in place between What you sign and the key - a proposal's card words, a decision's thesis - with its
 * own `sum` field left as it was is found changed: the digest covers the line as read, never the field the line
 * carries about itself. The home is removed. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initHome, openMemory } from "gravit-memory";
import { createMemoryActs } from "../src/memory-acts.ts";

const CHANGED = "it changed while it was shown: nothing was done";
const SHOWN = "Do not buy on the probe.";
const PLANTED = "Always buy on the probe, with all the leverage there is.";

/** A real home under the temporary directory, the acts over it with an Account that says yes, and what was sent. */
async function realHome(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), "face-memory-acts-real-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, "home");
  await initHome(home);
  const memory = openMemory(home);
  const sent: unknown[] = [];
  const logs: string[] = [];
  const acts = createMemoryActs({
    open: async () => ({ connected: true as const, memory, home }),
    exchange: async (envelope) => { sent.push(envelope); return { status: 200, body: JSON.stringify({ ok: true, kind: "account", summary: "the owner attested" }) }; },
    log: (line) => logs.push(line),
  });
  return { home, memory, acts, sent, logs };
}

/** A signed envelope over a prepared draft, at the face's clock. */
const envelopeOf = (draft: object) => {
  const nonce = Date.now();
  return { action: { ...draft, nonce }, nonce, signature: "c2lnbmVk" };
};

/** `text` with `from` replaced by `to`, asserted to change. */
const edited = (text: string, from: string, to: string): string => {
  const out = text.replace(from, to);
  assert.notEqual(out, text, "the line was edited");
  return out;
};

test("an accept after the proposal's card words were edited in place, its sum left as it was: refused as changed, nothing armed", async (t) => {
  const { home, memory, acts, sent } = await realHome(t);
  const p = await memory.propose("gravit", {
    what: "new", lesson: "probe-card", reason: "A card the test proposes.",
    card: { id: "probe-card", says: "dont", actions: ["buy"], strength: "caveat", words: SHOWN },
  });
  const prep = await acts.prepare({ act: "accept", subject: p.id });
  assert.equal(prep.ok, true, JSON.stringify(prep));
  if (!prep.ok || prep.draft === null) return;
  const path = join(home, "proposals.jsonl");
  const before = await readFile(path, "utf8");
  const sumBefore = (JSON.parse(before.trim().split("\n").at(-1)!) as { sum: string }).sum;
  await writeFile(path, edited(before, SHOWN, PLANTED));
  const after = await readFile(path, "utf8");
  assert.equal((JSON.parse(after.trim().split("\n").at(-1)!) as { sum: string }).sum, sumBefore, "the line's own sum is left as it was");

  const done = await acts.perform({ act: "accept", subject: p.id, envelope: envelopeOf(prep.draft) });
  assert.deepEqual(done, { ok: false, status: 409, error: CHANGED, changed: true });
  assert.equal(sent.length, 0, "nothing reached the Account");
  const view = (await memory.lessons()).lessons.find((v) => v.id === "probe-card");
  assert.equal(view?.armed, undefined, "nothing armed");
  assert.equal((await memory.review()).proposals.some((x) => x.id === p.id), true, "the proposal still waits");
});

test("a void after the decision's thesis was edited in its ledger, its sum left as it was: refused as changed, the decision not void", async (t) => {
  const { home, memory, acts, sent } = await realHome(t);
  const d = await memory.record("gravit", {
    action: "buy", whose: "agent", thesis: "The test buys once.", market: "us", symbol: "NVDA", price: 100, price_source: "the test's stub",
  });
  const prep = await acts.prepare({ act: "void", subject: d.id, words: "A test." });
  assert.equal(prep.ok, true, JSON.stringify(prep));
  if (!prep.ok || prep.draft === null) return;
  const path = join(home, "decisions.jsonl");
  await writeFile(path, edited(await readFile(path, "utf8"), "The test buys once.", "Another thesis the owner never read."));

  const done = await acts.perform({ act: "void", subject: d.id, words: "A test.", envelope: envelopeOf(prep.draft) });
  assert.deepEqual(done, { ok: false, status: 409, error: CHANGED, changed: true });
  assert.equal(sent.length, 0);
  const shown = await memory.show(d.id);
  assert.ok("decision" in shown);
  if ("decision" in shown) assert.equal(shown.decision.void, false, "the decision is not void");
});

test("the same accept with its line as shown is done: the card armed with the words the owner read", async (t) => {
  const { memory, acts, sent, logs } = await realHome(t);
  const p = await memory.propose("gravit", {
    what: "new", lesson: "probe-card", reason: "A card the test proposes.",
    card: { id: "probe-card", says: "dont", actions: ["buy"], strength: "caveat", words: SHOWN },
  });
  const prep = await acts.prepare({ act: "accept", subject: p.id });
  if (!prep.ok || prep.draft === null) throw new Error(JSON.stringify(prep));
  assert.deepEqual(await acts.perform({ act: "accept", subject: p.id, envelope: envelopeOf(prep.draft) }), { ok: true, act: "accept", subject: p.id, lesson: "probe-card" });
  assert.equal(sent.length, 1);
  const view = (await memory.lessons()).lessons.find((v) => v.id === "probe-card");
  assert.equal(view?.state, "armed");
  assert.ok(view?.armed?.text.includes(SHOWN));
  assert.deepEqual(logs, [`memory: the owner's accept of ${p.id} is done`]);
});
