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
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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

/** One day's rows, "HHMM price cumVolume cumAmount". */
export function dayRows(prec) {
  let volume = 0;
  let amount = 0;
  return prices(prec).map((price, i) => {
    const step = 1000 + (i % 7) * 100;
    volume += step;
    amount = round2(amount + step * price * 100);
    return `${hhmm(i)} ${price.toFixed(2)} ${volume} ${amount.toFixed(2)}`;
  });
}

/** The provider's reply for `symbol`: `{ code, data: { <symbol>: { data: [day, ...] } } }`. */
export function minutesReply(symbol, prec, days = DAYS) {
  const rows = dayRows(prec);
  return { code: 0, msg: "", data: { [symbol]: { data: days.map((date) => ({ date, prec: prec.toFixed(2), data: rows })) } } };
}

/** Writes `minutes-<symbol>.json` into `dir` for each `[symbol, prec]`. */
export function writeMinutes(dir, entries) {
  for (const [symbol, prec] of entries)
    writeFileSync(join(dir, `minutes-${symbol}.json`), `${JSON.stringify(minutesReply(symbol, prec))}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeMinutes(fileURLToPath(new URL(".", import.meta.url)), INDEX_PRECS);
}
