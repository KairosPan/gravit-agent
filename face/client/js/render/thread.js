// face/client/js/render/thread.js — the conversation body on host-shaped messages (spec 2026-10-19 §6):
// bubbles, the three gate cards, receipts and refusals, Gravit's composed answers with their working notes folded,
// icon-only keys, centred dividers; no tool call is drawn.
import { esc, attrs, cls } from '../html.js';
import { setMarkdown, markdownHtml } from './markdown.js';
import { t, th, thn, wordsEpoch, sayOf } from '../i18n/words.js';
import { icon } from '../icons.js';
import { divider } from '../time.js';
import { levelOf, needsAnswer } from '../messages.js';
import { avatar } from './avatars.js';
import { senderName } from './rail.js';
import { composedHtml, composedId } from './lunhui/composed.js';
import { foldNotes, notesHtml } from './lunhui/notes.js';
import { viewOf } from '../host/lunhui.js';
import { sessionRefRuns } from '../composer/draft.js';
import { chipInner, fileCard } from '../composer/view.js';
import { metaText, sizeText, isImageSrc } from '../composer/files.js';
import { maskSpans, maskExcerpt } from '../mask.js';
import { railView } from '../host/turns-view.js';
import { reportViews, reportTaskFailure } from '../host/analog.js';
import { eventTablesHtml } from './event-table.js';
import { routineCardOf } from '../host/desk-page-view.js';
import { routineClosings } from '../host/kinds.js';
import { tagWords } from '../host/page-tag.js';
import { gateOf } from '../host/memory-gate.js';
import { visible } from '../visible.js';
import { lessonHtml, lessonCount, isRedLine } from './lesson-line.js';
import { lessonsFor } from '../host/memory-lunhui.js';

export const chip = (text, tone = 'grey') => `<span class="${cls('chip', tone)}">${esc(text)}</span>`;

export function key(type, label, data = {}) {
  const glyph = { yes: 'check', no: 'x' }[type];
  return `<button type="button"${attrs({ class: `key ${type}`, 'aria-label': label, ...data })}>${icon(glyph, 14, 2.4)}</button>`;
}

export const ticker = sym => `<a class="ticker" href="#/markets/${esc(sym)}">${esc(sym)}${icon('chevRight', 12, 2.4)}</a>`;

export const withTickers = text => esc(text).replace(/\{\{([A-Z]+)\}\}/g, (_, sym) => ticker(sym));

// Gravit's words carry markdown (render/markdown.js); only a message flagged `markdown` goes through it. setMarkdown and
// markdownHtml are re-exported for the callers that named them here.
export { setMarkdown, markdownHtml };
const prose = m => (m.data?.markdown ? markdownHtml(m.text ?? '') : esc(m.text ?? ''));

// a gate's end state, in the old client's words; a card still waiting shows nothing in that slot
const ENDED = {
  approved: () => [t('thread.gate.approved'), 'up'], rejected: () => [t('thread.gate.declined'), 'grey'], answered: () => [t('thread.gate.answered'), 'up'],
  closed: () => [t('thread.gate.closed'), 'grey'], elsewhere: () => [t('thread.gate.elsewhere'), 'grey'],
};
const stateChip = m => (m.answer ? chip(...(Object.hasOwn(ENDED, m.answer) ? ENDED[m.answer]() : [m.answer, 'grey'])) : '');

// ✗ then ✓, answering rejected / allowed-once — the approval vocabulary api.js sends (nothing else reaches the host)
function gateKeys(m, conv) {
  if (!needsAnswer(m)) return '';
  const d = { 'data-action': 'answer', 'data-conv': conv.id, 'data-msg': m.id };
  return `<div class="keys right">${key('no', t('thread.gate.decline'), { ...d, 'data-value': 'rejected' })}${key('yes', t('thread.gate.approve'), { ...d, 'data-value': 'allowed-once' })}</div>`;
}

// ---- the memory's lessons on a seat card (memory order card, Task 6), drawn only once the face kept a gate for its call id
// (host/memory-gate.js gateOf). Every string the face or the memory gave — the state's and a fault's words, an order's
// words, a lesson's words, what an untold lesson needs, what was registered — is made visible, then escaped
const plain = text => esc(visible(text));
const dimLine = html => `<div class="dim">${html}</div>`;
const count = lessonCount;
const linesOf = g => (Array.isArray(g.lines) ? g.lines : []);
const lessonsOf = line => (Array.isArray(line?.lessons) ? line.lessons : []);
// a red line holds the card when the face says so or any lesson drawn is one: a lesson of strength red-line that says dont
const redLined = g => g.redLine === true || linesOf(g).some(line => lessonsOf(line).some(isRedLine));
const applies = g => linesOf(g).some(line => lessonsOf(line).length > 0 || count(line?.lessonsMore) > 0);

