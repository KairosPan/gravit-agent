// The owner's acts on the Memory screen (memory owner acts plan Task 4, host/memory-acts.js): open asks the face's prepare and
// draws what the act acts on; an act that takes no words is prepared at the Account at once, a worded one once the owner's
// words are quiet; go signs through the owner device and posts the act; a refusal of either route, of the Account's prepare or
// of the signer ends refused; close empties the slot and a late answer changes nothing. Against a recording post, a stub owner
// device and recording timers, over the real store and reducers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../client/js/store.js';
import { reducers } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { startMemoryActs, ACT_QUIET_MS, WORDED_ACTS, MEMORY_ACTS, actFits, lessonActs, proposalActs, decisionActs } from '../../client/js/host/memory-acts.js';
import { said, sayOf } from '../../client/js/i18n/words.js';
import { armedLesson, changedLesson, unarmedLesson, retiredLesson, refusedLesson, brokenLesson, memoryWaitingProposals, memoryDecisionRows } from './helpers/memory-page.js';

const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 8; i++) await tick(); };
const PREPARE = '/data/memory/prepare';
const ACT = '/data/memory/act';
const CARD_SHOW = { kind: 'card', lesson: 'no-chasing', state: 'unarmed', text: '---\nid: no-chasing\n---\nDo not chase\n' };
const draftOf = (act, subject) => ({ type: 'attest', service: 'gravit-memory', act, subject, digest: 'e'.repeat(64) });
const preparedOf = draft => ({
  ok: true, action: { ...draft, nonce: 1763380000000 }, primaryType: 'AccountAttest:Sign', accountChain: 'Simulation',
  domain: { name: 'AgentAccountSignTransaction', version: '1', chainId: 424242 },
  shown: ['service', 'act', 'subject', 'digest'].map(name => ({ name, value: draft[name] })).concat({ name: 'nonce', value: '1763380000000' }),
});
const ENVELOPE = { action: { type: 'attest' }, nonce: 1763380000000, signature: { kid: 'k1', es256: 'sig' } };

// a door that answers each path from its queue, else by its rule: the face's prepare draws the card and drafts the attest (none
// for a worded act with no words), the act is done
function rig({ answers = {} } = {}) {
  const store = createStore({ initial: emptyState(), reducers });
  const posts = [];
  const queues = {};
  const held = {};
  const rules = {
    [PREPARE]: body => ({ status: 200, body: { ok: true, show: CARD_SHOW, draft: WORDED_ACTS.includes(body.act) && body.words === undefined ? null : draftOf(body.act, body.subject) } }),
    [ACT]: body => ({ status: 200, body: { ok: true, act: body.act, subject: body.subject } }),
    ...answers,
  };
  const post = async (path, body) => {
    posts.push([path, JSON.parse(JSON.stringify(body))]);
    if (held[path]) await held[path];
    const queued = queues[path]?.shift();
    return queued ?? rules[path](body);
  };
  const owner = {
    prepares: [], signs: [],
    prepareAnswer: null, signAnswer: null,
    async prepare(draft) { owner.prepares.push(draft); return owner.prepareAnswer ?? { status: 200, body: preparedOf(draft) }; },
    async sign(prepared) { owner.signs.push(prepared); return owner.signAnswer ?? { ok: true, envelope: ENVELOPE }; },
  };
  let id = 0;
  const timers = new Map();
  const schedule = (fn, ms) => { timers.set(++id, { fn, ms }); return id; };
  const cancelTimer = t => { timers.delete(t); };
  const fire = () => { const due = [...timers.values()]; timers.clear(); for (const t of due) t.fn(); };
  const done = [];
  const acts = startMemoryActs({ store, owner, post, schedule, cancelTimer, afterDone: act => done.push(act) });
  return {
    store, acts, owner, posts, timers, fire, done,
    queue: (path, answer) => (queues[path] ??= []).push(answer),
    hold(path) { let release; held[path] = new Promise(r => { release = r; }); return () => { delete held[path]; release(); }; },
    a: () => store.get().memoryPage.act,
    sent: path => posts.filter(([p]) => p === path).map(([, b]) => b),
  };
}

