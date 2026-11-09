// face/client/js/render/messages.js — the Messages screen on the host's facts (spec 2026-10-19 §7 "Stage 1"; one-entry plan 2
// Task 5): Gravit's one conversation (head, thread, composer, the status line) with the rail of tasks on its right, its empty
// state, one line while it is off, unknown or loading, and Details.
import { esc, attrs, cls } from '../html.js';
import { t, th, sayOf, rawHtml } from '../i18n/words.js';
import { icon } from '../icons.js';
import { maskExcerpt } from '../mask.js';
import { fmtDate, rowTime } from '../time.js';
import { avatar } from './avatars.js';
import { renderThread, railHtml } from './thread.js';
import { renderTaskRail } from './tasks.js';
import { HOST_NAME } from '../wire/speaker.js';
import { kv, confirmPair } from './controls.js';
import { onScreenId } from '../host/sessions.js';
import { childrenOf } from '../host/children-view.js';
import { historyOf } from '../host/rail-view.js';
import { renderMenu, menuAria, filesRail } from '../composer/view.js';
import { statsView, pillsText, durationText, clockText } from '../host/turns-view.js';
import { jobsView, metaLine, isLive } from '../host/jobs-view.js';

// the conversation Messages writes to (plan 2 of one entry): the one /data/tasks names, once the list carries it; none while
// it is unknown (the tasks loading, off or failed) or on any other screen, so no composer is ever bound to another session
export function currentConversation(state) {
  const id = state.route.screen === 'messages' ? onScreenId(state) : null;
  return id ? state.conversations.find(c => c.id === id) ?? null : null;
}