function memoryLine(line, many) {
  const parts = [];
  if (many) parts.push(`<div class="mg-order">${plain(line?.order)}</div>`);
  if (line?.positionRead === false) parts.push(dimLine(th('thread.memory.noPosition')));
  if (typeof line?.fault === 'string' && line.fault !== '') parts.push(dimLine(plain(line.fault)));
  for (const l of lessonsOf(line)) parts.push(lessonHtml(l));
  if (count(line?.lessonsMore) > 0) parts.push(dimLine(thn('thread.memory.more', count(line.lessonsMore))));
  for (const u of Array.isArray(line?.untold) ? line.untold : []) {
    const needs = (Array.isArray(u?.needs) ? u.needs : []).map(visible).join(', ');
    parts.push(dimLine(th('thread.memory.untold', { needs })));
  }
  if (count(line?.untoldMore) > 0) parts.push(dimLine(thn('thread.memory.untoldMore', count(line.untoldMore))));
  if (typeof line?.registered === 'string' && line.registered !== '') parts.push(dimLine(plain(line.registered)));
  return parts.length ? `<div class="mg-line">${parts.join('')}</div>` : '';
}

function memoryHtml(g) {
  const lines = linesOf(g);
  const parts = [];
  if (g.state !== 'checked' && typeof g.words === 'string' && g.words !== '') parts.push(dimLine(plain(g.words)));
  for (const line of lines) parts.push(memoryLine(line, lines.length > 1));
  if (g.overridden === true) parts.push(dimLine(th('thread.memory.overridden')));
  const body = parts.join('');
  return body ? `<div class="mg">${body}</div>` : '';
}

// a waiting card's keys under a kept gate: on the rail, a lesson that applies sends the owner to the task's page (no one-click
// approve there); a red line takes the owner's reason in a form whose key overrides, then approves; else ✗ and ✓ as today
function memoryKeys(m, conv, g, rail) {
  if (!needsAnswer(m)) return '';
  const d = { 'data-action': 'answer', 'data-conv': conv.id, 'data-msg': m.id };
  const decline = key('no', t('thread.gate.decline'), { ...d, 'data-value': 'rejected' });
  if (rail && (applies(g) || redLined(g))) {
    return `<div class="keys right mg-open"><a href="#/task/${esc(encodeURIComponent(conv.id))}">${th('thread.memory.openTask')}</a>${decline}</div>`;
  }
  if (!redLined(g)) return gateKeys(m, conv);
  const field = (name, label, required) => `<label class="mg-field"><span class="dim">${esc(label)}</span>` +
    `<input class="input small" type="text"${attrs({ id: `mg-${m.id}-${name}`, 'data-field': name, 'aria-label': label, maxlength: '500', required })}></label>`;
  return `<div class="mg-override" data-gate="${esc(m.id)}"><div class="mg-ask">${th('thread.memory.overrideAsk')}</div>` +
    `${field('reason', t('thread.memory.reason'), true)}${field('wrongIf', t('thread.memory.wrongIf'), false)}` +
    `<div class="keys right">${decline}<button type="button" class="btn-primary small"${attrs({ 'data-action': 'overrideGate', 'data-conv': conv.id, 'data-msg': m.id, 'data-call': m.data?.callId })}>${th('thread.memory.override')}</button></div></div>`;
}

