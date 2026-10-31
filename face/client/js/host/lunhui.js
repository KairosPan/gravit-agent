// face/client/js/host/lunhui.js — the run views Gravit's composed answers draw from (plan 2 of the Lunhui run view, task 4):
// a composed message names its run and the view modules it reads; the open conversation's answers ask the face's view
// route (GET /data/lunhui/view) once per key, and the answer lands in the lunhui slice — loaded, or failed with its words,
// which the answer draws under its summary with a Retry. Pure but for the read it is handed.
import { firstOpen } from './sessions.js';

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
