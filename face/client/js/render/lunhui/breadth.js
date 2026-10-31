// face/client/js/render/lunhui/breadth.js — the breadth block: Counts (the advance/unchanged/decline split, the limit-up and
// limit-down counts, the day's turnover) or By change (the 23 change buckets as Eastmoney keys them, −11…11, each in
// proportion to the largest); the readout answers the switch (the up/down ratio) or the picked bucket (its count and share).
import { esc, attrs, cls } from '../../html.js';
import { seg } from '../controls.js';
import { label, headline, readout, count } from './block.js';

const NAMED = { '-11': 'Limit-down', 0: 'Unchanged', 11: 'Limit-up' };
const signed = n => (n < 0 ? `−${-n}` : n > 0 ? `+${n}` : '0');
const bucketName = n => NAMED[n] ?? `Bucket ${signed(n)}`;
const pct = (n, total) => (total > 0 ? `${(n / total * 100).toFixed(1)}%` : '—');
const stocks = n => `${n} stock${n === 1 ? '' : 's'}`;

// the turnover in yuan, compact (the readouts are English, so trillions rather than 万亿)
function yuan(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  for (const [size, unit] of [[1e12, ' tn'], [1e9, ' bn'], [1e6, ' m']]) if (Math.abs(n) >= size) return `¥${(n / size).toFixed(2)}${unit}`;
  return `¥${count(Math.round(n))}`;
}

function ratioWords(b) {
  const up = Number(b.advancers), down = Number(b.decliners);
  if (!(up > 0) && !(down > 0)) return 'Up/down ratio —';
  if (!(down > 0)) return 'Up/down ratio — · no fallers';
  const ratio = Number.isFinite(Number(b.ratio)) ? Number(b.ratio) : up / down;
  if (!(up > 0)) return `Up/down ratio ${ratio.toFixed(2)} · no risers`;
  return ratio >= 1
    ? `Up/down ratio ${ratio.toFixed(2)} · about ${Math.round(up / down)} risers for every 1 faller`
    : `Up/down ratio ${ratio.toFixed(2)} · about 1 riser for every ${Math.round(down / up)} fallers`;
}

function counts(b) {
  const total = Number(b.total);
  const split = `<div class="lh-split" aria-hidden="true"><span class="lh-split-up" style="flex-grow:${Number(b.advancers) || 0}"></span>` +
    `<span class="lh-split-flat" style="flex-grow:${Number(b.unchanged) || 0}"></span><span class="lh-split-down" style="flex-grow:${Number(b.decliners) || 0}"></span></div>`;
  const row = `<div class="lh-split-row"><span class="up">↑ ${esc(b.advancers)} up · ${pct(b.advancers, total)}</span>` +
    `<span class="dim">${esc(b.unchanged)} unchanged</span><span class="down">↓ ${esc(b.decliners)} down · ${pct(b.decliners, total)}</span></div>`;
  const tile = (k, v) => `<div class="lh-stat"><span class="lh-stat-k">${esc(k)}</span><span class="lh-stat-v">${esc(v)}</span></div>`;
  const tiles = `<div class="lh-stats">${tile('Limit-up', count(b.limitUp))}${tile('Limit-down', count(b.limitDown))}${tile('Turnover', yuan(b.turnover))}</div>`;
  return `${split}${row}${tiles}${readout(ratioWords(b))}`;
}

function byChange(b, ui, id) {
  const buckets = (Array.isArray(b.buckets) ? b.buckets : []).filter(x => Number.isInteger(x?.bucket)).map(x => ({ bucket: x.bucket, count: Number(x.count) || 0 }));
  const max = Math.max(0, ...buckets.map(x => x.count));
  const biggest = buckets.reduce((best, x) => (best && best.count >= x.count ? best : x), null);
  const asked = Number(ui.bucket);
  const picked = buckets.find(x => x.bucket === asked) ?? biggest;
  const total = Number(b.total);
  const bars = buckets.map(x => {
    const tone = x.bucket > 0 ? 'up' : x.bucket < 0 ? 'down' : 'flat';
    const on = x === picked;
    return `<button${attrs({ type: 'button', class: cls('lh-bucket', on && 'pressed'), 'data-action': 'lunhuiUi', 'data-id': id, 'data-field': 'bucket', 'data-value': String(x.bucket), 'aria-pressed': on ? 'true' : 'false', 'aria-label': `${bucketName(x.bucket)}: ${stocks(x.count)}` })}>` +
      `<span class="${cls('lh-bucket-bar', tone)}" style="height:${(max > 0 ? x.count / max * 100 : 0).toFixed(1)}%"></span><span class="lh-bucket-k">${signed(x.bucket)}</span></button>`;
  }).join('');
  const words = picked ? `${bucketName(picked.bucket)}: ${stocks(picked.count)} · ${pct(picked.count, total)} of ${b.total}` : 'No buckets were frozen';
  return `<div class="lh-dist">${bars}</div>${readout(words)}`;
}

export function breadthHtml(view, block, ui, id) {
  const b = view.breadth;
  if (!b || typeof b !== 'object' || b.unavailable) {
    return `${label('Breadth')}${headline(block)}<div class="lh-none">Breadth was not frozen for this run.</div>`;
  }
  const mode = ui.breadth === 'dist' ? 'dist' : 'counts';
  const control = seg([['Counts', 'counts'], ['By change', 'dist']], mode, 'lunhuiUi', { 'data-id': id, 'data-field': 'breadth' });
  return `${label(`Breadth · ${count(b.total)} stocks`)}${headline(block)}${control}${mode === 'dist' ? byChange(b, ui, id) : counts(b)}`;
}
