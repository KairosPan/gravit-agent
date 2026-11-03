// Copy of account/test/unit/cn-routes.test.ts at cb4930c4 (account split, plan A1), retargeted to the market's server: every assertion
// stays. The market has no service and no read-only mode: each server is the market's own over a core holding the stand-ins
import { request } from "node:http";
import { describe, expect, it } from "vitest";
import { RELAY_URL_MAX, type CnRelay, type RelayAnswer } from "../../src/live/cn-relay.ts";
import type { CnIfind, IfindAnswer } from "../../src/live/cn-ifind.ts";
import { createMarketCore } from "../../src/core.ts";
import { mountCn } from "../../src/routes-cn.ts";
import { startMarketServer } from "../../src/server.ts";

/** the market's server over a core holding `cn` (absent: none), the routes mounted as the main mounts them */
function startCnServer(o: { cn?: { relay: CnRelay; ifind: CnIfind }; cnQueueMs?: number; hosts?: string[] } = {}) {
  const core = createMarketCore({ cn: o.cn });
  return startMarketServer({ port: 0, hosts: o.hosts, mount: (app) => { mountCn(app, core, o.cnQueueMs !== undefined ? { cnQueueMs: o.cnQueueMs } : {}); }, close: () => core.close() });
}

const U = "https://push2delay.eastmoney.com/api/qt/clist/get?fs=m:0";
const QUERY = "A股 2026年10月30日涨跌幅 成交额 主力资金流向 所属概念";

function stubs(relayAnswer: RelayAnswer | (() => Promise<RelayAnswer>), ifindAnswer: IfindAnswer = { kind: "upstream", status: 200, contentType: "application/json", bytes: new TextEncoder().encode("{}") }) {
  const seen = { relay: [] as Array<{ url: string; headers: Record<string, string> }>, ifind: [] as string[] };
  const relay: CnRelay = async (url, headers) => { seen.relay.push({ url, headers }); return typeof relayAnswer === "function" ? relayAnswer() : relayAnswer; };
  const ifind: CnIfind = { configured: () => true, async ask(q) { seen.ifind.push(q); return ifindAnswer; } };
  return { cn: { relay, ifind }, seen };
}

describe("the relay route", () => {
  it("passes the upstream through", async () => {
    const gbk = Uint8Array.from([0xd6, 0xd0, 0xb9, 0xfa, 0x31]);
    const s = stubs({ kind: "upstream", status: 302, location: "https://push2delay.eastmoney.com/x", bytes: new Uint8Array() });
    const srv = await startCnServer({ cn: s.cn });
    try {
      const r = await fetch(`${srv.url}/api/cn/relay?url=${encodeURIComponent(U)}`, { redirect: "manual", headers: { accept: "a/b", referer: "https://x.example/", "user-agent": "ua", cookie: "secret=1" } });
      expect(r.status).toBe(302);
      expect(r.headers.get("x-cn-relay")).toBe("upstream");
      expect(r.headers.get("x-content-type-options")).toBe("nosniff");
      expect(r.headers.get("location")).toBe("https://push2delay.eastmoney.com/x");
      expect(s.seen.relay[0]!.url).toBe(U);
      expect(Object.keys(s.seen.relay[0]!.headers).sort()).toEqual(["accept", "referer", "user-agent"]);
    } finally { await srv.close(); }
    const g = stubs({ kind: "upstream", status: 200, contentType: "text/plain; charset=GBK", bytes: gbk });
    const srv2 = await startCnServer({ cn: g.cn });
    try {
      const r = await fetch(`${srv2.url}/api/cn/relay?url=${encodeURIComponent(U)}`);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toBe("text/plain; charset=GBK");
      expect(Array.from(new Uint8Array(await r.arrayBuffer()))).toEqual(Array.from(gbk));
    } finally { await srv2.close(); }
  });

  it("refusals", async () => {
    const s = stubs({ kind: "refused", word: "timeout" });
    const srv = await startCnServer({ cn: s.cn });
    try {
      const get = async (path: string) => { const r = await fetch(`${srv.url}${path}`); return { status: r.status, hdr: r.headers.get("x-cn-relay"), body: await r.json() }; };
      const enc = encodeURIComponent(U);
      for (const path of ["/api/cn/relay", `/api/cn/relay?url=${enc}&url=${enc}`, `/api/cn/relay?url=${encodeURIComponent("https://push2delay.eastmoney.com/" + "a".repeat(RELAY_URL_MAX))}`, `/api/cn/relay?url=${encodeURIComponent("https://evil.example/")}`]) {
        expect(await get(path)).toEqual({ status: 403, hdr: "refused", body: { ok: false, relay: "not-listed" } });
      }
      expect(s.seen.relay.length).toBe(0);
      expect((await get(`/api/cn/relay?url=${enc}`)).status).toBe(504);
    } finally { await srv.close(); }
    for (const [word, status] of [["too-large", 502], ["unreachable", 502]] as const) {
      const t = stubs({ kind: "refused", word });
      const sv = await startCnServer({ cn: t.cn });
      try { expect((await fetch(`${sv.url}/api/cn/relay?url=${encodeURIComponent(U)}`)).status).toBe(status); } finally { await sv.close(); }
    }
    const off = await startCnServer();
    try {
      const r = await fetch(`${off.url}/api/cn/relay?url=${encodeURIComponent(U)}`);
      expect(r.status).toBe(503);
      expect(await r.json()).toEqual({ ok: false, relay: "off" });
    } finally { await off.close(); }
  });

  it("bounds a queued request's whole wait", async () => {
    let signal: AbortSignal | undefined;
    const s = stubs(() => new Promise<RelayAnswer>(() => {}));
    const inner = s.cn.relay;
    s.cn.relay = (u, h, sg) => { signal = sg; return inner(u, h, sg); };
    const srv = await startCnServer({ cn: s.cn, cnQueueMs: 1 });
    try {
      // the minutes endpoint has the shortest limit (4 s); the wait is that plus the allowance
      const t0 = Date.now();
      const r = await fetch(`${srv.url}/api/cn/relay?url=${encodeURIComponent("https://web.ifzq.gtimg.cn/appstock/app/day/query?code=sh600000")}`);
      expect(r.status).toBe(504);
      expect(r.headers.get("x-cn-relay")).toBe("refused");
      expect(Date.now() - t0).toBeLessThan(6_000);
      expect(signal?.aborted).toBe(true); // the abandoned ask is told to leave the queue
    } finally { await srv.close(); }
  }, 10_000);
});