test('the act slot starts empty; the acts, the worded ones and the quiet are the plan\'s', () => {
  assert.equal(emptyState().memoryPage.act, null);
  assert.equal(ACT_QUIET_MS, 300);
  assert.deepEqual(WORDED_ACTS, ['retire', 'reject', 'void']);
  assert.deepEqual(MEMORY_ACTS, ['arm', 'retire', 'discard', 'accept', 'edit', 'reject', 'void']);
});

test("open('arm', …) asks the face's prepare with no words, gives its draft to the owner device, and ends ready", async () => {
  const r = rig();
  r.acts.open('arm', 'no-chasing');
  assert.deepEqual(r.a(), { act: 'arm', subject: 'no-chasing', words: '', status: 'reading', show: null, prepared: null, message: null, done: null });
  await settle();
  assert.deepEqual(r.sent(PREPARE), [{ act: 'arm', subject: 'no-chasing' }]);
  assert.deepEqual(r.owner.prepares, [draftOf('arm', 'no-chasing')], "the face's draft as it came");
  assert.equal(r.a().status, 'ready');
  assert.deepEqual(r.a().show, CARD_SHOW);
  assert.deepEqual(r.a().prepared, preparedOf(draftOf('arm', 'no-chasing')));
});

test("open('retire', …) draws the content and waits for words; the words quiet for ACT_QUIET_MS ask prepare once, trimmed", async () => {
  const r = rig();
  r.acts.open('retire', 'no-chasing');
  await settle();
  assert.equal(r.a().status, 'words');
  assert.deepEqual(r.a().show, CARD_SHOW, 'the content drawn');
  assert.equal(r.a().prepared, null, 'nothing prepared');
  assert.deepEqual(r.owner.prepares, []);
  r.acts.words('  no longer');
  assert.equal(r.a().words, '  no longer', 'the words as typed');
  assert.deepEqual([...r.timers.values()].map(t => t.ms), [ACT_QUIET_MS]);
  r.acts.words('  no longer true ');
  assert.deepEqual([...r.timers.values()].map(t => t.ms), [ACT_QUIET_MS], 'typing again before the quiet ends: one timer');
  assert.equal(r.sent(PREPARE).length, 1, 'nothing asked before the quiet');
  r.fire();
  await settle();
  assert.deepEqual(r.sent(PREPARE), [{ act: 'retire', subject: 'no-chasing' }, { act: 'retire', subject: 'no-chasing', words: 'no longer true' }], 'asked once, the words trimmed');
  assert.deepEqual(r.owner.prepares, [draftOf('retire', 'no-chasing')]);
  assert.equal(r.a().status, 'ready');
  assert.equal(r.a().words, '  no longer true ', 'the box keeps what was typed');
});

test('words that are only spaces ask nothing; words typed while the read is out are asked once it lands', async () => {
  const r = rig();
  r.acts.open('void', 'd-20261114-0a1b2c3d');
  await settle();
  r.acts.words('   ');
  r.fire();
  await settle();
  assert.equal(r.sent(PREPARE).length, 1);
  assert.equal(r.a().status, 'words');

  const s = rig();
  const release = s.hold(PREPARE);
  s.acts.open('reject', 'p-20261115-0a1b2c3d');
  s.acts.words('not a pattern');
  assert.equal(s.a().status, 'reading');
  release();
  await settle();
  assert.deepEqual(s.sent(PREPARE).at(-1), { act: 'reject', subject: 'p-20261115-0a1b2c3d', words: 'not a pattern' });
  assert.equal(s.a().status, 'ready');
});

test('words typed after the act is ready drop what was prepared until they are asked again', async () => {
  const r = rig();
  r.acts.open('retire', 'no-chasing');
  await settle();
  r.acts.words('first');
  r.fire();
  await settle();
  assert.equal(r.a().status, 'ready');
  r.acts.words('second');
  assert.equal(r.a().status, 'words');
  assert.equal(r.a().prepared, null);
  r.acts.go();
  await settle();
  assert.equal(r.owner.signs.length, 0, 'nothing signed while the words are not asked');
  r.fire();
  await settle();
  assert.equal(r.a().status, 'ready');
  r.acts.go();
  await settle();
  assert.deepEqual(r.sent(ACT).map(b => b.words), ['second'], 'the words prepared are the words posted');
});

