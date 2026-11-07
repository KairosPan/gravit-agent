// face/client/js/host/explore-join.js — the explore join (plan A2 Task 6): the market's public rows (/data/market/explore) and
// the account's connected rows (/data/account/connected/explore) as one explore body, the one the views read. Pure, no DOM.
// - A connected half the proxy re-served stale (`stale: true`: the account not answering) is no half: no connected line is
//   offered on a dead account. A stale market half is kept, and the join says it is stale.
// - A public line is left out where a connected venue that is not paper speaks for its connection (the same `connector`), and
//   where the venues read says its connection does not serve here (`not-served`, `closed`, `close-only`); a row left with no
//   lines goes. The focused Hyperliquid and xyz scopes keep the latter as read-only public data, without a connect-to-trade
//   route; an explicitly selected More provider does the same. Broad More and unscoped reads retain the original contract.
// - A row both halves list carries the connected lines that are not paper, then the market's kept lines, then the paper ones; the
//   row's own fields are lent by the market where the connected row is paper or trades less, else by the connected row, the
//   other filling what the lender lacks.
// - Every list is both halves' rows merged and sorted as the account's one explore sorted them before plan A2
//   (account/src/portfolio/live/explore.ts exploreAcross): `items` by the sort asked (most traded, biggest moves, closing
//   soonest), a search's rows that are what was typed first, the Predictions tab unsorted keeping the market's curated order —
//   then cut once at the query's limit, so a row only the account lists competes on the sort like any other; `movers` by the
//   move (one row an asset), `closing` the busiest then by the close, `mostTraded` by volume, each cut at the account's top (LIST_TOP) or the
//   longer source. `missing` says each half that is down.
// A half passed as `undefined` has not landed yet: it lists nothing and is said missing by no one.
import { said } from '../i18n/words.js';
import { marketOriginOf } from './market-view.js';

const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const records = v => (Array.isArray(v) ? v.filter(isRecord) : []);
const str = v => (typeof v === 'string' ? v : '');
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const LISTS = ['items', 'movers', 'closing', 'mostTraded'];
// the account's top for movers, closing and most traded (exploreAcross's `top`, 8 unless asked): the halves were cut there
export const LIST_TOP = 8;

// the account's orders (explore.ts byVolume, byMove, byClose): a row's volume — an event's own, else its 24h dollars, else its
// contracts — the size of its move, the time it closes; a stable sort, so a tie keeps the market's row first
const fin = v => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const volumeOf = i => fin(i.eventVolumeUsd24h) ?? fin(i.volumeUsd24h) ?? fin(i.contracts24h) ?? -1;
const byVolume = (a, b) => volumeOf(b) - volumeOf(a);
const moveOf = i => (fin(i.changePct24h) !== undefined ? Math.abs(i.changePct24h) : -1);
const byMove = (a, b) => moveOf(b) - moveOf(a) || byVolume(a, b);
const closeMs = i => (typeof i.closeTime === 'string' ? Date.parse(i.closeTime) : NaN);
const byClose = now => {
  const at = i => { const ms = closeMs(i); return ms > now ? ms : Number.POSITIVE_INFINITY; };
  return (a, b) => at(a) - at(b) || byVolume(a, b);
};
// movers keep one row an asset: a coin over its perpetual (explore.ts oneEach)
function oneEach(rows) {
  const asset = i => (i.kind === 'perp' ? `coin:${i.base ?? str(i.key).slice(str(i.key).indexOf(':') + 1)}` : i.key);
  const by = new Map();
  for (const i of rows) { const was = by.get(asset(i)); if (!was || (was.kind === 'perp' && i.kind !== 'perp')) by.set(asset(i), i); }
  return rows.filter(i => by.get(asset(i)) === i);
}
// the venues read's verdicts for a connection that does not serve here: never offer a connection to trade
const AWAY = new Set(['not-served', 'closed', 'close-only']);

// a half that is down, as `missing` says it
export const accountDown = () => ({ venue: 'account', venueName: said('markets.down.account'), why: said('markets.down.accountWhy') });
export const marketDown = () => ({ venue: 'market', venueName: said('markets.down.market'), why: said('markets.down.marketWhy') });

