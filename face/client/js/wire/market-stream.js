// face/client/js/wire/market-stream.js — the market's push channel in the browser (plan A2 Task 6): the Account stream's
// client (wire/account-stream.js) on the market's paths through the face's proxy — one EventSource per tab at
// /data/market/stream, its follows told to /data/market/stream/markets — carrying the public markets' frames alone: a
// snapshot, a quote, trades, a book and the heartbeat; no wallet event (an order, a fill, a card…) is the market's. Unlike
// the Account's channel, an idle public channel has nothing to deliver: it connects only while a visible page follows a market.
import { createAccountStream, FOLLOW_LIMIT } from './account-stream.js';

export const MARKET_PATHS = Object.freeze({ stream: '/data/market/stream', follow: '/data/market/stream/markets' });
export const MARKET_EVENT_TYPES = Object.freeze(['snapshot', 'quote', 'trades', 'book', 'hb']);

/** The market's push channel for one tab: createAccountStream's deps (the event source, the fetcher, the timers, the random
 * bytes, onStatus) and transport, on the market's paths and frames. `open` records the visible intent; a nonempty follow
 * opens the transport, an empty follow closes it. `close` cancels that intent until the page opens again.
 * @param {Parameters<typeof createAccountStream>[0]} deps
 * @param {Parameters<typeof createAccountStream>[1]} onEvent */
export function createMarketStream(deps, onEvent) {
  const stream = createAccountStream({ ...deps, paths: MARKET_PATHS, eventTypes: MARKET_EVENT_TYPES }, onEvent);
  let visible = false;
  let following = false;
  return {
    ...stream,
    open() {
      visible = true;
      if (following) stream.open();
    },
    close() {
      visible = false;
      stream.close();
    },
    follow(keys) {
      const next = [...new Set(keys)].filter(key => typeof key === 'string' && key.trim() !== '').slice(0, FOLLOW_LIMIT);
      following = next.length > 0;
      // Close before clearing the follow set so no empty POST competes with the list read that follows leaving a detail.
      if (!following) stream.close();
      stream.follow(next);
      if (visible && following) stream.open();
    },
  };
}
