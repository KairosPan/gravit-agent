// face/client/js/host/identity-view.js — the Identity tab's view (plan B1b Task 1): what the account's GET /api/account/identity
// (through the face's proxy, /data/account/identity) says of how Gravit reaches the operator — the networks it is connected on
// (Telegram, Slack since plan B2 Task 7, and iMessage through Photon since the iMessage plan), what reaches them where (the routing's
// five rows, the face always on), quiet hours on New York's clock, Not you, the strangers who wrote to the bot, and the Slack app
// manifest the account gives for Install app…. And the routing as the string the owner signs (account/src/portfolio/identity/kinds.ts formatRouting, the same rule).
// No DOM, no store.
import { HOST_NAME } from '../wire/speaker.js';
import { t } from '../i18n/words.js';

// the routing's rows, in the account's order, and each one's words
const ROWS = ['chat', 'alerts', 'brief', 'cards', 'fills'];
const ROW_WORDS = {
  chat: () => t('identity.route.chat', { name: HOST_NAME }),
  alerts: () => t('identity.route.alerts'),
  brief: () => t('identity.route.brief'),
  cards: () => t('identity.route.cards'),
  fills: () => t('identity.route.fills'),
};
/** the routing's rows, in the account's order, with their words (read when called: the words are the table's now) */
export const routeRows = () => ROWS.map(row => [row, ROW_WORDS[row]()]);
/** the networks the tab draws, in its order; each one connects */
export const NETWORKS = [['telegram', 'Telegram'], ['imessage', 'iMessage'], ['slack', 'Slack']]; // en-kept: the networks' names
const nameOf = net => Object.fromEntries(NETWORKS)[net];
/** the networks the account speaks on now (kinds.ts NETWORKS) */
export const SPOKEN = ['telegram', 'imessage', 'slack'];
/** iMessage's gapAt (messages Photon could no longer give back) is the row's trouble this long, then no more */
export const GAP_SHOWN_MS = 24 * 3_600_000;

const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = v => (typeof v === 'string' ? v : '');
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The routing as the owner signs it: the rows in their order, `row=net,net` joined by `;`, the networks sorted and each once, a row
 *  with none written `row=` — `chat=telegram;alerts=telegram;brief=;cards=telegram;fills=telegram`. */
export function formatRouting(routing) {
  const r = isRecord(routing) ? routing : {};
  return ROWS.map(row => `${row}=${[...new Set((Array.isArray(r[row]) ? r[row] : []).filter(n => typeof n === 'string'))].sort().join(',')}`).join(';');
}

/** The account's routing as read: each row the networks it names that the account speaks on, every row present. */
export function routingOf(read) {
  const r = isRecord(read?.routing) ? read.routing : {};
  return Object.fromEntries(ROWS.map(row => [row, [...new Set((Array.isArray(r[row]) ? r[row] : []).filter(n => SPOKEN.includes(n)))].sort()]));
}

export const sameRouting = (a, b) => formatRouting(a) === formatRouting(b);

/** The routing with one tick changed: `network` in `row` on or off. A row or network the tab does not know leaves it as it is. */
export function tickRouting(routing, row, network, on) {
  const base = isRecord(routing) ? routing : {};
  if (!ROWS.includes(row) || !SPOKEN.includes(network)) return base;
  const now = Array.isArray(base[row]) ? base[row] : [];
  const next = on ? [...new Set([...now, network])].sort() : now.filter(n => n !== network);
  return { ...base, [row]: next };
}

