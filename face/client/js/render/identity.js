// face/client/js/render/identity.js — Account › Identity (plan B1b Task 1), the seventh tab: three cardboxes over the account's
// identity read (host/identity-view.js) — Gravit (the networks Gravit speaks on: Telegram and Slack, each connected or not, with
// Details and, on a page that signs, Connect… (Telegram's), Install app… (Slack's, plan B2 Task 7) or Disconnect…; iMessage Later, with
// no key), What reaches you where (the five routing rows by network, the face always on; quiet hours on New York's clock; Save… while
// the ticks differ from the account's) and Not you · n (the strangers who wrote to the bot, each with Block). The owner's keys are
// drawn only while the page signs; a page that does not reads the same cards with one line saying so. The account not answering
// draws no connection.
// And the connect sheets 1 to 3 as a drawer of their own (Task 2; Slack's in plan B2 Task 7): Telegram's Bot token (a password field)
// or Slack's App tokens (the account's app manifest with Copy, then two password fields), Say hi (the bot's t.me link or the app's
// app_redirect link, and its QR as an <img> of the account's SVG data URL, never markup), Is this you? — each ending with its numbered
// steps above its keys.
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
const NETWORK_NAME = Object.fromEntries(NETWORKS);
const READ_ONLY = 'Only a browser that signs changes these.';
const QUIET_WORDS = 'Inside them alerts, the brief, reports, cards and fills are not sent, and not sent later; replies, urgent alerts and the watchdog always go.';

// ── Gravit: the networks ──

// a network's row: not connected (Connect… for Telegram, Install app… for Slack), or connected with its lines, Details and Disconnect…
const CONNECT_KEY = { telegram: 'Connect…', slack: 'Install app…' };
const detailsOpen = (details, net) => details === true || (details !== null && typeof details === 'object' && details[net] === true);
function networkRow(net, row, state, owner) {
  const name = NETWORK_NAME[net] ?? net;
  const named = { 'data-network': net };
  if (row.state !== 'connected') {
    return `<div class="venue" data-network="${esc(net)}"><span>${lines(GLYPH[net], name, ['Not connected'])}</span>` +
      `${keys(owner ? button(CONNECT_KEY[net] ?? 'Connect…', { 'data-action': 'identityConnect', ...named }) : '')}</div>`;
  }
  const open = detailsOpen(state.identity.details, net);
  const status = row.problem ?? (row.polling ? 'polling' : 'not polling');
  const since = [dateWord(row.since) ? `Since ${dateWord(row.since)}` : '', row.fingerprint ? `token ${row.fingerprint}` : '', status].filter(Boolean).join(' · ');
  const dims = [`Speaks as ${row.speaksAs || '—'}`, `Talks only with ${row.talksOnlyWith || '—'}`, row.problem ?? '', open ? since : ''];
  return `<div class="venue" data-network="${esc(net)}"><span>${lines(GLYPH[net], name, dims, 'Connected')}</span>` +
    `${keys(button('Details', { 'data-action': 'identityDetails', 'aria-expanded': open ? 'true' : 'false', ...named }), owner ? sheetKey('disconnectNetwork', named, 'Disconnect…', 'btn-danger') : '')}</div>`;
}

