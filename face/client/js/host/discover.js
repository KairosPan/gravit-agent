// face/client/js/host/discover.js — Discover from the face (spec 2026-10-19 §7 Stage 3 "Discover = My plugins"): the
// five listings (the Lunhui modules' since the module cards spec §5.1), each alone; the Gravit item's three reads, each
// alone; a skill's content; the agent writes; the one roster (one-entry plan 4), read with the listings, and its
// Available to Gravit switch. Impure; nothing here draws. A plain read joins the shelf's flight, a read
// after a write starts a fresh one, and only the latest-started read of a shelf lands.
import { botSettingsPayload, botModelChoices, normalizeBotModel } from '../wire/botSettings.js';
import { proposeBotId } from '../wire/botId.js';
import { said } from '../i18n/words.js';

export const SHELF_PATHS = Object.freeze({ plugins: '/data/plugins.json', bots: '/data/bots.json', agents: '/data/agents.json', memory: '/data/memory.json', modules: '/data/modules.json' });
export const ROSTER_PATH = '/data/roster.json';
const ROSTER_SWITCH = '/data/roster';
export const GRAVIT_KEYS = Object.freeze(['DEEPSEEK_API_KEY']); // en-kept: an environment variable's name

const VALID = {
  plugins: d => Array.isArray(d?.mcp),
  bots: d => Array.isArray(d?.bots),
  agents: d => Array.isArray(d?.local),
  memory: d => Array.isArray(d?.groups),
  modules: d => Array.isArray(d?.channels),
};
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const words = err => err?.code ?? err?.said ?? err?.message ?? said('discover.failed');
// an agent write that failed, in words: the write's name, then why
const writeFailed = (what, reason) => (what === 'connect' ? said('discover.fail.connect', { reason })
  : what === 'disconnect' ? said('discover.fail.disconnect', { reason }) : said('discover.fail.rescan', { reason }));

