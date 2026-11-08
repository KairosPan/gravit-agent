// face/client/js/host/desk-view.js — the Desk tab inside Markets (plan 2026-11-01-desk-p3-watch Task 11, ruling 15): what
// /data/desk/status answers (src/desk.ts DeskStatus, src/watch.ts WatchStatus), as the tab draws it — the desk's status, its
// runs and sleep gaps, the standing orders and their firings, the watch by market with each market's own today, its alerts,
// the levels as loaded, the refused files — and a level's mark on its market row and page. The status lines are the server's
// phrases (src/desk.ts deskStatusLines, standingLines, watchLines), re-spelt here from the status's fields: the server sends
// no prose. Times are New York's: a line's as deskTime writes them (`14:03 ET`, dated on another New York date), a column's
// bare (`14:03`, dated the same way). §5.7's "since you last looked" is dropped: the page keeps no reader state, and today's
// alerts stand in for it. Pure: nothing here reads, polls or touches the DOM.
import { t, tn } from '../i18n/words.js';

export const DESK_TAB = 'desk';
export const DESK_POLL_MS = 10_000;

const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const records = v => (Array.isArray(v) ? v.filter(isRecord) : []);
const str = v => (typeof v === 'string' ? v : '');
const count = v => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

// ---- New York's time, as src/et.ts tells it

const ET = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
function etParts(ms) {
  const p = {};
  for (const { type, value } of ET.formatToParts(new Date(ms))) p[type] = value;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
/** A time in a column: `HH:MM` on `now`'s New York date, `YYYY-MM-DD HH:MM` on another; anything that is no time as written. */
function etWhen(iso, now) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return str(iso);
  const at = etParts(ms);
  return at.date === etParts(now).date ? at.time : `${at.date} ${at.time}`;
}
/** A time in a line, as src/desk.ts deskTime (and statusTime, for a time that is no time) writes it. */
const deskTime = (iso, now) => (Number.isFinite(Date.parse(iso)) ? t('desk.et', { time: etWhen(iso, now) }) : str(iso));

/** `text` cut to `max` characters (code points), the last a `…`, as src/desk.ts cutText. */
function cut(text, max) {
  const chars = [...str(text)];
  return chars.length <= max ? str(text) : `${chars.slice(0, max - 1).join('')}…`;
}

// ---- the desk's lines (src/desk.ts deskStatusLines)

function headLine(s) {
  const up = count(s.uptimeMs);
  const enabled = s.desk?.enabled === true;
  const desk = enabled ? t('desk.head.on') : t('desk.head.off');
  return t('desk.head.line', { h: Math.floor(up / 3_600_000), m: Math.floor(up / 60_000) % 60, since: str(s.bootedAt), desk });
}
function offLine(off, now) {
  const since = deskTime(off.setAt, now);
  return off.until === undefined ? t('desk.off.line', { since, by: str(off.by) }) : t('desk.off.until', { since, by: str(off.by), until: deskTime(off.until, now) });
}
/** The phone line (src/desk.ts phoneLine): none, nothing connected, or each network as the account polls it; `now` in ms. */
export function phoneLine(p, now) {
  if (p.configured !== true) return t('desk.phone.none');
  const f = isRecord(p.accountFailing) ? p.accountFailing : null;
  const failing = f ? t('desk.phone.accountFailing', { since: deskTime(f.since, now), reason: str(f.reason) }) : '';
  const networks = records(p.networks);
  if (networks.length === 0) return t('desk.phone.nothing', { failing });
  const strangers = count(p.strangers);
  const network = n => {
    const polling = n.polling === true ? t('desk.phone.polling') : t('desk.phone.notPolling');
    return n.blocked === true ? t('desk.phone.blocked', { network: str(n.network), polling }) : t('desk.phone.network', { network: str(n.network), polling });
  };
  const parts = [
    networks.map(network).join(t('common.list.sep')),
    p.lastPollAt === undefined ? t('desk.noPoll') : t('desk.lastPoll', { at: deskTime(p.lastPollAt, now) }),
    t('desk.phone.queued', { n: count(p.queued) }),
    tn('desk.phone.strangers', strangers),
  ];
  for (const n of networks) {
    if (n.conflictAt !== undefined) parts.push(t('desk.phone.conflict', { network: str(n.network), at: deskTime(n.conflictAt, now) }));
    if (isRecord(n.pollFailing)) parts.push(t('desk.phone.pollFailing', { network: str(n.network), since: deskTime(n.pollFailing.since, now), reason: str(n.pollFailing.reason) }));
  }
  return t('desk.phone.line', { parts: parts.join(t('common.list.sep')), failing });
}
function budgetLine(b) {
  const used = count(b.used?.total).toLocaleString('en-US');
  const cap = typeof b.dailyTokens === 'number' ? b.dailyTokens.toLocaleString('en-US') : undefined;
  const line = cap === undefined
    ? t('desk.budget.noCap', { used })
    : b.spent === true
      ? t('desk.budget.spent', { used, cap })
      : t('desk.budget.line', { used, cap });
  return b.error === undefined ? line : t('desk.budget.unreadable', { line, error: str(b.error) });
}

