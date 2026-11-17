// face/client/js/render/lunhui/lessons.js — the owner's lessons on a run's leaders (memory alert and Lunhui, Task 5), from the
// face's answer (host/memory-lunhui.js): under the ladder, a block naming each leader that carries something — a stock link
// with its boards, then its lines — and, for a run that was not checked, one dim line by why; in a leader's stock drawer,
// the same lines. A lesson's line is the order card's (render/lesson-line.js). Every word the memory or the face gave — a
// lesson's words, what an untold lesson needs, a leader's fault — is made visible, then escaped; the face's own words for a
// run not checked or a memory not connected are the table's, never the answer's.
import { esc } from '../../html.js';
import { t, th, thn } from '../../i18n/words.js';
import { visible } from '../../visible.js';
import { lessonHtml, lessonCount } from '../lesson-line.js';
import { leaderLessons } from '../../host/memory-lunhui.js';
import { label, stockLink } from './block.js';

const list = v => (Array.isArray(v) ? v : []);
const dimLine = html => `<div class="dim">${html}</div>`;
// a run whose lessons are not drawn as checked: its line by its state, and a run not checked by its why
const NOT_CHECKED = { old: () => th('lunhui.memory.old'), 'no pool': () => th('lunhui.memory.noPool'), unreadable: () => th('lunhui.memory.unreadable') };
const UNCHECKED = {
  'not connected': () => th('lunhui.memory.notConnected'),
  'not checked': lessons => (Object.hasOwn(NOT_CHECKED, lessons.why) ? NOT_CHECKED[lessons.why]() : ''),
};

// a leader's lines: its fault, its lessons, how many were left out, the lessons that could not be checked and how many more
function linesOf(leader) {
  const parts = [];
  if (typeof leader?.fault === 'string' && leader.fault !== '') parts.push(dimLine(th('lunhui.memory.fault', { words: visible(leader.fault) })));
  for (const l of list(leader?.lessons)) parts.push(lessonHtml(l));
  if (lessonCount(leader?.lessonsMore) > 0) parts.push(dimLine(thn('thread.memory.more', lessonCount(leader.lessonsMore))));
  for (const u of list(leader?.untold)) parts.push(dimLine(th('thread.memory.untold', { needs: list(u?.needs).map(visible).join(', ') })));
  if (lessonCount(leader?.untoldMore) > 0) parts.push(dimLine(thn('thread.memory.untoldMore', lessonCount(leader.untoldMore))));
  return parts.join('');
}

// a leader as the ladder names it: a stock link when the view's stocks hold its code, else its code
function leaderName(leader, view, key) {
  const code = String(leader?.code ?? '');
  const stocks = view?.stocks && typeof view.stocks === 'object' ? view.stocks : {};
  const name = Object.hasOwn(stocks, code) && typeof stocks[code]?.name === 'string' && stocks[code].name !== '' ? stocks[code].name : code;
  const link = Object.hasOwn(stocks, code) ? stockLink({ code, name }, key) : esc(visible(code));
  const boards = Number.isInteger(leader?.boards) && leader.boards > 0 ? ` · ${thn('lunhui.memory.boards', leader.boards)}` : '';
  return `<div class="lh-lessons-who">${link}${boards}</div>`;
}

/** The lessons block under a ladder, or '' with nothing to say. */
export function ladderLessonsHtml(view, lessons, key) {
  const state = typeof lessons?.state === 'string' ? lessons.state : '';
  if (Object.hasOwn(UNCHECKED, state)) {
    const line = UNCHECKED[state](lessons);
    return line ? `<div class="lh-lessons dim">${line}</div>` : '';
  }
  if (state !== 'checked') return '';
  const leaders = list(lessons.leaders).map(leader => [leader, linesOf(leader)]).filter(([, lines]) => lines !== '');
  if (!leaders.length) return '';
  return `<div class="lh-lessons">${label(t('lunhui.memory.title'))}${leaders.map(([leader, lines]) => leaderName(leader, view, key) + lines).join('')}</div>`;
}

/** A leader's lessons in its stock drawer, or '' when the stock is no leader or has nothing. */
export function stockLessonsHtml(lessons, code) {
  return linesOf(leaderLessons(lessons, code));
}