export function startDiscover({ store, getJson, postJson, call, now = Date.now }) {
  const flights = new Map(); // shelf → its read in flight
  const seqs = {};           // shelf → the latest-started read

  function read(shelf, { fresh = false } = {}) {
    if (!fresh && flights.has(shelf)) return flights.get(shelf);
    const mine = (seqs[shelf] = (seqs[shelf] ?? 0) + 1);
    store.dispatch('shelfLoading', { shelf });
    const p = Promise.resolve()
      .then(() => getJson(SHELF_PATHS[shelf]))
      .then(data => {
        if (!VALID[shelf](data)) throw new Error(`${SHELF_PATHS[shelf]}: malformed`); // en-kept: an error the catch below drops, never on screen
        if (mine === seqs[shelf]) store.dispatch('shelfLoaded', { shelf, data, at: now() });
      })
      .catch(() => { if (mine === seqs[shelf]) store.dispatch('shelfFailed', { shelf, at: now() }); })
      .finally(() => { if (flights.get(shelf) === p) flights.delete(shelf); });
    flights.set(shelf, p);
    return p;
  }

  // the one roster, read as a shelf is: a plain read joins the one in flight, and only the latest-started read or switch
  // lands; a failed read keeps the lists it had
  let rosterSeq = 0;
  let rosterFlight = null;
  function readRoster({ fresh = false } = {}) {
    if (!fresh && rosterFlight) return rosterFlight;
    const mine = ++rosterSeq;
    const p = Promise.resolve()
      .then(() => getJson(ROSTER_PATH))
      .then(data => { if (mine === rosterSeq) store.dispatch('rosterLoaded', data); })
      .catch(() => { if (mine === rosterSeq) store.dispatch('rosterFailed'); })
      .finally(() => { if (rosterFlight === p) rosterFlight = null; });
    rosterFlight = p;
    return p;
  }

  // a switch: on is the flip of what the roster says; the answer is the roster as written. A roster the page could not
  // read posts nothing (its switches are drawn disabled); a refusal leaves the switch as it was, its words on the line
  async function toggleAvailable(kind, id) {
    const roster = store.get().discover.roster;
    if (roster?.status !== 'ready' || (kind !== 'agent' && kind !== 'bot') || typeof id !== 'string' || id === '') return false;
    const on = !(kind === 'bot' ? roster.bots : roster.agents).includes(id);
    let answer;
    try {
      answer = await postJson(ROSTER_SWITCH, { kind, id, on });
    } catch (err) {
      store.dispatch('discoverStatus', { line: said('discover.fail.available', { reason: words(err) }), bad: true });
      return false;
    }
    rosterSeq += 1;
    store.dispatch('rosterLoaded', answer);
    store.dispatch('discoverStatus', { line: null });
    return true;
  }

  const load = () => Promise.all([...Object.keys(SHELF_PATHS).map(shelf => read(shelf)), readRoster()]).then(() => {});

  // the old main-agent page's three cards: the host, the default model selection, the keys — each failing alone
  async function gravit() {
    const [host, catalog, keys] = await Promise.allSettled([
      Promise.resolve().then(() => getJson('/data/host.json')),
      Promise.resolve().then(() => call('session/modelCatalog', {})),
      Promise.resolve().then(() => call('credentials/describe', { refs: [...GRAVIT_KEYS] })),
    ]);
    store.dispatch('gravitLoaded', {
      host: host.status === 'fulfilled' && object(host.value) ? host.value : false,
      model: catalog.status === 'fulfilled' && object(catalog.value) ? (object(catalog.value.default) ? catalog.value.default : null) : false,
      keys: keys.status === 'fulfilled' && object(keys.value) ? keys.value : false,
    });
  }

  const skillFlights = new Set();
  async function skill(name) {
    if (typeof name !== 'string' || name === '' || skillFlights.has(name) || store.get().discover.skills?.[name]?.status === 'ready') return;
    skillFlights.add(name);
    store.dispatch('skillLoading', { name });
    try {
      store.dispatch('skillLoaded', { name, detail: await postJson('/data/memory/skill', { name }) });
    } catch {
      store.dispatch('skillFailed', { name });
    } finally {
      skillFlights.delete(name);
    }
  }

  // connect, disconnect, rescan: the write, then the agents listing again (rescan answers the listing itself)
  async function agentWrite(path, body, what) {
    let answer;
    try {
      answer = await postJson(path, body);
    } catch (err) {
      store.dispatch('discoverStatus', { line: writeFailed(what, words(err)), bad: true });
      return false;
    }
    store.dispatch('discoverStatus', { line: null });
    if (what === 'rescan' && VALID.agents(answer)) {
      seqs.agents = (seqs.agents ?? 0) + 1;
      store.dispatch('shelfLoaded', { shelf: 'agents', data: answer, at: now() });
    } else {
      await read('agents', { fresh: true });
    }
    return true;
  }
  const connect = bin => agentWrite('/data/agents/connect', { bin }, 'connect');
  const disconnect = bin => agentWrite('/data/agents/disconnect', { bin }, 'disconnect');
  const rescan = () => agentWrite('/data/agents/rescan', {}, 'rescan');

  // the model routes a bot may name: session/modelCatalog's groups, read once
  let models = null;
  function modelChoices() {
    models ??= Promise.resolve()
      .then(() => call('session/modelCatalog', {}))
      .then(catalog => botModelChoices(catalog), () => [])
      .then(choices => { store.dispatch('modelsLoaded', { choices }); return choices; });
    return models;
  }

  // a bot's settings, checked against the revision the page was drawn from: a stale revision is refused by the face
  // ("changed since this view was loaded") and the bots are read again; a save the face kept but could not re-declare
  // counts as saved, its words on Discover's line
  async function saveBot(bot, fields) {
    let payload;
    try {
      payload = botSettingsPayload(bot, fields);
    } catch (err) {
      store.dispatch('discoverStatus', { line: err?.said ?? err?.message ?? said('discover.fail.save', { reason: said('discover.failed') }), bad: true });
      return 'failed';
    }
    try {
      await postJson('/data/bots/settings', payload);
      store.dispatch('discoverStatus', { line: null });
      await read('bots', { fresh: true });
      return 'saved';
    } catch (err) {
      const why = words(err);
      const text = typeof why === 'string' ? why : '';
      if (err?.status === 409 && /changed since this view was loaded/.test(text)) {
        store.dispatch('discoverStatus', { line: said('discover.changedElsewhere'), bad: true });
        await read('bots', { fresh: true });
        return 'stale';
      }
      if (err?.status === 500 && /^bots\/\S+ was saved, but/.test(text)) {
        store.dispatch('discoverStatus', { line: why, bad: true });
        await read('bots', { fresh: true });
        return 'saved';
      }
      store.dispatch('discoverStatus', { line: said('discover.fail.save', { reason: why }), bad: true });
      return 'failed';
    }
  }

  // a new bot: blank fields left out (the face proposes the id from the name and fills the soul from its template);
  // a name with no ASCII letters proposes no id, so it needs one before anything is posted
  async function createBot({ name, id, description, model, soul }) {
    const clean = v => (typeof v === 'string' ? v.trim() : '');
    const n = clean(name);
    const i = clean(id);
    if (!n && !i) return { error: said('discover.bot.giveName') };
    if (!i && proposeBotId(n) === '') return { error: said('discover.bot.giveId') };
    let route;
    try {
      route = normalizeBotModel(typeof model === 'string' ? model : '');
    } catch (err) {
      return { error: err?.said ?? err?.message ?? said('discover.bot.useRoute') };
    }
    const body = {
      ...(n ? { name: n } : {}), ...(i ? { id: i } : {}), ...(clean(description) ? { description: clean(description) } : {}),
      ...(route ? { model: route } : {}), ...(typeof soul === 'string' && soul.trim() !== '' ? { soul } : {}),
    };
    try {
      const made = await postJson('/data/bots', body);
      await read('bots', { fresh: true });
      // the face answers {ok, bot: <the new row>} (src/bots.ts declared())
      const id = made?.bot?.id;
      return typeof id === 'string' ? id : { error: said('discover.bot.notListed') };
    } catch (err) {
      return { error: words(err) };
    }
  }

  return { load, read, readRoster, toggleAvailable, gravit, skill, connect, disconnect, rescan, modelChoices, saveBot, createBot };
}
