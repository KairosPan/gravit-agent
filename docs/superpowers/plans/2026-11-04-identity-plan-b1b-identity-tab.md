# Identity, plan B1b — Account › Identity and Connect Telegram — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The face's Account page gains a seventh tab, Identity, where the operator connects Gravit to Telegram in four sheets and one signature, sets what reaches them where and when, and blocks strangers — with Slack and iMessage holding their places.

**Architecture:**
- **A pure view and a renderer.** `host/identity-view.js` reads the account's `GET /data/account/identity` into the three cards; `render/identity.js` draws them as cardboxes in the face's tokens. `render/account.js` and `router.js` gain the `identity` tab after `rules`.
- **The four Connect sheets.** Sheets 1–3 are an Identity drawer of their own, driven by `host/identity.js` over the five proxied routes plan B1a added (`/data/account/identity`, `…/identity/pending`, `…/identity/telegram/token`, `…/identity/pending/not-me`, `…/identity/pending/drop`). Sheet 4 is the ordinary owner sheet engine (`host/sheet.js`) with a new kind, `connectNetwork`, so What you sign and the device signature are the page's usual ones.
- **Three more signed sheets** — `disconnect`, `routing` (the grid's ticks and quiet hours) and `block` — live in `host/sheet-identity.js`, delegated from `host/sheet-view.js` like the Rules tab's kinds.
- **The QR code** is made by the account (`qrcode`, pinned) as an SVG data URL in the pending answer, and drawn as an `<img>`, so no SVG from upstream ever enters the DOM as markup.

**Tech Stack:** the face's plain-ESM browser client (string renderers, the store and pure reducers, a host layer), tested with `node --test` and the fake DOM in `face/tests/client/`; `crypto.subtle` for the token's fingerprint; `qrcode@1.5.4` in `account/`.

**Spec:** `docs/superpowers/specs/2026-11-03-account-split-and-identity-design.md` §5.1, §5.2, §5.6 "Saving", §7 items 13–14, §10 Q3. Plan B1a (`docs/superpowers/plans/2026-11-04-identity-plan-b1a-telegram-account-and-face.md`) must be done first: its Global Constraints, names and rulings hold here. Read `DEVELOPMENT.md` §5.2–§5.4 for the client's layers, and `face/client/js/host/sheet-rules.js`, `host/rules-view.js` and `render/account.js` `rulesTab` as the precedent.

## Global Constraints

- Everything in plan B1a's Global Constraints, on the same branch `feat/identity-b1` and worktree `.claude/worktrees/identity-b1`, after B1a's Task 11.
- **Product copy** is English, in the face's tokens (cream `#f6f4ef`, Manrope, the seg tabs, cardboxes, `.btn-sm`); nothing on screen is Chinese. The instruction texts below are fixed copy.
- **Owner buttons** (Connect…, Disconnect…, Save…, Change…, Block) are drawn only while the page signs (`state.owner?.role === 'signs'`), like every owner button on the Account page.
- **The token never enters the store.** Sheet 1's field is read from its DOM input at Next, hashed and posted, and the input is cleared; the store holds only the pending view the account answers.
- **This plan's rulings:**
  1. Slack's row reads "Not connected" with a disabled Connect… and a muted "Soon" chip; its grid column is disabled. Why: Slack is the next round (B2), so the row says it exists and is not yet connectable, unlike iMessage's "Later".
  2. iMessage's row is its icon, its name and a muted "Later" chip, with no button; its column stays disabled (spec §7 item 13).
  3. The grid's Face column is ticked and disabled in every row (always on).
  4. A connect's signed routing ticks Telegram in all five rows on top of the routing now; the operator unticks later with Save…. Why: the spec's What you sign shows "what Gravit may send (from the routing)", and a fresh connection that sends nothing would look broken.
  5. Sheet 2 polls the pending connection every 1.5 s (`PENDING_POLL_MS = 1_500`), the connect sheet's sign-in poll cadence; the expiry is the account's (10 minutes) and is shown.
  6. The account answers `qr` as `data:image/svg+xml;base64,…`; the client draws it only when it starts with exactly that prefix.

## Review Focus

- **The operator closes the drawer, or the page reloads, between sheets.** The pending connection is dropped at once (`…/pending/drop`); a reload has no pending in the store and starts at sheet 1; the account's 10-minute expiry covers a tab that died. Test in Task 2 (`closing any of sheets 1 to 3 drops the pending connection`).
- **Sheet 4 signed after the pending expired.** The door refuses; the sheet shows the account's sentence and a Start again key that reopens sheet 1. Test in Task 2 (`an expired pending at Sign shows the account's words and Start again`).
- **A page that does not sign.** The tab reads (Telegram connected or not, the grid, quiet hours, Not you) with no owner button anywhere and one line saying only a browser that signs changes these. Test in Task 1 (`a page that does not sign draws no owner button on Identity`).
- **The account down while the tab is open.** The tab says the account is not answering and draws no stale Connected row as live. Test in Task 1 (`the account not answering: the tab says so and draws no connection`).
- **The token typed and Next pressed twice quickly.** One token request; the second press does nothing while the first is in the air. Test in Task 2 (`Next twice posts the token once`).

---

## File Structure

- Create: `face/client/js/host/identity-view.js` (pure), `face/client/js/host/identity.js` (impure: reads, the Connect flow), `face/client/js/host/sheet-identity.js` (the four signed kinds), `face/client/js/render/identity.js`, `face/client/js/reducers/identity.js`.
- Modify: `face/client/js/render/account.js` (`TABS`, the tab's body), `face/client/js/router.js` (`TABS`), `face/client/js/host/sheet-view.js` (delegate `IDENTITY_KINDS`), `face/client/js/render/owner.js` (`renderSheet` draws a kind's lines above its fields and its instructions above its buttons), `face/client/js/reducers/index.js`, `face/client/js/app.js` (start the identity host, its actions), `face/client/css/*` (only if a class the tokens lack is needed).
- Modify (account): `account/package.json` (`qrcode` 1.5.4, `@types/qrcode` exact), `account/src/portfolio/identity/pending.ts` (`qr`).
- Tests: `face/tests/client/identity-view.test.js`, `identity-host.test.js`, `sheet-identity.test.js`, `account.test.js` (extend), `face/tests/gravit-client-smoke.test.ts` (extend), `account/test/unit/identity-pending.test.ts` (extend).
- Docs: `DEVELOPMENT.md` §5, `face/README.md`, `CLAUDE.md` (the client row).

---

### Task 1: The Identity tab — three cards, read-only and owner

**Files:**
- Create: `face/client/js/host/identity-view.js`, `face/client/js/render/identity.js`, `face/client/js/reducers/identity.js`
- Modify: `face/client/js/render/account.js`, `router.js`, `reducers/index.js`, `host/account.js` (read `/data/account/identity` while the tab is shown, at the page's cadence, and fresh after an identity sheet is done), `app.js`
- Test: `face/tests/client/identity-view.test.js`, `face/tests/client/account.test.js`

**Interfaces:**
- Consumes: B1a Task 3's `IdentityView` JSON.
- Produces:
  - `ROUTE_ROWS = [['chat','Chat with Gravit'],['alerts','Watch alerts'],['brief','Pre-close brief'],['cards','Cards waiting'],['fills','Fills and reports']]`; `NETWORKS = [['telegram','Telegram'],['imessage','iMessage'],['slack','Slack']]`.
  - `identityOf(read) -> { ok: boolean, networks: { telegram: Row, slack: Row, imessage: Row }, grid: Array<{ row, label, face: true, telegram: { on: boolean, enabled: boolean }, imessage: { on: false, enabled: false }, slack: { on: false, enabled: false } }>, quiet: { from, to } | null, strangers: Array<{ network, sender, masked, count, last }> }` with `Row = { state: 'connected' | 'none' | 'soon' | 'later', speaksAs?, talksOnlyWith?, since?, fingerprint?, polling?, problem? }`; `problem` is one line from `blocked`, `conflictAt` or `pollFailing`.
  - `formatRouting(routing) -> string` — the account's string rule (B1a Global Constraints).
  - Reducer actions: `identityLoading`, `identityLoaded(body)`, `identityFailed(message)`; slice `state.identity = { status, data, message, connect }`.
  - `renderIdentityTab(state, now) -> string`.

- [ ] **Step 1: Write the failing tests** (`identity-view.test.js`, and the tab in `account.test.js` with the fake DOM):

```js
test('the tabs are Portfolio · Money · Venues · Agents · Cards · Rules · Identity', () => {
  assert.deepEqual(tabLabels(renderAccount(state({ tab: 'identity' }))), ['Portfolio', 'Money', 'Venues', 'Agents', 'Cards', 'Rules', 'Identity']);
  assert.equal(parseHash('#/account/identity').tab, 'identity');
});
test('a connected Telegram row: Connected, Speaks as, Talks only with, Details and Disconnect…', () => {
  const html = renderIdentityTab(signing(CONNECTED), NOW);
  for (const w of ['Telegram', 'Connected', 'Speaks as', '@gravit_desk_bot', 'Talks only with', '@pan', 'Details', 'Disconnect…']) assert.match(html, new RegExp(esc(w)));
});
test('Telegram not connected: Not connected and Connect…; Slack: Not connected, Connect… disabled, Soon; iMessage: Later and no button', () => {});
test('the grid: five rows, Face ticked and disabled, Telegram enabled only once connected, iMessage and Slack disabled', () => {});
test('quiet hours read 23:00–07:00 ET with Change…; none reads Off', () => {});
test('Not you lists network, masked id, count and last time, each with Block', () => {});
test('a page that does not sign draws no owner button on Identity', () => {
  const html = renderIdentityTab(readOnly(CONNECTED_WITH_STRANGER), NOW);
  for (const w of ['Connect…', 'Disconnect…', 'Save…', 'Change…', 'Block']) assert.doesNotMatch(html, new RegExp(`data-action[^>]*>${esc(w)}`));
  assert.match(html, /Only a browser that signs changes these\./);
});
test('the account not answering: the tab says so and draws no connection', () => {});
test('formatRouting writes the account\'s string', () => {
  assert.equal(formatRouting({ chat: ['telegram'], alerts: ['telegram'], brief: [], cards: ['telegram'], fills: ['telegram'] }), 'chat=telegram;alerts=telegram;brief=;cards=telegram;fills=telegram');
});
```

- [ ] **Step 2: Run** `cd face && npx tsx --test tests/client/identity-view.test.js tests/client/account.test.js` — Expected: FAIL.

- [ ] **Step 3: Implement.** Three `box(...)` cards titled `Gravit`, `What reaches you where`, `Not you · n` (the count in the title). Details toggles a line `Since <date> · token <fingerprint> · <polling | problem>`. A grid tick changes the store's draft routing (`identityTick`); while the draft differs from the account's, `Save…` opens the `routing` sheet (Task 3). Disabled controls carry `disabled` and `aria-disabled="true"`.

- [ ] **Step 4: Run** the client tests, then `cd face && npm test && npm run typecheck` — green.

- [ ] **Step 5: Commit** — `feat(client): Account › Identity - the Gravit card, what reaches you where, quiet hours and Not you; Slack soon, iMessage later`.

---

### Task 2: Connect Telegram in four sheets

**Files:**
- Create: `face/client/js/host/identity.js`, `face/client/js/host/sheet-identity.js` (the `connectNetwork` kind)
- Modify: `face/client/js/render/identity.js` (the drawer for sheets 1–3), `render/owner.js` (lines and instructions hooks), `host/sheet-view.js`, `reducers/identity.js`, `app.js`
- Modify (account): `account/package.json`, `account/src/portfolio/identity/pending.ts`
- Test: `face/tests/client/identity-host.test.js`, `face/tests/client/sheet-identity.test.js`, `account/test/unit/identity-pending.test.ts` (extend), `face/tests/gravit-client-smoke.test.ts` (extend)

**Interfaces:**
- Consumes: Task 1's slice; B1a Task 2's routes and `PendingView`; `host/sheet.js` `startSheet().open(kind, seed)`.
- Produces:
  - `startIdentity({ store, getJson, post, subtle, schedule, cancelTimer, now, openSheet }) -> { load(fresh?), openConnect(), next(tokenInput: HTMLInputElement), notMe(), thisIsMe(), back(), close(), startAgain() }`.
  - `fingerprintOf(subtle, token) -> Promise<{ salt: string, keyHash: string }>` — 16 random bytes as 32 lower-case hex, `keyHash` the hex SHA-256 of the salt's bytes then the token's UTF-8 bytes.
  - `state.identity.connect = { step: 1 | 2 | 3, pending: PendingView | null, fp: { salt, keyHash } | null, busy: boolean, error: string | null } | null`.
  - `IDENTITY_KINDS = ['connectNetwork', 'disconnect', 'routing', 'block']` with `identityTitleOf`, `identityGoOf`, `identityFieldsOf`, `identityDraftOf`, `identityLinesOf(kind, seed) -> string[]`, `identityStepsOf(kind) -> string[]`.
  - `connectNetwork` draft: `{ type: 'connectNetwork', network: 'telegram', pending, botId, speaksAs, operatorId, talksOnlyWith, routing, keyHash, salt }` from its seed (ruling 4 for `routing`).
  - Account: `PendingView.qr` = `data:image/svg+xml;base64,` + the base64 of `QRCode.toString(link, { type: 'svg', margin: 1 })`.

- [ ] **Step 1: Write the failing tests.** The fixed copy (titles, lines and the numbered instructions) is asserted word for word:

```js
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
test('sheet 1: Bot token, a password field with Paste and Next, where it is kept and where it never goes, then its steps above the buttons', () => {
  /* title 'Connect Telegram · 1 of 4 · Bot token'; input type=password autocomplete=off; lines 'Kept in: Account · :4820' and 'Never in: Gravit\'s box · ~/.dsh'; an <ol> with STEPS_1 placed before the button row */
});
test('Next hashes the token in the browser, posts it once, clears the field, and keeps no token in the store', async () => {
  /* post spy: one call to /data/account/identity/telegram/token with { token, keyHash, salt }; keyHash === sha256hex(hex2bytes(salt) + token); input.value === ''; JSON.stringify(store.get()) does not contain the token */
});
test('Next twice posts the token once', async () => {});
test('a token the account refuses shows its sentence on sheet 1 and stays there', async () => {});
test('sheet 2: Say hi with the t.me link, the QR as an img, the expiry, and its steps; it moves to 3 when the pending is heard', async () => {
  /* polls /data/account/identity/pending?id=… every 1500 ms; qr drawn as <img src="data:image/svg+xml;base64,…" alt="QR code for t.me/gravit_desk_bot">; a qr without that prefix draws no img; state heard → step 3 */
});
test('sheet 3: Is this you? with name, handle, masked id and message; Not me posts not-me and goes back to 2', async () => {});
test('This is me opens sheet 4, the owner sheet, seeded from the pending and the routing', async () => {
  /* openSheet called with ('connectNetwork', { pending: id, botId, speaksAs: '@gravit_desk_bot', operatorId, talksOnlyWith: '@pan', routing: 'chat=telegram;alerts=telegram;brief=telegram;cards=telegram;fills=telegram', keyHash, salt }) */
});
test('sheet 4: the seven lines above What you sign, its steps, and Sign with this browser\'s key', () => {
  assert.deepEqual(identityLinesOf('connectNetwork', SEED), [
    'Network: Telegram', 'Speaks as: @gravit_desk_bot', 'Talks only with: @pan',
    'May send: Chat with Gravit, Watch alerts, Pre-close brief, Cards waiting, Fills and reports',
    'Token kept in: Account · :4820', 'Signed by: this browser', 'Until: you disconnect',
  ]);
  assert.deepEqual(identityStepsOf('connectNetwork'), STEPS_4);
  assert.equal(identityGoOf('connectNetwork'), "Sign with this browser's key");
});
test('closing any of sheets 1 to 3 drops the pending connection', async () => {});
test('an expired pending at Sign shows the account\'s words and Start again', async () => {});
```

  Account (`identity-pending.test.ts`): `it("the pending answer carries the bot link's QR as an SVG data URL")` — `qr` starts with `data:image/svg+xml;base64,` and its decoded text contains `<svg`. Client smoke (`gravit-client-smoke.test.ts`, real boot over the account stand-in): `#/account/identity` renders the three cards.

