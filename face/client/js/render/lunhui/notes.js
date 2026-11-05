// face/client/js/render/lunhui/notes.js — a composed answer's working notes (plan 2 of the Lunhui run view, task 4): the
// words Gravit wrote on its way to the answer, folded into one closed disclosure placed above it, so the answer reads first.
import { esc } from '../../html.js';
import { th } from '../../i18n/words.js';

// composed id → the ids of the Gravit text messages it folds: those after the latest operator message (or an earlier
// composed answer) before it, up to it. Tool rows, system lines and anything else stay where they are.
export function foldNotes(messages) {
  const out = new Map();
  let start = 0;
  (Array.isArray(messages) ? messages : []).forEach((m, i, all) => {
    if (m.from === 'you') start = i + 1;
    else if (m.kind === 'composed') {
      out.set(m.id, all.slice(start, i).filter(x => x.from === 'gravit' && x.kind === 'text').map(x => x.id));
      start = i + 1;
    }
  });
  return out;
}

// the disclosure, id'd by the conversation and the answer so the render's keep-open pass finds it again; `inner` is the
// folded messages as the thread draws them
export const notesHtml = (conv, m, count, inner) =>
  `<details id="notes-${esc(conv.id)}-${esc(m.id)}" class="notes"><summary>${th('lunhui.notes', { n: count })}</summary><div class="notes-body">${inner}</div></details>`;
