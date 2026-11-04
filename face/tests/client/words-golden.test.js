// The zero-change harness: every screen state css.test.js draws renders the bytes pinned in fixtures/screens-en.json, so a
// words move (the English table, plan 6) shows as no change at all. The zone is set before the corpus is read, so a clock in
// any state prints the same on any machine.
process.env.TZ = 'America/New_York';
const { test } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { readFileSync } = await import('node:fs');
const { createHash } = await import('node:crypto');
const { corpus } = await import('./helpers/screens.js');

const pinned = JSON.parse(readFileSync(new URL('./fixtures/screens-en.json', import.meta.url), 'utf8'));
const entries = corpus();
const sha = html => createHash('sha256').update(html).digest('hex');

test('every screen state renders the bytes pinned in fixtures/screens-en.json', () => {
  assert.deepEqual(entries.map(([name]) => name), Object.keys(pinned), 'the corpus names its states as the fixture does, in order');
  const differ = entries.filter(([name, html]) => sha(html) !== pinned[name]).map(([name]) => name);
  assert.deepEqual(differ, [], `these states render other bytes: run npx tsx tests/client/golden-write.js --dump <dir> before and after the change and diff the two dirs`);
});

test('the corpus covers the screens', () => {
  const all = entries.map(([, html]) => html);
  const holds = (what, needle) => assert.ok(all.some(html => html.includes(needle)), `the corpus holds ${what} (${needle})`);
  holds('a Messages state', 'class="thread');
  holds('a Settings state', 'aria-label="Settings"');
  holds('Markets', 'class="main mkts');
  holds('Account', 'class="main acct');
  holds('Trade', 'class="main trade');
  holds('a channel', 'class="main chan');
  holds('Discover', 'class="main disc');
  holds('a module', 'class="mod-boxes');
  holds('a Run sheet', 'class="drawer sheet run-sheet');
  holds('an owner sheet', 'data-action="sheetSubmit"');
  holds('Sell many', 'aria-label="Sell many"');
  holds('the stock drawer', 'class="drawer stock');
  holds("Connect Telegram's drawer", 'data-action="identityClose"');
  holds('a list off a Mac', 'Ctrl+Alt+K');
});
