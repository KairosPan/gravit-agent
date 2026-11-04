// face/client/js/host/sheet-identity.js — Account › Identity's signed sheets (plan B1b Tasks 2–3; Slack's words plan B2 Task 7):
// connectNetwork, sheet 4 of Connect Telegram or Connect Slack (What you sign: the pending connection the account checked with Telegram and heard Say hi on, its bot, its operator, the
// routing a fresh connection sends and the token's fingerprint, never the token); and Task 3's three: disconnectNetwork (Disconnect
// Telegram: the binding and its token gone), routing (What reaches you where: the grid's ticks as the account's routing string, and
// quiet hours as two clocks or Off, which the account stores as null) and block (a stranger in Not you, by its reference).
// Each sheet is the account's own owner type (account/src/portfolio/account/sign.ts OwnerAction), every field from the seed. The
// sheet draws its lines above its fields and its numbered steps above its keys (render/owner.js). host/sheet-view.js delegates the
// kinds here; the sheet engine (host/sheet.js) prepares the draft and What you sign shows it. No clock. No DOM, no store.
import { ROUTE_ROWS, SPOKEN, formatRouting } from './identity-view.js';

const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = v => (typeof v === 'string' ? v : '');

/** Identity's sheet kinds; the disconnect is its own kind, never the Venues' `disconnect`. */
export const IDENTITY_KINDS = ['connectNetwork', 'disconnectNetwork', 'routing', 'block'];

/** Sheet 4's numbered steps (spec §5.2), fixed copy. */
export const CONNECT_STEPS_4 = [
  'Read each line: it is what the account will hold to.',
  "Sign with this browser's key. Only then does the account keep the token and start delivering.",
  'To stop, use Disconnect… in Account › Identity.',
];

/** Sheet 4's note under its steps, Slack's alone (the plan's ruling 5: Slack's composer takes a leading / as its own), fixed copy. */
export const SLACK_STEPS_4_NOTE = "On Slack, type the phone's commands with ! — !status, !pause 30m, !mute 30m, !new, !stop.";

const NETWORK_NAME = { telegram: 'Telegram', slack: 'Slack' };
// a disconnect or a block names one of the networks the account speaks on (identity-view.js SPOKEN, kinds.ts NETWORKS)
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The words of Task 3's sheets that refuse or change nothing, fixed copy. */
export const IDENTITY_WORDS = {
  quietEqual: 'Quiet hours start and end at different times',
  quietTimes: 'Pick when quiet hours start and end, or tick Off',
  unchanged: 'That is how it is now',
  noNetwork: 'Nothing connected to disconnect here',
  noSender: 'No sender to block here',
};

/** The rows a routing string (`chat=telegram;alerts=;…`) sends on `network`, as their words, in the routing's order. */
export function rowsSentOn(routing, network) {
  const on = new Map(str(routing).split(';').map(part => {
    const i = part.indexOf('=');
    return i < 0 ? [part, []] : [part.slice(0, i), part.slice(i + 1).split(',').filter(Boolean)];
  }));
  return ROUTE_ROWS.filter(([row]) => (on.get(row) ?? []).includes(network)).map(([, words]) => words);
}

/** The sheet's title. */
export function identityTitleOf(kind, seed) {
  const s = isRecord(seed) ? seed : {};
  switch (kind) {
    case 'connectNetwork': return `Connect ${NETWORK_NAME[str(s.network)] ?? 'Telegram'} · 4 of 4 · What you sign`;
    case 'disconnectNetwork': return `Disconnect ${NETWORK_NAME[str(s.network)] ?? 'Telegram'}`;
    case 'routing': return 'What reaches you where';
    case 'block': return `Block ${str(s.masked) || 'this sender'}`;
    default: return '';
  }
}

