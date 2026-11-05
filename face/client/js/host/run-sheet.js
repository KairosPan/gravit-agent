// face/client/js/host/run-sheet.js — a module card's Run sheet from the face (module cards spec §4 G6, §5.4–§5.5): open it
// from the modules listing, recompute it on every field against the listing as it stands, and Run it as one new
// conversation in the chosen channel — the client's own newConversation (session/create, session/rename, the prompt),
// nothing else. Impure; nothing here draws (render/run-sheet.js), every word is the view's (host/run-sheet-view.js).
import { newSheet, sheetOf, titleOf, messageOf } from './run-sheet-view.js';
import { said } from '../i18n/words.js';

const OWN_FIELDS = ['cites', 'stocks', 'note'];

const channelOf = (listing, name) => (Array.isArray(listing?.channels) ? listing.channels.find(c => c?.channel === name) ?? null : null);
// the channel's newest run as the listing holds it now, the run a Latest run pick is stamped with
const newestRunOf = (listing, name) => {
  const runs = channelOf(listing, name)?.runs;
  return Array.isArray(runs) && typeof runs[0]?.run === 'string' ? runs[0].run : null;
};

export function startRunSheet({ store, actions, readListing, go, now = Date.now }) {
  let sending = false; // a Run in the air: a second press sends nothing
  let last = null;      // the listing as open, field or run last read it

  async function read() {
    try { last = await readListing(); } catch { last = null; } // the shelf's own line says why
    return last;
  }

  async function open(module) {
    const listing = await read();
    const sheet = newSheet(listing, module);
    if (!sheet) { store.dispatch('discoverStatus', { line: said('runSheet.notModule'), bad: true }); return; }
    store.dispatch('runSheetOpen', sheet);
    if (listing === null || typeof listing !== 'object') store.dispatch('runSheetSaid', { line: said('runSheet.unread') }); // the view blocks Run too
  }

  // Where gives the new channel's picks, Stocks and Note kept; On stamps the channel's newest run — both on the listing
  // read again; the rest set alone, on the listing last read. What was said goes with any change
  async function field(name, value) {
    const listing = name === 'where' || name === 'on' ? await read() : last;
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
      if (!view?.canRun) { store.dispatch('runSheetSaid', { line: view?.blockedBy ?? said('runSheet.chooseWhere') }); return; }
      const workspaceId = channelOf(listing, sheet.where)?.workspaceId;
      if (typeof workspaceId !== 'string' || !workspaceId) { store.dispatch('runSheetSaid', { line: said('runSheet.chooseWhere') }); return; }
      const title = titleOf(listing, sheet, at);
      const id = await actions.newConversation({ title, workspaceId, text: messageOf(listing, sheet) });
      if (!id) { store.dispatch('runSheetSaid', { line: said('runSheet.failed') }); return; }
      store.dispatch('moduleRunStarted', { module: sheet.module, sessionId: id, title, startedAt: at });
      store.dispatch('runSheetClose');
      // the record and the closed sheet stand whatever the page move does; its own line says what failed
      try { await go({ screen: 'messages', id }); } catch { /* the conversation is in the list on the next read */ }
    } finally {
      sending = false;
    }
  }

  return { open, field, close, run };
}
