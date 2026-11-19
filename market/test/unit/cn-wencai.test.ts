import { describe, expect, it } from "vitest";
import type { IfindAnswer, IfindPicker } from "../../src/live/cn-ifind.ts";
import {
  createWencai, tableOf, wencaiPerDay, WENCAI_DEADLINE_MS, WENCAI_KEEP_MS, WENCAI_LIMIT_DEFAULT, WENCAI_WINDOW_MS,
  type WencaiAnswer,
} from "../../src/live/cn-wencai.ts";

const COL = "区间涨跌幅:前复权[20260928-20261118]";
const SHAPE = { errorcode: 0, tables: [{ table: { "股票代码": ["002242.SZ", "301313.SZ"], [COL]: [202.13, 112.8] } }], dataVol: 300, perf: 161 };
const bytesOf = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));
const upstream = (o: unknown, status = 200): IfindAnswer => ({ kind: "upstream", status, contentType: "application/json", bytes: bytesOf(o) });

// ---- a picker that records what it was asked and answers from a script; a clock the test moves ---------------------------------------
type Step = { answer: IfindAnswer; asked?: number } | IfindAnswer;
function rig(script: Step[] = [], o: { perDay?: number; configured?: boolean } = {}) {
  const clock = { t: Date.UTC(2026, 10, 19, 5, 0, 0) };
  const calls: Array<{ searchstring: string; searchtype: string; deadlineMs: number }> = [];
  const gates: Array<() => void> = [];
  const state = { hold: false };
  const picker: IfindPicker = {
    async pick(searchstring, searchtype, deadlineMs) {
      calls.push({ searchstring, searchtype, deadlineMs });
      if (state.hold) await new Promise<void>((r) => gates.push(r));
      const next = script.shift() ?? { answer: upstream(SHAPE), asked: 1 };
      return "answer" in next ? { answer: next.answer, asked: next.asked ?? 1 } : { answer: next, asked: next.kind === "upstream" ? 1 : 0 };
    },
  };
  const w = createWencai({ picker, configured: () => o.configured ?? true, perDay: o.perDay ?? 100, now: () => clock.t });
  return { w, calls, clock, state, gates };
}
const ok = (a: WencaiAnswer) => { if (a.kind !== "ok") throw new Error(`refused: ${JSON.stringify(a)}`); return a.body; };
const refused = (a: WencaiAnswer) => { if (a.kind !== "refused") throw new Error("answered ok"); return a; };

describe("tableOf", () => {
  it("turns the 2026-11-19 shape into columns and rows, the first `limit` of them", () => {
    expect(tableOf(SHAPE, 1)).toEqual({ columns: ["股票代码", COL], rows: [["002242.SZ", 202.13]], rowCount: 2, returned: 1, truncated: true });
    expect(tableOf(SHAPE, 50)).toEqual({ columns: ["股票代码", COL], rows: [["002242.SZ", 202.13], ["301313.SZ", 112.8]], rowCount: 2, returned: 2, truncated: false });
  });

  it("cuts a cell longer than 200 characters to 199 and an ellipsis, and says truncated", () => {
    const long = "概".repeat(250);
    const t = tableOf({ errorcode: 0, tables: [{ table: { a: ["x"], b: [long] } }] }, 50)!;
    const cell = t.rows[0]![1] as string;
    expect(cell).toBe(`${"概".repeat(199)}…`);
    expect([...cell].length).toBe(200);
    expect(t.truncated).toBe(true);
    expect(t.returned).toBe(t.rowCount);
    // exactly 200 characters is not cut
    expect(tableOf({ errorcode: 0, tables: [{ table: { a: ["y".repeat(200)] } }] }, 50)).toMatchObject({ rows: [["y".repeat(200)]], truncated: false });
  });

  it("passes cell values as they come: numbers as strings, ranks, nulls", () => {
    const t = tableOf({ errorcode: 0, tables: [{ table: { a: ["30", "1/5584", null], b: [-0.23, 7, 8] } }] }, 50)!;
    expect(t.rows).toEqual([["30", -0.23], ["1/5584", 7], [null, 8]]);
  });

  it("gives ragged columns the longest column's count and null in the missing cells", () => {
    expect(tableOf({ errorcode: 0, tables: [{ table: { a: [1, 2, 3], b: ["x"] } }] }, 50))
      .toEqual({ columns: ["a", "b"], rows: [[1, "x"], [2, null], [3, null]], rowCount: 3, returned: 3, truncated: false });
  });

  it("answers no rows for an empty tables list or a table of empty columns", () => {
    expect(tableOf({ errorcode: 0, tables: [] }, 50)).toEqual({ columns: [], rows: [], rowCount: 0, returned: 0, truncated: false });
    expect(tableOf({ errorcode: 0, tables: [{ table: { a: [], b: [] } }] }, 50))
      .toEqual({ columns: ["a", "b"], rows: [], rowCount: 0, returned: 0, truncated: false });
  });

  it("reads the first of two tables and says how many came", () => {
    const t = tableOf({ errorcode: 0, tables: [{ table: { a: [1] } }, { table: { z: [9, 9] } }] }, 50);
    expect(t).toEqual({ columns: ["a"], rows: [[1]], rowCount: 1, returned: 1, truncated: false, tables: 2 });
  });

  it("is null for a reply that is not errorcode 0 with tables", () => {
    expect(tableOf({ errorcode: -4001, errmsg: "no data." }, 50)).toBeNull();
    expect(tableOf({ errorcode: 0 }, 50)).toBeNull();
    expect(tableOf(null, 50)).toBeNull();
    expect(tableOf("x", 50)).toBeNull();
  });
});

