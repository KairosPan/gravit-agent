// face/client/js/render/lunhui/composed.js — Gravit's composed answer (plan 2 of the Lunhui run view): the summary as Gravit
// wrote it, through the markdown renderer, then the blocks in the call's order, each drawn by the face from the run's view
// model — never from model markup. While the view is on its way a block is a skeleton line; a view that could not be read
// is one line with a Retry under the summary, never a blank.
//
// A block plugs in by kind: DRAWERS[kind](view, block, ui, id) returns its HTML, `block` being { kind, title?, focus? } as
// the call gave it (its headline is block.title, escaped, the drawer's own), `ui` this answer's picks
// (state.lunhui.ui[id]), `id` the answer's page id (composedId) for element ids and data-id. A kind with no drawer yet draws
// its title alone.
import { esc } from '../../html.js';
import { markdownHtml } from '../thread.js';
import { viewOf } from '../../host/lunhui.js';

// kind → drawer; plan 2's tasks 5–7 add verdicts, breadth, sources (and the footer after the blocks), indices, ladder
const DRAWERS = {};

const SKELETON = {
  verdicts: 'Drawing the verdicts…', breadth: 'Drawing breadth…', indices: 'Drawing the indices…',
  ladder: 'Drawing the ladder…', sources: 'Drawing the sources…',
};

// the answer's id on the page: a message id is its log's own, so the conversation names it too
export const composedId = (m, conv) => `${conv?.id ?? ''}-${m.id}`;

const skeleton = block => `<div class="lh-skel" role="status">${esc(SKELETON[block.kind] ?? 'Drawing…')}</div>`;
const titleOnly = block => (typeof block.title === 'string' && block.title !== '' ? `<div class="lh-title">${esc(block.title)}</div>` : '');

function drawn(block, view, ui, id) {
  const draw = Object.hasOwn(DRAWERS, block.kind) ? DRAWERS[block.kind] : null;
  if (!draw) return titleOnly(block);
  // a view that does not hold what a drawer reads costs that block, not the answer
  try { return draw(view, block, ui ?? {}, id); } catch { return `<div class="lh-error">This block could not be drawn.</div>`; }
}

export function composedHtml(m, entry, ui, conv) {
  const d = m.data ?? {};
  const blocks = Array.isArray(d.blocks) ? d.blocks.filter(b => b && typeof b.kind === 'string') : [];
  const summary = `<div class="lh-summary">${markdownHtml(m.text ?? d.summary ?? '')}</div>`;
  if (entry?.status === 'failed') {
    return `<div class="lh-answer">${summary}<div class="lh-error" role="status">The run view could not be loaded: ${esc(entry.error ?? '')} ` +
      `<button type="button" class="btn-sm" data-action="lunhuiRetry" data-key="${esc(viewOf(m).key)}">Retry</button></div></div>`;
  }
  const loaded = entry?.status === 'loaded' && entry.view && typeof entry.view === 'object';
  const id = composedId(m, conv);
  const body = blocks.map(b => `<section class="lh-block">${loaded ? drawn(b, entry.view, ui, id) : skeleton(b)}</section>`).join('');
  return `<div class="lh-answer">${summary}${body}</div>`;
}
