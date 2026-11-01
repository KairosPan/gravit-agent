import { describe, expect, it } from "vitest";
import type { CnHttp } from "../../src/portfolio/live/cn-http.ts";
import { QUOTE_RESPONSE_LIMIT, QUOTE_TIMEOUT_MS } from "../../src/portfolio/live/cn-quotes.ts";
import { beijingDate, cnPhase, parseMarketStat, readCnSession, SESSION_RESPONSE_LIMIT, SESSION_TIMEOUT_MS, sessionFromReply } from "../../src/portfolio/live/cn-session.ts";

// the reply measured 2026-10-31 (a Saturday), cut to the fields read
const CLOSED = 'v_marketStat="2026-10-31 14:46:10|HK_close_已休市|SH_close_已休市|SZ_close_已休市|KCB_close_已休市|CYB_close_已休市";\n'
  + 'v_sh000001="1~上证指数~000001~3599.02~3651.43~' + "~".repeat(25) + '20261030161400~-52.41";\n';
const FRI_10 = Date.parse("2026-10-30T02:00:00Z"), FRI_12 = Date.parse("2026-10-30T04:00:00Z");
const FRI_1530 = Date.parse("2026-10-30T07:30:00Z"), SAT_10 = Date.parse("2026-10-31T02:00:00Z");

describe("cn-session", () => {
  it("parseMarketStat reads SH's token, else SZ's, never the Chinese words", () => {
    expect(parseMarketStat(CLOSED)).toBe("closed");
    expect(parseMarketStat('v_marketStat="2026-11-02 10:00:00|SH_open_交易中|SZ_open_交易中";')).toBe("open");
    expect(parseMarketStat('v_marketStat="2026-11-02 10:00:00|SZ_close_x";')).toBe("closed");
    expect(parseMarketStat("<html>busy</html>")).toBeNull();
  });

  it("beijingDate takes a Tencent time's date", () => {
    expect(beijingDate("20261030161400")).toBe("2026-10-30");
    expect(beijingDate("2026-10-30")).toBeNull();
    expect(beijingDate(undefined)).toBeNull();
  });

  it("cnPhase: Tencent says open or closed, the Beijing clock says lunch", () => {
    expect(cnPhase(FRI_10, "open", "2026-10-30")).toBe("trading");
    expect(cnPhase(FRI_12, "open", "2026-10-30")).toBe("midday");
    expect(cnPhase(FRI_12, "closed", "2026-10-30")).toBe("midday");
    expect(cnPhase(FRI_12, "closed", "2026-10-29")).toBe("closed");
    expect(cnPhase(SAT_10, "closed", "2026-10-30")).toBe("closed");
  });

  it("cnPhase without Tencent's word falls back to the Beijing clock", () => {
    expect(cnPhase(FRI_10, null, null)).toBe("trading");
    expect(cnPhase(FRI_12, null, null)).toBe("midday");
    expect(cnPhase(FRI_1530, null, null)).toBe("closed");
    expect(cnPhase(SAT_10, null, null)).toBe("closed");
  });

  it("sessionFromReply and readCnSession: one GET for marketStat and sh000001; a failure falls back", async () => {
    expect(sessionFromReply(CLOSED, SAT_10)).toEqual({ phase: "closed", lastSession: "2026-10-30" });
    const urls: string[] = [];
    const http: CnHttp = async (url) => { urls.push(url); return { status: 200, bytes: new Uint8Array(Buffer.from(CLOSED)) }; };
    expect(await readCnSession(http, SAT_10)).toEqual({ phase: "closed", lastSession: "2026-10-30" });
    expect(urls).toEqual(["https://qt.gtimg.cn/q=marketStat,sh000001"]);
    expect(await readCnSession(async () => { throw new Error("down"); }, FRI_10)).toEqual({ phase: "trading", lastSession: null });
    expect(await readCnSession(async () => ({ status: 502, bytes: new Uint8Array() }), FRI_10)).toEqual({ phase: "trading", lastSession: null });
  });

  it("the session's own limits equal the quote wire's", () => {
    expect([SESSION_RESPONSE_LIMIT, SESSION_TIMEOUT_MS]).toEqual([QUOTE_RESPONSE_LIMIT, QUOTE_TIMEOUT_MS]);
  });
});
