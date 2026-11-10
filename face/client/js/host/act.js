// face/client/js/host/act.js — the account's unsigned door through the face's proxy (sign-only-money §5.1-§5.3): one action, no
// signature, for the acts that move no money — Identity's four (connectNetwork, disconnectNetwork, setRouting, blockSender) and
// opening a paper account. The account applies it or refuses it in its own words (409 `{ ok: false, refusal }`); no key, no
// prepare, no What you sign. No DOM, no store.
import { refusedAt, whyOf } from './owner-view.js';
import { said } from '../i18n/words.js';

/** The face's route to the account's unsigned door. */
export const ACT = '/data/account/act';

/** `action` posted once through `post` (host/owner.js postVia's shape: `{ status, body }`, never throwing — a throw is taken as no
 *  answer): `{ ok: true, body }` when the account took it, else `{ ok: false, said }`, the account's sentence (a line: its words,
 *  or the face's when it gave none). */
export async function postAct(post, action) {
  let r = null;
  try { r = await post(ACT, { action }); } catch { r = null; }
  if (r && !refusedAt(r)) return { ok: true, body: r.body };
  return { ok: false, said: whyOf(r) || (r ? said('owner.refused') : said('account.noAnswer')) };
}
