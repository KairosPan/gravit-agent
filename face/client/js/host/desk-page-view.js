// face/client/js/host/desk-page-view.js — the Desk page's views (desk-page plan 1 Task 4, spec 2026-11-14 §6.1–§6.2): the head
// bar's state from /data/desk/status (src/desk.ts DeskStatus, src/watch.ts WatchStatus), News from /data/desk/news
// (src/desk-news.ts DeskNews) under the page's own choices (the deskPage slice: the filter, the rows opened, the rules
// unfolded), an alert's move, its row word and its count of the day, and a rule's words (a standing order's state is
// host/rail-view.js scheduledOf's); and the Routines column (plan 2 Task 7) from /data/desk/routines (src/routine-clock.ts
// RoutinesStatus): each routine's row, its run history worded, the cap's line; and the routine card in the thread (plan 3
// Task 3) from the same read's proposals. Every text from the ledgers is passed as it came, for the renderer to escape; the
// page translates nothing. Pure: nothing here reads, polls or touches the DOM.
import { t, tn } from '../i18n/words.js';
import { deskTime, etWhen } from './desk-view.js';
import { etDate } from '../time.js';

const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const records = v => (Array.isArray(v) ? v.filter(isRecord) : []);
const str = v => (typeof v === 'string' ? v : '');
const count = v => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
const nowOf = iso => (Number.isFinite(Date.parse(iso)) ? Date.parse(iso) : Date.now());

/** The head bar's state of a DeskStatus read at `nowIso`, or null with no status: `off` the desk disabled (FACE_DESK=0),
 *  `paused` a pause in force (`off`: who paused it, since and until when, as deskTime writes them), `muted` the watch's
 *  alerts muted (`until` as deskTime writes it, none while a terminal must unmute), `stopped` no watch or one not watching
 *  (`reason` its state, `none` with no watch), `monitoring` the watch polling US shares, `offHours` anything else - in
 *  that order. `rules` counts the watch's rules (desk/rules.yml), 0 with no watch. */
export function deskHeadOf(status, nowIso) {
  if (!isRecord(status) || status.ok !== true) return null;
  const now = nowOf(nowIso);
  const w = isRecord(status.watch) ? status.watch : null;
  const rules = w && Array.isArray(w.rules) ? w.rules.length : 0;
  if (status.desk?.enabled !== true) return { state: 'off', rules };
  if (isRecord(status.off)) {
    const o = status.off;
    return { state: 'paused', rules, off: { by: str(o.by), since: deskTime(o.setAt, now), ...(o.until === undefined ? {} : { until: deskTime(o.until, now) }) } };
  }
  if (w && isRecord(w.muted)) return { state: 'muted', rules, ...(w.muted.until === undefined ? {} : { until: deskTime(w.muted.until, now) }) };
  if (!w || w.state !== 'watching') return { state: 'stopped', rules, reason: w ? str(w.state) : 'none' };
  if (w.markets?.us?.state === 'polling') return { state: 'monitoring', rules };
  return { state: 'offHours', rules };
}

/** News as the page draws it from a DeskNews body under the slice's choices `ui` (`filter`, `open`, `rules`), or null with
 *  no body: `chips` All (every alert and report), one per symbol with its count, Reports with its count while there is
 *  one - the one on the filter `on`, a filter naming no chip read as All; `groups` the symbols' groups the filter shows,
 *  each `open` when its latest alert's id is; `reports` the routines' report groups under All or Reports (`name` the
 *  routine's, `latest`, `earlier`, `open` when its latest report's {@link reportId} is); `rulesOpen` the rules unfolded. */
