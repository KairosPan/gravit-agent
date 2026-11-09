// gravit-ui/js/render/controls.js — the small shared controls: segs, key-value rows, drawer sections, two-step confirms
import { esc, attrs, cls } from '../html.js';
import { th } from '../i18n/words.js';

// each item a label, or a [label, value] pair when the action takes a value other than the words: the item whose value is
// `pressed` is pressed, and each hands its value as data-value — and every item the same further data when it is given (a
// market page's ranges name the page)
export function seg(items, pressed, action, data = {}) {
  return `<div class="seg">${items.map(it => {
    const [label, value] = Array.isArray(it) ? it : [it, it];
    return `<button type="button"${attrs({ class: cls('seg-item', value === pressed && 'pressed'), 'aria-pressed': value === pressed ? 'true' : 'false', 'data-action': action, 'data-value': value, ...data })}>${esc(label)}</button>`;
  }).join('')}</div>`;
}

export function segLinks(items, current) {
  return `<div class="seg">${items.map(([label, href, key]) => `<a${attrs({ class: cls('seg-item', key === current && 'pressed'), 'aria-current': key === current ? 'page' : null, href })}>${esc(label)}</a>`).join('')}</div>`;
}

export function kv(rows) {
  return `<div class="kv-list">${rows.map(([k, v]) => `<div class="kv"><span class="kv-k">${esc(k)}</span><span class="kv-v">${v}</span></div>`).join('')}</div>`;
}

export function sec(label, lines, html = false) {
  return `<div class="dsec"><div class="dsec-label">${esc(label)}</div>${lines.map(l => `<div class="dsec-line">${html ? l : esc(l)}</div>`).join('')}</div>`;
}

// the second step of a confirm, in place of the button that asked
export function confirmPair(label) {
  return `<span class="confirm"><button type="button" class="btn-danger" data-action="confirmYes">${esc(label)}</button><button type="button" class="btn-sm" data-action="cancelConfirm">${th('common.no')}</button></span>`;
}
