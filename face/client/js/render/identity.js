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
import { HOST_NAME } from '../wire/speaker.js';
import { t, th, tn } from '../i18n/words.js';

const str = v => (typeof v === 'string' ? v : '');
const box = (inner, label) => `<section class="cardbox" aria-label="${esc(label)}">${inner}</section>`;
const note = text => `<p class="acct-note">${esc(text)}</p>`;
const title = text => `<div class="cardbox-title">${esc(text)}</div>`;
const when = (at, now) => { const ms = Date.parse(at); return Number.isNaN(ms) ? '' : sameDay(ms, now) ? fmtClock(ms) : `${fmtDate(ms)} ${fmtClock(ms)}`; };
const dateWord = at => { const ms = Date.parse(at); return Number.isNaN(ms) ? '' : fmtDate(ms); };
const clockWord = at => { const ms = Date.parse(at); return Number.isNaN(ms) ? '' : fmtClock(ms); };
// a row's words: its icon, its name bold (a chip beside it), each line under it dim
const lines = (glyph, head, dims = [], chipText = '') => `${icon(glyph, 16)} <b>${esc(head)}</b>${chipText ? ` ${chip(chipText)}` : ''}${dims.filter(Boolean).map(d => `<br><span class="dim">${esc(d)}</span>`).join('')}`;
const GLYPH = { telegram: 'plane', imessage: 'chat', slack: 'team' };
const signs = state => state.owner?.role === 'signs';
const button = (word, data, klass = 'btn-sm') => `<button${attrs({ type: 'button', class: klass, ...data })}>${esc(word)}</button>`;
const sheetKey = (kind, data, word, klass) => button(word, { 'data-action': 'openSheet', 'data-kind': kind, ...data }, klass);
const keys = (...k) => (k.some(Boolean) ? `<span class="btn-row">${k.join('')}</span>` : '');
const OFF = { disabled: true, 'aria-disabled': 'true' };
const readOnly = () => t('identity.readOnly');
const quietWords = () => t('identity.quiet.words');
const TELEGRAM = 'Telegram'; // en-kept: the network's name

// ── Gravit: the networks ──

function telegramRow(tg, state, owner) {
  const named = { 'data-network': 'telegram' };
  if (tg.state !== 'connected') {
    return `<div class="venue" data-network="telegram"><span>${lines(GLYPH.telegram, TELEGRAM, [t('identity.notConnected')])}</span>` +
      `${keys(owner ? button(t('identity.connect'), { 'data-action': 'identityConnect', ...named }) : '')}</div>`;
  }
  const open = state.identity.details === true;
  const status = tg.problem ?? (tg.polling ? t('identity.telegram.polling') : t('identity.telegram.notPolling'));
  const since = [dateWord(tg.since) ? t('identity.telegram.since', { date: dateWord(tg.since) }) : '', tg.fingerprint ? t('identity.telegram.token', { fingerprint: tg.fingerprint }) : '', status].filter(Boolean).join(' · ');
  const dims = [t('identity.telegram.speaksAs', { who: tg.speaksAs || '—' }), t('identity.telegram.talksWith', { who: tg.talksOnlyWith || '—' }), tg.problem ?? '', open ? since : ''];
  return `<div class="venue" data-network="telegram"><span>${lines(GLYPH.telegram, TELEGRAM, dims, t('identity.connected'))}</span>` +
    `${keys(button(t('identity.details'), { 'data-action': 'identityDetails', 'aria-expanded': open ? 'true' : 'false' }), owner ? sheetKey('disconnectNetwork', named, t('identity.disconnect'), 'btn-danger') : '')}</div>`;
}

function gravitCard(v, state, owner) {
  const rows = NETWORKS.map(([net, name]) => {
    if (net === 'telegram') return telegramRow(v.networks.telegram, state, owner);
    if (net === 'slack') {
      return `<div class="venue" data-network="slack"><span>${lines(GLYPH.slack, name, [t('identity.notConnected')], t('identity.soon'))}</span>` +
        `${keys(owner ? button(t('identity.connect'), OFF) : '')}</div>`;
    }
    return `<div class="venue" data-network="${esc(net)}"><span>${lines(GLYPH[net] ?? 'chat', name, [], t('identity.later'))}</span></div>`;
  }).join('');
  return box(`${title(HOST_NAME)}${note(t('identity.gravit.note', { name: HOST_NAME }))}<div class="venues">${rows}</div>` +
    `${owner ? '' : note(readOnly())}`, HOST_NAME);
}

// ── What reaches you where: the grid and quiet hours ──

