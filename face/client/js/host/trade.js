// face/client/js/host/trade.js — Trade's impure half (spec 2026-10-22 §6.4, plan 2 Task 10): the owner's hand order through the
// Account's own ticket. The kinds' picks reads through the face's proxy (explore?tab=<kind>&limit=12) on screen and every 20 s,
// one flight per kind; the trade search's own read (explore?q=); a pick opening the ticket and the order sheet (host/sheet.js)
// on the line the view rules (the one given where it takes the order, else the best able one), that line — a prediction's,
// the picked outcome's — followed on the Account's stream, a venue or outcome change re-seeding the sheet with its fields kept
// and re-following; a live quote frame for the followed line preparing again, quietly, once the market moved from the top the
// shown preparation landed at (the price for the order's side) and that preparation is FRESH_MS old (the Account's own ticket, P8); a fill frame said; the
// one-click Cancel through the owner device. The words are the views' (trade-view.js, owner-view.js); nothing here touches
// the DOM, and nothing lands after close().
import { ticketOf, fillWords } from './trade-view.js';
import { refusedAt, refusalOf, saidOf } from './owner-view.js';
import { FRESH_MS, askedOf } from './sheet.js';

export { FRESH_MS };
export const PICKS_MS = 20_000, PICK_LIMIT = 12;

