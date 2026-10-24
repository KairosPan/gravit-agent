// The owner's screen pieces (spec 2026-10-22 §6.3, plan 2 Task 6): the device line under the Account head's chips and its one
// key (the pair box, Sign in), Settings › Devices, and the sheet drawn — its fields by type, the quote box, What you sign, the
// countdown, what the Account said, Cancel and the go key, on only while the shown preparation is the form's. States built with
// the reducers over the stand-in's answers (tests/fixtures/account/).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderDeviceLine, renderDevices, renderSheet } from '../../client/js/render/owner.js';
import { reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { fieldsOf, keyfileAskOf } from '../../client/js/host/sheet-view.js';
import { connectOptionsOf } from '../../client/js/host/account-view.js';
import { esc } from '../../client/js/html.js';
import { askedOf } from '../../client/js/host/sheet.js';
import { fmtDate } from '../../client/js/time.js';

const NOW = Date.parse('2026-10-22T07:40:00.000Z');
const KID = 'a5048199a8081854';
const CJK = /[㐀-鿿]/;
const fx = name => JSON.parse(readFileSync(new URL(`../fixtures/account/${name}.json`, import.meta.url), 'utf8'));
const has = (html, fragment, why = fragment) => assert.ok(html.includes(fragment), `missing: ${why}`);
const lacks = (html, fragment, why = fragment) => assert.ok(!html.includes(fragment), `present: ${why}`);
// nothing a renderer should ever print: a hole, a raw object, the Account's JSON as it came
const clean = html => {
  assert.doesNotMatch(html, /undefined|NaN|\[object Object\]|\{"|":/, 'no hole, no raw object, no raw JSON');
  assert.doesNotMatch(html, CJK, 'English only');
};

const standing = (role, kid = '', page = fx('account')) => R.ownerStanding(R.accountLoaded(emptyState(), { data: page, at: NOW }), { role, kid });
// a sheet opened on its kind's fields, then each change as the engine lands it
const opened = (kind, seed, s = emptyState()) => R.sheetOpen(s, { kind, seed, fields: fieldsOf(kind, seed) });
// a sheet prepared for its form as it stands: what it was asked for is the form's draft at time zero
const prepared = (s, body, deadline = null) => R.sheetPrepared(s, { prepared: body, at: NOW, asked: askedOf(s.sheet), deadline });
const ADDRESS = '0x00000000000000000000000000000000000000ab';
const letInBody = () => ({
  ok: true, action: { type: 'approveAgent', agentAddress: ADDRESS, agentName: 'Claude Code', validUntil: 1_795_446_000_000, nonce: 1_792_854_221_990 },
  primaryType: 'AccountApproval:Agent', shown: [
    { name: 'agentAddress', value: ADDRESS }, { name: 'agentName', value: 'Claude Code' },
    { name: 'validUntil', value: '1795446000000' }, { name: 'nonce', value: '1792854221990' },
  ],
});
const CARD = { card: 'card-0001', hash: '0xdf578d9e3045cac33e2dd0b4d7c595b22771305fb678ad2e09c0e0397476aaac', decision: 'approve' };
const GO = /<button type="button" class="btn-primary" data-action="sheetSubmit"( disabled)?>([^<]*)<\/button>/;
const goKey = html => { const m = html.match(GO); assert.ok(m, 'the go key is drawn'); return { on: !m[1], word: m[2] }; };

test('the device line: the six standings, each its line and its one key', () => {
  const signs = renderDeviceLine(standing('signs', KID));
  assert.equal(signs, '<p class="acct-note">This page signs for the account</p>');
  assert.equal(renderDeviceLine(standing('pending', KID)), '<p class="acct-note">Waiting to be let in — Let it sign on the Account page, under Devices</p>');
  assert.equal(renderDeviceLine(standing('none')), '<p class="acct-note">This browser cannot sign for the account</p>');
  assert.equal(renderDeviceLine(standing('unknown')), '', 'not known yet: nothing');
  // the pair box, only for a page that needs the code
  const pair = renderDeviceLine(standing('needs-code'));
  has(pair, '<p class="acct-note">Pair with the code the Account printed in its terminal</p>');
  has(pair, '<div class="pair-box"><input id="pair-code" class="input small" type="text" autocomplete="off" aria-label="Pairing code">' +
    '<button type="button" class="btn-sm" data-action="pairDevice">Pair</button></div>');
  lacks(pair, 'data-action="signIn"');
  // Sign in, only for a page signed out
  const out = renderDeviceLine(standing('signed-out', KID));
  has(out, '<p class="acct-note">Signed out</p>');
  has(out, '<button type="button" class="btn-sm" data-action="signIn">Sign in</button>');
  lacks(out, 'pair-code');
  for (const html of [signs, renderDeviceLine(standing('pending', KID)), renderDeviceLine(standing('none'))]) {
    lacks(html, 'pair-code');
    lacks(html, 'data-action="signIn"');
  }
  // the Account's refusal to the device rides the same one line; a pairing in the air holds the key
  const refused = R.ownerBusy(R.ownerRefusal(standing('needs-code'), 'the pairing code is <b>wrong</b>'), true);
  const html = renderDeviceLine(refused);
  has(html, '<p class="acct-note">Pair with the code the Account printed in its terminal · the pairing code is &lt;b&gt;wrong&lt;/b&gt;</p>');
  has(html, 'data-action="pairDevice" disabled>Pair</button>');
  assert.equal(html.match(/class="acct-note"/g).length, 1, 'one muted line');
  clean(html + pair + out + signs);
});

test('Devices: the owners with this page marked, the devices waiting with Let it sign, Sign out — only for a page that signs', () => {
  const page = fx('account');
  page.signers.owners.push({ id: 'device:0f0f0f0f0f0f0f0f', kind: 'device', label: 'Laptop <b>two</b>' });
  page.signers.pendingDevices = [{ kid: '0123456789abcdef', at: '2026-10-22T07:40:00.000Z' }];
  const signs = renderDevices(standing('signs', KID, page));
  has(signs, '<div class="dsec"><div class="dsec-label">Devices</div>');
  has(signs, `<div class="dsec-line">Stand-in seed key · device:${KID} · this page</div>`);
  has(signs, '<div class="dsec-line">Laptop &lt;b&gt;two&lt;/b&gt; · device:0f0f0f0f0f0f0f0f</div>');
  has(signs, `<div class="venue"><span>0123456789abcdef · since ${fmtDate(Date.parse('2026-10-22T07:40:00.000Z'))}</span>` +
    '<button type="button" class="btn-sm" data-action="letDevice" data-kid="0123456789abcdef">Let it sign</button></div>');
  has(signs, '<button type="button" class="btn-sm" data-action="signOut">Sign out</button>');
  assert.equal(signs.match(/this page/g).length, 1, 'only this page is marked');
  clean(signs);
  // a page waiting to be let in sees the same rows and no key
  const waiting = renderDevices(standing('pending', '0123456789abcdef', page));
  has(waiting, `<div class="dsec-line">Stand-in seed key · device:${KID}</div>`);
  has(waiting, '0123456789abcdef · since ');
  for (const html of [waiting, renderDevices(standing('none', '', page)), renderDevices(standing('signed-out', KID, page))]) {
    lacks(html, 'data-action="letDevice"');
    lacks(html, 'data-action="signOut"');
  }
  lacks(waiting, 'this page', 'a page waiting is not an owner yet');
  // signed out, the page's key is still the owner's: marked, without a key
  has(renderDevices(standing('signed-out', KID, page)), `<div class="dsec-line">Stand-in seed key · device:${KID} · this page</div>`);
  // an owner without a label is its id; a waiting device with no time is its kid alone
  const bare = fx('account');
  bare.signers.owners = [{ id: `device:${KID}`, kind: 'device' }];
  bare.signers.pendingDevices = [{ kid: 'fedcba9876543210' }];
  const html = renderDevices(standing('signs', KID, bare));
  has(html, `<div class="dsec-line">device:${KID} · this page</div>`);
  has(html, '<span>fedcba9876543210</span>');
  clean(html);
  // no page read: no Devices
  assert.equal(renderDevices(R.ownerStanding(emptyState(), { role: 'signs', kid: KID })), '');
});

test('a Let in sheet draws its fields by type and no live go key before a preparation', () => {
  const s = opened('letIn', {});
  const html = renderSheet(s, NOW);
  assert.match(html, /^<aside class="drawer sheet" aria-label="Let a key in"><div class="drawer-head"><h2>Let a key in<\/h2>/);
  has(html, '<button type="button" class="close-key" data-action="sheetClose" aria-label="Close">×</button>');
  has(html, '<label class="field"><span class="field-label">Key address</span><input class="input" type="text" name="address" value="" placeholder="0x…" autocomplete="off" data-action="sheetField"></label>');
  has(html, '<label class="field"><span class="field-label">Name</span><input class="input" type="text" name="name" value="" placeholder="Claude Code" autocomplete="off" data-action="sheetField"></label>');
  // a seg through seg(), each item naming its field
  has(html, '<div class="field"><span class="field-label">Good for</span><div class="seg">');
  has(html, '<button type="button" class="seg-item pressed" aria-pressed="true" data-action="sheetField" data-value="30" name="days">30 days</button>');
  has(html, 'data-value="1" name="days">1 day</button>');
  has(html, '<div class="sheet-quote"><p class="acct-note">Fill it in to see what it would be.</p></div>');
  has(html, '<button type="button" class="btn-sm" data-action="sheetClose">Cancel</button>');
  assert.deepEqual(goKey(html), { on: false, word: 'Let it in' });
  lacks(html, 'What you sign');
  lacks(html, 'sheet-left');
  clean(html);
  // what is missing, in the sheet-view's words, in the same box
  const missing = renderSheet(R.sheetIncomplete(s, "Type the key's address"), NOW);
  has(missing, '<div class="sheet-quote"><p class="acct-note">Type the key&#39;s address</p></div>');
  assert.equal(goKey(missing).on, false);
  // asking: the box says so, the key stays off
  const asking = renderSheet(R.sheetAsking(s, {}), NOW);
  has(asking, '<div class="sheet-quote"><p class="acct-note">Asking…</p></div>');
  assert.equal(goKey(asking).on, false);
});

test('a ready sheet draws What you sign verbatim and a live key; a changed field dims it and takes the key off', () => {
  let s = opened('letIn', {});
  s = R.sheetField(s, { name: 'address', value: ADDRESS });
  s = R.sheetField(s, { name: 'name', value: 'Claude Code' });
  s = prepared(s, letInBody());
  const html = renderSheet(s, NOW);
  has(html, '<input class="input" type="text" name="address" value="0x00000000000000000000000000000000000000ab"');
  has(html, '<details class="acct-shown"><summary>What you sign</summary>' +
    `<div class="dsec-line">agentAddress: ${ADDRESS}</div><div class="dsec-line">agentName: Claude Code</div>` +
    '<div class="dsec-line">validUntil: 1795446000000</div><div class="dsec-line">nonce: 1792854221990</div></details>');
  assert.deepEqual(goKey(html), { on: true, word: 'Let it in' });
  lacks(html, 'sheet-quote', 'a preparation with no quote words draws no box');
  clean(html);
  // the form changed while the quiet ask is in the air: the shown preparation is drawn dimmed and the key is off
  const changed = R.sheetField(s, { name: 'name', value: 'Codex' });
  const stale = renderSheet(changed, NOW);
  has(stale, '<details class="acct-shown stale"><summary>What you sign</summary>');
  has(stale, 'name="name" value="Codex"');
  assert.equal(goKey(stale).on, false);
  // changed back: the same draft as asked, live again
  assert.equal(goKey(renderSheet(R.sheetField(changed, { name: 'name', value: 'Claude Code' }), NOW)).on, true);
  // the days moved: another validUntil, another draft
  assert.equal(goKey(renderSheet(R.sheetField(s, { name: 'days', value: '7' }), NOW)).on, false);
  // a card's sheet has no fields: its preparation, its words, Approve
  const card = prepared(opened('approveCard', CARD), fx('prepared-card'));
  const cardHtml = renderSheet(card, NOW);
  assert.match(cardHtml, /aria-label="Approve the card"/);
  has(cardHtml, `<div class="dsec-line">action: ${CARD.hash}</div>`);
  assert.deepEqual(goKey(cardHtml), { on: true, word: 'Approve' });
  lacks(cardHtml, 'class="field"');
  // signing: the key goes off; done: what the Account said
  assert.equal(goKey(renderSheet(R.sheetSigning(card), NOW)).on, false);
  const done = renderSheet(R.sheetDone(R.sheetSigning(card), { said: 'Done' }), NOW);
  has(done, '<p class="acct-note">Done</p>');
  assert.equal(goKey(done).on, false);
});

test('a refusal is the Account\'s sentence, with Prepare again only when preparing again is the answer', () => {
  const s = opened('approveCard', CARD);
  const again = renderSheet(R.sheetRefused(s, { message: 'this order was good for ten minutes after it was prepared: prepare it <again>', again: true }), NOW);
  has(again, '<div class="sheet-quote"><p class="acct-note">this order was good for ten minutes after it was prepared: prepare it &lt;again&gt;</p>' +
    '<div class="btn-row"><button type="button" class="btn-sm" data-action="sheetAgain">Prepare again</button></div></div>');
  assert.equal(goKey(again).on, false);
  const no = renderSheet(R.sheetRefused(s, { message: 'not an instruction this account knows', again: false }), NOW);
  has(no, '<p class="acct-note">not an instruction this account knows</p>');
  lacks(no, 'sheetAgain');
  // the Account gave no sentence: the reducer's own word
  has(renderSheet(R.sheetRefused(s, {}), NOW), '<p class="acct-note">Refused</p>');
  clean(again + no);
});

test('the countdown: the signature\'s minutes while a deadline is held, nothing past it', () => {
  const card = opened('approveCard', CARD);
  const html = renderSheet(prepared(card, fx('prepared-card'), NOW + 125_000), NOW);
  has(html, '<p class="sheet-left">Your signature is good for 2:05 more.</p>');
  lacks(renderSheet(prepared(card, fx('prepared-card'), NOW - 1), NOW), 'sheet-left');
  lacks(renderSheet(prepared(card, fx('prepared-card')), NOW), 'sheet-left', 'no deadline, no countdown');
  // an order's quote words above it (Task 11 draws the ticket's own figures)
  const order = R.sheetPrepared(R.sheetOpen(emptyState(), { kind: 'order', seed: {}, fields: [] }), { prepared: fx('prepared-order'), at: NOW, asked: null, deadline: NOW + 600_000 });
  const orderHtml = renderSheet(order, NOW);
  has(orderHtml, '<div class="sheet-quote"><b>buy 0.0099 ETH at Stand-in Exchange · market · about $24.31</b></div>');
  has(orderHtml, '<p class="sheet-left">Your signature is good for 10:00 more.</p>');
  assert.equal(orderHtml.match(/class="dsec-line"/g).length, 18, 'the seventeen fields and the nonce, verbatim');
  assert.deepEqual(goKey(orderHtml), { on: false, word: 'Sign and place' });
  clean(html + orderHtml);
});

test('the fields by type: a pick as checkboxes, a select with what is picked, a number as typed', () => {
  const venues = [{ id: 'paper-1', name: 'Paper <i>one</i>', paper: true }, { id: 'ex', name: 'Stand-in Exchange', paper: false }];
  const limit = renderSheet(opened('limit', { address: '0xb0b', name: 'Scout', venues, current: { allow: ['paper-1'], perPayment: '50', budget: '500' } }), NOW);
  has(limit, '<div class="field" role="group" aria-label="Venues"><span class="field-label">Venues</span>' +
    '<label class="sheet-check"><input type="checkbox" name="allow" value="paper-1" checked data-action="sheetField">Paper &lt;i&gt;one&lt;/i&gt;</label>' +
    '<label class="sheet-check"><input type="checkbox" name="allow" value="ex" data-action="sheetField">Stand-in Exchange</label></div>');
  has(limit, '<input class="input" type="text" name="perPayment" value="50" placeholder="100" inputmode="decimal" autocomplete="off" data-action="sheetField">');
  assert.match(limit, /<h2>Give Scout a limit<\/h2>/);
  const options = [{ connector: 'live:exchange', kind: 'exchange', label: 'An exchange account', needs: 'key-file', venues: ['okx'] }, { connector: 'live:broker', label: 'A broker', needs: 'key-file' }];
  const connect = renderSheet(opened('connect', { options }), NOW);
  has(connect, '<label class="field"><span class="field-label">What to connect</span><select class="input" name="connector" data-action="sheetField">' +
    '<option value="" selected disabled></option><option value="live:exchange">An exchange account</option><option value="live:broker">A broker</option></select></label>');
  const picked = renderSheet(opened('connect', { options, connector: 'live:broker' }), NOW);
  has(picked, '<select class="input" name="connector" data-action="sheetField"><option value="live:exchange">An exchange account</option><option value="live:broker" selected>A broker</option></select>');
  clean(limit + connect + picked);
  // an order sheet has no fields yet: the generic shell, no throw
  const order = renderSheet(R.sheetOpen(emptyState(), { kind: 'order', seed: {}, fields: [] }), NOW);
  assert.match(order, /^<aside class="drawer sheet" aria-label="Place an order">/);
  assert.equal(renderSheet(emptyState(), NOW), '', 'no sheet open: nothing');
});

test('every Account string is escaped: a name with markup in the title, the fields and What you sign', () => {
  const seed = { address: ADDRESS, name: 'Eve <b>bold</b> "q"' };
  const body = letInBody();
  body.shown[1].value = seed.name;
  const html = renderSheet(prepared(opened('letIn', seed), body), NOW);
  has(html, '<h2>Let Eve &lt;b&gt;bold&lt;/b&gt; &quot;q&quot; in</h2>');
  has(html, 'aria-label="Let Eve &lt;b&gt;bold&lt;/b&gt; &quot;q&quot; in"');
  has(html, 'value="Eve &lt;b&gt;bold&lt;/b&gt; &quot;q&quot;"');
  has(html, '<div class="dsec-line">agentName: Eve &lt;b&gt;bold&lt;/b&gt; &quot;q&quot;</div>');
  lacks(html, '<b>bold</b>');
  clean(html);
});

// plan 2 Task 8: the connect sheet's check, a muted line under its fields, from the key file's check and the venue's reach
test("a connect sheet draws its check under the fields: the key file found or missing, the Account page for what connects there", () => {
  const options = connectOptionsOf(fx('account'), fx('venues'));
  const open = opened('connect', { options, connector: 'live:alpaca-paper', venue: 'alpaca-paper' });
  const LINE = /<p class="sheet-hint">([^<]*)<\/p>/;
  const line = s => renderSheet(s, NOW).match(LINE)?.[1] ?? null;
  assert.equal(line(open), null, 'nothing checked yet: no line');
  const checked = (s, data) => R.keyfileLoaded(R.keyfileLoading(s, keyfileAskOf(s.sheet)), { data, at: NOW });
  const body = fx('keyfile');
  const html = renderSheet(checked(open, body), NOW);
  // under the fields, over the quote box
  has(html, `data-action="sheetField"></label><p class="sheet-hint">${esc(body.message)}</p><div class="sheet-quote">`);
  assert.equal(line(checked(open, { ok: true, ready: true, path: '/h/credentials/alpaca-paper/<api>.json', fields: ['keyId', 'secret'], message: '' })),
    'Key file found: /h/credentials/alpaca-paper/&lt;api&gt;.json');
  assert.equal(line(checked(open, { ...body, missing: ['keyId', 'secret'] })), 'Missing: keyId, secret');
  // the reach: a venue that does not answer from here says so first
  const unreached = R.reachLoaded(checked(open, body), { data: { ok: true, reach: [{ connector: 'live:alpaca-paper', state: 'location', said: 'not offered here', at: '2026-10-24T15:00:00.000Z' }] }, at: NOW });
  assert.equal(line(unreached), `not offered here · ${esc(body.message)}`);
  // an option that connects on the Account page
  assert.equal(line(opened('connect', { options, connector: 'live:robinhood' })), 'Connect on the Account page');
  // another sheet draws no check, whatever was read
  const letIn = checked(opened('letIn', { address: ADDRESS, name: 'Claude Code' }), body);
  assert.equal(line(letIn), null);
  clean(renderSheet(unreached, NOW));
});
