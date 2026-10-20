// face/client/js/render/tool-result.js — a tool row's result drawn for reading (spec 2026-10-19 §6, the `card` row): the
// old client's alpaca-kit renderers (wire/render.js) ported to strings. Only an `mcp__alpaca-kit__<tool>` result whose
// payload parses with ok:true is dressed — market_snapshot and the row listings as tables, daily_bars as a chart, account
// and breadth as tiles, calendar as its days — and anything else returns null, the row keeping its raw text. The parse
// tolerates dsh's spill elision (a big result arrives as its head and a note): what parsed is drawn, stamped Partial.
// The sign is always printed with a change, so colour never carries the direction alone.
import { esc } from '../html.js';
import { number } from '../wire/account-model.js';
import { chartSvg } from './chart.js';

const EM = '—';
const ALPACA = /^mcp__alpaca-kit__([a-z0-9_]+)$/;
const ROWS = new Set(['screen', 'positions', 'orders', 'earnings', 'corp_actions']);
const MAX_COLUMNS = 8;
// keys whose numbers read as signed deltas: printed with + or -, and coloured
const DELTA_KEYS = new Set(['unrealized_pl', 'unrealized_plpc', 'unrealized_intraday_pl', 'unrealized_intraday_plpc', 'change_today', 'pct_change', 'chg', 'delta']);

// comma-grouped, at most two decimals (four under one, so a penny quote keeps its shape)
function fmtNum(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return EM;
  return v.toLocaleString('en-US', { maximumFractionDigits: Math.abs(v) < 1 && v !== 0 ? 4 : 2 });
}
const fmtCell = v => (v === null || v === undefined || v === '' ? EM : typeof v === 'number' ? fmtNum(v) : String(v));
const fmtSigned = (v, suffix = '') => (typeof v === 'number' && Number.isFinite(v) ? (v > 0 ? '+' : '') + fmtNum(v) + suffix : EM);
const label = key => key.replaceAll('_', ' ');
const tone = v => (typeof v === 'number' && v !== 0 ? (v > 0 ? ' up' : ' down') : '');
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);

