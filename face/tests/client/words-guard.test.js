// The words guard (plan 6, D35): the face's words live in the table (client/js/i18n/en.js), so an English literal left in a
// client source is a word not yet moved. KEPT_FILES are the files whose English is not the face's words; PENDING the files the
// words tasks still have to move, each task taking its files off the list until Task 10 deletes it. A literal deliberately
// kept in place carries `// en-kept: <reason>` on its line or alone on the line before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { englishLiterals, wordsCalls } from './helpers/words-scan.js';

const ROOT = fileURLToPath(new URL('../../client/js/', import.meta.url));
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.js') ? [join(dir, e.name)] : []);
const FILES = walk(ROOT).map(f => relative(ROOT, f).split('\\').join('/')).sort();
const source = file => readFileSync(join(ROOT, file), 'utf8');

const KEPT_FILES = {
  'wire/api.js': 'transport errors, read by code',
  'wire/markdown.js': "Gravit's words",
};

const PENDING = [
  'app.js', 'composer/files.js', 'composer/menus.js', 'composer/view.js', 'host/account-view.js', 'host/account.js',
  'host/actions.js', 'host/channels.js', 'host/children-view.js', 'host/desk-view.js', 'host/desk.js', 'host/discover-view.js',
  'host/discover.js', 'host/explore-join.js', 'host/identity-view.js', 'host/identity.js', 'host/jobs.js', 'host/kinds.js',
  'host/list-view.js', 'host/live.js', 'host/lunhui.js', 'host/market-depth-view.js', 'host/market-view.js', 'host/markets.js',
  'host/modules-view.js', 'host/money-view.js', 'host/owner-view.js', 'host/owner.js', 'host/run-sheet-view.js',
  'host/run-sheet.js', 'host/runs-view.js', 'host/search-view.js', 'host/search.js', 'host/sell-many.js', 'host/sessions.js',
  'host/sheet-identity.js', 'host/sheet-market.js', 'host/sheet-money.js', 'host/sheet-rules.js', 'host/sheet-view.js',
  'host/sheet.js', 'host/traces.js', 'host/trade-view.js', 'host/wallet-send.js', 'reducers/controls.js', 'reducers/lunhui.js',
  'reducers/owner.js', 'reducers/traces.js', 'render/account.js', 'render/avatars.js', 'render/channel.js', 'render/chart.js',
  'render/controls.js', 'render/desk.js', 'render/discover.js', 'render/identity.js', 'render/lunhui/breadth.js',
  'render/lunhui/composed.js', 'render/lunhui/footer.js', 'render/lunhui/indices.js', 'render/lunhui/intraday.js',
  'render/lunhui/ladder.js', 'render/lunhui/notes.js', 'render/lunhui/signals.js', 'render/lunhui/sources.js',
  'render/lunhui/stock.js', 'render/lunhui/verdicts.js', 'render/lunhui/yesterday.js', 'render/markets.js', 'render/messages.js',
  'render/modules.js', 'render/owner.js', 'render/rail.js', 'render/run-sheet.js', 'render/thread.js', 'render/trade.js',
  'render/wallet-row.js', 'time.js', 'wire/botSettings.js', 'wire/market-model.js', 'wire/member-traces.js', 'wire/room.js',
  'wire/subagents.js', 'wire/wallet.js',
];

const texts = src => englishLiterals(src, 'snippet.js').map(l => l.text);

test('a capitalized word and a phrase are found; an identifier, a class list, a selector and a key name are not', () => {
  assert.deepEqual(texts("const a = 'Close';"), ['Close']);
  assert.deepEqual(texts("const a = 'Not signed in';"), ['Not signed in']);
  for (const quiet of ["'seg-item pressed'", "'#say'", "'Escape'", "'BUTTON'", "'content-type'"]) assert.deepEqual(texts(`const a = ${quiet};`), [], quiet);
});

test("a template's text and its aria-label are found, its tags and attribute names are not", () => {
  assert.deepEqual(texts('const a = `<div class="dsec-label">Theme</div>`;'), ['Theme']);
  assert.deepEqual(texts('const a = `<b aria-label="Copy">`;'), ['Copy']);
  assert.deepEqual(texts('const a = x => `<div class="${x}">${x}</div>`;'), []);
  assert.deepEqual(texts('const a = x => `<button type="button" data-x="${x}" aria-label="Close">×</button>`;'), ['Close']);
});

test("a words call's key, an import and a property name are not reported", () => {
  assert.deepEqual(texts("import { t } from 'Some Module';\nconst a = () => t('Close', { n: 1 });"), []);
  assert.deepEqual(texts("const a = { 'Not signed in': 1, 'aria-label': 2 };"), []);
  assert.deepEqual(texts("const a = () => import('Some Module');"), []);
  assert.deepEqual(texts("const a = () => th('Close the drawer');"), []);
});

test('en-kept on the line or the line before exempts it', () => {
  assert.deepEqual(texts("const a = 'Tencent'; // en-kept: a provider's name"), []);
  assert.deepEqual(texts("// en-kept: a provider's name\nconst a = 'Tencent';"), []);
  assert.deepEqual(texts("const b = 1; // en-kept: not alone\nconst a = 'Tencent';"), ['Tencent'], 'a marker after code covers its own line only');
  assert.deepEqual(texts("// en-kept: once\nconst a = 'Tencent';\nconst b = 'Alpaca';"), ['Alpaca']);
});

test('wordsCalls finds a literal key, a computed key and a call at module top level', () => {
  const calls = wordsCalls("const A = t('top');\nexport function f(k) { return th('in') + tn(k, 2) + thn(`x`, 1); }", 'snippet.js');
  assert.deepEqual(calls, [
    { line: 1, fn: 't', key: 'top', topLevel: true },
    { line: 2, fn: 'th', key: 'in', topLevel: false },
    { line: 2, fn: 'tn', key: null, topLevel: false },
    { line: 2, fn: 'thn', key: 'x', topLevel: false },
  ]);
  assert.deepEqual(wordsCalls("const f = () => t('a');\nclass C { m() { return t('b'); } }", 'snippet.js').map(c => c.topLevel), [false, false]);
});

test('no client file outside PENDING and KEPT_FILES has an English literal', () => {
  const found = FILES.filter(f => !(f in KEPT_FILES) && !PENDING.includes(f))
    .flatMap(f => englishLiterals(source(f), f).map(l => `${f}:${l.line} ${l.text}`));
  assert.deepEqual(found, [], 'move these into client/js/i18n/en.js, or mark a deliberate one // en-kept: <reason>');
});

test('every PENDING file still has one (a moved file must leave the list)', () => {
  assert.deepEqual([...PENDING].sort(), PENDING, 'PENDING is sorted');
  for (const f of PENDING) assert.ok(FILES.includes(f), `${f} exists`);
  assert.deepEqual(PENDING.filter(f => englishLiterals(source(f), f).length === 0), [], 'these files hold no English literal now: take them off PENDING');
  for (const f of Object.keys(KEPT_FILES)) assert.ok(FILES.includes(f), `${f} exists`);
});

test('no words call has a computed key or runs at module top level', () => {
  const bad = FILES.flatMap(f => wordsCalls(source(f), f).filter(c => c.key === null || c.topLevel).map(c => `${f}:${c.line} ${c.fn}(${c.key === null ? 'computed' : `'${c.key}'`})${c.topLevel ? ' at top level' : ''}`));
  assert.deepEqual(bad, []);
});
