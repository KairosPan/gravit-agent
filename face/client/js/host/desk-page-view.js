// face/client/js/host/desk-page-view.js — the Desk page's views (desk-page plan 1 Task 4, spec 2026-11-14 §6.1–§6.2): the head
// bar's state from /data/desk/status (src/desk.ts DeskStatus, src/watch.ts WatchStatus), News from /data/desk/news
// (src/desk-news.ts DeskNews) under the page's own choices (the deskPage slice: the filter, the rows opened, the rules
// unfolded), an alert's move, its row word and its count of the day, and a rule's words (a standing order's state is
// host/rail-view.js scheduledOf's). Every text from the ledgers is passed as it came, for the renderer to escape; the page
// translates nothing. Pure: nothing here reads, polls or touches the DOM.
import { t, tn } from '../i18n/words.js';
import { deskTime, etWhen } from './desk-view.js';

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
 *  each `open` when its latest alert's id is; `rulesOpen` the rules unfolded. */
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
  return {
    date: str(news.date), today: news.today !== false, sources: records(news.sources), chips,
    groups: shown.map(g => ({ ...g, earlier: records(g.earlier), open: open[str(g.latest.id)] === true })),
    reports, rules: records(news.rules), levels: count(news.levels), rulesOpen: ui.rules === true,
  };
}

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
