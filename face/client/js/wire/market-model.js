/** Pure view and persistence helpers for a market-qualified personal watchlist, and the Account's market keys starred beside it. */

export const STORAGE_KEY = "gravit.market.watchlist.v1";
/** Where a browser kept its list before the 2026-10-08 rename: read while the new
 *  key is absent, never written or deleted (rename spec 2026-10-18 §5.2). */
export const LEGACY_STORAGE_KEY = "kairos.market.watchlist.v1";
export const MARKET_INFO = Object.freeze({
  us: Object.freeze({ label: "美股", currency: "USD" }),
  cn: Object.freeze({ label: "A 股", currency: "CNY" }),
  crypto: Object.freeze({ label: "加密货币", currency: "USD" }),
});

const EM = "—";

/** @typedef {{id: string, market: 'us'|'cn'|'crypto', symbol: string, name: string, exchange: string, currency: string, aliases?: string[]}} Asset */

/** @param {unknown} value */
function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

/** A symbol is only meaningful together with its market. Never guess a market.
 * @param {unknown} value
 * @returns {Asset | null}
 */
export function normalizeAsset(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = clean(value.id);
  const parts = id.match(/^(us|cn|crypto):(.+)$/i);
  const market = clean(value.market).toLowerCase() || parts?.[1].toLowerCase();
  if (market !== "us" && market !== "cn" && market !== "crypto") return null;
  if (id && (!parts || parts[1].toLowerCase() !== market)) return null;
  let symbol = clean(value.symbol).toUpperCase() || parts?.[2].toUpperCase() || "";
  if (market === "cn") {
    symbol = symbol.replace(/^(?:SH|SZ|BJ)/, "").replace(/\.(?:SH|SS|SZ|BJ)$/, "");
    if (!/^\d{6}$/.test(symbol)) return null;
  } else if (market === "crypto") {
    symbol = symbol.replace("-", "/");
    if (!/^[A-Z0-9]{1,15}\/[A-Z0-9]{2,10}$/.test(symbol)) return null;
  } else if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol)) {
    return null;
  }
  // Stored identities cannot quietly be reassigned to a different instrument.
  if (parts && clean(value.symbol)) {
    const fromId = normalizeAsset({ market, symbol: parts[2] });
    if (!fromId || fromId.symbol !== symbol) return null;
  }
  const currency = clean(value.currency).toUpperCase();
  const normalized = {
    id: `${market}:${symbol}`,
    market,
    symbol,
    name: clean(value.name) || symbol,
    exchange: clean(value.exchange),
    currency: /^[A-Z]{3,10}$/.test(currency) ? currency : MARKET_INFO[market].currency,
  };
  if (Array.isArray(value.aliases)) {
    const aliases = [...new Set(value.aliases.map(clean).filter(Boolean))];
    if (aliases.length) normalized.aliases = aliases;
  }
  return normalized;
}

/** Recover usable entries while keeping the original storage untouched.
 * The caller can show the error and decide when an explicit edit should be saved.
 * @param {{getItem: (key: string) => string | null} | null | undefined} storage
 * @returns {{items: Asset[], error: string | null}}
 */
export function readWatchlist(storage) {
  let raw;
  try {
    if (!storage) throw new Error("Storage unavailable");
    raw = storage.getItem(STORAGE_KEY);
    if (raw === null) raw = storage.getItem(LEGACY_STORAGE_KEY);
  } catch {
    return { items: [], error: "无法读取本机自选列表。" };
  }
  if (raw === null) return { items: [], error: null };
  let saved;
  try {
    saved = JSON.parse(raw);
  } catch {
    return { items: [], error: "本机自选数据损坏，原始数据已保留。" };
  }
  if (!saved || saved.version !== 1 || !Array.isArray(saved.items)) {
    return { items: [], error: "无法识别本机自选数据格式，原始数据已保留。" };
  }
  const items = [];
  const seen = new Set();
  let invalid = 0;
  for (const entry of saved.items) {
    const asset = normalizeAsset(entry);
    if (!asset) { invalid += 1; continue; }
    if (!seen.has(asset.id)) { items.push(asset); seen.add(asset.id); }
  }
  return {
    items,
    error: invalid ? `${invalid} 项自选数据无法识别；其余已恢复，原始数据已保留。` : null,
  };
}

