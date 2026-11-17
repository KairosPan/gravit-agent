// face/client/js/render/desk-page.js — the Desk page (#/desk, desk-page plan 1 Task 4, spec 2026-11-14 §6.1–§6.2): the head
// bar - the title, the state chip, one line and the Pause key (none while off or paused) - the paused
// banner, then two columns: News (the sources, Calendar's one line, the filter chips, each symbol's group with its latest
// alert, Details and the earlier rows, the routines' reports, the watch rules folded) and Routines (plan 2 Task 7: the cap's
// line, each routine's row with its switch, opened to its instruction, when it runs, its run history, Test, Edit with gravit
// and Delete; then the standing orders as read-only rows, made in a terminal; the foot saying where routines are created).
// The desk off, or its status not read, is one line and no columns. Every text from the ledgers is drawn escaped, as
// written; the words are host/desk-page-view.js's and the table's.
import { esc } from '../html.js';
import { t, th, tn, thn, rawHtml, sayOf } from '../i18n/words.js';
import { deskHeadOf, newsViewOf, moveOf, rowWordsOf, nthWord, ruleRowOf, alertTime, reportId, routinesViewOf } from '../host/desk-page-view.js';
import { scheduledOf } from '../host/rail-view.js';
import { watchHead, etWhen } from '../host/desk-view.js';

const page = (head, body) => `<main class="main dk">${head}<div class="dk-body">${body}</div></main>`;
const headBar = (chip, line, key) => `<header class="head"><div class="dk-head-l"><h1 class="head-title">${th('desk.page.title')}</h1>${chip}${line ? `<span class="dk-line">${esc(line)}</span>` : ''}</div>${key}</header>`;
const chip = (tone, text, dot = false) => `<span class="chip ${tone}">${dot ? '<span class="status-dot"></span>' : ''}${esc(text)}</span>`;
const dim = text => `<p class="dk-dim">${esc(text)}</p>`;

// the head's chip and line by its state; the stopped watch says why in its own line
function chipOf(head) {
  switch (head.state) {
    case 'paused': return chip('warn', t('desk.chip.paused'));
    case 'muted': return chip('warn', head.until === undefined ? t('desk.chip.mutedOn') : t('desk.chip.muted', { time: head.until }));
    case 'stopped': return chip('warn', t('desk.chip.stopped'));
    case 'monitoring': return chip('ok', t('desk.chip.monitoring'), true);
    default: return chip('grey', t('desk.chip.offHours'));
  }
}
const headLine = (head, status) => (head.state !== 'stopped' ? tn('desk.page.line', head.rules)
  : head.reason === 'none' ? t('desk.page.noWatch') : watchHead(status.watch));

function banner(off) {
  const by = off.until === undefined ? th('desk.page.pausedBy', { by: off.by, since: off.since }) : th('desk.page.pausedUntil', { by: off.by, since: off.since, until: off.until });
  return `<div class="dk-banner" role="status"><strong>${th('desk.page.paused')}</strong><span>${by}</span><span>${th('desk.page.resume')}</span></div>`;
}

// ---- News

function sourceName(id) {
  switch (id) {
    case 'quotes': return t('desk.source.quotes');
    case 'headlines': return t('desk.source.headlines');
    case 'filings': return t('desk.source.filings');
    default: return null;
  }
}
function sourceChip(s) {
  const source = sourceName(s.id);
  if (source === null) return '';
  if (s.state === 'ok') return chip('ok', source);
  if (s.state === 'off') return chip('grey', t('desk.source.off', { source }));
  return chip('warn', typeof s.reason === 'string' && s.reason !== '' ? t('desk.source.down', { source, reason: s.reason }) : source);
}
const sources = list => `<div class="dk-row">${list.map(sourceChip).join('')}${chip('grey', t('desk.source.flows'))}${chip('grey', t('desk.source.social'))}` +
  `<a class="dk-link" href="#/discover">${th('desk.source.connect')}</a></div>`;
const calendar = () => `<div class="dk-part"><span class="dk-sub">${th('desk.news.calendar')}</span>${dim(t('desk.news.noCalendar'))}</div>`;
const filterKeys = chips => `<div class="dk-row" role="group" aria-label="${th('desk.news.filter')}">${chips.map(c =>
  `<button type="button" class="pill${c.on ? ' pressed' : ''}" data-action="dkFilter" data-value="${esc(c.id)}" aria-pressed="${c.on}">${esc(c.label)} <span class="dk-n">${c.count}</span></button>`).join('')}</div>`;

