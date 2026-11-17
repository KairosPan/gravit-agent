// face/client/js/render/memory-decisions.js — the Memory screen's Decisions tab (memory screen plan Task 4), for a connected
// decisions read: the symbol box, whose words the host reads the decisions for; No decision yet; else the decisions in the
// order the memory gives them, newest first, under their symbol's head while no symbol is typed (one with none under No
// symbol) - each its date, whose and by, its action, its id, its marks, its thesis in quotes, wrong if, the owner's words in
// quotes under In your words, what followed at each measured horizon, and, while it is not void, its void command; a void one
// struck - and a line when older decisions are not shown. Every text from the memory is made visible (visible.js) and then
// escaped; a class comes from the face's own tables alone.
import { attrs, cls, esc } from '../html.js';
import { t, th, tn } from '../i18n/words.js';
import { visible } from '../visible.js';
import { fmtDate } from '../time.js';
import { followedLine, decisionMarks } from '../host/memory-page-view.js';
import { shown, dim, terminalHtml } from './memory-lessons.js';

// each mark's words and its chip's colour
const MARKS = {
  void: [() => t('memory.decisions.markVoid'), 'down'],
  open: [() => t('memory.decisions.markOpen'), 'live'],
  reviewed: [() => t('memory.decisions.markReviewed'), 'ok'],
  backfilled: [() => t('memory.decisions.markBackfilled'), 'grey'],
};

const str = v => (typeof v === 'string' ? v : '');
const filled = v => typeof v === 'string' && v !== '';

function symbolBox(page) {
  return `<div class="mp-filter"><label for="mp-symbol" class="sr-only">${esc(t('memory.decisions.symbolLabel'))}</label>` +
    `<input id="mp-symbol" class="input mp-symbol" type="search" autocomplete="off" placeholder="${esc(t('memory.decisions.symbol'))}" data-action="memoryPageSymbol"${attrs({ value: str(page?.symbol) })}></div>`;
}

function followedHtml(figures) {
  const lines = followedLine(figures).map(f => `<li>${esc(f.against === null
    ? tn('memory.decisions.after', f.k, { pct: f.change })
    : tn('memory.decisions.afterAgainst', f.k, { pct: f.change, against: f.against }))}</li>`);
  return lines.length ? `<ul class="mp-followed">${lines.join('')}</ul>` : '';
}

function decisionHtml(row) {
  const view = row.view;
  const line = view.line && typeof view.line === 'object' ? view.line : {};
  const marks = decisionMarks(view);
  const isVoid = marks.includes('void');
  const date = typeof view.decidedMs === 'number' && Number.isFinite(view.decidedMs) ? `<span class="mp-when">${esc(fmtDate(view.decidedMs))}</span>` : '';
  const head = `<div class="mp-decision-head">${date}` +
    `<span class="mp-who">${esc(t('memory.decisions.whoseBy', { whose: visible(str(line.whose)), by: visible(str(line.by)) }))}</span>` +
    `<span class="mp-action">${shown(str(line.action))}</span><span class="mp-id">${shown(str(line.id))}</span>` +
    marks.map(m => `<span class="chip ${MARKS[m][1]}">${esc(MARKS[m][0]())}</span>`).join('') + '</div>';
  const thesis = `<div class="mp-words">${th('thread.memory.quoted', { words: visible(str(line.thesis)) })}</div>`;
  const wrong = filled(line.wrong_if) ? `<div class="mp-line">${esc(t('memory.decisions.wrongIf', { words: visible(line.wrong_if) }))}</div>` : '';
  const yours = filled(line.words)
    ? `<div class="mp-yours"><div class="mp-dim">${esc(t('memory.decisions.yourWords'))}</div><div class="mp-words">${th('thread.memory.quoted', { words: visible(line.words) })}</div></div>`
    : '';
  const voidCommand = isVoid ? '' : terminalHtml([row.command]);
  return `<article class="${cls('mp-decision', isVoid && 'void')}">${head}${thesis}${wrong}${yours}${followedHtml(row.figures)}${voidCommand}</article>`;
}

// the decisions under their symbol's head, each symbol once in the order it is first met
function grouped(rows) {
  const groups = new Map();
  for (const row of rows) {
    const symbol = row.view.line?.symbol;
    const key = filled(symbol) ? `s:${symbol}` : 'none';
    if (!groups.has(key)) groups.set(key, { head: filled(symbol) ? shown(symbol) : esc(t('memory.decisions.noSymbol')), rows: [] });
    groups.get(key).rows.push(row);
  }
  return [...groups.values()].map(g => `<section class="mp-group"><h2 class="mp-group-head">${g.head}</h2>${g.rows.map(decisionHtml).join('')}</section>`).join('');
}

/** The Decisions tab's body for a connected decisions read: `read` its body, `page` the screen's slice (the symbol typed),
 *  `now` the clock's time, which a decision's day does not need. */
export function decisionsHtml(read, page, now) {
  const rows = Array.isArray(read?.items) ? read.items.filter(r => r && typeof r === 'object' && r.view && typeof r.view === 'object') : [];
  const filtering = filled(page?.symbol);
  const list = !rows.length ? dim(t('memory.decisions.none')) : filtering ? rows.map(decisionHtml).join('') : grouped(rows);
  const more = read?.more === true ? dim(t('memory.decisions.more')) : '';
  return `<div class="mp-body mp-decisions">${symbolBox(page)}${list}${more}</div>`;
}
