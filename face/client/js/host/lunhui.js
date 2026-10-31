// face/client/js/host/lunhui.js — the run views Gravit's composed answers draw from (plan 2 of the Lunhui run view, task 4):
// a composed message names its run and the view modules it reads; the open conversation's answers ask the face's view
// route (GET /data/lunhui/view) once per key, and the answer lands in the lunhui slice — loaded, or failed with its words,
// which the answer draws under its summary with a Retry. Pure but for the read it is handed.
import { firstOpen } from './sessions.js';
import { cursorPatch } from '../render/lunhui/intraday.js';

const str = v => (typeof v === 'string' ? v : '');
const modulesOf = d => (Array.isArray(d?.modules) ? d.modules.filter(m => typeof m === 'string') : []);

export const viewKey = ({ strategy, run, modules }) => `${strategy}/${run}/${modules.join(',')}`;
// an empty list asks `modules=`, which the route reads as no module at all
export const viewPath = ({ strategy, run, modules }) =>
  `/data/lunhui/view?strategy=${encodeURIComponent(strategy)}&run=${encodeURIComponent(run)}&modules=${encodeURIComponent(modules.join(','))}`;

// the composed message's view request, its key with it
export function viewOf(m) {
  const want = { strategy: str(m?.data?.strategy), run: str(m?.data?.run), modules: modulesOf(m?.data) };
  return { key: viewKey(want), ...want };
}

// the open conversation, on Messages only (the render's currentConversation, without the screens it imports)
function openConversation(state) {
  if (state?.route?.screen !== 'messages') return null;
  const all = Array.isArray(state.conversations) ? state.conversations : [];
  return all.find(c => c.id === state.route.id) ?? firstOpen(all) ?? null;
}

// the open conversation's composed answers whose view has no entry yet, each key once
export function wantedViews(state) {
  const conv = openConversation(state);
  if (!conv) return [];
  const views = state.lunhui?.views ?? {};
  const out = new Map();
  for (const m of conv.messages ?? []) {
    if (m.kind !== 'composed') continue;
    const want = viewOf(m);
    if (want.strategy === '' || want.run === '' || Object.hasOwn(views, want.key) || out.has(want.key)) continue;
    out.set(want.key, want);
  }
  return [...out.values()];
}

// a failed read in words: the status when the face answered one, else the error's own message
const wordsOf = error => (typeof error?.status === 'number' ? `HTTP ${error.status}`
  : typeof error?.message === 'string' && error.message !== '' ? error.message : 'the view could not be read');

// read every wanted view: loading at once, then loaded or failed. The app calls this after every render and a dispatch
// renders, so a key another call marked in between (a render between two loads) is left to that call: nothing is asked twice
export async function ensureViews(store, getJson) {
  await Promise.all(wantedViews(store.get()).map(async ({ key, strategy, run, modules }) => {
    if (Object.hasOwn(store.get().lunhui?.views ?? {}, key)) return;
    store.dispatch('lunhuiViewLoading', key);
    try {
      const body = await getJson(viewPath({ strategy, run, modules }));
      const view = body?.view;
      if (view && typeof view === 'object') store.dispatch('lunhuiViewLoaded', { key, view });
      else store.dispatch('lunhuiViewFailed', { key, error: 'the answer held no view' });
    } catch (error) {
      store.dispatch('lunhuiViewFailed', { key, error: wordsOf(error) });
    }
  }));
}

// the minute cursor (task 6): the slider and the pointer move an indices chart's cursor in place — its line, its dot and the
// readout — and never the store, so a drag costs no render; a render that lands mid-drag draws the cursor at the last
// minute, and reapplyCursors (called right after the render restores the inputs) puts it back where the slider stands

/** The grid minute under the pointer: the chart's box mapped onto its 760-wide viewBox, the plot 56–708, clamped. */
export function minuteAt(clientX, rect, last) {
  const width = Number(rect?.width);
  if (!(width > 0)) return last;
  const i = Math.round(((clientX - rect.left) / width * 760 - 56) / 652 * 241);
  return Math.min(last, Math.max(0, i));
}

/** Set the cursor of answer `id` from a cursorPatch: the line's x1/x2, the dot's cx/cy, the readout's words. Dispatches nothing. */
export function applyCursor(doc, id, patch) {
  if (!patch) return;
  const cur = doc.getElementById(`cur-${id}`);
  const dot = doc.getElementById(`dot-${id}`);
  const read = doc.getElementById(`read-${id}`);
  if (cur) { cur.setAttribute('x1', String(patch.x)); cur.setAttribute('x2', String(patch.x)); }
  if (dot) { dot.setAttribute('cx', String(patch.x)); dot.setAttribute('cy', String(patch.y)); }
  if (read) read.textContent = patch.readout;
}

/** A loaded run view by its strategy and run: every view of one run holds the same indices, whichever modules it asked. */
export function runView(state, strategy, run) {
  for (const entry of Object.values(state?.lunhui?.views ?? {})) {
    if (entry?.status === 'loaded' && entry.view?.strategy === strategy && entry.view?.run === run) return entry.view;
  }
  return null;
}

/** The patch for a slider or a chart, by its data (data-strategy, data-run, data-symbol), at `minute`. */
export function cursorFor(state, el, minute) {
  const d = el?.dataset ?? {};
  const view = runView(state, d.strategy, d.run);
  return view ? cursorPatch(view, d.symbol, minute) : null;
}

/** After a render: every minute slider not at its max gets its cursor back at its own minute. */
export function reapplyCursors(root, doc, state) {
  for (const el of root.querySelectorAll('input[data-action="lunhuiMinute"]')) {
    if (String(el.value) === String(el.max)) continue;
    applyCursor(doc, el.dataset.id, cursorFor(state, el, Number(el.value)));
  }
}

// the stock drawer (plan 3, task 2): one code for a stock however a source writes it — sh600838 (the freezes' symbol), 600838
// (the view's stocks key) or cn:600838 (the Markets key) — and the board its prefix names
const CODE = /^(?:sh|sz|bj|cn:)?(\d{6})$/;
/** The six digits of a stock's code, from sh/sz/bj600838, 600838 or cn:600838; anything else is null. */
export function stockCode(raw) {
  if (typeof raw !== 'string') return null;
  const hit = CODE.exec(raw);
  return hit ? hit[1] : null;
}
/** The Markets key of a code. */
export const marketKey = code => `cn:${code}`;
/** The board a code's prefix names, or null for one no board here lists. */
export function boardOf(code) {
  const c = stockCode(code);
  if (!c) return null;
  if (/^60/.test(c)) return 'SH main board';
  if (/^68[89]/.test(c)) return 'STAR';
  if (/^00[0-3]/.test(c)) return 'SZ main board';
  if (/^30[01]/.test(c)) return 'ChiNext';
  if (/^(?:4|8|92)/.test(c)) return 'BSE';
  return null;
}