test('go signs once and posts the act with its words and envelope; a 200 ok is done and asks the reads again', async () => {
  const r = rig();
  r.acts.open('retire', 'no-chasing');
  await settle();
  r.acts.words(' no longer true\n');
  r.fire();
  await settle();
  r.acts.go();
  assert.equal(r.a().status, 'signing');
  r.acts.go();
  await settle();
  assert.equal(r.owner.signs.length, 1, 'signed once');
  assert.deepEqual(r.owner.signs[0], preparedOf(draftOf('retire', 'no-chasing')));
  assert.deepEqual(r.sent(ACT), [{ act: 'retire', subject: 'no-chasing', words: 'no longer true', envelope: ENVELOPE }], 'posted once');
  assert.equal(r.a().status, 'done');
  assert.deepEqual(r.a().done, { ok: true, act: 'retire', subject: 'no-chasing' });
  assert.deepEqual(r.done, ['retire']);
  r.acts.go();
  await settle();
  assert.equal(r.sent(ACT).length, 1, 'done: nothing more');
});

test('an act that takes no words posts none', async () => {
  const r = rig();
  r.acts.open('arm', 'no-chasing');
  await settle();
  r.acts.go();
  r.acts.go();
  await settle();
  assert.deepEqual(r.sent(ACT), [{ act: 'arm', subject: 'no-chasing', envelope: ENVELOPE }]);
  assert.equal(r.owner.signs.length, 1);
});

test("a refusal of the face's prepare ends refused with the body's error; of the act, with the Account's sentence or the error", async () => {
  const r = rig();
  r.queue(PREPARE, { status: 409, body: { ok: false, error: 'lesson no-chasing is armed: only a card that is neither armed nor refused is armed.' } });
  r.acts.open('arm', 'no-chasing');
  await settle();
  assert.equal(r.a().status, 'refused');
  assert.equal(r.a().message, 'lesson no-chasing is armed: only a card that is neither armed nor refused is armed.');
  assert.deepEqual(r.owner.prepares, []);

  const s = rig();
  s.queue(ACT, { status: 409, body: { ok: false, error: 'it was signed too long ago: prepare it again' } });
  s.acts.open('arm', 'no-chasing');
  await settle();
  s.acts.go();
  await settle();
  assert.equal(s.a().status, 'refused');
  assert.equal(s.a().message, 'it was signed too long ago: prepare it again');
  assert.deepEqual(s.done, [], 'nothing done, nothing read again');

  const t = rig();
  t.queue(ACT, { status: 401, body: { ok: false, error: 'the signature does not match the instruction', refusal: { code: 'E_ACCOUNT_BAD_SIGNATURE', message: 'the signature does not match the instruction' } } });
  t.acts.open('arm', 'no-chasing');
  await settle();
  t.acts.go();
  await settle();
  assert.equal(t.a().message, 'the signature does not match the instruction');

  // the face's own refusal with no words of its own: the owner's Refused
  const u = rig();
  u.queue(ACT, { status: 0, body: {} });
  u.acts.open('arm', 'no-chasing');
  await settle();
  u.acts.go();
  await settle();
  assert.equal(u.a().status, 'refused');
  assert.equal(sayOf(u.a().message), 'Refused');
});

test("a refused signature has the page learn its standing again; another refusal does not", async () => {
  const BAD = { status: 401, body: { ok: false, error: 'the signature does not match the instruction', refusal: { code: 'E_ACCOUNT_BAD_SIGNATURE', message: 'the signature does not match the instruction' } } };
  const r = rig();
  r.store.dispatch('ownerStanding', { role: 'signs', kid: 'k1' });
  let readies = 0;
  r.owner.ready = async () => { readies += 1; };
  r.queue(ACT, BAD);
  r.acts.open('arm', 'no-chasing');
  await settle();
  r.acts.go();
  await settle();
  assert.equal(readies, 1, 'the standing read again once');
  assert.equal(r.a().status, 'refused');
  assert.equal(r.a().message, 'the signature does not match the instruction');

  const s = rig();
  s.store.dispatch('ownerStanding', { role: 'signs', kid: 'k1' });
  let others = 0;
  s.owner.ready = async () => { others += 1; };
  s.queue(ACT, { status: 409, body: { ok: false, error: 'it was signed too long ago: prepare it again' } });
  s.acts.open('arm', 'no-chasing');
  await settle();
  s.acts.go();
  await settle();
  assert.equal(s.a().status, 'refused');
  assert.equal(others, 0, 'a refusal not about the standing reads nothing');
});

