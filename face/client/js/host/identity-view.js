// face/client/js/host/identity-view.js — the Identity tab's view (plan B1b Task 1): what the account's GET /api/account/identity
// (through the face's proxy, /data/account/identity) says of how Gravit reaches the operator — the networks it is connected on
// (Telegram in this round; Slack the next, iMessage later), what reaches them where (the routing's five rows, the face always on),
// quiet hours on New York's clock, and Not you, the strangers who wrote to the bot. And the routing as the string the owner signs
// (account/src/portfolio/identity/kinds.ts formatRouting, the same rule). No DOM, no store.

/** the routing's rows, in the account's order, with their words */
export const ROUTE_ROWS = [['chat', 'Chat with Gravit'], ['alerts', 'Watch alerts'], ['brief', 'Pre-close brief'], ['cards', 'Cards waiting'], ['fills', 'Fills and reports']];
/** the networks the tab draws, in its order; only Telegram connects in this round */
export const NETWORKS = [['telegram', 'Telegram'], ['imessage', 'iMessage'], ['slack', 'Slack']];
/** the networks the account speaks on now (kinds.ts NETWORKS) */
const SPOKEN = ['telegram'];

const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = v => (typeof v === 'string' ? v : '');
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The routing as the owner signs it: the rows in their order, `row=net,net` joined by `;`, the networks sorted and each once, a row
 *  with none written `row=` — `chat=telegram;alerts=telegram;brief=;cards=telegram;fills=telegram`. */
export function formatRouting(routing) {
  const r = isRecord(routing) ? routing : {};
  return ROUTE_ROWS.map(([row]) => `${row}=${[...new Set((Array.isArray(r[row]) ? r[row] : []).filter(n => typeof n === 'string'))].sort().join(',')}`).join(';');
}

/** The account's routing as read: each row the networks it names that the account speaks on, every row present. */
export function routingOf(read) {
  const r = isRecord(read?.routing) ? read.routing : {};
  return Object.fromEntries(ROUTE_ROWS.map(([row]) => [row, [...new Set((Array.isArray(r[row]) ? r[row] : []).filter(n => SPOKEN.includes(n)))].sort()]));
}

export const sameRouting = (a, b) => formatRouting(a) === formatRouting(b);

/** The routing with one tick changed: `network` in `row` on or off. A row or network the tab does not know leaves it as it is. */
export function tickRouting(routing, row, network, on) {
  const base = isRecord(routing) ? routing : {};
  if (!ROUTE_ROWS.some(([r]) => r === row) || !SPOKEN.includes(network)) return base;
  const now = Array.isArray(base[row]) ? base[row] : [];
  const next = on ? [...new Set([...now, network])].sort() : now.filter(n => n !== network);
  return { ...base, [row]: next };
}

// a connected network's trouble in one line, the worst first: the operator blocked the bot, another poller holds the token, polls fail
function problemOf(n, clock) {
  if (n.blocked === true) return 'You blocked the bot in Telegram: unblock it, or nothing reaches you there.';
  const conflict = str(n.conflictAt);
  if (conflict) return `Another program reads this bot's messages${clock(conflict) ? ` (since ${clock(conflict)})` : ''}: stop it, or Gravit hears nothing.`;
  if (isRecord(n.pollFailing)) {
    const since = clock(str(n.pollFailing.since));
    const reason = str(n.pollFailing.reason);
    return `Not hearing Telegram${since ? ` since ${since}` : ''}${reason ? `: ${reason}` : ''}.`;
  }
  return '';
}

/** The Identity tab's reading of the account's answer: `{ ok, networks: { telegram, imessage, slack }, grid, quiet, strangers }`.
 *  A connected Telegram row carries `speaksAs`, `talksOnlyWith`, `since`, `fingerprint`, `polling` and, when something is wrong,
 *  `problem` (one line); an unconnected one `state: 'none'`; Slack is `soon`, iMessage `later`. The grid's Telegram ticks are `draft`'s
 *  when one is given (the operator's unsaved ticks), else the account's, and enabled only once Telegram is connected; the face is
 *  always on, iMessage and Slack never. An answer the face does not recognise is `ok: false` with nothing connected.
 *  `clock(iso)` words a time for a problem line (the renderer's; none given, the ISO as it came). */
export function identityOf(read, draft = null, clock = iso => iso) {
  const ok = isRecord(read) && read.ok === true;
  const list = ok && Array.isArray(read.networks) ? read.networks.filter(n => isRecord(n) && n.state === 'connected') : [];
  const tg = list.find(n => n.network === 'telegram');
  const telegram = tg
    ? {
      state: 'connected', speaksAs: str(tg.speaksAs), talksOnlyWith: str(tg.talksOnlyWith), since: str(tg.since), fingerprint: str(tg.fingerprint),
      polling: tg.polling === true, ...(problemOf(tg, clock) ? { problem: problemOf(tg, clock) } : {}),
    }
    : { state: 'none' };
  const routing = isRecord(draft) ? routingOf({ routing: draft }) : routingOf(ok ? read : null);
  const on = telegram.state === 'connected';
  const grid = ROUTE_ROWS.map(([row, label]) => ({
    row, label, face: true,
    telegram: { on: routing[row].includes('telegram'), enabled: on },
    imessage: { on: false, enabled: false },
    slack: { on: false, enabled: false },
  }));
  const q = ok && isRecord(read.quiet) ? read.quiet : null;
  const quiet = q && CLOCK.test(str(q.from)) && CLOCK.test(str(q.to)) ? { from: q.from, to: q.to } : null;
  const strangers = (ok && Array.isArray(read.strangers) ? read.strangers : [])
    .filter(s => isRecord(s) && typeof s.sender === 'string' && s.sender !== '' && typeof s.network === 'string')
    .map(s => ({ network: s.network, sender: s.sender, masked: str(s.masked), count: Number.isFinite(s.count) ? s.count : 0, last: str(s.last) }));
  return { ok, networks: { telegram, imessage: { state: 'later' }, slack: { state: 'soon' } }, grid, quiet, strangers };
}