// every input is named and id'd by the gate and the question (q-<eventId>-<questionId>), so two pending cards asking
// the same question id are separate radio groups, the app reads the pressed card alone, and a re-render can find a
// pick or a typed answer again by its id; the free answer is dsh's `custom`, open beside a menu too
function question(m, conv) {
  const qs = Array.isArray(m.data?.questions) ? m.data.questions : [];
  // a question answered or closed takes nothing more: its inputs are drawn disabled
  const off = needsAnswer(m) ? '' : ' disabled';
  const blocks = qs.map((q, i) => {
    const name = `q-${m.id}-${q?.id ?? i}`;
    const options = Array.isArray(q?.options) ? q.options : [];
    const type = q?.multiSelect === true ? 'checkbox' : 'radio';
    const inputs = options.map((o, n) => `<label class="opt"><input type="${type}" id="${esc(`${name}-${n}`)}" name="${esc(name)}" value="${esc(o?.label ?? '')}"${off}><span>${esc(o?.label ?? '')}</span>${o?.description ? `<span class="dim">${esc(o.description)}</span>` : ''}</label>`).join('');
    const hint = options.length ? th('thread.question.other') : th('thread.question.yours');
    const custom = `<input class="input small" type="text" id="${esc(`${name}-custom`)}" name="${esc(`${name}-custom`)}" placeholder="${hint}" aria-label="${hint}"${off}>`;
    return `<div class="q" data-q="${esc(String(q?.id ?? i))}">${q?.header ? `<div class="card-title">${esc(q.header)}</div>` : ''}<div>${esc(q?.question ?? '')}</div>${q?.detail ? `<div class="dim">${esc(q.detail)}</div>` : ''}${inputs}${custom}</div>`;
  }).join('');
  const keys = needsAnswer(m) ? `<div class="keys right"><button type="button" class="btn-primary small" data-action="answerQuestion" data-conv="${esc(conv.id)}" data-msg="${esc(m.id)}">${th('thread.question.answer')}</button></div>` : '';
  return `<div class="card orange question" data-gate="${esc(m.id)}">${blocks}${stateChip(m)}${keys}</div>`;
}

// the routine card (desk-page plan 3 Task 3, spec 2026-11-14 §6.5): what the call proposed, its chip from the routines read,
// ✗ and ✓ while pending, else the settled line; every string as the call or the read gave it, escaped
function routineChip(c) {
  switch (c) {
    case 'new': return chip(t('thread.routine.new'));
    case 'change': return chip(t('thread.routine.change'));
    case 'added': return chip(t('thread.routine.added'), 'up');
    case 'dismissed': return chip(t('thread.routine.dismissed'));
    case 'replaced': return chip(t('thread.routine.replaced'));
    case 'expired': return chip(t('thread.routine.expired'));
    case null: return '';   // no routines read yet: nothing to say
    default: return chip(t('thread.routine.closed'));
  }
}
function routineLine(line) {
  switch (line?.kind) {
    case 'replaces': return t('thread.routine.replaces', { name: line.name });
    case 'limit': return t('thread.routine.limit');
    case 'failed': return t('desk.requestFailed');
    case 'notAdded': return t('thread.routine.notAdded');
    case 'first': return t('thread.routine.firstRun', { day: line.day, time: line.time });
    case 'next': return t('thread.routine.nextRun', { day: line.day, time: line.time });
    default: return '';
  }
}
function routineCard(m, state) {
  const routines = state?.deskPage?.routines;
  const id = m.data?.proposal;
  const c = routineCardOf(m, routines?.data, { refused: state?.deskPage?.pSaid?.[id] ?? null, busy: state?.deskPage?.pBusy?.[id] === true, now: routines?.at ?? undefined });
  const line = routineLine(c.line);
  const keyOf = (type, label, action) => key(type, label, { title: label, 'data-action': action, 'data-proposal': c.proposal });
  const ask = c.keys ? `<div class="rt-ask"><span class="rt-q">${th('thread.routine.ask')}</span><div class="keys right">${keyOf('no', t('thread.routine.dismiss'), 'routineNo')}${keyOf('yes', t('thread.routine.add'), 'routineYes')}</div></div>` : '';
  // pending: a waiting change's line above the keys, a refused answer's under them; settled: its line, and View on Desk once added
  const above = c.keys && c.line?.kind === 'replaces' ? `<div class="dim">${esc(line)}</div>` : '';
  const under = c.keys && c.line && c.line.kind !== 'replaces' ? `<div class="rt-said">${esc(line)}</div>` : '';
  const settled = c.keys ? ''
    : c.desk ? `<div class="rt-done">${line ? `<span class="dim">${esc(line)}</span>` : ''}<a href="#/desk">${th('thread.routine.viewOnDesk')}</a></div>`
      : line ? `<div class="dim">${esc(line)}</div>` : '';
  return `<div class="card orange"><div class="card-head"><div class="card-title">${esc(c.name)}</div>${routineChip(c.chip)}</div>` +
    `<div class="rt-when">${icon('clock', 14, 2)}<span>${esc(c.when)}</span></div><p class="rt-text">${esc(c.instruction)}</p>` +
    `${c.note ? `<div class="dim">${esc(c.note)}</div>` : ''}${above}${ask}${under}${settled}</div>`;
}

// a block that needs Messages' width, in the box's compact thread (box spec §6.5): its name and a link to Messages
const stub = name => `<div class="gbox-stub"><span>${esc(name)}</span><a href="#/messages">${th('gbox.open')} ›</a></div>`;

