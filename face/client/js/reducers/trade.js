// face/client/js/reducers/trade.js — Trade's slice (host/trade.js): the kind it is on (one of TRADE_KIND_IDS), the query typed, the
// kinds' picks reads (explore?tab=<kind>&limit=12) by kind and the trade search's own read (explore?q=, apart from the Markets
// search's `results`), the ticket open (its market, side, venue and outcome — the order sheet keeps its fields), and the last
// thing said (a cancel's answer, a fill) as words.
import { isLine } from '../i18n/words.js';
import { TRADE_KIND_IDS } from '../host/trade-view.js';

const tr = (s, patch) => ({ ...s, trade: { ...s.trade, ...patch } });
const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const IDLE = { status: 'idle', data: null, at: null };
const KINDS = new Set(TRADE_KIND_IDS);
// a kind's picks read: a failed read keeps its last items, with the Account's sentence when it refused (`message`, else null)
const pick = (s, kind, patch) => (KINDS.has(kind)
  ? tr(s, { picks: { ...s.trade.picks, [kind]: { ...IDLE, ...(isRecord(s.trade.picks[kind]) ? s.trade.picks[kind] : {}), ...patch } } }) : s);
const results = (s, patch) => tr(s, { results: { ...s.trade.results, ...patch } });

export const reducers = {
  tradeKind: (s, kind) => (KINDS.has(kind) && kind !== s.trade.kind ? tr(s, { kind }) : s),
  tradeQuery: (s, q) => tr(s, { q: typeof q === 'string' ? q : '' }),
  picksLoading: (s, { kind } = {}) => pick(s, kind, { status: 'loading' }),
  picksLoaded: (s, { kind, data, at } = {}) => pick(s, kind, { status: 'ready', data, at, message: null }),
  picksFailed: (s, { kind, at, message = null } = {}) => pick(s, kind, { status: 'error', at, message }),
  // the trade search's: named apart from the Markets search's resultsLoading/Loaded/Failed, which share the reducer table
  tradeResultsLoading: s => results(s, { status: 'loading' }),
  tradeResultsLoaded: (s, { data, at } = {}) => results(s, { status: 'ready', data, at, message: null }),
  tradeResultsFailed: (s, { at, message = null } = {}) => results(s, { status: 'error', at, message }),
  // a ticket on a market: a buy of its first outcome where nothing else is given; a new ticket clears what was said
  ticketOpen: (s, { id, side, venue, outcome } = {}) => (typeof id === 'string' && id !== '' ? tr(s, {
    ticket: {
      id, side: side === 'sell' ? 'sell' : 'buy', venue: typeof venue === 'string' && venue ? venue : null,
      outcome: Number.isInteger(outcome) && outcome >= 0 ? outcome : 0,
    },
    said: null,
  }) : s),
  ticketClose: s => (s.trade.ticket ? tr(s, { ticket: null }) : s),
  tradeSaid: (s, words) => tr(s, { said: isLine(words, { empty: true }) ? words : null }),
};
