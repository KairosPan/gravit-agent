// face/client/js/render/memory-lessons.js — the Memory screen's Lessons tab (memory screen plan Task 3), for a connected lessons
// read: a line at the top while the owner's chain is broken, with the command that reseals it; No lesson yet; else each card -
// its id, a chip of its state, when it was armed, its line (strength, what it says, its actions, its scope), its words in quotes
// (a broken card's under Now: they are its file's), its fault; a changed card's armed copy beside its file now, the differing
// lines marked, behind See the change; an unarmed or a retired card's file; for a card that applies its counts and, behind
// Cases, each outcome side by horizon, the median once there is one, else each case; each check as fact, operator and value,
// and each fact it defines alone, marked computed by the face or not, with the card's own definition and the face's beside it;
// and the terminal's commands its state allows, under At the terminal, in face/ - or, while this page signs for the Account,
// a key for each of the owner's acts its state allows (host/memory-acts.js) in place of that act's command. Every text from
// the memory is made visible
// (visible.js) and then escaped, a text line by line; a key is drawn only for an id of the plain shape (reducers/memory-page.js
// isId), and a row's flag is read as its own true alone.
import { esc, attrs, cls } from '../html.js';
import { t, th, tn } from '../i18n/words.js';
import { visible } from '../visible.js';
import { fmtDate } from '../time.js';
import { isId } from '../reducers/memory-page.js';
import { textDiff, recordView, cardLine, SCREEN_TEXT_MAX } from '../host/memory-page-view.js';
import { lessonCount } from './lesson-line.js';
import { lessonActs } from '../host/memory-acts.js';

/** A text from the memory, made visible and escaped (the other tabs draw theirs with it too). */
export const shown = v => esc(visible(v));
/** One dim line of the face's words. */
export const dim = text => `<p class="mp-dim">${esc(text)}</p>`;
/** One command the face built, in a code. */
export const command = line => `<code class="mp-command">${shown(line)}</code>`;
/** The commands given, each a string not empty, under At the terminal, in face/; nothing when none is. */
export function terminalHtml(lines) {
  const list = (Array.isArray(lines) ? lines : []).filter(v => typeof v === 'string' && v !== '');
  return list.length ? `<div class="mp-commands"><div class="mp-dim">${esc(t('memory.lessons.terminal'))}</div>${list.map(command).join('')}</div>` : '';
}

// each act's key, its words the face's own
const ACT_KEYS = {
  arm: () => t('memory.act.keyArm'),
  retire: () => t('memory.act.keyRetire'),
  discard: () => t('memory.act.keyDiscard'),
  accept: () => t('memory.act.keyAccept'),
  reject: () => t('memory.act.keyReject'),
  edit: () => t('memory.act.keyEdit'),
  void: () => t('memory.act.keyVoid'),
};
/** The keys of the owner's acts on `subject`, one per act of the face's own list, each opening its drawer; nothing for none or
 *  for a subject that is not a plain id. */
export function actKeysHtml(acts, subject) {
  const list = (Array.isArray(acts) ? acts : []).filter(a => Object.hasOwn(ACT_KEYS, a));
  if (!list.length || !isId(subject)) return '';
  return `<div class="mp-acts">${list.map(a => `<button type="button" class="btn-sm"${attrs({ 'data-action': 'memoryActOpen', 'data-act': a, 'data-subject': subject })}>${esc(ACT_KEYS[a]())}</button>`).join('')}</div>`;
}

/** A day as the screen writes it: its month and day, and its year when that is not the year of `now`, the clock's time. */
export function dayOf(ts, now) {
  const year = new Date(ts).getFullYear();
  return typeof now === 'number' && Number.isFinite(now) && new Date(now).getFullYear() !== year
    ? t('memory.page.dateYear', { date: fmtDate(ts), year }) : fmtDate(ts);
}

/** Whether the screen's map (its open rows, its shown differences) holds `id` as its own true. */
export const isOn = (map, id) => isId(id) && !!map && typeof map === 'object' && Object.hasOwn(map, id) && map[id] === true;

const scalar = v => (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : '');
/** A check as its fact, its operator and its value, a list of values joined (the caller makes it visible and escapes it). */
export function checkText(c) {
  const value = Array.isArray(c.value) ? c.value.map(scalar).join(t('common.list.sep')) : scalar(c.value);
  return `${typeof c.fact === 'string' ? c.fact : ''} ${typeof c.op === 'string' ? c.op : ''} ${value}`;
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
    ? `<p class="mp-median">${esc(tn('memory.lessons.median', h.k, { pct: pct(h.median) }))}</p>`
    : `<div class="mp-horizon"><div class="mp-dim">${esc(tn('memory.lessons.over', h.k))}</div>` +
      h.cases.map(c => `<div class="mp-case"><span>${shown(c.date)}</span><span>${shown(c.symbol)}</span><span>${shown(c.action)}</span><span class="mp-change">${esc(pct(c.change))}</span></div>`).join('') +
      '</div>'));
  return `<div class="mp-side"><div class="mp-side-head">${esc(head)}</div>${horizons.join('')}</div>`;
}

