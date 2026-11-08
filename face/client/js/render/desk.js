// face/client/js/render/desk.js — the Desk tab inside Markets (plan 2026-11-01-desk-p3-watch Task 11, ruling 15), from
// host/desk-view.js's view: the desk's status and its one control, Pause — no Resume and no arming, both the terminal's
// (spec §5.7) — then the watch by market with each market's today, today's alerts, the pages the desk opened today (as
// text), the levels as loaded and the refused files, the standing orders - each linking its last firing's session - and
// their firings, and the runs and sleep gaps.
// Every word is the view's; this module lays them out in the Markets screen's sections and lines.
import { esc } from '../html.js';
import { t, th, sayOf } from '../i18n/words.js';

const note = line => { const text = sayOf(line); return text ? `<p class="mk-note">${esc(text)}</p>` : ''; };
const empty = text => `<p class="mk-empty">${esc(text)}</p>`;
const section = (label, inner) => `<section class="dsec" aria-label="${esc(label)}"><div class="mk-h2">${esc(label)}</div>${inner}</section>`;
const line = (mark, t1, t2 = '', markClass = '') => `<div class="mk-line"><span class="mk-mark${markClass ? ` ${markClass}` : ''}">${mark}</span><div class="mk-line-b"><div class="mk-t1">${t1}</div>${t2 ? `<div class="mk-t2">${t2}</div>` : ''}</div></div>`;
const feed = lines => (lines.length ? `<div class="mk-feed">${lines.join('')}</div>` : '');
const tag = text => `<span class="mk-tag">${esc(text)}</span>`;
// the session an order's last firing woke, on the Messages route (P4 ruling 6): its report, read where it was said
const sessionLink = id => (id ? `<a href="#/messages/${esc(encodeURIComponent(id))}">${th('desk.tab.session')}</a>` : '');

/** The Desk tab: `view` deskViewOf's (null before a status has landed), `read` the slice's `{ status, message }` — the last
 *  failure's sentence (kept while the next read is on its way, cleared when one answers) said over the view kept, or, with
 *  none kept, Desk status unavailable under it. */
export function renderDeskTab(view, read = {}) {
  // the last failure's sentence stays said until a read answers, through the polls on their way after it
  const failed = note(read.message);
  if (!view) return `<div class="desk">${failed}${empty(read.message ? t('desk.tab.unavailable') : t('common.loading'))}</div>`;
  const pause = `<button type="button" class="btn" data-action="deskPause">${th('desk.tab.pause')}</button>`;
  const status = feed([view.head, view.off, view.phone, view.budget, view.ledgerError].filter(Boolean).map(w => line('·', esc(w))));
  const head = `<div class="desk-head">${status}${pause}</div>`;

  const watch = view.watch === null ? empty(t('desk.tab.notRunning'))
    : feed([line('·', esc(view.watch)), ...view.markets.map(m => line('·', esc(m.line ?? m.today), esc(m.line === null ? '' : m.today ?? ''))),
      ...[view.pending, view.muted, view.ledger, view.filings].filter(Boolean).map(w => line('·', esc(w)))]);
  const alerts = view.alerts.length ? feed(view.alerts.map(a => line(a.sent ? '✓' : '·', esc(`${a.when} · ${a.what}`),
    esc(`${a.outcome} · ${a.latency}`), a.sent ? 'ok' : ''))) : empty(t('desk.tab.noAlerts'));
  // an opened page is escaped text, never a link: the URL is the turn's, as asked, perhaps from a planted page - read, not
  // followed (spec 2026-11-07 §5.6)
  const pages = view.pages.length ? feed(view.pages.map(p => line('·', esc(p.url), esc(p.time)))) : empty(t('desk.tab.pagesNone'));
  const levels = view.levels.length || view.files.length
    ? feed([...view.levels.map(l => line('·', `${esc(`${l.symbol} · ${l.market}`)} <span class="mk-level">${esc(l.label)}</span>`, esc(`${l.plan} · ${l.file}`))),
      ...view.files.map(f => line('!', esc(f.file), esc(f.note), 'down'))])
    : empty(t('desk.tab.noLevels'));
  // an order's anchor leads its state only when the state is when it next falls, as src/desk.ts orderState says it; an
  // A-share order's market leads both, as standingLines prints it
  const standing = feed([...view.standingNotes.map(n => line('·', esc(n))),
    ...view.standing.map(o => line('·', esc(t('desk.tab.standing', { id: o.id, market: o.market === 'cn' ? t('desk.tab.marketCn') : '', anchor: o.timed ? t('desk.tab.anchor', { at: o.anchor }) : '', next: o.next })),
      [esc([o.hash === 'ok' ? '' : o.hash, o.last].filter(Boolean).join(' · ')), sessionLink(o.sessionId)].filter(Boolean).join(' · ')))]); // words-order: an order's pins, its last firing and its session's link under the visual separator
  const firings = view.firings.length ? feed(view.firings.map(f => line('·', esc(`${f.when} · ${f.order}`), esc(f.kind === f.outcome ? f.kind : `${f.kind} · ${f.outcome}`)))) : empty(t('desk.tab.noFirings'));
  const runs = feed([...view.runs.map(r => line('·', `${esc(t('desk.tab.run', { at: r.bootedAt, pid: r.pid }))}${r.lost ? ` ${tag(t('desk.tab.lost'))}` : ''}`)), // words-order: a run's line, then its tag
    ...view.asleep.map(g => line('·', esc(t('desk.tab.asleep', { from: g.from, to: g.to })), esc(g.gap)))]);

  return `<div class="desk">${failed}${head}` +
    section(t('desk.tab.watch'), watch) + section(t('desk.tab.alerts'), alerts) + section(t('desk.tab.pages'), pages) + section(t('desk.tab.levels'), levels) +
    section(t('desk.tab.standingOrders'), standing || empty(t('desk.tab.noneArmed'))) + section(t('desk.tab.firings'), firings) +
    `${section(t('desk.tab.runs'), runs || empty(t('desk.tab.noRuns')))}</div>`;
}
