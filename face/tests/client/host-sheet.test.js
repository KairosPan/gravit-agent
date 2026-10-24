// The sheet engine (spec 2026-10-22 §6.3, plan 2 task 5): host/sheet.js over a fake owner — prepare answering as the Account's
// generic branch does (the prepared-watch.json shape, a `deadline` where the rig asks for one, the money types' ten minutes),
// submit recording the preparation it was handed — against a fake clock and recorded timers. The Account's own sheet
// (docs/research/2026-10-22-account-owner-path-map.md §3, `quoteDialog`): re-prepare on a change after a quiet spell, a changed
// form re-prepares instead of signing, the countdown, re-prepare at zero, re-prepare under thirty seconds before signing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStore } from '../../client/js/store.js';
import { reducers } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { startSheet, PREPARE_QUIET_MS, RESIGN_UNDER_MS, FRESH_MS } from '../../client/js/host/sheet.js';

const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0)); };
const watch = () => JSON.parse(readFileSync(new URL('../fixtures/account/prepared-watch.json', import.meta.url), 'utf8'));
const START = 1_792_854_000_000;
const TEN_MINUTES = 600_000;
const SEED = { venue: 'paper-a', usd: '500' };
const DRAFT = { type: 'topUpPaper', venue: 'paper-a', usd: '500' };
const REQUOTE = { status: 409, body: { ok: false, refusal: { ok: false, code: 'E_ACCOUNT_EXPIRED', layer: 'account', message: 'this order was good for ten minutes after it was prepared: prepare it again' } } };
const BAD = { status: 409, body: { ok: false, refusal: { ok: false, code: 'E_ACCOUNT_BAD_ACTION', layer: 'account', message: 'not an instruction this account knows' } } };
const TAKEN = { status: 200, body: { ok: true, kind: 'account', summary: 'paper-a topped up by $500' } };

// a deferred answer the test resolves by hand
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

// the fake owner: prepare answers the Account's prepared shape for the draft, a fresh nonce each ask (and `deadline` = now +
// `deadlineMs` when the rig names one); `prepareWith` / `submitWith` queue answers (a body or a deferred's promise) ahead of it
function fakeOwner(clock, { deadlineMs = null } = {}) {
  const o = { drafts: [], envelopes: [], prepareWith: [], submitWith: [], nonce: 1_792_854_221_986 };
  o.prepare = draft => {
    o.drafts.push(draft);
    if (o.prepareWith.length) return Promise.resolve(o.prepareWith.shift());
    const body = watch();
    const action = { ...draft, nonce: o.nonce++, ...(deadlineMs === null ? {} : { deadline: clock.t + deadlineMs }) };
    body.action = action;
    body.shown = Object.entries(action).filter(([k]) => k !== 'type').map(([name, value]) => ({ name, value: String(value) }));
    return Promise.resolve({ status: 200, body });
  };
  o.submit = prepared => {
    o.envelopes.push(prepared);
    return Promise.resolve(o.submitWith.length ? o.submitWith.shift() : TAKEN);
  };
  return o;
}

// recorded timers on a fake clock: `advance(ms)` runs every timer that falls due, in order, moving the clock to each
function fakeTimers(clock) {
  const pending = new Map();
  let next = 1;
  return {
    pending,
    schedule: (fn, ms) => { const handle = next++; pending.set(handle, { fn, at: clock.t + ms }); return handle; },
    cancelTimer: handle => { pending.delete(handle); },
    async advance(ms) {
      const end = clock.t + ms;
      for (;;) {
        const due = [...pending.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!due) break;
        pending.delete(due[0]);
        clock.t = due[1].at;
        due[1].fn();
        await settle();
      }
      clock.t = end;
    },
  };
}

function rig(opts = {}) {
  const clock = { t: START };
  const store = createStore({ initial: emptyState(), reducers });
  const types = [];
  store.subscribe((_, type) => types.push(type));
  const owner = fakeOwner(clock, opts);
  const timers = fakeTimers(clock);
  const done = [], changes = [];
  const sheet = startSheet({
    store, owner, schedule: timers.schedule, cancelTimer: timers.cancelTimer, now: () => clock.t,
    afterAction: (kind, body) => done.push([kind, body]), onChange: (...a) => changes.push(a),
  });
  return { store, owner, timers, clock, sheet, types, done, changes, s: () => store.get().sheet };
}

test('a complete sheet prepares at once and an incomplete one says what is missing', async () => {
  assert.deepEqual([PREPARE_QUIET_MS, RESIGN_UNDER_MS, FRESH_MS], [300, 30_000, 3_000], "the Account's own spells");
  const r = rig();
  r.sheet.open('topUp', SEED);
  assert.deepEqual(r.owner.drafts, [DRAFT], 'asked at once, the draft from the seed');
  assert.equal(r.s().status, 'asking');
  assert.equal(r.s().kind, 'topUp');
  assert.deepEqual(r.s().fields.map(f => [f.name, f.value]), [['usd', '500']], "the sheet-view's fields from the seed");
  await settle();
  assert.equal(r.s().status, 'ready');
  assert.equal(r.s().prepared.action.type, 'topUpPaper');
  assert.equal(r.s().preparedAt, START);
  assert.equal(r.s().asked, JSON.stringify(DRAFT));
  assert.equal(r.s().deadline, null, 'no deadline on a preparation without one');
  assert.equal(r.timers.pending.size, 0, 'no countdown without a deadline');

  r.sheet.open('topUp', { venue: 'paper-a' });
  assert.equal(r.s().status, 'incomplete');
  assert.equal(r.s().words, 'Type an amount');
  assert.equal(r.s().prepared, null);
  assert.equal(r.owner.drafts.length, 1, 'nothing asked for an incomplete form');
});

