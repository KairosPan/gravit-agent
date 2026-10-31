// face/client/js/render/lunhui/footer.js — the footer every loaded composed answer ends with (not a block, spec §5.2): the
// sources the run asked for, ✓ or ✗, when its evidence froze in China time, and the run.
import { esc } from '../../html.js';
import { asked } from './sources.js';
import { chinaStamp } from './time.js';

// channels: state.channels; the run's channel (its name is the strategy) gets Open run, any other run nothing
export function footerHtml(view, channels) {
  const sources = Array.isArray(view?.sources) ? view.sources.filter(asked) : [];
  const words = ['Evidence', ...sources.map(s => `${s.source} ${s.frozen ? '✓' : '✗'}`), `frozen ${chinaStamp(view?.frozenAt)}`, `run ${view?.run ?? '—'}`];
  const own = Array.isArray(channels) && typeof view?.strategy === 'string' ? channels.find(c => c?.name === view.strategy && c.workspaceId) : null;
  const open = own ? ` <button type="button" class="lh-open-run" data-action="lunhuiOpenRun" data-id="${esc(own.workspaceId)}">Open run ›</button>` : '';
  return `<div class="lh-foot">${esc(words.join(' · '))}${open}</div>`;
}
