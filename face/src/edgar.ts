// face/src/edgar.ts
/** The EDGAR reader: a company's recent 8-K, 8-K/A and Form 4 filings, as SEC's submissions API lists them, for the
 * watch's filing rules (plan ruling 9). It reads two documents and nothing else: `company_tickers.json` for a
 * ticker's CIK, once per ET date, and a CIK's `submissions/CIK##########.json`.
 *
 * SEC'S TERMS. Every request names a contact (`User-Agent`, the operator's `ALPHA_EDGAR_USER_AGENT`), and requests
 * are spaced {@link EDGAR_SPACING_MS} apart - five a second, half SEC's ceiling. A ticker is looked up in SEC's
 * spelling, `.` as `-` (`BRK.B` is `BRK-B`).
 *
 * ACCEPTANCE TIME. `acceptanceDateTime` ends in `Z` but carries New York's wall clock (`2026-11-30T10:05:12.000Z` is
 * 10:05:12 ET), so its digits are read in America/New_York and written with the offset then in force
 * (`2026-11-30T10:05:12-05:00`). Should SEC's `Z` ever be true UTC, every time shifts by 4-5 hours; the drill checks
 * one filing against its EDGAR index page.
 *
 * ERRORS. A symbol's failure is its own `errors` entry and never stops the rest; `recentFilings` never rejects. A 401
 * or 403 is `refused: HTTP <code>`, which src/filings.ts reads as SEC refusing the contact.
 *
 * READ-ONLY. It takes `fetch` as a dependency (no test reaches sec.gov) and imports nothing but ./et.ts
 * (tests/edgar.test.ts pins both); its symbols arrive validated.
 * @module
 */
import { etClock, etDate } from "./et.ts";

/** SEC's ticker map: `{ "0": { cik_str, ticker, title }, ... }`. */
export const EDGAR_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
/** A company's submissions, its CIK padded to ten digits. */
export const EDGAR_SUBMISSIONS = (cik: number): string => `https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`;
/** The least time between two requests' starts. */
export const EDGAR_SPACING_MS = 200;
/** The largest body read; a larger one is that symbol's error. */
export const EDGAR_RESPONSE_MAX = 16 * 1024 * 1024;
/** One request's own deadline, beside the poll's signal. */
export const EDGAR_REQUEST_TIMEOUT_MS = 20_000;

/** The fetch the reader is given: the global `fetch` in the face, a fake in every test. */
export type EdgarFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<Response>;

/** One filing, as SEC lists it under a symbol's CIK. */
export interface Filing {
  symbol: string;
  cik: number;
  accession: string;
  form: string;
  filingDate: string;
  /** New York's wall time with its offset, `2026-11-30T10:05:12-05:00`; `null` when SEC gives none or one unreadable. */
  accepted: string | null;
  /** An 8-K's items, `2.02,9.01`; `null` when empty. */
  items: string | null;
  primaryDocument: string | null;
  /** The primary document, or the filing's index page without one. */
  url: string;
}

/** What one poll found: the filings, and the symbols that failed, each with its reason. */
export interface EdgarResult {
  filings: Filing[];
  errors: { symbol: string; error: string }[];
}

/** The reader. */
export interface Edgar {
  /**
   * The given forms filed on or after `since` for each symbol, in the symbols' order and SEC's order within each. A
   * ticker SEC does not list gives nothing and no error. Never rejects.
   * @param symbols - US tickers, validated.
   * @param forms - the forms kept.
   * @param since - the earliest filing date kept, `YYYY-MM-DD`.
   * @param opts - `stopAfterMs`: no symbol starts after this long; `signal`: the poll's abort.
   */
  recentFilings(symbols: string[], forms: readonly string[], since: string, opts: { stopAfterMs: number; signal: AbortSignal }): Promise<EdgarResult>;
}

/* ---------- the parse ---------- */

const ACCEPTED_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d+)?Z?$/;

/** SEC's `acceptanceDateTime` read on New York's wall clock, with the offset in force then; `null` for an empty, an
 * unreadable or a nonexistent wall time (one inside the spring-forward hour). In the repeated fall-back hour the
 * earlier reading, EDT, is taken. */
function acceptedOf(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const match = ACCEPTED_RE.exec(raw);
  if (match === null) return null;
  const [, date, clock] = match;
  const wall = Date.parse(`${date}T${clock}Z`);
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0, 19) !== `${date}T${clock}`) return null;
  for (const hours of [4, 5]) {
    const at = new Date(wall + hours * 3_600_000);
    if (etDate(at) === date && etClock(at) === clock) return `${date}T${clock}-0${hours}:00`;
  }
  return null;
}

/** A non-empty string, or `null`. */
const textOrNull = (x: unknown): string | null => (typeof x === "string" && x !== "" ? x : null);

/**
 * The given forms filed on or after `since` in a submissions body's `filings.recent`, in SEC's order. An entry whose
 * form, filing date or accession is not a non-empty string is skipped. Pure.
 * @param symbol - the ticker the filings are listed under.
 * @param cik - its CIK.
 * @param json - the parsed submissions body.
 * @param forms - the forms kept.
 * @param since - the earliest filing date kept, `YYYY-MM-DD`.
 * @throws when the body has no `filings.recent` with a `form` list.
 */
