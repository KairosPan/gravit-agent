// The local path's wire (spec 2026-11-20 §5.6): a key's venue and symbol, a ranking per venue from the market's explore answer, a
// quote, the hits and each venue's provider — over answers in the market's shapes (market/src/reads.ts, market/src/live/local.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LOCAL_VENUES, localKeyOf, isLocalKey, localPairOf, localRankOf, localQuoteOf, localHitsOf, localProviderOf } from '../../client/js/wire/local.js';

const fx = n => JSON.parse(readFileSync(new URL(`../fixtures/account/${n}.json`, import.meta.url), 'utf8'));
const NOW = Date.parse('2026-11-21T02:31:00Z');
const read = (venue, region, sort = 'volume', over = {}) => ({
  venue, region, sort, total: 3, asOf: '2026-11-21T02:30:00.000Z', session: { phase: 'trading', lastSession: '2026-11-20' },
  status: { state: 'live', said: `${venue} answering`, at: '2026-11-21T02:30:00.000Z' }, note: '', ...over,
});
const share = (venue, code, over = {}) => ({
  key: `${venue}:${code}`, kind: 'share', name: `Co ${code}`, base: code, currency: { hk: 'HKD', kr: 'KRW', tw: 'TWD' }[venue],
  asset: 'stocks', form: 'spot', region: venue, price: 100, changePct24h: 1.5, turnoverLocal: 2e9, quoteFrom: 'Src', tabs: [], at: [], ...over,
});
const index = (region, id, over = {}) => ({
  key: `ix:${region}:${id}`, kind: 'index', name: `Index ${id}`, base: id, asset: 'indices', form: 'spot', region,
  price: 38000.5, change24h: -120.25, changePct24h: -0.32, quoteFrom: 'Naver · 15 min delayed', tabs: [], at: [], ...over,
});
const answer = (items, local, over = {}) => ({ ok: true, asOf: local.asOf, tabs: [], items, movers: [], closing: [], mostTraded: [], missing: [], notes: [], local, ...over });
export const RANK_QUERY = (asset, region, sort = 'volume') => `asset=${asset}&form=spot&region=${region}&sort=${sort}&limit=20`;

test('localKeyOf: every venue, and the keys it refuses', () => {
  assert.deepEqual(LOCAL_VENUES, ['china', 'hk', 'kr', 'tw', 'ix']);
  assert.deepEqual(localKeyOf('cn:600519'), { venue: 'china', symbol: '600519' });
  assert.deepEqual(localKeyOf('hk:00700'), { venue: 'hk', symbol: '00700' });
  assert.deepEqual(localKeyOf('kr:005930'), { venue: 'kr', symbol: '005930' });
  assert.deepEqual(localKeyOf('kr:0126Z0'), { venue: 'kr', symbol: '0126Z0' }, 'a Korean code with a letter');
  assert.deepEqual(localKeyOf('tw:2330'), { venue: 'tw', symbol: '2330' });
  assert.deepEqual(localKeyOf('tw:2881A'), { venue: 'tw', symbol: '2881A' });
  assert.deepEqual(localKeyOf('ix:jp:n225'), { venue: 'ix', symbol: 'jp:n225' });
  assert.deepEqual(localKeyOf('ix:eu:dax'), { venue: 'ix', symbol: 'eu:dax' });
  for (const bad of ['hk:700', 'ix:n225', 'ix:xx:n225', 'cn:60051', 'kr:5930', 'tw:23', 'stock:AAPL', 'coin:BTC', '', null, 5]) {
    assert.equal(localKeyOf(bad), null, String(bad));
    assert.equal(isLocalKey(bad), false);
  }
  assert.equal(localPairOf('hk:00700'), 'hk|00700');
  assert.equal(localPairOf('ix:jp:n225'), 'ix|jp:n225');
  assert.equal(localPairOf('cn:600519'), 'china|600519');
  assert.equal(localPairOf('hk:700'), null);
});

test('localRankOf: a ranking per venue, kept with the query it was read for', () => {
  const hkQuery = RANK_QUERY('stocks', 'hk');
  const hk = localRankOf(answer([share('hk', '00700', { name: 'Tencent', nameLocal: '騰訊控股' }), share('kr', '005930')], read('hk', 'hk')), hkQuery);
  assert.equal(hk.venue, 'hk');
  assert.equal(hk.query, hkQuery);
  assert.equal(hk.sort, 'volume');
  assert.equal(hk.stale, false);
  assert.deepEqual(hk.items, [{ id: 'hk:00700', symbol: '00700', name: 'Tencent', price: 100, change_pct: 1.5, kind: 'share', turnover: 2e9, currency: 'HKD', name_local: '騰訊控股', quote_from: 'Src' }],
    "the venue's own keys alone");
  const kr = localRankOf(answer([share('kr', '005930')], read('kr', 'kr', 'movers')), RANK_QUERY('stocks', 'kr', 'movers'));
  assert.deepEqual(kr.items.map(i => [i.id, i.currency]), [['kr:005930', 'KRW']]);
  const tw = localRankOf(answer([share('tw', '2330')], read('tw', 'tw')), RANK_QUERY('stocks', 'tw'));
  assert.deepEqual(tw.items.map(i => [i.id, i.currency, i.turnover]), [['tw:2330', 'TWD', 2e9]]);
  const ix = localRankOf(answer([index('eu', 'dax'), index('eu', 'cac')], read('ix', 'eu')), RANK_QUERY('indices', 'eu'));
  assert.deepEqual(ix.items[0], { id: 'ix:eu:dax', symbol: 'dax', name: 'Index dax', price: 38000.5, change_pct: -0.32, kind: 'index', change: -120.25, quote_from: 'Naver · 15 min delayed' });
  assert.equal(ix.venue, 'ix');
  // China's answer, its read under `china` (and `local` too, on the market today)
  const china = localRankOf(fx('explore-china'), RANK_QUERY('stocks', 'cn'));
  assert.deepEqual(china.items[0], { id: 'cn:600519', symbol: '600519', name: '贵州茅台', price: 1392.05, change_pct: 2.81, turnover: 21610000000 });
  // an answer for another venue or another sort than the query's is no ranking
  assert.equal(localRankOf(answer([share('hk', '00700')], read('hk', 'hk')), RANK_QUERY('stocks', 'kr')), null);
  assert.equal(localRankOf(answer([share('hk', '00700')], read('hk', 'hk')), RANK_QUERY('stocks', 'hk', 'movers')), null);
  assert.equal(localRankOf({ ok: true, items: [] }, hkQuery), null, 'no read');
  assert.equal(localRankOf(answer([], read('hk', 'hk')), 'asset=stocks&region=jp&sort=volume'), null, 'no local venue');
  assert.equal(localRankOf(answer([share('hk', '00700')], read('hk', 'hk', 'volume', { status: { state: 'stale', said: 'last good' } })), hkQuery).stale, true);
  assert.equal(localRankOf({ ...answer([], read('hk', 'hk')), stale: true }, hkQuery).stale, true);
});

