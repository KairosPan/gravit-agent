import test from "node:test";
import assert from "node:assert/strict";
import { beijingDate, cnPhase, parseMarketStat, readCnSession, sessionFromReply } from "../src/cn-session.ts";

// the reply measured 2026-10-31 (a Saturday), cut to the fields read
const CLOSED = 'v_marketStat="2026-10-31 14:46:10|HK_close_已休市|SH_close_已休市|SZ_close_已休市|KCB_close_已休市|CYB_close_已休市";\n'
  + 'v_sh000001="1~上证指数~000001~3599.02~3651.43~' + "~".repeat(25) + '20261030161400~-52.41";\n';
const FRI_10 = Date.parse("2026-10-30T02:00:00Z"), FRI_12 = Date.parse("2026-10-30T04:00:00Z");
const FRI_1530 = Date.parse("2026-10-30T07:30:00Z"), SAT_10 = Date.parse("2026-10-31T02:00:00Z");

test("parseMarketStat reads SH's token, else SZ's, never the Chinese words", () => {
  assert.equal(parseMarketStat(CLOSED), "closed");
  assert.equal(parseMarketStat('v_marketStat="2026-11-02 10:00:00|SH_open_交易中|SZ_open_交易中";'), "open");
  assert.equal(parseMarketStat('v_marketStat="2026-11-02 10:00:00|SZ_close_x";'), "closed");
  assert.equal(parseMarketStat("<html>busy</html>"), null);
});

test("beijingDate takes a Tencent time's date", () => {
  assert.equal(beijingDate("20261030161400"), "2026-10-30");
  assert.equal(beijingDate("2026-10-30"), null);
  assert.equal(beijingDate(undefined), null);
});

test("cnPhase: Tencent says open or closed, the Beijing clock says lunch", () => {
  assert.equal(cnPhase(FRI_10, "open", "2026-10-30"), "trading");
  assert.equal(cnPhase(FRI_12, "open", "2026-10-30"), "midday");
  assert.equal(cnPhase(FRI_12, "closed", "2026-10-30"), "midday");
  assert.equal(cnPhase(FRI_12, "closed", "2026-10-29"), "closed");
  assert.equal(cnPhase(SAT_10, "closed", "2026-10-30"), "closed");
});

test("cnPhase without Tencent's word falls back to the Beijing clock", () => {
  assert.equal(cnPhase(FRI_10, null, null), "trading");
  assert.equal(cnPhase(FRI_12, null, null), "midday");
  assert.equal(cnPhase(FRI_1530, null, null), "closed");
  assert.equal(cnPhase(SAT_10, null, null), "closed");
});

test("sessionFromReply and readCnSession: one GET for marketStat and sh000001; a failure falls back", async () => {
  assert.deepEqual(sessionFromReply(CLOSED, SAT_10), { phase: "closed", lastSession: "2026-10-30" });
  const urls: string[] = [];
  const read = await readCnSession(async (url) => { urls.push(url.href); return new Response(CLOSED); }, SAT_10);
  assert.deepEqual(urls, ["https://qt.gtimg.cn/q=marketStat,sh000001"]);
  assert.deepEqual(read, { phase: "closed", lastSession: "2026-10-30" });
  assert.deepEqual(await readCnSession(async () => { throw new Error("down"); }, FRI_10), { phase: "trading", lastSession: null });
});

test("the session's own limits equal the quote wire's (minor #8)", async () => {
  const { SESSION_RESPONSE_LIMIT, SESSION_TIMEOUT_MS } = await import("../src/cn-session.ts");
  const { QUOTE_RESPONSE_LIMIT, QUOTE_TIMEOUT_MS } = await import("../src/quote-snapshots.ts");
  assert.deepEqual([SESSION_RESPONSE_LIMIT, SESSION_TIMEOUT_MS], [QUOTE_RESPONSE_LIMIT, QUOTE_TIMEOUT_MS]);
});
