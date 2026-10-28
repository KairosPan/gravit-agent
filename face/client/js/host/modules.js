// face/client/js/host/modules.js — a Lunhui module's page from the face (module cards spec §5.3): the latest run's
// artifact, read through the overview of that run's channel (POST /data/channels/overview, as host/channels.js posts
// it). Impure; nothing here draws. The listing is Discover's modules listing (host/discover.js), the run picked by
// modules-view's latestOf; the overview's latestRun holds the json only when it is that same run. One read per page
// entered, and only the latest-started read of a module lands.
import { latestOf } from './modules-view.js';

export function startModules({ store, postJson, readListing }) {
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

  return { latestArtifact };
}