describe("createWencai: validation", () => {
  it.each(["", "   ", "a".repeat(301), "涨幅\n排名", "tab\there", "del\u007f", 42, undefined])("refuses the question %j as bad-question", async (question) => {
    const r = rig();
    const a = refused(await r.w.ask({ question }));
    expect(a.word).toBe("bad-question");
    expect(r.calls).toHaveLength(0);
  });

  it("refuses a type outside stock and fund", async () => {
    const r = rig();
    for (const type of ["hkstock", "Stock", 1]) expect(refused(await r.w.ask({ question: "q", type })).word).toBe("bad-type");
    expect(r.calls).toHaveLength(0);
  });

  it.each([0, 201, 1.5, "50", -1, Number.NaN])("refuses the limit %j as bad-question, naming limit", async (limit) => {
    const r = rig();
    const a = refused(await r.w.ask({ question: "q", limit }));
    expect(a.word).toBe("bad-question");
    expect(a.message).toContain("limit");
    expect(r.calls).toHaveLength(0);
  });

  it("hands the picker the question unchanged and trimmed, the type, and the 30 s deadline", async () => {
    const r = rig();
    const q = '  涨幅 "前20" 50% & 成交额，从大到小  ';
    const body = ok(await r.w.ask({ question: q, type: "fund" }));
    expect(r.calls).toEqual([{ searchstring: '涨幅 "前20" 50% & 成交额，从大到小', searchtype: "fund", deadlineMs: 30_000 }]);
    expect(WENCAI_DEADLINE_MS).toBe(30_000);
    expect(body.question).toBe('涨幅 "前20" 50% & 成交额，从大到小');
    expect(body.type).toBe("fund");
  });

  it("defaults to stock and 50 rows", async () => {
    const many = { errorcode: 0, tables: [{ table: { a: Array.from({ length: 80 }, (_, i) => i) } }] };
    const r = rig([upstream(many)]);
    const body = ok(await r.w.ask({ question: "q" }));
    expect(r.calls[0]!.searchtype).toBe("stock");
    expect(WENCAI_LIMIT_DEFAULT).toBe(50);
    expect(body).toMatchObject({ ok: true, type: "stock", rowCount: 80, returned: 50, truncated: true });
    expect(body.rows).toHaveLength(50);
    expect(body.asOf).toBe(new Date(r.clock.t).toISOString());
    expect(body).not.toHaveProperty("dataVol");
  });

  it("accepts 300 characters and the limit's ends", async () => {
    const r = rig();
    ok(await r.w.ask({ question: "a".repeat(300), limit: 1 }));
    ok(await r.w.ask({ question: "b", limit: 200 }));
    expect(r.calls).toHaveLength(2);
  });
});

