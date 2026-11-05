// Account › Identity's sheets (plan B1b Task 2, spec §5.2): Connect Telegram's four sheets as drawn — 1 to 3 the Identity drawer
// (render/identity.js renderConnectDrawer), 4 the owner sheet's connectNetwork kind (host/sheet-identity.js through
// host/sheet-view.js, drawn by render/owner.js renderSheet) — their titles, lines and numbered instructions word for word, the
// steps above the keys, and sheet 4's draft from its seed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { renderConnectDrawer, connectSteps, etClock } from '../../client/js/render/identity.js';
import { renderSheet } from '../../client/js/render/owner.js';
import { IDENTITY_KINDS, identityTitleOf, identityGoOf, identityFieldsOf, identityDraftOf, identityLinesOf, identityStepsOf, identityNoteOf, rowsSentOn, slackSteps4Note } from '../../client/js/host/sheet-identity.js';
import { SHEET_KINDS, titleOf, goWord, fieldsOf, draftOf } from '../../client/js/host/sheet-view.js';
import { connectRoutingOf } from '../../client/js/host/identity.js';

const STEPS_1 = [
  'In Telegram, open @BotFather and send /newbot.',
  'Pick a name for Gravit, then a username that ends in "bot".',
  'BotFather answers with a token. Copy it.',
  'Paste it only here, never in a chat, not even with Gravit.',
];
const STEPS_2 = [
  'On your phone, open the link or scan the code: Telegram opens Gravit\'s bot.',
  'Tap Start.',
  'Wait here: this sheet moves on when the bot hears you.',
];
const STEPS_3 = [
  'Check the name, the handle and the message: they should be yours, sent a moment ago.',
  'This is me: Gravit talks only with this Telegram account.',
  'Not me: that sender is listed under Not you and never reaches Gravit. Say hi again from your own Telegram.',
];
const STEPS_4 = [
  'Read each line: it is what the account will hold to.',
  'Sign with this browser\'s key. Only then does the account keep the token and start delivering.',
  'To stop, use Disconnect… in Account › Identity.',
];
const ALL_TELEGRAM = 'chat=telegram;alerts=telegram;brief=telegram;cards=telegram;fills=telegram';
const SEED = {
  pending: '0123456789abcdef0123456789abcdef', botId: '777', speaksAs: '@gravit_desk_bot', operatorId: '555000123', talksOnlyWith: '@pan',
  routing: ALL_TELEGRAM, keyHash: 'a'.repeat(64), salt: 'b'.repeat(32),
};
const NOW = Date.parse('2026-11-04T15:00:00.000Z');
const PENDING = {
  id: SEED.pending, network: 'telegram', bot: { id: '777', username: 'gravit_desk_bot', name: 'Gravit' },
  link: 'https://t.me/gravit_desk_bot', qr: 'data:image/svg+xml;base64,PHN2Zy8+', expiresAt: '2026-11-04T15:10:00.000Z', state: 'waiting',
};
const decode = s => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const listOf = html => [...(html.match(/<ol class="sheet-steps">([\s\S]*?)<\/ol>/)?.[1] ?? '').matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => decode(m[1]));
const at = step => R.identityConnectSet(R.identityConnectOpen(R.nav(emptyState(NOW), { screen: 'account', tab: 'identity' })), { step, pending: step > 1 ? (step === 3 ? { ...PENDING, state: 'heard', sender: { id: '555000123', name: 'Pan', handle: '@pan', masked: '…123', text: '/start' } } : PENDING) : null });

test('the four steps lists are the spec\'s, word for word', () => {
  assert.deepEqual(connectSteps(1), STEPS_1);
  assert.deepEqual(connectSteps(2), STEPS_2);
  assert.deepEqual(connectSteps(3), STEPS_3);
  assert.deepEqual(connectSteps(1, 'telegram'), STEPS_1);
  assert.deepEqual(identityStepsOf('connectNetwork'), STEPS_4);
});

