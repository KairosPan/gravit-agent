// face/tests/client/helpers/editable-dom.js — node trees built by hand for the composer's DOM adapter
// (js/composer/dom.js): text nodes, elements with a dataset and children, an editor root, and a document whose
// getSelection() answers anchorNode/anchorOffset, focusNode/focusOffset, rangeCount, collapse, setBaseAndExtent, removeAllRanges and addRange, with a
// createRange() that records setStart. It parses no HTML: an editor's innerHTML setter stores the string and takes
// its children from the `parse` function the test hands it, if any.

class Node {
  constructor() { this.parentNode = null; this.childNodes = []; }
  contains(n) {
    for (let x = n; x; x = x.parentNode) if (x === this) return true;
    return false;
  }
  appendChild(n) { n.parentNode = this; this.childNodes.push(n); return n; }
}

class Text extends Node {
  constructor(s) { super(); this.nodeType = 3; this.nodeName = '#text'; this.data = String(s); }
  get nodeValue() { return this.data; }
  get textContent() { return this.data; }
}

class Element extends Node {
  constructor(tag, { dataset = {}, children = [] } = {}) {
    super();
    this.nodeType = 1;
    this.tagName = this.nodeName = String(tag).toUpperCase();
    this.dataset = { ...dataset };
    for (const c of children) this.appendChild(typeof c === 'string' ? new Text(c) : c);
  }
  get textContent() { return this.childNodes.map(c => c.textContent).join(''); }
}

class Editor extends Element {
  constructor(children, parse) { super('div', { children }); this.id = 'say'; this.parse = parse; this.html = null; }
  set innerHTML(h) {
    this.html = h;
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    for (const c of this.parse ? this.parse(h) : []) this.appendChild(typeof c === 'string' ? new Text(c) : c);
  }
  get innerHTML() { return this.html; }
}

export const text = s => new Text(s);
export const el = (tag, opts) => new Element(tag, opts);
/** A chip span as editorHtml draws it: data-chip holds the JSON, the inside is its label. */
export const chipEl = (chip, raw) => el('span', { dataset: { chip: raw ?? JSON.stringify(chip) }, children: [el('span', { children: [chip?.label ?? 'x'] })] });
export const editor = (children = [], parse) => new Editor(children, parse);

/** A document with one selection. `sel.collapsed` and `ranges` record what the adapter did. */
export function makeDoc() {
  const ranges = [];
  const sel = {
    anchorNode: null,
    anchorOffset: 0,
    rangeCount: 0,
    collapsed: [],
    focusNode: null,
    focusOffset: 0,
    extents: [],
    collapse(node, offset) { this.anchorNode = this.focusNode = node; this.anchorOffset = this.focusOffset = offset; this.rangeCount = 1; this.collapsed.push([node, offset]); },
    setBaseAndExtent(an, ao, fn, fo) { Object.assign(this, { anchorNode: an, anchorOffset: ao, focusNode: fn, focusOffset: fo, rangeCount: 1 }); this.extents.push([an, ao, fn, fo]); },
    removeAllRanges() { this.rangeCount = 0; this.anchorNode = null; this.anchorOffset = 0; },
    addRange(r) { this.rangeCount = 1; this.anchorNode = r.start?.[0] ?? null; this.anchorOffset = r.start?.[1] ?? 0; },
  };
  const doc = {
    sel,
    ranges,
    getSelection: () => sel,
    createRange() {
      const r = { start: null, setStart(node, offset) { this.start = [node, offset]; }, collapse() {} };
      ranges.push(r);
      return r;
    },
    /** Put the selection at (node, offset) as a browser would after a click or a keystroke. */
    select(node, offset, focusNode = node, focusOffset = offset) {
      Object.assign(sel, { anchorNode: node, anchorOffset: offset, focusNode, focusOffset, rangeCount: node ? 1 : 0 });
    },
  };
  return doc;
}