// an alert's move in the up or down colour, else its label (a level's, a filing's)
const moveChip = a => { const m = moveOf(a); return m ? chip(m.dir, m.text) : chip('grey', a.label); };
const wordsOf = a => rowWordsOf(a).map(w => `<span class="dk-word ${w.tone}">${esc(w.text)}</span>`).join('');

function earlierRow(a) {
  const m = moveOf(a);
  const move = m ? `<span class="dk-move ${m.dir}">${esc(m.text)}</span>` : `<span class="dk-move">${esc(a.label)}</span>`;
  // a reason with no headline draws no note: the row's words keep to its right
  const headline = a.reason?.headline ? `<span class="dk-note">${esc(a.reason.headline)}</span>` : '';
  return `<div class="dk-early"><span class="dk-time">${esc(alertTime(a))}</span>${move}${headline}${wordsOf(a)}</div>`;
}

function group(g, today) {
  const a = g.latest;
  const r = a.reason && typeof a.reason === 'object' ? a.reason : null;
  const words = wordsOf(a);
  const top = `<div class="dk-top"><div class="dk-row"><span class="dk-sym">${esc(g.symbol)}</span>${moveChip(a)}` +
    `<span class="dk-dim">${esc(t('desk.et', { time: alertTime(a) }))}</span><span class="dk-dim">${esc(nthWord(a.nth, today))}</span></div>${words ? `<div class="dk-row">${words}</div>` : ''}</div>`;
  const headline = r && r.headline ? `<p class="dk-headline">${esc(r.headline)}</p>` : '';
  const toggle = r ? `<button type="button" class="btn-sm" data-action="dkToggle" data-id="${esc(a.id)}" aria-expanded="${g.open}">${g.open ? th('desk.news.hide') : th('desk.news.details')}</button>` : '';
  const meta = r ? `<div class="dk-top"><div class="dk-row dk-dim">${r.label ? `<span>${esc(r.label)}</span>` : ''}<span>${thn('desk.news.pages', Number(r.pages) || 0)}</span></div>${toggle}</div>` : '';
  const session = r && r.sessionId ? `<a class="dk-link" href="#/history/${esc(encodeURIComponent(r.sessionId))}">${th('desk.news.session')}</a>` : '';
  const detail = r && g.open ? `<div class="dk-detail"><pre class="dk-reason">${esc(r.text)}</pre>${session}</div>` : '';
  const earlier = g.earlier.length ? `<div class="dk-part"><span class="dk-sub">${today ? th('desk.news.earlierToday') : th('desk.news.earlier')}</span>${g.earlier.map(earlierRow).join('')}</div>` : '';
  return `<article class="dk-group">${top}${headline}${meta}${detail}${earlier}</article>`;
}

// a routine's reports: its latest report's headline with Details opening its body as a reason's is opened, the earlier ones
// one row each - every word the model's, escaped
function reportGroup(g, now) {
  const r = g.latest;
  const toggle = `<button type="button" class="btn-sm" data-action="dkToggle" data-id="${esc(reportId(r))}" aria-expanded="${g.open}">${g.open ? th('desk.news.hide') : th('desk.news.details')}</button>`;
  const top = `<div class="dk-top"><div class="dk-row"><strong>${esc(g.name)}</strong><span class="dk-dim">${esc(t('desk.et', { time: etWhen(r.t, now) }))}</span></div>${toggle}</div>`;
  const headline = `<p class="dk-headline">${esc(r.headline)}</p>`;
  const detail = g.open ? `<div class="dk-detail"><pre class="dk-reason">${esc(r.body)}</pre></div>` : '';
  const earlier = g.earlier.length ? `<div class="dk-part"><span class="dk-sub">${th('desk.news.earlier')}</span>${g.earlier.map(e =>
    `<div class="dk-early"><span class="dk-time">${esc(etWhen(e.t, now))}</span><span class="dk-note">${esc(e.headline)}</span></div>`).join('')}</div>` : '';
  return `<article class="dk-group">${top}${headline}${detail}${earlier}</article>`;
}
const reportsPart = (view, now) => (view.reports.length
  ? `<div class="dk-part"><span class="dk-sub">${th('desk.news.reports')}</span><div class="dk-groups">${view.reports.map(g => reportGroup(g, now)).join('')}</div></div>` : '');

