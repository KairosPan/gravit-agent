import { describe, expect, it } from "vitest";
import { CN_BARS, gridIndex, historyUrl, parseDayQuery, parseKline, type ChinaRange } from "../../src/portfolio/live/cn-history.ts";
import { CANDLE_RANGES } from "../../src/portfolio/live/trade.ts";

const day = (date: string, prec: string, rows: string[]) => ({ date, prec, data: rows });
const DAYQ = JSON.stringify({ code: 0, data: { sh600519: { data: [
  day("20261030", "1354.00", ["0930 1363.00 1534 209084200.00", "0932 1359.61 2839 386191243.54", "1130 1380.00 30000 4100000000.00",
    "1300 1381.00 30500 4170000000.00", "1500 1392.05 59927 8257380000.00", "1505 1392.05 59944 8259708303.78"]),
  day("20261029", "1350.00", ["0930 1351.00 100 13510000.00"]) ] } } });
const kline = (interval: string, rows: string[][]) => JSON.stringify({ code: 0, data: { sh600519: { [`qfq${interval}`]: rows } } });
const bar = (date: string, c = "1392.050") => [date, "1325.400", c, "1393.370", "1322.600", "221992.000"];

describe("cn-history", () => {
  it("gridIndex: 09:30–11:30 are 0–120, 13:00–15:00 are 121–241, nothing else", () => {
    expect(["0930", "1130", "1131", "1259", "1300", "1500", "1501", "0929", "xx"].map(gridIndex)).toEqual([0, 120, null, null, 121, 241, null, null, null]);
  });

  it("parseDayQuery: oldest first, gaps repeat the last price with nothing traded, points past 15:00 dropped", () => {
    const [d29, d30] = parseDayQuery(DAYQ, "sh600519");
    expect(d29!.date).toBe("2026-10-29");
    expect(d29!.price.length).toBe(1);
    expect(d30!.date).toBe("2026-10-30");
    expect(d30!.prec).toBe(1354);
    expect(d30!.price.length).toBe(242);
    expect(d30!.price[1]).toBe(1363);
    expect(d30!.amount[1]).toBe(0);
    expect(d30!.amount[2]).toBe(177_107_043.54);
    expect(d30!.price[241]).toBe(1392.05);
    expect(() => parseDayQuery("<html>busy</html>", "sh600519")).toThrow();
    expect(() => parseDayQuery(JSON.stringify({ code: 0, data: { sh600519: { data: [day("20261030", "1354", ["0930 1 10 100", "0931 1 5 50"])] } } }), "sh600519")).toThrow();
  });

  it("parseKline: forward-adjusted rows to bars stamped 15:00 Beijing, for day, week and month", () => {
    expect(parseKline(kline("week", [bar("2026-10-30")]), "sh600519", "week"))
      .toEqual([{ t: Date.parse("2026-10-30T07:00:00Z"), o: 1325.4, h: 1393.37, l: 1322.6, c: 1392.05 }]);
    expect(parseKline(kline("day", [bar("2026-10-30")]), "sh600519", "day").length).toBe(1);
    expect(parseKline(kline("month", [bar("2026-10-30")]), "sh600519", "month").length).toBe(1);
    expect(() => parseKline(kline("day", [bar("2026-10-30")]), "sh600519", "week")).toThrow();
  });

  it("each range asks Tencent for its own read", () => {
    const want: Record<ChinaRange, string> = {
      "1D": "https://web.ifzq.gtimg.cn/appstock/app/day/query?code=sh600519",
      "5D": "https://web.ifzq.gtimg.cn/appstock/app/day/query?code=sh600519",
      "1M": "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh600519,day,,,22,qfq",
      "3M": "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh600519,day,,,66,qfq",
      "6M": "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh600519,day,,,132,qfq",
      YTD: "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh600519,day,,,260,qfq",
      "1Y": "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh600519,day,,,250,qfq",
      "5Y": "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh600519,week,,,260,qfq",
      MAX: "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh600519,month,,,500,qfq",
    };
    for (const range of Object.keys(want) as ChinaRange[]) expect(historyUrl("sh600519", range), range).toBe(want[range]);
  });

  it("China's ranges are the Account's chart ranges", () => {
    expect(["1D", "5D", ...Object.keys(CN_BARS)].sort()).toEqual([...CANDLE_RANGES].sort());
  });
});
