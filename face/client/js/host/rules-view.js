// face/client/js/host/rules-view.js — the Rules tab's view (plan 4a Task 5): what the Account's read says about how its agents
// may act — the mode in force (`guard`, `open` for Beast) and, door by door, what each mode does with an agent's request inside
// its limit (`modeRules`, account/mode-rules.ts), how long a card waits, whether the Account takes writes at all
// (`connectLive.writes`), the most one order or move may be worth (its cap), the agents' session (`dial.sessionExpiresAt`,
// `dial.sessionEnded`) and the most leverage they may set (`dial.maxLeverage`), offered only where a venue sets leverage from
// here (`venues[].trade.leverage`). A read-only Account has no cap, session or leverage to set. No DOM, no store.
import { pageOk, writesOn } from './account-view.js';

const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const str = v => (typeof v === 'string' ? v : '');
const EMPTY = Object.freeze({ mode: '', modeRows: [], cardMinutes: null, writes: false, cap: null, session: null, leverage: null, leverageOffered: false });

/** The Rules tab's reading of the Account's read at `now` (the caller's clock, milliseconds): `{ mode, modeRows, cardMinutes,
 *  writes, cap: { usd } | null, session: { until, ended } | null, leverage: { max } | null, leverageOffered }`. A page the face
 *  does not recognise is all empty. */
export function rulesOf(page, now) {
  if (!pageOk(page)) return { ...EMPTY, modeRows: [] };
  const mode = page.mode === 'guard' || page.mode === 'open' ? page.mode : '';
  const rules = isRecord(page.modeRules) ? page.modeRules : {};
  const modeRows = (Array.isArray(rules.rows) ? rules.rows : [])
    .filter(r => isRecord(r) && typeof r.door === 'string' && typeof r.guard === 'string' && typeof r.beast === 'string')
    .map(r => ({ door: r.door, guard: r.guard, beast: r.beast }));
  const cardMinutes = isNum(rules.cardMinutes) && rules.cardMinutes > 0 ? rules.cardMinutes : null;
  const writes = writesOn(page);
  const capUsd = page.connectLive.writes?.capUsd;
  const dial = isRecord(page.dial) ? page.dial : null;
  let session = null;
  if (writes && dial) {
    const until = str(dial.sessionExpiresAt);
    const t = Date.parse(until);
    session = { until, ended: dial.sessionEnded === true || (!Number.isNaN(t) && t <= now) };
  }
  const leverage = writes && dial ? { max: isNum(dial.maxLeverage) && dial.maxLeverage >= 1 ? dial.maxLeverage : 1 } : null;
  const leverageOffered = page.venues.some(v => isRecord(v) && isRecord(v.trade) && v.trade.leverage === true);
  return { mode, modeRows, cardMinutes, writes, cap: writes ? { usd: isNum(capUsd) ? capUsd : null } : null, session, leverage, leverageOffered };
}
