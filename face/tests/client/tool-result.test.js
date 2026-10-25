// A tool row's result (spec 2026-10-19 §6, the `card` row): no server's result is dressed any more, so every row draws the
// call's name and its payload folded under it — an alpaca-kit result in a conversation written before stage 3 included.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolResultHtml, toolResultFor } from '../../client/js/render/tool-result.js';
import { renderMessage } from '../../client/js/render/thread.js';
import { emptyState } from '../../client/js/data/empty.js';

const J = v => JSON.stringify(v);
const conv = { id: 's1', title: 'T', kind: 'gravit', members: ['gravit'], memberSessions: [], channel: null, preset: 'gravit', running: false, live: true, updatedAt: 5, created: null, messages: [], loaded: true, preview: null, usage: null, thinking: null, lastSeen: 0 };
const toolRow = data => ({ id: `t${data.callId}`, seq: 1, at: 1, from: 'gravit', kind: 'tool', text: '', data });

test('an alpaca-kit result from an old session draws as a plain tool result', () => {
  const result = J({ ok: true, rows: [{ date: '2026-10-16', close: 10 }, { date: '2026-10-17', close: 12 }, { date: '2026-10-18', close: 11 }] });
  assert.equal(toolResultHtml('mcp__alpaca-kit__daily_bars', result), null);
  const html = renderMessage(toolRow({ callId: 'c1', name: 'mcp__alpaca-kit__daily_bars', result, isError: false }), conv, emptyState());
  assert.match(html, /^<div class="msg left"/);
  assert.match(html, /<details id="tool-c1" class="tool"><summary><span class="tool-name">mcp__alpaca-kit__daily_bars<\/span><\/summary><pre>\{&quot;ok&quot;:true,&quot;rows&quot;:\[\{&quot;date&quot;:&quot;2026-10-16&quot;/);
  assert.doesNotMatch(html, /<table|<svg|viz|class="raw"/, 'no table, no chart, no Raw fold');
});

test('every tool result takes the plain path: whatever its server, its shape or its health', () => {
  const rows = J({ ok: true, rows: [{ symbol: 'A', close: 1, prev_close: 1, volume: 1 }] });
  for (const name of ['mcp__alpaca-kit__market_snapshot', 'mcp__alpaca-kit__account', 'mcp__alpaca-kit__calendar', 'mcp__account__portfolio_holdings', 'mcp__akshare__stock_zh_a_hist', 'bash', undefined]) {
    assert.equal(toolResultHtml(name, rows), null, String(name));
  }
  assert.equal(toolResultHtml('mcp__alpaca-kit__account', undefined), null);
  assert.equal(toolResultHtml('mcp__alpaca-kit__market_snapshot', 'Traceback (most recent call last)'), null);
});

test('toolResultFor asks per message and answers null for anything', () => {
  assert.equal(toolResultFor(undefined), null);
  assert.equal(toolResultFor({ name: 'mcp__alpaca-kit__account', result: J({ ok: true, equity: '1' }), isError: false }), null);
  assert.equal(toolResultFor({ name: 'mcp__alpaca-kit__account', result: J({ ok: true, equity: '1' }), isError: true }), null);
});