test('sheet 1: Bot token, a password field with Paste and Next, where it is kept and where it never goes, then its steps above the buttons', () => {
  const html = renderConnectDrawer(at(1));
  assert.match(html, /<aside class="drawer sheet" aria-label="Connect Telegram · 1 of 4 · Bot token">/);
  assert.match(html, /<h2>Connect Telegram · 1 of 4 · Bot token<\/h2>/);
  const input = html.match(/<input[^>]*id="identity-token"[^>]*>/)?.[0] ?? '';
  assert.match(input, /type="password"/);
  assert.match(input, /autocomplete="off"/);
  assert.match(input, /spellcheck="false"/);
  assert.doesNotMatch(input, /value=/, 'the field is never filled from the page');
  assert.match(html, /data-action="identityPaste">Paste</);
  assert.match(html, /data-action="identityNext"[^>]*>Next</);
  assert.ok(html.includes('Kept in: Account · :4820'));
  assert.ok(decode(html).includes("Never in: Gravit's box · ~/.dsh"));
  assert.deepEqual(listOf(html), STEPS_1);
  // the steps sit above the last button row, the keys Cancel and Next
  const ol = html.indexOf('<ol class="sheet-steps">');
  const lastRow = html.lastIndexOf('<div class="btn-row">');
  assert.ok(ol > 0 && ol < lastRow, 'steps above the buttons');
  assert.match(html.slice(lastRow), /identityClose[^>]*>Cancel<[\s\S]*identityNext[^>]*>Next</);
  // a busy Next says so and is off
  const busy = renderConnectDrawer(R.identityConnectSet(at(1), { busy: true }));
  assert.match(busy, /<button type="button" class="btn-primary" data-action="identityNext" disabled>Checking…<\/button>/);
  // an error is the account's sentence on sheet 1, with no Start again
  const refused = renderConnectDrawer(R.identityConnectSet(at(1), { error: 'Telegram does not know this token: nothing was kept. Copy it from BotFather again.' }));
  assert.match(refused, /Telegram does not know this token/);
  assert.doesNotMatch(refused, /Start again/);
});

test('sheets 2 and 3: their titles and steps, Back and Cancel', () => {
  const two = renderConnectDrawer(at(2));
  assert.match(two, /<h2>Connect Telegram · 2 of 4 · Say hi<\/h2>/);
  assert.deepEqual(listOf(two), STEPS_2);
  assert.match(two, /identityBack[^>]*>Back<[\s\S]*identityClose[^>]*>Cancel</);
  const three = renderConnectDrawer(at(3));
  assert.match(three, /<h2>Connect Telegram · 3 of 4 · Is this you\?<\/h2>/);
  assert.deepEqual(listOf(three), STEPS_3);
  assert.match(three, /identityNotMe[^>]*>Not me<[\s\S]*identityThisIsMe[^>]*>This is me</);
  assert.equal(renderConnectDrawer(emptyState(NOW)), '', 'none open, nothing drawn');
});

test('the expiry reads New York\'s clock', () => {
  assert.equal(etClock('2026-11-04T15:10:00.000Z'), '10:10');
  assert.equal(etClock('2026-11-05T02:05:00.000Z'), '21:05');
  assert.equal(etClock('2026-07-04T13:00:00.000Z'), '9:00');
  assert.equal(etClock('nonsense'), '');
});

test('IDENTITY_KINDS are the four, delegated by the sheet view; disconnectNetwork is its own kind', () => {
  assert.deepEqual(IDENTITY_KINDS, ['connectNetwork', 'disconnectNetwork', 'routing', 'block']);
  for (const k of IDENTITY_KINDS) assert.ok(SHEET_KINDS.includes(k), k);
  assert.equal(titleOf('connectNetwork', SEED), 'Connect Telegram · 4 of 4 · What you sign');
  assert.equal(identityTitleOf('connectNetwork'), 'Connect Telegram · 4 of 4 · What you sign');
  assert.equal(goWord('connectNetwork', SEED), "Sign with this browser's key");
  assert.deepEqual(fieldsOf('connectNetwork', SEED), []);
  assert.deepEqual(identityFieldsOf('connectNetwork', SEED), []);
  assert.deepEqual(draftOf('connectNetwork', [], SEED, NOW), identityDraftOf('connectNetwork', [], SEED));
  assert.equal(identityDraftOf('nonsense', [], {}), 'Nothing to sign here');
});

