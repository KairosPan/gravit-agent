// The composer's view: a draft's runs as the editor's markup, the / and @ menus, the draft's files rail, the drop overlay and
// the image lightbox. Strings only; app.js puts them in place.
import { esc, attrs, cls } from '../html.js';
import { icon } from '../icons.js';
import { avatarGlyph } from '../wire/room.js';
import { flatItems } from './menus.js';
import { metaText, progressText, limitsLine, isImageSrc } from './files.js';

const chipIcon = c => icon(c.kind === 'bot' ? 'agent' : c.kind === 'conversation' ? 'chat' : c.dir ? 'layers' : 'file', 13);

/** A chip's inner markup: its icon and its label. The bubble draws a conversation mention with it, no data and editable. */
export const chipInner = (iconHtml, label) => `${iconHtml}<span class="ref-chip-label">${esc(label)}</span>`;

/** The editor's markup: text escaped (its newlines kept under pre-wrap), a chip atomic, carrying itself in data-chip. A
 *  newline that ends the draft draws no line of its own under pre-wrap, so a BR follows it: the browser's own trailing
 *  BR, which the DOM adapter reads as nothing, and the caret after the newline sits on the new line. A chip that ends
 *  it is followed by a zero-width space, so the caret has a text position after it (the adapter counts it as nothing). */
export function editorHtml(runs) {
  const list = runs ?? [];
  const last = list[list.length - 1];
  return list.map(r => (r.type === 'text' ? esc(r.text)
    : `<span${attrs({ class: 'ref-chip', contenteditable: 'false', 'data-chip': JSON.stringify(r.chip) })}>${chipInner(chipIcon(r.chip), r.chip.label)}</span>`)).join('') +
    (last?.type === 'text' && last.text.endsWith('\n') ? '<br>' : last?.type === 'chip' ? '\u200B' : '');
}

/** The editor's menu attributes: expanded while the menu shows rows, its active row (`cm-<i>`) the active descendant. */
export function menuAria(menu) {
  const open = !!menu && flatItems(menu).length > 0;
  return { 'aria-expanded': open ? 'true' : 'false', 'aria-activedescendant': open ? `cm-${menu.active ?? 0}` : null };
}

const LABEL = { '/': 'Commands and skills', '@': 'References' };

function rowParts(it) {
  switch (it.kind) {
    case 'command': return [icon('bolt', 16), it.title, `/${it.name}`, it.description];
    case 'skill': return [icon('book', 16), it.name, `/${it.name}`, it.description];
    case 'bot': return [esc(avatarGlyph(it.id)), it.name, `@${it.id}`, it.description];
    case 'file': return [icon(it.dir ? 'layers' : 'file', 16), it.name, it.folder, ''];
    default: return [icon('chat', 16), it.title, '', it.age];
  }
}

const FOOT = '<div class="cmenu-foot"><kbd>↑↓</kbd> Move · <kbd>Enter</kbd> Choose · <kbd>Esc</kbd> Close</div>';

/** The menu: '' for none or for one with no rows. */
export function renderMenu(menu) {
  if (!menu || !flatItems(menu).length) return '';
  let i = 0;
  const body = menu.groups.map(g => {
    const head = (g.label ? `<div class="cmenu-group">${esc(g.label)}</div>` : '') + (g.crumb ? `<div class="cmenu-crumb">${esc(g.crumb)}</div>` : '');
    return head + g.items.map(it => {
      const n = i++;
      const on = n === menu.active;
      const [ic, title, name, desc] = rowParts(it);
      return `<div${attrs({ class: cls('cmenu-row', on && 'active'), role: 'option', id: `cm-${n}`, 'aria-selected': on ? 'true' : 'false', 'data-action': 'menuPick', 'data-index': String(n) })}>` +
        `<span class="cmenu-icon">${ic}</span><span class="cmenu-title">${esc(title)}</span><span class="cmenu-name">${esc(name)}</span><span class="cmenu-desc">${esc(desc)}</span></div>`;
    }).join('');
  }).join('');
  return `<div${attrs({ class: 'cmenu', role: 'listbox', 'aria-label': LABEL[menu.kind] ?? LABEL['@'] })}>${body}${FOOT}</div>`;
}

const removeKey = (key, name) =>
  `<button${attrs({ type: 'button', class: 'attach-remove', 'data-action': 'attachRemove', 'data-key': key, 'aria-label': `Remove ${name}` })}>${icon('x', 12, 2.4)}</button>`;

/** The shared file card: the file icon, the name, its line; a failed upload's Retry key; the remove key when it has one.
 *  The thread draws a sent file with it too, with neither key. */
export function fileCard({ name, meta, failedKey = null, removeKey: key = null, removeName = '', uploading = false }) {
  const line = failedKey != null
    ? `Upload failed · <button${attrs({ type: 'button', class: 'file-retry', 'data-action': 'attachRetry', 'data-key': failedKey })}>Retry</button>`
    : esc(meta);
  return `<div class="${cls('file-card', uploading && 'uploading', failedKey != null && 'failed')}"><span class="file-icon">${icon('file', 20)}</span>` +
    `<span class="file-name">${esc(name)}</span><span class="file-meta">${line}</span>${key != null ? removeKey(key, removeName || name) : ''}</div>`;
}

/** A draft's files in its order: an image a 64 px square (a card when its URL is not an image's), any other file a card. '' for none; a progress tick rewrites
 *  only this, inside #composer-files. */
export function filesRail(files) {
  return (files ?? []).map(f => {
    if (f.kind === 'image' && isImageSrc(f.url)) return `<div class="attach-image"><img${attrs({ src: f.url, alt: f.name })}>${removeKey(f.key, f.name)}</div>`;
    return fileCard({
      name: f.name, meta: f.status === 'uploading' ? progressText(f.loaded ?? 0, f.bytes) : metaText(f),
      failedKey: f.status === 'failed' ? f.key : null, removeKey: f.key, removeName: f.name, uploading: f.status === 'uploading',
    });
  }).join('');
}

/** Over the page while files are dragged onto it: the two lines, the second from the session's image limits. */
export function dropOverlay(limits) {
  return `<div class="drop-overlay"><div class="drop-card">${icon('upload', 28)}<div class="drop-title">Drop files or images here</div>` +
    `<div class="drop-sub">${esc(limitsLine(limits))}</div></div></div>`;
}

/** An image at full size: a click on the backdrop or the close key closes it, a click on the image is kept. '' for a src
 *  that is not an image's (isImageSrc): the lightbox opens nothing. */
export function lightboxHtml({ src, name }) {
  if (!isImageSrc(src)) return '';
  return `<div${attrs({ class: 'lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Image', 'data-action': 'lightboxClose' })}>` +
    `<img${attrs({ class: 'lightbox-img', src, alt: name || 'Image', 'data-action': 'lightboxKeep' })}>` +
    `<button${attrs({ type: 'button', class: 'close-key lightbox-close', 'data-action': 'lightboxClose', 'aria-label': 'Close' })}>${icon('x', 18)}</button></div>`;
}
