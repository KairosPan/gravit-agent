// The 中文 review dump (plan 7 Task 11): every key, English beside Chinese, with the corpus states that draw it — the TSV the
// operator corrects (its fix column) and its round trip.
process.env.TZ = 'America/New_York';
const { test } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { mkdirSync, copyFileSync, readFileSync, rmSync } = await import('node:fs');
const { join } = await import('node:path');
const { fileURLToPath } = await import('node:url');
const { EN } = await import('../../client/js/i18n/en.js');
const { reviewRows, tsvOf, parseTsv, encodeCell, decodeCell } = await import('./zh-review.js');
const { applyFixes } = await import('./zh-apply.js');

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

// plan 7 task 14: a filled fix column rewrites that one value; every other line of zh.js stays byte for byte, and a fix
// whose params are not the English key's is refused with the file untouched. The copy lives in the plan's scratch, never /tmp
test('zh-apply writes a fix, keeps every other line byte for byte, and refuses a fix with other params', () => {
  const scratch = fileURLToPath(new URL('../../../.superpowers/sdd/2026-11-05-dsh-ui-port-7-chinese/scratch-t14/', import.meta.url));
  const file = join(scratch, 'zh.js');
  const source = fileURLToPath(new URL('../../client/js/i18n/zh.js', import.meta.url));
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  copyFileSync(source, file);
  const before = readFileSync(file, 'utf8');
  const tsv = 'key\ten\tzh\tstates\tfix\ncommon.save\tSave\t保存\t—\t存好\ncommon.cancel\tCancel\t取消\t—\t\n';
  assert.deepEqual(applyFixes(tsv, file, EN), ['common.save']);
  const after = readFileSync(file, 'utf8').split('\n');
  const moved = before.split('\n').flatMap((line, i) => (line === after[i] ? [] : [after[i]]));
  assert.deepEqual(moved, ["  'common.save': '存好',"]);
  copyFileSync(source, file);
  assert.throws(() => applyFixes('key\ten\tzh\tstates\tfix\ncommon.save\tSave\t保存\t—\t{other} 存好\nno.such.key\tX\tY\t—\t坏\n', file, EN),
    /common\.save[\s\S]*no\.such\.key/);
  assert.equal(readFileSync(file, 'utf8'), before, 'a refused run writes nothing');
  // a line break would split zh.js's single-quoted literal (the review page invites \n; a TSV saved on Windows ends in \r),
  // and a fix of spaces is no word: each is refused by name and nothing is written
  const bad = 'key\ten\tzh\tstates\tfix\ncommon.save\tSave\t保存\t—\t保存\\n第二行\ncommon.cancel\tCancel\t取消\t—\t取消\r\n'
    + 'common.no\tNo\t否\t—\t   \n';
  assert.throws(() => applyFixes(bad, file, EN), e => /common\.save: holds a line break/.test(e.message)
    && /common\.cancel: holds a line break/.test(e.message) && /common\.no: empty/.test(e.message));
  assert.equal(readFileSync(file, 'utf8'), before, 'a line break or a blank fix writes nothing');
});
