// The editor's DOM adapter (plan 3 of the dsh UI port, Task 4): read, caret, place and write over hand-built nodes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEditor } from '../../client/js/composer/dom.js';
import { editorHtml } from '../../client/js/composer/view.js';
import { text, el, chipEl, editor, makeDoc } from './helpers/editable-dom.js';

const bot = { kind: 'bot', id: 'news-scout', label: 'News scout' };
const file = { kind: 'file', path: 'strategies/a.md', dir: false, label: 'a.md' };
const T = s => ({ type: 'text', text: s });
const C = chip => ({ type: 'chip', chip });

test('read gives text and chips in order, merging what the browser split', () => {
  const doc = makeDoc(), ed = makeEditor(doc);
  const root = editor([text('ask '), text('​the'), chipEl(bot), text(' about '), el('span', { children: ['this '] }), chipEl(file), text('​')]);
  assert.deepEqual(ed.read(root), [T('ask the'), C(bot), T(' about this '), C(file)]);
  assert.deepEqual(ed.read(editor()), []);
});

test("Shift+Enter's BR is a newline, the browser's trailing BR is not, a block starts a line", () => {
  const ed = makeEditor(makeDoc());
  assert.deepEqual(ed.read(editor([text('a'), el('br'), text('b')])), [T('a\nb')]);
  assert.deepEqual(ed.read(editor([text('a'), el('br'), el('br')])), [T('a\n')], 'the last BR is the browser\'s');
  assert.deepEqual(ed.read(editor([text('a'), el('br')])), [T('a')]);
  assert.deepEqual(ed.read(editor([el('br')])), []);
  assert.deepEqual(ed.read(editor([text('a'), el('div', { children: ['b'] }), el('p', { children: ['c'] })])), [T('a\nb\nc')]);
  assert.deepEqual(ed.read(editor([el('div', { children: ['a'] }), el('div', { children: ['b'] })])), [T('a\nb')], 'the first block starts no line');
  assert.deepEqual(ed.read(editor([text('a'), el('div', { children: [el('br')] })])), [T('a\n')]);
});

test('a chip with bad data is dropped, not thrown', () => {
  const ed = makeEditor(makeDoc());
  const root = editor([text('x'), chipEl(null, '{not json'), chipEl({ kind: 'robot', id: 'r', label: 'R' }), chipEl(null, '"str"'), chipEl(null, 'null'), text('y'), chipEl(bot)]);
  assert.deepEqual(ed.read(root), [T('xy'), C(bot)]);
});

test('the caret counts a chip as one, inside a text node and on the editor itself', () => {
  const doc = makeDoc(), ed = makeEditor(doc);
  const t1 = text('ab'), chip = chipEl(bot), t2 = text('​cd');
  const root = editor([t1, chip, t2]);
  doc.select(t1, 1); assert.equal(ed.caret(root), 1);
  doc.select(t2, 0); assert.equal(ed.caret(root), 3);
  doc.select(t2, 2); assert.equal(ed.caret(root), 4, 'the zero-width space counts nothing');
  doc.select(t2, 3); assert.equal(ed.caret(root), 5);
  doc.select(root, 0); assert.equal(ed.caret(root), 0);
  doc.select(root, 2); assert.equal(ed.caret(root), 3, 'after the chip');
  doc.select(root, 3); assert.equal(ed.caret(root), 5);
  doc.select(chip.childNodes[0].childNodes[0], 0); assert.equal(ed.caret(root), 3, 'inside a chip is after it');
  doc.select(chip, 0); assert.equal(ed.caret(root), 3);
  const br = editor([text('a'), el('br'), text('b'), el('br')]);
  doc.select(br, 2); assert.equal(ed.caret(br), 2, 'a BR is one');
  doc.select(br, 4); assert.equal(ed.caret(br), 3, 'clamped past the trailing BR');
  const blk = el('div', { children: ['b'] });
  const blocks = editor([text('a'), blk]);
  doc.select(blk, 0); assert.equal(ed.caret(blocks), 2, 'a block begins after its newline');
  doc.select(blk.childNodes[0], 1); assert.equal(ed.caret(blocks), 3);
});

test('place puts the caret after a chip and inside a text, clamped past the end', () => {
  const doc = makeDoc(), ed = makeEditor(doc);
  const t1 = text('ab'), chip = chipEl(bot), t2 = text('​cd');
  const root = editor([t1, chip, t2]);
  ed.place(root, 1); assert.deepEqual(doc.sel.collapsed.at(-1), [t1, 1]);
  ed.place(root, 3); assert.deepEqual(doc.sel.collapsed.at(-1), [t2, 1], 'after the chip, in the text that follows it, past its zero-width space');
  assert.equal(ed.caret(root), 3, 'caret reads place back');
  ed.place(root, 4); assert.deepEqual(doc.sel.collapsed.at(-1), [t2, 2], 'past the zero-width space');
  ed.place(root, 99); assert.deepEqual(doc.sel.collapsed.at(-1), [t2, 3], 'clamped to the end');
  ed.place(root, -4); assert.deepEqual(doc.sel.collapsed.at(-1), [t1, 0]);
  const lead = editor([chipEl(bot)]);
  ed.place(lead, 0); assert.deepEqual(doc.sel.collapsed.at(-1), [lead, 0], 'before a leading chip');
  ed.place(lead, 1); assert.deepEqual(doc.sel.collapsed.at(-1), [lead, 1], 'after a chip with no text behind it');
  const empty = editor([el('br')]);
  ed.place(empty, 5); assert.deepEqual(doc.sel.collapsed.at(-1), [empty, 0], 'before the browser\'s BR');
  const br = el('br'), lines = editor([text('a'), br, text('b')]);
  ed.place(lines, 2); assert.deepEqual(doc.sel.collapsed.at(-1), [lines.childNodes[2], 0]);
});

test("write sets the editor's markup from the runs and places the caret, or leaves it with at null", () => {
  const doc = makeDoc(), ed = makeEditor(doc);
  const runs = [T('hi '), C(bot), T(' there')];
  const built = [];
  const root = editor([text('old')], html => { built.push(html); return [text('hi '), chipEl(bot), text(' there')]; });
  ed.write(root, runs, 4);
  assert.equal(root.innerHTML, editorHtml(runs));
  assert.deepEqual(built, [editorHtml(runs)]);
  assert.deepEqual(doc.sel.collapsed.at(-1), [root.childNodes[2], 0]);
  assert.deepEqual(ed.read(root), runs);
  const n = doc.sel.collapsed.length;
  ed.write(root, [T('x')], null);
  assert.equal(root.innerHTML, 'x');
  assert.equal(doc.sel.collapsed.length, n, 'no caret placed');
});

test('a selection outside the editor reads as no caret', () => {
  const doc = makeDoc(), ed = makeEditor(doc);
  const root = editor([text('ab')]);
  const other = editor([text('zz')]);
  doc.select(other.childNodes[0], 1); assert.equal(ed.caret(root), null);
  doc.select(null, 0); assert.equal(ed.caret(root), null);
  assert.equal(makeEditor({ getSelection: () => null }).caret(root), null);
});
