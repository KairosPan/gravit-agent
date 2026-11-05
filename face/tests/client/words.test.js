// The words module (plan 6, spec §5.10): t reads the active table's value with its params filled raw, th the same as HTML
// with each param escaped unless it is rawHtml, tn and thn a plural's form by its count; withTable reads another table for
// a while, a key it lacks falling back to EN.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { t, th, tn, thn, rawHtml, withTable, setTable, wordsEpoch, said, saidn, sayOf, isSaid, isLine, saidError } from '../../client/js/i18n/words.js';
import { EN } from '../../client/js/i18n/en.js';

const PROBE = Object.freeze({
  'probe.greet': 'Hello {name} and {name}',
  'probe.why': "Can't run · {why}",
  'probe.jobs': { one: '1 job running', other: '{n} jobs running' },
  'probe.items': { one: '{n} item in {where}', other: '{n} items in {where}' },
});

test('t reads the value and fills its params raw', () => {
  assert.equal(t('common.save'), 'Save');
  assert.equal(withTable(PROBE, () => t('probe.greet', { name: '<b>' })), 'Hello <b> and <b>');
});

test('a missing key reads as the key', () => {
  assert.equal(t('no.such.key'), 'no.such.key');
  assert.equal(th('no.such.key'), 'no.such.key');
});

test('a missing param leaves its {name}', () => {
  assert.equal(withTable(PROBE, () => t('probe.greet', {})), 'Hello {name} and {name}');
  assert.equal(withTable(PROBE, () => t('probe.greet')), 'Hello {name} and {name}');
});

test('th inserts the value verbatim and escapes each param', () => {
  assert.equal(withTable(PROBE, () => th('probe.why', { why: '<b>' })), "Can't run · &lt;b&gt;");
  assert.equal(withTable(PROBE, () => th('probe.why', { why: `"'&` })), "Can't run · &quot;&#39;&amp;");
  assert.equal(th('common.cancel'), 'Cancel');
});

test('rawHtml passes markup through th', () => {
  assert.equal(withTable(PROBE, () => th('probe.why', { why: rawHtml('<b>x</b>') })), "Can't run · <b>x</b>");
  assert.ok(Object.isFrozen(rawHtml('<i>')));
  assert.equal(withTable(PROBE, () => th('probe.why', { why: { html: '<b>' } })), "Can't run · [object Object]", 'only rawHtml is markup');
});

test('tn and thn pick one for 1 and other otherwise, {n} the count unless given', () => {
  withTable(PROBE, () => {
    assert.equal(tn('probe.jobs', 1), '1 job running');
    assert.equal(tn('probe.jobs', 2), '2 jobs running');
    assert.equal(tn('probe.jobs', 0), '0 jobs running');
    assert.equal(tn('probe.jobs', 3, { n: '3,000' }), '3,000 jobs running');
    assert.equal(tn('probe.items', 1, { where: '<a>' }), '1 item in <a>');
    assert.equal(thn('probe.items', 2, { where: '<a>' }), '2 items in &lt;a&gt;');
    assert.equal(thn('probe.items', 2, { where: rawHtml('<a>') }), '2 items in <a>');
  });
  assert.equal(tn('time.ago.minutes', 1), '1 minute ago');
  assert.equal(tn('time.ago.days', 4), '4 days ago');
});

test('withTable reads another table, falls back to EN for a missing key, restores EN after, and moves wordsEpoch', () => {
  const before = wordsEpoch();
  let inside;
  const out = withTable({ 'common.save': '保存' }, () => {
    inside = wordsEpoch();
    return [t('common.save'), t('common.cancel')];
  });
  assert.deepEqual(out, ['保存', 'Cancel']);
  assert.notEqual(inside, before);
  assert.notEqual(wordsEpoch(), inside);
  assert.equal(t('common.save'), EN['common.save']);
  assert.throws(() => withTable({}, () => { throw new Error('boom'); }), /boom/);
  assert.equal(t('common.save'), 'Save', 'restored after a throw');
});

