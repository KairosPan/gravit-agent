// No Chinese in a client source but the content files (spec §3.3): the face's own words are English, in the table; Chinese
// stays where it is content — Lunhui's module names and sub-titles, the A-share units and pools, the room's notices (D36) —
// and, from plan 7, the Chinese table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../client/js/', import.meta.url));
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.js') ? [join(dir, e.name)] : []);

const CONTENT = {
  'i18n/zh.js': 'the Chinese table',
  'i18n/langs.js': "a language's own name",
  'host/modules-view.js': "the Lunhui modules' Chinese names and sub-titles",
  'host/runs-view.js': "the iFinD provider's name in a run's row",
  'host/run-sheet-view.js': "the Chinese request a Run sends Gravit",
  'wire/room.js': "the room's two notices (D36)",
  'wire/market-model.js': "the markets' Chinese labels",
  'render/discover.js': "the modules' Chinese sub-titles, in its comments",
  'render/markets.js': 'the A-share units (D36)',
  'render/lunhui/block.js': "the yuan tiers of Lunhui's amounts",
  'render/lunhui/sources.js': "the iFinD provider's name",
  'render/lunhui/stock.js': "the stock drawer's Chinese follow-up to Gravit",
};

test('no client source holds Chinese but the content files §3.3 names', () => {
  const holding = walk(ROOT).filter(f => /[㐀-鿿]/.test(readFileSync(f, 'utf8'))).map(f => relative(ROOT, f).split('\\').join('/')).sort();
  assert.deepEqual(holding, Object.keys(CONTENT).sort());
});
