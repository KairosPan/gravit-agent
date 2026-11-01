// The Rules tab's four sheets (plan 4a Task 5): Beast, the cap on each move, the agents' session and their leverage — each the
// Account's own setPolicy draft (account/src/portfolio/public/ui/agents-mount.js setMode, openCap, renderDial), with its own
// checks and words; and the sheet view's delegation of them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RULES_KINDS, rulesTitleOf, rulesGoOf, rulesFieldsOf, rulesDraftOf } from '../../client/js/host/sheet-rules.js';
import { SHEET_KINDS, goWord, titleOf, fieldsOf, draftOf } from '../../client/js/host/sheet-view.js';

const set = (fields, values) => fields.map(f => (Object.hasOwn(values, f.name) ? { ...f, value: values[f.name] } : f));

test('RULES_KINDS: beast, cap, session and leverageCap; another kind has nothing', () => {
  assert.deepEqual(RULES_KINDS, ['beast', 'cap', 'session', 'leverageCap']);
  assert.equal(rulesTitleOf('nonsense', {}), '');
  assert.equal(rulesGoOf('nonsense', {}), '');
  assert.deepEqual(rulesFieldsOf('nonsense', {}), []);
  assert.equal(rulesDraftOf('nonsense', {}, {}), 'Nothing to sign here');
});

test('beast drafts mode open, with no field', () => {
  assert.equal(rulesTitleOf('beast', {}), 'Switch to Beast');
  assert.equal(rulesGoOf('beast', {}), 'Sign Beast');
  assert.deepEqual(rulesFieldsOf('beast', {}), []);
  assert.deepEqual(rulesDraftOf('beast', [], {}), { type: 'setPolicy', change: 'mode', value: 'open' });
});

test("cap drafts the dollars typed, to the cent, never the cap now", () => {
  const seed = { capUsd: 250 };
  assert.equal(rulesTitleOf('cap', seed), 'Each move at most');
  assert.equal(rulesGoOf('cap', seed), 'Sign the cap');
  const fields = rulesFieldsOf('cap', seed);
  assert.deepEqual(fields, [{ name: 'cap', label: 'Dollars', type: 'number', value: '250' }]);
  assert.equal(rulesDraftOf('cap', fields, seed), 'That is the cap now');
  assert.equal(rulesDraftOf('cap', set(fields, { cap: '250.00' }), seed), 'That is the cap now');
  assert.deepEqual(rulesDraftOf('cap', set(fields, { cap: '$1,250.50' }), seed), { type: 'setPolicy', change: 'cap', value: '1250.50' });
  assert.deepEqual(rulesDraftOf('cap', set(fields, { cap: ' 100 ' }), seed), { type: 'setPolicy', change: 'cap', value: '100' });
  const DOLLARS = 'A number of dollars, more than zero, to the cent';
  for (const bad of ['0', '0.00', '1.234', '', 'ten', '-5', '12345678', '1e3']) assert.equal(rulesDraftOf('cap', set(fields, { cap: bad }), seed), DOLLARS, bad);
  // no cap given: blank to begin with
  assert.equal(rulesFieldsOf('cap', {})[0].value, '');
});

test("session renews for 30 days, or starts a new one when it ended", () => {
  assert.equal(rulesTitleOf('session', { ended: false }), "Agents' session");
  assert.equal(rulesGoOf('session', { ended: false }), 'Renew for 30 days');
  assert.equal(rulesGoOf('session', { ended: true }), 'Start a new one');
  assert.deepEqual(rulesFieldsOf('session', { ended: true }), []);
  assert.deepEqual(rulesDraftOf('session', [], { ended: false }), { type: 'setPolicy', change: 'session', value: '30d' });
});

test("leverageCap picks a step, sorted and once each with now among them, never their leverage now", () => {
  assert.equal(rulesTitleOf('leverageCap', { max: 5 }), 'Their leverage');
  assert.equal(rulesGoOf('leverageCap', { max: 5 }), 'Sign leverage');
  const [field] = rulesFieldsOf('leverageCap', { max: 5 });
  assert.equal(field.name, 'max');
  assert.equal(field.type, 'seg');
  assert.equal(field.value, '5');
  assert.deepEqual(field.options, [1, 2, 3, 5, 10, 20].map(n => ({ value: String(n), label: `${n}x` })));
  const odd = rulesFieldsOf('leverageCap', { max: 7 })[0];
  assert.deepEqual(odd.options.map(o => o.value), ['1', '2', '3', '5', '7', '10', '20']);
  assert.equal(odd.options[4].label, '7x');
  const fields = rulesFieldsOf('leverageCap', { max: 5 });
  assert.equal(rulesDraftOf('leverageCap', fields, { max: 5 }), 'That is their leverage now');
  assert.deepEqual(rulesDraftOf('leverageCap', set(fields, { max: '10' }), { max: 5 }), { type: 'setPolicy', change: 'maxLeverage', value: '10' });
  assert.deepEqual(rulesDraftOf('leverageCap', set(fields, { max: '1' }), { max: 5 }), { type: 'setPolicy', change: 'maxLeverage', value: '1' });
  // only a step the sheet offers
  assert.equal(rulesDraftOf('leverageCap', set(fields, { max: '4' }), { max: 5 }), 'Pick a step');
  // no figure from the Account: 1x
  assert.equal(rulesFieldsOf('leverageCap', {})[0].value, '1');
});

test('the sheet view delegates the four kinds', () => {
  for (const k of RULES_KINDS) assert.ok(SHEET_KINDS.includes(k), k);
  assert.equal(goWord('beast', {}), 'Sign Beast');
  assert.equal(titleOf('cap', { capUsd: 9 }), 'Each move at most');
  assert.deepEqual(fieldsOf('session', {}), []);
  assert.deepEqual(draftOf('session', [], { ended: true }, 123), { type: 'setPolicy', change: 'session', value: '30d' });
  assert.deepEqual(draftOf('cap', [{ name: 'cap', value: '9.5' }], { capUsd: 9 }, 0), { type: 'setPolicy', change: 'cap', value: '9.5' });
});
