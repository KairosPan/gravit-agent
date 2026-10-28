// face/client/js/host/run-sheet.js — a module card's Run sheet from the face (module cards spec §4 G6, §5.4–§5.5): open it
// from the modules listing, recompute it on every field against the listing as it stands, and Run it as one new
// conversation in the chosen channel — the client's own newConversation (session/create, session/rename, the prompt),
// nothing else. Impure; nothing here draws (render/run-sheet.js), every word is the view's (host/run-sheet-view.js).
import { newSheet, sheetOf, titleOf, messageOf } from './run-sheet-view.js';

const FAILED = "Couldn't send — the conversation may exist untitled in the channel";
const OWN_FIELDS = ['cites', 'stocks', 'note'];

const channelOf = (listing, name) => (Array.isArray(listing?.channels) ? listing.channels.find(c => c?.channel === name) ?? null : null);
// the channel's newest run as the listing holds it now, the run a Latest run pick is stamped with
const newestRunOf = (listing, name) => {
  const runs = channelOf(listing, name)?.runs;
  return Array.isArray(runs) && typeof runs[0]?.run === 'string' ? runs[0].run : null;
};

export function startRunSheet({ store, actions, readListing, go, now = Date.now }) {
  let sending = false; // a Run in the air: a second press sends nothing

  async function read() {
    try { return await readListing(); } catch { return null; } // the shelf's own line says why
  }

  async function open(module) {
    const listing = await read();
    const sheet = newSheet(listing, module);
    if (!sheet) { store.dispatch('discoverStatus', { line: 'Not a module', bad: true }); return; }
    store.dispatch('runSheetOpen', sheet);
  }

  // Where gives the new channel's picks, Stocks and Note kept; On stamps the channel's newest run; the rest set alone.
  // What was said goes with any change
  async function field(name, value) {
    const listing = await read();
    const cur = store.get().runSheet;
    if (!cur) return;
    let next;
    if (name === 'where') {
      const picked = newSheet(listing, cur.module, value);
      if (!picked) return;
      next = { ...picked, stocks: cur.stocks, note: cur.note };
    } else if (name === 'on') next = { ...cur, on: value, run: newestRunOf(listing, cur.where) };
    else if (OWN_FIELDS.includes(name)) next = { ...cur, [name]: value };
    else return;
    store.dispatch('runSheetSet', { ...next, said: null });
  }

  function close() {
    store.dispatch('runSheetClose');
  }

  async function run() {
    if (sending) return;
    sending = true;
    try {
      const listing = await read();
      const sheet = store.get().runSheet;
      if (!sheet) return;
      const at = now();
      const view = sheetOf(listing, sheet, at);
      if (!view?.canRun) { store.dispatch('runSheetSaid', { line: view?.blocker ?? 'choose where to run' }); return; }
      const workspaceId = channelOf(listing, sheet.where)?.workspaceId;
      if (typeof workspaceId !== 'string' || !workspaceId) { store.dispatch('runSheetSaid', { line: 'choose where to run' }); return; }
      const title = titleOf(listing, sheet, at);
      const id = await actions.newConversation({ title, workspaceId, text: messageOf(listing, sheet) });
      if (!id) { store.dispatch('runSheetSaid', { line: FAILED }); return; }
      store.dispatch('moduleRunStarted', { module: sheet.module, sessionId: id, title, startedAt: at });
      store.dispatch('runSheetClose');
      await go({ screen: 'messages', id });
    } finally {
      sending = false;
    }
  }

  return { open, field, close, run };
}
