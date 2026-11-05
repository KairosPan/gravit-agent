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
import { HOST_NAME } from '../wire/speaker.js';
import { t, th, tn, sayOf } from '../i18n/words.js';

const str = v => (typeof v === 'string' ? v : '');
const box = (inner, label) => `<section class="cardbox" aria-label="${esc(label)}">${inner}</section>`;
const note = text => `<p class="acct-note">${esc(text)}</p>`;
const title = text => `<div class="cardbox-title">${esc(text)}</div>`;
const when = (at, now) => { const ms = Date.parse(at); return Number.isNaN(ms) ? '' : sameDay(ms, now) ? fmtClock(ms) : t('time.dayClock', { day: fmtDate(ms), clock: fmtClock(ms) }); };
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
const NETWORK_NAME = Object.fromEntries(NETWORKS);
const readOnly = () => t('identity.readOnly');
const quietWords = () => t('identity.quiet.words');

// ── Gravit: the networks ──

// a network's row: not connected (Connect… for Telegram, Install app… for Slack), or connected with its lines, Details and Disconnect…
const connectKey = net => (net === 'slack' ? t('identity.install') : t('identity.connect'));
const detailsOpen = (details, net) => details === true || (details !== null && typeof details === 'object' && details[net] === true);
function networkRow(net, row, state, owner) {
  const name = NETWORK_NAME[net] ?? net;
  const named = { 'data-network': net };
  if (row.state !== 'connected') {
    return `<div class="venue" data-network="${esc(net)}"><span>${lines(GLYPH[net], name, [t('identity.notConnected')])}</span>` +
      `${keys(owner ? button(connectKey(net), { 'data-action': 'identityConnect', ...named }) : '')}</div>`;
  }
  const open = detailsOpen(state.identity.details, net);
  const status = row.problem ?? (row.polling ? t('identity.telegram.polling') : t('identity.telegram.notPolling'));
  const since = [dateWord(row.since) ? t('identity.telegram.since', { date: dateWord(row.since) }) : '', row.fingerprint ? t('identity.telegram.token', { fingerprint: row.fingerprint }) : '', status].filter(Boolean).join(' · '); // words-order: a network's facts under the visual separator
  const dims = [t('identity.telegram.speaksAs', { who: row.speaksAs || '—' }), t('identity.telegram.talksWith', { who: row.talksOnlyWith || '—' }), row.problem ?? '', open ? since : ''];
  return `<div class="venue" data-network="${esc(net)}"><span>${lines(GLYPH[net], name, dims, t('identity.connected'))}</span>` +
    `${keys(button(t('identity.details'), { 'data-action': 'identityDetails', 'aria-expanded': open ? 'true' : 'false', ...named }), owner ? sheetKey('disconnectNetwork', named, t('identity.disconnect'), 'btn-danger') : '')}</div>`;
}

