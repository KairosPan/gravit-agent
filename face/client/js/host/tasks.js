// face/client/js/host/tasks.js — the conversation's tasks from the face (plan 2 of one entry): GET /data/tasks read at once,
// again after each list refresh (app.js calls refresh()) and every TASKS_POLL_MS on the app's timers; Stop and Continue
// post once while one is in flight. A 404 from the read is `off` (no conversation: FACE_ROUTER=0); any other failure
// keeps the last items. Impure; nothing here draws. A failed write is a status line, never a throw.
import { said } from '../i18n/words.js';

export const TASKS_POLL_MS = 15_000;

// a message to the conversation about one task: the tag on its own first line, the title flattened to one line
const flat = v => String(v ?? '').replace(/[\s\]]+/g, ' ').trim();
export const followUpText = (task, text) => `[follow-up · task ${flat(task?.id)} · ${flat(task?.title)}]\n${text}`; // en-kept: the tag the router's contract reads

export function startTasks({ store, getJson, postJson, timers, now = Date.now }) {
  let seq = 0;        // only the latest-started read lands
  let timer = null;
  let disposed = false;

  async function refresh() {
    const mine = ++seq;
    try {
      const body = await getJson('/data/tasks');
      if (mine !== seq || disposed) return;
      store.dispatch('tasksLoaded', { conversation: body?.conversation ?? null, tasks: body?.tasks ?? [], desk: body?.desk ?? null, at: now() });
    } catch (err) {
      if (mine !== seq || disposed) return;
      store.dispatch(err?.status === 404 ? 'tasksOff' : 'tasksFailed', { at: now() });
    }
  }

  function arm() {
    if (disposed) return;
    timer = timers.after(TASKS_POLL_MS, () => { timer = null; void refresh().finally(arm); });
  }


  async function write(path, id, failed) {
    if (store.get().tasks.busy.includes(id)) return;
    store.dispatch('taskBusy', { id, on: true });
    try {
      await postJson(path, { task: id });
    } catch (err) {
      const line = failed === 'stop' && (err?.status === 404 || err?.status === 409) ? said('tasks.stop.gone') : failed === 'stop' ? said('tasks.stop.failed') : said('tasks.resume.failed');
      store.dispatch('hostStatus', { line, bad: true });
    } finally {
      store.dispatch('taskBusy', { id, on: false });
    }
    await refresh();
  }

  void refresh();
  arm();

  return {
    refresh,
    stop: id => write('/data/tasks/stop', id, 'stop'),
    resume: id => write('/data/tasks/continue', id, 'resume'),
    dispose() {
      disposed = true;
      if (timer !== null) timers.cancel(timer);
      timer = null;
    },
  };
}
