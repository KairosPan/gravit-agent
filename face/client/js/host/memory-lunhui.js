// face/client/js/host/memory-lunhui.js — the owner's lessons on a Lunhui run's leaders (memory alert and Lunhui, Task 5): each
// run a loaded view names is asked once, `GET /data/memory/lunhui?strategy=&run=`, by the view's own names, and the face's
// answer lands in the memoryLunhui slice (reducers/memory-lunhui.js) — ready with the lessons, or failed on a throw or a body
// that holds none. A run with an entry is never asked again. Nothing waits on it: the view is drawn first and its lessons
// join it when they land. Pure but for the read it is handed.

/** A run's key: the view's own strategy and run. */
export const runKey = view => `${view.strategy}/${view.run}`;

const named = v => typeof v === 'string' && v !== '';
const lessonsPath = ({ strategy, run }) => `/data/memory/lunhui?strategy=${encodeURIComponent(strategy)}&run=${encodeURIComponent(run)}`;

/** The loaded views' runs with no entry, each once: [{ runKey, strategy, run }]. */
export function wantedLessons(state) {
  const kept = state?.memoryLunhui ?? {};
  const out = new Map();
  for (const entry of Object.values(state?.lunhui?.views ?? {})) {
    const view = entry?.status === 'loaded' ? entry.view : null;
    if (!view || !named(view.strategy) || !named(view.run)) continue;
    const key = runKey(view);
    if (Object.hasOwn(kept, key) || out.has(key)) continue;
    out.set(key, { runKey: key, strategy: view.strategy, run: view.run });
  }
  return [...out.values()];
}

// read every wanted run: loading at once, then ready or failed. The app calls this after every render and a dispatch renders,
// so each run is checked again right before its first dispatch: one a nested call marked meanwhile is left to that call
export async function ensureLunhuiLessons(store, getJson) {
  await Promise.all(wantedLessons(store.get()).map(async want => {
    if (Object.hasOwn(store.get().memoryLunhui ?? {}, want.runKey)) return;
    store.dispatch('memoryLunhuiLoading', want.runKey);
    try {
      const body = await getJson(lessonsPath(want));
      const lessons = body?.lessons;
      if (lessons && typeof lessons === 'object' && !Array.isArray(lessons)) store.dispatch('memoryLunhuiLoaded', { runKey: want.runKey, lessons });
      else store.dispatch('memoryLunhuiFailed', want.runKey);
    } catch {
      store.dispatch('memoryLunhuiFailed', want.runKey);
    }
  }));
}

/** A view's run's ready lessons, or null. */
export function lessonsFor(state, view) {
  if (!view || typeof view !== 'object' || !named(view.strategy) || !named(view.run)) return null;
  const kept = state?.memoryLunhui ?? {};
  const key = runKey(view);
  const entry = Object.hasOwn(kept, key) ? kept[key] : null;
  return entry?.status === 'ready' && entry.lessons && typeof entry.lessons === 'object' ? entry.lessons : null;
}

/** A checked answer's leader of that code, or null. */
export function leaderLessons(lessons, code) {
  if (lessons?.state !== 'checked' || !Array.isArray(lessons.leaders)) return null;
  return lessons.leaders.find(l => l && typeof l === 'object' && l.code === code) ?? null;
}
