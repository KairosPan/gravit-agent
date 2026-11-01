import { describe, expect, it } from "vitest";
import { IFIND_DEADLINE_MS, TOKEN_TTL_MS, createIfind } from "../../src/portfolio/live/cn-ifind.js";
import type { CnHttp, CnReply } from "../../src/portfolio/live/cn-http.js";

const RT = "synthetic-refresh-token", AT = "synthetic-access-token";
const Q = "A股 2026年10月30日涨跌幅 成交额 主力资金流向 所属概念";
const json = (o: unknown, status = 200): CnReply => ({ status, bytes: new TextEncoder().encode(JSON.stringify(o)), contentType: "application/json" });
const text = (r: CnReply) => new TextDecoder().decode(r.bytes);

interface Call { path: string; headers: Record<string, string>; body: string | undefined; timeoutMs: number; maxBytes: number }
function rig(script: Array<CnReply | Error>, tick0 = 0) {
  const tick = { v: tick0 };
  const calls: Call[] = [];
  const clock = { t: 1_000_000 };
  const http: CnHttp = async (url, init) => {
    calls.push({ path: new URL(url).pathname, headers: init.headers ?? {}, body: init.body, timeoutMs: init.timeoutMs, maxBytes: init.maxBytes });
    clock.t += tick.v;
    const next = script.shift();
    if (!next) throw new Error("script exhausted");
    if (next instanceof Error) throw next;
    return next;
  };
  return { calls, clock, tick, http, now: () => clock.t };
}
const paths = (c: Call[]) => c.map((x) => x.path.replace("/api/v1/", ""));

