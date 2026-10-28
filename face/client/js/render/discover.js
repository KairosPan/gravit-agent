// face/client/js/render/discover.js — Discover as the inventory of what Gravit runs (spec 2026-10-19 §7 Stage 3
// "Discover = My plugins"): five shelves of cards from the face's listings, a grid per shelf, a page per item. No shop:
// nothing here installs, buys, publishes or counts installs. Every listed string is the host's or the operator's, through
// esc.
import { esc, attrs, cls } from '../html.js';
import { icon } from '../icons.js';
import { toHash } from '../router.js';
import { SHELVES, SOURCE, itemsOf, searchItems, itemById } from '../host/discover-view.js';
import { GRAVIT_KEYS } from '../host/discover.js';
import { avatar, mark } from './avatars.js';
import { kv } from './controls.js';
import { renderStatus } from './messages.js';

const PHASE = { pending: 'Pending', loading: 'Loading', active: 'Active', failed: 'Failed', unloading: 'Unloading' };
const SIGN_IN = { ok: 'Signed in', none: 'Not signed in' };
const UNREAD = "Couldn't read";

const markOf = (m, size) => (m.type === 'gravit' ? avatar('gravit', size) : mark({ tone: 'grey', ...m }, size, '10px', ''));
const sec = (label, body) => `<div class="dsec"><div class="dsec-label">${esc(label)}</div>${body}</div>`;
const line = text => `<div class="dsec-line">${esc(text)}</div>`;
const dim = text => `<div class="dsec-line dim">${esc(text)}</div>`;
const shelfOf = id => SHELVES.find(s => s.id === id) ?? null;

// a card opens its item's page
function card(item, grid = false) {
  return `<a${attrs({ class: cls('pcard', grid && 'in-grid'), href: `#/plugin/${encodeURIComponent(item.id)}` })}>${markOf(item.mark, 44)}` +
    `<span class="pcard-body"><span class="pcard-name">${esc(item.name)}</span><span class="pcard-blurb">${esc(item.line)}</span></span>` +
    `<span class="pcard-side"><span class="pcard-kind">${esc(item.kind.toUpperCase())}</span></span></a>`;
}

// a Research card (module cards spec §5.1): the link to the module's page around its mark, name and 副题, its role and
// channel, and the foot with the chip read from the latest run and Run, disabled until plan 3
function researchCard(item) {
  const name = item.source.name;
  return `<div${attrs({ class: cls('pcard', 'research', 'in-grid', item.dim && 'dim') })}><a${attrs({ class: 'pcard-link', href: `#/module/${encodeURIComponent(name)}` })}>${markOf(item.mark, 44)}` +
    `<span class="pcard-body"><span class="pcard-name">${esc(item.name)}</span><span class="pcard-blurb">${esc(item.line)}</span></span>` +
    `<span class="pcard-kind">${esc(item.kind.toUpperCase())}</span></a><span class="pcard-meta">${esc(item.meta)}</span>` +
    `<span class="pcard-foot"><span${attrs({ class: cls('chip', item.chip.tone) })}>${esc(item.chip.text)}</span>` +
    `<button type="button" class="btn-sm" data-action="runModule"${attrs({ 'data-module': name })} disabled title="Run comes with plan 3">Run</button></span></div>`;
}
const gridCard = i => (i.shelf === 'research' ? researchCard(i) : card(i, true));

// the Research shelf's one line when the listing says the Lunhui rows are not mounted: the cards stay, dimmed
const unmounted = state => (state.discover.shelves?.modules?.data?.mounted === false ? '<div class="disc-none dim">Lunhui rows not mounted</div>' : '');

