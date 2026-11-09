// face/client/js/render/discover.js — Discover as the inventory of what Gravit runs (spec 2026-10-19 §7 Stage 3
// "Discover = My plugins"): five shelves of cards from the face's listings, a grid per shelf, a page per item. No shop:
// nothing here installs, buys, publishes or counts installs. Every listed string is the host's or the operator's, through
// esc.
import { esc, attrs, cls } from '../html.js';
import { icon } from '../icons.js';
import { toHash } from '../router.js';
import { shelves, SOURCE, itemsOf, searchItems, itemById } from '../host/discover-view.js';
import { GRAVIT_KEYS } from '../host/discover.js';
import { avatar, mark } from './avatars.js';
import { kv } from './controls.js';
import { moduleChip, runKey } from './modules.js';
import { activeRuns } from '../host/modules-view.js';
import { renderStatus } from './messages.js';
import { t, th, tn } from '../i18n/words.js';

// an MCP server's phase and a CLI agent's sign-in, as the listing names them
function phaseWord(phase) {
  switch (phase) {
    case 'pending': return t('discover.phase.pending');
    case 'loading': return t('discover.phase.loading');
    case 'active': return t('discover.phase.active');
    case 'failed': return t('discover.phase.failed');
    case 'unloading': return t('discover.phase.unloading');
    default: return '—';
  }
}
const signInWord = state => (state === 'ok' ? t('discover.signIn.ok') : state === 'none' ? t('discover.signIn.none') : t('discover.signIn.unknown'));

const markOf = (m, size) => (m.type === 'gravit' ? avatar('gravit', size) : mark({ tone: 'grey', ...m }, size, '10px', ''));
const sec = (label, body) => `<div class="dsec"><div class="dsec-label">${esc(label)}</div>${body}</div>`;
const line = text => `<div class="dsec-line">${esc(text)}</div>`;
const dim = text => `<div class="dsec-line dim">${esc(text)}</div>`;
const shelfOf = id => shelves().find(s => s.id === id) ?? null;

// a card's kind in capitals, by the kind's code: each its own word in the table (a script without case has no capitals to
// take); an item with no code known draws its kind's word
function kindUpper(item) {
  switch (item.kindCode) {
    case 'mcp': return t('discover.kind.mcpUpper');
    case 'bot': return t('discover.kind.botUpper');
    case 'agent': return t('discover.kind.agentUpper');
    case 'skill': return t('discover.kind.skillUpper');
    case 'module': return t('discover.kind.moduleUpper');
    default: return item.kind;
  }
}

// a card opens its item's page
function card(item, grid = false) {
  return `<a${attrs({ class: cls('pcard', grid && 'in-grid'), href: `#/plugin/${encodeURIComponent(item.id)}` })}>${markOf(item.mark, 44)}` +
    `<span class="pcard-body"><span class="pcard-name">${esc(item.name)}</span><span class="pcard-blurb">${esc(item.line)}</span></span>` +
    `<span class="pcard-side"><span class="pcard-kind">${esc(kindUpper(item))}</span></span></a>`;
}

// a Research card (module cards spec §5.1): the link to the module's page around its mark, name and 副题, its role and
// channel, and the foot with the chip read from the latest run (a link to the conversation while its Run is running) and
// Run, off while the rows are not mounted or a Run of it is running
function researchCard(item) {
  const name = item.source.name;
  return `<div${attrs({ class: cls('pcard', 'research', 'in-grid', item.dim && 'dim') })}><a${attrs({ class: 'pcard-link', href: `#/module/${encodeURIComponent(name)}` })}>${markOf(item.mark, 44)}` +
    `<span class="pcard-body"><span class="pcard-name">${esc(item.name)}</span><span class="pcard-blurb">${esc(item.line)}</span></span>` +
    `<span class="pcard-kind">${esc(kindUpper(item))}</span></a><span class="pcard-meta">${esc(item.meta)}</span>` +
    `<span class="pcard-foot">${moduleChip(item.chip)}${runKey(name, item.dim === true, item.running === true)}</span></div>`;
}
const gridCard = i => (i.shelf === 'research' ? researchCard(i) : card(i, true));

// the Research shelf's one line when the listing says the Lunhui rows are not mounted: the cards stay, dimmed
const unmounted = state => (state.discover.shelves?.modules?.data?.mounted === false ? `<div class="disc-none dim">${th('discover.unmounted')}</div>` : '');

// what a shelf says beside its cards: a failed read with Retry, the first read, or nothing there
function shelfState(s, items, state) {
  const source = SOURCE[s.id];
  const status = state.discover.shelves?.[source]?.status ?? 'idle';
  if (status === 'failed') return `<div class="disc-none">${th('discover.unreadShelf', { shelf: s.title })} <button type="button" class="btn-sm" data-action="shelfRetry" data-shelf="${source}">${th('discover.retry')}</button></div>`;
  const own = s.id === 'agents' ? items.filter(i => i.id !== 'agent:gravit') : items;
  if (own.length) return '';
  if (status === 'ready') return s.id === 'agents' ? '' : `<div class="disc-none dim">${esc(s.empty)}</div>`;
  return `<div class="disc-none dim">${th('common.loading')}</div>`;
}

