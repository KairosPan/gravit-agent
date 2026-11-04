// face/client/js/render/identity.js — Account › Identity (plan B1b Task 1), the seventh tab: three cardboxes over the account's
// identity read (host/identity-view.js) — Gravit (the networks Gravit speaks on: Telegram connected or not, with Details and, on a
// page that signs, Connect… or Disconnect…; iMessage Later, with no key; Slack Soon, its Connect… disabled), What reaches you where
// (the five routing rows by network, the face always on; quiet hours on New York's clock; Save… while the ticks differ from the
// account's) and Not you · n (the strangers who wrote to the bot, each with Block). The owner's keys are drawn only while the page
// signs; a page that does not reads the same cards with one line saying so. The account not answering draws no connection.
import { esc, attrs } from '../html.js';
import { icon } from '../icons.js';
import { fmtClock, fmtDate, sameDay } from '../time.js';
import { chip } from './thread.js';
import { identityOf, NETWORKS, routingOf, sameRouting } from '../host/identity-view.js';

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
    `${keys(button('Details', { 'data-action': 'identityDetails', 'aria-expanded': open ? 'true' : 'false' }), owner ? sheetKey('disconnect', named, 'Disconnect…', 'btn-danger') : '')}</div>`;
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
  const v = identityOf(r.data, r.draft ?? null, clockWord);
  if (!v.ok) return `${note('Identity unreadable')}${retry}`;
  const owner = signs(state);
  return `<div class="cards">${gravitCard(v, state, owner)}${gridCard(v, state, owner)}${notYouCard(v, owner, now)}</div>`;
}