// the menu's slot above the box, the note (a refusal of the draft's files), then the box: the files rail, then the input row
// (never wrapping) of the paperclip and its hidden input, the editor and Send; the words are prompted to the session (host/actions.js). The editor is drawn empty:
// app.js puts the conversation's draft in it
export function renderComposer({ placeholder = t('composer.placeholder'), above = '', menu = null, files = [], note = '' } = {}) {
  const editor = attrs({ id: 'say', class: 'composer-input', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-labelledby': 'say-label', 'aria-controls': 'composer-menu', ...menuAria(menu), 'data-placeholder': placeholder });
  return `<form class="composer" data-action="send">${above}<div class="composer-menu" id="composer-menu">${renderMenu(menu)}</div>` +
    `<div class="composer-note" id="composer-note" role="status">${esc(note)}</div><div class="composer-box">` +
    `<div class="composer-files" id="composer-files">${filesRail(files)}</div><div class="composer-row">` +
    `<button type="button" class="attach-key" data-action="attachFiles" aria-label="${th('composer.attach')}">${icon('paperclip', 18)}</button>` +
    `<input${attrs({ type: 'file', id: 'attach-input', class: 'sr-only', multiple: true, tabindex: '-1', 'aria-hidden': 'true' })}>` +
    `<span id="say-label" class="sr-only">${th('composer.label')}</span><div${editor}></div>` +
    `<button type="submit" class="send-key" aria-label="${th('composer.send')}">${icon('send', 18, 2.4)}</button></div></div></form>`;
}

// the composer's own facts from app.js: the open menu, the draft's files, the note above the box
const composerOf = (composer, extra = {}) => ({ menu: composer?.menu ?? null, files: composer?.files ?? [], note: composer?.note ?? '', ...extra });

// the one line of host status the page keeps: not signed in, reconnecting, a host error, a command's word (spec §3)
export function renderStatus(status) {
  const line = sayOf(status?.line);
  if (!line) return '';
  return `<div class="${cls('status-line', status.bad && 'bad')}" role="status">${esc(line)}</div>`;
}

// the jobs chip (spec §5.8), before Working while the conversation has a job: it opens Details at Background jobs
function jobsChip(conv, state) {
  const v = jobsView(state.jobs, conv.id);
  if (!v.chip) return '';
  return `<button type="button" class="btn-sm jobs-chip" data-action="openJobs"><span class="${cls('jobs-dot', v.running.length > 0 && 'live')}"></span>${esc(v.chip)}${icon('chevDown', 14, 2.2)}</button>`;
}

function headRight(conv, state) {
  const working = conv.running ? `<span class="status up"><span class="status-dot"></span>${th('thread.working')}</span>` : '';
  return jobsChip(conv, state) + working + `<button type="button"${attrs({ class: cls('btn-sm', state.detailsOpen && 'pressed'), 'data-action': 'toggleDetails', 'aria-expanded': state.detailsOpen ? 'true' : 'false' })}>${th('details.title')}${icon('chevRight', 14, 2.2)}</button>`; // words-order: Details' name and its chevron
}

// the conversation's head reads Gravit, whatever the session's own title (a title is derived from a first prompt): it is not
// renamed, forked or archived
export function renderHead(conv, state) {
  return `<header class="head"><h1 class="head-title">${esc(HOST_NAME)}</h1>${headRight(conv, state)}</header>`;
}

// the conversation /data/tasks named, while Messages carries no old link waiting to land: none while the tasks load or once
// they are off; a failed re-read keeps the one last read
function conversationId(state) {
  const r = state.route;
  return r.id || r.channel ? null : state.tasks?.conversation ?? null;
}

// no conversation to write to: Loading… while the tasks load (or an old link waits on them), else one line saying it is off
// (FACE_ROUTER=0, or a face that names none) or could not be read — no composer, no rail
function goneScreen(state) {
  const status = state.tasks?.status;
  const waiting = status === 'loading' || !!state.route.id || !!state.route.channel;
  const line = waiting ? th('common.loading') : status === 'failed' ? th('thread.conversation.failed') : th('thread.conversation.off');
  return `<main class="main"><header class="head"><h1 class="head-title">${esc(HOST_NAME)}</h1></header><div class="empty"><div class="dim">${line}</div></div>${renderStatus(state.status)}</main>`;
}

// the conversation's two columns: its own (the thread or the empty state, the composer, the foot) and the rail of tasks on its
// right (folded above it on a narrow window, by CSS)
const columns = (inner, state, now, page) => `<div class="conv-cols"><div class="conv-col">${inner}</div>${renderTaskRail(state, now, { open: page.tasksOpen })}</div>`;

// the conversation known but not listed yet (a fresh one, nothing said): three plain prompts above the composer
function emptyScreen(state, now, composer, page) {
  const chips = [t('thread.suggest.buy'), t('thread.suggest.follow'), t('thread.suggest.check')].map(words => `<button type="button" class="btn-sm" data-action="suggest"${attrs({ 'data-text': words })}>${esc(words)}</button>`).join('');
  return `<main class="main"><header class="head"><h1 class="head-title">${esc(HOST_NAME)}</h1></header>` +
    columns(`<div class="empty">${avatar('gravit', 56)}<div class="empty-title">${th('thread.empty.title')}</div><div class="suggest">${chips}</div></div>${renderComposer(composerOf(composer))}${renderStatus(state.status)}`, state, now, page) + '</main>';
}

const fmtN = n => Math.round(n).toLocaleString('en-US');
// the host's usage projections, as rows: tokens in (the cache reads counted), tokens out, the context pressure; then the
// session's figures (D21), each row only when its figure exists
function usageRows(conv) {
  const usage = conv.usage && typeof conv.usage === 'object' ? conv.usage : null;
  const rows = [];
  const tu = usage?.tokenUsage;
  if (tu && typeof tu === 'object') rows.push([t('details.tokensIn'), fmtN((tu.uncachedInputTokens ?? 0) + (tu.cacheReadTokens ?? 0))], [t('details.tokensOut'), fmtN(tu.outputTokens ?? 0)]);
  const p = usage?.contextPressure;
  const ratio = typeof p === 'number' ? p : p && typeof p === 'object' && typeof p.ratio === 'number' ? p.ratio : null;
  if (ratio !== null) rows.push([t('details.context'), `${Math.round(ratio * 100)}%`]);
  const v = statsView(conv.stats, tu);
  if (v) {
    if (v.cache !== null) rows.push([t('details.cacheHit'), `${Math.round(v.cache * 100)}%`]);
    rows.push([t('details.turnsSteps'), esc(t('details.turnsStepsValue', { turns: v.turns, steps: v.steps }))]);
    if (v.modelMs !== null) rows.push([t('details.modelTime'), esc(durationText(v.modelMs))]);
    if (v.toolMs !== null) rows.push([t('details.toolTime'), esc(durationText(v.toolMs))]);
    if (v.firstTokenMs !== null) rows.push([t('details.firstToken'), esc(durationText(v.firstTokenMs))]);
    if (v.speed !== null) rows.push([t('details.speed'), esc(t('details.speedValue', { n: v.speed }))]);
  }
  return rows.length ? `<section class="dsec" id="dsec-usage"><div class="dsec-label">${th('details.usage')}</div>${kv(rows)}</section>` : '';
}

// under a conversation's composer: the status line, then the figures' two pills once a step has closed (each opens
// Details at Usage, and says so to a screen reader; an empty one is not drawn); nothing when both are empty. Each pill has
// its own id, so focus stays on the one it was on across a render and comes back to it when Details closes
const PILLS = ['figures', 'tokens'];
export function statsPills(conv) {
  return pillsText(statsView(conv.stats, conv.usage?.tokenUsage))
    .map((text, i) => (text ? `<button${attrs({ type: 'button', class: 'stats-pill', id: `pill-${PILLS[i]}-${conv.id}`, 'data-action': 'openUsage', 'aria-label': t('thread.pill.open', { text }) })}>${esc(text)}</button>` : '')).join('');
}
function threadFoot(conv, state) {
  const inner = renderStatus(state.status) + statsPills(conv);
  return inner ? `<div class="thread-foot">${inner}</div>` : '';
}

// the conversation's subagent children: who, how they run, Stop (asked twice) on a running continuable one
const MODE = { 'one-shot': () => t('details.oneShot'), continuable: () => t('details.continuable') };
const STATE = { running: () => t('details.running'), inactive: () => t('details.notRunning'), unknown: () => t('details.unknown'), unavailable: () => t('details.unavailable') };
// a child's mode and state: both in the table's order, or the one it has
const childMeta = (mode, state) => (mode && state ? th('details.childMeta', { mode, state }) : esc(mode || state));
const wordOf = (table, k) => (typeof k === 'string' && Object.hasOwn(table, k) ? table[k]() : '');
function childrenSection(conv, state) {
  const { children, unavailable } = childrenOf(conv, state.childRows);
  if (!children.length && !unavailable) return '';
  const rows = children.map(c => {
    const asking = state.confirm?.action === 'stopChild' && state.confirm?.id === c.id;
    const stop = !c.canStop ? '' : asking ? confirmPair(t('details.yesStop'))
      : `<button type="button" class="btn-sm" data-action="stopChild" data-parent="${esc(conv.id)}" data-child="${esc(c.id)}" data-label="${esc(c.label)}">${th('details.stop')}</button>`;
    return `<div class="child-row"><span class="child-name">${esc(c.label)}</span><span class="dim">${childMeta(wordOf(MODE, c.mode), wordOf(STATE, c.state))}</span>${stop}</div>`;
  }).join('');
  return `<section class="dsec"><div class="dsec-label">${th('details.children')}</div>${unavailable ? `<div class="dsec-line dim">${th('details.childrenUnavailable')}</div>` : rows}</section>`;
}

// Details › Background jobs (spec §5.8, P4): each running job a disclosure (open while it is the job open, its output
// written into the empty pre by app.js, never by a render) beside its Stop (asked twice), Stopping while it stops; the
// finished folded under Finished · n with Clear. A job's command and output are never masked (A2). The live clock is a
// span app.js ticks without rendering the page
function jobMeta(job, now) {
  if (!isLive(job) || !Number.isFinite(job.startedAt)) return esc(metaLine(job, now));
  const head = metaLine({ ...job, startedAt: null }, now);
  const clock = `<span${attrs({ 'data-job-clock': job.startedAt })}>${esc(clockText(now - job.startedAt))}</span>`;
  return head ? th('jobs.metaClock', { meta: head, clock: rawHtml(clock) }) : clock;
}
function jobDetails(job, state, now) {
  const live = isLive(job);
  const empty = !live && (Number(job.output?.total) || 0) === 0;
  // (a finished job's end line is its meta line's: the line under the output says only that there was none)
  const end = empty ? t('jobs.noOutput') : '';
  return `<details${attrs({ id: `jobd-${job.id}`, class: 'job-details', open: state.jobs?.open === job.id })}>` +
    `<summary${attrs({ 'data-action': 'openJob', 'data-job': job.id })}><span class="${cls('job-dot', live && 'live')}"></span><code class="job-cmd">${esc(job.label)}</code><span class="job-meta">${jobMeta(job, now)}</span></summary>` +
    `<pre${attrs({ class: 'job-out', id: `jobout-${job.id}` })}></pre><div${attrs({ class: 'job-note', id: `jobnote-${job.id}` })}></div>` +
    (end ? `<div class="job-end">${esc(end)}</div>` : '') +
    `<button${attrs({ type: 'button', class: 'btn-sm job-copy', id: `job-copy-${job.id}`, 'data-action': 'copyText', 'data-text': job.label, 'aria-label': t('jobs.copyCommand') })}>${th('jobs.copy')}</button></details>`;
}
function jobStop(conv, job, state) {
  // (focusable, so Yes, stop leaves focus here rather than on the page)
  if (job.status === 'stopping') return `<span${attrs({ class: 'dim', id: `job-stopping-${job.id}`, tabindex: '-1' })}>${th('jobs.stopping')}</span>`;
  if (state.confirm?.action === 'stopJob' && state.confirm?.id === job.id) return confirmPair(t('details.yesStop'));
  return `<button${attrs({ type: 'button', class: 'btn-sm', id: `job-stop-${job.id}`, 'data-action': 'stopJob', 'data-conv': conv.id, 'data-job': job.id })}>${th('details.stop')}</button>`;
}
function jobsSection(conv, state, now) {
  const { running, finished } = jobsView(state.jobs, conv.id);
  if (!running.length && !finished.length) return '';
  const rows = running.map(j => `<div class="job">${jobDetails(j, state, now)}${jobStop(conv, j, state)}</div>`).join('');
  const fold = !finished.length ? '' : `<details${attrs({ id: `jobs-finished-${conv.id}`, class: 'jobs-finished', open: finished.some(j => j.id === state.jobs?.open) })}><summary>${esc(t('jobs.finished', { n: finished.length }))}</summary>` +
    finished.map(j => `<div class="job">${jobDetails(j, state, now)}</div>`).join('') +
    `<button${attrs({ type: 'button', class: 'btn-sm', id: `jobs-clear-${conv.id}`, 'data-action': 'clearJobs', 'data-conv': conv.id })}>${th('jobs.clear')}</button></details>`;
  return `<section class="dsec" id="dsec-jobs"><div class="dsec-label">${th('jobs.title')}</div>${rows}${fold}</section>`;
}

// the conversation's Details: This task (Gravit, when it began, the agent) — nothing renames, forks, pins, archives or deletes
// the one conversation —, its background jobs, children, usage, and Stop while a turn runs
export function renderDetails(conv, state, now = Date.now()) {
  const asking = state.confirm?.action === 'stopGravit' && state.confirm?.id === conv.id;
  const facts = kv([...(conv.created ? [[t('details.created'), esc(fmtDate(conv.created))]] : []), [t('details.agent'), esc(HOST_NAME)]]);
  const stop = conv.running
    ? `<section class="dsec">${asking ? confirmPair(t('details.yesStopGravit')) : `<button type="button" class="btn-danger" data-action="stopGravit" data-conv="${esc(conv.id)}">${th('details.stopGravit')}</button>`}</section>`
    : '';
  return `<aside class="drawer details" aria-label="${th('details.title')}">
  <div class="drawer-head"><h2>${th('details.title')}</h2><button type="button" class="close-key" data-action="toggleDetails" aria-label="${th('common.close')}">×</button></div>
  <div class="drawer-body">
    <section class="dsec"><div class="dsec-label">${th('details.thisTask')}</div><div class="dsec-title">${esc(HOST_NAME)}</div>${facts}</section>
    ${jobsSection(conv, state, now)}${childrenSection(conv, state)}${usageRows(conv)}${stop}
  </div>
</aside>`;
}

// first in the thread while the window has more before it (D22): Earlier messages, or Loading… while a read runs —
// aria-disabled, not disabled, so the key keeps focus across the read (the earlier action ignores it meanwhile)
function earlierKey(conv) {
  const w = conv.window;
  if (!w?.hasMore) return '';
  return `<button${attrs({ class: 'btn-sm earlier-key', type: 'button', id: `earlier-${conv.id}`, 'data-action': 'earlier', 'data-conv': conv.id, 'aria-disabled': w.loading ? 'true' : null })}>${w.loading ? th('common.loading') : th('thread.earlier')}</button>`;
}

// a task's or a history session's page (#/task/<id>, #/history/<id>), read-only until Tasks 7 and 8 of plan 2 draw their own:
// its title and its transcript — no composer, no Details, nothing that writes to the session. One the list does not carry
// reads Loading… until the list is in, then Not found
export function renderSessionPage(state, now, page = {}) {
  const conv = state.conversations.find(c => c.id === state.route.id) ?? null;
  if (!conv) {
    const word = state.conversations.length ? th('history.notFound') : th('common.loading');
    return `<main class="main chan"><header class="head"><h1 class="head-title">${esc(state.route.id ?? '')}</h1></header><div class="chan-body"><div class="chan-none dim">${word}</div></div></main>`;
  }
  return `<main class="main"><header class="head"><h1 class="head-title">${esc(maskExcerpt(conv.title))}</h1></header><div class="thread-box"><div class="thread" id="thread">${earlierKey(conv)}${renderThread(conv, state, now, page)}</div></div></main>`;
}

// History (#/history) until Task 7 of plan 2 draws its own: every session but the conversation and its tasks, newest first,
// each a link to its read-only page
export function renderHistoryList(state, now) {
  const rows = historyOf(state);
  const body = rows.length
    ? rows.map(c => `<a class="chan-row" href="#/history/${esc(encodeURIComponent(c.id))}"><span class="chan-row-name">${esc(maskExcerpt(c.title))}</span><span class="chan-row-meta">${c.updatedAt ? rowTime(c.updatedAt, now) : ''}</span></a>`).join('')
    : `<div class="chan-none dim">${th('history.none')}</div>`;
  return `<main class="main chan"><header class="head"><h1 class="head-title">${th('history.title')}</h1></header><div class="chan-body">${body}</div></main>`;
}

// Messages is Gravit's one conversation (one-entry plan 2): its head, then its column (the thread with the turn rail, the one
// composer, the foot) beside the rail of tasks; its empty state while it is known but not listed; one line, no composer,
// while there is none to write to
export function renderMessagesScreen(state, now, composer = {}, page = {}) {
  if (!conversationId(state)) return goneScreen(state);
  const conv = currentConversation(state);
  if (!conv) return emptyScreen(state, now, composer, page);
  const thread = `<div class="thread-box"><div class="thread" id="thread">${earlierKey(conv)}${renderThread(conv, state, now, page)}</div><nav class="turn-rail" id="turn-rail" aria-label="${th('thread.turns')}" role="toolbar" aria-orientation="vertical">${railHtml(conv, page.rail)}</nav></div>`;
  return `<main class="${cls('main', (state.detailsOpen || state.lunhui?.stock) && 'with-drawer', state.lunhui?.stock && 'with-stock')}">${renderHead(conv, state)}` +
    columns(`${thread}${renderComposer(composerOf(composer))}${threadFoot(conv, state)}`, state, now, page) + `${state.detailsOpen ? renderDetails(conv, state, now) : ''}</main>`;
}
