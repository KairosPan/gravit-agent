// The owner's act drawer on the Memory screen (memory owner acts plan Task 4, render/memory-act.js) over states built with the
// real reducers: its title, what the act acts on (a card's text, a discard's two texts, a proposal, a decision), the owner's
// words box for a worded act, What you sign, the go key and its states, a refusal with Prepare again while the page signs and
// the act's own terminal command when the reads hold one, done (an edit's file), and every text from the memory made visible
// and escaped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { renderMemoryAct } from '../../client/js/render/memory-act.js';
import { said } from '../../client/js/i18n/words.js';
import { withTable } from '../../client/js/i18n/words.js';
import { ZH } from '../../client/js/i18n/zh.js';
import {
  memoryWaitingProposals, memoryDecisionRows, memoryLessons, memoryWaiting, memoryDecisions, armedLesson, changedLesson, unarmedLesson, decisionRow,
} from './helpers/memory-page.js';

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

// the screen with its three reads loaded: the lessons, the waiting and the decisions as the face answers them
function withReads(st = on, { lessons = [unarmedLesson(), changedLesson(), armedLesson()], waiting = memoryWaiting({ proposals: memoryWaitingProposals() }), decisions = memoryDecisions({ items: memoryDecisionRows() }) } = {}) {
  let out = R.memoryPageLoaded(st, { read: 'lessons', data: memoryLessons({ lessons }), at: NOW });
  out = R.memoryPageLoaded(out, { read: 'waiting', data: waiting, at: NOW });
  return R.memoryPageLoaded(out, { read: 'decisions', data: decisions, at: NOW });
}
const refusedOn = (st, act, subject, show) => R.memoryActRefused(R.memoryActPrepared(R.memoryActPreparing(shown(opened(act, subject, st), show)), { prepared: PREPARED }), { message: said('memory.act.noAnswer') });
const TERMINAL = '<div class="mp-commands"><div class="mp-dim">At the terminal, in face/</div>';

test("a refused drawer draws, under the refusal, the act's own terminal command from the reads the page holds", () => {
  const st = withReads();
  const [fresh] = memoryWaitingProposals();
  const [row] = memoryDecisionRows();
  const cases = [
    ['arm', 'add-below-stop', CARD, unarmedLesson().commands.arm],
    ['retire', 'no-chasing', CARD, armedLesson().commands.retire],
    ['discard', 'trim-into-strength', { kind: 'card', lesson: 'trim-into-strength', state: 'changed', text: 'a\n', armedText: 'b\n' }, changedLesson().commands.review],
    ['accept', fresh.id, { kind: 'proposal', proposal: fresh }, memoryWaiting().command],
    ['reject', fresh.id, { kind: 'proposal', proposal: fresh }, memoryWaiting().command],
    ['void', row.view.line.id, { kind: 'decision', decision: row.view.line }, row.command],
  ];
  for (const [act, subject, show, command] of cases) {
    const html = draw(refusedOn(st, act, subject, show));
    assert.match(html, /<p class="mp-act-said">The Account did not answer: nothing was signed<\/p>/, act);
    const at = html.indexOf(TERMINAL);
    assert.ok(at > html.indexOf('mp-act-said'), `${act}: the command under the refusal`);
    assert.ok(html.includes(`<code class="mp-command">${command.replace(/"/g, '&quot;')}</code>`), `${act}: ${html}`);
  }
});

