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
  'host/run-sheet-view.js': "the Chinese request a Run sends gravit",
  'wire/room.js': "the room's two notices (D36)",
  'wire/market-model.js': "the markets' Chinese labels",
  'render/discover.js': "the modules' Chinese sub-titles, in its comments",
  'render/markets.js': 'the A-share units (D36)',
  'render/lunhui/block.js': "the yuan tiers of Lunhui's amounts",
  'render/lunhui/sources.js': "the iFinD provider's name",
  'render/lunhui/stock.js': "the stock drawer's Chinese follow-up to gravit",
};

test('no client source holds Chinese but the content files §3.3 names', () => {
  const holding = walk(ROOT).filter(f => /[㐀-鿿]/.test(readFileSync(f, 'utf8'))).map(f => relative(ROOT, f).split('\\').join('/')).sort();
  assert.deepEqual(holding, Object.keys(CONTENT).sort());
});

test("the Markets screen under the Chinese table: the star's word, the tabs, the filters and Main in Chinese, none of their English", async () => {
  const { renderMarketsScreen } = await import('../../client/js/render/markets.js');
  const { reducers: R } = await import('../../client/js/reducers/index.js');
  const { emptyState } = await import('../../client/js/data/empty.js');
  const { withTable } = await import('../../client/js/i18n/words.js');
  const { ZH } = await import('../../client/js/i18n/zh.js');
  const { EN } = await import('../../client/js/i18n/en.js');
  const stocks = R.openMarketsFilter(R.setMarketsTab(R.nav(emptyState(), { screen: 'markets', id: null }), 'stocks'), 'form');
  const html = withTable(ZH, () => renderMarketsScreen(stocks, Date.parse('2026-11-19T15:00:00Z')));
  assert.match(html, /class="mk-tab mk-tab-star" data-action="mkTab" data-value="watchlist" aria-pressed="false" title="自选"><svg [^>]*>[\s\S]*?<\/svg><span class="sr-only">自选<\/span>/);
  for (const word of ['宏观与事件', '加密', '股票', '商品', '外汇', '地区', '形式', '来源', '主要来源', '美国', '现货与股票', '永续', '代币化', '事件合约', '期权']) assert.ok(html.includes(word), word);
  const shown = html.replace(/<[^>]+>/g, '\n');
  const english = Object.entries(EN)
    .filter(([key]) => /^markets\.(tab\.(watchlist|crypto|stocks|indices|commodities|fx|macro)|filter\.|region\.|form\.|source\.|chip\.|empty\.(filters|back|watchlist)|search\.back)/.test(key))
    .map(([key, en]) => [key, String(en).replace(/\{\w+\}/g, '').replace(/&/g, '&amp;').trim()])
    .filter(([key, en]) => en && en !== ZH[key]);
  for (const [key, en] of english) assert.ok(!shown.split('\n').some(line => line.trim() === en || line.includes(`${en} ·`)), `${key}: ${en}`);
});
