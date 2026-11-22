// The market's compute indices — Ornn's GPU rental and token price indices (spec 2026-11-22-markets-compute §5) — as the shapes the
// Markets store draws: an index's key (`cmp:<id>`), its quote pair at venue ornn, and one quote as /api/quotes answers it
// (market/src/live/ornn.ts quote: the latest settle, the previous one, the 30-day range, a GPU's current value). Pure: no DOM, no fetch.
import { number } from './market-model.js';

/** The indices the market reads (market/src/live/ornn.ts ORNN_INDICES, the same ids): seven GPUs, four labs' tokens, two classes'. */
export const COMPUTE_IDS = ['a100', 'b200', 'b300', 'h100', 'h200', 'rtx5090', 'rtxpro6000',
  'tok-anthropic', 'tok-openai', 'tok-google', 'tok-deepseek', 'tok-closed', 'tok-open'];
/** The venue an index is read at, and its source by name. */
export const COMPUTE_VENUE = 'ornn';
export const ORNN = 'Ornn'; // en-kept: the provider's name
/** The ranges an index's history is read for (Ornn's free history is three months of daily settles), and the one a page opens on. */
export const COMPUTE_RANGES = ['1M', '3M'];
export const COMPUTE_FIRST_RANGE = '3M';

const isRecord = v => !!v && typeof v === 'object' && !Array.isArray(v);
const str = v => (typeof v === 'string' ? v : '');
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** An index's key (`cmp:h100`, `cmp:tok-deepseek`) as its id and whether it is a GPU's, else null (`cmp:x`, `h100`). @param {unknown} id */
export function computeKeyOf(id) {
  if (typeof id !== 'string' || !id.startsWith('cmp:')) return null;
  const code = id.slice(4);
  return COMPUTE_IDS.includes(code) ? { id: code, gpu: !code.startsWith('tok-') } : null;
}
/** @param {unknown} id */
export const isComputeKey = id => computeKeyOf(id) !== null;
/** The market's quote pair for an index key (`ornn|h100`), else null. @param {unknown} id */
export function computePairOf(id) {
  const k = computeKeyOf(id);
  return k ? `${COMPUTE_VENUE}|${k.id}` : null;
}
/** The range an index's chart is drawn at: `kept` when Ornn reads it, else 3M. */
export const computeRangeOf = kept => (COMPUTE_RANGES.includes(kept) ? kept : COMPUTE_FIRST_RANGE);

/** A quotes row ({ venue: 'ornn', symbol, market } or a refusal) as the quote an index's page draws, keyed by its index key: its name and
 *  unit, the latest settle (`price`) and its date, the change from the previous settle, the previous settle, the 30-day high and low, a
 *  GPU's current value (`{ value, at }`, null when the current host did not answer; undefined for a token) and the market's note; null for
 *  a refused row or one at no index. @param {unknown} row */
export function computeQuoteOf(row) {
  if (!isRecord(row) || row.venue !== COMPUTE_VENUE || !isRecord(row.market) || row.refusal !== undefined) return null;
  const m = row.market;
  const id = `cmp:${str(row.symbol) || str(m.symbol)}`;
  const k = computeKeyOf(id);
  if (!k) return null;
  const facts = isRecord(m.local) ? m.local : {};
  const current = isRecord(m.current) && number(m.current.value) !== null && str(m.current.at) ? { value: number(m.current.value), at: m.current.at }
    : m.current === null ? null : undefined;
  return {
    id, name: str(m.name), unit: str(m.unit), price: number(m.price), change: number(m.change24h), changePct: number(m.changePct24h),
    prevSettle: number(facts.prevClose), high30: number(facts.high), low30: number(facts.low),
    settleDate: DAY.test(str(facts.lastSession)) ? facts.lastSession : null, quoteFrom: str(m.quoteFrom),
    ...(k.gpu ? { current: current ?? null } : {}), note: str(m.note) || null,
  };
}
