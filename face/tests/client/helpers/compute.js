// The market's compute answers (market/src/reads.ts exploreCompute, live/ornn.ts rows, quote and history) as the face's tests take
// them: Ornn's index rows (values from market/test/fixtures/ornn/, read 2026-11-22), an event on an index, a GPU's and a token's
// quote, an index's daily settles.

const SETTLE_GPU = '2026-11-21', SETTLE_TOK = '2026-11-20';
const at = id => [{ venue: 'ornn', venueName: 'Ornn', symbol: id, connected: false, canTrade: false, public: true }];
const gpu = (id, name, price, change = null) => ({
  key: `cmp:${id}`, kind: 'computeIndex', name, unit: '$/GPU·hr', base: id, asset: 'compute', form: 'spot', price,
  ...(change ? { change24h: change[0], changePct24h: change[1] } : {}), quoteFrom: `Ornn · settle ${SETTLE_GPU}`, tabs: [], at: at(id),
});
const tok = (id, name, price, change = null) => ({
  key: `cmp:${id}`, kind: 'computeIndex', name, unit: '$/M tokens', base: id, asset: 'compute', form: 'spot', price,
  ...(change ? { change24h: change[0], changePct24h: change[1] } : {}), quoteFrom: `Ornn · settle ${SETTLE_TOK}`, tabs: [], at: at(id),
});

/** The index rows, in the market's order (GPUs by price, then the tokens). */
export const computeRows = () => [
  gpu('b300', 'B300', 11.51), gpu('b200', 'B200', 9.09, [0.04, 0.44]), gpu('h200', 'H200', 6), gpu('h100', 'H100 SXM', 2.89, [-0.03, -1.03]),
  gpu('a100', 'A100 SXM4', 1.01), gpu('rtxpro6000', 'RTX PRO 6000 WS', 1.52), gpu('rtx5090', 'RTX 5090', 0.68),
  tok('tok-anthropic', 'Anthropic tokens', 0.7656, [0.0012, 0.16]), tok('tok-deepseek', 'DeepSeek tokens', 0.033822),
];
/** A Polymarket question on an index: the market's search for Ornn found it, classOf calls it a compute event. */
export const computeEvent = () => ({
  key: `pm:0x${'a8'.repeat(32)}`, kind: 'event', name: 'Will the Ornn H100 Index hit $2.25 (LOW) by December 31, 2026?', asset: 'compute', form: 'event',
  price: 0.14, change24h: 0.02, volumeUsd24h: 52_000, category: 'Tech', closeTime: '2026-12-31T23:59:00.000Z', tabs: [],
  at: [{ venue: 'polymarket', venueName: 'Polymarket', symbol: 'ornn-h100-225:Yes', connected: false, canTrade: false, public: true, price: 0.14 }],
});
const NOTE = "Compute: Ornn's GPU rental ($/GPU·hr) and token ($/M tokens) price indices, daily settles, view-only; the change is the latest settle less the previous one; no venue here trades them.";
const EVENTS_NOTE = "Compute's events: the prediction-market questions on Ornn's indices that a search for Ornn finds, kept ten minutes.";
const body = (items, notes, over = {}) => ({ ok: true, asOf: '2026-11-22T08:00:00.000Z', tabs: [{ id: 'compute', label: 'Compute', count: items.length }], items, movers: [], closing: [], mostTraded: [], missing: [], notes, ...over });
/** explore?asset=compute&form=spot */
export const computeSpot = () => body(computeRows(), [NOTE]);
/** explore?asset=compute&form=event */
export const computeEvents = () => body([computeEvent()], [EVENTS_NOTE]);
/** explore?asset=compute (no form): the spot rows, then the events */
export const computeAll = () => body([...computeRows(), computeEvent()], [NOTE, EVENTS_NOTE]);

/** /api/quotes?pairs=ornn|h100: H100's settle, the previous one, the 30-day range and its current value (`current` null: the host down,
 *  with the market's note) */
export const h100Quote = ({ current = { value: 2.69, at: '2026-11-22T05:01:30.556Z' } } = {}) => ({
  venue: 'ornn', symbol: 'h100',
  market: {
    symbol: 'h100', name: 'H100 SXM', kind: 'spot', base: 'h100', quote: 'USD', unit: '$/GPU·hr', open: false, types: [], price: 2.89,
    quoteFrom: `Ornn · settle ${SETTLE_GPU}`, change24h: -0.03, changePct24h: -1.03,
    local: { prevClose: 2.92, open: null, high: 2.95, low: 2.81, volume: null, turnover: null, lastSession: SETTLE_GPU, phase: 'closed', quoteStatus: 'unsaid' },
    current, ...(current === null ? { note: "Ornn's current value did not answer: the latest settle is shown" } : {}),
  },
});
/** /api/quotes?pairs=ornn|tok-deepseek: a token's settle, no current value */
export const deepseekQuote = () => ({
  venue: 'ornn', symbol: 'tok-deepseek',
  market: {
    symbol: 'tok-deepseek', name: 'DeepSeek tokens', kind: 'spot', base: 'tok-deepseek', quote: 'USD', unit: '$/M tokens', open: false, types: [], price: 0.033822,
    quoteFrom: `Ornn · settle ${SETTLE_TOK}`, change24h: 0.0004, changePct24h: 1.2,
    local: { prevClose: 0.033422, open: null, high: 0.0351, low: 0.0329, volume: null, turnover: null, lastSession: SETTLE_TOK, phase: 'closed', quoteStatus: 'unsaid' },
  },
});
/** /api/candles?venue=ornn&symbol=h100&range=3M: daily settles (o=h=l=c), with the three-month note */
export const h100History = (range = '3M') => ({
  ok: true, venue: 'ornn', venueName: 'Ornn', symbol: 'h100', range, source: 'Ornn',
  candles: [['2026-11-19', 2.95], ['2026-11-20', 2.92], ['2026-11-21', 2.89]].map(([d, v]) => ({ t: Date.parse(`${d}T04:00:00Z`), o: v, h: v, l: v, c: v })),
  ...(range === '1M' ? {} : { note: "Ornn's free history is three months" }),
});