export function parseSubmissions(symbol: string, cik: number, json: unknown, forms: readonly string[], since: string): Filing[] {
  const recent = (json as { filings?: { recent?: Record<string, unknown> } } | null)?.filings?.recent;
  if (typeof recent !== "object" || recent === null || !Array.isArray(recent.form)) {
    throw new Error("the submissions body has no filings.recent");
  }
  const column = (name: string): unknown[] => (Array.isArray(recent[name]) ? (recent[name] as unknown[]) : []);
  const [form, filingDate, accession, accepted, items, primaryDocument] =
    ["form", "filingDate", "accessionNumber", "acceptanceDateTime", "items", "primaryDocument"].map(column);
  const out: Filing[] = [];
  for (let i = 0; i < form.length; i++) {
    const f = form[i], date = filingDate[i], acc = accession[i];
    if (typeof f !== "string" || typeof date !== "string" || typeof acc !== "string" || f === "" || date === "" || acc === "") continue;
    if (!forms.includes(f) || date < since) continue;
    const doc = textOrNull(primaryDocument[i]);
    const folder = `https://www.sec.gov/Archives/edgar/data/${cik}/${acc.replaceAll("-", "")}`;
    out.push({
      symbol, cik, accession: acc, form: f, filingDate: date, accepted: acceptedOf(accepted[i]), items: textOrNull(items[i]),
      primaryDocument: doc, url: doc === null ? `${folder}/${acc}-index.htm` : `${folder}/${doc}`,
    });
  }
  return out;
}

/* ---------- the reader ---------- */

/** A failure the reader names itself, its message already the line. */
class EdgarError extends Error {}

/** A thrown value as one line of at most 200 characters; a bare `fetch failed` carries its cause. */
function errorLine(error: unknown): string {
  let text = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error ? error.cause : undefined;
  if (text === "fetch failed" && cause instanceof Error && cause.message !== "") text = `${text}: ${cause.message}`;
  const line = text.split(/\r?\n/, 1)[0].trim().slice(0, 200);
  return line === "" ? "the request failed and gave no reason" : line;
}

/** A body read to its end, refused past {@link EDGAR_RESPONSE_MAX}. A body dropped is cancelled without waiting: a
 * cloned body's cancel settles only once its twin is cancelled too. */
async function readCapped(res: Response): Promise<string> {
  if (Number(res.headers.get("content-length")) > EDGAR_RESPONSE_MAX) {
    void res.body?.cancel().catch(() => {});
    throw new EdgarError("response over 16 MiB");
  }
  if (res.body === null) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > EDGAR_RESPONSE_MAX) {
      void reader.cancel().catch(() => {});
      throw new EdgarError("response over 16 MiB");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** SEC's ticker map as ticker to CIK. */
function tickerMapOf(json: unknown): Map<string, number> {
  if (typeof json !== "object" || json === null || Array.isArray(json)) throw new EdgarError("company_tickers.json is not a ticker map");
  const map = new Map<string, number>();
  for (const entry of Object.values(json)) {
    const { ticker, cik_str: cik } = (entry ?? {}) as { ticker?: unknown; cik_str?: unknown };
    if (typeof ticker === "string" && typeof cik === "number" && Number.isInteger(cik) && cik > 0 && !map.has(ticker)) map.set(ticker, cik);
  }
  return map;
}

/**
 * The reader over `deps.fetch`. It keeps the ticker map of the ET date it was read on, and asks again on a new date;
 * a failed read is not kept, so the next poll asks again.
 * @param deps - `fetch`; `userAgent`, the contact SEC asks for; `now` and `sleep`, the clock and the pause, real by
 *   default.
 */
export function createEdgar(deps: { fetch: EdgarFetch; userAgent: string; now?: () => number; sleep?: (ms: number) => Promise<void> }): Edgar {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const headers = { "User-Agent": deps.userAgent, Accept: "application/json" };
  let lastStart: number | undefined;
  let tickers: { date: string; map: Map<string, number> } | undefined;

  /** One paced request's parsed body; a non-2xx, a body too large or not JSON throws its line. */
  async function getJson(url: string, signal: AbortSignal): Promise<unknown> {
    if (lastStart !== undefined) {
      const wait = EDGAR_SPACING_MS - (now() - lastStart);
      if (wait > 0) await sleep(wait);
    }
    signal.throwIfAborted();
    lastStart = now();
    const res = await deps.fetch(url, { headers: { ...headers }, signal: AbortSignal.any([signal, AbortSignal.timeout(EDGAR_REQUEST_TIMEOUT_MS)]) });
    if (!res.ok) {
      void res.body?.cancel().catch(() => {});
      throw new EdgarError(res.status === 401 || res.status === 403 ? `refused: HTTP ${res.status}` : `HTTP ${res.status}`);
    }
    return JSON.parse(await readCapped(res));
  }

  return {
    async recentFilings(symbols, forms, since, opts) {
      const start = now();
      const result: EdgarResult = { filings: [], errors: [] };
      const today = etDate(new Date(start));
      if (tickers?.date !== today) {
        try {
          tickers = { date: today, map: tickerMapOf(await getJson(EDGAR_TICKERS_URL, opts.signal)) };
        } catch (error) {
          tickers = undefined;
          const line = errorLine(error);
          for (const symbol of symbols) result.errors.push({ symbol, error: line });
          return result;
        }
      }
      const map = tickers.map;
      for (const symbol of symbols) {
        if (now() - start > opts.stopAfterMs) {
          result.errors.push({ symbol, error: "deadline" });
          continue;
        }
        const cik = map.get(symbol.replaceAll(".", "-"));
        if (cik === undefined) continue;
        try {
          if (opts.signal.aborted) throw opts.signal.reason;
          result.filings.push(...parseSubmissions(symbol, cik, await getJson(EDGAR_SUBMISSIONS(cik), opts.signal), forms, since));
        } catch (error) {
          result.errors.push({ symbol, error: errorLine(error) });
        }
      }
      return result;
    },
  };
}
