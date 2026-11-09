// face/client/js/host/discover-view.js — Discover's items from the face's listings (spec 2026-10-19 §7 Stage 3
// "Discover = My plugins"): what Gravit runs, as cards. Pure. MCP servers sit on Data, the six Lunhui modules on
// Research (module cards spec §5.1), the bots on Bots (never the default composition, which is Gravit), Gravit and the
// local CLI agents on Agents, the skills on Skills.
import { researchItems } from './modules-view.js';
import { t, tn } from '../i18n/words.js';
import { HOST_NAME } from '../wire/speaker.js';

export const SHELF_IDS = Object.freeze(['data', 'research', 'bots', 'agents', 'skills']);
// the shelves in order, each with its title and its empty words, read when drawn
export const shelves = () => [
  { id: 'data', title: t('discover.shelf.data'), empty: t('discover.empty.data') },
  { id: 'research', title: t('discover.shelf.research'), empty: t('discover.empty.research') },
  { id: 'bots', title: t('discover.shelf.bots'), empty: t('discover.empty.bots') },
  { id: 'agents', title: t('discover.shelf.agents'), empty: t('discover.empty.agents') },
  { id: 'skills', title: t('discover.shelf.skills'), empty: t('discover.empty.skills') },
];
// the listing each shelf is drawn from (host/discover.js reads them)
export const SOURCE = Object.freeze({ data: 'plugins', research: 'modules', bots: 'bots', agents: 'agents', skills: 'memory' });

const word = v => typeof v === 'string' && v.trim() !== '';
const list = v => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : []);
const letter = name => ({ type: 'letter', text: String(name).slice(0, 1).toUpperCase() });

function dataItems(plugins) {
  return list(plugins?.mcp).filter(m => word(m.server)).map(m => {
    const n = list(m.tools).length;
    return { id: `mcp:${m.server}`, shelf: 'data', kind: t('discover.kind.mcp'), kindCode: 'mcp', name: m.server, line: tn('discover.tools', n), mark: { type: 'glyph', icon: 'plug' }, source: m };
  });
}

// the one roster's lists (one-entry plan 4): an item is available when its id is on them; none read yet, none is
const rosterOf = r => ({ agents: Array.isArray(r?.agents) ? r.agents : [], bots: Array.isArray(r?.bots) ? r.bots : [] });

function botItems(bots, roster) {
  return list(bots?.bots).filter(b => word(b.id) && b.isDefault !== true).map(b => {
    const name = word(b.name) ? b.name : b.id;
    return { id: `bot:${b.id}`, shelf: 'bots', kind: t('discover.kind.bot'), kindCode: 'bot', name, line: word(b.description) ? b.description : '', mark: letter(name), source: b, available: roster.bots.includes(b.id) };
  });
}

// Gravit first (the main agent is always there), then the connected agents - each available or not to Gravit - then the
// ones found but not connected
function agentItems(agents, roster) {
  const main = agents?.main && typeof agents.main === 'object' ? agents.main : {};
  const gravit = { id: 'agent:gravit', shelf: 'agents', kind: t('discover.kind.agent'), kindCode: 'agent', name: word(main.name) ? main.name : HOST_NAME, line: word(main.runtime) ? main.runtime : '', mark: { type: 'gravit' }, source: main };
  const local = list(agents?.local).filter(a => word(a.bin)).map(a => ({
    id: `agent:${a.bin}`, shelf: 'agents', kind: t('discover.kind.agent'), kindCode: 'agent', name: word(a.label) ? a.label : a.bin, line: a.found === true ? t('discover.agent.connected') : t('discover.notFound'),
    mark: { type: 'glyph', icon: 'agent' }, source: { ...a, connected: true }, available: roster.agents.includes(a.bin),
  }));
  const found = list(agents?.candidates).filter(a => word(a.bin)).map(a => ({
    id: `agent:${a.bin}`, shelf: 'agents', kind: t('discover.kind.agent'), kindCode: 'agent', name: word(a.label) ? a.label : a.bin, line: word(a.version) ? t('discover.agent.foundVersion', { version: a.version }) : t('discover.agent.found'),
    mark: { type: 'glyph', icon: 'agent' }, source: { ...a, connected: false },
  }));
  return [gravit, ...local, ...found];
}

function skillItems(memory) {
  return list(memory?.groups).flatMap(g => list(g.skills).filter(k => word(k.name)).map(k => ({
    id: `skill:${k.name}`, shelf: 'skills', kind: t('discover.kind.skill'), kindCode: 'skill', name: k.name, line: word(k.description) ? k.description : '', group: word(g.name) ? g.name : '',
    mark: { type: 'glyph', icon: 'book' }, source: k,
  })));
}

// actives: the modules whose Run is running (modules-view's activeRuns), their cards live
export function itemsOf(discover, actives = {}) {
  const sh = discover?.shelves ?? {};
  const roster = rosterOf(discover?.roster);
  return {
    data: dataItems(sh.plugins?.data),
    research: researchItems(sh.modules?.data ?? null, sh.modules?.data?.mounted !== false, actives),
    bots: botItems(sh.bots?.data, roster),
    agents: agentItems(sh.agents?.data, roster),
    skills: skillItems(sh.memory?.data),
  };
}

export function searchItems(items, q) {
  const s = String(q ?? '').trim().toLowerCase();
  if (!s) return [];
  return items.filter(i => `${i.name} ${i.line}`.toLowerCase().includes(s));
}

export function itemById(discover, id) {
  return Object.values(itemsOf(discover)).flat().find(i => i.id === id) ?? null;
}
