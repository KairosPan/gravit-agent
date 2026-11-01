// The Market half's three sheets (plan 4a Task 3): Close (Sell), Change and Leverage — each the Account's own draft for its
// type (liveClose, liveAmend, liveLeverage: account/src/portfolio/public/ui/trade.js openClose, openAmend and the ticket's
// leverage editor), nothing added and nothing renamed — or, while the form is not complete, the words for what is missing; and
// each kind's seed from the rows the screens draw, the stand-in's page saying which venue changes and sets leverage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MARKET_KINDS, marketTitleOf, marketGoOf, marketFieldsOf, marketDraftOf, amendSeedOf, closeSeedOf, leverageSeedOf, marketLeverageSeedOf,
} from '../../client/js/host/sheet-market.js';
import { positionsOf, openOrdersOf } from '../../client/js/host/account-view.js';

const fx = name => JSON.parse(readFileSync(new URL(`../fixtures/account/${name}.json`, import.meta.url), 'utf8'));
const set = (fields, values) => fields.map(f => (Object.hasOwn(values, f.name) ? { ...f, value: values[f.name] } : f));

const PERP = { venue: 'ex', symbol: 'BTC/USDT:USDT', name: 'BTC perpetual', side: 'long', qty: '0.01', kind: 'perp' };

test('MARKET_KINDS: close, amend and leverage', () => {
  assert.deepEqual(MARKET_KINDS, ['close', 'amend', 'leverage']);
  assert.equal(marketTitleOf('nonsense', {}), '');
  assert.equal(marketGoOf('nonsense', {}), '');
  assert.deepEqual(marketFieldsOf('nonsense', {}), []);
  assert.equal(marketDraftOf('nonsense', {}, {}), 'Nothing to sign here');
});

test("close drafts the Account's liveClose", () => {
  assert.equal(marketTitleOf('close', PERP), 'Close BTC perpetual');
  assert.equal(marketGoOf('close', PERP), 'Sign and close');
  const fields = marketFieldsOf('close', PERP);
  assert.deepEqual(fields, [{ name: 'qty', label: 'How much', type: 'number', placeholder: 'All 0.01', value: '' }]);
  assert.deepEqual(marketDraftOf('close', fields, PERP), { type: 'liveClose', venue: 'ex', symbol: 'BTC/USDT:USDT', qty: '' }, 'blank: all of it');
  assert.deepEqual(marketDraftOf('close', set(fields, { qty: '0.5' }), PERP), { type: 'liveClose', venue: 'ex', symbol: 'BTC/USDT:USDT', qty: '0.5' });
  assert.deepEqual(marketDraftOf('close', { qty: ' 0.005 ' }, PERP).qty, '0.005', 'trimmed');
  for (const qty of ['abc', '0', '-1', '1e3']) assert.equal(marketDraftOf('close', { qty }, PERP), 'Type how much, or leave it empty for all of it', qty);
  assert.equal(marketDraftOf('close', {}, { ...PERP, venue: '' }), 'No position to close');
});

test('close is Sell for a stock and an event', () => {
  for (const kind of ['stock', 'event']) {
    const seed = { ...PERP, kind, name: 'Thing' };
    assert.equal(marketTitleOf('close', seed), 'Sell Thing', kind);
    assert.equal(marketGoOf('close', seed), 'Sign and sell', kind);
  }
  assert.equal(marketTitleOf('close', { ...PERP, kind: 'spot' }), 'Close BTC perpetual');
});

const EVENT_LIMIT = { venue: 'predict', order: 'ord-0020', type: 'limit', kind: 'event', qty: '50', limitPrice: '0.6', stopPrice: '', side: 'buy', base: 'SI-FEDCUT-DEC:YES' };

test("amend keeps what is blank and converts an event's cents", () => {
  assert.equal(marketTitleOf('amend', EVENT_LIMIT), 'Change ord-0020');
  assert.equal(marketGoOf('amend', EVENT_LIMIT), 'Sign and change');
  const fields = marketFieldsOf('amend', EVENT_LIMIT);
  assert.deepEqual(fields.map(f => [f.name, f.label, f.placeholder]), [['qty', 'Size', '50'], ['limitPrice', 'Limit, in cents', '60']], "the order's own, its price in cents");
  assert.deepEqual(marketDraftOf('amend', set(fields, { limitPrice: '62' }), EVENT_LIMIT),
    { type: 'liveAmend', venue: 'predict', order: 'ord-0020', qty: '', limitPrice: '0.62', stopPrice: '' });
  assert.equal(marketDraftOf('amend', fields, EVENT_LIMIT), 'Type what changes');
  assert.equal(marketDraftOf('amend', { limitPrice: '100' }, EVENT_LIMIT), 'A price in cents is between 0 and 100');
  assert.deepEqual(marketDraftOf('amend', { qty: '40' }, EVENT_LIMIT), { type: 'liveAmend', venue: 'predict', order: 'ord-0020', qty: '40', limitPrice: '', stopPrice: '' });
  // a market that is not an event: its prices as typed
  const spot = { ...EVENT_LIMIT, venue: 'ex', order: 'ord-0010', kind: 'spot', limitPrice: '141.44' };
  assert.equal(marketFieldsOf('amend', spot)[1].label, 'Limit price');
  assert.equal(marketFieldsOf('amend', spot)[1].placeholder, '141.44');
  assert.deepEqual(marketDraftOf('amend', { limitPrice: ' 140 ' }, spot), { type: 'liveAmend', venue: 'ex', order: 'ord-0010', qty: '', limitPrice: '140', stopPrice: '' });
  assert.equal(marketDraftOf('amend', { qty: '1' }, { ...spot, order: '' }), 'No order to change');
});

