// The Memory screen's fixtures (memory screen plan Task 2): the four reads' bodies as the face answers them
// (src/memory-screen.ts, src/memory-screen-routes.ts) - each `ok: true` and connected, or `ok: true` and not connected with
// the words that say so and the command that makes the home - for the host's, the renderer's and the corpus' states.

const HOME = '/srv/owner/memory';

export const memoryNotConnected = (over = {}) => ({
  ok: true, connected: false, why: 'no home', say: 'no memory here: run gravit-memory init', command: `npx --no gravit-memory init --home ${HOME}`, ...over,
});

export const memoryLessons = (over = {}) => ({ ok: true, connected: true, ownerChainBroken: false, lessons: [], ...over });

// the lessons read's rows (src/memory-screen.ts LessonRow): a card, its text as a file holds it, its record, what it checks and
// the commands its state allows, each built for the home above
const cmd = words => `npx --no gravit-memory ${words} --home ${HOME}`;
const RETIRE = id => cmd(`retire ${id} --reason "…"`);

export const lessonCard = (id, over = {}) => ({
  id, says: 'dont', actions: ['buy', 'add'], strength: 'caveat', scope: { market: ['US'] },
  check: [{ fact: 'change_5d_pct', op: '>', value: 8 }, { fact: 'sector', op: '==', value: 'semis' }],
  facts: { sector: 'The sector the owner files the name under.' },
  words: 'Do not chase a name up eight percent in five sessions', ...over,
});

const fileOf = card => `---\nid: ${card.id}\nsays: ${card.says}\nstrength: ${card.strength}\n---\n${card.words}\n`;
export const lessonText = (card, over = {}) => ({ sha256: 'a'.repeat(64), text: fileOf(card), card, ...over });

export const LESSON_CHECKS = [
  { fact: 'change_5d_pct', definition: "The last price over the close 5 full sessions before the last full one, in percent, from the Market's daily bars.", face: true },
  { fact: 'sector', definition: 'The sector the owner files the name under.', face: false },
];

const figure = (k, change) => ({ k, change_pct: change, vs_benchmark_pct: null });
export const lessonCase = (decision, date, symbol, action, figures) => ({ decision, date, symbol, action, figures });

export const lessonRecord = (over = {}) => ({
  owner: { fired: 6, followed: 4, overridden: 1, seen: 6, backfilled: 0, no_decision: 1 },
  agents: { followed: 0, overridden: 0, seen: 0 },
  followed: [
    lessonCase('d-20261103-0a1b2c3d', '2026-11-03', 'NVDA', 'pass', [figure(5, 3.4), figure(20, -1.5)]),
    lessonCase('d-20261105-1b2c3d4e', '2026-11-05', 'AMD', 'pass', [figure(5, 2.75)]),
  ],
  overridden: [lessonCase('d-20261107-2c3d4e5f', '2026-11-07', 'SMCI', 'buy', [figure(5, -4.1)])],
  backfilled: [],
  medians: { followed: { 5: 3.2 }, overridden: {} },
  ...over,
});

export const armedLesson = (over = {}) => {
  const card = lessonCard('no-chasing');
  return {
    id: 'no-chasing', state: 'armed', armedAt: '2026-11-14T15:00:00.000Z', armed: lessonText(card), file: lessonText(card),
    record: lessonRecord(), checks: LESSON_CHECKS, commands: { retire: RETIRE('no-chasing') }, ...over,
  };
};

export const changedLesson = (over = {}) => {
  const was = lessonCard('trim-into-strength', { says: 'do', actions: ['trim'], strength: 'caveat', words: 'Trim a third into a gap up', check: [], facts: undefined });
  const now = { ...was, words: 'Trim a half into a gap up' };
  return {
    id: 'trim-into-strength', state: 'changed', armedAt: '2026-11-10T15:00:00.000Z',
    armed: lessonText(was), file: lessonText(now, { sha256: 'b'.repeat(64) }), record: lessonRecord({ followed: [], overridden: [], medians: { followed: {}, overridden: {} } }),
    checks: [], commands: { arm: cmd('arm trim-into-strength'), retire: RETIRE('trim-into-strength'), review: cmd('review') }, ...over,
  };
};

