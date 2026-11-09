// face/client/js/reducers/identity.js — Account › Identity (plan B1b Task 1): the account's identity read as host/account.js lands
// it, the operator's unsaved ticks on the grid (a draft routing, dropped once it is the account's again), and each network's Details
// open or shut (`details`: false, or `{ telegram, imessage, slack }`).
// `connect` is the connect drawer's (Task 2, sheets 1 to 3; sheet 4 is the owner sheet; Slack's since plan B2 Task 7, iMessage's since
// the iMessage plan): `{ network, step, pending, fp, busy, error, silent, copied }` (silent: sheet 2's last read had no answer;
// copied: Slack's manifest was copied),
// null while none is open. It never holds a token: only the pending connection the account answered and the fingerprint (salt and
// keyHash) made in the browser.
import { isLine } from '../i18n/words.js';
import { connectedNetworks, routingOf, sameRouting, tickRouting } from '../host/identity-view.js';

const id = (s, patch) => ({ ...s, identity: { ...s.identity, ...patch } });
const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const STEPS = new Set([1, 2, 3]);
const HEX64 = /^[0-9a-f]{64}$/;
const HEX32 = /^[0-9a-f]{32}$/;
const OPEN = { step: 1, pending: null, fp: null, busy: false, error: null, silent: false, copied: false };
const CONNECTS = new Set(['telegram', 'imessage', 'slack']);
// a patch of the connect drawer: its keys alone, each of its shape — whatever else rides on a patch never reaches the store; the
// network is the drawer's from its opening and no patch changes it
function connectPatch(p) {
  const out = {};
  if (!isRecord(p)) return out;
  if (STEPS.has(p.step)) out.step = p.step;
  if (p.pending === null || isRecord(p.pending)) out.pending = p.pending;
  if (p.fp === null) out.fp = null;
  else if (isRecord(p.fp) && HEX32.test(p.fp.salt) && HEX64.test(p.fp.keyHash)) out.fp = { salt: p.fp.salt, keyHash: p.fp.keyHash };
  if (typeof p.busy === 'boolean') out.busy = p.busy;
  if (typeof p.silent === 'boolean') out.silent = p.silent;
  if (typeof p.copied === 'boolean') out.copied = p.copied;
  if (p.error === null || isLine(p.error, { empty: true })) out.error = p.error;
  return out;
}
// a draft's ticks only for networks the read shows connected (a Disconnect, or a change made elsewhere, takes the rest away)
function connectedOnly(draft, data) {
  if (draft === null) return null;
  const connected = connectedNetworks(data);
  const on = n => connected.has(n);
  return Object.fromEntries(Object.entries(draft).map(([row, nets]) => [row, Array.isArray(nets) ? nets.filter(on) : nets]));
}
// a draft that says what the account says already is no draft
const settled = (draft, data) => (draft !== null && sameRouting(draft, routingOf(data)) ? null : draft);

export const reducers = {
  identityLoading: s => id(s, { status: 'loading' }),
  identityLoaded: (s, body) => id(s, { status: 'ready', data: body ?? null, message: null, draft: settled(connectedOnly(s.identity.draft ?? null, body), body) }),
  // a failed read keeps no connection: the tab says the account is not answering rather than drawing a stale Connected row as live;
  // `message` the account's or the proxy's words when they were text
  identityFailed: (s, message) => id(s, { status: 'error', data: null, message: typeof message === 'string' && message.trim() !== '' ? message : null }),
  // a grid tick ({ row, network, on }) on a page that signs, for a network connected: the draft routing, over the account's
  identityTick: (s, { row, network, on } = {}) => {
    if (s.owner?.role !== 'signs') return s;
    const data = s.identity.data;
    if (!connectedNetworks(data).has(network)) return s;
    const next = tickRouting(s.identity.draft ?? routingOf(data), row, network, on === true);
    return id(s, { draft: settled(next, data) });
  },
  // a network's Details (none named: Telegram's) open or shut; none open is false
  identityDetails: (s, network) => {
    const net = CONNECTS.has(network) ? network : 'telegram';
    const was = s.identity.details;
    const now = isRecord(was) ? { ...was } : was === true ? { telegram: true } : {};
    if (now[net]) delete now[net]; else now[net] = true;
    return id(s, { details: Object.keys(now).length ? now : false });
  },
  // the connect drawer (sheets 1 to 3) for a network (none named or one the tab does not connect: Telegram): opened at sheet 1,
  // moved by host/identity.js, closed
  identityConnectOpen: (s, network) => id(s, { connect: { network: CONNECTS.has(network) ? network : 'telegram', ...OPEN } }),
  identityConnectSet: (s, patch) => (s.identity.connect ? id(s, { connect: { ...s.identity.connect, ...connectPatch(patch) } }) : s),
  identityConnectClose: s => (s.identity.connect ? id(s, { connect: null }) : s),
};
