// The Memory screen's Waiting tab (memory screen plan Task 4, render/memory-waiting.js) over states built with the real
// reducers: each proposal - who proposed it and when, what it is, its reason, its evidence, and for a new card or a change the
// card as it would be written - the review command; the decisions past their horizon and the count without a wrong if; nothing
// waiting; and text from the memory made visible and escaped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { renderMemoryScreen } from '../../client/js/render/memory-page.js';
import { waitingHtml } from '../../client/js/render/memory-waiting.js';
import { withTable } from '../../client/js/i18n/words.js';
import { ZH } from '../../client/js/i18n/zh.js';
import { memoryWaiting, memoryWaitingProposals, proposalCard } from './helpers/memory-page.js';

const NOW = Date.parse('2026-11-16T15:00:00.000Z');
const on = R.nav(emptyState(), { screen: 'memory', tab: 'waiting' });
const loaded = data => R.memoryPageLoaded(on, { read: 'waiting', data, at: NOW });
const draw = data => { const st = loaded(data); return waitingHtml(st.memoryPage.waiting.data, st.memoryPage, NOW); };
const text = html => html.replace(/<[^>]*>/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const articles = html => [...html.matchAll(/<article class="mp-proposal">[\s\S]*?<\/article>/g)].map(m => m[0]);
const PAST = ['d-20261101-0a1b2c3d', 'd-20261102-1b2c3d4e'];

test('the body is an mp-body; each proposal shows who proposed it and when, what it is, its reason in quotes and its evidence', () => {
  const html = draw(memoryWaiting({ proposals: memoryWaitingProposals() }));
  assert.match(html, /^<div class="mp-body mp-waiting">/);
  const [fresh, change, retire] = articles(html);
  assert.ok(text(fresh).includes('new lesson chase-gap'), text(fresh));
  assert.ok(text(fresh).includes('proposed by gravit on Nov 15'));
  assert.ok(text(fresh).includes('“Two gap-up buys on the open gave back their gain by noon”'));
  assert.ok(text(fresh).includes('evidence: d-20261103-0a1b2c3d, d-20261105-1b2c3d4e'));
  assert.ok(text(change).includes('change to no-chasing'));
  assert.ok(text(change).includes('evidence: d-20261107-2c3d4e5f'));
  assert.ok(text(retire).includes('retire gap-fade'));
  assert.ok(text(retire).includes('“It has not fired in a year”'));
  assert.doesNotMatch(retire, /evidence:/, 'no evidence: none drawn');
  assert.doesNotMatch(html, /<a /, 'no id is a link');
});

test('a new card and a change: the card as it would be written - its line, its words, each check, each fact with its definition', () => {
  const [fresh, change, retire] = articles(draw(memoryWaiting({ proposals: memoryWaitingProposals() })));
  assert.match(fresh, /The card as it would be written/);
  assert.ok(text(fresh).includes('red-line · dont buy · US'));
  assert.ok(text(fresh).includes('“Do not buy a gap up of six percent on the open”'));
  assert.match(fresh, /<li class="mp-check"><code class="mp-fact">change_1d_pct &gt;= 6<\/code><\/li>/);
  assert.match(fresh, /<li class="mp-check"><code class="mp-fact">session in open, pre<\/code><\/li>/);
  assert.match(fresh, /<li class="mp-check"><code class="mp-fact">session<\/code><span class="mp-def">The part of the trading day the order is placed in\.<\/span><\/li>/);
  assert.ok(text(change).includes('caveat · dont buy · US'));
  assert.match(change, /<code class="mp-fact">change_5d_pct &gt; 10<\/code>/);
  assert.doesNotMatch(change, /it defines:/, 'no facts defined: none drawn');
  assert.doesNotMatch(retire, /as it would be written/, 'a retire carries no card');
});

test('the review command under At the terminal, once', () => {
  const html = draw(memoryWaiting({ proposals: memoryWaitingProposals() }));
  assert.match(html, /<div class="mp-dim">At the terminal<\/div><code class="mp-command">npx --no gravit-memory review --home \/srv\/owner\/memory<\/code>/);
  assert.equal(html.split('<code class="mp-command">').length - 1, 1);
});

test('the decisions past their horizon with no review, as text; the count without a wrong if', () => {
  const html = draw(memoryWaiting({ proposals: memoryWaitingProposals(), pastHorizon: PAST, withoutWrongIf: 3 }));
  assert.ok(text(html).includes('Decisions past their horizon with no review'));
  assert.match(html, /<p class="mp-ids">d-20261101-0a1b2c3d, d-20261102-1b2c3d4e<\/p>/);
  assert.ok(text(html).includes('3 decisions have no wrong if'));
  assert.ok(text(draw(memoryWaiting({ withoutWrongIf: 1 }))).includes('1 decision has no wrong if'));
  const none = draw(memoryWaiting({ proposals: memoryWaitingProposals() }));
  assert.doesNotMatch(none, /past their horizon/);
  assert.doesNotMatch(none, /no wrong if/);
});

test('past their horizon with no proposal: the ids and the review command, not Nothing waits for you', () => {
  const html = draw(memoryWaiting({ pastHorizon: PAST }));
  assert.doesNotMatch(html, /Nothing waits/);
  assert.match(html, /<p class="mp-ids">/);
  assert.match(html, /mp-command/);
});

test('none waiting: Nothing waits for you, and no command', () => {
  const html = draw(memoryWaiting());
  assert.equal(html, '<div class="mp-body mp-waiting"><p class="mp-dim">Nothing waits for you</p></div>');
});

test("a proposal's reason, words, lesson and evidence with a mark and markup are text, the mark visible; what is no class", () => {
  const card = proposalCard('x<i>', { words: 'do <b>this</b>\u202e', check: [{ fact: 'f<i>', op: '<', value: '<s>' }], facts: { 'f<i>': 'def\u2066<u>' } });
  const odd = { v: 1, kind: 'proposal', id: 'p-x', seq: 1, prev: null, t: '2026-11-15T12:00:00.000Z', by: 'agent<b>\u200b', sum: 'f', what: 'change', lesson: 'a<b>\u202e', card,
    reason: 'because <script>\u202e', evidence: ['d-1<i>\u202e'] };
  const html = draw(memoryWaiting({ proposals: [odd, { ...odd, what: 'merge" class="x', card: undefined }], pastHorizon: ['d-<b>\u202e'] }));
  assert.ok(html.includes('change to a&lt;b&gt;\\u202e'), html);
  assert.ok(html.includes('proposed by agent&lt;b&gt;\\u200b on Nov 15'));
  assert.ok(html.includes('“because &lt;script&gt;\\u202e”'));
  assert.ok(html.includes('evidence: d-1&lt;i&gt;\\u202e'));
  assert.ok(html.includes('“do &lt;b&gt;this&lt;/b&gt;\\u202e”'));
  assert.ok(html.includes('<code class="mp-fact">f&lt;i&gt; &lt; &lt;s&gt;</code>'));
  assert.ok(html.includes('<span class="mp-def">def\\u2066&lt;u&gt;</span>'));
  assert.ok(html.includes('<p class="mp-ids">d-&lt;b&gt;\\u202e</p>'));
  assert.ok(html.includes('<span class="mp-what">merge&quot; class=&quot;x <span class="mp-id">a&lt;b&gt;\\u202e</span></span>'), 'a what the face does not know, drawn as given');
  assert.doesNotMatch(html, /class="x/);
  assert.doesNotMatch(html, /[\u202e\u2066\u200b]/);
  assert.doesNotMatch(html, /<b>|<i>|<script>|<u>|<s>/);
});

test('the frame draws the Waiting tab for a connected waiting read', () => {
  const html = renderMemoryScreen(loaded(memoryWaiting({ proposals: memoryWaitingProposals() })), NOW);
  assert.match(html, />Waiting · 3<\/a>/);
  assert.match(html, /<div class="mp-page"><div class="mp-body mp-waiting">/);
});

test('the Waiting tab under ZH', () => {
  const html = withTable(ZH, () => draw(memoryWaiting({ proposals: memoryWaitingProposals(), pastHorizon: PAST, withoutWrongIf: 2 })));
  for (const word of ['新教训', '修改 no-chasing', '退役 gap-fade', '在终端运行']) assert.ok(html.includes(word), word);
  assert.ok(withTable(ZH, () => draw(memoryWaiting())).includes('没有等你处理的事'));
});
