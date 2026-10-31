// face/client/js/render/lunhui/composed.js — Gravit's composed answer (plan 2 of the Lunhui run view): the summary as Gravit
// wrote it, through the markdown renderer, then the blocks in the call's order, each drawn by the face from the run's view
// model — never from model markup. While the view is on its way a block is a skeleton line; a view that could not be read
// is one line with a Retry under the summary, never a blank.
//
// A block plugs in by kind: DRAWERS[kind](view, block, ui, id, key) returns its HTML, `block` being { kind, title?, focus? } as
// the call gave it (its headline is block.title, escaped, the drawer's own), `ui` this answer's picks
// (state.lunhui.ui[id]), `id` the answer's page id (composedId) for element ids and data-id, `key` the answer's view key
// (viewOf(m).key) for its stock links. A kind with no drawer yet draws its title alone. Pool names in the summary and in each
// headline are stock links (block.js linkNames), and nowhere else.
import { esc } from '../../html.js';
import { linkNames } from './block.js';
import { markdownHtml } from '../markdown.js';
import { viewOf } from '../../host/lunhui.js';
import { verdictsHtml } from './verdicts.js';
import { breadthHtml } from './breadth.js';
import { indicesHtml } from './indices.js';
import { ladderHtml } from './ladder.js';
import { yesterdayHtml } from './yesterday.js';
import { signalsHtml } from './signals.js';
import { sourcesHtml } from './sources.js';
import { footerHtml } from './footer.js';

// kind → drawer
const DRAWERS = { verdicts: verdictsHtml, breadth: breadthHtml, indices: indicesHtml, ladder: ladderHtml, yesterday: yesterdayHtml, signals: signalsHtml, sources: sourcesHtml };

const SKELETON = {
  verdicts: 'Drawing the verdicts…', breadth: 'Drawing breadth…', indices: 'Drawing the indices…',
  ladder: 'Drawing the ladder…', yesterday: 'Drawing yesterday…', signals: 'Drawing the signals…', sources: 'Drawing the sources…',
};

// the answer's id on the page: a message id is its log's own, so the conversation names it too
export const composedId = (m, conv) => `${conv?.id ?? ''}-${m.id}`;

const skeleton = block => `<div class="lh-skel" role="status">${esc(SKELETON[block.kind] ?? 'Drawing…')}</div>`;
const titleOnly = block => (typeof block.title === 'string' && block.title !== '' ? `<div class="lh-title">${esc(block.title)}</div>` : '');

// a drawer's headlines with their pool names linked; the rest of its HTML as it drew it
const TITLE = /(<div class="lh-title">)([\s\S]*?)(<\/div>)/g;
const linkTitles = (html, view, key) => html.replace(TITLE, (_, open, inner, close) => open + linkNames(inner, view, key) + close);

function drawn(block, view, ui, id, key) {
  const draw = Object.hasOwn(DRAWERS, block.kind) ? DRAWERS[block.kind] : null;
  if (!draw) return linkTitles(titleOnly(block), view, key);
  // a view that does not hold what a drawer reads costs that block, not the answer
  try { return linkTitles(draw(view, block, ui ?? {}, id, key), view, key); } catch { return `<div class="lh-error">This block could not be drawn.</div>`; }
}

// the footer after the blocks, once the view is here; one it cannot read costs only itself
function footer(view) {
  try { return footerHtml(view); } catch { return ''; }
}

export function composedHtml(m, entry, ui, conv) {
  const d = m.data ?? {};
  const blocks = Array.isArray(d.blocks) ? d.blocks.filter(b => b && typeof b.kind === 'string') : [];
  const loaded = entry?.status === 'loaded' && entry.view && typeof entry.view === 'object';
  const key = viewOf(m).key;
  const text = markdownHtml(m.text ?? d.summary ?? '');
  const summary = `<div class="lh-summary">${loaded ? linkNames(text, entry.view, key) : text}</div>`;
  if (entry?.status === 'failed') {
    return `<div class="lh-answer">${summary}<div class="lh-error" role="status">The run view could not be loaded: ${esc(entry.error ?? '')} ` +
      `<button type="button" class="btn-sm" data-action="lunhuiRetry" data-key="${esc(key)}">Retry</button></div></div>`;
  }
  const id = composedId(m, conv);
  const body = blocks.map(b => `<section class="lh-block">${loaded ? drawn(b, entry.view, ui, id, key) : skeleton(b)}</section>`).join('');
  return `<div class="lh-answer">${summary}${body}${loaded ? footer(entry.view) : ''}</div>`;
}
