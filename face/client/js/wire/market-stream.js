// face/client/js/wire/market-stream.js — the market's push channel in the browser (plan A2 Task 6): the Account stream's
// client (wire/account-stream.js) on the market's paths through the face's proxy — one EventSource per tab at
// /data/market/stream, its follows told to /data/market/stream/markets — carrying the public markets' frames alone: a
// snapshot, a quote, trades, a book and the heartbeat; no wallet event (an order, a fill, a card…) is the market's.
import { createAccountStream } from './account-stream.js';

export const MARKET_PATHS = Object.freeze({ stream: '/data/market/stream', follow: '/data/market/stream/markets' });
export const MARKET_EVENT_TYPES = Object.freeze(['snapshot', 'quote', 'trades', 'book', 'hb']);

/** The market's push channel for one tab: createAccountStream's deps (the event source, the fetcher, the timers, the random
 * bytes, onStatus) and its contract, on the market's paths and frames.
 * @param {Parameters<typeof createAccountStream>[0]} deps
 * @param {Parameters<typeof createAccountStream>[1]} onEvent */
export function createMarketStream(deps, onEvent) {
  return createAccountStream({ ...deps, paths: MARKET_PATHS, eventTypes: MARKET_EVENT_TYPES }, onEvent);
}
