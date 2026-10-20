// face/client/js/render/thread.js — the conversation body on host-shaped messages (spec 2026-10-19 §6):
// bubbles, the tool row, the three gate cards, receipts and refusals, icon-only keys, centred dividers.
import { esc, attrs, cls } from '../html.js';
import { icon } from '../icons.js';
import { divider } from '../time.js';
import { levelOf, needsAnswer } from '../messages.js';
import { avatar } from './avatars.js';
import { senderName } from './rail.js';
import { toolResultFor } from './tool-result.js';

export const chip = (text, tone = 'grey') => `<span class="${cls('chip', tone)}">${esc(text)}</span>`;

export function key(type, label, data = {}) {
  const glyph = { yes: 'check', no: 'x' }[type];
  return `<button type="button"${attrs({ class: `key ${type}`, 'aria-label': label, ...data })}>${icon(glyph, 14, 2.4)}</button>`;
}

export const ticker = t => `<a class="ticker" href="#/markets/${esc(t)}">${esc(t)}${icon('chevRight', 12, 2.4)}</a>`;

export const withTickers = text => esc(text).replace(/\{\{([A-Z]+)\}\}/g, (_, t) => ticker(t));

// Gravit's words carry markdown; the app hands in the DOM-built renderer (wire/markdown.js) at boot, tests a stub,
// and with none set the text is escaped. Only a message flagged `markdown` goes through it.
let markdown = null;
export function setMarkdown(fn) { markdown = typeof fn === 'function' ? fn : null; }
const prose = m => (m.data?.markdown && markdown ? markdown(m.text ?? '') : esc(m.text ?? ''));
// any other markdown the screens draw (a channel's thesis), through the same renderer, escaped when none is set
export const markdownHtml = text => (markdown ? markdown(text ?? '') : esc(text ?? ''));

// a gate's end state, in the old client's words; a card still waiting shows nothing in that slot
const ENDED = { approved: ['Approved', 'up'], rejected: ['Declined', 'grey'], answered: ['Answered', 'up'], closed: ['Closed', 'grey'], elsewhere: ['Settled elsewhere', 'grey'] };
const stateChip = m => (m.answer ? chip(...(ENDED[m.answer] ?? [m.answer, 'grey'])) : '');

// ✗ then ✓, answering rejected / allowed-once — the approval vocabulary api.js sends (nothing else reaches the host)
function gateKeys(m, conv) {
  if (!needsAnswer(m)) return '';
  const d = { 'data-action': 'answer', 'data-conv': conv.id, 'data-msg': m.id };
  return `<div class="keys right">${key('no', 'Decline', { ...d, 'data-value': 'rejected' })}${key('yes', 'Approve', { ...d, 'data-value': 'allowed-once' })}</div>`;
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
    const hint = options.length ? 'Other…' : 'Your answer';
    const custom = `<input class="input small" type="text" id="${esc(`${name}-custom`)}" name="${esc(`${name}-custom`)}" placeholder="${hint}" aria-label="${hint}">`;
    return `<div class="q" data-q="${esc(String(q?.id ?? i))}">${q?.header ? `<div class="card-title">${esc(q.header)}</div>` : ''}<div>${esc(q?.question ?? '')}</div>${q?.detail ? `<div class="dim">${esc(q.detail)}</div>` : ''}${inputs}${custom}</div>`;
  }).join('');
  const keys = needsAnswer(m) ? `<div class="keys right"><button type="button" class="btn-primary small" data-action="answerQuestion" data-conv="${esc(conv.id)}" data-msg="${esc(m.id)}">Answer</button></div>` : '';
  return `<div class="card orange question" data-gate="${esc(m.id)}">${blocks}${stateChip(m)}${keys}</div>`;
}

