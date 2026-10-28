// face/client/js/render/run-sheet.js — a module card's Run sheet (module cards spec §5.4) as a drawer in the owner sheet's
// chrome: Where, On with each option open or greyed with its reason, Cites, Stocks, Theme's source line, the Note, Runs via
// and Writes, what was said, Cancel and Run. Every word is the view's (host/run-sheet-view.js) or the listing's, through esc.
import { esc, attrs, cls } from '../html.js';
import { sheetOf } from '../host/run-sheet-view.js';
import { kv } from './controls.js';

const hint = text => (text ? `<p class="sheet-hint">${esc(text)}</p>` : '');
const bad = text => (text ? `<p class="field-error">${esc(text)}</p>` : '');
const label = text => `<span class="field-label">${esc(text)}</span>`;

// a select of the sheet's: a value no option has is an empty option the box shows, never the first option it would not send
function select(name, options, value, disabled = false) {
  const known = options.some(o => o.value === value);
  const items = (known ? '' : '<option value="" selected disabled></option>') +
    options.map(o => `<option${attrs({ value: o.value, selected: o.value === value })}>${esc(o.label)}</option>`).join('');
  return `<select${attrs({ class: 'input', name, 'data-action': 'runSheetField', disabled })}>${items}</select>`;
}

function where(v) {
  return `<label class="field">${label('Where')}${select('where', v.where.options, v.where.value, v.where.fixed)}</label>`;
}

// one radio per option: its label, and its detail while it is open or its reason while it is greyed
function on(v) {
  const opts = v.on.options.map(o => `<label${attrs({ class: cls('opt', o.enabled ? 'on' : 'off') })}><input${attrs({
    type: 'radio', name: 'on', value: o.id, checked: o.id === v.on.value, disabled: !o.enabled, 'data-action': 'runSheetField',
  })}><span>${esc(o.label)}</span>${hint(o.enabled ? o.detail : o.reason)}</label>`).join('');
  return `<div${attrs({ class: 'field', role: 'radiogroup', 'aria-label': 'On' })}>${label('On')}${opts || hint('nothing to run on')}</div>`;
}

function cites(c) {
  if (!c) return '';
  const chosen = c.options.find(o => o.value === c.value) ?? null;
  const box = c.readOnly ? `<div class="dsec-line">${esc(chosen?.label ?? 'none')}</div>` : select('cites', c.options, c.value);
  return `<div class="field">${label('Cites')}${box}${hint(c.line)}${hint(chosen?.warning)}</div>`;
}

function stocks(st) {
  if (!st) return '';
  return `<label class="field">${label('Stocks')}<input${attrs({
    class: 'input', type: 'text', id: 'run-stocks', name: 'stocks', value: st.value, autocomplete: 'off', 'data-action': 'runSheetField',
  })}></label>${hint(st.hint)}${bad(st.error)}`;
}

const note = n => `<label class="field">${label('Note to Gravit')}<textarea${attrs({
  class: 'textarea', id: 'run-note', name: 'note', rows: '3', 'data-action': 'runSheetField',
})}>${esc(n.value)}</textarea></label>`;

/** The open Run sheet as a drawer over the screen; no sheet (or no module): nothing. */
export function renderRunSheet(state, now = Date.now()) {
  const sheet = state.runSheet;
  if (!sheet) return '';
  const v = sheetOf(state.discover?.shelves?.modules?.data ?? null, sheet, now);
  if (!v) return '';
  const run = `<button${attrs({ type: 'button', class: 'btn-primary', 'data-action': 'runSheetRun', disabled: !v.canRun, title: v.canRun ? null : v.blocker })}>Run</button>`;
  const keys = `<div class="btn-row"><button type="button" class="btn-sm" data-action="runSheetCancel">Cancel</button>${run}</div>`;
  return `<div${attrs({ class: 'drawer sheet run-sheet', role: 'dialog', 'aria-label': v.title })}><div class="drawer-head"><h2>${esc(v.title)}</h2>` +
    '<button type="button" class="close-key" data-action="runSheetCancel" aria-label="Close">×</button></div>' +
    `<div class="drawer-body">${where(v)}${on(v)}${cites(v.cites)}${stocks(v.stocks)}${hint(v.source)}${note(v.note)}` +
    `${kv([['Runs via', esc(v.via)], ['Writes', esc(v.writes)]])}${bad(sheet.said)}${keys}</div></div>`;
}
