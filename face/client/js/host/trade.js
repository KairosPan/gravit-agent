// face/client/js/host/trade.js — Trade's impure half (spec 2026-10-22 §6.4, plan 2 Task 10): the owner's hand order through the
// Account's own ticket. The kinds' picks reads through the face's proxy (explore?tab=<kind>&limit=12) on screen and every 20 s,
// one flight per kind; the trade search's own read (explore?q=); a pick opening the ticket and the order sheet (host/sheet.js)
// on the line the view rules (the one given where it takes the order, else the best able one), that line followed on the
// Account's stream, a venue change re-seeding the sheet with its fields kept and re-following; a quote frame for the followed
// line preparing again, quietly, once the shown quote is FRESH_MS old; a fill frame said; the one-click Cancel through the
// owner device. The words are the views' (trade-view.js, owner-view.js); nothing here touches the DOM, and nothing lands after
// close().
import { ticketOf, fillWords } from './trade-view.js';
import { refusedAt, refusalOf, saidOf } from './owner-view.js';
import { FRESH_MS } from './sheet.js';

export { FRESH_MS };
export const PICKS_MS = 20_000, PICK_LIMIT = 12;

const EXPLORE = '/data/account/explore';
const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const blank = q => typeof q !== 'string' || !q.trim();
// the Account's sentence when it refuses (`refusal.message`), else its error words — only when they are text
const words = v => (typeof v === 'string' && v.trim() !== '' ? v : null);
const messageOf = body => words(body?.refusal?.message) ?? words(body?.error);
const answered = body => body?.ok === true && Array.isArray(body.items);
// the stream's key for a ticket's line at a venue: the able line there, `<venue>:<symbol>`, or none
function keyOf(ticket, venue) {
  const leg = Array.isArray(ticket?.legs) ? ticket.legs.find(l => l.able && l.venue === venue) : undefined;
  return leg ? `${leg.venue}:${leg.symbol}` : null;
}

