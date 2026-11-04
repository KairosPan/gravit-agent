// The composer's view: a draft's runs as the editor's markup, and the / and @ menus. Strings only; app.js puts them in place.
import { esc, attrs, cls } from '../html.js';
import { icon } from '../icons.js';
import { avatarGlyph } from '../wire/room.js';
import { flatItems } from './menus.js';

const chipIcon = c => icon(c.kind === 'bot' ? 'agent' : c.kind === 'conversation' ? 'chat' : c.dir ? 'layers' : 'file', 13);

/** A chip's inner markup: its icon and its label. The bubble draws a conversation mention with it, no data and editable. */
export const chipInner = (iconHtml, label) => `${iconHtml}<span class="ref-chip-label">${esc(label)}</span>`;

/** The editor's markup: text escaped (its newlines kept under pre-wrap), a chip atomic, carrying itself in data-chip. A
 *  newline that ends the draft draws no line of its own under pre-wrap, so a BR follows it: the browser's own trailing
 *  BR, which the DOM adapter reads as nothing, and the caret after the newline sits on the new line. */
export function editorHtml(runs) {
  const list = runs ?? [];
  const last = list[list.length - 1];
  return list.map(r => (r.type === 'text' ? esc(r.text)
    : `<span${attrs({ class: 'ref-chip', contenteditable: 'false', 'data-chip': JSON.stringify(r.chip) })}>${chipInner(chipIcon(r.chip), r.chip.label)}</span>`)).join('') +
    (last?.type === 'text' && last.text.endsWith('\n') ? '<br>' : '');
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
