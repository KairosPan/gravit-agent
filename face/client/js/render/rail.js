// face/client/js/render/rail.js — the two-level navigation on the host's facts (spec 2026-10-19 §7 "Rail", "List"):
// a first level that collapses to icons, and the conversation list as the second level on Messages.
import { esc, attrs, cls } from '../html.js';
import { t, th, thn } from '../i18n/words.js';
import { icon } from '../icons.js';
import { shortcut, chordLabel } from '../keys.js';
import { rowTime } from '../time.js';
import { unreadOf, onScreenId } from '../host/sessions.js';
import { worthOf, cardsOf } from '../host/account-view.js';
import { money } from '../wire/account-model.js';
import { avatar } from './avatars.js';
import { HOST_NAME } from '../wire/speaker.js';
import { groupsOf } from '../host/list-view.js';
import { waitingCount } from '../host/rail-view.js';
import { maskExcerpt } from '../mask.js';
import { titleMatches, mergeResults, highlightRuns, searchPhase, moreThanTwenty, spoken, spokenLine } from '../host/search-view.js';

const NAME = { gravit: HOST_NAME, system: '' };
// the screens the second level stands beside: Messages and the pages a session or a strategy opens on
const LISTED = new Set(['messages', 'task', 'history', 'strategy']);

// a bot's display name comes with the list (/data/bots.json); an unknown sender keeps its id
export function senderName(from, state) {
  if (from === 'you') return t('list.you');
  return NAME[from] ?? state?.bots?.find(b => b.id === from)?.name ?? from;
}

// a row's line (drawn masked, as every excerpt is, with no eye: spec §5.9): the conversation on screen previews from
// its own window; any other row from the host's one-message page (`preview`, re-read when its session moves), and until
// that lands from the last line drawn. Only SPOKEN lines count — never a context row (a runtime snapshot, a plugin
// notice) or a tool row
export function previewOf(conv, state = null) {
  const m = conv.messages.findLast(spoken);
  const read = typeof conv.preview === 'string' && conv.preview !== '' ? conv.preview : null;
  const onScreen = !!state?.route && onScreenId(state) === conv.id;
  if (read && !(onScreen && m)) return read;
  if (!m) return '';
  const who = m.from === 'you' ? '' : senderName(m.from, state);
  const name = m.data?.name ?? who;
  const line = spokenLine(m);
  return conv.kind === 'group' && name ? t('list.preview.from', { name, line }) : line;
}

function row(conv, state, now) {
  const current = onScreenId(state) === conv.id;
  const pin = conv.archived ? '' : `<button type="button" class="pin-key" data-action="${conv.pinned ? 'unpin' : 'pin'}" data-conv="${esc(conv.id)}" aria-label="${conv.pinned ? th('list.unpin') : th('list.pin')}" id="pin-${esc(conv.id)}">${icon('pin', 14, 2)}</button>`;
  return '<div class="row-wrap">' +
    `<a${attrs({ class: cls('row', current && 'current'), 'aria-current': current ? 'page' : null, href: `#/messages/${conv.id}`, 'data-action': 'open', 'data-id': conv.id })}>` +
    `<span class="${cls('dot', unreadOf(conv) && 'on')}"></span>` +
    `<span class="row-body"><span class="row-top"><span class="row-title">${esc(maskExcerpt(conv.title))}</span>${conv.pinned ? `<span class="row-pin">${icon('pin', 11, 2, true)}</span>` : ''}<span class="row-time">${conv.updatedAt ? rowTime(conv.updatedAt, now) : ''}</span></span>` +
    `<span class="row-preview">${esc(maskExcerpt(previewOf(conv, state)))}</span></span></a>${pin}</div>`;
}

function draftRow() {
  return `<a class="row current draft" aria-current="page" href="#/messages/new" data-action="open" data-id="new"><span class="dot"></span>` +
    `<span class="row-body"><span class="row-top"><span class="row-title">${th('list.newMessage')}</span><span class="row-time">${th('list.draft.now')}</span></span><span class="row-preview">${th('list.draft.notSent')}</span></span></a>`;
}

