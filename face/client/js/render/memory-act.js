// face/client/js/render/memory-act.js — the owner's act drawer on the Memory screen (memory owner acts plan Task 4), drawn
// from the slice's act (host/memory-acts.js) and nothing else: its title naming the act and the subject; what the act acts on
// - a card's text in a pre (a discard's armed copy and its file now, each under its head), a proposal as the Waiting tab draws
// it with, for an accept or an edit, the card's source, a decision's decided day, whose and by, action, symbol and thesis -; for
// a worded act the owner's words box under Why, in your own words; What you sign, each field the Account shows as `name:
// value`; the go key, the act's verb, on only while it is ready, Signing… while it signs; a refusal's words, under them the
// act's own terminal command under At the terminal, in face/ when the reads the page holds carry one, and Prepare again while
// the page still signs; Done, and for an edit the file it wrote and what to do next. Every text from the memory and the
// Account is made visible (visible.js) and then escaped; the words box holds the owner's words as typed, escaped, line breaks
// kept.
import { esc, attrs } from '../html.js';
import { t, th, sayOf } from '../i18n/words.js';
import { visible } from '../visible.js';
import { whatYouSignLines } from '../host/owner-view.js';
import { SCREEN_TEXT_MAX } from '../host/memory-page-view.js';
import { WORDED_ACTS } from '../host/memory-acts.js';
import { shown, dim, dayOf, terminalHtml } from './memory-lessons.js';
import { proposalHtml } from './memory-waiting.js';

// each act's title and its go key, the face's own words
const TITLES = {
  arm: subject => t('memory.act.titleArm', { subject }),
  retire: subject => t('memory.act.titleRetire', { subject }),
  discard: subject => t('memory.act.titleDiscard', { subject }),
  accept: subject => t('memory.act.titleAccept', { subject }),
  edit: subject => t('memory.act.titleEdit', { subject }),
  reject: subject => t('memory.act.titleReject', { subject }),
  void: subject => t('memory.act.titleVoid', { subject }),
};
const VERBS = {
  arm: () => t('memory.act.goArm'),
  retire: () => t('memory.act.goRetire'),
  discard: () => t('memory.act.goDiscard'),
  accept: () => t('memory.act.goAccept'),
  edit: () => t('memory.act.goEdit'),
  reject: () => t('memory.act.goReject'),
  void: () => t('memory.act.goVoid'),
};

const str = v => (typeof v === 'string' ? v : '');
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const cut = () => dim(t('memory.lessons.cut', { n: SCREEN_TEXT_MAX.toLocaleString('en-US') }));
// a text from the memory in a pre, each line made visible
const pre = text => `<pre class="mp-text">${str(text).split('\n').map(l => shown(l)).join('\n')}</pre>`;

function cardHtml(show) {
  const texts = typeof show.armedText === 'string'
    ? `<div class="mp-diff-head">${esc(t('memory.lessons.armedHead'))}</div>${pre(show.armedText)}<div class="mp-diff-head">${esc(t('memory.lessons.nowHead'))}</div>${pre(show.text)}`
    : pre(show.text);
  return `${texts}${show.cut === true ? cut() : ''}`;
}

// a decision as the Decisions tab heads it: the day it was decided (its registration's when it names none), whose and by, its
// action, its symbol, its id; then its thesis
function decisionHtml(line, now) {
  const at = Date.parse(str(line.decided_at) || str(line.t));
  const date = Number.isNaN(at) ? '' : `<span class="mp-when">${esc(dayOf(at, now))}</span>`;
  const who = `<span class="mp-who">${esc(t('memory.decisions.whoseBy', { whose: visible(str(line.whose)), by: visible(str(line.by)) }))}</span>`;
  const symbol = str(line.symbol) ? `<span class="mp-act-symbol">${shown(line.symbol)}</span>` : '';
  const thesis = str(line.thesis) ? `<div class="mp-words">${th('thread.memory.quoted', { words: visible(line.thesis) })}</div>` : '';
  return `<div class="mp-decision-head">${date}${who}<span class="mp-action">${shown(str(line.action))}</span>${symbol}<span class="mp-id">${shown(str(line.id))}</span></div>${thesis}`;
}

// the proposed card's source, each entry a line of text, under Source; nothing when it has none
function sourceHtml(proposal) {
  const list = (Array.isArray(proposal.card?.source) ? proposal.card.source : []).filter(v => typeof v === 'string' && v !== '');
  return list.length ? `<div class="mp-checks"><div class="mp-dim">${esc(t('memory.act.source'))}</div><ul class="mp-check-list">${list.map(v => `<li class="mp-check">${shown(v)}</li>`).join('')}</ul></div>` : '';
}

