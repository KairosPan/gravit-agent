// face/src/market-news.ts
/**
 * The face's headline read: the Market's `GET /api/news?symbols=<A,B>&since=<ISO>` (market/src/reads.ts), asked
 * server-side for the desk's why post (src/alert-text.ts `whyPost`, spec §5.3). It is mounted for no browser: no
 * route of the face's proxies it.
 *
 * {@link marketNews} asks the symbols, each once and upper-cased, {@link NEWS_SYMBOLS_MOST} to a GET, at the market the
 * `mcp-market` row reads (`FACE_MARKET_URL`, src/market-row.ts `marketUrl`), cut at {@link NEWS_ABORT_MS} on the headers and the body
 * (src/upstream-proxy.ts `askUpstream`; the Market bounds each symbol inside it). Each symbol comes back as its
 * headlines, newest first as the Market lists them, or `unavailable` with why:
 * - the Market's own `unavailable` reason for a symbol whose feed refused;
 * - a symbol not a US ticker by the Market's rule: `not a US ticker`, never asked;
 * - a refusal (409), a malformed query (400), any other status, no answer in time, or a body not of the news shape:
 *   every symbol of that GET, the reason naming which;
 * - a symbol the answer does not list. A headline not of the shape, or whose URL is not `https://` or is longer than
 *   {@link NEWS_URL_MAX} characters, is left out. Never rejects.
 * @module
 */
import { marketUrl } from "./market-row.ts";
import { askUpstream } from "./upstream-proxy.ts";

/** One headline as the Market gives it: its time (ISO, UTC), its outlet, its title and its article's URL. */
export interface Headline { time: string; outlet: string; title: string; url: string }

/** A symbol's headlines, or why it has none. */
export type NewsAnswer = { headlines: Headline[] } | { unavailable: string };

/** How long the read waits for the Market's answer, its headers and its body. */
export const NEWS_ABORT_MS = 10_000;

/** The longest reason the read quotes from the Market, in characters (code points). */
const REASON_MAX = 300;

/** `text` as one line, cut to {@link REASON_MAX} characters with a `…`. */
function reasonOf(text: string): string {
  const chars = [...text.replace(/[\n\r\v\f\u0085\u2028\u2029]+/g, " ")];
  return chars.length <= REASON_MAX ? chars.join("") : `${chars.slice(0, REASON_MAX - 1).join("")}…`;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The longest headline URL the read keeps, in characters. */
export const NEWS_URL_MAX = 500;

/** A headline of the shape, its URL `https://` and at most {@link NEWS_URL_MAX} characters - any other is left out, so
 * the desk is never handed a link of another scheme. */
const isHeadline = (v: unknown): v is Headline =>
  isRecord(v) && typeof v.time === "string" && typeof v.outlet === "string" && typeof v.title === "string" && typeof v.url === "string"
  && v.url.startsWith("https://") && v.url.length <= NEWS_URL_MAX;

/** Why a non-200 answer has no headlines: the refusal's code and words, a 400's error, or the status. */
function failureOf(status: number, body: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = undefined;
  }
  if (status === 409 && isRecord(parsed) && isRecord(parsed.refusal)) {
    const { code, message } = parsed.refusal;
    if (typeof code === "string" && typeof message === "string") return reasonOf(`the Market refused (${code}): ${message}`);
  }
  if (status === 400 && isRecord(parsed) && typeof parsed.error === "string") return reasonOf(`the Market answered 400: ${parsed.error}`);
  return `the Market answered ${status}`;
}

/** The most symbols one GET asks: the Market refuses more (market/src/reads.ts `NEWS_SYMBOLS_MOST`). */
export const NEWS_SYMBOLS_MOST = 10;

/** A US ticker by the Market's rule (market/src/live/us-quotes.ts `US_TICKER`): the Market refuses a query naming
 * any other, so the read leaves such a symbol out rather than lose the rest. */
const US_TICKER = /^[A-Z]{1,5}(\.[A-Z])?$/;

/** One GET for `asked` (at most {@link NEWS_SYMBOLS_MOST}): each symbol's headlines or why it has none. */
async function askChunk(doFetch: typeof fetch, base: string, abortMs: number, asked: readonly string[], since: string): Promise<Map<string, NewsAnswer>> {
  const out = new Map<string, NewsAnswer>();
  const all = (unavailable: string): Map<string, NewsAnswer> => {
    for (const sym of asked) out.set(sym, { unavailable });
    return out;
  };
  const query = new URLSearchParams({ symbols: asked.join(","), since });
  const answer = await askUpstream(doFetch, `${base}/api/news?${query.toString()}`, abortMs);
  if ("unreachable" in answer) return all(`the Market did not answer: ${answer.unreachable}`);
  if (answer.status !== 200) return all(failureOf(answer.status, answer.body));
  let parsed: unknown;
  try {
    parsed = JSON.parse(answer.body);
  } catch {
    parsed = undefined;
  }
  if (!isRecord(parsed) || parsed.ok !== true || !isRecord(parsed.news)) return all("the Market's answer is not its news shape");
  const news = parsed.news;
  const unavailable = isRecord(parsed.unavailable) ? parsed.unavailable : {};
  for (const sym of asked) {
    const why = Object.hasOwn(unavailable, sym) ? unavailable[sym] : undefined;
    const list = Object.hasOwn(news, sym) ? news[sym] : undefined;
    if (typeof why === "string") out.set(sym, { unavailable: reasonOf(why) });
    else if (Array.isArray(list)) out.set(sym, { headlines: list.filter(isHeadline) });
    else out.set(sym, { unavailable: "the Market's answer does not list it" });
  }
  return out;
}

/**
 * The headline read: the symbols upper-cased, each once; one not a US ticker is `not a US ticker` and never asked;
 * the rest asked {@link NEWS_SYMBOLS_MOST} to a GET, the GETs side by side, a failing GET marking only its own symbols.
 * @param deps - the fetch (the global one), the Market's base URL (`marketUrl()` at each read) and each GET's deadline.
 * @returns a read of `symbols`' headlines since `since`, keyed by each symbol upper-cased.
 */
export function marketNews(deps: { fetch?: typeof fetch; baseUrl?: string; abortMs?: number } = {}): (symbols: readonly string[], since: string) => Promise<Map<string, NewsAnswer>> {
  return async (symbols, since) => {
    const out = new Map<string, NewsAnswer>();
    const asked: string[] = [];
    for (const sym of new Set(symbols.map((s) => s.toUpperCase()))) {
      if (US_TICKER.test(sym)) asked.push(sym);
      else out.set(sym, { unavailable: "not a US ticker" });
    }
    const chunks: string[][] = [];
    for (let i = 0; i < asked.length; i += NEWS_SYMBOLS_MOST) chunks.push(asked.slice(i, i + NEWS_SYMBOLS_MOST));
    const base = deps.baseUrl ?? marketUrl();
    const answers = await Promise.all(chunks.map((chunk) => askChunk(deps.fetch ?? fetch, base, deps.abortMs ?? NEWS_ABORT_MS, chunk, since)));
    for (const answer of answers) for (const [sym, a] of answer) out.set(sym, a);
    return out;
  };
}
