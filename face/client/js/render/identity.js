// face/client/js/render/identity.js — Account › Identity (plan B1b Task 1), the seventh tab: three cardboxes over the account's
// identity read (host/identity-view.js) — Gravit (the networks Gravit speaks on: Telegram connected or not, with Details and, on a
// page that signs, Connect… or Disconnect…; iMessage Later, with no key; Slack Soon, its Connect… disabled), What reaches you where
// (the five routing rows by network, the face always on; quiet hours on New York's clock; Save… while the ticks differ from the
// account's) and Not you · n (the strangers who wrote to the bot, each with Block). The owner's keys are drawn only while the page
// signs; a page that does not reads the same cards with one line saying so. The account not answering draws no connection.
// And Connect Telegram's sheets 1 to 3 as a drawer of their own (Task 2): Bot token (a password field), Say hi (the bot's link and its
// QR as an <img> of the account's SVG data URL, never markup), Is this you? — each ending with its numbered steps above its keys.
import { esc, attrs } from '../html.js';
import { icon } from '../icons.js';
import { fmtClock, fmtDate, sameDay } from '../time.js';
import { chip } from './thread.js';
import { identityOf, NETWORKS, routingOf, sameRouting } from '../host/identity-view.js';

const str = v => (typeof v === 'string' ? v : '');
const box = (inner, label) => `<section class="cardbox" aria-label="${esc(label)}">${inner}</section>`;
const note = text => `<p class="acct-note">${esc(text)}</p>`;
const title = text => `<div class="cardbox-title">${esc(text)}</div>`;
const when = (at, now) => { const t = Date.parse(at); return Number.isNaN(t) ? '' : sameDay(t, now) ? fmtClock(t) : `${fmtDate(t)} ${fmtClock(t)}`; };
const dateWord = at => { const t = Date.parse(at); return Number.isNaN(t) ? '' : fmtDate(t); };
const clockWord = at => { const t = Date.parse(at); return Number.isNaN(t) ? '' : fmtClock(t); };
// a row's words: its icon, its name bold (a chip beside it), each line under it dim
const lines = (glyph, head, dims = [], chipText = '') => `${icon(glyph, 16)} <b>${esc(head)}</b>${chipText ? ` ${chip(chipText)}` : ''}${dims.filter(Boolean).map(d => `<br><span class="dim">${esc(d)}</span>`).join('')}`;
const GLYPH = { telegram: 'plane', imessage: 'chat', slack: 'team' };
const signs = state => state.owner?.role === 'signs';
const button = (word, data, klass = 'btn-sm') => `<button${attrs({ type: 'button', class: klass, ...data })}>${esc(word)}</button>`;
const sheetKey = (kind, data, word, klass) => button(word, { 'data-action': 'openSheet', 'data-kind': kind, ...data }, klass);
const keys = (...k) => (k.some(Boolean) ? `<span class="btn-row">${k.join('')}</span>` : '');
const OFF = { disabled: true, 'aria-disabled': 'true' };
const READ_ONLY = 'Only a browser that signs changes these.';
const QUIET_WORDS = 'Inside them alerts, the brief, reports, cards and fills are not sent, and not sent later; replies, urgent alerts and the watchdog always go.';

// ── Gravit: the networks ──

function telegramRow(t, state, owner) {
  const named = { 'data-network': 'telegram' };
  if (t.state !== 'connected') {
    return `<div class="venue" data-network="telegram"><span>${lines(GLYPH.telegram, 'Telegram', ['Not connected'])}</span>` +
      `${keys(owner ? button('Connect…', { 'data-action': 'identityConnect', ...named }) : '')}</div>`;
  }
  const open = state.identity.details === true;
  const status = t.problem ?? (t.polling ? 'polling' : 'not polling');
  const since = [dateWord(t.since) ? `Since ${dateWord(t.since)}` : '', t.fingerprint ? `token ${t.fingerprint}` : '', status].filter(Boolean).join(' · ');
  const dims = [`Speaks as ${t.speaksAs || '—'}`, `Talks only with ${t.talksOnlyWith || '—'}`, t.problem ?? '', open ? since : ''];
  return `<div class="venue" data-network="telegram"><span>${lines(GLYPH.telegram, 'Telegram', dims, 'Connected')}</span>` +
    `${keys(button('Details', { 'data-action': 'identityDetails', 'aria-expanded': open ? 'true' : 'false' }), owner ? sheetKey('disconnectNetwork', named, 'Disconnect…', 'btn-danger') : '')}</div>`;
}

