// face/client/js/render/lunhui/breadth.js — the breadth block: Counts (the advance/unchanged/decline split, the limit-up and
// limit-down counts, the day's turnover) or By change (the 23 change buckets as Eastmoney keys them, −11…11, each in
// proportion to the largest); the readout answers the switch (the up/down ratio) or the picked bucket (its count and share).
import { esc, attrs, cls } from '../../html.js';
import { seg } from '../controls.js';
import { label, headline, readout, count, yuan } from './block.js';
import { t, th, tn } from '../../i18n/words.js';

const signed = n => (n < 0 ? `−${-n}` : n > 0 ? `+${n}` : '0');
// the three buckets Eastmoney names, the rest by their change
const bucketName = n => (n === -11 ? t('lunhui.breadth.limitDown') : n === 0 ? t('lunhui.breadth.unchanged') : n === 11 ? t('lunhui.breadth.limitUp')
  : t('lunhui.breadth.bucket', { n: signed(n) }));
const pct = (n, total) => (total > 0 ? `${(n / total * 100).toFixed(1)}%` : '—');
const stocks = n => tn('lunhui.breadth.stocks', n, { n: count(n) });

function ratioWords(b) {
  const up = Number(b.advancers), down = Number(b.decliners);
  if (!(up > 0) && !(down > 0)) return t('lunhui.breadth.ratioNone');
  if (!(down > 0)) return t('lunhui.breadth.noFallers');
  const ratio = Number.isFinite(Number(b.ratio)) ? Number(b.ratio) : up / down;
  if (!(up > 0)) return t('lunhui.breadth.noRisers', { ratio: ratio.toFixed(2) });
  return ratio >= 1
    ? t('lunhui.breadth.risers', { ratio: ratio.toFixed(2), n: Math.round(up / down) })
    : t('lunhui.breadth.fallers', { ratio: ratio.toFixed(2), n: Math.round(down / up) });
}

function counts(b) {
  const total = Number(b.total);
  const split = `<div class="lh-split" aria-hidden="true"><span class="lh-split-up" style="flex-grow:${Number(b.advancers) || 0}"></span>` +
    `<span class="lh-split-flat" style="flex-grow:${Number(b.unchanged) || 0}"></span><span class="lh-split-down" style="flex-grow:${Number(b.decliners) || 0}"></span></div>`;
  const row = `<div class="lh-split-row"><span class="up">${th('lunhui.breadth.up', { n: count(b.advancers), pct: pct(b.advancers, total) })}</span>` +
    `<span class="dim">${th('lunhui.breadth.flat', { n: count(b.unchanged) })}</span><span class="down">${th('lunhui.breadth.down', { n: count(b.decliners), pct: pct(b.decliners, total) })}</span></div>`;
  const tile = (k, v) => `<div class="lh-stat"><span class="lh-stat-k">${esc(k)}</span><span class="lh-stat-v">${esc(v)}</span></div>`;
  const tiles = `<div class="lh-stats">${tile(t('lunhui.breadth.limitUp'), count(b.limitUp))}${tile(t('lunhui.breadth.limitDown'), count(b.limitDown))}${tile(t('lunhui.turnover'), yuan(b.turnover))}</div>`;
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
    return `<button${attrs({ type: 'button', class: cls('lh-bucket', on && 'pressed'), 'data-action': 'lunhuiUi', 'data-id': id, 'data-field': 'bucket', 'data-value': String(x.bucket), 'aria-pressed': on ? 'true' : 'false', 'aria-label': t('lunhui.breadth.bucketLabel', { bucket: bucketName(x.bucket), stocks: stocks(x.count) }) })}>` +
      `<span class="${cls('lh-bucket-bar', tone)}" style="height:${(max > 0 ? x.count / max * 100 : 0).toFixed(1)}%"></span><span class="lh-bucket-k">${signed(x.bucket)}</span></button>`;
  }).join('');
  const words = picked ? t('lunhui.breadth.picked', { name: bucketName(picked.bucket), stocks: stocks(picked.count), pct: pct(picked.count, total), total: count(b.total) }) : t('lunhui.breadth.noBuckets');
  return `<div class="lh-dist">${bars}</div>${readout(words)}`;
}

export function breadthHtml(view, block, ui, id) {
  const b = view.breadth;
  if (!b || typeof b !== 'object' || b.unavailable) {
    return `${label(t('lunhui.breadth.title'))}${headline(block)}<div class="lh-none">${th('lunhui.breadth.none')}</div>`;
  }
  const mode = ui.breadth === 'dist' ? 'dist' : 'counts';
  const control = seg([[t('lunhui.breadth.counts'), 'counts'], [t('lunhui.byChange'), 'dist']], mode, 'lunhuiUi', { 'data-id': id, 'data-field': 'breadth' });
  return `${label(t('lunhui.breadth.label', { n: count(b.total) }))}${headline(block)}${control}${mode === 'dist' ? byChange(b, ui, id) : counts(b)}`;
}
