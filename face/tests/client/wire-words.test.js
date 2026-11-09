// The wire modules moved from the old client (stage 3): no Chinese anywhere in their source — the face's words live in
// the tables (client/js/i18n/, spec 2026-11-03 §5.10), and these modules' words reach the screens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const MOVED = ['channelName', 'botId', 'botSettings', 'subagents', 'member-traces'];

test('the moved wire modules carry no Chinese', async () => {
  for (const name of MOVED) {
    const src = await readFile(new URL(`../../client/js/wire/${name}.js`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /[\u3400-\u9fff]/, name);
  }
});