function gridCard(v, state, owner) {
  const tick = (on, enabled, label, data) => `<input${attrs({ type: 'checkbox', 'aria-label': label, checked: on, ...(enabled ? data : OFF) })}>`;
  const nameOf = net => NETWORK_NAME[net];
  const head = [th('identity.grid.face'), ...NETWORKS.map(([, name]) => name)].map(h => `<th scope="col">${h}</th>`).join('');
  const rows = v.grid.map(g => `<tr><td>${esc(g.label)}</td>` +
    `<td>${tick(true, false, t('identity.grid.inFace', { label: g.label }), {})}</td>` +
    `<td>${tick(g.telegram.on, owner && g.telegram.enabled, t('identity.grid.onNetwork', { label: g.label, network: nameOf('telegram') }), { 'data-action': 'identityTick', 'data-row': g.row, 'data-network': 'telegram' })}</td>` +
    `<td>${tick(false, false, t('identity.grid.onNetwork', { label: g.label, network: nameOf('imessage') }), {})}</td><td>${tick(false, false, t('identity.grid.onNetwork', { label: g.label, network: nameOf('slack') }), {})}</td></tr>`).join('');
  const table = `<div class="acct-wrap"><table class="acct-t"><thead><tr><th scope="col">${th('identity.grid.what')}</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
  const draft = state.identity.draft;
  const changed = owner && draft !== null && draft !== undefined && !sameRouting(draft, routingOf(state.identity.data));
  const save = changed ? `${note(t('identity.grid.notSaved'))}<div class="btn-row">${sheetKey('routing', {}, t('identity.grid.save'))}</div>` : '';
  const hours = v.quiet ? t('identity.quiet.range', { from: v.quiet.from, to: v.quiet.to }) : t('identity.quiet.off');
  const quiet = `<div class="venues"><div class="venue"><span><b>${th('identity.quiet.title')}</b><br><span class="dim">${esc(hours)}</span><br><span class="dim">${esc(quietWords())}</span></span>` +
    `${keys(owner ? sheetKey('routing', {}, t('identity.quiet.change')) : '')}</div></div>`;
  return box(`${title(t('identity.grid.title'))}${table}${save}${quiet}`, t('identity.grid.title'));
}

// ── Not you: the strangers ──

const NETWORK_NAME = Object.fromEntries(NETWORKS);

function notYouCard(v, owner, now) {
  const n = v.strangers.length;
  const rows = v.strangers.map(s => {
    const words = [NETWORK_NAME[s.network] ?? s.network, s.masked || '…', tn('identity.strangers.messages', s.count), when(s.last, now) ? t('identity.strangers.last', { when: when(s.last, now) }) : ''].filter(Boolean).join(' · ');
    return `<div class="venue"><span>${esc(words)}</span>` +
      `${keys(owner ? sheetKey('block', { 'data-network': s.network, 'data-sender': s.sender, 'data-masked': s.masked }, t('identity.strangers.block')) : '')}</div>`;
  }).join('');
  const body = n ? `${note(t('identity.strangers.note', { name: HOST_NAME }))}<div class="venues">${rows}</div>` : note(t('identity.strangers.none', { name: HOST_NAME }));
  return box(`${title(t('identity.strangers.title', { n }))}${body}`, t('identity.strangers.label'));
}

/** The Identity tab at `now`: the three cards over the account's identity read; Loading… before any answer; the account not
 *  answering (with Retry, and its words when it gave some) after a failed read, drawing no connection; Identity unreadable for an
 *  answer the face does not recognise. */
export function renderIdentityTab(state, now) {
  const r = state.identity ?? {};
  const retry = `<div class="btn-row">${button(t('identity.retry'), { 'data-action': 'refreshIdentity' })}</div>`;
  if (r.data === null || r.data === undefined) {
    if (r.status === 'error' || (r.message ?? null) !== null) return `${note(t('identity.notAnswering'))}${r.message ? note(r.message) : ''}${retry}`;
    return note(t('common.loading'));
  }
  const owner = signs(state);
  // the unsaved ticks only while the page signs: one that no longer does shows the account's routing
  const v = identityOf(r.data, owner ? r.draft ?? null : null, clockWord);
  if (!v.ok) return `${note(t('identity.unreadable'))}${retry}`;
  return `<div class="cards">${gravitCard(v, state, owner)}${gridCard(v, state, owner)}${notYouCard(v, owner, now)}</div>`;
}

// ── Connect Telegram: sheets 1 to 3, the Identity drawer (plan B1b Task 2, spec §5.2; sheet 4 is the owner sheet) ──

/** Sheets 1 to 3's numbered steps, fixed copy: each sheet ends with them above its keys. Any other step: none. */
export function connectSteps(step) {
  const name = HOST_NAME;
  if (step === 1) {
    // the suffix is the one Telegram asks a bot's username to end in, quoted as typed
    return [t('identity.steps.newbot'), t('identity.steps.name', { name, suffix: '"bot"' }), t('identity.steps.token'), t('identity.steps.paste', { name })];
  }
  if (step === 2) return [t('identity.steps.open', { name }), t('identity.steps.start'), t('identity.steps.wait')];
  if (step === 3) return [t('identity.steps.check'), t('identity.steps.isMe', { name }), t('identity.steps.notMe', { name })];
  return [];
}
const connectTitle = step => (step === 1 ? t('identity.sheet.one') : step === 2 ? t('identity.sheet.two') : step === 3 ? t('identity.sheet.three') : '');
const QR_PREFIX = 'data:image/svg+xml;base64,';
const T_ME = /^https:\/\/t\.me\/([A-Za-z0-9_]{1,64})$/;
const conflictWords = () => t('identity.sheet.conflict');
const silentWords = () => t('identity.sheet.silent');

/** A time as New York's clock reads it, h:mm (24-hour). */
export function etClock(at) {
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ms)).map(p => [p.type, p.value]));
  return `${Number(parts.hour) % 24}:${parts.minute}`;
}

const stepsList = steps => `<ol class="sheet-steps">${steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>`;
const lineBox = rows => `<div class="sheet-quote">${rows.map(r => `<div class="dsec-line">${esc(r)}</div>`).join('')}</div>`;
const primary = (word, data) => `<button${attrs({ type: 'button', class: 'btn-primary', ...data })}>${esc(word)}</button>`;

// sheet 1: no <form> round the token's field, so a browser sees no login to offer to keep (its password managers are told the same);
// Enter in the field is Next all the same (app.js's keydown)
function sheetOne(c) {
  const field = `<div class="field"><label class="field-label" for="identity-token">${th('identity.token.label')}</label>` +
    `<input${attrs({
      id: 'identity-token', class: 'input', type: 'password', autocomplete: 'off', spellcheck: 'false', 'aria-label': t('identity.token.label'),
      'data-lpignore': 'true', 'data-1p-ignore': 'true', 'data-form-type': 'other', disabled: c.busy === true,
    })}>` +
    `<span class="btn-row">${button(t('identity.token.paste'), { 'data-action': 'identityPaste', disabled: c.busy === true })}</span></div>`;
  return { body: `${field}${lineBox([t('identity.token.keptIn'), t('identity.token.neverIn', { name: HOST_NAME })])}`, keys: [button(t('common.cancel'), { 'data-action': 'identityClose' }), primary(c.busy ? t('identity.token.checking') : t('identity.token.next'), { 'data-action': 'identityNext', disabled: c.busy === true })] };
}

function sheetTwo(c) {
  const p = c.pending ?? {};
  const m = T_ME.exec(str(p.link));
  const shown = m ? `t.me/${m[1]}` : '';
  const link = m ? `<p><a${attrs({ href: p.link, target: '_blank', rel: 'noopener noreferrer' })}>${esc(shown)}</a></p>` : '';
  const qr = m && typeof p.qr === 'string' && p.qr.startsWith(QR_PREFIX) ? `<img${attrs({ class: 'identity-qr', src: p.qr, alt: t('identity.sheet.qr', { link: shown }), width: '180', height: '180' })}>` : '';
  const until = etClock(p.expiresAt);
  const lines = [
    until ? `<p class="sheet-hint">${esc(t('identity.sheet.until', { until }))}</p>` : '',
    p.state === 'conflict' ? note(conflictWords()) : '',
    c.silent === true ? note(silentWords()) : '',
  ].join('');
  return { body: `${link}${qr}${lines}`, keys: [button(t('identity.sheet.back'), { 'data-action': 'identityBack' }), button(t('common.cancel'), { 'data-action': 'identityClose' })] };
}

function sheetThree(c) {
  const s = c.pending?.sender ?? {};
  const rows = [t('identity.sender.name', { name: str(s.name) || '—' }), t('identity.sender.handle', { handle: str(s.handle) || t('identity.sender.none') }),
    t('identity.sender.id', { id: str(s.masked) || '…' }), t('identity.sender.message', { text: str(s.text) || '—' })];
  return {
    body: lineBox(rows),
    keys: [button(t('identity.sheet.back'), { 'data-action': 'identityBack', disabled: c.busy === true }), button(t('common.cancel'), { 'data-action': 'identityClose' }),
      button(t('identity.sheet.notMe'), { 'data-action': 'identityNotMe', disabled: c.busy === true }), primary(t('identity.sheet.isMe'), { 'data-action': 'identityThisIsMe', disabled: c.busy === true })],
  };
}

/** The Connect Telegram drawer (sheets 1 to 3) while one is open: its title, its body, the account's words when it refused or the
 *  connection is gone (with Start again from sheet 2 on), its numbered steps, then its keys. None open: nothing. */
export function renderConnectDrawer(state) {
  const c = state.identity?.connect;
  const title = c ? connectTitle(c.step) : '';
  if (!title) return '';
  const sheet = c.step === 1 ? sheetOne(c) : c.step === 2 ? sheetTwo(c) : sheetThree(c);
  const error = typeof c.error === 'string' && c.error ? note(c.error) : '';
  const again = error && c.step > 1 ? `<div class="btn-row">${button(t('identity.sheet.again'), { 'data-action': 'identityStartAgain' })}</div>` : '';
  return `<aside${attrs({ class: 'drawer sheet', 'aria-label': title })}><div class="drawer-head"><h2>${esc(title)}</h2><button type="button" class="close-key" data-action="identityClose" aria-label="${th('common.close')}">×</button></div>` +
    `<div class="drawer-body">${sheet.body}${error}${again}${stepsList(connectSteps(c.step))}<div class="btn-row">${sheet.keys.join('')}</div></div></aside>`;
}