function gravitCard(v, state, owner) {
  const rows = NETWORKS.map(([net, name]) => {
    if (net === 'telegram' || net === 'slack') return networkRow(net, v.networks[net], state, owner);
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
    `<td>${tick(false, false, t('identity.grid.onNetwork', { label: g.label, network: nameOf('imessage') }), {})}</td>` +
    `<td>${tick(g.slack.on, owner && g.slack.enabled, t('identity.grid.onNetwork', { label: g.label, network: nameOf('slack') }), { 'data-action': 'identityTick', 'data-row': g.row, 'data-network': 'slack' })}</td></tr>`).join('');
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

function notYouCard(v, owner, now) {
  const n = v.strangers.length;
  const rows = v.strangers.map(s => {
    const words = [NETWORK_NAME[s.network] ?? s.network, s.masked || '…', tn('identity.strangers.messages', s.count), when(s.last, now) ? t('identity.strangers.last', { when: when(s.last, now) }) : ''].filter(Boolean).join(' · '); // words-order: a stranger's facts under the visual separator
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

// ── Connect Telegram and Connect Slack: sheets 1 to 3, the Identity drawer (plan B1b Task 2, spec §5.2; Slack's plan B2 Task 7; sheet
// 4 is the owner sheet) ──

/** Sheets 1 to 3's numbered steps by network (Telegram's when none is named), fixed copy: each sheet ends with them above its keys.
 *  Any other step: none. */
export function connectSteps(step, net = 'telegram') {
  const name = HOST_NAME;
  if (net === 'slack') {
    if (step === 1) return [t('identity.slackSteps.create'), t('identity.slackSteps.manifest'), t('identity.slackSteps.appToken'), t('identity.slackSteps.botToken'), t('identity.slackSteps.paste', { name })];
    if (step === 2) return [t('identity.slackSteps.open', { name }), t('identity.slackSteps.send'), t('identity.slackSteps.wait')];
    if (step === 3) return [t('identity.steps.check'), t('identity.slackSteps.isMe', { name }), t('identity.slackSteps.notMe', { name })];
    return [];
  }
  if (step === 1) {
    // the suffix is the one Telegram asks a bot's username to end in, quoted as typed
    return [t('identity.steps.newbot'), t('identity.steps.name', { name, suffix: '"bot"' }), t('identity.steps.token'), t('identity.steps.paste', { name })];
  }
  if (step === 2) return [t('identity.steps.open', { name }), t('identity.steps.start'), t('identity.steps.wait')];
  if (step === 3) return [t('identity.steps.check'), t('identity.steps.isMe', { name }), t('identity.steps.notMe', { name })];
  return [];
}
const connectTitle = (step, net) => (net === 'slack'
  ? (step === 1 ? t('identity.sheet.slackOne') : step === 2 ? t('identity.sheet.slackTwo') : step === 3 ? t('identity.sheet.slackThree') : '')
  : (step === 1 ? t('identity.sheet.one') : step === 2 ? t('identity.sheet.two') : step === 3 ? t('identity.sheet.three') : ''));
const QR_PREFIX = 'data:image/svg+xml;base64,';
const T_ME = /^https:\/\/t\.me\/([A-Za-z0-9_]{1,64})$/;
// Slack's app_redirect to the app's DM (account slack-api.ts slackAppLink): the app's id and the team's, nothing else
const APP_REDIRECT = /^https:\/\/slack\.com\/app_redirect\?app=[A-Z0-9]{1,32}&team=[A-Z0-9]{1,32}$/;
const conflictWords = net => (net === 'slack' ? t('identity.sheet.slackConflict') : t('identity.sheet.conflict'));
const silentWords = () => t('identity.sheet.silent');
const noManifest = () => t('identity.manifest.none');
const kept = () => [t('identity.token.keptIn'), t('identity.token.neverIn', { name: HOST_NAME })];

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
const networkOfConnect = c => (c?.network === 'slack' ? 'slack' : 'telegram');

// a token's password field: no <form> round it, so a browser sees no login to offer to keep (its password managers are told the same);
// Enter in it is Next, or on to the next field (app.js's keydown)
function tokenField(id, label, c) {
  return `<div class="field"><label class="field-label" for="${esc(id)}">${esc(label)}</label>` +
    `<input${attrs({
      id, class: 'input', type: 'password', autocomplete: 'off', spellcheck: 'false', 'aria-label': label,
      'data-lpignore': 'true', 'data-1p-ignore': 'true', 'data-form-type': 'other', disabled: c.busy === true,
    })}>` +
    `<span class="btn-row">${button(t('identity.token.paste'), { 'data-field': id, 'data-action': 'identityPaste', disabled: c.busy === true })}</span></div>`;
}
const sheetOneKeys = c => [button(t('common.cancel'), { 'data-action': 'identityClose' }), primary(c.busy ? t('identity.token.checking') : t('identity.token.next'), { 'data-action': 'identityNext', disabled: c.busy === true })];

function sheetOne(c) {
  return { body: `${tokenField('identity-token', t('identity.token.label'), c)}${lineBox(kept())}`, keys: sheetOneKeys(c) };
}

// Slack's sheet 1: the account's app manifest to paste into Slack (escaped text in a <pre>, with Copy), then the two tokens
function slackSheetOne(c, manifest) {
  const shown = manifest
    ? `<div class="field"><span class="field-label">${th('identity.manifest.label')}</span><pre class="identity-manifest" id="identity-manifest" tabindex="0">${esc(manifest)}</pre>` +
      `<span class="btn-row">${button(c.copied === true ? t('identity.manifest.copied') : t('identity.manifest.copy'), { 'data-action': 'identityCopyManifest' })}</span></div>`
    : note(noManifest());
  const fields = tokenField('identity-app-token', t('identity.token.appLabel'), c) + tokenField('identity-bot-token', t('identity.token.botLabel'), c);
  return { body: `${shown}${fields}${lineBox(kept())}`, keys: sheetOneKeys(c) };
}

// the bot's page at its network, drawn only when it is the shape that network's link has: the href, the words and the QR's alt
function linkOf(p, net) {
  const link = str(p.link);
  if (net === 'slack') {
    if (!APP_REDIRECT.test(link)) return null;
    const ws = str(p.workspace) || str(p.bot?.workspace);
    const name = HOST_NAME;
    return {
      href: link,
      words: ws ? t('identity.sheet.openIn', { name, workspace: ws }) : t('identity.sheet.openInSlack', { name }),
      alt: ws ? t('identity.sheet.qrApp', { name, workspace: ws }) : t('identity.sheet.qrAppAny', { name }),
    };
  }
  const m = T_ME.exec(link);
  const shown = m ? `t.me/${m[1]}` : '';
  return m ? { href: link, words: shown, alt: t('identity.sheet.qr', { link: shown }) } : null;
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
    ws ? `<p class="sheet-hint">${esc(t('identity.sheet.workspace', { workspace: ws }))}</p>` : '',
    until ? `<p class="sheet-hint">${esc(t('identity.sheet.until', { until }))}</p>` : '',
    p.state === 'conflict' ? note(conflictWords(net)) : '',
    c.silent === true ? note(silentWords()) : '',
  ].join('');
  return { body: `${link}${qr}${lines}`, keys: [button(t('identity.sheet.back'), { 'data-action': 'identityBack' }), button(t('common.cancel'), { 'data-action': 'identityClose' })] };
}

// sheet 3: Telegram's sender by their masked id; Slack's by the full user id beside the name and @name, so the operator can check it
// against their Slack profile (display names are not unique)
function sheetThree(c) {
  const s = c.pending?.sender ?? {};
  const id = networkOfConnect(c) === 'slack' ? t('identity.sender.slackId', { id: str(s.userId) || '—' }) : t('identity.sender.id', { id: str(s.masked) || '…' });
  const rows = [t('identity.sender.name', { name: str(s.name) || '—' }), t('identity.sender.handle', { handle: str(s.handle) || t('identity.sender.none') }),
    id, t('identity.sender.message', { text: str(s.text) || '—' })];
  return {
    body: lineBox(rows),
    keys: [button(t('identity.sheet.back'), { 'data-action': 'identityBack', disabled: c.busy === true }), button(t('common.cancel'), { 'data-action': 'identityClose' }),
      button(t('identity.sheet.notMe'), { 'data-action': 'identityNotMe', disabled: c.busy === true }), primary(t('identity.sheet.isMe'), { 'data-action': 'identityThisIsMe', disabled: c.busy === true })],
  };
}

/** The connect drawer (sheets 1 to 3, Telegram's or Slack's) while one is open: its title, its body, the account's words when it
 *  refused or the connection is gone (with Start again from sheet 2 on), its numbered steps, then its keys. None open: nothing. */
export function renderConnectDrawer(state) {
  const c = state.identity?.connect;
  const net = networkOfConnect(c);
  const title = c ? connectTitle(c.step, net) : '';
  if (!title) return '';
  const sheet = c.step === 1 ? (net === 'slack' ? slackSheetOne(c, identityOf(state.identity?.data).slackManifest) : sheetOne(c)) : c.step === 2 ? sheetTwo(c) : sheetThree(c);
  const error = sayOf(c.error) ? note(sayOf(c.error)) : '';
  const again = error && c.step > 1 ? `<div class="btn-row">${button(t('identity.sheet.again'), { 'data-action': 'identityStartAgain' })}</div>` : '';
  return `<aside${attrs({ class: 'drawer sheet', 'aria-label': title })}><div class="drawer-head"><h2>${esc(title)}</h2><button type="button" class="close-key" data-action="identityClose" aria-label="${th('common.close')}">×</button></div>` +
    `<div class="drawer-body">${sheet.body}${error}${again}${stepsList(connectSteps(c.step, net))}<div class="btn-row">${sheet.keys.join('')}</div></div></aside>`;
}
