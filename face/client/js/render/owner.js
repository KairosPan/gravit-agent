// face/client/js/render/owner.js — the owner device on the screen (spec 2026-10-22 §6.3, plan 2 Task 6): the device line under
// the Account head's chips with its one key (the pair box, Sign in), Settings › Devices, and the sheet — the Account's own
// prepare → What you sign → sign (`quoteDialog`, docs/research/2026-10-22-account-owner-path-map.md §3) drawn as a drawer: its
// fields by type, the quote box, What you sign verbatim, the signature's minutes, what the Account said, Cancel and the go key.
// Every word is a view's (host/owner-view.js, host/sheet-view.js) or the Account's; this module draws them.
import { esc, attrs, cls } from '../html.js';
import { fmtDate } from '../time.js';
import { pageOk } from '../host/account-view.js';
import { standingWords, devicesOf, whatYouSignLines, goodForWords } from '../host/owner-view.js';
import { titleOf, goWord } from '../host/sheet-view.js';
import { askedOf } from '../host/sheet.js';
import { seg } from './controls.js';

const note = text => `<p class="acct-note">${esc(text)}</p>`;
const key = (action, word, data = {}) => `<button${attrs({ type: 'button', class: 'btn-sm', 'data-action': action, ...data })}>${esc(word)}</button>`;

// ── the device line ──

/** The device line under the Account head's chips: the standing's one muted line (the Account's refusal to the device on it),
 *  and its key — the pair box for a page that needs the code, Sign in for a page signed out. A standing not known: nothing. */
export function renderDeviceLine(state) {
  const owner = state.owner;
  const w = standingWords(owner);
  if (!w.line) return '';
  const line = note([w.line, typeof owner?.refusal === 'string' ? owner.refusal : ''].filter(Boolean).join(' · '));
  const busy = owner?.busy === true;
  if (w.key === 'pair') {
    return `${line}<div class="pair-box"><input${attrs({ id: 'pair-code', class: 'input small', type: 'text', autocomplete: 'off', 'aria-label': 'Pairing code' })}>` +
      `${key('pairDevice', 'Pair', { disabled: busy })}</div>`;
  }
  if (w.key === 'signIn') return `${line}<div class="btn-row">${key('signIn', 'Sign in', { disabled: busy })}</div>`;
  return line;
}

// ── Settings › Devices ──

/** Settings › Devices from the page's signers: each owner `label · id`, this page's own marked `this page`; each device waiting
 *  `kid · since <date>`, with Let it sign — and Sign out — only for a page that signs. No page read: nothing. */
export function renderDevices(state) {
  if (!pageOk(state.account?.data)) return '';
  const owner = state.owner;
  const signs = owner?.role === 'signs';
  const d = devicesOf(state.account.data, owner);
  const owners = d.owners.map(o => `<div class="dsec-line">${esc([o.label, o.id, o.here ? 'this page' : ''].filter(Boolean).join(' · '))}</div>`).join('');
  const pending = d.pending.map(p => {
    const t = Date.parse(p.at);
    const words = [p.kid, Number.isNaN(t) ? '' : `since ${fmtDate(t)}`].filter(Boolean).join(' · ');
    return `<div class="venue"><span>${esc(words)}</span>${signs ? key('letDevice', 'Let it sign', { 'data-kid': p.kid }) : ''}</div>`;
  }).join('');
  return `<div class="dsec"><div class="dsec-label">Devices</div>${owners}${pending}${signs ? `<div class="btn-row">${key('signOut', 'Sign out')}</div>` : ''}</div>`;
}

// ── the sheet ──

