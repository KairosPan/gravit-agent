// face/client/js/host/market-depth-view.js — a market's page's four reads beside its price (plan 4a Task 4), pure views over the
// Account's own answers as the face's proxy passes them: the asset sheet (/data/account/asset?key=, the Account's `asset`:
// what is held of it, its open orders, its statement lines and what was paid), its order book (/data/account/connected/book or /data/market/book), its latest
// trades (the same two routes, …/trades) and a perpetual's funding (/data/account/funding). Each takes the route's body as the store
// keeps it and answers its empty shape for a body it does not recognise. The asset a market is read as is the Account's own
// page's rule (its ui/markets.js mkAssetKey). An amount that does not parse is null; a time stays the Account's ISO string. No DOM.
import { number } from '../wire/account-model.js';
import { positionsOf, orderRowsOf, missingWords, statementLinesOf, assetsOf } from './account-view.js';
import { t } from '../i18n/words.js';

const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const records = v => (Array.isArray(v) ? v.filter(isRecord) : []);
const str = v => (typeof v === 'string' ? v : '');
const stamp = at => { const ms = typeof at === 'string' ? Date.parse(at) : NaN; return Number.isFinite(ms) ? ms : null; };
// the newest first, a time that does not parse last; a tie keeps the Account's order
const newestFirst = (a, b) => { const ta = stamp(a.at), tb = stamp(b.at); return ta === tb ? 0 : ta === null ? 1 : tb === null ? -1 : tb - ta; };

/** The asset the Account's asset read knows a market by, as its own page asks it (ui/markets.js mkAssetKey): a coin's or a
 *  perpetual's coin `crypto:<base>`, a stock `equity:<base>`, an RWA `rwa:<base>`, an event contract `event:<symbol>` at its
 *  first connected line; anything else (an event no venue connected lists, a market with no base) is read as nothing: ''. */
export function assetKeyOf(item) {
  if (!isRecord(item)) return '';
  const base = str(item.base).toUpperCase();
  if (item.kind === 'coin' || item.kind === 'perp') return base ? `crypto:${base}` : '';
  if (item.kind === 'stock') return base ? `equity:${base}` : '';
  if (item.kind === 'rwa') return base ? `rwa:${base}` : '';
  if (item.kind === 'event') {
    const at = records(item.at).find(a => a.connected === true && str(a.symbol) !== '');
    return at ? `event:${at.symbol}` : '';
  }
  return '';
}

const EMPTY_HERE = Object.freeze({ held: null, paperHeld: null, positions: [], orders: [], cost: [], paperCost: [], agents: [], missing: [] });
const costRows = v => records(v).map(c => ({
  key: str(c.key), side: str(c.side), symbol: str(c.symbol), avgCostUsd: number(c.avgCostUsd), costUsd: number(c.costUsd),
  coveredQty: number(c.coveredQty), ofQty: number(c.ofQty), words: str(c.words),
}));
// the statement's `by` for the owner's own line, as the Account writes it (account/statement.ts)
const OWNER_BY = 'You'; // en-kept: the Account's word, matched
const heldRow = row => (isRecord(row) ? assetsOf({ ok: true, rows: [row] })[0] ?? null : null);

/** You here, from the asset sheet: what is held of it across its venues (`held`, the holdings row as assetsOf words one, or
 *  null), its positions (as positionsOf rows), its open orders with who placed them (as openOrdersOf names them, the page's
 *  `keys` naming an agent's address), what was paid (`cost`: `{ key, side, symbol, avgCostUsd, costUsd, coveredQty, ofQty,
 *  words }` — the row's key, a position's `position:<venue>:<symbol>`, an event's own), what the agents do here (`agents`: its
 *  orders whose author is not the owner, `{ type: 'order', order }`, then its statement lines whose `by` is not You,
 *  `{ type: 'line', line }`, newest first), and the venues it could not read, one sentence
 *  each. The paper accounts' holding of it (the sheet's `paper`, the Paper lens) is apart: `paperHeld` its row and
 *  `paperCost` that row's cost, its positions among `positions` (each `paper`, its cost among `cost`) but for a spot one,
 *  which is the row again. A refusal, or a body that is not the asset read, is the empty shape. */
export function hereOf(body, page) {
  if (body?.ok !== true || !Array.isArray(body.positions) || !Array.isArray(body.orders)) return { ...EMPTY_HERE };
  const orders = orderRowsOf(body.orders, isRecord(page) ? page.keys : []);
  const theirs = orders.filter(o => !o.mine);
  const said = statementLinesOf({ ok: true, lines: body.lines }).filter(l => l.by !== '' && l.by !== OWNER_BY);
  const paper = isRecord(body.paper) ? body.paper : {};
  const paperCost = costRows(paper.cost);
  const atPosition = c => c.key.startsWith('position:');
  return {
    held: heldRow(body.row),
    paperHeld: heldRow(paper.row),
    positions: [...positionsOf(body), ...positionsOf({ ok: true, positions: paper.positions }).filter(p => p.kind !== 'spot').map(p => ({ ...p, paper: true }))],
    orders,
    cost: [...costRows(body.cost), ...paperCost.filter(atPosition)],
    paperCost: paperCost.filter(c => !atPosition(c)),
    agents: [...theirs.map(order => ({ type: 'order', order })), ...said.map(line => ({ type: 'line', line }))],
    missing: missingWords(body.missing),
  };
}

