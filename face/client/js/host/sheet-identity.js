// face/client/js/host/sheet-identity.js — Account › Identity's signed sheets (plan B1b Tasks 2–3; Slack's words plan B2 Task 7):
// connectNetwork, sheet 4 of Connect Telegram, Slack or iMessage (What you sign: the pending connection the account checked with Telegram and heard Say hi on, its bot, its operator, the
// routing a fresh connection sends and the token's fingerprint, never the token); and Task 3's three: disconnectNetwork (Disconnect
// Telegram: the binding and its token gone), routing (What reaches you where: the grid's ticks as the account's routing string, and
// quiet hours as two clocks or Off, which the account stores as null) and block (a stranger in Not you, by its reference).
// Each sheet is the account's own owner type (account/src/portfolio/account/sign.ts OwnerAction), every field from the seed. The
// sheet draws its lines above its fields and its numbered steps above its keys (render/owner.js). host/sheet-view.js delegates the
// kinds here; the sheet engine (host/sheet.js) prepares the draft and What you sign shows it. No clock. No DOM, no store.
import { routeRows, formatRouting, NETWORKS, SPOKEN } from './identity-view.js';
import { HOST_NAME } from '../wire/speaker.js';
import { t } from '../i18n/words.js';

const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = v => (typeof v === 'string' ? v : '');

/** Identity's sheet kinds; the disconnect is its own kind, never the Venues' `disconnect`. */
export const IDENTITY_KINDS = ['connectNetwork', 'disconnectNetwork', 'routing', 'block'];

/** Sheet 4's numbered steps (spec §5.2), fixed copy. */
export const connectSteps4 = () => [t('sheet.identity.read'), t('sheet.identity.sign'), t('sheet.identity.stop')];

/** Sheet 4's note under its steps, Slack's alone (the plan's ruling 5: Slack's composer takes a leading / as its own), fixed copy. */
export const slackSteps4Note = () => t('sheet.identity.slackNote');

// a disconnect or a block names one of the networks the account speaks on (identity-view.js SPOKEN, kinds.ts NETWORKS); their names
// (identity-view.js NETWORKS)
const NETWORK_NAME = Object.fromEntries(NETWORKS.filter(([id]) => SPOKEN.includes(id)));
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
// a network's name, Telegram's for one the account does not speak on
const networkName = id => NETWORK_NAME[str(id)] ?? NETWORK_NAME.telegram;

/** The words of Task 3's sheets that refuse or change nothing, fixed copy, read at the call. */
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

/** The sheet's title. */
export function identityTitleOf(kind, seed) {
  const s = isRecord(seed) ? seed : {};
  switch (kind) {
    case 'connectNetwork': return t('sheet.identity.title', { network: networkName(s.network) });
    case 'disconnectNetwork': return t('sheet.identity.disconnect', { network: networkName(s.network) });
    case 'routing': return t('identity.grid.title');
    case 'block': return str(s.masked) ? t('sheet.identity.block', { sender: s.masked }) : t('sheet.identity.blockAny');
    default: return '';
  }
}

/** The sheet's go key. */
export function identityGoOf(kind) {
  switch (kind) {
    case 'connectNetwork': return t('sheet.identity.goConnect');
    case 'disconnectNetwork': return t('sheet.identity.goDisconnect');
    case 'routing': return t('sheet.identity.goRouting');
    case 'block': return t('sheet.identity.goBlock');
    default: return '';
  }
}

// the seed's quiet hours: two clocks, or null for off
const quietOf = s => (isRecord(s.quiet) && CLOCK.test(str(s.quiet.from)) && CLOCK.test(str(s.quiet.to)) ? { from: s.quiet.from, to: s.quiet.to } : null);

/** The sheet's fields: the routing sheet's quiet hours, two clocks and Off, from the seed's quiet hours; the other kinds' are all
 *  their seed's, so none is typed. */
export function identityFieldsOf(kind, seed) {
  const s = isRecord(seed) ? seed : {};
  if (kind !== 'routing') return [];
  const q = quietOf(s);
  return [
    { name: 'quietFrom', label: t('sheet.identity.quietFrom'), type: 'time', value: q ? q.from : '' },
    { name: 'quietTo', label: t('sheet.identity.quietTo'), type: 'time', value: q ? q.to : '' },
    { name: 'quietOff', label: t('sheet.identity.quietOff'), type: 'check', value: q === null },
  ];
}

