// face/client/js/host/rail-view.js — the rail of tasks as facts (one-entry plan 2): each task the face's /data/tasks gave, in
// its group — waiting on you, running, done today — with its worker's open gate and its short status in words. A gate the mux
// delivered moves its line under you before the next read says so; a waiting task whose gate the operator answered here
// waits on no one until that read. Pure: no clock but the `now` it is handed.
import { t, tn } from '../i18n/words.js';
import { needsAnswer } from '../messages.js';
import { fmtClock, MIN } from '../time.js';

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

/** The tasks in their groups, in the order the face gave them. */
export function railOf(state, now = Date.now()) {
  const rail = { you: [], running: [], done: [] };
  for (const task of state.tasks?.items ?? []) {
    const { group, line } = lineOf(task, state, now);
    rail[group].push(line);
  }
  return rail;
}

/** The lines waiting on the operator: the Messages badge. */
export const waitingCount = state => railOf(state).you.length;
