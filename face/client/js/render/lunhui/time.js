// face/client/js/render/lunhui/time.js — a run's stamps in China time (M7): the session is Shanghai's, so an ISO stamp is
// printed in Asia/Shanghai, never in the browser's zone (the operator's browser runs in New York); the zone's name the table's.
import { t } from '../../i18n/words.js';

const FMT = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** "MM-DD HH:MM CST" for an ISO stamp; — for anything that is not a time. */
export function chinaStamp(iso) {
  const d = typeof iso === 'string' || typeof iso === 'number' ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '—';
  const p = Object.fromEntries(FMT.formatToParts(d).map(x => [x.type, x.value]));
  return t('lunhui.time.china', { at: `${p.month}-${p.day} ${p.hour}:${p.minute}` });
}