// `rail`: a gate drawn on the rail of tasks (gateHtml); `compact`: the box's compact thread (renderMessage's page) — two
// options, not the page itself, whose own `rail` on Messages is the turn rail's state
function body(m, conv, state, { rail = false, compact = false } = {}) {
  const d = m.data ?? {};
  switch (m.kind) {
    // Gravit's composed answer, drawn from its run's view as the lunhui slice holds it; in the box, one line to Messages
    case 'composed': {
      if (compact) return stub(t('gbox.stub.composed'));
      // (a history page reads its answers and sends nothing: their follow-ups are not drawn); the owner's lessons on the run's
      // leaders, once the face answered them (host/memory-lunhui.js)
      const entry = state?.lunhui?.views?.[viewOf(m).key];
      return composedHtml(m, entry, state?.lunhui?.ui?.[composedId(m, conv)], conv, state?.channels, { asks: state?.route?.screen !== 'history', lessons: lessonsFor(state, entry?.view) });
    }
    case 'card': {
      // no gate kept for its call: the card as it has always been drawn
      const g = gateOf(state, m);
      return `<div class="card orange"><div class="card-head"><div class="card-title">${esc(d.title ?? m.text)}</div>${stateChip(m)}</div>` +
        `<div class="dim">${esc([d.venue, d.line].filter(Boolean).join(' · '))}</div>${g ? memoryHtml(g) + memoryKeys(m, conv, g, rail) : gateKeys(m, conv)}</div>`;
    }
    case 'approval': {
      const shown = d.displayReason ?? d.reason ?? m.text ?? '';
      const audit = d.reason && d.displayReason && d.reason !== d.displayReason ? `<div class="dim">${esc(d.reason)}</div>` : '';
      return `<div class="card orange"><div class="card-head"><div class="card-title">${esc(d.toolName ?? t('thread.gate.approval'))}</div>${stateChip(m)}</div><div>${esc(shown)}</div>${audit}${gateKeys(m, conv)}</div>`;
    }
    case 'question':
      return question(m, conv);
    case 'receipt':
      return `<div class="bubble green"><div class="line">${chip(d.status ?? t('thread.receipt.accepted'), 'up')}<span>${esc(m.text)}</span></div></div>`;
    case 'routine':
      return routineCard(m, state);
    case 'refusal':
      return `<div class="card red">${d.code ? chip(`✗ ${d.code}`, 'down') : ''}<div>${esc(m.text)}</div></div>`;
    default:
      return `<div class="bubble ${levelOf(m)}">${prose(m)}${d.interrupted ? `<div class="cut">${th('thread.interrupted')}</div>` : ''}</div>`;
  }
}

// one of the three gates (an order card, an approval, a question) as the thread draws it, for a line of the rail of tasks:
// keyed by the worker's record and the message id, so the answer and answerQuestion actions take it unchanged; on the rail
// (`rail`) a card a lesson applies to is answered on its task's page, not with one click
const GATE_KINDS = new Set(['card', 'approval', 'question']);
export const gateHtml = (conv, m, state, { rail = false } = {}) => (GATE_KINDS.has(m?.kind) ? body(m, conv, state, { rail }) : '');

// a room member's answer can open the turn that produced it: read on opening (host/traces.js), its context lines and
// words drawn, its tool calls not; the slice and the disclosure's id name the conversation, since two rooms repeat
// message ids
function trace(m, conv, state) {
  if (typeof m.data?.memberSessionId !== 'string' || typeof m.data?.memberTurn !== 'number') return '';
  const tr = state?.traces?.[conv.id]?.[m.id];
  const item = x => (x.from === 'system' ? `<div class="sysline">${esc(x.text)}</div>` : `<div class="dsec-line">${esc(x.text)}</div>`);
  const steps = tr?.status === 'ready' ? tr.messages.filter(x => x.kind !== 'tool') : [];
  const inner = !tr || tr.status === 'loading' ? `<div class="dim">${th('common.loading')}</div>`
    : tr.status === 'failed' ? `<div class="dim">${esc(sayOf(tr.line))}</div>`
      : steps.length ? steps.map(item).join('') : `<div class="dim">${th('thread.trace.noSteps')}</div>`;
  return `<details id="trace-${esc(conv.id)}-${esc(m.id)}" class="trace"><summary data-action="openTrace" data-conv="${esc(conv.id)}" data-msg="${esc(m.id)}">${th('thread.trace.title')}</summary>` +
    `<div class="trace-body">${inner}</div></details>`;
}

