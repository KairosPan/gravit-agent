import { describe, expect, it } from "vitest";
import type { CnHttp } from "../../src/portfolio/live/cn-http.ts";
import { RELAY_URL_MAX, createCnRelay, relayTarget } from "../../src/portfolio/live/cn-relay.ts";

const ZT = "ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=500&sort=fbt:asc&date=20261023";
describe("cn-relay", () => {
  it("relayTarget takes exactly the rows' endpoints", () => {
    const ok = [
      "https://qt.gtimg.cn/q=sh000001,sz399001,sh600519",
      "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh600519,day,,,60,qfq",
      "https://web.ifzq.gtimg.cn/appstock/app/day/query?code=sh000001",
      ...["getTopicZTPool", "getTopicZBPool", "getYesterdayZTPool", "getTopicZDFenBu"].map((p) => `https://push2ex.eastmoney.com/${p}?${ZT}`),
      "https://push2.eastmoney.com/api/qt/clist/get?fs=m:90+t:3+f:!50&pz=30",
      "https://push2delay.eastmoney.com/api/qt/clist/get?fs=b:BK0715",
    ];
    for (const u of ok) expect(relayTarget(u), u).not.toBeNull();
    expect(relayTarget(ok[0]!)).toEqual({ url: ok[0], timeoutMs: 7_000, maxBytes: 524_288 });
    expect(relayTarget(ok[1]!)?.timeoutMs).toBe(7_000);
    expect(relayTarget(ok[2]!)?.timeoutMs).toBe(4_000);
    const bad = ["http://qt.gtimg.cn/q=sh000001", "https://qt.gtimg.cn:8443/q=x", "https://u:p@qt.gtimg.cn/q=x", "https://qt.gtimg.cn/q=sh000001?x=1",
      "https://qt.gtimg.cn/q=sh000001#a", "https://qt.gtimg.cn/q=../x", "https://smartbox.gtimg.cn/s3/?q=x", "https://push2ex.eastmoney.com/getTopicDTPool",
      "https://push2delay.eastmoney.com/getTopicZTPool", "https://quantapi.51ifind.com/api/v1/smart_stock_picking", "https://17.push2.eastmoney.com/api/qt/clist/get",
      "not a url", `https://qt.gtimg.cn/q=${"a".repeat(RELAY_URL_MAX)}`];
    for (const u of bad) expect(relayTarget(u), u).toBeNull();
  });

  it("the relay answers the upstream's status, type, location and bytes unchanged", async () => {
    const bytes = new Uint8Array([0x76, 0x5f, 0xd2, 0x7e, 0x7e]);
    const a = await createCnRelay(async () => ({ status: 200, contentType: "text/plain; charset=GBK", bytes }))("https://qt.gtimg.cn/q=sh600519", {});
    expect(a).toEqual({ kind: "upstream", status: 200, contentType: "text/plain; charset=GBK", bytes });
    if (a.kind === "upstream") expect(Array.from(a.bytes)).toEqual(Array.from(bytes));
    const loc = "https://push2delay.eastmoney.com/api/qt/clist/get?fs=b:BK0715";
    let calls = 0;
    const r = await createCnRelay(async () => { calls++; return { status: 302, location: loc, bytes: new Uint8Array() }; })("https://push2.eastmoney.com/api/qt/clist/get?fs=x", {});
    expect(r).toMatchObject({ kind: "upstream", status: 302, location: loc });
    expect(calls).toBe(1);
    const n = await createCnRelay(async () => ({ status: 404, bytes: new Uint8Array() }))("https://qt.gtimg.cn/q=zz", {});
    expect(n).toMatchObject({ kind: "upstream", status: 404 });
  });

  it("the relay asks with the target's limits and three headers only", async () => {
    const seen: Array<Parameters<CnHttp>[1]> = [];
    const relay = createCnRelay(async (_u, init) => { seen.push(init); return { status: 200, bytes: new Uint8Array() }; });
    const headers = { accept: "a".repeat(300), referer: "https://x/", "user-agent": "bad\r\nx: y", cookie: "c", authorization: "t", "x-forwarded-for": "1.1.1.1" };
    await relay("https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh600519,day,,,60,qfq", headers);
    await relay("https://web.ifzq.gtimg.cn/appstock/app/day/query?code=sh000001", { accept: "x" });
    expect(seen[0]).toMatchObject({ timeoutMs: 7_000, maxBytes: 524_288 });
    expect(seen[0]!.headers).toEqual({ accept: "a".repeat(256), referer: "https://x/" });
    expect(seen[1]!.timeoutMs).toBe(4_000);
  });

  it("refusals are words", async () => {
    let asked = 0;
    const never = createCnRelay(async () => { asked++; return { status: 200, bytes: new Uint8Array() }; });
    expect(await never("https://example.com/x", {})).toEqual({ kind: "refused", word: "not-listed" });
    expect(asked).toBe(0);
    const url = "https://qt.gtimg.cn/q=sh600519";
    expect(await createCnRelay(async () => { throw new Error("timeout"); })(url, {})).toEqual({ kind: "refused", word: "timeout" });
    expect(await createCnRelay(async () => { throw new Error("too-large"); })(url, {})).toEqual({ kind: "refused", word: "too-large" });
    expect(await createCnRelay(async () => { throw new TypeError("fetch failed"); })(url, {})).toEqual({ kind: "refused", word: "unreachable" });
  });

  it("past its cap the relay queues, never refuses", async () => {
    const releases: Array<() => void> = [];
    let started = 0;
    const relay = createCnRelay(() => new Promise((resolve) => { started++; releases.push(() => resolve({ status: 200, bytes: new Uint8Array() })); }), { inFlight: 2 });
    const all = [1, 2, 3].map(() => relay("https://qt.gtimg.cn/q=sh600519", {}));
    await new Promise((r) => setTimeout(r, 10));
    expect(started).toBe(2);
    releases[0]!();
    await new Promise((r) => setTimeout(r, 10));
    expect(started).toBe(3);
    releases[1]!(); releases[2]!();
    for (const a of await Promise.all(all)) expect(a.kind).toBe("upstream");
  });

  it("an abandoned queued ask leaves the queue and never reaches the upstream", async () => {
    const releases: Array<() => void> = [];
    const urls: string[] = [];
    const relay = createCnRelay((u) => new Promise((resolve) => { urls.push(u); releases.push(() => resolve({ status: 200, bytes: new Uint8Array() })); }), { inFlight: 1 });
    const first = relay("https://qt.gtimg.cn/q=sh600519", {});
    const gone = new AbortController();
    const queued = relay("https://qt.gtimg.cn/q=sh000001", {}, gone.signal);
    await new Promise((r) => setTimeout(r, 10));
    gone.abort();
    expect(await queued).toEqual({ kind: "refused", word: "timeout" });
    releases[0]!();
    await first;
    await new Promise((r) => setTimeout(r, 10));
    expect(urls).toEqual(["https://qt.gtimg.cn/q=sh600519"]);
    // the slot was handed back: a new ask runs
    const next = relay("https://qt.gtimg.cn/q=sz000001", {});
    await new Promise((r) => setTimeout(r, 10));
    expect(urls.length).toBe(2);
    releases[1]!();
    expect((await next).kind).toBe("upstream");
  });

  it("a burst past the waiting cap is refused, not queued", async () => {
    const releases: Array<() => void> = [];
    const relay = createCnRelay(() => new Promise((resolve) => { releases.push(() => resolve({ status: 200, bytes: new Uint8Array() })); }), { inFlight: 1, waiting: 2 });
    const all = [1, 2, 3, 4].map(() => relay("https://qt.gtimg.cn/q=sh600519", {}));
    expect(await all[3]).toEqual({ kind: "refused", word: "timeout" });
    for (let i = 0; i < 3; i++) { await new Promise((r) => setTimeout(r, 5)); releases[i]!(); }
    expect((await Promise.all(all.slice(0, 3))).every((a) => a.kind === "upstream")).toBe(true);
  });
});
