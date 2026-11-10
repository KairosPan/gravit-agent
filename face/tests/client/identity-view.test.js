// Account › Identity (plan B1b Task 1): the account's GET /api/account/identity read through the face's proxy, drawn as three cards —
// Gravit (the networks: Telegram, iMessage and Slack, each connected or not), What reaches you where (the five routing rows and
// quiet hours) and Not you (the strangers, each with Block) — every key on any page since sign-only-money: none is signed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identityOf, formatRouting, routingOf, tickRouting, routeRows, NETWORKS } from '../../client/js/host/identity-view.js';
import { renderIdentityTab } from '../../client/js/render/identity.js';
import { reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { esc } from '../../client/js/html.js';
import { fmtClock, fmtDate } from '../../client/js/time.js';
import { t } from '../../client/js/i18n/words.js';

const NOW = Date.parse('2026-11-04T15:00:00.000Z');
const CJK = /[㐀-鿿]/;
const re = w => new RegExp(esc(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const ROUTING = { chat: ['telegram'], alerts: ['telegram'], brief: [], cards: ['telegram'], fills: ['telegram'] };
const NONE_ROUTING = { chat: [], alerts: [], brief: [], cards: [], fills: [] };
const CONNECTED = {
  ok: true,
  networks: [{ network: 'telegram', speaksAs: '@gravit_desk_bot', talksOnlyWith: '@pan', since: '2026-11-03T15:20:00.000Z', fingerprint: 'ab12cd34', state: 'connected', polling: true, lastPollAt: '2026-11-04T14:59:30.000Z' }],
  routing: ROUTING, quiet: { from: '23:00', to: '07:00', zone: 'America/New_York' }, strangers: [],
};
const NOT_CONNECTED = { ok: true, networks: [], routing: NONE_ROUTING, quiet: null, strangers: [] };
const STRANGER = { network: 'telegram', sender: '0123456789ab', masked: '…789', count: 3, last: '2026-11-04T13:02:00.000Z' };
const CONNECTED_WITH_STRANGER = { ...CONNECTED, strangers: [STRANGER] };

const shown = (body, tab = 'identity') => R.identityLoaded(R.nav(emptyState(), { screen: 'account', tab }), body);
const signing = body => R.ownerStanding(shown(body), { role: 'signs', kid: 'a5048199a8081854' });
const readOnly = body => R.ownerStanding(shown(body), { role: 'needs-code', kid: '' });
// a box by its aria-label
const boxOf = (html, label) => html.match(new RegExp(`<section class="cardbox" aria-label="${label}">[\\s\\S]*?</section>`))?.[0] ?? '';
// a key: a button with an action and these words
const keyed = (html, w) => new RegExp(`<button[^>]*data-action[^>]*>${esc(w)}</button>`).test(html);

test('the rows and networks are the plan\'s', () => {
  assert.deepEqual(routeRows(), [['chat', 'Chat with Gravit'], ['alerts', 'Watch alerts'], ['brief', 'Pre-close brief'], ['cards', 'Cards waiting'], ['fills', 'Fills and reports']]);
  assert.deepEqual(NETWORKS, [['telegram', 'Telegram'], ['imessage', 'iMessage'], ['slack', 'Slack']]);
});

test('formatRouting writes the account\'s string', () => {
  assert.equal(formatRouting({ chat: ['telegram'], alerts: ['telegram'], brief: [], cards: ['telegram'], fills: ['telegram'] }), 'chat=telegram;alerts=telegram;brief=;cards=telegram;fills=telegram');
  assert.equal(formatRouting({}), 'chat=;alerts=;brief=;cards=;fills=');
  assert.equal(formatRouting({ chat: ['telegram', 'telegram'], brief: ['slack', 'telegram'] }), 'chat=telegram;alerts=;brief=slack,telegram;cards=;fills=', 'sorted, each once');
  assert.equal(formatRouting(null), 'chat=;alerts=;brief=;cards=;fills=');
});

test('identityOf: a connected Telegram, Slack and iMessage not connected, the grid, quiet hours and Not you', () => {
  const v = identityOf(CONNECTED_WITH_STRANGER);
  assert.equal(v.ok, true);
  assert.deepEqual(v.networks, {
    telegram: { state: 'connected', speaksAs: '@gravit_desk_bot', talksOnlyWith: '@pan', since: '2026-11-03T15:20:00.000Z', fingerprint: 'ab12cd34', polling: true },
    imessage: { state: 'none' }, slack: { state: 'none' },
  });
  assert.deepEqual(v.grid.map(g => g.row), ['chat', 'alerts', 'brief', 'cards', 'fills']);
  assert.deepEqual(v.grid[0], { row: 'chat', label: 'Chat with Gravit', face: true, telegram: { on: true, enabled: true }, imessage: { on: false, enabled: false }, slack: { on: false, enabled: false } });
  assert.deepEqual(v.grid[2].telegram, { on: false, enabled: true });
  assert.deepEqual(v.quiet, { from: '23:00', to: '07:00' });
  assert.deepEqual(v.strangers, [STRANGER]);
  // nothing connected: Telegram none, its ticks disabled
  const n = identityOf(NOT_CONNECTED);
  assert.deepEqual(n.networks.telegram, { state: 'none' });
  assert.ok(n.grid.every(g => g.telegram.enabled === false && g.telegram.on === false));
  assert.equal(n.quiet, null);
  // a draft's ticks override the account's
  const d = identityOf(CONNECTED, { ...ROUTING, brief: ['telegram'], chat: [] });
  assert.deepEqual(d.grid.map(g => g.telegram.on), [false, true, true, true, true]);
  // an answer the face does not recognise: nothing connected
  for (const bad of [null, { ok: false }, { networks: CONNECTED.networks }, 'x']) {
    const u = identityOf(bad);
    assert.equal(u.ok, false);
    assert.equal(u.networks.telegram.state, 'none');
    assert.deepEqual(u.strangers, []);
  }
});

test('identityOf: a problem is one line, the worst first', () => {
  const net = over => identityOf({ ...CONNECTED, networks: [{ ...CONNECTED.networks[0], ...over }] }, null, () => '09:30').networks.telegram.problem;
  assert.equal(net({}), undefined);
  assert.equal(net({ blocked: true, conflictAt: 'x' }), 'You blocked the bot in Telegram: unblock it, or nothing reaches you there.');
  assert.equal(net({ conflictAt: '2026-11-04T14:30:00.000Z' }), "Another program reads this bot's messages (since 09:30): stop it, or Gravit hears nothing.");
  assert.equal(net({ pollFailing: { since: '2026-11-04T14:30:00.000Z', reason: 'ENOTFOUND' } }), 'Not hearing Telegram since 09:30: ENOTFOUND.');
});

test('routingOf and tickRouting: every row, only networks the account speaks on; a tick on or off', () => {
  assert.deepEqual(routingOf({ routing: { chat: ['telegram', 'fax'], alerts: 'x' } }), { chat: ['telegram'], alerts: [], brief: [], cards: [], fills: [] });
  assert.deepEqual(tickRouting(ROUTING, 'brief', 'telegram', true).brief, ['telegram']);
  assert.deepEqual(tickRouting(ROUTING, 'chat', 'telegram', false).chat, []);
  assert.equal(tickRouting(ROUTING, 'nope', 'telegram', true), ROUTING);
  assert.equal(tickRouting(ROUTING, 'chat', 'fax', true), ROUTING);
  assert.deepEqual(tickRouting(ROUTING, 'chat', 'slack', true).chat, ['slack', 'telegram'], 'Slack is spoken now');
});

test('a connected Telegram row: Connected, Speaks as, Talks only with, Details and Disconnect…', () => {
  const html = renderIdentityTab(signing(CONNECTED), NOW);
  for (const w of ['Telegram', 'Connected', 'Speaks as', '@gravit_desk_bot', 'Talks only with', '@pan', 'Details', 'Disconnect…']) assert.match(html, re(w));
  assert.match(html, /<button[^>]*data-action="askIdentityDisconnect" data-network="telegram"[^>]*>Disconnect…<\/button>/);
  assert.match(html, /<button[^>]*data-action="identityDetails"[^>]*>Details<\/button>/);
  // Details shut: no since line; open: Since <date> · token <fingerprint> · polling
  assert.doesNotMatch(html, /token ab12cd34/);
  const open = renderIdentityTab(R.identityDetails(signing(CONNECTED)), NOW);
  assert.match(open, re(`Since ${fmtDate(Date.parse('2026-11-03T15:20:00.000Z'))} · token ab12cd34 · polling`));
  assert.match(open, /aria-expanded="true"/);
  // a problem replaces polling, and is said on the row too
  const failing = { ...CONNECTED, networks: [{ ...CONNECTED.networks[0], polling: false, pollFailing: { since: '2026-11-04T14:30:00.000Z', reason: 'ENOTFOUND' } }] };
  const words = `Not hearing Telegram since ${fmtClock(Date.parse('2026-11-04T14:30:00.000Z'))}: ENOTFOUND.`;
  assert.match(renderIdentityTab(signing(failing), NOW), re(words));
  assert.match(renderIdentityTab(R.identityDetails(signing(failing)), NOW), re(`token ab12cd34 · ${words}`));
  // not polling and nothing wrong
  const idle = { ...CONNECTED, networks: [{ ...CONNECTED.networks[0], polling: false }] };
  assert.match(renderIdentityTab(R.identityDetails(signing(idle)), NOW), re('token ab12cd34 · not polling'));
});

test('Telegram not connected: Not connected and Connect…; Slack: Not connected and Install app…, no Soon; iMessage: Not connected and Connect…, never Later', () => {
  const html = renderIdentityTab(signing(NOT_CONNECTED), NOW);
  const gravit = boxOf(html, 'Gravit');
  assert.ok(gravit, 'the Gravit card');
  const rowOf = name => gravit.match(new RegExp(`<div class="venue"[^>]*data-network="${name}"[\\s\\S]*?</div>`))?.[0] ?? '';
  const tg = rowOf('telegram'), sl = rowOf('slack'), im = rowOf('imessage');
  assert.match(tg, /<b>Telegram<\/b>/);
  assert.match(tg, /Not connected/);
  assert.match(tg, /<button[^>]*data-action="identityConnect" data-network="telegram"[^>]*>Connect…<\/button>/);
  assert.doesNotMatch(tg, /Disconnect…|Details/);
  assert.match(sl, /<b>Slack<\/b><br>/);
  assert.doesNotMatch(sl, /Soon|chip/);
  assert.match(sl, /Not connected/);
  assert.match(sl, /<button[^>]*data-action="identityConnect" data-network="slack"[^>]*>Install app…<\/button>/);
  assert.doesNotMatch(sl, /disabled/);
  assert.match(im, /<b>iMessage<\/b><br>/);
  assert.match(im, /Not connected/);
  assert.match(im, /<button[^>]*data-action="identityConnect" data-network="imessage"[^>]*>Connect…<\/button>/);
  assert.doesNotMatch(html, /Later|chip grey/);
  // the order: Telegram, iMessage, Slack
  assert.ok(gravit.indexOf('data-network="telegram"') < gravit.indexOf('data-network="imessage"'));
  assert.ok(gravit.indexOf('data-network="imessage"') < gravit.indexOf('data-network="slack"'));
});

test('the grid: five rows, Face ticked and disabled, Telegram enabled only once connected, iMessage and Slack disabled', () => {
  const grid = boxOf(renderIdentityTab(signing(CONNECTED), NOW), 'What reaches you where');
  assert.match(grid, /<div class="cardbox-title">What reaches you where<\/div>/);
  assert.match(grid, /<th scope="col">Face<\/th><th scope="col">Telegram<\/th><th scope="col">iMessage<\/th><th scope="col">Slack<\/th>/);
  const rows = grid.match(/<tr><td>[\s\S]*?<\/tr>/g) ?? [];
  assert.deepEqual(rows.map(r => r.match(/<td>([^<]*)<\/td>/)[1]), ['Chat with Gravit', 'Watch alerts', 'Pre-close brief', 'Cards waiting', 'Fills and reports']);
  for (const r of rows) {
    const boxes = r.match(/<input[^>]*>/g);
    assert.equal(boxes.length, 4);
    assert.match(boxes[0], /type="checkbox"[^>]*checked[^>]*disabled aria-disabled="true"/, 'Face ticked and disabled');
    assert.doesNotMatch(boxes[1], /disabled/, 'Telegram enabled');
    assert.match(boxes[1], /data-action="identityTick" data-row="[a-z]+" data-network="telegram"/);
    assert.match(boxes[2], /disabled aria-disabled="true"/);
    assert.match(boxes[3], /disabled aria-disabled="true"/);
    assert.doesNotMatch(boxes[2] + boxes[3], /checked/);
  }
  assert.match(rows[0].match(/<input[^>]*>/g)[1], /checked/, 'chat ticked');
  assert.doesNotMatch(rows[2].match(/<input[^>]*>/g)[1], /checked/, 'brief unticked');
  // nothing connected: Telegram's column disabled too
  const off = boxOf(renderIdentityTab(signing(NOT_CONNECTED), NOW), 'What reaches you where');
  for (const r of off.match(/<tr><td>[\s\S]*?<\/tr>/g)) assert.match(r.match(/<input[^>]*>/g)[1], /disabled aria-disabled="true"/);
  // a tick: the draft differs, Save applies it; ticked back, no Save
  const s = signing(CONNECTED);
  assert.ok(!keyed(renderIdentityTab(s, NOW), 'Save'), 'no Save while nothing changed');
  const ticked = R.identityTick(s, { row: 'brief', network: 'telegram', on: true });
  assert.deepEqual(ticked.identity.draft.brief, ['telegram']);
  const html = renderIdentityTab(ticked, NOW);
  assert.match(html, /<button[^>]*data-action="identitySave"[^>]*>Save<\/button>/);
  assert.match(html, /Not saved yet: Save applies it\./);
  assert.match(boxOf(html, 'What reaches you where').match(/<tr><td>Pre-close brief[\s\S]*?<\/tr>/)[0].match(/<input[^>]*>/g)[1], /checked/);
  const back = R.identityTick(ticked, { row: 'brief', network: 'telegram', on: false });
  assert.equal(back.identity.draft, null);
  assert.ok(!keyed(renderIdentityTab(back, NOW), 'Save'));
  // a tick on a network not connected, or one the tab does not route, changes nothing
  assert.equal(R.identityTick(signing(NOT_CONNECTED), { row: 'chat', network: 'telegram', on: true }).identity.draft, null);
  assert.equal(R.identityTick(s, { row: 'chat', network: 'slack', on: true }).identity.draft, null);
  // the account's answer catching up with the draft drops it
  assert.equal(R.identityLoaded(ticked, { ...CONNECTED, routing: { ...ROUTING, brief: ['telegram'] } }).identity.draft, null);
  assert.deepEqual(R.identityLoaded(ticked, CONNECTED).identity.draft.brief, ['telegram'], 'a read that has not caught up keeps it');
});

test('quiet hours read 23:00–07:00 ET with Change…; none reads Off', () => {
  const html = boxOf(renderIdentityTab(signing(CONNECTED), NOW), 'What reaches you where');
  assert.match(html, /Quiet hours/);
  assert.match(html, /23:00–07:00 ET/);
  assert.match(html, /<button[^>]*data-action="identityQuietEdit"[^>]*>Change…<\/button>/);
  assert.doesNotMatch(html, /identity-quiet-from/, 'the clocks only once Change… is pressed');
  // Change…: two clocks seeded from the account's, Off unticked, Cancel and Save in place of Change…
  const editing = boxOf(renderIdentityTab(R.identityQuietEdit(signing(CONNECTED), true), NOW), 'What reaches you where');
  assert.match(editing, /<input id="identity-quiet-from" class="input" type="time" value="23:00" name="from" data-action="identityQuietField">/);
  assert.match(editing, /<input id="identity-quiet-to" class="input" type="time" value="07:00" name="to" data-action="identityQuietField">/);
  assert.match(editing, /<input id="identity-quiet-off" type="checkbox" name="off" data-action="identityQuietField">Off: no quiet hours/);
  // the editor is drawn from its draft in the store: Off unticked and two clocks set stay so on any redraw
  const set = [['off', false], ['from', '22:00'], ['to', '06:30']].reduce((st, [name, value]) => R.identityQuietField(st, { name, value }), R.identityQuietEdit(signing({ ...CONNECTED, quiet: null }), true));
  assert.deepEqual(set.identity.quietDraft, { from: '22:00', to: '06:30', off: false });
  const redrawn = renderIdentityTab(set, NOW);
  assert.match(redrawn, /id="identity-quiet-from" class="input" type="time" value="22:00"/);
  assert.match(redrawn, /<input id="identity-quiet-off" type="checkbox" name="off"/);
  assert.doesNotMatch(redrawn, /id="identity-quiet-off"[^>]*checked/);
  assert.equal(R.identityQuietField(set, { name: 'off', value: 'yes' }), set, 'a field of another shape is none');
  assert.equal(R.identityQuietEdit(set, false).identity.quietDraft, null, 'shut: the draft goes');
  assert.match(editing, /data-action="identityQuietCancel"[^>]*>Cancel</);
  assert.match(editing, /data-action="identityQuietSave"[^>]*>Save</);
  assert.ok(!keyed(editing, 'Change…'));
  // a refusal said under quiet hours, gone when the editor shuts
  const said = R.identitySaid(R.identityQuietEdit(signing(CONNECTED), true), { at: 'quiet', words: 'Quiet hours start and end at different times' });
  assert.match(renderIdentityTab(said, NOW), /Quiet hours start and end at different times/);
  assert.equal(R.identityQuietEdit(said, false).identity.said, null);
  // quiet hours off: Off ticked, the clocks empty
  const offEdit = renderIdentityTab(R.identityQuietEdit(signing({ ...CONNECTED, quiet: null }), true), NOW);
  assert.match(offEdit, /<input id="identity-quiet-off" type="checkbox" checked name="off"/);
  assert.match(offEdit, /<input id="identity-quiet-from" class="input" type="time" value="" name="from"/);
  const off = boxOf(renderIdentityTab(signing({ ...CONNECTED, quiet: null }), NOW), 'What reaches you where');
  assert.match(off, /Quiet hours[\s\S]*Off/);
  assert.doesNotMatch(off, /ET</);
  assert.ok(keyed(off, 'Change…'));
});

test('Not you lists network, masked id, count and last time, each with Block', () => {
  const two = { ...CONNECTED, strangers: [STRANGER, { network: 'telegram', sender: 'ba9876543210', masked: '…012', count: 1, last: '2026-11-02T10:00:00.000Z' }] };
  const html = renderIdentityTab(signing(two), NOW);
  const box = boxOf(html, 'Not you');
  assert.match(box, /<div class="cardbox-title">Not you · 2<\/div>/);
  assert.match(box, re(`Telegram · …789 · 3 messages · last ${fmtClock(Date.parse(STRANGER.last))}`));
  assert.match(box, re(`Telegram · …012 · 1 message · last ${fmtDate(Date.parse('2026-11-02T10:00:00.000Z'))} ${fmtClock(Date.parse('2026-11-02T10:00:00.000Z'))}`));
  assert.match(box, /<button[^>]*data-action="askIdentityBlock" data-network="telegram" data-sender="0123456789ab" data-masked="…789"[^>]*>Block<\/button>/);
  assert.equal((box.match(/>Block<\/button>/g) ?? []).length, 2);
  // nobody: the count 0 and one line
  const none = boxOf(renderIdentityTab(signing(CONNECTED), NOW), 'Not you');
  assert.match(none, /Not you · 0/);
  assert.match(none, /Nobody else has written to Gravit\./);
});

test('a page that does not sign — pending, asked or signed-out — draws Connect…, Disconnect…, the grid and Block', () => {
  const standing = (body, role) => R.ownerStanding(shown(body), { role, kid: '' });
  for (const role of ['pending', 'needs-code', 'signed-out', 'none']) {
    const html = renderIdentityTab(standing(CONNECTED_WITH_STRANGER, role), NOW);
    assert.ok(keyed(html, 'Disconnect…'), `${role}: Disconnect…`);
    assert.ok(keyed(html, 'Block'), `${role}: Block`);
    assert.ok(keyed(html, 'Change…'), `${role}: Change…`);
    assert.ok(keyed(html, 'Install app…'), `${role}: Install app…`);
    assert.doesNotMatch(html, /Only a browser that signs/);
    // Telegram's column ticks, Face's stays the face's
    const rows = boxOf(html, 'What reaches you where').match(/<tr><td>[\s\S]*?<\/tr>/g);
    for (const r of rows) assert.doesNotMatch(r.match(/<input[^>]*>/g)[1], /disabled/);
    const none = renderIdentityTab(standing(NOT_CONNECTED, role), NOW);
    assert.match(none, /data-action="identityConnect" data-network="telegram">Connect…</);
    assert.match(none, /data-action="identityConnect" data-network="imessage">Connect…</);
  }
  // a tick on such a page is a draft, and Save is drawn
  const ticked = R.identityTick(readOnly(CONNECTED), { row: 'brief', network: 'telegram', on: true });
  assert.deepEqual(ticked.identity.draft.brief, ['telegram']);
  assert.match(renderIdentityTab(ticked, NOW), /data-action="identitySave"[^>]*>Save</);
});

test('Disconnect… and Block ask once in their place, saying what goes', () => {
  const asked = R.askConfirm(readOnly(CONNECTED_WITH_STRANGER), { action: 'identityDisconnect', network: 'telegram' });
  const gravit = boxOf(renderIdentityTab(asked, NOW), 'Gravit');
  assert.match(gravit, /Disconnect Telegram\? Gravit stops talking with you there, and its token is deleted\./);
  assert.match(gravit, /<span class="confirm"><button type="button" class="btn-danger" data-action="confirmYes">Yes, disconnect<\/button><button type="button" class="btn-sm" data-action="cancelConfirm">No<\/button><\/span>/);
  assert.doesNotMatch(gravit, />Disconnect…</);
  const block = R.askConfirm(readOnly(CONNECTED_WITH_STRANGER), { action: 'identityBlock', network: 'telegram', sender: '0123456789ab', masked: '…789' });
  const notYou = boxOf(renderIdentityTab(block, NOW), 'Not you');
  assert.match(notYou, /Block …789\? It never reaches Gravit\./);
  assert.match(notYou, /data-action="confirmYes">Yes, block</);
  assert.doesNotMatch(notYou, />Block</);
  // iMessage's ask keeps the Photon note beneath its sentence; Telegram's has none
  const imRead = { ...CONNECTED, networks: [...CONNECTED.networks, { network: 'imessage', speaksAs: '+14155550123', talksOnlyWith: '+14155550100', state: 'connected', polling: true }] };
  const im = boxOf(renderIdentityTab(R.askConfirm(readOnly(imRead), { action: 'identityDisconnect', network: 'imessage' }), NOW), 'Gravit');
  const sentence = im.indexOf('Disconnect iMessage? Gravit stops talking with you there');
  const note = esc("Your number stays registered in your Photon project, which is yours: to make the old secret useless, rotate it in the project's Settings.");
  assert.ok(sentence >= 0 && im.indexOf(note) > sentence, 'the Photon note beneath the ask');
  assert.doesNotMatch(gravit, /Photon project/, "Telegram's ask has no Photon note");
  // a refusal is said in the card where it was pressed
  const said = R.identitySaid(readOnly(CONNECTED_WITH_STRANGER), { at: 'networks', words: 'Telegram is not connected' });
  assert.match(boxOf(renderIdentityTab(said, NOW), 'Gravit'), /Telegram is not connected/);
  assert.equal(R.identitySaid(said, { at: 'elsewhere', words: 'x' }), said, 'an unknown place is none');
  assert.equal(R.identitySaid(said, null).identity.said, null);
});

test('the account not answering: the tab says so and draws no connection', () => {
  const failed = R.identityFailed(signing(CONNECTED), 'The account did not answer.');
  const html = renderIdentityTab(failed, NOW);
  assert.match(html, /The account is not answering\./);
  assert.match(html, /The account did not answer\./);
  for (const w of ['Connected', '@gravit_desk_bot', 'Disconnect…', 'Speaks as', 'What reaches you where']) assert.doesNotMatch(html, re(w));
  assert.match(html, /<button[^>]*data-action="refreshIdentity"[^>]*>Retry<\/button>/);
  // still not answering while the next read is in the air
  assert.match(renderIdentityTab(R.identityLoading(failed), NOW), /The account is not answering\./);
  assert.doesNotMatch(renderIdentityTab(R.identityLoading(failed), NOW), /@gravit_desk_bot/);
  // no words given: the sentence alone
  assert.match(renderIdentityTab(R.identityFailed(signing(CONNECTED)), NOW), /The account is not answering\./);
  // answered again: drawn
  assert.match(renderIdentityTab(R.identityLoaded(failed, CONNECTED), NOW), /@gravit_desk_bot/);
  // never read: Loading…; an answer the face does not recognise: Identity unreadable, nothing drawn from it
  assert.match(renderIdentityTab(R.nav(emptyState(), { screen: 'account', tab: 'identity' }), NOW), /Loading…/);
  const odd = renderIdentityTab(signing({ ok: true, networks: 'x' }), NOW);
  assert.match(renderIdentityTab(signing({ nope: 1 }), NOW), /Identity unreadable/);
  assert.doesNotMatch(odd, /Connected/);
});

test('the reducer: loading, loaded, failed, details, and its slice', () => {
  const s0 = emptyState();
  assert.deepEqual(s0.identity, { status: 'idle', data: null, message: null, connect: null, draft: null, details: false });
  const l = R.identityLoading(s0);
  assert.equal(l.identity.status, 'loading');
  const ok = R.identityLoaded(l, CONNECTED);
  assert.equal(ok.identity.status, 'ready');
  assert.equal(ok.identity.data, CONNECTED);
  assert.equal(ok.identity.message, null);
  const bad = R.identityFailed(ok, 'down');
  assert.equal(bad.identity.status, 'error');
  assert.equal(bad.identity.data, null, 'no stale connection kept');
  assert.equal(bad.identity.message, 'down');
  assert.equal(R.identityFailed(ok, 42).identity.message, null);
  assert.equal(R.identityDetails(R.identityDetails(ok)).identity.details, false);
});

test('no CJK and no raw JSON in the tab', () => {
  for (const s of [signing(CONNECTED_WITH_STRANGER), readOnly(NOT_CONNECTED), R.identityFailed(signing(CONNECTED), 'x')]) {
    const html = renderIdentityTab(R.identityDetails(s), NOW);
    assert.doesNotMatch(html, CJK);
    assert.doesNotMatch(html, /\{"|":/);
  }
});

// ── plan B2 Task 7: Slack's row and its column ──

const SLACK_NET = { network: 'slack', speaksAs: '@gravit', talksOnlyWith: '@pan', since: '2026-11-04T14:00:00.000Z', fingerprint: 'cd56ef78', state: 'connected', polling: true };
const BOTH = { ...CONNECTED, networks: [...CONNECTED.networks, SLACK_NET], routing: { ...ROUTING, chat: ['slack', 'telegram'], alerts: ['slack'] }, slackManifest: '{\n  "display_information": { "name": "Gravit" }\n}' };
const SLACK_ONLY = { ...NOT_CONNECTED, networks: [SLACK_NET], routing: { ...NONE_ROUTING, chat: ['slack'] } };

test('Slack not connected: Not connected and Install app…; connected: Connected, Speaks as, Talks only with, Details and Disconnect…', () => {
  const v = identityOf(BOTH);
  assert.deepEqual(v.networks.slack, { state: 'connected', speaksAs: '@gravit', talksOnlyWith: '@pan', since: '2026-11-04T14:00:00.000Z', fingerprint: 'cd56ef78', polling: true });
  assert.equal(v.slackManifest, BOTH.slackManifest);
  assert.equal(identityOf(CONNECTED).slackManifest, '', 'none given, none drawn');
  assert.equal(identityOf({ ...CONNECTED, slackManifest: 42 }).slackManifest, '');
  const gravit = boxOf(renderIdentityTab(signing(BOTH), NOW), 'Gravit');
  const sl = gravit.match(/<div class="venue"[^>]*data-network="slack"[\s\S]*?<\/div>/)?.[0] ?? '';
  for (const w of ['Slack', 'Connected', 'Speaks as @gravit', 'Talks only with @pan', 'Details', 'Disconnect…']) assert.match(sl, re(w), w);
  assert.match(sl, /<button[^>]*data-action="askIdentityDisconnect" data-network="slack"[^>]*>Disconnect…<\/button>/);
  assert.match(sl, /<button[^>]*data-action="identityDetails"[^>]*data-network="slack"[^>]*>Details<\/button>/);
  assert.doesNotMatch(sl, /Install app…|Soon/);
  // Details is the row's own: Slack's opens Slack's line, not Telegram's
  const open = renderIdentityTab(R.identityDetails(signing(BOTH), 'slack'), NOW);
  assert.match(open, /token cd56ef78/);
  assert.doesNotMatch(open, /token ab12cd34/);
  const both = R.identityDetails(R.identityDetails(signing(BOTH), 'slack'), 'telegram');
  assert.match(renderIdentityTab(both, NOW), /token ab12cd34/);
  assert.equal(R.identityDetails(R.identityDetails(signing(BOTH), 'slack'), 'slack').identity.details, false);
  // Slack's trouble in Slack's words
  const net = over => identityOf({ ...SLACK_ONLY, networks: [{ ...SLACK_NET, ...over }] }, null, () => '09:30').networks.slack.problem;
  assert.equal(net({ conflictAt: '2026-11-04T14:30:00.000Z' }), "Another program holds this app's connection to Slack (since 09:30): stop it, or Gravit hears nothing.");
  assert.equal(net({ pollFailing: { since: '2026-11-04T14:30:00.000Z', reason: 'invalid_auth' } }), 'Not hearing Slack since 09:30: invalid_auth.');
  assert.equal(net({ blocked: true }), undefined, 'blocking is Telegram\'s');
  // a page that does not sign: the row reads, with its key
  const ro = boxOf(renderIdentityTab(readOnly(SLACK_ONLY), NOW), 'Gravit');
  assert.match(ro, /Speaks as @gravit/);
  assert.match(ro, /data-network="slack"[^>]*>Disconnect…/);
});

test('the grid enables Slack\'s column once Slack is connected; iMessage stays disabled', () => {
  const v = identityOf(BOTH);
  assert.deepEqual(v.grid[0].slack, { on: true, enabled: true });
  assert.deepEqual(v.grid[1].slack, { on: true, enabled: true });
  assert.deepEqual(v.grid[2].slack, { on: false, enabled: true });
  assert.deepEqual(v.grid[0].imessage, { on: false, enabled: false });
  assert.deepEqual(identityOf(CONNECTED).grid[0].slack, { on: false, enabled: false });
  const grid = boxOf(renderIdentityTab(signing(BOTH), NOW), 'What reaches you where');
  const rows = grid.match(/<tr><td>[\s\S]*?<\/tr>/g);
  for (const r of rows) {
    const boxes = r.match(/<input[^>]*>/g);
    assert.match(boxes[2], /disabled aria-disabled="true"/, 'iMessage');
    assert.doesNotMatch(boxes[3], /disabled/, 'Slack enabled');
    assert.match(boxes[3], /data-action="identityTick" data-row="[a-z]+" data-network="slack"/);
  }
  assert.match(rows[0].match(/<input[^>]*>/g)[3], /checked/);
  assert.doesNotMatch(rows[2].match(/<input[^>]*>/g)[3], /checked/);
  // a tick on Slack's column: the draft, sorted with Telegram's
  const ticked = R.identityTick(signing(BOTH), { row: 'brief', network: 'slack', on: true });
  assert.deepEqual(ticked.identity.draft.brief, ['slack']);
  assert.match(renderIdentityTab(ticked, NOW), />Save</);
  // not connected: its column disabled and a tick changes nothing
  assert.equal(R.identityTick(signing(CONNECTED), { row: 'chat', network: 'slack', on: true }).identity.draft, null);
  // a read that drops Slack drops its ticks from a draft
  assert.ok(!JSON.stringify(R.identityLoaded(ticked, CONNECTED).identity.draft).includes('slack'));
});

test("a stranger's last message on another day is a day and a clock in the table's order", async () => {
  const { withTable } = await import('../../client/js/i18n/words.js');
  const last = '2026-11-01T13:02:00.000Z';
  const html = withTable({ 'time.dayClock': '{clock} ({day})' }, () => renderIdentityTab(signing({ ...CONNECTED, strangers: [{ ...STRANGER, last }] }), NOW));
  assert.ok(html.includes(`${fmtClock(Date.parse(last))} (${fmtDate(Date.parse(last))})`), html);
});

// ── the iMessage plan: iMessage's row through Photon, its column and its troubles ──

const IM_NET = { network: 'imessage', speaksAs: '+14155550123', talksOnlyWith: '+14155550100', since: '2026-11-04T14:00:00.000Z', fingerprint: 'ef90ab12', state: 'connected', polling: true };
const readWith = over => (over ? { ...NOT_CONNECTED, networks: [{ ...IM_NET, ...over }], routing: { ...NONE_ROUTING, chat: ['imessage'] } } : NOT_CONNECTED);
const iso = ms => new Date(ms).toISOString();
const problemFor = over => identityOf(readWith(over), null, () => '09:30', NOW).networks.imessage.problem ?? '';

test('a connected iMessage is a row of its own and its column is enabled', () => {
  const v = identityOf(readWith({}));
  assert.deepEqual(v.networks.imessage, { state: 'connected', speaksAs: '+14155550123', talksOnlyWith: '+14155550100', since: '2026-11-04T14:00:00.000Z', fingerprint: 'ef90ab12', polling: true });
  assert.deepEqual(v.grid[0].imessage, { on: true, enabled: true });
  assert.deepEqual(v.grid[1].imessage, { on: false, enabled: true });
  const gravit = boxOf(renderIdentityTab(signing(readWith({})), NOW), 'Gravit');
  const im = gravit.match(/<div class="venue"[^>]*data-network="imessage"[\s\S]*?<\/div>/)?.[0] ?? '';
  for (const w of ['iMessage', 'Connected', 'Speaks as +14155550123', 'Talks only with +14155550100', 'via Photon', 'Details', 'Disconnect…']) assert.match(im, re(w), w);
  assert.doesNotMatch(im, /@\+|Connect…<|Later/);
  assert.match(im, /<button[^>]*data-action="askIdentityDisconnect" data-network="imessage"[^>]*>Disconnect…<\/button>/);
  // Details: since, the project secret's fingerprint, polling
  assert.match(renderIdentityTab(R.identityDetails(signing(readWith({})), 'imessage'), NOW), re(`Since ${fmtDate(Date.parse('2026-11-04T14:00:00.000Z'))} · secret ef90ab12 · polling`));
  // its column: enabled, ticked where the routing says, a tick a draft
  const grid = boxOf(renderIdentityTab(signing(readWith({})), NOW), 'What reaches you where');
  const rows = grid.match(/<tr><td>[\s\S]*?<\/tr>/g);
  for (const r of rows) {
    const boxes = r.match(/<input[^>]*>/g);
    assert.doesNotMatch(boxes[2], /disabled/, 'iMessage enabled');
    assert.match(boxes[2], /data-action="identityTick" data-row="[a-z]+" data-network="imessage"/);
  }
  assert.match(rows[0].match(/<input[^>]*>/g)[2], /checked/);
  const ticked = R.identityTick(signing(readWith({})), { row: 'brief', network: 'imessage', on: true });
  assert.deepEqual(ticked.identity.draft.brief, ['imessage']);
  assert.equal(R.identityTick(signing(CONNECTED), { row: 'chat', network: 'imessage', on: true }).identity.draft, null, 'not connected: no tick');
  // a page that does not sign reads the row, with its key
  const ro = boxOf(renderIdentityTab(readOnly(readWith({})), NOW), 'Gravit');
  assert.match(ro, /Speaks as \+14155550123/);
  assert.match(ro, /data-network="imessage"[^>]*>Disconnect…/);
});

test('an unconnected iMessage offers Connect…, never Later', () => {
  assert.equal(identityOf(readWith()).networks.imessage.state, 'none');
  const html = renderIdentityTab(signing(readWith()), NOW);
  assert.match(html, /data-action="identityConnect" data-network="imessage">Connect…</);
  assert.doesNotMatch(html, /Later/);
  assert.match(renderIdentityTab(readOnly(readWith()), NOW), /data-network="imessage">Connect…/, 'on a page that does not sign too');
});

test("movedAt, refusedAt and a fresh gapAt are the row's problem; an old gapAt is not", () => {
  const now = NOW;
  assert.equal(problemFor({ movedAt: iso(now) }), t('identity.problem.moved'));
  assert.equal(problemFor({ refusedAt: iso(now) }), t('identity.problem.refused'));
  assert.equal(problemFor({ gapAt: iso(now - 3_600_000) }), t('identity.problem.gap'));
  assert.equal(problemFor({ gapAt: iso(now - 25 * 3_600_000) }), '');
  assert.equal(problemFor({}), '');
  // the worst first: moved over refused over a failing read over a gap
  assert.equal(problemFor({ movedAt: iso(now), refusedAt: iso(now), gapAt: iso(now) }), t('identity.problem.moved'));
  assert.equal(problemFor({ refusedAt: iso(now), pollFailing: { since: iso(now), reason: 'auth' } }), t('identity.problem.refused'));
  // a failing read is named by the row's own network
  assert.equal(problemFor({ pollFailing: { since: iso(now), reason: 'auth' }, gapAt: iso(now) }), 'Not hearing iMessage since 09:30: auth.');
  // blocking is Telegram's alone
  assert.equal(problemFor({ blocked: true }), '');
  // the row says it, in place of polling
  const html = renderIdentityTab(R.identityDetails(signing(readWith({ refusedAt: iso(now) })), 'imessage'), NOW);
  assert.match(html, re(t('identity.problem.refused')));
  assert.doesNotMatch(html, / · polling/);
});
