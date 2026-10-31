// face/client/js/render/lunhui/indices.js — the indices block: one row per index in the view's order (its name, last, change
// and the day's sparkline; a button that charts it), the picked index's day minute by minute with Gravit's focus band, the
// minute slider under it, and the readout that answers the slider or the pointer. The slider and the pointer move the cursor
// in place (host/lunhui.js applyCursor); neither touches the store.
import { esc, attrs, cls } from '../../html.js';
import { label, headline, signedPct, fix2 } from './block.js';
import { intradaySvg, sparklineSvg, cursorPatch } from './intraday.js';

const hasLine = row => Array.isArray(row?.minutes?.price) && row.minutes.price.length > 0;
const num = v => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);

function rowHtml(row, on, id) {
  const pct = num(row.pct);
  const tone = pct === null || pct === 0 ? null : pct < 0 ? 'down' : 'up';
  return `<button${attrs({ type: 'button', class: cls('lh-ix', on && 'pressed'), 'data-action': 'lunhuiUi', 'data-id': id, 'data-field': 'index', 'data-value': row.symbol, 'aria-pressed': on ? 'true' : 'false' })}>` +
    `<span class="lh-ix-name">${esc(row.name ?? row.symbol)}</span>` +
    `<span class="lh-ix-last">${num(row.last) === null ? '—' : fix2(row.last)}</span>` +
    `<span class="${cls('lh-ix-pct', tone)}">${pct === null ? '—' : signedPct(pct)}</span>` +
    (hasLine(row) ? sparklineSvg(row.minutes) : '') +
    `</button>`;
}

function chart(view, block, row, id) {
  if (!hasLine(row)) return `<div class="lh-none">No minute line frozen for ${esc(row.name ?? row.symbol)}</div>`;
  const last = row.minutes.price.length - 1;
  const where = { 'data-id': id, 'data-strategy': view.strategy ?? '', 'data-run': view.run ?? '', 'data-symbol': row.symbol };
  const svg = intradaySvg(row.minutes, { focus: block.focus, minute: last, id })
    .replace(/^<svg class="lh-chart"/, `<svg class="lh-chart"${attrs({ 'data-action': 'lunhuiHover', 'data-last': String(last), ...where })}`);
  const slider = `<input${attrs({ type: 'range', id: `minute-${id}`, class: 'lh-minute', 'data-action': 'lunhuiMinute', ...where, min: '0', max: String(last), value: String(last), step: '1', 'aria-label': `Minute on ${row.name ?? row.symbol}` })}>`;
  const words = cursorPatch(view, row.symbol, last)?.readout ?? '';
  return `${svg}${slider}<div class="lh-readout" id="read-${esc(id)}" role="status" aria-live="polite">${esc(words)}</div>`;
}

export function indicesHtml(view, block, ui, id) {
  const ix = view.indices;
  const rows = Array.isArray(ix?.rows) ? ix.rows.filter(r => r && typeof r.symbol === 'string') : [];
  if (!ix || ix.unavailable || rows.length === 0) {
    return `${label('Indices')}${headline(block)}<div class="lh-none">Indices were not frozen for this run.</div>`;
  }
  const picked = rows.find(r => r.symbol === ui.index) ?? rows[0];
  const through = typeof view.through === 'string' && view.through !== '' ? ` · through ${view.through}` : '';
  return `${label(`Indices${through}`)}${headline(block)}` +
    `<div class="lh-ix-rows">${rows.map(r => rowHtml(r, r === picked, id)).join('')}</div>` +
    chart(view, block, picked, id);
}
