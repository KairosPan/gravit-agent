// The editor's DOM adapter: the only code that reads or writes the editor's nodes (div#say, contenteditable, chips as
// atomic spans carrying data-chip). app.js takes it as host.editor ?? makeEditor(doc).
// The caret counts as lengthOf does: a text's UTF-16 length with zero-width spaces left out, 1 for a chip, 1 for a
// newline (a BR, or a DIV or P block after its parent's first child); the browser's trailing BR counts nothing.
import { normalize } from './draft.js';
import { editorHtml } from './view.js';

const ZWSP = /​/g;
const KINDS = new Set(['bot', 'file', 'conversation']);
const isText = n => n.nodeType === 3;
const isChip = n => n.nodeType === 1 && n.dataset?.chip != null;
const isBlock = n => n.nodeName === 'DIV' || n.nodeName === 'P';

function parseChip(raw) {
  try {
    const c = JSON.parse(raw);
    return c && typeof c === 'object' && KINDS.has(c.kind) ? c : null;
  } catch { return null; }
}

/** The editor's content as tokens in document order, each with its units and its node; `stop` reports where the
 *  selection's anchor falls, in units before the trailing BR is dropped. */
function tokens(root, anchor) {
  const out = [];
  let units = 0, at = null;
  const hit = n => { if (at == null) at = n; };
  const visit = (node, index) => {
    if (isText(node)) {
      const t = node.data.replace(ZWSP, '');
      if (anchor?.node === node) hit(units + node.data.slice(0, anchor.offset).replace(ZWSP, '').length);
      if (t) out.push({ type: 'text', node, text: t, start: units });
      units += t.length;
      return;
    }
    if (node.nodeType !== 1) return;
    if (isChip(node)) {
      const chip = parseChip(node.dataset.chip);
      if (chip) { out.push({ type: 'chip', node, chip, start: units }); units += 1; }
      if (anchor && node.contains(anchor.node)) hit(units);
      return;
    }
    if (node.nodeName === 'BR') { out.push({ type: 'br', node, start: units }); units += 1; return; }
    if (isBlock(node) && index > 0) { out.push({ type: 'block', node, start: units }); units += 1; }
    walk(node);
  };
  const walk = parent => {
    const kids = parent.childNodes;
    for (let i = 0; i < kids.length; i++) {
      if (anchor?.node === parent && anchor.offset === i) hit(units);
      visit(kids[i], i);
    }
    if (anchor?.node === parent && anchor.offset >= kids.length) hit(units);
  };
  walk(root);
  if (out.length && out[out.length - 1].type === 'br') { out.pop(); units -= 1; }
  return { out, length: units, at };
}

const indexIn = node => Array.prototype.indexOf.call(node.parentNode.childNodes, node);

/** The raw offset in a text node after its k-th visible character (past a leading zero-width space for k = 0). */
function rawOffset(data, k) {
  let seen = 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i] === '​') continue;
    if (seen === k) return i;
    seen++;
  }
  return data.length;
}

export function makeEditor(doc) {
  const read = el => normalize(tokens(el, null).out.map(t => (t.type === 'chip' ? { type: 'chip', chip: t.chip }
    : { type: 'text', text: t.type === 'text' ? t.text : '\n' })));

  const caret = el => {
    const sel = doc.getSelection?.();
    if (!sel || !sel.rangeCount || !sel.anchorNode || !el.contains(sel.anchorNode)) return null;
    const { at, length } = tokens(el, { node: sel.anchorNode, offset: sel.anchorOffset });
    return at == null ? null : Math.min(Math.max(at, 0), length);
  };

  const place = (el, at) => {
    const sel = doc.getSelection?.();
    if (!sel) return;
    const { out, length } = tokens(el, null);
    const n = Math.min(Math.max(Number(at) || 0, 0), length);
    let spot = null;
    const t = out.find(x => x.type === 'text' && x.start <= n && n <= x.start + x.text.length);
    if (t) spot = [t.node, rawOffset(t.node.data, n - t.start)];
    else {
      for (const x of out) {
        if (x.start === n) { spot = [x.node.parentNode, indexIn(x.node)]; break; }
        if (x.start + 1 === n) { spot = x.type === 'block' ? [x.node, 0] : [x.node.parentNode, indexIn(x.node) + 1]; break; }
      }
    }
    sel.collapse(...(spot ?? [el, 0]));
  };

  const write = (el, runs, at) => {
    el.innerHTML = editorHtml(runs);
    if (at != null) place(el, at);
  };

  return { read, caret, place, write };
}