// ---- the standing orders (src/desk.ts standingLines, orderState)

const REFUSED_SHOWN_MAX = 200;

function standingNotesOf(s) {
  const notes = [];
  const orders = records(s.orders);
  if (s.file?.state === 'refused') notes.push(t('desk.standing.refused', { errors: cut((Array.isArray(s.file.errors) ? s.file.errors : []).join(t('common.list.semi')), REFUSED_SHOWN_MAX) }));
  else if (orders.length === 0) notes.push(t('desk.standing.none'));
  if (isRecord(s.ledger)) notes.push(t('desk.standing.ledger', { error: str(s.ledger.error) }));
  if (s.calendar?.state === 'failed') notes.push(t('desk.standing.noCalendar', { clock: str(s.calendar.clock), error: str(s.calendar.error) || t('desk.noReason') }));
  const cn = s.calendars?.cn;
  if (cn?.state === 'failed') notes.push(t('desk.standing.noCnCalendar', { clock: str(cn.clock), error: str(cn.error) || t('desk.noReason') }));
  return notes;
}
// an order's state past its anchor: its firing running, disabled, expired, its text's or script's pin moved or gone, its
// strategy's levels.yml changed, gone or unreadable, else when it next falls — `timed` only then, the one state src/desk.ts
// orderState says after the order's anchor
function nextOf(o, running, now) {
  const state = next => ({ next, timed: false });
  if (isRecord(running) && str(running.key).startsWith(`${o.id}:`)) return state(t('desk.order.running', { since: deskTime(running.startedAt, now) }));
  if (o.enabled !== true) return state(t('desk.order.disabled'));
  if (o.expired === true) return state(t('desk.order.expired', { at: str(o.expires) }));
  const changed = what => t('desk.order.changed', { what, id: o.id });
  const missing = what => t('desk.order.missing', { what });
  const text = `${str(o.dir)}/${str(o.file)}`;
  if (o.hash === 'changed') return state(changed(text));
  if (o.hash === 'missing') return state(missing(text));
  const script = str(o.producer) || t('desk.order.producer');
  if (o.producerHash === 'changed') return state(changed(script));
  if (o.producerHash === 'missing') return state(missing(script));
  const levels = `${str(o.dir)}/levels.yml`;
  if (o.levelsHash === 'changed') return state(changed(levels));
  if (o.levelsHash === 'missing') return state(t('desk.order.gone', { what: levels, id: o.id }));
  if (o.levelsHash === 'unreadable') return state(t('desk.order.unreadable', { what: levels }));
  return { next: o.nextAnchor === undefined ? t('desk.order.noSession') : t('desk.order.next', { at: deskTime(o.nextAnchor, now) }), timed: true };
}

// the hash cell: the text's pin, else - the text's and the script's pins ok - the levels.yml pin's state when it is not
const levelsCell = () => ({ changed: t('desk.levels.changed'), missing: t('desk.levels.gone'), unreadable: t('desk.levels.unreadable') });
function hashCell(o) {
  const hash = str(o.hash);
  if (hash !== 'ok' || (o.producerHash !== undefined && o.producerHash !== 'ok')) return hash;
  const cells = levelsCell();
  return Object.hasOwn(cells, o.levelsHash) ? cells[o.levelsHash] : hash;
}

// ---- the watch (src/desk.ts watchLines)

const marketNames = () => ({ us: t('desk.market.us'), cn: t('desk.market.cn') });
const SUPPRESS_ORDER = ['cap', 'muted', 'off', 'cooldown', 'window'];

