import { describe, expect, it } from "vitest";
import { mergeMovers, parseTencentRank, rankUrl } from "../../src/portfolio/live/cn-rank.ts";

const row = (code: string, name: string, zxj: string, zdf: string, turnover: string) =>
  ({ code, name, zxj, zdf, turnover, volume: "1", hsl: "1", pe_ttm: "1", zsz: "1", ltsz: "1", zf: "1", lb: "1", state: "", stock_type: "GP-A" });
const page = (rows: object[], total = 5577) => JSON.stringify({ code: 0, msg: "ok", data: { rank_list: rows, offset: 0, total } });
const RANK = page([row("sz300502", "新易盛", "196.00", "-14.19", "2160760"), row("sh688825", "长鑫科技", "41.80", "-2.50", "1214502"),
  row("bj920306", "天元重工", "7.58", "-23.28", "16000"), row("hk00700", "腾讯控股", "1", "1", "1")]);

describe("cn-rank", () => {
  it("parseTencentRank maps rows to symbols, yuan turnover, and skips what is not an A share", () => {
    const { total, rows } = parseTencentRank(RANK);
    expect(total).toBe(5577);
    expect(rows.map((i) => i.symbol)).toEqual(["300502", "688825", "920306"]);
    expect(rows[0]).toEqual({ symbol: "300502", name: "新易盛", price: 196, changePct: -14.19, turnover: 21_607_600_000 });
    for (const bad of ["<html>busy</html>", JSON.stringify({ code: 1, data: {} }), JSON.stringify({ code: 0, data: { total: 1 } })]) {
      expect(() => parseTencentRank(bad), bad).toThrow();
    }
  });

  it("mergeMovers ranks gainers and losers by the size of the move, then turnover", () => {
    const g = parseTencentRank(page([row("sz300030", "阳普医疗", "7.31", "20.03", "35402"), row("sz301132", "满坤科技", "56.08", "20.01", "83510")])).rows;
    const l = parseTencentRank(page([row("bj920306", "天元重工", "7.58", "-23.28", "16000"), row("sz300911", "亿田智能", "22.20", "-19.33", "49000")])).rows;
    expect(mergeMovers(g, l, 3).map((i) => i.symbol)).toEqual(["920306", "300030", "301132"]);
    const tie = parseTencentRank(page([row("sz000001", "甲", "1", "10.00", "100"), row("sz000002", "乙", "1", "-10.00", "900")])).rows;
    expect(mergeMovers(tie.slice(0, 1), tie.slice(1)).map((i) => i.symbol)).toEqual(["000002", "000001"]);
  });

  it("the URLs name their host and carry the sort", () => {
    expect(rankUrl("turnover", "down", 20)).toBe("https://proxy.finance.qq.com/cgi/cgi-bin/rank/hs/getBoardRankList?_appver=11.17.0&board_code=aStock&sort_type=turnover&direct=down&offset=0&count=20");
    expect(rankUrl("priceRatio", "up", 20)).toContain("sort_type=priceRatio&direct=up&offset=0&count=20");
  });
});
