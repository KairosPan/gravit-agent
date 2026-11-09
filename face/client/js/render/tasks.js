// face/client/js/render/tasks.js — the rail of tasks (one-entry plan 2): a head per group that has a line — waiting on you,
// running, done today — and one line per task, a disclosure whose summary is only its state's dot, its title, its short
// status and a caret. Expanded: its strategy, its steps (newest last), its open gate (answered on the line) or its result,
// its tokens, and the keys its state allows — Stop, Continue — beside the link to its full process. A line is open while
// the page holds its id open (app.js), so a whole-page render never folds one the operator opened. On a narrow window
// the rail folds above the thread under one summary counting the lines waiting on you (app.css).
// The desk folds in (one-entry plan 3): a task from the phone names its origin; today's firings and annotations are lines
// in running and done — expanded, their kind, their text and their session in History, no key — and the standing orders
// are the scheduled group after done, each its order and its next firing; expanded, its strategy, its last outcome and
// that session in History, no key. Their open ids are `desk:<id>` and `order:<order>`, never a task's.
import { esc, attrs, cls } from '../html.js';
import { th } from '../i18n/words.js';
import { icon } from '../icons.js';
import { maskExcerpt } from '../mask.js';
import { railOf } from '../host/rail-view.js';
import { deskTime, firingWord } from '../host/desk-view.js';
import { gateHtml, NETWORKS } from './thread.js';

const GROUPS = [['you', () => th('tasks.group.you')], ['running', () => th('tasks.group.running')], ['done', () => th('tasks.group.done')], ['scheduled', () => th('tasks.group.scheduled')]];
const DESK_KINDS = { firing: () => th('thread.desk.schedule'), annotation: () => th('thread.desk.alert') };
const STOPS = new Set(['running', 'waiting', 'stalled']);
const CONTINUES = new Set(['stalled', 'failed', 'blocked']);
const fmtN = n => Math.round(Number(n) || 0).toLocaleString('en-US');

function usageOf(u) {
  if (!u || typeof u !== 'object') return '';
  const tokens = th('tasks.usage', { in: fmtN((u.uncachedInputTokens ?? 0) + (u.cacheReadTokens ?? 0)), out: fmtN(u.outputTokens ?? 0) });
  return `<div class="task-usage">${tokens}</div>`;
}

/** The keys a task's state allows: Stop while it runs, waits or stalls; Continue once it stalled, failed or was blocked —
 * both disabled while one is in flight. The line and the task's page draw the same. */
export function stateKeys(task, busy) {
  const key = (action, label) => `<button${attrs({ type: 'button', class: 'btn-sm', 'data-action': action, 'data-task': task.id, disabled: busy })}>${label}</button>`;
  return `${STOPS.has(task.state) ? key('taskStop', th('details.stop')) : ''}${CONTINUES.has(task.state) ? key('taskResume', th('tasks.continue')) : ''}`;
}

function keys(task, busy) {
  return `<div class="task-keys">${stateKeys(task, busy)}<a class="btn-sm" href="#/task/${esc(encodeURIComponent(task.id))}">${th('tasks.full')}</a></div>`;
}

// where a task came from, named only for the phone (a browser task is the page's own)
function originOf(task) {
  if (task.origin !== 'phone') return '';
  const word = Object.hasOwn(NETWORKS, task.network) ? th('thread.phone.on', { network: NETWORKS[task.network] }) : th('thread.phone');
  return `<div class="task-origin">${word}</div>`;
}

const strategyRow = name => (typeof name === 'string' && name !== ''
  ? `<div class="task-strategy"><span class="task-strategy-label">${th('tasks.strategy')}</span><a class="task-strategy-link" href="#/strategy/${esc(encodeURIComponent(name))}">${esc(name)}</a></div>` : '');
const historyLink = id => (typeof id === 'string' && id !== ''
  ? `<div class="task-keys"><a class="btn-sm" href="#/history/${esc(encodeURIComponent(id))}">${th('tasks.desk.session')}</a></div>` : '');

