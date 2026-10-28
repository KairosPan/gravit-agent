// face/client/js/reducers/run-sheet.js — a module card's Run sheet (module cards spec §5.4): the slice the host
// recomputes whole on every field (host/run-sheet.js), what it said, and the Runs this page sent, by module (§5.7).
import { closeOverlays } from './messages.js';

const sheet = (s, patch) => (s.runSheet ? { ...s, runSheet: { ...s.runSheet, ...patch } } : s);
const runs = s => (s.moduleRuns && typeof s.moduleRuns === 'object' ? s.moduleRuns : {});

export const reducers = {
  // the sheet over whatever is open, the other drawers closed as a new message closes them
  runSheetOpen: (s, value) => ({ ...closeOverlays(s), runSheet: value }),
  runSheetSet: (s, value) => (s.runSheet ? { ...s, runSheet: value } : s),
  runSheetSaid: (s, { line } = {}) => sheet(s, { said: typeof line === 'string' && line !== '' ? line : null }),
  runSheetClose: s => ({ ...s, runSheet: null }),
  moduleRunStarted: (s, { module, sessionId, title, startedAt }) => ({ ...s, moduleRuns: { ...runs(s), [module]: { sessionId, title, startedAt } } }),
  moduleRunCleared: (s, { module }) => {
    if (!(module in runs(s))) return s;
    const { [module]: _gone, ...rest } = runs(s);
    return { ...s, moduleRuns: rest };
  },
  moduleRunsLoaded: (s, { runs: loaded } = {}) => ({ ...s, moduleRuns: loaded && typeof loaded === 'object' && !Array.isArray(loaded) ? loaded : {} }),
};
