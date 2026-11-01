import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHINA_VENUE, isCnKey, chinaPairOf, rankOf, cnQuoteOf, cnHitsOf, chinaProviderOf } from '../../client/js/wire/china.js';

const fx = n => JSON.parse(readFileSync(new URL(`../fixtures/account/${n}.json`, import.meta.url), 'utf8'));
const NOW = Date.parse('2026-10-31T02:31:00Z');

test('keys and pairs', () => {
  assert.equal(CHINA_VENUE, 'china');
  assert.equal(isCnKey('cn:600519'), true);
  for (const bad of ['cn:60051', 'us:AAPL', 'cn:60051a', '600519', null, 5]) assert.equal(isCnKey(bad), false);
  assert.equal(chinaPairOf('cn:688981'), 'china|688981');
  assert.equal(chinaPairOf('us:AAPL'), null);
});

test('rankOf: the ranking in the shape chinaRowsOf reads', () => {
  const body = fx('explore-china');
  const r = rankOf(body, 'volume');
  assert.equal(r.ok, true);
  assert.equal(r.total, 5577);
  assert.equal(r.sort, 'volume');
  assert.equal(r.stale, false);
  assert.deepEqual(r.session, { phase: 'closed', lastSession: '2026-10-30' });
  assert.equal(r.status.state, 'live');
  assert.deepEqual(r.items[0], { id: 'cn:600519', symbol: '600519', name: '贵州茅台', price: 1392.05, change_pct: 2.81, turnover: 21610000000 });
  assert.equal(r.items.length, 3);
  assert.equal(rankOf(body, 'movers'), null);
  assert.equal(rankOf({ ...body, stale: true }, 'volume').stale, true);
  assert.equal(rankOf({ ok: false }, 'volume'), null);
  assert.equal(rankOf(null, 'volume'), null);
  assert.equal(rankOf(fx('explore-all'), 'volume'), null);
});

test('rankOf: the Account\'s own stale ranking is stale', () => {
  const body = fx('explore-china');
  const stale = { ...body, china: { ...body.china, status: { state: 'stale', said: 'Tencent is slow: the last good ranking', at: '2026-10-31T02:20:00.000Z' } } };
  const r = rankOf(stale, 'volume');
  assert.equal(r.stale, true);
  assert.equal(r.status.state, 'stale');
  assert.equal(rankOf(body, 'volume').stale, false);
});

test('cnQuoteOf: the twelve facts, the phase and the status', () => {
  const [moutai, , refused] = fx('quotes-china').quotes;
  const q = cnQuoteOf(moutai, NOW);
  assert.deepEqual(q, {
    id: 'cn:600519', market: 'cn', symbol: '600519', name: '贵州茅台', price: 1392.05, prev_close: 1354, change: 38.05, change_pct: 2.81,
    volume: 2161000, as_of: '2026-10-30T15:00:03+08:00', received_at: '2026-10-31T02:31:00.000Z', volume_as_of: '2026-10-30T15:00:03+08:00',
    source: 'Tencent', feed: '', basis: 'previous_close', quote_status: 'live', market_status: 'closed', message: '', last_session: '2026-10-30',
    open: 1363, high: 1399.9, low: 1360.1, turnover: 21610000000, turnover_rate: 0.17, market_cap: 1.74e12, pe_ttm: 20.5,
    limit_up: 1489.4, limit_down: 1218.6, amplitude: 2.4,
  });
  assert.equal(cnQuoteOf(refused, NOW), null);
  const phase = (phase, quoteStatus) => cnQuoteOf({ ...moutai, market: { ...moutai.market, cn: { ...moutai.market.cn, phase, quoteStatus } } }, NOW);
  assert.equal(phase('trading', 'delayed').market_status, 'open');
  assert.equal(phase('trading', 'delayed').quote_status, 'delayed');
  assert.equal(phase('midday', 'live').market_status, 'midday');
  assert.equal(cnQuoteOf({ venue: 'china', symbol: '600519' }, NOW), null);
});

test('cnHitsOf: only the A shares, a STAR share included', () => {
  const { assets, quotes } = cnHitsOf(fx('explore-search-china'));
  assert.deepEqual(assets.map(a => a.id), ['cn:600519', 'cn:688981', 'cn:300750']);
  assert.deepEqual(assets[1], { id: 'cn:688981', market: 'cn', symbol: '688981', name: '中芯国际', exchange: '', currency: 'CNY' });
  assert.deepEqual(quotes['cn:688981'], { price: 98.6, change_pct: -0.4 });
  assert.deepEqual(cnHitsOf({ ok: false }), { assets: [], quotes: {} });
});

test('chinaProviderOf: the source state as a provider', () => {
  assert.deepEqual(chinaProviderOf({ state: 'stale', said: 'x' })[0], { id: 'tencent', market: 'cn', status: 'limited', said: 'x' });
  assert.equal(chinaProviderOf({ state: 'live', said: 'y' })[0].status, 'connected');
  assert.equal(chinaProviderOf({ state: 'unavailable', said: 'z' })[0].status, 'error');
  assert.deepEqual(chinaProviderOf(null), []);
  assert.deepEqual(chinaProviderOf({ state: 'nope', said: '' }), []);
});

test('the candle fixtures carry the Account\'s China history shapes', () => {
  const d = fx('candles-china-1d'), m = fx('candles-china-1m');
  assert.equal(d.sessions[0].date, '2026-10-30');
  assert.equal(m.candles.length, 2);
  assert.equal(m.venue, 'china');
});
