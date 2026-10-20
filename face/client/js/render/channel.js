// face/client/js/render/channel.js — a channel's page (spec 2026-10-19 §7 Stage 3 "Channels"): the status headline,
// the thesis, the latest backtest, the backtests, the journal, the files and the rosters, from /data/channels/overview.
// Everything here was written by Gravit or the operator into the channel's directory: text through esc, the thesis
// through the thread's DOM-built markdown.
import { esc, cls } from '../html.js';
import { fmtClock, fmtDate } from '../time.js';
import { chip, markdownHtml } from './thread.js';
import { kv } from './controls.js';

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

function rows(label, list, toLine) {
  return Array.isArray(list) && list.length ? sec(label, list.map(toLine).join('')) : '';
}

function rosters(data) {
  const names = new Map((Array.isArray(data.allBots) ? data.allBots : []).map(b => [b.id, b.name]));
  const agents = Array.isArray(data.agents) ? data.agents : [];
  const bots = Array.isArray(data.bots) ? data.bots : [];
  return sec('Agents', agents.length ? agents.map(a => `<div class="dsec-line">${esc(a)}</div>`).join('') : none('None')) +
    sec('Bots', bots.length ? bots.map(b => `<div class="dsec-line">${esc(names.get(b) ?? b)}</div>`).join('') : none('None'));
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
    stale + headline(status) + thesis(body) + latest(body) +
    rows('Backtests', body.backtests, b => line(b.file, bytesWord(b.bytes))) +
    rows('Journal', (body.journal ?? []).slice(0, JOURNAL_ROWS), j => `<div class="chan-row"><span class="chan-row-meta">${esc(j.date)}</span><span class="chan-row-name">${esc(j.text)}</span></div>`) +
    rows('Files', body.files, f => line(f.name, [bytesWord(f.bytes), Number.isFinite(Date.parse(f.mtime)) ? fmtDate(Date.parse(f.mtime)) : ''].filter(Boolean).join(' · '))) +
    rosters(data),
    head,
  );
}