function table(cols, numeric, body) {
  const head = cols.map(c => `<th${numeric.has(c) ? ' class="num"' : ''}>${esc(label(c))}</th>`).join('');
  return `<div class="viz-scroll"><table class="viz-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

// market_snapshot: symbol, close, the change against the previous close, volume — the largest change first
function snapshot(rows) {
  const withPct = rows.filter(object).map(r => {
    const pct = typeof r.close === 'number' && typeof r.prev_close === 'number' && r.prev_close !== 0 ? ((r.close - r.prev_close) / r.prev_close) * 100 : null;
    return { ...r, pct };
  }).sort((a, b) => (b.pct ?? -Infinity) - (a.pct ?? -Infinity) || 0);
  const body = withPct.map(r => `<tr><td class="sym">${esc(fmtCell(r.symbol))}</td><td class="num">${esc(fmtCell(r.close))}</td>` +
    `<td class="num${tone(r.pct)}">${esc(fmtSigned(r.pct, '%'))}</td><td class="num">${esc(fmtCell(r.volume))}</td></tr>`).join('');
  return table(['symbol', 'close', 'change', 'volume'], new Set(['close', 'change', 'volume']), body);
}

// a row listing: the first row's first eight columns; the raw text keeps the rest
function generic(rows) {
  const list = rows.filter(object);
  if (!list.length) return null;
  const cols = Object.keys(list[0]).slice(0, MAX_COLUMNS);
  const numeric = new Set(cols.filter(c => list.some(r => typeof r[c] === 'number')));
  const body = list.map(r => `<tr>${cols.map(c => {
    const v = r[c];
    const delta = DELTA_KEYS.has(c) && typeof v === 'number';
    const klass = numeric.has(c) ? `num${delta ? tone(v) : ''}` : c === 'symbol' ? 'sym' : '';
    return `<td${klass ? ` class="${klass}"` : ''}>${esc(delta ? fmtSigned(v) : fmtCell(v))}</td>`;
  }).join('')}</tr>`).join('');
  return table(cols, numeric, body);
}

// account and breadth: tiles when small, a key-value list when wide; Alpaca's decimal strings read as numbers
function flat(payload) {
  const entries = Object.entries(payload).filter(([k, v]) => k !== 'ok' && (v === null || ['number', 'string', 'boolean'].includes(typeof v)));
  if (!entries.length) return null;
  const word = (k, v) => {
    const n = typeof v === 'boolean' ? null : number(v);
    if (n === null) return fmtCell(typeof v === 'boolean' ? String(v) : v);
    return /(^|_)pct(_|$)|plpc/.test(k) && Math.abs(n) <= 1 ? `${fmtNum(n * 100)}%` : fmtNum(n);
  };
  if (entries.length <= MAX_COLUMNS) {
    return `<div class="viz-tiles">${entries.map(([k, v]) => `<div class="viz-tile"><div class="viz-tile-label">${esc(label(k))}</div><div class="viz-tile-value">${esc(word(k, v))}</div></div>`).join('')}</div>`;
  }
  return `<dl class="viz-kv">${entries.map(([k, v]) => `<dt>${esc(label(k))}</dt><dd>${esc(word(k, v))}</dd>`).join('')}</dl>`;
}

function calendar(days) {
  if (!Array.isArray(days)) return null;
  return `<div class="viz-meta">${days.length} trading day${days.length === 1 ? '' : 's'}</div><div class="viz-days">${esc(days.join('  '))}</div>`;
}

// daily_bars: the closes as the Market page's chart; fewer than two closes stay a table
function bars(rows) {
  const dateKey = ['date', 'day', 'timestamp', 't'].find(k => rows[0]?.[k] !== undefined);
  const chart = dateKey ? chartSvg(rows.filter(object).map(r => ({ date: String(r[dateKey]), close: r.close }))) : '';
  return chart || generic(rows);
}

// whole JSON objects inside elided text: the one the seam cut fails its own parse and is dropped
function salvageRows(text) {
  const rows = [];
  let i = text.indexOf('[', text.indexOf('"rows"'));
  if (i === -1) return rows;
  const n = text.length;
  while (i < n) {
    const start = text.indexOf('{', i);
    if (start === -1) break;
    let depth = 0;
    let inStr = false;
    let escaped = false;
    let j = start;
    for (; j < n; j++) {
      const ch = text[j];
      if (inStr) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) break; }
    }
    if (j >= n) break;
    try {
      const o = JSON.parse(text.slice(start, j + 1));
      if (object(o)) rows.push(o);
    } catch { /* the seam's object */ }
    i = j + 1;
  }
  return rows;
}

// the result as delivered: whole JSON; else up to the last closing brace (a note after it); else whole rows salvaged
export function parsePayload(text) {
  try {
    return { payload: JSON.parse(text), partial: false };
  } catch { /* the two salvage tiers */ }
  const cut = text.lastIndexOf('}');
  if (cut !== -1) {
    try {
      return { payload: JSON.parse(text.slice(0, cut + 1)), partial: true };
    } catch { /* cut mid-row */ }
  }
  if (/^\s*\{/.test(text) && /"ok":\s*true/.test(text)) {
    const rows = salvageRows(text);
    if (rows.length) return { payload: { ok: true, rows }, partial: true };
  }
  return null;
}

export function toolResultHtml(name, text) {
  if (typeof name !== 'string' || typeof text !== 'string') return null;
  const tool = ALPACA.exec(name)?.[1];
  if (!tool) return null;
  const parsed = parsePayload(text);
  if (!parsed || !object(parsed.payload) || parsed.payload.ok !== true) return null;
  const p = parsed.payload;
  let body = null;
  try {
    if (tool === 'market_snapshot' && Array.isArray(p.rows)) body = snapshot(p.rows);
    else if (tool === 'daily_bars' && Array.isArray(p.rows) && p.rows.length) body = bars(p.rows);
    else if (tool === 'calendar') body = calendar(p.days);
    else if (tool === 'breadth' || tool === 'account') body = flat(p);
    else if (ROWS.has(tool) && Array.isArray(p.rows)) body = p.rows.length ? generic(p.rows) : '<div class="viz-meta">0 rows</div>';
  } catch {
    return null; // a shape surprise falls back to the raw text, never a half-drawn table
  }
  return body ? `<div class="viz">${parsed.partial ? '<div class="viz-stamp">Partial</div>' : ''}${body}</div>` : null;
}

// the thread asks per message: a message's data object is kept across renders, so its result is parsed once
const memo = new WeakMap();
export function toolResultFor(data) {
  if (!object(data)) return null;
  if (!memo.has(data)) memo.set(data, data.isError ? null : toolResultHtml(data.name, data.result));
  return memo.get(data);
}
