// face/client/js/reducers/discover.js — Discover's store from the face (host/discover.js): the query, a listing per shelf
// (a failed read keeps what it had), the Gravit item's three cards, the skills read, a module page's latest artifact
// (host/modules.js), Discover's own line, and the one roster (one-entry plan 4): `ready` with its two lists, `corrupt` for a
// file the face cannot read (its switches drawn off and disabled), `failed` keeping the lists it had.
import { isLine } from '../i18n/words.js';

const disc = (s, patch) => ({ ...s, discover: { ...s.discover, ...patch } });
const shelf = (s, name, patch) => disc(s, { shelves: { ...s.discover.shelves, [name]: { ...(s.discover.shelves?.[name] ?? { status: 'idle', data: null, at: null }), ...patch } } });
const skillOf = (s, name, patch) => disc(s, { skills: { ...(s.discover.skills ?? {}), [name]: { ...(s.discover.skills?.[name] ?? {}), ...patch } } });
// a module's latest artifact: {status, run, json}; a re-read keeps what it had until it lands
const artifactOf = (s, module, patch) => disc(s, {
  artifacts: { ...(s.discover.artifacts ?? {}), [module]: { ...(s.discover.artifacts?.[module] ?? { status: 'idle', run: null, json: null }), ...patch } },
});

const ids = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string') : null);

export const reducers = {
  setDiscoverQuery: (s, query) => disc(s, { query: typeof query === 'string' ? query : '' }),
  shelfLoading: (s, { shelf: name }) => shelf(s, name, { status: 'loading' }),
  shelfLoaded: (s, { shelf: name, data, at }) => shelf(s, name, { status: 'ready', data, at }),
  shelfFailed: (s, { shelf: name, at }) => shelf(s, name, { status: 'failed', at: s.discover.shelves?.[name]?.at ?? at }),
  gravitLoaded: (s, { host, model, keys }) => disc(s, { gravit: { host, model, keys } }),
  skillLoading: (s, { name }) => skillOf(s, name, { status: 'loading' }),
  skillLoaded: (s, { name, detail }) => skillOf(s, name, { status: 'ready', detail }),
  skillFailed: (s, { name }) => skillOf(s, name, { status: 'failed' }),
  moduleArtifactLoading: (s, { module }) => artifactOf(s, module, { status: 'loading' }),
  moduleArtifactLoaded: (s, { module, run, json }) => artifactOf(s, module, { status: 'ready', run: run ?? null, json: json ?? null }),
  moduleArtifactFailed: (s, { module }) => artifactOf(s, module, { status: 'failed' }),
  discoverStatus: (s, { line, bad = false }) => disc(s, { status: isLine(line) ? { line, bad } : null }),
  modelsLoaded: (s, { choices }) => disc(s, { models: Array.isArray(choices) ? choices : [] }),
  // the roster's read or a switch's answer: {ok: true, agents, bots}, or {ok: false, corrupt: true}; anything else failed
  rosterLoaded: (s, data) => {
    const agents = ids(data?.agents);
    const bots = ids(data?.bots);
    if (data?.ok === true && agents && bots) return disc(s, { roster: { status: 'ready', agents, bots } });
    if (data?.corrupt === true) return disc(s, { roster: { status: 'corrupt', agents: [], bots: [] } });
    return reducers.rosterFailed(s);
  },
  rosterFailed: s => disc(s, { roster: { agents: [], bots: [], ...s.discover.roster, status: 'failed' } }),
};
