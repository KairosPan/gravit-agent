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
  assert.deepEqual(Object.keys(fmt), ['chgHtml']);
});
