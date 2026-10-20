// face/client/js/render/thread.js — the conversation body on host-shaped messages (spec 2026-10-19 §6):
// bubbles, the tool row, the three gate cards, receipts and refusals, icon-only keys, centred dividers.
import { esc, attrs, cls } from '../html.js';
import { icon } from '../icons.js';
import { divider } from '../time.js';
import { levelOf, needsAnswer } from '../messages.js';
import { avatar } from './avatars.js';
import { senderName } from './rail.js';

export const chip = (text, tone = 'grey') => `<span class="${cls('chip', tone)}">${esc(text)}</span>`;

export function key(type, label, data = {}) {
  const glyph = { yes: 'check', no: 'x', plus: 'plus' }[type];
  return `<button type="button"${attrs({ class: `key ${type}`, 'aria-label': label, ...data })}>${icon(glyph, 14, 2.4)}</button>`;
}

export const ticker = t => `<a class="ticker" href="#/markets/${esc(t)}">${esc(t)}${icon('chevRight', 12, 2.4)}</a>`;

export const withTickers = text => esc(text).replace(/\{\{([A-Z]+)\}\}/g, (_, t) => ticker(t));

// Gravit's words carry markdown; the app hands in the DOM-built renderer (wire/markdown.js) at boot, tests a stub,
// and with none set the text is escaped. Only a message flagged `markdown` goes through it.
let markdown = null;
export function setMarkdown(fn) { markdown = typeof fn === 'function' ? fn : null; }
const prose = m => (m.data?.markdown && markdown ? markdown(m.text ?? '') : esc(m.text ?? ''));

// a gate's end state, in the old client's words; a card still waiting shows nothing in that slot
const ENDED = { approved: ['Approved', 'up'], rejected: ['Declined', 'grey'], answered: ['Answered', 'up'], closed: ['Closed', 'grey'], elsewhere: ['Settled elsewhere', 'grey'] };
const stateChip = m => (m.answer ? chip(...(ENDED[m.answer] ?? [m.answer, 'grey'])) : '');

// ✗ then ✓, answering rejected / allowed-once (`data-answer` keeps the demo's words until the app boots on the host)
function gateKeys(m, conv) {
  if (!needsAnswer(m)) return '';
  const d = { 'data-action': 'answer', 'data-conv': conv.id, 'data-msg': m.id };
  return `<div class="keys right">${key('no', 'Decline', { ...d, 'data-value': 'rejected', 'data-answer': 'rejected' })}${key('yes', 'Approve', { ...d, 'data-value': 'allowed-once', 'data-answer': 'approved' })}</div>`;
}

function question(m, conv) {
  const qs = Array.isArray(m.data?.questions) ? m.data.questions : [];
  const blocks = qs.map((q, i) => {
    const id = `q-${q?.id ?? i}`;
    const options = Array.isArray(q?.options) ? q.options : [];
    const type = q?.multiSelect === true ? 'checkbox' : 'radio';
    const inputs = options.map(o => `<label class="opt"><input type="${type}" name="${esc(id)}" value="${esc(o?.label ?? '')}"><span>${esc(o?.label ?? '')}</span>${o?.description ? `<span class="dim">${esc(o.description)}</span>` : ''}</label>`).join('');
    const custom = options.length === 0 || q?.allowCustom === true ? `<input class="input small" type="text" name="${esc(id)}-custom" placeholder="Your answer" aria-label="Your answer">` : '';
    return `<div class="q" data-q="${esc(String(q?.id ?? i))}">${q?.header ? `<div class="card-title">${esc(q.header)}</div>` : ''}<div>${esc(q?.question ?? '')}</div>${q?.detail ? `<div class="dim">${esc(q.detail)}</div>` : ''}${inputs}${custom}</div>`;
  }).join('');
  const keys = needsAnswer(m) ? `<div class="keys right"><button type="button" class="btn-primary small" data-action="answerQuestion" data-conv="${esc(conv.id)}" data-msg="${esc(m.id)}">Answer</button></div>` : '';
  return `<div class="card orange question">${blocks}${stateChip(m)}${keys}</div>`;
}

function body(m, conv) {
  const d = m.data ?? {};
  switch (m.kind) {
    case 'tool': {
      const running = d.result === undefined;
      return `<details class="${cls('tool', d.isError && 'danger')}"><summary><span class="tool-name">${esc(m.text || d.title || d.name || 'tool')}</span>${running ? '<span class="dim">running</span>' : ''}</summary>${running ? '' : `<pre>${esc(d.result)}</pre>`}</details>`;
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

export function renderMessage(m, conv, state) {
  if (m.from === 'system') return `<div class="sysline">${esc(m.text)}</div>`;
  if (m.from === 'you') {
    const files = (m.data?.files ?? []).map(n => `<span class="file-chip">${icon('file', 13, 2)}${esc(n)}</span>`).join('');
    return `<div class="msg you"><div class="bubble you">${files}${m.text ? esc(m.text) : ''}</div>${avatar('you', 28)}</div>`;
  }
  const name = conv.kind === 'group' && m.from !== 'gravit' ? `<div class="sender-name">${esc(m.data?.name ?? senderName(m.from, state))}</div>` : '';
  // plain talk keeps a bubble's width; every card, tool row and green bubble runs wider (spec §16)
  const wide = m.kind !== 'text';
  return `<div class="msg left">${name}<div class="msg-row">${avatar(m.from, 28, state)}<div class="${cls('msg-body', wide && 'wide')}">${body(m, conv)}</div></div></div>`;
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
