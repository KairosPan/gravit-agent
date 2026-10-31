/**
 * The composition check of `lunhui_present`, `plugins/lunhui/lib/present.mjs`: `checkPresent`
 * against the synthetic sealed 10-27 run's view and digest (`syntheticSealedRun()`), and
 * `unsupportedNumbers`, the digest number rule - a number Gravit writes in another form than the
 * digest's ("4,774", "1.3%", "41%" for 0.41, full-width digits) is found, one the digest does not
 * hold is named.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildView, viewDigest } from "../plugins/lunhui/lib/view.mjs";
import { checkPresent, unsupportedNumbers } from "../plugins/lunhui/lib/present.mjs";
import { syntheticSealedRun } from "./lunhui-view-fixtures.ts";

const sealed = syntheticSealedRun();
const view = buildView(sealed);
const digest = viewDigest(view);

const ok = (over = {}) => ({ strategy: "cn-market", run: sealed.run, summary: "普跌的一天：567 家上涨、4,774 家下跌。",
  blocks: [{ kind: "verdicts" }, { kind: "breadth", title: "近九成个股下跌" },
    { kind: "indices", title: "14:00 后放量跳水", focus: { from: "14:00", to: "15:00" } },
    { kind: "ladder", title: "断在 3 板：昨天 8 个 2 板", focus: { rung: 3 } }, { kind: "sources" }], choices: [], ...over });

test("an ok composition returns its kinds and the run's market modules", () => {
  assert.deepEqual(checkPresent(ok(), { view, digest, manifest: sealed.manifest }),
    { blocks: ["verdicts", "breadth", "indices", "ladder", "sources"], modules: ["environment", "sentiment", "theme", "counterevidence"] });
});
test("numbers in other forms are found in the digest", () => {
  assert.deepEqual(unsupportedNumbers(["上证跌 1.3%，跌 1.33%", "炸板率 41%", "成交约 1.5 万亿", "１４:００ 后"], digest, new Set()), []);
});
test("numbers the digest does not hold are named", () => {
  assert.deepEqual(unsupportedNumbers(["近九成 88.8%", "上证跌 2.1%", "１４:３７"], digest, new Set()), ["88.8%", "2.1%", "14:37"]);
});
test("run ids, dates and pool codes are exempt", () => {
  assert.deepEqual(unsupportedNumbers([`${sealed.run} 2026-10-27 10-27 10月27日 600001`], digest, new Set(Object.keys(view.stocks))), []);
});
test("each rule refuses with its field", () => {
  const refuse = (args: any, field: string) => assert.throws(() => checkPresent(args, { view, digest, manifest: sealed.manifest }),
    (e: any) => e.code === "INVALID_PRESENT" && e.message.startsWith(`INVALID_PRESENT: ${field}`));
  refuse(ok({ summary: "" }), "summary");
  refuse(ok({ blocks: [] }), "blocks");
  refuse(ok({ blocks: [{ kind: "sources" }, { kind: "sources" }] }), "blocks");
  refuse(ok({ module: "environment" }), "blocks[3].kind");
  refuse(ok({ blocks: [{ kind: "ladder", title: "x".repeat(41) }] }), "blocks[0].title");
  refuse(ok({ blocks: [{ kind: "ladder" }] }), "blocks[0].title");
  refuse(ok({ blocks: [{ kind: "ladder", title: "梯队", focus: { rung: 9 } }] }), "blocks[0].focus");
  refuse(ok({ blocks: [{ kind: "indices", title: "指数", focus: { from: "15:00", to: "14:00" } }] }), "blocks[0].focus");
  refuse(ok({ blocks: [{ kind: "breadth", title: "涨跌", focus: { rung: 1 } }] }), "blocks[0].focus");
  refuse(ok({ choices: [{ label: "a" }, { label: "b" }, { label: "c" }, { label: "d" }] }), "choices");
  refuse(ok({ choices: [{ label: "打开", stock: "999999" }] }), "choices[0].stock");
  refuse(ok({ summary: "近九成个股下跌 88.8%" }), "numbers");
});
test("a strategy run is refused", () => {
  assert.throws(() => checkPresent(ok(), { view, digest, manifest: { ...sealed.manifest, kind: "strategy" } }), (e: any) => e.code === "NOT_A_MARKET_RUN");
});
test("an undrawable block is refused with the view's reason", () => {
  const noIndex = buildView({ ...sealed, manifest: { ...sealed.manifest, evidence: sealed.manifest.evidence.filter((e: any) => e.source !== "index") },
    evidence: sealed.evidence.filter((e: any) => e.source !== "index") });
  assert.throws(() => checkPresent(ok({ summary: "普跌" , blocks: [{ kind: "indices", title: "指数" }] }), { view: noIndex, digest: viewDigest(noIndex), manifest: sealed.manifest }),
    (e: any) => e.code === "INVALID_PRESENT" && /index not frozen/.test(e.message));
});
test("a card run's module narrows the modules", () => {
  assert.deepEqual(checkPresent(ok({ module: "sentiment", blocks: [{ kind: "ladder", title: "断在 3 板" }] }), { view, digest, manifest: sealed.manifest }).modules, ["sentiment"]);
});