test('a refused drawer draws no command when the reads hold none, nor while the act is not refused', () => {
  const bare = withReads(on, { lessons: [unarmedLesson({ commands: {} })], waiting: memoryWaiting({ command: undefined }), decisions: memoryDecisions({ items: [decisionRow('d-20261114-0a1b2c3d', {}, { void: true })] }) });
  const [fresh] = memoryWaitingProposals();
  for (const [act, subject, show] of [['arm', 'add-below-stop', CARD], ['accept', fresh.id, { kind: 'proposal', proposal: fresh }], ['void', 'd-20261114-0a1b2c3d', { kind: 'decision', decision: memoryDecisionRows()[0].view.line }], ['arm', 'no-such-card', CARD]]) {
    assert.ok(!draw(refusedOn(bare, act, subject, show)).includes('mp-commands'), act);
  }
  assert.ok(!draw(refusedOn(on, 'arm', 'add-below-stop', CARD)).includes('mp-commands'), 'no read loaded: none');
  assert.ok(!draw(R.memoryActPrepared(R.memoryActPreparing(shown(opened('arm', 'add-below-stop', withReads()), CARD)), { prepared: PREPARED })).includes('mp-commands'), 'ready: none');
  // a command from the memory is made visible and escaped
  const mark = '\u202e';
  const odd = withReads(on, { lessons: [unarmedLesson({ commands: { arm: `npx arm ${mark}<b>` } })] });
  const html = draw(refusedOn(odd, 'arm', 'add-below-stop', CARD));
  assert.ok(!html.includes(mark));
  assert.match(html, /<code class="mp-command">npx arm \\u202e&lt;b&gt;<\/code>/);
});

test('Prepare again is drawn only while the page still signs', () => {
  const refused = st => draw(R.memoryActRefused(ready('arm', 'no-chasing', CARD), { message: 'the signature does not match the instruction' }));
  assert.match(refused(on), /Prepare again/);
  const signs = R.ownerStanding(on, { role: 'signs', kid: 'k1' });
  assert.match(draw(R.memoryActRefused(R.memoryActPrepared(R.memoryActPreparing(shown(opened('arm', 'no-chasing', signs), CARD)), { prepared: PREPARED }), { message: 'no' })), /Prepare again/);
  const dropped = R.ownerStanding(signs, { role: 'none' });
  const html = draw(R.memoryActRefused(R.memoryActPrepared(R.memoryActPreparing(shown(opened('arm', 'no-chasing', dropped), CARD)), { prepared: PREPARED }), { message: 'the signature does not match the instruction' }));
  assert.doesNotMatch(html, /Prepare again/);
  assert.match(html, /the signature does not match the instruction/);
});

test("an accept's and an edit's drawer draws the card's source when it has one; a void's whose and by and the decided day", () => {
  const [fresh] = memoryWaitingProposals();
  const sourced = { ...fresh, card: { ...fresh.card, source: ['d-20261103-0a1b2c3d', `a note ${'\u202e'}<b>`] } };
  for (const act of ['accept', 'edit']) {
    const html = draw(ready(act, fresh.id, { kind: 'proposal', proposal: sourced }));
    const words = text(html);
    assert.ok(words.includes('Source'), act);
    assert.ok(words.includes('d-20261103-0a1b2c3d'), act);
    assert.match(html, /a note \\u202e&lt;b&gt;/, act);
    assert.ok(!html.includes('\u202e'));
  }
  assert.ok(!text(draw(ready('accept', fresh.id, { kind: 'proposal', proposal: fresh }))).includes('Source'), 'no source, no head');
  assert.ok(!text(draw(ready('reject', fresh.id, { kind: 'proposal', proposal: sourced }))).includes('Source'), 'a reject draws none');

  const line = decisionRow('d-20261114-0a1b2c3d', { t: '2026-11-14T12:00:00.000Z', decided_at: '2026-11-03T12:00:00.000Z', whose: 'owner', by: 'gravit-face', backfilled: true }).view.line;
  const html = draw(R.memoryActWords(shown(opened('void', line.id), { kind: 'decision', decision: line }), { words: '' }));
  const words = text(html);
  assert.ok(words.includes('Nov 3'), words);
  assert.ok(!words.includes('Nov 14'), 'the decided day, not the registration date');
  assert.match(html, /<span class="mp-who">owner · by gravit-face<\/span>/);
});
