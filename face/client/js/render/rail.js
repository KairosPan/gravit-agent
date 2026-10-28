// face/client/js/render/rail.js — the two-level navigation on the host's facts (spec 2026-10-19 §7 "Rail", "List"):
// a first level that collapses to icons, and the conversation list as the second level on Messages.
import { esc, attrs, cls } from '../html.js';
import { icon } from '../icons.js';
import { rowTime } from '../time.js';
import { needsAnswer } from '../messages.js';
import { unreadOf, firstOpen } from '../host/sessions.js';
import { worthOf, cardsOf } from '../host/account-view.js';
import { money } from '../wire/account-model.js';
import { avatar, groupMark } from './avatars.js';
import { groupsOf } from '../host/list-view.js';

const NAME = { you: 'You', gravit: 'Gravit', system: '' };
// a bot's display name comes with the list (/data/bots.json); an unknown sender keeps its id
export function senderName(from, state) {
  return NAME[from] ?? state?.bots?.find(b => b.id === from)?.name ?? from;
}

// a row's line: the conversation on screen previews from its own window; any other row from the host's one-message
// page (`preview`, re-read when its session moves), and until that lands from the last line drawn. Only SPOKEN lines
// count — never a context row (a runtime snapshot, a plugin notice) or a tool row
export function previewOf(conv, state = null) {
  const m = conv.messages.findLast(x => x.from !== 'system' && x.kind !== 'tool' && typeof x.text === 'string' && x.text !== '');
  const read = typeof conv.preview === 'string' && conv.preview !== '' ? conv.preview : null;
  const onScreen = state?.route?.screen === 'messages' && state.route.id === conv.id;
  if (read && !(onScreen && m)) return read;
  if (!m) return '';
  const who = m.from === 'you' ? '' : senderName(m.from, state);
  const name = m.data?.name ?? who;
  return conv.kind === 'group' && name ? `${name}: ${m.text}` : m.text;
}

function rowMark(conv, state) {
  if (conv.kind === 'group') return groupMark(conv.members, 36, state);
  const who = conv.kind === 'bot' ? conv.preset ?? conv.members.find(x => x !== 'gravit') ?? 'gravit' : 'gravit';
  return avatar(who, 36, state);
}

function row(conv, state, now) {
  const current = state.route.screen === 'messages' && state.route.id === conv.id;
  return `<a${attrs({ class: cls('row', current && 'current'), 'aria-current': current ? 'page' : null, href: `#/messages/${conv.id}`, 'data-action': 'open', 'data-id': conv.id })}>` +
    `<span class="${cls('dot', unreadOf(conv) && 'on')}"></span>${rowMark(conv, state)}` +
    `<span class="row-body"><span class="row-top"><span class="row-title">${esc(conv.title)}</span><span class="row-time">${conv.updatedAt ? rowTime(conv.updatedAt, now) : ''}</span></span>` +
    `<span class="row-preview">${esc(previewOf(conv, state))}</span></span></a>`;
}

function draftRow() {
  return `<a class="row current draft" aria-current="page" href="#/messages/new" data-action="open" data-id="new"><span class="dot"></span><span class="av av-draft">+</span>` +
    `<span class="row-body"><span class="row-top"><span class="row-title">New message</span><span class="row-time">now</span></span><span class="row-preview">Not sent yet</span></span></a>`;
}

// a first-level key: an icon and its name; collapsed, the name stays as the title and for screen readers
function navItem(href, name, label, current, mini, badge = 0) {
  return `<a${attrs({ class: cls('nav-item', current && 'current'), 'aria-current': current ? 'page' : null, href, title: mini ? label : null })}>${icon(name, 22, current ? 2.1 : 2)}` +
    `<span class="nav-label">${esc(label)}</span>${badge ? `<span class="nav-badge">${badge}</span>` : ''}</a>`;
}

// the first level: Messages (its badge counts the conversations with a card waiting on you), Markets, Trade, Discover, Account with its
// leading figure once the Account's page has answered — the paper book's, named so, when it leads — and its badge counting
// the cards waiting for you on the Account, and the collapse key; it collapses to a strip of icons
function worthLine(state) {
  const a = state.account;
  const { lead, paperLeads } = worthOf(a?.data, a?.holdings?.data, a?.paper?.data);
  return lead.usd === null ? '' : `<span class="account-line">${esc(money(lead.usd))}${paperLeads ? ' · Paper' : ''}</span>`;
}
const cardsWaiting = state => cardsOf(state.account?.data).reduce((n, g) => n + g.cards.length, 0);

