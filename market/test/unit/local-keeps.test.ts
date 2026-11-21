import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isRefusal, type Refusal } from "../../src/core/errors.ts";
import type { CnHttp, CnReply } from "../../src/live/cn-http.ts";
import { eastmoney } from "../../src/live/eastmoney.ts";
import { hongKongSource } from "../../src/live/hongkong.ts";
import { koreaSource } from "../../src/live/korea.ts";
import { localHosts } from "../../src/live/local-http.ts";
import { taiwanSource } from "../../src/live/taiwan.ts";
import { worldIndices } from "../../src/live/world-indices.ts";

const fx = (n: string): Uint8Array => new Uint8Array(readFileSync(new URL(`../fixtures/regions/${n}`, import.meta.url)));
const reply = (bytes: Uint8Array, status = 200): CnReply => ({ status, bytes });
const answered = <T,>(v: T | Refusal): T => { if (isRefusal(v)) throw new Error(`refused: ${v.message}`); return v; };

function net(routes: Array<[string, CnReply]>) {
  const sent: string[] = [];
  const http: CnHttp = async (url) => {
    sent.push(url);
    const hit = routes.find(([k]) => url.includes(k));
    return hit ? hit[1] : { status: 404, bytes: new Uint8Array() };
  };
  return { http, sent };
}

type Quoter = { quotes(s: readonly string[]): Promise<unknown> };
const cases: Array<{ name: string; route: [string, CnReply]; make: (http: CnHttp, clock: () => number) => Quoter; code: string;
  /** Friday 11:00 local (trading), a minute after Friday's close, and Friday 17:00+ local (well past it) */ fri11: number; closeIn: number; afterClose: number }> = [
  { name: "Hong Kong", route: ["qt.gtimg.cn", reply(fx("tencent-quotes.txt"))], make: (http, clock) => hongKongSource({ http, clock }), code: "00700",
    fri11: Date.parse("2026-11-20T03:00:00Z"), closeIn: Date.parse("2026-11-20T07:59:58Z"), afterClose: Date.parse("2026-11-20T09:00:00Z") },
  { name: "Korea", route: ["realtime/domestic/stock", reply(fx("naver-kr-quotes.json"))], make: (http, clock) => koreaSource({ http, clock }), code: "005930",
    fri11: Date.parse("2026-11-20T02:00:00Z"), closeIn: Date.parse("2026-11-20T06:29:58Z"), afterClose: Date.parse("2026-11-20T08:00:00Z") },
  { name: "Taiwan", route: ["getStockInfo", reply(fx("twse-mis.json"))], make: (http, clock) => taiwanSource({ http, clock }), code: "2330",
    fri11: Date.parse("2026-11-20T03:00:00Z"), closeIn: Date.parse("2026-11-20T05:29:58Z"), afterClose: Date.parse("2026-11-20T07:00:00Z") },
];

describe("a local source's quote keep follows its session", () => {
  for (const c of cases) {
    it(`${c.name}: 5 s in session, until the next open well after the close, and a quote read in session is not carried past the close`, async () => {
      const n = net([c.route]);
      let t = c.fri11;
      const s = c.make(n.http, () => t);
      await s.quotes([c.code]);
      t += 4_000; await s.quotes([c.code]);
      expect(n.sent).toHaveLength(1);
      t += 2_000; await s.quotes([c.code]);
      expect(n.sent).toHaveLength(2);
      // read two seconds before the close, asked again well after it: the in-session quote was kept 5 s
      t = c.closeIn; await s.quotes([c.code]);
      expect(n.sent).toHaveLength(3);
      t = c.afterClose; await s.quotes([c.code]);
      expect(n.sent).toHaveLength(4);
      // a quote read well after the close is kept to the next open
      t += 3_600_000; await s.quotes([c.code]);
      expect(n.sent).toHaveLength(4);
    });
  }
});

describe("one guard over the local hosts", () => {
  it("a 429 from Tencent to the Hong Kong source pauses Tencent for the indices too: nothing more is sent there", async () => {
    const sent: string[] = [];
    const raw: CnHttp = async (url) => { sent.push(url); return url.includes("gtimg.cn") ? { status: 429, bytes: new Uint8Array() } : { status: 404, bytes: new Uint8Array() }; };
    const http = localHosts(raw);
    const em = eastmoney({ http: async () => ({ status: 404, bytes: new Uint8Array() }) });
    const hk = hongKongSource({ http, eastmoney: em });
    const ix = worldIndices({ http, eastmoney: em });
    expect(isRefusal(await hk.quotes(["00700"]))).toBe(true);
    const tencentAsks = sent.filter((u) => u.includes("gtimg.cn")).length;
    expect(tencentAsks).toBe(1);
    await ix.levels("hk");
    expect(sent.filter((u) => u.includes("gtimg.cn")).length).toBe(tencentAsks);
  });

  it("each source's own allowlist still holds inside it", async () => {
    const sent: string[] = [];
    const http = localHosts(async (url) => { sent.push(url); return reply(fx("naver-kr-quotes.json")); });
    // Korea's source asks only Naver's hosts; the guard's list carries Tencent's too, but the source's own list refuses them
    const kr = koreaSource({ http });
    answered(await kr.quotes(["005930"]));
    expect(sent.every((u) => new URL(u).hostname.endsWith("naver.com"))).toBe(true);
  });
});
