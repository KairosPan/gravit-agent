/** An order as the memory is asked about it: a seat write's arguments read into validated order lines
 * ({@link gateOrdersOf}), and, from a line and a position, what might be done ({@link consideringOf}), what an
 * approval and a decline are written as ({@link approvedAction}, {@link declinedAction}), the order's words
 * ({@link orderWords}) and the symbol the memory is asked with ({@link memorySymbol}).
 *
 * Every argument is the model's and is read as hostile: a line keeps only the fields of {@link OrderLine}, each one
 * that passed its shape check - a venue id of {@link VENUE_ID}, a symbol of {@link SHOWN_SYMBOL}, a side of `buy` or
 * `sell`, numbers finite and above zero. One field that fails makes the whole order unreadable; no argument is
 * passed on as text.
 *
 * MODULE WEIGHT. Pure: it imports nothing but symbols.ts.
 * @module
 */
import { SYMBOL_RE } from "./symbols.ts";

/** What a decision in the memory says was done. */
export type Action = "buy" | "add" | "trim" | "sell" | "short" | "cover" | "hold" | "pass";

/** One order of a seat write, its fields checked. `leg` is a batch's 1-based leg; `close` marks a close (a sell). */
export interface OrderLine {
  leg?: number;
  venue: string;
  symbol: string;
  side: "buy" | "sell";
  close: boolean;
  qty?: number;
  usd?: number;
  limitPrice?: number;
}

/** A seat write's lines, or why there are none. */
export type GateOrders =
  | { kind: "lines"; lines: OrderLine[] }
  | { kind: "none"; why: "not checked for this tool" | "more than five lines" | "the order could not be read" };

/** The most lines a write is checked for; a longer batch is not checked. */
export const GATE_LINES_MAX = 5;

/** The memory's own symbol shape. */
export const MEMORY_SYMBOL = /^[A-Za-z0-9][A-Za-z0-9._^=-]{0,31}$/;

/** A venue id a line may carry. */
export const VENUE_ID = /^[A-Za-z0-9._:-]{1,64}$/;

/** A symbol a line may carry and its words may show. */
export const SHOWN_SYMBOL = /^[A-Za-z0-9._:\/^=-]{1,40}$/;

/** A position on the line's venue: its side, its size and, when known, its entry price. */
export type Position = { side: "long" | "short"; qty: number; entryPrice?: number };

/** The seat writes this module reads, by raw name. */
const ORDER_RAW = "portfolio_live_order";
const CLOSE_RAW = "portfolio_live_close";
const BATCH_RAW = "portfolio_live_batch";

const UNREADABLE: GateOrders = { kind: "none", why: "the order could not be read" };

/** A tool's raw name: what follows its last `__`, or the whole name when it has none. */
function rawNameOf(name: string): string {
  const at = name.lastIndexOf("__");
  return at < 0 ? name : name.slice(at + 2);
}

/** A plain object, not an array and not null. */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Absent, or a finite number above zero; `false` for anything else. */
function amountOf(v: unknown): number | undefined | false {
  if (v === undefined) return undefined;
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : false;
}

/** The venue and symbol both pass their checks. */
function placeOf(args: Record<string, unknown>): { venue: string; symbol: string } | undefined {
  const { venue, symbol } = args;
  if (typeof venue !== "string" || !VENUE_ID.test(venue)) return undefined;
  if (typeof symbol !== "string" || !SHOWN_SYMBOL.test(symbol)) return undefined;
  return { venue, symbol };
}

/** One `portfolio_live_order`'s fields as a line, or undefined when any of them fails its check. */
function orderLineOf(args: unknown, leg?: number): OrderLine | undefined {
  if (!isRecord(args)) return undefined;
  const place = placeOf(args);
  if (!place) return undefined;
  const side = args.side;
  if (side !== "buy" && side !== "sell") return undefined;
  const qty = amountOf(args.qty);
  const usd = amountOf(args.usd);
  const limitPrice = amountOf(args.limitPrice);
  if (qty === false || usd === false || limitPrice === false) return undefined;
  const line: OrderLine = { ...(leg === undefined ? {} : { leg }), ...place, side, close: false };
  if (qty !== undefined) line.qty = qty;
  if (usd !== undefined) line.usd = usd;
  if (limitPrice !== undefined) line.limitPrice = limitPrice;
  return line;
}

