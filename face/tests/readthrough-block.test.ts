// face/tests/readthrough-block.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { etMinute, pctText, renderBlock, renderLater } from "../plugins/readthrough/lib/block.mjs";

/** 04:03 ET on Monday 2026-11-09. */
const AT = "2026-11-09T09:03:10.000Z";
const D = {
  symbol: "NVDA", basis: "company", event: "董事会对 CEO 启动独立调查", sources: ["NVIDIA newsroom 11-08 18:00 ET", "8-K 11-09 06:02 ET"],
  logic: "调查带来供应不确定 → 客户找备选",
  peers: [{ symbol: "AMD", reason: "数据中心 GPU 的直接替代" }, { symbol: "AVGO", reason: "云厂商自研芯片的设计伙伴" }],
  noDirection: null, counter: "调查针对个人，不改变产品和产能", certainty: "medium",
};
const t = (symbol: string, changePct: number | null, traded = true, feed = "robinhood", asOf: string | null = AT) => ({ symbol, changePct, feed, asOf, traded });
const TAPE = [t("NVDA", -7.31), t("AMD", 5.44), t("AVGO", 1.2), t("SPY", -0.36)];

test("pctText signs with + and U+2212, one decimal, and writes zero bare", () => {
  assert.deepEqual([pctText(5.44), pctText(-7.31), pctText(0.04), pctText(-0.04)], ["+5.4%", "−7.3%", "0.0%", "0.0%"]);
  assert.equal(etMinute(AT), "04:03");
});

test("the block under an alert: head, logic, direction, tape with one shared stamp, counter", () => {
  assert.equal(renderBlock({ direction: D, tape: TAPE, shut: false, forTask: false }), [
    "推演 · Gravit 的推断，不是下单 · 确定度 中",
    "· 逻辑：调查带来供应不确定 → 客户找备选",
    "· 方向：做多 AMD（数据中心 GPU 的直接替代）；做多 AVGO（云厂商自研芯片的设计伙伴）",
    "· 盘面：NVDA −7.3% · AMD +5.4% · AVGO +1.2% · SPY −0.4%（ROBINHOOD 04:03 ET）",
    "· 反方：调查针对个人，不改变产品和产能",
  ].join("\n"));
});

test("prints of different feeds or minutes each carry their stamp; one not of the session reads 未成交", () => {   // Review Focus 2
  const tape = [t("NVDA", -7.31), t("AMD", 5.44, true, "nasdaq", "2026-11-09T09:01:40.000Z"), t("AVGO", null, false), t("SPY", 0.2, false)];
  const line = renderBlock({ direction: D, tape, shut: false, forTask: false }).split("\n")[3];
  assert.equal(line, "· 盘面：NVDA −7.3%（ROBINHOOD 04:03 ET） · AMD +5.4%（NASDAQ 04:01 ET） · AVGO 未成交 · SPY 未成交");
});

test("a shut market, the certainty words, and a task's two extra lines", () => {
  const task = renderBlock({ direction: { ...D, certainty: "high" }, tape: TAPE, shut: true, forTask: true }).split("\n");
  assert.deepEqual([task[0], task[1], task[4], task[6]], [
    "推演 · Gravit 的推断，不是下单 · 确定度 高", "· 事件：董事会对 CEO 启动独立调查",
    "· 盘面：休市，事件之后还没有成交", "来源：NVIDIA newsroom 11-08 18:00 ET · 8-K 11-09 06:02 ET",
  ]);
  assert.ok(renderBlock({ direction: { ...D, certainty: "low" }, tape: TAPE, shut: false, forTask: false }).startsWith("推演 · Gravit 的推断，不是下单 · 确定度 低\n"));
});

test("no direction is one line under an alert, three for a task", () => {
  const none = { ...D, peers: [], counter: null, noDirection: "这是全行业的事，对手一起受累" };
  assert.equal(renderBlock({ direction: none, tape: TAPE, shut: false, forTask: false }), "推演：没有方向 —— 这是全行业的事，对手一起受累");
  assert.equal(renderBlock({ direction: none, tape: TAPE, shut: false, forTask: true }).split("\n").length, 3);
});

test("a later alert's line re-prices each rival from its recorded print; no figure without both prints", () => {
  assert.equal(
    renderLater({ givenAt: AT, peers: [{ symbol: "AMD", then: 473.39, now: 502.8 }, { symbol: "AVGO", then: null, now: 300 }, { symbol: "INTC", then: 40, now: 39.5 }] }),
    "推演（04:03 ET 已给）：做多 AMD，此后 +6.2%；做多 AVGO；做多 INTC，此后 −1.3%",
  );
  assert.equal(renderLater({ givenAt: AT, peers: [] }), null);
});