export function renderNav(state) {
  const { screen } = state.route;
  const mini = !!state.railCollapsed;
  const waiting = state.conversations.filter(c => c.messages.some(needsAnswer)).length;
  // the last one open, unless it has since been archived; else the first open one
  const last = state.lastConv && !state.conversations.some(c => c.id === state.lastConv && c.archived) ? state.lastConv : null;
  const messagesHref = `#/messages/${screen === 'messages' && state.route.id && state.route.id !== 'new' ? state.route.id : last ?? firstOpen(state.conversations)?.id ?? ''}`;
  const cards = cardsWaiting(state);
  return `<nav class="${cls('rail', mini && 'mini')}" aria-label="Gravit">
  <div class="brand">${avatar('gravit', 28)}<span class="brand-name">Gravit</span>` +
    `<button type="button" class="rail-toggle" data-action="toggleRail" aria-expanded="${mini ? 'false' : 'true'}" aria-label="${mini ? 'Expand navigation' : 'Collapse navigation'}">${icon(mini ? 'chevRight' : 'chevLeft', 16, 2.2)}</button></div>
  <div class="rail-group">
    ${navItem(messagesHref, 'chat', 'Messages', screen === 'messages' || screen === 'channel', mini, waiting)}
    ${navItem('#/markets', 'markets', 'Markets', screen === 'markets', mini)}
    ${navItem('#/trade', 'trade', 'Trade', screen === 'trade', mini)}
    ${navItem('#/discover', 'compass', 'Discover', screen === 'discover' || screen === 'plugin' || screen === 'module', mini)}
  </div>
  <div class="rail-foot">
    <div class="rail-lines"><button type="button" class="line-key" data-action="openSettings" aria-label="Settings" title="Settings">${icon('bars', 20, 2)}</button></div>
    <a${attrs({ class: cls('account', screen === 'account' && 'current'), 'aria-current': screen === 'account' ? 'page' : null, href: '#/account/portfolio', title: mini ? 'Account' : null })}>${icon('wallet', 22, 2)}<span class="account-body"><span class="account-title">Account</span>${worthLine(state)}</span>${cards ? `<span class="nav-badge">${cards}</span>` : ''}</a>
  </div>
</nav>`;
}

// a group's head: the collapse key, then the channel's name as a link to its page (a bot's or the other groups' as text)
function groupHead(g, state) {
  const label = `${g.collapsed ? 'Expand' : 'Collapse'} ${g.label}`;
  const here = state.route.screen === 'channel' && state.route.id === g.workspaceId;
  const name = g.kind === 'channel'
    ? `<a${attrs({ class: cls('grp-name', here && 'current'), 'aria-current': here ? 'page' : null, href: `#/channel/${encodeURIComponent(g.workspaceId)}` })}>${esc(g.label)}</a>`
    : `<span class="grp-name">${esc(g.label)}</span>`;
  return `<div class="grp-head"><button type="button" class="grp-key" data-action="toggleGroup"${attrs({ 'data-key': g.key, 'aria-expanded': g.collapsed ? 'false' : 'true', 'aria-label': label })}>` +
    `${icon(g.collapsed ? 'chevRight' : 'chevDown', 14, 2.2)}</button>${name}</div>`;
}

// the second level, open on Messages: the new-message key on top, then the groups (host/list-view.js), each its head
// and its rows, newest first
export function renderList(state, now) {
  if (state.route.screen !== 'messages' && state.route.screen !== 'channel') return '';
  const rows = (state.draft ? draftRow() : '') + groupsOf(state).map(g => groupHead(g, state) + g.shown.map(c => row(c, state, now)).join('')).join('');
  return `<aside class="list" aria-label="Messages"><div class="list-head"><h2 class="list-title">Messages</h2>` +
    `<button type="button" class="new-key" data-action="startDraft" aria-label="New message">${icon('plus', 18, 2.2)}</button></div>` +
    `${rows ? `<div class="rail-rows">${rows}</div>` : ''}</aside>`;
}

export function renderRail(state, now) {
  return renderNav(state) + renderList(state, now);
}