test('connectNetwork drafts from its seed alone, the fingerprint and never the token', () => {
  assert.deepEqual(identityDraftOf('connectNetwork', [], SEED), {
    type: 'connectNetwork', network: 'telegram', pending: SEED.pending, botId: '777', speaksAs: '@gravit_desk_bot', operatorId: '555000123',
    talksOnlyWith: '@pan', routing: ALL_TELEGRAM, keyHash: SEED.keyHash, salt: SEED.salt,
  });
  assert.equal(typeof identityDraftOf('connectNetwork', [], { ...SEED, pending: '' }), 'string');
  assert.equal(typeof identityDraftOf('connectNetwork', [], { ...SEED, keyHash: 'nope' }), 'string');
  assert.equal(typeof identityDraftOf('connectNetwork', [], { ...SEED, salt: 'B'.repeat(32) }), 'string');
  assert.ok(!('token' in identityDraftOf('connectNetwork', [], { ...SEED, token: 'x' })));
  // ruling 4: the routing now with Telegram ticked in every row
  assert.equal(connectRoutingOf({ ok: true, routing: { chat: [], alerts: [], brief: [], cards: [], fills: [] } }), ALL_TELEGRAM);
  assert.equal(connectRoutingOf(null), ALL_TELEGRAM);
  assert.deepEqual(rowsSentOn('chat=telegram;alerts=;brief=telegram;cards=;fills=', 'telegram'), ['Chat with Gravit', 'Pre-close brief']);
});

