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
/* A bare domain is a link too: Telegram makes one tappable without a scheme. Taken out:
 * - a dotted host whose last label is a known-looking TLD and whose label before it carries a letter
 *   (`evil.com`, `Pay.Example.COM/x`), with or without a port and a path;
 * - any dotted host with a letter TLD of two or more when a path follows (`evil.example/approve`);
 * - a dotted-quad address, with or without a port and a path (`203.0.113.5:8080/pay`).
 * Left alone: prices and percentages (`183.00`, `3.5%`), versions (`v1.2.3`), pair symbols
 * (`BTC/USDT`, no dot), market suffixes on a numeric code (`600519.SH`, `0700.HK`, no letter before
 * the dot) and one-letter classes (`BRK.B`). The same rule stands in face/src/card-notice.ts; keep the two alike. */
const TLDS = "com|net|org|io|ai|app|dev|co|me|xyz|info|biz|site|online|top|shop|store|link|click|live|tech|cloud|pro|gg|ly|to|tv|cc|ws|ru|de|uk|cn|jp|fr|nl|eu|ca|au|in|br|ch|money|finance|exchange|trade|example";
const BARE_HOST = String.raw`(?<![\w.\-/])(?:[a-z0-9-]+\.)*[a-z0-9-]*[a-z][a-z0-9-]*\.`;
const BARE_LINK = new RegExp(
  String.raw`${BARE_HOST}(?:(?:${TLDS})(?![\w-])(?!\.[a-z0-9])(?::\d{1,5})?(?:\/[^\s"]*)?|[a-z]{2,24}(?::\d{1,5})?\/[^\s"]*)` +
    String.raw`|(?<![\w.])\d{1,3}(?:\.\d{1,3}){3}(?![\w.])(?::\d{1,5})?(?:\/[^\s"]*)?`,
  "gi",
);
/** every link in a text the account writes itself - with a scheme or bare - as `<link>` */
export const noLinks = (s: string): string => s.replace(LINK, "<link>").replace(BARE_LINK, "<link>");
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