test('a change prepares after 300 ms of quiet, once', async () => {
  const r = rig();
  r.sheet.open('topUp', { venue: 'paper-a' });
  r.sheet.change('usd', '1');
  assert.equal(r.s().fields[0].value, '1');
  await r.timers.advance(200);
  r.sheet.change('usd', '12');
  await r.timers.advance(299);
  assert.equal(r.owner.drafts.length, 0, 'a new change put the ask off');
  await r.timers.advance(1);
  assert.deepEqual(r.owner.drafts, [{ ...DRAFT, usd: '12' }], 'once, the form as it stands');
  await r.timers.advance(5_000);
  assert.equal(r.owner.drafts.length, 1, 'once only');
  assert.equal(r.s().status, 'ready');
  assert.deepEqual(r.changes, [['topUp', 'usd', '1'], ['topUp', 'usd', '12']], 'onChange after every change');
});

test('a changed form is prepared again, not signed', async () => {
  const r = rig();
  r.sheet.open('topUp', SEED);
  await settle();
  const first = r.s().prepared;
  r.sheet.change('usd', '600');
  assert.equal(r.s().status, 'ready', 'the field changes; the shown preparation stays');
  assert.equal(r.s().asked, JSON.stringify(DRAFT), 'asked is what was asked');
  await r.sheet.submit();
  assert.equal(r.owner.envelopes.length, 0, 'nothing signed');
  assert.deepEqual(r.owner.drafts, [DRAFT, { ...DRAFT, usd: '600' }], 'prepared again at once');
  assert.notEqual(r.s().prepared, first);
  assert.equal(r.s().asked, JSON.stringify({ ...DRAFT, usd: '600' }));
  await r.timers.advance(PREPARE_QUIET_MS);
  assert.equal(r.owner.drafts.length, 2, 'the pending ask was the same ask: dropped');
  const second = r.s().prepared;
  await r.sheet.submit();
  assert.deepEqual(r.owner.envelopes, [second], 'the preparation of the form as it stands');
  assert.equal(second.action.usd, '600');

  // the clock is not the form: a draft that reads the clock (validUntil) is the same draft a minute on
  const k = rig();
  k.sheet.open('letIn', { address: '0x' + 'ab'.repeat(20), name: 'Claude Code' });
  await settle();
  assert.equal(k.owner.drafts[0].validUntil, START + 30 * 86_400_000);
  const letIn = k.s().prepared;
  k.clock.t += 60_000;
  await k.sheet.submit();
  assert.equal(k.owner.drafts.length, 1, 'not prepared again');
  assert.deepEqual(k.owner.envelopes, [letIn]);
});

test('a submit under thirty seconds prepares again before signing', async () => {
  const r = rig({ deadlineMs: TEN_MINUTES });
  r.sheet.open('topUp', SEED);
  await settle();
  const old = r.s().prepared;
  assert.equal(r.s().deadline, START + TEN_MINUTES);
  r.clock.t = START + TEN_MINUTES - RESIGN_UNDER_MS + 1;
  await r.sheet.submit();
  assert.equal(r.owner.drafts.length, 2, 'prepared again in the same press');
  assert.equal(r.owner.envelopes.length, 1, 'and signed');
  assert.notEqual(r.owner.envelopes[0], old, 'never the old one');
  assert.notEqual(r.owner.envelopes[0].action.nonce, old.action.nonce);
  assert.equal(r.owner.envelopes[0].action.deadline, r.clock.t + TEN_MINUTES, 'the fresh one');
  assert.equal(r.s().status, 'done');

  // thirty seconds or more: the shown one is signed as it is
  const t = rig({ deadlineMs: TEN_MINUTES });
  t.sheet.open('topUp', SEED);
  await settle();
  const shown = t.s().prepared;
  t.clock.t = START + TEN_MINUTES - RESIGN_UNDER_MS;
  await t.sheet.submit();
  assert.equal(t.owner.drafts.length, 1);
  assert.deepEqual(t.owner.envelopes, [shown]);
});

test('at zero the sheet prepares again', async () => {
  const r = rig({ deadlineMs: 5_000 });
  r.sheet.open('topUp', SEED);
  await settle();
  assert.equal(r.timers.pending.size, 1, 'the countdown while a deadline is held');
  await r.timers.advance(4_000);
  assert.equal(r.types.filter(t => t === 'sheetTick').length, 4, 'a re-render every second');
  assert.equal(r.owner.drafts.length, 1);
  await r.timers.advance(1_000);
  assert.equal(r.owner.drafts.length, 2, 'at zero, prepared again');
  assert.equal(r.s().status, 'ready');
  assert.equal(r.s().deadline, START + 5_000 + 5_000, "the new preparation's deadline");
  assert.equal(r.owner.envelopes.length, 0, 'nothing signed');
});

