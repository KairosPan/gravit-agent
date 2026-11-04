// The editor's DOM adapter: the only code that reads or writes the editor's nodes (div#say, contenteditable, chips as
// atomic spans carrying data-chip). app.js takes it as host.editor ?? makeEditor(doc).
// The caret counts as lengthOf does: a text's UTF-16 length with zero-width spaces left out, 1 for a chip, 1 for a
// newline (a BR, a DIV or P block that starts a line, content after a block); the browser's own BRs count nothing.
import { normalize } from './draft.js';
import { editorHtml } from './view.js';

const ZWSP = /​/g;
const KINDS = new Set(['bot', 'file', 'conversation']);
const isText = n => n.nodeType === 3;
const isChip = n => n.nodeType === 1 && n.dataset?.chip != null;
const isBlock = n => n.nodeName === 'DIV' || n.nodeName === 'P';
const indexIn = node => Array.prototype.indexOf.call(node.parentNode.childNodes, node);

function parseChip(raw) {
  try {
    const c = JSON.parse(raw);
    return c && typeof c === 'object' && KINDS.has(c.kind) ? c : null;
  } catch { return null; }
}

const isBr = n => n.nodeName === 'BR';
const visible = n => n.data.replace(ZWSP, '');

/** Whether a node, walked, gives a token of its own before any block: text, a good chip, a BR, or an inline holding one. */
function produces(node) {
  if (isText(node)) return visible(node).length > 0;
  if (node.nodeType !== 1 || isBlock(node)) return false;
  if (isChip(node)) return parseChip(node.dataset.chip) != null;
  if (isBr(node)) return true;
  return Array.prototype.some.call(node.childNodes, produces);
}

/** The editor's content as tokens in document order, each with its units, its node and, for a non-text token, the
 *  selection spots just before and just after it; `at` is where the selection's anchor falls. Lines follow the
 *  browser: a block starts a line unless nothing or a BR comes before it, content after a block starts a line, and
 *  a BR that ends a block or the editor is the browser's own and gives nothing. */
function tokens(root, anchor) {
  const out = [];
  let units = 0, at = null, pending = null;
  const hit = n => { if (at == null) at = n; };
  const push = t => { out.push({ ...t, start: units }); units += t.type === 'text' ? t.text.length : 1; };
  const flush = () => {
    if (!pending) return;
    const b = pending;
    pending = null;
    push({ type: 'nl', node: b, before: [b, b.childNodes.length], after: [b.parentNode, indexIn(b) + 1] });
  };
  const visit = node => {
    if (isText(node)) {
      const t = visible(node);
      if (anchor?.node === node) hit(units + node.data.slice(0, anchor.offset).replace(ZWSP, '').length);
      if (t) push({ type: 'text', node, text: t });
      return;
    }
    if (node.nodeType !== 1) return;
    const around = () => ({ before: [node.parentNode, indexIn(node)], after: [node.parentNode, indexIn(node) + 1] });
    if (isChip(node)) {
      const chip = parseChip(node.dataset.chip);
      if (chip) push({ type: 'chip', node, chip, ...around() });
      if (anchor && node.contains(anchor.node)) hit(units);
      return;
    }
    if (isBr(node)) {
      const p = node.parentNode;
      if (!(p !== root && isBlock(p) && p.childNodes[p.childNodes.length - 1] === node)) push({ type: 'br', node, ...around() });
      return;
    }
    if (isBlock(node)) {
      pending = null;
      const last = out[out.length - 1];
      if (last && last.type !== 'br') push({ type: 'nl', node, before: [node.parentNode, indexIn(node)], after: [node, 0] });
      walk(node);
      pending = node;
      return;
    }
    walk(node);
  };
  const walk = parent => {
    const kids = parent.childNodes;
    for (let i = 0; i < kids.length; i++) {
      if (pending && produces(kids[i])) flush();
      if (anchor?.node === parent && anchor.offset === i) hit(units);
      visit(kids[i]);
    }
    if (anchor?.node === parent && anchor.offset >= kids.length) hit(units);
  };
  walk(root);
  if (out.length && out[out.length - 1].type === 'br') { out.pop(); units -= 1; }
  return { out, length: units, at };
}

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
        if (x.start === n) { spot = x.before; break; }
        if (x.start + 1 === n) { spot = x.after; break; }
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
