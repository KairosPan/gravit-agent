// face/client/js/host/account-view.js — the Account screen's pure views (spec 2026-10-22 §6.2) over the Account's own payloads
// as the face proxies them — the page (/data/account), holdings?cost=1 and its paper lens, history, statement and agents — each
// taking the route's body as the store keeps it and answering its empty shape for a body it does not recognise; the seat box's
// words over /data/seat.json (spec 2026-10-20 §6.3); and, until their last callers go, the Alpaca-shaped views over
// /data/account.json (spec 2026-10-19 §7 Stage 2). An amount that does not parse is null, never NaN and never 0; a time stays
// the Account's ISO string, its words the renderer's. No DOM.
import { number, orderMatches } from '../wire/account-model.js';
import { fmtDate } from '../time.js';
import { positionId } from './market-view.js';

// ── The Alpaca-shaped views: Alpaca's own decimal strings become the portfolio, the orders by bucket, the statement and its
// CSV, and the venue's facts. Kept for render/rail.js, render/markets.js, render/account.js and app.js until they move. ──

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

// one CSV field, RFC 4180 (csvOf's and statementCsvOf's: it stays when csvOf goes)
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

// ── The seat box, and the Account's words it shares with the views below ──

const isNum = v => typeof v === 'number' && Number.isFinite(v);
// whole dollars where they are whole: "$100", "$1,000", "$56.17"
const dollars = n => `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const EMPTY_SEAT = { service: '', mode: '', writes: '', seat: '', limits: [], venues: [], cards: '', url: '' };
// the Account's mode and its writes (`connectLive.writes`) as its page words them: the seat box's and the head's alike
const modeWords = mode => (mode === 'guard' ? 'Guard' : mode === 'open' ? 'Beast' : '');
const writesWords = w => (w && typeof w === 'object' ? (w.on === true ? `Trading on${isNum(w.capUsd) ? ` · ${dollars(w.capUsd)} a move` : ''}` : 'Read-only') : '');
// one limit in one line, `trade · paper-1 · $100 an order · $850 of $1,000 left · expired`: the seat's (its perOrderUsd) and
// an Account agent's (its perPaymentUsd) alike
const limitWords = (l, perOrderUsd) => [
  l.scope,
  (Array.isArray(l.allow) ? l.allow : []).join(', '),
  isNum(perOrderUsd) ? `${dollars(perOrderUsd)} an order` : '',
  isNum(l.budgetUsd) ? `${dollars(isNum(l.leftUsd) ? l.leftUsd : 0)} of ${dollars(l.budgetUsd)} left` : '',
  l.expired === true ? 'expired' : '',
].filter(Boolean).join(' · ');

/** The Account seat's standing (/data/seat.json; spec 2026-10-20 §6.3) in the words the Venues box draws: the service, the
 *  Account's own mode and writes, the seat's standing, each limit, the venues with the paper ones marked, the cards waiting.
 *  Nothing read, or a view that is not one, is all blanks; a service not reachable is that line and nothing else. */
export function seatWords(data) {
  if (!data || data.ok !== true) return EMPTY_SEAT;
  const url = typeof data.url === 'string' ? data.url : '';
  let host = url;
  try { host = new URL(url).host; } catch { /* a bare address stays as it is */ }
  if (data.reachable !== true) return { ...EMPTY_SEAT, service: `${host} · ${data.error === 'disabled' ? 'seat disabled' : 'not reachable'}`, url };
  const mode = modeWords(data.mode);
  const writes = writesWords(data.writes);
  const s = data.seat && typeof data.seat === 'object' ? data.seat : {};
  const name = typeof s.name === 'string' && s.name ? s.name : 'Gravit';
  const seat = s.status === 'admitted' ? `${name} · admitted${isNum(s.validUntil) ? ` until ${fmtDate(s.validUntil)}` : ''}`
    : s.status === 'knocking' ? `${name} · knocking — admit it on the Account page`
      : s.status === 'expired' ? `${name} · expired`
        : s.status === 'revoked' ? `${name} · revoked`
          : s.status === 'unknown' ? `${name} · on the account · standing unknown`
            : `${name} · not on the account`;
  const limits = (Array.isArray(s.limits) ? s.limits : []).map(l => limitWords(l, l.perOrderUsd));
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

// ── The Account's own payloads (spec 2026-10-22 §6.2), each as its /data/account… route answers it ──

const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
// a list as the Account sends it, an entry that is not an object left out
const records = v => (Array.isArray(v) ? v.filter(isRecord) : []);
// a string as the Account sends it, or nothing
const str = v => (typeof v === 'string' ? v : '');
// a read's list: only an answer (`ok: true`) carries one
const listOf = (body, key) => (body?.ok === true ? records(body[key]) : []);
// an ISO time as a number to compare, null when it is not one
const stamp = at => { const t = typeof at === 'string' ? Date.parse(at) : NaN; return Number.isFinite(t) ? t : null; };
// the largest value first, an unpriced row last; the newest first, a time that does not parse last; a tie keeps the Account's order
const largestFirst = (a, b) => (a.usd === b.usd ? 0 : a.usd === null ? 1 : b.usd === null ? -1 : b.usd - a.usd);
const newestFirst = (a, b) => { const ta = stamp(a.at), tb = stamp(b.at); return ta === tb ? 0 : ta === null ? 1 : tb === null ? -1 : tb - ta; };

/** True when the body is the Account's page as /data/account serves it: an answer with its venues, cards and orders, its
 *  signers and connectLive. The page views below answer their empty shapes for anything else. */
export function pageOk(page) {
  return Boolean(page?.ok === true && Array.isArray(page.venues) && Array.isArray(page.cards) && Array.isArray(page.orders) && page.signers && page.connectLive);
}

/** The head's two chips: the Account's mode (`Guard`, `Beast`) and its writes (`Trading on · $250 a move`, `Read-only`). */
export function headOf(page) {
  if (!pageOk(page)) return { mode: '', writes: '' };
  return { mode: modeWords(page.mode), writes: writesWords(page.connectLive.writes) };
}

/** The Portfolio's two figures, each labelled. Real money — the page's `totalUsd`: the venues that are not paper, in flight and
 *  held; the holdings read repeats it — leads, unless it is zero or does not parse while a paper venue is connected and the
 *  paper lens (`holdings?cost=1&paper=1`) has a total: then Paper leads, and real money, when there is a figure, is second. */
export function worthOf(page, holdingsBody, paperBody) {
  if (!pageOk(page)) return { lead: { label: 'Net worth', usd: null }, second: null, paperLeads: false };
  const real = number(page.totalUsd);
  const paperTotal = number(paperBody?.totalUsd);
  const hasPaper = page.venues.some(v => v?.paper === true);
  const paperLeads = (real === null || real === 0) && hasPaper && paperTotal !== null;
  if (paperLeads) return { lead: { label: 'Paper', usd: paperTotal }, second: real === null ? null : { label: 'Net worth', usd: real }, paperLeads };
  return { lead: { label: 'Net worth', usd: real }, second: hasPaper && paperTotal !== null ? { label: 'Paper', usd: paperTotal } : null, paperLeads };
}

/** The change line for the range, from `history` (or `history?paper=1`): `changeUsd`, `changePct` — the Account's percent, 0.72
 *  being 0.72 % — whether the curve is partial, and its first point's time. A body that is not one is all nulls. */
export function changeOf(historyBody) {
  const h = isRecord(historyBody) ? historyBody : {};
  return { usd: number(h.changeUsd), pct: number(h.changePct), partial: h.partial === true, first: typeof h.first === 'string' ? h.first : null };
}

/** The Assets table from `holdings?cost=1`'s rows: each asset across its venues (`changePct24h` the Account's percent), the
 *  largest value first. */
export function assetsOf(holdingsBody) {
  return listOf(holdingsBody, 'rows').map(row => ({
    key: str(row.key), asset: str(row.asset), cls: str(row.class),
    amount: number(row.amount), usd: number(row.usd), price: number(row.price), changePct24h: number(row.changePct24h),
    venues: records(row.venues).map(v => ({ venue: str(v.venue), venueName: str(v.venueName), amount: number(v.amount), usd: number(v.usd), stale: v.stale === true })),
  })).sort(largestFirst);
}

/** The Positions table from the same read's `positions` (the paper lens's are its own), in the Account's order. */
export function positionsOf(holdingsBody) {
  return listOf(holdingsBody, 'positions').map(p => ({
    venue: str(p.venue), venueName: str(p.venueName), symbol: str(p.symbol), name: str(p.name), side: str(p.side),
    qty: number(p.qty), entryPrice: number(p.entryPrice), markPrice: number(p.markPrice), usd: number(p.usd), unrealizedUsd: number(p.unrealizedUsd),
    paper: p.paper === true,
  }));
}

const OPEN = new Set(['open', 'partial', 'pending']);

/** The page's orders still working — open, partial or pending — newest first as the Account sends them, each with whose it
 *  is: You for the owner's, else the agent's name where the order names it, else An agent. */
export function openOrdersOf(page) {
  if (!pageOk(page)) return [];
  return records(page.orders).filter(o => OPEN.has(o.status)).map(o => ({
    id: str(o.id), venue: str(o.venue), venueName: str(o.venueName), symbol: str(o.symbol), side: str(o.side), type: str(o.type),
    qty: number(o.qty), filledQty: number(o.filledQty), limitPrice: number(o.limitPrice), status: o.status,
    who: o.authority === 'owner' ? 'You' : typeof o.agentName === 'string' && o.agentName ? o.agentName : 'An agent',
    paper: o.paper === true,
  }));
}

/** A read's `missing` — the venues it could not reach — one sentence a venue, `Stand-in Exchange did not answer`: a venue
 *  whose stats and positions both failed is named once. */
export function missingWords(missing) {
  const words = records(missing).filter(m => typeof m.venue === 'string' && m.venue)
    .map(m => `${typeof m.venueName === 'string' && m.venueName ? m.venueName : m.venue} did not answer`);
  return [...new Set(words)];
}

/** The Statement drawer's lines from `statement`, newest first, each in the Account's words (`by`: You, an agent approved by
 *  you or inside its limit, the paper account). */
export function statementLinesOf(statementBody) {
  return listOf(statementBody, 'lines').map(l => ({
    key: str(l.key), at: str(l.at), type: str(l.type), kind: str(l.kind), description: str(l.description),
    amountUsd: number(l.amountUsd), feeUsd: number(l.feeUsd), status: str(l.status), by: str(l.by), paper: l.paper === true,
  })).sort(newestFirst);
}

/** The statement's lines as RFC 4180 CSV, CRLF line ends, with the `by` column. */
export function statementCsvOf(rows) {
  const lines = ['date,type,kind,description,amount,fee,status,by'];
  for (const l of records(rows)) lines.push([l.at, l.type, l.kind, l.description, l.amountUsd, l.feeUsd, l.status, l.by].map(field).join(','));
  return lines.map(line => `${line}\r\n`).join('');
}

/** A venue's health from the page's `health[id]`: it answers when its last good read is newer than its last failure (or it
 *  never failed); it is not answering since a failure as new as that or newer; it is not read yet when neither is on record. */
function healthOf(h) {
  const okAt = stamp(h?.lastOkAt), failAt = stamp(h?.lastFailAt);
  if (okAt !== null && (failAt === null || okAt > failAt)) return { health: 'answers', healthWords: 'Answers', since: null };
  if (failAt !== null) return { health: 'not-answering', healthWords: 'Not answering', since: h.lastFailAt };
  return { health: 'not-read', healthWords: 'Not read yet', since: null };
}

/** What a venue does, in the words its row draws. */
function doesOf(v) {
  const can = isRecord(v.liveCan) ? v.liveCan : {};
  return [
    v.trade?.can === true ? 'Trades' : '',
    can.transfer === true || can.withdraw === true ? 'Moves money' : '',
    can.receive === true ? 'Receives' : '',
    v.earn?.can === true ? 'Earns' : '',
    typeof v.watchOnly === 'string' && v.watchOnly ? 'Watched' : '',
  ].filter(Boolean);
}

/** The Venues tab from the page's `venues`: each venue's value, front line, health, what it does, the paper flag, when it was
 *  read (`stale` the Account's words where it says them), and the Details drawer's facts — the key file's path when it has
 *  one, never what is in it. */
export function venuesOf(page) {
  if (!pageOk(page)) return [];
  const health = isRecord(page.health) ? page.health : {};
  return records(page.venues).map(v => {
    const id = str(v.id);
    return {
      id, name: str(v.name), usd: number(v.usd), frontLine: str(v.frontLine),
      ...healthOf(Object.hasOwn(health, id) ? health[id] : undefined),
      does: doesOf(v), paper: v.paper === true, asOf: str(v.asOf),
      stale: typeof v.stale === 'string' ? v.stale : v.stale === true,
      details: {
        holdings: records(v.holdings).map(h => ({ asset: str(h.asset), amount: number(h.amount), usd: number(h.usd) })),
        noTradeBecause: str(v.noTradeBecause), restricted: str(v.restricted),
        notServed: str(v.notServed?.said), closeOnly: str(v.closeOnly?.said), watchOnly: str(v.watchOnly), keyFile: str(v.keyFile),
      },
    };
  });
}

const sameName = (a, b) => typeof a === 'string' && a.trim().toLowerCase() === b.trim().toLowerCase();

/** The Agents tab. Gravit's row first, in the seat box's words — its standing, its limits, its cards waiting, from the seat
 *  view (/data/seat.json) — whenever the seat view has a standing to show (the seat view counts no orders); then every agent
 *  the Account lists (`agents`), each limit in the same words. While Gravit's row stands, the Account's own row for the seat
 *  (the agent of the seat's name, in any case) is left out, so Gravit is listed once; with no seat view to stand on, the
 *  Account's list is the whole answer. The knocking keys are the page's (`requestsOf`). */
export function agentsOf(agentsBody, seatView) {
  const w = seatWords(seatView);
  const rows = [];
  let seatName = null;
  if (w.seat) {
    const s = seatView.seat && typeof seatView.seat === 'object' ? seatView.seat : {};
    seatName = typeof s.name === 'string' && s.name ? s.name : 'Gravit';   // the name seatWords gives the seat
    rows.push({ gravit: true, name: seatName, standing: w.seat, limits: w.limits, cards: w.cards, orders: 0 });
  }
  for (const a of listOf(agentsBody, 'agents')) {
    if (seatName !== null && sameName(a.name, seatName)) continue;
    rows.push({
      gravit: false, name: str(a.name), status: str(a.status), validUntil: str(a.validUntil),
      limits: records(a.limits).map(l => limitWords(l, l.perPaymentUsd)),
      cards: Array.isArray(a.cards) ? a.cards.length : 0,
      orders: Array.isArray(a.orders) ? a.orders.length : 0,
    });
  }
  return rows;
}

const asText = v => (typeof v === 'string' ? v : String(v));

/** The Cards tab: the cards waiting for the owner (the page's `cards`), grouped by the agent that asked in the order the agents
 *  first appear; each card's reason, value and answer-by time, and What it asks — `shown`, every field the owner signs — as
 *  the Account sends it. */
export function cardsOf(page) {
  if (!pageOk(page)) return [];
  const groups = new Map();
  for (const c of records(page.cards)) {
    const agentName = typeof c.agentName === 'string' && c.agentName ? c.agentName : 'An agent';
    if (!groups.has(agentName)) groups.set(agentName, []);
    groups.get(agentName).push({
      id: str(c.id), reason: str(c.reason), usd: number(c.usd), expiresAt: str(c.expiresAt),
      shown: records(c.shown).map(f => ({ name: asText(f.name), value: asText(f.value) })),
    });
  }
  return [...groups].map(([agentName, cards]) => ({ agentName, cards }));
}

/** The agents' asks (the page's `asks`: a bigger budget, a venue, a session), in their words. */
export function asksOf(page) {
  if (!pageOk(page)) return [];
  return records(page.asks).map(a => ({ id: str(a.id), agentName: str(a.agentName), kind: str(a.kind), text: str(a.text), expiresAt: str(a.expiresAt) }));
}

/** The keys knocking to be let in (the page's `requests`). */
export function requestsOf(page) {
  if (!pageOk(page)) return [];
  return records(page.requests).map(r => ({ address: str(r.address), name: str(r.name), at: str(r.at) }));
}