test('a quiet ask keeps the shown preparation until the new one lands', async () => {
  const r = rig();
  r.sheet.open('topUp', SEED);
  await settle();
  const first = r.s().prepared;
  const slow = deferred();
  r.owner.prepareWith.push(slow.promise);
  const asked = r.sheet.prepareNow({ quiet: true });
  assert.equal(r.s().status, 'ready');
  assert.equal(r.s().prepared, first, 'the shown one stays');
  const answer = watch();
  slow.resolve({ status: 200, body: answer });
  await asked;
  assert.equal(r.s().prepared, answer, 'the new one, once it landed');

  // a loud ask clears the shown preparation
  r.sheet.prepareNow();
  assert.equal(r.s().status, 'asking');
  assert.equal(r.s().prepared, null);
  await settle();

  // only the latest ask lands
  const older = deferred(), newer = deferred();
  r.owner.prepareWith.push(older.promise, newer.promise);
  const a = r.sheet.prepareNow({ quiet: true });
  const b = r.sheet.prepareNow({ quiet: true });
  const fresh = watch(), stale = watch();
  newer.resolve({ status: 200, body: fresh });
  await b;
  older.resolve({ status: 200, body: stale });
  await a;
  assert.equal(r.s().prepared, fresh, 'an older answer is dropped');
});

test('a refusal at prepare is drawn and nothing is signed', async () => {
  const r = rig();
  r.owner.prepareWith.push(BAD);
  r.sheet.open('topUp', SEED);
  await settle();
  assert.equal(r.s().status, 'refused');
  assert.equal(r.s().message, 'not an instruction this account knows');
  assert.equal(r.s().again, false);
  assert.equal(r.s().prepared, null);
  r.owner.prepareWith.push(BAD);
  await r.sheet.submit();
  assert.equal(r.owner.envelopes.length, 0, 'nothing signed');
  assert.equal(r.owner.drafts.length, 2, 'the press prepared again');
  assert.equal(r.s().status, 'refused');
});

test('a refusal with again offers Prepare again', async () => {
  const r = rig({ deadlineMs: TEN_MINUTES });
  r.sheet.open('topUp', SEED);
  await settle();
  r.owner.submitWith.push(REQUOTE);
  await r.sheet.submit();
  assert.equal(r.owner.envelopes.length, 1);
  assert.equal(r.s().status, 'refused');
  assert.equal(r.s().again, true);
  assert.equal(r.s().message, 'this order was good for ten minutes after it was prepared: prepare it again');
  assert.equal(r.done.length, 0, 'no afterAction on a refusal');
  assert.equal(r.timers.pending.size, 0, 'no countdown over a refused preparation');
  await r.sheet.again();
  assert.equal(r.owner.drafts.length, 2);
  assert.equal(r.s().status, 'ready');
  assert.equal(r.s().message, null);
  assert.equal(r.s().again, false);
});

test('done calls afterAction once with the kind and the body', async () => {
  const r = rig();
  r.sheet.open('topUp', SEED);
  await settle();
  const shown = r.s().prepared;
  const press = r.sheet.submit();
  assert.equal(r.s().status, 'signing');
  await r.sheet.submit();
  await press;
  assert.deepEqual(r.owner.envelopes, [shown], 'the shown preparation, once');
  assert.equal(r.s().status, 'done');
  assert.equal(r.s().said, 'paper-a topped up by $500');
  assert.deepEqual(r.done, [['topUp', TAKEN.body]]);
  await r.sheet.submit();
  assert.equal(r.owner.envelopes.length, 1, 'a done sheet signs nothing more');
  assert.equal(r.done.length, 1);
});

test('close cancels the timers', async () => {
  const r = rig({ deadlineMs: TEN_MINUTES });
  r.sheet.open('topUp', SEED);
  await settle();
  r.sheet.change('usd', '700');
  assert.equal(r.timers.pending.size, 2, 'the countdown and the pending ask');
  r.sheet.close();
  assert.equal(r.timers.pending.size, 0);
  assert.equal(r.s(), null);
  await r.timers.advance(TEN_MINUTES);
  assert.equal(r.owner.drafts.length, 1, 'nothing asked after close');

  // an answer for a closed sheet is dropped; open on an open sheet closes it first
  const slow = deferred();
  r.owner.prepareWith.push(slow.promise);
  r.sheet.open('topUp', SEED);
  r.sheet.close();
  slow.resolve({ status: 200, body: watch() });
  await settle();
  assert.equal(r.s(), null);
  r.sheet.open('topUp', SEED);
  await settle();
  r.sheet.change('usd', '800');
  r.sheet.open('topUp', { venue: 'paper-b' });
  assert.equal(r.timers.pending.size, 0, 'the old sheet’s timers cancelled');
  assert.equal(r.s().seed.venue, 'paper-b');
});
