// face/client/js/render/wallet-row.js — a row waiting for the operator's own browser wallet (plan 4b Task 1), drawn by Trade's
// Under way and the Account's Money tab alike; its own module so neither screen's renderer imports the other's.
import { esc, attrs } from '../html.js';

const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = v => (typeof v === 'string' ? v : '');

// a row waiting for the operator's own browser wallet (a DEX order, a payment the Account built): Waiting for your wallet, what
// the last send said (host/wallet-send.js, by its key), and — on a page that signs — Send from wallet…, or Report again where a
// hash was sent: one this page keeps (it reports that hash), or one the Account already holds (the send asks the Account
// again and reports it); neither ever sends again; disabled while one is in the air. An order keeps its Cancel beside it
export function walletRow(what, id, key, data, reported, sends, signs, cancel) {
  const at = key && isRecord(sends) && isRecord(sends[key]) ? sends[key] : null;
  const said = at && str(at.said) ? `<span class="tk-why">${esc(at.said)}</span>` : '';
  const sending = at?.status === 'sending';
  const keyOf = !signs ? '' : at?.again === true
    ? `<button type="button"${attrs({ class: 'btn-sm', 'data-action': 'reportAgain', 'data-key': key, disabled: sending })}>Report again</button>`
    : `<button type="button"${attrs({ class: 'btn-sm', 'data-action': 'sendFromWallet', ...data, disabled: sending })}>${reported ? 'Report again' : 'Send from wallet…'}</button>`;
  return `<tr><td><b>${esc(what)}</b><span class="tk-why">${esc(['Waiting for your wallet', id].filter(Boolean).join(' · '))}</span>${said}</td><td class="r">${keyOf}${cancel}</td></tr>`;
}

