// face/client/js/render/memory-waiting.js — the Memory screen's Waiting tab (memory screen plan Task 4), for a connected waiting
// read: each proposal waiting for the owner - what it is (a new lesson, a change to one, a retire), who proposed it and when, its
// reason in quotes, its evidence as decision ids, and for a new card or a change the card as it would be written: its line, its
// words in quotes, each check as fact, operator and value, each fact it defines with its definition -; then the decisions past
// their horizon with no review, as text, the count of decisions with no wrong if, and the review command; Nothing waits for you
// when no proposal and no decision waits. Every text from the memory is made visible (visible.js) and then escaped; no id is a
// link and a class comes from the face's own tables alone.
import { esc } from '../html.js';
import { t, th, tn } from '../i18n/words.js';
import { visible } from '../visible.js';
import { fmtDate } from '../time.js';
import { shown, dim, terminalHtml, lineOf } from './memory-lessons.js';

const str = v => (typeof v === 'string' ? v : '');
const strings = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string') : []);
const scalar = v => (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : '');

// what a proposal is, in words, with the lesson it names; a what the face does not know is drawn as given
function whatOf(p) {
  const lesson = visible(str(p.lesson));
  switch (p.what) {
    case 'new': return `${esc(t('memory.waiting.whatNew'))} <span class="mp-id">${esc(lesson)}</span>`;
    case 'change': return esc(t('memory.waiting.whatChange', { lesson }));
    case 'retire': return esc(t('memory.waiting.whatRetire', { lesson }));
    default: return `${shown(str(p.what))} <span class="mp-id">${esc(lesson)}</span>`;
  }
}

// a check as fact, operator and value; a list of values joined
function checkText(c) {
  const value = Array.isArray(c.value) ? c.value.map(scalar).join(t('common.list.sep')) : scalar(c.value);
  return `${str(c.fact)} ${str(c.op)} ${value}`;
}

function cardHtml(card) {
  const checks = (Array.isArray(card.check) ? card.check : []).filter(c => c && typeof c === 'object')
    .map(c => `<li class="mp-check"><code class="mp-fact">${shown(checkText(c))}</code></li>`);
  const facts = card.facts && typeof card.facts === 'object' ? Object.entries(card.facts).filter(([, d]) => typeof d === 'string') : [];
  const defines = facts.map(([fact, d]) => `<li class="mp-check"><code class="mp-fact">${shown(fact)}</code><span class="mp-def">${shown(d)}</span></li>`);
  const list = (head, items) => (items.length ? `<div class="mp-checks"><div class="mp-dim">${esc(head)}</div><ul class="mp-check-list">${items.join('')}</ul></div>` : '');
  return `<div class="mp-written"><div class="mp-dim">${esc(t('memory.waiting.asWritten'))}</div>` +
    `<div class="mp-line">${esc(lineOf(card))}</div><div class="mp-words">${th('thread.memory.quoted', { words: visible(str(card.words)) })}</div>` +
    `${list(t('memory.waiting.checks'), checks)}${list(t('memory.waiting.defines'), defines)}</div>`;
}

function proposalHtml(p) {
  const at = Date.parse(str(p.t));
  const when = Number.isNaN(at) ? '' : `<div class="mp-when">${esc(t('memory.waiting.proposedBy', { by: visible(str(p.by)), date: fmtDate(at) }))}</div>`;
  const evidence = strings(p.evidence);
  const card = (p.what === 'new' || p.what === 'change') && p.card && typeof p.card === 'object' ? cardHtml(p.card) : '';
  return `<article class="mp-proposal"><div class="mp-proposal-head"><span class="mp-what">${whatOf(p)}</span></div>${when}` +
    `<div class="mp-words">${th('thread.memory.quoted', { words: visible(str(p.reason)) })}</div>` +
    (evidence.length ? `<div class="mp-line">${esc(t('memory.waiting.evidence', { ids: visible(evidence.join(t('common.list.sep'))) }))}</div>` : '') +
    `${card}</article>`;
}

/** The Waiting tab's body for a connected waiting read: `read` its body, `page` the screen's slice, `now` the clock's time,
 *  which a proposal's day does not need. */
export function waitingHtml(read, page, now) {
  const proposals = Array.isArray(read?.proposals) ? read.proposals.filter(p => p && typeof p === 'object') : [];
  const past = strings(read?.pastHorizon);
  const without = Number.isInteger(read?.withoutWrongIf) && read.withoutWrongIf > 0 ? read.withoutWrongIf : 0;
  const count = without ? dim(tn('memory.waiting.withoutWrongIf', without)) : '';
  if (!proposals.length && !past.length) return `<div class="mp-body mp-waiting">${dim(t('memory.waiting.none'))}${count}</div>`;
  const pastHtml = past.length
    ? `<div class="mp-past"><h2 class="mp-section-head">${esc(t('memory.waiting.pastHorizon'))}</h2><p class="mp-ids">${shown(past.join(t('common.list.sep')))}</p></div>`
    : '';
  return `<div class="mp-body mp-waiting">${proposals.map(proposalHtml).join('')}${pastHtml}${count}${terminalHtml([read?.command])}</div>`;
}