test("sheet 4: the seven lines above What you sign, its steps, and Sign with this browser's key", () => {
  assert.deepEqual(identityLinesOf('connectNetwork', SEED), [
    'Network: Telegram', 'Speaks as: @gravit_desk_bot', 'Talks only with: @pan',
    'May send: Chat with Gravit, Watch alerts, Pre-close brief, Cards waiting, Fills and reports',
    'Token kept in: Account · :4820', 'Signed by: this browser', 'Until: you disconnect',
  ]);
  assert.deepEqual(identityStepsOf('connectNetwork'), STEPS_4);
  assert.equal(identityGoOf('connectNetwork'), "Sign with this browser's key");
  // drawn: the lines first, What you sign under them, the steps above the button row
  const shown = Object.entries({ ...identityDraftOf('connectNetwork', [], SEED), nonce: NOW }).map(([name, value]) => ({ name, value: String(value) }));
  let s = R.sheetOpen(R.ownerStanding(emptyState(NOW), { role: 'signs', kid: 'a5048199a8081854' }), { kind: 'connectNetwork', seed: SEED, fields: [] });
  s = R.sheetAsking(s, { quiet: false });
  s = R.sheetPrepared(s, { prepared: { ok: true, action: { type: 'connectNetwork' }, shown, quote: null }, at: NOW, asked: JSON.stringify(identityDraftOf('connectNetwork', [], SEED)), deadline: null });
  const html = renderSheet(s, NOW);
  assert.match(html, /<h2>Connect Telegram · 4 of 4 · What you sign<\/h2>/);
  const first = html.indexOf('Network: Telegram');
  const what = html.indexOf('<summary>What you sign</summary>');
  const ol = html.indexOf('<ol class="sheet-steps">');
  const keys = html.lastIndexOf('<div class="btn-row">');
  assert.ok(first > 0 && first < what && what < ol && ol < keys, 'lines, What you sign, steps, keys');
  assert.deepEqual(listOf(html), STEPS_4);
  assert.match(html.slice(keys), /data-action="sheetSubmit">Sign with this browser&#39;s key</);
  assert.doesNotMatch(html, /Start again/, 'only a refused sheet offers it');
  // another kind draws neither lines nor steps
  const other = renderSheet(R.sheetOpen(emptyState(NOW), { kind: 'beast', seed: {}, fields: [] }), NOW);
  assert.doesNotMatch(other, /sheet-steps|Network: Telegram/);
});

// ── Task 3: Disconnect, What reaches you where with quiet hours, and Block ──

test('disconnect drafts disconnectNetwork with its three lines', () => {
  const seed = { network: 'telegram' };
  assert.deepEqual(identityDraftOf('disconnectNetwork', [], seed), { type: 'disconnectNetwork', network: 'telegram' });
  assert.deepEqual(draftOf('disconnectNetwork', [], seed, NOW), { type: 'disconnectNetwork', network: 'telegram' });
  assert.equal(titleOf('disconnectNetwork', seed), 'Disconnect Telegram');
  assert.equal(goWord('disconnectNetwork', seed), 'Sign disconnect');
  assert.deepEqual(fieldsOf('disconnectNetwork', seed), []);
  assert.deepEqual(identityLinesOf('disconnectNetwork', seed), [
    'Gravit stops reading and sending on Telegram.',
    'The token is deleted from the account.',
    'The desk keeps working in the face.',
  ]);
  assert.equal(typeof identityDraftOf('disconnectNetwork', [], { network: 'imessage' }), 'string', 'only a network the account speaks on');
  assert.equal(typeof identityDraftOf('disconnectNetwork', [], {}), 'string');
  // drawn: the three lines above the keys, Sign disconnect, no Start again
  const s = R.sheetOpen(R.ownerStanding(emptyState(NOW), { role: 'signs', kid: 'a5048199a8081854' }), { kind: 'disconnectNetwork', seed, fields: [] });
  const html = renderSheet(s, NOW);
  assert.match(html, /<h2>Disconnect Telegram<\/h2>/);
  assert.ok(html.indexOf('Gravit stops reading and sending on Telegram.') < html.lastIndexOf('<div class="btn-row">'));
  assert.match(html, /data-action="sheetSubmit"[^>]*>Sign disconnect</);
  assert.doesNotMatch(html, /Start again/);
});

const SEED_ROUTING = { chat: ['telegram'], alerts: ['telegram'], brief: [], cards: ['telegram'], fills: ['telegram'] };
const SEED_STRING = 'chat=telegram;alerts=telegram;brief=;cards=telegram;fills=telegram';
const RSEED = { routing: SEED_ROUTING, quiet: { from: '23:00', to: '07:00' }, saved: SEED_STRING };
const rfields = (over = {}, seed = RSEED) => identityFieldsOf('routing', seed).map(f => (f.name in over ? { ...f, value: over[f.name] } : f));

test('routing drafts the grid as the account\'s string and the quiet hours, refuses equal times and an unchanged draft', () => {
  const SEED = RSEED;
  const fields = rfields;
  assert.deepEqual(identityDraftOf('routing', fields({ quietFrom: '22:00', quietTo: '06:30' }), SEED), { type: 'setRouting', routing: SEED_STRING, quietFrom: '22:00', quietTo: '06:30' });
  assert.equal(identityDraftOf('routing', fields({ quietFrom: '22:00', quietTo: '22:00' }), SEED), 'Quiet hours start and end at different times');
  assert.equal(identityDraftOf('routing', fields({ quietOff: true }), SEED).quietFrom, '');
  // off is both ends empty, which the account stores as null
  assert.deepEqual(identityDraftOf('routing', fields({ quietOff: true }), SEED), { type: 'setRouting', routing: SEED_STRING, quietFrom: '', quietTo: '' });
  // the fields: two clocks and Off, from the seed's quiet hours
  assert.deepEqual(identityFieldsOf('routing', SEED).map(f => [f.name, f.type, f.value]), [['quietFrom', 'time', '23:00'], ['quietTo', 'time', '07:00'], ['quietOff', 'check', false]]);
  assert.deepEqual(identityFieldsOf('routing', { ...SEED, quiet: null }).map(f => [f.name, f.value]), [['quietFrom', ''], ['quietTo', ''], ['quietOff', true]]);
  // unchanged: the account's routing and its quiet hours as they are
  assert.equal(identityDraftOf('routing', fields(), SEED), 'That is how it is now');
  assert.equal(identityDraftOf('routing', fields({}, { ...SEED, quiet: null }), { ...SEED, quiet: null }), 'That is how it is now');
  // a draft routing (the grid's unsaved ticks) is a change with the quiet hours as they are
  const ticked = { ...SEED, routing: { ...SEED_ROUTING, brief: ['telegram'] } };
  assert.deepEqual(identityDraftOf('routing', rfields({}, ticked), ticked), { type: 'setRouting', routing: 'chat=telegram;alerts=telegram;brief=telegram;cards=telegram;fills=telegram', quietFrom: '23:00', quietTo: '07:00' });
  // quiet hours on with an end missing or not a clock
  assert.equal(typeof identityDraftOf('routing', fields({ quietFrom: '' }), SEED), 'string');
  assert.equal(typeof identityDraftOf('routing', fields({ quietTo: '7am' }), SEED), 'string');
  // turning them on from off needs both times
  const off = { ...SEED, quiet: null };
  assert.equal(typeof identityDraftOf('routing', rfields({ quietOff: false }, off), off), 'string');
  assert.deepEqual(identityDraftOf('routing', rfields({ quietOff: false, quietFrom: '21:00', quietTo: '06:00' }, off), off), { type: 'setRouting', routing: SEED_STRING, quietFrom: '21:00', quietTo: '06:00' });
  // the sheet view delegates; the title and go word are the plan's
  assert.deepEqual(draftOf('routing', fields({ quietOff: true }), SEED, NOW), identityDraftOf('routing', fields({ quietOff: true }), SEED));
  assert.equal(titleOf('routing', SEED), 'What reaches you where');
  assert.equal(goWord('routing', SEED), 'Sign');
  assert.deepEqual(identityLinesOf('routing', SEED), ['On Telegram: Chat with Gravit, Watch alerts, Cards waiting, Fills and reports']);
  assert.deepEqual(identityLinesOf('routing', { ...SEED, routing: {} }), ['On Telegram: nothing']);
});

test('the routing sheet draws its quiet hours as two clocks and an Off box', () => {
  const s = R.sheetOpen(R.ownerStanding(emptyState(NOW), { role: 'signs', kid: 'a5048199a8081854' }), { kind: 'routing', seed: RSEED, fields: identityFieldsOf('routing', RSEED) });
  const html = renderSheet(s, NOW);
  assert.match(html, /<h2>What reaches you where<\/h2>/);
  assert.match(html, /<input class="input" type="time" name="quietFrom" value="23:00"[^>]*data-action="sheetField"/);
  assert.match(html, /<input class="input" type="time" name="quietTo" value="07:00"[^>]*data-action="sheetField"/);
  assert.match(html, /<input type="checkbox" name="quietOff" value="true" data-action="sheetField">/);
  assert.match(html, /On Telegram: Chat with Gravit/);
  assert.match(html, /data-action="sheetSubmit"[^>]*>Sign</);
});

test('block drafts blockSender for the stranger\'s ref, shown by its masked id', () => {
  const seed = { network: 'telegram', sender: '0a1b2c3d4e5f', masked: '…789' };
  assert.deepEqual(identityDraftOf('block', [], seed), { type: 'blockSender', network: 'telegram', sender: '0a1b2c3d4e5f', masked: '…789' });
  assert.deepEqual(draftOf('block', [], seed, NOW), identityDraftOf('block', [], seed));
  assert.equal(titleOf('block', seed), 'Block …789');
  assert.equal(goWord('block', seed), 'Sign block');
  assert.deepEqual(fieldsOf('block', seed), []);
  assert.deepEqual(identityLinesOf('block', seed), ['Messages from …789 are dropped and no longer counted.']);
  assert.equal(typeof identityDraftOf('block', [], { ...seed, sender: '' }), 'string');
  assert.equal(typeof identityDraftOf('block', [], { ...seed, masked: '' }), 'string');
  assert.equal(typeof identityDraftOf('block', [], { ...seed, network: 'imessage' }), 'string');
  assert.deepEqual(identityDraftOf('block', [], { ...seed, network: 'slack', masked: '…7QK' }), { type: 'blockSender', network: 'slack', sender: '0a1b2c3d4e5f', masked: '…7QK' });
  // an account-supplied masked id is escaped where drawn
  const odd = { ...seed, masked: '<b>…7</b>' };
  const html = renderSheet(R.sheetOpen(emptyState(NOW), { kind: 'block', seed: odd, fields: [] }), NOW);
  assert.ok(!html.includes('<b>…7</b>'));
  assert.ok(html.includes('&lt;b&gt;…7&lt;/b&gt;'));
});

test('sheet 1 is no form, so the browser is not invited to keep the bot token as a password', () => {
  const html = renderConnectDrawer(at(1));
  assert.doesNotMatch(html, /<form/);
  const input = html.match(/<input[^>]*id="identity-token"[^>]*>/)?.[0] ?? '';
  assert.match(input, /type="password"/);
  assert.match(input, /data-lpignore="true"/);
  assert.match(input, /data-1p-ignore="true"/);
});

// ── plan B2 Task 7: Connect Slack's four sheets ──

const SLACK_STEPS_1 = [
  'Open api.slack.com/apps, choose Create New App, then From a manifest, and pick your workspace.',
  'Paste the manifest above and create the app.',
  'In Basic Information › App-Level Tokens, generate a token with the connections:write scope. It starts with xapp-. Paste it in the first field.',
  'In Install App, install the app to your workspace and copy the Bot User OAuth Token. It starts with xoxb-. Paste it in the second field.',
  'Paste them only here, never in a chat, not even with Gravit.',
];
const SLACK_STEPS_2 = [
  'Open the link or scan the code: Slack opens Gravit\'s app.',
  'In its Messages tab, send it any message, for example hi.',
  'Wait here: this sheet moves on when the app hears you.',
];
const SLACK_STEPS_3 = [
  'Check the name, the handle and the message: they should be yours, sent a moment ago.',
  'This is me: Gravit talks only with this Slack account, in this direct message.',
  'Not me: that sender is listed under Not you and never reaches Gravit. Say hi again from your own Slack account.',
];
const SLACK_STEPS_4_NOTE_WORDS = 'On Slack, type the phone\'s commands with ! — !status, !pause 30m, !mute 30m, !new, !stop.';
const MANIFEST = '{\n  "display_information": {\n    "name": "Gravit"\n  },\n  "x": "<b>&"\n}';
const ALL_BOTH = 'chat=slack,telegram;alerts=slack,telegram;brief=slack,telegram;cards=slack,telegram;fills=slack,telegram';
const SLACK_SEED = {
  network: 'slack', pending: 'fedcba9876543210fedcba9876543210', botId: 'T0FAKE001:U0BOT0001', speaksAs: '@gravit', operatorId: 'T0FAKE001:U0OPER7QK',
  talksOnlyWith: '@pan', routing: ALL_BOTH, keyHash: 'c'.repeat(64), salt: 'd'.repeat(32),
};
const SLACK_PENDING = {
  id: SLACK_SEED.pending, network: 'slack', bot: { id: 'T0FAKE001:U0BOT0001', username: 'gravit', name: 'Gravit' }, workspace: 'Fake Co',
  link: 'https://slack.com/app_redirect?app=A0FAKE0001&team=T0FAKE001', qr: 'data:image/svg+xml;base64,PHN2Zy8+', expiresAt: '2026-11-04T15:10:00.000Z', state: 'waiting',
};
const slackAt = (step, manifest = MANIFEST) => R.identityConnectSet(
  R.identityConnectOpen(R.identityLoaded(R.nav(emptyState(NOW), { screen: 'account', tab: 'identity' }), { ok: true, networks: [], routing: {}, quiet: null, strangers: [], ...(manifest === null ? {} : { slackManifest: manifest }) }), 'slack'),
  { step, pending: step > 1 ? (step === 3 ? { ...SLACK_PENDING, state: 'heard', sender: { id: 'T0FAKE001:U0OPER7QK', name: 'Pan', handle: '@pan', userId: 'U0OPER7QK', masked: '…7QK', text: 'hi' } } : SLACK_PENDING) : null },
);

test('Slack\'s steps lists are the plan\'s, word for word', () => {
  assert.deepEqual(connectSteps(1, 'slack'), SLACK_STEPS_1);
  assert.deepEqual(connectSteps(2, 'slack'), SLACK_STEPS_2);
  assert.deepEqual(connectSteps(3, 'slack'), SLACK_STEPS_3);
  assert.equal(slackSteps4Note(), SLACK_STEPS_4_NOTE_WORDS);
  assert.deepEqual(listOf(renderConnectDrawer(slackAt(2))), SLACK_STEPS_2);
  assert.deepEqual(listOf(renderConnectDrawer(slackAt(3))), SLACK_STEPS_3);
});

test('sheet 1: Connect Slack · 1 of 4 · App tokens — the manifest with Copy, two password fields, no form, where they are kept, its steps above the keys', () => {
  const html = renderConnectDrawer(slackAt(1));
  assert.match(html, /<aside class="drawer sheet" aria-label="Connect Slack · 1 of 4 · App tokens">/);
  assert.match(html, /<h2>Connect Slack · 1 of 4 · App tokens<\/h2>/);
  assert.doesNotMatch(html, /<form/);
  // the manifest as the account gave it, escaped, in a <pre>, with Copy
  const pre = html.match(/<pre[^>]*id="identity-manifest"[^>]*>([\s\S]*?)<\/pre>/);
  assert.ok(pre, 'the manifest');
  assert.equal(decode(pre[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>')), MANIFEST);
  assert.ok(!html.includes('<b>&'), 'escaped');
  assert.match(html, /<button[^>]*data-action="identityCopyManifest"[^>]*>Copy<\/button>/);
  assert.ok(html.indexOf('identity-manifest') < html.indexOf('identity-app-token'), 'the manifest above the fields');
  // two password fields, the browser told to keep neither
  const app = html.match(/<input[^>]*id="identity-app-token"[^>]*>/)?.[0] ?? '';
  const bot = html.match(/<input[^>]*id="identity-bot-token"[^>]*>/)?.[0] ?? '';
  for (const input of [app, bot]) {
    assert.match(input, /type="password"/);
    assert.match(input, /autocomplete="off"/);
    assert.match(input, /spellcheck="false"/);
    assert.match(input, /data-lpignore="true"/);
    assert.match(input, /data-1p-ignore="true"/);
    assert.match(input, /data-form-type="other"/);
    assert.doesNotMatch(input, /value=/);
  }
  assert.match(html, /<label class="field-label" for="identity-app-token">App-level token \(xapp-…\)<\/label>/);
  assert.match(html, /<label class="field-label" for="identity-bot-token">Bot token \(xoxb-…\)<\/label>/);
  assert.ok(html.indexOf('identity-app-token') < html.indexOf('identity-bot-token'), 'the app-level token first');
  assert.ok(html.includes('Kept in: Account · :4820'));
  assert.ok(decode(html).includes("Never in: Gravit's box · ~/.dsh"));
  assert.deepEqual(listOf(html), SLACK_STEPS_1);
  const ol = html.indexOf('<ol class="sheet-steps">');
  const lastRow = html.lastIndexOf('<div class="btn-row">');
  assert.ok(ol > html.indexOf('identity-bot-token') && ol < lastRow, 'steps under the fields, above the buttons');
  assert.match(html.slice(lastRow), /identityClose[^>]*>Cancel<[\s\S]*identityNext[^>]*>Next</);
  // no manifest from the account: said, and no Copy
  const none = renderConnectDrawer(slackAt(1, null));
  assert.doesNotMatch(none, /<pre|identityCopyManifest/);
  assert.match(none, /The account gave no manifest: update the account, then open this sheet again\./);
  // a busy Next is off, both fields too
  const busy = renderConnectDrawer(R.identityConnectSet(slackAt(1), { busy: true }));
  assert.match(busy, /data-action="identityNext" disabled>Checking…</);
  assert.match(busy.match(/<input[^>]*id="identity-bot-token"[^>]*>/)[0], /disabled/);
  // Telegram's sheet 1 is as it was: one field, no manifest
  const tg = renderConnectDrawer(at(1));
  assert.doesNotMatch(tg, /identity-manifest|identity-app-token/);
  assert.match(tg, /id="identity-token"/);
});

test('sheet 4 for Slack: its seven lines, B1b\'s steps, and the ! note', () => {
  assert.deepEqual(identityLinesOf('connectNetwork', SLACK_SEED), ['Network: Slack', 'Speaks as: @gravit', 'Talks only with: @pan',
    'May send: Chat with Gravit, Watch alerts, Pre-close brief, Cards waiting, Fills and reports', 'Tokens kept in: Account · :4820', 'Signed by: this browser', 'Until: you disconnect']);
  assert.equal(identityTitleOf('connectNetwork', SLACK_SEED), 'Connect Slack · 4 of 4 · What you sign');
  assert.deepEqual(identityStepsOf('connectNetwork', SLACK_SEED), STEPS_4);
  assert.equal(identityNoteOf('connectNetwork', SLACK_SEED), SLACK_STEPS_4_NOTE_WORDS);
  assert.equal(identityNoteOf('connectNetwork', SEED), '', 'Telegram has no note');
  assert.deepEqual(identityDraftOf('connectNetwork', [], SLACK_SEED), {
    type: 'connectNetwork', network: 'slack', pending: SLACK_SEED.pending, botId: 'T0FAKE001:U0BOT0001', speaksAs: '@gravit', operatorId: 'T0FAKE001:U0OPER7QK',
    talksOnlyWith: '@pan', routing: ALL_BOTH, keyHash: SLACK_SEED.keyHash, salt: SLACK_SEED.salt,
  });
  assert.equal(connectRoutingOf({ ok: true, routing: { chat: ['telegram'], alerts: ['telegram'], brief: ['telegram'], cards: ['telegram'], fills: ['telegram'] } }, 'slack'), ALL_BOTH);
  // drawn: the steps, then the note under them, then the keys
  const shown = Object.entries({ ...identityDraftOf('connectNetwork', [], SLACK_SEED), nonce: NOW }).map(([name, value]) => ({ name, value: String(value) }));
  let s = R.sheetOpen(R.ownerStanding(emptyState(NOW), { role: 'signs', kid: 'a5048199a8081854' }), { kind: 'connectNetwork', seed: SLACK_SEED, fields: [] });
  s = R.sheetAsking(s, { quiet: false });
  s = R.sheetPrepared(s, { prepared: { ok: true, action: { type: 'connectNetwork' }, shown, quote: null }, at: NOW, asked: JSON.stringify(identityDraftOf('connectNetwork', [], SLACK_SEED)), deadline: null });
  const html = renderSheet(s, NOW);
  assert.match(html, /<h2>Connect Slack · 4 of 4 · What you sign<\/h2>/);
  assert.deepEqual(listOf(html), STEPS_4);
  const ol = html.indexOf('<ol class="sheet-steps">');
  const noteAt = html.indexOf('On Slack, type the phone');
  const keys = html.lastIndexOf('<div class="btn-row">');
  assert.ok(ol > 0 && ol < noteAt && noteAt < keys, 'steps, the note, keys');
  assert.ok(decode(html).includes(SLACK_STEPS_4_NOTE_WORDS));
  // Telegram's sheet 4 draws no note
  const tg = renderSheet(R.sheetOpen(emptyState(NOW), { kind: 'connectNetwork', seed: SEED, fields: [] }), NOW);
  assert.doesNotMatch(tg, /type the phone/);
});

test('Disconnect Slack drafts disconnectNetwork slack with Slack\'s words', () => {
  const seed = { network: 'slack' };
  assert.deepEqual(identityDraftOf('disconnectNetwork', [], seed), { type: 'disconnectNetwork', network: 'slack' });
  assert.equal(titleOf('disconnectNetwork', seed), 'Disconnect Slack');
  assert.deepEqual(identityLinesOf('disconnectNetwork', seed), [
    'Gravit stops reading and sending on Slack.',
    'Both tokens are deleted from the account.',
    'The desk keeps working in the face.',
  ]);
  const html = renderSheet(R.sheetOpen(R.ownerStanding(emptyState(NOW), { role: 'signs', kid: 'a5048199a8081854' }), { kind: 'disconnectNetwork', seed, fields: [] }), NOW);
  assert.match(html, /<h2>Disconnect Slack<\/h2>/);
  assert.match(html, /Both tokens are deleted from the account\./);
});

test('the routing sheet says what each connected network is sent', () => {
  const seed = { routing: { chat: ['slack', 'telegram'], alerts: ['telegram'], brief: [], cards: ['slack'], fills: [] }, quiet: null, saved: 'chat=;alerts=;brief=;cards=;fills=', networks: ['telegram', 'slack'] };
  assert.deepEqual(identityLinesOf('routing', seed), ['On Telegram: Chat with Gravit, Watch alerts', 'On Slack: Chat with Gravit, Cards waiting']);
  assert.deepEqual(identityLinesOf('routing', { ...seed, networks: ['slack'] }), ['On Slack: Chat with Gravit, Cards waiting']);
  assert.deepEqual(identityLinesOf('routing', { ...seed, networks: undefined }), ['On Telegram: Chat with Gravit, Watch alerts'], 'none named: Telegram, as before');
});

test("what a network may send is listed under the table's separator", async () => {
  const { withTable } = await import('../../client/js/i18n/words.js');
  withTable({ 'common.list.sep': '、' }, () => {
    assert.equal(identityLinesOf('connectNetwork', SEED)[3], 'May send: Chat with Gravit、Watch alerts、Pre-close brief、Cards waiting、Fills and reports');
    assert.deepEqual(identityLinesOf('routing', { routing: SEED_ROUTING }), ['On Telegram: Chat with Gravit、Watch alerts、Cards waiting、Fills and reports']);
  });
});