// what a shelf says beside its cards: a failed read with Retry, the first read, or nothing there
function shelfState(s, items, state) {
  const source = SOURCE[s.id];
  const status = state.discover.shelves?.[source]?.status ?? 'idle';
  if (status === 'failed') return `<div class="disc-none">${UNREAD} ${esc(s.title)} <button type="button" class="btn-sm" data-action="shelfRetry" data-shelf="${source}">Retry</button></div>`;
  const own = s.id === 'agents' ? items.filter(i => i.id !== 'agent:gravit') : items;
  if (own.length) return '';
  if (status === 'ready') return s.id === 'agents' ? '' : `<div class="disc-none dim">${esc(s.empty)}</div>`;
  return '<div class="disc-none dim">Loading…</div>';
}

const rescanKey = '<button type="button" class="btn-sm" data-action="rescanAgents">Rescan</button>';

function shelf(s, items, state) {
  // Research is a grid of its six, never a scrolling row
  const research = s.id === 'research';
  const cards = !items.length ? '' : research ? `${unmounted(state)}<div class="grid">${items.map(researchCard).join('')}</div>` : `<div class="shelf-row">${items.map(i => card(i)).join('')}</div>`;
  const sub = research ? ` <span class="dim">Lunhui · ${items.length} modules</span>` : '';
  return `<section class="shelf"><div class="shelf-head"><div class="shelf-title">${esc(s.title)}${sub}</div>${s.id === 'agents' ? rescanKey : ''}` +
    `<a class="link" href="#/discover/${s.id}">See all ›</a></div>${shelfState(s, items, state)}${cards}</section>`;
}

function grid(title, items, extra = '', back = false) {
  return `<section class="grid-sec">${back ? '<a class="back-link" href="#/discover">‹ Discover</a>' : ''}<div class="grid-title">${esc(title)}</div>${extra}` +
    `${items.length ? `<div class="grid">${items.map(gridCard).join('')}</div>` : ''}</section>`;
}

function header(state) {
  return `<div class="disc-head"><h1 class="head-title">Discover</h1>` +
    `<div class="search"><label for="dq" class="sr-only">Search</label>${icon('search', 18, 2)}<input id="dq" type="search" autocomplete="off" placeholder="Search" data-action="dq"${attrs({ value: state.discover.query })}></div>` +
    `<span class="spacer"></span><a class="pill" href="#/discover/create">${icon('plus', 14, 2.2)}Create a bot</a></div>`;
}

// Create a bot: a name (the id proposed from it unless given), a description, a model, a soul; blank ones are left to the
// face (its id rule, its template soul, the default route)
function createPage(state) {
  const choices = Array.isArray(state.discover.models) ? state.discover.models : [];
  const options = [{ value: '', label: 'Default' }, ...choices].map(c => `<option${attrs({ value: c.value })}>${esc(c.label)}</option>`).join('');
  const box = (key, label) => `<label class="field"><span class="field-label">${label}</span><input${attrs({ id: `nb-${key}`, class: 'input', name: key, type: 'text', autocomplete: 'off' })}></label>`;
  return '<main class="main disc plugin-page"><a id="page-back" class="back-link page-back" href="#/discover">‹ Discover</a>' +
    '<header class="plug-head"><div class="plug-title"><h1 class="plug-name">Create a bot</h1></div></header>' +
    `<div class="plug-body"><form class="bot-edit" data-action="createBot">${box('name', 'Name')}${box('id', 'Id')}${box('description', 'Description')}` +
    `<label class="field"><span class="field-label">Model</span><select id="nb-model" class="input" name="model">${options}</select></label>` +
    '<label class="field"><span class="field-label">Soul</span><textarea id="nb-soul" class="textarea" name="soul" rows="14"></textarea></label>' +
    `<div class="btn-row"><button type="submit" class="btn-primary">Create</button></div></form></div>${renderStatus(state.discover.status)}</main>`;
}

