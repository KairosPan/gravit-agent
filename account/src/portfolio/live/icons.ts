/**
 * A MARKET'S ICON (Markets' rows and the one drawer): the logo shown beside a market's name, as the address of an image the PAGE loads itself
 * in an <img>. The account never fetches, keeps or serves these images: each comes from where its owner publishes it, and one that does not
 * load leaves the letter tile in its place.
 *
 *   a coin, a coin's perpetual       Elbstream's logo for the coin        https://api.elbstream.com/logos/crypto/BTC
 *   a share or a fund                Elbstream's logo for the ticker      https://api.elbstream.com/logos/symbol/AAPL
 *   a tokenised share                the share's: Ondo's NVDAon, xStocks' NVDAx and Robinhood's NVDA are NVDA's (by their issuers, dex.ts
 *                                    ISSUERS and robinhood.ts STOCK_TOKEN_ISSUER); a fund's token (Ondo's OUSG and USDY, BlackRock's BUIDL)
 *                                    its own coin logo; any other none — a share's ticker read as a coin's symbol can be another token's
 *                                    logo (Elbstream's crypto TSLA is FTX's tokenised Tesla)
 *   a pre-IPO company                the icon of the company's own website (preipo.ts `domain`), through Google's favicon service
 *   an event                         the venue's own picture: Polymarket's for the market or its event and Polymarket US's for the market
 *                                    (Listing `image`, from Polymarket's own host), Kalshi's for the series (assets.kalshi.com, the host
 *                                    Kalshi's own API names for it — events/{ticker}/metadata `image_url`, read 2026-10-13 — by the series every
 *                                    Kalshi market ticker starts with)
 *
 * Trade's rows that are not market rows take theirs by the same rules: a holding (holdingIcon) by what its venue says it is, an open
 * position (positionIcon) by its contract's symbol.
 *
 * Elbstream's logos (elbstream.com/logos, read 2026-10-11) are free to show straight from its host in an <img>, with a link to elbstream.com
 * wherever one is shown — the page says "Logos by Elbstream" at 12pt — and keeping or serving them from elsewhere is not part of that plan, so
 * nothing is kept. Only a symbol that reads as one goes into an address, and a venue's picture only from the venue's own host, over https.
 */
import { companyOf, PRE_IPO_COMPANIES, PRE_IPO_GROUP } from "./preipo.ts";
import { STOCK_TOKEN_ISSUER } from "./robinhood.ts";

export const ELBSTREAM_LOGOS = "https://api.elbstream.com/logos";
const KALSHI_IMAGES = "https://assets.kalshi.com/series-images-webp";
const FAVICONS = "https://www.google.com/s2/favicons";
/** where a venue's own picture is taken from: Polymarket's host (Gamma's `icon`, the US gateway's `image`) */
const VENUE_IMAGE_HOSTS: ReadonlySet<string> = new Set(["polymarket-upload.s3.us-east-2.amazonaws.com"]);

/** a coin's symbol as one (BTC, 1INCH); a ticker as one (AAPL, BRK.B); a Kalshi series (KXFEDDECISION) */
const COIN = /^[A-Z0-9]{1,15}$/;
const TICKER = /^[A-Z][A-Z0-9]{0,6}(?:[.-][A-Z0-9]{1,3})?$/;
const SERIES = /^[A-Z][A-Z0-9]{1,40}$/;

/** the issuers whose tokens are funds, not shares (dex.ts ISSUERS): their tokens are shown by their own coin logos */
const FUND_ISSUER = /\bOndo Finance\b|\bBlackRock\b/;

const coinLogo = (symbol: string): string | undefined => (COIN.test(symbol) ? `${ELBSTREAM_LOGOS}/crypto/${symbol}` : undefined);
const tickerLogo = (ticker: string): string | undefined => (TICKER.test(ticker) ? `${ELBSTREAM_LOGOS}/symbol/${encodeURIComponent(ticker)}` : undefined);

/** the share a tokenised share tracks, by its issuer: Ondo's tokens are the ticker and "on", xStocks' the ticker and "x", Robinhood's the
 * ticker itself. Undefined for a token that is not a share */
function shareOf(base: string, issuer: string | undefined): string | undefined {
  if (!issuer) return undefined;
  if (issuer === STOCK_TOKEN_ISSUER) return base;
  if (/\bOndo Global Markets\b/.test(issuer)) return /^(.+)ON$/.exec(base)?.[1];
  if (/\bxStocks\b/.test(issuer)) return /^(.+)X$/.exec(base)?.[1];
  return undefined;
}

/** a pre-IPO company's logo: its own website's icon (preipo.ts `domain`); none for a company the account does not know */
function companyIcon(slug: string): string | undefined {
  const company = PRE_IPO_COMPANIES.find((c) => c.slug === slug);
  return company ? `${FAVICONS}?domain=${encodeURIComponent(company.domain)}&sz=128` : undefined;
}

/** a Kalshi contract's picture: its series', the part of its ticker before the first dash (`KXFEDDECISION-26OCT-H0`) */
function kalshiIcon(ticker: string): string | undefined {
  const series = ticker.split("-")[0]!.toUpperCase();
  return SERIES.test(series) ? `${KALSHI_IMAGES}/${series}.webp` : undefined;
}

