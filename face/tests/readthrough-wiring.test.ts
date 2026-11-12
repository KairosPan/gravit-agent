import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deskFenceSymbols, readThroughLane, readThroughPrices, usSessionOn, wireReadThrough } from "../src/readthrough.ts";

const at = (iso: string) => Date.parse(iso);
const quote = (symbol: string, over: object = {}) => ({
  id: `us:${symbol}`, market: "us", symbol, price: 100, prev_close: 107.9, change: -7.9, change_pct: -7.3, volume: null, as_of: "2026-11-09T09:03:10.000Z",
  received_at: null, volume_as_of: null, source: "market", feed: "robinhood", basis: "previous_close", quote_status: "live", market_status: "unknown", message: "", ...over,
});

test("prices are asked as US shares in the order given and keep a null change beside a price", async () => {
  const asked: unknown[] = [];
  const prices = readThroughPrices({ snapshot: async (assets) => { asked.push(assets); return { ok: true, generated_at: "", quotes: [quote("NVDA"), quote("AMD", { change_pct: null })], providers: [] } as never; } });
  assert.deepEqual(await prices(["NVDA", "AMD"]), [
    { symbol: "NVDA", price: 100, changePct: -7.3, feed: "robinhood", asOf: "2026-11-09T09:03:10.000Z" },
    { symbol: "AMD", price: 100, changePct: null, feed: "robinhood", asOf: "2026-11-09T09:03:10.000Z" },
  ]);
  assert.deepEqual((asked[0] as { market: string; symbol: string }[]).map((a) => [a.market, a.symbol]), [["us", "NVDA"], ["us", "AMD"]]);
  await assert.rejects(readThroughPrices({ unavailable: "no quote source is wired", snapshot: async () => { throw new Error("unused"); } })(["NVDA"]), /no quote source is wired/);
});

test("the desk's symbols: the US names of its three files, never a strategy's levels", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "readthrough-wiring-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "desk"), { recursive: true });
  await mkdir(join(root, "strategies", "s1"), { recursive: true });
  await writeFile(join(root, "desk", "rules.yml"), "- id: watch-nvda\n  kind: move_pct\n  symbols: [NVDA, '600519']\n  move_pct: 5\n- id: index-move\n  kind: move_pct\n  symbols: [SPY]\n  move_pct: 1.5\n");
  await writeFile(join(root, "desk", "holdings.yml"), "- symbol: CRWV\n  qty: 10\n  avg_cost: 90\n");
  await writeFile(join(root, "strategies", "s1", "levels.yml"), "- symbol: NBIS\n  kind: watch\n  price: 50\n  when: cross_up\n  plan: look\n  expires: 2027-01-01\n");
  assert.deepEqual(await deskFenceSymbols(root, "2026-11-09"), ["CRWV", "NVDA", "SPY"]);
  assert.deepEqual(await deskFenceSymbols(join(root, "nowhere"), "2026-11-09"), []);
});

test("a US session is on from 04:00 to 20:00 ET on a session day, to 17:00 on an early close", () => {
  for (const [iso, on] of [
    ["2026-11-09T08:59:59Z", false], ["2026-11-09T09:00:00Z", true], ["2026-11-10T00:59:59Z", true], ["2026-11-10T01:00:00Z", false],
    ["2026-11-08T17:00:00Z", false],   // Sunday
    ["2026-11-26T17:00:00Z", false],   // Thanksgiving
    ["2026-11-27T21:59:59Z", true], ["2026-11-27T22:00:00Z", false],   // the early close: 17:00 ET
  ] as const) assert.equal(usSessionOn(at(iso)), on, iso);
});

test("the lane reads the service at each call and is inert without one", async () => {
  const services: Record<string, unknown> = {};
  const lane = readThroughLane({ get: (key) => services[key] });
  assert.deepEqual([lane.ready(), lane.close("s"), await lane.given("NVDA", "2026-11-06"), await lane.later([{ symbol: "NVDA", ref: "2026-11-06" }])], [false, [], false, []]);
  lane.open("s", { pass: "p", asks: [] }); await lane.sent(["rt-20261109-0000aaaa"], true);   // no throw
  services.readThrough = { ready: () => true, open() {}, close: () => [{ id: "i", text: "t" }], given: async () => true, later: async () => ["l"], sent: async () => {} };
  assert.deepEqual([lane.ready(), lane.close("s"), await lane.given("NVDA", "2026-11-06"), await lane.later([])], [true, [{ id: "i", text: "t" }], true, ["l"]]);
});

test("wireReadThrough wires the service through inject, each time it is provided", async () => {
  const wired: any[] = [];
  let provide: ((layer: unknown) => void) | undefined;
  wireReadThrough({ inject: (deps, callback) => { assert.deepEqual(deps, ["readThrough"]); provide = callback; } },
    { quotes: { snapshot: async () => ({ ok: true, generated_at: "", quotes: [quote("NVDA")], providers: [] }) as never }, root: "/nowhere", now: () => at("2026-11-09T09:03:00Z") });
  provide!({ readThrough: { wire: (deps: unknown) => { wired.push(deps); } } });
  provide!({ readThrough: { wire: (deps: unknown) => { wired.push(deps); } } });   // the row reloaded
  assert.equal(wired.length, 2);
  assert.deepEqual(Object.keys(wired[0]).sort(), ["deskSymbols", "prices", "usSessionOn"]);
  assert.deepEqual([wired[0].usSessionOn(), await wired[0].deskSymbols()], [true, []]);
  assert.equal((await wired[0].prices(["NVDA"]))[0].changePct, -7.3);
});
