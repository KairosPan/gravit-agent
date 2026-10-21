// face/client/js/host/seat.js — the Account seat's impure half (spec 2026-10-20 §6.3): /data/seat.json in one flight at a
// time, into the store's seat slice. The view it brings is the face's reduction of the Account's own /api/account; "not
// reachable" is a state the view carries, never a failed read.

export function startSeat({ store, getJson, now = Date.now }) {
  let flight = null;
  let flightFresh = false;
  let seq = 0;   // only the latest-started read lands: a fresh one must not be overwritten by an older plain one

  // fresh: past the face's 30 s cache (`?fresh=1`) — Refresh on Venues and the read right after a seat receipt; a plain
  // read joins any flight, a fresh one joins only a fresh one
  function load({ fresh = false } = {}) {
    if (flight && (flightFresh || !fresh)) return flight;
    const mine = ++seq;
    store.dispatch('seatLoading');
    const current = Promise.resolve()
      .then(() => getJson(fresh ? '/data/seat.json?fresh=1' : '/data/seat.json'))
      .then(data => {
        if (mine !== seq) return;
        if (data && data.ok === true) store.dispatch('seatLoaded', { data, at: now() });
        else store.dispatch('seatFailed', { at: now() });
      }, () => { if (mine === seq) store.dispatch('seatFailed', { at: now() }); })
      .finally(() => { if (flight === current) { flight = null; flightFresh = false; } });
    flight = current;
    flightFresh = fresh;
    return current;
  }

  return { load };
}
