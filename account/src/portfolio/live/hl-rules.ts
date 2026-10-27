/** HYPERLIQUID'S ORDER RULES (HyperCore docs: Tick and lot size), in one place for every reader that prices or sizes an order there — the
 * connection to trade (hyperliquid-trade.ts), and the public listing a paper account trades Hyperliquid's perpetuals by (public-markets.ts):
 *   a size     a multiple of 10^-szDecimals, the asset's szDecimals in its meta (BTC's 5: 0.00001 BTC)
 *   a price    at most five significant figures and at most MAX_DECIMALS − szDecimals decimals (MAX_DECIMALS: 6 for a perpetual, 8 for
 *              spot); a whole number always passes
 *   a value    an order is worth $10 at least (Hyperliquid's refusal MinTradeNtl: "Order must have minimum value of $10") */
import { ceilTo, floorTo, plain } from "./trade.ts";

/** the least an order is worth at Hyperliquid, in dollars */
export const HL_MIN_ORDER_USD = 10;

/** the most decimals a price has here: MAX_DECIMALS (6 for perps, 8 for spot) less the asset's szDecimals */
export const hlDecimals = (kind: "spot" | "perp", szDecimals: number): number => Math.max(0, (kind === "spot" ? 8 : 6) - szDecimals);

/** the step of a size: 10^-szDecimals */
export const hlLot = (szDecimals: number): number => Number((10 ** -szDecimals).toPrecision(6));

/** Does Hyperliquid take this price (Tick and lot size): at most five significant figures and at most `decimals` decimal places — a whole
 * number always passes */
export function hlPriceOk(px: number, decimals: number): boolean {
  if (!(Number.isFinite(px) && px > 0)) return false;
  if (Number.isInteger(px)) return true;
  const [int = "", frac = ""] = plain(px, 12).split(".");
  if (frac.length > decimals) return false;
  return `${int === "0" ? "" : int}${frac}`.replace(/^0+/, "").length <= 5;
}

/** the power of ten of a price: 81359 → 4, 0.11 → −1 */
function magnitude(px: number): number {
  let e = Math.floor(Math.log10(px));
  if (10 ** (e + 1) <= px) e += 1;
  if (10 ** e > px) e -= 1;
  return e;
}

/** the grid of prices Hyperliquid takes around `px`: the fifth significant figure, never finer than the decimals allowed; a whole number
 * from 100,000 up */
export function hlPriceStep(px: number, decimals: number): number {
  if (!(px > 0)) return 10 ** -decimals;
  if (px >= 100_000) return 1;
  return Number(Math.max(10 ** (magnitude(px) - 4), 10 ** -decimals).toPrecision(1));
}

/** the nearest price Hyperliquid takes at or inside `px`: down for a buy's worst price, up for a sell's — never looser than asked. NaN when
 * there is none (a price under the smallest step) */
export function hlPriceInside(px: number, decimals: number, dir: "down" | "up"): number {
  if (!(Number.isFinite(px) && px > 0)) return NaN;
  const step = hlPriceStep(px, decimals);
  const out = dir === "down" ? floorTo(px, step) : ceilTo(px, step);
  return out > 0 && hlPriceOk(out, decimals) ? out : NaN;
}

/** a perpetual's order rules at its price now, as a market says them (Market.qtyStep, minQty, priceStep, minNotional): BTC at 82,384 with
 * szDecimals 5 — sizes of 0.00001 BTC, prices in whole dollars, $10 at least; ETH at 3,000 with 4 — 0.0001 ETH, $0.10 */
export function hlPerpSteps(szDecimals: number, price: number): { qtyStep: number; minQty: number; priceStep: number; minNotional: number } {
  const lot = hlLot(szDecimals);
  return { qtyStep: lot, minQty: lot, priceStep: hlPriceStep(price, hlDecimals("perp", szDecimals)), minNotional: HL_MIN_ORDER_USD };
}