// a first-level key: an icon and its name; collapsed, the name stays as the title and for screen readers
function navItem(href, name, label, current, mini, badge = 0) {
  return `<a${attrs({ class: cls('nav-item', current && 'current'), 'aria-current': current ? 'page' : null, href, title: mini ? label : null })}>${icon(name, 22, current ? 2.1 : 2)}` +
    `<span class="nav-label">${esc(label)}</span>${badge ? `<span class="nav-badge">${badge}</span>` : ''}</a>`;
}

// the first level: Messages (its badge counts the tasks waiting on you, host/rail-view.js), Markets, Trade, Discover, Account with its
// leading figure once the Account's read has answered — the paper book's, named so, when it leads — and its badge counting
// the cards waiting for you on the Account, and the collapse key; it collapses to a strip of icons
function worthLine(state) {
  const a = state.account;
  const { lead, paperLeads } = worthOf(a?.data, a?.holdings?.data, a?.paper?.data);
  return lead.usd === null ? '' : `<span class="account-line">${paperLeads ? th('nav.worthPaper', { worth: money(lead.usd) }) : esc(money(lead.usd))}</span>`;
}
const cardsWaiting = state => cardsOf(state.account?.data).reduce((n, g) => n + g.cards.length, 0);

export function renderNav(state) {
  const { screen } = state.route;
  const mini = !!state.railCollapsed;
  const waiting = waitingCount(state);
  const cards = cardsWaiting(state);
  return `<nav class="${cls('rail', mini && 'mini')}" aria-label="${esc(HOST_NAME)}">
  <div class="brand">${avatar('gravit', 28)}<span class="brand-name">${esc(HOST_NAME)}<span class="brand-caption">${th('nav.workspace')}</span></span>` +
    `<button type="button" class="rail-toggle" data-action="toggleRail" aria-expanded="${mini ? 'false' : 'true'}" aria-label="${mini ? th('nav.expand') : th('nav.collapse')}">${icon(mini ? 'chevRight' : 'chevLeft', 16, 2.2)}</button></div>
  <div class="rail-group">
    ${navItem('#/messages', 'chat', t('nav.messages'), LISTED.has(screen), mini, waiting)}
    ${navItem('#/markets', 'markets', t('nav.markets'), screen === 'markets', mini)}
    ${navItem('#/trade', 'trade', t('nav.trade'), screen === 'trade', mini)}
    ${navItem('#/discover', 'compass', t('nav.discover'), screen === 'discover' || screen === 'plugin' || screen === 'module', mini)}
  </div>
  <div class="rail-foot">
    <div class="rail-lines"><button type="button" class="line-key" data-action="openSettings" aria-label="${th('nav.settings')}" title="${th('nav.settings')}">${icon('bars', 20, 2)}<span class="rail-setting-label">${th('nav.settings')}</span></button></div>
    <a${attrs({ class: cls('account', screen === 'account' && 'current'), 'aria-current': screen === 'account' ? 'page' : null, href: '#/account/portfolio', title: mini ? t('nav.account') : null })}>${icon('wallet', 22, 2)}<span class="account-body"><span class="account-title">${th('nav.account')}</span>${worthLine(state)}</span>${cards ? `<span class="nav-badge">${cards}</span>` : ''}</a>
  </div>
</nav>`;
}

// a group's head: the collapse key, then the channel's name as a link to its page (a bot's or the other groups' as text)
function groupHead(g, state) {
  const label = g.collapsed ? t('list.group.expand', { name: g.label }) : t('list.group.collapse', { name: g.label });
  const here = state.route.screen === 'strategy' && (state.channels ?? []).some(c => c.workspaceId === g.workspaceId && c.name === state.route.id);
  const name = g.kind === 'channel'
    ? `<a${attrs({ class: cls('grp-name', here && 'current'), 'aria-current': here ? 'page' : null, href: `#/channel/${encodeURIComponent(g.workspaceId)}` })}>${esc(g.label)}</a>`
    : `<span class="grp-name">${esc(g.label)}</span>`;
  return `<div class="grp-head"><button type="button" class="grp-key" data-action="toggleGroup"${attrs({ 'data-key': g.key, 'aria-expanded': g.collapsed ? 'false' : 'true', 'aria-label': label })}>` +
    `${icon(g.collapsed ? 'chevRight' : 'chevDown', 14, 2.2)}</button>${name}</div>`;
}

