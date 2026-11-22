import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { isRefusal, type Refusal } from "../../src/core/errors.ts";
import type { CnHttp, CnReply } from "../../src/live/cn-http.ts";
import { localHosts, LOCAL_HOSTS } from "../../src/live/local-http.ts";
import {
  ORNN_CURRENT_TTL_MS, ORNN_FAIL_HOLD_MS, ORNN_HISTORY_AFTER_MS, ORNN_HISTORY_MIN_MS, ORNN_HISTORY_RETRY_MS, ORNN_HOSTS, ORNN_INDICES, ORNN_LIST_TTL_MS, ORNN_STALE_MS, ornnSource, type OrnnMarket,
} from "../../src/live/ornn.ts";

const fxText = (n: string): string => readFileSync(new URL(`../fixtures/ornn/${n}`, import.meta.url), "utf8");
const fx = (n: string): Uint8Array => new TextEncoder().encode(fxText(n));
const reply = (bytes: Uint8Array, status = 200): CnReply => ({ status, bytes });
const json = (v: unknown, status = 200): CnReply => reply(new TextEncoder().encode(JSON.stringify(v)), status);
const answered = <T,>(v: T | Refusal): T => { if (isRefusal(v)) throw new Error(`refused: ${v.message}`); return v; };

const DAILY = "/daily-index/all";
const H100_HIST = "/gpu/H100%20SXM/index-history";
const RTXPRO_HIST = "/gpu/RTX%20PRO%206000%20WS/index-history";
const LABS = "/public-index/otpi";
const LAB_HIST = "otpi?lab=anthropic&";
const CLASSES = "/otpi/weight-class";
const CLASS_HIST = "weight-class?class=closed&";
const H100_NOW = "api.ornnai.com/api/gpu/H100%20SXM";

/** routes matched in order by a substring of the URL; the first that matches answers (a function may change its answer between asks) */
type Route = [string, CnReply | (() => CnReply)];
function net(routes: Route[]) {
  const sent: string[] = [];
  const http: CnHttp = async (url) => {
    sent.push(url);
    const hit = routes.find(([k]) => url.includes(k));
    if (!hit) return { status: 404, bytes: new Uint8Array() };
    return typeof hit[1] === "function" ? hit[1]() : hit[1];
  };
  return { http, sent, count: (part: string) => sent.filter((u) => u.includes(part)).length };
}
/** the three latest-index asks and the histories the fixtures hold (the more specific substrings first) */
const base = (): Route[] => [
  [H100_HIST, reply(fx("h100-history.json"))],
  [RTXPRO_HIST, reply(fx("rtxpro-history.json"))],
  [LAB_HIST, reply(fx("otpi-anthropic-history.json"))],
  [CLASS_HIST, reply(fx("otpi-class-closed-history.json"))],
  [DAILY, reply(fx("daily-all.json"))],
  [CLASSES, reply(fx("otpi-class.json"))],
  [H100_NOW, reply(fx("h100.json"))],
  ["otpi?lab=", json({ success: false })],
  ["weight-class?class=", json({ success: false })],
  [LABS, reply(fx("otpi.json"))],
];
const T0 = Date.parse("2026-11-22T08:00:00Z");

describe("the list", () => {
  it("names the thirteen indices and their hosts join the shared guard", () => {
    expect(ORNN_INDICES.map((i) => i.key)).toEqual([
      "cmp:a100", "cmp:b200", "cmp:b300", "cmp:h100", "cmp:h200", "cmp:rtx5090", "cmp:rtxpro6000",
      "cmp:tok-anthropic", "cmp:tok-openai", "cmp:tok-google", "cmp:tok-deepseek", "cmp:tok-closed", "cmp:tok-open",
    ]);
    expect(ORNN_INDICES.find((i) => i.id === "rtxpro6000")).toMatchObject({ kind: "gpu", ornn: "RTX PRO 6000 WS", name: "RTX PRO 6000 WS", unit: "$/GPU·hr" });
    expect(ORNN_INDICES.find((i) => i.id === "tok-closed")).toMatchObject({ kind: "class", ornn: "closed", name: "Closed-source tokens", unit: "$/M tokens" });
    for (const h of ORNN_HOSTS) expect(LOCAL_HOSTS).toContain(h);
    expect([...ORNN_HOSTS].sort()).toEqual(["api.ornnai.com", "data.ornn.com"]);
  });
});

