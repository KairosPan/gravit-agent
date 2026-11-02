// face/client/js/host/desk-view.js — the Desk tab inside Markets (plan 2026-11-01-desk-p3-watch Task 11, ruling 15): what
// /data/desk/status answers (src/desk.ts DeskStatus, src/watch.ts WatchStatus), as the tab draws it — the desk's status, its
// runs and sleep gaps, the standing orders and their firings, the watch by market with each market's own today, its alerts,
// the levels as loaded, the refused files — and a level's mark on its market row and page. The status lines are the server's
// phrases (src/desk.ts deskStatusLines, standingLines, watchLines), re-spelt here from the status's fields: the server sends
// no prose. Times are New York's: a line's as deskTime writes them (`14:03 ET`, dated on another New York date), a column's
// bare (`14:03`, dated the same way). §5.7's "since you last looked" is dropped: the page keeps no reader state, and today's
// alerts stand in for it. Pure: nothing here reads, polls or touches the DOM.

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
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return str(iso);
  const at = etParts(t);
  return at.date === etParts(now).date ? at.time : `${at.date} ${at.time}`;
}
/** A time in a line, as src/desk.ts deskTime (and statusTime, for a time that is no time) writes it. */
const deskTime = (iso, now) => (Number.isFinite(Date.parse(iso)) ? `${etWhen(iso, now)} ET` : str(iso));

/** `text` cut to `max` characters (code points), the last a `…`, as src/desk.ts cutText. */
function cut(text, max) {
  const chars = [...str(text)];
  return chars.length <= max ? str(text) : `${chars.slice(0, max - 1).join('')}…`;
}

// ---- the desk's lines (src/desk.ts deskStatusLines)

function headLine(s) {
  const up = count(s.uptimeMs);
  const enabled = s.desk?.enabled === true;
  return `up ${Math.floor(up / 3_600_000)}h ${Math.floor(up / 60_000) % 60}m since ${str(s.bootedAt)} · desk ${enabled ? 'on' : 'off (FACE_DESK=0)'}`;
}
function offLine(off, now) {
  const until = off.until === undefined ? '' : ` until ${deskTime(off.until, now)}`;
  return `desk: paused since ${deskTime(off.setAt, now)} by ${str(off.by)}${until} (npm run desk -- resume)`;
}
function telegramLine(t, now) {
  if (t.configured !== true) return 'telegram: not configured (TELEGRAM_BOT_TOKEN and TELEGRAM_OPERATOR_ID in $DSH_HOME/.env)';
  const parts = [
    ...(t.blocked === true ? ['blocked (403)'] : []),
    t.polling === true ? 'polling' : 'not polling',
    t.lastPollAt === undefined ? 'no poll yet' : `last poll ${deskTime(t.lastPollAt, now)}`,
    `${count(t.dropped)} dropped`,
    `${count(t.queued)} queued`,
  ];
  if (t.conflictAt !== undefined) parts.push(`conflict at ${deskTime(t.conflictAt, now)}`);
  if (isRecord(t.pollFailing)) parts.push(`poll failing since ${deskTime(t.pollFailing.since, now)}: ${str(t.pollFailing.reason)}`);
  return `telegram: ${parts.join(', ')}`;
}
function budgetLine(b) {
  const used = count(b.used?.total).toLocaleString('en-US');
  const cap = typeof b.dailyTokens === 'number' ? b.dailyTokens.toLocaleString('en-US') : undefined;
  const line = cap === undefined
    ? `budget: ${used} tokens today, cap not set (budget.dailyTokens in standing.yml)`
    : b.spent === true
      ? `budget: spent, ${used} of ${cap} tokens today; standing orders and phone turns wait for 00:00 ET`
      : `budget: ${used} of ${cap} tokens today`;
  return b.error === undefined ? line : `${line} (ledger unreadable: ${str(b.error)})`;
}

// ---- the standing orders (src/desk.ts standingLines, orderState)

const REFUSED_SHOWN_MAX = 200;

