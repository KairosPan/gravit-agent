// face/client/js/reducers/memory-lunhui.js — the lessons of each Lunhui run, by its key (host/memory-lunhui.js runKey,
// `<strategy>/<run>`), as the face answered GET /data/memory/lunhui: loading, ready with the answer, or failed. An entry is
// never dropped, so a run is asked once, and a failed one once more (host/memory-lunhui.js).

const slice = s => s.memoryLunhui ?? {};
const put = (s, runKey, entry) => (typeof runKey === 'string' && runKey !== '' ? { ...s, memoryLunhui: { ...slice(s), [runKey]: entry } } : s);

export const reducers = {
  memoryLunhuiLoading: (s, runKey) => put(s, runKey, { status: 'loading' }),
  memoryLunhuiLoaded: (s, { runKey, lessons } = {}) => (lessons && typeof lessons === 'object' ? put(s, runKey, { status: 'ready', lessons }) : s),
  memoryLunhuiFailed: (s, runKey) => put(s, runKey, { status: 'failed' }),
};