test('amend draws only the fields its type has', () => {
  const names = type => marketFieldsOf('amend', { ...EVENT_LIMIT, kind: 'spot', type }).map(f => f.name);
  assert.deepEqual(names('market'), ['qty']);
  assert.deepEqual(names('limit'), ['qty', 'limitPrice']);
  assert.deepEqual(names('stop'), ['qty', 'stopPrice']);
  assert.deepEqual(names('stop_limit'), ['qty', 'limitPrice', 'stopPrice']);
  assert.deepEqual(marketFieldsOf('amend', { ...EVENT_LIMIT, type: 'stop_limit' }).map(f => f.label), ['Size', 'Limit, in cents', 'Stop, in cents']);
  // a price typed into a field the type does not have is not sent
  assert.deepEqual(marketDraftOf('amend', { qty: '1', stopPrice: '5' }, { ...EVENT_LIMIT, kind: 'spot', type: 'limit' }).stopPrice, '');
  assert.deepEqual(marketDraftOf('amend', { stopPrice: '30' }, { ...EVENT_LIMIT, type: 'stop' }),
    { type: 'liveAmend', venue: 'predict', order: 'ord-0020', qty: '', limitPrice: '', stopPrice: '0.3' });
});

test('leverage refuses a fraction and keeps the margin mode blank by default', () => {
  const seed = { venue: 'ex', venueName: 'Stand-in Exchange', symbol: 'BTC/USDT:USDT', name: 'BTC perpetual', leverage: '3' };
  assert.equal(marketTitleOf('leverage', seed), 'Leverage · BTC perpetual');
  assert.equal(marketGoOf('leverage', seed), 'Sign leverage');
  const fields = marketFieldsOf('leverage', seed);
  assert.deepEqual(fields, [
    { name: 'leverage', label: 'Leverage', type: 'number', placeholder: '3', value: '' },
    { name: 'marginMode', label: 'Margin', type: 'select', options: [{ value: '', label: 'Keep it' }, { value: 'cross', label: 'Cross' }, { value: 'isolated', label: 'Isolated' }], value: '' },
  ]);
  assert.equal(marketFieldsOf('leverage', { ...seed, leverage: '' })[0].placeholder, '1', 'none held: 1');
  for (const leverage of ['2.5', '', '0', '1000', 'x']) assert.equal(marketDraftOf('leverage', { leverage }, seed), 'Leverage is a whole number, 1 or more', leverage);
  assert.deepEqual(marketDraftOf('leverage', set(fields, { leverage: '5' }), seed), { type: 'liveLeverage', venue: 'ex', symbol: 'BTC/USDT:USDT', leverage: '5', marginMode: '' });
  assert.equal(marketDraftOf('leverage', { leverage: '5', marginMode: 'cross' }, seed).marginMode, 'cross');
  assert.equal(marketDraftOf('leverage', { leverage: '5', marginMode: 'portfolio' }, seed).marginMode, '', 'only the modes offered');
});

test("the seeds from the stand-in's rows: Change on a resting order at a venue that amends, Leverage on a perpetual where its venue sets it", () => {
  const page = fx('account');
  const orders = openOrdersOf(page);
  assert.deepEqual(orders.map(o => [o.id, amendSeedOf(o, page) !== null]),
    [['ord-0010', true], ['ord-0009', false], ['ord-0004', true], ['ord-0003', true], ['ord-0002', true]], "the broker changes nothing in place");
  assert.deepEqual(amendSeedOf(orders[2], page), { venue: 'ex', order: 'ord-0004', type: 'stop', kind: 'spot', qty: '0.6', limitPrice: '', stopPrice: '137.83', side: 'sell', base: 'SOL' });
  assert.equal(amendSeedOf({ ...orders[0], type: 'market' }, page), null, 'a market order does not rest');
  assert.equal(amendSeedOf({ ...orders[0], id: '' }, page), null);
  const positions = positionsOf(fx('holdings'));
  assert.deepEqual(closeSeedOf(positions[0]), { venue: 'ex', symbol: 'BTC/USDT:USDT', name: 'BTC perpetual', side: 'long', qty: '0.01', kind: 'perp' });
  assert.equal(closeSeedOf(positions[2]).kind, 'event');
  assert.deepEqual(leverageSeedOf(positions[0], page), { venue: 'ex', venueName: 'Stand-in Exchange', symbol: 'BTC/USDT:USDT', name: 'BTC perpetual', leverage: '3' });
  assert.equal(leverageSeedOf(positions[2], page), null, 'an event is no perpetual');
  assert.equal(leverageSeedOf({ ...positions[0], venue: 'broker' }, page), null, 'the broker sets no leverage');
  // a perpetual's page: its first connected line whose venue sets leverage, with the leverage held there
  const legs = [{ venue: 'broker', symbol: 'X', connected: true }, { venue: 'ex', venueName: 'Stand-in Exchange', symbol: 'BTC/USDT:USDT', connected: true }];
  assert.deepEqual(marketLeverageSeedOf({ kind: 'perp', name: 'BTC perpetual' }, legs, positions, page),
    { venue: 'ex', venueName: 'Stand-in Exchange', symbol: 'BTC/USDT:USDT', name: 'BTC perpetual', leverage: '3' });
  assert.equal(marketLeverageSeedOf({ kind: 'spot' }, legs, positions, page), null);
  assert.equal(marketLeverageSeedOf({ kind: 'perp' }, [{ ...legs[1], connected: false }], positions, page), null, 'a public listing only');
});