test('a refusal the face marks changed asks the reads again; its words alone do not', async () => {
  const r = rig();
  r.queue(ACT, { status: 409, body: { ok: false, error: 'the card changed while it was shown: nothing was armed.', changed: true } });
  r.acts.open('arm', 'no-chasing');
  await settle();
  r.acts.go();
  await settle();
  assert.equal(r.a().status, 'refused');
  assert.equal(r.a().message, 'the card changed while it was shown: nothing was armed.');
  assert.deepEqual(r.done, ['arm'], 'the page is stale by its own account');

  const s = rig();
  s.queue(ACT, { status: 409, body: { ok: false, error: 'it changed while it was shown: nothing was done' } });
  s.acts.open('arm', 'no-chasing');
  await settle();
  s.acts.go();
  await settle();
  assert.equal(s.a().status, 'refused');
  assert.deepEqual(s.done, [], 'the sentence is not matched: only changed: true reads again');
});

test("a prepare the Account did not answer - the proxy's 503 { unreachable }, of the face's prepare or the Account's - says so in the face's words", async () => {
  const NO_ANSWER = 'The Account did not answer: nothing was signed';
  const r = rig();
  r.owner.prepareAnswer = { status: 503, body: { ok: false, unreachable: 'ECONNREFUSED' } };
  r.acts.open('arm', 'no-chasing');
  await settle();
  assert.equal(r.a().status, 'refused');
  assert.equal(sayOf(r.a().message), NO_ANSWER);

  const s = rig();
  s.queue(PREPARE, { status: 503, body: { ok: false, unreachable: 'disabled' } });
  s.acts.open('arm', 'no-chasing');
  await settle();
  assert.equal(s.a().status, 'refused');
  assert.equal(sayOf(s.a().message), NO_ANSWER);

  // a prepare refused with a sentence of its own keeps it
  const t = rig();
  t.owner.prepareAnswer = { status: 409, body: { ok: false, refusal: { code: 'E_ACCOUNT_THRESHOLD', message: 'this account needs 2 signers; 1 signed' } } };
  t.acts.open('arm', 'no-chasing');
  await settle();
  assert.equal(t.a().message, 'this account needs 2 signers; 1 signed');
});

test("the Account's prepare refused ends refused with its words; a signer that will not sign ends refused with its words", async () => {
  const r = rig();
  r.owner.prepareAnswer = { status: 409, body: { ok: false, refusal: { code: 'E_ACCOUNT_BAD_ACTION', message: 'attest names a subject of 1 to 80 letters, digits or . _ : -' } } };
  r.acts.open('arm', 'no-chasing');
  await settle();
  assert.equal(r.a().status, 'refused');
  assert.equal(r.a().message, 'attest names a subject of 1 to 80 letters, digits or . _ : -');

  const s = rig();
  s.owner.signAnswer = { ok: false, said: said('owner.notSigning') };
  s.acts.open('arm', 'no-chasing');
  await settle();
  s.acts.go();
  await settle();
  assert.equal(s.a().status, 'refused');
  assert.equal(sayOf(s.a().message), 'This browser does not sign for the account.');
  assert.deepEqual(s.sent(ACT), [], 'nothing posted');
});

test('open again on a refusal keeps the words and prepares with them at once', async () => {
  const r = rig();
  r.queue(ACT, { status: 409, body: { ok: false, error: 'it was signed too long ago: prepare it again' } });
  r.acts.open('reject', 'p-20261115-0a1b2c3d');
  await settle();
  r.acts.words('not a pattern');
  r.fire();
  await settle();
  r.acts.go();
  await settle();
  assert.equal(r.a().status, 'refused');
  r.acts.open('reject', 'p-20261115-0a1b2c3d');
  assert.equal(r.a().words, 'not a pattern');
  await settle();
  assert.equal(r.a().status, 'ready');
  assert.deepEqual(r.sent(PREPARE).at(-1), { act: 'reject', subject: 'p-20261115-0a1b2c3d', words: 'not a pattern' });
  // another act or subject starts with no words
  r.acts.open('reject', 'p-20261115-1b2c3d4e');
  assert.equal(r.a().words, '');
});

