// Discover's items from the face's listings (spec 2026-10-19 §7 Stage 3 "Discover = My plugins"): the abilities on
// Abilities (spec 2026-11-13 §4.4), MCP servers on Data, bots on Bots, Gravit and the CLI agents on Agents, skills on
// Skills; ids namespaced.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemsOf, searchItems, itemById, SHELF_IDS, SOURCE, shelves, abilityStateWord } from '../../client/js/host/discover-view.js';
import { listings, modulesListing, abilitiesListing } from './helpers/inventory.js';

const shelf = data => ({ status: 'ready', data, at: 1 });

const discover = (over = {}) => ({ query: '', shelves: { ...listings(), ...over } });

test('the six shelves, in order, Abilities first', () => {
  assert.deepEqual(SHELF_IDS, ['abilities', 'data', 'research', 'bots', 'agents', 'skills']);
  assert.deepEqual(shelves().map(s => s.id), SHELF_IDS);
  assert.deepEqual(shelves().map(s => s.title), ['Abilities', 'Data', 'Research', 'Bots', 'Agents', 'Skills']);
  assert.equal(shelves()[0].empty, 'No abilities');
  assert.equal(SOURCE.abilities, 'abilities');
});

// the abilities listing with its first ability changed by `over`
const withFirst = over => {
  const l = abilitiesListing();
  l.abilities[0] = { ...l.abilities[0], ...over };
  return discover({ abilities: shelf(l) });
};

test('Abilities: one item per ability, in the order served, its text the top level', () => {
  const items = itemsOf(discover()).abilities;
  assert.deepEqual(items.map(i => i.id), ['ability:event-analogs', 'ability:read-through']);
  const [first, second] = items;
  assert.equal(first.shelf, 'abilities'); assert.equal(first.kindCode, 'ability'); assert.equal(first.kind, 'Ability');
  assert.equal(first.name, 'Event analogs');
  assert.equal(first.line, 'What stocks did after past events like this one, measured against the market');
  assert.deepEqual(first.mark, { type: 'glyph', icon: 'rewind' });
  assert.equal(first.dim, false); assert.equal(first.chip, null);
  assert.equal(first.text.name, first.name); assert.equal(first.text.blurb, first.line);
  assert.match(first.text.about, /^Give Gravit a stock/);
  assert.equal(first.text.asks.length, 3); assert.equal(first.text.limits.length, 4);
  assert.equal(first.source.id, 'event-analogs'); assert.equal(first.source.state, 'on');
  assert.equal(second.name, 'Read-through'); assert.deepEqual(second.mark, { type: 'glyph', icon: 'arrows' });
});

test('Abilities in Chinese: each text field from the overlay when it has it, from the top level when not', () => {
  const zh = itemsOf(discover(), {}, 'zh').abilities[0];
  assert.equal(zh.name, '事件对标'); assert.equal(zh.text.name, '事件对标');
  assert.equal(zh.line, zh.text.blurb); assert.match(zh.line, /^一件事发生后/);
  assert.ok(zh.text.asks[0].startsWith('NVDA 董事会'));
  assert.equal(itemsOf(discover(), {}, 'en').abilities[0].name, 'Event analogs', 'English reads the top level');
  const top = abilitiesListing().abilities[0];
  const noAbout = itemsOf(withFirst({ zh: { name: '事件对标', asks: [] } }), {}, 'zh').abilities[0];
  assert.equal(noAbout.text.about, top.about, 'an overlay lacking about reads the top-level about');
  assert.deepEqual(noAbout.text.asks, [], 'an empty list in the overlay is its list');
  assert.deepEqual(noAbout.text.limits, top.limits);
  assert.equal(noAbout.text.blurb, top.blurb);
  assert.equal(itemsOf(withFirst({ zh: null }), {}, 'zh').abilities[0].name, 'Event analogs', 'no overlay: the top level');
  assert.equal(itemById(discover(), 'ability:read-through', 'zh').name, '对手推演');
  assert.equal(itemById(discover(), 'ability:read-through').name, 'Read-through');
});

