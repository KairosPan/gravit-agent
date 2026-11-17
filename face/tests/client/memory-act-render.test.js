// The owner's act drawer on the Memory screen (memory owner acts plan Task 4, render/memory-act.js) over states built with the
// real reducers: its title, what the act acts on (a card's text, a discard's two texts, a proposal, a decision), the owner's
// words box for a worded act, What you sign, the go key and its states, a refusal with Prepare again, done (an edit's file),
// and every text from the memory made visible and escaped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { renderMemoryAct } from '../../client/js/render/memory-act.js';
import { said } from '../../client/js/i18n/words.js';
import { withTable } from '../../client/js/i18n/words.js';
import { ZH } from '../../client/js/i18n/zh.js';
import { memoryWaitingProposals, memoryDecisionRows } from './helpers/memory-page.js';

const NOW = Date.parse('2026-11-16T15:00:00.000Z');
const on = R.nav(emptyState(), { screen: 'memory', tab: 'lessons' });
const opened = (act, subject, st = on) => R.memoryActOpen(st, { act, subject });
const shown = (st, show) => R.memoryActShown(st, { show });
const CARD = { kind: 'card', lesson: 'no-chasing', state: 'unarmed', text: '---\nid: no-chasing\n---\nDo not chase\n' };
const PREPARED = {
  ok: true, action: { type: 'attest', nonce: 1763380000000 }, primaryType: 'AccountAttest:Sign', accountChain: 'Simulation', domain: {},
  shown: [{ name: 'service', value: 'gravit-memory' }, { name: 'act', value: 'arm' }, { name: 'subject', value: 'no-chasing' }, { name: 'digest', value: 'e'.repeat(64) }, { name: 'nonce', value: '1763380000000' }],
};
const ready = (act = 'arm', subject = 'no-chasing', show = CARD) => R.memoryActPrepared(R.memoryActPreparing(shown(opened(act, subject), show)), { prepared: PREPARED });
const draw = st => renderMemoryAct(st, NOW);
const text = html => html.replace(/<[^>]*>/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ');

test('no act open: nothing drawn', () => {
  assert.equal(draw(on), '');
});

test("the drawer's title names the act and the subject; a card's text in a pre, made visible and escaped; the go key is the act's verb", () => {
  const html = draw(ready());
  assert.match(html, /^<div class="drawer sheet mp-act" role="dialog" aria-label="Arm no-chasing">/);
  assert.match(html, /<h2>Arm no-chasing<\/h2>/);
  assert.match(html, /<pre class="mp-text">---\nid: no-chasing\n---\nDo not chase\n<\/pre>/);
  assert.match(html, /<button type="button" class="close-key" data-action="memoryActClose" aria-label="Close">×<\/button>/);
  assert.match(html, /<button type="button" class="btn-primary" data-action="memoryActGo">Arm<\/button>/);
  assert.doesNotMatch(html, /textarea/, 'an arm takes no words');
});

test('What you sign: each field the Account shows, name: value, in its order', () => {
  const html = draw(ready());
  assert.match(html, /What you sign/);
  const words = text(html);
  assert.ok(words.includes(`service: gravit-memory act: arm subject: no-chasing digest: ${'e'.repeat(64)} nonce: 1763380000000`), words);
});

test('the go key is disabled until ready; signing reads Signing…', () => {
  const reading = draw(opened('arm', 'no-chasing'));
  assert.match(reading, /data-action="memoryActGo" disabled>Arm<\/button>/);
  assert.match(reading, /Loading…/);
  const preparing = draw(R.memoryActPreparing(shown(opened('arm', 'no-chasing'), CARD)));
  assert.match(preparing, /data-action="memoryActGo" disabled>Arm<\/button>/);
  assert.match(preparing, /Preparing…/);
  assert.doesNotMatch(preparing, /What you sign/);
  const signing = draw(R.memoryActSigning(ready()));
  assert.match(signing, /data-action="memoryActGo" disabled>Signing…<\/button>/);
});

test('a card cut by the face says so', () => {
  const html = draw(ready('arm', 'no-chasing', { ...CARD, cut: true }));
  assert.match(html, /Cut at 16,384 characters/);
});

test('a discard draws the armed copy and the file now, each under its head', () => {
  const html = draw(ready('discard', 'trim-into-strength', { kind: 'card', lesson: 'trim-into-strength', state: 'changed', text: 'Trim a half\n', armedText: 'Trim a third\n' }));
  assert.match(html, /<div class="mp-diff-head">Armed<\/div><pre class="mp-text">Trim a third\n<\/pre>/);
  assert.match(html, /<div class="mp-diff-head">Now<\/div><pre class="mp-text">Trim a half\n<\/pre>/);
  assert.match(html, /<h2>Discard trim-into-strength<\/h2>/);
});

test('a proposal: who and when, what, its reason in quotes and its card', () => {
  const [fresh] = memoryWaitingProposals();
  const html = draw(ready('accept', fresh.id, { kind: 'proposal', proposal: fresh }));
  const words = text(html);
  assert.ok(words.includes('proposed by gravit on Nov 15'), words);
  assert.ok(words.includes('new lesson chase-gap'), words);
  assert.ok(words.includes('“Two gap-up buys on the open gave back their gain by noon”'), words);
  assert.ok(words.includes('The card as it would be written'), words);
  assert.ok(words.includes('red-line · dont buy · US'), words);
  assert.ok(words.includes('change_1d_pct >= 6'), words);
  assert.match(html, /<h2>Accept p-20261115-0a1b2c3d<\/h2>/);
});

test('a decision: its date, its action, its symbol and its thesis', () => {
  const [row] = memoryDecisionRows();
  const html = draw(R.memoryActWords(shown(opened('void', row.view.line.id), { kind: 'decision', decision: row.view.line }), { words: '' }));
  const words = text(html);
  assert.ok(words.includes('Nov 14'), words);
  assert.match(html, /<span class="mp-action">buy<\/span>/);
  assert.match(html, /<span class="mp-act-symbol">NVDA<\/span>/);
  assert.ok(words.includes('“The data-centre outlook was raised”'), words);
});

test('a worded act has its words box, as typed, under Why, in your own words', () => {
  const st = R.memoryActWords(shown(opened('retire', 'no-chasing'), CARD), { words: 'no longer\ntrue <b>' });
  const html = draw(st);
  assert.match(html, /Why, in your own words/);
  assert.match(html, /<textarea class="textarea mp-act-words" id="mp-act-words" name="words" rows="3" maxlength="500" data-action="memoryActWords">no longer\ntrue &lt;b&gt;<\/textarea>/);
  assert.match(html, /<button type="button" class="btn-primary" data-action="memoryActGo" disabled>Retire<\/button>/);
  const signing = draw(R.memoryActSigning(R.memoryActPrepared(R.memoryActPreparing(st), { prepared: PREPARED })));
  assert.match(signing, /maxlength="500" data-action="memoryActWords" disabled>/, 'the words held while it signs');
});

test('refused draws the message and Prepare again; done draws Done, an edit its file and what to do next', () => {
  const refused = draw(R.memoryActRefused(ready(), { message: 'it changed while it was shown: nothing was done' }));
  assert.match(refused, /<p class="mp-act-said">it changed while it was shown: nothing was done<\/p>/);
  assert.match(refused, /<button type="button" class="btn-primary" data-action="memoryActOpen" data-act="arm" data-subject="no-chasing">Prepare again<\/button>/);
  assert.doesNotMatch(refused, /memoryActGo/);
  const saidRefused = draw(R.memoryActRefused(ready(), { message: said('owner.notSigning') }));
  assert.match(saidRefused, /This browser does not sign for the account\./);

  const done = draw(R.memoryActDone(R.memoryActSigning(ready()), { done: { ok: true, act: 'arm', subject: 'no-chasing', sha256: 'a'.repeat(64) } }));
  assert.match(done, /<p class="mp-act-done">Done<\/p>/);
  assert.doesNotMatch(done, /memoryActGo|Prepare again/);
  const [fresh] = memoryWaitingProposals();
  const edit = draw(R.memoryActDone(R.memoryActSigning(ready('edit', fresh.id, { kind: 'proposal', proposal: fresh })), { done: { ok: true, act: 'edit', subject: fresh.id, lesson: 'chase-gap', path: '/srv/owner/memory/lessons/chase-gap.md' } }));
  assert.match(edit, /<code class="mp-command">\/srv\/owner\/memory\/lessons\/chase-gap\.md<\/code>/);
  assert.match(edit, /Edit the file, then arm it here/);
});

test('words with a direction mark and markup are text, the mark visible; the subject too', () => {
  const mark = '\u202e';
  const html = draw(R.memoryActRefused(ready('arm', 'no-chasing', { ...CARD, text: `ok ${mark}<script>x</script>` }), { message: `no ${mark}<i>` }));
  assert.ok(!html.includes(mark), 'no raw mark');
  assert.match(html, /ok \\u202e&lt;script&gt;x&lt;\/script&gt;/);
  assert.match(html, /no \\u202e&lt;i&gt;/);
  const [fresh] = memoryWaitingProposals();
  const proposal = draw(ready('reject', fresh.id, { kind: 'proposal', proposal: { ...fresh, reason: `why ${mark}<b>`, by: `g${mark}` } }));
  assert.ok(!proposal.includes(mark));
  assert.match(proposal, /why \\u202e&lt;b&gt;/);
  // the box holds the words as typed: escaped, the mark kept as typed
  const typed = draw(R.memoryActWords(shown(opened('reject', fresh.id), { kind: 'proposal', proposal: fresh }), { words: `a${mark}<b>` }));
  assert.ok(typed.includes(`>a${mark}&lt;b&gt;</textarea>`));
});

test('under ZH: the title, the keys and the heads in the table', () => {
  const html = withTable(ZH, () => draw(R.memoryActWords(shown(opened('retire', 'no-chasing'), CARD), { words: '' })));
  assert.doesNotMatch(text(html), /Retire|Why, in your own words|What you sign/);
});
