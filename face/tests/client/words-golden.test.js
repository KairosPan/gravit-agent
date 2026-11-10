// The zero-change harness: every screen state css.test.js draws renders the bytes pinned in fixtures/screens-en.json, so a
// words move (the English table, plan 6) shows as no change at all. The zone is set before the corpus is read, so a clock in
// any state prints the same on any machine. The fixture is append-only (golden-write.js): a new state is added after the
// pinned ones, and a state redrawn on purpose is re-pinned by name.
process.env.TZ = 'America/New_York';
const { test } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { readFileSync } = await import('node:fs');
const { createHash } = await import('node:crypto');
const { goldenEntries } = await import('./helpers/screens.js');

const { existsSync } = await import('node:fs');
const { setTable } = await import('../../client/js/i18n/words.js');
const { EN } = await import('../../client/js/i18n/en.js');
const { ZH } = await import('../../client/js/i18n/zh.js');

const pinned = JSON.parse(readFileSync(new URL('./fixtures/screens-en.json', import.meta.url), 'utf8'));
const entries = await goldenEntries();
const sha = html => createHash('sha256').update(html).digest('hex');
// the same corpus drawn under ZH (plan 7 Task 10), the table set for the whole read and EN after
const ZH_FIXTURE = new URL('./fixtures/screens-zh.json', import.meta.url);
setTable(ZH);
const zhEntries = await goldenEntries().finally(() => setTable(EN));

test('every screen state renders the bytes pinned in fixtures/screens-en.json', () => {
  assert.deepEqual(entries.map(([name]) => name), Object.keys(pinned), 'the corpus names its states as the fixture does, in order (a new state goes at the end: golden-write.js --pin)');
  const differ = entries.filter(([name, html]) => sha(html) !== pinned[name]).map(([name]) => name);
  assert.deepEqual(differ, [], `these states render other bytes: run npx tsx tests/client/golden-write.js --dump <dir> before and after the change and diff the two dirs; a change meant to redraw them is re-pinned with --pin --repin <names>`);
});

test('every screen state renders the bytes pinned in fixtures/screens-zh.json under ZH', () => {
  assert.ok(existsSync(ZH_FIXTURE), 'the Chinese golden is pinned (golden-write.js --lang zh --pin)');
  const zhPinned = JSON.parse(readFileSync(ZH_FIXTURE, 'utf8'));
  assert.deepEqual(zhEntries.map(([name]) => name), Object.keys(zhPinned), 'the Chinese golden names the corpus as the English one does');
  assert.deepEqual(zhEntries.map(([name]) => name), entries.map(([name]) => name));
  const differ = zhEntries.filter(([name, html]) => sha(html) !== zhPinned[name]).map(([name]) => name);
  assert.deepEqual(differ, [], 'these states draw other bytes under ZH: golden-write.js --lang zh --dump before and after, and --lang zh --pin --repin <names> for a change meant');
  assert.ok(zhEntries.some(([, html]) => html.includes('>设置<')), 'the corpus is drawn in Chinese');
});

test('the corpus covers the screens', async () => {
  const { everyState } = await import('./helpers/screens.js');
  const sheetKinds = new Set(everyState().map(st => st.sheet?.kind).filter(Boolean));
  const all = entries.map(([, html]) => html);
  const holds = (what, needle) => assert.ok(all.some(html => html.includes(needle)), `the corpus holds ${what} (${needle})`);
  holds('a Messages state', 'class="thread');
  holds('a Settings state', 'aria-label="Settings"');
  holds('Markets', 'class="main mkts');
  holds('Account', 'class="main acct');
  holds('Trade', 'class="main trade');
  holds('a strategy page', 'class="main chan strat');
  holds('Discover', 'class="main disc');
  holds('a module', 'class="mod-boxes');
  holds('a Run sheet', 'class="drawer sheet run-sheet');
  holds('an owner sheet', 'data-action="sheetSubmit"');
  holds('Sell many', 'aria-label="Sell many"');
  holds('the stock drawer', 'class="drawer stock');
  holds("Connect Telegram's drawer", 'data-action="identityClose"');
  holds('the side panel off a Mac', 'Ctrl+Alt+K');
  holds('the side panel', 'class="row-note"');
  holds("Account's Money", 'Send only the asset on the network the row names');
  holds("Account's Rules", 'Only a browser that signs switches to Beast.');
  holds('a prepared move', 'Can&#39;t be undone.');
  holds("a market's order book", '>Order book<');
  holds("a perpetual's funding", '>Funding<');
  holds("the watchlist's refusal", 'Couldn&#39;t save the watchlist');
  holds("a Run the host could not send", 'Couldn&#39;t send');
  holds("app.js's line for an unanswered question", 'Answer every question first');
  for (const kind of ['close', 'amend', 'leverage', 'beast', 'cap', 'session', 'leverageCap', 'move', 'earn', 'subWallet',
    'revoke', 'endLimit', 'paper', 'topUp', 'resetPaper', 'disconnect', 'declineAsk', 'letDevice', 'signOut', 'reopen', 'letIn', 'limit', 'approveCard', 'connect', 'order']) {
    assert.ok(sheetKinds.has(kind), `the corpus opens a ${kind} sheet`);
  }
});
