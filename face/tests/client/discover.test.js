// Discover as the inventory of what Gravit runs (spec 2026-10-19 §7 Stage 3 "Discover = My plugins"): five shelves
// from the face's listings, a grid per shelf, a page per item — and no shop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDiscover, renderPlugin } from '../../client/js/render/discover.js';
import { renderModule } from '../../client/js/render/modules.js';
import { reducers as R } from '../../client/js/reducers/index.js';
import { emptyState } from '../../client/js/data/empty.js';
import { listings, buffett, modulesListing, MARKET_RUN } from './helpers/inventory.js';

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
  const html = [renderDiscover(loaded()), ...['mcp:alpaca-kit', 'bot:buffett', 'agent:codex', 'agent:gravit', 'skill:rules'].map(page)].join('');
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

test("the bot page offers Talk to and Edit; the editor's field ids carry the revision", () => {
  const s = loaded({ screen: 'plugin', id: 'bot:buffett' });
  const h = renderPlugin(s);
  assert.match(h, /data-action="talkTo" data-id="buffett"[^>]*>Talk to Buffett Type</);
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

test('a broken or unlisted bot offers no Talk to', () => {
  for (const over of [{ broken: 'cannot mount' }, { listed: false }]) {
    const l = listings();
    l.bots.data.bots = [{ ...buffett, ...over }];
    const h = renderPlugin(loadedFrom(l, { screen: 'plugin', id: 'bot:buffett' }));
    assert.doesNotMatch(h, /data-action="talkTo"/, JSON.stringify(over));
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
