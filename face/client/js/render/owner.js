// face/client/js/render/owner.js — the owner device on the screen (spec 2026-10-22 §6.3, plan 2 Task 6): the device line under
// the Account head's chips with its one key (the pair box, Sign in), Settings › Devices, and the sheet — the Account's own
// prepare → What you sign → sign (`quoteDialog`, docs/research/2026-10-22-account-owner-path-map.md §3) drawn as a drawer: its
// fields by type, the quote box, What you sign verbatim, the signature's minutes, what the Account said, Cancel and the go key.
// Every word is a view's (host/owner-view.js, host/sheet-view.js) or the Account's; this module draws them.
import { esc, attrs, cls } from '../html.js';
import { fmtDate } from '../time.js';
import { pageOk } from '../host/account-view.js';
import { standingWords, devicesOf, whatYouSignLines, goodForWords } from '../host/owner-view.js';
import { titleOf, goWord, connectCheckOf, connectOptionOf, isWalletOption, whoOf, signOutLineOf } from '../host/sheet-view.js';
import { askedOf } from '../host/sheet.js';
import { moveHintsOf, moveSaysOf, routesWordsOf, earnHintsOf, earnSaysOf } from '../host/sheet-money.js';
import { seg } from './controls.js';

const note = text => `<p class="acct-note">${esc(text)}</p>`;
const key = (action, word, data = {}) => `<button${attrs({ type: 'button', class: 'btn-sm', 'data-action': action, ...data })}>${esc(word)}</button>`;

// ── the device line ──

/** The device line under the Account head's chips: the standing's one muted line (the Account's refusal to the device on it),
 *  and its key — the pair box for a page that needs the code, Sign in for a page signed out. A standing not known: nothing.
 *  The pair box is a form, so Enter in its one box submits it (`pairDevice` on the form's submit) as Pair does on a click. */