test('setTable moves wordsEpoch only when the table changes, and reads the new table until it is set back', () => {
  const zh = { 'common.save': '保存' };
  const start = wordsEpoch();
  setTable(EN);
  assert.equal(wordsEpoch(), start, 'the same table: no new epoch, so no memo is thrown away');
  try {
    setTable(zh);
    const on = wordsEpoch();
    assert.notEqual(on, start);
    assert.equal(t('common.save'), '保存');
    assert.equal(t('common.cancel'), 'Cancel', 'a key the table lacks reads from EN');
    setTable(zh);
    assert.equal(wordsEpoch(), on);
    assert.equal(withTable(zh, () => wordsEpoch()), on, 'withTable under the table already active moves nothing');
  } finally {
    setTable(EN);
  }
  assert.equal(t('common.save'), 'Save');
});

test('setTable refuses a table that is not an object, and keeps the one it had', () => {
  const start = wordsEpoch();
  for (const bad of [null, undefined, 'zh', 1, true]) assert.throws(() => setTable(bad), TypeError, String(bad));
  assert.equal(wordsEpoch(), start);
  assert.equal(t('common.save'), 'Save');
});

test('a null or missing param value reads as nothing in t and th alike; a count is read as a number', () => {
  withTable(PROBE, () => {
    assert.equal(t('probe.why', { why: null }), "Can't run · ");
    assert.equal(th('probe.why', { why: undefined }), "Can't run · ");
    assert.equal(t('probe.why', { why: 0 }), "Can't run · 0");
    assert.equal(tn('probe.jobs', '1'), '1 job running', "the string '1' is one");
    assert.equal(tn('probe.jobs', '2'), '2 jobs running');
  });
});

// a line the store keeps (plan 7 Task 2): its key and params, read in the table that stands when it is drawn
test('said reads the table standing at sayOf, not the one at said', () => {
  const line = said('jobs.dropped');
  assert.equal(sayOf(line), EN['jobs.dropped']);
  assert.equal(withTable({ 'jobs.dropped': '…之前的输出已丢弃…' }, () => sayOf(line)), '…之前的输出已丢弃…');
  const made = withTable(PROBE, () => said('probe.why', { why: 'x' }));
  assert.equal(sayOf(made), 'probe.why', 'made under the probe, read under EN: EN lacks it');
  assert.equal(withTable(PROBE, () => sayOf(made)), "Can't run · x");
});

test('saidn picks its form by its count', () => {
  withTable(PROBE, () => {
    assert.equal(sayOf(saidn('probe.jobs', 1)), '1 job running');
    assert.equal(sayOf(saidn('probe.jobs', 3)), '3 jobs running');
    assert.equal(sayOf(saidn('probe.items', 2, { where: '<a>' })), '2 items in <a>');
  });
});

test('sayOf passes a string through and draws nothing for null', () => {
  assert.equal(sayOf("the Account's <words>"), "the Account's <words>");
  assert.equal(sayOf(''), '');
  for (const none of [null, undefined, 0, {}, { key: 'common.save' }]) assert.equal(sayOf(none), '', String(none));
});

test('a said is frozen and its params are copied', () => {
  const params = { why: 'first' };
  const line = said('probe.why', params);
  params.why = 'changed';
  assert.ok(Object.isFrozen(line) && Object.isFrozen(line.params));
  assert.equal(withTable(PROBE, () => sayOf(line)), "Can't run · first");
  assert.ok(isSaid(line) && !isSaid({ key: 'probe.why' }) && !isSaid('probe.why'));
});

test('a said put into another, and into t or th, reads in the table that stands; th escapes it once', () => {
  const inner = said('probe.why', { why: '<x>' });
  withTable(PROBE, () => {
    assert.equal(sayOf(said('probe.greet', { name: inner })), "Hello Can't run · <x> and Can't run · <x>");
    assert.equal(th('probe.why', { why: inner }), "Can't run · Can&#39;t run · &lt;x&gt;");
  });
});

test('isLine takes a string or a said, the empty string only when asked; saidError carries its said', () => {
  assert.ok(isLine('x') && isLine(said('common.save')) && !isLine('') && isLine('', { empty: true }) && !isLine(null) && !isLine({}));
  const err = saidError('probe.why', { why: 'w' });
  assert.ok(err instanceof Error && isSaid(err.said));
  assert.equal(err.message, 'probe.why', 'its message read now, for a log');
  assert.equal(withTable(PROBE, () => sayOf(err.said)), "Can't run · w");
});