// a key in the operator's words (spec §5.9, D25): its original in the raw run, under its mask until the eye reveals it;
// the eye names the message's nth secret, and a reveal is `<convId>|<msgId>|<n>` in the page's set (app.js)
function secret(run, id, shown) {
  // until revealed a screen reader hears neither the original nor the asterisks, only that a secret is hidden (the label,
  // not a text node, which a copy would take)
  const mask = shown ? '' : `<span class="secret-mask" role="img" aria-label="${th('thread.secret.hidden')}">${esc(run.masked)}</span>`;
  return `<span${attrs({ class: cls('secret', shown && 'revealed'), 'data-secret': id })}><span${attrs({ class: 'secret-raw', 'aria-hidden': shown ? null : 'true' })}>${esc(run.text)}</span>${mask}</span>` +
    `<button${attrs({ type: 'button', class: 'secret-eye', id: `secret-${id}`, 'data-action': 'toggleSecret', 'data-secret': id, 'aria-label': shown ? t('thread.secret.hide') : t('thread.secret.show') })}>${icon(shown ? 'eyeOff' : 'eye', 14)}</button>`;
}

// the operator's words: a conversation mention is a chip (D17); a file or bot reference stays the text that was sent; a
// key is masked (display only: what was sent and what a copy takes stay the original)
function youText(text, m, conv, page) {
  if (!text) return '';
  let n = 0;
  return sessionRefRuns(text).map(r => {
    if (r.type === 'ref') return `<span class="ref-chip">${chipInner(icon('chat', 13), maskExcerpt(r.label))}</span>`;
    return maskSpans(r.text).map(s => {
      if (s.type !== 'secret') return esc(s.text);
      const i = n++;
      return secret(s, `${m.id}-${i}`, page.revealed?.has(`${conv.id}|${m.id}|${i}`) === true);
    }).join('');
  }).join('');
}

// an image the host cannot give back (no thumb, or offloaded by compaction) is a card: its name or Image, its type and size
const imageMeta = a => {
  const type = typeof a.mediaType === 'string' && a.mediaType.includes('/') ? a.mediaType.split('/')[1].toUpperCase() : t('thread.imageType');
  return typeof a.bytes === 'number' ? t('thread.imageMeta', { type, size: sizeText(a.bytes) }) : type;
};
const isImage = a => a?.type === 'image';

// the operator's attachments, right-aligned above the bubble: a lone image up to 240 px wide, with others 64 px squares;
// an image not loaded yet an empty frame, one whose thumb is not an image's URL (isImageSrc) a card; a file its card, which opens nothing (the host gives no file back)
function youFiles(list, thumbs) {
  const lone = list.length === 1;
  return `<div class="you-files">${list.map(a => {
    if (!isImage(a)) return fileCard({ name: a.name ?? t('thread.file'), meta: metaText({ name: a.name, bytes: a.bytes ?? 0 }) });
    const src = Object.hasOwn(thumbs, a.attachmentId) ? thumbs[a.attachmentId] : undefined;
    if (src === null || a.offloaded === true || (src !== undefined && !isImageSrc(src))) return fileCard({ name: a.name || t('thread.image'), meta: imageMeta(a) });
    const name = a.name || t('thread.image');
    const inner = src === undefined ? '' : `<img${attrs({ src, alt: name })}>`;
    return `<button${attrs({ type: 'button', class: cls(lone ? 'you-image' : 'you-thumb', src === undefined && 'loading'), 'data-action': 'openImage', 'data-attachment': a.attachmentId, 'data-name': name, 'aria-label': name })}>${inner}</button>`;
  }).join('')}</div>`;
}

// a text from the operator's phone (host/kinds.js phoneMessage) is the operator's bubble under a Phone chip naming its network
export const NETWORKS = { telegram: 'Telegram', slack: 'Slack', imessage: 'iMessage' }; // en-kept: the networks' own names
const phoneChip = network => chip(Object.hasOwn(NETWORKS, network) ? t('thread.phone.on', { network: NETWORKS[network] }) : t('thread.phone'));

// a message sent from the Gravit box (host/kinds.js onScreen) is the operator's bubble under Asked from <the page in words>
const askedFrom = onScreen => `<span class="you-from">${icon('screen', 13)}${th('gbox.asked', { where: tagWords(onScreen) })}</span>`; // words-order: an icon before one key's words