function gravitCard(v, state, owner) {
  const rows = NETWORKS.map(([net, name]) => {
    if (net === 'telegram') return telegramRow(v.networks.telegram, state, owner);
    if (net === 'slack') {
      return `<div class="venue" data-network="slack"><span>${lines(GLYPH.slack, name, ['Not connected'], 'Soon')}</span>` +
        `${keys(owner ? button('Connect…', OFF) : '')}</div>`;
    }
    return `<div class="venue" data-network="${esc(net)}"><span>${lines(GLYPH[net] ?? 'chat', name, [], 'Later')}</span></div>`;
  }).join('');
  return box(`${title('Gravit')}${note('Where Gravit reaches you beyond this face, and who it talks to there.')}<div class="venues">${rows}</div>` +
    `${owner ? '' : note(READ_ONLY)}`, 'Gravit');
}

// ── What reaches you where: the grid and quiet hours ──

function gridCard(v, state, owner) {
  const tick = (on, enabled, label, data) => `<input${attrs({ type: 'checkbox', 'aria-label': label, checked: on, ...(enabled ? data : OFF) })}>`;
  const head = ['Face', 'Telegram', 'iMessage', 'Slack'].map(h => `<th scope="col">${h}</th>`).join('');
  const rows = v.grid.map(g => `<tr><td>${esc(g.label)}</td>` +
    `<td>${tick(true, false, `${g.label} in the face`, {})}</td>` +
    `<td>${tick(g.telegram.on, owner && g.telegram.enabled, `${g.label} on Telegram`, { 'data-action': 'identityTick', 'data-row': g.row, 'data-network': 'telegram' })}</td>` +
    `<td>${tick(false, false, `${g.label} on iMessage`, {})}</td><td>${tick(false, false, `${g.label} on Slack`, {})}</td></tr>`).join('');
  const table = `<div class="acct-wrap"><table class="acct-t"><thead><tr><th scope="col">What</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
  const draft = state.identity.draft;
  const changed = owner && draft !== null && draft !== undefined && !sameRouting(draft, routingOf(state.identity.data));
  const save = changed ? `${note('Not saved yet: Save… signs the change.')}<div class="btn-row">${sheetKey('routing', {}, 'Save…')}</div>` : '';
  const quietWords = v.quiet ? `${v.quiet.from}–${v.quiet.to} ET` : 'Off';
  const quiet = `<div class="venues"><div class="venue"><span><b>Quiet hours</b><br><span class="dim">${esc(quietWords)}</span><br><span class="dim">${esc(QUIET_WORDS)}</span></span>` +
    `${keys(owner ? sheetKey('routing', {}, 'Change…') : '')}</div></div>`;
  return box(`${title('What reaches you where')}${table}${save}${quiet}`, 'What reaches you where');
}

// ── Not you: the strangers ──

const NETWORK_NAME = Object.fromEntries(NETWORKS);

function notYouCard(v, owner, now) {
  const n = v.strangers.length;
  const rows = v.strangers.map(s => {
    const words = [NETWORK_NAME[s.network] ?? s.network, s.masked || '…', `${s.count} ${s.count === 1 ? 'message' : 'messages'}`, when(s.last, now) ? `last ${when(s.last, now)}` : ''].filter(Boolean).join(' · ');
    return `<div class="venue"><span>${esc(words)}</span>` +
      `${keys(owner ? sheetKey('block', { 'data-network': s.network, 'data-sender': s.sender, 'data-masked': s.masked }, 'Block') : '')}</div>`;
  }).join('');
  const body = n ? `${note('Anyone but you who writes to the bot never reaches Gravit: they are counted here, by a masked id.')}<div class="venues">${rows}</div>` : note('Nobody else has written to Gravit.');
  return box(`${title(`Not you · ${n}`)}${body}`, 'Not you');
}

/** The Identity tab at `now`: the three cards over the account's identity read; Loading… before any answer; the account not
 *  answering (with Retry, and its words when it gave some) after a failed read, drawing no connection; Identity unreadable for an
 *  answer the face does not recognise. */
export function renderIdentityTab(state, now) {
  const r = state.identity ?? {};
  const retry = `<div class="btn-row">${button('Retry', { 'data-action': 'refreshIdentity' })}</div>`;
  if (r.data === null || r.data === undefined) {
    if (r.status === 'error' || (r.message ?? null) !== null) return `${note('The account is not answering.')}${r.message ? note(r.message) : ''}${retry}`;
    return note('Loading…');
  }
  const owner = signs(state);
  // the unsaved ticks only while the page signs: one that no longer does shows the account's routing
  const v = identityOf(r.data, owner ? r.draft ?? null : null, clockWord);
  if (!v.ok) return `${note('Identity unreadable')}${retry}`;
  return `<div class="cards">${gravitCard(v, state, owner)}${gridCard(v, state, owner)}${notYouCard(v, owner, now)}</div>`;
}

// ── Connect Telegram: sheets 1 to 3, the Identity drawer (plan B1b Task 2, spec §5.2; sheet 4 is the owner sheet) ──

/** Sheets 1 to 3's numbered steps, fixed copy: each sheet ends with them above its keys. */
export const CONNECT_STEPS = {
  1: [
    'In Telegram, open @BotFather and send /newbot.',
    'Pick a name for Gravit, then a username that ends in "bot".',
    'BotFather answers with a token. Copy it.',
    'Paste it only here, never in a chat, not even with Gravit.',
  ],
  2: [
    "On your phone, open the link or scan the code: Telegram opens Gravit's bot.",
    'Tap Start.',
    'Wait here: this sheet moves on when the bot hears you.',
  ],
  3: [
    'Check the name, the handle and the message: they should be yours, sent a moment ago.',
    'This is me: Gravit talks only with this Telegram account.',
    'Not me: that sender is listed under Not you and never reaches Gravit. Say hi again from your own Telegram.',
  ],
};
const CONNECT_TITLES = { 1: 'Connect Telegram · 1 of 4 · Bot token', 2: 'Connect Telegram · 2 of 4 · Say hi', 3: 'Connect Telegram · 3 of 4 · Is this you?' };
const QR_PREFIX = 'data:image/svg+xml;base64,';
const T_ME = /^https:\/\/t\.me\/([A-Za-z0-9_]{1,64})$/;
const CONFLICT_WORDS = "Another program reads this bot's messages: stop it, and this sheet goes on.";
const SILENT_WORDS = 'The account is not answering: this sheet keeps asking.';

/** A time as New York's clock reads it, h:mm (24-hour). */
export function etClock(at) {
  const t = Date.parse(at);
  if (Number.isNaN(t)) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(t)).map(p => [p.type, p.value]));
  return `${Number(parts.hour) % 24}:${parts.minute}`;
}

const stepsList = steps => `<ol class="sheet-steps">${steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>`;
const lineBox = rows => `<div class="sheet-quote">${rows.map(r => `<div class="dsec-line">${esc(r)}</div>`).join('')}</div>`;
const primary = (word, data) => `<button${attrs({ type: 'button', class: 'btn-primary', ...data })}>${esc(word)}</button>`;

// sheet 1: no <form> round the token's field, so a browser sees no login to offer to keep (its password managers are told the same);
// Enter in the field is Next all the same (app.js's keydown)
function sheetOne(c) {
  const field = `<div class="field"><label class="field-label" for="identity-token">Bot token</label>` +
    `<input${attrs({
      id: 'identity-token', class: 'input', type: 'password', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Bot token',
      'data-lpignore': 'true', 'data-1p-ignore': 'true', 'data-form-type': 'other', disabled: c.busy === true,
    })}>` +
    `<span class="btn-row">${button('Paste', { 'data-action': 'identityPaste', disabled: c.busy === true })}</span></div>`;
  return { body: `${field}${lineBox(['Kept in: Account · :4820', "Never in: Gravit's box · ~/.dsh"])}`, keys: [button('Cancel', { 'data-action': 'identityClose' }), primary(c.busy ? 'Checking…' : 'Next', { 'data-action': 'identityNext', disabled: c.busy === true })] };
}

function sheetTwo(c) {
  const p = c.pending ?? {};
  const m = T_ME.exec(str(p.link));
  const shown = m ? `t.me/${m[1]}` : '';
  const link = m ? `<p><a${attrs({ href: p.link, target: '_blank', rel: 'noopener noreferrer' })}>${esc(shown)}</a></p>` : '';
  const qr = m && typeof p.qr === 'string' && p.qr.startsWith(QR_PREFIX) ? `<img${attrs({ class: 'identity-qr', src: p.qr, alt: `QR code for ${shown}`, width: '180', height: '180' })}>` : '';
  const until = etClock(p.expiresAt);
  const lines = [
    until ? `<p class="sheet-hint">${esc(`This connection waits until ${until} ET; after that, start again.`)}</p>` : '',
    p.state === 'conflict' ? note(CONFLICT_WORDS) : '',
    c.silent === true ? note(SILENT_WORDS) : '',
  ].join('');
  return { body: `${link}${qr}${lines}`, keys: [button('Back', { 'data-action': 'identityBack' }), button('Cancel', { 'data-action': 'identityClose' })] };
}

function sheetThree(c) {
  const s = c.pending?.sender ?? {};
  const rows = [`Name: ${str(s.name) || '—'}`, `Handle: ${str(s.handle) || 'none'}`, `Telegram id: ${str(s.masked) || '…'}`, `Message: ${str(s.text) || '—'}`];
  return {
    body: lineBox(rows),
    keys: [button('Back', { 'data-action': 'identityBack', disabled: c.busy === true }), button('Cancel', { 'data-action': 'identityClose' }),
      button('Not me', { 'data-action': 'identityNotMe', disabled: c.busy === true }), primary('This is me', { 'data-action': 'identityThisIsMe', disabled: c.busy === true })],
  };
}

/** The Connect Telegram drawer (sheets 1 to 3) while one is open: its title, its body, the account's words when it refused or the
 *  connection is gone (with Start again from sheet 2 on), its numbered steps, then its keys. None open: nothing. */
export function renderConnectDrawer(state) {
  const c = state.identity?.connect;
  if (!c || !CONNECT_TITLES[c.step]) return '';
  const title = CONNECT_TITLES[c.step];
  const sheet = c.step === 1 ? sheetOne(c) : c.step === 2 ? sheetTwo(c) : sheetThree(c);
  const error = typeof c.error === 'string' && c.error ? note(c.error) : '';
  const again = error && c.step > 1 ? `<div class="btn-row">${button('Start again', { 'data-action': 'identityStartAgain' })}</div>` : '';
  return `<aside${attrs({ class: 'drawer sheet', 'aria-label': title })}><div class="drawer-head"><h2>${esc(title)}</h2><button type="button" class="close-key" data-action="identityClose" aria-label="Close">×</button></div>` +
    `<div class="drawer-body">${sheet.body}${error}${again}${stepsList(CONNECT_STEPS[c.step])}<div class="btn-row">${sheet.keys.join('')}</div></div></aside>`;
}