// the desk's codes as words (src/watch.ts, src/firing.ts), each a key whose English is the code as drawn; an unknown one is
// drawn as it came
function watchStateWord(code) {
  switch (code) {
    case 'starting': return t('desk.watchState.starting');
    case 'watching': return t('desk.watchState.watching');
    case 'stopped': return t('desk.watchState.stopped');
    default: return code;
  }
}
function suppressWord(code) {
  switch (code) {
    case 'cap': return t('desk.suppress.cap');
    case 'muted': return t('desk.suppress.muted');
    case 'off': return t('desk.suppress.off');
    case 'cooldown': return t('desk.suppress.cooldown');
    case 'window': return t('desk.suppress.window');
    default: return code;
  }
}
function alertOutcomeWord(code) {
  switch (code) {
    case 'pending': return t('desk.alertOutcome.pending');
    case 'sent': return t('desk.alertOutcome.sent');
    case 'queued': return t('desk.alertOutcome.queued');
    case 'undelivered': return t('desk.alertOutcome.undelivered');
    case 'suppressed': return t('desk.alertOutcome.suppressed');
    default: return code;
  }
}
// a firing's kind and its turn's outcome share one set of words (src/firing.ts's ledger records and DeskTurnRecord)
function firingWord(code) {
  switch (code) {
    case 'started': return t('desk.firing.started');
    case 'finished': return t('desk.firing.finished');
    case 'missed': return t('desk.firing.missed');
    case 'interrupted': return t('desk.firing.interrupted');
    case 'expired': return t('desk.firing.expired');
    case 'phoned': return t('desk.firing.phoned');
    case 'woke': return t('desk.firing.woke');
    case 'refused': return t('desk.firing.refused');
    case 'ended': return t('desk.firing.ended');
    case 'timed-out': return t('desk.firing.timedOut');
    case 'failed': return t('desk.firing.failed');
    case 'cancelled': return t('desk.firing.cancelled');
    case 'no-turn': return t('desk.firing.noTurn');
    case 'error': return t('desk.firing.error');
    default: return code;
  }
}
const WATCH_ERROR_SHOWN_MAX = 200;
const FILE_ERROR_SHOWN_MAX = 80;

function watchHead(w) {
  if (w.state === 'idle') return t('desk.watch.idle');
  if (w.state === 'held-elsewhere') return isRecord(w.holder) ? t('desk.watch.heldBy', { pid: w.holder.pid }) : t('desk.watch.held');
  if (w.state === 'lease-failed') return t('desk.watch.lease', { error: str(w.leaseError) || t('desk.watch.unknown') });
  return t('desk.watch.state', { state: watchStateWord(str(w.state)) });
}
function phaseOf(m, now) {
  const date = str(m.session?.date) || t('desk.phase.today');
  switch (m.state) {
    case 'no-calendar': return t('desk.phase.noCalendar');
    case 'closed': return t('desk.phase.closed');
    case 'waiting': return isRecord(m.session) ? t('desk.phase.opens', { date, at: deskTime(m.session.open, now) }) : t('desk.phase.waiting');
    case 'polling': {
      const poll = m.lastPollAt === undefined ? t('desk.noPoll') : t('desk.lastPoll', { at: deskTime(m.lastPollAt, now) });
      return t('desk.phase.polling', { date, n: count(m.watched), poll });
    }
    default: return t('desk.phase.over', { date });
  }
}
function marketLine(name, m, now) {
  if (m.state === 'off') return null;
  const notWatched = Array.isArray(m.notWatched) && m.notWatched.length ? t('desk.watch.notWatched', { n: m.notWatched.length }) : '';
  const error = m.lastError === undefined ? '' : t('desk.watch.error', { error: cut(m.lastError, WATCH_ERROR_SHOWN_MAX) });
  return t('desk.watch.market', { name, phase: phaseOf(m, now), notWatched, error });
}
// a market's alerts on its own session date (the status counts each market's apart): none is no line
function todayLine(name, today) {
  const day = isRecord(today) ? today : {};
  const by = isRecord(day.suppressed) ? day.suppressed : {};
  const reasons = SUPPRESS_ORDER.filter(r => count(by[r]) > 0);
  const suppressed = reasons.reduce((n, r) => n + count(by[r]), 0);
  if (count(day.sent) === 0 && suppressed === 0 && count(day.repeats) === 0) return null;
  const parts = [t('desk.today.sent', { n: count(day.sent) })];
  if (suppressed > 0) parts.push(t('desk.today.suppressed', { n: suppressed, reasons: reasons.map(r => t('desk.today.reason', { reason: suppressWord(r), n: count(by[r]) })).join(t('common.list.sep')) }));
  if (count(day.repeats) > 0) parts.push(t('desk.today.repeats', { n: count(day.repeats) }));
  return t('desk.today.line', { name, parts: parts.join(t('common.list.sep')) });
}
function filingsLine(f, now) {
  switch (f.state) {
    case 'no-contact': return t('desk.filings.noContact');
    case 'refused-today': return t('desk.filings.refused');
    case 'polling': {
      const poll = f.lastPollAt === undefined ? t('desk.noPoll') : t('desk.lastPoll', { at: deskTime(f.lastPollAt, now) });
      const error = f.lastError === undefined ? '' : t('desk.filings.lastError', { error: cut(f.lastError, WATCH_ERROR_SHOWN_MAX) });
      return t('desk.filings.polling', { n: count(f.symbols), poll, error });
    }
    default: return t('desk.filings.off');
  }
}
// a file refused whole (its last good load kept), or loaded with refusals, each as the phone's line numbers it
function fileNote(f) {
  if (f.error !== undefined) return t('desk.file.refused', { error: cut(f.error, FILE_ERROR_SHOWN_MAX) });
  const refusals = records(f.refusals);
  if (!refusals.length) return null;
  const each = refusals.map(r => (!Number.isInteger(r.index) ? str(r.reason)
    : r.symbol !== undefined ? t('desk.file.refusalOf', { n: r.index + 1, symbol: r.symbol, reason: str(r.reason) }) : t('desk.file.refusalAt', { n: r.index + 1, reason: str(r.reason) })));
  return t('desk.file.refusals', { n: refusals.length, of: count(f.entries) + refusals.length, each: each.join(t('common.list.semi')) });
}

