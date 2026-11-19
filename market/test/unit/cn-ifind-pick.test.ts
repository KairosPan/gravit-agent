import { describe, expect, it } from "vitest";
import { createIfind } from "../../src/live/cn-ifind.js";
import type { CnHttp, CnReply } from "../../src/live/cn-http.js";

const RT = "synthetic-refresh-token", AT = "synthetic-access-token";
const json = (o: unknown, status = 200): CnReply => ({ status, bytes: new TextEncoder().encode(JSON.stringify(o)), contentType: "application/json" });

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
const tokenReply = (t = AT) => json({ errorcode: 0, data: { access_token: t } });

describe("createIfind pick", () => {
  it("passes the searchstring and searchtype as given", async () => {
    const r = rig([tokenReply(), json({ errorcode: 0 })]);
    const i = createIfind({ env: () => ({ IFIND_REFRESH_TOKEN: RT }), http: r.http, now: r.now });
    const out = await i.pick('近一年收益率 "前20"', "fund", 30_000);
    expect(JSON.parse(r.calls[1]!.body!)).toEqual({ searchstring: '近一年收益率 "前20"', searchtype: "fund" });
    expect(out.asked).toBe(1);
    expect(out.answer.kind).toBe("upstream");
  });

  it("counts a stale cached token's retry as a second call", async () => {
    const r = rig([tokenReply(), json({ errorcode: 0 }), json({ errorcode: -1010 }), tokenReply("fresh"), json({ errorcode: 0 })]);
    const i = createIfind({ env: () => ({ IFIND_REFRESH_TOKEN: RT }), http: r.http, now: r.now });
    await i.pick("q", "stock", 30_000);
    r.calls.length = 0;
    const out = await i.pick("q", "stock", 30_000);
    expect(paths(r.calls)).toEqual(["smart_stock_picking", "get_access_token", "smart_stock_picking"]);
    expect(out.asked).toBe(2);
  });

  it("is bounded by its own deadline", async () => {
    const r = rig([tokenReply(), json({ errorcode: 0 }), json({ errorcode: -1010 }), tokenReply("fresh")], 0);
    const i = createIfind({ env: () => ({ IFIND_REFRESH_TOKEN: RT }), http: r.http, now: r.now });
    await i.pick("q", "stock", 30_000);
    r.calls.length = 0;
    r.tick.v = 20_000;
    const out = await i.pick("q", "stock", 30_000);
    // the first call at 0 s, the re-exchange at 20 s (past the old 15 s bound), the second query at 40 s is refused
    expect(out.answer).toEqual({ kind: "refused", word: "timeout" });
    expect(paths(r.calls)).toEqual(["smart_stock_picking", "get_access_token"]);
    expect(out.asked).toBe(1);
  });

  it("asks nothing when unconfigured", async () => {
    const r = rig([]);
    const i = createIfind({ env: () => ({}), http: r.http, now: r.now });
    expect(await i.pick("q", "stock", 30_000)).toEqual({ answer: { kind: "refused", word: "unconfigured" }, asked: 0 });
    expect(r.calls).toHaveLength(0);
  });
});