/** a venue's own picture, from its own host over https; anything else is not shown */
export function venueImage(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && VENUE_IMAGE_HOSTS.has(u.hostname) ? u.href : undefined;
  } catch {
    return undefined;
  }
}

/** a market row's icon (see the top of this file): its key, kind and base as explore.ts makes them, its issuer, its company's group, and for
 * an event the venue's own picture where a listing carried one */
export function iconOf(i: { key: string; kind: string; base?: string | undefined; issuer?: string | undefined; group?: { id: string } | undefined }, image?: string): string | undefined {
  const base = String(i.base ?? "").trim().toUpperCase();
  if (i.kind === "event") {
    const own = venueImage(image);
    if (own) return own;
    return i.key.startsWith("kalshi:") ? kalshiIcon(i.key.slice("kalshi:".length)) : undefined;
  }
  if (i.group?.id.startsWith(PRE_IPO_GROUP)) return companyIcon(i.group.id.slice(PRE_IPO_GROUP.length));
  if (i.kind === "stock") return tickerLogo(base);
  if (i.kind === "rwa") {
    const share = shareOf(base, i.issuer);
    if (share) return tickerLogo(share);
    return i.issuer && FUND_ISSUER.test(i.issuer) ? coinLogo(base) : undefined;
  }
  if (i.kind === "coin" || i.kind === "perp") return coinLogo(base);
  return undefined;
}

/** the fund tokens a wallet holds (address.ts reads Ondo's OUSG, rOUSG and USDY; BlackRock's BUIDL): a fund, not a share — its own coin logo */
const FUND_TOKENS: ReadonlySet<string> = new Set(["OUSG", "ROUSG", "USDY", "BUIDL"]);

/** who issues a token a venue holds, by the words of its holding line: a wallet's says the token's kind (dex.ts: "Ethereum · Ondo Stock",
 * "· xStock"; robinhood.ts: "Robinhood Chain · Stock Token"), a paper account's the listing it came from ("paper · NVDAon/USDC@Ethereum from
 * Ondo Global Markets", "from xStocks at Gate", "from Robinhood Stock Tokens") */
function issuerOfLine(note: string): string | undefined {
  if (/\bStock Tokens?\b/.test(note)) return STOCK_TOKEN_ISSUER;
  if (/\bOndo (Stock|Global Markets)\b/.test(note)) return "Ondo Global Markets";
  if (/\bxStocks?\b/.test(note)) return "Backed (xStocks)";
  return undefined;
}

/** A HOLDING's logo (Trade's "You hold"), by what its venue says it is, from the same sources as a market row's: a coin or a dollar coin by
 * the coin's, a share by its ticker's, a token an issuer stands behind by its share's (the issuer read from the holding's line) or, a fund's
 * token, by its own coin's; a Kalshi contract (`<ticker>:YES`) by its series' picture — held at Kalshi itself, or at a paper account, whose
 * markets in that shape are Kalshi's own listing's (`connector`). Anything else none: an event contract at another venue takes its picture
 * from a market row that lists it (trade.js), and a token whose issuer its line does not say has none */
export function holdingIcon(h: { asset: string; class?: string | undefined; note?: string | undefined }, connector?: string | undefined): string | undefined {
  const asset = String(h.asset ?? "").trim();
  const up = asset.toUpperCase();
  if (h.class === "crypto" || h.class === "stable") return coinLogo(up);
  if (h.class === "equity") return tickerLogo(up);
  if (h.class === "rwa") {
    if (FUND_TOKENS.has(up)) return coinLogo(up);
    const share = shareOf(up, issuerOfLine(String(h.note ?? "")));
    return share ? tickerLogo(share) : undefined;
  }
  if (h.class === "event") {
    if (connector !== "live:kalshi" && connector !== "live:paper") return undefined;
    const k = /^([A-Z][A-Z0-9]{1,40}-[A-Z0-9.-]{1,60}):(YES|NO)$/.exec(asset);
    return k ? kalshiIcon(k[1]!) : undefined;
  }
  return undefined;
}

/** An OPEN POSITION's logo (Trade's "You hold" under Perps and Pre-IPO), by its contract's symbol as the venue names it (`BTC-PERP`,
 * `BTC/USDT:USDT`, `io:ANTH-PERP`): a company's own website icon where it names a pre-IPO company the account knows, else the coin's. A
 * Hyperliquid HIP-3 market (`xyz:GOLD`) takes only a company's: its letters may be a share's, an index's or a metal's, never a coin's */
export function positionIcon(p: { symbol: string; kind?: string | undefined }): string | undefined {
  if (p.kind !== "perp" && p.kind !== "future") return undefined;
  const s = String(p.symbol ?? "").trim();
  const hip3 = /^[a-z][a-z0-9]{0,7}:([A-Za-z0-9]{1,24})/.exec(s);
  const base = hip3 ? hip3[1]!.toUpperCase() : (s.split("@")[0]!.split(/[/:]/)[0]!.replace(/-(USDT?|USDC|USD)-SWAP$/i, "").replace(/[-_](PERP|SWAP|PERPETUAL)$/i, "").split("-")[0] ?? "").toUpperCase();
  if (!base) return undefined;
  const company = companyOf(base);
  if (company?.known) return companyIcon(company.slug);
  return hip3 ? undefined : coinLogo(base);
}
