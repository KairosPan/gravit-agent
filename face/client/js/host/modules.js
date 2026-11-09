// face/client/js/host/modules.js — a Lunhui module's page from the face (module cards spec §5.3): the latest run's
// artifact, read through the overview of that run's channel (POST /data/channels/overview, as host/channels.js posts
// it). Impure; nothing here draws. The listing is Discover's modules listing (host/discover.js), the run picked by
// modules-view's latestOf; the overview's latestRun holds the json only when it is that same run. One read per page
// entered, and only the latest-started read of a module lands.
// The Runs this page sent (spec §5.7, G10; one-entry plan 2): trackRuns drops a record when the task it asked Gravit for
// is done — re-reading the listing at once and once more 5 s later, a backstop for the file write — when no such task
// showed within FRESH_MS of it, or when it is an hour old, and mirrors the records to this browser's storage as a
// convenience, read back at boot; the page is right without it.
import { latestOf, FRESH_MS, MODULE_NAMES, taskOfRun } from './modules-view.js';

export const RUNS_KEY = 'gravit-face.module-runs';
const STALE_MS = 60 * 60_000;
const BACKSTOP_MS = 5000;

const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const recordOk = r => plain(r) && typeof r.title === 'string' && typeof r.startedAt === 'number' && Number.isFinite(r.startedAt);

// the records as storage keeps them, or {} when they are missing, unreadable or not of the shape
export function readRuns(storage) {
  try {
    const raw = storage?.getItem(RUNS_KEY);
    const v = raw ? JSON.parse(raw) : null;
    if (!plain(v)) return {};
    const entries = Object.entries(v);
    return entries.every(([k, r]) => MODULE_NAMES.has(k) && recordOk(r)) ? v : {};
  } catch {
    return {};
  }
}

export function startModules({ store, postJson, readListing, refreshListing = async () => {}, timers = null, storage = null, now = Date.now }) {
  const seqs = {}; // module → the latest-started read

  async function latestArtifact(module) {
    const mine = (seqs[module] = (seqs[module] ?? 0) + 1);
    let listing = null;
    try { listing = await readListing(); } catch { /* the shelf's own line says so */ }
    const latest = latestOf(listing, module);
    if (!latest || mine !== seqs[module]) return;
    const { run, workspaceId } = latest;
    store.dispatch('moduleArtifactLoading', { module });
    try {
      const data = await postJson('/data/channels/overview', { workspaceId });
      if (mine !== seqs[module]) return;
      const l = data?.body?.latestRun;
      store.dispatch('moduleArtifactLoaded', { module, run, json: l?.run === run ? l.artifacts?.[module]?.json ?? null : null });
    } catch {
      if (mine === seqs[module]) store.dispatch('moduleArtifactFailed', { module });
    }
  }

  // the listing read again; a failure is the shelf's own line
  const reread = () => { try { Promise.resolve(refreshListing()).catch(() => {}); } catch { /* the same */ } };

  let tracking = false;
  let passing = false;  // a pass dispatches; the store tells its subscribers again inside it
  let mirrored = null;  // the moduleRuns last written to storage

  function mirror(runs) {
    if (runs === mirrored) return;
    mirrored = runs;
    try { storage?.setItem(RUNS_KEY, JSON.stringify(runs ?? {})); } catch { /* storage may be unavailable: the page still runs */ }
  }

  // one pass over the records: what ended goes, the listing read again for what may have landed
  function pass(s) {
    const runs = plain(s.moduleRuns) ? s.moduleRuns : {};
    const at = now();
    const answered = s.tasks?.status !== undefined && s.tasks.status !== 'loading'; // a task is missing only once /data/tasks answered
    for (const [module, r] of Object.entries(runs)) {
      const age = at - (recordOk(r) ? r.startedAt : -Infinity);
      if (age > STALE_MS) { store.dispatch('moduleRunCleared', { module }); continue; }
      const task = taskOfRun(r, s.tasks?.items);
      if (task && task.group === 'done') {
        store.dispatch('moduleRunCleared', { module });
        reread();
        timers?.after(BACKSTOP_MS, reread);
      } else if (!task && age > FRESH_MS && answered) {
        store.dispatch('moduleRunCleared', { module });
        reread();
      }
    }
  }

  function trackRuns() {
    if (tracking) return;
    tracking = true;
    store.dispatch('moduleRunsLoaded', { runs: readRuns(storage) });
    mirrored = store.get().moduleRuns;
    store.subscribe(() => {
      if (passing) return;
      passing = true;
      try { pass(store.get()); } finally { passing = false; }
      mirror(store.get().moduleRuns);
    });
  }

  return { latestArtifact, trackRuns };
}
