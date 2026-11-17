// face/client/js/render/memory-lessons.js — the Memory screen's Lessons tab (memory screen plan Task 3), for a connected lessons
// read: a line at the top while the owner's chain is broken, with the command that reseals it; No lesson yet; else each card -
// its id, a chip of its state, when it was armed, its line (strength, what it says, its actions, its scope), its words in quotes,
// its fault; a changed card's armed copy beside its file now, the differing lines marked, behind See the change; an unarmed or
// a retired card's file; for a card that applies its counts and, behind Cases, each outcome side by horizon, the median once
// there is one, else each case; the facts it checks, each marked computed by the face or not; and the terminal's commands its
// state allows. Every text from the memory is made visible (visible.js) and then escaped, a text line by line; a key is drawn
// only for an id of the plain shape (reducers/memory-page.js isId).
import { esc, attrs, cls } from '../html.js';
import { t, th } from '../i18n/words.js';
import { visible } from '../visible.js';
import { fmtDate } from '../time.js';
import { isId } from '../reducers/memory-page.js';
import { textDiff, recordView, cardLine, SCREEN_TEXT_MAX } from '../host/memory-page-view.js';
import { lessonCount } from './lesson-line.js';

/** A text from the memory, made visible and escaped (the other tabs draw theirs with it too). */
export const shown = v => esc(visible(v));
/** One dim line of the face's words. */
export const dim = text => `<p class="mp-dim">${esc(text)}</p>`;
/** One command the face built, in a code. */
export const command = line => `<code class="mp-command">${shown(line)}</code>`;
/** The commands given, each a string not empty, under At the terminal; nothing when none is. */
export function terminalHtml(lines) {
  const list = (Array.isArray(lines) ? lines : []).filter(v => typeof v === 'string' && v !== '');
  return list.length ? `<div class="mp-commands"><div class="mp-dim">${esc(t('memory.lessons.terminal'))}</div>${list.map(command).join('')}</div>` : '';
}

// each state's words and its chip's colour; a state the face does not know is drawn as given, grey
const STATES = {
  armed: [() => t('memory.lessons.stateArmed'), 'ok'],
  changed: [() => t('memory.lessons.stateChanged'), 'warn'],
  broken: [() => t('memory.lessons.stateBroken'), 'down'],
  unarmed: [() => t('memory.lessons.stateUnarmed'), 'grey'],
  retired: [() => t('memory.lessons.stateRetired'), 'grey'],
  refused: [() => t('memory.lessons.stateRefused'), 'down'],
};

function chip(state) {
  const known = Object.hasOwn(STATES, state) ? STATES[state] : null;
  return `<span class="chip ${known ? known[1] : 'grey'}">${known ? esc(known[0]()) : shown(state)}</span>`;
}

// a key of the row: drawn only for an id of the plain shape
const key = (action, id, word) => (isId(id) ? `<button type="button" class="btn-sm"${attrs({ 'data-action': action, 'data-id': id })}>${esc(word)}</button>` : '');