/** A failed write leaves the last persisted list intact; callers must surface it.
 * @param {{setItem: (key: string, value: string) => void} | null | undefined} storage
 * @param {unknown} items
 * @returns {string | null}
 */
export function saveWatchlist(storage, items) {
  if (!Array.isArray(items)) return "自选列表格式无效，未保存。";
  const normalized = [];
  const seen = new Set();
  for (const entry of items) {
    const asset = normalizeAsset(entry);
    if (!asset) return "自选列表含无效证券，未保存。";
    if (!seen.has(asset.id)) { normalized.push(asset); seen.add(asset.id); }
  }
  try {
    if (!storage) throw new Error("Storage unavailable");
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, items: normalized }));
    return null;
  } catch {
    return "无法保存到本机；刷新页面后，本次修改可能丢失。";
  }
}

/** Where this browser keeps the Account's markets it stars: their row keys (`coin:BTC`, `stock:AAPL`, `event:<venue>:<market>`),
 *  the Account's grammar and not the face's, so under a key of their own (spec 2026-10-22 §6.1). */
export const ACCOUNT_WATCH_KEY = "gravit.account.watch.v1";
const ACCOUNT_WATCH_LIMIT = 100;
/** An Account row key, shaped as host/market-view.js's isAccountKey reads one. */
const ACCOUNT_KEY = /^(coin|stock|perp|rwa|event|preipo|kalshi|pm|pmus):/;
/** @param {unknown} value @returns {value is string} */
const isAccountWatchKey = (value) => typeof value === "string" && ACCOUNT_KEY.test(value);

/** The Account keys this browser starred: the valid ones, once each, the first hundred; the stored value is left as it is,
 * and an entry that is not an Account key is said in `error`, the rest restored.
 * @param {{getItem: (key: string) => string | null} | null | undefined} storage
 * @returns {{items: string[], error: string | null}}
 */
export function readAccountWatch(storage) {
  let raw;
  try {
    if (!storage) throw new Error("Storage unavailable");
    raw = storage.getItem(ACCOUNT_WATCH_KEY);
  } catch {
    return { items: [], error: "The saved Account stars could not be read." };
  }
  if (raw === null) return { items: [], error: null };
  let saved;
  try {
    saved = JSON.parse(raw);
  } catch {
    return { items: [], error: "The saved Account stars are damaged; they are kept as they were." };
  }
  if (!saved || saved.version !== 1 || !Array.isArray(saved.items)) {
    return { items: [], error: "The saved Account stars are in a shape this page does not read; they are kept as they were." };
  }
  const items = [];
  const seen = new Set();
  let invalid = 0;
  for (const entry of saved.items) {
    if (!isAccountWatchKey(entry)) { invalid += 1; continue; }
    if (!seen.has(entry) && items.length < ACCOUNT_WATCH_LIMIT) { items.push(entry); seen.add(entry); }
  }
  return { items, error: invalid ? `${invalid} saved Account stars could not be read; the rest are restored.` : null };
}

/** Write the Account keys starred, once each; a list with anything else, or past a hundred, is not written. A failed write
 * leaves the last persisted list intact; callers must surface it.
 * @param {{setItem: (key: string, value: string) => void} | null | undefined} storage
 * @param {unknown} keys
 * @returns {string | null}
 */
