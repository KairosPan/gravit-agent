// face/client/js/reducers/discover.js — Discover's store from the face (host/discover.js): the query, a listing per shelf
// (a failed read keeps what it had), the Gravit item's three cards, the skills read, a module page's latest artifact
// (host/modules.js), and Discover's own line.
const disc = (s, patch) => ({ ...s, discover: { ...s.discover, ...patch } });
const shelf = (s, name, patch) => disc(s, { shelves: { ...s.discover.shelves, [name]: { ...(s.discover.shelves?.[name] ?? { status: 'idle', data: null, at: null }), ...patch } } });
const skillOf = (s, name, patch) => disc(s, { skills: { ...(s.discover.skills ?? {}), [name]: { ...(s.discover.skills?.[name] ?? {}), ...patch } } });
// a module's latest artifact: {status, run, json}; a re-read keeps what it had until it lands
const artifactOf = (s, module, patch) => disc(s, {
  artifacts: { ...(s.discover.artifacts ?? {}), [module]: { ...(s.discover.artifacts?.[module] ?? { status: 'idle', run: null, json: null }), ...patch } },
});

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
  discoverStatus: (s, { line, bad = false }) => disc(s, { status: typeof line === 'string' && line !== '' ? { line, bad } : null }),
  modelsLoaded: (s, { choices }) => disc(s, { models: Array.isArray(choices) ? choices : [] }),
};
