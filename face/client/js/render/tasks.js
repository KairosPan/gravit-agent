// face/client/js/render/tasks.js — the rail of tasks (one-entry plan 2): a head per group that has a line — waiting on you,
// running, done today — and one line per task, a disclosure whose summary is only its state's dot, its title, its short
// status and a caret. Expanded: its strategy, its steps (newest last), its open gate (answered on the line) or its result,
// its tokens, and the keys its state allows — Stop, Continue — beside the link to its full process. A line is open while
// the page holds its id open (app.js), so a whole-page render never folds one the operator opened. On a narrow window
// the rail folds above the thread under one summary counting the lines waiting on you (app.css).
import { esc, attrs, cls } from '../html.js';
import { th } from '../i18n/words.js';
import { icon } from '../icons.js';
import { maskExcerpt } from '../mask.js';
import { railOf } from '../host/rail-view.js';
import { gateHtml } from './thread.js';

const GROUPS = [['you', () => th('tasks.group.you')], ['running', () => th('tasks.group.running')], ['done', () => th('tasks.group.done')]];
const STOPS = new Set(['running', 'waiting', 'stalled']);
const CONTINUES = new Set(['stalled', 'failed', 'blocked']);
const fmtN = n => Math.round(Number(n) || 0).toLocaleString('en-US');

function usageOf(u) {
  if (!u || typeof u !== 'object') return '';
  const tokens = th('tasks.usage', { in: fmtN((u.uncachedInputTokens ?? 0) + (u.cacheReadTokens ?? 0)), out: fmtN(u.outputTokens ?? 0) });
  return `<div class="task-usage">${tokens}</div>`;
}

function keys(task, busy) {
  const key = (action, label) => `<button${attrs({ type: 'button', class: 'btn-sm', 'data-action': action, 'data-task': task.id, disabled: busy })}>${label}</button>`;
  return `<div class="task-keys">${STOPS.has(task.state) ? key('taskStop', th('details.stop')) : ''}${CONTINUES.has(task.state) ? key('taskResume', th('tasks.continue')) : ''}` +
    `<a class="btn-sm" href="#/task/${esc(encodeURIComponent(task.id))}">${th('tasks.full')}</a></div>`;
}

function line({ task, gate, status }, group, state, open) {
  const record = gate ? state.conversations.find(c => c.id === task.id) : null;
  // (a waiting task answered here reads running until the next read)
  const dot = gate ? 'waiting' : task.state === 'waiting' && group === 'running' ? 'running' : task.state;
  const strategy = typeof task.strategy === 'string' && task.strategy !== ''
    ? `<div class="task-strategy"><span class="task-strategy-label">${th('tasks.strategy')}</span><a class="task-strategy-link" href="#/strategy/${esc(encodeURIComponent(task.strategy))}">${esc(task.strategy)}</a></div>` : '';
  const steps = Array.isArray(task.steps) && task.steps.length ? `<ol class="task-steps">${task.steps.map(s => `<li>${esc(maskExcerpt(String(s)))}</li>`).join('')}</ol>` : '';
  const end = record ? `<div class="task-gate">${gateHtml(record, gate, state)}</div>`
    : task.result?.text ? `<div class="task-result">${esc(maskExcerpt(task.result.text))}</div>` : '';
  return `<details${attrs({ class: 'task-line', 'data-task': task.id, open: open?.has(task.id) === true })}>` +
    `<summary${attrs({ id: `tline-${task.id}`, 'data-action': 'toggleTask', 'data-task': task.id })}><span class="${cls('task-dot', dot)}"></span>` +
    `<span class="task-title">${esc(maskExcerpt(task.title ?? ''))}</span><span class="task-status">${esc(status)}</span><span class="task-caret">${icon('chevDown', 14, 2.2)}</span></summary>` +
    `<div class="task-body">${strategy}${steps}${end}${usageOf(task.usage)}${keys(task, state.tasks.busy.includes(task.id))}</div></details>`;
}

/** The rail: '' while it has no line. `open` is the ids the page holds open. */
export function renderTaskRail(state, now, { open = null } = {}) {
  const rail = railOf(state, now);
  const groups = GROUPS.filter(([g]) => rail[g].length);
  if (!groups.length) return '';
  const body = groups.map(([g, head]) => `<section class="task-group"><h3 class="task-group-head">${head()}</h3>${rail[g].map(l => line(l, g, state, open)).join('')}</section>`).join('');
  return `<aside class="tasks" aria-label="${th('tasks.rail')}"><details class="tasks-fold" id="tasks-fold"><summary class="tasks-fold-key">${th('tasks.fold', { n: rail.you.length })}</summary></details>` +
    `<h2 class="tasks-title">${th('tasks.rail')}</h2><div class="tasks-body">${body}</div></aside>`;
}
