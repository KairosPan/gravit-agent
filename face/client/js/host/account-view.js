// face/client/js/host/account-view.js — the Account screen's pure view (spec 2026-10-19 §7 Stage 2) over /data/account.json:
// Alpaca's own decimal strings become the portfolio, the orders by bucket, the statement and its CSV, and the venue's facts.
// An amount that does not parse is null, never NaN and never 0. No DOM.
import { number, orderMatches } from '../wire/account-model.js';
import { fmtDate } from '../time.js';
import { positionId } from './market-view.js';

const CLASSES = { us_equity: ['equity', 'Stocks'], crypto: ['crypto', 'Crypto'] };
const OTHER = ['stable', 'Other'];
// A fixed order, so a bucket keeps its place and its colour whatever its size.
const ALLOC_ORDER = ['cash', 'equity', 'crypto', 'stable'];
const ALLOC_LABEL = { cash: 'Cash', equity: 'Stocks', crypto: 'Crypto', stable: 'Other' };
const empty = (reason = null) => ({
  available: false, reason, currency: 'USD', netWorth: null, today: null, todayPct: null, alloc: [], holdings: [],
  orders: { working: [], filled: [], closed: [], other: [] },
});

/** The Portfolio tab's numbers from a keyed payload; the keyless and failed payloads are unavailable. */
export function portfolioOf(data) {
  if (!data || data.ok !== true) return empty();
  if (!data.available) return empty(typeof data.reason === 'string' ? data.reason : null);
  const account = data.account && typeof data.account === 'object' ? data.account : {};
  const positions = Array.isArray(data.positions) ? data.positions : [];
  const orders = Array.isArray(data.orders) ? data.orders : [];
  const netWorth = number(account.equity);
  const lastEquity = number(account.last_equity);
  const hasDay = netWorth !== null && lastEquity !== null && lastEquity > 0;
  const today = hasDay ? netWorth - lastEquity : null;

  const sums = { cash: Math.max(0, number(account.cash) ?? 0), equity: 0, crypto: 0, stable: 0 };
  for (const position of positions) {
    const [token] = CLASSES[position?.asset_class] ?? OTHER;
    sums[token] += Math.max(0, number(position?.market_value) ?? 0);
  }
  const total = ALLOC_ORDER.reduce((t, token) => t + sums[token], 0);
  const alloc = total > 0
    ? ALLOC_ORDER.filter(token => sums[token] > 0)
      .map(token => ({ token, label: ALLOC_LABEL[token], value: sums[token], pct: sums[token] / total * 100 }))
    : [];

  const buckets = { working: [], filled: [], closed: [], other: [] };
  for (const order of orders) {
    const bucket = ['working', 'filled', 'closed'].find(name => orderMatches(order, name)) ?? 'other';
    buckets[bucket].push(order);
  }

  return {
    available: true,
    reason: null,
    currency: typeof account.currency === 'string' && account.currency ? account.currency : 'USD',
    netWorth,
    today,
    todayPct: hasDay ? today / lastEquity : null,
    alloc,
    holdings: positions.map(position => ({
      id: positionId(position),
      symbol: typeof position?.symbol === 'string' ? position.symbol : '',
      qty: number(position?.qty),
      value: number(position?.market_value),
      changeToday: number(position?.change_today),
    })),
    orders: buckets,
  };
}

const amount = value => { const n = number(value); return n === null ? null : String(n); };
const capital = s => (typeof s === 'string' && s ? s[0].toUpperCase() + s.slice(1) : '');

/** One order in a line: `Buy 2 AAPL · limit 150 · 0 of 2 filled`; a notional order reads `Buy $500 AAPL · market`. */
export function orderLine(order) {
  const symbol = typeof order?.symbol === 'string' ? order.symbol : '';
  const type = typeof order?.type === 'string' ? order.type.replace(/_/g, ' ') : '';
  const limit = (order?.type === 'limit' || order?.type === 'stop_limit') ? amount(order.limit_price) : null;
  const qty = amount(order?.qty);
  const filled = amount(order?.filled_qty);
  const notional = qty === null ? amount(order?.notional) : null;
  const size = notional !== null ? `$${notional}` : (qty ?? '');
  const parts = [[capital(order?.side), size, symbol].filter(Boolean).join(' ')];
  if (type) parts.push(limit !== null ? `${type} ${limit}` : type);
  if (qty !== null) parts.push(`${filled ?? 0} of ${qty} filled`);
  else if (filled !== null && Number(filled) > 0) parts.push(`${filled} filled`);
  return parts.join(' · ');
}

const time = at => { const t = Date.parse(at); return Number.isNaN(t) ? -Infinity : t; };

/** The statement: every order with a fill — filled, partly filled and still working, or partly filled and then
 * canceled — newest first, with what each cost, so it reconciles with the positions. */
