// face/client/js/render/lunhui/footer.js — the footer every loaded composed answer ends with (not a block, spec §5.2): the
// sources the run asked for, ✓ or ✗, when its evidence froze in China time, and the run.
import { esc } from '../../html.js';
import { asked } from './sources.js';
import { chinaStamp } from './time.js';

export function footerHtml(view) {
  const sources = Array.isArray(view?.sources) ? view.sources.filter(asked) : [];
  const words = ['Evidence', ...sources.map(s => `${s.source} ${s.frozen ? '✓' : '✗'}`), `frozen ${chinaStamp(view?.frozenAt)}`, `run ${view?.run ?? '—'}`];
  return `<div class="lh-foot">${esc(words.join(' · '))}</div>`;
}
