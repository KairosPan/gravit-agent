// face/client/js/host/discover-view.js — Discover's items from the face's listings (spec 2026-10-19 §7 Stage 3
// "Discover = My plugins"): what gravit runs, as cards. Pure. The abilities sit on Abilities, first (what gravit can do,
// spec 2026-11-13 §4.4), MCP servers on Data, the six Lunhui modules on Research (module cards spec §5.1), the bots on
// Bots (never the default composition, which is gravit), gravit and the local CLI agents on Agents, the skills on Skills.
import { researchItems } from './modules-view.js';
import { ICONS } from '../icons.js';
import { t, tn } from '../i18n/words.js';
import { HOST_NAME } from '../wire/speaker.js';

export const SHELF_IDS = Object.freeze(['abilities', 'data', 'research', 'bots', 'agents', 'skills']);
// the shelves in order, each with its title and its empty words, read when drawn
export const shelves = () => [
  { id: 'abilities', title: t('discover.shelf.abilities'), empty: t('discover.empty.abilities') },
  { id: 'data', title: t('discover.shelf.data'), empty: t('discover.empty.data') },
  { id: 'research', title: t('discover.shelf.research'), empty: t('discover.empty.research') },
  { id: 'bots', title: t('discover.shelf.bots'), empty: t('discover.empty.bots') },
  { id: 'agents', title: t('discover.shelf.agents'), empty: t('discover.empty.agents') },
  { id: 'skills', title: t('discover.shelf.skills'), empty: t('discover.empty.skills') },
];
// the listing each shelf is drawn from (host/discover.js reads them)
export const SOURCE = Object.freeze({ abilities: 'abilities', data: 'plugins', research: 'modules', bots: 'bots', agents: 'agents', skills: 'memory' });

const word = v => typeof v === 'string' && v.trim() !== '';
const list = v => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : []);
const letter = name => ({ type: 'letter', text: String(name).slice(0, 1).toUpperCase() });
const isText = v => typeof v === 'string';
const strings = v => (Array.isArray(v) ? v.filter(isText) : []);

// an ability's state in words (spec 2026-11-13 §4.3); a state this page does not know reads —
export function abilityStateWord(state) {
  switch (state) {
    case 'on': return t('discover.abilityState.on');
    case 'off': return t('discover.abilityState.off');
    case 'starting': return t('discover.abilityState.starting');
    case 'failed': return t('discover.abilityState.failed');
    default: return '—';
  }
}

// an ability's text in the page's language: in Chinese each field from the zh overlay when it has that field (an empty list
// too), from the top level when not; in English the top level's
function abilityText(a, lang) {
  const zh = lang === 'zh' && a.zh && typeof a.zh === 'object' ? a.zh : {};
  const pick = (key, fits) => (fits(zh[key]) ? zh[key] : fits(a[key]) ? a[key] : null);
  return {
    name: pick('name', word) ?? a.id,
    blurb: pick('blurb', isText) ?? '',
    about: pick('about', isText) ?? '',
    asks: strings(pick('asks', Array.isArray)),
    limits: strings(pick('limits', Array.isArray)),
  };
}

// an ability's mark is its declared icon, or bolt when it declares none or one the client lacks (icons.js throws on those)
const abilityIcon = name => (isText(name) && Object.hasOwn(ICONS, name) ? name : 'bolt');

// the abilities in the order served; one not on is dim, with its state on a chip (Failed warn, the others grey)
function abilityItems(listing, lang) {
  return list(listing?.abilities).filter(a => word(a.id)).map(a => {
    const text = abilityText(a, lang);
    return {
      id: `ability:${a.id}`, shelf: 'abilities', kind: t('discover.kind.ability'), kindCode: 'ability', name: text.name, line: text.blurb,
      mark: { type: 'glyph', icon: abilityIcon(a.icon) }, dim: a.state !== 'on',
      chip: a.state === 'on' ? null : { text: abilityStateWord(a.state), tone: a.state === 'failed' ? 'warn' : 'grey' }, text, source: a,
    };
  });
}

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

// gravit first (the main agent is always there), then the connected agents - each available or not to gravit - then the
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

// actives: the modules whose Run is running (modules-view's activeRuns), their cards live; lang: the page's language
// (state.lang), which the abilities' text is read in
export function itemsOf(discover, actives = {}, lang = 'en') {
  const sh = discover?.shelves ?? {};
  const roster = rosterOf(discover?.roster);
  return {
    abilities: abilityItems(sh.abilities?.data, lang),
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

export function itemById(discover, id, lang = 'en') {
  return Object.values(itemsOf(discover, {}, lang)).flat().find(i => i.id === id) ?? null;
}
