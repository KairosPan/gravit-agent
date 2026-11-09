// face/client/js/render/rail.js — the two-level navigation on the host's facts (spec 2026-10-19 §7 "Rail"): a first level
// that collapses to icons, and the side panel (render/side.js) as the second level beside Messages and its pages.
import { esc, attrs, cls } from '../html.js';
import { t, th } from '../i18n/words.js';
import { icon } from '../icons.js';
import { worthOf, cardsOf } from '../host/account-view.js';
import { money } from '../wire/account-model.js';
import { avatar } from './avatars.js';
import { HOST_NAME } from '../wire/speaker.js';
import { waitingCount } from '../host/rail-view.js';
import { renderSide, SIDE_SCREENS } from './side.js';

const NAME = { gravit: HOST_NAME, system: '' };

// a bot's display name comes with the list (/data/bots.json); an unknown sender keeps its id
export function senderName(from, state) {
  if (from === 'you') return t('list.you');
  return NAME[from] ?? state?.bots?.find(b => b.id === from)?.name ?? from;
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
    ${navItem('#/messages', 'chat', t('nav.messages'), SIDE_SCREENS.has(screen), mini, waiting)}
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

export function renderRail(state, now, opts = {}) {
  return renderNav(state) + renderSide(state, now, opts);
}
