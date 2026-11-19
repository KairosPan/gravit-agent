// POST /api/cn/wencai over a stub CnWencai: the route's status table, header, fence and pass-through; the client's own rules are cn-wencai's tests
import { describe, expect, it } from "vitest";
import type { CnIfind } from "../../src/live/cn-ifind.ts";
import type { CnRelay } from "../../src/live/cn-relay.ts";
import type { CnWencai, WencaiAnswer, WencaiOk, WencaiWord } from "../../src/live/cn-wencai.ts";
import { createMarketCore } from "../../src/core.ts";
import { mountCn } from "../../src/routes-cn.ts";
import { startMarketServer } from "../../src/server.ts";

const OK: WencaiOk = { ok: true, question: "q", type: "stock", asOf: "2026-11-19T00:00:00.000Z", columns: ["code"], rows: [["600519"]], rowCount: 1, returned: 1, truncated: false, budget: { used: 1, cap: 100, resetsAt: null } };

function wencaiStub(answer: WencaiAnswer) {
  const seen: unknown[] = [];
  const wencai: CnWencai = { async ask(req) { seen.push(req); return answer; }, budget: () => OK.budget, enabled: () => true };
  return { wencai, seen };
}
function startWith(o: { wencai?: CnWencai; cn?: boolean; ifind?: CnIfind } = {}) {
  const ifind: CnIfind = o.ifind ?? { configured: () => true, ask: async () => ({ kind: "refused", word: "unconfigured" }) };
  const relay: CnRelay = async () => ({ kind: "refused", word: "unreachable" });
  const cn = o.cn === false ? undefined : { relay, ifind, ...(o.wencai ? { wencai: o.wencai } : {}) };
  const core = createMarketCore({ cn });
  return startMarketServer({ port: 0, mount: (app) => { mountCn(app, core); }, close: () => core.close() });
}
const post = (url: string, body: string, headers: Record<string, string> = { "content-type": "application/json" }) => fetch(`${url}/api/cn/wencai`, { method: "POST", headers, body });

describe("POST /api/cn/wencai", () => {
  it("passes an ok answer through", async () => {
    const s = wencaiStub({ kind: "ok", body: OK });
    const srv = await startWith({ wencai: s.wencai });
    try {
      const r = await post(srv.url, JSON.stringify({ question: "q", type: "stock", limit: 5 }));
      expect(r.status).toBe(200);
      expect(r.headers.get("x-cn-wencai")).toBe("upstream");
      expect(r.headers.get("cache-control")).toBe("no-store");
      expect(await r.json()).toEqual(OK);
      expect(s.seen).toEqual([{ question: "q", type: "stock", limit: 5 }]);
    } finally { await srv.close(); }
  });

  it("answers each word with its status", async () => {
    const table: Array<[WencaiWord, number]> = [["bad-question", 400], ["bad-type", 400], ["off", 503], ["unconfigured", 503], ["budget", 429], ["credential", 502], ["timeout", 504], ["too-large", 502], ["unreachable", 502], ["upstream", 502]];
    for (const [word, status] of table) {
      const detail = word === "upstream" ? { errorcode: -4001, errmsg: "x" } : undefined;
      const s = wencaiStub({ kind: "refused", word, message: `m-${word}`, ...(detail ? { detail } : {}) });
      const srv = await startWith({ wencai: s.wencai });
      try {
        const r = await post(srv.url, JSON.stringify({ question: "q" }));
        expect(r.status).toBe(status);
        expect(r.headers.get("x-cn-wencai")).toBe("refused");
        expect(await r.json()).toEqual({ ok: false, wencai: word, message: `m-${word}`, ...(detail ? { detail } : {}) });
      } finally { await srv.close(); }
    }
  });

  it("answers off with no wencai on the core, or no cn at all", async () => {
    for (const o of [{}, { cn: false }]) {
      const srv = await startWith(o);
      try {
        const r = await post(srv.url, JSON.stringify({ question: "q" }));
        expect(r.status).toBe(503);
        expect(r.headers.get("x-cn-wencai")).toBe("refused");
        expect(await r.json()).toMatchObject({ ok: false, wencai: "off" });
      } finally { await srv.close(); }
    }
  });

  it("hands the client {} when the body is not a JSON object", async () => {
    const s = wencaiStub({ kind: "refused", word: "bad-question", message: "m" });
    const srv = await startWith({ wencai: s.wencai });
    try {
      const a = await post(srv.url, "hello", { "content-type": "text/plain" });
      const b = await post(srv.url, "[1,2]");
      const c = await fetch(`${srv.url}/api/cn/wencai`, { method: "POST" });
      for (const r of [a, b, c]) expect(r.status).toBe(400);
      expect(s.seen).toEqual([{}, {}, {}]);
    } finally { await srv.close(); }
  });

  it("is behind the fence", async () => {
    const s = wencaiStub({ kind: "ok", body: OK });
    const srv = await startWith({ wencai: s.wencai });
    try {
      const r = await post(srv.url, JSON.stringify({ question: "q" }), { "content-type": "application/json", origin: "https://evil.example" });
      expect(r.status).toBe(403);
      expect(s.seen).toEqual([]);
    } finally { await srv.close(); }
  });

  it("hands a question with quotes, percent and ampersand over unchanged", async () => {
    const s = wencaiStub({ kind: "ok", body: OK });
    const srv = await startWith({ wencai: s.wencai });
    try {
      const question = `涨幅 > 5% & "放量" 的股票`;
      await post(srv.url, JSON.stringify({ question }));
      expect(s.seen).toEqual([{ question }]);
    } finally { await srv.close(); }
  });

  it("leaves /api/cn/ifind asking ifind alone, never counted by wencai", async () => {
    const s = wencaiStub({ kind: "ok", body: OK });
    const asked: string[] = [];
    const ifind: CnIfind = { configured: () => true, async ask(q) { asked.push(q); return { kind: "upstream", status: 200, contentType: "application/json", bytes: new TextEncoder().encode("{}") }; } };
    const srv = await startWith({ wencai: s.wencai, ifind });
    try {
      const query = "A股 2026年10月30日涨跌幅 成交额 主力资金流向 所属概念";
      const r = await fetch(`${srv.url}/api/cn/ifind`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }) });
      expect(r.status).toBe(200);
      expect(asked).toEqual([query]);
      expect(s.seen).toEqual([]);
    } finally { await srv.close(); }
  });
});
