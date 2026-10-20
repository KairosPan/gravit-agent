// A tool row's result drawn for reading (spec 2026-10-19 §6, the `card` row): alpaca-kit's payloads as tables, tiles and
// a chart; anything unrecognised draws nothing and the row keeps its raw text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolResultHtml } from '../../client/js/render/tool-result.js';

const J = v => JSON.stringify(v);
const cells = h => [...h.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map(m => m[1]);

test('market_snapshot is a table sorted by change, the sign printed', () => {
  const h = toolResultHtml('mcp__alpaca-kit__market_snapshot', J({ ok: true, rows: [
    { symbol: 'AAPL', close: 101, prev_close: 100, volume: 1200 },
    { symbol: 'NVDA', close: 95, prev_close: 100, volume: 5000000 },
    { symbol: 'MSFT', close: 110, prev_close: 100, volume: null },
  ] }));
  assert.match(h, /<table class="viz-table">/);
  assert.match(h, /<th>symbol<\/th><th class="num">close<\/th><th class="num">change<\/th><th class="num">volume<\/th>/);
  assert.deepEqual(cells(h).filter((_, i) => i % 4 === 0), ['MSFT', 'AAPL', 'NVDA'], 'sorted by the change, largest first');
  assert.match(h, /<td class="num up">\+10%<\/td>/); assert.match(h, /<td class="num down">-5%<\/td>/);
  assert.match(h, /<td class="num">5,000,000<\/td>/); assert.match(h, /<td class="num">—<\/td>/);
});

test('daily_bars is a chart', () => {
  const h = toolResultHtml('mcp__alpaca-kit__daily_bars', J({ ok: true, rows: [{ date: '2026-10-16', close: 10 }, { date: '2026-10-17', close: 12 }, { date: '2026-10-18', close: 11 }] }));
  assert.match(h, /<svg class="mk-chart"/);
  assert.match(h, /aria-label="Daily closes from 2026-10-16 to 2026-10-18/);
  const one = toolResultHtml('mcp__alpaca-kit__daily_bars', J({ ok: true, rows: [{ date: '2026-10-16', close: 10 }] }));
  assert.match(one, /<table class="viz-table">/, 'one close is a table, not a chart');
});

test('account tiles read decimal strings', () => {
  const h = toolResultHtml('mcp__alpaca-kit__account', J({ ok: true, equity: '100250.5', cash: '400', buying_power: '0.5', status: 'ACTIVE', unrealized_plpc: '-0.012' }));
  assert.match(h, /class="viz-tiles"/);
  assert.match(h, /viz-tile-label">equity<\/div><div class="viz-tile-value">100,250.5</);
  assert.match(h, /viz-tile-label">buying power<\/div><div class="viz-tile-value">0.5</);
  assert.match(h, /viz-tile-label">status<\/div><div class="viz-tile-value">ACTIVE</);
  assert.match(h, /viz-tile-label">unrealized plpc<\/div><div class="viz-tile-value">-1.2%</);
  const wide = toolResultHtml('mcp__alpaca-kit__breadth', J({ ok: true, ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`k${i}`, i])) }));
  assert.match(wide, /class="viz-kv"/, 'more than eight fields are a key-value list');
  assert.match(toolResultHtml('mcp__alpaca-kit__calendar', J({ ok: true, days: ['2026-10-19', '2026-10-20'] })), /2 trading days[\s\S]*2026-10-19/);
  assert.match(toolResultHtml('mcp__alpaca-kit__positions', J({ ok: true, rows: [] })), /0 rows/);
  const pos = toolResultHtml('mcp__alpaca-kit__positions', J({ ok: true, rows: [{ symbol: 'AAPL', qty: '5', unrealized_pl: -3.5 }] }));
  assert.match(pos, /<td class="sym">AAPL<\/td>/); assert.match(pos, /<td class="num down">-3.5<\/td>/);
});

test('a spilled result draws what parsed, stamped Partial', () => {
  const rows = Array.from({ length: 3 }, (_, i) => ({ symbol: `S${i}`, close: i + 1, prev_close: 1, volume: 1 }));
  const whole = J({ ok: true, rows });
  const cut = whole.slice(0, whole.lastIndexOf('{"symbol":"S2"') + 12) + '\n\n[...]\n\n' + 'tail"}]}\n(Omitted 900 bytes. Full formatted result stored at: /tmp/x.txt)';
  const h = toolResultHtml('mcp__alpaca-kit__market_snapshot', cut);
  assert.match(h, /class="viz-stamp">Partial</);
  assert.deepEqual(cells(h).filter((_, i) => i % 4 === 0).sort(), ['S0', 'S1'], 'the two whole rows, the one cut at the seam dropped');
  const noted = toolResultHtml('mcp__alpaca-kit__account', `${J({ ok: true, equity: '1' })}\n(Omitted 10 bytes. Full formatted result stored at: /tmp/y.txt)`);
  assert.match(noted, /viz-stamp">Partial</);
  assert.doesNotMatch(toolResultHtml('mcp__alpaca-kit__market_snapshot', whole), /Partial/);
});

test("an unknown tool, another server's tool of the same name, an ok:false body or garbage draw nothing", () => {
  const rows = J({ ok: true, rows: [{ symbol: 'A', close: 1, prev_close: 1, volume: 1 }] });
  assert.equal(toolResultHtml('bash', rows), null);
  assert.equal(toolResultHtml('mcp__other__market_snapshot', rows), null);
  assert.equal(toolResultHtml('mcp__alpaca-kit__no_such_tool', rows), null);
  assert.equal(toolResultHtml('mcp__alpaca-kit__market_snapshot', J({ ok: false, error: 'no keys' })), null);
  assert.equal(toolResultHtml('mcp__alpaca-kit__market_snapshot', 'Traceback (most recent call last)'), null);
  assert.equal(toolResultHtml('mcp__alpaca-kit__market_snapshot', J({ ok: true, rows: 'x' })), null);
  assert.equal(toolResultHtml(undefined, rows), null);
  assert.equal(toolResultHtml('mcp__alpaca-kit__account', undefined), null);
});

test('every cell is escaped', () => {
  const bad = '<img src=x onerror=alert(1)>';
  const html = [
    toolResultHtml('mcp__alpaca-kit__market_snapshot', J({ ok: true, rows: [{ symbol: bad, close: 1, prev_close: 1, volume: 1 }] })),
    toolResultHtml('mcp__alpaca-kit__screen', J({ ok: true, rows: [{ [bad]: bad }] })),
    toolResultHtml('mcp__alpaca-kit__account', J({ ok: true, [bad]: bad })),
    toolResultHtml('mcp__alpaca-kit__calendar', J({ ok: true, days: [bad] })),
    toolResultHtml('mcp__alpaca-kit__daily_bars', J({ ok: true, rows: [{ date: bad, close: 1 }, { date: bad, close: 2 }] })),
  ].join('');
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});