/** The sheet's go key. */
export function identityGoOf(kind) {
  switch (kind) {
    case 'connectNetwork': return "Sign with this browser's key";
    case 'disconnectNetwork': return 'Sign disconnect';
    case 'routing': return 'Sign';
    case 'block': return 'Sign block';
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
    { name: 'quietFrom', label: 'Quiet from (New York)', type: 'time', value: q ? q.from : '' },
    { name: 'quietTo', label: 'Quiet until (New York)', type: 'time', value: q ? q.to : '' },
    { name: 'quietOff', label: 'Off: no quiet hours', type: 'check', value: q === null },
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
      return [
        `Network: ${NETWORK_NAME[network] ?? network}`,
        `Speaks as: ${str(s.speaksAs) || '—'}`,
        `Talks only with: ${str(s.talksOnlyWith) || '—'}`,
        `May send: ${sends.length ? sends.join(', ') : 'nothing yet'}`,
        `${network === 'slack' ? 'Tokens' : 'Token'} kept in: Account · :4820`,
        'Signed by: this browser',
        'Until: you disconnect',
      ];
    }
    case 'disconnectNetwork': {
      const slack = str(s.network) === 'slack';
      const name = NETWORK_NAME[str(s.network)] ?? 'Telegram';
      return [`Gravit stops reading and sending on ${name}.`, slack ? 'Both tokens are deleted from the account.' : 'The token is deleted from the account.', 'The desk keeps working in the face.'];
    }
    case 'routing': {
      // a line for each network the seed names connected (none named: Telegram's alone, as before Slack)
      const nets = Array.isArray(s.networks) ? SPOKEN.filter(n => s.networks.includes(n)) : ['telegram'];
      const routing = formatRouting(s.routing);
      return nets.map(n => { const sends = rowsSentOn(routing, n); return `On ${NETWORK_NAME[n]}: ${sends.length ? sends.join(', ') : 'nothing'}`; });
    }
    case 'block': return [`Messages from ${str(s.masked) || 'this sender'} are dropped and no longer counted.`];
    default: return [];
  }
}

/** The numbered steps drawn above the sheet's keys. */
export function identityStepsOf(kind, _seed) {
  switch (kind) {
    case 'connectNetwork': return CONNECT_STEPS_4;
    default: return [];
  }
}

/** The note drawn under the steps: Slack's sheet 4 alone; '' for the rest. */
export function identityNoteOf(kind, seed) {
  return kind === 'connectNetwork' && isRecord(seed) && seed.network === 'slack' ? SLACK_STEPS_4_NOTE : '';
}

const HEX64 = /^[0-9a-f]{64}$/;
const HEX32 = /^[0-9a-f]{32}$/;

/** The account's draft for the sheet, from its seed — or, while the seed cannot be signed, the words for it. */
export function identityDraftOf(kind, fields, seed) {
  const s = isRecord(seed) ? seed : {};
  switch (kind) {
    case 'connectNetwork': {
      const need = ['pending', 'botId', 'speaksAs', 'operatorId', 'talksOnlyWith', 'routing'];
      if (need.some(k => str(s[k]) === '')) return 'This connection is not complete: start again.';
      if (!HEX64.test(str(s.keyHash)) || !HEX32.test(str(s.salt))) return 'This connection is not complete: start again.';
      return {
        type: 'connectNetwork', network: str(s.network) || 'telegram', pending: s.pending, botId: s.botId, speaksAs: s.speaksAs,
        operatorId: s.operatorId, talksOnlyWith: s.talksOnlyWith, routing: s.routing, keyHash: s.keyHash, salt: s.salt,
      };
    }
    case 'disconnectNetwork': {
      const network = str(s.network);
      if (!SPOKEN.includes(network)) return IDENTITY_WORDS.noNetwork;
      return { type: 'disconnectNetwork', network };
    }
    case 'routing': {
      const routing = formatRouting(s.routing);
      const off = ticked(fields, 'quietOff');
      const from = off ? '' : clockOf(fields, 'quietFrom');
      const to = off ? '' : clockOf(fields, 'quietTo');
      if (!off && (!CLOCK.test(from) || !CLOCK.test(to))) return IDENTITY_WORDS.quietTimes;
      if (!off && from === to) return IDENTITY_WORDS.quietEqual;
      // the account's routing as it is (`saved`, its string; none given, the seed's routing is the account's) and its quiet hours
      const saved = typeof s.saved === 'string' && s.saved ? s.saved : routing;
      const q = quietOf(s);
      const sameQuiet = off ? q === null : q !== null && q.from === from && q.to === to;
      if (routing === saved && sameQuiet) return IDENTITY_WORDS.unchanged;
      // quiet hours off are both ends empty, which the account stores as null
      return { type: 'setRouting', routing, quietFrom: from, quietTo: to };
    }
    case 'block': {
      const network = str(s.network), sender = str(s.sender), masked = str(s.masked);
      if (!SPOKEN.includes(network) || !sender || !masked) return IDENTITY_WORDS.noSender;
      return { type: 'blockSender', network, sender, masked };
    }
    default: return 'Nothing to sign here';
  }
}