test('localQuoteOf: a share, an index and an A share; a refusal is none', () => {
  const facts = { prevClose: 395, open: 396, high: 402, low: 394, volume: 1.2e7, turnover: 4.8e9, lastSession: '2026-11-20', phase: 'trading', quoteStatus: 'delayed' };
  const hk = localQuoteOf({ venue: 'hk', symbol: '00700', market: { symbol: '00700', name: 'Tencent', price: 400, change24h: 5, changePct24h: 1.27, quoteAt: '2026-11-21T02:30:00Z', quoteFrom: 'Tencent', currency: 'HKD', local: facts } }, NOW);
  assert.deepEqual(hk, {
    id: 'hk:00700', market: 'hk', symbol: '00700', name: 'Tencent', price: 400, prev_close: 395, change: 5, change_pct: 1.27, volume: 1.2e7,
    as_of: '2026-11-21T02:30:00Z', received_at: '2026-11-21T02:31:00.000Z', volume_as_of: '2026-11-21T02:30:00Z', source: 'Tencent', feed: '',
    basis: 'previous_close', quote_status: 'delayed', market_status: 'open', message: '', last_session: '2026-11-20', open: 396, high: 402, low: 394,
    turnover: 4.8e9, currency: 'HKD',
  });
  const ix = localQuoteOf({ venue: 'ix', symbol: 'jp:n225', market: { symbol: 'jp:n225', name: 'Nikkei 225', price: 38000, quoteFrom: 'Naver · 15 min delayed', local: { ...facts, quoteStatus: 'unsaid', phase: 'closed' } } }, NOW);
  assert.equal(ix.id, 'ix:jp:n225');
  assert.equal(ix.currency, null, 'an index has no currency');
  assert.equal(ix.source, 'Naver · 15 min delayed');
  assert.equal(ix.quote_status, 'unsaid', 'a delay never claimed');
  assert.equal(ix.market_status, 'closed');
  const [moutai, , refused] = fx('quotes-china').quotes;
  assert.equal(localQuoteOf(moutai, NOW).id, 'cn:600519');
  assert.equal(localQuoteOf(moutai, NOW).pe_ttm, 20.5);
  assert.equal(localQuoteOf(refused, NOW), null);
  assert.equal(localQuoteOf({ venue: 'hk', symbol: '700', market: { price: 1 } }, NOW), null, 'a key no venue writes');
  assert.equal(localQuoteOf({ venue: 'hk', symbol: '00700', refusal: { message: 'no' } }, NOW), null);
});

test('localHitsOf: every local key, with its price', () => {
  const { hits, quotes } = localHitsOf({ ok: true, items: [share('hk', '00700', { nameLocal: '騰訊控股' }), { key: 'stock:AAPL', price: 1 }, ...fx('explore-search-china').items.filter(i => i.key === 'cn:600519')] });
  assert.deepEqual(hits.map(h => [h.id, h.venue]), [['hk:00700', 'hk'], ['cn:600519', 'china']]);
  assert.equal(hits[0].nameLocal, '騰訊控股');
  assert.deepEqual(quotes['hk:00700'], { price: 100, change_pct: 1.5 });
  assert.deepEqual(localHitsOf(null), { hits: [], quotes: {} });
});

test('localProviderOf: one provider a venue', () => {
  assert.deepEqual(localProviderOf('hk', { state: 'live', said: 'ok' }), [{ id: 'tencent', market: 'hk', status: 'connected', said: 'ok' }]);
  assert.deepEqual(localProviderOf('kr', { state: 'stale', said: '' }), [{ id: 'naver', market: 'kr', status: 'limited', said: '' }]);
  assert.deepEqual(localProviderOf('tw', { state: 'unavailable', said: 'x', notAnswering: true }), [{ id: 'twse', market: 'tw', status: 'error', said: 'x', notAnswering: true }]);
  assert.deepEqual(localProviderOf('ix', { state: 'live', said: '' })[0].id, 'indices');
  assert.deepEqual(localProviderOf('china', { state: 'live', said: '' })[0].market, 'cn');
  assert.deepEqual(localProviderOf('jp', { state: 'live' }), []);
  assert.deepEqual(localProviderOf('hk', null), []);
});
