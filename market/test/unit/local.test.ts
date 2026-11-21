import { describe, expect, it } from "vitest";
import { indexRow, quoteWord, shareRow, staleRank, type LocalRead } from "../../src/live/local.ts";

const read: LocalRead = { venue: "hk", region: "hk", sort: "volume", total: 3, asOf: "2026-11-20T08:00:00.000Z", session: { phase: "closed", lastSession: "2026-11-20" },
  status: { state: "live", said: "ok" }, note: "n" };

describe("quoteWord", () => {
  it("says a declared delay in its own figure, zero as real time, nothing as the name", () => {
    expect(quoteWord("Naver", 15)).toBe("Naver · 15 min delayed");
    expect(quoteWord("TWSE", 0)).toBe("TWSE · real time");
    expect(quoteWord("Tencent", null)).toBe("Tencent");
    expect(quoteWord("Tencent", undefined)).toBe("Tencent");
  });
});

describe("rows", () => {
  it("a share is view-only, in its currency, with no dollar volume", () => {
    const r = shareRow({ venue: "hk", venueName: "Tencent", code: "00700", name: "Tencent", nameLocal: "腾讯控股", currency: "HKD", price: 344, changePct: -1.26, turnover: 1.4e10, quoteFrom: "Tencent" });
    expect(r.key).toBe("hk:00700");
    expect(r.kind).toBe("share");
    expect(r.currency).toBe("HKD");
    expect(r.turnoverLocal).toBe(1.4e10);
    expect(r.volumeUsd24h).toBeUndefined();
    expect(r.tabs).toEqual([]);
    expect(r.at).toHaveLength(1);
    expect(r.at![0]).toMatchObject({ venue: "hk", venueName: "Tencent", symbol: "00700", connected: false, canTrade: false, public: true });
  });
  it("a missing price or turnover leaves the field out", () => {
    const r = shareRow({ venue: "kr", venueName: "Naver", code: "005930", name: "삼성전자", currency: "KRW", price: null, changePct: null, turnover: null, quoteFrom: "Naver" });
    expect("price" in r).toBe(false);
    expect("turnoverLocal" in r).toBe(false);
  });
  it("an index has its key, no currency", () => {
    const r = indexRow({ region: "jp", id: "n225", name: "Nikkei 225", level: 56436.65, change: -3007.56, changePct: -5.06, quoteFrom: "Eastmoney", quoteAt: "2026-11-20T06:30:00.000Z" });
    expect(r.key).toBe("ix:jp:n225");
    expect(r.kind).toBe("index");
    expect(r.currency).toBeUndefined();
    expect(r.at![0]).toMatchObject({ venue: "ix", canTrade: false });
  });
});

describe("staleRank", () => {
  const last = { at: 1_000, answer: { items: [], read } };
  it("answers a ranking up to 10 minutes old, flagged stale", () => {
    const s = staleRank(last, 1_000 + 599_999, "late")!;
    expect(s.read.status).toEqual({ state: "stale", said: "late", at: read.asOf });
    expect(staleRank(last, 1_000 + 600_000, "late")).toBeNull();
    expect(staleRank(undefined, 5, "late")).toBeNull();
  });
});

describe("rankTtlMs", () => {
  it("is the in-session keep while trading or at midday, else the time to the next open", async () => {
    const { rankTtlMs } = await import("../../src/live/local.ts");
    const { SESSIONS } = await import("../../src/live/local-session.ts");
    expect(rankTtlMs(SESSIONS.hk, Date.parse("2026-11-20T03:00:00Z"), 10_000)).toBe(10_000);
    expect(rankTtlMs(SESSIONS.hk, Date.parse("2026-11-20T04:30:00Z"), 10_000)).toBe(10_000);
    // Friday 17:00 Hong Kong to Monday 09:30
    expect(rankTtlMs(SESSIONS.hk, Date.parse("2026-11-20T09:00:00Z"), 10_000)).toBe(Date.parse("2026-11-23T01:30:00Z") - Date.parse("2026-11-20T09:00:00Z"));
  });
});