// a field by its type, every control naming its field and answering sheetField
function field(f) {
  const label = esc(f.label);
  const options = Array.isArray(f.options) ? f.options : [];
  switch (f.type) {
    case 'seg':
      return `<div class="field"><span class="field-label">${label}</span>${seg(options.map(o => [o.label, o.value]), f.value, 'sheetField', { name: f.name })}</div>`;
    case 'pick': {
      const ticked = new Set(Array.isArray(f.value) ? f.value : []);
      const boxes = options.map(o => `<label class="sheet-check"><input${attrs({ type: 'checkbox', name: f.name, value: o.value, checked: ticked.has(o.value), 'data-action': 'sheetField' })}>${esc(o.label)}</label>`).join('');
      return `<div${attrs({ class: 'field', role: 'group', 'aria-label': f.label })}><span class="field-label">${label}</span>${boxes}</div>`;
    }
    case 'check':
      return `<label class="sheet-check"><input${attrs({ type: 'checkbox', name: f.name, value: 'true', checked: f.value === true || f.value === 'true', 'data-action': 'sheetField' })}>${label}</label>`;
    case 'select': {
      // a value no option has (nothing picked yet) is an empty option the box shows, never the first option it would not send
      const known = options.some(o => o.value === f.value);
      const items = (known ? '' : '<option value="" selected disabled></option>') +
        options.map(o => `<option${attrs({ value: o.value, selected: o.value === f.value })}>${esc(o.label)}</option>`).join('');
      return `<label class="field"><span class="field-label">${label}</span><select${attrs({ class: 'input', name: f.name, 'data-action': 'sheetField' })}>${items}</select></label>`;
    }
    default:
      // a number is typed as text: the Account takes the dollars as the string typed
      return `<label class="field"><span class="field-label">${label}</span><input${attrs({
        class: 'input', type: 'text', name: f.name, value: typeof f.value === 'string' ? f.value : '', placeholder: f.placeholder || null,
        inputmode: f.type === 'number' ? 'decimal' : null, autocomplete: 'off', 'data-action': 'sheetField',
      })}></label>`;
  }
}

// the quote box: what is missing, asking, the Account's refusal (Prepare again when that is the answer), or the quote's words
function quoteBox(s) {
  let inner = '';
  if (s.status === 'incomplete') inner = note(s.words || 'Fill it in to see what it would be.');
  else if (s.status === 'asking') inner = note('Asking…');
  else if (s.status === 'refused') inner = `${note(s.message)}${s.again ? `<div class="btn-row">${key('sheetAgain', 'Prepare again')}</div>` : ''}`;
  else if (typeof s.prepared?.quote?.words === 'string' && s.prepared.quote.words) inner = `<b>${esc(s.prepared.quote.words)}</b>`;
  return inner ? `<div class="sheet-quote">${inner}</div>` : '';
}

/** The open sheet as a drawer: its title, its fields, the quote box, the signature's minutes, What you sign (dimmed while the form
 *  is not the draft the shown preparation was asked for), what the Account said, Cancel and the go key — on only while the sheet
 *  is ready and the form's draft is the one asked for. No sheet open: nothing. */
export function renderSheet(state, now) {
  const s = state.sheet;
  if (!s) return '';
  const title = titleOf(s.kind, s.seed);
  const fields = (Array.isArray(s.fields) ? s.fields : []).filter(f => f && typeof f.name === 'string').map(field).join('');
  const current = s.asked !== null && askedOf(s) === s.asked;
  const live = s.status === 'ready' && current;
  const left = s.deadline !== null && (s.status === 'ready' || s.status === 'signing') ? goodForWords(s.deadline - now) : '';
  const lines = s.prepared ? whatYouSignLines(s.prepared) : [];
  const signs = lines.length
    ? `<details${attrs({ class: cls('acct-shown', s.status === 'ready' && !current && 'stale') })}><summary>What you sign</summary>${lines.map(l => `<div class="dsec-line">${esc(l)}</div>`).join('')}</details>`
    : '';
  const said = s.status === 'done' && s.said ? note(s.said) : '';
  const keys = `<div class="btn-row">${key('sheetClose', 'Cancel')}<button${attrs({ type: 'button', class: 'btn-primary', 'data-action': 'sheetSubmit', disabled: !live })}>${esc(goWord(s.kind, s.seed))}</button></div>`;
  return `<aside${attrs({ class: 'drawer sheet', 'aria-label': title })}><div class="drawer-head"><h2>${esc(title)}</h2><button type="button" class="close-key" data-action="sheetClose" aria-label="Close">×</button></div>` +
    `<div class="drawer-body">${fields}${quoteBox(s)}${left ? `<p class="sheet-left">${esc(left)}</p>` : ''}${signs}${said}${keys}</div></aside>`;
}