- [ ] **Step 2: Run** `cd face && npx tsx --test tests/client/identity-host.test.js tests/client/sheet-identity.test.js` and `cd account && npx vitest run test/unit/identity-pending.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement.** `cd account && npm install --save-exact qrcode@1.5.4 && npm install --save-exact --save-dev @types/qrcode@1.5.5`. In the client, sheet 1's field is `<input type="password" autocomplete="off" spellcheck="false">`; Paste fills it from `navigator.clipboard.readText()` when the browser allows, else does nothing. Sheet 2's expiry line: `This connection waits until <h:mm> ET; after that, start again.` Sheets 1–3 have Cancel; 2 and 3 have Back (Back from 2 drops the pending and returns to 1). The drawer and the owner sheet never show at once: `thisIsMe` closes the drawer without dropping and opens the sheet; the sheet's Cancel posts drop. `render/owner.js` `renderSheet` draws `identityLinesOf` above the fields and `<ol class="sheet-steps">` from `identityStepsOf` above the button row, for identity kinds only.

- [ ] **Step 4: Run** both packages' suites and typechecks, and `cd face && FACE_SMOKE=1 npm test` — green.

- [ ] **Step 5: Commit** — `feat(client): Connect Telegram in four sheets - the token hashed in the browser and sent once, Say hi with a QR, Is this you, and What you sign`.

---

### Task 3: Disconnect, routing with quiet hours, and Block

**Files:**
- Modify: `face/client/js/host/sheet-identity.js`, `render/identity.js`, `host/identity.js` (reload fresh after a done sheet)
- Test: `face/tests/client/sheet-identity.test.js` (extend)

**Interfaces:**
- Consumes: Task 2's kinds table; B1a Task 3's owner types.
- Produces drafts:
  - `disconnect` (seed `{ network: 'telegram' }`) → `{ type: 'disconnectNetwork', network: 'telegram' }`; title `Disconnect Telegram`; go `Sign disconnect`; lines `Gravit stops reading and sending on Telegram.`, `The token is deleted from the account.`, `The desk keeps working in the face.`
  - `routing` (seed `{ routing, quiet }`, fields `quietFrom`, `quietTo` as `type: 'time'` and `quietOff` as a checkbox) → `{ type: 'setRouting', routing: formatRouting(seed.routing), quietFrom, quietTo }`, `""` for both when off; title `What reaches you where`; go `Sign`; words `Quiet hours start and end at different times` and `That is how it is now` while the draft would refuse or change nothing.
  - `block` (seed a stranger) → `{ type: 'blockSender', network, sender, masked }`; title `Block …789`; go `Sign block`; line `Messages from …789 are dropped and no longer counted.`

- [ ] **Step 1: Write the failing tests:**

```js
test('disconnect drafts disconnectNetwork with its three lines', () => {});
test('routing drafts the grid as the account\'s string and the quiet hours, refuses equal times and an unchanged draft', () => {
  assert.deepEqual(identityDraftOf('routing', fields({ quietFrom: '22:00', quietTo: '06:30' }), SEED), { type: 'setRouting', routing: SEED_STRING, quietFrom: '22:00', quietTo: '06:30' });
  assert.equal(identityDraftOf('routing', fields({ quietFrom: '22:00', quietTo: '22:00' }), SEED), 'Quiet hours start and end at different times');
  assert.equal(identityDraftOf('routing', fields({ quietOff: true }), SEED).quietFrom, '');
});
test('block drafts blockSender for the stranger\'s ref, shown by its masked id', () => {});
test('a done identity sheet reads Identity again past the face\'s cache', async () => { /* getJson saw /data/account/identity?fresh=1 */ });
```

- [ ] **Step 2: Run** `cd face && npx tsx --test tests/client/sheet-identity.test.js` — Expected: FAIL.

- [ ] **Step 3: Implement** the three kinds and their keys in `render/identity.js`.

- [ ] **Step 4: Run** `cd face && npm test && npm run typecheck` — green.

- [ ] **Step 5: Commit** — `feat(client): Identity's signed sheets - disconnect, what reaches you where with quiet hours, and block`.

