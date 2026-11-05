// The owner's words (spec 2026-10-22 §6.3, plan 2 Task 4): the standing's line and its key, the Devices rows, the What you
// sign lines, the countdown, and the Account's own reading of an answer — refused or not, why, what it offers, what it said —
// over the stand-in's fixtures (tests/fixtures/account/) and the Account's answer shapes (the owner-path map §2.6–§2.7).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  standingWords, devicesOf, whatYouSignLines, goodForWords, refusedAt, whyOf, refusalOf, saidOf,
} from '../../client/js/host/owner-view.js';
import { spoken } from './helpers/spoken.js';

// a fixture of the stand-in's answers, parsed afresh for every call so no test sees another's copy
const fx = name => JSON.parse(readFileSync(new URL(`../fixtures/account/${name}.json`, import.meta.url), 'utf8'));
const owner = (role, kid = '') => ({ role, kid, refusal: null, busy: false });
const refusal = (status, code, message) => ({ status, body: { ok: false, refusal: { ok: false, code, layer: 'door', message } } });

test('standingWords: the six standings, each its line and its key', () => {
  assert.deepEqual(standingWords(owner('signs', 'a5048199a8081854')), { line: 'This page signs for the account', key: null });
  assert.deepEqual(standingWords(owner('pending', 'a5048199a8081854')), { line: 'Waiting to be let in — a browser that signs lets it in, under Settings › Devices', key: null });
  assert.deepEqual(standingWords(owner('needs-code')), { line: 'Pair with the code the Account printed in its terminal', key: 'pair' });
  assert.deepEqual(standingWords(owner('signed-out')), { line: 'Signed out', key: 'signIn' });
  assert.deepEqual(standingWords(owner('none')), { line: 'This browser cannot sign for the account', key: null });
  assert.deepEqual(standingWords(owner('unknown')), { line: '', key: null });
  assert.deepEqual(standingWords(null), { line: '', key: null });
});

test('devicesOf: the owners with this page marked, and the devices waiting', () => {
  const page = fx('account');
  assert.deepEqual(devicesOf(page, owner('signs', 'a5048199a8081854')), {
    owners: [{ id: 'device:a5048199a8081854', label: 'Stand-in seed key', kind: 'device', here: true }],
    pending: [],
  });
  page.signers.pendingDevices = [{ kid: '0123456789abcdef', at: '2026-10-22T07:40:00.000Z' }];
  assert.deepEqual(devicesOf(page, owner('pending', '0123456789abcdef')), {
    owners: [{ id: 'device:a5048199a8081854', label: 'Stand-in seed key', kind: 'device', here: false }],
    pending: [{ kid: '0123456789abcdef', at: '2026-10-22T07:40:00.000Z' }],
  });
  // a page with no kid marks nothing; a body that is not the page is no devices
  assert.equal(devicesOf(page, owner('unknown')).owners[0].here, false);
  assert.deepEqual(devicesOf({ ok: false }, owner('signs', 'a5048199a8081854')), { owners: [], pending: [] });
});

test('whatYouSignLines: every shown field as name: value, in the order the Account shows them', () => {
  assert.deepEqual(whatYouSignLines(fx('prepared-watch')), ['venue: ex', 'symbol: BTC/USDT', 'on: true', 'nonce: 1792854221986']);
  assert.equal(whatYouSignLines(fx('prepared-order')).length, 18);
  assert.deepEqual(whatYouSignLines(null), []);
});

test('goodForWords: minutes and seconds while the signature is good, nothing at or under zero', () => {
  assert.equal(goodForWords(125_000), 'Your signature is good for 2:05 more.');
  assert.equal(goodForWords(600_000), 'Your signature is good for 10:00 more.');
  assert.equal(goodForWords(400), 'Your signature is good for 0:01 more.');
  assert.equal(goodForWords(0), '');
  assert.equal(goodForWords(-3_000), '');
  assert.equal(goodForWords(Number.NaN), '');
});

test('a result that is a refusal is refused on a 200', () => {
  const r = { status: 200, body: { ok: true, kind: 'result', result: { ok: false, code: 'E_CARD_REJECTED', message: 'You rejected it; nothing moved' } } };
  assert.equal(refusedAt(r), true);
  assert.equal(whyOf(r), 'You rejected it; nothing moved');
});

test('refusedAt: the Account\'s own test, clause by clause', () => {
  assert.equal(refusedAt(null), true);
  assert.equal(refusedAt({ status: 200 }), true);
  assert.equal(refusedAt(refusal(409, 'E_ACCOUNT_REQUOTE', 'the price moved')), true);
  assert.equal(refusedAt({ status: 0, body: { ok: false, error: 'The account did not answer. Try again.' } }), true);
  assert.equal(refusedAt({ status: 500, body: {} }), true);
  assert.equal(refusedAt({ status: 200, body: { ok: true, kind: 'order', order: { id: 'ord-0011', status: 'open' } } }), false);
  assert.equal(refusedAt({ status: 200, body: { ok: true, kind: 'result', result: { ok: true } } }), false);
  assert.equal(refusedAt({ status: 200, body: { ok: true, kind: 'result', result: null } }), false);
});