const rescanKey = () => `<button type="button" class="btn-sm" data-action="rescanAgents">${th('discover.rescan')}</button>`;

function shelf(s, items, state) {
  // Research is a grid of its six, never a scrolling row
  const research = s.id === 'research';
  const cards = !items.length ? '' : research ? `${unmounted(state)}<div class="grid">${items.map(researchCard).join('')}</div>` : `<div class="shelf-row">${items.map(i => card(i)).join('')}</div>`;
  const sub = research ? ` <span class="dim">${th('discover.lunhuiModules', { n: items.length })}</span>` : '';
  return `<section class="shelf"><div class="shelf-head"><div class="shelf-title">${esc(s.title)}${sub}</div>${s.id === 'agents' ? rescanKey() : ''}` +
    `<a class="link" href="#/discover/${s.id}">${th('discover.seeAll')}</a></div>${shelfState(s, items, state)}${cards}</section>`;
}

function grid(title, items, extra = '', back = false) {
  return `<section class="grid-sec">${back ? `<a class="back-link" href="#/discover">${th('discover.back')}</a>` : ''}<div class="grid-title">${esc(title)}</div>${extra}` +
    `${items.length ? `<div class="grid">${items.map(gridCard).join('')}</div>` : ''}</section>`;
}

function header(state) {
  return `<div class="disc-head"><h1 class="head-title">${th('nav.discover')}</h1>` +
    `<div class="search"><label for="dq" class="sr-only">${th('discover.search')}</label>${icon('search', 18, 2)}<input id="dq" type="search" autocomplete="off" placeholder="${th('discover.search')}" data-action="dq"${attrs({ value: state.discover.query })}></div>` +
    `<span class="spacer"></span><a class="pill" href="#/discover/create">${icon('plus', 14, 2.2)}${th('discover.createBot')}</a></div>`; // words-order: an icon, then its word
}

// Create a bot: a name (the id proposed from it unless given), a description, a model, a soul; blank ones are left to the
// face (its id rule, its template soul, the default route)
function createPage(state) {
  const choices = Array.isArray(state.discover.models) ? state.discover.models : [];
  const options = [{ value: '', label: t('discover.model.default') }, ...choices].map(c => `<option${attrs({ value: c.value })}>${esc(c.label)}</option>`).join('');
  const box = (key, label) => `<label class="field"><span class="field-label">${label}</span><input${attrs({ id: `nb-${key}`, class: 'input', name: key, type: 'text', autocomplete: 'off' })}></label>`;
  return `<main class="main disc plugin-page"><a id="page-back" class="back-link page-back" href="#/discover">${th('discover.back')}</a>` +
    `<header class="plug-head"><div class="plug-title"><h1 class="plug-name">${th('discover.createBot')}</h1></div></header>` +
    `<div class="plug-body"><form class="bot-edit" data-action="createBot">${box('name', th('discover.field.name'))}${box('id', th('discover.field.id'))}${box('description', th('discover.field.description'))}` +
    `<label class="field"><span class="field-label">${th('discover.field.model')}</span><select id="nb-model" class="input" name="model">${options}</select></label>` +
    `<label class="field"><span class="field-label">${th('discover.field.soul')}</span><textarea id="nb-soul" class="textarea" name="soul" rows="14"></textarea></label>` +
    `<div class="btn-row"><button type="submit" class="btn-primary">${th('discover.create')}</button></div></form></div>${renderStatus(state.discover.status)}</main>`;
}

export function renderDiscover(state, now = Date.now()) {
  if (state.route.id === 'create') return createPage(state);
  const d = state.discover;
  const items = itemsOf(d, activeRuns(state.moduleRuns, state.tasks?.items, now));
  let body;
  if (d.query.trim()) {
    const found = searchItems(Object.values(items).flat(), d.query);
    body = grid(tn('discover.results', found.length), found);
  } else if (shelfOf(state.route.id)) {
    const s = shelfOf(state.route.id);
    body = grid(s.title, items[s.id], (s.id === 'agents' ? rescanKey() : '') + shelfState(s, items[s.id], state) + (s.id === 'research' ? unmounted(state) : ''), true);
  } else {
    body = shelves().map(s => shelf(s, items[s.id], state)).join('');
  }
  return `<main class="main disc">${header(state)}${body}${renderStatus(d.status)}</main>`;
}

// ---- a page per item

