// face/client/js/render/channel.js — a channel's page (spec 2026-10-19 §7 Stage 3 "Channels"): the status headline,
// the thesis, the latest backtest, the research runs, the backtests, the journal, the files and the rosters, from
// /data/channels/overview.
// Everything here was written by Gravit or the operator into the channel's directory: text through esc, the thesis
// through the thread's DOM-built markdown.
import { esc, cls, attrs } from '../html.js';
import { icon } from '../icons.js';
import { fmtClock, fmtDate } from '../time.js';
import { chip, markdownHtml } from './thread.js';
import { kv } from './controls.js';
import { runsView } from '../host/runs-view.js';

const JOURNAL_ROWS = 20;
const LATEST_FIELDS = 12;

export function bytesWord(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
const scalar = v => v === null || ['number', 'string', 'boolean'].includes(typeof v);
const fieldWord = v => (typeof v === 'number' && !Number.isInteger(v) ? String(Math.round(v * 1e4) / 1e4) : String(v));
const sec = (label, body) => `<section class="dsec"><div class="dsec-label">${esc(label)}</div>${body}</section>`;
const line = (name, meta) => `<div class="chan-row"><span class="chan-row-name">${esc(name)}</span>${meta ? `<span class="chan-row-meta">${esc(meta)}</span>` : ''}</div>`;
const none = word => `<div class="dsec-line dim">${esc(word)}</div>`;

function thesis(body) {
  const t = body?.thesis;
  return sec('Thesis', t && !t.isTemplate && typeof t.markdown === 'string' && t.markdown.trim() !== ''
    ? `<div class="chan-thesis">${markdownHtml(t.markdown)}</div>` : none('No thesis yet'));
}

function latest(body) {
  const l = body?.latest;
  if (!l || typeof l.file !== 'string') return '';
  const json = l.json && typeof l.json === 'object' && !Array.isArray(l.json) ? l.json : {};
  const rows = Object.entries(json).filter(([, v]) => scalar(v)).slice(0, LATEST_FIELDS).map(([k, v]) => [k, esc(fieldWord(v))]);
  return sec('Latest backtest', `<div class="chan-row"><span class="chan-row-name mono">${esc(l.file)}</span></div>${rows.length ? kv(rows) : ''}`);
}

// the Lunhui research runs (modules spec §5.11): the latest sealed run with an artifact — its line, a chip per module,
// the expectation card, each artifact whole in a collapsed details — then a dim line per run and the omitted count
function researchRuns(body) {
  const v = runsView(body);
  const l = v.latest;
  const head = l ? `<div class="chan-row"><span class="chan-row-name mono">${esc([l.run, `as of ${l.asOf ?? '—'}`, l.snapshotId && `snapshot ${l.snapshotId}`, l.marketRun && `cn-market run ${l.marketRun}`].filter(Boolean).join(' · '))}</span></div>` +
    (l.chips.length ? `<div class="btn-row">${l.chips.map(c => chip(c.text)).join('')}</div>` : '') +
    (l.expectation ? kv(l.expectation.map(([k, w]) => [k, esc(w)])) : '') +
    l.details.map(d => `<details class="acct-shown"><summary>${esc(d.module)}</summary><div class="dsec-line mono">${esc(d.json)}</div></details>`).join('') : '';
  const runLines = v.rows.map(r => {
    const arts = `${r.artifacts.length} artifacts${r.artifacts.length ? `: ${r.artifacts.join(', ')}` : ''}`;
    return `<div class="chan-row dim"><span class="chan-row-name mono">${esc(r.run)}</span><span class="chan-row-meta">${esc([`as of ${r.asOf ?? '—'}`, arts, bytesWord(r.bytes), !r.sealed && 'unsealed'].filter(Boolean).join(' · '))}</span></div>`;
  }).join('');
  return sec('Research runs', head + (v.empty ? none(v.empty) : '') + runLines + (v.omitted > 0 ? none(`older runs not listed: ${v.omitted}`) : ''));
}

function rows(label, list, toLine) {
  return Array.isArray(list) && list.length ? sec(label, list.map(toLine).join('')) : '';
}

// a roster's editor: a box per choice, ticked as the store holds it; a seventh bot box is shut while six are ticked
function rosterEditor(e) {
  const full = e.which === 'bots' && e.ticked.length >= 6;
  const boxes = e.choices.map((c, i) => {
    const on = e.ticked.includes(c.value);
    return `<label class="opt"><input type="checkbox"${attrs({ id: `roster-${e.which}-${i}`, name: 'roster', value: c.value, checked: on, disabled: !on && full })}><span>${esc(c.label)}</span></label>`;
  }).join('');
  return `<div class="roster-edit">${boxes || none('None to choose')}<div class="btn-row">` +
    `<button type="button" class="key yes" data-action="commitEdit" aria-label="Save">${icon('check', 14, 2.4)}</button>` +
    `<button type="button" class="key no" data-action="cancelEdit" aria-label="Cancel">${icon('x', 14, 2.4)}</button>` +
    `${e.error ? `<span class="field-error">${esc(e.error)}</span>` : ''}</div></div>`;
}

function roster(label, which, names, state, id) {
  const e = state.edit?.kind === 'roster' && state.edit.which === which && state.edit.workspaceId === id ? state.edit : null;
  const edit = e ? '' : `<button type="button" class="btn-sm" data-action="editRoster" data-which="${which}" data-id="${esc(id)}">Edit</button>`;
  const body = e ? rosterEditor(e) : names.length ? names.map(n => `<div class="dsec-line">${esc(n)}</div>`).join('') : none('None');
  return `<section class="dsec"><div class="dsec-label chan-label">${esc(label)}${edit}</div>${body}</section>`;
}

function rosters(data, state, id) {
  const names = new Map((Array.isArray(data.allBots) ? data.allBots : []).map(b => [b.id, b.name]));
  const agents = Array.isArray(data.agents) ? data.agents : [];
  const bots = Array.isArray(data.bots) ? data.bots : [];
  return roster('Agents', 'agents', agents, state, id) + roster('Bots', 'bots', bots.map(b => names.get(b) ?? b), state, id);
}

function headline(status) {
  const s = status && typeof status === 'object' ? status : {};
  const numbers = s.numbers && typeof s.numbers === 'object' ? Object.entries(s.numbers).map(([k, v]) => [k, esc(String(v))]) : [];
  return (s.one_line ? `<p class="chan-line">${esc(s.one_line)}</p>` : '') +
    (s.next ? `<div class="dsec-line">Next: ${esc(s.next)}</div>` : '') + (numbers.length ? kv(numbers) : '');
}

const retry = id => `<button type="button" class="btn-sm" data-action="channelRetry" data-id="${esc(id)}">Retry</button>`;

export function renderChannelScreen(state, now) {
  const id = state.route.id;
  const listed = (state.channels ?? []).find(c => c.workspaceId === id) ?? null;
  const c = state.channel?.id === id ? state.channel : { status: 'idle', data: null, at: null };
  const name = listed ? listed.title || listed.name : c.data?.channel?.name ?? id ?? '';
  const shell = (body, head = '') => `<main class="main chan"><header class="head"><h1 class="head-title">${esc(name)}</h1>${head}</header><div class="chan-body">${body}</div></main>`;
  if (c.status === 'missing' || (!listed && (state.channels ?? []).length > 0)) return shell('<div class="chan-none">Channel not found</div>');
  const data = c.data;
  if (!data) {
    if (c.status === 'failed') return shell(`<div class="chan-none">Channel unavailable ${retry(id)}</div>`);
    return shell('<div class="chan-none dim">Loading…</div>');
  }
  const status = data.status && typeof data.status === 'object' ? data.status : {};
  const head = (status.status ? chip(status.status) : '') + '<span class="spacer"></span>' +
    `<button type="button" class="btn-primary small" data-action="newRound" data-id="${esc(id)}">New round</button>`;
  const stale = c.status === 'failed' ? `<div class="${cls('chan-stale', 'dim')}">As of ${esc(fmtClock(c.at ?? now))} · stale ${retry(id)}</div>` : '';
  const body = data.body && typeof data.body === 'object' ? data.body : {};
  return shell(
    stale + headline(status) + thesis(body) + latest(body) + researchRuns(body) +
    rows('Backtests', body.backtests, b => line(b.file, bytesWord(b.bytes))) +
    rows('Journal', (body.journal ?? []).slice(0, JOURNAL_ROWS), j => `<div class="chan-row"><span class="chan-row-meta">${esc(j.date)}</span><span class="chan-row-name">${esc(j.text)}</span></div>`) +
    rows('Files', body.files, f => line(f.name, [bytesWord(f.bytes), Number.isFinite(Date.parse(f.mtime)) ? fmtDate(Date.parse(f.mtime)) : ''].filter(Boolean).join(' · '))) +
    rosters(data, state, id),
    head,
  );
}