export const unarmedLesson = (over = {}) => {
  const card = lessonCard('add-below-stop', { says: 'dont', actions: ['add'], scope: { market: ['US'], symbols: ['TSLA'] }, words: 'Never add below the stop', check: [], facts: undefined });
  return { id: 'add-below-stop', state: 'unarmed', file: lessonText(card), record: null, checks: [], commands: { arm: cmd('arm add-below-stop') }, ...over };
};

export const retiredLesson = (over = {}) => {
  const card = lessonCard('gap-fade', { says: 'careful', actions: ['short'], scope: undefined, words: 'Fade a gap only with the tape', check: [], facts: undefined });
  return { id: 'gap-fade', state: 'retired', file: lessonText(card), record: null, checks: [], commands: { arm: cmd('arm gap-fade') }, ...over };
};

export const refusedLesson = (over = {}) => ({
  id: 'size-cap', state: 'refused', fault: 'card size-cap cannot be armed: its words are empty',
  file: { sha256: 'c'.repeat(64), text: '---\nid: size-cap\n---\n', fault: 'card size-cap cannot be armed: its words are empty' },
  record: null, checks: [], commands: {}, ...over,
});

export const brokenLesson = (over = {}) => {
  const card = lessonCard('earnings-hold', { says: 'careful', actions: ['hold'], scope: undefined, words: 'Hold no size through a print', check: [], facts: undefined });
  return {
    id: 'earnings-hold', state: 'broken', fault: 'card earnings-hold cannot be read: lessons/earnings-hold.md is a directory, not a card file.',
    armedAt: '2026-11-02T15:00:00.000Z', armed: lessonText(card), record: null, checks: [], commands: { retire: RETIRE('earnings-hold') }, ...over,
  };
};

export const memoryReseal = cmd('reseal');

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

// the decisions read's rows (src/memory-screen.ts DecisionRow): the package's view of a decision - its line, its amends and
// what they make of it - with what followed at each horizon, and the void command for one that is not void; each decided at
// the middle of a UTC day, so it reads one day in every zone from UTC-11 to UTC+11
const DECIDED = '2026-11-12T12:00:00.000Z';
export const decisionRow = (id, line = {}, { figures = [], ...view } = {}) => {
  const v = {
    line: { v: 1, kind: 'decision', id, seq: 1, prev: null, t: DECIDED, by: 'gravit-face', sum: 'd'.repeat(64), action: 'buy', whose: 'owner', thesis: 'The print beat and the outlook held', ...line },
    amends: [], void: false, open: true, reviewed: false, decidedMs: Date.parse(line.t ?? DECIDED), ...view,
  };
  return v.void ? { view: v, figures } : { view: v, figures, command: cmd(`void ${id} --reason "…"`) };
};

// an owner's decision with figures, an agent's reviewed, a void one, and an agent's backfilled with no symbol
export const memoryDecisionRows = () => [
  decisionRow('d-20261114-0a1b2c3d', { t: '2026-11-14T12:00:00.000Z', symbol: 'NVDA', market: 'US', action: 'buy', whose: 'owner', thesis: 'The data-centre outlook was raised', wrong_if: 'it closes under the gap', words: 'I buy the gap, small' },
    { figures: [{ k: 5, change_pct: 3.2, vs_benchmark_pct: 1.1 }, { k: 20, change_pct: -0.4, vs_benchmark_pct: null }, { k: 60, change_pct: null, vs_benchmark_pct: null }] }),
  decisionRow('d-20261113-1b2c3d4e', { t: '2026-11-13T12:00:00.000Z', by: 'gravit', symbol: 'AMD', market: 'US', action: 'pass', whose: 'agent', thesis: 'The read-through is priced in' }, { open: false, reviewed: true }),
  decisionRow('d-20261112-2c3d4e5f', { t: '2026-11-12T12:00:00.000Z', symbol: 'NVDA', market: 'US', action: 'add', whose: 'owner', thesis: 'Add on the retest' }, { void: true, open: false }),
  decisionRow('d-20261111-3d4e5f6a', { t: '2026-11-11T12:00:00.000Z', by: 'gravit', action: 'hold', whose: 'agent', thesis: 'Hold the book through the print', backfilled: true }, { open: false }),
];

