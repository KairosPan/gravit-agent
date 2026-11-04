// face/client/js/render/messages.js — the Messages screen on the host's facts (spec 2026-10-19 §7 "Stage 1"):
// a conversation (head, thread, composer, the status line), the new-message screen, the empty state, Details.
import { esc, attrs, cls } from '../html.js';
import { icon } from '../icons.js';
import { fmtDate } from '../time.js';
import { avatar, cluster } from './avatars.js';
import { renderThread, railHtml } from './thread.js';
import { senderName } from './rail.js';
import { kv, inlineEdit, confirmPair } from './controls.js';
import { firstOpen } from '../host/sessions.js';
import { needsAnswer } from '../messages.js';
import { childrenOf } from '../host/children-view.js';
import { channelLabel } from '../host/list-view.js';
import { renderMenu, menuAria, filesRail } from '../composer/view.js';
import { statsView, pillsText, durationText, clockText } from '../host/turns-view.js';
import { jobsView, metaLine, endLine, isLive } from '../host/jobs-view.js';

export function currentConversation(state) {
  const id = state.route.screen === 'messages' ? state.route.id : null;
  return state.conversations.find(c => c.id === id) ?? firstOpen(state.conversations);
}

// the menu's slot above the box, the note (a refusal of the draft's files), then the box: the files rail, then the input row
// (never wrapping) of the paperclip and its hidden input, the editor and Send; the words are prompted to the session (host/actions.js). The editor is drawn empty:
// app.js puts the conversation's draft in it
export function renderComposer({ placeholder = 'Tell Gravit…', above = '', menu = null, files = [], note = '' } = {}) {
  const editor = attrs({ id: 'say', class: 'composer-input', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-labelledby': 'say-label', 'aria-controls': 'composer-menu', ...menuAria(menu), 'data-placeholder': placeholder });
  return `<form class="composer" data-action="send">${above}<div class="composer-menu" id="composer-menu">${renderMenu(menu)}</div>` +
    `<div class="composer-note" id="composer-note" role="status">${esc(note)}</div><div class="composer-box">` +
    `<div class="composer-files" id="composer-files">${filesRail(files)}</div><div class="composer-row">` +
    `<button type="button" class="attach-key" data-action="attachFiles" aria-label="Attach files">${icon('paperclip', 18)}</button>` +
    `<input${attrs({ type: 'file', id: 'attach-input', class: 'sr-only', multiple: true, tabindex: '-1', 'aria-hidden': 'true' })}>` +
    `<span id="say-label" class="sr-only">Tell Gravit</span><div${editor}></div>` +
    `<button type="submit" class="send-key" aria-label="Send">${icon('send', 18, 2.4)}</button></div></div></form>`;
}

// the composer's own facts from app.js: the open menu, the draft's files, the note above the box
const composerOf = (composer, extra = {}) => ({ menu: composer?.menu ?? null, files: composer?.files ?? [], note: composer?.note ?? '', ...extra });

// the one line of host status the page keeps: not signed in, reconnecting, a host error, a command's word (spec §3)
export function renderStatus(status) {
  if (!status?.line) return '';
  return `<div class="${cls('status-line', status.bad && 'bad')}" role="status">${esc(status.line)}</div>`;
}

// the jobs chip (spec §5.8), before Working while the conversation has a job: it opens Details at Background jobs
function jobsChip(conv, state) {
  const v = jobsView(state.jobs, conv.id);
  if (!v.chip) return '';
  return `<button type="button" class="btn-sm jobs-chip" data-action="openJobs"><span class="${cls('jobs-dot', v.running.length > 0 && 'live')}"></span>${esc(v.chip)}${icon('chevDown', 14, 2.2)}</button>`;
}

function headRight(conv, state) {
  const working = conv.running ? '<span class="status up"><span class="status-dot"></span>Working</span>' : '';
  return jobsChip(conv, state) + working + `<button type="button"${attrs({ class: cls('btn-sm', state.detailsOpen && 'pressed'), 'data-action': 'toggleDetails', 'aria-expanded': state.detailsOpen ? 'true' : 'false' })}>Details${icon('chevRight', 14, 2.2)}</button>`;
}

export function renderHead(conv, state) {
  if (conv.kind !== 'group') return `<header class="head"><h1 class="head-title">${esc(conv.title)}</h1>${headRight(conv, state)}</header>`;
  const names = conv.members.map(m => senderName(m, state)).join(' · ');
  return `<header class="head centered"><div class="head-right">${headRight(conv, state)}</div>${cluster(conv.members, 44, state)}` +
    `<div class="head-task">${esc(conv.title)}</div><div class="dim members">${esc(names)} · ${conv.members.length} members</div></header>`;
}

// the new-message screen: a title, Where (a channel, the root first), the first words in the composer
function draftScreen(state, composer) {
  const d = state.draft;
  const channels = [...(state.channels ?? [])].sort((a, b) => (b.isRoot ? 1 : 0) - (a.isRoot ? 1 : 0));
  const options = channels.map(c => `<option value="${esc(c.workspaceId)}"${c.workspaceId === d.where ? ' selected' : ''}>${esc(channelLabel(c))}</option>`).join('') +
    '<option value="__new">New channel…</option>';
  // New channel… opens a name box under Where; Where keeps its channel until the new one exists
  const naming = state.edit?.kind === 'newChannel' ? `<div class="to-line">${inlineEdit([{ name: 'channel', value: '', label: 'Name the channel' }], state.edit.error)}</div>` : '';
  return `<main class="main"><header class="head centered draft"><button type="button" class="btn-sm head-cancel" data-action="cancelDraft">Cancel</button>${avatar('gravit', 44)}` +
    `<label for="nm-title" class="sr-only">Name this</label><input id="nm-title" class="title-input" type="text" autocomplete="off" placeholder="Name this (or your first line is the name)" data-action="draftTitle"${attrs({ value: d.title })}>` +
    `<div class="to-line"><label class="to-label" for="nm-where">Where</label><select id="nm-where" name="where" class="input small" data-action="draftWhere">${options}</select></div>${naming}</header>` +
    `<div class="thread" id="thread"></div>${renderComposer(composerOf(composer))}${renderStatus(state.status)}</main>`;
}

function emptyScreen(state, composer) {
  const chips = ['Buy a little BTC', 'Follow Pelosi', 'Check an address'].map(t => `<button type="button" class="btn-sm" data-action="suggest"${attrs({ 'data-text': t })}>${esc(t)}</button>`).join('');
  return `<main class="main"><header class="head"><h1 class="head-title">Gravit</h1></header><div class="empty">${avatar('gravit', 56)}` +
    `<div class="empty-title">Nothing handed to Gravit yet</div><div class="suggest">${chips}</div></div>${renderComposer(composerOf(composer))}${renderStatus(state.status)}</main>`;
}

const fmtN = n => Math.round(n).toLocaleString('en-US');
// the host's usage projections, as rows: tokens in (the cache reads counted), tokens out, the context pressure; then the
// session's figures (D21), each row only when its figure exists
function usageRows(conv) {
  const usage = conv.usage && typeof conv.usage === 'object' ? conv.usage : null;
  const rows = [];
  const t = usage?.tokenUsage;
  if (t && typeof t === 'object') rows.push(['Tokens in', fmtN((t.uncachedInputTokens ?? 0) + (t.cacheReadTokens ?? 0))], ['Tokens out', fmtN(t.outputTokens ?? 0)]);
  const p = usage?.contextPressure;
  const ratio = typeof p === 'number' ? p : p && typeof p === 'object' && typeof p.ratio === 'number' ? p.ratio : null;
  if (ratio !== null) rows.push(['Context', `${Math.round(ratio * 100)}%`]);
  const v = statsView(conv.stats, t);
  if (v) {
    if (v.cache !== null) rows.push(['Cache hit', `${Math.round(v.cache * 100)}%`]);
    rows.push(['Turns · steps', esc(`${v.turns} · ${v.steps}`)]);
    if (v.modelMs !== null) rows.push(['Model time', esc(durationText(v.modelMs))]);
    if (v.toolMs !== null) rows.push(['Tool time', esc(durationText(v.toolMs))]);
    if (v.firstTokenMs !== null) rows.push(['First token', esc(durationText(v.firstTokenMs))]);
    if (v.speed !== null) rows.push(['Speed', esc(`${v.speed} tok/s`)]);
  }
  return rows.length ? `<section class="dsec" id="dsec-usage"><div class="dsec-label">Usage</div>${kv(rows)}</section>` : '';
}

// under a conversation's composer: the status line, then the figures' two pills once a step has closed (each opens
// Details at Usage; an empty one is not drawn); nothing when both are empty. Each pill has its own id, so focus stays on
// the one it was on across a render and comes back to it when Details closes
const PILLS = ['figures', 'tokens'];
export function statsPills(conv) {
  return pillsText(statsView(conv.stats, conv.usage?.tokenUsage))
    .map((text, i) => (text ? `<button${attrs({ type: 'button', class: 'stats-pill', id: `pill-${PILLS[i]}-${conv.id}`, 'data-action': 'openUsage' })}>${esc(text)}</button>` : '')).join('');
}
function threadFoot(conv, state) {
  const inner = renderStatus(state.status) + statsPills(conv);
  return inner ? `<div class="thread-foot">${inner}</div>` : '';
}

// where the conversation lives, named as the list names its channel
const whereOf = (conv, state) => {
  const ch = (state.channels ?? []).find(c => c.workspaceId === conv.channel?.workspaceId);
  return ch ? channelLabel(ch) : conv.channel?.name ?? 'Default directory';
};

// the row actions under This task: Fork once there is something to fork; Archive while nothing runs or waits, Un-archive for the face's own archive
// (the host's cannot be undone here); Delete while nothing runs or waits, asked twice
function rowKeys(conv, state) {
  const key = (action, label, cls = 'btn-sm', id = null) => `<button type="button" class="${cls}" data-action="${action}" data-conv="${esc(conv.id)}"${id ? ` id="${esc(id)}"` : ''}>${label}</button>`;
  const idle = !conv.running && !conv.messages.some(needsAnswer);
  const deleting = state.confirm?.action === 'deleteConv' && state.confirm?.id === conv.id;
  return [
    key('changeWords', 'Change words'),
    // dsh forks from a completed turn: a conversation with nothing in it yet has none
    conv.messages.length ? key('fork', 'Fork') : '',
    conv.archived ? '' : state.pinned?.includes(conv.id) ? key('unpin', 'Unpin', 'btn-sm', `details-pin-${conv.id}`) : key('pin', 'Pin', 'btn-sm', `details-pin-${conv.id}`),
    conv.archived === 'face' ? key('unarchive', 'Un-archive') : !conv.archived && idle ? key('archive', 'Archive') : '',
    !idle ? '' : deleting ? confirmPair('Yes, delete') : key('deleteConv', 'Delete', 'btn-danger'),
  ].join('');
}

// the conversation's subagent children: who, how they run, Stop (asked twice) on a running continuable one
const MODE = { 'one-shot': 'One-shot', continuable: 'Continuable' };
const STATE = { running: 'Running', inactive: 'Not running', unknown: 'Unknown', unavailable: 'Unavailable' };
function childrenSection(conv, state) {
  const { children, unavailable } = childrenOf(conv, state.childRows);
  if (!children.length && !unavailable) return '';
  const rows = children.map(c => {
    const asking = state.confirm?.action === 'stopChild' && state.confirm?.id === c.id;
    const stop = !c.canStop ? '' : asking ? confirmPair('Yes, stop')
      : `<button type="button" class="btn-sm" data-action="stopChild" data-parent="${esc(conv.id)}" data-child="${esc(c.id)}" data-label="${esc(c.label)}">Stop</button>`;
    return `<div class="child-row"><span class="child-name">${esc(c.label)}</span><span class="dim">${[MODE[c.mode], STATE[c.state]].filter(Boolean).join(' · ')}</span>${stop}</div>`;
  }).join('');
  return `<section class="dsec"><div class="dsec-label">Children</div>${unavailable ? '<div class="dsec-line dim">Children unavailable</div>' : rows}</section>`;
}

// Details › Background jobs (spec §5.8, P4): each running job a disclosure (open while it is the job open, its output
// written into the empty pre by app.js, never by a render) beside its Stop (asked twice), Stopping while it stops; the
// finished folded under Finished · n with Clear. A job's command and output are never masked (A2). The live clock is a
// span app.js ticks without rendering the page
function jobMeta(job, now) {
  if (!isLive(job) || !Number.isFinite(job.startedAt)) return esc(metaLine(job, now));
  const head = metaLine({ ...job, startedAt: null }, now);
  const clock = `<span${attrs({ 'data-job-clock': job.startedAt })}>${esc(clockText(now - job.startedAt))}</span>`;
  return head ? `${esc(head)} · ${clock}` : clock;
}
function jobDetails(job, state, now) {
  const live = isLive(job);
  const empty = !live && (Number(job.output?.total) || 0) === 0;
  const end = live ? '' : [empty ? '(no output)' : '', endLine(job)].filter(Boolean).join(' · ');
  return `<details${attrs({ id: `job-${job.id}`, class: 'job-details', open: state.jobs?.open === job.id })}>` +
    `<summary${attrs({ 'data-action': 'openJob', 'data-job': job.id })}><span class="${cls('job-dot', live && 'live')}"></span><code class="job-cmd">${esc(job.label)}</code><span class="job-meta">${jobMeta(job, now)}</span></summary>` +
    `<pre${attrs({ class: 'job-out', id: `job-out-${job.id}` })}></pre><div${attrs({ class: 'job-note', id: `job-note-${job.id}` })}></div>` +
    (end ? `<div class="job-end">${esc(end)}</div>` : '') +
    `<button${attrs({ type: 'button', class: 'btn-sm job-copy', id: `job-copy-${job.id}`, 'data-action': 'copyText', 'data-text': job.label, 'aria-label': 'Copy command' })}>Copy</button></details>`;
}
function jobStop(conv, job, state) {
  if (job.status === 'stopping') return '<span class="dim">Stopping</span>';
  if (state.confirm?.action === 'stopJob' && state.confirm?.id === job.id) return confirmPair('Yes, stop');
  return `<button${attrs({ type: 'button', class: 'btn-sm', id: `job-stop-${job.id}`, 'data-action': 'stopJob', 'data-conv': conv.id, 'data-job': job.id })}>Stop</button>`;
}
function jobsSection(conv, state, now) {
  const { running, finished } = jobsView(state.jobs, conv.id);
  if (!running.length && !finished.length) return '';
  const rows = running.map(j => `<div class="job">${jobDetails(j, state, now)}${jobStop(conv, j, state)}</div>`).join('');
  const fold = !finished.length ? '' : `<details${attrs({ id: `jobs-finished-${conv.id}`, class: 'jobs-finished' })}><summary>${esc(`Finished · ${finished.length}`)}</summary>` +
    finished.map(j => `<div class="job">${jobDetails(j, state, now)}</div>`).join('') +
    `<button${attrs({ type: 'button', class: 'btn-sm', id: `jobs-clear-${conv.id}`, 'data-action': 'clearJobs', 'data-conv': conv.id })}>Clear</button></details>`;
  return `<section class="dsec" id="dsec-jobs"><div class="dsec-label">Background jobs</div>${rows}${fold}</section>`;
}

export function renderDetails(conv, state, now = Date.now()) {
  const e = state.edit;
  const renaming = !!e && e.kind === 'rename' && e.convId === conv.id;
  const asking = state.confirm?.action === 'stopGravit' && state.confirm?.id === conv.id;
  const title = renaming ? inlineEdit([{ name: 'title', value: conv.title, label: 'Name this' }], e.error) : `<div class="dsec-title">${esc(conv.title)}</div>`;
  const agent = conv.kind === 'bot' && conv.preset ? senderName(conv.preset, state) : 'Gravit';
  const facts = kv([...(conv.created ? [['Created', esc(fmtDate(conv.created))]] : []), ['Where', esc(whereOf(conv, state))], ['Agent', esc(agent)], ...(conv.archived === 'host' ? [['Archived', 'By the host']] : [])]);
  const members = conv.kind === 'group' ? `<section class="dsec"><div class="dsec-label">Members</div>${conv.members.map(m => `<div class="dsec-line">${esc(senderName(m, state))}</div>`).join('')}</section>` : '';
  const stop = conv.running
    ? `<section class="dsec">${asking ? confirmPair('Yes, stop Gravit') : `<button type="button" class="btn-danger" data-action="stopGravit" data-conv="${esc(conv.id)}">Stop Gravit</button>`}</section>`
    : '';
  return `<aside class="drawer details" aria-label="Details">
  <div class="drawer-head"><h2>Details</h2><button type="button" class="close-key" data-action="toggleDetails" aria-label="Close">×</button></div>
  <div class="drawer-body">
    <section class="dsec"><div class="dsec-label">This task</div>${title}${facts}${renaming ? '' : `<div class="btn-row">${rowKeys(conv, state)}</div>`}</section>
    ${jobsSection(conv, state, now)}${members}${childrenSection(conv, state)}${usageRows(conv)}${stop}
  </div>
</aside>`;
}

// first in the thread while the window has more before it (D22): Earlier messages, or Loading… while a read runs —
// aria-disabled, not disabled, so the key keeps focus across the read (the earlier action ignores it meanwhile)
function earlierKey(conv) {
  const w = conv.window;
  if (!w?.hasMore) return '';
  return `<button${attrs({ class: 'btn-sm earlier-key', type: 'button', id: `earlier-${conv.id}`, 'data-action': 'earlier', 'data-conv': conv.id, 'aria-disabled': w.loading ? 'true' : null })}>${w.loading ? 'Loading…' : 'Earlier messages'}</button>`;
}

export function renderMessagesScreen(state, now, composer = {}, page = {}) {
  if (state.draft) return draftScreen(state, composer);
  const conv = currentConversation(state);
  if (!conv) return emptyScreen(state, composer);
  const placeholder = conv.kind === 'group' ? 'Tell Gravit… @ a bot by name' : 'Tell Gravit…';
  return `<main class="${cls('main', (state.detailsOpen || state.lunhui?.stock) && 'with-drawer', state.lunhui?.stock && 'with-stock')}">${renderHead(conv, state)}<div class="thread-box"><div class="thread" id="thread">${earlierKey(conv)}${renderThread(conv, state, now, page)}</div><nav class="turn-rail" id="turn-rail" aria-label="Turns">${railHtml(conv, page.rail)}</nav></div>${renderComposer(composerOf(composer, { placeholder }))}${threadFoot(conv, state)}${state.detailsOpen ? renderDetails(conv, state, now) : ''}</main>`;
}
