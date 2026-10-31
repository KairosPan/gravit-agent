// face/client/js/render/lunhui/sources.js — the sources block and the footer's evidence line: per source, frozen (✓), refused
// (✗ with the refusal codes, a repeated code counted ×n), or not asked (—), and the modules whose artifacts named it missing.
import { esc } from '../../html.js';
import { label, headline } from './block.js';

export const asked = s => Boolean(s?.frozen) || (Array.isArray(s?.refusals) && s.refusals.length > 0) || (Array.isArray(s?.missingIn) && s.missingIn.length > 0);

// the codes in the order first met, a repeat as ×n
export function codesWords(refusals) {
  const n = new Map();
  for (const c of Array.isArray(refusals) ? refusals : []) n.set(c, (n.get(c) ?? 0) + 1);
  return [...n].map(([c, k]) => (k > 1 ? `${c} ×${k}` : String(c))).join(', ');
}

// a stand-in run's boards came from iFinD (同花顺问财), Eastmoney's refusal code beside it
function state(s) {
  if (s.frozen) return `✓ ${s.provider === '同花顺问财' ? 'via iFinD' : 'frozen'}${s.delayed ? ' · delayed' : ''}`;
  if (!asked(s)) return '—';
  const codes = codesWords(s.refusals);
  return codes ? `✗ ${codes}` : '✗ not frozen';
}

export function sourcesHtml(view, block) {
  const sources = Array.isArray(view.sources) ? view.sources : [];
  const rows = sources.map(s => {
    const missing = Array.isArray(s.missingIn) && s.missingIn.length ? `<span class="lh-src-miss">missing in ${esc(s.missingIn.join(', '))}</span>` : '';
    const from = s.frozen && s.provider === '同花顺问财' && typeof s.fallbackFrom === 'string' && s.fallbackFrom ? `<span class="lh-src-miss">Eastmoney ${esc(s.fallbackFrom)}</span>` : '';
    return `<div class="lh-src"><span class="lh-src-name">${esc(s.source)}</span><span class="lh-src-state">${esc(state(s))}</span>${from}${missing}</div>`;
  }).join('');
  return `${label('Sources')}${headline(block)}<div class="lh-srcs">${rows}</div>`;
}