export function newsViewOf(news, ui = {}) {
  if (!isRecord(news)) return null;
  const groups = records(news.alerts?.groups).filter(g => isRecord(g.latest));
  const reports = isRecord(news.reports) ? news.reports : { total: 0, groups: [] };
  const reportsTotal = count(reports.total);
  const symbols = new Set(groups.map(g => str(g.symbol)));
  const filter = (ui.filter === 'reports' && reportsTotal > 0) || (ui.filter !== 'all' && symbols.has(ui.filter)) ? ui.filter : 'all';
  const open = isRecord(ui.open) ? ui.open : {};
  const chips = [
    { id: 'all', label: t('desk.news.all'), count: count(news.alerts?.total) + reportsTotal, on: filter === 'all' },
    ...groups.map(g => ({ id: str(g.symbol), label: str(g.symbol), count: count(g.count), on: filter === str(g.symbol) })),
    ...(reportsTotal > 0 ? [{ id: 'reports', label: t('desk.news.reports'), count: reportsTotal, on: filter === 'reports' }] : []),
  ];
  const shown = filter === 'all' ? groups : filter === 'reports' ? [] : groups.filter(g => g.symbol === filter);
  const reportGroups = filter === 'all' || filter === 'reports'
    ? records(reports.groups).filter(g => isRecord(g.latest)).map(g => ({
      name: str(g.routine?.name), latest: g.latest, earlier: records(g.earlier), open: open[reportId(g.latest)] === true,
    }))
    : [];
  return {
    date: str(news.date), today: news.today !== false, sources: records(news.sources), chips,
    groups: shown.map(g => ({ ...g, earlier: records(g.earlier), open: open[str(g.latest.id)] === true })),
    reports: reportGroups, rules: records(news.rules), levels: count(news.levels), rulesOpen: ui.rules === true,
  };
}

/** The id a report's Details opens by in the slice's `open`: its run's key, apart from the alerts' ids. */
export const reportId = report => `report:${str(report?.key)}`;

/** An alert's move, `{ text, dir }` - its sign and one decimal (`−8.1%`, a true minus) and `up` or `down`, both read from the
 *  value as rounded, so −0.04 is `0.0%` - or null for a level's or a filing's, which draws its label. */
export function moveOf(alert) {
  const pct = alert?.movePct;
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return null;
  const shown = Number(pct.toFixed(1));
  const sign = shown < 0 ? '\u2212' : shown > 0 ? '+' : '';
  return { text: `${sign}${Math.abs(shown).toFixed(1)}%`, dir: shown < 0 ? 'down' : 'up' };
}

/** An alert's time on its own New York date, `HH:MM`. */
export const alertTime = alert => etWhen(str(alert?.t), Date.parse(str(alert?.t)) || Date.now());

// a held-back alert's word, by why the watch held it
function heldWord(code) {
  switch (code) {
    case 'cooldown': return t('desk.row.cooldown');
    case 'cap': return t('desk.row.cap');
    case 'muted': return t('desk.row.muted');
    case 'off': return t('desk.row.paused');
    case 'window': return t('desk.row.window');
    default: return code;
  }
}

/** The words a row carries where they hold, each `{ text, tone }` (`held` or `warn`): a held-back alert its one word, why the
 *  watch held it (none for a code it does not name); else Undelivered, and no reason for an alert that has none - an
 *  undelivered alert with no reason carries both. */
export function rowWordsOf(alert) {
  if (alert?.delivery === 'held' || alert?.held !== undefined) {
    const text = heldWord(str(alert.held));
    return text ? [{ text, tone: 'held' }] : [];
  }
  const words = [];
  if (alert?.delivery === 'undelivered') words.push({ text: t('desk.row.undelivered'), tone: 'warn' });
  if (!isRecord(alert?.reason)) words.push({ text: t('desk.row.noReason'), tone: 'warn' });
  return words;
}

const ORDINAL = new Intl.PluralRules('en-US', { type: 'ordinal' });
/** `nth alert today` (or of the day shown), its ordinal by English's rules - every form one sentence in Chinese. */
export function nthWord(n) {
  const nth = Number.isInteger(n) && n > 0 ? n : 1;
  switch (ORDINAL.select(nth)) {
    case 'one': return t('desk.news.nthSt', { n: nth });
    case 'two': return t('desk.news.nthNd', { n: nth });
    case 'few': return t('desk.news.nthRd', { n: nth });
    default: return t('desk.news.nthTh', { n: nth });
  }
}

/** A watch rule's row: `names` what it watches (its symbols, Holdings, Levels; No symbols for none), `what` its threshold
 *  or its forms, `today` its alerts today. */
