// face/client/js/host/rail-view.js — the rail of tasks as facts (one-entry plan 2): each task the face's /data/tasks gave, in
// its group — waiting on you, running, done today — with its worker's open gate and its short status in words. A gate the mux
// delivered moves its line under you before the next read says so; a waiting task whose gate the operator answered here
// waits on no one until that read. The desk folds in (one-entry plan 3): today's firings and annotations run or are done
// beside the tasks, never waiting on you, and the standing orders are a group of their own after done, read-only. Their
// times are New York's. Pure: no clock but the `now` it is handed.
import { t, tn } from '../i18n/words.js';
import { needsAnswer } from '../messages.js';
import { fmtClock, MIN } from '../time.js';
import { deskTime } from './desk-view.js';

const GATE_KINDS = new Set(['card', 'approval', 'question']);
const GROUPS = new Set(['you', 'running', 'done']);
const WORDS = {
  stopped: () => t('tasks.status.stopped'), stalled: () => t('tasks.status.stalled'),
  blocked: () => t('tasks.status.blocked'), failed: () => t('tasks.status.failed'),
};

// the short status: a gate's ask (an order card or an approval, or a question), the steps and minutes while it runs, the
// clock it finished at, else the state's word
function statusOf(task, gate, state, now) {
  if (state === 'waiting') {
    const kind = gate ? (gate.kind === 'question' ? 'question' : 'approval') : task.waitingFor?.kind;
    return kind === 'question' ? t('tasks.status.answer') : t('tasks.status.approve');
  }
  if (state === 'running') {
    const steps = Array.isArray(task.steps) ? task.steps.length : 0;
    const minutes = Number.isFinite(task.startedAt) ? Math.max(0, Math.floor((now - task.startedAt) / MIN)) : 0;
    return tn('tasks.status.running', steps, { minutes });
  }
  if (state === 'done') return t('tasks.status.done', { clock: fmtClock(task.lastEventAt) });
  return Object.hasOwn(WORDS, state) ? WORDS[state]() : '';
}

function lineOf(task, state, now) {
  const record = state.conversations.find(c => c.id === task.id);
  const gate = record?.messages.findLast(needsAnswer) ?? null;
  const answeredHere = !gate && task.state === 'waiting' && !!record?.messages.some(m => GATE_KINDS.has(m.kind));
  const shown = gate ? 'waiting' : answeredHere ? 'running' : task.state;
  const group = gate ? 'you' : answeredHere ? 'running' : GROUPS.has(task.group) ? task.group : 'running';
  return { group, line: { task, gate, status: statusOf(task, gate, shown, now) } };
}

// a firing's or an annotation's short status: since when it runs, the clock it ended at - New York's, saying ET, as a
// scheduled line's - or failed
function deskStatusOf(line, now) {
  if (line.state === 'running') return t('tasks.desk.since', { clock: deskTime(line.startedAt, now) });
  if (line.state === 'failed') return t('tasks.status.failed');
  return t('tasks.status.done', { clock: deskTime(line.endedAt ?? line.startedAt, now) });
}

// a standing order's short status: its next firing in New York's time, else why it has none
function scheduledStatusOf(order, now) {
  if (order.expired === true) return t('tasks.scheduled.expired');
  if (order.enabled !== true) return t('tasks.scheduled.disabled');
  return typeof order.next === 'string' && order.next !== '' ? t('tasks.scheduled.next', { at: deskTime(order.next, now) }) : t('tasks.scheduled.noNext');
}

/** The tasks in their groups, in the order the face gave them; the desk's lines of today after them in running or done (a
 * task line is `{task, gate, status}`, a desk line `{desk, status}`); the standing orders as `{scheduled, status}`. */
export function railOf(state, now = Date.now()) {
  const rail = { you: [], running: [], done: [], scheduled: [] };
  for (const task of state.tasks?.items ?? []) {
    const { group, line } = lineOf(task, state, now);
    rail[group].push(line);
  }
  const desk = state.tasks?.desk ?? null;
  for (const line of desk?.lines ?? []) rail[line.state === 'running' ? 'running' : 'done'].push({ desk: line, status: deskStatusOf(line, now) });
  for (const order of desk?.scheduled ?? []) rail.scheduled.push({ scheduled: order, status: scheduledStatusOf(order, now) });
  return rail;
}

/** One task's line and its group, as the rail draws it (a task's page heads with it); null for a task the face did not give. */
export function taskLine(state, id, now = Date.now()) {
  const task = (state.tasks?.items ?? []).find(x => x.id === id);
  return task ? lineOf(task, state, now) : null;
}

/** The lines waiting on the operator: the Messages badge (task lines alone: the desk never waits on you). */
export const waitingCount = state => railOf(state).you.length;

// a strategy goes by one name everywhere: its channel's display title (the registry's, the operator's to change), else its name
export const channelLabel = ch => (typeof ch.title === 'string' && ch.title !== '' ? ch.title : ch.name);

/** The strategies: every channel but the root, by name. */
export function strategiesOf(state) {
  return (Array.isArray(state.channels) ? state.channels : [])
    .filter(ch => !ch.isRoot && typeof ch.name === 'string' && ch.name !== '')
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** History: every session the list holds that is neither the conversation nor one of its tasks, newest first. */
export function historyOf(state) {
  const tasks = new Set((state.tasks?.items ?? []).map(task => task.id));
  const conversation = state.tasks?.conversation ?? null;
  return (state.conversations ?? [])
    .filter(c => c.id !== conversation && !tasks.has(c.id))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}
