// Account › Identity (plan B1b Task 1): the account's GET /api/account/identity read through the face's proxy, drawn as three cards —
// Gravit (the networks: Telegram connected or not, iMessage later, Slack soon), What reaches you where (the five routing rows and
// quiet hours) and Not you (the strangers, each with Block) — with the owner's keys only on a page that signs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identityOf, formatRouting, routingOf, tickRouting, routeRows, NETWORKS } from '../../client/js/host/identity-view.js';
import { renderIdentityTab } from '../../client/js/render/identity.js';
import { reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { esc } from '../../client/js/html.js';
import { fmtClock, fmtDate } from '../../client/js/time.js';

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

test('identityOf: a connected Telegram, Slack not connected, iMessage later, the grid, quiet hours and Not you', () => {
  const v = identityOf(CONNECTED_WITH_STRANGER);
  assert.equal(v.ok, true);
  assert.deepEqual(v.networks, {
    telegram: { state: 'connected', speaksAs: '@gravit_desk_bot', talksOnlyWith: '@pan', since: '2026-11-03T15:20:00.000Z', fingerprint: 'ab12cd34', polling: true },
    imessage: { state: 'later' }, slack: { state: 'none' },
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
  assert.match(html, /<button[^>]*data-action="openSheet" data-kind="disconnectNetwork" data-network="telegram"[^>]*>Disconnect…<\/button>/);
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

test('Telegram not connected: Not connected and Connect…; Slack: Not connected and Install app…, no Soon; iMessage: Later and no button', () => {
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
  assert.match(im, /<b>iMessage<\/b> <span class="chip grey">Later<\/span>/);
  assert.doesNotMatch(im, /<button/);
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
  // a tick: the draft differs, Save… opens the routing sheet; ticked back, no Save…
  const s = signing(CONNECTED);
  assert.ok(!keyed(renderIdentityTab(s, NOW), 'Save…'), 'no Save… while nothing changed');
  const ticked = R.identityTick(s, { row: 'brief', network: 'telegram', on: true });
  assert.deepEqual(ticked.identity.draft.brief, ['telegram']);
  const html = renderIdentityTab(ticked, NOW);
  assert.match(html, /<button[^>]*data-action="openSheet" data-kind="routing"[^>]*>Save…<\/button>/);
  assert.match(boxOf(html, 'What reaches you where').match(/<tr><td>Pre-close brief[\s\S]*?<\/tr>/)[0].match(/<input[^>]*>/g)[1], /checked/);
  const back = R.identityTick(ticked, { row: 'brief', network: 'telegram', on: false });
  assert.equal(back.identity.draft, null);
  assert.ok(!keyed(renderIdentityTab(back, NOW), 'Save…'));
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
  assert.match(html, /<button[^>]*data-action="openSheet" data-kind="routing"[^>]*>Change…<\/button>/);
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
  assert.match(box, /<button[^>]*data-action="openSheet" data-kind="block" data-network="telegram" data-sender="0123456789ab" data-masked="…789"[^>]*>Block<\/button>/);
  assert.equal((box.match(/>Block<\/button>/g) ?? []).length, 2);
  // nobody: the count 0 and one line
  const none = boxOf(renderIdentityTab(signing(CONNECTED), NOW), 'Not you');
  assert.match(none, /Not you · 0/);
  assert.match(none, /Nobody else has written to Gravit\./);
});

test('a page that does not sign draws no owner button on Identity', () => {
  for (const body of [CONNECTED_WITH_STRANGER, NOT_CONNECTED]) {
    const html = renderIdentityTab(readOnly(body), NOW);
    for (const w of ['Connect…', 'Disconnect…', 'Save…', 'Change…', 'Block']) assert.doesNotMatch(html, new RegExp(`data-action[^>]*>${esc(w)}`));
    assert.doesNotMatch(html, />Connect…<|>Install app…</, 'neither network\'s');
    assert.match(html, /Only a browser that signs changes these\./);
    // the ticks read, and change nothing
    for (const box of html.match(/<input[^>]*>/g)) assert.match(box, /disabled aria-disabled="true"/);
  }
  const html = renderIdentityTab(readOnly(CONNECTED_WITH_STRANGER), NOW);
  for (const w of ['Connected', '@gravit_desk_bot', '@pan', '23:00–07:00 ET', '…789']) assert.match(html, re(w));
  assert.ok(keyed(html, 'Details'), 'Details is a read');
  // a draft from before the page stopped signing draws no Save…
  const s = R.ownerStanding(R.identityTick(signing(CONNECTED), { row: 'brief', network: 'telegram', on: true }), { role: 'needs-code', kid: '' });
  assert.ok(!/>Save…</.test(renderIdentityTab(s, NOW)));
  // and its ticks are the account's, not the unsaved draft's
  const briefTick = boxOf(renderIdentityTab(s, NOW), 'What reaches you where').match(/<tr><td>Pre-close brief[\s\S]*?<\/tr>/)[0].match(/<input[^>]*>/g)[1];
  assert.doesNotMatch(briefTick, /checked/);
  // a tick on a page that does not sign changes no draft
  assert.equal(R.identityTick(readOnly(CONNECTED), { row: 'brief', network: 'telegram', on: true }).identity.draft, null);
  // a page that signs has no such line
  assert.doesNotMatch(renderIdentityTab(signing(CONNECTED), NOW), /Only a browser that signs/);
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
  assert.match(sl, /<button[^>]*data-action="openSheet" data-kind="disconnectNetwork" data-network="slack"[^>]*>Disconnect…<\/button>/);
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
  // a page that does not sign: the row reads, no key
  const ro = boxOf(renderIdentityTab(readOnly(SLACK_ONLY), NOW), 'Gravit');
  assert.match(ro, /Speaks as @gravit/);
  assert.doesNotMatch(ro, /Disconnect…|Install app…/);
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
  assert.match(renderIdentityTab(ticked, NOW), />Save…</);
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
