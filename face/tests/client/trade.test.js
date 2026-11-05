// The Trade screen (spec 2026-10-22 §6.4, plan 2 Task 11) over the stand-in's answers (tests/fixtures/account/): the head with
// the Account's own writes chip, the kinds, the picker (what is held, starred, most traded, a search's results), Under way with
// its one-click Cancel, and the ticket — Where (the best marked, a public listing leading to Venues), Buy or Sell, the amount
// and its unit, Market or Limit, extended hours where the line offers them on a limit, the quote, What you sign, the
// signature's minutes, what the Account said and Sign and place, on only while the shown preparation is the form's. A page that
// does not sign reads (the picker, Under way) and draws its device line where the form would be.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderTradeScreen } from '../../client/js/render/trade.js';
import { reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { ticketOf, underWayOf, tradeKinds } from '../../client/js/host/trade-view.js';
import { headOf } from '../../client/js/host/account-view.js';
import { whatYouSignLines, standingWords } from '../../client/js/host/owner-view.js';
import { askedOf } from '../../client/js/host/sheet.js';
import { fmtClock } from '../../client/js/time.js';

const NOW = Date.parse('2026-10-22T07:40:00.000Z');
const CJK = /[㐀-鿿]/;
// a fixture of the stand-in's answers, parsed afresh for every call so no test sees another's copy
const fx = name => JSON.parse(readFileSync(new URL(`../fixtures/account/${name}.json`, import.meta.url), 'utf8'));
const read = data => ({ status: 'ready', data, at: 1 });
const picksOf = (all, kind) => ({ ...all, items: all.items.filter(i => i.tabs.includes(kind)) });
// the plain form the trade host opens the order sheet with
const form = over => ({ venue: '', side: 'buy', outcome: '0', amount: '', unit: 'usd', orderType: 'market', limit: '', extendedHours: false, ...over });

// Trade on screen with the Account's page, its holdings, All's explore read and the crypto and predictions picks; the owner's
// standing; a ticket open with its order sheet seeded as the trade host seeds it (the view's venue, the ticket's side and
// outcome) and the fields given over it
function stateWith({ role = 'signs', kind = 'crypto', q = '', results = null, watch = [], ticket = null, fields = {}, page = fx('account'), all = fx('explore-all') } = {}) {
  const s0 = emptyState();
  let s = {
    ...s0,
    route: { screen: 'trade', id: null },
    markets: { ...s0.markets, explore: { all: read(all) }, watch },
    account: { ...s0.account, status: 'ready', data: page, holdings: read(fx('holdings')) },
    owner: { ...s0.owner, role, kid: role === 'signs' ? 'a5048199a8081854' : '' },
    trade: {
      ...s0.trade, kind, q,
      picks: { crypto: read(picksOf(all, 'crypto')), predictions: read(fx('explore-predictions')) },
      results: results ? read(results) : s0.trade.results,
      ticket,
    },
  };
  if (ticket) {
    const t = ticketOf(s, NOW);
    s = R.sheetOpen(s, { kind: 'order', seed: { id: ticket.id, ticket: t }, fields: form({ venue: t.venue, side: t.side, outcome: String(t.outcome), ...fields }) });
  }
  return s;
}
const ETH = { id: 'coin:ETH', side: 'buy', venue: null, outcome: 0 };
const draw = s => renderTradeScreen(s, NOW);
const panel = html => html.match(/<aside class="tk-panel" aria-label="Order ticket">[\s\S]*<\/aside>/)?.[0] ?? '';
const goKey = html => html.match(/<button type="submit"[^>]*>Sign and place<\/button>/)?.[0] ?? '';
// the ticket ready: the stand-in's preparation landed for the form as it stands, its signature good for 2:05
function ready(s, prepared = fx('prepared-order')) {
  return R.sheetPrepared(s, { prepared, at: NOW, asked: askedOf(s.sheet), deadline: NOW + 125_000 });
}

test('the screen with no ticket: the head with the Account\'s writes chip, the kinds, the picker, Under way, Pick a market', () => {
  const s = stateWith({ watch: ['coin:BTC', 'coin:GONE'] });
  const html = draw(s);
  assert.match(html, /^<main class="main trade"><div class="tp"><div class="tp-cols"><div class="tp-main"><div class="tp-head"><h1 class="head-title">Trade<\/h1>/);
  // the chip is the Account's own words, never a literal of the screen's
  const writes = headOf(s.account.data).writes;
  assert.ok(writes, 'the stand-in page says whether it trades');
  assert.match(html, new RegExp(`<span class="chip grey">${writes.replace(/[$.]/g, c => `\\${c}`)}</span>`));
  // the kinds: the Account's tabs, the one Trade is on pressed
  const kinds = [...html.matchAll(/<button type="button" class="seg-item( pressed)?" aria-pressed="(true|false)" data-action="tradeKind" data-value="([a-z]+)">[\s\S]*?<\/svg>([^<]+)<\/button>/g)];
  assert.deepEqual(kinds.map(m => [m[3], m[2], m[4]]), tradeKinds().map(k => [k.id, String(k.id === 'crypto'), k.label]));
  // the picker: the search box, what is held (the venue it is held at handed on), the starred, the kind's most traded
  assert.match(html, /<h2 class="tk-h2">Crypto<\/h2>/);
  assert.match(html, /<label for="tq" class="sr-only">Search Crypto<\/label><input id="tq" type="search" autocomplete="off" placeholder="Search Crypto" data-action="tradeQuery" value="">/);
  for (const g of ['You hold', 'Watching', 'Most traded']) assert.match(html, new RegExp(`<div class="tk-pg-h">${g}</div>`), g);
  assert.match(html, /<li><button type="button" class="tk-row" data-action="pickMarket" data-id="coin:BTC" data-venue="ex"><span class="mk-av mk-av-sm" aria-hidden="true">BTC<\/span><span class="tk-rn"><b>BTC<\/b><span class="mk-sub">0\.124 · Stand-in Exchange, Stand-in Wallet<\/span><\/span><span class="tk-rp"><span class="num">\$62,479\.03<\/span><\/span><\/button><\/li>/);
  assert.match(html, /data-action="pickMarket" data-id="coin:GONE"><span class="mk-av mk-av-sm" aria-hidden="true">GONE<\/span><span class="tk-rn"><b>GONE<\/b><span class="mk-sub">Not in this read<\/span>/);
  assert.match(html, /data-action="pickMarket" data-id="coin:DOGE">/);
  assert.doesNotMatch(html, /data-action="pickMarket"[^>]*data-(side|outcome)=/, 'a coin opens as a buy, with no outcome');
  // Under way: the page's working orders in the Account screen's words, Cancel where the Account knows what cancels it
  const under = underWayOf(s.account.data);
  assert.ok(under.length > 0);
  assert.match(html, new RegExp(`<h2 class="tk-h2">Under way</h2><span class="dim">${under.length}</span>`));
  for (const o of under) {
    if (o.cancel) assert.match(html, new RegExp(`<button type="button" class="btn-sm" data-action="cancelOrder" data-venue="${o.cancel.venue}" data-order="${o.cancel.order}">Cancel</button>`), o.id);
  }
  assert.equal((html.match(/data-action="cancelOrder"/g) ?? []).length, under.filter(o => o.cancel).length);
  assert.match(html, /Stand-in Exchange · Buy 0\.707 SOL\/USDT · limit 141\.44 · open/);
  // the ticket panel: the kind and Pick a market, no form, no go key
  const p = panel(html);
  assert.match(p, /<span class="mk-tag tk-ktag">Crypto<\/span><h2 class="tk-title">Pick a market<\/h2>/);
  assert.doesNotMatch(p, /<form|Sign and place|data-action="closeTicket"/);
  // a ticket on a perpetual (a route or a stale link) opens nothing: Pick a market
  const perp = { ...s, trade: { ...s.trade, ticket: { id: 'perp:ETH', side: 'buy', venue: 'ex', outcome: 0 } } };
  const pp = panel(draw(perp));
  assert.match(pp, /<h2 class="tk-title">Pick a market<\/h2>/);
  assert.doesNotMatch(pp, /<form|Sign and place/);
});

test('a query: the trade search\'s results of the kind; Searching… on its way; its refusal said; nothing found said', () => {
  const all = fx('explore-all');
  const results = { ...all, items: all.items.filter(i => i.key.endsWith(':ETH')) };
  const found = draw(stateWith({ q: 'eth', results }));
  assert.match(found, /<div class="tk-pg-h">Results for “eth”<\/div>/);
  assert.match(found, /data-action="pickMarket" data-id="coin:ETH"/);
  assert.doesNotMatch(found, /<div class="tk-pg-h">(You hold|Most traded)<\/div>/, 'a query shows its results alone');
  assert.match(found, /data-action="tradeQuery" value="eth"/);
  const s = stateWith({ q: 'zz' });
  assert.match(draw({ ...s, trade: { ...s.trade, results: { status: 'loading', data: null, at: null } } }), /<p class="mk-empty">Searching…<\/p>/);
  assert.match(draw({ ...s, trade: { ...s.trade, results: { status: 'error', data: null, at: 1, message: 'The account is busy' } } }), /<p class="mk-empty">The account is busy<\/p>/);
  assert.match(draw(stateWith({ q: 'zz', results: { ...all, items: [] } })), /<p class="mk-empty">Nothing matches “zz” under Crypto\.<\/p>/);
  // a kind's picks still on their way, with nothing held or watched yet (the page's own watch list empty)
  const loading = stateWith({ page: { ...fx('account'), watch: [] } });
  assert.match(draw({ ...loading, trade: { ...loading.trade, picks: {} }, account: { ...loading.account, holdings: { status: 'idle', data: null, at: null } } }), /<p class="mk-empty">Loading…<\/p>/);
});

test('a ticket: Where with the best marked and Paper, a public listing leading to Venues; the side, Amount and In, Market, no limit field', () => {
  const html = draw(stateWith({ ticket: ETH }));
  const p = panel(html);
  assert.match(p, /<div class="tk-h"><div class="tk-h-l"><h2 class="tk-title">Buy ETH<\/h2><\/div><button type="button" class="close-key" data-action="closeTicket" aria-label="Close the ticket">×<\/button><\/div>/);
  assert.match(p, /<form class="tk-form" data-action="placeOrder" novalidate autocomplete="off">/);
  assert.match(p, /<div class="tk-picked"><span class="mk-av mk-av-sm" aria-hidden="true">ETH<\/span><span class="tk-rn"><b>ETH<\/b><span class="mk-sub">Crypto · ETH\/USDT<\/span><\/span><span class="tk-rp"><span class="num">\$2,455\.60<\/span><\/span><\/div>/);
  // Where: the able lines as keys, the one the form is at pressed, the best and the paper marked; the public listing leads to Venues
  assert.match(p, /<div class="dsec-label">Where<\/div>/);
  assert.match(p, /<button type="button" class="tk-at" data-action="ticketVenue" data-venue="ex" aria-pressed="true"><span><b>Stand-in Exchange<\/b><span class="mk-tag up">Best<\/span><\/span><span class="tk-at-r">\$2,455\.60<\/span><\/button>/);
  assert.match(p, /data-action="ticketVenue" data-venue="wallet" aria-pressed="false">/);
  assert.match(p, /data-action="ticketVenue" data-venue="paper-momentum" aria-pressed="false"><span><b>Momentum · paper<\/b><span class="mk-tag">Paper<\/span><\/span>/);
  assert.match(p, /<div class="tk-at pub"><span><b>[^<]+<\/b><span class="mk-tag">Public<\/span><\/span><span class="tk-at-r">[^<]+<a class="link" href="#\/account\/venues">Connect to trade<\/a><\/span><\/div>/);
  assert.doesNotMatch(p, /data-venue="standin-pubex-public"/, 'a public listing is not a place the order goes');
  // the side, Amount and In, the order type; no limit field and no extended hours on a market order
  assert.match(p, /<div class="seg tk-side" role="group" aria-label="Buy or sell"><button type="button" class="seg-item pressed" aria-pressed="true" data-action="ticketSide" data-value="buy">Buy<\/button><button type="button" class="seg-item" aria-pressed="false" data-action="ticketSide" data-value="sell">Sell<\/button><\/div>/);
  assert.match(p, /<input id="tk-amount" class="input tk-input" type="text" name="amount" value="" placeholder="25" inputmode="decimal" autocomplete="off" data-action="ticketField">/);
  assert.match(p, /<select id="tk-unit" class="input tk-input" name="unit" data-action="ticketField"><option value="usd" selected>Dollars<\/option><option value="qty">ETH<\/option><\/select>/);
  assert.match(p, /<select id="tk-type" class="input tk-input" name="orderType" data-action="ticketField"><option value="market" selected>Market<\/option><option value="limit">Limit<\/option><\/select>/);
  assert.doesNotMatch(p, /name="limit"|name="extendedHours"/);
  // nothing typed: the sheet's words for what is missing, the go key off, nothing to sign yet
  assert.match(p, /<div class="tk-quote"><div class="tk-path">Fill it in to see what it would be\.<\/div><\/div>/);
  assert.match(goKey(p), /disabled/);
  assert.doesNotMatch(p, /What you sign|Your signature is good/);
  assert.match(p, /<button type="button" class="btn tk-hand" data-action="handToGravit" data-id="coin:ETH">[\s\S]*?Hand to Gravit instead<\/button>/);
  // a sell from the form, a stock's unit in shares
  assert.match(panel(draw(stateWith({ ticket: ETH, fields: { side: 'sell' } }))), /<h2 class="tk-title">Sell ETH<\/h2>/);
  const nvda = panel(draw(stateWith({ kind: 'stocks', ticket: { id: 'stock:NVDA', side: 'buy', venue: 'broker', outcome: 0 } })));
  assert.match(nvda, /<option value="qty">Shares<\/option>/);
  assert.match(nvda, /<h2 class="tk-title">Buy NVDA<\/h2>/);
});

test('a limit: the limit field; extended hours only on a limit, only where the picked line offers them', () => {
  const eth = panel(draw(stateWith({ ticket: ETH, fields: { orderType: 'limit', limit: '2400' } })));
  assert.match(eth, /<option value="limit" selected>Limit<\/option>/);
  assert.match(eth, /<label class="field"><span class="field-label">Limit price<\/span><input id="tk-limit" class="input tk-input" type="text" name="limit" value="2400" inputmode="decimal" autocomplete="off" data-action="ticketField"><\/label>/);
  assert.doesNotMatch(eth, /name="extendedHours"/, 'the line offers no extended hours');
  // the broker's NVDA line offers them
  const all = fx('explore-all');
  all.items.find(i => i.key === 'stock:NVDA').at[0].session.extendedHours = true;
  const nvda = (fields, venue = 'broker') => panel(draw(stateWith({ all, kind: 'stocks', ticket: { id: 'stock:NVDA', side: 'buy', venue, outcome: 0 }, fields })));
  assert.match(nvda({ orderType: 'limit', extendedHours: true }), /<label class="sheet-check"><input type="checkbox" name="extendedHours" value="true" checked data-action="ticketField">Extended hours<\/label>/);
  assert.match(nvda({ orderType: 'limit' }), /<input type="checkbox" name="extendedHours" value="true" data-action="ticketField">/);
  assert.doesNotMatch(nvda({ orderType: 'market' }), /name="extendedHours"/, 'a market order rides no extended hours');
  assert.doesNotMatch(nvda({ orderType: 'limit' }, 'paper-momentum'), /name="extendedHours"/, 'the paper line does not offer them');
});

test('ready: the quote from the preparation, What you sign closed with its 18 lines verbatim, the countdown, Sign and place on', () => {
  const prepared = fx('prepared-order');
  const s = ready(stateWith({ ticket: ETH, fields: { amount: '25' } }), prepared);
  const p = panel(draw(s));
  // the stand-in's order quote gives no fee of its own: the venue charges it as it does
  assert.match(p, /<div class="tk-quote"><div class="tk-big"><span>buy 0\.0099 ETH at Stand-in Exchange · market · about \$24\.31<\/span><span>≈ \$24\.31<\/span><\/div><div class="tk-path">up to \$24\.80 if the price moves<\/div><div class="tk-path">fee as Stand-in Exchange charges it<\/div><\/div>/);
  assert.match(p, /<p class="tk-left">Your signature is good for 2:05 more\.<\/p>/);
  const signs = p.match(/<details id="tk-signs" class="acct-shown"><summary data-action="toggleSigns">What you sign<\/summary>([\s\S]*?)<\/details>/);
  assert.ok(signs, 'What you sign, closed');
  const lines = [...signs[1].matchAll(/<div class="dsec-line">([^<]*)<\/div>/g)].map(m => m[1]);
  assert.equal(lines.length, 18);
  assert.deepEqual(lines, whatYouSignLines(prepared));
  assert.equal(lines[0], 'venue: ex');
  assert.equal(lines[15], 'maxNotional: 24.80');
  assert.match(goKey(p), /^<button type="submit" class="btn-primary tk-go">Sign and place<\/button>$/);
  assert.match(p, /<div class="tk-quote">/, 'the quote is the form\'s: not dimmed');
  // the form changed under the shown preparation: the go key off, the quote and What you sign dimmed until the new one lands
  const changed = R.sheetField(s, { name: 'amount', value: '30' });
  const q = panel(draw(changed));
  assert.match(goKey(q), /disabled/);
  assert.match(q, /<details id="tk-signs" class="acct-shown stale">/);
  assert.match(q, /<div class="tk-quote stale"><div class="tk-big"><span>buy 0\.0099 ETH/);
  // a preparation that landed with no draft asked for it is never signed: the go key off, even on a complete form
  const unasked = panel(draw(R.sheetPrepared(stateWith({ ticket: ETH, fields: { amount: '25' } }), { prepared, at: NOW, asked: null, deadline: NOW + 125_000 })));
  assert.match(goKey(unasked), /disabled/);
  // and on a form still incomplete, whose own draft is null too: null is never taken for the draft asked
  const incomplete = stateWith({ ticket: ETH });
  assert.equal(askedOf(incomplete.sheet), null);
  const nullNull = R.sheetPrepared(incomplete, { prepared, at: NOW, asked: null, deadline: NOW + 125_000 });
  assert.equal(nullNull.sheet.status, 'ready');
  assert.match(goKey(panel(draw(nullNull))), /disabled/);
  // signing: the go key off, the minutes still counting
  assert.match(goKey(panel(draw(R.sheetSigning(s)))), /disabled/);
  // a fee the order's quote gives is drawn, zero included; a paper order is marked
  const fee = fx('prepared-order');
  fee.quote.order.feeUsd = 0;
  fee.quote.order.paper = true;
  const withFee = panel(draw(ready(stateWith({ ticket: ETH, fields: { amount: '25' } }), fee)));
  assert.match(withFee, /<div class="tk-path">fee \$0\.00<\/div>/);
  assert.match(withFee, /about \$24\.31 <span class="mk-tag">Paper<\/span><\/span>/);
});

test('what the Account said: a refusal as the muted line, Prepare again only when that is the answer; done says what it placed', () => {
  const s = stateWith({ ticket: ETH, fields: { amount: '25' } });
  const again = panel(draw(R.sheetRefused(s, { message: 'The price moved — prepare it again', again: true })));
  assert.match(again, /<p class="tk-msg" role="status">The price moved — prepare it again<\/p>/);
  assert.match(again, /<button type="button" class="btn-sm" data-action="sheetAgain">Prepare again<\/button>/);
  assert.match(goKey(again), /disabled/);
  const no = panel(draw(R.sheetRefused(s, { message: 'Over your cap', again: false })));
  assert.match(no, /<p class="tk-msg" role="status">Over your cap<\/p>/);
  assert.doesNotMatch(no, /Prepare again/);
  const done = panel(draw(R.sheetDone(R.sheetSigning(ready(s)), { said: 'ord-0011 · open on the book' })));
  assert.match(done, /<p class="tk-msg" role="status">ord-0011 · open on the book<\/p>/);
  assert.match(goKey(done), /disabled/);
  assert.match(panel(draw(R.sheetAsking(s, {}))), /<div class="tk-path">Asking…<\/div>/);
});

test('a prediction: its outcomes under the picked row in cents, the picked one pressed; a held one opens as a sell of it', () => {
  const s = stateWith({ kind: 'predictions', ticket: { id: 'event:predict:SI-FEDCUT-DEC', side: 'sell', venue: 'predict', outcome: 0 } });
  const html = draw(s);
  // the picker's held prediction hands on its side, venue and outcome
  assert.match(html, /<button type="button" class="tk-row on" aria-current="true" data-action="pickMarket" data-id="event:predict:SI-FEDCUT-DEC" data-side="sell" data-venue="predict" data-outcome="0">/);
  const p = panel(html);
  assert.match(p, /<h2 class="tk-title">Sell Yes<\/h2>/);
  assert.match(p, /<div class="tk-out"><button type="button" class="mk-yes pressed" aria-pressed="true" data-action="ticketOutcome" data-value="0">Yes 62¢<\/button><button type="button" class="mk-no" aria-pressed="false" data-action="ticketOutcome" data-value="1">No 38¢<\/button><\/div>/);
  assert.match(p, /<option value="qty">Contracts<\/option>/);
  const limit = panel(draw(stateWith({ kind: 'predictions', ticket: { id: 'event:predict:SI-FEDCUT-DEC', side: 'buy', venue: 'predict', outcome: 1 }, fields: { orderType: 'limit' } })));
  assert.match(limit, /<span class="field-label">Limit, in cents<\/span>/);
  assert.match(limit, /<h2 class="tk-title">Buy No<\/h2>/);
  assert.match(limit, /<button type="button" class="mk-no pressed" aria-pressed="true" data-action="ticketOutcome" data-value="1">No 38¢<\/button>/);
});

test('a page that does not sign: the picker and Under way, its device line where the form would be, no Sign and no Cancel', () => {
  for (const role of ['pending', 'needs-code', 'signed-out', 'none']) {
    const html = draw(stateWith({ role, ticket: ETH }));
    const p = panel(html);
    assert.match(p, new RegExp(`<p class="acct-note">${standingWords({ role }).line}</p>`), role);
    assert.doesNotMatch(p, /<form|Sign and place|data-action="ticketField"|data-action="ticketVenue"/, role);
    assert.match(p, /<h2 class="tk-title">Buy ETH<\/h2>/, role);
    assert.match(html, /data-action="pickMarket"/, `${role}: the picker reads`);
    assert.match(html, /<h2 class="tk-h2">Under way<\/h2>/, `${role}: Under way reads`);
    assert.doesNotMatch(html, /data-action="cancelOrder"/, `${role}: Cancel is the owner's`);
  }
  // a standing not known yet: no line, no form
  const unknown = panel(draw(stateWith({ role: 'unknown', ticket: ETH })));
  assert.doesNotMatch(unknown, /<form|Sign and place|acct-note/);
});

test('Under way lists the cards waiting on the owner, each reason · value · answer by with Review → to Cards; no key signs there', () => {
  const card = fx('account').cards[0];
  const by = fmtClock(Date.parse(card.expiresAt));   // the same day as NOW: the clock
  for (const role of ['signs', 'pending']) {
    const html = draw(stateWith({ role }));
    const open = html.match(/<section class="cardbox tk-open">[\s\S]*?<\/section>/)?.[0] ?? '';
    assert.match(open, /<div class="tk-pg-h">Cards waiting<\/div>/, role);
    assert.ok(open.includes(`<tr><td>${card.reason} · $119.99 · answer by ${by}</td><td class="r"><a class="btn-sm" href="#/account/cards">Review →</a></td></tr>`), `${role}: the card's row and its link`);
    assert.equal((open.match(/href="#\/account\/cards"/g) ?? []).length, 1, `${role}: one row, one link`);
    assert.doesNotMatch(open, /approveCard|data-hash|data-card/, `${role}: Cards is where a card is answered`);
  }
  // a page with no cards: nothing added
  const page = { ...fx('account'), cards: [] };
  const none = draw(stateWith({ page }));
  assert.doesNotMatch(none, /Cards waiting|#\/account\/cards/);
  assert.match(none, /<h2 class="tk-h2">Under way<\/h2>/);
});

test('what was said on Trade — a cancel\'s answer, a fill — is a line over Under way', () => {
  const s = stateWith();
  assert.match(draw({ ...s, trade: { ...s.trade, said: 'Bought 0.04 ETH @ 3,120.50 · Stand-in Exchange' } }), /<p class="tk-said" role="status">Bought 0\.04 ETH @ 3,120\.50 · Stand-in Exchange<\/p>/);
  assert.doesNotMatch(draw(s), /tk-said/);
});

test('no CJK, no icon URL, no undefined, NaN or raw JSON; every Account string is escaped', () => {
  const all = fx('explore-all');
  const eth = all.items.find(i => i.key === 'coin:ETH');
  eth.name = '<img src=x onerror=1>';
  eth.base = '<i>ETH</i>';
  eth.at[0].venueName = '<b>Bad Exchange</b>';
  const page = fx('account');
  page.orders[0].symbol = '<script>x</script>';
  const prepared = fx('prepared-order');
  prepared.quote.order.words = 'buy <u>it</u>';
  prepared.shown[0].value = '"><svg>';
  const states = [
    stateWith({ all, page }), ready(stateWith({ all, page, ticket: ETH, fields: { amount: '25' } }), prepared),
    stateWith({ all, page, kind: 'predictions', ticket: { id: 'event:predict:SI-FEDCUT-DEC', side: 'sell', venue: 'predict', outcome: 0 } }),
    stateWith({ role: 'pending', all, page, ticket: ETH }), stateWith({ all, page, kind: 'stocks' }), stateWith({ all, page, kind: 'rwas' }),
  ];
  for (const s of states) {
    const html = draw(s);
    assert.doesNotMatch(html, CJK);
    assert.doesNotMatch(html, /https?:\/\/|\.svg|\.png|<img/i);
    assert.doesNotMatch(html, /undefined|NaN|\[object|\{"/);
    assert.doesNotMatch(html, /<script|<b>Bad|<u>it|<i>ETH|"><svg>/);
  }
  const html = draw(states[1]);
  assert.match(html, /&lt;img src=x onerror=1&gt;/);
  assert.match(html, /&lt;b&gt;Bad Exchange&lt;\/b&gt;/);
  assert.match(html, /buy &lt;u&gt;it&lt;\/u&gt;/);
  assert.match(html, /venue: &quot;&gt;&lt;svg&gt;/);
  assert.match(html, /&lt;script&gt;x&lt;\/script&gt;/);
});