export function startTrade({ store, getJson, owner, sheet, stream, schedule, cancelTimer, now = Date.now, afterAction = () => {} }) {
  let closed = false;
  let shown = false;
  let pollTimer = null;
  let followed = null;       // the ticket's line on the stream, `<venue>:<symbol>`, or null
  let refreshing = false;    // a quiet re-prepare for a moved quote is in the air
  const cancelling = new Set();   // the cancels in the air, `<venue>|<order>`
  const kinds = new Map();   // a kind of read → { flight, path, seq }

  // One flight per kind of read (markets.js's rule): an ask for the path in the air joins it; another path starts a read whose
  // answer alone lands; nothing lands after close().
  function fly(kind, path, land, loading) {
    if (closed) return;
    let k = kinds.get(kind);
    if (!k) { k = { flight: null, path: null, seq: 0 }; kinds.set(kind, k); }
    if (k.flight !== null && k.path === path) return;
    const mine = ++k.seq;
    let asked;
    try { asked = Promise.resolve(getJson(path)); } catch (error) { asked = Promise.reject(error); }
    const flight = asked
      .then(body => { if (!closed && mine === k.seq) land(body, false); }, error => { if (!closed && mine === k.seq) land(error?.body, true); })
      .finally(() => { if (k.flight === flight) { k.flight = null; k.path = null; } });
    k.flight = flight;
    k.path = path;
    store.dispatch(...loading);
  }
  function drop(kind) { const k = kinds.get(kind); if (k) { k.seq += 1; k.flight = null; k.path = null; } }

  // the picks of the kind Trade is on
  function readPicks() {
    const kind = store.get().trade.kind;
    fly(`picks:${kind}`, `${EXPLORE}?tab=${encodeURIComponent(kind)}&limit=${PICK_LIMIT}`, (body, refused) => {
      if (!refused && answered(body)) store.dispatch('picksLoaded', { kind, data: body, at: now() });
      else store.dispatch('picksFailed', { kind, at: now(), message: messageOf(body) });
    }, ['picksLoading', { kind }]);
  }

  function armPoll() {
    pollTimer = schedule(() => { pollTimer = null; if (closed || !shown) return; armPoll(); readPicks(); }, PICKS_MS);
  }
  function stopPoll() {
    if (pollTimer !== null) { cancelTimer(pollTimer); pollTimer = null; }
  }

  // the stream follows the ticket's line, or nothing
  function follow(key) {
    if (key === followed) return;
    followed = key;
    stream.follow(key ? [key] : []);
  }
  function release() {
    followed = null;
    stream.follow([]);
  }

  // the order sheet seeded with the ticket as the view rules it now, on the given fields; the line they name followed
  function seed(id, fields) {
    const ticket = ticketOf(store.get(), now());
    follow(keyOf(ticket, fields.venue));
    return sheet.open('order', { id, ticket }, fields);
  }

  return {
    /** Trade on screen in a visible tab, or not: the picks read and its poll run only while it is. */
    show(on) {
      if (closed) return;
      const next = Boolean(on);
      if (next === shown) return;
      shown = next;
      if (!shown) { stopPoll(); return; }
      armPoll();
      readPicks();
    },
    /** The kind Trade is on: its picks at once, the poll over from now. A kind Trade does not have changes nothing. */
    kind(k) {
      if (closed) return;
      store.dispatch('tradeKind', k);
      if (store.get().trade.kind !== k) return;
      if (shown) { stopPoll(); armPoll(); }
      readPicks();
    },
    /** The query typed (app.js debounces it): the trade search's read, the latest one lands; a blank one reads nothing and
     *  drops the one in the air. */
    query(raw) {
      if (closed) return;
      const q = typeof raw === 'string' ? raw : '';
      store.dispatch('tradeQuery', q);
      if (blank(q)) { drop('results'); return; }
      fly('results', `${EXPLORE}?q=${encodeURIComponent(q.trim())}&limit=${PICK_LIMIT}`, (body, refused) => {
        if (!refused && answered(body)) store.dispatch('tradeResultsLoaded', { data: body, at: now() });
        else store.dispatch('tradeResultsFailed', { at: now(), message: messageOf(body) });
      }, ['tradeResultsLoading']);
    },
    /** A market picked: the ticket open on it and the order sheet seeded — at the venue given where it takes the order, else
     *  the best able line — with nothing typed; that line followed. Resolves as the sheet's open does. */
    pick(id, { side = 'buy', venue = null, outcome = 0 } = {}) {
      if (closed) return undefined;
      store.dispatch('ticketOpen', { id, side, venue, outcome });
      const open = store.get().trade.ticket;
      if (!open || open.id !== id) return undefined;
      const ticket = ticketOf(store.get(), now());
      return seed(id, {
        venue: ticket?.venue ?? '', side: open.side, outcome: String(open.outcome),
        amount: '', unit: 'usd', orderType: 'market', limit: '', extendedHours: false,
      });
    },
    /** The venue field changed (after `sheet.change('venue', id)`): the sheet seeded again with its fields kept, the new line
     *  followed. Nothing while no ticket's sheet is open, or while it is signing. */
    venue(id) {
      if (closed) return undefined;
      const open = store.get().trade.ticket;
      const s = store.get().sheet;
      if (!open || !s || s.kind !== 'order' || s.status === 'signing' || !isRecord(s.fields)) return undefined;
      return seed(open.id, { ...s.fields, venue: id });
    },
    /** The ticket closed: the sheet with it, the follow released. */
    closeTicket() {
      if (closed) return;
      store.dispatch('ticketClose');
      sheet.close();
      release();
    },
    /** One click: the Account's liveCancel through the owner device, once while it is in the air; its answer said, and the
     *  reads after an action told when it was taken (the Account changed, even after close). */
    async cancel(venue, order) {
      if (closed) return;
      const key = `${venue}|${order}`;
      if (cancelling.has(key)) return;
      cancelling.add(key);
      let r;
      try { r = await owner.act({ type: 'liveCancel', venue, order }); } catch { r = null; } finally { cancelling.delete(key); }
      const refused = refusedAt(r);
      if (!closed) store.dispatch('tradeSaid', refused ? refusalOf(r).message : saidOf(r.body));
      if (!refused) afterAction('cancel', r.body);
    },
    /** A stream event: a quote for the followed line, while the shown preparation is ready and FRESH_MS old, prepares again
     *  quietly (one at a time); a fill is said. */
    onStreamEvent(ev) {
      if (closed || !isRecord(ev)) return;
      if (ev.type === 'quote') {
        const d = ev.data;
        if (!isRecord(d) || followed === null) return;
        const key = typeof d.key === 'string' && d.key ? d.key : `${d.venue}:${d.symbol}`;
        if (key !== followed || refreshing) return;
        const s = store.get().sheet;
        if (!s || s.kind !== 'order' || s.status !== 'ready' || !Number.isFinite(s.preparedAt) || now() - s.preparedAt < FRESH_MS) return;
        refreshing = true;
        Promise.resolve(sheet.prepareNow({ quiet: true })).catch(() => null).finally(() => { refreshing = false; });
      } else if (ev.type === 'fill') {
        const said = fillWords(ev.data);
        if (said) store.dispatch('tradeSaid', said);
      }
    },
    /** The poll stopped and the follow released; nothing is read, followed or landed after. */
    close() {
      if (closed) return;
      closed = true;
      stopPoll();
      for (const kind of kinds.keys()) drop(kind);
      if (followed !== null) release();
    },
  };
}