/** One `portfolio_live_close`'s fields as a sell line marked close, or undefined when any of them fails its check. */
function closeLineOf(args: unknown): OrderLine | undefined {
  if (!isRecord(args)) return undefined;
  const place = placeOf(args);
  if (!place) return undefined;
  const qty = amountOf(args.qty);
  if (qty === false) return undefined;
  const line: OrderLine = { ...place, side: "sell", close: true };
  if (qty !== undefined) line.qty = qty;
  return line;
}

/** The lines of a seat write named `name` with arguments `args`: an order, a close, or a batch of at most
 * {@link GATE_LINES_MAX} legs. Any other tool is not checked; a field that fails its check leaves nothing read. */
export function gateOrdersOf(name: string, args: unknown): GateOrders {
  const raw = rawNameOf(name);
  if (raw === ORDER_RAW) {
    const line = orderLineOf(args);
    return line ? { kind: "lines", lines: [line] } : UNREADABLE;
  }
  if (raw === CLOSE_RAW) {
    const line = closeLineOf(args);
    return line ? { kind: "lines", lines: [line] } : UNREADABLE;
  }
  if (raw === BATCH_RAW) {
    if (!isRecord(args) || !Array.isArray(args.legs) || args.legs.length === 0) return UNREADABLE;
    if (args.legs.length > GATE_LINES_MAX) return { kind: "none", why: "more than five lines" };
    const lines: OrderLine[] = [];
    for (const [i, leg] of args.legs.entries()) {
      const line = orderLineOf(leg, i + 1);
      if (!line) return UNREADABLE;
      lines.push(line);
    }
    return { kind: "lines", lines };
  }
  return { kind: "none", why: "not checked for this tool" };
}

/** What `line` might be, given `position`: a Position, null when flat, undefined when it was not read. One to three
 * actions, distinct. A sell sized in dollars against a long cannot be told a trim from a sell. */
export function consideringOf(line: OrderLine, position: Position | null | undefined): Action[] {
  if (line.close) {
    if (position?.side === "long") return ["sell"];
    if (position?.side === "short") return ["cover"];
    return ["sell", "cover"];
  }
  if (line.side === "buy") {
    if (position === null) return ["buy"];
    if (position === undefined) return ["buy", "add", "cover"];
    return position.side === "long" ? ["add"] : ["cover"];
  }
  if (position === null || position?.side === "short") return ["short"];
  if (position === undefined) return ["short", "trim", "sell"];
  if (line.qty === undefined) return ["trim", "sell"];
  return line.qty < position.qty ? ["trim"] : ["sell"];
}

/** The one action an approval is written as, or undefined when the position does not settle it. */
export function approvedAction(line: OrderLine, position: Position | null | undefined): Action | undefined {
  const considering = consideringOf(line, position);
  return considering.length === 1 ? considering[0] : undefined;
}

/** What a decline is written as: `pass` for a buy, `hold` for a sell or a close. */
export function declinedAction(line: OrderLine): "pass" | "hold" {
  return line.side === "buy" && !line.close ? "pass" : "hold";
}

/** A number as the words show it, with no `+` (an exponent's sign). */
function numberWords(n: number): string {
  return String(n).replace("+", "");
}

/** `buy 10 NVDA · limit 183 · paper-1`, from the line's own fields alone. */
export function orderWords(line: OrderLine): string {
  const parts: string[] = [];
  if (line.close) {
    parts.push(line.qty === undefined ? `close ${line.symbol}` : `close ${numberWords(line.qty)} ${line.symbol}`);
  } else if (line.qty !== undefined) {
    parts.push(`${line.side} ${numberWords(line.qty)} ${line.symbol}`);
  } else if (line.usd !== undefined) {
    parts.push(`${line.side} $${numberWords(line.usd)} of ${line.symbol}`);
  } else {
    parts.push(`${line.side} ${line.symbol}`);
  }
  if (!line.close && line.limitPrice !== undefined) parts.push(`limit ${numberWords(line.limitPrice)}`);
  parts.push(line.venue);
  return parts.join(" · ");
}

/** The market an instrument of the Account's listing `kind` is in: a stock is `US`; any other kind is no market. */
export function marketOfKind(kind: unknown): "US" | undefined {
  return kind === "stock" ? "US" : undefined;
}

/** The symbol the memory is asked with: the line's, when it fits MEMORY_SYMBOL and SYMBOL_RE and a market was placed. */
export function memorySymbol(line: OrderLine, market: "US" | undefined): string | undefined {
  if (market !== "US") return undefined;
  return MEMORY_SYMBOL.test(line.symbol) && SYMBOL_RE.test(line.symbol) ? line.symbol : undefined;
}
