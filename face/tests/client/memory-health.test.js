// The Memory screen's Health tab (memory screen plan Task 4, render/memory-health.js) over states built with the real reducers:
// the home; each ledger with its line count, its chain sound or broken at a line, a partial last line; the price source - its
// address, when it last ran, whether it answered and how many it refused - or none named; the face's seven facts with their
// definitions; the commands, each in a code; and text from the memory made visible and escaped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { renderMemoryScreen } from '../../client/js/render/memory-page.js';
import { healthHtml } from '../../client/js/render/memory-health.js';
import { withTable } from '../../client/js/i18n/words.js';
import { ZH } from '../../client/js/i18n/zh.js';
import { memoryHealth, memoryHealthFull, FACE_FACT_ROWS } from './helpers/memory-page.js';

const NOW = Date.parse('2026-11-16T15:00:00.000Z');
const on = R.nav(emptyState(), { screen: 'memory', tab: 'health' });
const loaded = data => R.memoryPageLoaded(on, { read: 'health', data, at: NOW });
const draw = data => { const st = loaded(data); return healthHtml(st.memoryPage.health.data, st.memoryPage, NOW); };
const text = html => html.replace(/<[^>]*>/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const ledger = (html, file) => html.match(new RegExp(`<div class="mp-ledger"><code class="mp-fact">${file.replace('.', '\\.')}</code>[\\s\\S]*?</div>`))?.[0] ?? '';

test('the body is an mp-body; the home in a code', () => {
  const html = draw(memoryHealthFull());
  assert.match(html, /^<div class="mp-body mp-health">/);
  assert.match(html, /<h2 class="mp-section-head">Home<\/h2><code class="mp-fact">\/srv\/owner\/memory<\/code>/);
});

test('each ledger: its line count and its chain, sound or broken at its line; a partial last line named', () => {
  const html = draw(memoryHealthFull());
  assert.match(html, /<h2 class="mp-section-head">Ledgers<\/h2>/);
  assert.equal(html.split('class="mp-ledger"').length - 1, 5);
  assert.match(ledger(html, 'decisions.jsonl'), /<span class="mp-counts">12 lines<\/span><span class="chip ok">sound<\/span>/);
  assert.match(ledger(html, 'owner.jsonl'), /<span class="mp-counts">5 lines<\/span><span class="chip down">broken at line 4<\/span>/);
  assert.match(ledger(html, 'recalls.jsonl'), /<span class="chip ok">sound<\/span><span class="chip warn">a partial last line<\/span>/);
  assert.doesNotMatch(ledger(html, 'outcomes.jsonl'), /partial/);
  assert.ok(text(draw(memoryHealthFull({ lines: { 'owner.jsonl': 1 }, chains: [{ file: 'owner.jsonl', ok: false }], partial: [] }))).includes('1 line broken'), 'one line; broken with no line given');
});

// the price source's last run as the package writes it (gravit-memory's reconcile): ok is a source set that refused nothing
const run = last => text(draw(memoryHealthFull({ prices: { url: 'http://127.0.0.1:4821', ...(last === undefined ? {} : { last }) } })));
const RAN = '2026-11-16T12:00:00.000Z';

test('the price source: its address as text; one refusal in six, when it was last asked, refused 1 of 6', () => {
  const html = draw(memoryHealthFull());
  assert.match(html, /<h2 class="mp-section-head">Price source<\/h2><code class="mp-fact">http:\/\/127\.0\.0\.1:4821<\/code>/);
  assert.doesNotMatch(html, /<a /, 'the address is not a link');
  const words = text(html);
  assert.ok(/last asked Nov 16 \d\d:\d\d · refused 1 of 6/.test(words), words);
  assert.doesNotMatch(words, /answered/, 'a run that refused one is not drawn as answered');
});

test("the price source's last run in the package's three cases: never asked; asked nothing; answered or refused, of how many", () => {
  assert.ok(run(undefined).includes('Price source http://127.0.0.1:4821 never asked'), run(undefined));
  const nothing = run({ t: RAN, ok: true, refused: 0, asked: 0 });
  assert.ok(/last ran Nov 16 \d\d:\d\d · asked it nothing/.test(nothing), nothing);
  assert.doesNotMatch(nothing, /answered|refused/, 'a run that asked nothing says neither');
  assert.ok(/last asked Nov 16 \d\d:\d\d · answered/.test(run({ t: RAN, ok: true, refused: 0, asked: 4 })));
  assert.doesNotMatch(run({ t: RAN, ok: true, refused: 0, asked: 4 }), /refused/);
  assert.ok(run({ t: RAN, ok: false, refused: 2 }).includes('refused 2'), 'a run written before asked was: read as one that asked');
  assert.doesNotMatch(run({ t: RAN, ok: false, refused: 2 }), /refused 2 of/);
  assert.ok(run({ t: RAN, ok: true, refused: 0 }).includes('answered'));
  const odd = run({ t: RAN, ok: false, refused: -1, asked: 1.5 });
  assert.ok(/· refused The face's facts/.test(odd), `a count that is not one is left out, never drawn as 0: ${odd}`);
  assert.doesNotMatch(odd, /refused \d|-1|1\.5| of \d/);
  assert.ok(run({ t: 'never', ok: true, refused: 0, asked: 3 }).includes('Price source http://127.0.0.1:4821 answered'), 'a time that does not parse is left out');
  assert.ok(/last asked Mar 4, 2025 \d\d:\d\d/.test(run({ t: '2025-03-04T12:00:00.000Z', ok: true, refused: 0, asked: 1 })), 'another year: the year');
});

test("no address: No price source is named, and where one is named", () => {
  const html = draw(memoryHealthFull({ prices: { url: '', last: { t: '2026-11-16T12:00:00.000Z', ok: true, refused: 0, asked: 0 } } }));
  assert.match(html, /<h2 class="mp-section-head">Price source<\/h2><p class="mp-dim">No price source is named: set prices\.url in the home&#39;s config\.json<\/p>/);
  assert.doesNotMatch(html, /last ran|last asked/);
});

test("the face's seven facts, each with the face's definition", () => {
  const html = draw(memoryHealthFull());
  assert.match(html, /<h2 class="mp-section-head">The face&#39;s facts<\/h2>/);
  assert.equal(html.split('<li class="mp-check">').length - 1, 7);
  for (const { fact, definition } of FACE_FACT_ROWS) {
    assert.ok(html.includes(`<li class="mp-check"><code class="mp-fact">${fact}</code><span class="mp-def">${definition.replace(/'/g, '&#39;')}</span></li>`), fact);
  }
});

test('the commands, each in a code under At the terminal, in face/', () => {
  const html = draw(memoryHealthFull());
  assert.match(html, /<h2 class="mp-section-head">At the terminal, in face\/<\/h2>/);
  for (const name of ['status', 'verify', 'reconcile', 'review', 'reseal']) {
    assert.ok(html.includes(`<code class="mp-command">npx --no gravit-memory ${name} --home /srv/owner/memory</code>`), name);
  }
});

test('a home with nothing in it: no ledger, no fact, no command, the home and the source still drawn', () => {
  const html = draw(memoryHealth());
  assert.doesNotMatch(html, /mp-ledger|mp-check|mp-command/);
  assert.match(html, /\/srv\/owner\/memory/);
  assert.match(html, /http:\/\/127\.0\.0\.1:4821/);
});

test('text from the memory - the home, a ledger, the address, a fact, a command - is text, the mark visible', () => {
  const html = draw(memoryHealthFull({
    home: '/h<b>\u202e', lines: { 'x<i>\u2066': 2 }, partial: ['x<i>\u2066'], chains: [{ file: 'x<i>\u2066', ok: 'yes', line: '<s>' }],
    prices: { url: 'javascript:alert(1)<u>\u200b', last: { t: 'never<b>', ok: false, refused: 2 } },
    facts: [{ fact: 'f<i>', definition: 'd\u202e<b>' }], commands: [{ name: 'n', line: 'npx <b>\u202e' }],
  }));
  for (const s of ['/h&lt;b&gt;\\u202e', 'x&lt;i&gt;\\u2066', 'javascript:alert(1)&lt;u&gt;\\u200b', 'f&lt;i&gt;', 'd\\u202e&lt;b&gt;', 'npx &lt;b&gt;\\u202e']) assert.ok(html.includes(s), s);
  assert.match(ledger(html, 'x&lt;i&gt;\\\\u2066'), /<span class="chip down">broken<\/span>/, 'a chain not plainly ok is broken, a line not a number not drawn');
  assert.doesNotMatch(html, /last ran|last asked|never&lt;b/, 'a time that does not parse is not drawn');
  assert.ok(text(html).includes('refused 2'));
  assert.doesNotMatch(html, /<a |href/);
  assert.doesNotMatch(html, /[\u202e\u2066\u200b]/);
  assert.doesNotMatch(html, /<b>|<i>|<u>|<s>/);
});

test('the frame draws the Health tab for a connected health read', () => {
  const html = renderMemoryScreen(loaded(memoryHealthFull()), NOW);
  assert.match(html, /<div class="mp-page"><div class="mp-body mp-health">/);
});

test('the Health tab under ZH', () => {
  const html = withTable(ZH, () => draw(memoryHealthFull()));
  for (const word of ['主目录', '账本', '完好', '在第 4 行断开', '价格来源']) assert.ok(html.includes(word), word);
  assert.ok(withTable(ZH, () => draw(memoryHealthFull({ prices: { url: '' } }))).includes('没有指定价格来源'));
});