describe("createIfind", () => {
  it("no token is unconfigured, and nothing is asked", async () => {
    const r = rig([]);
    const i = createIfind({ env: () => ({}), http: r.http, now: r.now });
    expect(i.configured()).toBe(false);
    expect(await i.ask(Q)).toEqual({ kind: "refused", word: "unconfigured" });
    expect(r.calls).toHaveLength(0);
  });

  it("a refresh token is exchanged once, then the query asked with the access token", async () => {
    const reply = json({ errorcode: 0, tables: [{ table: {} }] });
    const r = rig([json({ errorcode: 0, data: { access_token: AT } }), reply]);
    const i = createIfind({ env: () => ({ IFIND_REFRESH_TOKEN: RT }), http: r.http, now: r.now });
    expect(i.configured()).toBe(true);
    const a = await i.ask(Q);
    expect(paths(r.calls)).toEqual(["get_access_token", "smart_stock_picking"]);
    expect(r.calls[0]!.headers.refresh_token).toBe(RT);
    expect(r.calls[1]!.headers.access_token).toBe(AT);
    expect(r.calls[1]!.headers["Content-Type"]).toBe("application/json");
    expect(r.calls[1]!.headers.Accept).toBe("application/json");
    expect(r.calls[1]!.body).toBe('{"searchstring":"A股 2026年10月30日涨跌幅 成交额 主力资金流向 所属概念","searchtype":"stock"}');
    expect(r.calls[1]!.maxBytes).toBe(4 * 1024 * 1024);
    expect(a).toEqual({ kind: "upstream", status: 200, contentType: "application/json", bytes: reply.bytes });
  });

  it("the access token is cached for six days", async () => {
    const ok = () => json({ errorcode: 0 });
    const r = rig([json({ errorcode: 0, data: { access_token: AT } }), ok(), ok(), json({ errorcode: 0, data: { access_token: "second" } }), ok()]);
    const i = createIfind({ env: () => ({ IFIND_REFRESH_TOKEN: RT }), http: r.http, now: r.now });
    await i.ask(Q);
    await i.ask(Q);
    expect(paths(r.calls)).toEqual(["get_access_token", "smart_stock_picking", "smart_stock_picking"]);
    r.clock.t += TOKEN_TTL_MS + 1;
    await i.ask(Q);
    expect(paths(r.calls).slice(3)).toEqual(["get_access_token", "smart_stock_picking"]);
    expect(r.calls[4]!.headers.access_token).toBe("second");
  });

  it("a cached token answered nonzero is exchanged once and asked once more", async () => {
    const good = json({ errorcode: 0, tables: [] });
    const r = rig([json({ errorcode: 0, data: { access_token: AT } }), json({ errorcode: 0 }), json({ errorcode: -1010 }), json({ errorcode: 0, data: { access_token: "fresh" } }), good]);
    const i = createIfind({ env: () => ({ IFIND_REFRESH_TOKEN: RT }), http: r.http, now: r.now });
    await i.ask(Q);
    r.calls.length = 0;
    const a = await i.ask(Q);
    expect(paths(r.calls)).toEqual(["smart_stock_picking", "get_access_token", "smart_stock_picking"]);
    expect(r.calls[2]!.headers.access_token).toBe("fresh");
    expect(a).toMatchObject({ kind: "upstream", bytes: good.bytes });
  });

  it("the retry's own refusal is answered unchanged, not retried again", async () => {
    const last = json({ errorcode: -1011 });
    const r = rig([json({ errorcode: 0, data: { access_token: AT } }), json({ errorcode: 0 }), json({ errorcode: -1010 }), json({ errorcode: 0, data: { access_token: "fresh" } }), last]);
    const i = createIfind({ env: () => ({ IFIND_REFRESH_TOKEN: RT }), http: r.http, now: r.now });
    await i.ask(Q);
    r.calls.length = 0;
    const a = await i.ask(Q);
    expect(r.calls).toHaveLength(3);
    expect(a).toMatchObject({ kind: "upstream", bytes: last.bytes });
  });

  it("a freshly exchanged token answered nonzero is not exchanged again", async () => {
    const bad = json({ errorcode: -1010 });
    const r = rig([json({ errorcode: 0, data: { access_token: AT } }), bad]);
    const i = createIfind({ env: () => ({ IFIND_REFRESH_TOKEN: RT }), http: r.http, now: r.now });
    const a = await i.ask(Q);
    expect(paths(r.calls)).toEqual(["get_access_token", "smart_stock_picking"]);
    expect(a).toMatchObject({ kind: "upstream", bytes: bad.bytes });
  });

  it("a bare IFIND_ACCESS_TOKEN is never exchanged", async () => {
    const bad = json({ errorcode: -1010 });
    const r = rig([bad]);
    const i = createIfind({ env: () => ({ IFIND_ACCESS_TOKEN: AT, IFIND_REFRESH_TOKEN: RT }), http: r.http, now: r.now });
    const a = await i.ask(Q);
    expect(paths(r.calls)).toEqual(["smart_stock_picking"]);
    expect(r.calls[0]!.headers.access_token).toBe(AT);
    expect(a).toMatchObject({ kind: "upstream", bytes: bad.bytes });
  });

  it("a 401 on the cached token re-exchanges like a nonzero errorcode", async () => {
    const good = json({ errorcode: 0 });
    const r = rig([json({ errorcode: 0, data: { access_token: AT } }), json({ errorcode: 0 }), { status: 401, bytes: new Uint8Array() }, json({ errorcode: 0, data: { access_token: "fresh" } }), good]);
    const i = createIfind({ env: () => ({ IFIND_REFRESH_TOKEN: RT }), http: r.http, now: r.now });
    await i.ask(Q);
    r.calls.length = 0;
    const a = await i.ask(Q);
    expect(paths(r.calls)).toEqual(["smart_stock_picking", "get_access_token", "smart_stock_picking"]);
    expect(a).toMatchObject({ kind: "upstream", status: 200 });
  });

  it("an exchange refused is credential", async () => {
    for (const reply of [json({ errorcode: -1302 }), json({ errorcode: 0, data: {} }), json({ errorcode: 0, data: { access_token: AT } }, 403)]) {
      const r = rig([reply]);
      const i = createIfind({ env: () => ({ IFIND_REFRESH_TOKEN: RT }), http: r.http, now: r.now });
      expect(await i.ask(Q)).toEqual({ kind: "refused", word: "credential" });
      expect(paths(r.calls)).toEqual(["get_access_token"]);
    }
  });

  it("the whole ask is bounded by 15 s", async () => {
    const r = rig([json({ errorcode: 0, data: { access_token: AT } }), json({ errorcode: 0 }), json({ errorcode: -1010 }), json({ errorcode: 0, data: { access_token: "fresh" } }), json({ errorcode: 0 })]);
    const i = createIfind({ env: () => ({ IFIND_REFRESH_TOKEN: RT }), http: r.http, now: r.now });
    await i.ask(Q); // the token is now cached
    r.calls.length = 0;
    r.tick.v = 10_000;
    expect(await i.ask(Q)).toEqual({ kind: "refused", word: "timeout" });
    expect(r.calls).toHaveLength(2); // the query, then the exchange; the second query is never made
    expect(r.calls[0]!.timeoutMs).toBe(IFIND_DEADLINE_MS);
    expect(r.calls[1]!.timeoutMs).toBe(5_000);
  });

  it("timeouts and sizes are words; nothing carries a token", async () => {
    const cases: Array<[Error, string]> = [[new Error("timeout"), "timeout"], [new Error("too-large"), "too-large"], [new TypeError("fetch failed " + RT), "unreachable"]];
    for (const [err, word] of cases) {
      const r = rig([err]);
      const i = createIfind({ env: () => ({ IFIND_ACCESS_TOKEN: AT, IFIND_REFRESH_TOKEN: RT }), http: r.http, now: r.now });
      const a = await i.ask(Q);
      expect(a).toEqual({ kind: "refused", word });
      expect(JSON.stringify(a)).not.toContain(AT);
      expect(JSON.stringify(a)).not.toContain(RT);
    }
  });
});