describe("rows", () => {
  it("thirteen rows from the three fixtures: GPUs by price, then tokens, with units and settle dates, view-only", async () => {
    const n = net(base());
    const s = ornnSource({ http: n.http, clock: () => T0, paceMs: 0 });
    const r = answered(await s.rows("volume"));
    expect(r.items.map((i) => i.key)).toEqual([
      "cmp:b300", "cmp:b200", "cmp:h200", "cmp:h100", "cmp:rtxpro6000", "cmp:a100", "cmp:rtx5090",
      "cmp:tok-anthropic", "cmp:tok-openai", "cmp:tok-google", "cmp:tok-deepseek", "cmp:tok-closed", "cmp:tok-open",
    ]);
    const h100 = r.items.find((i) => i.key === "cmp:h100")!;
    expect(h100).toMatchObject({
      kind: "computeIndex", name: "H100 SXM", base: "h100", asset: "compute", form: "spot", unit: "$/GPU·hr", price: 2.89,
      quoteFrom: "Ornn · settle 2026-11-21", tabs: [],
    });
    expect(h100.at).toEqual([{ venue: "ornn", venueName: "Ornn", symbol: "h100", connected: false, canTrade: false, public: true, price: 2.89, quoteFrom: "Ornn · settle 2026-11-21" }]);
    expect(h100.volumeUsd24h).toBeUndefined();
    const anth = r.items.find((i) => i.key === "cmp:tok-anthropic")!;
    expect(anth).toMatchObject({ name: "Anthropic tokens", unit: "$/M tokens", quoteFrom: "Ornn · settle 2026-11-20" });
    expect(anth.price).toBeCloseTo(0.7656, 4);
    expect(r.items.find((i) => i.key === "cmp:tok-open")).toMatchObject({ name: "Open-source tokens" });
    expect(r.items.find((i) => i.key === "cmp:tok-open")!.price).toBeCloseTo(0.062, 4);
    expect(r.stale).toBeUndefined();
    expect(r.asOf).toBe(new Date(T0).toISOString());
  });

  it("an unknown GPU in daily-all is left out; a listed GPU missing from it gives no row", async () => {
    const daily = JSON.parse(fxText("daily-all.json")) as { data: Array<{ gpu_type: string }> };
    daily.data = daily.data.filter((d) => d.gpu_type !== "H200");
    daily.data.push({ gpu_type: "MI300X", region: "global", index_value: 3.3, date: "2026-11-21T05:00:00.000Z" } as never);
    const n = net([[DAILY, json(daily)], ...base()]);
    const r = answered(await ornnSource({ http: n.http, clock: () => T0, paceMs: 0 }).rows("volume"));
    expect(r.items).toHaveLength(12);
    expect(r.items.map((i) => i.key)).not.toContain("cmp:h200");
    expect(r.items.some((i) => i.name.includes("MI300X"))).toBe(false);
  });

  it("no change until a row's history is read; then H100's change from its history's last two points, read once per settle", async () => {
    const n = net(base());
    const s = ornnSource({ http: n.http, clock: () => T0, paceMs: 0 });
    const first = answered(await s.rows("volume"));
    expect(first.items.find((i) => i.key === "cmp:h100")!.change24h).toBeUndefined();
    await vi.waitFor(() => expect(n.count(H100_HIST)).toBe(1));
    await vi.waitFor(async () => {
      const h = answered(await s.rows("volume")).items.find((i) => i.key === "cmp:h100")!;
      expect(h.change24h).toBeCloseTo(-0.01, 8);
      expect(h.changePct24h).toBeCloseTo(-0.34, 2);
    });
    const anth = answered(await s.rows("volume")).items.find((i) => i.key === "cmp:tok-anthropic")!;
    expect(anth.change24h).toBeCloseTo(0.7656285226052413 - 0.7457952461719837, 8);
    await s.rows("volume"); await s.rows("movers");
    await new Promise((go) => setTimeout(go, 10));
    // one history read per row per settle, whatever its answer
    expect(n.count(H100_HIST)).toBe(1);
    expect(n.count("/gpu/B300/index-history")).toBe(1);
    expect(n.count(LAB_HIST)).toBe(1);
  });

  it("a history of one point gives no change", async () => {
    const one = { success: true, gpu_type: "H100 SXM", access: "public-3mo", data: [{ timestamp: "2026-11-21T05:00:00.000Z", index_value: 2.89 }] };
    const n = net([[H100_HIST, json(one)], ...base()]);
    const s = ornnSource({ http: n.http, clock: () => T0, paceMs: 0 });
    await s.rows("volume");
    await vi.waitFor(() => expect(n.count(H100_HIST)).toBe(1));
    await new Promise((go) => setTimeout(go, 10));
    const h = answered(await s.rows("volume")).items.find((i) => i.key === "cmp:h100")!;
    expect(h.change24h).toBeUndefined();
    expect(h.changePct24h).toBeUndefined();
  });

  it("movers: by the size of the change, rows with none last", async () => {
    const n = net(base());
    const s = ornnSource({ http: n.http, clock: () => T0, paceMs: 0 });
    await s.rows("volume");
    await vi.waitFor(() => expect(n.count(CLASS_HIST)).toBe(1));
    await new Promise((go) => setTimeout(go, 10));
    const keys = answered(await s.rows("movers")).items.map((i) => i.key);
    // anthropic +2.66%, closed +4.86%, H100 -0.34%, RTX PRO -1.30%; the rest have no history
    expect(keys.slice(0, 4)).toEqual(["cmp:tok-closed", "cmp:tok-anthropic", "cmp:rtxpro6000", "cmp:h100"]);
  });
});

