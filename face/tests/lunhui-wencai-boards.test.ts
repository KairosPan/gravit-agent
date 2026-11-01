/** The stand-in's boards from one universe: eligibility, per-board numbers, the three lists. */
import test from "node:test";
import assert from "node:assert/strict";
import { deriveStandInBoards } from "../plugins/lunhui/lib/wencai-boards.mjs";
import { EXCLUDED_CONCEPTS, exclusionReason } from "../plugins/lunhui/lib/wencai-excluded.mjs";

type Row = { code: string; name: string | null; pct: number | null; amount: number | null; mainNet: number | null; concepts: string[] };
const row = (i: number, concepts: string[], pct: number | null = 1, amount: number | null = 100, mainNet: number | null = 10, name: string | null = `n${i}`): Row => ({
  code: String(600000 + i), name, pct, amount, mainNet, concepts,
});
const many = (n: number, concepts: string[], f: (i: number) => Partial<Row> = () => ({}), start = 0): Row[] =>
  Array.from({ length: n }, (_, k) => ({ ...row(start + k, concepts), ...f(k) }));

test("eligible concepts have ten members and are not excluded", () => {
  const rows = [
    ...many(10, ["人形机器人", "融资融券"], () => ({}), 0),
    ...many(9, ["青蒿素"], () => ({}), 100),
    ...many(10, ["2026中报预增"], () => ({}), 200),
  ];
  const { boards } = deriveStandInBoards(rows);
  assert.deepEqual(boards.map((b) => b.name), ["人形机器人"]);
  assert.equal(boards[0].code, "THS:人形机器人");
});

test("a board's numbers come from its members", () => {
  const pcts = [5, 3, 3, 1, -1, -2, 0, 2, 4, 6];
  const rows = pcts.map((p, i) => row(i, ["X"], p, i === 9 ? 500 : 100, 10, `s${i}`));
  rows[0] = { ...rows[0], pct: 6, amount: 100, name: "tieSmall" }; // ties with row 9 at 6, smaller turnover
  const [b] = deriveStandInBoards(rows).boards;
  assert.equal(b.pct, (6 + 3 + 3 + 1 - 1 - 2 + 0 + 2 + 4 + 6) / 10);
  assert.equal(b.advancers, 7);
  assert.equal(b.decliners, 2);
  assert.equal(b.amount, 100 * 9 + 500);
  assert.equal(b.leader, "s9");
});

test("leader falls back to the code when the name is null", () => {
  const rows = many(10, ["X"], (i) => ({ pct: i, name: i === 9 ? null : `n${i}` }));
  assert.equal(deriveStandInBoards(rows).boards[0].leader, "600009");
});

test("three lists in the spec's order and bounds", () => {
  const rows: Row[] = [];
  for (let c = 0; c < 35; c++) rows.push(...many(10, [`C${c}`], () => ({ pct: c, mainNet: c * 10, amount: 200 }), c * 10));
  rows.push(...many(105, ["BIG"], (i) => ({ pct: 100, mainNet: 0, amount: 200 + i }), 1000));
  const r = deriveStandInBoards(rows);
  assert.equal(r.boards.length, 30);
  assert.equal(r.boards[0].name, "BIG");
  assert.deepEqual(r.boards.slice(1, 4).map((b) => b.name), ["C34", "C33", "C32"]);
  assert.equal(r.members.length, 10);
  assert.equal(r.members[0].board, "THS:BIG");
  assert.equal(r.members[0].members.length, 100);
  assert.equal(r.members[0].truncated, true);
  assert.equal(r.members[1].truncated, false);
  assert.equal(r.flow.length, 30);
  assert.equal(r.flow[0].name, "C34");
  assert.equal(r.flow[0].mainNet, 3400);
  assert.equal(r.flow[0].mainShare, (3400 / 2000) * 100);
  const mem = r.members[1].members;
  assert.deepEqual(mem.map((m) => m.pct), [...mem.map((m) => m.pct)].sort((a, b) => (b as number) - (a as number)));
});

test("rows without concepts or numbers count nowhere they cannot", () => {
  const rows = [
    ...many(10, ["X"], (i) => ({ pct: i < 9 ? 2 : null, amount: i === 0 ? null : 100, mainNet: null })),
    row(99, [], 9),
  ];
  const r = deriveStandInBoards(rows);
  assert.equal(r.boards.length, 1);
  assert.equal(r.boards[0].pct, 2);
  assert.equal(r.boards[0].advancers, 9);
  assert.equal(r.boards[0].decliners, 0);
  assert.equal(r.boards[0].amount, 900);
  assert.equal(r.members[0].members.length, 10);
  assert.equal(r.members[0].members.at(-1)!.pct, null);
  const zero = deriveStandInBoards(many(10, ["Z"], () => ({ amount: 0, mainNet: 5 })));
  assert.equal(zero.flow[0].mainShare, null);
  assert.equal(deriveStandInBoards(many(10, ["Z"], () => ({ amount: null }))).flow[0].mainShare, null);
});

test("every exclusion has a reason", () => {
  assert.ok(EXCLUDED_CONCEPTS.size > 15);
  for (const [name, reason] of EXCLUDED_CONCEPTS) assert.ok(name && reason.length > 3, name);
  for (const n of ["2026中报预增", "2025年报预增", "2026三季报预增"]) assert.ok(exclusionReason(n), n);
  for (const n of ["融资融券", "深股通", "ST板块", "同花顺漂亮100"]) assert.ok(exclusionReason(n), n);
  for (const n of ["人形机器人", "白酒概念", "CRO概念", "青蒿素"]) assert.equal(exclusionReason(n), undefined, n);
});
