// Discover's items from the face's listings (spec 2026-10-19 §7 Stage 3 "Discover = My plugins"): MCP servers on
// Data, bots on Bots, Gravit and the CLI agents on Agents, skills on Skills; ids namespaced.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemsOf, searchItems, itemById, SHELF_IDS, shelves } from '../../client/js/host/discover-view.js';
import { listings, modulesListing } from './helpers/inventory.js';

const shelf = data => ({ status: 'ready', data, at: 1 });

const discover = (over = {}) => ({ query: '', shelves: { ...listings(), ...over } });

test('the five shelves, in order', () => {
  assert.deepEqual(SHELF_IDS, ['data', 'research', 'bots', 'agents', 'skills']);
  assert.deepEqual(shelves().map(s => s.id), SHELF_IDS);
  assert.deepEqual(shelves().map(s => s.title), ['Data', 'Research', 'Bots', 'Agents', 'Skills']);
});

test('Research: six module items from the modules listing, with chips; six still when the listing never came', () => {
  const items = itemsOf(discover({ modules: shelf(modulesListing()) })).research;
  assert.deepEqual(items.map(i => [i.id, i.chip.text]), [['module:environment', 'WEAK · STABLE'], ['module:sentiment', 'IGNITION · POSITIVE · NONE'], ['module:theme', 'not evaluable · boards'], ['module:leader', 'lunhui-s01-repair · no candidate'], ['module:mode', 'lunhui-s01-repair · WAIT'], ['module:counterevidence', 'lunhui-s01-repair · 5 items']]);
  assert.equal(itemsOf(discover()).research.length, 6);
  assert.equal(itemById(discover({ modules: shelf(modulesListing()) }), 'module:theme').name, 'Theme');
  assert.ok(searchItems(Object.values(itemsOf(discover({ modules: shelf(modulesListing()) }))).flat(), '题材').some(i => i.id === 'module:theme'));
});

test('Research with the rows not mounted: the chips keep their words, grey, and every item is dim', () => {
  const items = itemsOf(discover({ modules: shelf({ ...modulesListing(), mounted: false }) })).research;
  assert.equal(items[0].chip.text, 'WEAK · STABLE');
  assert.ok(items.every(i => i.chip.tone === 'grey' && i.dim === true));
  assert.ok(itemsOf(discover({ modules: shelf(modulesListing()) })).research.every(i => i.dim === false));
});

test('MCP servers become Data items with their tool counts; the default bot is not a Bot item', () => {
  const items = itemsOf(discover());
  assert.deepEqual(items.data.map(i => [i.id, i.name, i.line]), [['mcp:alpaca-kit', 'alpaca-kit', '2 tools'], ['mcp:akshare', 'akshare', '0 tools']]);
  assert.deepEqual(items.bots.map(i => [i.id, i.name, i.line]), [['bot:buffett', 'Buffett Type', 'Buys cheap, holds long']]);
});

test('Agents: Gravit first, then the connected agents, then the found candidates', () => {
  const items = itemsOf(discover());
  assert.deepEqual(items.agents.map(i => [i.id, i.name, i.line]), [
    ['agent:gravit', 'Gravit', 'dsh 0.2.0-rc.2'],
    ['agent:codex', 'Codex', 'Connected'],
    ['agent:gone', 'Gone', 'Not found'],
    ['agent:claude', 'Claude Code', 'Found · 2.1'],
  ]);
  assert.equal(itemsOf({ query: '', shelves: {} }).agents[0].id, 'agent:gravit', 'Gravit is there before the agents answer');
});

test('skills from every group', () => {
  const items = itemsOf(discover());
  assert.deepEqual(items.skills.map(i => [i.id, i.name, i.line, i.group]), [['skill:rules', 'rules', 'The five honest-eval rules', 'mechanics'], ['skill:voice', 'voice', 'How Gravit writes', 'style-gravit']]);
});

test('search matches name and line across the shelves', () => {
  const all = Object.values(itemsOf(discover())).flat();
  assert.deepEqual(searchItems(all, 'HONEST').map(i => i.id), ['skill:rules']);
  assert.deepEqual(searchItems(all, 'buffett').map(i => i.id), ['bot:buffett']);
  assert.deepEqual(searchItems(all, '  '), []);
});

test('ids are namespaced and itemById finds each', () => {
  const d = discover();
  for (const id of ['mcp:alpaca-kit', 'bot:buffett', 'agent:gravit', 'agent:codex', 'agent:claude', 'skill:rules']) assert.equal(itemById(d, id)?.id, id, id);
  assert.equal(itemById(d, 'bot:gravit'), null, 'the default bot is no item');
  assert.equal(itemById(d, 'mcp:nope'), null);
});

test('a listing that failed or never came draws no items, and nothing throws on garbage', () => {
  const items = itemsOf({ query: '', shelves: { plugins: { status: 'failed', data: null }, bots: shelf({ bots: 'x' }), memory: shelf({ groups: [{ name: 'g', skills: 'x' }, null] }) } });
  assert.deepEqual(items.data, []); assert.deepEqual(items.bots, []); assert.deepEqual(items.skills, []);
});