test('an ability not on is dim, with a chip: Off and Starting grey, Failed warn; an unknown state dim too', () => {
  const first = over => itemsOf(withFirst(over)).abilities[0];
  const off = first({ state: 'off' });
  assert.equal(off.dim, true); assert.deepEqual(off.chip, { text: 'Off', tone: 'grey' });
  assert.deepEqual(first({ state: 'starting' }).chip, { text: 'Starting', tone: 'grey' });
  const failed = first({ state: 'failed' });
  assert.equal(failed.dim, true); assert.equal(failed.chip.tone, 'warn'); assert.equal(failed.chip.text, 'Failed');
  const odd = first({ state: 'paused' });
  assert.equal(odd.dim, true); assert.equal(odd.chip.tone, 'grey'); assert.equal(odd.chip.text, '—');
  assert.equal(first({ state: undefined }).dim, true);
  assert.equal(abilityStateWord('on'), 'On');
});

test('an ability with no icon, or one the client has none of, is marked with bolt', () => {
  assert.deepEqual(itemsOf(withFirst({ icon: null })).abilities[0].mark, { type: 'glyph', icon: 'bolt' });
  assert.equal(itemsOf(withFirst({ icon: 'no-such-icon' })).abilities[0].mark.icon, 'bolt');
  assert.equal(itemsOf(withFirst({ icon: 'constructor' })).abilities[0].mark.icon, 'bolt');
});

test('an abilities listing holding garbage skips it; the other shelves are unchanged', () => {
  const l = abilitiesListing();
  const items = itemsOf(discover({ abilities: shelf({ abilities: [null, 7, {}, ...l.abilities] }) }));
  assert.deepEqual(items.abilities.map(i => i.id), ['ability:event-analogs', 'ability:read-through']);
  const { abilities: none, ...without } = itemsOf(discover({ abilities: undefined }));
  const { abilities: kept, ...others } = items;
  assert.deepEqual(none, []); assert.equal(kept.length, 2);
  assert.deepEqual(others, without, 'the other shelves read as they did beside the garbage');
  assert.deepEqual(itemsOf(discover({ abilities: shelf({ abilities: 'x' }) })).abilities, []);
});

test('search finds an ability by its blurb', () => {
  const all = Object.values(itemsOf(discover())).flat();
  assert.deepEqual(searchItems(all, 'rivals').map(i => i.id), ['ability:read-through']);
  assert.ok(searchItems(Object.values(itemsOf(discover(), {}, 'zh')).flat(), '对手').some(i => i.id === 'ability:read-through'));
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
  for (const id of ['ability:event-analogs', 'mcp:alpaca-kit', 'bot:buffett', 'agent:gravit', 'agent:codex', 'agent:claude', 'skill:rules']) assert.equal(itemById(d, id)?.id, id, id);
  assert.equal(itemById(d, 'bot:gravit'), null, 'the default bot is no item');
  assert.equal(itemById(d, 'mcp:nope'), null);
});

test('a listing that failed or never came draws no items, and nothing throws on garbage', () => {
  const items = itemsOf({ query: '', shelves: { abilities: { status: 'failed', data: null }, plugins: { status: 'failed', data: null }, bots: shelf({ bots: 'x' }), memory: shelf({ groups: [{ name: 'g', skills: 'x' }, null] }) } });
  assert.deepEqual(items.abilities, []); assert.deepEqual(items.data, []); assert.deepEqual(items.bots, []); assert.deepEqual(items.skills, []);
});

test("the one roster (one-entry plan 4): each bot but the default and each connected CLI agent carries available", () => {
  const on = { ...discover(), roster: { status: 'ready', agents: ['codex'], bots: ['buffett'] } };
  const items = itemsOf(on);
  assert.deepEqual(items.bots.map(i => [i.id, i.available]), [['bot:buffett', true]]);
  assert.deepEqual(items.agents.map(i => [i.id, i.available]), [['agent:gravit', undefined], ['agent:codex', true], ['agent:gone', false], ['agent:claude', undefined]]);
  const off = itemsOf({ ...discover(), roster: { status: 'ready', agents: [], bots: [] } });
  assert.equal(off.bots[0].available, false);
  assert.equal(off.agents[1].available, false);
  assert.equal(itemsOf(discover()).bots[0].available, false, 'no roster read yet: off');
});
