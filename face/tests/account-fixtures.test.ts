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

/** The owner's signed fields of a live order, in the order signed (owner-path map §3), then the nonce. */
const LIVE_ORDER_FIELDS = [
  "venue", "symbol", "side", "orderType", "qty", "limitPrice", "stopPrice", "tif", "postOnly", "reduceOnly", "extendedHours",
  "trailPercent", "trailPrice", "takeProfit", "stopLoss", "maxNotional", "deadline", "nonce",
];

test("the stage-2 fixtures carry what the views read", () => {
  const v = fx("venues");
  assert.equal(v.ok, true); assert.ok(v.venues.length > 12, "every connector judged, not the first twelve");
  assert.ok(v.venues.every((r: any) => typeof r.connector === "string" && typeof r.name === "string" && typeof r.group === "string"
    && typeof r.needs === "string" && typeof r.verdict === "string" && typeof r.connected === "boolean"));
  assert.ok(new Set(v.venues.map((r: any) => r.group)).size > 1, "more than the exchanges");
  const b = fx("paper-books"); assert.equal(b.ok, true); assert.ok(Array.isArray(b.books));
  const k = fx("keyfile");
  assert.equal(k.ok, true); assert.equal(typeof k.ready, "boolean"); assert.equal(typeof k.path, "string"); assert.equal(typeof k.message, "string");
  assert.ok(Array.isArray(k.fields) && k.fields.every((f: unknown) => typeof f === "string"), "field names only");

  const o = fx("prepared-order");
  assert.equal(o.ok, true); assert.equal(o.primaryType, "AccountTransaction:LiveOrder"); assert.equal(typeof o.domain?.chainId, "number");
  assert.equal(o.shown.length, 18); assert.deepEqual(o.shown.map((line: any) => line.name), LIVE_ORDER_FIELDS);
  assert.ok(o.shown.every((line: any) => typeof line.value === "string"));
  assert.equal(o.action.type, "liveOrder"); assert.ok(Number.isSafeInteger(o.action.deadline)); assert.ok(Number.isSafeInteger(o.action.nonce));
  assert.equal(typeof o.quote.order.words, "string"); assert.equal(typeof o.quote.order.notionalUsd, "number"); assert.equal(typeof o.quote.order.maxUsd, "number");
  const w = fx("prepared-watch");
  assert.equal(w.ok, true); assert.equal(w.action.type, "setWatch"); assert.ok(Number.isSafeInteger(w.action.nonce));
  assert.deepEqual(w.shown.map((line: any) => line.name), ["venue", "symbol", "on", "nonce"]); assert.equal(w.action.deadline, undefined);
  const c = fx("prepared-card");
  assert.equal(c.ok, true); assert.equal(c.primaryType, "AccountApproval:Card"); assert.equal(c.action.decision, "approve");
  assert.match(c.action.card, /^card-\d+$/); assert.match(c.action.action, /^0x[0-9a-f]{64}$/);
  assert.deepEqual(c.shown.map((line: any) => line.name), ["card", "action", "decision", "nonce"]);
});

/** The fixtures whose arrays are kept whole: every connector the Account judges, every field an owner signs. */
const WHOLE = /^(venues|prepared-.+)\.json$/;

/** Where `value` carries a `native` or `icon` key, at any depth, and an array past `keep` entries. */
const offences = (value: unknown, at: string, keep = Infinity): string[] => {
  if (Array.isArray(value)) return [...(value.length > keep ? [`${at}: ${value.length} entries`] : []), ...value.flatMap((inner, i) => offences(inner, `${at}[${i}]`, keep))];
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, inner]) => [...(key === "native" || key === "icon" ? [`${at}.${key}`] : []), ...offences(inner, `${at}.${key}`, keep)]);
};

test("no native or icon key at any depth, no array past 12 entries but in venues and a prepared action, the stream payloads stripped too", () => {
  const dir = new URL("./fixtures/account/", import.meta.url);
  const names = readdirSync(dir).filter((name) => name.endsWith(".json"));
  assert.ok(names.length > 0, "the JSON fixtures are there");
  assert.deepEqual(names.filter((name) => WHOLE.test(name)).sort(), ["prepared-card.json", "prepared-order.json", "prepared-watch.json", "venues.json"]);
  for (const name of names) assert.deepEqual(offences(JSON.parse(readFileSync(new URL(name, dir), "utf8")), name, WHOLE.test(name) ? Infinity : 12), []);
  const data = readFileSync(new URL("stream-frames.txt", dir), "utf8").split("\n").filter((line) => line.startsWith("data:"));
  assert.ok(data.length > 0, "the stream fixture has data lines");
  assert.deepEqual(data.flatMap((line, i) => offences(JSON.parse(line.slice("data:".length)), `stream data line ${i + 1}`)), []);
});
