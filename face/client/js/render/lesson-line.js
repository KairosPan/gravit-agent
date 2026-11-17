// face/client/js/render/lesson-line.js — one of the owner's lessons as a line, shared by the order card (render/thread.js) and a
// Lunhui run's lessons (render/lunhui/lessons.js): the head (your lesson, or your red line when it is a red line that says
// dont), the lesson's words in quotes, made visible (visible.js) and then escaped, and how often it fired, was followed and
// was overridden.
import { esc, cls } from '../html.js';
import { t, th } from '../i18n/words.js';
import { visible } from '../visible.js';

/** A count drawn as one: a positive finite number, else 0. */
export const lessonCount = n => (Number.isFinite(n) && n > 0 ? n : 0);
/** A red line: a lesson of strength red-line that says dont. */
export const isRedLine = l => l?.strength === 'red-line' && l?.says === 'dont';

/** One lesson's line. */
export function lessonHtml(l) {
  const red = isRedLine(l);
  const counts = t('thread.memory.counts', { fired: lessonCount(l?.fired), followed: lessonCount(l?.followed), overridden: lessonCount(l?.overridden) });
  return `<div class="${cls('mg-lesson', red && 'red')}"><div class="mg-head">${red ? th('thread.memory.redLine') : th('thread.memory.lesson')}</div>` +
    `<div class="mg-words">${th('thread.memory.quoted', { words: visible(l?.words) })}</div><div class="dim">${esc(counts)}</div></div>`;
}
