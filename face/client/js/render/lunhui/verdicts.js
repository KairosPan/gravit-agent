// face/client/js/render/lunhui/verdicts.js — the verdicts block: one tile per market module in the view's order (its name,
// its state, the detail line, and how many reviewer items stand against it); the open tile (ui.tile) shows that module's
// claims as the artifact wrote them, then the reviewer's items against it in the stress colour.
import { esc, attrs, cls } from '../../html.js';
import { label, headline } from './block.js';

// a state's pill tone: strength green, weakness red, a module that could not judge in the stress colour, the rest grey
const TONE = { STRONG: 'up', EXPANDING: 'up', RELAY: 'up', WEAK: 'down', CONTRACTING: 'down', NOT_EVALUABLE: 'warn' };
const pill = state => `<span class="${cls('chip', TONE[state] ?? 'grey')}">${esc(state ?? '—')}</span>`;
const line = (l, stress = false) => `<div class="${cls('lh-line', stress && 'stress')}"><span class="lh-id">${esc(l?.id ?? '—')}</span>${esc(l?.text ?? '')}</div>`;

export function verdictsHtml(view, block, ui, id) {
  const verdicts = Array.isArray(view.verdicts) ? view.verdicts : [];
  const items = Array.isArray(view.reviewer?.items) ? view.reviewer.items : null;
  const against = module => (items ? items.filter(x => x?.against === module) : []);
  const challenged = v => (items ? against(v.module).length : Number(v.challenged) || 0);
  const open = verdicts.find(v => v.module === ui.tile) ?? null;
  const tiles = verdicts.map(v => {
    const n = challenged(v);
    return `<button${attrs({ type: 'button', class: cls('lh-tile', v === open && 'open'), 'data-action': 'lunhuiUi', 'data-id': id, 'data-field': 'tile', 'data-value': v.module, 'aria-expanded': v === open ? 'true' : 'false' })}>` +
      `<span class="lh-tile-name">${esc(v.module)}</span>${pill(v.state)}<span class="lh-tile-detail">${esc(v.detail ?? '')}</span>` +
      (n > 0 ? `<span class="lh-tile-chal">${n} challenged</span>` : '') + '</button>';
  }).join('');
  const lines = open
    ? `<div class="lh-lines">${(Array.isArray(open.lines) ? open.lines : []).map(l => line(l)).join('')}${against(open.module).map(x => line(x, true)).join('')}</div>`
    : '';
  const n = verdicts.length;
  return `${label(`This run · ${n} module${n === 1 ? '' : 's'}`)}${headline(block)}<div class="lh-tiles">${tiles}</div>${lines}`;
}