test('whyOf: the refusal\'s sentence, else the error, else the result\'s message, else nothing', () => {
  assert.equal(whyOf(refusal(409, 'E_ACCOUNT_NONCE', 'this nonce was used')), 'this nonce was used');
  assert.equal(whyOf({ status: 0, body: { ok: false, error: 'The account did not answer. Try again.' } }), 'The account did not answer. Try again.');
  assert.equal(whyOf({ status: 409, body: { ok: false } }), '');
  assert.equal(whyOf(null), '');
});

test('refusalOf: Prepare again for a requote or an expiry, the standing for a bad signature, Refused for no words', () => {
  assert.deepEqual(refusalOf(refusal(409, 'E_ACCOUNT_REQUOTE', 'the price moved past what was signed: prepare again')),
    { message: 'the price moved past what was signed: prepare again', again: true, standing: false });
  assert.deepEqual(refusalOf(refusal(409, 'E_ACCOUNT_EXPIRED', 'this instruction is good for 10 minutes')),
    { message: 'this instruction is good for 10 minutes', again: true, standing: false });
  assert.deepEqual(refusalOf(refusal(401, 'E_ACCOUNT_BAD_SIGNATURE', 'the signature does not match the instruction')),
    { message: 'the signature does not match the instruction', again: false, standing: true });
  // the card's 409 under the same code says nothing about the device
  assert.deepEqual(refusalOf(refusal(409, 'E_ACCOUNT_BAD_SIGNATURE', 'this approval names a different instruction than the one the card holds')),
    { message: 'this approval names a different instruction than the one the card holds', again: false, standing: false });
  assert.deepEqual(refusalOf({ status: 200, body: { ok: true, kind: 'result', result: { ok: false, code: 'E_CARD_REJECTED', message: 'You rejected it; nothing moved' } } }),
    { message: 'You rejected it; nothing moved', again: false, standing: false });
  assert.deepEqual(spoken(refusalOf({ status: 409, body: { ok: false } })), { message: 'Refused', again: false, standing: false });
});

test('saidOf: an order by its id and its status, the Account\'s summary, Done for a result', () => {
  const order = status => ({ ok: true, kind: 'order', order: { id: 'ord-0011', status } });
  assert.equal(spoken(saidOf(order('open'))), 'ord-0011 · open on the book');
  assert.equal(spoken(saidOf(order('filled'))), 'ord-0011 · filled');
  assert.equal(spoken(saidOf(order('canceled'))), 'ord-0011 · canceled');
  assert.equal(spoken(saidOf(order('pending'))), 'ord-0011 · pending');
  assert.equal(saidOf({ ok: true, kind: 'account', summary: 'agent key "Claude Code" authorised until 2026-11-21' }), 'agent key "Claude Code" authorised until 2026-11-21');
  assert.equal(spoken(saidOf({ ok: true, kind: 'result', result: { ok: true } })), 'Done');
  assert.equal(saidOf(null), '');
});

test("what a taken action said is in the table's order — an order's id and status, a sign-out's Guard after its words — read when drawn", async () => {
  const { withTable, sayOf, said } = await import('../../client/js/i18n/words.js');
  const { guardFirstDone, guardFirstRefused } = await import('../../client/js/host/sheet-view.js');
  const line = saidOf({ ok: true, kind: 'order', order: { id: 'ord-1', status: 'open' } });
  assert.equal(withTable({ 'owner.order.said': '{status}: {id}', 'owner.order.open': 'on the book' }, () => sayOf(line)), 'on the book: ord-1');
  const done = guardFirstDone(line);
  assert.equal(sayOf(done), 'ord-1 · open on the book. Guard is on.');
  assert.equal(withTable({ 'sheet.guard.done': 'Guard is on: {said}{stop}', 'sheet.guard.stop': '!', 'owner.order.said': '{status} {id}' }, () => sayOf(done)), 'Guard is on: open on the book ord-1!',
    'the words inside follow the table too');
  assert.equal(sayOf(guardFirstDone('Signed out.')), 'Signed out. Guard is on.', 'a sentence ended needs no stop');
  assert.equal(withTable({ 'sheet.guard.refused': '{words}{stop} — not signed out', 'sheet.guard.noAnswer': 'no answer' }, () => sayOf(guardFirstRefused(''))), 'no answer. — not signed out');
  assert.equal(sayOf(guardFirstRefused(said('sheet.guard.noAnswer'))), 'Not signed out: the account did not answer. Guard is on.');
});
