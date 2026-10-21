/** `/data/seat.json` (spec 2026-10-20 §5.4): the Account's `GET /api/account`
 * reduced to the seat's standing for the screen — the pure view and the
 * route (the fence, the cache, `?fresh=1`, the abort, the failure words). */
import test from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { WebRoute } from "@deepseek-ai/dsh-host-webserver";
import { SEAT_TIMEOUT_MS, SEAT_TTL_MS, registerSeatRoute, seatView, type SeatView } from "../src/seat.ts";

const URL_ = "http://127.0.0.1:4820";
const NOW = 1_760_000_000_000;

/** The Account's times are ISO strings (`exchange.ts:1488` at 133b9a7), never numbers. */
const UNTIL = "2026-11-19T00:00:00.000Z";

/** An `/api/account` body as the Account answers it at 133b9a7, with the seat admitted. */
function account(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ok: true, real: true, mode: "guard",
    keys: [{ address: "0xab12", name: "Gravit", code: "GRV", validUntil: UNTIL, approvedAt: "2026-10-20T10:00:00Z", status: "ok" }],
    requests: [],
    spend: [
      { id: "lim-1", agent: "0xab12", agentName: "Gravit", scope: "trade", allow: ["paper-1"], perPaymentUsd: 100, budgetUsd: 1000, spentUsd: 100, reservedUsd: 50, windowHours: 0, validUntil: UNTIL, expired: false },
      { id: "lim-2", agent: "0xcd34", agentName: "Desk", scope: "trade", allow: ["ex"], perPaymentUsd: 150, budgetUsd: 600, spentUsd: 0, reservedUsd: 0, windowHours: 0, validUntil: UNTIL, expired: false },
    ],
    venues: [
      { id: "paper-1", name: "Paper account · paper", connector: "live:paper", paper: true, usd: 10_000, frontLine: "$10,000 of paper money" },
      { id: "okx", name: "OKX", connector: "live:okx", usd: 0, stale: true, notServed: { said: "OKX does not serve this location" } },
    ],
    cards: [
      { id: "card-7", flight: "GRV-0007", usd: 56, reason: "Gravit asks to PAPER · buy 1 AAPL at paper-1", agent: "0xab12", agentName: "Gravit", expiresAt: "2026-10-20T11:00:00Z" },
      { id: "card-8", flight: "DSK-0003", usd: 20, reason: "Desk asks …", agent: "0xcd34", agentName: "Desk" },
    ],
    connectLive: { writes: { on: true, capUsd: 100 } },
    modeRules: { rows: [], cardMinutes: 30 },
    ...over,
  };
}

test("seatView: admitted — the key by name, its limit with what is left, the paper venue marked, this seat's cards and the others' count", () => {
  const v = seatView(account(), "Gravit", URL_, NOW);
  assert.equal(v.ok, true); assert.equal(v.reachable, true); assert.equal(v.url, URL_);
  assert.equal(v.asOf, new Date(NOW).toISOString());
  assert.equal(v.mode, "guard"); assert.deepEqual(v.writes, { on: true, capUsd: 100 }); assert.equal(v.cardMinutes, 30);
  assert.equal(v.seat?.status, "admitted"); assert.equal(v.seat?.name, "Gravit"); assert.equal(v.seat?.address, "0xab12");
  assert.equal(v.seat?.validUntil, Date.parse(UNTIL), "the Account's ISO time becomes the box's milliseconds");
  assert.equal(v.seat?.limits.length, 1, "the Desk's limit is not the seat's");
  assert.deepEqual(v.seat?.limits[0], { scope: "trade", allow: ["paper-1"], perOrderUsd: 100, budgetUsd: 1000, spentUsd: 100, reservedUsd: 50, leftUsd: 850, validUntil: Date.parse(UNTIL), expired: false });
  assert.equal(seatView(account({ keys: [{ address: "0xab12", name: "Gravit", status: "ok", validUntil: 1_800_000_000_000 }] }), "Gravit", URL_, NOW).seat?.validUntil, 1_800_000_000_000, "a number is taken as it is");
  assert.deepEqual(v.venues?.map((x) => [x.id, x.paper, x.usd]), [["paper-1", true, 10_000], ["okx", false, 0]]);
  assert.equal(v.venues?.[0].frontLine, "$10,000 of paper money");
  assert.equal(v.venues?.[1].stale, true); assert.equal(v.venues?.[1].notServed, "OKX does not serve this location");
  assert.deepEqual(v.cards, [{ id: "card-7", usd: 56, reason: "Gravit asks to PAPER · buy 1 AAPL at paper-1", expiresAt: "2026-10-20T11:00:00Z" }]);
  assert.equal(v.others, 1);
});