test('close empties the slot, and a late answer of either route changes nothing', async () => {
  const r = rig();
  const release = r.hold(PREPARE);
  r.acts.open('arm', 'no-chasing');
  r.acts.close();
  assert.equal(r.a(), null);
  release();
  await settle();
  assert.equal(r.a(), null, 'the late prepare changed nothing');
  assert.deepEqual(r.owner.prepares, [], 'and asked the Account nothing');

  const s = rig();
  s.acts.open('arm', 'no-chasing');
  await settle();
  const out = s.hold(ACT);
  s.acts.go();
  await settle();
  s.acts.close();
  out();
  await settle();
  assert.equal(s.a(), null, 'the late act changed nothing in the drawer');
  assert.deepEqual(s.done, ['arm'], 'a success that lands after the drawer was closed still reads the memory again');

  const u = rig();
  u.acts.open('arm', 'no-chasing');
  await settle();
  u.queue(ACT, { status: 409, body: { ok: false, error: 'this was done already' } });
  const late = u.hold(ACT);
  u.acts.go();
  await settle();
  u.acts.close();
  late();
  await settle();
  assert.deepEqual(u.done, [], 'a late refusal that is not a change reads nothing again');

  // a quiet timer standing when it closes asks nothing
  const t = rig();
  t.acts.open('retire', 'no-chasing');
  await settle();
  t.acts.words('why');
  t.acts.close();
  assert.equal(t.timers.size, 0);
  t.fire();
  await settle();
  assert.equal(t.sent(PREPARE).length, 1);
});

test('the host opens only an act of its own list on a subject of that act\'s shape', async () => {
  const r = rig();
  for (const [act, subject] of [['delete', 'no-chasing'], ['arm', 'No-Chasing'], ['accept', 'no-chasing'], ['void', 'no-chasing'], ['arm', '<b>x</b>'], ['arm', 'constructor x'], ['toString', 'no-chasing'], ['arm', undefined]]) {
    r.acts.open(act, subject);
    assert.equal(r.a(), null, `${act} ${subject}`);
  }
  assert.deepEqual(r.posts, []);
  assert.equal(actFits('accept', 'p-20261115-0a1b2c3d'), true);
  assert.equal(actFits('void', 'd-20261114-0a1b2c3d'), true);
  assert.equal(actFits('retire', 'no-chasing'), true);
  assert.equal(actFits('hasOwnProperty', 'no-chasing'), false);
});

test("the acts a row's state allows, as the face's prepare allows them", () => {
  assert.deepEqual(lessonActs(armedLesson()), ['retire']);
  assert.deepEqual(lessonActs(changedLesson()), ['arm', 'retire', 'discard']);
  assert.deepEqual(lessonActs(unarmedLesson()), ['arm']);
  assert.deepEqual(lessonActs(retiredLesson()), ['arm']);
  assert.deepEqual(lessonActs(refusedLesson()), []);
  assert.deepEqual(lessonActs(brokenLesson()), ['arm', 'retire']);
  assert.deepEqual(lessonActs(brokenLesson({ file: { sha256: 'c'.repeat(64), text: 'x', fault: 'no front matter' } })), ['retire'], 'a file that does not parse is not armed');
  assert.deepEqual(lessonActs(armedLesson({ id: 'Not-A-Lesson' })), [], 'an id off the lesson shape: none');
  // a text the read says is cut: no key for the act that would show it
  const cutCopy = copy => ({ ...copy, cut: true });
  assert.deepEqual(lessonActs(unarmedLesson({ file: cutCopy(unarmedLesson().file) })), [], 'an arm shows the file');
  assert.deepEqual(lessonActs(armedLesson({ armed: cutCopy(armedLesson().armed) })), [], 'a retire shows the armed copy');
  assert.deepEqual(lessonActs(changedLesson({ file: cutCopy(changedLesson().file) })), ['retire'], 'a changed card whose file is cut: retire alone');
  assert.deepEqual(lessonActs(changedLesson({ armed: cutCopy(changedLesson().armed) })), ['arm'], 'a changed card whose armed copy is cut: arm alone');
  const [fresh, change, retire] = memoryWaitingProposals();
  assert.deepEqual(proposalActs(fresh), ['accept', 'reject', 'edit']);
  assert.deepEqual(proposalActs(change), ['accept', 'reject', 'edit']);
  assert.deepEqual(proposalActs(retire), ['accept', 'reject'], 'a retirement is not edited');
  const [owned, , voided] = memoryDecisionRows();
  assert.deepEqual(decisionActs(owned), ['void']);
  assert.deepEqual(decisionActs(voided), []);
});