function recordHtml(row, page) {
  const r = row.record;
  if (!r || typeof r !== 'object') return '';
  const o = r.owner ?? {};
  // seen and backfilled only above zero, so the counts add up for a card fired with no decision recorded
  const above = v => Number.isInteger(v) && v > 0;
  const counts = [ // words-order: a card's counts under the visual separator
    t('thread.memory.counts', { fired: lessonCount(o.fired), followed: lessonCount(o.followed), overridden: lessonCount(o.overridden) }),
    ...(above(o.seen) ? [t('memory.lessons.seen', { n: o.seen })] : []),
    ...(above(o.backfilled) ? [t('memory.lessons.backfilled', { n: o.backfilled })] : []),
    t('memory.lessons.noDecision', { n: lessonCount(o.no_decision) }),
  ].join(' · ');
  const hasCases = recordView(r, 'followed').length > 0 || recordView(r, 'overridden').length > 0;
  const open = hasCases && isOn(page?.open, row.id);
  const cases = open ? `<div class="mp-cases">${sideHtml(r, 'followed', t('memory.lessons.followed'))}${sideHtml(r, 'overridden', t('memory.lessons.overridden'))}</div>` : '';
  const keyHtml = hasCases ? key('memoryPageToggle', row.id, open ? t('memory.lessons.hideCases') : t('memory.lessons.cases')) : '';
  return `<div class="mp-record"><span class="mp-counts">${esc(counts)}</span>${keyHtml}</div>${cases}`;
}

// one definition of a fact under whose it is - the card's own, or the face's
const definitionHtml = (who, words) => (typeof words === 'string' && words !== ''
  ? `<span class="mp-def"><span class="mp-def-who">${esc(who)}</span> ${shown(words)}</span>` : '');

// each check as fact, operator and value, each fact defined alone by its name; the computed mark; the card's definition and
// the face's beside it when the face computes the fact
function checksHtml(checks) {
  const list = Array.isArray(checks) ? checks.filter(c => c && typeof c.fact === 'string') : [];
  if (!list.length) return '';
  const items = list.map(c => `<li class="mp-check"><code class="mp-fact">${shown(typeof c.op === 'string' ? checkText(c) : c.fact)}</code>` +
    `<span class="chip ${c.face === true ? 'ok' : 'grey'}">${esc(c.face === true ? t('memory.lessons.computed') : t('memory.lessons.notComputed'))}</span>` +
    definitionHtml(t('memory.lessons.cardDefines'), c.own) + (c.face === true ? definitionHtml(t('memory.lessons.faceComputes'), c.definition) : '') + '</li>');
  return `<div class="mp-checks"><div class="mp-dim">${esc(t('memory.lessons.checks'))}</div><ul class="mp-check-list">${items.join('')}</ul></div>`;
}

// a card's acts: while the page signs, a key for each act its state allows and the commands of the others (a changed card's
// review is its Discard…); else the terminal's commands its state allows
function actsHtml(row, signs) {
  const keys = signs ? lessonActs(row) : [];
  const covers = { arm: 'arm', retire: 'retire', review: 'discard' };
  const commands = ['arm', 'retire', 'review'].filter(k => !keys.includes(covers[k])).map(k => row.commands?.[k]);
  return `${actKeysHtml(keys, row.id)}${terminalHtml(commands)}`;
}

function lessonHtml(row, page, now, signs) {
  const card = row.armed?.card ?? row.file?.card;
  const armedAt = typeof row.armedAt === 'string' ? Date.parse(row.armedAt) : NaN;
  const head = `<div class="mp-lesson-head"><span class="mp-id">${shown(row.id)}</span>${chip(row.state)}` +
    (Number.isNaN(armedAt) ? '' : `<span class="mp-when">${esc(t('memory.lessons.armedAt', { date: dayOf(armedAt, now) }))}</span>`) + '</div>';
  // a broken card's line and words are its file's, under the word the change uses for the file
  const fileHead = row.state === 'broken' && !row.armed?.card ? `<div class="mp-diff-head">${esc(t('memory.lessons.nowHead'))}</div>` : '';
  const words = card && typeof card.words === 'string' && card.words !== '' ? `<div class="mp-words">${th('thread.memory.quoted', { words: visible(card.words) })}</div>` : '';
  const line = card ? `${fileHead}<div class="mp-line">${esc(lineOf(card))}</div>${words}` : '';
  const faults = [row.fault, row.file?.fault].filter((f, i, all) => typeof f === 'string' && f !== '' && all.indexOf(f) === i);
  const fault = faults.map(f => `<p class="mp-fault">${shown(f)}</p>`).join('');
  let text = '';
  if (row.state === 'changed') {
    const open = isOn(page?.diff, row.id);
    text = `<div class="mp-record">${key('memoryPageDiff', row.id, open ? t('memory.lessons.hideChange') : t('memory.lessons.seeChange'))}</div>${open ? diffHtml(row) : ''}`;
  } else if (row.state === 'unarmed' || row.state === 'retired') {
    text = textHtml(row.file);
  }
  return `<article class="mp-lesson">${head}${line}${fault}${text}${recordHtml(row, page)}${checksHtml(row.checks)}${actsHtml(row, signs)}</article>`;
}

/** The Lessons tab's body for a connected lessons read: `read` its body, `page` the screen's slice (its open rows and shown
 *  differences), `now` the clock's time, against which a card's armed day carries its year when it is another; `signs`,
 *  whether this page signs for the Account: then each card carries the keys of the acts its state allows in place of their
 *  commands. */
export function lessonsHtml(read, page, now, signs = false) {
  const rows = Array.isArray(read?.lessons) ? read.lessons.filter(r => r && typeof r === 'object') : [];
  const chain = read?.ownerChainBroken === true
    ? `<div class="mp-chain"><p class="mp-chain-say">${esc(t('memory.lessons.chainBroken'))}</p>${terminalHtml([read.reseal])}</div>`
    : '';
  const body = rows.length ? rows.map(r => lessonHtml(r, page, now, signs)).join('') : dim(t('memory.lessons.none'));
  return `<div class="mp-body mp-lessons">${chain}${body}</div>`;
}
