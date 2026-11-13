// face/client/js/host/analog.js — the event analog views a screen draws: a report line in the open conversation carries the
// views the face's line after its relay names, or, for a relay with none, the ids its body names that are its task's own event
// views (so another task's view, or a chart view stored before the chart analog was withdrawn, draws nothing); a task's page — on the rail at #/task/<id>, or off it at
// #/history/<id> once its New York day is over — its task's named views, else its last event view; the market page at an
// event its route's view. Each task (GET /data/tasks/one) and each view (GET /data/analog/view) is read once into the analog
// slice; a 404 is `gone` and never asked again, and a task read that failed for another reason is read once more when its
// screen is entered again. Pure but for the read it is handed and the screen each store last entered.
import { onScreenId } from './sessions.js';
import { said } from '../i18n/words.js';

/** An event analog view's id: the face's ANALOG_VIEW_ID_RE (src/analog-view.ts), copied. */
export const VIEW_ID_RE = /^an-\d{8}-[0-9a-f]{8}$/;
/** The face's line after a relay's closing fence, naming the report's event tables: src/task-relay.ts TABLE_LINE_RE, copied. */
export const TABLE_LINE_RE = /^\[face · event table: (an-\d{8}-[0-9a-f]{8}(?:, an-\d{8}-[0-9a-f]{8})*)\] /;
const NAMED = /an-\d{8}-[0-9a-f]{8}/g;
const NAMES_ONE = /an-\d{8}-[0-9a-f]{8}/;

/** The view ids a face line names, or null for a line that is not one. */
export function tableLineViews(line) {
  const hit = TABLE_LINE_RE.exec(typeof line === 'string' ? line : '');
  return hit ? hit[1].split(', ') : null;
}

const isReport = m => m?.kind === 'task' && m.data?.form === 'report';

/** The event views a report line draws: the face line's (`data.views`) when it has one, else the ids its body names that are
 * in `taskEventViews` (none while the task is unread), each once, in the order named. */
export function reportViews(message, taskEventViews) {
  if (!isReport(message)) return [];
  const line = message.data.views;
  if (Array.isArray(line)) return line.filter(id => typeof id === 'string' && VIEW_ID_RE.test(id));
  const among = Array.isArray(taskEventViews) ? taskEventViews : [];
  const body = typeof message.data.body === 'string' ? message.data.body : '';
  const out = [];
  for (const [id] of body.matchAll(NAMED)) if (among.includes(id) && !out.includes(id)) out.push(id);
  return out;
}

const loadedTask = (state, id) => {
  const entry = state.analog?.tasks?.[id];
  return entry?.status === 'loaded' ? entry.task : null;
};
const strings = v => (Array.isArray(v) ? v.filter(s => typeof s === 'string') : []);

// a task entry read again on entering its screen: failed, and not for a 404
const retriable = entry => entry?.status === 'failed' && entry.gone !== true;

/** The failed task read a report line's tables wait on, or null: a report with no face line whose body names a view id and
 * whose task read failed (its tables cannot be drawn, so the line says why). */
export function reportTaskFailure(message, state) {
  if (!isReport(message) || Array.isArray(message.data.views) || typeof message.data.task !== 'string') return null;
  if (typeof message.data.body !== 'string' || !NAMES_ONE.test(message.data.body)) return null;
  const entry = state?.analog?.tasks?.[message.data.task];
  return entry?.status === 'failed' ? entry : null;
}

/** The tasks and views the screen still wants, each once, none that has an entry: the open conversation's report lines, the
 * task page's task (on the rail or in History), the market route's event view. With `retry`, a task whose read failed for a
 * reason other than a 404 is wanted again. */
