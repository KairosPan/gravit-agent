// face/client/js/render/lunhui/signals.js — the signals block: the sentiment module's state and money effect, the conflict
// sentence as the artifact wrote it, its measures in two columns (contraction, relay) written as the digest writes them, then
// the reviewer's challenges against sentiment in the stress colour.
import { esc } from '../../html.js';
import { label, headline, fix2, count, pill } from './block.js';
import { t, th } from '../../i18n/words.js';

// a measure's name, as the digest keys it; one the face does not name reads as its key
function measureName(measure) {
  switch (measure) {
    case 'break_ratio': return t('lunhui.signals.breakRatio');
    case 'limit_down_count': return t('lunhui.signals.limitDowns');
    case 'yesterday_negative_tail': return t('lunhui.signals.negativeTail');
    case 'seal_ratio': return t('lunhui.signals.sealRatio');
    case 'yesterday_return_median': return t('lunhui.signals.median');
    case 'max_streak': return t('lunhui.signals.maxStreak');
    default: return measure;
  }
}
const WHOLE = new Set(['limit_down_count', 'max_streak']);
const value = m => (m.value == null || m.value === '' || !Number.isFinite(Number(m.value)) ? '—' : WHOLE.has(m.measure) ? count(m.value) : fix2(m.value));

const column = (word, side, measures) => `<div class="lh-sig-col"><div class="lh-sig-h">${word}</div>` +
  measures.filter(m => m?.side === side).map(m => `<div class="lh-sig-m"><span class="lh-sig-k">${esc(measureName(m.measure))}</span><span class="lh-sig-v">${esc(value(m))}</span></div>`).join('') + '</div>';

export function signalsHtml(view, block) {
  const s = view.signals;
  if (!s || typeof s !== 'object') {
    return `${label(t('lunhui.signals.label'))}${headline(block)}<div class="lh-none">${th('lunhui.signals.none')}</div>`;
  }
  const measures = Array.isArray(s.measures) ? s.measures : [];
  const challenges = Array.isArray(s.challenges) ? s.challenges : [];
  const conflict = typeof s.conflict === 'string' && s.conflict !== '' ? `<div class="lh-conflict">${esc(s.conflict)}</div>` : '';
  const lines = challenges.length
    ? `<div class="lh-lines">${challenges.map(c => `<div class="lh-line stress"><span class="lh-id">${esc(c?.id ?? '—')}</span>${esc(c?.text ?? '')}</div>`).join('')}</div>`
    : '';
  return `${label(t('lunhui.signals.label'))}${headline(block)}<div class="lh-sig-head">${pill(s.state)}<span class="lh-sig-money">${th('lunhui.signals.money', { effect: s.moneyEffect ?? '—' })}</span></div>` +
    `${conflict}<div class="lh-sig-cols">${column(th('lunhui.signals.contraction'), 'contraction', measures)}${column(th('lunhui.signals.relay'), 'relay', measures)}</div>${lines}`;
}
