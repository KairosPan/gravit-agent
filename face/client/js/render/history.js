// face/client/js/render/history.js — History (one-entry plan 2 Task 7): every session that is neither the conversation nor one
// of its tasks (host/rail-view.js historyOf). #/history lists them newest first — the title, the strategy the session's
// channel names (none for the root), when, a one-line preview as the list's preview read left it — each a link and no action;
// #/history/<id> is one read cold and read-only: its head (the title, a Read-only tag, back to History) and its transcript,
// earlier pages loadable, no composer, and a gate still open in its record drawn closed, never answerable; a task's session —
// off the rail once its New York day is over — draws its event tables at the top, as its task's page does.
import { esc } from '../html.js';
import { th } from '../i18n/words.js';
import { icon } from '../icons.js';
import { maskExcerpt } from '../mask.js';
import { rowTime } from '../time.js';
import { needsAnswer } from '../messages.js';
import { historyOf, channelLabel } from '../host/rail-view.js';
import { renderThread } from './thread.js';
import { earlierKey } from './messages.js';
import { pageViews } from './task.js';
import { eventTablesHtml } from './event-table.js';

// the strategy a session's channel names: its channel's display title, none for the root or a channel the list does not hold
function strategyOf(conv, state) {
  const ws = conv.channel?.workspaceId;
  const ch = ws ? (state.channels ?? []).find(c => c.workspaceId === ws) : null;
  return ch && !ch.isRoot ? channelLabel(ch) : '';
}

// the preview on one line: every run of whitespace one space
const oneLine = text => (typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '');

function row(conv, state, now) {
  const strategy = strategyOf(conv, state);
  const preview = oneLine(conv.preview);
  return `<a class="hist-row" href="#/history/${esc(encodeURIComponent(conv.id))}"><span class="hist-top"><span class="hist-title">${esc(maskExcerpt(conv.title))}</span>` +
    `${strategy ? `<span class="hist-strategy">${esc(strategy)}</span>` : ''}<span class="hist-when">${conv.updatedAt ? rowTime(conv.updatedAt, now) : ''}</span></span>` +
    `${preview ? `<span class="hist-preview">${esc(maskExcerpt(preview))}</span>` : ''}</a>`;
}

function listScreen(state, now) {
  const rows = historyOf(state);
  const body = rows.length ? rows.map(c => row(c, state, now)).join('') : `<div class="chan-none dim">${th('history.none')}</div>`;
  return `<main class="main chan"><header class="head"><h1 class="head-title">${th('history.title')}</h1></header><div class="chan-body hist-list">${body}</div></main>`;
}

const back = () => `<a class="hist-back" href="#/history" aria-label="${th('history.back')}">${icon('chevLeft', 18, 2.2)}</a>`;

function sessionScreen(state, now, page) {
  const id = state.route.id;
  const conv = state.conversations.find(c => c.id === id) ?? null;
  if (!conv) {
    const word = state.conversations.length ? th('history.notFound') : th('common.loading');
    return `<main class="main chan"><header class="head">${back()}<h1 class="head-title">${esc(id ?? '')}</h1></header><div class="chan-body"><div class="chan-none dim">${word}</div></div></main>`;
  }
  // a gate the record still holds open waits on no one here: drawn closed, its keys never drawn
  const shown = { ...conv, messages: conv.messages.map(m => (needsAnswer(m) ? { ...m, answer: 'closed' } : m)) };
  return `<main class="main"><header class="head">${back()}<h1 class="head-title">${esc(maskExcerpt(conv.title))}</h1><span class="chip grey hist-tag">${th('history.readOnly')}</span></header>` +
    `<div class="thread-box"><div class="thread" id="thread">${eventTablesHtml(state, pageViews(state, id))}${earlierKey(conv)}${renderThread(shown, state, now, page)}</div></div></main>`;
}

/** History's screen: the list at #/history, one session read-only at #/history/<id>. */
export function renderHistoryScreen(state, now, page = {}) {
  return state.route.id ? sessionScreen(state, now, page) : listScreen(state, now);
}