// a field's value from the form: the sheet's fields, or a plain { name: value }
function valueOf(fields, name) {
  if (Array.isArray(fields)) return fields.find(f => isRecord(f) && f.name === name)?.value;
  return isRecord(fields) ? fields[name] : undefined;
}
const clockOf = (fields, name) => { const v = valueOf(fields, name); return typeof v === 'string' ? v.trim() : ''; };
const ticked = (fields, name) => { const v = valueOf(fields, name); return v === true || v === 'true'; };

/** The lines drawn above the sheet's fields: what the account will hold to. */
export function identityLinesOf(kind, seed) {
  const s = isRecord(seed) ? seed : {};
  switch (kind) {
    case 'connectNetwork': {
      const network = str(s.network) || 'telegram';
      const sends = rowsSentOn(s.routing, network);
      const imessage = network === 'imessage';
      // iMessage's: via Photon, and the project secret kept in the account by its fingerprint (the account's: keyHash's first 8)
      const kept = imessage ? t('sheet.identity.keptInAccount', { fingerprint: str(s.keyHash).slice(0, 8) || '—' })
        : network === 'slack' ? t('sheet.identity.keptInBoth') : t('sheet.identity.keptIn');
      return [
        t('sheet.identity.network', { network: NETWORK_NAME[network] ?? network }),
        ...(imessage ? [t('identity.viaPhoton')] : []),
        t('sheet.identity.speaksAs', { who: str(s.speaksAs) || '—' }),
        t('sheet.identity.talksWith', { who: str(s.talksOnlyWith) || '—' }),
        sends.length ? t('sheet.identity.maySend', { rows: sends.join(t('common.list.sep')) }) : t('sheet.identity.maySendNone'),
        kept,
        t('sheet.identity.signedBy'),
        t('sheet.identity.until'),
      ];
    }
    case 'disconnectNetwork': {
      const net = str(s.network);
      const network = networkName(s.network);
      const gone = net === 'slack' ? t('sheet.identity.tokensGone') : net === 'imessage' ? t('sheet.identity.secretGone') : t('sheet.identity.tokenGone');
      return [t('sheet.identity.stops', { name: HOST_NAME, network }), gone, t('sheet.identity.deskKeeps')];
    }
    case 'routing': {
      // a line for each network the seed names connected (none named: Telegram's alone, as before Slack)
      const nets = Array.isArray(s.networks) ? SPOKEN.filter(n => s.networks.includes(n)) : ['telegram'];
      const routing = formatRouting(s.routing);
      return nets.map(n => {
        const sends = rowsSentOn(routing, n);
        const network = NETWORK_NAME[n];
        return sends.length ? t('sheet.identity.on', { network, rows: sends.join(t('common.list.sep')) }) : t('sheet.identity.onNone', { network });
      });
    }
    case 'block': return [str(s.masked) ? t('sheet.identity.dropped', { sender: s.masked }) : t('sheet.identity.droppedAny')];
    default: return [];
  }
}

/** The numbered steps drawn above the sheet's keys. */
export function identityStepsOf(kind, _seed) {
  switch (kind) {
    case 'connectNetwork': return connectSteps4();
    default: return [];
  }
}

/** The note drawn under the steps: Slack's sheet 4 (its ! commands) and Disconnect iMessage (the Photon registration stays); '' for
 *  the rest. */
export function identityNoteOf(kind, seed) {
  const network = isRecord(seed) ? seed.network : '';
  if (kind === 'connectNetwork' && network === 'slack') return slackSteps4Note();
  if (kind === 'disconnectNetwork' && network === 'imessage') return t('sheet.identity.photonStays');
  return '';
}

const HEX64 = /^[0-9a-f]{64}$/;
const HEX32 = /^[0-9a-f]{32}$/;

/** The account's draft for the sheet, from its seed — or, while the seed cannot be signed, the words for it. */
export function identityDraftOf(kind, fields, seed) {
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
    default: return t('sheet.nothingToSign');
  }
}
