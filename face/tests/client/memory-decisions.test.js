// The Memory screen's Decisions tab (memory screen plan Task 4, render/memory-decisions.js) over states built with the real
// reducers: the decisions in the order given, under their symbol's head while no symbol is typed; each one's date, whose and
// by, action, thesis, wrong if, what followed, marks and void command; a void one struck; the owner's words; the symbol box;
// older decisions not shown; none; and text from the memory made visible and escaped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { renderMemoryScreen } from '../../client/js/render/memory-page.js';
import { decisionsHtml } from '../../client/js/render/memory-decisions.js';
import { withTable } from '../../client/js/i18n/words.js';
import { ZH } from '../../client/js/i18n/zh.js';
import { memoryDecisions, memoryDecisionRows, decisionRow } from './helpers/memory-page.js';

const NOW = Date.parse('2026-11-16T15:00:00.000Z');
const on = R.nav(emptyState(), { screen: 'memory', tab: 'decisions' });
const loaded = (data, st = on) => R.memoryPageLoaded(st, { read: 'decisions', data, at: NOW });
const draw = (data, st = loaded(data)) => decisionsHtml(st.memoryPage.decisions.data, st.memoryPage, NOW);
const count = (html, needle) => html.split(needle).length - 1;
const text = html => html.replace(/<[^>]*>/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const articles = html => [...html.matchAll(/<article class="mp-decision[^"]*">([\s\S]*?)<\/article>/g)].map(m => m[0]);

test('the body is an mp-body; the decisions are drawn in the order given, under their symbol, one with none under No symbol', () => {
  const html = draw(memoryDecisions({ items: memoryDecisionRows() }));
  assert.match(html, /^<div class="mp-body mp-decisions">/);
  const heads = [...html.matchAll(/<h2 class="mp-group-head">([^<]*)<\/h2>/g)].map(m => m[1]);
  assert.deepEqual(heads, ['NVDA', 'AMD', 'No symbol'], 'each symbol once, in the order it is first met');
  const order = ['d-20261114-0a1b2c3d', 'd-20261112-2c3d4e5f', 'd-20261113-1b2c3d4e', 'd-20261111-3d4e5f6a'];
  const at = order.map(id => html.indexOf(`<span class="mp-id">${id}</span>`));
  assert.ok(at.every(i => i > 0) && at.every((i, n) => n === 0 || i > at[n - 1]), 'newest first within a symbol');
  const nvda = html.slice(html.indexOf('>NVDA</h2>'), html.indexOf('>AMD</h2>'));
  assert.equal(count(nvda, '<article'), 2);
});

test("an owner's decision: its date, owner · by gravit-face, its action, its thesis in quotes, wrong if, what followed, Open, its void command", () => {
  const [first] = articles(draw(memoryDecisions({ items: memoryDecisionRows() })));
  const words = text(first);
  assert.match(first, /<span class="mp-when">Nov 14<\/span>/);
  assert.ok(words.includes('owner · by gravit-face'), words);
  assert.match(first, /<span class="mp-action">buy<\/span>/);
  assert.ok(words.includes('“The data-centre outlook was raised”'));
  assert.ok(words.includes('wrong if: it closes under the gap'));
  assert.match(first, /<li>after 5 sessions \+3\.20% \(\+1\.10% against the benchmark\)<\/li>/);
  assert.match(first, /<li>after 20 sessions -0\.40%<\/li>/);
  assert.doesNotMatch(first, /after 60 sessions/, 'a horizon not measured is not drawn');
  assert.match(first, /<span class="chip live">Open<\/span>/);
  assert.match(first, /At the terminal/);
  assert.match(first, /<code class="mp-command">npx --no gravit-memory void d-20261114-0a1b2c3d --reason &quot;…&quot; --home \/srv\/owner\/memory<\/code>/);
});

test("an owner's words are drawn in quotes under In your words; a decision with none has neither", () => {
  const [first, , , last] = articles(draw(memoryDecisions({ items: memoryDecisionRows() })));
  assert.match(first, /<div class="mp-dim">In your words<\/div><div class="mp-words">“I buy the gap, small”<\/div>/);
  assert.doesNotMatch(last, /In your words/);
  assert.doesNotMatch(last, /wrong if:/, 'no wrong if: none drawn');
});

test("an agent's reviewed decision and a backfilled one: agent · by gravit, their marks", () => {
  const [, , amd, hold] = articles(draw(memoryDecisions({ items: memoryDecisionRows() })));
  assert.ok(text(amd).includes('agent · by gravit'));
  assert.match(amd, /<span class="chip ok">Reviewed<\/span>/);
  assert.doesNotMatch(amd, /chip live/);
  assert.match(hold, /<span class="chip grey">Backfilled<\/span>/);
  assert.match(hold, /<span class="mp-when">Nov 11<\/span>/);
});

test('a void decision is drawn struck with Void and carries no command', () => {
  const html = draw(memoryDecisions({ items: memoryDecisionRows() }));
  const voided = articles(html).find(a => a.includes('d-20261112-2c3d4e5f'));
  assert.match(voided, /^<article class="mp-decision void">/);
  assert.match(voided, /<span class="chip down">Void<\/span>/);
  assert.doesNotMatch(voided, /mp-command/);
  assert.doesNotMatch(voided, /At the terminal/);
  assert.equal(count(html, 'class="mp-decision void"'), 1);
});

test('the symbol box: an input dispatching memoryPageSymbol, its value the slice\'s; typed, the decisions are still under their symbol', () => {
  const html = draw(memoryDecisions({ items: memoryDecisionRows() }));
  assert.match(html, /<input id="mp-symbol" class="input mp-symbol" type="search" autocomplete="off" placeholder="Symbol" data-action="memoryPageSymbol" value="">/);
  assert.match(html, /<label for="mp-symbol" class="sr-only">Filter by symbol<\/label>/);
  const st = loaded(memoryDecisions({ items: memoryDecisionRows().filter(r => r.view.line.symbol === 'NVDA') }), R.memoryPageSymbol(on, { symbol: 'NVDA' }));
  const flat = draw(null, st);
  assert.match(flat, /data-action="memoryPageSymbol" value="NVDA"/);
  assert.deepEqual([...flat.matchAll(/<h2 class="mp-group-head">([^<]*)<\/h2>/g)].map(m => m[1]), ['NVDA'], 'the head drawn while a symbol is typed');
  assert.equal(articles(flat).length, 2);
  const kept = draw(null, R.memoryPageSymbol(loaded(memoryDecisions({ items: memoryDecisionRows() })), { symbol: 'NVDA' }));
  assert.deepEqual([...kept.matchAll(/<h2 class="mp-group-head">([^<]*)<\/h2>/g)].map(m => m[1]), ['NVDA', 'AMD', 'No symbol'], 'decisions kept from another filter each under their own symbol');
  const odd = draw(null, R.memoryPageSymbol(loaded(memoryDecisions()), { symbol: '"><b>' }));
  assert.match(odd, /value="&quot;&gt;&lt;b&gt;"/, 'the value escaped');
});

test('more: Show older from the last decision; its id not plain: Older decisions are not shown; no more: neither', () => {
  const more = draw(memoryDecisions({ items: memoryDecisionRows(), more: true }));
  assert.match(more, /<div class="mp-record"><button type="button" class="btn-sm" data-action="memoryPageOlder" data-id="d-20261111-3d4e5f6a">Show older<\/button><\/div><\/div>$/);
  assert.doesNotMatch(more, /Older decisions are not shown|Back to the newest/);
  const odd = draw(memoryDecisions({ items: [decisionRow('d-x y')], more: true }));
  assert.match(odd, /<p class="mp-dim">Older decisions are not shown<\/p><\/div>$/);
  assert.doesNotMatch(odd, /memoryPageOlder|data-id/);
  const all = draw(memoryDecisions({ items: memoryDecisionRows() }));
  assert.doesNotMatch(all, /Show older|Older decisions/);
});

test('a window of older decisions: Back to the newest above the list', () => {
  const st = loaded(memoryDecisions({ items: memoryDecisionRows().slice(2), more: true }), R.memoryPageBefore(on, { id: 'd-20261113-1b2c3d4e' }));
  const html = draw(null, st);
  assert.ok(html.indexOf('data-action="memoryPageNewest"') < html.indexOf('<section class="mp-group">'), html);
  assert.match(html, /<div class="mp-record"><button type="button" class="btn-sm" data-action="memoryPageNewest">Back to the newest<\/button><\/div>/);
  assert.match(html, /data-action="memoryPageOlder" data-id="d-20261111-3d4e5f6a"/);
  assert.doesNotMatch(draw(memoryDecisions({ items: memoryDecisionRows() })), /memoryPageNewest/, 'the newest: no key back');
});

test("a symbol typed and no decision for it: that none was found, the symbol set apart, matched exactly; the box still drawn", () => {
  const html = draw(null, R.memoryPageSymbol(loaded(memoryDecisions()), { symbol: 'nvda' }));
  assert.match(html, /<p class="mp-dim">No decision for <code class="mp-fact">nvda<\/code>\. A symbol is matched exactly, capitals included\.<\/p>/);
  assert.doesNotMatch(html, /No decision yet/);
  const odd = draw(null, R.memoryPageSymbol(loaded(memoryDecisions()), { symbol: 'a<b>\u202e' }));
  assert.ok(odd.includes('<code class="mp-fact">a&lt;b&gt;\\u202e</code>'), odd);
  assert.doesNotMatch(odd, /<b>|\u202e/);
});

test('none: No decision yet, the box still drawn', () => {
  const none = draw(memoryDecisions());
  assert.match(none, /<p class="mp-dim">No decision yet<\/p>/);
  assert.match(none, /data-action="memoryPageSymbol"/);
  assert.doesNotMatch(none, /<article/);
});

test('a thesis with a direction mark and markup is text with the mark visible; an id off its shape is text; wrong if and words too', () => {
  const row = decisionRow('d-x<i>', { symbol: 'N<b>', thesis: 'buy <b>now</b>\u202e or never', wrong_if: '<i>gap</i>\u2066', words: 'mine\u200b<script>', whose: 'owner<u>', by: 'gravit\u202e' });
  const html = draw(memoryDecisions({ items: [row] }));
  assert.ok(html.includes('“buy &lt;b&gt;now&lt;/b&gt;\\u202e or never”'), html);
  assert.ok(html.includes('wrong if: &lt;i&gt;gap&lt;/i&gt;\\u2066'));
  assert.ok(html.includes('“mine\\u200b&lt;script&gt;”'));
  assert.ok(html.includes('owner&lt;u&gt; · by gravit\\u202e'));
  assert.match(html, /<span class="mp-id">d-x&lt;i&gt;<\/span>/);
  assert.match(html, /<h2 class="mp-group-head">N&lt;b&gt;<\/h2>/);
  assert.doesNotMatch(html, /[\u202e\u2066\u200b]/, 'no raw mark');
  assert.doesNotMatch(html, /<b>|<i>|<script>|<u>/);
});

test('an action or a mark the face does not know is drawn as given, with no class from it', () => {
  const row = decisionRow('d-20261110-4e5f6a7b', { action: 'swap" onclick="x' });
  const html = draw(memoryDecisions({ items: [row] }));
  assert.match(html, /<span class="mp-action">swap&quot; onclick=&quot;x<\/span>/);
  assert.doesNotMatch(html, /class="[^"]*swap/);
});

test('the frame draws the Decisions tab for a connected decisions read', () => {
  const html = renderMemoryScreen(loaded(memoryDecisions({ items: memoryDecisionRows() })), NOW);
  assert.match(html, /<div class="mp-page"><div class="mp-body mp-decisions">/);
});

// the owner's acts (memory owner acts plan Task 4): while the page signs, a decision that is not void carries Void… in place
// of its void command; for any other role the command stands
test('while the page signs, a decision that is not void carries Void… and no void command', () => {
  const st = R.ownerStanding(loaded(memoryDecisions({ items: memoryDecisionRows() })), { role: 'signs', kid: 'k1' });
  const html = renderMemoryScreen(st, NOW);
  const [owned, voided, agents, backfilled] = articles(html);
  for (const [a, id] of [[owned, 'd-20261114-0a1b2c3d'], [agents, 'd-20261113-1b2c3d4e'], [backfilled, 'd-20261111-3d4e5f6a']]) {
    assert.ok(a.includes(`<button type="button" class="btn-sm" data-action="memoryActOpen" data-act="void" data-subject="${id}">Void…</button>`), id);
  }
  assert.doesNotMatch(voided, /memoryActOpen/);
  assert.doesNotMatch(html, /mp-command|At the terminal/);
  const other = renderMemoryScreen(R.ownerStanding(loaded(memoryDecisions({ items: memoryDecisionRows() })), { role: 'signed-out', kid: '' }), NOW);
  assert.doesNotMatch(other, /memoryActOpen/);
  assert.equal(count(other, '<code class="mp-command">npx --no gravit-memory void'), 3);
});

test('the Decisions tab under ZH', () => {
  const html = withTable(ZH, () => draw(memoryDecisions({ items: memoryDecisionRows(), more: true })));
  for (const word of ['无代码', '作废', '你的原话', '显示更早的']) assert.ok(html.includes(word), word);
  assert.ok(withTable(ZH, () => draw(memoryDecisions())).includes('还没有决策'));
  assert.ok(withTable(ZH, () => draw(memoryDecisions({ items: [decisionRow('d-x y')], more: true }))).includes('更早的决策未显示'));
  assert.ok(withTable(ZH, () => draw(null, R.memoryPageSymbol(loaded(memoryDecisions()), { symbol: 'nvda' }))).includes('没有 <code class="mp-fact">nvda</code> 的决策'));
  assert.ok(withTable(ZH, () => draw(null, R.memoryPageBefore(loaded(memoryDecisions()), { id: 'd-20261113-1b2c3d4e' }))).includes('回到最新'));
});

test('a decision with no thesis draws no empty quotes; one of another year carries its year', () => {
  const html = draw(memoryDecisions({ items: [decisionRow('d-20250304-0a1b2c3d', { t: '2025-03-04T12:00:00.000Z', thesis: '' })] }));
  assert.doesNotMatch(html, /“”|mp-words/);
  assert.match(html, /<span class="mp-when">Mar 4, 2025<\/span>/);
});