/** The cost row of a position (`position:<venue>:<symbol>`, else an event contract's own `event:<symbol>`), or of the asset
 *  held (its row's key; `paper`: the paper accounts' row's): null when the sheet names none. */
export function costOf(here, { venue = '', symbol = '', kind = '', key = '', paper = false } = {}) {
  const kept = paper && key ? here?.paperCost : here?.cost;
  const rows = Array.isArray(kept) ? kept : [];
  const want = key ? [key] : [`position:${venue}:${symbol}`, kind === 'event' ? `event:${symbol}` : ''].filter(Boolean);
  return rows.find(c => want.includes(c.key)) ?? null;
}

const EMPTY_BOOK = Object.freeze({ bids: [], asks: [], from: '', at: '', depth: '', public: false });
// one level as the Account sends it, [price, size]: a size the source gives none of is null
const levelOf = l => {
  if (!Array.isArray(l)) return null;
  const price = number(l[0]);
  return price === null ? null : { price, size: l[1] === null || l[1] === undefined ? null : number(l[1]) };
};

/** The order book: each side `[{ price, size }]` best first as the Account sends it (a size the source gives none of null),
 *  whose book it is in the Account's words (`from`), its stamp, `depth` (`full`, or `top` — the best bid and ask only) and
 *  whether it is a public source's (`public`). Anything else is the empty book. */
export function bookOf(body) {
  if (body?.ok !== true || !isRecord(body.book)) return { ...EMPTY_BOOK, bids: [], asks: [] };
  const b = body.book;
  const side = v => (Array.isArray(v) ? v.map(levelOf).filter(Boolean) : []);
  return { bids: side(b.bids), asks: side(b.asks), from: str(b.from), at: str(b.at), depth: str(b.depth), public: body.public === true };
}

/** The latest trades, newest first, each `{ price, size, side, at }` (`side` only where the source says which side took, else
 *  ''); `none`, the answering half's sentence (the market's, or the Account's at a connected venue) when the source publishes no trades at all (else ''); whether a public source's. */
export function tradesOf(body) {
  if (body?.ok !== true || !Array.isArray(body.trades)) return { trades: [], none: '', public: false };
  const trades = records(body.trades).map(x => ({ price: number(x.price), size: number(x.size), side: x.side === 'buy' || x.side === 'sell' ? x.side : '', at: str(x.at) }))
    .filter(x => x.price !== null).sort(newestFirst);
  return { trades, none: str(body.none).trim(), public: body.public === true };
}

/** A perpetual's funding: the lines of every funding read (one a venue) whose `symbol` is one of the page's (`symbol`, one or a
 *  list: its lines' symbols), newest first, each `{ at, venueName, side, qty, rate, usd, paper }` — `usd` above zero paid out of
 *  the position, below zero received, as the Account keeps it. A read that is not one gives none. */
export function fundingOf(bodies, symbol) {
  const symbols = new Set((Array.isArray(symbol) ? symbol : [symbol]).filter(s => typeof s === 'string' && s !== ''));
  return (Array.isArray(bodies) ? bodies : [])
    .filter(b => b?.ok === true && Array.isArray(b.lines))
    .flatMap(b => records(b.lines))
    .filter(l => symbols.has(l.symbol))
    .map(l => ({
      at: str(l.at), venueName: str(l.venueName) || str(l.venue), side: l.side === 'long' || l.side === 'short' ? l.side : '',
      qty: number(l.qty), rate: number(l.rate), usd: number(l.usd), paper: l.paper === true,
    }))
    .sort(newestFirst);
}

/** The venues a funding read could not read, among `venues` (the page's connected lines'; null: every one), as the Account's
 *  own page says them under its rows (ui/terminal.js ttFunding): `Not read: Stand-in Exchange: lists no funding.`; '' for none. */
export function fundingMissingOf(body, venues = null) {
  if (body?.ok !== true) return '';
  const only = Array.isArray(venues) ? new Set(venues) : null;
  const missed = records(body.missing).filter(m => only === null || only.has(m.venue))
    .map(m => `${str(m.venueName) || str(m.venue)}: ${str(m.why).replace(/[.\s]+$/, '')}`);
  return missed.length ? t('markets.funding.notRead', { venues: missed.join(' · ') }) : '';
}
