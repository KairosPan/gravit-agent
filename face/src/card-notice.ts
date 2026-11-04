/**
 * CARD NOTICES — what the face tells the operator's phone when Gate 2 raises a card (src/orders.ts,
 * src/boot.ts armOrderGate): one line of words, kind `card`, sent through the account (src/phone.ts),
 * which picks the recipient, the routing row (Cards waiting) and quiet hours.
 *
 * Text only: no button, no link, nothing that approves from the phone (D18, charter §8). A card is
 * answered in Gravit, in the browser, and nowhere else; the notice only says one is waiting. Every
 * URL is taken out (`<link>`) - a payee's included, since a link on the phone is something to tap -
 * and so is every line break, so a model-written field cannot pass itself off as a second line.
 *
 * Sent only by a face with the desk on (plan B1a ruling 10, src/main.ts), so a second face on a
 * scratch home never phones. The account's own Guard card for the same seat write phones too: two
 * cards per write is the accepted design.
 */
import { describeOrder } from "./orders.ts";
import type { PhoneClient } from "./phone.ts";

const BIN = "gravit-face";

/** The notice's longest line, the suffix included: a card's own line is already bounded per field
 * (orders.ts), and this bounds a call with very many fields. */
export const CARD_NOTICE_MAX = 600;

const SUFFIX = " — waiting in Gravit";
const PREFIX = "Your call · ";

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

/** `text` defanged: every link as `<link>`, every dot that could make a host as `·` (the block above). */
export function scrubLinks(text: string): string {
  return scrubLinkText(text);
}

/** A field the order's short form writes bare: one word of the kind a venue, a symbol or an order
 * type is. Anything else and the notice falls back to the card's own line, which quotes it. */
const WORD = /^[A-Za-z0-9._:/-]{1,40}$/;
const NUMBER = /^\d+(?:\.\d+)?$/;

const word = (v: unknown): string | undefined => (typeof v === "string" && WORD.test(v) ? v : undefined);
const amount = (v: unknown): string | undefined => {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return String(v);
  return typeof v === "string" && NUMBER.test(v) ? v : undefined;
};
const pick = (row: Record<string, unknown>, ...keys: string[]): unknown => {
  for (const key of keys) if (row[key] !== undefined && row[key] !== null) return row[key];
  return undefined;
};

/** `Buy 10 NVDA · limit 183 · alpaca-paper` for a single order whose side, size and symbol read as
 * words; undefined when any of them does not, and the caller uses the card's own line. */
function orderLine(args: unknown): string | undefined {
  if (args === null || typeof args !== "object" || Array.isArray(args)) return undefined;
  const row = args as Record<string, unknown>;
  const side = word(row.side)?.toLowerCase();
  if (side !== "buy" && side !== "sell") return undefined;
  const symbol = word(row.symbol);
  const qty = amount(row.qty);
  const usd = amount(row.usd);
  const size = qty ?? (usd === undefined ? undefined : `$${usd}`);
  if (symbol === undefined || size === undefined) return undefined;
  const parts = [`${side === "buy" ? "Buy" : "Sell"} ${size} ${symbol}`];
  const rawType = pick(row, "orderType", "order_type");
  const type = word(rawType);
  if (rawType !== undefined && type === undefined) return undefined;
  const limit = pick(row, "limitPrice", "limit_price");
  const stop = pick(row, "stopPrice", "stop_price");
  if ((limit !== undefined && amount(limit) === undefined) || (stop !== undefined && amount(stop) === undefined)) return undefined;
  /* "limit 183" says the type already; any other type is said once, before its prices */
  if (type !== undefined && !(type === "limit" && limit !== undefined)) parts.push(type);
  if (limit !== undefined) parts.push(`limit ${amount(limit)}`);
  if (stop !== undefined) parts.push(`stop ${amount(stop)}`);
  const venue = row.venue;
  if (venue !== undefined) {
    const v = word(venue);
    if (v === undefined) return undefined;
    parts.push(v);
  }
  return parts.join(" · ");
}

/**
 * The phone's line for a card raised on `name` with `args`.
 *
 * A single order (`portfolio_live_order`) reads as the operator says it - side, size, symbol, its
 * type and prices, the venue; any other seat write is `describeOrder` of the raw tool name (the part
 * after the last `__`), the card's own line without the server. No link, no line break.
 * @param name - the registered tool name (`exec.name`).
 * @param args - `exec.arguments`.
 * @returns `Your call · <what> — waiting in Gravit`, at most {@link CARD_NOTICE_MAX} characters.
 */
export function cardNoticeText(name: string, args: unknown): string {
  const raw = name.slice(name.lastIndexOf("__") + (name.includes("__") ? 2 : 0));
  const what = (raw === "portfolio_live_order" ? orderLine(args) : undefined) ?? describeOrder(raw, args);
  let line = what.replace(/\s*[\r\n]+\s*/g, " ").trim();
  line = scrubLinks(line);
  const room = CARD_NOTICE_MAX - PREFIX.length - SUFFIX.length;
  /* scrubbed again after the cut, which must neither leave nor make a link; the ellipsis is added after
   * (NFKC reads '…' as three dots), and a second scrub that lengthened the line is cut once more - a
   * prefix of a scrubbed line is still clean */
  if (line.length > room) line = `${scrubLinks(line.slice(0, room - 1)).slice(0, room - 1)}…`;
  return `${PREFIX}${line}${SUFFIX}`;
}

/**
 * Send a card's notice, kind `card`, and never throw or wait: Gate 2's listener calls this and
 * goes on to ask. What the account answers is read from the body (src/phone.ts): sent or queued
 * says nothing; held, refused, or no answer is one line, and nothing is retried - the card itself
 * waits in Gravit either way.
 * @param phone - the account's send, or undefined when there is none yet (one line).
 * @param name - the registered tool name.
 * @param args - its arguments.
 * @param log - where the one line goes.
 */
export function announceCard(
  phone: Pick<PhoneClient, "send"> | undefined,
  name: string,
  args: unknown,
  log: (line: string) => void = console.log,
): void {
  const notSent = (why: string): void => { log(`${BIN}: a card notice was not sent: ${why}`); };
  if (phone === undefined) {
    notSent("no phone (the account's half is off)");
    return;
  }
  try {
    phone.send("card", cardNoticeText(name, args)).then(
      (said) => { if ("held" in said) notSent(`the account held it (${said.held})`); },
      (err: unknown) => { notSent(err instanceof Error ? err.message : String(err)); },
    );
  } catch (err) {
    notSent(err instanceof Error ? err.message : String(err));
  }
}