function rulesFold(view) {
  const key = `<button type="button" class="dk-fold" data-action="dkRules" aria-expanded="${view.rulesOpen}"><span>${th('desk.news.rules', { n: view.rules.length })}</span>` +
    `<span class="dk-dim">${view.rulesOpen ? th('desk.news.hide') : th('desk.news.details')}</span></button>`;
  if (!view.rulesOpen) return key;
  const rows = view.rules.map(rule => ruleRowOf(rule, view.today)).map(r => `<div class="dk-rule"><span><strong>${esc(r.names)}</strong> <span class="dk-dim">${esc(r.what)}</span></span><span class="dk-dim">${esc(r.today)}</span></div>`);
  return `${key}<div class="dk-rules">${rows.join('')}<div class="dk-rule"><span>${th('desk.news.levels', { n: view.levels })}</span></div></div>`;
}

function news(state, now) {
  const p = state.deskPage;
  const view = newsViewOf(p.data, p);
  const head = `<div class="dk-col-head"><h2>${th('desk.news.title')}</h2><span class="dk-dim">${th('desk.news.caption')}</span>` +
    `${view && !view.today ? chip('grey', t('desk.news.dayOf', { date: view.date })) : ''}</div>`;
  // the last failure's sentence stays said over the news kept until a read answers; with none kept, News waits or is unavailable
  const failed = p.message ? dim(sayOf(p.message)) : '';
  if (!view) return `<section class="dk-col" aria-label="${th('desk.news.title')}">${head}${failed}${dim(p.message ? t('desk.page.unavailable') : t('common.loading'))}</section>`;
  const groups = view.groups.length ? `<div class="dk-groups">${view.groups.map(g => group(g, view.today)).join('')}</div>`
    : view.chips[0].count === 0 ? dim(t('desk.news.none')) : '';
  return `<section class="dk-col" aria-label="${th('desk.news.title')}">${head}${failed}${sources(view.sources)}${calendar()}${filterKeys(view.chips)}${groups}${reportsPart(view, now)}${rulesFold(view)}</section>`;
}

// ---- Routines

// a routine's switch: a 44 by 26 track and its knob, pressed to turn it the other way
const routineSwitch = r => `<button type="button" role="switch" class="dk-switch" aria-checked="${r.on}" aria-label="${r.on ? th('desk.routines.switchOff', { name: r.name }) : th('desk.routines.switchOn', { name: r.name })}" ` +
  `data-action="dkSwitch" data-id="${esc(r.id)}" data-value="${!r.on}"><span class="dk-knob" aria-hidden="true"></span></button>`;

// a run of the history: its time ("Test" beside a test's), its status, its note, the link to its session
function runRow(u) {
  const test = u.test ? chip('grey', t('desk.routines.test')) : '';
  const note = u.note ? `<span class="dk-note">${esc(u.note)}</span>` : '';
  const session = u.sessionId ? `<a class="dk-link" href="#/history/${esc(encodeURIComponent(u.sessionId))}">${th('desk.news.session')}</a>` : '';
  return `<div class="dk-run"><span class="dk-run-t">${esc(u.time)}</span>${test}${chip(u.tone, u.status)}${note}${session}</div>`;
}

function routineOpened(r) {
  const part = (head, body) => `<div class="dk-part"><span class="dk-sub">${head}</span>${body}</div>`;
  const runs = r.runs.length ? r.runs.map(runRow).join('') : dim(t('desk.routines.noRuns'));
  const test = `<button type="button" class="btn-sm" data-action="dkTest" data-id="${esc(r.id)}"${r.busy ? ' disabled' : ''}>${r.busy ? th('desk.routines.running') : th('desk.routines.test')}</button>`;
  const edit = `<button type="button" class="btn-sm" data-action="dkEdit" data-text="${esc(t('desk.routines.editText', { name: r.name }))}">${th('desk.routines.edit')}</button>`;
  const del = `<button type="button" class="btn-danger" data-action="dkDelete" data-id="${esc(r.id)}">${th('desk.routines.delete')}</button>`;
  const ask = r.asking ? `<div class="dk-ask" role="alert"><strong>${th('desk.routines.deleteAsk')}</strong><span class="confirm">` +
    `<button type="button" class="btn-danger" data-action="dkDeleteYes" data-id="${esc(r.id)}">${th('desk.routines.deleteYes')}</button>` +
    `<button type="button" class="btn-sm" data-action="dkDeleteNo">${th('common.cancel')}</button></span></div>` : '';
  return `<div class="dk-detail">${part(th('desk.routines.instruction'), `<p class="dk-text">${esc(r.instruction)}</p>`)}` +
    `${part(th('desk.routines.when'), `<p class="dk-text">${esc(r.schedule)}</p>`)}${part(th('desk.routines.history'), runs)}<div class="btn-row">${test}${edit}${del}</div>${ask}</div>`;
}