export function wantedAnalog(state, { retry = false } = {}) {
  const tasks = [];
  const views = [];
  const route = state?.route;
  if (!route) return { tasks, views };
  const haveTask = id => Object.hasOwn(state.analog?.tasks ?? {}, id) && !(retry && retriable(state.analog.tasks[id]));
  const wantTask = id => { if (!haveTask(id) && !tasks.includes(id)) tasks.push(id); };
  const wantViews = ids => { for (const id of ids) if (VIEW_ID_RE.test(id) && !views.includes(id)) views.push(id); };

  const id = onScreenId(state);
  const conv = id ? (state.conversations ?? []).find(c => c.id === id) ?? null : null;
  for (const m of conv?.messages ?? []) {
    if (!isReport(m) || typeof m.data.task !== 'string') continue;
    if (Array.isArray(m.data.views)) { wantViews(reportViews(m, null)); continue; }
    // a relay with no face line: its task's event views decide, so the task is read first when its body names any id
    if (typeof m.data.body !== 'string' || !NAMES_ONE.test(m.data.body)) continue;
    const task = loadedTask(state, m.data.task);
    if (task) wantViews(reportViews(m, strings(task.eventViews)));
    else wantTask(m.data.task);
  }

  // the task's page, or its session read in History once it is off the rail (a session that is no task answers 404, once)
  if ((route.screen === 'task' || route.screen === 'history') && typeof route.id === 'string' && route.id !== '') {
    const task = loadedTask(state, route.id);
    if (!task) wantTask(route.id);
    else {
      const named = strings(task.namedViews);
      const events = strings(task.eventViews);
      wantViews(named.length ? named : events.slice(-1));
    }
  }

  // the market page at an event (Task 8 adds the route's event)
  const eventView = route.event?.view;
  if (typeof eventView === 'string') wantViews([eventView]);

  const haveView = v => Object.hasOwn(state.analog?.views ?? {}, v);
  return { tasks, views: views.filter(v => !haveView(v)) };
}

// a failed read in words: the status when the face answered one, else the error's own message
const wordsOf = (error, fallback) => (typeof error?.status === 'number' ? `HTTP ${error.status}`
  : typeof error?.message === 'string' && error.message !== '' ? error.message : fallback);

async function readTask(store, getJson, id, retry) {
  const tasks = store.get().analog?.tasks ?? {};
  if (Object.hasOwn(tasks, id) && !(retry && retriable(tasks[id]))) return;
  store.dispatch('analogTaskLoading', id);
  try {
    const task = (await getJson(`/data/tasks/one?id=${encodeURIComponent(id)}`))?.task;
    if (task && typeof task === 'object') store.dispatch('analogTaskLoaded', { id, task });
    else store.dispatch('analogTaskFailed', { id, error: said('analog.task.noTask') });
  } catch (error) {
    store.dispatch('analogTaskFailed', { id, error: wordsOf(error, said('analog.task.failed')), gone: error?.status === 404 });
  }
}

async function readView(store, getJson, id) {
  if (Object.hasOwn(store.get().analog?.views ?? {}, id)) return;
  store.dispatch('analogViewLoading', id);
  try {
    const view = (await getJson(`/data/analog/view?id=${encodeURIComponent(id)}`))?.view;
    if (view && typeof view === 'object') store.dispatch('analogViewLoaded', { id, view });
    else store.dispatch('analogViewFailed', { id, error: said('analog.view.noView'), gone: false });
  } catch (error) {
    store.dispatch('analogViewFailed', { id, error: wordsOf(error, said('analog.view.failed')), gone: error?.status === 404 });
  }
}

// the screen each store last entered: the route's screen and id, or the conversation on screen (Ruling 6's pattern, as
// host/markets.js readEvent keeps its event)
const entered = new WeakMap();
const screenKey = state => {
  const route = state?.route;
  if (!route) return '';
  return `${route.screen}:${route.screen === 'messages' ? onScreenId(state) ?? '' : route.id ?? ''}`;
};

/** Read every wanted task, then every view wanted once they are in: loading at once, then loaded or failed. The app calls this
 * after every render and a dispatch renders, so an id another call marked in between is left to that call. A call that finds
 * the store on a screen it had not entered last time reads its failed (not 404) tasks once more. */
export async function ensureAnalog(store, getJson) {
  const key = screenKey(store.get());
  const retry = entered.get(store) !== key;
  entered.set(store, key);
  await Promise.all(wantedAnalog(store.get(), { retry }).tasks.map(id => readTask(store, getJson, id, retry)));
  await Promise.all(wantedAnalog(store.get()).views.map(id => readView(store, getJson, id)));
}
