// face/plugins/lunhui/lib/account-fetch.mjs
/**
 * Lunhui's reach onto the Account (plan 2 of the Account's two parts): a `fetch` that sends every
 * upstream read the four freezes make to the Account at `origin`, never to the upstream. It is the
 * only production fetch of the freezes; a row's `config.fetch` (the fixture directory,
 * `lib/fixture-fetch.mjs`) is the tests' alternative, and there is no direct-to-upstream fallback.
 *
 * - A GET of any URL goes to `GET <origin>/api/cn/relay?url=<the URL>`, with the caller's signal,
 *   `redirect: "manual"`, and of its headers only `accept`, `referer` and `user-agent`. The Account
 *   decides what it relays.
 *   - `x-cn-relay: upstream`: the upstream's status, content type and bytes, returned as they are;
 *     a 3xx (its `location` kept) only when the caller asked `redirect: "manual"`, otherwise a
 *     `TypeError("redirect refused")`, what `fetch` with `redirect: "error"` does.
 *   - `x-cn-relay: refused`: by its word, `timeout` → code `PROVIDER_TIMEOUT`, `too-large` →
 *     `RESPONSE_TOO_LARGE`, any other a code-less error naming the word.
 * - A POST to exactly `WENCAI_QUERY_URL` goes to `POST <origin>/api/cn/ifind` as
 *   `{"query": <its searchstring>}`: no token, no other header or field. The Account holds the
 *   token and does the exchange. Its refusals map as the relay's, plus `unconfigured` →
 *   `IFIND_UNCONFIGURED` and `credential` → `IFIND_CREDENTIAL`.
 * - Anything else (another method, another POST - the token exchange among them) is refused here,
 *   nothing sent.
 *
 * An answer with neither header (an Account older than this, or something else on that port) and a
 * request that never gets an answer are `ACCOUNT_UNAVAILABLE` errors naming the Account, which
 * `upstreamError` words as the Account's failure, not the upstream's, and writes to stderr; an abort
 * of the caller's signal is rethrown as it is.
 */

export const DEFAULT_ACCOUNT_URL = "http://127.0.0.1:4820";
export const WENCAI_QUERY_URL = "https://quantapi.51ifind.com/api/v1/smart_stock_picking";
/** the codes the adapter throws for the iFinD route's two answers Lunhui words itself */
export const IFIND_UNCONFIGURED = "IFIND_UNCONFIGURED", IFIND_CREDENTIAL = "IFIND_CREDENTIAL";
/** the code of a failure that is the Account's own: no answer, an answer without the route, or its refusal */
export const ACCOUNT_UNAVAILABLE = "ACCOUNT_UNAVAILABLE";

/** The caller's headers the relay forwards upstream; the Account forwards no others. */
const RELAYED_HEADERS = ["accept", "referer", "user-agent"];
/** Refusal words that are codes `fetchBytes` already raises, and the iFinD route's own two. */
const SHARED_CODES = { timeout: "PROVIDER_TIMEOUT", "too-large": "RESPONSE_TOO_LARGE" };
/** The refusal word that is the upstream's failure, not the Account's: the code-less one. */
const UPSTREAM_WORDS = new Set(["unreachable"]);
/** An error the Account itself caused, so `upstreamError` names the Account. */
const accountError = (message, options) => Object.assign(new Error(message, options), { code: ACCOUNT_UNAVAILABLE });
const RELAY = { mark: "x-cn-relay", key: "relay", route: "relay", codes: SHARED_CODES };
const IFIND = { mark: "x-cn-ifind", key: "ifind", route: "iFinD route", codes: { ...SHARED_CODES, unconfigured: IFIND_UNCONFIGURED, credential: IFIND_CREDENTIAL } };

/**
 * An http(s) URL with no user, path other than "/", query or fragment → its origin.
 * @param {unknown} raw
 * @returns {string}
 */
export function accountOrigin(raw) {
  if (typeof raw !== "string" || raw === "") throw new TypeError(`the Account's address is a URL string, not ${JSON.stringify(raw)}`);
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new TypeError(`the Account's address is not a URL: ${raw}`);
  }
  const wrong =
    url.protocol !== "http:" && url.protocol !== "https:" ? `its scheme ${url.protocol} (http or https)`
    : url.username || url.password ? "a user"
    : url.pathname !== "/" ? `a path ${url.pathname}`
    : url.search || raw.includes("?") ? "a query"
    : url.hash || raw.includes("#") ? "a fragment"
    : null;
  if (wrong) throw new TypeError(`the Account's address is an origin alone, and ${raw} has ${wrong}`);
  return url.origin;
}

/**
 * A `fetch` onto the Account at `origin`. `fetchImpl` is read at call time.
 * @param {string} origin
 * @param {{ fetchImpl?: (url: string, init: RequestInit) => Promise<Response> }} [options]
 * @returns {(url: string | URL, init?: RequestInit) => Promise<Response>}
 */
export function accountFetch(origin, { fetchImpl = (u, i) => globalThis.fetch(u, i) } = {}) {
  const base = accountOrigin(origin);

  /** One request to the Account; a rejection names it unless the caller's signal aborted. */
  async function ask(url, init, signal) {
    try {
      return await fetchImpl(url, init);
    } catch (error) {
      if (signal?.aborted) throw error;
      throw accountError(`the Account at ${base} did not answer`, { cause: error });
    }
  }

  /** The Account's answer read by its mark: the upstream's, or its refusal as an error. */
  async function judge(response, { mark, key, route, codes }) {
    const said = response.headers.get(mark);
    if (said === "upstream") return response;
    if (said !== "refused") {
      throw accountError(`the Account at ${base} answered without its ${route} (HTTP ${response.status}): restart it from this tree`);
    }
    let word;
    try {
      const body = await response.json();
      word = body?.[key];
    } catch {
      word = undefined;
    }
    const text = typeof word === "string" ? word : "an unreadable refusal";
    const error = new Error(`the Account at ${base} refused through its ${route}: ${text}`);
    const code = typeof word === "string" && Object.hasOwn(codes, word) ? codes[word] : UPSTREAM_WORDS.has(word) ? undefined : ACCOUNT_UNAVAILABLE;
    throw code ? Object.assign(error, { code }) : error;
  }

  return async function fetchViaAccount(url, init = {}) {
    const target = String(url);
    const method = (init.method ?? "GET").toUpperCase();
    const signal = init.signal ?? undefined;

    if (method === "GET") {
      const given = new Headers(init.headers);
      /** @type {Record<string, string>} */
      const headers = {};
      for (const name of RELAYED_HEADERS) {
        const value = given.get(name);
        if (value !== null) headers[name] = value;
      }
      const sent = `${base}/api/cn/relay?url=${encodeURIComponent(target)}`;
      const response = await judge(await ask(sent, { method: "GET", headers, signal, redirect: "manual" }, signal), RELAY);
      if (response.status >= 300 && response.status < 400 && init.redirect !== "manual") throw new TypeError("redirect refused");
      return response;
    }

    if (method === "POST" && target === WENCAI_QUERY_URL) {
      let query;
      try {
        query = typeof init.body === "string" ? JSON.parse(init.body)?.searchstring : undefined;
      } catch {
        query = undefined;
      }
      if (typeof query !== "string") throw new Error("the 问财 query the Account relays is a JSON body with a searchstring");
      const init2 = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }), signal, redirect: "manual" };
      return judge(await ask(`${base}/api/cn/ifind`, init2, signal), IFIND);
    }

    throw new Error("the Account relays GETs and the one 问财 query only");
  };
}