// a routine's row: the name and its when line (or Paused) opening it, its switch; a refused act's line under it; opened, its parts
function routineRow(r) {
  const key = `<button type="button" class="dk-rt-key" data-action="dkRoutine" data-id="${esc(r.id)}" aria-expanded="${r.open}"><strong>${esc(r.name)}</strong><span class="dk-dim">${esc(r.when)}</span></button>`;
  const refused = r.said ? `<p class="dk-said" role="status">${esc(sayOf(r.said))}</p>` : '';
  return `<article class="dk-rt"><div class="dk-rt-top">${key}${routineSwitch(r)}</div>${refused}${r.open ? routineOpened(r) : ''}</article>`;
}

// the column: the cap's line (and the spent one) under the head, a read's failure, the routines - or the store's one line when
// it cannot be read - then the standing orders' read-only rows; No routines yet. only with neither, once a read has answered
function routines(state, now) {
  const p = state.deskPage;
  const view = routinesViewOf(p.routines.data, p, new Date(now).toISOString());
  const standing = scheduledOf(state, now).map(({ scheduled: o, status }) => `<article class="dk-routine"><div class="dk-routine-b"><strong>${esc(o.order)}</strong><span class="dk-dim">${esc(status)}</span></div>${chip('grey', t('desk.chip.terminal'))}</article>`);
  const rows = [...(view ? view.rows.map(routineRow) : []), ...standing];
  const cap = view ? `${dim(view.cap.line)}${view.cap.spent ? `<p class="dk-spent">${th('desk.routines.capSpent')}</p>` : ''}` : '';
  const failed = p.routines.message ? dim(sayOf(p.routines.message)) : '';
  const error = view?.error ? dim(t('desk.routines.unreadable', { error: view.error })) : '';
  const messages = rawHtml(`<a href="#/messages">${th('nav.messages')}</a>`);
  return `<section class="dk-col" aria-label="${th('desk.routines.title')}"><div class="dk-col-head"><h2>${th('desk.routines.title')}</h2><span class="dk-dim">${th('desk.routines.caption')}</span></div>` +
    `${cap}${failed}${error}${rows.length ? `<div class="dk-groups">${rows.join('')}</div>` : view?.error || p.routines.status !== 'ready' ? '' : `<p>${th('desk.routines.none')}</p>`}<p class="dk-dim">${th('desk.routines.foot', { messages })}</p></section>`;
}

/** The Desk screen at `now` (ms): the head and its state, then News and Routines. The desk off is one line; so is its status
 *  not read yet, or failed - the failure's sentence (kept until a read answers) and Desk status unavailable, never a chip
 *  from the status before it. A read on its way over a status read keeps the screen as it stands. */
export function renderDeskScreen(state, now) {
  const d = state.desk;
  const head = d.message ? null : deskHeadOf(d.data, new Date(now).toISOString());
  if (!head) return page(headBar('', null, ''), `${d.message ? dim(sayOf(d.message)) : ''}${dim(d.message ? t('desk.page.unavailable') : t('common.loading'))}`);
  if (head.state === 'off') return page(headBar('', null, ''), dim(t('desk.page.off')));
  const pause = head.state === 'paused' ? '' : `<button type="button" class="btn-sm" data-action="deskPause">${th('desk.page.pause')}</button>`;
  return page(headBar(chipOf(head), headLine(head, d.data), pause),
    `${head.state === 'paused' ? banner(head.off) : ''}<div class="dk-cols">${news(state, now)}${routines(state, now)}</div>`);
}
