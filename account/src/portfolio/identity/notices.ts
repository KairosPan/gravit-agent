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
 * phone, and Telegram makes a link of far more than an http URL, so this defangs rather than lists:
 * - any scheme (`ftp://x`, `javascript://x`) and a scheme-relative `//host…` is `<link>`, to the next space;
 * - any dotted token in which a label carrying a letter is followed by a label of two or more that
 *   starts with a letter is `<link>`, whatever its TLD, with its port and path (`evil.museum`,
 *   `evil.xn--p1ai`, `sub.evil.io:8080/x`; `a@evil.io` and `x_evil.com` keep only what is before
 *   the host), and so is a dotted-quad address;
 * - left alone: numbers (`183.00`, `3.5%`, `v1.2.3`), a numeric code with a market suffix (`600519.SH`:
 *   no letter before the dot), a ticker with a one-letter class (`BRK.B`), a bare upper-case ticker on
 *   `.US` (`NVDA.US`, with no port or path) and pair symbols (`BTC/USDT`: no dot).
 * Ordinary dotted words read as links too and are taken out: `notes.md`, `Alpaca.Paper`, `binance.us`. */
const SCHEME_LINK = /[a-z][a-z0-9+.-]*:\/\/\S*/giu;
const RELATIVE_LINK = /\/\/\S+/gu;
const DOTTED_SOURCE = String.raw`[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+`;
const LINK_TAIL = /^(?::\d{1,5})?(?:[/?#]\S*)?/u;

function isLinkHost(host: string, tail: string): boolean {
  const labels = host.split(".");
  if (labels.length === 4 && labels.every((label) => /^\d{1,3}$/u.test(label))) return true;
  if (tail === "" && /^[A-Z]{1,6}\.US$/u.test(host)) return false;
  for (let i = 0; i + 1 < labels.length; i++) {
    if (/\p{L}/u.test(labels[i] ?? "") && /^\p{L}[\p{L}\p{N}-]+$/u.test(labels[i + 1] ?? "")) return true;
  }
  return false;
}

function scrubLinkText(text: string): string {
  const s = text.replace(SCHEME_LINK, "<link>").replace(RELATIVE_LINK, "<link>");
  const dotted = new RegExp(DOTTED_SOURCE, "gu");
  let out = "";
  let at = 0;
  for (let m = dotted.exec(s); m !== null; m = dotted.exec(s)) {
    const host = m[0];
    const end = m.index + host.length;
    const tail = LINK_TAIL.exec(s.slice(end))?.[0] ?? "";
    if (!isLinkHost(host, tail)) continue;
    out += `${s.slice(at, m.index)}<link>`;
    at = end + tail.length;
    dotted.lastIndex = at;
  }
  return out + s.slice(at);
}
/* LINK SCRUB END */
/** every link in a text the account writes itself - any scheme, scheme-relative, or a bare host - as `<link>` */
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
