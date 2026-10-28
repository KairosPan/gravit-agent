// face/client/js/host/discover-view.js — Discover's items from the face's listings (spec 2026-10-19 §7 Stage 3
// "Discover = My plugins"): what Gravit runs, as cards. Pure. MCP servers sit on Data, the six Lunhui modules on
// Research (module cards spec §5.1), the bots on Bots (never the default composition, which is Gravit), Gravit and the
// local CLI agents on Agents, the skills on Skills.
import { researchItems } from './modules-view.js';

export const SHELVES = Object.freeze([
  { id: 'data', title: 'Data', empty: 'No MCP servers' },
  { id: 'research', title: 'Research', empty: 'No research modules' },
  { id: 'bots', title: 'Bots', empty: 'No bots yet' },
  { id: 'agents', title: 'Agents', empty: 'No agents' },
  { id: 'skills', title: 'Skills', empty: 'No skills' },
]);
// the listing each shelf is drawn from (host/discover.js reads them)
export const SOURCE = Object.freeze({ data: 'plugins', research: 'modules', bots: 'bots', agents: 'agents', skills: 'memory' });

const word = v => typeof v === 'string' && v.trim() !== '';
const list = v => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : []);
const letter = name => ({ type: 'letter', text: String(name).slice(0, 1).toUpperCase() });

function dataItems(plugins) {
  return list(plugins?.mcp).filter(m => word(m.server)).map(m => {
    const n = list(m.tools).length;
    return { id: `mcp:${m.server}`, shelf: 'data', kind: 'MCP', name: m.server, line: `${n} tool${n === 1 ? '' : 's'}`, mark: { type: 'glyph', icon: 'plug' }, source: m };
  });
}

function botItems(bots) {
  return list(bots?.bots).filter(b => word(b.id) && b.isDefault !== true).map(b => {
    const name = word(b.name) ? b.name : b.id;
    return { id: `bot:${b.id}`, shelf: 'bots', kind: 'Bot', name, line: word(b.description) ? b.description : '', mark: letter(name), source: b };
  });
}

// Gravit first (the main agent is always there), then the connected agents, then the ones found but not connected
function agentItems(agents) {
  const main = agents?.main && typeof agents.main === 'object' ? agents.main : {};
  const gravit = { id: 'agent:gravit', shelf: 'agents', kind: 'Agent', name: word(main.name) ? main.name : 'Gravit', line: word(main.runtime) ? main.runtime : '', mark: { type: 'gravit' }, source: main };
  const local = list(agents?.local).filter(a => word(a.bin)).map(a => ({
    id: `agent:${a.bin}`, shelf: 'agents', kind: 'Agent', name: word(a.label) ? a.label : a.bin, line: a.found === true ? 'Connected' : 'Not found',
    mark: { type: 'glyph', icon: 'agent' }, source: { ...a, connected: true },
  }));
  const found = list(agents?.candidates).filter(a => word(a.bin)).map(a => ({
    id: `agent:${a.bin}`, shelf: 'agents', kind: 'Agent', name: word(a.label) ? a.label : a.bin, line: word(a.version) ? `Found · ${a.version}` : 'Found',
    mark: { type: 'glyph', icon: 'agent' }, source: { ...a, connected: false },
  }));
  return [gravit, ...local, ...found];
}

function skillItems(memory) {
  return list(memory?.groups).flatMap(g => list(g.skills).filter(k => word(k.name)).map(k => ({
    id: `skill:${k.name}`, shelf: 'skills', kind: 'Skill', name: k.name, line: word(k.description) ? k.description : '', group: word(g.name) ? g.name : '',
    mark: { type: 'glyph', icon: 'book' }, source: k,
  })));
}

// actives: the modules whose Run is running (modules-view's activeRuns), their cards live
export function itemsOf(discover, actives = {}) {
  const sh = discover?.shelves ?? {};
  return {
    data: dataItems(sh.plugins?.data),
    research: researchItems(sh.modules?.data ?? null, sh.modules?.data?.mounted !== false, actives),
    bots: botItems(sh.bots?.data),
    agents: agentItems(sh.agents?.data),
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
