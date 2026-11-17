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
