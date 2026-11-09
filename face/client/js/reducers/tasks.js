// face/client/js/reducers/tasks.js — the conversation's tasks as GET /data/tasks gave them (host/tasks.js): whole-set,
// `off` when the face has no conversation (FACE_ROUTER=0: the route answers 404), `failed` keeping the last items, and
// the ids with a Stop or Continue in flight; and the desk's lines the same read carries (one-entry plan 3): the standing
// orders and today's firings and annotations, empty when the read has none.
const tasks = (s, patch) => ({ ...s, tasks: { ...s.tasks, ...patch } });
const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const NO_DESK = { scheduled: [], lines: [] };
// a line's state, which the rail draws as a class: one of the three the face sends, anything else done
const DESK_STATES = new Set(['running', 'done', 'failed']);
const deskOf = d => (isRecord(d) ? {
  scheduled: Array.isArray(d.scheduled) ? d.scheduled.filter(o => isRecord(o) && typeof o.order === 'string') : [],
  lines: Array.isArray(d.lines)
    ? d.lines.filter(l => isRecord(l) && typeof l.id === 'string').map(l => (DESK_STATES.has(l.state) ? l : { ...l, state: 'done' }))
    : [],
} : NO_DESK);

export const reducers = {
  tasksLoaded: (s, { conversation = null, tasks: items = [], desk = null, at = null } = {}) => tasks(s, {
    status: 'ready',
    conversation: typeof conversation === 'string' && conversation !== '' ? conversation : null,
    items: Array.isArray(items) ? items.filter(t => t && typeof t.id === 'string') : [],
    desk: deskOf(desk),
    at,
  }),
  tasksOff: (s, { at = null } = {}) => tasks(s, { status: 'off', conversation: null, items: [], desk: NO_DESK, at }),
  tasksFailed: (s, { at = null } = {}) => tasks(s, { status: 'failed', at }),
  taskBusy: (s, { id, on } = {}) => {
    if (typeof id !== 'string') return s;
    const has = s.tasks.busy.includes(id);
    if (on && !has) return tasks(s, { busy: [...s.tasks.busy, id] });
    if (!on && has) return tasks(s, { busy: s.tasks.busy.filter(b => b !== id) });
    return s;
  },
};