// the search box under the list head (spec 2026-11-03 §5.1, P1): its words are the store's; the hint names the platform's key
// from the keys' table
function searchBox(query, mac) {
  return `<div class="conv-search">${icon('search', 16, 2)}<input${attrs({ id: 'cq', type: 'search', autocomplete: 'off', placeholder: t('search.box'), 'aria-label': t('search.box'), 'data-action': 'convQuery', value: query })}>` +
    `<kbd class="conv-search-key">${esc(chordLabel(shortcut('searchConversations'), mac))}</kbd></div>`;
}

const SEARCH_LINE = {
  searching: () => th('search.searching'), empty: () => th('search.empty'), failed: () => th('search.failed'), more: () => th('search.more'),
};
const stateLine = key => `<div class="conv-results-state">${SEARCH_LINE[key]()}</div>`;

// a result: its title and time, then its channel in bold and the snippet with the match marked; an archived one dim with its
// chip, and the face's own archive undone by the key after the link (the host's cannot be undone here). The snippet is masked
// first (an excerpt, whoever spoke: spec §5.9), which keeps its length, so the match's offsets stand
function hit(it, now) {
  const runs = highlightRuns(typeof it.snippet === 'string' ? maskExcerpt(it.snippet) : it.snippet, it.match).map(r => (r.mark ? `<mark>${esc(r.text)}</mark>` : esc(r.text))).join('');
  const link = `<a${attrs({ class: cls('conv-hit', it.archived && 'archived'), href: `#/messages/${it.id}`, 'data-action': 'open', 'data-id': it.id })}>` +
    `<span class="row-top"><span class="row-title">${esc(maskExcerpt(it.title))}</span>${it.archived ? `<span class="chip grey">${th('list.archived')}</span>` : ''}<span class="row-time">${it.at ? rowTime(it.at, now) : ''}</span></span>` +
    `<span class="conv-hit-line"><b class="conv-hit-channel">${esc(it.channelLabel)}</b>${runs ? ` ${runs}` : ''}</span></a>`;
  return link + (it.archived === 'face' ? `<button type="button" class="btn-sm" data-action="unarchive"${attrs({ 'data-conv': it.id })}>${th('list.unarchive')}</button>` : '');
}

// the results in place of the groups: the title matches at once, the content ones as they land, at most twenty
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
      merged.map(it => hit(it, now)).join('') +
      (moreThanTwenty(merged, hasMore) ? stateLine('more') : '') + (contentPhase === 'failed' ? stateLine('failed') : '');
  }
  return `<div class="conv-results">${inner}</div>`;
}

// the second level, open on Messages: the new-message key on top, the search box, then the groups (host/list-view.js), each
// its head and its rows, newest first — or, while a query stands, its results in their place
export function renderList(state, now, { mac = true } = {}) {
  if (!LISTED.has(state.route.screen)) return '';
  const query = state.search?.query ?? '';
  const opened = !!state.listOpen;
  const head = `<aside class="list" data-list-open="${opened}" aria-label="${th('list.title')}"><div class="list-head"><h2 class="list-title">${th('list.title')}</h2>` +
    `<button type="button" id="list-toggle" class="list-toggle" data-action="toggleList" aria-expanded="${opened}" aria-controls="conversation-list-body" aria-label="${opened ? th('list.hide') : th('list.show')}">${icon('chevDown', 18, 2.2)}</button>` +
    `<button type="button" class="new-key" data-action="startDraft" aria-label="${th('list.newMessage')}">${icon('plus', 18, 2.2)}</button></div><div class="list-body" id="conversation-list-body">` + searchBox(query, mac);
  if (query.trim() !== '') return `${head}${results(state, now)}</div></aside>`;
  const rows = (state.draft ? draftRow() : '') + groupsOf(state).map(g => groupHead(g, state) + g.shown.map(c => row(c, state, now)).join('')).join('');
  return `${head}${rows ? `<div class="rail-rows">${rows}</div>` : ''}</div></aside>`;
}

export function renderRail(state, now, opts = {}) {
  return renderNav(state) + renderList(state, now, opts);
}
