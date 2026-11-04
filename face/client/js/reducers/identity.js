// face/client/js/reducers/identity.js — Account › Identity (plan B1b Task 1): the account's identity read as host/account.js lands
// it, the operator's unsaved ticks on the grid (a draft routing, dropped once it is the account's again), and Details open or shut.
// `connect` is the Connect Telegram sheets' (Task 2), null while none is open.
import { identityOf, routingOf, sameRouting, tickRouting } from '../host/identity-view.js';

const id = (s, patch) => ({ ...s, identity: { ...s.identity, ...patch } });
// a draft that says what the account says already is no draft
const settled = (draft, data) => (draft !== null && sameRouting(draft, routingOf(data)) ? null : draft);

export const reducers = {
  identityLoading: s => id(s, { status: 'loading' }),
  identityLoaded: (s, body) => id(s, { status: 'ready', data: body ?? null, message: null, draft: settled(s.identity.draft ?? null, body) }),
  // a failed read keeps no connection: the tab says the account is not answering rather than drawing a stale Connected row as live;
  // `message` the account's or the proxy's words when they were text
  identityFailed: (s, message) => id(s, { status: 'error', data: null, message: typeof message === 'string' && message.trim() !== '' ? message : null }),
  // a grid tick ({ row, network, on }) on a page that signs, for a network connected: the draft routing, over the account's
  identityTick: (s, { row, network, on } = {}) => {
    if (s.owner?.role !== 'signs') return s;
    const data = s.identity.data;
    const v = identityOf(data);
    if (!v.ok || v.networks[network]?.state !== 'connected') return s;
    const next = tickRouting(s.identity.draft ?? routingOf(data), row, network, on === true);
    return id(s, { draft: settled(next, data) });
  },
  identityDetails: s => id(s, { details: !s.identity.details }),
};
