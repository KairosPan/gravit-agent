// face/tests/client/market-fmt.test.js — a quote's change as the Markets screen and a market's page print it
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fmt from '../../client/js/market-fmt.js';

test('a change: an arrow and words for screen readers; one decimal from 1%, two under; flat at zero or nothing', () => {
  const { chgHtml } = fmt;
  assert.equal(chgHtml(1.2), '<span class="up"><span aria-hidden="true">▲</span><span class="sr-only">up</span> 1.2%</span>');
  assert.equal(chgHtml(-0.4), '<span class="down"><span aria-hidden="true">▼</span><span class="sr-only">down</span> 0.40%</span>');
  assert.equal(chgHtml(0), '<span class="flat">0.00%</span>');
  assert.equal(chgHtml(null), '<span class="flat">—</span>');
  assert.equal(chgHtml(NaN), '<span class="flat">—</span>');
});

test('only what the screens import stays: the stand-in prices, cents, volumes and countdowns left with Trade', () => {
  assert.deepEqual(Object.keys(fmt).sort(), ['chgHtml', 'localAmount', 'localPrice']);
});

test('a local price in its currency: HK$ and NT$ to two places, the won with none, the yuan as ever; an index level bare', () => {
  const { localPrice } = fmt;
  assert.equal(localPrice(400, 'HKD'), 'HK$400.00');
  assert.equal(localPrice(71500, 'KRW'), '₩71,500');
  assert.equal(localPrice(71500.6, 'KRW'), '₩71,501');
  assert.equal(localPrice(1025, 'TWD'), 'NT$1,025.00');
  assert.equal(localPrice(1392.05, 'CNY'), '¥1,392.05');
  assert.equal(localPrice(18000.5, null), '18,000.50', 'an index level in points, no currency sign');
  assert.equal(localPrice(-3.2, 'HKD'), '-HK$3.20');
  assert.equal(localPrice(null, 'HKD'), '—');
  assert.equal(localPrice(NaN, 'KRW'), '—');
});

test('a local amount, compact, in its currency: a turnover of billions or trillions', () => {
  const { localAmount } = fmt;
  assert.equal(localAmount(4.8e9, 'HKD'), 'HK$4.8B');
  assert.equal(localAmount(1.23e12, 'KRW'), '₩1.2T');
  assert.equal(localAmount(35.1e9, 'TWD'), 'NT$35.1B');
  assert.equal(localAmount(820e6, 'HKD'), 'HK$820M');
  assert.equal(localAmount(999_960, 'TWD'), 'NT$1M');
  assert.equal(localAmount(5e9, null), '5B');
  assert.equal(localAmount(null, 'HKD'), '—');
});
