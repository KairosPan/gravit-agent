/** THE US SYMBOL DIRECTORY: which tickers the US stocks line lists, and what each is called, read from Nasdaq Trader's own symbol
 * directory — two small pipe-delimited text files that Nasdaq publishes for exactly this, keyless:
 *   GET www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt    every Nasdaq-listed security
 *   GET www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt     every other listing (NYSE, NYSE American, NYSE Arca, Cboe BZX, IEX)
 * Each file has a header row, one row a security, and a last line "File Creation Time: …" that is not a row. Lines end in CRLF. The
 * columns are found by their header NAME, never by position: nasdaqlisted has "Symbol", "Security Name", "Test Issue" and "ETF";
 * otherlisted has "ACT Symbol", "Security Name", "Exchange", "ETF" and "Test Issue", in another order.
 *
 * It takes the place of Cboe's symbol book, which this machine's address cannot reach (Cboe's CDN answers it a page of its own). The
 * book here is plain tickers only — one to five letters, a class letter after a dot (BRK.B) — with the test issues (Test Issue "Y")
 * left out; preferreds, warrants and units carry a dollar sign or another mark in the directory ("ABR$D") and are not plain tickers.
 * Where a symbol is in both files the first row (nasdaqlisted's) is the one kept.
 *
 * The files are read WHOLE (they are well past the two thousand characters the market keeps of any other answer: `maxText`), one after
 * the other on the process's own "nasdaqtrader" lane, and with no user-agent header of ours: the host is asked as a plain client. They
 * are kept DIRECTORY_MS (the lists change by a few names a day); an answer that is a refusal is kept DIRECTORY_RETRY_MS, so a host that
 * is down is asked every ten minutes and not by every listing. A read already on its way is shared by everyone who asks.
 */
import { isRefusal, type Refusal } from "../core/errors.ts";
import { no } from "../refuse.ts";
import type { Pace } from "./history.ts";
import { publicNo } from "./public-markets.ts";
import type { Http } from "./types.ts";

export const NASDAQ_TRADER = "https://www.nasdaqtrader.com/dynamic/SymDir";
/** how long the two files are kept: twelve hours */
export const DIRECTORY_MS = 43_200_000;
/** how soon a refused read is asked again: ten minutes */
export const DIRECTORY_RETRY_MS = 600_000;
/** the most of a file read: the real ones are about 0.4 MB (nasdaqlisted) and 0.8 MB (otherlisted) */
const FILE_TEXT_MAX = 2_000_000;
const NAME = "Nasdaq Trader";
const VENUE = "nasdaqtrader";
/** a plain ticker, as public-stocks.ts TICKER and us-quotes.ts US_TICKER write it */
const TICKER = /^[A-Z]{1,5}(\.[A-Z])?$/;

export interface DirEntry {
  symbol: string;
  name: string;
  etf: boolean;
  /** the listing exchange's letter: "Q" for every row of nasdaqlisted, the Exchange column's for otherlisted (N, A, P, Z, V) */
  exchange: string;
}

/** a file's rows as records by header name: undefined when the first line is not a header that names the columns this needs */
function rowsOf(text: string, symbolColumn: string): Array<Record<string, string>> | undefined {
  const lines = text.split(/\r?\n/);
  const head = (lines[0] ?? "").split("|").map((h) => h.trim());
  const need = [symbolColumn, "Security Name", "Test Issue", "ETF"];
  if (!need.every((h) => head.includes(h))) return undefined;
  const rows: Array<Record<string, string>> = [];
  for (const line of lines.slice(1)) {
    // the closing "File Creation Time: …" line, and a blank one, are not rows
    if (!line.trim() || line.startsWith("File Creation Time")) continue;
    const cells = line.split("|");
    if (cells.length < head.length) continue;
    const row: Record<string, string> = {};
    head.forEach((h, i) => (row[h] = (cells[i] ?? "").trim()));
    rows.push(row);
  }
  return rows;
}

/** both files' text → plain-ticker entries, test issues dropped, first row of a symbol wins; columns found by header name. A file with no
 * header row adds nothing (the reader below tells that apart as a refusal: this is the pure parse) */
