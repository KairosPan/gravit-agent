// face/client/js/render/lunhui/signals.js — the signals block: the sentiment module's state and money effect, the conflict
// sentence as the artifact wrote it, its measures in two columns (contraction, relay) written as the digest writes them, then
// the reviewer's challenges against sentiment in the stress colour.
import { esc } from '../../html.js';
import { label, headline, fix2, count, pill } from './block.js';

const NAMES = {
  break_ratio: 'Break ratio', limit_down_count: 'Limit-downs', yesterday_negative_tail: 'Yesterday below −5%',
  seal_ratio: 'Seal ratio', yesterday_return_median: 'Yesterday median', max_streak: 'Highest streak',
};
const WHOLE = new Set(['limit_down_count', 'max_streak']);
const value = m => (m.value == null || m.value === '' || !Number.isFinite(Number(m.value)) ? '—' : WHOLE.has(m.measure) ? count(m.value) : fix2(m.value));

const column = (word, side, measures) => `<div class="lh-sig-col"><div class="lh-sig-h">${word}</div>` +
  measures.filter(m => m?.side === side).map(m => `<div class="lh-sig-m"><span class="lh-sig-k">${esc(NAMES[m.measure] ?? m.measure)}</span><span class="lh-sig-v">${esc(value(m))}</span></div>`).join('') + '</div>';

export function signalsHtml(view, block) {
  const s = view.signals;
  if (!s || typeof s !== 'object') {
    return `${label('Sentiment signals')}${headline(block)}<div class="lh-none">Sentiment was not read in this run.</div>`;
  }
  const measures = Array.isArray(s.measures) ? s.measures : [];
  const challenges = Array.isArray(s.challenges) ? s.challenges : [];
  const conflict = typeof s.conflict === 'string' && s.conflict !== '' ? `<div class="lh-conflict">${esc(s.conflict)}</div>` : '';
  const lines = challenges.length
    ? `<div class="lh-lines">${challenges.map(c => `<div class="lh-line stress"><span class="lh-id">${esc(c?.id ?? '—')}</span>${esc(c?.text ?? '')}</div>`).join('')}</div>`
    : '';
  return `${label('Sentiment signals')}${headline(block)}<div class="lh-sig-head">${pill(s.state)}<span class="lh-sig-money">money effect ${esc(s.moneyEffect ?? '—')}</span></div>` +
    `${conflict}<div class="lh-sig-cols">${column('Contraction', 'contraction', measures)}${column('Relay', 'relay', measures)}</div>${lines}`;
}
