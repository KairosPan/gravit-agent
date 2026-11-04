// face/client/js/host/sheet-market.js — the Market half's three sheets (plan 4a Task 3): Close (or Sell) a position, Change an
// order still working, and a perpetual's Leverage — each the Account's own draft for its type, `liveClose`, `liveAmend` and
// `liveLeverage`, with the fields its own page signs them with (the retired page at 9614314c, ui/trade.js openClose, openAmend
// and the ticket's leverage editor), nothing added and nothing renamed. host/sheet-view.js delegates the three kinds here; the
// sheet engine (host/sheet.js) prepares the draft and What you sign shows it, as it does Trade's order. No clock: each deadline
// is the Account's prepare's. And each kind's seed from a row the screens draw — a working order, a position, a market's
// line — with the retired page saying whether its venue changes, closes or sets leverage. No DOM, no store.
import { eventPriceOf } from './trade-view.js';
import { venuesOf } from './account-view.js';

const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = v => (typeof v === 'string' ? v : '');
// a seed's figure as the string a field shows: a number, or the string a key's data-* drew it as
const figure = v => (typeof v === 'number' && Number.isFinite(v) ? String(v) : str(v));
// a plain decimal, as the Account takes its sizes
const DECIMAL = /^\d+(\.\d+)?$/;
const LIMITED = new Set(['limit', 'stop_limit']);
const STOPPED = new Set(['stop', 'stop_limit']);
/** The order types a Change sheet changes: the resting ones, with a price to move. */
export const CHANGEABLE = new Set(['limit', 'stop', 'stop_limit']);
const MARGIN_LABELS = { cross: 'Cross', isolated: 'Isolated' };
// the margin modes a seed offers: a list, or the comma-joined string a key's data-* drew it as; only the two the Account knows
const modesOf = v => (Array.isArray(v) ? v : str(v).split(','))
  .map(x => (typeof x === 'string' ? x.trim() : '')).filter((x, i, all) => Object.hasOwn(MARGIN_LABELS, x) && all.indexOf(x) === i);
// the most leverage a seed allows: a positive figure as the page takes one (a fraction too), else none said
const maxOf = v => { const n = Number(figure(v)); return Number.isFinite(n) && n > 0 ? n : null; };

/** The Market half's sheet kinds. */
export const MARKET_KINDS = ['close', 'amend', 'leverage'];

// a stock or an event is sold, never closed
const sells = seed => seed.kind === 'stock' || seed.kind === 'event';
// a price of an event's order in the cents its owner types (the Account's own `was`), else as it is
const shownPrice = (v, event) => {
  const fig = figure(v);
  if (!event || fig === '' || !Number.isFinite(Number(fig))) return fig;
  return String(Number((Number(fig) * 100).toFixed(2)));
};

/** The sheet's title, naming what the seed names. */
export function marketTitleOf(kind, seed) {
  const s = isRecord(seed) ? seed : {};
  switch (kind) {
    case 'close': { const name = str(s.name) || str(s.symbol); return `${sells(s) ? 'Sell' : 'Close'} ${name}`.trim(); }
    case 'amend': return `Change ${str(s.order)}`.trim();
    case 'leverage': return `Leverage · ${str(s.name) || str(s.symbol)}`;
    default: return '';
  }
}

/** The sheet's go key. */
export function marketGoOf(kind, seed) {
  const s = isRecord(seed) ? seed : {};
  switch (kind) {
    case 'close': return sells(s) ? 'Sign and sell' : 'Sign and close';
    case 'amend': return 'Sign and change';
    case 'leverage': return 'Sign leverage';
    default: return '';
  }
}

