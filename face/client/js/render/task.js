// face/client/js/render/task.js — a task's full process (one-entry plan 2 Task 8): #/task/<id> is its worker's transcript,
// read-only. The head: back to Messages, the task's title, its state (the rail's dot and short status), its strategy, the
// keys its state allows (Stop, Continue), Working and the jobs chip and Details as on Messages. The thread as the thread
// draws it — a Lunhui composed answer included, its follow-ups sent to Gravit by app.js — with its gates answerable as on
// the task's line. In place of a composer one line: to change course, tell Gravit (a link to Messages).
import { esc, cls } from '../html.js';
import { th } from '../i18n/words.js';
import { icon } from '../icons.js';
import { maskExcerpt } from '../mask.js';
import { taskLine } from '../host/rail-view.js';
import { renderThread } from './thread.js';
import { earlierKey, headRight, renderDetails } from './messages.js';
import { stateKeys, dotOf } from './tasks.js';
import { eventTablesHtml } from './event-table.js';

const back = () => `<a class="task-back" href="#/messages" aria-label="${th('tasks.page.back')}">${icon('chevLeft', 18, 2.2)}</a>`;

// the head's facts from the task as /data/tasks gave it: its state's dot and short status, its strategy, its keys
function facts(found, state) {
  if (!found) return '';
  const { group, line } = found;
  const { task } = line;
  const strategy = typeof task.strategy === 'string' && task.strategy !== ''
    ? `<a class="task-head-strategy" href="#/strategy/${esc(encodeURIComponent(task.strategy))}">${esc(task.strategy)}</a>` : '';
  const keys = stateKeys(task, state.tasks.busy.includes(task.id));
  return `<span class="task-head-state"><span class="${cls('task-dot', dotOf(line, group))}"></span>${esc(line.status)}</span>${strategy}` +
    (keys ? `<span class="task-head-keys">${keys}</span>` : '');
}

// the event views the page draws (analog event table §4.1): those its reports named, newest first, else its last event view;
// the task as GET /data/tasks/one read it (the analog slice), so a task off the rail still draws (History draws them too)
export function pageViews(state, id) {
  const entry = state.analog?.tasks?.[id];
  if (entry?.status !== 'loaded') return [];
  const strings = v => (Array.isArray(v) ? v.filter(s => typeof s === 'string') : []);
  const named = strings(entry.task?.namedViews);
  return named.length ? [...named].reverse() : strings(entry.task?.eventViews).slice(-1);
}

/** The task's page: Loading… while neither the list nor the tasks carry it, Not found once they are in without it. */
export function renderTaskScreen(state, now, page = {}) {
  const id = state.route.id;
  const found = taskLine(state, id, now);
  const conv = state.conversations.find(c => c.id === id) ?? null;
  const title = found?.line.task.title || conv?.title || id || '';
  const head = `<header class="head">${back()}<h1 class="head-title">${esc(maskExcerpt(title))}</h1>${facts(found, state)}${conv ? headRight(conv, state) : ''}</header>`;
  if (!conv) {
    const known = state.conversations.length && state.tasks.status !== 'loading';
    const word = known && !found ? th('history.notFound') : th('common.loading');
    return `<main class="main chan">${head}<div class="chan-body"><div class="chan-none dim">${word}</div></div></main>`;
  }
  const thread = `<div class="thread-box"><div class="thread" id="thread">${eventTablesHtml(state, pageViews(state, id))}${earlierKey(conv)}${renderThread(conv, state, now, page)}</div></div>`;
  const foot = `<div class="task-foot"><a class="task-tell" href="#/messages">${th('tasks.page.tell')}</a></div>`;
  return `<main class="${cls('main', (state.detailsOpen || state.lunhui?.stock) && 'with-drawer', state.lunhui?.stock && 'with-stock')}">${head}${thread}${foot}` +
    `${state.detailsOpen ? renderDetails(conv, state, now, { worker: true, task: found?.line.task ?? null }) : ''}</main>`;
}