---

### Task 4: Docs for the tab and the operator's drill

**Files:**
- Modify: `DEVELOPMENT.md` (§5.1 pages and files, §5.2 the identity wire, §5.3 the host layer, §5.4 rendering, §7.3 the new client tests, §7.4 the drill), `face/README.md` (Account › Identity, and "The phone drill"), `CLAUDE.md` (the client row names Identity), `account/README.md` (`qrcode`).

- [ ] **Step 1:** Write `face/README.md` "The phone drill" as the operator section below gives it, and the Identity tab's paragraph. Update the rest as listed.
- [ ] **Step 2: Run** `cd face && npm test` and `cd account && npm test` — green.
- [ ] **Step 3: Commit** — `docs: Account › Identity and the phone drill`.

---

## For the operator, after the merge

These are yours; an agent never does them (they drive your launchd, your `~/.dsh` and your Telegram).

1. **Merge** `feat/identity-b1` into `main` (both plans) when you are happy with the review.
2. **Install the new dependency:** `cd account && npm ci`.
3. **Take the token out of Gravit's box.** Delete the `TELEGRAM_BOT_TOKEN` and `TELEGRAM_OPERATOR_ID` lines from `$DSH_HOME/.env` (and the repo-root `.env.telegram`, if you have one). The face no longer reads them; this makes sure no copy stays there.
4. **Restart** the account (`npm run account` in `account/`, or `npm run account:service -- restart` if its LaunchAgent is installed), the market if it is not running (`npm run market` in `market/`), then the face (`cd face && npm run service -- restart`, or `npm start`).
5. **The bot.** Reuse the bot you made for the desk — paste the token you had in `.env` — or make a new one: in Telegram, @BotFather, `/newbot`, a name, then a username ending in `bot`. If the old token was ever shown anywhere it should not be, send BotFather `/revoke` and use the new token.
6. **Connect** in the face: Account › Identity › Telegram › Connect…, on a page that signs. Paste the token (sheet 1), press Start on the phone (sheet 2), check it is you (sheet 3), read and Sign (sheet 4).
7. **Keep it running** (optional, recommended): `cd account && npm run account:service -- install`, `cd market && npm run market:service -- install`; `cd face && npm run service -- install` again so the watchdog checks all three.
8. **The drill** (`face/README.md` "The phone drill"):
   1. Account › Identity shows Telegram Connected, Speaks as your bot, Talks only with you; Slack "Not connected · Soon"; iMessage "Later".
   2. On the phone send `/status`: the answer has a `phone: telegram polling …` line.
   3. Ask Gravit something on the phone: the answer comes back as a reply in the same chat.
   4. From another Telegram account, message the bot: nothing answers; Not you shows `…` and the last three digits, count 1. Block it: it leaves the list.
   5. Untick Telegram for Watch alerts and Save… (sign): `/status` still answers; the next alert is not sent to the phone (`alerts.jsonl` records `undelivered: not routed`). Tick it again.
   6. Set quiet hours to cover the next few minutes: a watch alert is held (`quiet hours`); a text you send is still answered.
   7. Let Gravit place a paper order: the phone shows `Your call · … — waiting in Gravit` with no link; approve in the browser; the fill notice `Filled · …` arrives.
   8. Stop the account for ten minutes or more (Ctrl-C in its terminal; under its LaunchAgent, `npm run account:service -- uninstall`, and `install` again afterwards): one `the account has not answered since …` arrives; start it: `the account answers again (down since …)`.
   9. `/pause 30m` and `/mute 30m` from the phone answer as before; resume from a terminal (`npm run desk -- resume`, `npm run desk -- unmute`).
   10. Disconnect… (sign): the bot stops answering; `credentials/networks/telegram.json` is gone from the account's home.

## Self-Review

- **Spec coverage.** §5.1 cards, rows, grid, quiet hours and Not you → Task 1; owner buttons only while signing → Task 1's test. §5.2's four sheets, their instructions and the pending's drop and expiry → Task 2. §5.6 "Saving" (routing and quiet hours, Disconnect…, Block, each one signature) → Task 3. §10 Q3 → ruling 2, Task 1. §5.10 installing the LaunchAgents → the operator section.
- **Types.** `IDENTITY_KINDS`, the drafts' fields and the routing string match B1a Task 3's owner types and Global Constraints; `PendingView` and `IdentityView` are B1a's.
- **Review Focus** lines each have a named test in Task 1 or Task 2.
