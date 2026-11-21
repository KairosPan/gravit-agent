import { describe, expect, it } from "vitest";
import { NAVER_HOSTS, TWSE_HOSTS, politeHosts, retryOnce } from "../../src/live/local-http.ts";
import type { CnReply } from "../../src/live/cn-http.ts";

const init = { timeoutMs: 1, maxBytes: 1 };
const reply = (status: number): CnReply => ({ status, bytes: new Uint8Array() });

describe("politeHosts", () => {
  it("a 429 pauses only that host, for 15 minutes", async () => {
    let now = 1_000;
    const sent: string[] = [];
    const http = politeHosts(async (url) => { sent.push(url); return reply(url.includes("m.stock") ? 429 : 200); }, NAVER_HOSTS, { clock: () => now });
    expect((await http("https://m.stock.naver.com/a", init)).status).toBe(429);
    await expect(http("https://m.stock.naver.com/b", init)).rejects.toThrow("paused");
    expect((await http("https://api.stock.naver.com/c", init)).status).toBe(200);
    expect(sent).toEqual(["https://m.stock.naver.com/a", "https://api.stock.naver.com/c"]);
    now += 899_999;
    await expect(http("https://m.stock.naver.com/b", init)).rejects.toThrow("paused");
    now += 1;
    expect((await http("https://m.stock.naver.com/d", init)).status).toBe(429);
  });

  it("a refusal page pauses the host and the ask throws refused", async () => {
    const http = politeHosts(async () => reply(200), TWSE_HOSTS, { isRefusalPage: () => true });
    await expect(http("https://www.twse.com.tw/x", init)).rejects.toThrow("refused");
    await expect(http("https://www.twse.com.tw/x", init)).rejects.toThrow("paused");
  });

  it("a 3xx reply (no redirect is followed) pauses the host as a 403 does", async () => {
    let now = 0;
    const sent: string[] = [];
    const http = politeHosts(async (url) => { sent.push(url); return reply(302); }, TWSE_HOSTS, { clock: () => now });
    expect((await http("https://www.twse.com.tw/a", init)).status).toBe(302);
    await expect(http("https://www.twse.com.tw/b", init)).rejects.toThrow("paused");
    expect(sent).toEqual(["https://www.twse.com.tw/a"]);
  });

  it("a host off the list throws before any request", async () => {
    let n = 0;
    const http = politeHosts(async () => { n++; return reply(200); }, NAVER_HOSTS);
    await expect(http("https://evil.example.com/x", init)).rejects.toThrow(/is not asked/);
    expect(n).toBe(0);
  });
});

describe("retryOnce", () => {
  it("asks twice on a timeout, once on a 500", async () => {
    let n = 0;
    const r = await retryOnce(async () => { if (n++ === 0) throw new Error("timeout"); return reply(200); });
    expect([n, r.status]).toEqual([2, 200]);
    let m = 0;
    expect((await retryOnce(async () => { m++; return reply(500); })).status).toBe(500);
    expect(m).toBe(1);
    let k = 0;
    await expect(retryOnce(async () => { k++; throw new Error("paused"); })).rejects.toThrow("paused");
    expect(k).toBe(1);
  });
});
