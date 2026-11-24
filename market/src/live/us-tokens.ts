/** THE ROBINHOOD TOKEN NAMES AND THE NAME GATE: what each of Robinhood's Stock Tokens is called, and the check that a Robinhood quote is
 * taken only for the share the token stands for.
 *
 * Robinhood prices a Stock Token under its tokenSymbol (api.robinhood.com/rhj/prices), and that symbol is not always the share's
 * ticker: SATS is EchoStar's token, while SATS the ticker is now Strive's preferred stock. So a quote is taken for a symbol only where
 * the token's name and the directory's company name for that symbol (us-directory.ts) agree.
 *
 * The names come from GET api.robinhood.com/rhj/assets, body { assets: [{ tokenSymbol, tokenName, … }] }, where tokenName reads
 * "EchoStar • Robinhood Token" (a bullet with a space either side): the name is the part before the bullet. The list is read on the
 * process's own "robinhood" lane, kept TOKEN_NAMES_MS (a day: the tokens change by a name now and then) and, if the read is refused or
 * its pace throws, asked again no sooner than TOKEN_RETRY_MS, so a down host is asked every ten minutes and not by every listing. A
 * read already on its way is shared by everyone who asks.
 *
 * AGREEMENT (namesAgree): lower-case both names; drop apostrophes without a space ("Kohl's" becomes "kohls") and turn any other
 * punctuation into spaces; drop the generic words (inc, corp, company, class, series, shares, trust, etf…); the names agree when they
 * share a word, or when the initials of one name make a word of the other ("General Electric" gives "ge", which GE Aerospace has;
 * "Advanced Micro Devices" gives "amd"). Initials of fewer than two words are not used: one word's initial is a single letter that
 * would agree with anything.
 */
import { isRefusal, type Refusal } from "../core/errors.ts";
import { no } from "../refuse.ts";
import type { Pace } from "./history.ts";
import { publicNo } from "./public-markets.ts";
import { US_SHARES } from "./public-stocks.ts";
import type { Http } from "./types.ts";
import type { DirEntry } from "./us-directory.ts";

export const RH_ASSETS = "https://api.robinhood.com/rhj/assets";
/** how long the token names are kept: a day */
export const TOKEN_NAMES_MS = 86_400_000;
/** how soon a refused read is asked again: ten minutes */
export const TOKEN_RETRY_MS = 600_000;
const VENUE = "robinhood";
const NAME = "Robinhood";
/** what tokenName puts after the company's name: a bullet (code point 8226) between spaces */
const BULLET = " • ";

/** the words a company's name carries without saying which company: legal forms and share-class boilerplate */
const GENERIC = new Set(["inc", "corp", "corporation", "company", "co", "the", "common", "stock", "class", "a", "b", "ordinary", "shares", "ltd", "plc", "trust", "etf", "series"]);

/** a name's meaningful words, by the rule in the header */
function words(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !GENERIC.has(w));
}

/** whether a token's name and a directory Security Name name one company (the rule in the header; either name may carry its share-class
 * boilerplate or not) */
export function namesAgree(tokenName: string, securityName: string): boolean {
  const a = words(tokenName);
  const b = words(securityName);
  if (a.some((w) => b.includes(w))) return true;
  const initials = (ws: string[]) => (ws.length >= 2 ? ws.map((w) => w[0]).join("") : undefined);
  const ia = initials(a);
  const ib = initials(b);
  return (ia !== undefined && b.includes(ia)) || (ib !== undefined && a.includes(ib));
}

export interface TokenNames {
  /** tokenSymbol → the token's name (before " • "), read now where none is kept */
  read(): Promise<ReadonlyMap<string, string> | Refusal>;
  /** the names as last read, without reading; undefined before the first answer */
  now(): ReadonlyMap<string, string> | undefined;
  clear(): void;
}

export function robinhoodTokenNames(deps: { http: Http; pace: Pace; clock: () => number }): TokenNames {
  const { http, pace, clock } = deps;
  let kept: { until: number; p: Promise<ReadonlyMap<string, string> | Refusal> } | undefined;
  let last: ReadonlyMap<string, string> | undefined;

  const fetchNames = async (): Promise<ReadonlyMap<string, string> | Refusal> => {
    let r;
    try {
      await pace(VENUE);
      r = await http(RH_ASSETS);
    } catch {
      return no("E_VENUE_UNREACHABLE", { venue: VENUE, message: `${NAME} did not answer` });
    }
    if (r.status !== 200) return publicNo(VENUE, NAME, r);
    const assets = (r.body as { assets?: unknown } | null | undefined)?.assets;
    if (!Array.isArray(assets)) return no("E_VENUE_REJECTED", { venue: VENUE, message: `${NAME} answered a token list this could not read`, native: { status: 200 } });
    const names = new Map<string, string>();
    for (const a of assets as Array<{ tokenSymbol?: unknown; tokenName?: unknown }>) {
      if (typeof a?.tokenSymbol !== "string" || typeof a.tokenName !== "string") continue;
      names.set(a.tokenSymbol, a.tokenName.split(BULLET)[0]?.trim() ?? a.tokenName);
    }
    last = names;
    return names;
  };

  return {
    read() {
      if (kept && clock() < kept.until) return kept.p;
      const entry: { until: number; p: Promise<ReadonlyMap<string, string> | Refusal> } = { until: Number.POSITIVE_INFINITY, p: Promise.resolve(new Map()) };
      entry.p = fetchNames().then((r) => {
        // the keep runs from when the answer came; a refusal is asked again after the shorter wait
        if (kept === entry) entry.until = clock() + (isRefusal(r) ? TOKEN_RETRY_MS : TOKEN_NAMES_MS);
        return r;
      });
      kept = entry;
      return entry.p;
    },
    now: () => last,
    clear() {
      kept = undefined;
      last = undefined;
    },
  };
}

/** Robinhood's quote may be taken for `symbol`: with both maps, the directory lists it, Robinhood has a token of that symbol and the
 * token's name agrees with the directory's — a ticker with no token of its name is not taken (Robinhood quotes by token symbol, and a
 * quote under a symbol no token names is one nothing here can check); with either map missing, only US_SHARES (the cold-start set) */
export function listedGate(dir: ReadonlyMap<string, DirEntry> | undefined, tokens: ReadonlyMap<string, string> | undefined): (symbol: string) => boolean {
  if (!dir || !tokens) return (s) => US_SHARES.includes(s);
  return (s) => {
    const entry = dir.get(s);
    if (!entry) return false;
    const token = tokens.get(s);
    return token !== undefined && namesAgree(token, entry.name);
  };
}