export function parseDirectory(nasdaqListed: string, otherListed: string): DirEntry[] {
  const seen = new Map<string, DirEntry>();
  const take = (rows: Array<Record<string, string>> | undefined, symbolColumn: string, exchangeOf: (r: Record<string, string>) => string) => {
    for (const r of rows ?? []) {
      const symbol = r[symbolColumn] ?? "";
      if (!TICKER.test(symbol) || r["Test Issue"] === "Y" || seen.has(symbol)) continue;
      seen.set(symbol, { symbol, name: displayName(r["Security Name"] ?? ""), etf: r["ETF"] === "Y", exchange: exchangeOf(r) });
    }
  };
  take(rowsOf(nasdaqListed, "Symbol"), "Symbol", () => "Q");
  take(rowsOf(otherListed, "ACT Symbol"), "ACT Symbol", (r) => r["Exchange"] ?? "");
  return [...seen.values()];
}

/** a Security Name for display: the share-class boilerplate trimmed ("Apple Inc. - Common Stock" becomes "Apple Inc."; the class stays:
 * "Alphabet Inc. - Class A Common Stock" becomes "Alphabet Inc. Class A"). A name that does not end in "Common Stock" (an ETF's) is only
 * trimmed of its padding */
export function displayName(securityName: string): string {
  return securityName
    .trim()
    .replace(/(?:\s+-)?\s+common stock$/i, "")
    .replace(/\s+-\s+/g, " ")
    .trim();
}

export interface UsDirectory {
  /** the entries, read now where none is kept (both files, one after the other, on the "nasdaqtrader" lane) */
  entries(): Promise<DirEntry[] | Refusal>;
  /** the entries as last read, by symbol, without reading; undefined before the first answer */
  now(): ReadonlyMap<string, DirEntry> | undefined;
  clear(): void;
}

export function usDirectory(deps: { http: Http; pace: Pace; clock: () => number }): UsDirectory {
  const { http, pace, clock } = deps;
  let kept: { until: number; p: Promise<DirEntry[] | Refusal> } | undefined;
  let last: ReadonlyMap<string, DirEntry> | undefined;

  /** one file's text, or the refusal that says why not */
  const file = async (name: string): Promise<string | Refusal> => {
    let r;
    // the lane's wait inside the try as well: a pace that throws is the directory not answering — a refusal, held DIRECTORY_RETRY_MS like
    // any other, never a rejection kept for twelve hours
    try {
      await pace(VENUE);
      // asked as the plain text it is: the host guard's default `accept: application/json` gets HTTP 406 from Nasdaq Trader (seen live
      // 2026-11-24, the first read after the restart)
      r = await http(`${NASDAQ_TRADER}/${name}`, { maxText: FILE_TEXT_MAX, headers: { accept: "text/plain" } });
    } catch {
      return no("E_VENUE_UNREACHABLE", { venue: VENUE, message: `${NAME} did not answer` });
    }
    if (r.status !== 200) return publicNo(VENUE, NAME, r);
    return r.text;
  };

  const read = async (): Promise<DirEntry[] | Refusal> => {
    const nasdaq = await file("nasdaqlisted.txt");
    if (isRefusal(nasdaq)) return nasdaq;
    const other = await file("otherlisted.txt");
    if (isRefusal(other)) return other;
    if (rowsOf(nasdaq, "Symbol") === undefined || rowsOf(other, "ACT Symbol") === undefined) {
      return no("E_VENUE_REJECTED", { venue: VENUE, message: `${NAME} answered a file this could not read: no header row`, native: { status: 200 } });
    }
    const entries = parseDirectory(nasdaq, other);
    last = new Map(entries.map((e) => [e.symbol, e]));
    return entries;
  };

  return {
    entries() {
      const now = clock();
      if (kept && now < kept.until) return kept.p;
      const entry: { until: number; p: Promise<DirEntry[] | Refusal> } = { until: Number.POSITIVE_INFINITY, p: Promise.resolve([]) };
      entry.p = read().then((r) => {
        // the keep runs from when the answer came, not from when it was asked; a refusal is asked again after the shorter wait
        if (kept === entry) entry.until = clock() + (isRefusal(r) ? DIRECTORY_RETRY_MS : DIRECTORY_MS);
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
