// face/plugins/analog/lib/pages.mjs
/**
 * The record of the web pages a reader opened, held in memory for the face's life. A page is kept by its key: the
 * host in lower case without a leading `www.`, the path without trailing slashes, and the query as written, so the
 * scheme, a fragment, a `www.` and a trailing slash a model adds or drops in copying a URL never part a page from
 * itself, while a different path or query does. The record keeps the newest pages only.
 */

/** The most pages the record holds. */
export const PAGES_MAX = 2000;

/**
 * The key of an `http:` or `https:` URL, or null for anything else.
 * @param {unknown} url
 * @returns {string | null}
 */
export function pageKey(url) {
  if (typeof url !== "string") return null;
  /** @type {URL} */
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const host = parsed.host.toLowerCase().replace(/^www\./, "");
  if (host === "") return null;
  return `${host}${parsed.pathname.replace(/\/+$/, "")}${parsed.search}`;
}

/**
 * A record of opened pages holding the newest `max` keys.
 * @param {number} [max]
 * @returns {{ note: (url: unknown) => void, has: (url: unknown) => boolean }}
 */
export function createPageRecord(max = PAGES_MAX) {
  /** @type {Set<string>} keys, oldest first */
  const keys = new Set();
  return {
    note(url) {
      const key = pageKey(url);
      if (key === null) return;
      keys.delete(key);
      keys.add(key);
      for (const old of keys) {
        if (keys.size <= max) break;
        keys.delete(old);
      }
    },
    has(url) {
      const key = pageKey(url);
      return key !== null && keys.has(key);
    },
  };
}