/** The sheet's fields, each `{ name, label, type, options?, placeholder?, value }`, every one blank to begin with. */
export function marketFieldsOf(kind, seed) {
  const s = isRecord(seed) ? seed : {};
  switch (kind) {
    case 'close': return [{ name: 'qty', label: 'How much', type: 'number', placeholder: `All ${figure(s.qty)}`.trim(), value: '' }];
    case 'amend': {
      const event = s.kind === 'event';
      const type = str(s.type);
      return [
        { name: 'qty', label: 'Size', type: 'number', placeholder: figure(s.qty) || null, value: '' },
        ...(LIMITED.has(type) ? [{ name: 'limitPrice', label: event ? 'Limit, in cents' : 'Limit price', type: 'number', placeholder: shownPrice(s.limitPrice, event) || null, value: '' }] : []),
        ...(STOPPED.has(type) ? [{ name: 'stopPrice', label: event ? 'Stop, in cents' : 'Stop price', type: 'number', placeholder: shownPrice(s.stopPrice, event) || null, value: '' }] : []),
      ];
    }
    case 'leverage': {
      const max = maxOf(s.maxLeverage);
      const modes = modesOf(s.marginModes);
      return [
        { name: 'leverage', label: max ? `Leverage, 1 to ${max}` : 'Leverage', type: 'number', placeholder: figure(s.leverage) || '1', value: '' },
        // a Margin choice only where the venue says which modes it sets
        ...(modes.length ? [{ name: 'marginMode', label: 'Margin', type: 'select', options: [{ value: '', label: 'Keep it' }, ...modes.map(value => ({ value, label: MARGIN_LABELS[value] }))], value: '' }] : []),
      ];
    }
    default: return [];
  }
}

// a field's value from the form: the sheet's fields, or a plain { name: value }; trimmed text, else ''
function text(fields, name) {
  const v = Array.isArray(fields) ? fields.find(f => isRecord(f) && f.name === name)?.value : isRecord(fields) ? fields[name] : undefined;
  return typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
}

/** The Account's draft for the sheet, from its fields and its seed — or, while something is missing, the words for it. */
export function marketDraftOf(kind, fields, seed) {
  const s = isRecord(seed) ? seed : {};
  switch (kind) {
    case 'close': {
      if (!str(s.venue) || !str(s.symbol)) return 'No position to close';
      const qty = text(fields, 'qty');
      // blank closes all of it
      if (qty !== '' && !(DECIMAL.test(qty) && Number(qty) > 0)) return 'Type how much, or leave it empty for all of it';
      return { type: 'liveClose', venue: s.venue, symbol: s.symbol, qty };
    }
    case 'amend': {
      if (!str(s.venue) || !str(s.order)) return 'No order to change';
      const event = s.kind === 'event';
      const type = str(s.type);
      const qty = text(fields, 'qty');
      const price = name => {
        const typed = text(fields, name);
        if (typed === '' || !event) return typed;
        return eventPriceOf(typed);
      };
      const limitPrice = LIMITED.has(type) ? price('limitPrice') : '';
      const stopPrice = STOPPED.has(type) ? price('stopPrice') : '';
      if (limitPrice === null || stopPrice === null) return 'A price in cents is between 0 and 100';
      if (!qty && !limitPrice && !stopPrice) return 'Type what changes';
      return { type: 'liveAmend', venue: s.venue, order: s.order, qty, limitPrice, stopPrice };
    }
    case 'leverage': {
      if (!str(s.venue) || !str(s.symbol)) return 'No market to set leverage on';
      const leverage = text(fields, 'leverage');
      if (!/^\d{1,3}$/.test(leverage) || Number(leverage) < 1) return 'Leverage is a whole number, 1 or more';
      const max = maxOf(s.maxLeverage);
      if (max !== null && Number(leverage) > max) return `Leverage is at most ${max}x here`;
      const marginMode = text(fields, 'marginMode');
      if (marginMode !== '' && !modesOf(s.marginModes).includes(marginMode)) return 'That margin mode is not offered here';
      return { type: 'liveLeverage', venue: s.venue, symbol: s.symbol, leverage, marginMode };
    }
    default: return 'Nothing to sign here';
  }
}

// ── the seeds, from the rows the screens draw ──

// what the page says a venue does, by its id
const canAt = (page, venue) => venuesOf(page).find(v => v.id === venue)?.tradeCan ?? { amend: false, leverage: false, close: false };