function youMessage(m, conv, state, page) {
  const list = Array.isArray(m.data?.attachments) ? m.data.attachments : [];
  const tag = m.data?.source === 'telegram' ? phoneChip(m.data.network) : m.data?.onScreen ? askedFrom(m.data.onScreen) : '';
  if (!list.length && !tag) return `<div class="msg you"><div class="bubble you">${youText(m.text, m, conv, page)}</div>${avatar('you', 28)}</div>`;
  const bubble = m.text ? `<div class="bubble you">${youText(m.text, m, conv, page)}</div>` : '';
  const files = list.length ? youFiles(list, state?.thumbs ?? {}) : '';
  return `<div class="msg you"><div class="you-body">${tag}${files}${bubble}</div>${avatar('you', 28)}</div>`;
}

// a desk line (host/kinds.js deskMessage): a firing of the face's clock, an alert of its watch or a routine's report, noted into the conversation.
// A firing's body is the whole brief or report the phone got, so the line folds as a task's report does: its Scheduled,
// Watch or Routine chip and its first line (masked, then clipped at DESK_SUMMARY_MAX) as the summary, the body under it (open across a render by its
// id); a line with no body is the chip alone. Masked as a worker's words are: an agent wrote it, and it may hold a pasted key
const DESK_CHIP = { schedule: () => t('thread.desk.schedule'), alert: () => t('thread.desk.alert'), routine: () => t('thread.desk.routine') };
export const DESK_SUMMARY_MAX = 120;
function deskLine(m, conv) {
  const line = m.data?.line;
  const label = chip(Object.hasOwn(DESK_CHIP, line) ? DESK_CHIP[line]() : String(line ?? ''));
  const body = m.text ?? '';
  if (body.trim() === '') return `<div class="sysline desk-line">${label}</div>`;
  // masked whole, then clipped: a key the cut falls inside is hidden before any piece of it is kept
  const first = maskExcerpt(body.split('\n').find(l => l.trim() !== '') ?? '');
  const clipped = first.length > DESK_SUMMARY_MAX ? `${first.slice(0, DESK_SUMMARY_MAX - 1)}…` : first;
  return `<details class="sysline ctx desk-line" id="desk-${esc(conv.id)}-${esc(m.id)}"><summary>${label} <span class="desk-text">${esc(clipped)}</span></summary><pre>${esc(maskExcerpt(body))}</pre></details>`;
}

/** The conversation's operator images still to read from the host: not offloaded, with no entry in `thumbs` yet, each once. */
export function thumbsNeeded(conv, thumbs) {
  const out = [];
  const seen = new Set();
  for (const m of conv.messages ?? []) {
    if (m.from !== 'you' || !Array.isArray(m.data?.attachments)) continue;
    for (const a of m.data.attachments) {
      if (!isImage(a) || a.offloaded === true || (thumbs && Object.hasOwn(thumbs, a.attachmentId)) || seen.has(a.attachmentId)) continue;
      seen.add(a.attachmentId);
      out.push({ sessionId: conv.id, attachmentId: a.attachmentId });
    }
  }
  return out;
}

// a task's message (host/kinds.js): a report relayed into the conversation is one centred line linking its task's page, its
// body folded under it (open across a render by its id); a worker's brief and a steer Gravit relayed are Gravit's bubbles
// under their labels; a recovery note and a stop are centred lines in the face's words. A report's title is its head's, else
// the task's own, else Task; its status in the table's words, one it does not name as it came. Masked as every worker's words
const REPORT_STATUS = {
  ready: () => t('thread.task.ready'), waiting: () => t('tasks.group.you'), blocked: () => t('tasks.status.blocked'),
  failed: () => t('tasks.status.failed'), stalled: () => t('tasks.status.stalled'),
};
function taskMessage(m, conv, state, page = {}) {
  const d = m.data ?? {};
  if (d.form === 'report') {
    const known = typeof d.task === 'string' ? (state?.tasks?.items ?? []).find(task => task.id === d.task)?.title : null;
    const title = maskExcerpt(d.title || known || t('thread.task.untitled'));
    const status = typeof d.status === 'string' && Object.hasOwn(REPORT_STATUS, d.status) ? REPORT_STATUS[d.status]() : String(d.status ?? '');
    const line = esc(t('thread.task.line', { title, status }));
    const head = typeof d.task === 'string' ? `<a class="task-link" href="#/task/${esc(encodeURIComponent(d.task))}">${line}</a>` : line;
    // the event tables the report carries, under its line (analog event table §4.1), folded: each group closed, opened by a
    // click and kept open across renders by its id (the operator's choice, 2026-11-12: folded by default); none draws nothing
    // a task read that failed leaves them undrawable: its words, in one line
    // in the box's compact thread, any table (or the line saying why it cannot be drawn) is one line to Messages
    const failed = reportTaskFailure(m, state);
    const views = reportViews(m, typeof d.task === 'string' ? state?.analog?.tasks?.[d.task]?.task?.eventViews ?? null : null);
    const tables = page.compact ? (failed || views.length ? stub(t('gbox.stub.events')) : '')
      : failed ? `<div class="et-list"><div class="et-state et-failed">${esc(sayOf(failed.error))}</div></div>`
      : eventTablesHtml(state, views, { fold: m.id });
    return `<details class="sysline ctx" id="relay-${esc(conv.id)}-${esc(m.id)}"><summary>${head}</summary><pre>${esc(maskExcerpt(d.body ?? ''))}</pre></details>${tables}`;
  }
  if (d.form === 'recovery') return `<div class="sysline">${th('thread.task.recovery')}</div>`;
  if (d.form === 'stopped') return `<div class="sysline">${th('tasks.status.stopped')}</div>`;
  const label = d.form === 'brief' ? th('thread.task.brief') : th('thread.task.steer');
  return `<div class="msg left"><div class="sender-name">${label}</div><div class="msg-row">${avatar('gravit', 28)}<div class="msg-body"><div class="bubble grey">${markdownHtml(maskExcerpt(m.text ?? ''))}</div></div></div></div>`;
}