export function ruleRowOf(rule) {
  const names = [...(Array.isArray(rule.symbols) ? rule.symbols.filter(s => typeof s === 'string') : [])];
  if (rule.holdings === true) names.push(t('desk.rule.holdings'));
  if (rule.levels === true) names.push(t('desk.rule.levels'));
  const forms = Array.isArray(rule.forms) ? rule.forms.filter(f => typeof f === 'string') : [];
  const what = rule.kind === 'filing' ? t('desk.rule.filing', { forms: forms.join(t('common.list.sep')) })
    : rule.kind === 'gap' ? t('desk.rule.gap', { pct: typeof rule.pct === 'number' ? rule.pct : '' })
      : t('desk.rule.move', { pct: typeof rule.pct === 'number' ? rule.pct : '' });
  return { names: names.length ? names.join(t('common.list.sep')) : t('desk.rule.none'), what, today: tn('desk.rule.today', count(rule.alertsToday)) };
}

// ---- the Routines column (plan 2 Task 7, spec 2026-11-14 §6.7)

// a run's status as its word and its chip's tone; a status it does not name is drawn as it came
function statusOf(status) {
  switch (status) {
    case 'running': return { text: t('desk.routines.statusRunning'), tone: 'grey' };
    case 'succeeded': return { text: t('desk.routines.statusSucceeded'), tone: 'ok' };
    case 'failed': return { text: t('desk.routines.statusFailed'), tone: 'down' };
    case 'missed': return { text: t('desk.routines.statusMissed'), tone: 'warn' };
    case 'skipped': return { text: t('desk.routines.statusSkipped'), tone: 'grey' };
    default: return { text: str(status), tone: 'grey' };
  }
}
// a run's note code as its words (src/routine-clock.ts runNote); a code it does not name is drawn as it came
function noteWord(code) {
  switch (code) {
    case 'timed-out': return t('desk.routines.noteTimedOut');
    case 'no-answer': return t('desk.routines.noteNoAnswer');
    case 'asleep': return t('desk.routines.noteAsleep');
    case 'down': return t('desk.routines.noteDown');
    case 'late': return t('desk.routines.noteLate');
    case 'busy': return t('desk.routines.noteBusy');
    case 'paused': return t('desk.routines.notePaused');
    case 'cap': return t('desk.routines.noteCap');
    case 'interrupted': return t('desk.routines.noteInterrupted');
    case 'cancelled': return t('desk.routines.noteCancelled');
    default: return code;
  }
}

/** A run's note as the history draws it: a succeeded run's headline as it came (the model's words, for the renderer to
 *  escape); a code's words - an `error` its run's `detail` when it has one, else the word; none while it runs. */
export function runNoteOf(run) {
  const note = str(run?.note);
  if (run?.status === 'succeeded') return note;
  if (run?.status === 'running') return '';
  if (note === 'error') return str(run?.detail) || t('desk.routines.noteError');
  return noteWord(note);
}

/** A run as a history row: its time (`HH:MM` on `now`'s New York date, else with its date), its status word and tone, its
 *  note, whether it was a test, and the session it ran in. */
export function runRowOf(run, now) {
  const { text, tone } = statusOf(run?.status);
  return {
    time: etWhen(str(run?.at), now), status: text, tone, note: runNoteOf(run), test: run?.test === true,
    ...(str(run?.sessionId) ? { sessionId: run.sessionId } : {}),
  };
}

const tokens = n => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.round(n).toLocaleString('en-US') : '0');
// a test of `id` the face holds under way (a test run's key is `<routine>:test:<ISO time>`)
const testRunning = (data, id) => typeof data.running === 'string' && data.running.startsWith(`${id}:test:`);

/** The Routines column from a RoutinesStatus body under the slice's choices `ui` (`rOpen`, `rAsk`, `rBusy`, `rSaid`) at
 *  `nowIso`, or null with no body: `error` the store's load error when it cannot be read (and then no rows), `cap` its
 *  line ("{used} of {cap} tokens today") and whether it is spent; `rows` each routine - `when` its when line or Paused, `on`,
 *  `open`, `asking` (its delete question), `busy` (a Test under way: asked here, or the face running a test of it),
 *  `said` (a refused act's line, a said or a string), and, opened, its `instruction`, `schedule` (the when line) and `runs`. */