/** A working order's Change seed (an openOrdersOf row), or null: only an order with an id, at a venue the page says changes
 *  orders in place, of a resting type — and one the retired page would let you change: not waiting for its wallet to send
 *  it, not being canceled, not unfollowed since a restart, with no change the venue has yet to confirm. */
export function amendSeedOf(order, page) {
  const o = isRecord(order) ? order : {};
  if (!str(o.id) || !str(o.venue) || !CHANGEABLE.has(o.type) || !canAt(page, o.venue).amend) return null;
  if (o.waitingForWallet === true || o.canceling === true || o.unfollowed === true || o.changing === true || o.unconfirmed === true) return null;
  return {
    venue: o.venue, order: o.id, type: o.type, kind: str(o.kind), qty: figure(o.qty), limitPrice: figure(o.limitPrice),
    stopPrice: figure(o.stopPrice), side: str(o.side), base: str(o.base),
  };
}

/** A position's Close seed (a positionsOf row), or null for one with no venue or symbol. */
export function closeSeedOf(position) {
  const p = isRecord(position) ? position : {};
  if (!str(p.venue) || !str(p.symbol)) return null;
  return { venue: p.venue, symbol: p.symbol, name: str(p.name) || p.symbol, side: str(p.side), qty: figure(p.qty), kind: str(p.kind) };
}

// what the venue says of a market's leverage, as the retired page's ticket reads it: the most it takes (the market read's
// `maxLeverage`) and the margin modes it sets (the market read's `marginModes`, else the venue's `trade.marginModes`) — `quotes`
// the markets' reads by `venue|symbol`; nothing said is left out
function limitsAt(page, quotes, venue, symbol) {
  const read = isRecord(quotes) && Object.hasOwn(quotes, `${venue}|${symbol}`) ? quotes[`${venue}|${symbol}`] : null;
  const v = (isRecord(page) && Array.isArray(page.venues) ? page.venues : []).find(x => isRecord(x) && x.id === venue);
  const given = Array.isArray(read?.marginModes) ? read.marginModes : isRecord(v?.trade) && Array.isArray(v.trade.marginModes) ? v.trade.marginModes : [];
  const max = maxOf(read?.maxLeverage), modes = modesOf(given);
  return { ...(max !== null ? { maxLeverage: String(max) } : {}), ...(modes.length ? { marginModes: modes.join(',') } : {}) };
}

/** A perpetual position's Leverage seed, or null: only a `perp` at a venue the page says sets leverage. `quotes` (optional) are
 *  the market reads by `venue|symbol`: what the venue says of the most leverage and the margin modes of it. */
export function leverageSeedOf(position, page, quotes = null) {
  const p = isRecord(position) ? position : {};
  if (p.kind !== 'perp' || !str(p.venue) || !str(p.symbol) || !canAt(page, p.venue).leverage) return null;
  return { venue: p.venue, venueName: str(p.venueName), symbol: p.symbol, name: str(p.name) || p.symbol, leverage: figure(p.leverage), ...limitsAt(page, quotes, p.venue, p.symbol) };
}

/** A perpetual's market page Leverage seed: its first connected line at a venue the page says sets leverage, the leverage held
 *  there when a position at that line says it — or null. `item` is the market (its kind `perp`), `legs` its lines, `positions`
 *  what is held at them (positionsOf rows). */
export function marketLeverageSeedOf(item, legs, positions, page, quotes = null) {
  if (!isRecord(item) || item.kind !== 'perp') return null;
  const leg = (Array.isArray(legs) ? legs : []).find(l => isRecord(l) && l.connected === true && str(l.venue) && str(l.symbol) && canAt(page, l.venue).leverage);
  if (!leg) return null;
  const held = (Array.isArray(positions) ? positions : []).find(p => isRecord(p) && p.venue === leg.venue && p.symbol === leg.symbol);
  return { venue: leg.venue, venueName: str(leg.venueName), symbol: leg.symbol, name: str(item.name) || leg.symbol, leverage: figure(held?.leverage), ...limitsAt(page, quotes, leg.venue, leg.symbol) };
}
