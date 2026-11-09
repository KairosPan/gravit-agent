// face/client/js/render/modules.js — a Lunhui module's page, #/module/<name> (module cards spec §5.3), in the plugin
// page's chrome: the head with the chip and Run (off while the rows are not mounted or a Run of it runs), the Reads / Writes / Runs on boxes from the
// static table, the runs across the module's channels from the listing, the latest artifact through its channel's
// overview (host/modules.js), and the module's legend from Appendix A. Every listed string is the host's, through esc;
// the legends cite the manuscript by paragraph id only.
import { esc, attrs, cls } from '../html.js';
import { toHash } from '../router.js';
import { pageOf, activeRuns } from '../host/modules-view.js';
import { mark } from './avatars.js';
import { kv } from './controls.js';
import { renderStatus } from './messages.js';
import { t, th } from '../i18n/words.js';

// the listing not read yet: 'failed' with nothing kept, 'loading' while first read
const unreadWord = unread => (unread === 'failed' ? t('discover.unread') : t('common.loading'));
const STATUS_TONE = { OK: 'ok', NOT_EVALUABLE: 'warn' };

const sec = (label, body) => `<div class="dsec"><div class="dsec-label">${esc(label)}</div>${body}</div>`;
const dim = text => `<div class="dsec-line dim">${esc(text)}</div>`;
const chip = (text, tone) => `<span${attrs({ class: cls('chip', tone) })}>${esc(text)}</span>`;
// a module's chip: a live one is the link to the conversation its Run started
export const moduleChip = c => (c.href
  ? `<a${attrs({ class: cls('chip', c.tone), href: c.href })}>${esc(c.text)} ›</a>`
  : chip(c.text, c.tone));
// a module's Run: off while the rows are not mounted, and while a Run of it is running
export const runKey = (name, off, running) =>
  `<button${attrs({ type: 'button', class: 'btn-sm', 'data-action': 'runModule', 'data-module': name, disabled: off || running, title: running ? t('modules.running') : null })}>${th('modules.run')}</button>`;
const box = (label, rows) => sec(label, kv(rows.map(([k, v]) => [k, esc(v)])));
const compact = json => { try { return JSON.stringify(json); } catch { return ''; } };

// the head's chip: the page's, or `…` while the listing is first read and `—` when it could not be; a running Run's
// either way, since it needs no listing
function head(m, page, unread, mounted) {
  const c = !unread || page.running ? page.chip : { text: unread === 'failed' ? '—' : '…', tone: 'grey' };
  const model = m.route.slice(m.route.lastIndexOf('/') + 1);
  return `<header class="plug-head">${mark({ type: 'glyph', icon: m.icon }, 72, '10px', '')}<div class="plug-title"><h1 class="plug-name">${esc(m.title)}</h1>` +
    `<div class="dim">${esc(`${m.role} · ${model} · ${m.channelWords}`)}</div>` + // words-order: a module's role, model and channel under the visual separator
    `<div class="mod-tags"><span class="pcard-kind">${th('discover.kind.moduleUpper')}</span>${moduleChip(c)}</div></div>` +
    `<div class="plug-key">${runKey(m.name, !mounted, page.running)}</div></header>`;
}

// the runs across the module's channels, newest first, as the listing holds them; while the listing is first read, or
// when it could not be, that instead
function runs(rows, unread) {
  if (unread) return sec(t('modules.runs'), dim(unreadWord(unread)));
  if (!rows.length) return sec(t('modules.runs'), dim(t('modules.noRun')));
  const heads = [th('modules.col.session'), th('modules.col.channel'), th('modules.col.run'), th('modules.col.status'), th('modules.col.headline')].map(h => `<th>${h}</th>`).join('');
  const tr = r => `<tr><td>${esc(r.session ?? '—')}</td><td>${esc(r.channel)}</td><td class="mono">${esc(r.run)}</td>` +
    `<td>${chip(r.status ?? '—', STATUS_TONE[r.status] ?? 'grey')}</td><td>${esc(r.words)}</td></tr>`;
  return sec(t('modules.runs'), `<div class="mod-runs-wrap"><table class="mod-runs"><thead><tr>${heads}</tr></thead><tbody>${rows.map(tr).join('')}</tbody></table></div>`);
}

// the latest run's artifact whole, collapsed, once its channel's overview answers with that run; a read of another run
// (the listing moved on after the page read) is not the latest's, and says where older runs are
function latest(page, read, unread) {
  const title = t('modules.latest');
  if (unread) return sec(title, dim(unreadWord(unread)));
  if (!page.latest) return sec(title, dim(t('modules.noRun')));
  if (!read || read.status === 'loading' || read.status === 'idle') return sec(title, dim(t('common.loading')));
  if (read.status === 'failed') return sec(title, dim(t('discover.unread')));
  if (read.run !== page.latest.run || read.json === null || read.json === undefined) return sec(title, dim(t('modules.olderRuns')));
  return sec(title, `<details class="acct-shown"><summary>${esc(`${read.run} · ${page.latest.channel}`)}</summary><pre class="disc-text">${esc(compact(read.json))}</pre></details>`);
}

// Appendix A's legend: label beside its reading, two columns
function legend(l) {
  if (!l) return '';
  const rows = l.rows.map(r => `<div class="kv"><span class="kv-k mono">${esc(r.label)}</span><span class="kv-v">${esc(r.text)}</span></div>`).join('');
  return sec(l.title, `<div class="kv-list mod-legend">${rows}</div>`);
}

export function renderModule(state, now = Date.now()) {
  const name = state.route.id ?? '';
  const back = `<a id="page-back" class="back-link page-back" href="${esc(toHash(state.lastDiscover ?? { screen: 'discover', id: null }))}">${th('discover.back')}</a>`;
  const listing = state.discover.shelves?.modules;
  const mounted = listing?.data?.mounted !== false;
  const page = pageOf(listing?.data ?? null, name, mounted, activeRuns(state.moduleRuns, state.tasks?.items, now));
  if (!page) {
    const status = listing?.status ?? 'idle';
    return `<main class="main disc plugin-page">${back}<div class="disc-none dim">${status === 'idle' || status === 'loading' ? th('common.loading') : th('discover.notFound')}</div></main>`;
  }
  const m = page.module;
  // the listing not read yet: still reading, or failed with nothing kept
  const unread = listing?.data ? null : listing?.status === 'failed' ? 'failed' : 'loading';
  const body = `<div class="mod-boxes">${box(t('modules.reads'), page.kv.reads)}${box(t('modules.writes'), page.kv.writes)}${box(t('modules.runsOn'), page.kv.runsOn)}</div>` +
    runs(page.rows, unread) + latest(page, state.discover.artifacts?.[m.name], unread) + legend(m.legend);
  return `<main class="main disc plugin-page">${back}${head(m, page, unread, mounted)}<div class="plug-body">${body}</div>${renderStatus(state.discover.status)}</main>`;
}