const pct = v => `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;

/** A card's line of words: its strength, what it says, its actions and its scope, each made visible (the caller escapes it). */
export function lineOf(card) {
  const c = cardLine(card);
  const sep = t('common.list.sep');
  const params = { strength: visible(c.strength), says: visible(c.says), actions: visible(c.actions.join(sep)) };
  const scope = [...c.markets, ...c.symbols];
  return scope.length ? t('memory.lessons.lineScope', { ...params, scope: visible(scope.join(sep)) }) : t('memory.lessons.line', params);
}

// a text the face served, each line made visible, in a pre; the line that says the face cut it
function textHtml(copy) {
  if (!copy || typeof copy.text !== 'string') return '';
  const lines = copy.text.split('\n').map(l => shown(l)).join('\n');
  return `<pre class="mp-text">${lines}</pre>${copy.cut === true ? dim(t('memory.lessons.cut', { n: SCREEN_TEXT_MAX.toLocaleString('en-US') })) : ''}`;
}

function diffSide(head, lines) {
  return `<div class="mp-diff-side"><div class="mp-diff-head">${esc(head)}</div><pre class="mp-text">` +
    lines.map(l => `<span class="${cls('mp-ln', l.mark !== 'same' && l.mark)}">${shown(l.line)}</span>`).join('\n') + '</pre></div>';
}

function diffHtml(row) {
  const d = textDiff(row.armed?.text, row.file?.text);
  const cut = row.armed?.cut === true || row.file?.cut === true ? dim(t('memory.lessons.cut', { n: SCREEN_TEXT_MAX.toLocaleString('en-US') })) : '';
  return `<div class="mp-diff">${diffSide(t('memory.lessons.armedHead'), d.armed)}${diffSide(t('memory.lessons.nowHead'), d.file)}</div>${cut}`;
}

function sideHtml(record, side, head) {
  const view = recordView(record, side);
  if (!view.length) return '';
  const horizons = view.map(h => (h.median !== undefined
    ? `<p class="mp-median">${esc(t('memory.lessons.median', { pct: pct(h.median), k: h.k }))}</p>`
    : `<div class="mp-horizon"><div class="mp-dim">${esc(t('memory.lessons.over', { k: h.k }))}</div>` +
      h.cases.map(c => `<div class="mp-case"><span>${shown(c.date)}</span><span>${shown(c.symbol)}</span><span>${shown(c.action)}</span><span class="mp-change">${esc(pct(c.change))}</span></div>`).join('') +
      '</div>'));
  return `<div class="mp-side"><div class="mp-side-head">${esc(head)}</div>${horizons.join('')}</div>`;
}

function recordHtml(row, page) {
  const r = row.record;
  if (!r || typeof r !== 'object') return '';
  const o = r.owner ?? {};
  const counts = `${t('thread.memory.counts', { fired: lessonCount(o.fired), followed: lessonCount(o.followed), overridden: lessonCount(o.overridden) })}` +
    ` · ${t('memory.lessons.noDecision', { n: lessonCount(o.no_decision) })}`;
  const hasCases = recordView(r, 'followed').length > 0 || recordView(r, 'overridden').length > 0;
  const open = hasCases && page?.open?.[row.id] === true && isId(row.id);
  const cases = open ? `<div class="mp-cases">${sideHtml(r, 'followed', t('memory.lessons.followed'))}${sideHtml(r, 'overridden', t('memory.lessons.overridden'))}</div>` : '';
  const keyHtml = hasCases ? key('memoryPageToggle', row.id, open ? t('memory.lessons.hideCases') : t('memory.lessons.cases')) : '';
  return `<div class="mp-record"><span class="mp-counts">${esc(counts)}</span>${keyHtml}</div>${cases}`;
}

function checksHtml(checks) {
  const list = Array.isArray(checks) ? checks.filter(c => c && typeof c.fact === 'string') : [];
  if (!list.length) return '';
  const items = list.map(c => `<li class="mp-check"><code class="mp-fact">${shown(c.fact)}</code>` +
    `<span class="chip ${c.face === true ? 'ok' : 'grey'}">${esc(c.face === true ? t('memory.lessons.computed') : t('memory.lessons.notComputed'))}</span>` +
    (typeof c.definition === 'string' ? `<span class="mp-def">${shown(c.definition)}</span>` : '') + '</li>');
  return `<div class="mp-checks"><div class="mp-dim">${esc(t('memory.lessons.checks'))}</div><ul class="mp-check-list">${items.join('')}</ul></div>`;
}

const commandsHtml = commands => terminalHtml(['arm', 'retire', 'review'].map(k => commands?.[k]));

function lessonHtml(row, page) {
  const card = row.armed?.card ?? row.file?.card;
  const armedAt = typeof row.armedAt === 'string' ? Date.parse(row.armedAt) : NaN;
  const head = `<div class="mp-lesson-head"><span class="mp-id">${shown(row.id)}</span>${chip(row.state)}` +
    (Number.isNaN(armedAt) ? '' : `<span class="mp-when">${esc(t('memory.lessons.armedAt', { date: fmtDate(armedAt) }))}</span>`) + '</div>';
  const line = card ? `<div class="mp-line">${esc(lineOf(card))}</div><div class="mp-words">${th('thread.memory.quoted', { words: visible(card.words) })}</div>` : '';
  const faults = [row.fault, row.file?.fault].filter((f, i, all) => typeof f === 'string' && f !== '' && all.indexOf(f) === i);
  const fault = faults.map(f => `<p class="mp-fault">${shown(f)}</p>`).join('');
  let text = '';
  if (row.state === 'changed') {
    const open = page?.diff?.[row.id] === true && isId(row.id);
    text = `<div class="mp-record">${key('memoryPageDiff', row.id, open ? t('memory.lessons.hideChange') : t('memory.lessons.seeChange'))}</div>${open ? diffHtml(row) : ''}`;
  } else if (row.state === 'unarmed' || row.state === 'retired') {
    text = textHtml(row.file);
  }
  return `<article class="mp-lesson">${head}${line}${fault}${text}${recordHtml(row, page)}${checksHtml(row.checks)}${commandsHtml(row.commands)}</article>`;
}

/** The Lessons tab's body for a connected lessons read: `read` its body, `page` the screen's slice (its open rows and shown
 *  differences), `now` the clock's time, which a card's armed day does not need. */
export function lessonsHtml(read, page, now) {
  const rows = Array.isArray(read?.lessons) ? read.lessons.filter(r => r && typeof r === 'object') : [];
  const chain = read?.ownerChainBroken === true
    ? `<div class="mp-chain"><p class="mp-chain-say">${esc(t('memory.lessons.chainBroken'))}</p>${typeof read.reseal === 'string' && read.reseal !== '' ? command(read.reseal) : ''}</div>`
    : '';
  const body = rows.length ? rows.map(r => lessonHtml(r, page)).join('') : dim(t('memory.lessons.none'));
  return `<div class="mp-body mp-lessons">${chain}${body}</div>`;
}