function mcpPage(m) {
  const tools = Array.isArray(m.tools) ? m.tools.filter(tool => tool && typeof tool.name === 'string') : [];
  return kv([[t('discover.key.state'), esc(phaseWord(m.phase))]]) +
    sec(t('discover.key.tools'), tools.length ? tools.map(tool => `<div class="tool-line"><span class="mono">${esc(tool.name)}</span>${tool.description ? `<span class="tool-desc">${esc(tool.description)}</span>` : ''}</div>`).join('') : dim(t('discover.none')));
}

// a bot's editor: every box's id carries the revision it was drawn from, so a re-read after a stale save brings the
// saved values instead of the typing that lost the race
function botEditor(b, state) {
  const id = `bot-${b.id}-${b.revision ?? ''}`;
  const choices = Array.isArray(state.discover.models) ? state.discover.models : [];
  const current = typeof b.model === 'string' && b.model !== '' ? b.model : '';
  const options = [{ value: '', label: t('discover.model.default') }, ...choices, ...(current && !choices.some(c => c.value === current) ? [{ value: current, label: current }] : [])]
    .map(c => `<option${attrs({ value: c.value, selected: c.value === current })}>${esc(c.label)}</option>`).join('');
  const box = (key, label, value) => `<label class="field"><span class="field-label">${label}</span><input${attrs({ id: `${id}-${key}`, class: 'input', name: key, type: 'text', autocomplete: 'off', value })}></label>`;
  return `<form class="bot-edit" data-action="saveBot" data-id="${esc(b.id)}">${box('name', th('discover.field.name'), b.name ?? '')}${box('description', th('discover.field.description'), b.description ?? '')}` +
    `<label class="field"><span class="field-label">${th('discover.field.model')}</span><select${attrs({ id: `${id}-model`, class: 'input', name: 'model' })}>${options}</select></label>` +
    `<label class="field"><span class="field-label">${th('discover.field.soul')}</span><textarea${attrs({ id: `${id}-soul`, class: 'textarea', name: 'soul', rows: 14 })}>${esc(b.soul ?? '')}</textarea></label>` +
    `<div class="btn-row"><button type="button" class="btn" data-action="cancelEdit">${th('common.cancel')}</button><button type="submit" class="btn-primary">${th('common.save')}</button></div></form>`;
}

function botPage(b) {
  const skills = Array.isArray(b.skills) ? b.skills.filter(k => k && typeof k.name === 'string') : [];
  const issues = Array.isArray(b.setupIssues) ? b.setupIssues.filter(i => typeof i === 'string') : [];
  return (b.broken ? `<div class="disc-broken">${th('discover.bot.cantRun', { reason: b.broken })}</div>` : '') +
    kv([[t('discover.field.model'), esc(typeof b.model === 'string' && b.model !== '' ? b.model : t('discover.model.default'))], [t('discover.key.home'), `<span class="mono">${esc(b.homeCwd ?? '—')}</span>`]]) +
    (b.description ? sec(t('discover.field.description'), line(b.description)) : '') +
    sec(t('discover.field.soul'), typeof b.soul === 'string' && b.soul.trim() !== '' ? `<pre class="disc-text">${esc(b.soul)}</pre>` : dim(t('discover.none'))) +
    (skills.length ? sec(t('discover.shelf.skills'), skills.map(k => line(k.name)).join('')) : '') +
    (issues.length ? sec(t('discover.bot.setupIssues'), issues.map(line).join('')) : '');
}

function agentPage(a) {
  const rows = [[t('discover.key.version'), esc(a.version ?? '—')]];
  if (a.connected) rows.push([t('discover.key.signIn'), esc(signInWord(a.auth?.state))], [t('discover.key.tool'), `<span class="mono">${esc(a.tool ?? '—')}</span>`]);
  return kv(rows);
}

// a card of the Gravit page: still reading, failed alone, or its rows
const card3 = (label, value, rows) => sec(label, value === null || value === undefined ? dim(t('common.loading')) : value === false ? dim(t('discover.unread')) : kv(rows(value)));

function gravitPage(state) {
  const g = state.discover.gravit ?? {};
  return card3(t('discover.field.model'), g.model, m => [[t('discover.key.provider'), esc(m?.provider ?? '—')], [t('discover.field.model'), esc(m?.model ?? '—')], [t('discover.key.effort'), esc(m?.reasoningEffort ?? '—')]]) +
    card3(t('discover.key.host'), g.host, h => [[t('discover.key.cwd'), `<span class="mono">${esc(h.cwd ?? '—')}</span>`], [t('discover.key.home'), `<span class="mono">${esc(h.home ?? '—')}</span>`],
      [t('discover.key.attached'), esc(h.attachedSessions ?? '—')], [t('discover.key.version'), esc(h.version ?? '—')]]) +
    card3(t('discover.key.keys'), g.keys, k => GRAVIT_KEYS.map(ref => [ref, k?.[ref]?.configured === true ? th('discover.key.present') : th('discover.key.absent')]));
}