export function renderMessage(m, conv, state, page = {}) {
  // a tool call is drawn nowhere (the operator's word, 2026-10-28): its gate, receipt or refusal is a message of its own
  if (m.kind === 'tool') return '';
  if (m.kind === 'task') return taskMessage(m, conv, state, page);
  if (m.kind === 'desk') return deskLine(m, conv);
  // a producer-sourced user record (a runtime snapshot, a plugin notice, a member's delta) is context, folded away under its source;
  // a line the page itself writes (a round end, a child's report) stays a centred line
  if (m.from === 'system') {
    const source = typeof m.data?.source === 'string' && m.data.source !== '' ? m.data.source : null;
    return source
      ? `<details class="sysline ctx"><summary>${th('thread.context', { source })}</summary><pre>${esc(m.text)}</pre></details>`
      : `<div class="sysline">${esc(m.text)}</div>`;
  }
  if (m.from === 'you') return youMessage(m, conv, state, page);
  const name = conv.kind === 'group' && m.from !== 'gravit' ? `<div class="sender-name">${esc(m.data?.name ?? senderName(m.from, state))}</div>` : '';
  // plain talk keeps a bubble's width; every card and green bubble runs wider (spec §16), a composed answer wider still
  const width = m.kind === 'composed' && !page.compact ? 'composed' : m.kind !== 'text' && 'wide';
  return `<div class="msg left">${name}<div class="msg-row">${avatar(m.from, 28, state)}<div class="${cls('msg-body', width)}">${body(m, conv, state, { compact: Boolean(page.compact) })}${trace(m, conv, state)}</div></div></div>`;
}

// the three-dot row while the host streams a turn
const thinkingRow = conv => `<div class="msg left"><div class="msg-row">${avatar(conv.kind === 'bot' ? conv.preset : 'gravit', 28)}<div class="msg-body"><div class="bubble grey thinking" role="status" aria-label="${th('thread.thinking')}"><span></span><span></span><span></span></div></div></div></div>`;

// a turn's mark in the thread: no height, the thread's gap cancelled; the rail reads its offsetTop and jumps to it (app.js).
// Its id (tmark-) is apart from the ticks' (turn-tick-)
const turnMark = (conv, tick) => `<div class="turn-mark"${attrs({ id: `tmark-${conv.id}-${tick.turn}`, 'data-turn': tick.turn })}></div>`;

// railView once per change of its inputs, for the thread's marks and the rail alike (renders run 10–20 a second)
let viewMemo = null;
function railOf(conv) {
  const w = conv?.window;
  const key = [conv?.id, conv?.outline, conv?.loaded, w?.start, w?.hasMore];
  if (!viewMemo || !viewMemo.key.every((v, i) => Object.is(v, key[i]))) viewMemo = { key, view: railView(conv) };
  return viewMemo.view;
}