function gravitCard(v, state, owner) {
  const rows = NETWORKS.map(([net, name]) => {
    if (net === 'telegram' || net === 'slack') return networkRow(net, v.networks[net], state, owner);
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
    `<td>${tick(false, false, `${g.label} on iMessage`, {})}</td>` +
    `<td>${tick(g.slack.on, owner && g.slack.enabled, `${g.label} on Slack`, { 'data-action': 'identityTick', 'data-row': g.row, 'data-network': 'slack' })}</td></tr>`).join('');
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

// ── Connect Telegram and Connect Slack: sheets 1 to 3, the Identity drawer (plan B1b Task 2, spec §5.2; Slack's plan B2 Task 7; sheet
// 4 is the owner sheet) ──

/** Sheets 1 to 3's numbered steps by network, fixed copy: each sheet ends with them above its keys. */
export const CONNECT_STEPS = {
  telegram: {
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
  },
  slack: {
    1: [
      'Open api.slack.com/apps, choose Create New App, then From a manifest, and pick your workspace.',
      'Paste the manifest above and create the app.',
      'In Basic Information › App-Level Tokens, generate a token with the connections:write scope. It starts with xapp-. Paste it in the first field.',
      'In Install App, install the app to your workspace and copy the Bot User OAuth Token. It starts with xoxb-. Paste it in the second field.',
      'Paste them only here, never in a chat, not even with Gravit.',
    ],
    2: [
      "Open the link or scan the code: Slack opens Gravit's app.",
      'In its Messages tab, send it any message, for example hi.',
      'Wait here: this sheet moves on when the app hears you.',
    ],
    3: [
      'Check the name, the handle and the message: they should be yours, sent a moment ago.',
      'This is me: Gravit talks only with this Slack account, in this direct message.',
      'Not me: that sender is listed under Not you and never reaches Gravit. Say hi again from your own Slack account.',
    ],
  },
};
const CONNECT_TITLES = {
  telegram: { 1: 'Connect Telegram · 1 of 4 · Bot token', 2: 'Connect Telegram · 2 of 4 · Say hi', 3: 'Connect Telegram · 3 of 4 · Is this you?' },
  slack: { 1: 'Connect Slack · 1 of 4 · App tokens', 2: 'Connect Slack · 2 of 4 · Say hi', 3: 'Connect Slack · 3 of 4 · Is this you?' },
};
const QR_PREFIX = 'data:image/svg+xml;base64,';
const T_ME = /^https:\/\/t\.me\/([A-Za-z0-9_]{1,64})$/;
// Slack's app_redirect to the app's DM (account slack-api.ts slackAppLink): the app's id and the team's, nothing else
const APP_REDIRECT = /^https:\/\/slack\.com\/app_redirect\?app=[A-Z0-9]{1,32}&team=[A-Z0-9]{1,32}$/;
const CONFLICT_WORDS = {
  telegram: "Another program reads this bot's messages: stop it, and this sheet goes on.",
  slack: "Another program holds this app's connection to Slack: stop it, and this sheet goes on.",
};
const SILENT_WORDS = 'The account is not answering: this sheet keeps asking.';
const NO_MANIFEST = 'The account gave no manifest: update the account, then open this sheet again.';
const KEPT = ['Kept in: Account · :4820', "Never in: Gravit's box · ~/.dsh"];

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
const networkOfConnect = c => (c?.network === 'slack' ? 'slack' : 'telegram');

// a token's password field: no <form> round it, so a browser sees no login to offer to keep (its password managers are told the same);
// Enter in it is Next, or on to the next field (app.js's keydown)
function tokenField(id, label, c) {
  return `<div class="field"><label class="field-label" for="${esc(id)}">${esc(label)}</label>` +
    `<input${attrs({
      id, class: 'input', type: 'password', autocomplete: 'off', spellcheck: 'false', 'aria-label': label,
      'data-lpignore': 'true', 'data-1p-ignore': 'true', 'data-form-type': 'other', disabled: c.busy === true,
    })}>` +
    `<span class="btn-row">${button('Paste', { 'data-field': id, 'data-action': 'identityPaste', disabled: c.busy === true })}</span></div>`;
}
const sheetOneKeys = c => [button('Cancel', { 'data-action': 'identityClose' }), primary(c.busy ? 'Checking…' : 'Next', { 'data-action': 'identityNext', disabled: c.busy === true })];

function sheetOne(c) {
  return { body: `${tokenField('identity-token', 'Bot token', c)}${lineBox(KEPT)}`, keys: sheetOneKeys(c) };
}

// Slack's sheet 1: the account's app manifest to paste into Slack (escaped text in a <pre>, with Copy), then the two tokens
function slackSheetOne(c, manifest) {
  const shown = manifest
    ? `<div class="field"><span class="field-label">App manifest</span><pre class="identity-manifest" id="identity-manifest" tabindex="0">${esc(manifest)}</pre>` +
      `<span class="btn-row">${button(c.copied === true ? 'Copied' : 'Copy', { 'data-action': 'identityCopyManifest' })}</span></div>`
    : note(NO_MANIFEST);
  const fields = tokenField('identity-app-token', 'App-level token (xapp-…)', c) + tokenField('identity-bot-token', 'Bot token (xoxb-…)', c);
  return { body: `${shown}${fields}${lineBox(KEPT)}`, keys: sheetOneKeys(c) };
}

// the bot's page at its network, drawn only when it is the shape that network's link has: the href, the words and the QR's alt
function linkOf(p, net) {
  const link = str(p.link);
  if (net === 'slack') {
    if (!APP_REDIRECT.test(link)) return null;
    const ws = str(p.workspace) || str(p.bot?.workspace);
    return { href: link, words: ws ? `Open Gravit in ${ws}` : 'Open Gravit in Slack', alt: ws ? `QR code for Gravit's app in ${ws}` : "QR code for Gravit's app" };
  }
  const m = T_ME.exec(link);
  return m ? { href: link, words: `t.me/${m[1]}`, alt: `QR code for t.me/${m[1]}` } : null;
}

function sheetTwo(c) {
  const p = c.pending ?? {};
  const net = networkOfConnect(c);
  const l = linkOf(p, net);
  const link = l ? `<p><a${attrs({ href: l.href, target: '_blank', rel: 'noopener noreferrer' })}>${esc(l.words)}</a></p>` : '';
  const qr = l && typeof p.qr === 'string' && p.qr.startsWith(QR_PREFIX) ? `<img${attrs({ class: 'identity-qr', src: p.qr, alt: l.alt, width: '180', height: '180' })}>` : '';
  const ws = net === 'slack' ? str(p.workspace) || str(p.bot?.workspace) : '';
  const until = etClock(p.expiresAt);
  const lines = [
    ws ? `<p class="sheet-hint">${esc(`Workspace: ${ws}`)}</p>` : '',
    until ? `<p class="sheet-hint">${esc(`This connection waits until ${until} ET; after that, start again.`)}</p>` : '',
    p.state === 'conflict' ? note(CONFLICT_WORDS[net]) : '',
    c.silent === true ? note(SILENT_WORDS) : '',
  ].join('');
  return { body: `${link}${qr}${lines}`, keys: [button('Back', { 'data-action': 'identityBack' }), button('Cancel', { 'data-action': 'identityClose' })] };
}

// sheet 3: Telegram's sender by their masked id; Slack's by the full user id beside the name and @name, so the operator can check it
// against their Slack profile (display names are not unique)
function sheetThree(c) {
  const s = c.pending?.sender ?? {};
  const id = networkOfConnect(c) === 'slack' ? `Slack id: ${str(s.userId) || '—'}` : `Telegram id: ${str(s.masked) || '…'}`;
  const rows = [`Name: ${str(s.name) || '—'}`, `Handle: ${str(s.handle) || 'none'}`, id, `Message: ${str(s.text) || '—'}`];
  return {
    body: lineBox(rows),
    keys: [button('Back', { 'data-action': 'identityBack', disabled: c.busy === true }), button('Cancel', { 'data-action': 'identityClose' }),
      button('Not me', { 'data-action': 'identityNotMe', disabled: c.busy === true }), primary('This is me', { 'data-action': 'identityThisIsMe', disabled: c.busy === true })],
  };
}

/** The connect drawer (sheets 1 to 3, Telegram's or Slack's) while one is open: its title, its body, the account's words when it
 *  refused or the connection is gone (with Start again from sheet 2 on), its numbered steps, then its keys. None open: nothing. */
export function renderConnectDrawer(state) {
  const c = state.identity?.connect;
  const net = networkOfConnect(c);
  if (!c || !CONNECT_TITLES[net][c.step]) return '';
  const title = CONNECT_TITLES[net][c.step];
  const sheet = c.step === 1 ? (net === 'slack' ? slackSheetOne(c, identityOf(state.identity?.data).slackManifest) : sheetOne(c)) : c.step === 2 ? sheetTwo(c) : sheetThree(c);
  const error = typeof c.error === 'string' && c.error ? note(c.error) : '';
  const again = error && c.step > 1 ? `<div class="btn-row">${button('Start again', { 'data-action': 'identityStartAgain' })}</div>` : '';
  return `<aside${attrs({ class: 'drawer sheet', 'aria-label': title })}><div class="drawer-head"><h2>${esc(title)}</h2><button type="button" class="close-key" data-action="identityClose" aria-label="Close">×</button></div>` +
    `<div class="drawer-body">${sheet.body}${error}${again}${stepsList(CONNECT_STEPS[net][c.step])}<div class="btn-row">${sheet.keys.join('')}</div></div></aside>`;
}
