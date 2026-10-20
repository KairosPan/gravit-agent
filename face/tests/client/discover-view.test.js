// Discover's items from the face's listings (spec 2026-10-19 §7 Stage 3 "Discover = My plugins"): MCP servers on
// Data, bots on Bots, Gravit and the CLI agents on Agents, skills on Skills; ids namespaced.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemsOf, searchItems, itemById, SHELVES } from '../../client/js/host/discover-view.js';

const shelf = data => ({ status: 'ready', data, at: 1 });
export const listings = () => ({
  plugins: shelf({ ok: true, mcp: [{ server: 'alpaca-kit', phase: 'active', tools: [{ name: 'mcp__alpaca-kit__account', description: 'The paper account' }, { name: 'mcp__alpaca-kit__screen', description: 'Screen' }] }, { server: 'akshare', phase: 'failed', tools: [] }], agentTools: [], rows: [] }),
  bots: shelf({ ok: true, bots: [
    { id: 'gravit', name: 'Gravit', description: 'host', isDefault: true, listed: true },
    { id: 'buffett', name: 'Buffett Type', description: 'Buys cheap, holds long', isDefault: false, listed: true },
  ] }),
  agents: shelf({ ok: true, main: { name: 'Gravit', runtime: 'dsh 0.2.0-rc.2' },
    local: [{ bin: 'codex', label: 'Codex', found: true, version: '0.9', auth: { state: 'ok' } }, { bin: 'gone', label: 'Gone', found: false, auth: { state: 'unknown' } }],
    candidates: [{ bin: 'claude', label: 'Claude Code', version: '2.1' }] }),
  memory: shelf({ ok: true, groups: [{ name: 'mechanics', skills: [{ name: 'rules', description: 'The five honest-eval rules' }] }, { name: 'style-gravit', skills: [{ name: 'voice', description: 'How Gravit writes' }] }] }),
});
const discover = (over = {}) => ({ query: '', shelves: { ...listings(), ...over } });

test('the four shelves, in order', () => {
  assert.deepEqual(SHELVES.map(s => s.id), ['data', 'bots', 'agents', 'skills']);
  assert.deepEqual(SHELVES.map(s => s.title), ['Data', 'Bots', 'Agents', 'Skills']);
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
