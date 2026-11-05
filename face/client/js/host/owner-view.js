// face/client/js/host/owner-view.js — the owner device's pure words (spec 2026-10-22 §6.3, plan 2 Task 4): the standing's line
// and its one key, Settings › Devices from the page's signers, What you sign from a preparation's `shown`, the countdown, and
// the Account's own reading of an answer (docs/research/2026-10-22-account-owner-path-map.md §2.6–§2.7) — refused or not, its
// sentence, what it offers, what it said. Every Account string passes as it came (the renderer escapes). No DOM, no store.
import { pageOk } from './account-view.js';
import { t } from '../i18n/words.js';

const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const records = v => (Array.isArray(v) ? v.filter(isRecord) : []);
const str = v => (typeof v === 'string' ? v : '');

/** The device line under the Account head's chips, and its one key: `pair` (the code box) or `signIn`. `unknown` says nothing. */
export function standingWords(owner) {
  switch (owner?.role) {
    case 'signs': return { line: t('owner.standing.signs'), key: null };
    case 'pending': return { line: t('owner.standing.pending'), key: null };
    case 'needs-code': return { line: t('owner.standing.needsCode'), key: 'pair' };
    case 'signed-out': return { line: t('owner.standing.signedOut'), key: 'signIn' };
    case 'none': return { line: t('owner.standing.none'), key: null };
    default: return { line: '', key: null };
  }
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
  return t('owner.goodFor', { left: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` });
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
  return { message: whyOf(r) || t('owner.refused'), again: AGAIN.has(code), standing: r?.status === 401 && code === 'E_ACCOUNT_BAD_SIGNATURE' };
}

// an order's status in words; another as the Account said it
function statusWords(status) {
  switch (status) {
    case 'open': return t('owner.order.open');
    case 'filled': return t('owner.order.filled');
    case 'canceled': return t('owner.order.canceled');
    default: return status;
  }
}

/** What a taken action said: an order by its id and its status (`ord-0011 · open on the book`), the Account's summary, `Done`
 *  for a result. */
export function saidOf(body) {
  if (body?.kind === 'order' && isRecord(body.order)) {
    const status = str(body.order.status);
    return `${str(body.order.id)} · ${statusWords(status)}`;
  }
  if (body?.kind === 'account') return str(body.summary);
  if (body?.kind === 'result') return t('owner.done');
  return '';
}