export function saveAccountWatch(storage, keys) {
  if (!Array.isArray(keys)) return "The Account stars are not a list; nothing was saved.";
  const items = [];
  const seen = new Set();
  for (const key of keys) {
    if (!isAccountWatchKey(key)) return "The Account stars hold something that is not an Account market; nothing was saved.";
    if (!seen.has(key)) { items.push(key); seen.add(key); }
  }
  if (items.length > ACCOUNT_WATCH_LIMIT) return "More than a hundred Account stars; nothing was saved.";
  try {
    if (!storage) throw new Error("Storage unavailable");
    storage.setItem(ACCOUNT_WATCH_KEY, JSON.stringify({ version: 1, items }));
    return null;
  } catch {
    return "The Account stars could not be saved in this browser; this change may be lost on reload.";
  }
}

/** @param {Asset[]} items @param {string} [market] @param {string} [query] */
export function filterWatchlist(items, market = "all", query = "") {
  const terms = clean(query).toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((asset) => {
    if (market !== "all" && asset.market !== market) return false;
    const searchable = [asset.symbol, asset.name, asset.exchange, asset.id, ...(asset.aliases || [])]
      .join(" ").toLocaleLowerCase();
    return terms.every((term) => searchable.includes(term));
  });
}

/** Missing quote fields stay last in either direction; default preserves user order.
 * @param {Asset[]} items
 * @param {Record<string, {price?: unknown, change_pct?: unknown}>} quotes
 * @param {{key?: string, direction?: string}} [sort]
 */
export function sortWatchlist(items, quotes, sort = {}) {
  const { key = "default", direction = "asc" } = sort;
  if (!["symbol", "price", "change_pct"].includes(key)) return items.slice();
  const factor = direction === "desc" ? -1 : 1;
  return items.slice().sort((a, b) => {
    if (key === "symbol") return a.symbol.localeCompare(b.symbol, "en", { numeric: true }) * factor;
    const left = number(quotes?.[a.id]?.[key]);
    const right = number(quotes?.[b.id]?.[key]);
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    return (left < right ? -1 : left > right ? 1 : 0) * factor;
  });
}

/** Only finite decimal numbers count; blanks, booleans, hex and partial parses do not.
 * @param {unknown} value
 * @returns {number | null}
 */
export function number(value) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed === 0 ? 0 : parsed : null;
}

/** @param {unknown} value @param {unknown} [currency] */
export function price(value, currency = "USD") {
  const parsed = number(value);
  if (parsed === null) return EM;
  const code = clean(currency).toUpperCase();
  const marker = code === "CNY" || code === "RMB" ? "¥" : !code || code === "USD" ? "$" : `${code} `;
  const absolute = Math.abs(parsed);
  // Small tokens need more precision; a nonzero quote must never display as $0.00.
  const formatted = absolute > 0 && absolute < 1e-8
    ? Number(absolute.toPrecision(4)).toString()
    : absolute.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: absolute < 1 ? 8 : 2 });
  return `${parsed < 0 ? "-" : ""}${marker}${formatted}`;
}

/** @param {unknown} value */
export function signed(value) {
  const parsed = number(value);
  if (parsed === null) return EM;
  return `${parsed > 0 ? "+" : ""}${parsed.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Quote changes already use percentage points, never fractions.
 * @param {unknown} value
 */
export function percent(value) {
  const parsed = number(value);
  return parsed === null ? EM : `${signed(parsed)}%`;
}

/** Show instants in the viewer's local timezone, with an explicit local label.
 * Date-only observations remain dates. Naive timestamps keep their unknown zone.
 * @param {unknown} value
 */
export function quoteTime(value) {
  const stamp = clean(value);
  if (!stamp) return EM;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(stamp);
  const validTimestamp = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/i.test(stamp);
  if (!dateOnly && !validTimestamp) return EM;
  const parsed = Date.parse(stamp);
  if (!Number.isFinite(parsed)) return EM;
  if (dateOnly) return new Date(parsed).toISOString().slice(0, 10) === stamp ? stamp.replaceAll("-", "/") : EM;
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(stamp)) return `${stamp.replace("T", " ")}（时区未注明）`;
  const formatted = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23", timeZoneName: "shortOffset",
  }).format(new Date(parsed));
  return `${formatted}（本地）`;
}