// a tool call leaves nothing in the thread, not even the time it held: a divider reads the gap between the rows drawn;
// the words a composed answer folds are drawn inside its Working notes, just above it, and nowhere else; the closing words of
// a turn that ends on a routine card are not drawn (host/kinds.js routineClosings: the reply is the card alone). Before the first
// message drawn past a turn's start, that turn's mark: a loaded turn's, or one whose turn/start lies before the window
// while this message is of its turn (a page cuts at a message group, not at turn/start); the loaded turns left at the end
export function renderThread(conv, state, now, page = {}) {
  let prev = null;
  const out = [];
  const notes = foldNotes(conv.messages);
  const folded = new Set([...[...notes.values()].flat(), ...routineClosings(conv.messages)]);
  const byId = new Map(conv.messages.map(m => [m.id, m]));
  const ticks = Array.isArray(conv.outline) ? railOf(conv).ticks : [];
  let next = 0;
  const marksBefore = seq => {
    for (; next < ticks.length && ticks[next].seq < seq; next++) {
      const tick = ticks[next];
      if (tick.loaded || seq < (ticks[next + 1]?.seq ?? Infinity)) out.push(turnMark(conv, tick));
    }
  };
  // the scroll keep's anchor (app.js render): the first message drawn at or past page.anchor carries data-anchor (its
  // folded notes first, when it has them: they are drawn above it) — an attribute of its own, never in place of an id
  let anchor = typeof page.anchor === 'number' ? page.anchor : null;
  const anchored = html => {
    if (anchor === null) return html;
    anchor = null;
    return html.replace(/^<(div|details)/, '<$1 data-anchor');
  };
  for (const m of conv.messages) {
    if (m.kind === 'tool' || folded.has(m.id)) continue;
    if (typeof m.seq === 'number') marksBefore(m.seq);
    const d = divider(m.at, prev, now);
    if (d) out.push(`<div class="divider">${esc(d)}</div>`);
    const at = anchor !== null && typeof m.seq === 'number' && m.seq >= anchor;
    const ids = m.kind === 'composed' ? notes.get(m.id) ?? [] : [];
    const keep = at ? anchored : html => html;
    if (ids.length) out.push(keep(notesHtml(conv, m, ids.length, ids.map(id => renderMessage(byId.get(id), conv, state, page)).join(''))));
    out.push(keep(renderMessage(m, conv, state, page)));
    prev = m.at;
  }
  for (; next < ticks.length; next++) if (ticks[next].loaded) out.push(turnMark(conv, ticks[next]));
  if (conv.thinking) out.push(thinkingRow(conv));
  return out.join('');
}

// the turn rail (D22), the inside of #turn-rail: a tick per turn, the hovered one's card beside it (its prompt and reply
// masked whoever spoke, as every excerpt is) and describing its tick; '' when the rail does not show. The rail is one Tab
// stop (a toolbar): the focused tick's, else the active turn's, else the last; the arrows walk the rest (app.js). Memoized
// on its inputs, not on railView's output (new objects every call): the page renders 10–20 times a second while a turn
// streams
let railMemo = null;
export function railHtml(conv, { active = null, hover = null, pulse = null, focus = null } = {}) {
  const w = conv?.window;
  const key = [conv?.id, conv?.outline, conv?.loaded, w?.start, w?.hasMore, active, hover, pulse, focus, wordsEpoch()];
  if (railMemo && railMemo.key.every((v, i) => Object.is(v, key[i]))) return railMemo.html;
  const { show, ticks } = railOf(conv);
  const stop = [focus, active].find(n => n !== null && ticks.some(tk => tk.turn === n)) ?? ticks.at(-1)?.turn;
  const html = !show ? '' : ticks.map(tk => {
    const carded = tk.turn === hover;
    const tick = `<button${attrs({ type: 'button', class: cls('turn-tick', tk.loaded && 'loaded', tk.turn === active && 'active', tk.turn === pulse && 'pulse'), id: `turn-tick-${tk.turn}`, 'data-action': 'jumpTurn', 'data-turn': tk.turn, 'aria-label': t('thread.turn', { n: tk.turn }), tabindex: tk.turn === stop ? '0' : '-1', 'aria-describedby': carded && `turn-card-${tk.turn}`, 'aria-busy': tk.turn === pulse && 'true' })}></button>`;
    const card = !carded ? '' : `<div class="turn-card" id="turn-card-${tk.turn}" role="tooltip"><div class="turn-card-head">${esc(t('thread.turnJump', { n: tk.turn }))}</div>` +
      `<div class="turn-card-prompt">${esc(maskExcerpt(tk.prompt))}</div>${tk.response ? `<div class="turn-card-reply">${esc(maskExcerpt(tk.response))}</div>` : ''}</div>`;
    return `<div class="turn-row">${tick}${card}</div>`;
  }).join('');
  railMemo = { key, html };
  return html;
}