describe("history", () => {
  it("daily bars, o = h = l = c: 1M is 30 bars; 3M and longer are all the points there are, with the note", async () => {
    const n = net(base());
    const s = ornnSource({ http: n.http, clock: () => T0, paceMs: 0 });
    const m1 = answered(await s.history("h100", "1M"));
    expect(m1).toMatchObject({ venue: "ornn", venueName: "Ornn", symbol: "h100", range: "1M", source: "Ornn" });
    expect(m1.candles).toHaveLength(30);
    expect(m1.note).toBeUndefined();
    expect(m1.candles.at(-1)).toEqual({ t: Date.parse("2026-11-21T05:00:00.000Z"), o: 2.89, h: 2.89, l: 2.89, c: 2.89 });
    for (const range of ["3M", "6M", "1Y", "MAX"] as const) {
      const h = answered(await s.history("h100", range));
      expect(h.candles).toHaveLength(91);
      expect(h.note).toBe("Ornn's free history is three months");
    }
    // one read answered every range
    expect(n.count(H100_HIST)).toBe(1);
    const tok = answered(await s.history("tok-anthropic", "3M"));
    expect(tok.candles).toHaveLength(90);
    expect(tok.candles[0]!.t).toBe(Date.parse("2026-08-22T00:00:00Z"));
    expect(n.sent.find((u) => u.includes(LAB_HIST))).toBe("https://data.ornn.com/api/public-index/otpi?lab=anthropic&startDate=2026-08-24&endDate=2026-11-22");
    answered(await s.history("tok-closed", "1M"));
    expect(n.sent.find((u) => u.includes(CLASS_HIST))).toBe("https://data.ornn.com/api/public-index/otpi/weight-class?class=closed&startDate=2026-08-24&endDate=2026-11-22");
  });

  it("refuses an intraday range and an unknown id", async () => {
    const s = ornnSource({ http: net(base()).http, clock: () => T0, paceMs: 0 });
    expect(isRefusal(await s.history("h100", "1D"))).toBe(true);
    expect(isRefusal(await s.history("nope", "1M"))).toBe(true);
  });
});