function skillPage(item, state) {
  const read = state.discover.skills?.[item.name];
  const content = read?.status === 'ready' ? `<pre class="disc-text">${esc(read.detail?.content ?? '')}</pre>` : read?.status === 'failed' ? dim(t('discover.unread')) : dim(t('common.loading'));
  return kv([[t('discover.key.group'), esc(read?.detail?.group ?? item.group ?? '—')]]) + (item.line ? sec(t('discover.field.description'), line(item.line)) : '') + sec(t('discover.key.content'), content);
}

// the line under an item's name: what it is, by its shelf; a module's is its kind
function kindLine(i) {
  if (i.shelf === 'data') return t('discover.kindLine.mcp');
  if (i.shelf === 'bots') return t('discover.kind.bot');
  if (i.shelf === 'skills') return t('discover.kindLine.skill', { group: i.group });
  if (i.shelf === 'agents') return i.id === 'agent:gravit' ? t('discover.kindLine.main') : t('discover.kindLine.cli');
  return i.kind;
}

// Available to Gravit (one-entry plan 4): the one roster's switch on a bot or a connected CLI agent, pressed while it is on
// the roster; disabled while the roster is unread or unreadable
function availableKey(item, state, kind, id) {
  const ready = state.discover.roster?.status === 'ready';
  return `<button${attrs({ type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(ready && item.available === true), 'data-action': 'toggleAvailable', 'data-kind': kind, 'data-id': id, disabled: !ready })}>` +
    `<span class="switch-track"><span class="switch-knob"></span></span><span class="switch-label">${th('discover.available')}</span></button>`;
}
const switchable = item => typeof item.available === 'boolean';

function keysOf(item, state) {
  if (item.shelf === 'bots') {
    // a bot is talked to in a room or a task, through Gravit (one-entry plans 2 and 4): its card switches it and edits it
    return `${availableKey(item, state, 'bot', item.source.id)}<button type="button" class="btn-sm" data-action="editBot" data-id="${esc(item.source.id)}">${th('discover.edit')}</button>`;
  }
  if (item.shelf !== 'agents' || item.id === 'agent:gravit') return '';
  const bin = esc(item.source.bin);
  return item.source.connected
    ? `${switchable(item) ? availableKey(item, state, 'agent', item.source.bin) : ''}<button type="button" id="plug-key" class="btn-sm" data-action="disconnectAgent" data-bin="${bin}">${th('discover.disconnect')}</button>`
    : `<button type="button" id="plug-key" class="btn-primary" data-action="connectAgent" data-bin="${bin}">${th('discover.connect')}</button>`;
}

// the roster file the face cannot read, said on a page whose switch it disables
const rosterLine = (item, state) => (switchable(item) && state.discover.roster?.status === 'corrupt' ? `<div class="disc-broken">${th('discover.rosterUnreadable')}</div>` : '');

function bodyOf(item, state) {
  if (item.id === 'agent:gravit') return gravitPage(state);
  if (item.shelf === 'data') return mcpPage(item.source);
  if (item.shelf === 'bots') return state.edit?.kind === 'bot' && state.edit.id === item.source.id ? botEditor(item.source, state) : botPage(item.source);
  if (item.shelf === 'agents') return agentPage(item.source);
  if (item.shelf === 'research') return line(item.meta);
  return skillPage(item, state);
}

// the listing an id is drawn from, so an unknown id waits while that listing is read
const ID_SOURCE = { mcp: 'plugins', bot: 'bots', agent: 'agents', skill: 'memory', module: 'modules' };

export function renderPlugin(state) {
  const id = state.route.id ?? '';
  const back = `<a id="page-back" class="back-link page-back" href="${esc(toHash(state.lastDiscover ?? { screen: 'discover', id: null }))}">${th('discover.back')}</a>`;
  const item = itemById(state.discover, id);
  if (!item) {
    const source = ID_SOURCE[id.slice(0, id.indexOf(':'))];
    const status = source ? state.discover.shelves?.[source]?.status ?? 'idle' : 'ready';
    return `<main class="main disc plugin-page">${back}<div class="disc-none dim">${status === 'idle' || status === 'loading' ? th('common.loading') : th('discover.notFound')}</div></main>`;
  }
  const head = `<header class="plug-head">${markOf(item.mark, 72)}<div class="plug-title"><h1 class="plug-name">${esc(item.name)}</h1>` +
    `<div class="dim">${esc(kindLine(item))}</div></div><div class="plug-key">${keysOf(item, state)}</div></header>`;
  return `<main class="main disc plugin-page">${back}${head}<div class="plug-body">${rosterLine(item, state)}${bodyOf(item, state)}</div>${renderStatus(state.discover.status)}</main>`;
}