// a line's disclosure: its summary only the dot, a bot task's bot (one-entry plan 4), the title, the status and the caret;
// the body as given
function lineHtml(id, dot, title, status, body, open, bot = '') {
  const who = typeof bot === 'string' && bot !== '' ? `<span class="task-bot">${esc(bot)}</span>` : '';
  return `<details${attrs({ class: 'task-line', 'data-task': id, open: open?.has(id) === true })}>` +
    `<summary${attrs({ id: `tline-${id}`, 'data-action': 'toggleTask', 'data-task': id })}><span class="${cls('task-dot', dot)}"></span>${who}` +
    `<span class="task-title">${esc(maskExcerpt(title ?? ''))}</span><span class="task-status">${esc(status)}</span><span class="task-caret">${icon('chevDown', 14, 2.2)}</span></summary>` +
    `<div class="task-body">${body}</div></details>`;
}

/** A firing's or an annotation's line: its kind, its text, its session in History; no key. */
export function deskLineHtml({ desk, status }, open) {
  const kind = Object.hasOwn(DESK_KINDS, desk.kind) ? `<div class="task-origin">${DESK_KINDS[desk.kind]()}</div>` : '';
  const text = typeof desk.text === 'string' && desk.text !== '' ? `<div class="task-result">${esc(maskExcerpt(desk.text))}</div>` : '';
  return lineHtml(`desk:${desk.id}`, desk.state, desk.title, status, kind + text + historyLink(desk.sessionId), open);
}

/** A standing order's line, read-only: its order and next firing; expanded, its strategy, its last outcome and when, and
 * that firing's session in History. A strategy's page draws its orders' lines with it. */
export function scheduledLineHtml({ scheduled: o, status }, now, open) {
  const armed = o.enabled === true && o.expired !== true;
  const last = o.last && typeof o.last === 'object'
    ? `<div class="task-meta">${th('tasks.scheduled.last', { outcome: firingWord(String(o.last.outcome ?? '')), at: deskTime(o.last.t, now) })}</div>` : '';
  return lineHtml(`order:${o.order}`, armed ? 'scheduled' : 'stopped', o.order, status, strategyRow(o.strategy) + last + historyLink(o.last?.sessionId), open);
}

/** A line's dot: waiting while a gate waits on the operator; a waiting task answered here reads running until the next read. */
export const dotOf = ({ task, gate }, group) => (gate ? 'waiting' : task.state === 'waiting' && group === 'running' ? 'running' : task.state);

/** One task's line, as the rail draws it; a strategy's page draws its tasks' lines with it (render/strategy.js). */
export function taskLineHtml({ task, gate, status }, group, state, open) {
  const record = gate ? state.conversations.find(c => c.id === task.id) : null;
  const dot = dotOf({ task, gate }, group);
  const strategy = strategyRow(task.strategy);
  const steps = Array.isArray(task.steps) && task.steps.length ? `<ol class="task-steps">${task.steps.map(s => `<li>${esc(maskExcerpt(String(s)))}</li>`).join('')}</ol>` : '';
  const end = record ? `<div class="task-gate">${gateHtml(record, gate, state)}</div>`
    // a gate the read says waits but this page has not seen (after a reload, until the worker is opened): its full process
    : task.waitingFor && group !== 'running' ? `<div class="task-gate-there">${th('tasks.gateThere')}</div>`
    : task.result?.text ? `<div class="task-result">${esc(maskExcerpt(task.result.text))}</div>` : '';
  return lineHtml(task.id, dot, task.title, status, `${originOf(task)}${strategy}${steps}${end}${usageOf(task.usage)}${keys(task, state.tasks.busy.includes(task.id))}`, open, task.bot);
}

/** Any line of the rail in its group: a task's, the desk's or a standing order's. */
export function railLineHtml(line, group, state, now, open) {
  if (line.scheduled) return scheduledLineHtml(line, now, open);
  if (line.desk) return deskLineHtml(line, open);
  return taskLineHtml(line, group, state, open);
}

/** The rail: '' while it has no line. `open` is the ids the page holds open. */
export function renderTaskRail(state, now, { open = null } = {}) {
  const rail = railOf(state, now);
  const groups = GROUPS.filter(([g]) => rail[g].length);
  if (!groups.length) return '';
  const body = groups.map(([g, head]) => `<section class="task-group"><h3 class="task-group-head">${head()}</h3>${rail[g].map(l => railLineHtml(l, g, state, now, open)).join('')}</section>`).join('');
  return `<aside class="tasks" aria-label="${th('tasks.rail')}"><details class="tasks-fold" id="tasks-fold"><summary class="tasks-fold-key">${th('tasks.fold', { n: rail.you.length })}</summary></details>` +
    `<h2 class="tasks-title">${th('tasks.rail')}</h2><div class="tasks-body">${body}</div></aside>`;
}
