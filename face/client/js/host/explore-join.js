// face/client/js/host/explore-join.js — the explore join (plan A2 Task 6): the market's public rows (/data/market/explore) and
// the account's connected rows (/data/account/connected/explore) as one explore body, the one the views read. Pure, no DOM.
// - A connected half the proxy re-served stale (`stale: true`: the account not answering) is no half: no connected line is
//   offered on a dead account. A stale market half is kept, and the join says it is stale.
// - A public line is left out where a connected venue that is not paper speaks for its connection (the same `connector`), and
//   where the venues read says its connection does not serve here (`not-served`, `closed`, `close-only`); a row left with no
//   lines goes.
// - A row both halves list carries the connected lines that are not paper, then the market's kept lines, then the paper ones; the
//   row's own fields are lent by the market where the connected row is paper or trades less, else by the connected row, the
//   other filling what the lender lacks.
// - Each list is the market's order, then the rows only the account lists, cut to the longer source — `items` too, so a market
//   that lists fewer rows than the query's limit leaves the account's own rows in (both halves are cut at the same limit
//   upstream). `missing` says each half that is down.
// A half passed as `undefined` has not landed yet: it lists nothing and is said missing by no one.

const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const records = v => (Array.isArray(v) ? v.filter(isRecord) : []);
const str = v => (typeof v === 'string' ? v : '');
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const LISTS = ['items', 'movers', 'closing', 'mostTraded'];
// the venues read's verdicts for a connection that does not serve here: its public lines are offered nowhere
const AWAY = new Set(['not-served', 'closed', 'close-only']);

export const ACCOUNT_DOWN = { venue: 'account', venueName: 'the Account', why: 'The Account is not answering: the venues connected are not listed' };
export const MARKET_DOWN = { venue: 'market', venueName: 'the market', why: 'The market is not answering: public markets are not listed' };

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
function withLines(r, keep) {
  const at = records(r.at);
  const kept = at.filter(keep);
  const out = { ...r, at: kept };
  let had = at.length > 0, has = kept.length > 0;
  if (Array.isArray(r.outcomes)) {
    out.outcomes = r.outcomes.map(o => {
      if (!isRecord(o)) return o;
      const lines = records(o.at);
      const left = lines.filter(keep);
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
 * @param {{venues?: Array<{connector?: string, paper?: boolean}>, here?: Array<{connector?: string, verdict?: string}>}} [opts]
 *   `venues` the page's venues (venuesOf), `here` the venues read's rows
 * @returns {object|null} an explore body as the views read it ({ok:true, items, movers, closing, mostTraded, tabs, missing,
 *   notes, asOf, china?, stale?}); null when neither half answers */
export function joinExplore(market, connected, { venues = [], here = [] } = {}) {
  const m = halfOf(market, false);
  const c = halfOf(connected, true);
  if (!m && !c) return null;
  const speaks = new Set(records(venues).filter(v => v.paper !== true && str(v.connector)).map(v => v.connector));
  const away = new Set(records(here).filter(v => AWAY.has(str(v.verdict)) && str(v.connector)).map(v => v.connector));
  const keep = l => !(l.public === true && (speaks.has(str(l.connector)) || away.has(str(l.connector))));
  const mRows = byKey(m), cRows = byKey(c);
  const joined = new Map();
  const rowOf = key => {
    if (joined.has(key)) return joined.get(key);
    const mr = mRows.get(key), cr = cRows.get(key);
    const kept = mr ? withLines(mr, keep) : undefined;
    const r = cr && kept ? joinRow(kept, cr) : cr && mr ? cr : cr ?? kept ?? null;
    joined.set(key, r);
    return r;
  };
  const listOf = name => {
    const ml = records(m?.[name]), cl = records(c?.[name]);
    const mKeys = new Set(ml.map(r => r.key));
    const cap = Math.max(ml.length, cl.length);
    const rows = [...ml.map(r => rowOf(r.key)), ...cl.filter(r => !mKeys.has(r.key)).map(r => rowOf(r.key))].filter(Boolean);
    return rows.slice(0, cap);
  };
  const items = (() => {
    const ml = records(m?.items), cl = records(c?.items);
    const mKeys = new Set(ml.map(r => r.key));
    const rows = [...ml.map(r => rowOf(r.key)), ...cl.filter(r => !mKeys.has(r.key)).map(r => rowOf(r.key))].filter(Boolean);
    return rows.slice(0, Math.max(ml.length, cl.length));
  })();
  // the rows only the account lists, for the tabs' counts
  const only = c ? records(c.items).filter(r => !mRows.has(r.key)) : [];
  const tabs = m
    ? records(m.tabs).map(t => ({ ...t, count: (num(t.count) ?? 0) + only.filter(r => Array.isArray(r.tabs) && r.tabs.includes(t.id)).length }))
    : records(c?.tabs).map(t => ({ ...t }));
  const missing = [...records(m?.missing), ...records(c?.missing)];
  if (market !== undefined && !m) missing.push({ ...MARKET_DOWN });
  if (connected !== undefined && !c) missing.push({ ...ACCOUNT_DOWN });
  const notes = [...new Set([...(Array.isArray(m?.notes) ? m.notes : []), ...(Array.isArray(c?.notes) ? c.notes : [])].filter(n => typeof n === 'string'))];
  const out = {
    ok: true, asOf: m ? m.asOf : c.asOf, items, movers: listOf('movers'), closing: listOf('closing'), mostTraded: listOf('mostTraded'),
    tabs, missing, notes,
  };
  if (m && m.china !== undefined) out.china = m.china;
  if (m && m.stale === true) out.stale = true;
  return out;
}
