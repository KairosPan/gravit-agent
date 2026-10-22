// face/tests/account-fixtures.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