// a connected network's trouble in one line, the worst first: the operator blocked the bot (Telegram's); Photon moved the operator to
// another number, or refuses to write to theirs (iMessage's); another program holds the token (Telegram's poller) or the app's socket
// (Slack's); the reads fail (named by the row's own network); messages Photon could not give back (iMessage's gapAt, for a day)
function problemOf(n, clock, now) {
  const slack = n.network === 'slack';
  if (n.network === 'telegram' && n.blocked === true) return t('identity.problem.blocked');
  if (str(n.movedAt)) return t('identity.problem.moved');
  if (str(n.refusedAt)) return t('identity.problem.refused');
  const conflict = str(n.conflictAt);
  if (conflict) {
    const since = clock(conflict);
    if (slack) return since ? t('identity.problem.slackConflictSince', { since, name: HOST_NAME }) : t('identity.problem.slackConflict', { name: HOST_NAME });
    return since ? t('identity.problem.conflictSince', { since, name: HOST_NAME }) : t('identity.problem.conflict', { name: HOST_NAME });
  }
  if (isRecord(n.pollFailing)) {
    const at = clock(str(n.pollFailing.since));
    const reason = str(n.pollFailing.reason);
    const network = nameOf(n.network) ?? nameOf('telegram');
    if (at && reason) return t('identity.problem.pollSinceWhy', { network, since: at, reason });
    if (at) return t('identity.problem.pollSince', { network, since: at });
    return reason ? t('identity.problem.pollWhy', { network, reason }) : t('identity.problem.poll', { network });
  }
  const gap = Date.parse(str(n.gapAt));
  if (Number.isFinite(gap) && now - gap < GAP_SHOWN_MS) return t('identity.problem.gap');
  return '';
}

// a network's row as read: connected, with its lines and its trouble, or none
function networkOf(n, clock, now) {
  if (!n) return { state: 'none' };
  const problem = problemOf(n, clock, now);
  return {
    state: 'connected', speaksAs: str(n.speaksAs), talksOnlyWith: str(n.talksOnlyWith), since: str(n.since), fingerprint: str(n.fingerprint),
    polling: n.polling === true, ...(problem ? { problem } : {}),
  };
}

// the account's answer's connected rows, or none for an answer the face does not recognise
const connectedRows = read => (isRecord(read) && read.ok === true && Array.isArray(read.networks) ? read.networks.filter(n => isRecord(n) && n.state === 'connected') : []);

/** The networks the account's answer shows connected, of those it speaks on, read with no words: the reducers' test, so no
 *  reducer reads the table. */
export function connectedNetworks(read) {
  return new Set(connectedRows(read).map(n => n.network).filter(n => SPOKEN.includes(n)));
}

/** The Identity tab's reading of the account's answer: `{ ok, networks: { telegram, imessage, slack }, grid, quiet, strangers,
 *  slackManifest }`. A connected row carries `speaksAs`, `talksOnlyWith`, `since`, `fingerprint`, `polling` and, when something is
 *  wrong, `problem` (one line); an unconnected one `state: 'none'`. The grid's network ticks are `draft`'s when one is given (the
 *  operator's unsaved ticks), else the account's, each enabled only once its network is connected; the face is always on.
 *  `slackManifest` is the account's app manifest text ('' when it gave none). An answer the face does not recognise is `ok: false`
 *  with nothing connected.
 *  `clock(iso)` words a time for a problem line (the renderer's; none given, the ISO as it came); `now` is when the tab is drawn
 *  (iMessage's gapAt is a problem for a day after it). */
export function identityOf(read, draft = null, clock = iso => iso, now = Date.now()) {
  const ok = isRecord(read) && read.ok === true;
  const list = connectedRows(read);
  const networks = Object.fromEntries(SPOKEN.map(net => [net, networkOf(list.find(n => n.network === net), clock, now)]));
  const routing = isRecord(draft) ? routingOf({ routing: draft }) : routingOf(ok ? read : null);
  const grid = routeRows().map(([row, label]) => ({
    row, label, face: true,
    ...Object.fromEntries(SPOKEN.map(net => [net, { on: routing[row].includes(net), enabled: networks[net].state === 'connected' }])),
  }));
  const q = ok && isRecord(read.quiet) ? read.quiet : null;
  const quiet = q && CLOCK.test(str(q.from)) && CLOCK.test(str(q.to)) ? { from: q.from, to: q.to } : null;
  const strangers = (ok && Array.isArray(read.strangers) ? read.strangers : [])
    .filter(s => isRecord(s) && typeof s.sender === 'string' && s.sender !== '' && typeof s.network === 'string')
    .map(s => ({ network: s.network, sender: s.sender, masked: str(s.masked), count: Number.isFinite(s.count) ? s.count : 0, last: str(s.last) }));
  const slackManifest = ok ? str(read.slackManifest) : '';
  return { ok, networks: { telegram: networks.telegram, imessage: networks.imessage, slack: networks.slack }, grid, quiet, strangers, slackManifest };
}
