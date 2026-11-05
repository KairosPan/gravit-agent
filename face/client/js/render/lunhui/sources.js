// face/client/js/render/lunhui/sources.js — the sources block and the footer's evidence line: per source, frozen (✓), refused
// (✗ with the refusal codes, a repeated code counted ×n), or not asked (—), and the modules whose artifacts named it missing.
import { esc } from '../../html.js';
import { label, headline } from './block.js';
import { t, th } from '../../i18n/words.js';

export const asked = s => Boolean(s?.frozen) || (Array.isArray(s?.refusals) && s.refusals.length > 0) || (Array.isArray(s?.missingIn) && s.missingIn.length > 0);

// the codes in the order first met, a repeat as ×n
export function codesWords(refusals) {
  const n = new Map();
  for (const c of Array.isArray(refusals) ? refusals : []) n.set(c, (n.get(c) ?? 0) + 1);
  return [...n].map(([c, k]) => (k > 1 ? `${c} ×${k}` : String(c))).join(t('common.list.sep'));
}

// a stand-in run's boards came from iFinD (同花顺问财), Eastmoney's refusal code beside it
function state(s) {
  if (s.frozen) return `✓ ${[s.provider === '同花顺问财' ? t('lunhui.src.viaIfind') : t('lunhui.src.frozen'), s.delayed ? t('lunhui.src.delayed') : ''].filter(Boolean).join(' · ')}`; // words-order: how it froze, then delayed, under the visual separator
  if (!asked(s)) return '—';
  const codes = codesWords(s.refusals);
  return codes ? `✗ ${codes}` : `✗ ${t('lunhui.src.notFrozen')}`;
}

export function sourcesHtml(view, block) {
  const sources = Array.isArray(view.sources) ? view.sources : [];
  const rows = sources.map(s => {
    const missing = Array.isArray(s.missingIn) && s.missingIn.length ? `<span class="lh-src-miss">${th('lunhui.src.missingIn', { modules: s.missingIn.join(t('common.list.sep')) })}</span>` : '';
    const from = s.frozen && s.provider === '同花顺问财' && typeof s.fallbackFrom === 'string' && s.fallbackFrom ? `<span class="lh-src-miss">Eastmoney ${esc(s.fallbackFrom)}</span>` : ''; // en-kept: a provider's name and its code
    return `<div class="lh-src"><span class="lh-src-name">${esc(s.source)}</span><span class="lh-src-state">${esc(state(s))}</span>${from}${missing}</div>`;
  }).join('');
  return `${label(t('lunhui.src.label'))}${headline(block)}<div class="lh-srcs">${rows}</div>`;
}
