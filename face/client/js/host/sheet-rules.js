// face/client/js/host/sheet-rules.js — the Rules tab's four signed sheets (plan 4a Task 5): Beast, the cap on each move, the
// agents' session and their leverage — each the Account's own `setPolicy` draft, with the checks and words its own page signs it
// with (the retired page at 9614314c, ui/agents-mount.js setMode, openCap and renderDial), nothing added and nothing renamed.
// Guard is no sheet: it is the Account's one unsigned write (host/account.js guard). host/sheet-view.js delegates the four kinds
// here; the sheet engine (host/sheet.js) prepares the draft and What you sign shows it. No clock. No DOM, no store.
import { t } from '../i18n/words.js';

const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = v => typeof v === 'number' && Number.isFinite(v);
// a seed's figure as the string a field shows
const figure = v => (isNum(v) ? String(v) : typeof v === 'string' ? v : '');
// the cap the Account takes: dollars to the cent, at most seven digits before the point
const CAP = /^\d{1,7}(\.\d{1,2})?$/;
// the leverage steps the retired page offers, its figure now among them
const STEPS = [1, 2, 3, 5, 10, 20];
const leverageNow = s => (isNum(s.max) && s.max >= 1 ? s.max : Number(s.max) >= 1 ? Number(s.max) : 1);
const stepsOf = s => [...new Set([...STEPS, leverageNow(s)])].sort((a, b) => a - b);

/** The Rules tab's sheet kinds. */
export const RULES_KINDS = ['beast', 'cap', 'session', 'leverageCap'];

/** The sheet's title. */
export function rulesTitleOf(kind) {
  switch (kind) {
    case 'beast': return t('sheet.title.beast');
    case 'cap': return t('rules.cap.head');
    case 'session': return t('rules.session.head');
    case 'leverageCap': return t('rules.leverage.head');
    default: return '';
  }
}

/** The sheet's go key: a session that ended starts a new one. */
export function rulesGoOf(kind, seed) {
  const s = isRecord(seed) ? seed : {};
  switch (kind) {
    case 'beast': return t('sheet.go.beast');
    case 'cap': return t('sheet.go.cap');
    case 'session': return s.ended === true ? t('rules.session.start') : t('rules.session.renew');
    case 'leverageCap': return t('sheet.go.leverage');
    default: return '';
  }
}

/** The sheet's fields, each `{ name, label, type, options?, value }`: the cap's dollars, the cap now to begin with; their
 *  leverage's step, now's pressed. */
export function rulesFieldsOf(kind, seed) {
  const s = isRecord(seed) ? seed : {};
  switch (kind) {
    case 'cap': return [{ name: 'cap', label: t('sheet.field.dollars'), type: 'number', value: figure(s.capUsd) }];
    case 'leverageCap': return [{
      name: 'max', label: t('rules.leverage.head'), type: 'seg', options: stepsOf(s).map(n => ({ value: String(n), label: `${n}x` })), value: String(leverageNow(s)),
    }];
    default: return [];
  }
}

// a field's value from the form: the sheet's fields, or a plain { name: value }; trimmed text, else ''
function text(fields, name) {
  const v = Array.isArray(fields) ? fields.find(f => isRecord(f) && f.name === name)?.value : isRecord(fields) ? fields[name] : undefined;
  return typeof v === 'string' ? v.trim() : isNum(v) ? String(v) : '';
}

/** The Account's draft for the sheet, from its fields and its seed — or, while it would change nothing or is not one the
 *  Account takes, the words for it. */
export function rulesDraftOf(kind, fields, seed) {
  const s = isRecord(seed) ? seed : {};
  switch (kind) {
    case 'beast': return { type: 'setPolicy', change: 'mode', value: 'open' };
    case 'cap': {
      const v = text(fields, 'cap').replace(/[$,\s]/g, '');
      if (!CAP.test(v) || !(Number(v) > 0)) return t('sheet.missing.cap');
      if (isNum(s.capUsd) && Number(v) === s.capUsd) return t('sheet.missing.capNow');
      return { type: 'setPolicy', change: 'cap', value: v };
    }
    case 'session': return { type: 'setPolicy', change: 'session', value: '30d' };
    case 'leverageCap': {
      const picked = text(fields, 'max');
      const n = stepsOf(s).find(step => String(step) === picked);
      if (n === undefined) return t('sheet.missing.step');
      if (n === leverageNow(s)) return t('sheet.missing.leverageNow');
      return { type: 'setPolicy', change: 'maxLeverage', value: String(n) };
    }
    default: return t('sheet.nothingToSign');
  }
}
