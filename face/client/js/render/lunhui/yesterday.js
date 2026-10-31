// face/client/js/render/lunhui/yesterday.js — the yesterday block: how yesterday's multi-board names did today. A switch orders
// the rows (By change: worst first; By boards: tallest first, worst first among equals); the tiles are the median and the share
// below −5%; each row is a stock link, its boards and today's change with a bar in proportion to the largest move.
import { esc, cls } from '../../html.js';
import { seg } from '../controls.js';
import { label, headline, readout, count, fix2, signedPct, stockLink } from './block.js';

const tone = v => { const r = Number(Number(v).toFixed(2)); return r > 0 ? 'up' : r < 0 ? 'down' : 'flat'; };
const pctOf = r => (Number.isFinite(Number(r?.pct)) ? Number(r.pct) : 0);

function nameHtml(r, view, key) {
  const held = typeof r.code === 'string' && view?.stocks && typeof view.stocks === 'object' && Object.hasOwn(view.stocks, r.code);
  return held ? stockLink({ code: r.code, name: r.name }, key) : esc(r.name ?? r.code ?? '—');
}

export function yesterdayHtml(view, block, ui, id, key) {
  const y = view.yesterday;
  if (!y || typeof y !== 'object' || y.unavailable) {
    return `${label("Yesterday's limit-ups")}${headline(block)}<div class="lh-none">Yesterday's limit-ups were not frozen for this run.</div>`;
  }
  const rows = (Array.isArray(y.rows) ? y.rows : []).filter(r => r && typeof r === 'object');
  const mode = ui?.ysort === 'boards' ? 'boards' : 'pct';
  const sorted = [...rows].sort((a, b) => (mode === 'boards' ? (Number(b.yesterdayBoards) || 0) - (Number(a.yesterdayBoards) || 0) : 0) || pctOf(a) - pctOf(b));
  const max = Math.max(0, ...rows.map(r => Math.abs(pctOf(r))));
  const below = `${fix2(Number(y.belowMinus5Share) * 100)}%`;
  const tile = (k, v) => `<div class="lh-stat"><span class="lh-stat-k">${esc(k)}</span><span class="lh-stat-v">${esc(v)}</span></div>`;
  const control = seg([['By change', 'pct'], ['By boards', 'boards']], mode, 'lunhuiUi', { 'data-id': id, 'data-field': 'ysort' });
  const list = sorted.length
    ? `<div class="lh-yrows">${sorted.map(r => {
      const p = pctOf(r);
      const w = max > 0 ? Math.abs(p) / max * 100 : 0;
      return `<div class="lh-yrow"><span class="lh-yname">${nameHtml(r, view, key)}</span><span class="lh-yb">${esc(r.yesterdayBoards)}b</span>` +
        `<span class="${cls('lh-ypct', tone(p))}">${esc(signedPct(p))}</span>` +
        `<span class="lh-ybar" aria-hidden="true"><span class="${cls('lh-ybar-fill', tone(p))}" style="width:${w.toFixed(1)}%"></span></span></div>`;
    }).join('')}</div>`
    : '<div class="lh-none">No name at two boards or more yesterday.</div>';
  return `${label(`Yesterday's limit-ups · ${count(y.count)}`)}${headline(block)}${control}` +
    `<div class="lh-stats">${tile('Median', signedPct(y.median))}${tile('Below −5%', below)}</div>${list}` +
    readout(`${count(y.count)} limit-ups yesterday · median ${signedPct(y.median)} · ${below} below −5%`);
}