describe("quote", () => {
  it("a GPU: the latest settle, the previous one, the 30-day range and the current value 2.69 at 05:01:30Z", async () => {
    const n = net(base());
    const s = ornnSource({ http: n.http, clock: () => T0, paceMs: 0 });
    const q = answered(await s.quote("h100")) as OrnnMarket;
    expect(q).toMatchObject({ symbol: "h100", name: "H100 SXM", kind: "spot", price: 2.89, quoteFrom: "Ornn · settle 2026-11-21", unit: "$/GPU·hr", open: false, types: [] });
    expect(q.change24h).toBeCloseTo(-0.01, 8);
    expect(q.local).toMatchObject({ prevClose: 2.9, open: null, volume: null, turnover: null, lastSession: "2026-11-21", phase: "closed", quoteStatus: "unsaid" });
    const h = JSON.parse(fxText("h100-history.json")) as { data: Array<{ index_value: number }> };
    const last30 = h.data.slice(-30).map((p) => p.index_value);
    expect(q.local.high).toBe(Math.max(...last30));
    expect(q.local.low).toBe(Math.min(...last30));
    expect(q.current).toEqual({ value: 2.69, at: "2026-11-22T05:01:30.556Z" });
    expect(q.note).toBeUndefined();
  });

  it("the current host's 500 leaves the settle answered with a note", async () => {
    const n = net([[H100_NOW, json({}, 500)], ...base()]);
    const q = answered(await ornnSource({ http: n.http, clock: () => T0, paceMs: 0 }).quote("h100")) as OrnnMarket;
    expect(q.price).toBe(2.89);
    expect(q.local.prevClose).toBe(2.9);
    expect(q.current).toBeNull();
    expect(q.note).toMatch(/current/i);
  });

  it("a token row carries no current value and never asks the current host", async () => {
    const n = net(base());
    const q = answered(await ornnSource({ http: n.http, clock: () => T0, paceMs: 0 }).quote("tok-anthropic")) as OrnnMarket;
    expect(q.price).toBeCloseTo(0.7656, 4);
    expect(q.local.lastSession).toBe("2026-11-20");
    expect(q.current).toBeUndefined();
    expect(n.count("api.ornnai.com")).toBe(0);
  });
});

