// face/client/js/host/memory-lunhui.js — the owner's lessons on a Lunhui run's leaders (memory alert and Lunhui, Task 5): each
// run a loaded view names is asked once, `GET /data/memory/lunhui?strategy=&run=`, by the view's own names, and the face's
// answer lands in the memoryLunhui slice (reducers/memory-lunhui.js) — ready with the lessons, or failed on a throw or a body
// that holds none. A run with an entry is not asked again, save that a failed read is asked once more, on a render no sooner
// than LESSONS_RETRY_MS after it failed (no timer is set), and after a second failure stays failed and draws nothing; when
// each failed and how many times is kept beside each store, not in its state. Nothing waits on it: the view is drawn first
// and its lessons join it when they land. Pure but for the read it is handed and that record.

/** A run's key: the view's own strategy and run. */
export const runKey = view => `${view.strategy}/${view.run}`;

/** How long after a failed read its one more read waits, at the least. */
export const LESSONS_RETRY_MS = 5_000;

const named = v => typeof v === 'string' && v !== '';
const lessonsPath = ({ strategy, run }) => `/data/memory/lunhui?strategy=${encodeURIComponent(strategy)}&run=${encodeURIComponent(run)}`;

/** Each store's failed reads, by run key: { strategy, run, at, count, asking }. */
const failures = new WeakMap();
const failuresOf = store => {
  let kept = failures.get(store);
  if (!kept) failures.set(store, (kept = new Map()));
  return kept;
};

/** Whether the failed read of `key` is due its one more read at `at`. */
function dueAgain(store, key, at) {
  const failed = failuresOf(store).get(key);
  if (!failed || failed.count !== 1 || failed.asking || at - failed.at < LESSONS_RETRY_MS) return false;
  const kept = store.get()?.memoryLunhui ?? {};
  return Object.hasOwn(kept, key) && kept[key]?.status === 'failed';
}

/** The failed runs due their one more read: [{ runKey, strategy, run }]. */
function retries(store, at) {
  return [...failuresOf(store)].filter(([key]) => dueAgain(store, key, at)).map(([key, f]) => ({ runKey: key, strategy: f.strategy, run: f.run }));
}

/** Whether a render has a run to ask: one with no entry, or a failed one due its one more read. */
export function lessonsDue(store, now = Date.now) {
  return wantedLessons(store.get()).length > 0 || retries(store, now()).length > 0;
}

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

// read every wanted run and every failed one due its one more read: loading at once, then ready or failed. The app calls this
// after every render and a dispatch renders, so each run is checked again right before its dispatch: one a nested call marked
// meanwhile is left to that call
export async function ensureLunhuiLessons(store, getJson, now = Date.now) {
  const kept = failuresOf(store);
  const failed = want => {
    const was = kept.get(want.runKey);
    kept.set(want.runKey, { strategy: want.strategy, run: want.run, at: now(), count: (was?.count ?? 0) + 1, asking: false });
    store.dispatch('memoryLunhuiFailed', want.runKey);
  };
  const read = async (want, again) => {
    if (again) {
      if (!dueAgain(store, want.runKey, now())) return;
      kept.get(want.runKey).asking = true;
    } else if (Object.hasOwn(store.get().memoryLunhui ?? {}, want.runKey)) return;
    store.dispatch('memoryLunhuiLoading', want.runKey);
    try {
      const body = await getJson(lessonsPath(want));
      const lessons = body?.lessons;
      if (lessons && typeof lessons === 'object' && !Array.isArray(lessons)) {
        kept.delete(want.runKey);
        store.dispatch('memoryLunhuiLoaded', { runKey: want.runKey, lessons });
      } else failed(want);
    } catch {
      failed(want);
    }
  };
  await Promise.all([...wantedLessons(store.get()).map(want => read(want, false)), ...retries(store, now()).map(want => read(want, true))]);
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
