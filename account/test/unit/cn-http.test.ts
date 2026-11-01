import { describe, expect, it } from "vitest";
import { CN_HOSTS, cnHosts, readCapped } from "../../src/portfolio/live/cn-http.ts";

describe("cn-http", () => {
  it("cnHosts asks only the four Tencent hosts, over https, by GET", async () => {
    const sent: string[] = [];
    const http = cnHosts(async (url) => { sent.push(url); return { status: 200, bytes: new Uint8Array() }; });
    await http("https://qt.gtimg.cn/q=sh600519", { timeoutMs: 7_000, maxBytes: 1024 });
    for (const bad of ["http://qt.gtimg.cn/q=x", "https://qt.gtimg.cn:8443/q=x", "https://u:p@qt.gtimg.cn/", "https://push2.eastmoney.com/api", "nonsense"])
      await expect(http(bad, { timeoutMs: 1, maxBytes: 1 })).rejects.toThrow(/is not asked/);
    expect(sent).toEqual(["https://qt.gtimg.cn/q=sh600519"]);
    expect(CN_HOSTS).toEqual(["qt.gtimg.cn", "smartbox.gtimg.cn", "proxy.finance.qq.com", "web.ifzq.gtimg.cn"]);
  });

  it("cnHosts takes a longer list for a caller that names one", async () => {
    const sent: string[] = [];
    const http = cnHosts(async (url) => { sent.push(url); return { status: 200, bytes: new Uint8Array() }; }, [...CN_HOSTS, "relay.example.com"]);
    await http("https://relay.example.com/x", { timeoutMs: 1, maxBytes: 1 });
    await expect(http("https://other.example.com/x", { timeoutMs: 1, maxBytes: 1 })).rejects.toThrow(/is not asked/);
    expect(sent).toEqual(["https://relay.example.com/x"]);
  });

  it("readCapped stops past maxBytes", async () => {
    const stream = (n: number) => new ReadableStream<Uint8Array>({ start(c) { for (let i = 0; i < n; i++) c.enqueue(new Uint8Array(600)); c.close(); } });
    await expect(readCapped(stream(3), 1_024)).rejects.toThrow("too-large");
    expect((await readCapped(stream(1), 1_024)).byteLength).toBe(600);
  });

  it("cnHosts passes a POST body through", async () => {
    let got: string | undefined;
    const http = cnHosts(async (_u, init) => { got = init.body; return { status: 200, bytes: new Uint8Array() }; });
    await http("https://qt.gtimg.cn/q=x", { timeoutMs: 1, maxBytes: 1, body: '{"a":1}' });
    expect(got).toBe('{"a":1}');
  });
});