// the waiting read's proposals as the package keeps them: a new card, a change to one and a retire
export const proposalCard = (id, over = {}) => ({
  id, says: 'dont', actions: ['buy'], strength: 'red-line', scope: { market: ['US'] },
  check: [{ fact: 'change_1d_pct', op: '>=', value: 6 }, { fact: 'session', op: 'in', value: ['open', 'pre'] }],
  facts: { session: 'The part of the trading day the order is placed in.' },
  words: 'Do not buy a gap up of six percent on the open', ...over,
});

const proposalLine = (id, seq, body) => ({ v: 1, kind: 'proposal', id, seq, prev: null, t: '2026-11-15T12:00:00.000Z', by: 'gravit', sum: 'f'.repeat(64), ...body });
export const memoryWaitingProposals = () => [
  proposalLine('p-20261115-0a1b2c3d', 1, { what: 'new', lesson: 'chase-gap', card: proposalCard('chase-gap'),
    reason: 'Two gap-up buys on the open gave back their gain by noon', evidence: ['d-20261103-0a1b2c3d', 'd-20261105-1b2c3d4e'] }),
  proposalLine('p-20261115-1b2c3d4e', 2, { what: 'change', lesson: 'no-chasing',
    card: proposalCard('no-chasing', { strength: 'caveat', check: [{ fact: 'change_5d_pct', op: '>', value: 10 }], facts: undefined, words: 'Do not chase a name up ten percent in five sessions' }),
    reason: 'Eight percent fired on names that kept going', evidence: ['d-20261107-2c3d4e5f'] }),
  proposalLine('p-20261115-2c3d4e5f', 3, { what: 'retire', lesson: 'gap-fade', reason: 'It has not fired in a year' }),
];

// the face's seven facts (src/memory-facts.ts FACE_FACTS) and the five commands the Health tab lists, for the home above
export const FACE_FACT_ROWS = [
  { fact: 'price', definition: "The last price, to two decimals, from the Market's quote." },
  { fact: 'change_1d_pct', definition: "The last price over the previous close, in percent, both from the Market's quote." },
  { fact: 'change_5d_pct', definition: "The last price over the close 5 full sessions before the last full one, in percent, from the Market's daily bars." },
  { fact: 'change_20d_pct', definition: "The last price over the close 20 full sessions before the last full one, in percent, from the Market's daily bars." },
  { fact: 'change_60d_pct', definition: "The last price over the close 60 full sessions before the last full one, in percent, from the Market's daily bars." },
  { fact: 'held', definition: "Whether the venue's account holds the symbol, from the Account's position on that venue." },
  { fact: 'unrealized_pct', definition: "A long's last price over its entry price, in percent, from the Market's quote and the Account's entry price; none for a short." },
];
export const HEALTH_COMMANDS = ['status', 'verify', 'reconcile', 'review', 'reseal'].map(name => ({ name, line: cmd(name) }));

// a home with every ledger, the owner's chain broken at its fourth line and the recalls' last line partial
export const memoryHealthFull = (over = {}) => memoryHealth({
  lines: { 'decisions.jsonl': 12, 'recalls.jsonl': 40, 'outcomes.jsonl': 31, 'proposals.jsonl': 3, 'owner.jsonl': 5 },
  partial: ['recalls.jsonl'],
  chains: [{ file: 'decisions.jsonl', ok: true }, { file: 'recalls.jsonl', ok: true }, { file: 'outcomes.jsonl', ok: true }, { file: 'proposals.jsonl', ok: true }, { file: 'owner.jsonl', ok: false, line: 4 }],
  prices: { url: 'http://127.0.0.1:4821', last: { t: '2026-11-16T12:00:00.000Z', ok: true, refused: 1, asked: 6 } },
  facts: FACE_FACT_ROWS, commands: HEALTH_COMMANDS, ...over,
});