export function renderDiscover(state) {
  if (state.route.id === 'create') return createPage(state);
  const d = state.discover;
  const items = itemsOf(d);
  let body;
  if (d.query.trim()) {
    const found = searchItems(Object.values(items).flat(), d.query);
    body = grid(`${found.length} result${found.length === 1 ? '' : 's'}`, found);
  } else if (shelfOf(state.route.id)) {
    const s = shelfOf(state.route.id);
    body = grid(s.title, items[s.id], (s.id === 'agents' ? rescanKey : '') + shelfState(s, items[s.id], state) + (s.id === 'research' ? unmounted(state) : ''), true);
  } else {
    body = SHELVES.map(s => shelf(s, items[s.id], state)).join('');
  }
  return `<main class="main disc">${header(state)}${body}${renderStatus(d.status)}</main>`;
}

// ---- a page per item

function mcpPage(m) {
  const tools = Array.isArray(m.tools) ? m.tools.filter(t => t && typeof t.name === 'string') : [];
  return kv([['State', esc(PHASE[m.phase] ?? '—')]]) +
    sec('Tools', tools.length ? tools.map(t => `<div class="tool-line"><span class="mono">${esc(t.name)}</span>${t.description ? `<span class="tool-desc">${esc(t.description)}</span>` : ''}</div>`).join('') : dim('None'));
}

// a bot's editor: every box's id carries the revision it was drawn from, so a re-read after a stale save brings the
// saved values instead of the typing that lost the race
function botEditor(b, state) {
  const id = `bot-${b.id}-${b.revision ?? ''}`;
  const choices = Array.isArray(state.discover.models) ? state.discover.models : [];
  const current = typeof b.model === 'string' && b.model !== '' ? b.model : '';
  const options = [{ value: '', label: 'Default' }, ...choices, ...(current && !choices.some(c => c.value === current) ? [{ value: current, label: current }] : [])]
    .map(c => `<option${attrs({ value: c.value, selected: c.value === current })}>${esc(c.label)}</option>`).join('');
  const box = (key, label, value) => `<label class="field"><span class="field-label">${label}</span><input${attrs({ id: `${id}-${key}`, class: 'input', name: key, type: 'text', autocomplete: 'off', value })}></label>`;
  return `<form class="bot-edit" data-action="saveBot" data-id="${esc(b.id)}">${box('name', 'Name', b.name ?? '')}${box('description', 'Description', b.description ?? '')}` +
    `<label class="field"><span class="field-label">Model</span><select${attrs({ id: `${id}-model`, class: 'input', name: 'model' })}>${options}</select></label>` +
    `<label class="field"><span class="field-label">Soul</span><textarea${attrs({ id: `${id}-soul`, class: 'textarea', name: 'soul', rows: 14 })}>${esc(b.soul ?? '')}</textarea></label>` +
    '<div class="btn-row"><button type="button" class="btn" data-action="cancelEdit">Cancel</button><button type="submit" class="btn-primary">Save</button></div></form>';
}

function botPage(b) {
  const skills = Array.isArray(b.skills) ? b.skills.filter(k => k && typeof k.name === 'string') : [];
  const issues = Array.isArray(b.setupIssues) ? b.setupIssues.filter(i => typeof i === 'string') : [];
  return (b.broken ? `<div class="disc-broken">Can't run · ${esc(b.broken)}</div>` : '') +
    kv([['Model', esc(typeof b.model === 'string' && b.model !== '' ? b.model : 'Default')], ['Home', `<span class="mono">${esc(b.homeCwd ?? '—')}</span>`]]) +
    (b.description ? sec('Description', line(b.description)) : '') +
    sec('Soul', typeof b.soul === 'string' && b.soul.trim() !== '' ? `<pre class="disc-text">${esc(b.soul)}</pre>` : dim('None')) +
    (skills.length ? sec('Skills', skills.map(k => line(k.name)).join('')) : '') +
    (issues.length ? sec('Setup issues', issues.map(line).join('')) : '');
}

function agentPage(a) {
  const rows = [['Version', esc(a.version ?? '—')]];
  if (a.connected) rows.push(['Sign-in', esc(SIGN_IN[a.auth?.state] ?? 'Unknown')], ['Tool', `<span class="mono">${esc(a.tool ?? '—')}</span>`]);
  return kv(rows);
}

