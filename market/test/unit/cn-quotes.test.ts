import { describe, expect, it } from "vitest";
import { decodeGbk, parseTencentQuotes, tencentCode } from "../../src/live/cn-quotes.ts";

const NOW = Date.parse("2026-10-31T02:00:00Z");
/** One Tencent quote line, `v_<code>="…";`, its 88 fields joined by `~`: the indices the parser reads
 * from `at`, every other field empty. */
function line(code: string, at: Record<number, string>): string {
  return `v_${code}="${Array.from({ length: 88 }, (_, i) => at[i] ?? "").join("~")}";\n`;
}
const quoted = (code: string, extra: Record<number, string> = {}) =>
  line(code, { 0: "1", 1: "NAME", 2: code.slice(2), 3: "165.50", 4: "160.00", 6: "0", 30: "20260915150003", 37: "0", ...extra });
const parse = (text: string, ...symbols: string[]) => parseTencentQuotes(text, symbols, NOW);

describe("cn-quotes", () => {
  it("tencentCode files 6 under sh, 0 and 3 under sz, 4, 8 and 9 under bj", () => {
    expect([tencentCode("603986"), tencentCode("300750"), tencentCode("000001"), tencentCode("920185"), tencentCode("830799"), tencentCode("123456"), tencentCode("60398")])
      .toEqual(["sh603986", "sz300750", "sz000001", "bj920185", "bj830799", null, null]);
  });

  it("a quote carries the last price, the previous close and the provider's Beijing time", () => {
    const { quotes } = parse(quoted("sh603986"), "603986");
    const q = quotes.get("603986")!;
    expect(q.price).toBe(165.5);
    expect(q.prevClose).toBe(160);
    expect(q.asOf).toBe("2026-09-15T15:00:03+08:00");
    expect(Date.parse(q.asOf!)).toBe(Date.parse("2026-09-15T07:00:03Z"));
  });

  it("volume is in shares: lots on most boards, shares on STAR, unknown when the turnover fits neither", () => {
    // Measured 2026-10-30: field 6 is lots of 100 for 600519, 000001, 300750 and 920045, shares for 688981;
    // field 37 is the turnover in 10,000 CNY, which decides.
    const { quotes } = parse([
      quoted("sh600519", { 3: "1392.05", 6: "59927", 37: "825738" }),
      quoted("sh688981", { 3: "98.60", 6: "29998989", 37: "295750" }),
      quoted("sz000001", { 3: "11.64", 6: "1864245", 37: "1" }),
      quoted("sz300750", { 3: "232.92", 6: "0", 37: "0" }),
      quoted("bj920045", { 3: "407.10", 6: "21775", 37: "" }),
    ].join(""), "600519", "688981", "000001", "300750", "920045");
    expect(quotes.get("600519")!.volume).toBe(5_992_700);
    expect(quotes.get("688981")!.volume).toBe(29_998_989);
    expect(quotes.get("000001")!.volume).toBeNull();
    expect(quotes.get("300750")!.volume).toBe(0);
    expect(quotes.get("920045")!.volume).toBeNull();
  });

  it("an unknown code, a row for another code, or one too short to read is absent", () => {
    const text = quoted("sh603986") + 'v_pv_none_match="1";\n'
      + line("sh600000", { 2: "600001", 3: "1.00" }) + 'v_sz300750="1~NAME~300750~232.92";\n';
    const { quotes } = parse(text, "603986", "920999", "600000", "300750", "123456");
    expect([...quotes.keys()]).toEqual(["603986"]);
  });

  it("a missing or malformed event time stays missing", () => {
    // Date.parse rolls 02-31 over to 03-03 and 24:00 to the next midnight; the round trip refuses both.
    for (const time of ["", "20260915", "2026-09-15 15:00:03", "20261345150003", "20260231150003", "20260915240000"]) {
      const q = parse(quoted("sh603986", { 30: time }), "603986").quotes.get("603986")!;
      expect(q.asOf, time).toBeNull();
      expect(q.volume, time).toBeNull();
    }
  });

  it("GBK names decode before the fields split, so a trail byte that reads as ~ moves no field", () => {
    // 0x81 0x7E is one GBK character whose second byte is ASCII "~"; decoded as UTF-8 it would add a field.
    const before = Buffer.from('v_sh603986="1~');
    const after = Buffer.from(quoted("sh603986").slice('v_sh603986="1~NAME'.length));
    const text = decodeGbk(new Uint8Array(Buffer.concat([before, Buffer.from([0xc3, 0xa9, 0x81, 0x7e]), after])));
    const q = parse(text, "603986").quotes.get("603986")!;
    expect(q.price).toBe(165.5);
    expect(Date.parse(q.asOf!)).toBe(Date.parse("2026-09-15T07:00:03Z"));
  });

  it("a quote carries the page's facts, in yuan and percent", () => {
    const moutai = line("sh600519", { 1: "@NAME@", 2: "600519", 3: "1392.05", 4: "1354.00", 5: "1363.00", 6: "59927",
      30: "20261030161455", 33: "1393.37", 34: "1352.98", 37: "825738", 38: "0.48", 39: "21.18", 43: "2.98", 45: "17401.76",
      47: "1489.40", 48: "1218.60" });
    // the reply is GBK, as Tencent's is: 贵州茅台 is B9F3 D6DD C3A9 CCA8
    const [head, tail] = moutai.split("@NAME@");
    const gbk = Buffer.concat([Buffer.from(head!), Buffer.from([0xb9, 0xf3, 0xd6, 0xdd, 0xc3, 0xa9, 0xcc, 0xa8]), Buffer.from(tail!)]);
    const u = parse(decodeGbk(new Uint8Array(gbk)), "600519").quotes.get("600519")!;
    expect([u.name, u.open, u.high, u.low, u.turnover, u.turnoverRate, u.marketCap, u.peTtm, u.limitUp, u.limitDown, u.amplitude])
      .toEqual(["贵州茅台", 1363, 1393.37, 1352.98, 8_257_380_000, 0.48, 1_740_176_000_000, 21.18, 1489.4, 1218.6, 2.98]);
  });

  it("a negative P/E is kept", () => {
    expect(parse(quoted("sh603986", { 39: "-12.50" }), "603986").quotes.get("603986")!.peTtm).toBe(-12.5);
  });

  it("the session comes from the same reply: closed, open, midday, and the last trading day", () => {
    const stat = (token: string) => `v_marketStat="2026-10-30 10:00:00|SH_${token}_x|SZ_${token}_x";\n`;
    const index = line("sh000001", { 2: "000001", 30: "20261030113000" });
    const at = (now: number, token: string) => parseTencentQuotes(stat(token) + index + quoted("sh603986"), ["603986"], now).session;
    expect(at(Date.parse("2026-10-31T02:00:00Z"), "close")).toEqual({ phase: "closed", lastSession: "2026-10-30" });
    expect(at(Date.parse("2026-10-30T02:00:00Z"), "open").phase).toBe("trading");
    expect(at(Date.parse("2026-10-30T04:00:00Z"), "close").phase).toBe("midday");
  });
});
