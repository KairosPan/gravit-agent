// face/client/js/render/box.js — the gravit box (plan 1 of the box): on the screens that show no conversation, half a ball at
// the right edge (its marks: the tasks waiting on the operator, the conversation working, a reply not yet seen), and once
// it is opened a panel over the page with the one conversation's thread and Messages' own composer. Nothing drawn while
// the box does not stand here or a sheet covers it; beside a drawer or Trade's open ticket it steps aside (by CSS).
import { esc, attrs } from '../html.js';
import { t, th, tn } from '../i18n/words.js';
import { icon } from '../icons.js';
import { chordLabel, shortcut } from '../keys.js';
import { HOST_NAME } from '../wire/speaker.js';
import { boxShown, boxOpenHere } from '../host/sessions.js';
import { boxCovered, boxAside, ballMarks, boxAttached } from '../host/box-view.js';
import { pageTagOf, parseTag, tagWords } from '../host/page-tag.js';
import { renderComposer, renderStatus } from './messages.js';
import { renderThread } from './thread.js';
import { waitingLineHtml } from './tasks.js';
import { railOf } from '../host/rail-view.js';

// the ball's name for a screen reader: Ask gravit, then what waits, working, a new reply, as they apply
function ballLabel({ waiting, working, fresh }) {
  const parts = [t('gbox.ask')];
  if (waiting > 0) parts.push(t('gbox.label.waiting', { n: waiting }));
  if (working) parts.push(t('gbox.label.working'));
  if (fresh) parts.push(t('gbox.label.fresh'));
  return parts.join(t('common.list.sep'));
}

function ball(state, mac) {
  const marks = ballMarks(state);
  const badge = marks.waiting > 0 ? `<span class="gbox-badge" aria-hidden="true">${esc(String(marks.waiting))}</span>` : '';
  const dot = marks.working ? '<span class="gbox-dot pulse" aria-hidden="true"></span>' : marks.fresh ? '<span class="gbox-dot steady" aria-hidden="true"></span>' : '';
  const head = attrs({ type: 'button', id: 'gbox-ball', class: 'gbox-ball', 'data-action': 'boxOpen', 'aria-label': ballLabel(marks), title: t('gbox.title', { key: chordLabel(shortcut('writeToGravit'), mac) }) });
  return `<button${head}><span class="gbox-g" aria-hidden="true">G</span>${badge}${dot}</button>`;
}

// the panel's thread: the earlier part a link to Messages, then the messages; one plain line while the conversation is
// known but not listed yet
function body(state, now, page) {
  const conv = (state.conversations ?? []).find(c => c.id === state.tasks.conversation);
  if (!conv) return `<p class="gbox-empty dim">${th('gbox.empty')}</p>`;
  const earlier = conv.window?.hasMore ? `<a class="gbox-earlier" href="#/messages">${th('gbox.earlier')}</a>` : '';
  return `<div class="thread" id="thread">${earlier}${renderThread(conv, state, now, { ...page, compact: true })}</div>`;
}

// what waits on the operator, above the thread (spec §6.6): the rail's lines waiting on you, less, on a strategy's page, that
// page's own (it draws them); at most three, then how many more Messages holds; nothing when none waits
const WAITING_MAX = 3;
function waiting(state, now) {
  const here = state.route?.screen === 'strategy' ? state.route.id : null;
  const lines = railOf(state, now).you.filter(l => here === null || l.task.strategy !== here);
  if (!lines.length) return '';
  const more = lines.length > WAITING_MAX ? `<a class="gbox-more" href="#/messages">${esc(tn('gbox.moreWaiting', lines.length - WAITING_MAX))}</a>` : '';
  return `<h3 class="gbox-waiting-head">${th('tasks.group.you')}</h3>${lines.slice(0, WAITING_MAX).map(l => waitingLineHtml(l, state)).join('')}${more}`;
}

// the page chip over the composer (spec §6.7): the page the next message names, in the operator's words, with × to leave it
// off; once ×'d, a ghost key puts it back; nothing where the page has no tag
function chips(state) {
  const tag = pageTagOf(state);
  if (tag === null) return '';
  if (!boxAttached(state)) return `<div class="gbox-chips"><button type="button" class="gbox-attach" data-action="boxAttach">${icon('screen', 14)}<span>${th('gbox.attach')}</span></button></div>`;
  const off = th('gbox.detach');
  return `<div class="gbox-chips"><span class="gbox-chip">${icon('screen', 14)}<span>${esc(tagWords(parseTag(`${tag}\n`).tag))}</span>` +
    `<button type="button" class="gbox-chip-x" data-action="boxDetach" aria-label="${off}" title="${off}">${icon('x', 12, 2.2)}</button></span></div>`;
}

function panel(state, now, composer, page) {
  const conv = (state.conversations ?? []).find(c => c.id === state.tasks.conversation);
  const working = conv?.running ? `<span class="status up"><span class="status-dot"></span>${th('thread.working')}</span>` : '';
  const open = th('gbox.open');
  const minimize = th('gbox.minimize');
  const head = `<header class="gbox-head"><span class="gbox-mark" aria-hidden="true">G</span><h2>${esc(HOST_NAME)}</h2>${working}` +
    `<a class="gbox-key" href="#/messages" aria-label="${open}" title="${open}">${icon('openIn', 18)}</a>` +
    `<button type="button" class="gbox-key" data-action="boxClose" aria-label="${minimize}" title="${minimize}">${icon('chevDown', 18, 2.2)}</button></header>`;
  const say = renderComposer({ menu: composer?.menu ?? null, files: composer?.files ?? [], note: composer?.note ?? '' });
  return `<section${attrs({ class: 'gbox-panel', role: 'dialog', 'aria-modal': 'false', 'aria-label': HOST_NAME })}>${head}<div class="gbox-waiting">${waiting(state, now)}</div>` +
    `<div class="gbox-body">${body(state, now, page)}</div>${chips(state)}${say}${renderStatus(state.status)}</section>`;
}

/** The box on this screen: '' where it does not stand or a sheet covers it; the panel while open, else the ball. `composer`
 *  is Messages' { menu, files, note }; `page` the thread's { revealed, anchor, rail } and `mac` for the shortcut's name. */
export function renderBox(state, now, composer = {}, page = {}) {
  if (!boxShown(state) || boxCovered(state)) return '';
  const aside = boxAside(state);
  const inner = boxOpenHere(state) ? panel(state, now, composer, page) : ball(state, page.mac !== false);
  return `<div${attrs({ class: 'gbox', 'data-aside': aside })}>${inner}</div>`;
}
