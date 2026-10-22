// face/tests/account-fixtures.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
const fx = (name: string): any => JSON.parse(readFileSync(new URL(`./fixtures/account/${name}.json`, import.meta.url), "utf8"));

test("the Account fixtures carry what the views read", () => {
  const a = fx("account");
  assert.equal(a.ok, true); assert.ok(Array.isArray(a.venues)); assert.ok(Array.isArray(a.cards)); assert.ok(a.signers?.owners);
  assert.ok(a.connectLive?.writes && typeof a.connectLive.writes.capUsd === "number"); assert.ok(["guard", "open"].includes(a.mode));
  const e = fx("explore-all");
  assert.ok(e.tabs.some((t: any) => t.id === "all")); assert.ok(e.items.length > 0); assert.ok(e.items.every((i: any) => typeof i.key === "string" && i.at));
  assert.ok(e.items.every((i: any) => i.icon === undefined), "icons stripped");
  const p = fx("explore-predictions"); assert.ok(p.items.some((i: any) => i.kind === "event" && Array.isArray(i.outcomes)));
  const h = fx("holdings"); assert.equal(h.ok, true); assert.ok(Array.isArray(h.rows)); assert.ok(h.change24h);
  assert.equal(fx("holdings-paper").paper, true);
  assert.ok(Array.isArray(fx("positions").positions)); assert.ok(Array.isArray(fx("statement").lines)); assert.ok(Array.isArray(fx("history").points));
  assert.equal(fx("history-paper").paper, true); assert.ok(Array.isArray(fx("agents").agents)); assert.ok(Array.isArray(fx("compare").rows));
  assert.ok(Array.isArray(fx("candles").candles)); assert.ok(fx("market").market?.symbol);
  const frames = readFileSync(new URL("./fixtures/account/stream-frames.txt", import.meta.url), "utf8");
  assert.match(frames, /^retry: 1000\n\n/); assert.match(frames, /\nevent: (snapshot|hb)\n/);
});

/** Where `value` carries a `native` or `icon` key, at any depth, and an array past `keep` entries. */
const offences = (value: unknown, at: string, keep = Infinity): string[] => {
  if (Array.isArray(value)) return [...(value.length > keep ? [`${at}: ${value.length} entries`] : []), ...value.flatMap((inner, i) => offences(inner, `${at}[${i}]`, keep))];
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, inner]) => [...(key === "native" || key === "icon" ? [`${at}.${key}`] : []), ...offences(inner, `${at}.${key}`, keep)]);
};

test("no native or icon key at any depth, no array past 12 entries, the stream payloads stripped too", () => {
  const dir = new URL("./fixtures/account/", import.meta.url);
  const names = readdirSync(dir).filter((name) => name.endsWith(".json"));
  assert.ok(names.length > 0, "the JSON fixtures are there");
  for (const name of names) assert.deepEqual(offences(JSON.parse(readFileSync(new URL(name, dir), "utf8")), name, 12), []);
  const data = readFileSync(new URL("stream-frames.txt", dir), "utf8").split("\n").filter((line) => line.startsWith("data:"));
  assert.ok(data.length > 0, "the stream fixture has data lines");
  assert.deepEqual(data.flatMap((line, i) => offences(JSON.parse(line.slice("data:".length)), `stream data line ${i + 1}`)), []);
});