export function routinesViewOf(data, ui = {}, nowIso) {
  if (!isRecord(data) || data.ok !== true) return null;
  const now = nowOf(nowIso);
  const load = isRecord(data.load) ? data.load : { ok: true };
  const cap = isRecord(data.cap) ? data.cap : {};
  const capView = { line: t('desk.routines.cap', { used: tokens(cap.used), cap: tokens(cap.dailyTokens) }), spent: cap.spent === true };
  if (load.ok !== true) return { error: str(load.error) || t('desk.requestFailed'), cap: capView, rows: [] };
  const busy = isRecord(ui.rBusy) ? ui.rBusy : {};
  const saidBy = isRecord(ui.rSaid) ? ui.rSaid : {};
  const rows = records(data.routines).filter(r => str(r.id)).map(r => {
    const on = r.enabled === true;
    const open = ui.rOpen === r.id;
    return {
      id: r.id, name: str(r.name), on, when: on ? str(r.when) : t('desk.routines.paused'), open, asking: open && ui.rAsk === r.id,
      busy: busy[r.id] === 'test' || testRunning(data, r.id), said: saidBy[r.id] ?? null,
      ...(open ? { instruction: str(r.instruction), schedule: str(r.when), runs: records(r.runs).map(run => runRowOf(run, now)) } : {}),
    };
  });
  return { error: null, cap: capView, rows };
}

// ---- the routine card in the thread (plan 3 Task 3, spec 2026-11-14 §6.5)

// a settled card's chip, by its proposal's state
function settledChip(p) {
  switch (p.state) {
    case 'confirmed': return p.current === true ? 'added' : 'replaced';
    case 'superseded': return 'replaced';
    case 'dismissed': return 'dismissed';
    case 'expired': return 'expired';
    default: return 'closed';
  }
}

/** The routine card of a lifted `routine` message (host/kinds.js routineLift) under the routines read `data` (a
 *  RoutinesStatus body, or null before one): `name`, `when`, `instruction` and `note` the call's and the result's, as they
 *  came; `chip` from the proposal the read holds by the card's id - `new` pending (`change` when the call replaces a
 *  routine), `added` confirmed and its routine's current version, `replaced` confirmed but replaced since or superseded,
 *  `dismissed`, `expired`, `closed` for a proposal the read does not hold or one whose name or instruction (trimmed) is not
 *  the call's, and null - no chip - before a read has answered; `keys` only while pending and no answer of the card's is in flight (`busy`).
 *  `line`: a pending card's refused answer (`refused`: `limit`, else `failed`), else a pending change's `replaces` (the
 *  routine's name, while the read holds it); an added card's `first` run (`next` for a change) with `day` (the word for
 *  today, else its New York date) and `time` (`HH:MM` New York) from the read's next slot, none without one; a dismissed
 *  card's `notAdded`. `desk` an added card's View on Desk. `now` (an ISO time or ms) is the day the card reads as today. */
export function routineCardOf(message, data, { refused = null, busy = false, now } = {}) {
  const d = isRecord(message?.data) ? message.data : {};
  const id = str(d.proposal);
  const held = isRecord(data) && data.ok === true && id ? records(data.proposals).find(x => x.id === id) : undefined;
  // what the card shows must be what ✓ would add: a proposal whose name or instruction is not the call's is not this card's
  const same = held && str(held.name).trim() === str(d.name).trim() && str(held.instruction).trim() === str(d.instruction).trim();
  const p = same ? held : undefined;
  const replaces = str(d.replaces) !== '';
  // before a routines read has answered there is nothing to say of the proposal: no chip at all, not Closed
  const chip = !isRecord(data) ? null : !p ? 'closed' : p.state === 'pending' ? (replaces ? 'change' : 'new') : settledChip(p);
  const keys = p?.state === 'pending' && !busy;
  const card = { proposal: id, name: str(d.name), when: str(d.when), instruction: str(d.instruction), note: str(d.note), chip, keys, desk: chip === 'added' };
  if (keys && refused) return { ...card, line: { kind: refused === 'limit' ? 'limit' : 'failed' } };
  if (chip === 'change' && str(p.replacesName)) return { ...card, line: { kind: 'replaces', name: p.replacesName } };
  if (chip === 'dismissed') return { ...card, line: { kind: 'notAdded' } };
  if (chip === 'added' && isRecord(p.next) && Number.isFinite(Date.parse(p.next.at))) {
    const at = p.next.at;
    const today = new Date(typeof now === 'number' ? now : nowOf(now)).toISOString();
    const day = etDate(at) === etDate(today) ? t('time.today') : etDate(at);
    return { ...card, line: { kind: replaces ? 'next' : 'first', day, time: etWhen(at, Date.parse(at)) } };
  }
  return card;
}