// a half as the join reads it: an answer, null (down), or undefined (not landed yet)
function halfOf(b, connected) {
  if (b === undefined) return undefined;
  if (!isRecord(b) || b.ok !== true || !Array.isArray(b.items)) return null;
  if (connected && b.stale === true) return null;
  return b;
}
// every row a body lists, by key, the first found across its lists
function byKey(b) {
  const map = new Map();
  if (!b) return map;
  for (const list of LISTS) for (const r of records(b[list])) if (str(r.key) && !map.has(r.key)) map.set(r.key, r);
  return map;
}
// a row's lines as the join drops them: its own `at` and each outcome's
function withLines(r, keep, map = l => l) {
  const at = records(r.at);
  const kept = at.filter(keep).map(map);
  const out = { ...r, at: kept };
  let had = at.length > 0, has = kept.length > 0;
  if (Array.isArray(r.outcomes)) {
    out.outcomes = r.outcomes.map(o => {
      if (!isRecord(o)) return o;
      const lines = records(o.at);
      const left = lines.filter(keep).map(map);
      had ||= lines.length > 0;
      has ||= left.length > 0;
      return { ...o, at: left };
    });
  }
  return had && !has ? null : out;
}
// the lender's fields over the other's, a field the lender lacks (absent or null) the other's
function lend(lender, other) {
  const out = { ...other };
  for (const [k, v] of Object.entries(lender)) if (v !== undefined && v !== null) out[k] = v;
  return out;
}
const isPaperLine = l => l.paper === true;
// the lines of a row both list: the connected not paper, the market's kept, the connected paper
const joinLines = (c, m) => [...records(c).filter(l => !isPaperLine(l)), ...records(m), ...records(c).filter(isPaperLine)];
function joinRow(m, c) {
  const marketLends = c.paper === true || (num(c.volumeUsd24h) ?? 0) < (num(m.volumeUsd24h) ?? 0);
  const row = marketLends ? lend(m, c) : lend(c, m);
  row.at = joinLines(c.at, m.at);
  if (Array.isArray(m.outcomes) || Array.isArray(c.outcomes)) {
    const lead = records(marketLends ? m.outcomes : c.outcomes).length ? (marketLends ? m.outcomes : c.outcomes) : (marketLends ? c.outcomes : m.outcomes);
    const otherOf = (list, o) => records(list).find(x => str(x.label) === str(o.label));
    row.outcomes = records(lead).map(o => {
      const mo = otherOf(m.outcomes, o), co = otherOf(c.outcomes, o);
      return { ...o, at: joinLines(co?.at, mo?.at) };
    });
  }
  return row;
}

/** The market's explore and the account's connected explore as one body the views read.
 * @param {object|null|undefined} market the market's body; null for a half that failed, undefined for one not landed yet
 * @param {object|null|undefined} connected the account's connected body, the same way; `stale: true` is down
 * @param {{venues?: Array<{connector?: string, paper?: boolean}>, here?: Array<{connector?: string, verdict?: string}>,
 *   tab?: string, q?: string, sort?: string, scope?: string, source?: string, limit?: number, now?: number}} [opts]
 *   `venues` the page's venues (venuesOf), `here` the venues read's rows; `tab`, `q`, `sort` and `limit` the question both
 *   halves were asked (the order and the cut of `items`; no limit: the longer half's length); `now` the clock `closing` sorts by
 * @returns {object|null} an explore body as the views read it ({ok:true, items, movers, closing, mostTraded, tabs, missing,
 *   notes, asOf, china?, stale?}); null when neither half answers */
