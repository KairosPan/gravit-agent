// Account › Identity's sheets (plan B1b Task 2, spec §5.2; since sign-only-money, three): Connect's sheets as drawn, the Identity
// drawer (render/identity.js renderConnectDrawer) — their titles and numbered instructions word for word, the steps above the keys —
// and the four acts as the account's actions (host/sheet-identity.js identityActionOf), unsigned and no owner sheet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { renderConnectDrawer, connectSteps } from '../../client/js/render/identity.js';
import { etClock } from '../../client/js/time.js';
import { identityActionOf, rowsSentOn } from '../../client/js/host/sheet-identity.js';
import { SHEET_KINDS } from '../../client/js/host/sheet-view.js';
import { connectRoutingOf } from '../../client/js/host/identity.js';
import { t } from '../../client/js/i18n/words.js';

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

test('the three steps lists are the spec\'s, word for word', () => {
  assert.deepEqual(connectSteps(1), STEPS_1);
  assert.deepEqual(connectSteps(2), STEPS_2);
  assert.deepEqual(connectSteps(3), STEPS_3);
  assert.deepEqual(connectSteps(1, 'telegram'), STEPS_1);
});

test('sheet 1: Bot token, a password field with Paste and Next, where it is kept and where it never goes, then its steps above the buttons', () => {
  const html = renderConnectDrawer(at(1));
  assert.match(html, /<aside class="drawer sheet" aria-label="Connect Telegram · 1 of 3 · Bot token">/);
  assert.match(html, /<h2>Connect Telegram · 1 of 3 · Bot token<\/h2>/);
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
  assert.match(two, /<h2>Connect Telegram · 2 of 3 · Say hi<\/h2>/);
  assert.deepEqual(listOf(two), STEPS_2);
  assert.match(two, /identityBack[^>]*>Back<[\s\S]*identityClose[^>]*>Cancel</);
  const three = renderConnectDrawer(at(3));
  assert.match(three, /<h2>Connect Telegram · 3 of 3 · Is this you\?<\/h2>/);
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

test("Identity's acts are no owner sheet: no sheet kind, no What you sign", () => {
  for (const k of ['connectNetwork', 'disconnectNetwork', 'routing', 'block', 'setRouting', 'blockSender']) assert.ok(!SHEET_KINDS.includes(k), k);
  assert.equal(identityActionOf('nonsense', {}), '');
});

test('connectNetwork is built from its seed alone, the fingerprint and never the token', () => {
  assert.deepEqual(identityActionOf('connectNetwork', SEED), {
    type: 'connectNetwork', network: 'telegram', pending: SEED.pending, botId: '777', speaksAs: '@gravit_desk_bot', operatorId: '555000123',
    talksOnlyWith: '@pan', routing: ALL_TELEGRAM, keyHash: SEED.keyHash, salt: SEED.salt,
  });
  assert.equal(typeof identityActionOf('connectNetwork', { ...SEED, pending: '' }), 'string');
  assert.equal(typeof identityActionOf('connectNetwork', { ...SEED, keyHash: 'nope' }), 'string');
  assert.equal(typeof identityActionOf('connectNetwork', { ...SEED, salt: 'B'.repeat(32) }), 'string');
  assert.ok(!('token' in identityActionOf('connectNetwork', { ...SEED, token: 'x' })));
  // ruling 4: the routing now with Telegram ticked in every row
  assert.equal(connectRoutingOf({ ok: true, routing: { chat: [], alerts: [], brief: [], cards: [], fills: [] } }), ALL_TELEGRAM);
  assert.equal(connectRoutingOf(null), ALL_TELEGRAM);
  assert.deepEqual(rowsSentOn('chat=telegram;alerts=;brief=telegram;cards=;fills=', 'telegram'), ['Chat with Gravit', 'Pre-close brief']);
});

// ── Task 3: Disconnect, What reaches you where with quiet hours, and Block ──

test('disconnect is disconnectNetwork, only for a network the account speaks on', () => {
  for (const network of ['telegram', 'slack', 'imessage']) assert.deepEqual(identityActionOf('disconnectNetwork', { network }), { type: 'disconnectNetwork', network });
  assert.equal(identityActionOf('disconnectNetwork', { network: 'fax' }), 'Nothing connected to disconnect here');
  assert.equal(typeof identityActionOf('disconnectNetwork', {}), 'string');
});

const SEED_ROUTING = { chat: ['telegram'], alerts: ['telegram'], brief: [], cards: ['telegram'], fills: ['telegram'] };
const SEED_STRING = 'chat=telegram;alerts=telegram;brief=;cards=telegram;fills=telegram';
const RSEED = { routing: SEED_ROUTING, quiet: { from: '23:00', to: '07:00' }, saved: SEED_STRING };
// quiet hours' fields as their editor reads them: the seed's clocks and Off, then what was changed
const rfields = (over = {}, seed = RSEED) => ({ quietFrom: seed.quiet?.from ?? '', quietTo: seed.quiet?.to ?? '', quietOff: !seed.quiet, ...over });

test('routing sends the grid as the account\'s string and the quiet hours, refuses equal times and an unchanged draft', () => {
  const SEED = RSEED;
  const fields = rfields;
  assert.deepEqual(identityActionOf('routing', SEED, fields({ quietFrom: '22:00', quietTo: '06:30' })), { type: 'setRouting', routing: SEED_STRING, quietFrom: '22:00', quietTo: '06:30' });
  assert.equal(identityActionOf('routing', SEED, fields({ quietFrom: '22:00', quietTo: '22:00' })), 'Quiet hours start and end at different times');
  assert.equal(identityActionOf('routing', SEED, fields({ quietOff: true })).quietFrom, '');
  // off is both ends empty, which the account stores as null
  assert.deepEqual(identityActionOf('routing', SEED, fields({ quietOff: true })), { type: 'setRouting', routing: SEED_STRING, quietFrom: '', quietTo: '' });
  // unchanged: the account's routing and its quiet hours as they are
  assert.equal(identityActionOf('routing', SEED, fields()), 'That is how it is now');
  assert.equal(identityActionOf('routing', { ...SEED, quiet: null }, fields({}, { ...SEED, quiet: null })), 'That is how it is now');
  // a draft routing (the grid's unsaved ticks) is a change with the quiet hours as they are
  const ticked = { ...SEED, routing: { ...SEED_ROUTING, brief: ['telegram'] } };
  assert.deepEqual(identityActionOf('routing', ticked, rfields({}, ticked)), { type: 'setRouting', routing: 'chat=telegram;alerts=telegram;brief=telegram;cards=telegram;fills=telegram', quietFrom: '23:00', quietTo: '07:00' });
  // quiet hours on with an end missing or not a clock
  assert.equal(typeof identityActionOf('routing', SEED, fields({ quietFrom: '' })), 'string');
  assert.equal(typeof identityActionOf('routing', SEED, fields({ quietTo: '7am' })), 'string');
  // turning them on from off needs both times
  const off = { ...SEED, quiet: null };
  assert.equal(typeof identityActionOf('routing', off, rfields({ quietOff: false }, off)), 'string');
  assert.deepEqual(identityActionOf('routing', off, rfields({ quietOff: false, quietFrom: '21:00', quietTo: '06:00' }, off)), { type: 'setRouting', routing: SEED_STRING, quietFrom: '21:00', quietTo: '06:00' });
});

test('block is blockSender for the stranger\'s ref, shown by its masked id', () => {
  const seed = { network: 'telegram', sender: '0a1b2c3d4e5f', masked: '…789' };
  assert.deepEqual(identityActionOf('block', seed), { type: 'blockSender', network: 'telegram', sender: '0a1b2c3d4e5f', masked: '…789' });
  assert.equal(typeof identityActionOf('block', { ...seed, sender: '' }), 'string');
  assert.equal(typeof identityActionOf('block', { ...seed, masked: '' }), 'string');
  assert.equal(typeof identityActionOf('block', { ...seed, network: 'fax' }), 'string');
  assert.deepEqual(identityActionOf('block', { ...seed, network: 'imessage', masked: '…com' }), { type: 'blockSender', network: 'imessage', sender: '0a1b2c3d4e5f', masked: '…com' });
  assert.deepEqual(identityActionOf('block', { ...seed, network: 'slack', masked: '…7QK' }), { type: 'blockSender', network: 'slack', sender: '0a1b2c3d4e5f', masked: '…7QK' });
});

test('sheet 1 is no form, so the browser is not invited to keep the bot token as a password', () => {
  const html = renderConnectDrawer(at(1));
  assert.doesNotMatch(html, /<form/);
  const input = html.match(/<input[^>]*id="identity-token"[^>]*>/)?.[0] ?? '';
  assert.match(input, /type="password"/);
  assert.match(input, /data-lpignore="true"/);
  assert.match(input, /data-1p-ignore="true"/);
});

// ── plan B2 Task 7: Connect Slack's sheets ──

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
const SLACK_NOTE_WORDS = 'On Slack, type the phone\'s commands with ! — !status, !pause 30m, !mute 30m, !new, !stop.';
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
  assert.deepEqual(listOf(renderConnectDrawer(slackAt(2))), SLACK_STEPS_2);
  assert.deepEqual(listOf(renderConnectDrawer(slackAt(3))), SLACK_STEPS_3);
});