describe("createWencai: words", () => {
  it("is unconfigured, asking nothing, when iFinD is not configured", async () => {
    const r = rig([], { configured: false });
    expect(refused(await r.w.ask({ question: "q" })).word).toBe("unconfigured");
    expect(r.calls).toHaveLength(0);
    expect(r.w.enabled()).toBe(false);
  });

  it("is off at perDay 0, before unconfigured", async () => {
    const r = rig([], { perDay: 0, configured: false });
    expect(refused(await r.w.ask({ question: "q" })).word).toBe("off");
    expect(r.calls).toHaveLength(0);
    expect(r.w.enabled()).toBe(false);
    expect(rig().w.enabled()).toBe(true);
  });

  it("validates before off", async () => {
    const r = rig([], { perDay: 0 });
    expect(refused(await r.w.ask({ question: "" })).word).toBe("bad-question");
  });

  it("passes the picker's credential refusal with the renewal message", async () => {
    const r = rig([{ kind: "refused", word: "credential" }]);
    const a = refused(await r.w.ask({ question: "q" }));
    expect(a).toEqual({
      kind: "refused", word: "credential",
      message: "iFinD refused the account's token: the account may have expired. Renew it at iFinD, write the new refresh token into .env.ifind, then restart the market.",
    });
  });

  it.each(["timeout", "too-large", "unreachable"] as const)("passes the picker's %s as the same word", async (word) => {
    const r = rig([{ kind: "refused", word }]);
    const a = refused(await r.w.ask({ question: "q" }));
    expect(a.word).toBe(word);
    expect(a.message).not.toMatch(/https?:|51ifind|token/i);
  });

  it.each([-1302, -1301])("answers credential for an upstream errorcode %i", async (errorcode) => {
    const r = rig([upstream({ errorcode, errmsg: "x" })]);
    expect(refused(await r.w.ask({ question: "q" })).word).toBe("credential");
  });

  it("answers upstream with iFinD's code and errmsg as detail", async () => {
    const r = rig([upstream({ errorcode: -4001, errmsg: "no data." })]);
    const a = refused(await r.w.ask({ question: "q" }));
    expect(a.word).toBe("upstream");
    expect(a.detail).toEqual({ errorcode: -4001, errmsg: "no data." });
  });

  it("cuts a long errmsg to 200 characters", async () => {
    const r = rig([upstream({ errorcode: -9, errmsg: "e".repeat(500) })]);
    const a = refused(await r.w.ask({ question: "q" }));
    expect([...a.detail!.errmsg].length).toBe(200);
    expect(a.message.length).toBeLessThan(300);
  });

  it("answers upstream with a null errorcode for an HTTP 500 or bytes that are not JSON", async () => {
    const r = rig([
      upstream({ errorcode: 0 }, 500),
      { kind: "upstream", status: 200, bytes: new TextEncoder().encode("<html>busy</html>") },
    ]);
    const a = refused(await r.w.ask({ question: "q" }));
    expect(a.word).toBe("upstream");
    expect(a.detail).toMatchObject({ errorcode: null });
    expect(a.detail!.errmsg).toContain("500");
    const b = refused(await r.w.ask({ question: "q" }));
    expect(b.word).toBe("upstream");
    expect(b.detail).toMatchObject({ errorcode: null });
  });

  it("answers upstream for errorcode 0 without tables", async () => {
    const r = rig([upstream({ errorcode: 0, errmsg: "" })]);
    expect(refused(await r.w.ask({ question: "q" })).word).toBe("upstream");
  });

  it("answers ok with no rows for errorcode 0 and empty tables", async () => {
    const r = rig([upstream({ errorcode: 0, tables: [] })]);
    expect(ok(await r.w.ask({ question: "q" }))).toMatchObject({ rowCount: 0, rows: [], truncated: false });
  });
});

