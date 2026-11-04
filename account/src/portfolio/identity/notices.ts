/** THE ACCOUNT'S OWN NOTICES — what the account itself tells the operator's phone, with no desk turn: a fill (kind `fill`, as each one is
 * told to the pages: service.ts paperSaid and toldFill) and a Guard card raised (kind `card`, as the ledger takes its row). Plain text, one
 * line, no button and no link: a card is answered in Gravit (Account › Cards), never from the phone, and nothing sent links to the face. */
import type { LedgerRow } from "../../agent/ledger.ts";

export interface FillFields {
  side: string;
  qty: number | string;
  symbol: string;
  price?: number | string | undefined;
  venueName: string;
  paper?: boolean | undefined;
}

/** a URL in a text the account writes itself: taken out, so that no notice carries a link */
const LINK = /\bhttps?:\/\/[^\s]+/gi;
const noLinks = (s: string): string => s.replace(LINK, "<link>");
const oneLine = (s: string): string => s.replace(/\s*[\r\n]+\s*/g, " ").trim();
const capital = (s: string): string => (s === "" ? s : s[0]!.toUpperCase() + s.slice(1));

/** `Filled · Buy 10 NVDA at 183.00 · Paper · Alpaca` — the order's own side, size and market, its price when told, paper when it is */
export function fillNotice(f: FillFields): string {
  const price = f.price === undefined || f.price === "" ? "" : ` at ${String(f.price)}`;
  const what = `${capital(String(f.side))} ${String(f.qty)} ${f.symbol}${price}`;
  return noLinks(oneLine(["Filled", what, ...(f.paper ? ["Paper"] : []), f.venueName].join(" · ")));
}

/** `Your call · <the card's own line> — waiting in Gravit` for a card raised (a `card` row, `pending`); undefined for every other row */
export function cardNotice(row: LedgerRow): string | undefined {
  if (!row || row.kind !== "card" || row.outcome !== "pending") return undefined;
  const reason = typeof row.reason === "string" ? oneLine(noLinks(row.reason)) : "";
  if (reason === "") return undefined;
  return `Your call · ${reason} — waiting in Gravit`;
}