test('sheet 1: Connect Slack · 1 of 3 · App tokens — the manifest with Copy, two password fields, no form, where they are kept, its steps above the keys', () => {
  const html = renderConnectDrawer(slackAt(1));
  assert.match(html, /<aside class="drawer sheet" aria-label="Connect Slack · 1 of 3 · App tokens">/);
  assert.match(html, /<h2>Connect Slack · 1 of 3 · App tokens<\/h2>/);
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

test("This is me for Slack sends connectNetwork slack; sheet 3 carries the ! note, Telegram's none", () => {
  assert.deepEqual(identityActionOf('connectNetwork', SLACK_SEED), {
    type: 'connectNetwork', network: 'slack', pending: SLACK_SEED.pending, botId: 'T0FAKE001:U0BOT0001', speaksAs: '@gravit', operatorId: 'T0FAKE001:U0OPER7QK',
    talksOnlyWith: '@pan', routing: ALL_BOTH, keyHash: SLACK_SEED.keyHash, salt: SLACK_SEED.salt,
  });
  assert.equal(connectRoutingOf({ ok: true, routing: { chat: ['telegram'], alerts: ['telegram'], brief: ['telegram'], cards: ['telegram'], fills: ['telegram'] } }, 'slack'), ALL_BOTH);
  const three = renderConnectDrawer(slackAt(3));
  assert.ok(decode(three).includes(SLACK_NOTE_WORDS));
  assert.ok(three.indexOf('type the phone') < three.indexOf('<ol class="sheet-steps">'), 'the note above the steps');
  assert.doesNotMatch(renderConnectDrawer(slackAt(2)), /type the phone/);
  assert.doesNotMatch(renderConnectDrawer(at(3)), /type the phone/, "Telegram's none");
});

// ── the iMessage plan: Connect iMessage's sheets ──

const IM_SEED = {
  network: 'imessage', pending: 'aaaabbbbccccddddaaaabbbbccccdddd', botId: 'prj_1:+14155550123', speaksAs: '+14155550123', operatorId: '+14155550100', talksOnlyWith: '+14155550100',
  routing: 'chat=imessage;alerts=imessage;brief=;cards=imessage;fills=imessage', keyHash: 'c'.repeat(8) + 'a'.repeat(56), salt: 'b'.repeat(32),
};
const draft = IM_SEED;
const imAt = () => R.identityConnectOpen(R.nav(emptyState(NOW), { screen: 'account', tab: 'identity' }), 'imessage');

test("iMessage's steps lists, word for word", () => {
  assert.deepEqual(connectSteps(1, 'imessage'), [
    'Make a free Photon account and create a project used only for Gravit.',
    "In the project's Settings, copy the project ID and the project secret.",
    'Paste them below, then pick your country or region and type your mobile number.',
  ]);
  assert.deepEqual(connectSteps(2, 'imessage'), [
    "On your iPhone, open the link or scan the code with the camera: a new message opens, addressed to Gravit's number. Send hi.",
    'Wait here: this sheet moves on when Gravit hears you from your number.',
  ]);
  assert.deepEqual(connectSteps(3, 'imessage'), [
    'This is me: Gravit talks only with this number, on iMessage.',
    'Not me: that sender is listed under Not you and never reaches Gravit. Say hi again from your own iPhone.',
  ]);
  assert.deepEqual(connectSteps(4, 'imessage'), []);
});

test('sheet 1: Connect iMessage · 1 of 3 · Photon project — one line on Photon, its guide on top with the button to Photon, three fields, where the secret is kept', () => {
  const html = renderConnectDrawer(imAt());
  assert.match(html, /<aside class="drawer sheet" aria-label="Connect iMessage · 1 of 3 · Photon project">/);
  assert.match(decode(html), /Gravit's iMessage goes through Photon, and your messages pass through its servers\./);
  assert.match(html, /<a class="btn-sm sheet-link" href="https:\/\/app\.photon\.codes" target="_blank" rel="noopener noreferrer">Open Photon ↗<\/a>/);
  assert.match(html, /<input id="identity-photon-project" class="input" type="text" autocomplete="off"/);
  assert.match(html, /<input id="identity-photon-secret" class="input" type="password" autocomplete="off"/);
  assert.match(html, /<input id="identity-photon-phone" class="input" type="tel" inputmode="tel" autocomplete="off"/);
  for (const label of ['Project ID', 'Project secret', 'Your mobile number']) assert.ok(html.includes(`>${label}</label>`), label);
  // the region list before the number, on the default region, each option its name and calling code
  const select = html.indexOf('<select id="identity-photon-region"');
  assert.ok(select > 0 && select < html.indexOf('id="identity-photon-phone"'));
  assert.match(html, /aria-label="Country or region"/);
  assert.match(html, /<option value="US" selected>United States \+1<\/option>/);
  assert.match(html, /<option value="CN">China \+86<\/option>/);
  assert.match(renderConnectDrawer({ ...imAt(), identity: { ...imAt().identity, connect: { ...imAt().identity.connect, region: 'CN' } } }), /<option value="CN" selected>/);
  assert.ok(html.includes('Kept in: Account · :4820'));
  assert.ok(decode(html).includes("Never in: Gravit's box · ~/.dsh"));
  assert.doesNotMatch(html, /<form/);
  // the guide once, above the fields, the button in its first step
  const ol = html.indexOf('<ol class="sheet-steps">');
  assert.ok(ol >= 0 && ol < html.indexOf('identity-photon-project'));
  assert.equal(html.indexOf('<ol class="sheet-steps">', ol + 1), -1);
  assert.ok(html.indexOf('app.photon.codes') < html.indexOf('</li>', ol));
  assert.deepEqual([...html.slice(html.indexOf('<ol class="sheet-steps">'), html.indexOf('</ol>')).matchAll(/<li>([^<]*)/g)].map(m => decode(m[1])), connectSteps(1, 'imessage'));
});

test('connectNetwork for iMessage: its numbers, no @', () => {
  assert.deepEqual(identityActionOf('connectNetwork', draft), {
    type: 'connectNetwork', network: 'imessage', pending: draft.pending, botId: 'prj_1:+14155550123', speaksAs: '+14155550123', operatorId: '+14155550100',
    talksOnlyWith: '+14155550100', routing: draft.routing, keyHash: draft.keyHash, salt: draft.salt,
  });
});

test('Connect Telegram · 1 of 3 · …: the titles count three sheets', () => {
  const titleAt = (net, step) => {
    const open = R.identityConnectOpen(R.nav(emptyState(NOW), { screen: 'account', tab: 'identity' }), net);
    return renderConnectDrawer(R.identityConnectSet(open, { step, pending: step > 1 ? { ...PENDING, network: net, ...(step === 3 ? { state: 'heard', sender: { id: '1', name: 'Pan', handle: '@pan', masked: '…1', text: 'hi' } } : {}) } : null })).match(/<h2>([^<]*)<\/h2>/)[1];
  };
  assert.deepEqual([1, 2, 3].map(n => titleAt('telegram', n)), ['Connect Telegram · 1 of 3 · Bot token', 'Connect Telegram · 2 of 3 · Say hi', 'Connect Telegram · 3 of 3 · Is this you?']);
  assert.deepEqual([1, 2, 3].map(n => titleAt('slack', n)), ['Connect Slack · 1 of 3 · App tokens', 'Connect Slack · 2 of 3 · Say hi', 'Connect Slack · 3 of 3 · Is this you?']);
  assert.deepEqual([1, 2, 3].map(n => titleAt('imessage', n)), ['Connect iMessage · 1 of 3 · Photon project', 'Connect iMessage · 2 of 3 · Say hi', 'Connect iMessage · 3 of 3 · Is this you?']);
  for (const net of ['telegram', 'slack', 'imessage']) for (const n of [1, 2, 3]) assert.doesNotMatch(titleAt(net, n), /of 4/);
});