describe("createWencai: the budget", () => {
  it("refuses the third ask in 24 h at cap 2 and frees at exactly 24 h after the first call", async () => {
    const r = rig([], { perDay: 2 });
    expect(r.w.budget()).toEqual({ used: 0, cap: 2, resetsAt: null });
    const first = r.clock.t;
    expect(ok(await r.w.ask({ question: "q1" })).budget).toEqual({ used: 1, cap: 2, resetsAt: new Date(first + WENCAI_WINDOW_MS).toISOString() });
    r.clock.t += 1_000;
    expect(ok(await r.w.ask({ question: "q2" })).budget.used).toBe(2);
    r.clock.t += 1_000;
    const a = refused(await r.w.ask({ question: "q3" }));
    expect(a.word).toBe("budget");
    expect(a.message).toBe(`2 of 2 问财 calls spent in the last 24 hours; the next one frees at ${new Date(first + WENCAI_WINDOW_MS).toISOString()}`);
    expect(r.calls).toHaveLength(2);
    r.clock.t = first + WENCAI_WINDOW_MS - 1;
    expect(refused(await r.w.ask({ question: "q3" })).word).toBe("budget");
    r.clock.t = first + WENCAI_WINDOW_MS;
    expect(ok(await r.w.ask({ question: "q3" })).budget.used).toBe(2);
    expect(r.calls).toHaveLength(3);
  });

  it("counts what the picker says it asked", async () => {
    const r = rig([{ answer: upstream(SHAPE), asked: 2 }, { answer: { kind: "refused", word: "unconfigured" }, asked: 0 }], { perDay: 5 });
    await r.w.ask({ question: "q1" });
    expect(r.w.budget().used).toBe(2);
    await r.w.ask({ question: "q2" });
    expect(r.w.budget().used).toBe(2);
  });

  it("counts a refused pick's calls too", async () => {
    const r = rig([{ answer: { kind: "refused", word: "timeout" }, asked: 1 }], { perDay: 5 });
    await r.w.ask({ question: "q" });
    expect(r.w.budget().used).toBe(1);
  });
});

describe("createWencai: the keep", () => {
  it("answers the same ask within a minute from memory, with the first read's asOf and the current budget", async () => {
    const r = rig();
    const one = ok(await r.w.ask({ question: "q" }));
    expect(one.budget.used).toBe(1);
    r.clock.t += 1_000;
    // another question answered between the first read and the kept hit spends a second call
    ok(await r.w.ask({ question: "other" }));
    r.clock.t = Date.parse(one.asOf) + WENCAI_KEEP_MS - 1;
    const two = ok(await r.w.ask({ question: " q ", type: "stock" }));
    expect(r.calls).toHaveLength(2);
    expect(two.asOf).toBe(one.asOf);
    expect(two.rows).toEqual(one.rows);
    expect(two.budget.used).toBe(2);
    expect(two.budget).toEqual(r.w.budget());
    r.clock.t += 1;
    ok(await r.w.ask({ question: "q" }));
    expect(r.calls).toHaveLength(3);
  });

  it("keys by type and limit as well as the question", async () => {
    const r = rig();
    await r.w.ask({ question: "q" });
    await r.w.ask({ question: "q", type: "fund" });
    await r.w.ask({ question: "q", limit: 10 });
    expect(r.calls).toHaveLength(3);
  });

  it("shares one flight between two identical asks at once", async () => {
    const r = rig();
    r.state.hold = true;
    const a = r.w.ask({ question: "q" }), b = r.w.ask({ question: "q" });
    await Promise.resolve();
    r.gates.splice(0).forEach((g) => g());
    const [x, y] = await Promise.all([a, b]);
    expect(r.calls).toHaveLength(1);
    expect(ok(x).asOf).toBe(ok(y).asOf);
    expect(r.w.budget().used).toBe(1);
  });

  it("keeps no refusal: a timeout then the same ask asks again", async () => {
    const r = rig([{ kind: "refused", word: "timeout" }]);
    expect(refused(await r.w.ask({ question: "q" })).word).toBe("timeout");
    ok(await r.w.ask({ question: "q" }));
    expect(r.calls).toHaveLength(2);
  });

  it("answers a kept hit while the budget is spent, spending nothing", async () => {
    const r = rig([], { perDay: 1 });
    ok(await r.w.ask({ question: "q" }));
    expect(refused(await r.w.ask({ question: "other" })).word).toBe("budget");
    const kept = ok(await r.w.ask({ question: "q" }));
    expect(kept.budget.used).toBe(1);
    expect(r.calls).toHaveLength(1);
  });
});

describe("wencaiPerDay", () => {
  it("reads MARKET_WENCAI_PER_DAY, a non-negative integer, else 100", () => {
    expect(wencaiPerDay({})).toBe(100);
    expect(wencaiPerDay({ MARKET_WENCAI_PER_DAY: "0" })).toBe(0);
    expect(wencaiPerDay({ MARKET_WENCAI_PER_DAY: "250" })).toBe(250);
    for (const v of ["-1", "1.5", "abc", "", " 5", "1e3"]) expect(wencaiPerDay({ MARKET_WENCAI_PER_DAY: v })).toBe(100);
  });
});
