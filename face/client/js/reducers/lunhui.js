// face/client/js/reducers/lunhui.js — the composed answers' slice (plan 2 of the Lunhui run view): each run view by its key
// (host/lunhui.js viewKey) — loading, loaded with its model, or failed with its words until Retry forgets it — and each
// answer's own picks (a tile open, a tab, a bucket) by the answer's id — and the stock drawer open (plan 3): the opening answer's
// view key and the code, or null. Opening it closes every other overlay (reducers/messages.js closeOverlays).
import { closeOverlays } from './messages.js';

const slice = s => s.lunhui ?? { views: {}, ui: {}, stock: null };
const putView = (s, key, entry) => (typeof key === 'string' ? { ...s, lunhui: { ...slice(s), views: { ...slice(s).views, [key]: entry } } } : s);

export const reducers = {
  lunhuiViewLoading: (s, key) => putView(s, key, { status: 'loading' }),
  lunhuiViewLoaded: (s, { key, view }) => putView(s, key, { status: 'loaded', view }),
  lunhuiViewFailed: (s, { key, error }) => putView(s, key, { status: 'failed', error: typeof error === 'string' && error !== '' ? error : 'the view could not be read' }),
  lunhuiRetry(s, key) {
    const views = slice(s).views;
    if (typeof key !== 'string' || !Object.hasOwn(views, key)) return s;
    const { [key]: _gone, ...rest } = views;
    return { ...s, lunhui: { ...slice(s), views: rest } };
  },
  lunhuiStockOpen(s, { key, code } = {}) {
    if (typeof key !== 'string' || typeof code !== 'string' || code === '') return s;
    const c = closeOverlays(s);
    return { ...c, lunhui: { ...slice(c), stock: { key, code } } };
  },
  lunhuiStockClose: s => (slice(s).stock == null ? s : { ...s, lunhui: { ...slice(s), stock: null } }),
  lunhuiUi(s, { id, patch }) {
    if (typeof id !== 'string' || !patch || typeof patch !== 'object') return s;
    const ui = slice(s).ui;
    return { ...s, lunhui: { ...slice(s), ui: { ...ui, [id]: { ...(ui[id] ?? {}), ...patch } } } };
  },
};
