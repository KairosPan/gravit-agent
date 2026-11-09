// face/client/js/reducers/tasks.js — the conversation's tasks as GET /data/tasks gave them (host/tasks.js): whole-set,
// `off` when the face has no conversation (FACE_ROUTER=0: the route answers 404), `failed` keeping the last items, and
// the ids with a Stop or Continue in flight.
const tasks = (s, patch) => ({ ...s, tasks: { ...s.tasks, ...patch } });

export const reducers = {
  tasksLoaded: (s, { conversation = null, tasks: items = [], at = null } = {}) => tasks(s, {
    status: 'ready',
    conversation: typeof conversation === 'string' && conversation !== '' ? conversation : null,
    items: Array.isArray(items) ? items.filter(t => t && typeof t.id === 'string') : [],
    at,
  }),
  tasksOff: (s, { at = null } = {}) => tasks(s, { status: 'off', conversation: null, items: [], at }),
  tasksFailed: (s, { at = null } = {}) => tasks(s, { status: 'failed', at }),
  taskBusy: (s, { id, on } = {}) => {
    if (typeof id !== 'string') return s;
    const has = s.tasks.busy.includes(id);
    if (on && !has) return tasks(s, { busy: [...s.tasks.busy, id] });
    if (!on && has) return tasks(s, { busy: s.tasks.busy.filter(b => b !== id) });
    return s;
  },
};
