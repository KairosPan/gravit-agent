/**
 * The shared synthetic fixtures of the Lunhui run view's tests: `syntheticPools1027()`, the three
 * limit-up pools of a made-up session 2026-10-27 in the shape `eastmoney.mjs` parses them to, each
 * row tagged with its `pool`. Nothing here was fetched; every code, name, price and time is made
 * up (A26), and the rows are a pure function of the tables below - no clock, no randomness. Codes
 * are six digits with no exchange, as the pools send them; names are `样本` plus the code, except
 * `600001`'s.
 *
 * The ladder the pools make (`ladderCodes`): `600001` sealed at 5 boards, `600011`–`600013` at 4,
 * `000101`–`000108` at 2; `000021` broke trying its third board, `000109`–`000111` their second;
 * `600014`–`600016` (3 boards yesterday) and `000022`–`000028` (2) did not seal again - 26 names.
 * `002001` sits in zt and zb both, the overlap; `003001`–`003024` broke on a first board, and
 * `000101`–`000140` held 1 board yesterday.
 */
import { limitPrices } from "../plugins/lunhui/lib/market.mjs";

type Row = Record<string, unknown>;
export type Pools = { zt: Row[]; zb: Row[]; yesterday: Row[] };

const round2 = (x: number) => Math.round(x * 100) / 100;

/** `prefix` followed by `from`..`to`, each zero-padded to six digits with `prefix`. */
function codes(prefix: string, from: number, to: number): string[] {
  return Array.from({ length: to - from + 1 }, (_, i) => prefix + String(from + i).padStart(6 - prefix.length, "0"));
}

const nameOf = (code: string) => (code === "600001" ? "上海九百" : `样本${code}`);
const INDUSTRIES = ["电力", "软件开发", "通信设备", "化学制品", "汽车零部件", "文化传媒", "通用设备"];
const n = (code: string) => Number(code);
const industryOf = (code: string) => INDUSTRIES[n(code) % INDUSTRIES.length];
const turnoverOf = (code: string) => round2(3 + (n(code) % 13) * 0.71);
const amountOf = (code: string) => 100_000_000 + (n(code) % 29) * 17_000_000;

/** Each code's previous close: `600001` 4.62, `000021` 43.19, the rest a made-up spread from 5 to 34. */
function precOf(code: string): number {
  if (code === "600001") return 4.62;
  if (code === "000021") return 43.19;
  return round2(5 + (n(code) % 37) * 0.79);
}

const up = (code: string) => limitPrices(precOf(code), 0.1).up;
const pctOf = (code: string, price: number) => round2((price / precOf(code) - 1) * 100);

/** One 涨停池 row sealed at `boards`. */
function zt(code: string, boards: number, firstSealAt: string, breakCount: number, sealFunds: number): Row {
  const price = up(code);
  return {
    pool: "zt", code, name: nameOf(code), pct: pctOf(code, price), price, boards, firstSealAt,
    lastSealAt: breakCount === 0 ? firstSealAt : "135507", breakCount, sealFunds,
    industry: industryOf(code), turnoverRate: turnoverOf(code), amount: amountOf(code),
  };
}

/** One 炸板池 row: it touched its limit-up at `firstSealAt` and closed `drop` yuan below it. */
function zb(code: string, firstSealAt: string, breakCount: number, drop: number): Row {
  const limitPrice = up(code);
  const price = round2(limitPrice - drop);
  return {
    pool: "zb", code, name: nameOf(code), pct: pctOf(code, price), price, limitPrice, firstSealAt, breakCount,
    industry: industryOf(code), turnoverRate: turnoverOf(code), amount: amountOf(code),
  };
}

/** One 昨日涨停 row: yesterday's limit-up after `yesterdayBoards` boards, today's `pct`. */
function yesterday(code: string, yesterdayBoards: number, pct: number): Row {
  const limitPrice = precOf(code);
  return {
    pool: "yesterday", code, name: nameOf(code), pct, price: round2(limitPrice * (1 + pct / 100)), limitPrice,
    yesterdayBoards, industry: industryOf(code), turnoverRate: turnoverOf(code), amount: amountOf(code),
  };
}

/** Minutes after midnight as an `HHMMSS` seal time. */
const clock = (t: number) => `${String(Math.floor(t / 60)).padStart(2, "0")}${String(t % 60).padStart(2, "0")}00`;

const YESTERDAY_PCT: Record<string, number> = { "600014": -9.91, "600015": -10.02, "600016": -2.65, "000021": 2.78 };
const SEAL_4 = ["092501", "092502", "093409"];

/** The three pools of the synthetic 2026-10-27, parsed shape, each row with its `pool`. */
export function syntheticPools1027(): Pools {
  const y = (code: string, boards: number) => yesterday(code, boards, YESTERDAY_PCT[code] ?? 1.0);
  return {
    zt: [
      zt("600001", 5, "093026", 0, 150_000_000),
      ...codes("6000", 11, 13).map((code, i) => zt(code, 4, SEAL_4[i], 1, 80_000_000 - i * 5_000_000)),
      ...codes("000", 101, 108).map((code, i) => zt(code, 2, "092500", 0, 40_000_000 + i * 1_000_000)),
      ...codes("002", 1, 29).map((code, i) => zt(code, 1, clock(580 + i), 0, 10_000_000 + i * 500_000)),
    ],
    zb: [
      zb("000021", "093629", 2, 2.1),
      ...codes("000", 109, 111).map((code, i) => zb(code, "100512", 1 + i, 0.37)),
      ...codes("003", 1, 24).map((code, i) => zb(code, clock(630 + i), 1 + (i % 3), 0.21)),
      zb("002001", "094000", 1, 0.01),
    ],
    yesterday: [
      y("600001", 4),
      ...codes("6000", 11, 16).map((code) => y(code, 3)),
      ...codes("0000", 21, 28).map((code) => y(code, 2)),
      ...codes("000", 101, 140).map((code) => y(code, 1)),
    ],
  };
}
