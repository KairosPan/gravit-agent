// The 中文 review dump (plan 7 Task 11): every key, English beside Chinese, with the corpus states that draw it — the TSV the
// operator corrects (its fix column) and its round trip.
process.env.TZ = 'America/New_York';
const { test } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { EN } = await import('../../client/js/i18n/en.js');
const { reviewRows, tsvOf, parseTsv, encodeCell, decodeCell } = await import('./zh-review.js');

const rows = await reviewRows();

test('the tsv has one row per key, in order, five columns', () => {
  const lines = tsvOf(rows).split('\n').filter(Boolean);
  assert.equal(lines[0], 'key\ten\tzh\tstates\tfix');
  assert.equal(lines.length - 1, Object.keys(EN).length);
  assert.deepEqual(lines.slice(1).map(l => l.split('\t')[0]), Object.keys(EN));
  for (const l of lines) assert.equal(l.split('\t').length, 5, l);
  const plural = Object.keys(EN).find(k => typeof EN[k] === 'object');
  assert.equal(rows.find(r => r.key === plural).en, `${EN[plural].one} | ${EN[plural].other}`, "a plural's English is one | other");
  assert.ok(lines.slice(1).every(l => l.endsWith('\t')), 'the fix column is empty');
});

test("a key's states are the states that draw it", () => {
  const nav = rows.find(r => r.key === 'nav.messages');
  assert.ok(nav.states.includes('state-0'), 'the empty Messages state draws the nav');
  assert.ok(nav.states.length > 100, 'the nav is on every page');
  const language = rows.find(r => r.key === 'settings.language');
  assert.ok(language.states.length > 0 && language.states.every(name => /^state-\d+(-pc)?$/.test(name)), 'Settings states');
  assert.ok(!language.states.includes('state-0'), 'not a state without Settings');
  // a table word put into another as a param is found too (common.list.sep between the venues of an asset's row)
  assert.ok(rows.find(r => r.key === 'common.list.sep').states.length > 0, 'a word inside another word is found');
  assert.ok(rows.some(r => r.states.length === 0), 'a key no corpus state draws reads —');
  assert.ok(tsvOf(rows).includes('\t—\t'));
});

test('a value with a tab or a newline survives the round trip', () => {
  for (const v of ['a\tb', 'one\ntwo', 'back\\slash', 'a\\tb', '中文\t“引号”\n']) assert.equal(decodeCell(encodeCell(v)), v, JSON.stringify(v));
  const back = parseTsv(tsvOf([{ key: 'x.y.z', en: 'a\tb', zh: '甲\n乙', states: ['state-1', 'state-2'] }]));
  assert.deepEqual(back, [{ key: 'x.y.z', en: 'a\tb', zh: '甲\n乙', states: ['state-1', 'state-2'], fix: '' }]);
  const fixed = tsvOf([{ key: 'x.y.z', en: 'E', zh: 'Z', states: [] }]).replace(/\t$/m, '\t改\\t后');
  assert.equal(parseTsv(fixed)[0].fix, '改\t后', 'a fix written with \\t reads as a tab');
});