export function joinExplore(market, connected, { venues = [], here = [], tab = '', q = '', sort = '', scope = '', source = '', limit, now = Date.now() } = {}) {
  const m = halfOf(market, false);
  const c = halfOf(connected, true);
  if (!m && !c) return null;
  // a connected venue speaks for its public line only while the connected half answers (or has not landed yet): with the
  // Account down or stale the screens fall back to the public data
  const speaks = c === null ? new Set() : new Set(records(venues).filter(v => v.paper !== true && str(v.connector)).map(v => v.connector));
  const away = new Set(records(here).filter(v => AWAY.has(str(v.verdict)) && str(v.connector)).map(v => v.connector));
  const scoped = ['hyperliquid', 'xyz', 'more'].includes(scope);
  const provider = scope === 'more' && str(source) !== '';
  const focused = scope === 'hyperliquid' || scope === 'xyz' || provider;
  const connectorOf = l => str(l.connector) || str(records(venues).find(v => v.id === l.venue)?.connector);
  const inScope = (row, line) => {
    if (!scoped) return true;
    // The connected service has already selected its matching source; public rows use the registry's exact venue id.
    if (provider) return line.public !== true || line.venue === source;
    const origin = row.kind === 'perp' ? marketOriginOf({ ...line, connector: connectorOf(line) }) : null;
    return scope === 'more' ? origin === null : origin === scope;
  };
  const scopedRows = body => new Map([...byKey(body)].flatMap(([key, row]) => {
    const kept = scoped ? withLines(row, l => inScope(row, l)) : row;
    return kept ? [[key, kept]] : [];
  }));
  const mRows = scopedRows(m), cRows = scopedRows(c);
  const joined = new Map();
  const rowOf = key => {
    if (joined.has(key)) return joined.get(key);
    const mr = mRows.get(key), cr = cRows.get(key);
    // A focused public market remains discoverable when the connected venue's shorter list omits it. Only a connected
    // line for this same row replaces it; a connected Hyperliquid wallet must not hide the entire xyz public universe.
    const rowSpeaks = scoped ? new Set(records(cr?.at).filter(l => l.paper !== true).map(connectorOf)) : speaks;
    const keep = l => !(l.public === true && (rowSpeaks.has(str(l.connector)) || (!focused && away.has(str(l.connector)))));
    const readOnly = l => {
      if (!focused || l.public !== true || !away.has(str(l.connector))) return l;
      const { connectTo, ...data } = l;
      return { ...data, canTrade: false };
    };
    const kept = mr ? withLines(mr, keep, readOnly) : undefined;
    const r = cr && kept ? joinRow(kept, cr) : cr ?? kept ?? null;
    joined.set(key, r);
    return r;
  };
  // a list's rows from both halves, once each, the market's first (a tie on the sort keeps it first)
  const merged = name => {
    const seen = new Set();
    const rows = [];
    for (const r of [...records(m?.[name]), ...records(c?.[name])]) {
      if (!str(r.key) || seen.has(r.key)) continue;
      seen.add(r.key);
      const row = rowOf(r.key);
      if (row) rows.push(row);
    }
    return rows;
  };
  const longer = name => Math.max(records(m?.[name]).length, records(c?.[name]).length);
  const cap = name => Math.max(LIST_TOP, longer(name));
  const items = (() => {
    const rows = merged('items');
    const query = str(q).trim().toLowerCase();
    // the Predictions tab with no sort and no search keeps the market's curated order, the account's own rows after it
    const curated = tab === 'predictions' && !sort && !query;
    const sorted = curated ? rows : [...rows].sort(sort === 'movers' ? byMove : sort === 'closing' ? byClose(now) : byVolume);
    const named = i => str(i.base || i.name).toLowerCase() === query;
    const ordered = query ? [...sorted.filter(named), ...sorted.filter(i => !named(i))] : sorted;
    const n = typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : longer('items');
    return ordered.slice(0, n);
  })();
  const movers = oneEach(merged('movers').sort(byMove)).slice(0, cap('movers'));
  // the busiest closing soon, cut there, then in the order they close (explore.ts: `soon` by volume, `closing` by close)
  const closing = merged('closing').sort(byVolume).slice(0, cap('closing')).sort(byClose(now));
  const mostTraded = merged('mostTraded').sort(byVolume).slice(0, cap('mostTraded'));
  // Count connected-only rows before the final list cut, after the same scope and line filtering as the rows. The server's
  // counts may cover more than its returned items: preserve those totals instead of rebuilding tabs from the visible list.
  const connectedItems = [...new Map(records(c?.items).filter(r => str(r.key)).map(r => [r.key, r])).values()];
  const countedIn = (rows, id) => rows.filter(r => Array.isArray(r.tabs) && r.tabs.includes(id)).length;
  const keptConnected = connectedItems.map(r => cRows.get(r.key)).filter(r => r && rowOf(r.key));
  const only = keptConnected.filter(r => !mRows.has(r.key));
  const removedConnected = connectedItems.filter(r => !cRows.has(r.key) || !rowOf(r.key));
  const connectedTabs = records(c?.tabs).map(tab => ({ ...tab, count: Math.max(0, (num(tab.count) ?? 0) - countedIn(removedConnected, tab.id)) }));
  const tabs = m
    ? records(m.tabs).map(tab => ({ ...tab, count: (num(tab.count) ?? 0) + countedIn(only, tab.id) }))
    : connectedTabs;
  if (m) {
    const ids = new Set(tabs.map(tab => tab.id));
    // A missing public tab has no public rows; the connected half can supply it, including its rows beyond the list limit.
    for (const tab of connectedTabs) if (!ids.has(tab.id) && tab.count > 0) { tabs.push(tab); ids.add(tab.id); }
  }
  const missing = [...records(m?.missing), ...records(c?.missing)];
  if (market !== undefined && !m) missing.push(marketDown());
  if (connected !== undefined && !c) missing.push(accountDown());
  const notes = [...new Set([...(Array.isArray(m?.notes) ? m.notes : []), ...(Array.isArray(c?.notes) ? c.notes : [])].filter(n => typeof n === 'string'))];
  const out = {
    ok: true, asOf: m ? m.asOf : c.asOf, items, movers, closing, mostTraded,
    tabs, missing, notes,
  };
  if (m && m.china !== undefined) out.china = m.china;
  if (m && m.stale === true) out.stale = true;
  return out;
}
