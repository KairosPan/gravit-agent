// The Gravit box's page tag (plan 2, Task 1; spec 2026-11-16-gravit-box-design.md 6.7): the first line of a message sent from a
// box screen, naming the page the operator is on. It is English in every language — the router's contract reads it — and an
// id goes in only when the store knows it, never a display name; parseTag reads it back for the thread to draw in words.
import { boxShown } from './sessions.js';
import { isAccountKey } from './market-view.js';
import { itemById } from './discover-view.js';
import { MODULE_NAMES } from './modules-view.js';
import { t } from '../i18n/words.js';

export const TAG_MAX = 120;
export const TAG_ID = /^[A-Za-z0-9:._\/-]{1,64}$/;

const PAGES = ['Desk', 'Markets', 'Trade', 'Discover', 'Account', 'Strategy']; // en-kept: the tag's page names, read by the router's contract
const SCREEN_PAGE = { desk: PAGES[0], markets: PAGES[1], trade: PAGES[2], discover: PAGES[3], plugin: PAGES[3], module: PAGES[3], account: PAGES[4], strategy: PAGES[5] };
const SIDES = ['buy', 'sell'];

const idOk = v => typeof v === 'string' && TAG_ID.test(v);
const tagText = (page, id, at) => `[on screen · ${[page, id, at == null ? null : `at ${at}`].filter(x => x != null).join(' · ')}]`; // en-kept: the tag the router's contract reads

/** The tag for the screen the operator is on, or null where no box stands. */
export function pageTagOf(state) {
  if (!boxShown(state)) return null;
  const r = state.route;
  const page = SCREEN_PAGE[r.screen];
  if (!page) return null;
  let id = null;
  let at = null;
  if (r.screen === 'markets') {
    if (isAccountKey(r.id) && idOk(r.id)) {
      id = r.id;
      if (r.id.startsWith('stock:') && idOk(r.event?.at)) at = r.event.at;
    }
  } else if (r.screen === 'trade') {
    const k = state.trade?.ticket;
    if (k && SIDES.includes(k.side) && isAccountKey(k.id) && idOk(k.id)) id = `${k.side} ${k.id}`;
  } else if (r.screen === 'plugin') {
    if (idOk(r.id) && itemById(state.discover, r.id)) id = r.id;
  } else if (r.screen === 'module') {
    if (idOk(r.id) && MODULE_NAMES.has(r.id)) id = r.id;
  } else if (r.screen === 'account') {
    if (idOk(r.tab)) id = r.tab;
  } else if (r.screen === 'strategy') {
    if (idOk(r.id) && (state.channels ?? []).some(c => !c.isRoot && c.name === r.id)) id = r.id;
  }
  const text = tagText(page, id, at);
  return text.length > TAG_MAX ? tagText(page, null, null) : text;
}

const TAG_LINE = /^\[on screen · (Desk|Markets|Trade|Discover|Account|Strategy)(?: · ([^\]·\n]+?))?(?: · at ([^\]·\n]+))?\]$/;

/** The tag a message opens with, and the text after its line; null for any other text. */
export function parseTag(text) {
  if (typeof text !== 'string') return null;
  const m = /^([^\r\n]*)\r?\n([\s\S]*)$/.exec(text);
  if (!m) return null;
  const g = TAG_LINE.exec(m[1]);
  if (!g) return null;
  return { tag: { page: g[1], id: g[2] ?? null, at: g[3] ?? null }, rest: m[2] };
}

const shown = key => key.replace(/^[^:]*:/, '');
const screenWord = page => {
  const words = [t('nav.desk'), t('nav.markets'), t('nav.trade'), t('nav.discover'), t('nav.account'), t('gbox.page.strategy')]; // in PAGES' order
  return words[PAGES.indexOf(page)];
};
const sideWord = side => (side === 'sell' ? t('trade.sell') : t('trade.buy'));

/** The tag in the operator's language: the screen's word, then the id as shown, then the event date. */
export function tagWords(tag) {
  const parts = [screenWord(tag.page)];
  if (tag.id != null) {
    if (tag.page === PAGES[1]) parts.push(shown(tag.id));
    else if (tag.page === PAGES[2]) {
      const [side, ...key] = tag.id.split(' ');
      parts.push(key.length ? [sideWord(side), shown(key.join(' '))].join(' ') : tag.id); // words-order: a side word and a market code
    } else parts.push(tag.id);
  }
  if (tag.at != null) parts.push(tag.at);
  return parts.join(' · '); // words-order: a list of the page's parts
}
