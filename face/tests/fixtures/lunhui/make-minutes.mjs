// face/tests/fixtures/lunhui/make-minutes.mjs
/**
 * Writes the synthetic Tencent minute-line replies (`web.ifzq.gtimg.cn/appstock/app/day/query`)
 * the Lunhui fixtures serve: `minutes-<symbol>.json`, one five-day reply per symbol. Nothing here is
 * fetched; every number is made up, and the files are a pure function of the tables below - no
 * clock, no randomness, prices to two decimals. Run `node face/tests/fixtures/lunhui/make-minutes.mjs`
 * after changing it, and commit its outputs beside it.
 *
 * Each day holds the 242 grid points (09:30-11:30 = 0-120, 13:00-15:00 = 121-241). Point i's price
 * is `prec * (1 + 0.004 * sin(i / 19))` up to i = 180, then a straight line to `prec * 0.9867` at
 * i = 241; the cumulative volume (lots) grows by `1000 + (i % 7) * 100` a point and the cumulative
 * amount (CNY) by that volume times the price times 100.
 *
 * It also writes the stock lines of the sibling `../lunhui-eastmoney/` (the limit-up freeze's
 * ladder): one file per `ladderCodes` name of that directory's three pools, but the last, whose
 * line the fixtures hold back so the freeze records it `minutes_missing`. Each stock's `prec` and
 * shape come from its first pool, in the order zt, zb, 昨日涨停 (limit-up by `limitRate`, half up to
 * the fen, as `market.mjs` computes it): a zt line ramps from `prec * 1.03` at 09:30 to the
 * limit-up at its `firstSealAt` minute and stays there; a zb line ramps to the limit-up minus 0.01
 * at that minute, then decays in a straight line to its close; a 昨日涨停 line drifts in a straight
 * line from `prec` (yesterday's limit-up) to its close at `pct`. Volume and amount grow as above.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ladderCodes } from "../../../plugins/lunhui/lib/derive.mjs";
import { exchangeOf, limitPrices, limitRate } from "../../../plugins/lunhui/lib/market.mjs";

/** The five trading days every reply holds, newest first as the provider lists them. */
export const DAYS = ["20261023", "20261022", "20261021", "20261020", "20261019"];
const POINTS = 242;
const BEND = 180;
const CLOSE_RATIO = 0.9867;

/** The four indices this directory serves, each with its previous close. */
export const INDEX_PRECS = [
  ["sh000001", 3697.52],
  ["sz399001", 11534.38],
  ["sz399006", 2638.23],
  ["sh000300", 4103.54],
];

const round2 = (x) => Math.round(x * 100) / 100;