test("seatView: knocking, expired, revoked, and a seat admitted under another name is absent; the match ignores case", () => {
  const knocking = seatView(account({ keys: [], requests: [{ address: "0xab12", name: "Gravit", at: "2026-10-20T10:00:00Z" }] }), "Gravit", URL_, NOW);
  assert.equal(knocking.seat?.status, "knocking"); assert.equal(knocking.seat?.address, undefined);
  assert.equal(seatView(account({ keys: [{ address: "0x1", name: "gravit", status: "expired" }] }), "Gravit", URL_, NOW).seat?.status, "expired");
  assert.equal(seatView(account({ keys: [{ address: "0x1", name: "GRAVIT", status: "revoked" }] }), "Gravit", URL_, NOW).seat?.status, "revoked");
  const other = seatView(account({ keys: [{ address: "0x1", name: "gravit-2", status: "ok" }], cards: [], spend: [] }), "Gravit", URL_, NOW);
  assert.equal(other.seat?.status, "absent"); assert.deepEqual(other.seat?.limits, []); assert.deepEqual(other.cards, []);
});

/* The final review's Important 4 and 5: the Account keeps retired keys in `keys[]` and appends the new one when a key is
 * re-admitted under the same name, so the standing is the best of the name's keys — ok, then knocking, then expired, then
 * revoked — and the limits and cards are that key's, by address; a status the face does not know is `unknown`, never
 * admitted. */
test("seatView: a re-admitted seat is admitted on its new key, its limits and cards by that key's address; the best of a name's keys wins", () => {
  const keys = [
    { address: "0xold", name: "Gravit", status: "revoked", validUntil: UNTIL },
    { address: "0xnew", name: "Gravit", status: "ok", validUntil: UNTIL },
  ];
  const spend = [
    { id: "lim-old", agent: "0xold", agentName: "Gravit", scope: "trade", allow: ["ex"], perPaymentUsd: 1, budgetUsd: 1, spentUsd: 0, reservedUsd: 0, validUntil: UNTIL, expired: false },
    { id: "lim-new", agent: "0xnew", agentName: "Gravit", scope: "trade", allow: ["paper-1"], perPaymentUsd: 25, budgetUsd: 100, spentUsd: 0, reservedUsd: 0, validUntil: UNTIL, expired: false },
  ];
  const cards = [{ id: "card-old", agent: "0xold", agentName: "Gravit", usd: 1 }, { id: "card-new", agent: "0xnew", agentName: "Gravit", usd: 9 }, { id: "card-desk", agent: "0xcd34", agentName: "Desk", usd: 2 }];
  const v = seatView(account({ keys, spend, cards }), "Gravit", URL_, NOW);
  assert.equal(v.seat?.status, "admitted"); assert.equal(v.seat?.address, "0xnew");
  assert.deepEqual(v.seat?.limits.map((l) => l.allow), [["paper-1"]], "the retired key's limit is not the seat's");
  assert.deepEqual(v.cards?.map((c) => c.id), ["card-new"]); assert.equal(v.others, 2);
  const knocking = seatView(account({ keys: [keys[0]], requests: [{ address: "0xnew", name: "Gravit", at: "2026-10-20T10:00:00Z" }], spend: [], cards: [] }), "Gravit", URL_, NOW);
  assert.equal(knocking.seat?.status, "knocking", "a new key knocking beside a revoked one is knocking");
  assert.equal(seatView(account({ keys: [keys[0], { address: "0xmid", name: "Gravit", status: "expired" }], spend: [], cards: [] }), "Gravit", URL_, NOW).seat?.status, "expired");
  assert.equal(seatView(account({ keys: [keys[0]], spend: [], cards: [] }), "Gravit", URL_, NOW).seat?.status, "revoked");
  for (const status of ["suspended", undefined, 7, "unknown"]) {
    const odd = seatView(account({ keys: [{ address: "0x9", name: "Gravit", status }], spend: [], cards: [] }), "Gravit", URL_, NOW);
    assert.equal(odd.seat?.status, "unknown", `status ${String(status)} is not admitted`);
    assert.equal(odd.seat?.address, "0x9");
  }
});

