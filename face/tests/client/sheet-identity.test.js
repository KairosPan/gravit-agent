// Account › Identity's sheets (plan B1b Task 2, spec §5.2): Connect Telegram's four sheets as drawn — 1 to 3 the Identity drawer
// (render/identity.js renderConnectDrawer), 4 the owner sheet's connectNetwork kind (host/sheet-identity.js through
// host/sheet-view.js, drawn by render/owner.js renderSheet) — their titles, lines and numbered instructions word for word, the
// steps above the keys, and sheet 4's draft from its seed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { renderConnectDrawer, CONNECT_STEPS, etClock } from '../../client/js/render/identity.js';
import { renderSheet } from '../../client/js/render/owner.js';
import { IDENTITY_KINDS, identityTitleOf, identityGoOf, identityFieldsOf, identityDraftOf, identityLinesOf, identityStepsOf, rowsSentOn } from '../../client/js/host/sheet-identity.js';
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
  assert.deepEqual(CONNECT_STEPS[1], STEPS_1);
  assert.deepEqual(CONNECT_STEPS[2], STEPS_2);
  assert.deepEqual(CONNECT_STEPS[3], STEPS_3);
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
  assert.equal(typeof identityDraftOf('disconnectNetwork', [], { network: 'slack' }), 'string', 'only a network the account speaks on');
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
  assert.equal(typeof identityDraftOf('block', [], { ...seed, network: 'slack' }), 'string');
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
