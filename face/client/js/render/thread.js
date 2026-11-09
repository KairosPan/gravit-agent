// face/client/js/render/thread.js — the conversation body on host-shaped messages (spec 2026-10-19 §6):
// bubbles, the three gate cards, receipts and refusals, Gravit's composed answers with their working notes folded,
// icon-only keys, centred dividers; no tool call is drawn.
import { esc, attrs, cls } from '../html.js';
import { setMarkdown, markdownHtml } from './markdown.js';
import { t, th, wordsEpoch, sayOf } from '../i18n/words.js';
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

// every input is named and id'd by the gate and the question (q-<eventId>-<questionId>), so two pending cards asking
// the same question id are separate radio groups, the app reads the pressed card alone, and a re-render can find a
// pick or a typed answer again by its id; the free answer is dsh's `custom`, open beside a menu too
function question(m, conv) {
  const qs = Array.isArray(m.data?.questions) ? m.data.questions : [];
  const blocks = qs.map((q, i) => {
    const name = `q-${m.id}-${q?.id ?? i}`;
    const options = Array.isArray(q?.options) ? q.options : [];
    const type = q?.multiSelect === true ? 'checkbox' : 'radio';
    const inputs = options.map((o, n) => `<label class="opt"><input type="${type}" id="${esc(`${name}-${n}`)}" name="${esc(name)}" value="${esc(o?.label ?? '')}"><span>${esc(o?.label ?? '')}</span>${o?.description ? `<span class="dim">${esc(o.description)}</span>` : ''}</label>`).join('');
    const hint = options.length ? th('thread.question.other') : th('thread.question.yours');
    const custom = `<input class="input small" type="text" id="${esc(`${name}-custom`)}" name="${esc(`${name}-custom`)}" placeholder="${hint}" aria-label="${hint}">`;
    return `<div class="q" data-q="${esc(String(q?.id ?? i))}">${q?.header ? `<div class="card-title">${esc(q.header)}</div>` : ''}<div>${esc(q?.question ?? '')}</div>${q?.detail ? `<div class="dim">${esc(q.detail)}</div>` : ''}${inputs}${custom}</div>`;
  }).join('');
  const keys = needsAnswer(m) ? `<div class="keys right"><button type="button" class="btn-primary small" data-action="answerQuestion" data-conv="${esc(conv.id)}" data-msg="${esc(m.id)}">${th('thread.question.answer')}</button></div>` : '';
  return `<div class="card orange question" data-gate="${esc(m.id)}">${blocks}${stateChip(m)}${keys}</div>`;
}

function body(m, conv, state) {
  const d = m.data ?? {};
  switch (m.kind) {
    // Gravit's composed answer, drawn from its run's view as the lunhui slice holds it
    case 'composed':
      return composedHtml(m, state?.lunhui?.views?.[viewOf(m).key], state?.lunhui?.ui?.[composedId(m, conv)], conv, state?.channels);
    case 'card':
      return `<div class="card orange"><div class="card-head"><div class="card-title">${esc(d.title ?? m.text)}</div>${stateChip(m)}</div>` +
        `<div class="dim">${esc([d.venue, d.line].filter(Boolean).join(' · '))}</div>${gateKeys(m, conv)}</div>`;
    case 'approval': {
      const shown = d.displayReason ?? d.reason ?? m.text ?? '';
      const audit = d.reason && d.displayReason && d.reason !== d.displayReason ? `<div class="dim">${esc(d.reason)}</div>` : '';
      return `<div class="card orange"><div class="card-head"><div class="card-title">${esc(d.toolName ?? t('thread.gate.approval'))}</div>${stateChip(m)}</div><div>${esc(shown)}</div>${audit}${gateKeys(m, conv)}</div>`;
    }
    case 'question':
      return question(m, conv);
    case 'receipt':
      return `<div class="bubble green"><div class="line">${chip(d.status ?? t('thread.receipt.accepted'), 'up')}<span>${esc(m.text)}</span></div></div>`;
    case 'refusal':
      return `<div class="card red">${d.code ? chip(`✗ ${d.code}`, 'down') : ''}<div>${esc(m.text)}</div></div>`;
    default:
      return `<div class="bubble ${levelOf(m)}">${prose(m)}${d.interrupted ? `<div class="cut">${th('thread.interrupted')}</div>` : ''}</div>`;
  }
}

// one of the three gates (an order card, an approval, a question) as the thread draws it, for a line of the rail of tasks:
// keyed by the worker's record and the message id, so the answer and answerQuestion actions take it unchanged
const GATE_KINDS = new Set(['card', 'approval', 'question']);
export const gateHtml = (conv, m, state) => (GATE_KINDS.has(m?.kind) ? body(m, conv, state) : '');

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

function youMessage(m, conv, state, page) {
  const list = Array.isArray(m.data?.attachments) ? m.data.attachments : [];
  if (!list.length) return `<div class="msg you"><div class="bubble you">${youText(m.text, m, conv, page)}</div>${avatar('you', 28)}</div>`;
  const bubble = m.text ? `<div class="bubble you">${youText(m.text, m, conv, page)}</div>` : '';
  return `<div class="msg you"><div class="you-body">${youFiles(list, state?.thumbs ?? {})}${bubble}</div>${avatar('you', 28)}</div>`;
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

export function renderMessage(m, conv, state, page = {}) {
  // a tool call is drawn nowhere (the operator's word, 2026-10-28): its gate, receipt or refusal is a message of its own
  if (m.kind === 'tool') return '';
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
  const width = m.kind === 'composed' ? 'composed' : m.kind !== 'text' && 'wide';
  return `<div class="msg left">${name}<div class="msg-row">${avatar(m.from, 28, state)}<div class="${cls('msg-body', width)}">${body(m, conv, state)}${trace(m, conv, state)}</div></div></div>`;
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
// the words a composed answer folds are drawn inside its Working notes, just above it, and nowhere else. Before the first
// message drawn past a turn's start, that turn's mark: a loaded turn's, or one whose turn/start lies before the window
// while this message is of its turn (a page cuts at a message group, not at turn/start); the loaded turns left at the end
export function renderThread(conv, state, now, page = {}) {
  let prev = null;
  const out = [];
  const notes = foldNotes(conv.messages);
  const folded = new Set([...notes.values()].flat());
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