// what the act acts on, as the face's prepare showed it
function showHtml(show, act, now) {
  if (!isObject(show)) return '';
  if (show.kind === 'card') return cardHtml(show);
  if (show.kind === 'proposal' && isObject(show.proposal)) return proposalHtml(show.proposal, now, act === 'accept' || act === 'edit' ? sourceHtml(show.proposal) : '');
  if (show.kind === 'decision' && isObject(show.decision)) return decisionHtml(show.decision, now);
  return '';
}

// the act's own terminal command, from the reads the page holds: a lesson's arm, retire or review (a discard's), the waiting
// read's review for a proposal, a decision row's void; '' when they hold none
const LESSON_COMMANDS = { arm: 'arm', retire: 'retire', discard: 'review' };
function commandOf(page, a) {
  const subject = str(a.subject);
  if (Object.hasOwn(LESSON_COMMANDS, a.act)) {
    const rows = page?.lessons?.data?.lessons;
    const row = Array.isArray(rows) ? rows.find(r => isObject(r) && r.id === subject) : undefined;
    return str(row?.commands?.[LESSON_COMMANDS[a.act]]);
  }
  if (a.act === 'accept' || a.act === 'edit' || a.act === 'reject') return str(page?.waiting?.data?.command);
  if (a.act === 'void') {
    const items = page?.decisions?.data?.items;
    const row = Array.isArray(items) ? items.find(r => isObject(r) && r.view?.line?.id === subject) : undefined;
    return str(row?.command);
  }
  return '';
}

function wordsBox(a) {
  const held = a.status === 'signing' || a.status === 'done';
  return `<label class="field"><span class="field-label">${esc(t('memory.act.words'))}</span><textarea${attrs({
    class: 'textarea mp-act-words', id: 'mp-act-words', name: 'words', rows: '3', maxlength: '500', 'data-action': 'memoryActWords', disabled: held,
  })}>${esc(str(a.words))}</textarea></label>`;
}

function signHtml(prepared) {
  const lines = whatYouSignLines(prepared);
  return lines.length ? `<div class="mp-act-sign"><div class="mp-dim">${esc(t('memory.act.whatYouSign'))}</div>${lines.map(l => `<div class="dsec-line">${shown(l)}</div>`).join('')}</div>` : '';
}

function doneHtml(a) {
  const path = a.act === 'edit' && str(a.done?.path) ? `<code class="mp-command">${shown(a.done.path)}</code>${dim(t('memory.act.editDone'))}` : '';
  return `<p class="mp-act-done">${esc(t('memory.act.done'))}</p>${path}`;
}

// a page that still signs: the Account has not answered that it does not (render/memory-page.js says the same of its line)
const stillSigns = role => role === 'signs' || role === 'unknown' || role === undefined;

// the act's keys: the go key while it is not done or refused, Prepare again on a refusal while the page still signs
function keysHtml(a, role) {
  if (a.status === 'done') return '';
  if (a.status === 'refused') {
    if (!stillSigns(role)) return '';
    return `<div class="btn-row"><button type="button" class="btn-primary"${attrs({ 'data-action': 'memoryActOpen', 'data-act': a.act, 'data-subject': a.subject })}>${esc(t('memory.act.again'))}</button></div>`;
  }
  const word = a.status === 'signing' ? t('memory.act.signing') : VERBS[a.act]();
  return `<div class="btn-row"><button${attrs({ type: 'button', class: 'btn-primary', 'data-action': 'memoryActGo', disabled: a.status !== 'ready' })}>${esc(word)}</button></div>`;
}

/** The act drawer over the Memory screen, or '' with no act open. `now` the clock's time, against which a day carries its year
 *  when it is another. */
export function renderMemoryAct(state, now) {
  const a = state?.memoryPage?.act;
  if (!isObject(a) || !Object.hasOwn(TITLES, a.act)) return '';
  const title = TITLES[a.act](visible(str(a.subject)));
  const status = a.status === 'reading' ? dim(t('common.loading')) : a.status === 'preparing' ? dim(t('memory.act.preparing')) : '';
  const words = WORDED_ACTS.includes(a.act) && a.show ? wordsBox(a) : '';
  const prepared = a.prepared && (a.status === 'ready' || a.status === 'signing') ? signHtml(a.prepared) : '';
  const refusal = a.status === 'refused' ? `<p class="mp-act-said">${shown(sayOf(a.message))}</p>${terminalHtml([commandOf(state.memoryPage, a)])}` : '';
  const done = a.status === 'done' ? doneHtml(a) : '';
  return `<div${attrs({ class: 'drawer sheet mp-act', role: 'dialog', 'aria-label': title })}><div class="drawer-head"><h2>${esc(title)}</h2>` +
    `<button type="button" class="close-key" data-action="memoryActClose" aria-label="${th('common.close')}">×</button></div>` +
    `<div class="drawer-body">${showHtml(a.show, a.act, now)}${status}${words}${prepared}${refusal}${done}${keysHtml(a, state.owner?.role)}</div></div>`;
}