export function statementOf(data) {
  if (!data?.ok || !data.available || !Array.isArray(data.orders)) return [];
  return data.orders
    .filter(order => orderMatches(order, 'filled') || (number(order?.filled_qty) ?? 0) > 0)
    .map(order => {
      const qty = number(order.filled_qty) ?? number(order.qty);
      const price = number(order.filled_avg_price);
      return {
        at: order.filled_at ?? order.submitted_at ?? null,
        side: typeof order.side === 'string' ? order.side : '',
        qty,
        symbol: typeof order.symbol === 'string' ? order.symbol : '',
        price,
        amount: qty !== null && price !== null ? qty * price : null,
      };
    })
    .sort((a, b) => time(b.at) - time(a.at));
}

function field(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The statement as RFC 4180 CSV, CRLF line ends. */
export function csvOf(rows) {
  const lines = ['date,side,qty,symbol,price,amount'];
  for (const row of rows ?? []) lines.push([row.at, row.side, row.qty, row.symbol, row.price, row.amount].map(field).join(','));
  return lines.map(line => `${line}\r\n`).join('');
}

/** The Venues tab's facts: the host and its mode, where the keys come from, whether order tools are registered. */
export function venueOf(data, creds, toolNames) {
  const host = data?.ok && data.available && typeof data.host === 'string' ? data.host : null;
  const mode = host === null ? '' : /^paper-api\./.test(host) ? 'Paper' : 'Live';
  let keys = 'unknown';
  if (creds && typeof creds === 'object') {
    const id = creds.APCA_API_KEY_ID;
    const secret = creds.APCA_API_SECRET_KEY;
    keys = id?.configured && secret?.configured ? (typeof id.source === 'string' && id.source ? id.source : 'unknown') : 'none';
  }
  const orders = Array.isArray(toolNames) ? (toolNames.some(name => typeof name === 'string' && name.endsWith('__place_order')) ? 'on' : 'off') : 'unknown';
  return { host, mode, keys, orders };
}

const isNum = v => typeof v === 'number' && Number.isFinite(v);
// whole dollars where they are whole: "$100", "$1,000", "$56.17"
const dollars = n => `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const EMPTY_SEAT = { service: '', mode: '', writes: '', seat: '', limits: [], venues: [], cards: '', url: '' };

/** The Account seat's standing (/data/seat.json; spec 2026-10-20 §6.3) in the words the Venues box draws: the service, the
 *  Account's own mode and writes, the seat's standing, each limit, the venues with the paper ones marked, the cards waiting.
 *  Nothing read, or a view that is not one, is all blanks; a service not reachable is that line and nothing else. */
export function seatWords(data) {
  if (!data || data.ok !== true) return EMPTY_SEAT;
  const url = typeof data.url === 'string' ? data.url : '';
  let host = url;
  try { host = new URL(url).host; } catch { /* a bare address stays as it is */ }
  if (data.reachable !== true) return { ...EMPTY_SEAT, service: `${host} · ${data.error === 'disabled' ? 'seat disabled' : 'not reachable'}`, url };
  const mode = data.mode === 'guard' ? 'Guard' : data.mode === 'open' ? 'Beast' : '';
  const w = data.writes;
  const writes = w && typeof w === 'object' ? (w.on === true ? `Trading on${isNum(w.capUsd) ? ` · ${dollars(w.capUsd)} a move` : ''}` : 'Read-only') : '';
  const s = data.seat && typeof data.seat === 'object' ? data.seat : {};
  const name = typeof s.name === 'string' && s.name ? s.name : 'Gravit';
  const seat = s.status === 'admitted' ? `${name} · admitted${isNum(s.validUntil) ? ` until ${fmtDate(s.validUntil)}` : ''}`
    : s.status === 'knocking' ? `${name} · knocking — admit it on the Account page`
      : s.status === 'expired' ? `${name} · expired`
        : s.status === 'revoked' ? `${name} · revoked`
          : s.status === 'unknown' ? `${name} · on the account · standing unknown`
            : `${name} · not on the account`;
  const limits = (Array.isArray(s.limits) ? s.limits : []).map(l => [
    l.scope,
    (Array.isArray(l.allow) ? l.allow : []).join(', '),
    isNum(l.perOrderUsd) ? `${dollars(l.perOrderUsd)} an order` : '',
    isNum(l.budgetUsd) ? `${dollars(isNum(l.leftUsd) ? l.leftUsd : 0)} of ${dollars(l.budgetUsd)} left` : '',
    l.expired === true ? 'expired' : '',
  ].filter(Boolean).join(' · '));
  const venues = (Array.isArray(data.venues) ? data.venues : []).map(v => ({
    id: typeof v.id === 'string' ? v.id : '',
    name: typeof v.name === 'string' && v.name ? v.name : (typeof v.id === 'string' ? v.id : ''),
    paper: v.paper === true,
    usd: isNum(v.usd) ? dollars(v.usd) : '',
    note: typeof v.notServed === 'string' && v.notServed ? v.notServed : (v.stale === true ? 'stale' : ''),
  }));
  const n = Array.isArray(data.cards) ? data.cards.length : 0;
  const cards = n === 0 ? '' : `${n} card${n === 1 ? '' : 's'} waiting`;
  return { service: `${host} · reachable`, mode, writes, seat, limits, venues, cards, url };
}