// a card of the Gravit page: still reading, failed alone, or its rows
const card3 = (label, value, rows) => sec(label, value === null || value === undefined ? dim('Loading…') : value === false ? dim(UNREAD) : kv(rows(value)));

function gravitPage(state) {
  const g = state.discover.gravit ?? {};
  return card3('Model', g.model, m => [['Provider', esc(m?.provider ?? '—')], ['Model', esc(m?.model ?? '—')], ['Effort', esc(m?.reasoningEffort ?? '—')]]) +
    card3('Host', g.host, h => [['Working directory', `<span class="mono">${esc(h.cwd ?? '—')}</span>`], ['Home', `<span class="mono">${esc(h.home ?? '—')}</span>`],
      ['Attached sessions', esc(h.attachedSessions ?? '—')], ['Version', esc(h.version ?? '—')]]) +
    card3('Keys', g.keys, k => GRAVIT_KEYS.map(ref => [ref, k?.[ref]?.configured === true ? 'Present' : 'Absent']));
}

function skillPage(item, state) {
  const read = state.discover.skills?.[item.name];
  const content = read?.status === 'ready' ? `<pre class="disc-text">${esc(read.detail?.content ?? '')}</pre>` : read?.status === 'failed' ? dim(UNREAD) : dim('Loading…');
  return kv([['Group', esc(read?.detail?.group ?? item.group ?? '—')]]) + (item.line ? sec('Description', line(item.line)) : '') + sec('Content', content);
}

const KIND_LINE = { MCP: () => 'MCP server', Bot: () => 'Bot', Skill: i => `Skill · ${i.group}`, Agent: i => (i.id === 'agent:gravit' ? 'Main agent' : 'CLI agent') };

function keysOf(item) {
  if (item.shelf === 'bots') {
    const b = item.source;
    // Talk to needs a bot dsh can run: not broken, and on the preset roster
    const talk = b.broken || b.listed === false ? '' : `<button type="button" class="btn-primary" data-action="talkTo" data-id="${esc(b.id)}">Talk to ${esc(item.name)}</button>`;
    return `${talk}<button type="button" class="btn-sm" data-action="editBot" data-id="${esc(b.id)}">Edit</button>`;
  }
  if (item.shelf !== 'agents' || item.id === 'agent:gravit') return '';
  const bin = esc(item.source.bin);
  return item.source.connected
    ? `<button type="button" id="plug-key" class="btn-sm" data-action="disconnectAgent" data-bin="${bin}">Disconnect</button>`
    : `<button type="button" id="plug-key" class="btn-primary" data-action="connectAgent" data-bin="${bin}">Connect</button>`;
}

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
  const back = `<a id="page-back" class="back-link page-back" href="${esc(toHash(state.lastDiscover ?? { screen: 'discover', id: null }))}">‹ Discover</a>`;
  const item = itemById(state.discover, id);
  if (!item) {
    const source = ID_SOURCE[id.slice(0, id.indexOf(':'))];
    const status = source ? state.discover.shelves?.[source]?.status ?? 'idle' : 'ready';
    return `<main class="main disc plugin-page">${back}<div class="disc-none dim">${status === 'idle' || status === 'loading' ? 'Loading…' : 'Not found'}</div></main>`;
  }
  const head = `<header class="plug-head">${markOf(item.mark, 72)}<div class="plug-title"><h1 class="plug-name">${esc(item.name)}</h1>` +
    `<div class="dim">${esc(KIND_LINE[item.kind]?.(item) ?? item.kind)}</div></div><div class="plug-key">${keysOf(item)}</div></header>`;
  return `<main class="main disc plugin-page">${back}${head}<div class="plug-body">${bodyOf(item, state)}</div>${renderStatus(state.discover.status)}</main>`;
}