describe("keeps and the stale rule", () => {
  it("the three latest-index asks are kept an hour; a GPU's current value five minutes", async () => {
    const n = net(base());
    let t = T0;
    const s = ornnSource({ http: n.http, clock: () => t, paceMs: 0 });
    await s.rows("volume");
    const latest = (): number[] => [n.count(DAILY), n.sent.filter((u) => u.endsWith("/public-index/otpi")).length, n.sent.filter((u) => u.endsWith("/otpi/weight-class")).length];
    expect(latest()).toEqual([1, 1, 1]);
    t += ORNN_LIST_TTL_MS - 1; await s.rows("volume");
    expect(n.count(DAILY)).toBe(1);
    t += 1; await s.rows("volume");
    expect(latest()).toEqual([2, 2, 2]);

    await s.quote("h100");
    t += ORNN_CURRENT_TTL_MS - 1; await s.quote("h100");
    expect(n.count(H100_NOW)).toBe(1);
    t += 1; await s.quote("h100");
    expect(n.count(H100_NOW)).toBe(2);
  });

  it("a failed read answers the last good one, flagged stale, for ten minutes past its keep, then the read is refused", async () => {
    let down = false;
    const routes = base().map(([k, v]): Route => [k, () => (down && !k.includes("history") && !k.includes("?") ? json({}, 500) : (v as CnReply))]);
    const n = net(routes);
    let t = T0;
    const s = ornnSource({ http: n.http, clock: () => t, paceMs: 0 });
    answered(await s.rows("volume"));
    down = true;
    t += ORNN_LIST_TTL_MS + 1;
    const stale = answered(await s.rows("volume"));
    expect(stale.stale).toBe(true);
    expect(stale.items).toHaveLength(13);
    expect(stale.items.find((i) => i.key === "cmp:h100")!.quoteFrom).toBe("Ornn · settle 2026-11-21 · stale");
    expect(stale.note).toMatch(/last/i);
    expect(s.status().state).toBe("stale");
    t = T0 + ORNN_LIST_TTL_MS + ORNN_STALE_MS;
    const gone = await s.rows("volume");
    expect(isRefusal(gone)).toBe(true);
    expect(s.status().state).toBe("unavailable");
  });

  it("one ask failing with nothing kept leaves its rows out and says so", async () => {
    // the labs' latest ask fails; the classes and GPUs answer
    const m = net([[H100_HIST, reply(fx("h100-history.json"))], [DAILY, reply(fx("daily-all.json"))], [CLASSES, reply(fx("otpi-class.json"))], [LABS, json({}, 500)]]);
    const r = answered(await ornnSource({ http: m.http, clock: () => T0, paceMs: 0 }).rows("volume"));
    expect(r.items).toHaveLength(9);
    expect(r.items.map((i) => i.key)).not.toContain("cmp:tok-anthropic");
    expect(r.note).toMatch(/lab/i);
  });
});

describe("the shared guard", () => {
  it("a 429 pauses that host for every ask; the other host is still asked", async () => {
    const n = net([[DAILY, json({}, 429)], ...base()]);
    let t = T0;
    const shared = localHosts(n.http, { clock: () => t });
    const s = ornnSource({ http: shared, clock: () => t, paceMs: 0 });
    await s.rows("volume");
    await new Promise((go) => setTimeout(go, 10));
    const before = n.count("data.ornn.com");
    // a minute later, inside the 15-minute pause: a history read of that host sends nothing
    t = T0 + 60_000;
    const q = await s.history("h200", "1M");
    expect(isRefusal(q)).toBe(true);
    expect(n.count("data.ornn.com")).toBe(before);
    // the pause is the guard's, not the source's: another consumer of the same guard sends nothing to that host either
    const other = ornnSource({ http: shared, clock: () => t, paceMs: 0 });
    expect(isRefusal(await other.history("b300", "1M"))).toBe(true);
    await expect(shared("https://data.ornn.com/api/public-index/daily-index/all", { timeoutMs: 1, maxBytes: 1_000_000 })).rejects.toThrow("paused");
    expect(n.count("data.ornn.com")).toBe(before);
    // api.ornnai.com is a host of its own: not paused
    await shared("https://api.ornnai.com/api/gpu/B200", { timeoutMs: 1, maxBytes: 1_000_000 });
    expect(n.count("api.ornnai.com/api/gpu/B200")).toBe(1);
  });
});

