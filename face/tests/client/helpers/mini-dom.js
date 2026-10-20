// face/tests/client/helpers/mini-dom.js — a document just big enough to run the DOM-built markdown
// (js/wire/markdown.js) under node:test and read back what a browser would serialize: createElement,
// className and classList.add, textContent, append, the three link attributes, outerHTML.
const escText = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = s => escText(s).replace(/"/g, '&quot;');
const VOID = new Set(['hr', 'br', 'img', 'input']);
const ATTRS = ['href', 'target', 'rel'];

class MiniElement {
  constructor(tag) {
    this.localName = String(tag).toLowerCase();
    this.tagName = this.localName.toUpperCase();
    this.className = '';
    this.children = [];
  }
  get classList() {
    return { add: name => { if (!this.className.split(/\s+/).includes(name)) this.className = this.className ? `${this.className} ${name}` : name; } };
  }
  set textContent(v) { this.children = [String(v)]; }
  get textContent() { return this.children.map(c => (typeof c === 'string' ? c : c.textContent)).join(''); }
  append(...nodes) { for (const n of nodes) this.children.push(n); }
  get outerHTML() {
    const attrs = (this.className ? ` class="${escAttr(this.className)}"` : '') +
      ATTRS.filter(a => this[a] !== undefined).map(a => ` ${a}="${escAttr(this[a])}"`).join('');
    if (VOID.has(this.localName)) return `<${this.localName}${attrs}>`;
    return `<${this.localName}${attrs}>${this.children.map(c => (typeof c === 'string' ? escText(c) : c.outerHTML)).join('')}</${this.localName}>`;
  }
}

// run `fn` with globalThis.document set to the mini document, restoring whatever was there before
export function withMiniDocument(fn) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: tag => new MiniElement(tag) } });
  try {
    return fn();
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else Reflect.deleteProperty(globalThis, 'document');
  }
}