function standingNotesOf(s) {
  const notes = [];
  const orders = records(s.orders);
  if (s.file?.state === 'refused') notes.push(`standing orders stopped: standing.yml is refused: ${cut((Array.isArray(s.file.errors) ? s.file.errors : []).join('; '), REFUSED_SHOWN_MAX)}`);
  else if (orders.length === 0) notes.push('standing orders: none armed (npm run desk -- arm)');
  if (isRecord(s.ledger)) notes.push(`standing orders stopped: the firing ledger cannot be read (${str(s.ledger.error)})`);
  if (s.calendar?.state === 'failed') notes.push(`standing orders: no calendar today, ${str(s.calendar.clock)}: ${str(s.calendar.error) || 'no reason given'}`);
  const cn = s.calendars?.cn;
  if (cn?.state === 'failed') notes.push(`standing orders: no A-share calendar today, ${str(cn.clock)}: ${str(cn.error) || 'no reason given'}`);
  return notes;
}
// an order's state past its anchor: its firing running, disabled, expired, its text's or script's pin moved or gone, its
// strategy's levels.yml changed, gone or unreadable, else when it next falls — `timed` only then, the one state src/desk.ts
// orderState says after the order's anchor
function nextOf(o, running, now) {
  const state = next => ({ next, timed: false });
  if (isRecord(running) && str(running.key).startsWith(`${o.id}:`)) return state(`running since ${deskTime(running.startedAt, now)}`);
  if (o.enabled !== true) return state('disabled');
  if (o.expired === true) return state(`expired after ${str(o.expires)}`);
  const rearm = `changed since arming (npm run desk -- rearm ${o.id})`;
  const text = `${str(o.dir)}/${str(o.file)}`;
  if (o.hash === 'changed') return state(`${text} ${rearm}`);
  if (o.hash === 'missing') return state(`${text} is missing`);
  const script = str(o.producer) || 'its producer';
  if (o.producerHash === 'changed') return state(`${script} ${rearm}`);
  if (o.producerHash === 'missing') return state(`${script} is missing`);
  const levels = `${str(o.dir)}/levels.yml`;
  if (o.levelsHash === 'changed') return state(`${levels} ${rearm}`);
  if (o.levelsHash === 'missing') return state(`${levels} is gone since arming (npm run desk -- rearm ${o.id})`);
  if (o.levelsHash === 'unreadable') return state(`${levels} cannot be read`);
  return { next: o.nextAnchor === undefined ? "no session in the calendar's window" : `next ${deskTime(o.nextAnchor, now)}`, timed: true };
}

// the hash cell: the text's pin, else - the text's and the script's pins ok - the levels.yml pin's state when it is not
const LEVELS_CELL = { changed: 'levels.yml changed', missing: 'levels.yml gone', unreadable: 'levels.yml unreadable' };
function hashCell(o) {
  const hash = str(o.hash);
  if (hash !== 'ok' || (o.producerHash !== undefined && o.producerHash !== 'ok')) return hash;
  return LEVELS_CELL[o.levelsHash] ?? hash;
}

// ---- the watch (src/desk.ts watchLines)

const MARKET_NAMES = { us: 'US', cn: 'A shares' };
const SUPPRESS_ORDER = ['cap', 'muted', 'off', 'cooldown', 'window'];
const WATCH_ERROR_SHOWN_MAX = 200;
const FILE_ERROR_SHOWN_MAX = 80;