// ---- a level's mark

/** A mark's words: `stop 170 · -1.30%` — its kind and level, then its distance from the last polled price to 2 dp, + above it,
 *  none before a price. */
function labelOf(mark) {
  const d = mark.distancePct;
  const at = typeof d === 'number' && Number.isFinite(d) ? ` · ${d > 0 ? '+' : ''}${d.toFixed(2)}%` : '';
  return `${str(mark.kind)} ${str(mark.level)}${at}`;
}
const marksOf = status => (isRecord(status) && status.ok === true && isRecord(status.watch) ? records(status.watch.marks) : []);

/** The level's mark for a Markets row (`stock:<SYM>`, a US share; `cn:<6 digits>`, an A share): the watch's nearest mark of that
 *  symbol (the status lists them nearest first), `{ label, plan, file }`; null for any other row, or with no mark. */
export function markOf(status, rowId) {
  const id = str(rowId);
  const at = id.indexOf(':');
  const head = id.slice(0, at);
  const symbol = id.slice(at + 1);
  const market = head === 'stock' && /^[A-Z][A-Z0-9.-]*$/.test(symbol) ? 'us' : head === 'cn' && /^\d{6}$/.test(symbol) ? 'cn' : null;
  if (at < 0 || market === null) return null;
  const mark = marksOf(status).find(m => m.market === market && m.symbol === symbol);
  return mark ? { label: labelOf(mark), plan: str(mark.plan), file: str(mark.file) } : null;
}

// ---- the view

// one alert as the tab lists it: when (New York), what fired with its print and feed, what became of it, and the send's latency
function alertOf(a, now) {
  const price = typeof a.price === 'number' ? `${a.price}${a.feed ? ` ${a.feed}` : ''}` : '';
  const what = [`${str(a.symbol)} ${str(a.label)}`, a.gap === true ? t('desk.alert.gap') : '', price].filter(Boolean).join(' · '); // words-order: an alert's facts under the visual separator
  const outcome = a.outcome === 'suppressed' && a.suppressed ? t('desk.alert.suppressed', { why: suppressWord(str(a.suppressed)) }) : alertOutcomeWord(str(a.outcome));
  const latency = typeof a.latencyMs === 'number' && Number.isFinite(a.latencyMs) ? t('desk.gap.seconds', { n: (a.latencyMs / 1000).toFixed(1) }) : '—';
  return { when: etWhen(a.t, now), what, outcome, sent: a.outcome === 'sent', latency };
}
function gapWord(ms) {
  const n = count(ms);
  const seconds = Math.round(n / 1000);
  if (seconds < 60) return t('desk.gap.seconds', { n: seconds });
  // the total minutes rounded first, then split: never 60 min, never 1 h 60 min
  const minutes = Math.round(n / 60_000);
  const h = Math.floor(minutes / 60);
  return h ? t('desk.gap.hours', { h, m: minutes % 60 }) : t('desk.gap.minutes', { n: minutes });
}