test("seatView: an odd shape never throws — empty lists, absent, no mode", () => {
  for (const odd of [{}, null, undefined, "x", [], { keys: "x", requests: 3, spend: null, venues: [null, 1, "v"], cards: { id: 1 }, connectLive: "no", modeRules: [], mode: "beast" }]) {
    const v = seatView(odd, "Gravit", URL_, NOW);
    assert.equal(v.ok, true); assert.equal(v.reachable, true);
    assert.equal(v.seat?.status, "absent"); assert.deepEqual(v.seat?.limits, []);
    assert.deepEqual(v.venues, []); assert.deepEqual(v.cards, []); assert.equal(v.others, 0);
    assert.equal(v.mode, undefined); assert.deepEqual(v.writes, { on: false, capUsd: null }); assert.equal(v.cardMinutes, undefined);
  }
  const partial = seatView({ keys: [{ address: "0xp", name: "Gravit", status: "ok" }], venues: [{ id: "p", paper: true }, { name: "no id" }], spend: [{ agent: "0xP", agentName: "Gravit", scope: "trade", allow: "paper-1,ex", budgetUsd: "nope" }] }, "Gravit", URL_, NOW);
  assert.deepEqual(partial.venues?.map((x) => [x.id, x.name, x.paper, x.usd]), [["p", "p", true, null], ["", "no id", false, null]]);
  assert.deepEqual(partial.seat?.limits[0].allow, ["paper-1", "ex"], "a comma-joined allow reads as a list");
  assert.equal(partial.seat?.limits[0].leftUsd, null, "no budget, nothing left to compute");
});

/* --- the route --------------------------------------------------------------- */

function fakeRes(): { out: { status: number; body: string; headers: Record<string, string> }; res: ServerResponse } {
  const out = { status: 0, body: "", headers: {} as Record<string, string> };
  const res = {
    writeHead(status: number, headers?: Record<string, string>) { out.status = status; Object.assign(out.headers, headers ?? {}); return res; },
    end(body?: string | Buffer) { out.body = String(body ?? ""); return res; },
  };
  return { out, res: res as unknown as ServerResponse };
}

const req = (url = "/data/seat.json", headers: Record<string, string> = { host: "127.0.0.1:3090" }): IncomingMessage =>
  ({ url, headers } as unknown as IncomingMessage);

