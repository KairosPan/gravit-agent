// The Memory screen's fixtures (memory screen plan Task 2): the four reads' bodies as the face answers them
// (src/memory-screen.ts, src/memory-screen-routes.ts) - each `ok: true` and connected, or `ok: true` and not connected with
// the words that say so and the command that makes the home - for the host's, the renderer's and the corpus' states.

const HOME = '/srv/owner/memory';

export const memoryNotConnected = (over = {}) => ({
  ok: true, connected: false, why: 'no home', say: 'no memory here: run gravit-memory init', command: `npx --no gravit-memory init --home ${HOME}`, ...over,
});

export const memoryLessons = (over = {}) => ({ ok: true, connected: true, ownerChainBroken: false, lessons: [], ...over });

export const memoryDecisions = (over = {}) => ({ ok: true, connected: true, items: [], more: false, ...over });

const proposal = (id, lesson, reason) => ({ id, t: '2026-11-15T14:00:00.000Z', by: 'gravit', kind: 'proposal', what: 'new', lesson, reason });

export const memoryProposals = () => [
  proposal('p-20261115-0a1b2c3d', 'chase-gap', 'Two gap-up buys on the open gave back their gain by noon'),
  proposal('p-20261115-1b2c3d4e', 'add-on-weakness', 'An add below the stop deepened the loss'),
];

export const memoryWaiting = (over = {}) => ({
  ok: true, connected: true, proposals: [], pastHorizon: [], withoutWrongIf: 0, command: `npx --no gravit-memory review --home ${HOME}`, ...over,
});

export const memoryHealth = (over = {}) => ({
  ok: true, connected: true, home: HOME, lines: {}, partial: [], chains: [], prices: { url: 'http://127.0.0.1:4821' }, facts: [], commands: [], ...over,
});