function body(m, conv) {
  const d = m.data ?? {};
  switch (m.kind) {
    case 'tool': {
      // the row and its Raw keep ids, so a render opens again what the person opened
      const running = d.result === undefined;
      const id = esc(String(d.callId ?? m.id));
      const raw = `<pre>${esc(d.result)}</pre>`;
      const pretty = running ? null : toolResultFor(d);
      const result = running ? '' : pretty ? `${pretty}<details id="raw-${id}" class="raw"><summary>Raw</summary>${raw}</details>` : raw;
      return `<details id="tool-${id}" class="${cls('tool', d.isError && 'danger')}"><summary><span class="tool-name">${esc(m.text || d.title || d.name || 'tool')}</span>${running ? '<span class="dim">running</span>' : ''}</summary>${result}</details>`;
    }
    case 'card':
      return `<div class="card orange"><div class="card-head"><div class="card-title">${esc(d.title ?? m.text)}</div>${stateChip(m)}</div>` +
        `<div class="dim">${esc([d.venue, d.line].filter(Boolean).join(' · '))}</div>${gateKeys(m, conv)}</div>`;
    case 'approval': {
      const shown = d.displayReason ?? d.reason ?? m.text ?? '';
      const audit = d.reason && d.displayReason && d.reason !== d.displayReason ? `<div class="dim">${esc(d.reason)}</div>` : '';
      return `<div class="card orange"><div class="card-head"><div class="card-title">${esc(d.toolName ?? 'approval')}</div>${stateChip(m)}</div><div>${esc(shown)}</div>${audit}${gateKeys(m, conv)}</div>`;
    }
    case 'question':
      return question(m, conv);
    case 'receipt':
      return `<div class="bubble green"><div class="line">${chip(d.status ?? 'accepted', 'up')}<span>${esc(m.text)}</span></div></div>`;
    case 'refusal':
      return `<div class="card red">${d.code ? chip(`✗ ${d.code}`, 'down') : ''}<div>${esc(m.text)}</div></div>`;
    default:
      return `<div class="bubble ${levelOf(m)}">${prose(m)}${d.interrupted ? '<div class="cut">Interrupted</div>' : ''}</div>`;
  }
}

// a room member's answer can open the turn that produced it: read on opening (host/traces.js), drawn with the
// thread's own rows; the slice and the disclosure's id name the conversation, since two rooms repeat message ids
function trace(m, conv, state) {
  if (typeof m.data?.memberSessionId !== 'string' || typeof m.data?.memberTurn !== 'number') return '';
  const t = state?.traces?.[conv.id]?.[m.id];
  const item = x => (x.kind === 'tool' ? body(x, conv) : x.from === 'system' ? `<div class="sysline">${esc(x.text)}</div>` : `<div class="dsec-line">${esc(x.text)}</div>`);
  const inner = !t || t.status === 'loading' ? '<div class="dim">Loading…</div>'
    : t.status === 'failed' ? `<div class="dim">${esc(t.line)}</div>`
      : t.messages.length ? t.messages.map(item).join('') : '<div class="dim">No steps</div>';
  return `<details id="trace-${esc(conv.id)}-${esc(m.id)}" class="trace"><summary data-action="openTrace" data-conv="${esc(conv.id)}" data-msg="${esc(m.id)}">Trace</summary>` +
    `<div class="trace-body">${inner}</div></details>`;
}

export function renderMessage(m, conv, state) {
  // a producer-sourced user record (a runtime snapshot, a plugin notice, a member's delta) is context, folded away under its source;
  // a line the page itself writes (a round end, a child's report) stays a centred line
  if (m.from === 'system') {
    const source = typeof m.data?.source === 'string' && m.data.source !== '' ? m.data.source : null;
    return source
      ? `<details class="sysline ctx"><summary>context · ${esc(source)}</summary><pre>${esc(m.text)}</pre></details>`
      : `<div class="sysline">${esc(m.text)}</div>`;
  }
  if (m.from === 'you') return `<div class="msg you"><div class="bubble you">${m.text ? esc(m.text) : ''}</div>${avatar('you', 28)}</div>`;
  const name = conv.kind === 'group' && m.from !== 'gravit' ? `<div class="sender-name">${esc(m.data?.name ?? senderName(m.from, state))}</div>` : '';
  // plain talk keeps a bubble's width; every card, tool row and green bubble runs wider (spec §16)
  const wide = m.kind !== 'text';
  return `<div class="msg left">${name}<div class="msg-row">${avatar(m.from, 28, state)}<div class="${cls('msg-body', wide && 'wide')}">${body(m, conv)}${trace(m, conv, state)}</div></div></div>`;
}

// the three-dot row while the host streams a turn
const thinkingRow = conv => `<div class="msg left"><div class="msg-row">${avatar(conv.kind === 'bot' ? conv.preset : 'gravit', 28)}<div class="msg-body"><div class="bubble grey thinking" role="status" aria-label="thinking"><span></span><span></span><span></span></div></div></div></div>`;

export function renderThread(conv, state, now) {
  let prev = null;
  const out = [];
  for (const m of conv.messages) {
    const d = divider(m.at, prev, now);
    if (d) out.push(`<div class="divider">${esc(d)}</div>`);
    out.push(renderMessage(m, conv, state));
    prev = m.at;
  }
  if (conv.thinking) out.push(thinkingRow(conv));
  return out.join('');
}