type FakeFetch = (url: string, init: { signal: AbortSignal; redirect: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Register with a fake fetch and clock; return the one route. */
function routeWith(doFetch: FakeFetch, now: () => number, timeoutMs?: number): { route: WebRoute; fetched: string[] } {
  const routes: WebRoute[] = [];
  const fetched: string[] = [];
  const spy: FakeFetch = (url, init) => { fetched.push(url); return doFetch(url, init); };
  registerSeatRoute({ register: (route) => routes.push(route) }, { url: URL_, seatName: "Gravit", fetch: spy as unknown as typeof fetch, now, ...(timeoutMs === undefined ? {} : { timeoutMs }) });
  assert.equal(routes.length, 1);
  assert.equal(`${routes[0].kind} ${routes[0].path}`, "exact /data/seat.json");
  return { route: routes[0], fetched };
}

async function call(route: WebRoute, r: IncomingMessage = req()): Promise<{ status: number; body: string; headers: Record<string, string>; json: SeatView }> {
  const { out, res } = fakeRes();
  await route.handler(r, res);
  let json: SeatView = { ok: true, url: "", reachable: false };
  try { json = JSON.parse(out.body) as SeatView; } catch { /* a refusal body */ }
  return { ...out, json };
}

const answering = (body: unknown, status = 200): FakeFetch => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test("the route: a good read is the view with the content type; the fence refuses a foreign Origin with the fixed body", async () => {
  const { route, fetched } = routeWith(answering(account()), () => NOW);
  const a = await call(route);
  assert.equal(a.status, 200); assert.equal(a.headers["content-type"], "application/json; charset=utf-8");
  assert.equal(a.json.reachable, true); assert.equal(a.json.seat?.status, "admitted");
  assert.deepEqual(fetched, [`${URL_}/api/account`]);
  const foreign = await call(route, req("/data/seat.json", { host: "127.0.0.1:3090", origin: "https://evil.example" }));
  assert.equal(foreign.status, 403); assert.equal(foreign.body, '{"ok":false,"error":"forbidden"}');
  const noHost = await call(route, req("/data/seat.json", {}));
  assert.equal(noHost.status, 403);
  assert.equal(fetched.length, 1, "a refused request never reaches the Account");
});

test("the route: two reads within the TTL fetch once; ?fresh=1 fetches again; the TTL expires", async () => {
  let clock = NOW;
  const { route, fetched } = routeWith(answering(account()), () => clock);
  await call(route); await call(route);
  assert.equal(fetched.length, 1);
  await call(route, req("/data/seat.json?fresh=1"));
  assert.equal(fetched.length, 2);
  clock += SEAT_TTL_MS + 1;
  await call(route);
  assert.equal(fetched.length, 3);
});

test("the route: concurrent reads share one fetch", async () => {
  let release!: (v: { ok: boolean; status: number; json(): Promise<unknown> }) => void;
  const gate = new Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>((r) => { release = r; });
  const { route, fetched } = routeWith(() => gate, () => NOW);
  const a = fakeRes(); const b = fakeRes();
  const p = Promise.all([route.handler(req(), a.res), route.handler(req(), b.res)]);
  release({ ok: true, status: 200, json: async () => account() });
  await p;
  assert.equal(fetched.length, 1);
  assert.equal((JSON.parse(a.out.body) as SeatView).seat?.status, "admitted");
  assert.equal((JSON.parse(b.out.body) as SeatView).seat?.status, "admitted");
});

test("the route: an unreachable service answers reachable:false with the failure's code, never its text", async () => {
  const { route } = routeWith(async () => { throw Object.assign(new TypeError("fetch failed secret-host-name"), { cause: { code: "ECONNREFUSED" } }); }, () => NOW);
  const a = await call(route);
  assert.equal(a.status, 200);
  assert.deepEqual(a.json, { ok: true, url: URL_, reachable: false, error: "ECONNREFUSED" });
  assert.doesNotMatch(a.body, /secret/);
  const bare = routeWith(async () => { throw new Error("something private"); }, () => NOW);
  assert.equal((await call(bare.route)).json.error, "unreachable");
  assert.doesNotMatch((await call(bare.route)).body, /private/);
});

test("the route: a hanging service is cut at the timeout", async () => {
  const hanging: FakeFetch = (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
  });
  const { route } = routeWith(hanging, () => NOW, 20);
  const a = await call(route);
  assert.deepEqual(a.json, { ok: true, url: URL_, reachable: false, error: "timeout" });
  assert.ok(SEAT_TIMEOUT_MS >= 5_000, "the real timeout gives the Account its settle time");
});

test("the route: a 403 or a 500 says http <status>; unparsable JSON says unreadable; a redirect is an error", async () => {
  assert.equal((await call(routeWith(answering({}, 403), () => NOW).route)).json.error, "http 403");
  assert.equal((await call(routeWith(answering({}, 500), () => NOW).route)).json.error, "http 500");
  const bad: FakeFetch = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token"); } });
  assert.equal((await call(routeWith(bad, () => NOW).route)).json.error, "unreadable");
  let seen: { redirect: string } | undefined;
  const spy: FakeFetch = async (_url, init) => { seen = init; return { ok: true, status: 200, json: async () => account() }; };
  await call(routeWith(spy, () => NOW).route);
  assert.equal(seen?.redirect, "error");
});
