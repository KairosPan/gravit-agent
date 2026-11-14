// face/client/js/host/desk-view.js — the desk's status (/data/desk/status: src/desk.ts DeskStatus, src/watch.ts WatchStatus)
// as the face's screens read it beside the Desk screen's own view (host/desk-page-view.js): the poll's period, New York's
// times as src/desk.ts writes them, the firing codes as words, the watch's own line, and a level's mark on its market row and
// page (plan 2026-11-01-desk-p3-watch Task 11). The Desk tab these once fed left Markets for the Desk screen (desk-page plan 1
// Task 5). Pure: nothing here reads, polls or touches the DOM.
import { t } from '../i18n/words.js';

export const DESK_POLL_MS = 10_000;

const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const records = v => (Array.isArray(v) ? v.filter(isRecord) : []);
const str = v => (typeof v === 'string' ? v : '');

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
export function etWhen(iso, now) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return str(iso);
  const at = etParts(ms);
  return at.date === etParts(now).date ? at.time : `${at.date} ${at.time}`;
}
/** A time in a line, as src/desk.ts deskTime (and statusTime, for a time that is no time) writes it. */
export const deskTime = (iso, now) => (Number.isFinite(Date.parse(iso)) ? t('desk.et', { time: etWhen(iso, now) }) : str(iso));

// ---- the desk's codes as words

// the watch's state as a word (src/watch.ts), a key whose English is the code as drawn; an unknown one is drawn as it came
function watchStateWord(code) {
  switch (code) {
    case 'starting': return t('desk.watchState.starting');
    case 'watching': return t('desk.watchState.watching');
    case 'stopped': return t('desk.watchState.stopped');
    default: return code;
  }
}
// a firing's kind and its turn's outcome share one set of words (src/firing.ts's ledger records and DeskTurnRecord)
export function firingWord(code) {
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
/** The watch's own line (src/desk.ts watchLines' head): nothing to watch, held elsewhere, its lease refused, or its state. */
export function watchHead(w) {
  if (w.state === 'idle') return t('desk.watch.idle');
  if (w.state === 'held-elsewhere') return isRecord(w.holder) ? t('desk.watch.heldBy', { pid: w.holder.pid }) : t('desk.watch.held');
  if (w.state === 'lease-failed') return t('desk.watch.lease', { error: str(w.leaseError) || t('desk.watch.unknown') });
  return t('desk.watch.state', { state: watchStateWord(str(w.state)) });
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