describe("review round 1", () => {
  it("a failed background history read is tried once more after the hold, and the change appears", async () => {
    let fails = 1;
    const n = net([[H100_HIST, () => (fails-- > 0 ? json({}, 500) : reply(fx("h100-history.json")))], ...base()]);
    let t = T0;
    const s = ornnSource({ http: n.http, clock: () => t, paceMs: 0 });
    await s.rows("volume");
    await vi.waitFor(() => expect(n.count(H100_HIST)).toBe(1));
    await new Promise((go) => setTimeout(go, 10));
    t += ORNN_HISTORY_RETRY_MS - 1;
    // inside the list's keep and the hold: no second read
    await s.rows("volume");
    await new Promise((go) => setTimeout(go, 10));
    expect(n.count(H100_HIST)).toBe(1);
    expect(answered(await s.rows("volume")).items.find((i) => i.key === "cmp:h100")!.change24h).toBeUndefined();
    t += 1;
    await s.rows("volume");
    await vi.waitFor(async () => {
      expect(answered(await s.rows("volume")).items.find((i) => i.key === "cmp:h100")!.change24h).toBeCloseTo(-0.01, 8);
    });
    expect(n.count(H100_HIST)).toBe(2);
    // an answered read is once per settle
    t += ORNN_HISTORY_RETRY_MS * 3;
    await s.rows("volume");
    await new Promise((go) => setTimeout(go, 10));
    expect(n.count(H100_HIST)).toBe(2);
  });

  it("a zero previous value gives no change at all", async () => {
    const h = { success: true, gpu_type: "H100 SXM", access: "public-3mo", data: [
      { timestamp: "2026-11-20T05:00:00.000Z", index_value: 0 }, { timestamp: "2026-11-21T05:00:00.000Z", index_value: 2.89 }] };
    const n = net([[H100_HIST, json(h)], ...base()]);
    const q = answered(await ornnSource({ http: n.http, clock: () => T0, paceMs: 0 }).quote("h100")) as OrnnMarket;
    expect(q.change24h).toBeUndefined();
    expect(q.changePct24h).toBeUndefined();
    expect(q.local.prevClose).toBeNull();
  });

  it("the 30-day range holds at most 30 values, the settle among them", async () => {
    // the history ends a day before the settle: the settle is pushed first, then the range cut to 30
    const full = JSON.parse(fxText("h100-history.json")) as { data: Array<{ timestamp: string; index_value: number }> };
    const data = full.data.slice(0, -1).map((p, k, all) => (k === all.length - 30 ? { ...p, index_value: 99 } : p));
    const n = net([[H100_HIST, json({ ...full, data })], ...base()]);
    const q = answered(await ornnSource({ http: n.http, clock: () => T0, paceMs: 0 }).quote("h100")) as OrnnMarket;
    // the 99 is 30th from the end of the history; with the settle pushed it is 31st and falls outside the range
    expect(q.local.high).toBeLessThan(99);
    const want = [...data.slice(-29).map((p) => p.index_value), 2.89];
    expect(q.local.high).toBe(Math.max(...want));
    expect(q.local.low).toBe(Math.min(...want));
  });

  it("a history is kept until 24 h after its last point, and at least an hour", async () => {
    const n = net(base());
    const last = Date.parse("2026-11-21T05:00:00.000Z");
    // read two hours after the last point: kept until 24 h after it
    let t = last + 2 * 3_600_000;
    const s = ornnSource({ http: n.http, clock: () => t, paceMs: 0 });
    answered(await s.history("h100", "1M"));
    t = last + ORNN_HISTORY_AFTER_MS - 1; answered(await s.history("h100", "1M"));
    expect(n.count(H100_HIST)).toBe(1);
    t = last + ORNN_HISTORY_AFTER_MS; answered(await s.history("h100", "1M"));
    expect(n.count(H100_HIST)).toBe(2);
    // read again past the 24 h: kept the hour's minimum
    t += ORNN_HISTORY_MIN_MS - 1; answered(await s.history("h100", "1M"));
    expect(n.count(H100_HIST)).toBe(2);
    t += 1; answered(await s.history("h100", "1M"));
    expect(n.count(H100_HIST)).toBe(3);
  });

  it("a failed latest-index ask is not sent again within a minute, and is after", async () => {
    const n = net([[DAILY, json({}, 500)], ...base()]);
    let t = T0;
    const s = ornnSource({ http: n.http, clock: () => t, paceMs: 0 });
    await s.rows("volume");
    expect(n.count(DAILY)).toBe(1);
    t += ORNN_FAIL_HOLD_MS - 1; await s.rows("volume");
    expect(n.count(DAILY)).toBe(1);
    t += 1; await s.rows("volume");
    expect(n.count(DAILY)).toBe(2);
  });
});
