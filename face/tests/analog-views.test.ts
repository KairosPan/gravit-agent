// face/tests/analog-views.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AnalogError } from "../plugins/analog/lib/errors.mjs";
import { VIEWS_KEPT, VIEW_ID_RE, VIEW_MAX_BYTES, createViewStore, newViewId } from "../plugins/analog/lib/views.mjs";

const dir = async (t: { after(fn: () => Promise<unknown>): unknown }) => {
  const root = await mkdtemp(join(tmpdir(), "analog-views-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return join(root, "face", "analog", "views");
};
const code = (c: string) => (e: unknown) => e instanceof AnalogError && e.code === c;

test("an id is the New York date and eight hex digits", () => {
  assert.deepEqual([VIEW_MAX_BYTES, VIEWS_KEPT], [524_288, 300]);
  assert.equal(newViewId(new Date("2026-11-11T03:00:00Z"), () => Buffer.from("0a1b2c3d", "hex")), "an-20261110-0a1b2c3d");
  assert.match(newViewId(new Date()), VIEW_ID_RE);
});

test("a view is written 0600 in a 0700 directory, with its id inside, and read back", async (t) => {
  const store = createViewStore(await dir(t));
  const { id, bytes, windowsDropped } = await store.write({ kind: "chart", cases: [] }, new Date("2026-11-10T20:00:00Z"));
  assert.match(id, /^an-20261110-[0-9a-f]{8}$/); assert.equal(windowsDropped, 0); assert.ok(bytes > 0);
  assert.deepEqual(await store.read(id), { kind: "chart", cases: [], id, windowsDropped: 0, casesDropped: 0 });
});

test("the file and its directory keep others out, and no temporary file is left", async (t) => {
  const at = await dir(t);
  const { id } = await createViewStore(at).write({ kind: "chart", cases: [] });
  assert.equal((await stat(join(at, `${id}.json`))).mode & 0o777, 0o600);
  assert.equal((await stat(at)).mode & 0o777, 0o700);
  assert.deepEqual(await readdir(at), [`${id}.json`]);
});

test("an id that is not an id, and one that is not there", async (t) => {
  const store = createViewStore(await dir(t));
  for (const bad of ["", "an-1", "../an-20261110-0a1b2c3d", "an-20261110-0A1B2C3D", 7]) await assert.rejects(store.read(bad as string), code("BAD_VIEW_ID"));
  await assert.rejects(store.read("an-20261110-0a1b2c3d"), code("NO_SUCH_VIEW"));
});

test("past the size cap the farthest cases lose their windows, counted", async (t) => {
  const window = Array.from({ length: 91 }, (_, k) => [k - 30, 101.11, 102.22, 99.33, 100.44, 123456789]);
  const cases = Array.from({ length: 12 }, (_, k) => ({ id: `S${k}:2020-01-01`, distance: k, window }));
  const store = createViewStore(await dir(t), { maxBytes: 20_000 });
  const { id, bytes, windowsDropped } = await store.write({ kind: "chart", windowsDropped: 0, cases });
  const kept = await store.read(id) as { cases: Array<{ distance: number; window: unknown }>; windowsDropped: number };
  assert.ok(bytes <= 20_000); assert.ok(windowsDropped > 0 && windowsDropped < 12); assert.equal(kept.windowsDropped, windowsDropped);
  assert.deepEqual(kept.cases.map((c) => c.window === null), cases.map((_, k) => k >= 12 - windowsDropped));
});

test("when every window is gone and the view is still over the cap, the farthest cases go too, counted", async (t) => {
  const cases = Array.from({ length: 200 }, (_, k) => ({ id: `S${k}:2020-01-01`, distance: k, window: null }));
  const store = createViewStore(await dir(t), { maxBytes: 5_000 });
  const { id, bytes, windowsDropped, casesDropped } = await store.write({ kind: "chart", cases });
  const kept = await store.read(id) as { cases: Array<{ id: string }>; casesDropped: number };
  assert.ok(bytes <= 5_000); assert.equal(windowsDropped, 0);
  assert.ok(casesDropped > 0 && casesDropped < 200); assert.equal(kept.casesDropped, casesDropped);
  assert.deepEqual(kept.cases.map((c) => c.id), cases.slice(0, 200 - casesDropped).map((c) => c.id));
});

test("a leading case is the last to lose anything", async (t) => {
  const window = Array.from({ length: 91 }, (_, k) => [k - 30, 101.11, 102.22, 99.33, 100.44, 123456789]);
  const cases = Array.from({ length: 12 }, (_, k) => ({ id: `S${k}:2020-01-01`, distance: k, window }));
  const leading = { own: ["S11:2020-01-01"], others: [{ id: "S10:2020-01-01", standsFor: 1 }] };
  const store = createViewStore(await dir(t), { maxBytes: 20_000 });
  const { id, windowsDropped, casesDropped } = await store.write({ kind: "chart", leading, cases });
  const kept = await store.read(id) as { cases: Array<{ id: string; window: unknown }> };
  assert.ok(windowsDropped > 0 && windowsDropped <= 10); assert.equal(casesDropped, 0);
  assert.deepEqual(kept.cases.filter((c) => c.window === null).map((c) => c.id), cases.slice(10 - windowsDropped, 10).map((c) => c.id), "the two leading cases, though the farthest, keep their windows");
});

test("write leaves the view it was given as it was", async (t) => {
  const window = Array.from({ length: 91 }, (_, k) => [k - 30, 101.11, 102.22, 99.33, 100.44, 123456789]);
  const view = { kind: "chart", windowsDropped: 0, cases: Array.from({ length: 12 }, (_, k) => ({ id: `S${k}:2020-01-01`, distance: k, window })) };
  const before = structuredClone(view);
  await createViewStore(await dir(t), { maxBytes: 20_000 }).write(view);
  assert.deepEqual(view, before);
});

test("a view of thousands of cases is trimmed in one pass, not by serializing it once for every window", async (t) => {
  const window = Array.from({ length: 91 }, (_, k) => [k - 30, 101.11, 102.22, 99.33, 100.44, 123456789]);
  const cases = Array.from({ length: 3000 }, (_, k) => ({ id: `S${k}:2020-01-01`, symbol: `S${k}`, distance: k / 100, window }));
  const store = createViewStore(await dir(t)); // the real cap, 512 KiB
  const started = performance.now();
  const { bytes, windowsDropped, casesDropped } = await store.write({ kind: "chart", cases });
  const took = performance.now() - started;
  assert.ok(bytes <= VIEW_MAX_BYTES);
  assert.ok(windowsDropped > 2800 && casesDropped === 0, `${windowsDropped} windows, ${casesDropped} cases`);
  assert.ok(took < 5000, `${Math.round(took)} ms: one pass takes a fraction of a second; a whole-view serialization per dropped window takes minutes`);
});

test("only the newest views are kept", async (t) => {
  const at = await dir(t);
  const store = createViewStore(at, { kept: 3 });
  const ids: string[] = [];
  for (let k = 0; k < 5; k++) {
    const { id } = await store.write({ kind: "chart", cases: [], k });
    ids.push(id);
    await utimes(join(at, `${id}.json`), new Date(1_700_000_000_000 + k * 1000), new Date(1_700_000_000_000 + k * 1000));
  }
  await store.write({ kind: "chart", cases: [], k: 5 });
  const left = (await readdir(at)).sort();
  assert.equal(left.length, 3); assert.ok(!left.includes(`${ids[0]}.json`) && !left.includes(`${ids[1]}.json`) && !left.includes(`${ids[2]}.json`));
});
