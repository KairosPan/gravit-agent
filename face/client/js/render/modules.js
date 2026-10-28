// face/client/js/render/modules.js — a Lunhui module's page, #/module/<name> (module cards spec §5.3), in the plugin
// page's chrome: the head with the chip and Run (disabled until plan 3), the Reads / Writes / Runs on boxes from the
// static table, the runs across the module's channels from the listing, the latest artifact through its channel's
// overview (host/modules.js), and the module's legend from Appendix A. Every listed string is the host's, through esc;
// the legends cite the manuscript by paragraph id only.
import { esc, attrs, cls } from '../html.js';
import { toHash } from '../router.js';
import { pageOf } from '../host/modules-view.js';
import { mark } from './avatars.js';
import { kv } from './controls.js';
import { renderStatus } from './messages.js';

const UNREAD = "Couldn't read";
const STATUS_TONE = { OK: 'ok', NOT_EVALUABLE: 'warn' };

const sec = (label, body) => `<div class="dsec"><div class="dsec-label">${esc(label)}</div>${body}</div>`;
const dim = text => `<div class="dsec-line dim">${esc(text)}</div>`;
const chip = (text, tone) => `<span${attrs({ class: cls('chip', tone) })}>${esc(text)}</span>`;
const box = (label, rows) => sec(label, kv(rows.map(([k, v]) => [k, esc(v)])));
const compact = json => { try { return JSON.stringify(json); } catch { return ''; } };

// the head's chip: the page's, or `…` while the listing is first read and `—` when it could not be
function head(m, page, unread) {
  const c = !unread ? page.chip : { text: unread === UNREAD ? '—' : '…', tone: 'grey' };
  const model = m.route.slice(m.route.lastIndexOf('/') + 1);
  return `<header class="plug-head">${mark({ type: 'glyph', icon: m.icon }, 72, '10px', '')}<div class="plug-title"><h1 class="plug-name">${esc(m.title)}</h1>` +
    `<div class="dim">${esc(`${m.role} · ${model} · ${m.channelWords}`)}</div>` +
    `<div class="mod-tags"><span class="pcard-kind">MODULE</span>${chip(c.text, c.tone)}</div></div>` +
    `<div class="plug-key"><button type="button" class="btn-sm" data-action="runModule"${attrs({ 'data-module': m.name })} disabled title="Run comes with plan 3">Run</button></div></header>`;
}

// the runs across the module's channels, newest first, as the listing holds them; while the listing is first read, or
// when it could not be, that instead
function runs(rows, unread) {
  if (unread) return sec('Runs', dim(unread));
  if (!rows.length) return sec('Runs', dim('No run yet'));
  const th = ['Session', 'Channel', 'Run', 'Status', 'Headline'].map(h => `<th>${h}</th>`).join('');
  const tr = r => `<tr><td>${esc(r.session ?? '—')}</td><td>${esc(r.channel)}</td><td class="mono">${esc(r.run)}</td>` +
    `<td>${chip(r.status ?? '—', STATUS_TONE[r.status] ?? 'grey')}</td><td>${esc(r.words)}</td></tr>`;
  return sec('Runs', `<div class="mod-runs-wrap"><table class="mod-runs"><thead><tr>${th}</tr></thead><tbody>${rows.map(tr).join('')}</tbody></table></div>`);
}

// the latest run's artifact whole, collapsed, once its channel's overview answers with that run; a read of another run
// (the listing moved on after the page read) is not the latest's, and says where older runs are
function latest(page, read, unread) {
  if (unread) return sec('Latest artifact', dim(unread));
  if (!page.latest) return sec('Latest artifact', dim('No run yet'));
  if (!read || read.status === 'loading' || read.status === 'idle') return sec('Latest artifact', dim('Loading…'));
  if (read.status === 'failed') return sec('Latest artifact', dim(UNREAD));
  if (read.run !== page.latest.run || read.json === null || read.json === undefined) return sec('Latest artifact', dim('open the channel page to read older runs'));
  return sec('Latest artifact', `<details class="acct-shown"><summary>${esc(`${read.run} · ${page.latest.channel}`)}</summary><pre class="disc-text">${esc(compact(read.json))}</pre></details>`);
}

// Appendix A's legend: label beside its reading, two columns
function legend(l) {
  if (!l) return '';
  const rows = l.rows.map(r => `<div class="kv"><span class="kv-k mono">${esc(r.label)}</span><span class="kv-v">${esc(r.text)}</span></div>`).join('');
  return sec(l.title, `<div class="kv-list mod-legend">${rows}</div>`);
}

export function renderModule(state) {
  const name = state.route.id ?? '';
  const back = `<a id="page-back" class="back-link page-back" href="${esc(toHash(state.lastDiscover ?? { screen: 'discover', id: null }))}">‹ Discover</a>`;
  const listing = state.discover.shelves?.modules;
  const page = pageOf(listing?.data ?? null, name, listing?.data?.mounted !== false);
  if (!page) {
    const status = listing?.status ?? 'idle';
    return `<main class="main disc plugin-page">${back}<div class="disc-none dim">${status === 'idle' || status === 'loading' ? 'Loading…' : 'Not found'}</div></main>`;
  }
  const m = page.module;
  // the listing not read yet: still reading, or failed with nothing kept
  const unread = listing?.data ? null : listing?.status === 'failed' ? UNREAD : 'Loading…';
  const body = `<div class="mod-boxes">${box('Reads', page.kv.reads)}${box('Writes', page.kv.writes)}${box('Runs on', page.kv.runsOn)}</div>` +
    runs(page.rows, unread) + latest(page, state.discover.artifacts?.[m.name], unread) + legend(m.legend);
  return `<main class="main disc plugin-page">${back}${head(m, page, unread)}<div class="plug-body">${body}</div>${renderStatus(state.discover.status)}</main>`;
}
