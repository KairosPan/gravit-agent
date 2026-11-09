// face/client/js/host/run-sheet.js — a module card's Run sheet from the face (module cards spec §4 G6, §5.4–§5.5): open it
// from the modules listing, recompute it on every field against the listing as it stands, and Run it as one message to
// Gravit's one conversation (one-entry plan 2, spec §5.13): the module's request under a first line asking for a task
// titled exactly as the card's chip will find it — no session created. Impure; nothing here draws (render/run-sheet.js),
// every word is the view's (host/run-sheet-view.js).
import { newSheet, sheetOf, titleOf, askOf } from './run-sheet-view.js';
import { said } from '../i18n/words.js';

const OWN_FIELDS = ['cites', 'stocks', 'note'];

// the channel's newest run as the listing holds it now, the run a Latest run pick is stamped with
const newestRunOf = (listing, name) => {
  const runs = (Array.isArray(listing?.channels) ? listing.channels.find(c => c?.channel === name) ?? null : null)?.runs;
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
      // the conversation as /data/tasks last named it: none while the tasks load, once it is off or unknown
      const conversation = store.get().tasks?.conversation;
      if (typeof conversation !== 'string' || !conversation) { store.dispatch('runSheetSaid', { line: said('runSheet.noConversation') }); return; }
      const title = titleOf(listing, sheet, at);
      const sent = await actions.send(askOf(listing, sheet, at), { sessionId: conversation });
      if (!sent) { store.dispatch('runSheetSaid', { line: said('runSheet.failed') }); return; }
      store.dispatch('moduleRunStarted', { module: sheet.module, title, startedAt: at });
      store.dispatch('runSheetClose');
      // the record and the closed sheet stand whatever the page move does
      try { await go({ screen: 'messages' }); } catch { /* Messages is a click away */ }
    } finally {
      sending = false;
    }
  }

  return { open, field, close, run };
}