const EXPLORE = '/data/account/explore';
const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const blank = q => typeof q !== 'string' || !q.trim();
// the Account's sentence when it refuses (`refusal.message`), else its error words — only when they are text
const words = v => (typeof v === 'string' && v.trim() !== '' ? v : null);
const messageOf = body => words(body?.refusal?.message) ?? words(body?.error);
const answered = body => body?.ok === true && Array.isArray(body.items);
// an outcome field's index, as tradeDraftOf reads it: blank is the first
const indexOf = v => { const n = Number(v ?? 0); return Number.isInteger(n) && n >= 0 ? n : 0; };
// the stream's key for a ticket's line at a venue: the able line there, `<venue>:<symbol>` — a prediction's at the picked
// outcome's symbol there, the one the order goes to — or none
function keyOf(ticket, venue, outcome) {
  const leg = Array.isArray(ticket?.legs) ? ticket.legs.find(l => l.able && l.venue === venue) : undefined;
  if (!leg) return null;
  if (!ticket.event) return `${leg.venue}:${leg.symbol}`;
  const at = Array.isArray(ticket.outcomes) ? ticket.outcomes[outcome]?.at : undefined;
  const line = Array.isArray(at) ? at.find(l => l.venue === venue) : undefined;
  return line?.symbol ? `${venue}:${line.symbol}` : null;
}
const figure = v => (typeof v === 'number' && Number.isFinite(v) ? v
  : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
// a pushed quote's price for the side: a buy's ask, a sell's bid, else its last trade, else its mark
const pushedPrice = (d, side) => [side === 'sell' ? d.bid : d.ask, d.last, d.mark].map(figure).find(n => n !== null) ?? null;
// the order sheet's side, as tradeDraftOf reads it: a sell, else a buy
const sideOf = s => (isRecord(s?.fields) && s.fields.side === 'sell' ? 'sell' : 'buy');

export function startTrade({ store, getJson, owner, sheet, stream, schedule, cancelTimer, now = Date.now, afterAction = () => {} }) {
  let closed = false;
  let shown = false;
  let pollTimer = null;
  let followed = null;       // the ticket's line on the stream, `<venue>:<symbol>`, or null
  let gen = 0;               // the ticket's seeding: bumped by every seed and closeTicket
  let refreshing = null;     // the seeding whose quiet re-prepare for a moved quote is in the air, or null
  let lastFrame = null;      // the followed line's last live quote frame since the seeding
  let preparedTop = null;    // that frame's price for the order's side as it stood when the shown preparation landed, or null
  let topFor = null;         // the preparation preparedTop belongs to (its body, by identity)
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

  // the stream follows the ticket's line, told every time (the stream client skips a set it already has: no mirror here to go
  // stale against Markets', which writes the same set); none to follow releases only what this host holds
  function follow(key) {
    if (key === null) { if (followed !== null) release(); return; }
    followed = key;
    stream.follow([key]);
  }
  function release() {
    followed = null;
    stream.follow([]);
  }

  // the order sheet seeded with the ticket as the view rules it now, carrying the fields' venue (where it is an able line) and
  // outcome so the seed's ticket is the form's; the line they name followed
  function seed(id, fields) {
    gen += 1;
    forgetTop();
    const ruled = ticketOf(store.get(), now());
    const outcome = indexOf(fields.outcome);
    const able = Boolean(ruled?.legs.some(l => l.able && l.venue === fields.venue));
    const ticket = ruled && { ...ruled, venue: able ? fields.venue : ruled.venue, outcome };
    follow(keyOf(ticket, fields.venue, outcome));
    return sheet.open('order', { id, ticket }, fields);
  }
  // the top a preparation stands at (the Account's preparedTop): when the shown preparation lands, the last live frame's price
  // for the order's side — none seen yet, the next frame's; a seeding starts with none
  function forgetTop() { lastFrame = null; preparedTop = null; topFor = null; }
  function syncTop() {
    const s = store.get().sheet;
    if (!s || s.kind !== 'order' || s.status !== 'ready' || !isRecord(s.prepared) || s.prepared === topFor) return;
    topFor = s.prepared;
    preparedTop = lastFrame ? pushedPrice(lastFrame, sideOf(s)) : null;
  }
  const unsubscribe = store.subscribe(() => { if (!closed) syncTop(); });

  // a ticket field changed: the open order sheet seeded again with its fields kept and the change; nothing while no ticket's
  // sheet is open, or while it is signing
  function reseed(patch) {
    const open = store.get().trade.ticket;
    const s = store.get().sheet;
    if (!open || !s || s.kind !== 'order' || s.status === 'signing' || !isRecord(s.fields)) return undefined;
    return seed(open.id, { ...s.fields, ...patch });
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
     *  the best able line — with nothing typed; that line followed. Resolves as the sheet's open does. Nothing while the sheet
     *  open is signing. */
    pick(id, { side = 'buy', venue = null, outcome = 0 } = {}) {
      if (closed || store.get().sheet?.status === 'signing') return undefined;
      store.dispatch('ticketOpen', { id, side, venue, outcome });
      const open = store.get().trade.ticket;
      if (!open || open.id !== id) return undefined;
      const ticket = ticketOf(store.get(), now());
      return seed(id, {
        venue: ticket?.venue ?? '', side: open.side, outcome: String(open.outcome),
        amount: '', unit: 'usd', orderType: 'market', limit: '', extendedHours: false,
      });
    },
    /** The open ticket's order sheet seeded again with the fields it had (another sheet took its place and closed): its side,
     *  venue, outcome and what was typed, the line they name followed. Nothing while no ticket is open, or a sheet is signing. */
    resume(fields) {
      const open = store.get().trade.ticket;
      if (closed || !open || !isRecord(fields) || store.get().sheet?.status === 'signing') return undefined;
      return seed(open.id, { ...fields });
    },
    /** The venue field changed (after `sheet.change('venue', id)`): the sheet seeded again with its fields kept and a ticket at
     *  that venue, the new line followed. Nothing while no ticket's sheet is open, or while it is signing. */
    venue(id) {
      if (closed) return undefined;
      return reseed({ venue: id });
    },
    /** A prediction's outcome field changed (after `sheet.change('outcome', i)`): as venue(), the picked outcome's line followed. */
    outcome(i) {
      if (closed) return undefined;
      return reseed({ outcome: String(i) });
    },
    /** The ticket closed: the sheet with it, the follow released when this host holds one. */
    closeTicket() {
      if (closed) return;
      gen += 1;
      forgetTop();
      store.dispatch('ticketClose');
      sheet.close();
      if (followed !== null) release();
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
    /** A stream event: a live quote for the followed line whose price for the order's side moved from the top the shown
     *  preparation landed at (the Account's own `preparedTop`: never the order's own price, a limit's being the limit), while
     *  that preparation is ready, FRESH_MS old and still the form's (a form mid-edit is the sheet's own debounce's), prepares
     *  again quietly — one at a time per ticket; a fill is said. */
    onStreamEvent(ev) {
      if (closed || !isRecord(ev)) return;
      if (ev.type === 'quote') {
        const d = ev.data;
        if (!isRecord(d) || d.live !== true || followed === null) return;
        const key = typeof d.key === 'string' && d.key ? d.key : `${d.venue}:${d.symbol}`;
        if (key !== followed) return;
        syncTop();   // a preparation landed since the last frame: its top is that frame's
        lastFrame = d;
        const s = store.get().sheet;
        if (!s || s.kind !== 'order' || s.status !== 'ready' || !Number.isFinite(s.preparedAt)) return;
        const pushed = pushedPrice(d, sideOf(s));
        // no frame seen when the shown preparation landed: this one is the top it stands at, nothing asked
        if (preparedTop === null) { preparedTop = pushed; return; }
        if (pushed === null || pushed === preparedTop) return;
        if (refreshing === gen || now() - s.preparedAt < FRESH_MS || askedOf(s) !== s.asked) return;
        const mine = gen;
        refreshing = mine;
        Promise.resolve(sheet.prepareNow({ quiet: true })).catch(() => null).finally(() => { if (refreshing === mine) refreshing = null; });
      } else if (ev.type === 'fill') {
        const said = fillWords(ev.data);
        if (said) store.dispatch('tradeSaid', said);
      }
    },
    /** The poll stopped and the follow released; nothing is read, followed or landed after. */
    close() {
      if (closed) return;
      closed = true;
      unsubscribe();
      stopPoll();
      for (const kind of kinds.keys()) drop(kind);
      if (followed !== null) release();
    },
  };
}