function watchHead(w) {
  if (w.state === 'idle') return 'watch: nothing to watch';
  if (w.state === 'held-elsewhere') return `watch: another face${isRecord(w.holder) ? ` (pid ${w.holder.pid})` : ''} holds the watch on this home`;
  if (w.state === 'lease-failed') return `watch: off today: its lease cannot be written (${str(w.leaseError) || 'unknown'})`;
  return `watch: ${str(w.state)}`;
}
function phaseOf(m, now) {
  const date = str(m.session?.date) || "today's";
  switch (m.state) {
    case 'no-calendar': return 'no calendar today';
    case 'closed': return 'closed today';
    case 'waiting': return isRecord(m.session) ? `the ${date} session opens at ${deskTime(m.session.open, now)}` : 'waiting for the session';
    case 'polling': return `polling the ${date} session, ${count(m.watched)} symbols, ${m.lastPollAt === undefined ? 'no poll yet' : `last poll ${deskTime(m.lastPollAt, now)}`}`;
    default: return `the ${date} session has closed`;
  }
}
function marketLine(name, m, now) {
  if (m.state === 'off') return null;
  const notWatched = Array.isArray(m.notWatched) && m.notWatched.length ? `; not watched: ${m.notWatched.length}` : '';
  const error = m.lastError === undefined ? '' : `; ${cut(m.lastError, WATCH_ERROR_SHOWN_MAX)}`;
  return `watch ${name}: ${phaseOf(m, now)}${notWatched}${error}`;
}
// a market's alerts on its own session date (the status counts each market's apart): none is no line
function todayLine(name, today) {
  const t = isRecord(today) ? today : {};
  const by = isRecord(t.suppressed) ? t.suppressed : {};
  const reasons = SUPPRESS_ORDER.filter(r => count(by[r]) > 0);
  const suppressed = reasons.reduce((n, r) => n + count(by[r]), 0);
  if (count(t.sent) === 0 && suppressed === 0 && count(t.repeats) === 0) return null;
  const parts = [`${count(t.sent)} sent`];
  if (suppressed > 0) parts.push(`${suppressed} suppressed (${reasons.map(r => `${r} ${count(by[r])}`).join(', ')})`);
  if (count(t.repeats) > 0) parts.push(`${count(t.repeats)} repeats in a cooldown`);
  return `alerts today (${name}): ${parts.join(', ')}`;
}
function filingsLine(f, now) {
  switch (f.state) {
    case 'no-contact': return 'filings: off: set ALPHA_EDGAR_USER_AGENT';
    case 'refused-today': return 'filings: off until tomorrow: SEC refused the requests';
    case 'polling': {
      const poll = f.lastPollAt === undefined ? 'no poll yet' : `last poll ${deskTime(f.lastPollAt, now)}`;
      return `filings: polling, ${count(f.symbols)} symbols, ${poll}${f.lastError === undefined ? '' : `; last error ${cut(f.lastError, WATCH_ERROR_SHOWN_MAX)}`}`;
    }
    default: return 'filings: off';
  }
}
// a file refused whole (its last good load kept), or loaded with refusals, each as the phone's line numbers it
function fileNote(f) {
  if (f.error !== undefined) return `refused, the last good load kept: ${cut(f.error, FILE_ERROR_SHOWN_MAX)}`;
  const refusals = records(f.refusals);
  if (!refusals.length) return null;
  const each = refusals.map(r => `${Number.isInteger(r.index) ? `#${r.index + 1}${r.symbol !== undefined ? ` ${r.symbol}` : ''}: ` : ''}${str(r.reason)}`);
  return `${refusals.length} of ${count(f.entries) + refusals.length} refused: ${each.join('; ')}`;
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
  const what = [`${str(a.symbol)} ${str(a.label)}`, a.gap === true ? 'gap' : '', price].filter(Boolean).join(' · ');
  const outcome = a.outcome === 'suppressed' && a.suppressed ? `suppressed (${a.suppressed})` : str(a.outcome);
  const latency = typeof a.latencyMs === 'number' && Number.isFinite(a.latencyMs) ? `${(a.latencyMs / 1000).toFixed(1)} s` : '—';
  return { when: etWhen(a.t, now), what, outcome, latency };
}
function gapWord(ms) {
  const n = count(ms);
  const seconds = Math.round(n / 1000);
  if (seconds < 60) return `${seconds} s`;
  // the total minutes rounded first, then split: never 60 min, never 1 h 60 min
  const minutes = Math.round(n / 60_000);
  const h = Math.floor(minutes / 60);
  return h ? `${h} h ${minutes % 60} min` : `${minutes} min`;
}

/** The Desk tab's view of a DeskStatus read at `nowIso` (ruling 15), or null for anything that is not one. Each line is the
 *  server's phrase: `head` the desk line, `off` the pause line while one is in force, `telegram` and `budget` theirs (null
 *  without), `watch` the watch's head (null while it does not run); `markets` each market's line (null while it is off) and
 *  its own session date's counts (`today`, null with none) — a market with neither is left out; `pending`, `muted` and
 *  `ledger` the alert lines (null when they do not hold), `filings` the filings' line; `alerts` the watch's recent ones,
 *  newest first; `levels` the watch's marks; `standing` the orders of the last good load (`market` its market, `us` when
 *  it names none; `hash` its pins' state, a strategy's levels.yml named when the text's and the script's hold; `timed` when
 *  its state is when it next falls, which its anchor leads) and `standingNotes` what holds the
 *  whole book; `firings` the recent firings; `runs` the last ten, newest first; `asleep` this run's gaps; `files` the watch's
 *  files with a refusal or an error; `ledgerError` the desk ledger's, as the budget names it. */
export function deskViewOf(status, nowIso) {
  if (!isRecord(status) || status.ok !== true) return null;
  const now = Number.isFinite(Date.parse(nowIso)) ? Date.parse(nowIso) : Date.now();
  const w = isRecord(status.watch) ? status.watch : null;
  const standing = isRecord(status.standing) ? status.standing : null;
  const markets = w ? ['us', 'cn'].flatMap(k => {
    const m = isRecord(w.markets?.[k]) ? w.markets[k] : null;
    if (!m) return [];
    const line = marketLine(MARKET_NAMES[k], m, now);
    const today = todayLine(MARKET_NAMES[k], m.today);
    return line === null && today === null ? [] : [{ name: MARKET_NAMES[k], line, today }];
  }) : [];
  return {
    head: headLine(status),
    ...(isRecord(status.off) ? { off: offLine(status.off, now) } : {}),
    telegram: isRecord(status.telegram) ? telegramLine(status.telegram, now) : null,
    budget: isRecord(status.budget) ? budgetLine(status.budget) : null,
    watch: w ? watchHead(w) : null,
    markets,
    pending: w && count(w.pending) > 0 ? `alerts: ${count(w.pending)} held for the next hour's batch` : null,
    muted: w && isRecord(w.muted) ? `alerts: muted until ${w.muted.until === undefined ? 'a terminal lifts it' : deskTime(w.muted.until, now)} (npm run desk -- unmute)` : null,
    ledger: w && w.ledgerError !== undefined ? `alerts: the ledger cannot be read (${str(w.ledgerError)}), so the watch sends nothing until it can` : null,
    filings: w && isRecord(w.filings) ? filingsLine(w.filings, now) : null,
    alerts: w ? records(w.recent).map(a => alertOf(a, now)) : [],
    levels: w ? records(w.marks).map(m => ({ market: MARKET_NAMES[m.market] ?? str(m.market), symbol: str(m.symbol), label: labelOf(m), plan: str(m.plan), file: str(m.file) })) : [],
    standing: standing ? records(standing.orders).map(o => ({
      id: str(o.id), market: o.market === 'cn' ? 'cn' : 'us', anchor: str(o.at), ...nextOf(o, standing.running, now), hash: hashCell(o),
      last: isRecord(o.last) ? `last ${str(o.last.outcome)} ${deskTime(o.last.t, now)}` : '',
    })) : [],
    standingNotes: standing ? standingNotesOf(standing) : [],
    firings: standing ? records(standing.recent).map(f => ({ order: str(f.order), when: etWhen(f.t, now), kind: str(f.kind), outcome: str(f.outcome) })) : [],
    runs: records(status.runs).slice(-10).reverse().map(r => ({ bootedAt: etWhen(r.bootedAt, now), pid: r.pid, lost: r.lost === true })),
    asleep: records(status.asleep).map(g => ({ from: etWhen(g.from, now), to: etWhen(g.to, now), gap: gapWord(g.gapMs) })),
    files: w ? records(w.files).flatMap(f => { const note = fileNote(f); return note === null ? [] : [{ file: str(f.file), note }]; }) : [],
    ledgerError: status.ledgerError === undefined ? null : `ledger unreadable: ${str(status.ledgerError)}`,
  };
}
