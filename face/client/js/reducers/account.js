// face/client/js/reducers/account.js — Account on the face: what host/account.js and host/seat.js bring in, the Statement
// drawer, a venue's Details drawer, the Settings drawer, and the Rules tab's Guard press
import { closeOverlays } from './messages.js';

const acc = (s, patch) => ({ ...s, account: { ...s.account, ...patch } });
const seat = (s, patch) => ({ ...s, seat: { ...s.seat, ...patch } });
// one of the Account's reads beside the page, { status, data, at }: a failed read keeps its last data, as the page does
const read = (s, key, patch) => acc(s, { [key]: { ...s.account[key], ...patch } });
// the history curve's ranges, the Account's own
const RANGES = ['1d', '1w', '1m', 'all'];

export const reducers = {
  // the Account seat's standing (host/seat.js): /data/seat.json as read; a failed read keeps the last view
  seatLoading: s => seat(s, { status: 'loading' }),
  seatLoaded: (s, { data, at }) => seat(s, { status: 'ready', data, at }),
  seatFailed: (s, { at }) => seat(s, { status: 'error', at }),
  // the Account's page (host/account.js): /data/account as read
  accountLoading: s => acc(s, { status: 'loading' }),
  accountLoaded: (s, { data, at }) => acc(s, { status: 'ready', data, at, message: null }),
  // a failed read keeps the last data: the screen says it is not current rather than going blank; `message` is the
  // Account's own sentence when it refused, else null
  accountFailed: (s, { at, message = null }) => acc(s, { status: 'error', at, message }),
  // its other reads: holdings?cost=1, the paper lens (holdings?cost=1&paper=1), the leading history curve, the statement, the
  // agents; the holdings, the paper lens and the statement keep the Account's sentence when they refused, as the page does
  holdingsLoading: s => read(s, 'holdings', { status: 'loading' }),
  holdingsLoaded: (s, { data, at }) => read(s, 'holdings', { status: 'ready', data, at, message: null }),
  holdingsFailed: (s, { at, message = null }) => read(s, 'holdings', { status: 'error', at, message }),
  paperLoading: s => read(s, 'paper', { status: 'loading' }),
  paperLoaded: (s, { data, at }) => read(s, 'paper', { status: 'ready', data, at, message: null }),
  paperFailed: (s, { at, message = null }) => read(s, 'paper', { status: 'error', at, message }),
  historyLoading: s => read(s, 'history', { status: 'loading' }),
  historyLoaded: (s, { data, at }) => read(s, 'history', { status: 'ready', data, at }),
  historyFailed: (s, { at }) => read(s, 'history', { status: 'error', at }),
  statementLoading: s => read(s, 'statement', { status: 'loading' }),
  statementLoaded: (s, { data, at }) => read(s, 'statement', { status: 'ready', data, at, message: null }),
  statementFailed: (s, { at, message = null }) => read(s, 'statement', { status: 'error', at, message }),
  agentsLoading: s => read(s, 'agents', { status: 'loading' }),
  agentsLoaded: (s, { data, at }) => read(s, 'agents', { status: 'ready', data, at }),
  agentsFailed: (s, { at }) => read(s, 'agents', { status: 'error', at }),
  // the connect sheet's reads (plan 2 Task 8): where this account can connect (/data/account/venues), the kept paper books,
  // a key file's check and a venue's reach — each keeping the Account's sentence when it refused. The key file's check
  // records what it asked as it starts, so its words are drawn only for the form they answer: while it is in the air the
  // data kept is an earlier check's
  venuesHereLoading: s => read(s, 'venuesHere', { status: 'loading' }),
  venuesHereLoaded: (s, { data, at }) => read(s, 'venuesHere', { status: 'ready', data, at, message: null }),
  venuesHereFailed: (s, { at, message = null }) => read(s, 'venuesHere', { status: 'error', at, message }),
  paperBooksLoading: s => read(s, 'paperBooks', { status: 'loading' }),
  paperBooksLoaded: (s, { data, at }) => read(s, 'paperBooks', { status: 'ready', data, at, message: null }),
  paperBooksFailed: (s, { at, message = null }) => read(s, 'paperBooks', { status: 'error', at, message }),
  keyfileLoading: (s, asked = null) => read(s, 'keyfile', { status: 'loading', asked }),
  keyfileLoaded: (s, { data, at }) => read(s, 'keyfile', { status: 'ready', data, at, message: null }),
  keyfileFailed: (s, { at, message = null }) => read(s, 'keyfile', { status: 'error', at, message }),
  reachLoading: s => read(s, 'reach', { status: 'loading' }),
  reachLoaded: (s, { data, at }) => read(s, 'reach', { status: 'ready', data, at, message: null }),
  reachFailed: (s, { at, message = null }) => read(s, 'reach', { status: 'error', at, message }),
  // Guard (host/account.js guard, plan 4a Task 5): the press in the air, then what the Account's answer said — done in the
  // face's words, or its refusal in its own; the mode drawn stays the page's
  guardAsking: s => acc(s, { guard: { status: 'asking', said: null, message: null } }),
  guardSaid: (s, said) => acc(s, { guard: { status: 'said', said: typeof said === 'string' ? said : null, message: null } }),
  // a signed Beast done: the last Guard press's words are no longer the news
  guardClear: s => acc(s, { guard: { status: 'idle', said: null, message: null } }),
  guardRefused: (s, message) => acc(s, { guard: { status: 'refused', said: null, message: typeof message === 'string' ? message : null } }),
  // the browser wallet's sends (host/wallet-send.js, plan 4b Task 1), by key (a payment's `<id>@<at>`, an order's client id):
  // in the air, sent, or refused in the Account's or the wallet's words; `again` while a hash the wallet sent is kept for
  // Report again
  walletSaid: (s, { key, status, said, again = false } = {}) => (typeof key === 'string' && key !== ''
    ? acc(s, { wallet: { ...s.account.wallet, [key]: { status, said: typeof said === 'string' ? said : null, again: again === true } } }) : s),
  // the curve's range; one the Account does not draw leaves the slice as it is
  setHistoryRange: (s, range) => (RANGES.includes(range) && range !== s.account.history.range ? read(s, 'history', { range }) : s),
  // the Statement is a drawer: one at a time, as Settings and Details are
  openStatement: s => { const c = closeOverlays(s); return { ...c, account: { ...c.account, statementOpen: true } }; },
  closeStatement: s => (s.account.statementOpen ? acc(s, { statementOpen: false }) : s),
  // a venue's Details (the Venues tab) is a drawer too, naming its venue by id; one the page does not list draws nothing
  openVenueDetails: (s, id) => {
    if (typeof id !== 'string' || id === '') return s;
    const c = closeOverlays(s);
    return { ...c, account: { ...c.account, detailsVenue: id } };
  },
  closeVenueDetails: s => (s.account.detailsVenue ? acc(s, { detailsVenue: null }) : s),

  openSettings: s => ({ ...closeOverlays(s), settingsOpen: true }),
  closeSettings: s => ({ ...s, settingsOpen: false, edit: null, confirm: null }),
};