/** A grid index to its provider time, "HHMM" China time. */
function hhmm(i) {
  const t = i <= 120 ? 570 + i : 780 + i - 121;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}${String(t % 60).padStart(2, "0")}`;
}

/** The 242 prices of one day off `prec`, two decimals. */
export function prices(prec) {
  const bend = prec * (1 + 0.004 * Math.sin(BEND / 19));
  const close = prec * CLOSE_RATIO;
  return Array.from({ length: POINTS }, (_, i) =>
    round2(i <= BEND ? prec * (1 + 0.004 * Math.sin(i / 19)) : bend + ((close - bend) * (i - BEND)) / (POINTS - 1 - BEND)),
  );
}

/** One day's rows, "HHMM price cumVolume cumAmount", over `series` (the index curve off `prec` by default). */
export function dayRows(prec, series = prices(prec)) {
  let volume = 0;
  let amount = 0;
  return series.map((price, i) => {
    const step = 1000 + (i % 7) * 100;
    volume += step;
    amount = round2(amount + step * price * 100);
    return `${hhmm(i)} ${price.toFixed(2)} ${volume} ${amount.toFixed(2)}`;
  });
}

/** The provider's reply for `symbol`: `{ code, data: { <symbol>: { data: [day, ...] } } }`. */
export function minutesReply(symbol, prec, days = DAYS, series = prices(prec)) {
  const rows = dayRows(prec, series);
  return { code: 0, msg: "", data: { [symbol]: { data: days.map((date) => ({ date, prec: prec.toFixed(2), data: rows })) } } };
}

/** Writes `minutes-<symbol>.json` into `dir` for each `[symbol, prec, series?]`. */
export function writeMinutes(dir, entries) {
  for (const [symbol, prec, series] of entries)
    writeFileSync(join(dir, `minutes-${symbol}.json`), `${JSON.stringify(minutesReply(symbol, prec, DAYS, series))}\n`);
}

/** A seal time "HHMMSS" to its grid index: before 09:30 the first point, in the lunch break 13:00's. */
function sealIndex(hhmmss) {
  const t = Number(hhmmss.slice(0, 2)) * 60 + Number(hhmmss.slice(2, 4));
  if (t <= 570) return 0;
  if (t <= 690) return t - 570;
  if (t < 780) return 121;
  return Math.min(241, t - 780 + 121);
}

/** A straight line from `a` at `i0` to `b` at `i1`, read at `i`. */
const line = (a, b, i0, i1, i) => (i1 === i0 ? b : a + ((b - a) * (i - i0)) / (i1 - i0));

/** The three pools of `dir` in the parsed shape the ladder and the shapes read. */
function poolsOf(dir) {
  const read = (name) => JSON.parse(readFileSync(join(dir, name), "utf8")).data.pool;
  const seal = (value) => String(value).padStart(6, "0");
  return {
    zt: read("zt-pool.json").map((raw) => ({ code: raw.c, name: raw.n, pct: raw.zdp, price: raw.p / 1000, boards: raw.lbc, firstSealAt: seal(raw.fbt) })),
    zb: read("zb-pool.json").map((raw) => ({ code: raw.c, name: raw.n, price: raw.p / 1000, limitPrice: raw.ztp / 1000, firstSealAt: seal(raw.fbt) })),
    yesterday: read("yesterday-pool.json").map((raw) => ({ code: raw.c, price: raw.p / 1000, limitPrice: raw.ztp / 1000, yesterdayBoards: raw.ylbc })),
  };
}

/** The `[symbol, prec, series]` of one ladder code, by its first pool. */
function stockEntry(pools, code) {
  const symbol = `${exchangeOf(code)}${code}`;
  const zt = pools.zt.find((row) => row.code === code);
  if (zt) {
    const rate = limitRate(code, zt.name);
    const prec = round2(zt.price / (1 + rate));
    const { up } = limitPrices(prec, rate);
    const s = sealIndex(zt.firstSealAt);
    return [symbol, prec, Array.from({ length: POINTS }, (_, i) => round2(i >= s ? up : line(prec * 1.03, up, 0, s, i)))];
  }
  const zb = pools.zb.find((row) => row.code === code);
  if (zb) {
    const rate = limitRate(code, zb.name);
    const prec = round2(zb.limitPrice / (1 + rate));
    const top = round2(limitPrices(prec, rate).up - 0.01);
    const s = sealIndex(zb.firstSealAt);
    return [symbol, prec, Array.from({ length: POINTS }, (_, i) => round2(i <= s ? line(prec * 1.03, top, 0, s, i) : line(top, zb.price, s, POINTS - 1, i)))];
  }
  const y = pools.yesterday.find((row) => row.code === code);
  const prec = y.limitPrice;
  return [symbol, prec, Array.from({ length: POINTS }, (_, i) => round2(line(prec, y.price, 0, POINTS - 1, i)))];
}

/** The stock entries of `dir`'s ladder, the last name held back. */
export function ladderEntries(dir) {
  const pools = poolsOf(dir);
  return ladderCodes(pools).slice(0, -1).map((code) => stockEntry(pools, code));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeMinutes(fileURLToPath(new URL(".", import.meta.url)), INDEX_PRECS);
  const eastmoney = fileURLToPath(new URL("../lunhui-eastmoney/", import.meta.url));
  writeMinutes(eastmoney, ladderEntries(eastmoney));
}