/** The Desk tab's view of a DeskStatus read at `nowIso` (ruling 15), or null for anything that is not one. Each line is the
 *  server's phrase: `head` the desk line, `off` the pause line while one is in force, `phone` and `budget` theirs (null
 *  without), `watch` the watch's head (null while it does not run); `markets` each market's line (null while it is off) and
 *  its own session date's counts (`today`, null with none) — a market with neither is left out; `pending`, `muted` and
 *  `ledger` the alert lines (null when they do not hold), `filings` the filings' line; `alerts` the watch's recent ones,
 *  newest first; `pages` the pages the desk opened today (`fetchesToday`), newest first as the status lists them, each
 *  `{ time, url }` - `time` as deskTime writes it (`14:03 ET`), the URL as it came, for the tab to draw as text; `levels`
 *  the watch's marks; `standing` the orders of the last good load (`market` its market, `us` when it names none; `hash` its pins' state, a strategy's levels.yml named when the text's and the script's hold; `timed` when
 *  its state is when it next falls, which its anchor leads; `sessionId` the session its last firing woke, null for none -
 *  the tab links it on the Messages route, P4 ruling 6) and `standingNotes` what holds the
 *  whole book; `firings` the recent firings; `runs` the last ten, newest first; `asleep` this run's gaps; `files` the watch's
 *  files with a refusal or an error; `ledgerError` the desk ledger's, as the budget names it. */
export function deskViewOf(status, nowIso) {
  if (!isRecord(status) || status.ok !== true) return null;
  const now = Number.isFinite(Date.parse(nowIso)) ? Date.parse(nowIso) : Date.now();
  const w = isRecord(status.watch) ? status.watch : null;
  const standing = isRecord(status.standing) ? status.standing : null;
  const names = marketNames();
  const markets = w ? ['us', 'cn'].flatMap(k => {
    const m = isRecord(w.markets?.[k]) ? w.markets[k] : null;
    if (!m) return [];
    const line = marketLine(names[k], m, now);
    const today = todayLine(names[k], m.today);
    return line === null && today === null ? [] : [{ name: names[k], line, today }];
  }) : [];
  return {
    head: headLine(status),
    ...(isRecord(status.off) ? { off: offLine(status.off, now) } : {}),
    phone: isRecord(status.phone) ? phoneLine(status.phone, now) : null,
    budget: isRecord(status.budget) ? budgetLine(status.budget) : null,
    watch: w ? watchHead(w) : null,
    markets,
    pending: w && count(w.pending) > 0 ? t('desk.alerts.pending', { n: count(w.pending) }) : null,
    muted: w && isRecord(w.muted) ? t('desk.alerts.muted', { until: w.muted.until === undefined ? t('desk.alerts.terminal') : deskTime(w.muted.until, now) }) : null,
    ledger: w && w.ledgerError !== undefined ? t('desk.alerts.ledger', { error: str(w.ledgerError) }) : null,
    filings: w && isRecord(w.filings) ? filingsLine(w.filings, now) : null,
    alerts: w ? records(w.recent).map(a => alertOf(a, now)) : [],
    pages: records(status.fetchesToday).flatMap(f => (typeof f.t === 'string' && typeof f.url === 'string' ? [{ time: deskTime(f.t, now), url: f.url }] : [])),
    levels: w ? records(w.marks).map(m => ({ market: Object.hasOwn(names, m.market) ? names[m.market] : str(m.market), symbol: str(m.symbol), label: labelOf(m), plan: str(m.plan), file: str(m.file) })) : [],
    standing: standing ? records(standing.orders).map(o => ({
      id: str(o.id), market: o.market === 'cn' ? 'cn' : 'us', anchor: str(o.at), ...nextOf(o, standing.running, now), hash: hashCell(o),
      last: isRecord(o.last) ? t('desk.order.last', { outcome: firingWord(str(o.last.outcome)), at: deskTime(o.last.t, now) }) : '',
      sessionId: isRecord(o.last) && str(o.last.sessionId) !== '' ? str(o.last.sessionId) : null,
    })) : [],
    standingNotes: standing ? standingNotesOf(standing) : [],
    firings: standing ? records(standing.recent).map(f => ({ order: str(f.order), when: etWhen(f.t, now), kind: firingWord(str(f.kind)), outcome: firingWord(str(f.outcome)) })) : [],
    runs: records(status.runs).slice(-10).reverse().map(r => ({ bootedAt: etWhen(r.bootedAt, now), pid: r.pid, lost: r.lost === true })),
    asleep: records(status.asleep).map(g => ({ from: etWhen(g.from, now), to: etWhen(g.to, now), gap: gapWord(g.gapMs) })),
    files: w ? records(w.files).flatMap(f => { const note = fileNote(f); return note === null ? [] : [{ file: str(f.file), note }]; }) : [],
    ledgerError: status.ledgerError === undefined ? null : t('desk.ledgerUnreadable', { error: str(status.ledgerError) }),
  };
}
