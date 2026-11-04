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

/* LINK SCRUB BEGIN - byte-identical in face/src/card-notice.ts and account/src/portfolio/identity/notices.ts
 * (face/tests/card-notice.test.ts compares the two). Nothing a notice carries may be tappable on the
 * phone. Rather than guess which tokens are hosts, the text is defanged:
 * 1. NFKC-normalised, and the dot look-alikes U+3002, U+FF0E, U+FF61 and U+2024 read as '.';
 * 2. any scheme (`ftp://x`, `javascript://x`) and a scheme-relative `//host…` is `<link>`, to the next
 *    space, and so is a dotted-quad address with its port and path;
 * 3. every '.' left that is not between two ASCII digits becomes '·' (U+00B7), so no host survives:
 *    `163.com` → `163·com`, `NVDA.US` → `NVDA·US`, `notes.md` → `notes·md`; prices and numbers
 *    (`183.00`, `3.5%`, `1,234.56`) stay as they are.
 * `@mentions`, `/commands`, `#tags` and `$cashtags` are left alone: none links to the face. */
const DOT_LOOKALIKES = /[。．｡․]/gu;
const SCHEME_LINK = /[a-z][a-z0-9+.-]*:\/\/\S*/giu;
const RELATIVE_LINK = /\/\/\S+/gu;
const DOTTED_QUAD = /(?<![0-9.])[0-9]{1,3}(?:\.[0-9]{1,3}){3}(?![0-9])(?::[0-9]{1,5})?(?:[/?#]\S*)?/gu;
const LONE_DOT = /(?<![0-9])\.|\.(?![0-9])/gu;

function scrubLinkText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(DOT_LOOKALIKES, ".")
    .replace(SCHEME_LINK, "<link>")
    .replace(RELATIVE_LINK, "<link>")
    .replace(DOTTED_QUAD, "<link>")
    .replace(LONE_DOT, "·");
}
/* LINK SCRUB END */
/** a text the account writes itself, defanged: every link as `<link>`, every dot that could make a host as `·` */
export const noLinks = (s: string): string => scrubLinkText(s);
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
