// face/client/js/render/side.js — the second level beside Messages (one-entry plan 2 Task 6): the search box, a Gravit row
// (the one conversation), a History row (every other session, host/rail-view.js historyOf) and the strategies, each a row
// to its page with its status word as status.yaml gives it. It stands beside Messages, a task, History and a strategy's
// page; on a narrow window it folds behind its disclosure.
import { esc, attrs, cls } from '../html.js';
import { t, th, thn } from '../i18n/words.js';
import { icon } from '../icons.js';
import { shortcut, chordLabel } from '../keys.js';
import { rowTime } from '../time.js';
import { unreadOf } from '../host/sessions.js';
import { historyOf, strategiesOf, channelLabel } from '../host/rail-view.js';
import { HOST_NAME } from '../wire/speaker.js';
import { maskExcerpt } from '../mask.js';
import { titleMatches, mergeResults, highlightRuns, searchPhase, moreThanTwenty } from '../host/search-view.js';

// the screens the side panel stands beside
export const SIDE_SCREENS = new Set(['messages', 'task', 'history', 'strategy']);

// the search box under the panel's head (spec 2026-11-03 §5.1, P1): its words are the store's; the hint names the platform's
// key from the keys' table
function searchBox(query, mac) {
  return `<div class="conv-search">${icon('search', 16, 2)}<input${attrs({ id: 'cq', type: 'search', autocomplete: 'off', placeholder: t('search.box'), 'aria-label': t('search.box'), 'data-action': 'convQuery', value: query })}>` +
    `<kbd class="conv-search-key">${esc(chordLabel(shortcut('searchConversations'), mac))}</kbd></div>`;
}

const SEARCH_LINE = {
  searching: () => th('search.searching'), empty: () => th('search.empty'), failed: () => th('search.failed'), more: () => th('search.more'),
};
const stateLine = key => `<div class="conv-results-state">${SEARCH_LINE[key]()}</div>`;

// where a hit opens: the conversation on Messages, a task on its page, any other session in history
function hitHref(id, state) {
  if (id === state.tasks?.conversation) return '#/messages';
  const isTask = (state.tasks?.items ?? []).some(task => task.id === id);
  return `#/${isTask ? 'task' : 'history'}/${encodeURIComponent(id)}`;
}

// a result: its title and time, then its channel in bold and the snippet with the match marked; an archived one dim with its
// chip. The snippet is masked first (an excerpt, whoever spoke: spec §5.9), which keeps its length, so the match's offsets stand
function hit(it, state, now) {
  const runs = highlightRuns(typeof it.snippet === 'string' ? maskExcerpt(it.snippet) : it.snippet, it.match).map(r => (r.mark ? `<mark>${esc(r.text)}</mark>` : esc(r.text))).join('');
  return `<a${attrs({ class: cls('conv-hit', it.archived && 'archived'), href: hitHref(it.id, state) })}>` +
    `<span class="row-top"><span class="row-title">${esc(maskExcerpt(it.title))}</span>${it.archived ? `<span class="chip grey">${th('list.archived')}</span>` : ''}<span class="row-time">${it.at ? rowTime(it.at, now) : ''}</span></span>` +
    `<span class="conv-hit-line"><b class="conv-hit-channel">${esc(it.channelLabel)}</b>${runs ? ` ${runs}` : ''}</span></a>`;
}

// the results in place of the rows: the title matches at once, the content ones as they land, at most twenty
function results(state, now) {
  const { query, contentPhase, content, hasMore } = state.search;
  const titles = titleMatches(state.conversations, state.channels, query);
  const merged = mergeResults({ titles, content, conversations: state.conversations, channels: state.channels });
  const phase = searchPhase({ query, contentPhase, merged });
  let inner;
  if (phase === 'searching') inner = stateLine('searching') + '<div class="sk"></div>'.repeat(3);
  else if (phase === 'empty' || phase === 'failed') inner = stateLine(phase);
  else {
    inner = `<div class="conv-results-count">${thn('search.count', merged.length)}</div>` +
      merged.map(it => hit(it, state, now)).join('') +
      (moreThanTwenty(merged, hasMore) ? stateLine('more') : '') + (contentPhase === 'failed' ? stateLine('failed') : '');
  }
  return `<div class="conv-results">${inner}</div>`;
}

// a row: a link with its title and, after it, a note (History's count, a strategy's status word); the current one marked
function row(href, title, current, { dot = '', note = '' } = {}) {
  return `<a${attrs({ class: cls('row', current && 'current'), 'aria-current': current ? 'page' : null, href })}>${dot}` +
    `<span class="row-body"><span class="row-top"><span class="row-title">${esc(title)}</span>${note !== '' ? `<span class="row-note">${esc(note)}</span>` : ''}</span></span></a>`;
}

function rows(state) {
  const { screen, id } = state.route;
  const record = state.conversations.find(c => c.id === state.tasks?.conversation);
  const gravit = row('#/messages', HOST_NAME, screen === 'messages', { dot: `<span class="${cls('dot', record && unreadOf(record) && 'on')}"></span>` });
  const history = row('#/history', t('history.title'), screen === 'history', { note: String(historyOf(state).length) });
  const strategies = strategiesOf(state);
  const head = strategies.length ? `<div class="grp-head"><span class="grp-name">${th('list.strategies')}</span></div>` : '';
  const each = strategies.map(ch => row(`#/strategy/${encodeURIComponent(ch.name)}`, channelLabel(ch), screen === 'strategy' && id === ch.name,
    { note: typeof ch.status === 'string' ? ch.status : '' })).join('');
  return `<div class="rail-rows">${gravit}${history}${head}${each}</div>`;
}

// the side panel: its head with the narrow window's disclosure, the search box, then the rows — or, while a query stands, its
// results in their place
export function renderSide(state, now, { mac = true } = {}) {
  if (!SIDE_SCREENS.has(state.route.screen)) return '';
  const query = state.search?.query ?? '';
  const opened = !!state.listOpen;
  return `<aside class="list" data-list-open="${opened}" aria-label="${th('list.title')}"><div class="list-head"><h2 class="list-title">${th('list.title')}</h2>` +
    `<button type="button" id="list-toggle" class="list-toggle" data-action="toggleList" aria-expanded="${opened}" aria-controls="conversation-list-body" aria-label="${opened ? th('list.hide') : th('list.show')}">${icon('chevDown', 18, 2.2)}</button>` +
    `</div><div class="list-body" id="conversation-list-body">${searchBox(query, mac)}${query.trim() !== '' ? results(state, now) : rows(state)}</div></aside>`;
}
