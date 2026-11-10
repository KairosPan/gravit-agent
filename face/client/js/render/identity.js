// face/client/js/render/identity.js — Account › Identity (plan B1b Task 1), the seventh tab: three cardboxes over the account's
// identity read (host/identity-view.js) — Gravit (the networks Gravit speaks on: Telegram, iMessage and Slack, each connected or
// not, with Details and Connect… (Telegram's and iMessage's), Install app… (Slack's, plan B2 Task 7) or Disconnect…, which asks once
// in its place; a connected iMessage says it runs via Photon), What reaches you where (the five routing rows by network, the face
// always on; Save while the ticks differ from the account's; quiet hours on New York's clock, with Change… opening their two clocks,
// Off and Save in place) and Not you · n (the strangers who wrote to the bot, each with Block, which asks once in its place). Since
// sign-only-money every key is drawn for any page, signing or not: none of these acts is signed. The account not answering draws no
// connection.
// And the connect sheets 1 to 3 as a drawer of their own (Task 2; Slack's in plan B2 Task 7; iMessage's in the iMessage plan):
// Telegram's Bot token (a password field), Slack's App tokens (the account's app manifest with Copy, then two password fields) or
// iMessage's Photon project (what Photon is, its project ID, secret and the operator's number), Say hi (the bot's t.me link, the app's
// app_redirect link or the line's sms: link, and its QR as an <img> of the account's SVG data URL, never markup), Is this you? — each
// ending with its numbered steps above its keys; This is me connects there.
import { esc, attrs } from '../html.js';
import { icon } from '../icons.js';
import { fmtClock, fmtDate, sameDay } from '../time.js';
import { chip } from './thread.js';
import { confirmPair } from './controls.js';
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
const button = (word, data, klass = 'btn-sm') => `<button${attrs({ type: 'button', class: klass, ...data })}>${esc(word)}</button>`;
const keys = (...k) => (k.some(Boolean) ? `<span class="btn-row">${k.join('')}</span>` : '');
const OFF = { disabled: true, 'aria-disabled': 'true' };
const NETWORK_NAME = Object.fromEntries(NETWORKS);
const quietWords = () => t('identity.quiet.words');

// ── Gravit: the networks ──

// a network's row: not connected (Connect… for Telegram and iMessage, Install app… for Slack), or connected with its lines (iMessage's
// via Photon, its fingerprint the project secret's), Details and Disconnect… — asked once, what goes said in its place
const connectKey = net => (net === 'slack' ? t('identity.install') : t('identity.connect'));
const detailsOpen = (details, net) => details === true || (details !== null && typeof details === 'object' && details[net] === true);
function networkRow(net, row, state) {
  const name = NETWORK_NAME[net] ?? net;
  const named = { 'data-network': net };
  if (row.state !== 'connected') {
    return `<div class="venue" data-network="${esc(net)}"><span>${lines(GLYPH[net], name, [t('identity.notConnected')])}</span>` +
      `${keys(button(connectKey(net), { 'data-action': 'identityConnect', ...named }))}</div>`;
  }
  const open = detailsOpen(state.identity.details, net);
  const status = row.problem ?? (row.polling ? t('identity.telegram.polling') : t('identity.telegram.notPolling'));
  const imessage = net === 'imessage';
  const print = !row.fingerprint ? '' : imessage ? t('identity.imessage.secret', { fingerprint: row.fingerprint }) : t('identity.telegram.token', { fingerprint: row.fingerprint });
  const since = [dateWord(row.since) ? t('identity.telegram.since', { date: dateWord(row.since) }) : '', print, status].filter(Boolean).join(' · '); // words-order: a network's facts under the visual separator
  const dims = [t('identity.telegram.speaksAs', { who: row.speaksAs || '—' }), t('identity.telegram.talksWith', { who: row.talksOnlyWith || '—' }), imessage ? t('identity.viaPhoton') : '', row.problem ?? '', open ? since : ''];
  return `<div class="venue" data-network="${esc(net)}"><span>${lines(GLYPH[net], name, dims, t('identity.connected'))}</span>` +
    `${keys(button(t('identity.details'), { 'data-action': 'identityDetails', 'aria-expanded': open ? 'true' : 'false', ...named }), disconnectKey(net, name, state))}</div>`;
}
function disconnectKey(net, name, state) {
  const c = state.confirm;
  return c?.action === 'identityDisconnect' && c.network === net
    ? `<span class="dim">${esc(t('identity.confirm.disconnect', { network: name }))}</span>${confirmPair(t('identity.confirm.disconnectYes'))}` +
      // iMessage's number stays registered in the operator's own Photon project: said beneath the ask
      (net === 'imessage' ? `<br><span class="dim">${esc(t('identity.confirm.photonStays'))}</span>` : '')
    : button(t('identity.disconnect'), { 'data-action': 'askIdentityDisconnect', 'data-network': net }, 'btn-danger');
}
// an act's words where it was pressed (host/identity.js): the account's refusal, or why it was not sent
const saidAt = (state, at) => (state.identity.said?.at === at && sayOf(state.identity.said.words) ? note(sayOf(state.identity.said.words)) : '');

