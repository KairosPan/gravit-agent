// face/client/js/render/desk.js — the Desk tab inside Markets (plan 2026-11-01-desk-p3-watch Task 11, ruling 15), from
// host/desk-view.js's view: the desk's status and its one control, Pause — no Resume and no arming, both the terminal's
// (spec §5.7) — then the watch by market with each market's today, today's alerts, the levels as loaded and the refused
// files, the standing orders and their firings, and the runs and sleep gaps. Every word is the view's; this module lays
// them out in the Markets screen's sections and lines.
import { esc } from '../html.js';

const note = text => (text ? `<p class="mk-note">${esc(text)}</p>` : '');
const empty = text => `<p class="mk-empty">${esc(text)}</p>`;
const section = (label, inner) => `<section class="dsec" aria-label="${esc(label)}"><div class="mk-h2">${esc(label)}</div>${inner}</section>`;
const line = (mark, t1, t2 = '', markClass = '') => `<div class="mk-line"><span class="mk-mark${markClass ? ` ${markClass}` : ''}">${mark}</span><div class="mk-line-b"><div class="mk-t1">${t1}</div>${t2 ? `<div class="mk-t2">${t2}</div>` : ''}</div></div>`;
const feed = lines => (lines.length ? `<div class="mk-feed">${lines.join('')}</div>` : '');
const tag = text => `<span class="mk-tag">${esc(text)}</span>`;

/** The Desk tab: `view` deskViewOf's (null before a status has landed), `read` the slice's `{ status, message }` — the last
 *  failure's sentence (kept while the next read is on its way, cleared when one answers) said over the view kept, or, with
 *  none kept, Desk status unavailable under it. */
export function renderDeskTab(view, read = {}) {
  // the last failure's sentence stays said until a read answers, through the polls on their way after it
  const said = note(read.message);
  if (!view) return `<div class="desk">${said}${empty(read.message ? 'Desk status unavailable' : 'Loading…')}</div>`;
  const pause = '<button type="button" class="btn" data-action="deskPause">Pause</button>';
  const status = feed([view.head, view.off, view.telegram, view.budget, view.ledgerError].filter(Boolean).map(w => line('·', esc(w))));
  const head = `<div class="desk-head">${status}${pause}</div>`;

  const watch = view.watch === null ? empty('The watch is not running.')
    : feed([line('·', esc(view.watch)), ...view.markets.map(m => line('·', esc(m.line ?? m.today), esc(m.line === null ? '' : m.today ?? ''))),
      ...[view.pending, view.muted, view.ledger, view.filings].filter(Boolean).map(w => line('·', esc(w)))]);
  const alerts = view.alerts.length ? feed(view.alerts.map(a => line(a.outcome === 'sent' ? '✓' : '·', esc(`${a.when} · ${a.what}`),
    esc(`${a.outcome} · ${a.latency}`), a.outcome === 'sent' ? 'ok' : ''))) : empty('No alerts yet.');
  const levels = view.levels.length || view.files.length
    ? feed([...view.levels.map(l => line('·', `${esc(`${l.symbol} · ${l.market}`)} <span class="mk-level">${esc(l.label)}</span>`, esc(`${l.plan} · ${l.file}`))),
      ...view.files.map(f => line('!', esc(f.file), esc(f.note), 'down'))])
    : empty('No levels loaded.');
  // an order's anchor leads its state only when the state is when it next falls, as src/desk.ts orderState says it
  const standing = feed([...view.standingNotes.map(n => line('·', esc(n))),
    ...view.standing.map(o => line('·', esc(`standing ${o.id}: ${o.timed ? `${o.anchor}, ` : ''}${o.next}`), esc([o.hash === 'ok' ? '' : o.hash, o.last].filter(Boolean).join(' · '))))]);
  const firings = view.firings.length ? feed(view.firings.map(f => line('·', esc(`${f.when} · ${f.order}`), esc(f.kind === f.outcome ? f.kind : `${f.kind} · ${f.outcome}`)))) : empty('No firings yet.');
  const runs = feed([...view.runs.map(r => line('·', `${esc(`${r.bootedAt} · pid ${r.pid}`)}${r.lost ? ` ${tag('lost')}` : ''}`)),
    ...view.asleep.map(g => line('·', esc(`asleep ${g.from}–${g.to}`), esc(g.gap)))]);

  return `<div class="desk">${said}${head}` +
    section('The watch', watch) + section('Alerts', alerts) + section('Levels as loaded', levels) +
    section('Standing orders', standing || empty('None armed.')) + section('Firings', firings) +
    `${section('Runs and sleep', runs || empty('No runs in the ledger.'))}</div>`;
}