export function renderDeviceLine(state) {
  const owner = state.owner;
  const w = standingWords(owner);
  if (!w.line) return '';
  const line = note([w.line, typeof owner?.refusal === 'string' ? owner.refusal : ''].filter(Boolean).join(' · '));
  const busy = owner?.busy === true;
  if (w.key === 'pair') {
    return `${line}<form class="pair-box" data-action="pairDevice" autocomplete="off"><input${attrs({ id: 'pair-code', class: 'input small', type: 'text', autocomplete: 'off', 'aria-label': 'Pairing code' })}>` +
      `${key('pairDevice', 'Pair', { disabled: busy })}</form>`;
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
    // a value the sheet holds for the draft, never typed (a sign-in's state): nothing drawn
    case 'hidden':
      return '';
    case 'check':
      return `<label class="sheet-check"><input${attrs({ type: 'checkbox', name: f.name, value: 'true', checked: f.value === true || f.value === 'true', 'data-action': 'sheetField' })}>${label}</label>`;
    case 'select': {
      // a value no option has (nothing picked yet) is an empty option the box shows, never the first option it would not send
      const known = options.some(o => o.value === f.value);
      const items = (known ? '' : '<option value="" selected disabled></option>') +
        options.map(o => `<option${attrs({ value: o.value, selected: o.value === f.value, disabled: o.disabled === true })}>${esc(o.label)}</option>`).join('');
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
  // an earn's quote is the Account's quote.earn (earn.js:146)
  else if (typeof s.prepared?.quote?.earn?.words === 'string' && s.prepared.quote.earn.words) inner = `<b>${esc(s.prepared.quote.earn.words)}</b>`;
  return inner ? `<div class="sheet-quote">${inner}</div>` : '';
}

// the connect sheet's own keys (plan 4b Task 4): above the address, a tile per browser wallet this page found for the wallet
// kind — its signature fills the address — and, for a venue's sign-in, the key that starts it, or the venue's page as a link
// when no tab opened for it
function connectKeys(s, account) {
  const option = connectOptionOf(s);
  if (!option) return { above: '', below: '' };
  if (isWalletOption(option)) {
    const w = account?.connectWallet;
    const wallets = Array.isArray(w?.wallets) ? w.wallets : [];
    const asking = w?.status === 'asking';
    const tiles = wallets.map(x => `<button${attrs({ type: 'button', class: 'btn-sm', 'data-action': 'connectWallet', 'data-wallet': x.id, disabled: asking })}>${esc(`Use ${x.name}`)}</button>`).join('');
    return { above: tiles ? `<div class="btn-row">${tiles}</div>` : '', below: '' };
  }
  if (option.needs !== 'sign-in') return { above: '', below: '' };
  const who = whoOf(option);
  const si = account?.signIn;
  const mine = si?.connector === option.connector;
  const link = mine && si.status === 'waiting' && si.tab === false && si.url
    ? `<p class="sheet-hint"><a${attrs({ href: si.url, target: '_blank', rel: 'noopener noreferrer' })}>${esc(`Open ${who}'s sign-in page`)}</a>, then come back.</p>` : '';
  // off while this option's sign-in is under way or done: a second press would open a stray tab for a state never used
  const busy = mine && ['starting', 'waiting', 'ready'].includes(si.status);
  return { above: '', below: `<div class="btn-row">${key('connectSignIn', `Sign in at ${who}`, { disabled: busy })}</div>${link}` };
}

/** The open sheet as a drawer: its title, its fields (a connect sheet's check under them), the quote box, the signature's minutes, What you sign (dimmed while the form
 *  is not the draft the shown preparation was asked for), what the Account said, Cancel and the go key — on only while the sheet
 *  is ready and the form's draft is the one asked for. No sheet open: nothing. */
export function renderSheet(state, now) {
  const s = state.sheet;
  if (!s) return '';
  const title = titleOf(s.kind, s.seed, s.fields);
  const all = (Array.isArray(s.fields) ? s.fields : []).filter(f => f && typeof f.name === 'string');
  const extra = s.kind === 'connect' ? connectKeys(s, state.account) : { above: '', below: '' };
  // a connect sheet's wallet tiles sit between what to connect and the address they fill
  const fields = s.kind === 'connect'
    ? `${all.filter(f => f.name === 'connector').map(field).join('')}${extra.above}${all.filter(f => f.name !== 'connector').map(field).join('')}${extra.below}`
    : all.map(field).join('');
  const current = s.asked !== null && askedOf(s) === s.asked;
  const live = s.status === 'ready' && current;
  const left = s.deadline !== null && (s.status === 'ready' || s.status === 'signing') ? goodForWords(s.deadline - now) : '';
  const lines = s.prepared ? whatYouSignLines(s.prepared) : [];
  const signs = lines.length
    ? `<details${attrs({ class: cls('acct-shown', s.status === 'ready' && !current && 'stale') })}><summary>What you sign</summary>${lines.map(l => `<div class="dsec-line">${esc(l)}</div>`).join('')}</details>`
    : '';
  const said = s.status === 'done' && s.said ? note(s.said) : '';
  // a connect sheet's check, under its fields: the key file found or missing, the venue's reach, a browser wallet's or a
  // sign-in's words, a command line's example — the Account's words, a key file by its path, never what it holds
  const checked = s.kind === 'connect' ? connectCheckOf(s, state.account?.keyfile, state.account?.reach, { wallet: state.account?.connectWallet, signIn: state.account?.signIn }) : '';
  const check = checked ? `<p class="sheet-hint">${esc(checked)}</p>` : '';
  // a move's lines under its fields (the cap on each move, where it would go that is not served here), and a bridge's routes
  // under the quote, beside the preparation they were read for (plan 4b Task 2)
  // a sign-out's line under its box: who keeps signing once this page no longer does (plan 4b Task 6)
  const hints = [...moveHintsOf(s), ...earnHintsOf(s), signOutLineOf(s)].filter(Boolean).map(h => `<p class="sheet-hint">${esc(h)}</p>`).join('');
  const r = routesWordsOf(s, state.account?.routes);
  // the page's words under a move's quote (where it goes, Can't be undone.), only beside the preparation that is the form's
  // and an earn's (what it is worth, its yield and lock, where it lands taken out: plan 4b Task 3)
  const says = s.status === 'ready' || s.status === 'signing' ? [...moveSaysOf(s), ...earnSaysOf(s)].map(l => `<p class="sheet-hint">${esc(l)}</p>`).join('') : '';
  const routes = r ? `<p class="sheet-hint sheet-routes">${r.lead.startsWith('Via ') ? `<b>${esc(r.lead)}</b>` : esc(r.lead)}${r.others ? `<br>${esc(r.others)}` : ''}</p>` : '';
  const keys = `<div class="btn-row">${key('sheetClose', 'Cancel')}<button${attrs({ type: 'button', class: 'btn-primary', 'data-action': 'sheetSubmit', disabled: !live })}>${esc(goWord(s.kind, s.seed, s.fields))}</button></div>`;
  // a granting sheet's line under its title: the ask in the Account's words (plan 4b Task 6)
  const asked = typeof s.seed?.askedWords === 'string' && s.seed.askedWords ? `<p class="sheet-hint">${esc(s.seed.askedWords)}</p>` : '';
  return `<aside${attrs({ class: 'drawer sheet', 'aria-label': title })}><div class="drawer-head"><h2>${esc(title)}</h2><button type="button" class="close-key" data-action="sheetClose" aria-label="Close">×</button></div>` +
    `<div class="drawer-body">${asked}${fields}${check}${hints}${quoteBox(s)}${routes}${says}${left ? `<p class="sheet-left">${esc(left)}</p>` : ''}${signs}${said}${keys}</div></aside>`;
}
