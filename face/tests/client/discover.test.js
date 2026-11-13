// Discover as the inventory of what Gravit runs (spec 2026-10-19 §7 Stage 3 "Discover = My plugins"): six shelves
// from the face's listings, a grid per shelf, a page per item — and no shop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDiscover, renderPlugin } from '../../client/js/render/discover.js';
import { renderModule } from '../../client/js/render/modules.js';
import { reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { listings, buffett, modulesListing, MARKET_RUN } from './helpers/inventory.js';
import { withTable } from '../../client/js/i18n/words.js';
import { ZH } from '../../client/js/i18n/zh.js';

const loadedFrom = (lists, route = { screen: 'discover', id: null }) => {
  let s = emptyState();
  for (const [shelf, v] of Object.entries(lists)) s = R.shelfLoaded(s, { shelf, data: v.data, at: 1 });
  return R.nav(s, route);
};
const loaded = route => loadedFrom(listings(), route);
const page = id => renderPlugin(loaded({ screen: 'plugin', id }));
const apos = "(?:'|&#39;)";

test("the shelves draw from the host's listings, with See all and Create a bot", () => {
  const h = renderDiscover(loaded());
  assert.match(h, /<main class="main disc">/);
  assert.match(h, /<h1 class="head-title">Discover<\/h1>/);
  assert.match(h, /id="dq"[^>]*placeholder="Search"/);
  assert.match(h, /href="#\/discover\/create"[^>]*>[\s\S]*?Create a bot/);
  for (const [t, id] of [['Data', 'data'], ['Bots', 'bots'], ['Agents', 'agents'], ['Skills', 'skills']]) {
    assert.match(h, new RegExp(`shelf-title">${t}<`), t);
    assert.match(h, new RegExp(`href="#/discover/${id}">See all`), id);
  }
  assert.match(h, /href="#\/plugin\/mcp%3Aalpaca-kit"/);
  assert.match(h, /pcard-name">alpaca-kit<[\s\S]*?pcard-blurb">2 tools</);
  assert.match(h, /pcard-name">Buffett Type</); assert.match(h, /pcard-name">Gravit</); assert.match(h, /pcard-name">rules</);
  assert.match(h, /data-action="rescanAgents"/);
});

test('a failed shelf says so with Retry and leaves the others drawn', () => {
  const { bots, ...rest } = listings();
  const s = R.shelfFailed(loadedFrom(rest), { shelf: 'bots', at: 1 });
  const h = renderDiscover(s);
  assert.match(h, new RegExp(`Couldn${apos}t read Bots`)); assert.match(h, /data-action="shelfRetry" data-shelf="bots"/);
  assert.match(h, /pcard-name">alpaca-kit</);
  assert.match(renderDiscover(R.nav(emptyState(), { screen: 'discover', id: null })), /Loading…/);
  assert.match(renderDiscover(R.shelfLoaded(s, { shelf: 'bots', data: { ok: true, bots: [] }, at: 2 })), /No bots yet/);
  assert.ok(bots);
});

test('a query draws one grid of matches; a shelf route draws that shelf as a grid with a way back', () => {
  const q = renderDiscover(R.setDiscoverQuery(loaded(), 'honest'));
  assert.match(q, /grid-title">1 result</); assert.match(q, /pcard-name">rules</); assert.doesNotMatch(q, /shelf-title/);
  const g = renderDiscover(loaded({ screen: 'discover', id: 'agents' }));
  assert.match(g, /href="#\/discover"[^>]*>‹ Discover/); assert.match(g, /grid-title">Agents</);
  assert.match(g, /pcard-name">Codex</); assert.doesNotMatch(g, /pcard-name">alpaca-kit</);
});

test('an MCP page lists its tools with their descriptions', () => {
  const h = page('mcp:alpaca-kit');
  assert.match(h, /plug-name">alpaca-kit</); assert.match(h, /MCP server/);
  assert.match(h, />State<[\s\S]*?>Active</);
  assert.match(h, /mcp__alpaca-kit__account[\s\S]*?The paper account/);
  assert.match(h, /href="#\/discover"[^>]*>‹ Discover/);
  assert.match(page('mcp:akshare'), />State<[\s\S]*?>Failed</);
});

test('a bot page: model, description, soul, home, skills, setup issues', () => {
  const h = page('bot:buffett');
  assert.match(h, /plug-name">Buffett Type</);
  assert.match(h, />Model<[\s\S]*?deepseek\/deepseek-chat/);
  assert.match(h, /Buys cheap, holds long/);
  assert.match(h, /# Buffett\nBuy cheap\./);
  assert.match(h, />Home<[\s\S]*?\/r\/bots\/buffett\/home/);
  assert.match(h, />Skills<[\s\S]*?value/);
  assert.match(h, /skills\/notes missing/);
  const l = listings();
  l.bots.data.bots = [{ ...buffett, model: undefined, broken: 'cannot mount the composition', setupIssues: [] }];
  const b = renderPlugin(loadedFrom(l, { screen: 'plugin', id: 'bot:buffett' }));
  assert.match(b, />Model<[\s\S]*?>Default</);
  assert.match(b, new RegExp(`Can${apos}t run · cannot mount the composition`));
});

test('an agent page: version, sign-in, Connect for a candidate and Disconnect for a connected one', () => {
  const c = page('agent:codex');
  assert.match(c, /CLI agent/); assert.match(c, />Version<[\s\S]*?>0\.9</); assert.match(c, />Sign-in<[\s\S]*?>Signed in</);
  assert.match(c, />Tool<[\s\S]*?agent_codex/);
  assert.match(c, /data-action="disconnectAgent" data-bin="codex"/);
  const f = page('agent:claude');
  assert.match(f, /data-action="connectAgent" data-bin="claude"/); assert.doesNotMatch(f, /disconnectAgent/);
  assert.match(page('agent:gone'), />Sign-in<[\s\S]*?>Unknown</);
});

test('the Gravit page: model, host and keys, a failed card alone', () => {
  const at = loaded({ screen: 'plugin', id: 'agent:gravit' });
  assert.match(renderPlugin(at), /Loading…/);
  const h = renderPlugin(R.gravitLoaded(at, { host: { cwd: '/r', home: '/h', attachedSessions: 2, version: '0.2.0-rc.2' }, model: false, keys: { DEEPSEEK_API_KEY: { configured: true } } }));
  assert.match(h, /Main agent/);
  assert.match(h, new RegExp(`>Model<[\\s\\S]*?Couldn${apos}t read`));
  assert.match(h, />Working directory<[\s\S]*?>\/r</); assert.match(h, />Home<[\s\S]*?>\/h</); assert.match(h, />Attached sessions<[\s\S]*?>2</);
  assert.match(h, />DEEPSEEK_API_KEY<[\s\S]*?>Present</); assert.doesNotMatch(h, /APCA_/, 'no key the face does not read');
  assert.match(renderPlugin(R.gravitLoaded(at, { host: false, model: false, keys: {} })), />DEEPSEEK_API_KEY<[\s\S]*?>Absent</);
  const m = renderPlugin(R.gravitLoaded(at, { host: false, model: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' }, keys: false }));
  assert.match(m, />Provider<[\s\S]*?>deepseek</); assert.match(m, />Effort<[\s\S]*?>high</);
  assert.match(m, new RegExp(`>Host<[\\s\\S]*?Couldn${apos}t read`));
});

test('a skill page shows Loading… then its content', () => {
  const s = loaded({ screen: 'plugin', id: 'skill:rules' });
  assert.match(renderPlugin(s), /Loading…/);
  const r = R.skillLoaded(s, { name: 'rules', detail: { ok: true, name: 'rules', description: 'd', group: 'mechanics', path: '/p', content: '# Five rules' } });
  assert.match(renderPlugin(r), /# Five rules/);
  assert.match(renderPlugin(r), />Group<[\s\S]*?mechanics/);
  assert.match(renderPlugin(R.skillFailed(s, { name: 'rules' })), new RegExp(`Couldn${apos}t read`));
});

test('an unknown id: Loading… while its shelf loads, Not found after', () => {
  assert.match(renderPlugin(R.nav(emptyState(), { screen: 'plugin', id: 'bot:zz' })), /Loading…/);
  assert.match(page('bot:zz'), /Not found/);
  assert.match(page('nonsense'), /Not found/);
});

// a review is a shop's; the Research shelf's CN reviewer role is no review
test('no Install, Uninstall, Publish, review, installs, price or shop', () => {
  const html = [renderDiscover(loaded()), ...['mcp:alpaca-kit', 'bot:buffett', 'agent:codex', 'agent:gravit', 'skill:rules', 'ability:event-analogs', 'ability:read-through'].map(page)].join('');
  for (const w of [/Install/, /Uninstall/, /Publish/, /\breviews?\b/i, /installs/, /price/i, /shop/i, /What you sign/]) assert.doesNotMatch(html, w, String(w));
});

test('markup in a soul, a skill, a tool description and a reason stays text', () => {
  const bad = '<img src=x onerror=alert(1)>';
  const l = listings();
  l.plugins.data.mcp[0].tools[0].description = bad;
  l.bots.data.bots = [{ ...buffett, soul: bad, description: bad, broken: bad, setupIssues: [bad] }];
  l.memory.data.groups[0].skills[0].description = bad;
  const html = [
    renderDiscover(loadedFrom(l)),
    renderPlugin(loadedFrom(l, { screen: 'plugin', id: 'mcp:alpaca-kit' })),
    renderPlugin(loadedFrom(l, { screen: 'plugin', id: 'bot:buffett' })),
    renderPlugin(R.skillLoaded(loadedFrom(l, { screen: 'plugin', id: 'skill:rules' }), { name: 'rules', detail: { content: bad, group: bad } })),
  ].join('');
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test("the bot page offers Edit; the editor's field ids carry the revision", () => {
  const s = loaded({ screen: 'plugin', id: 'bot:buffett' });
  const h = renderPlugin(s);
  assert.match(h, /data-action="editBot" data-id="buffett"/);
  const editing = R.startEdit(s, { kind: 'bot', id: 'buffett' });
  const e = renderPlugin(R.modelsLoaded(editing, { choices: [{ value: 'deepseek/deepseek-chat', label: 'DeepSeek · Chat' }, { value: 'kimi/k2', label: 'Kimi · K2' }] }));
  assert.match(e, /<form class="bot-edit" data-action="saveBot" data-id="buffett">/);
  assert.match(e, /id="bot-buffett-r1-name"[^>]*value="Buffett Type"/);
  assert.match(e, /id="bot-buffett-r1-description"/);
  assert.match(e, /<select id="bot-buffett-r1-model"[^>]*><option value="">Default<\/option><option value="deepseek\/deepseek-chat" selected>DeepSeek · Chat<\/option><option value="kimi\/k2">Kimi · K2<\/option>/);
  assert.match(e, /<textarea id="bot-buffett-r1-soul"[^>]*># Buffett\nBuy cheap\.<\/textarea>/);
  assert.match(e, /data-action="cancelEdit"/);
  const l = listings();
  l.bots.data.bots = [{ ...buffett, revision: 'r2', model: 'other/route' }];
  const later = renderPlugin(R.startEdit(loadedFrom(l, { screen: 'plugin', id: 'bot:buffett' }), { kind: 'bot', id: 'buffett' }));
  assert.match(later, /id="bot-buffett-r2-name"/, 'a new revision, new boxes');
  assert.match(later, /<option value="other\/route" selected>other\/route<\/option>/, 'a model not in the catalog is still offered');
});

test('bot cards have no Talk to key', () => {
  for (const over of [{}, { broken: 'cannot mount' }, { listed: false }]) {
    const l = listings();
    l.bots.data.bots = [{ ...buffett, ...over }];
    const h = renderPlugin(loadedFrom(l, { screen: 'plugin', id: 'bot:buffett' }));
    assert.doesNotMatch(h, /data-action="talkTo"|Talk to/, JSON.stringify(over));
    assert.match(h, /data-action="editBot"/);
  }
});

test('the Create page', () => {
  const h = renderDiscover(R.modelsLoaded(loaded({ screen: 'discover', id: 'create' }), { choices: [{ value: 'deepseek/deepseek-chat', label: 'DeepSeek · Chat' }] }));
  assert.match(h, /href="#\/discover"[^>]*>‹ Discover/);
  assert.match(h, /<h1 class="plug-name">Create a bot<\/h1>/);
  assert.match(h, /<form class="bot-edit" data-action="createBot">/);
  for (const id of ['nb-name', 'nb-id', 'nb-description', 'nb-model', 'nb-soul']) assert.match(h, new RegExp(`id="${id}"`), id);
  assert.match(h, /<option value="">Default<\/option><option value="deepseek\/deepseek-chat">DeepSeek · Chat<\/option>/);
  assert.match(h, /type="submit"[^>]*>Create</);
  assert.doesNotMatch(h, /shelf-title/);
});

test("a server's tool description is drawn clamped, its whole text kept for the reader", () => {
  const l = listings();
  const long = 'A-share stock data: quotes. ## Available Methods - **a**() one - **b**() two'.repeat(40);
  l.plugins.data.mcp[0].tools[0].description = long;
  const h = renderPlugin(loadedFrom(l, { screen: 'plugin', id: 'mcp:alpaca-kit' }));
  assert.match(h, /<span class="tool-desc">A-share stock data: quotes\./);
  assert.ok(h.includes(long.slice(-40)), 'the whole description stays on the page');
});

// a Lunhui module's page before its listing is read, and its latest artifact only for the latest run
const modulePage = (id, listing) => R.nav(listing ? R.shelfLoaded(emptyState(), { shelf: 'modules', data: listing, at: 1 }) : emptyState(), { screen: 'module', id });
const headChip = h => h.match(/<span class="pcard-kind">MODULE<\/span><span class="chip ?([a-z]*)">([^<]*)<\/span>/)?.slice(1);

test('a module page while the listing loads: Loading…, for an unknown name too; the head chip waits for the listing', () => {
  assert.match(renderModule(modulePage('foo')), /<div class="disc-none dim">Loading…<\/div>/);
  assert.match(renderModule(R.shelfLoading(modulePage('foo'), { shelf: 'modules' })), /Loading…/);
  const loading = renderModule(modulePage('sentiment'));
  assert.deepEqual(headChip(loading), ['grey', '…']);
  assert.doesNotMatch(loading, /no run yet/, 'the head never contradicts Runs saying Loading…');
  const failed = renderModule(R.shelfFailed(modulePage('sentiment'), { shelf: 'modules', at: 1 }));
  assert.deepEqual(headChip(failed), ['grey', '—']);
  assert.match(failed, new RegExp(`Couldn${apos}t read`));
  assert.deepEqual(headChip(renderModule(modulePage('sentiment', modulesListing()))), ['ok', 'IGNITION · POSITIVE · NONE']);
});

test("a module page's latest artifact: shown for the latest run alone, never another run labelled with its channel", () => {
  const at = modulePage('sentiment', modulesListing());
  const same = renderModule(R.moduleArtifactLoaded(at, { module: 'sentiment', run: MARKET_RUN, json: { state: 'IGNITION' } }));
  assert.ok(same.includes(`<summary>${MARKET_RUN} · cn-market</summary>`));
  const other = renderModule(R.moduleArtifactLoaded(at, { module: 'sentiment', run: '20261027T020000Z-00000000', json: { state: 'OLDER_RUN' } }));
  assert.doesNotMatch(other, /<summary>/);
  assert.doesNotMatch(other, /OLDER_RUN|20261027T020000Z/);
  assert.match(other, /open the channel page to read older runs/);
});

test("an item's line is known by its shelf and a module's unread head by its code, never by a table word", () => {
  const table = { 'discover.kind.mcp': 'Serveur', 'discover.kindLine.mcp': 'Serveur MCP', 'discover.unread': 'Illisible', 'common.loading': 'Chargement…' };
  withTable(table, () => {
    const h = page('mcp:alpaca-kit');
    assert.match(h, /<div class="dim">Serveur MCP<\/div>/);
    const s = R.nav(emptyState(), { screen: 'module', id: 'sentiment' });
    const failed = renderModule(R.shelfFailed(s, { shelf: 'modules', at: 1 }));
    assert.match(failed, /class="chip grey">—</, 'a listing that failed draws — in the head');
    assert.match(failed, /Illisible/);
    assert.match(renderModule(s), /class="chip grey">…</, 'one first read draws …');
    assert.match(renderModule(s), /Chargement…/);
  });
});

test("a card's kind is drawn in the table's capitals, never a table word upper-cased", () => {
  const table = { 'discover.kind.mcpUpper': 'Srv', 'discover.kind.botUpper': 'Bt', 'discover.kind.agentUpper': 'Agt', 'discover.kind.skillUpper': 'Sk', 'discover.kind.moduleUpper': 'Mod', 'discover.kind.abilityUpper': 'Abl',
    'discover.kind.mcp': 'xmcp', 'discover.kind.bot': 'xbot', 'discover.kind.agent': 'xagent', 'discover.kind.skill': 'xskill', 'discover.kind.module': 'xmodule', 'discover.kind.ability': 'xability' };
  withTable(table, () => {
    const kinds = [...renderDiscover(loaded()).matchAll(/<span class="pcard-kind">([^<]*)<\/span>/g)].map(m => m[1]);
    assert.ok(kinds.length > 0);
    for (const k of ['Srv', 'Bt', 'Agt', 'Sk', 'Mod', 'Abl']) assert.ok(kinds.includes(k), `${k} drawn: ${kinds}`);
    assert.deepEqual(kinds.filter(k => !['Srv', 'Bt', 'Agt', 'Sk', 'Mod', 'Abl'].includes(k)), []);
    assert.match(renderModule(R.nav(emptyState(), { screen: 'module', id: 'sentiment' })), /<span class="pcard-kind">Mod<\/span>/);
  });
});

// the abilities (spec 2026-11-13 §4.4): the first shelf's cards, and an ability's page with its ask keys, which write to
// Gravit's conversation only when the page knows it
const conversing = (s, conversation = 'c-gravit') => R.tasksLoaded(s, { conversation, tasks: [], at: 1 });
// the listings with the ability at index i changed by `over`
const withAbility = (i, over) => {
  const l = listings();
  l.abilities.data.abilities[i] = { ...l.abilities.data.abilities[i], ...over };
  return l;
};
const abilityAt = (id, l = listings()) => loadedFrom(l, { screen: 'plugin', id });
const askKeys = h => h.match(/<button[^>]*data-action="askAbility"[^>]*>/g) ?? [];
const labelAt = (h, label) => h.indexOf(`<div class="dsec-label">${label}</div>`);

test("Discover's front draws the Abilities shelf first, a card per ability; one not on is dim with its state", () => {
  const h = renderDiscover(conversing(loaded()));
  assert.equal([...h.matchAll(/shelf-title">([^<]*)</g)].map(m => m[1])[0], 'Abilities');
  const shelf = h.slice(h.indexOf('shelf-title">Abilities'), h.indexOf('shelf-title">Data'));
  for (const id of ['event-analogs', 'read-through']) assert.match(shelf, new RegExp(`<a class="pcard" href="#/plugin/ability%3A${id}">`), id);
  assert.equal(shelf.match(/<span class="pcard-kind">ABILITY<\/span><\/span>/g)?.length, 2, 'on: the kind alone');
  const off = renderDiscover(loadedFrom(withAbility(1, { state: 'off' })));
  assert.match(off, /<a class="pcard" href="#\/plugin\/ability%3Aevent-analogs">/);
  assert.match(off, /<a class="pcard dim" href="#\/plugin\/ability%3Aread-through">[\s\S]*?<span class="pcard-side"><span class="pcard-kind">ABILITY<\/span><span class="chip grey">Off<\/span><\/span><\/a>/);
  assert.match(renderDiscover(loadedFrom(withAbility(0, { state: 'failed' }))), /<a class="pcard dim" href="#\/plugin\/ability%3Aevent-analogs">[\s\S]*?<span class="chip warn">Failed<\/span>/);
  assert.match(renderDiscover(loadedFrom(withAbility(0, { state: 'off' }), { screen: 'discover', id: 'abilities' })), /<a class="pcard in-grid dim" href="#\/plugin\/ability%3Aevent-analogs">/, 'its grid');
});

test("the event analog's page: State, About, Ask Gravit with its hint, What it does not tell you, Made of", () => {
  const h = renderPlugin(conversing(abilityAt('ability:event-analogs')));
  assert.match(h, /<h1 class="plug-name">Event analogs<\/h1><div class="dim">Ability<\/div>/);
  assert.match(h, /<span class="kv-k">State<\/span><span class="kv-v">On<\/span>/);
  const at = ['About', 'Ask Gravit', 'What it does not tell you', 'Made of'].map(label => labelAt(h, label));
  assert.ok(at.every(i => i > 0), `every section drawn: ${at}`);
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'in that order');
  assert.ok(h.indexOf('<span class="kv-k">State</span>') < at[0], 'State first');
  assert.match(h, /<div class="dsec-line">Give Gravit a stock and what just happened to it\.[^<]*<\/div><div class="dsec-line">The answer is a table/, 'About: a line per paragraph');
  const keys = askKeys(h);
  assert.equal(keys.length, 3);
  assert.ok(keys.every(k => !/disabled/.test(k)), 'none disabled');
  assert.match(keys[0], /^<button type="button" class="btn-sm ask-key" data-action="askAbility" data-text="NVDA&#39;s board opened an investigation into its CEO\. What did stocks do after events like this\?">$/);
  assert.match(h, /data-action="askAbility"[^>]*>NVDA&#39;s board opened an investigation into its CEO\. What did stocks do after events like this\?<\/button>/);
  assert.match(h, /<div class="dsec-line dim">Puts the question in Gravit&#39;s box\. Nothing is sent until you send it\.<\/div>/);
  assert.doesNotMatch(h, /conversation is not available/);
  assert.match(h, /<div class="dsec-line">Historical statistics, not a forecast and not a basis for a trade<\/div>/);
  const made = h.slice(at[3]);
  assert.match(made, /<span class="kv-k">Tools<\/span><span class="kv-v">[\s\S]*?analog_events/);
  assert.match(made, /<span class="kv-k">Roles<\/span><span class="kv-v">[\s\S]*?source-reader/);
  assert.match(made, /<span class="kv-k">Skills<\/span><span class="kv-v">[\s\S]*?<a class="link mono" href="#\/plugin\/skill%3Aanalog-guide">analog-guide ›<\/a>/);
  assert.match(made, /<span class="kv-k">Rows<\/span><span class="kv-v">[\s\S]*?analog-views<\/span><span class="dim">Active<\/span>/);
  assert.match(made, /analog-events<\/span><span class="dim">Active<\/span>/);
  assert.doesNotMatch(made, /not registered|missing|>Off</);
});

test('the ask keys are disabled without a conversation, saying so; with the ability not on they are disabled and say nothing', () => {
  for (const s of [abilityAt('ability:event-analogs'), R.tasksOff(abilityAt('ability:event-analogs'), { at: 1 }), conversing(abilityAt('ability:event-analogs'), null)]) {
    const h = renderPlugin(s);
    assert.equal(askKeys(h).length, 3);
    assert.ok(askKeys(h).every(k => / disabled>$/.test(k)), 'every key disabled');
    assert.match(h, new RegExp(`<div class="dsec-line dim">Gravit${apos}s conversation is not available</div>`));
    assert.doesNotMatch(h, /Nothing is sent until you send it/);
  }
  const off = renderPlugin(conversing(abilityAt('ability:event-analogs', withAbility(0, { state: 'off' }))));
  assert.match(off, /<span class="kv-k">State<\/span><span class="kv-v">Off<\/span>/);
  assert.equal(askKeys(off).length, 3);
  assert.ok(askKeys(off).every(k => / disabled>$/.test(k)));
  assert.doesNotMatch(off, /Nothing is sent until you send it|conversation is not available/);
  assert.ok(askKeys(renderPlugin(conversing(abilityAt('ability:event-analogs', withAbility(0, { state: 'starting' }))))).every(k => / disabled>$/.test(k)), 'starting: disabled');
});

test("an ability's page draws no section it has nothing for, and says what is not there", () => {
  const bare = renderPlugin(conversing(abilityAt('ability:event-analogs', withAbility(0, { asks: [], limits: [], about: '' }))));
  for (const label of ['Ask Gravit', 'What it does not tell you', 'About']) assert.equal(labelAt(bare, label), -1, label);
  assert.equal(askKeys(bare).length, 0);
  assert.doesNotMatch(bare, /Nothing is sent until you send it/);
  assert.ok(labelAt(bare, 'Made of') > 0);
  const parts = withAbility(0, {
    tools: [{ name: 'analog_events', registered: false }],
    roles: [{ id: 'source-reader', present: false }],
    skills: [{ name: 'analog-guide', present: false }],
    rows: [{ id: 'analog-views', enabled: false, phase: null }, { id: 'analog-events', enabled: true, phase: 'failed' }],
  });
  const h = renderPlugin(conversing(abilityAt('ability:event-analogs', parts)));
  assert.match(h, /analog_events<\/span><span class="dim">not registered<\/span>/);
  assert.match(h, /source-reader<\/span><span class="dim">missing<\/span>/);
  assert.match(h, /analog-guide<\/span><span class="dim">missing<\/span>/);
  assert.doesNotMatch(h, /href="#\/plugin\/skill%3Aanalog-guide"/, 'a missing skill is no link');
  assert.match(h, /analog-views<\/span><span class="dim">off<\/span>/);
  assert.match(h, /analog-events<\/span><span class="dim">Failed<\/span>/);
  const rt = renderPlugin(conversing(abilityAt('ability:read-through')));
  assert.ok(labelAt(rt, 'Made of') > 0);
  assert.doesNotMatch(rt, /kv-k">Roles<|kv-k">Skills</, 'the read-through has no roles and no skills: no such rows');
  assert.match(rt, /read_through/);
});

test("an ability's listed strings are escaped, and its page never names a tool's description", () => {
  const ask = 'Is "A&B" <up>?';
  const bad = '<img src=x onerror=alert(1)>';
  const l = withAbility(0, { asks: [ask], about: bad, limits: [bad], name: bad, tools: [{ name: bad, registered: true }], rows: [{ id: bad, enabled: true, phase: 'active' }], roles: [{ id: bad, present: true }], skills: [{ name: bad, present: true }] });
  const h = renderPlugin(conversing(abilityAt('ability:event-analogs', l)));
  assert.ok(h.includes('data-text="Is &quot;A&amp;B&quot; &lt;up&gt;?"'));
  assert.ok(!h.includes(ask), 'the ask nowhere unescaped');
  assert.ok(h.includes('>Is &quot;A&amp;B&quot; &lt;up&gt;?</button>'));
  assert.doesNotMatch(h, /<img/);
  assert.match(h, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(renderDiscover(loadedFrom(l)), /<img/);
  for (const id of ['ability:event-analogs', 'ability:read-through']) assert.doesNotMatch(renderPlugin(conversing(abilityAt(id))), /description/, id);
});

test("an ability's page in Chinese reads the overlay and the Chinese table", () => {
  withTable(ZH, () => {
    const h = renderPlugin(R.setLang(conversing(abilityAt('ability:event-analogs')), 'zh'));
    for (const w of ['事件对标', '问 Gravit', '它说明不了什么', '组成', '简介']) assert.ok(h.includes(w), w);
    assert.match(h, /data-text="NVDA 董事会对 CEO 启动调查/);
    assert.match(renderDiscover(R.setLang(loaded(), 'zh')), /pcard-name">对手推演</);
  });
});

test('an unknown ability: Loading… while the abilities shelf is idle, Not found once it is read', () => {
  assert.match(renderPlugin(R.nav(emptyState(), { screen: 'plugin', id: 'ability:nope' })), /Loading…/);
  assert.match(page('ability:nope'), /Not found/);
  assert.match(page('ability:event-analogs'), /plug-name">Event analogs</, 'an ability is no skill page');
});

// the one roster (one-entry plan 4 Task 5): the Available to Gravit switch on a bot's and a connected CLI agent's page
const rostered = (route, roster = { ok: true, agents: ['codex'], bots: ['buffett'] }) => R.rosterLoaded(loaded(route), roster);
const switchOf = h => h.match(/<button[^>]*class="switch"[^>]*>[\s\S]*?<\/button>/)?.[0] ?? '';

test('the bot card draws the Available to Gravit switch, pressed when the bot is on the roster', () => {
  const on = switchOf(renderPlugin(rostered({ screen: 'plugin', id: 'bot:buffett' })));
  assert.match(on, /<button type="button" class="switch" role="switch" aria-checked="true" data-action="toggleAvailable" data-kind="bot" data-id="buffett">/);
  assert.match(on, /Available to Gravit/);
  assert.doesNotMatch(on, /disabled/);
  const off = switchOf(renderPlugin(rostered({ screen: 'plugin', id: 'bot:buffett' }, { ok: true, agents: [], bots: [] })));
  assert.match(off, /aria-checked="false" data-action="toggleAvailable" data-kind="bot" data-id="buffett"/);
  assert.match(renderPlugin(rostered({ screen: 'plugin', id: 'bot:buffett' })), /data-action="editBot"/, 'Edit stays beside it');
  withTable(ZH, () => assert.match(switchOf(renderPlugin(rostered({ screen: 'plugin', id: 'bot:buffett' }))), /Gravit 可用/));
});

test('a connected CLI agent draws the switch too; Gravit and a candidate not connected draw none', () => {
  const codex = renderPlugin(rostered({ screen: 'plugin', id: 'agent:codex' }));
  assert.match(switchOf(codex), /class="switch" role="switch" aria-checked="true" data-action="toggleAvailable" data-kind="agent" data-id="codex"/);
  assert.match(codex, /data-action="disconnectAgent"/);
  assert.match(switchOf(renderPlugin(rostered({ screen: 'plugin', id: 'agent:gone' }))), /aria-checked="false"[^>]*data-kind="agent" data-id="gone"/);
  for (const id of ['agent:gravit', 'agent:claude', 'mcp:alpaca-kit', 'skill:rules']) {
    assert.doesNotMatch(renderPlugin(rostered({ screen: 'plugin', id })), /toggleAvailable/, id);
  }
});

test('an unreadable roster draws discover.rosterUnreadable and disabled switches; an unread one disabled switches alone', () => {
  const bad = renderPlugin(rostered({ screen: 'plugin', id: 'bot:buffett' }, { ok: false, corrupt: true }));
  assert.match(bad, /The roster file cannot be read; repair channels\.json in the harness home\./);
  assert.match(switchOf(bad), /aria-checked="false"[^>]*disabled/);
  withTable(ZH, () => assert.match(renderPlugin(rostered({ screen: 'plugin', id: 'agent:codex' }, { ok: false, corrupt: true })), /名单文件读不出来；请修好 harness 目录里的 channels\.json。/));
  const unread = renderPlugin(loaded({ screen: 'plugin', id: 'bot:buffett' }));
  assert.match(switchOf(unread), /disabled/);
  assert.doesNotMatch(unread, /roster file/);
  assert.doesNotMatch(renderPlugin(rostered({ screen: 'plugin', id: 'bot:buffett' })), /roster file/);
});
