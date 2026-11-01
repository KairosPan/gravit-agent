// face/client/js/host/owner-view.js — the owner device's pure words (spec 2026-10-22 §6.3, plan 2 Task 4): the standing's line
// and its one key, Settings › Devices from the page's signers, What you sign from a preparation's `shown`, the countdown, and
// the Account's own reading of an answer (docs/research/2026-10-22-account-owner-path-map.md §2.6–§2.7) — refused or not, its
// sentence, what it offers, what it said. Every Account string passes as it came (the renderer escapes). No DOM, no store.
import { pageOk } from './account-view.js';

const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const records = v => (Array.isArray(v) ? v.filter(isRecord) : []);
const str = v => (typeof v === 'string' ? v : '');

const STANDING = new Map([
  ['signs', { line: 'This page signs for the account', key: null }],
  ['pending', { line: 'Waiting to be let in — a browser that signs lets it in, under Settings › Devices', key: null }],
  ['needs-code', { line: 'Pair with the code the Account printed in its terminal', key: 'pair' }],
  ['signed-out', { line: 'Signed out', key: 'signIn' }],
  ['none', { line: 'This browser cannot sign for the account', key: null }],
]);

/** The device line under the Account head's chips, and its one key: `pair` (the code box) or `signIn`. `unknown` says nothing. */
export function standingWords(owner) {
  const s = STANDING.get(owner?.role);
  return s ? { ...s } : { line: '', key: null };
}

/** Settings › Devices from the page's `signers`: the owners (this page's own `device:<kid>` marked `here`) and the devices
 *  waiting to be let in (`pendingDevices`, the page's read carries no label). Anything but the page is no devices. */
export function devicesOf(page, owner) {
  if (!pageOk(page)) return { owners: [], pending: [] };
  const mine = typeof owner?.kid === 'string' && owner.kid ? `device:${owner.kid}` : null;
  return {
    owners: records(page.signers.owners).map(o => ({ id: str(o.id), label: str(o.label), kind: str(o.kind), here: mine !== null && o.id === mine })),
    pending: records(page.signers.pendingDevices).map(d => ({ kid: str(d.kid), at: str(d.at) })),
  };
}

/** What you sign: every field the Account shows, `name: value`, in its order — the lines the signature covers. */
export function whatYouSignLines(prepared) {
  return records(prepared?.shown).map(f => `${str(f.name)}: ${str(f.value)}`);
}

/** The countdown of a preparation with a `deadline`, `Your signature is good for m:ss more.`; nothing at or under zero. A part
 *  second counts as a second, so the line never reads 0:00 while the signature is still good. */
export function goodForWords(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const s = Math.ceil(ms / 1000);
  return `Your signature is good for ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} more.`;
}

/** The Account's own refused test (its page's `refusedAt`): no answer, a 4xx or 5xx, no body, `ok: false`, or a result that is
 *  itself a refusal — a rejected card answers so on a 200. */
export function refusedAt(r) {
  return Boolean(!r || r.status >= 400 || !r.body || r.body.ok === false || (r.body.kind === 'result' && r.body.result && r.body.result.ok === false));
}

/** The Account's `why`: its refusal's sentence, else its error, else a result's message. */
export const whyOf = r => r?.body?.refusal?.message || r?.body?.error || r?.body?.result?.message || '';

const AGAIN = new Set(['E_ACCOUNT_REQUOTE', 'E_ACCOUNT_EXPIRED']);

/** A refusal for the screen: the Account's sentence (`Refused` when it gave none), `again` when preparing again is the answer
 *  (the price moved, the ten minutes passed), `standing` when the door did not take the signature (a 401: the device may be
 *  dropped) — not a card's 409 under the same code, which names a different instruction. */
export function refusalOf(r) {
  const code = r?.body?.refusal?.code ?? r?.body?.result?.code;
  return { message: whyOf(r) || 'Refused', again: AGAIN.has(code), standing: r?.status === 401 && code === 'E_ACCOUNT_BAD_SIGNATURE' };
}

const STATUS_WORDS = new Map([['open', 'open on the book'], ['filled', 'filled'], ['canceled', 'canceled']]);

/** What a taken action said: an order by its id and its status (`ord-0011 · open on the book`), the Account's summary, `Done`
 *  for a result. */
export function saidOf(body) {
  if (body?.kind === 'order' && isRecord(body.order)) {
    const status = str(body.order.status);
    return `${str(body.order.id)} · ${STATUS_WORDS.get(status) ?? status}`;
  }
  if (body?.kind === 'account') return str(body.summary);
  if (body?.kind === 'result') return 'Done';
  return '';
}