function gravitCard(v, state) {
  const rows = NETWORKS.map(([net]) => networkRow(net, v.networks[net], state)).join('');
  return box(`${title(HOST_NAME)}${note(t('identity.gravit.note', { name: HOST_NAME }))}<div class="venues">${rows}</div>${saidAt(state, 'networks')}`, HOST_NAME);
}

// ── What reaches you where: the grid and quiet hours ──

function gridCard(v, state) {
  const tick = (on, enabled, label, data) => `<input${attrs({ type: 'checkbox', 'aria-label': label, checked: on, ...(enabled ? data : OFF) })}>`;
  const nameOf = net => NETWORK_NAME[net];
  const head = [th('identity.grid.face'), ...NETWORKS.map(([, name]) => name)].map(h => `<th scope="col">${h}</th>`).join('');
  const cell = (g, net) => `<td>${tick(g[net].on, g[net].enabled, t('identity.grid.onNetwork', { label: g.label, network: nameOf(net) }), { 'data-action': 'identityTick', 'data-row': g.row, 'data-network': net })}</td>`;
  const rows = v.grid.map(g => `<tr><td>${esc(g.label)}</td>` +
    `<td>${tick(true, false, t('identity.grid.inFace', { label: g.label }), {})}</td>` +
    `${NETWORKS.map(([net]) => cell(g, net)).join('')}</tr>`).join('');
  const table = `<div class="acct-wrap"><table class="acct-t"><thead><tr><th scope="col">${th('identity.grid.what')}</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
  const draft = state.identity.draft;
  const changed = draft !== null && draft !== undefined && !sameRouting(draft, routingOf(state.identity.data));
  const save = changed ? `${note(t('identity.grid.notSaved'))}<div class="btn-row">${button(t('identity.grid.save'), { 'data-action': 'identitySave' })}</div>` : '';
  const hours = v.quiet ? t('identity.quiet.range', { from: v.quiet.from, to: v.quiet.to }) : t('identity.quiet.off');
  const editing = state.identity.quietEdit === true;
  const quiet = `<div class="venues"><div class="venue"><span><b>${th('identity.quiet.title')}</b><br><span class="dim">${esc(hours)}</span><br><span class="dim">${esc(quietWords())}</span></span>` +
    `${keys(editing ? '' : button(t('identity.quiet.change'), { 'data-action': 'identityQuietEdit' }))}</div></div>${editing ? quietEditor(state.identity.quietDraft, v.quiet) : ''}`;
  return box(`${title(t('identity.grid.title'))}${table}${save}${saidAt(state, 'grid')}${quiet}${saidAt(state, 'quiet')}`, t('identity.grid.title'));
}

// quiet hours' editor (Change…): two clocks of New York's day and Off, drawn from the store's draft (seeded from the account's; none
// held, the account's); Save applies at once
function quietEditor(draft, q) {
  const d = draft ?? (q ? { from: q.from, to: q.to, off: false } : { from: '', to: '', off: true });
  const field = name => ({ name, 'data-action': 'identityQuietField' });
  const clock = (id, name, label, value) => `<label class="field"><span class="field-label">${esc(label)}</span><input${attrs({ id, class: 'input', type: 'time', value, ...field(name) })}></label>`;
  return `<div class="identity-quiet">${clock('identity-quiet-from', 'from', t('identity.quiet.from'), d.from)}${clock('identity-quiet-to', 'to', t('identity.quiet.to'), d.to)}` +
    `<label class="sheet-check"><input${attrs({ id: 'identity-quiet-off', type: 'checkbox', checked: d.off === true, ...field('off') })}>${esc(t('identity.quiet.offTick'))}</label>` +
    `<div class="btn-row">${button(t('common.cancel'), { 'data-action': 'identityQuietCancel' })}${button(t('identity.quiet.save'), { 'data-action': 'identityQuietSave' }, 'btn-primary')}</div></div>`;
}

// ── Not you: the strangers ──

function notYouCard(v, state, now) {
  const n = v.strangers.length;
  const rows = v.strangers.map(s => {
    const words = [NETWORK_NAME[s.network] ?? s.network, s.masked || '…', tn('identity.strangers.messages', s.count), when(s.last, now) ? t('identity.strangers.last', { when: when(s.last, now) }) : ''].filter(Boolean).join(' · '); // words-order: a stranger's facts under the visual separator
    return `<div class="venue"><span>${esc(words)}</span>` +
      `${keys(blockKey(s, state))}</div>`;
  }).join('');
  const body = n ? `${note(t('identity.strangers.note', { name: HOST_NAME }))}<div class="venues">${rows}</div>` : note(t('identity.strangers.none', { name: HOST_NAME }));
  return box(`${title(t('identity.strangers.title', { n }))}${body}${saidAt(state, 'strangers')}`, t('identity.strangers.label'));
}
// a stranger's Block, asked once, what it does said in its place
function blockKey(s, state) {
  const c = state.confirm;
  return c?.action === 'identityBlock' && c.network === s.network && c.sender === s.sender
    ? `<span class="dim">${esc(t('identity.confirm.block', { sender: s.masked || '…' }))}</span>${confirmPair(t('identity.confirm.blockYes'))}`
    : button(t('identity.strangers.block'), { 'data-action': 'askIdentityBlock', 'data-network': s.network, 'data-sender': s.sender, 'data-masked': s.masked });
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
  const v = identityOf(r.data, r.draft ?? null, clockWord, now);
  if (!v.ok) return `${note(t('identity.unreadable'))}${retry}`;
  return `<div class="cards">${gravitCard(v, state)}${gridCard(v, state)}${notYouCard(v, state, now)}</div>`;
}

// ── Connect Telegram, Slack and iMessage: its three sheets, the Identity drawer (plan B1b Task 2, spec §5.2; Slack's plan B2 Task 7;
// iMessage's the iMessage plan; since sign-only-money This is me connects, no fourth sheet) ──

/** Sheets 1 to 3's numbered steps by network (Telegram's when none is named), fixed copy: each sheet ends with them above its keys.
 *  Any other step: none. */
export function connectSteps(step, net = 'telegram') {
  const name = HOST_NAME;
  if (net === 'imessage') {
    if (step === 1) return [t('identity.imessageSteps.signup', { name }), t('identity.imessageSteps.project'), t('identity.imessageSteps.copy')];
    if (step === 2) return [t('identity.imessageSteps.text', { name }), t('identity.imessageSteps.wait', { name })];
    if (step === 3) return [t('identity.imessageSteps.isMe', { name }), t('identity.imessageSteps.notMe', { name })];
    return [];
  }
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
  : net === 'imessage'
    ? (step === 1 ? t('identity.sheet.imessageOne') : step === 2 ? t('identity.sheet.imessageTwo') : step === 3 ? t('identity.sheet.imessageThree') : '')
    : (step === 1 ? t('identity.sheet.one') : step === 2 ? t('identity.sheet.two') : step === 3 ? t('identity.sheet.three') : ''));
const QR_PREFIX = 'data:image/svg+xml;base64,';
const T_ME = /^https:\/\/t\.me\/([A-Za-z0-9_]{1,64})$/;
// Slack's app_redirect to the app's DM (account slack-api.ts slackAppLink): the app's id and the team's, nothing else
const APP_REDIRECT = /^https:\/\/slack\.com\/app_redirect\?app=[A-Z0-9]{1,32}&team=[A-Z0-9]{1,32}$/;
// iMessage's line as an sms: link (account pending.ts): Messages opens addressed to the number, E.164 and nothing else
const SMS = /^sms:(\+[1-9]\d{6,14})$/;
// Photon's console, where a project is made (sheet 1's link)
const PHOTON_URL = 'https://app.photon.codes'; // en-kept: Photon's address
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
const networkOfConnect = c => (c?.network === 'slack' || c?.network === 'imessage' ? c.network : 'telegram');

// a token's password field (or, for iMessage's project ID and number, a plain one): no <form> round it, so a browser sees no login to
// offer to keep (its password managers are told the same); Enter in it is Next, or on to the next field (app.js's keydown)
function tokenField(id, label, c, type = 'password') {
  return `<div class="field"><label class="field-label" for="${esc(id)}">${esc(label)}</label>` +
    `<input${attrs({
      id, class: 'input', type, autocomplete: 'off', spellcheck: 'false', 'aria-label': label,
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

// iMessage's sheet 1: one line on Photon, then its guide on top (the first step carrying the button to Photon's console), the project
// ID, the secret (a password field) and the operator's number, and where the secret is kept and where it never goes
function imessageSheetOne(c) {
  const [first, ...rest] = connectSteps(1, 'imessage');
  const open = `<a${attrs({ class: 'btn-sm sheet-link', href: PHOTON_URL, target: '_blank', rel: 'noopener noreferrer' })}>${esc(t('identity.photon.open'))} ↗</a>`;
  const guide = `<ol class="sheet-steps"><li>${esc(first)}<div class="btn-row">${open}</div></li>${rest.map(r => `<li>${esc(r)}</li>`).join('')}</ol>`;
  const fields = tokenField('identity-photon-project', t('identity.token.projectLabel'), c, 'text') + tokenField('identity-photon-secret', t('identity.token.secretLabel'), c) +
    tokenField('identity-photon-phone', t('identity.token.phoneLabel'), c, 'tel');
  return { body: `${note(t('identity.photon.signup', { name: HOST_NAME }))}${guide}${fields}${lineBox(kept())}`, keys: sheetOneKeys(c), stepsShown: true };
}

// the bot's page at its network, drawn only when it is the shape that network's link has: the href, the anchor's words and the QR's alt
function linkOf(p, net) {
  const link = str(p.link);
  if (net === 'imessage') {
    const m = SMS.exec(link);
    return m ? { href: link, anchor: t('identity.sheet.textHi', { line: m[1] }), alt: t('identity.sheet.qrSms', { line: m[1] }) } : null;
  }
  if (net === 'slack') {
    if (!APP_REDIRECT.test(link)) return null;
    const ws = str(p.workspace) || str(p.bot?.workspace);
    const name = HOST_NAME;
    return {
      href: link,
      anchor: ws ? t('identity.sheet.openIn', { name, workspace: ws }) : t('identity.sheet.openInSlack', { name }),
      alt: ws ? t('identity.sheet.qrApp', { name, workspace: ws }) : t('identity.sheet.qrAppAny', { name }),
    };
  }
  const m = T_ME.exec(link);
  const shown = m ? `t.me/${m[1]}` : '';
  return m ? { href: link, anchor: shown, alt: t('identity.sheet.qr', { link: shown }) } : null;
}

function sheetTwo(c) {
  const p = c.pending ?? {};
  const net = networkOfConnect(c);
  const l = linkOf(p, net);
  const link = l ? `<p><a${attrs({ href: l.href, target: '_blank', rel: 'noopener noreferrer' })}>${esc(l.anchor)}</a></p>` : '';
  const qr = l && typeof p.qr === 'string' && p.qr.startsWith(QR_PREFIX) ? `<img${attrs({ class: 'identity-qr', src: p.qr, alt: l.alt, width: '180', height: '180' })}>` : '';
  const ws = net === 'slack' ? str(p.workspace) || str(p.bot?.workspace) : '';
  const until = etClock(p.expiresAt);
  const lines = [
    ws ? `<p class="sheet-hint">${esc(t('identity.sheet.workspace', { workspace: ws }))}</p>` : '',
    until ? `<p class="sheet-hint">${esc(t('identity.sheet.until', { until }))}</p>` : '',
    p.state === 'conflict' ? note(conflictWords(net)) : '',
    net === 'imessage' && str(p.strangerHeard?.masked) ? note(t('identity.sheet.otherSender', { masked: p.strangerHeard.masked })) : '',
    c.silent === true ? note(silentWords()) : '',
  ].join('');
  return { body: `${link}${qr}${lines}`, keys: [button(t('identity.sheet.back'), { 'data-action': 'identityBack' }), button(t('common.cancel'), { 'data-action': 'identityClose' })] };
}

// sheet 3 (This is me connects there): Telegram's sender by their masked id; Slack's by the full user id beside the name and @name, so the operator can check it
// against their Slack profile (display names are not unique); iMessage's by the number heard alone
function sheetThree(c) {
  const s = c.pending?.sender ?? {};
  const net = networkOfConnect(c);
  const id = net === 'slack' ? t('identity.sender.slackId', { id: str(s.userId) || '—' }) : t('identity.sender.id', { id: str(s.masked) || '…' });
  const rows = net === 'imessage'
    ? [t('identity.sender.number', { number: str(s.handle) || '—' }), t('identity.sender.message', { text: str(s.text) || '—' })]
    : [t('identity.sender.name', { name: str(s.name) || '—' }), t('identity.sender.handle', { handle: str(s.handle) || t('identity.sender.none') }),
      id, t('identity.sender.message', { text: str(s.text) || '—' })];
  // Slack's: the phone's commands typed with ! there (plan B2 Task 7; Slack's composer takes a leading / as its own)
  const bang = net === 'slack' ? `<p class="sheet-hint">${esc(t('identity.sheet.slackNote'))}</p>` : '';
  return {
    body: `${lineBox(rows)}${bang}`,
    keys: [button(t('identity.sheet.back'), { 'data-action': 'identityBack', disabled: c.busy === true }), button(t('common.cancel'), { 'data-action': 'identityClose' }),
      button(t('identity.sheet.notMe'), { 'data-action': 'identityNotMe', disabled: c.busy === true }), primary(t('identity.sheet.isMe'), { 'data-action': 'identityThisIsMe', disabled: c.busy === true })],
  };
}

/** The connect drawer (sheets 1 to 3, Telegram's, Slack's or iMessage's) while one is open: its title, its body, the account's words when it
 *  refused or the connection is gone (with Start again from sheet 2 on), its numbered steps, then its keys. None open: nothing. */
export function renderConnectDrawer(state) {
  const c = state.identity?.connect;
  const net = networkOfConnect(c);
  const title = c ? connectTitle(c.step, net) : '';
  if (!title) return '';
  const one = () => (net === 'slack' ? slackSheetOne(c, identityOf(state.identity?.data).slackManifest) : net === 'imessage' ? imessageSheetOne(c) : sheetOne(c));
  const sheet = c.step === 1 ? one() : c.step === 2 ? sheetTwo(c) : sheetThree(c);
  const error = sayOf(c.error) ? note(sayOf(c.error)) : '';
  const again = error && c.step > 1 ? `<div class="btn-row">${button(t('identity.sheet.again'), { 'data-action': 'identityStartAgain' })}</div>` : '';
  return `<aside${attrs({ class: 'drawer sheet', 'aria-label': title })}><div class="drawer-head"><h2>${esc(title)}</h2><button type="button" class="close-key" data-action="identityClose" aria-label="${th('common.close')}">×</button></div>` +
    `<div class="drawer-body">${sheet.body}${error}${again}${sheet.stepsShown ? '' : stepsList(connectSteps(c.step, net))}<div class="btn-row">${sheet.keys.join('')}</div></div></aside>`;
}
