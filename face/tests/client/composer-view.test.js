// The composer's view (plan 3 of the dsh UI port, Task 3): the editor's runs as markup, the / and @ menus drawn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editorHtml, renderMenu } from '../../client/js/composer/view.js';
import { slashItems, atItems } from '../../client/js/composer/menus.js';
import { avatarGlyph } from '../../client/js/wire/room.js';

const unesc = s => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const rows = h => h.match(/<div class="cmenu-row[^"]*"[^>]*>/g) ?? [];

test('the editor draws text escaped and a chip atomic with its data', () => {
  const chip = { kind: 'file', path: 'strategies/a "b".md', dir: false, label: '<b>x</b>' };
  const h = editorHtml([{ type: 'text', text: 'see <i>\nnow ' }, { type: 'chip', chip }, { type: 'text', text: ' & go' }]);
  assert.ok(h.startsWith('see &lt;i&gt;\nnow '), 'text escaped, the newline kept');
  assert.match(h, / &amp; go$/);
  assert.doesNotMatch(h, /<b>|<i>/);
  const span = h.match(/<span class="ref-chip"([^>]*)>/);
  assert.ok(span, 'a chip is a ref-chip');
  assert.match(span[1], /contenteditable="false"/);
  const data = span[1].match(/data-chip="([^"]*)"/)[1];
  assert.deepEqual(JSON.parse(unesc(data)), chip);
  assert.match(h, /<span class="ref-chip-label">&lt;b&gt;x&lt;\/b&gt;<\/span>/);
  assert.match(h, /<svg[^>]*width="13"/, 'the icon at 13 px');
  const icons = ['bot', 'file', 'folder', 'conversation'].map(k => {
    const c = k === 'bot' ? { kind: 'bot', id: 'b', label: 'B' } : k === 'conversation' ? { kind: 'conversation', id: 's', label: 'S' }
      : { kind: 'file', path: 'p', dir: k === 'folder', label: 'p' };
    return editorHtml([{ type: 'chip', chip: c }]);
  });
  assert.equal(new Set(icons.map(h2 => h2.match(/<svg[\s\S]*?<\/svg>/)[0])).size, 4, 'bot, file, folder and conversation each their own icon');
  assert.equal(editorHtml([]), '');
});

test('the slash menu draws Commands and Skills with their names in mono, the active row marked, the footer\'s keys', () => {
  const groups = slashItems({ commands: [{ name: 'compact', description: 'Shrink the <context>' }], skills: [{ name: 'rules', description: 'The rules' }], query: '', atStart: true });
  const h = renderMenu({ kind: '/', from: 0, query: '', groups, active: 1 });
  assert.match(h, /^<div class="cmenu" role="listbox" aria-label="Commands and skills">/);
  assert.match(h, /<div class="cmenu-group">Commands<\/div>/);
  assert.match(h, /<div class="cmenu-group">Skills<\/div>/);
  const r = rows(h);
  assert.equal(r.length, 2);
  assert.match(r[0], /role="option"/); assert.match(r[0], /id="cm-0"/); assert.match(r[0], /aria-selected="false"/);
  assert.match(r[0], /data-action="menuPick"/); assert.match(r[0], /data-index="0"/);
  assert.match(r[1], /class="cmenu-row active"/); assert.match(r[1], /aria-selected="true"/); assert.match(r[1], /id="cm-1"/);
  assert.match(h, /<span class="cmenu-title">Compact<\/span><span class="cmenu-name">\/compact<\/span><span class="cmenu-desc">Shrink the &lt;context&gt;<\/span>/);
  assert.match(h, /<span class="cmenu-title">rules<\/span><span class="cmenu-name">\/rules<\/span><span class="cmenu-desc">The rules<\/span>/);
  assert.match(h, /<div class="cmenu-foot"><kbd>↑↓<\/kbd> Move · <kbd>Enter<\/kbd> Choose · <kbd>Esc<\/kbd> Close<\/div><\/div>$/);
  // a query drops the headings
  const q = renderMenu({ kind: '/', from: 0, query: 'co', groups: slashItems({ commands: [{ name: 'compact' }], skills: [], query: 'co', atStart: true }), active: 0 });
  assert.doesNotMatch(q, /cmenu-group/);
});

test("the @ menu draws a bot's glyph and id, a file's folder, a folder walk's crumb, a conversation's age", () => {
  const groups = atItems({
    bots: [{ id: 'news-scout', name: 'News Scout', description: 'Reads <news>' }],
    files: [{ path: 'strategies/alpha/thesis.md', kind: 'file' }, { path: 'desk', kind: 'directory' }],
    conversations: [{ kind: 'conversation', id: 's1', title: 'Is <BTC> cheap?', age: '5 minutes ago' }],
    query: '',
  });
  const h = renderMenu({ kind: '@', from: 0, query: '', groups, active: 0 });
  assert.match(h, /aria-label="References"/);
  for (const g of ['Bots in this room', 'Files and folders', 'Conversations']) assert.ok(h.includes(`<div class="cmenu-group">${g}</div>`), g);
  assert.equal(rows(h).length, 4);
  assert.ok(h.includes(avatarGlyph('news-scout')), "the bot's glyph");
  assert.match(h, /<span class="cmenu-title">News Scout<\/span><span class="cmenu-name">@news-scout<\/span><span class="cmenu-desc">Reads &lt;news&gt;<\/span>/);
  assert.match(h, /<span class="cmenu-title">thesis\.md<\/span><span class="cmenu-name">strategies\/alpha<\/span><span class="cmenu-desc"><\/span>/);
  assert.match(h, /<span class="cmenu-title">desk<\/span><span class="cmenu-name"><\/span><span class="cmenu-desc"><\/span>/);
  assert.match(h, /<span class="cmenu-title">Is &lt;BTC&gt; cheap\?<\/span><span class="cmenu-name"><\/span><span class="cmenu-desc">5 minutes ago<\/span>/);
  assert.match(h, /id="cm-3"[^>]*data-index="3"|data-index="3"/);
  // a folder walk: one group, its crumb
  const walk = renderMenu({ kind: '@', from: 0, query: 'strategies/<x>/', groups: atItems({ files: [{ path: 'strategies/x/a.md', kind: 'file' }], query: 'strategies/<x>/' }), active: 0 });
  assert.match(walk, /<div class="cmenu-crumb">strategies\/&lt;x&gt;\/<\/div>/);
  assert.equal(rows(walk).length, 1);
});

test('no rows draws nothing', () => {
  assert.equal(renderMenu(null), '');
  assert.equal(renderMenu({ kind: '@', from: 0, query: 'zz', groups: [], active: 0 }), '');
  assert.equal(renderMenu({ kind: '/', from: 0, query: 'zz', groups: [{ label: 'Skills', items: [] }], active: 0 }), '');
});

test("the editor's menu state for assistive tech: expanded with rows, the active row its active descendant", async () => {
  const { menuAria } = await import('../../client/js/composer/view.js');
  const menu = { kind: '@', from: 0, query: '', groups: [{ label: 'Bots in this room', items: [{ kind: 'bot', id: 'a', name: 'A', description: '' }, { kind: 'bot', id: 'b', name: 'B', description: '' }] }], active: 1 };
  assert.deepEqual(menuAria(menu), { 'aria-expanded': 'true', 'aria-activedescendant': 'cm-1' });
  assert.deepEqual(menuAria(null), { 'aria-expanded': 'false', 'aria-activedescendant': null });
  assert.deepEqual(menuAria({ ...menu, groups: [] }), { 'aria-expanded': 'false', 'aria-activedescendant': null }, 'a menu with no rows is closed');
});
