// face/client/js/host/sheet-identity.js — Account › Identity's signed sheets (plan B1b Tasks 2–3): connectNetwork, sheet 4 of Connect
// Telegram (What you sign: the pending connection the account checked with Telegram and heard Say hi on, its bot, its operator, the
// routing a fresh connection sends and the token's fingerprint, never the token); disconnectNetwork, routing and block are Task 3's.
// Each sheet is the account's own owner type (account/src/portfolio/account/sign.ts OwnerAction), every field from the seed. The
// sheet draws its lines above its fields and its numbered steps above its keys (render/owner.js). host/sheet-view.js delegates the
// kinds here; the sheet engine (host/sheet.js) prepares the draft and What you sign shows it. No clock. No DOM, no store.
import { ROUTE_ROWS } from './identity-view.js';

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

const NETWORK_NAME = { telegram: 'Telegram' };

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
    case 'connectNetwork': return 'Connect Telegram · 4 of 4 · What you sign';
    // Task 3's sheets (their titles the plan's)
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

/** The sheet's fields: connectNetwork's are all its seed's, so none is typed. */
export function identityFieldsOf() {
  return [];
}

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
        'Token kept in: Account · :4820',
        'Signed by: this browser',
        'Until: you disconnect',
      ];
    }
    default: return [];
  }
}

/** The numbered steps drawn above the sheet's keys. */
export function identityStepsOf(kind) {
  switch (kind) {
    case 'connectNetwork': return CONNECT_STEPS_4;
    default: return [];
  }
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
    default: return 'Nothing to sign here';
  }
}
