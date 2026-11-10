// face/client/js/host/sheet-identity.js — Account › Identity's four acts as the account's actions (plan B1b Tasks 2–3; since
// sign-only-money, unsigned: host/identity.js posts them through host/act.js, no owner sheet and no What you sign): connectNetwork
// (This is me on Connect's sheet 3: the pending connection the account checked and heard Say hi on, its bot, its operator, the
// routing a fresh connection sends and the token's fingerprint, never the token), disconnectNetwork (Disconnect…: the binding and
// its token gone), setRouting (What reaches you where's Save: the grid's ticks as the account's routing string, and quiet hours as
// two clocks or Off, which the account stores as null) and blockSender (a stranger in Not you, by its reference). Each is the
// account's own type (account/src/portfolio/account/sign.ts OwnerAction), every field from the seed. No clock. No DOM, no store.
import { routeRows, formatRouting, SPOKEN } from './identity-view.js';
import { t } from '../i18n/words.js';

const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = v => (typeof v === 'string' ? v : '');

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The words of an act that would refuse or change nothing, fixed copy, read at the call. */
export const identityWords = () => ({
  quietEqual: t('sheet.identity.quietEqual'),
  quietTimes: t('sheet.identity.quietTimes'),
  unchanged: t('sheet.identity.unchanged'),
  noNetwork: t('sheet.identity.noNetwork'),
  noSender: t('sheet.identity.noSender'),
});

/** The rows a routing string (`chat=telegram;alerts=;…`) sends on `network`, as their words, in the routing's order. */
export function rowsSentOn(routing, network) {
  const on = new Map(str(routing).split(';').map(part => {
    const i = part.indexOf('=');
    return i < 0 ? [part, []] : [part.slice(0, i), part.slice(i + 1).split(',').filter(Boolean)];
  }));
  return routeRows().filter(([row]) => (on.get(row) ?? []).includes(network)).map(([, words]) => words);
}

// the seed's quiet hours: two clocks, or null for off
const quietOf = s => (isRecord(s.quiet) && CLOCK.test(str(s.quiet.from)) && CLOCK.test(str(s.quiet.to)) ? { from: s.quiet.from, to: s.quiet.to } : null);

// a field's value from the form: the sheet's fields, or a plain { name: value }
function valueOf(fields, name) {
  if (Array.isArray(fields)) return fields.find(f => isRecord(f) && f.name === name)?.value;
  return isRecord(fields) ? fields[name] : undefined;
}
const clockOf = (fields, name) => { const v = valueOf(fields, name); return typeof v === 'string' ? v.trim() : ''; };
const ticked = (fields, name) => { const v = valueOf(fields, name); return v === true || v === 'true'; };

const HEX64 = /^[0-9a-f]{64}$/;
const HEX32 = /^[0-9a-f]{32}$/;

/** The account's action for an Identity act (`connectNetwork`, `disconnectNetwork`, `routing` or `block`), from its seed and, for
 *  the routing, its quiet hours' fields (`quietFrom`, `quietTo`, `quietOff`: a list of fields or a plain { name: value }) — or,
 *  while it cannot be sent, the words for it. */
export function identityActionOf(kind, seed, fields) {
  const s = isRecord(seed) ? seed : {};
  switch (kind) {
    case 'connectNetwork': {
      const need = ['pending', 'botId', 'speaksAs', 'operatorId', 'talksOnlyWith', 'routing'];
      if (need.some(k => str(s[k]) === '')) return t('sheet.identity.incomplete');
      if (!HEX64.test(str(s.keyHash)) || !HEX32.test(str(s.salt))) return t('sheet.identity.incomplete');
      return {
        type: 'connectNetwork', network: str(s.network) || 'telegram', pending: s.pending, botId: s.botId, speaksAs: s.speaksAs,
        operatorId: s.operatorId, talksOnlyWith: s.talksOnlyWith, routing: s.routing, keyHash: s.keyHash, salt: s.salt,
      };
    }
    case 'disconnectNetwork': {
      const network = str(s.network);
      if (!SPOKEN.includes(network)) return identityWords().noNetwork;
      return { type: 'disconnectNetwork', network };
    }
    case 'routing': {
      const routing = formatRouting(s.routing);
      const off = ticked(fields, 'quietOff');
      const from = off ? '' : clockOf(fields, 'quietFrom');
      const to = off ? '' : clockOf(fields, 'quietTo');
      if (!off && (!CLOCK.test(from) || !CLOCK.test(to))) return identityWords().quietTimes;
      if (!off && from === to) return identityWords().quietEqual;
      // the account's routing as it is (`saved`, its string; none given, the seed's routing is the account's) and its quiet hours
      const saved = typeof s.saved === 'string' && s.saved ? s.saved : routing;
      const q = quietOf(s);
      const sameQuiet = off ? q === null : q !== null && q.from === from && q.to === to;
      if (routing === saved && sameQuiet) return identityWords().unchanged;
      // quiet hours off are both ends empty, which the account stores as null
      return { type: 'setRouting', routing, quietFrom: from, quietTo: to };
    }
    case 'block': {
      const network = str(s.network), sender = str(s.sender), masked = str(s.masked);
      if (!SPOKEN.includes(network) || !sender || !masked) return identityWords().noSender;
      return { type: 'blockSender', network, sender, masked };
    }
    default: return '';
  }
}