describe("the iFinD route", () => {
  const post = (base: string, body: string | undefined) => fetch(`${base}/api/cn/ifind`, { method: "POST", headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body }) });

  it("asks only the stand-in's query", async () => {
    const bytes = new TextEncoder().encode('{"errorcode":0}');
    const s = stubs({ kind: "refused", word: "timeout" }, { kind: "upstream", status: 200, contentType: "application/json", bytes });
    const srv = await startCnServer({ cn: s.cn });
    try {
      const r = await post(srv.url, JSON.stringify({ query: QUERY }));
      expect(r.status).toBe(200);
      expect(r.headers.get("x-cn-ifind")).toBe("upstream");
      expect(r.headers.get("content-type")).toContain("application/json");
      expect(new Uint8Array(await r.arrayBuffer())).toEqual(bytes);
      expect(s.seen.ifind).toEqual([QUERY]);
      for (const body of [JSON.stringify({ query: "A股 茅台" }), JSON.stringify({ query: 1 }), undefined, "{}", JSON.stringify({ query: QUERY + "\n" })]) {
        const x = await post(srv.url, body);
        expect(x.status).toBe(400);
        expect(x.headers.get("x-cn-ifind")).toBe("refused");
        expect(await x.json()).toEqual({ ok: false, ifind: "not-the-query" });
      }
      expect(s.seen.ifind.length).toBe(1);
    } finally { await srv.close(); }
    for (const [word, status] of [["unconfigured", 503], ["credential", 502], ["timeout", 504], ["too-large", 502], ["unreachable", 502]] as const) {
      const t = stubs({ kind: "refused", word: "timeout" }, { kind: "refused", word });
      const sv = await startCnServer({ cn: t.cn });
      try {
        const x = await post(sv.url, JSON.stringify({ query: QUERY }));
        expect(x.status).toBe(status);
        expect(await x.json()).toEqual({ ok: false, ifind: word });
      } finally { await sv.close(); }
    }
    const off = await startCnServer();
    try {
      const x = await post(off.url, JSON.stringify({ query: QUERY }));
      expect(x.status).toBe(503);
      expect(await x.json()).toEqual({ ok: false, ifind: "off" });
    } finally { await off.close(); }
  });
});

describe("both routes", () => {
  it("are behind the fence", async () => {
    const s = stubs({ kind: "upstream", status: 200, bytes: new Uint8Array() });
    const srv = await startCnServer({ cn: s.cn, hosts: ["market:4821"] });
    try {
      const evil = { origin: "https://evil.example" };
      expect((await fetch(`${srv.url}/api/cn/relay?url=${encodeURIComponent(U)}`, { headers: evil })).status).toBe(403);
      expect((await fetch(`${srv.url}/api/cn/ifind`, { method: "POST", headers: { ...evil, "content-type": "application/json" }, body: JSON.stringify({ query: QUERY }) })).status).toBe(403);
      expect(s.seen.relay.length + s.seen.ifind.length).toBe(0);
      const status = await new Promise<number>((resolve, reject) => {
        const req = request(`${srv.url}/api/cn/relay?url=${encodeURIComponent(U)}`, { headers: { host: "market:4821" } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
        req.on("error", reject); req.end();
      });
      expect(status).toBe(200);
    } finally { await srv.close(); }
  });

  it("answer on a read-only service", async () => {
    const s = stubs({ kind: "upstream", status: 200, bytes: new Uint8Array([1]) });
    const srv = await startCnServer({ cn: s.cn });
    try { expect((await fetch(`${srv.url}/api/cn/relay?url=${encodeURIComponent(U)}`)).status).toBe(200); } finally { await srv.close(); }
  });
});
