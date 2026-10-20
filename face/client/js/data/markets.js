// gravit-ui/js/data/markets.js — the demo's stand-in markets, after Linqi's buyer-agent-demo (ui/markets.js, ui/trade.js),
// still read by the demo Account's panels until stage 2's Task 8 removes them with this file
import { MIN } from '../time.js';

// the account's "$100 a move": one owner order may be worth this much at most
export const CAP_USD = 100;
// a prepared order is good for ten minutes
export const QUOTE_MS = 10 * MIN;
// fee rates at the stand-in venues; every other venue charges nothing
export const FEES = { 'Stand-in Exchange': 0.001, 'Stand-in Wallet': 0.003, Coinbase: 0.004 };
// a stand-in account's dollars the moment it connects
export const STANDIN_CASH = { Coinbase: 500, 'Interactive Brokers': 1000, Polymarket: 300, Hyperliquid: 500 };
// the stand-in places the later stages' screens still name (Account's Move form, the ticket's venues) until stage 2 reads the host
export const VENUES = ['Stand-in Exchange', 'Stand-in Broker', 'Stand-in Wallet'];
export const CONNECTABLE = ['Coinbase', 'Interactive Brokers', 'Polymarket', 'Hyperliquid'];

const coin = (id, name, price, chg, vol, qtyStep, minQty, at) => ({ id, key: `crypto:${id}`, kind: 'coin', tabs: ['crypto'], name, base: id, price, chg, vol, qtyStep, minQty, at });
const stock = (id, name, price, chg, vol, leg) => ({ id, key: `equity:${id}`, kind: 'stock', tabs: ['stocks'], name, base: id, price, chg, vol, qtyStep: 0.0001, minQty: 0.0001, minUsd: 1, at: [leg] });
const leg = (venue, symbol, bid, ask, pub = false) => ({ venue, symbol, bid, ask, ...(pub ? { public: true } : {}) });
const out = (label, price, bid, ask, chg) => ({ label, price, bid, ask, chg });
const event = (id, name, category, closeTime, vol, yes, no, tabs = ['predictions']) => ({
  id, key: `event:${id}`, kind: 'event', tabs, name, base: id, category, closeTime, vol, price: yes.price, chg: yes.chg,
  qtyStep: 1, minQty: 1, outcomes: [yes, no], at: [{ venue: 'Polymarket', symbol: id, public: true }],
});

export const INSTRUMENTS = [
  coin('BTC', 'Bitcoin', 62800, 1.2, 1.94e9, 0.00001, 0.0001, [leg('Stand-in Exchange', 'BTC/USDT', 62796.4, 62803.6), leg('Stand-in Wallet', 'cbBTC/USDC', 62744.1, 62861.2), leg('Coinbase', 'BTC-USD', 62795.0, 62806.0, true)]),
  coin('ETH', 'Ethereum', 2630, 3.8, 8.4e8, 0.0001, 0.001, [leg('Stand-in Exchange', 'ETH/USDT', 2629.74, 2630.26), leg('Stand-in Wallet', 'WETH/USDC', 2627.1, 2633.0), leg('Coinbase', 'ETH-USD', 2629.6, 2630.5, true)]),
  coin('SOL', 'Solana', 147, -1.6, 3.1e8, 0.001, 0.01, [leg('Stand-in Exchange', 'SOL/USDT', 146.98, 147.02), leg('Coinbase', 'SOL-USD', 146.97, 147.04, true)]),
  coin('DOGE', 'Dogecoin', 0.1214, 12.4, 1.2e8, 1, 10, [leg('Coinbase', 'DOGE-USD', 0.12136, 0.12144, true)]),
  coin('AVAX', 'Avalanche', 24.37, -8.2, 9.6e7, 0.01, 0.1, [leg('Coinbase', 'AVAX-USD', 24.36, 24.38, true)]),
  coin('LINK', 'Chainlink', 13.92, 4.9, 7.1e7, 0.01, 0.1, [leg('Coinbase', 'LINK-USD', 13.91, 13.93, true)]),
  stock('AAPL', 'Apple', 228.4, -0.4, 1.12e10, leg('Stand-in Broker', 'AAPL', 228.38, 228.42)),
  stock('NVDA', 'NVIDIA', 187.4, 1.9, 3.05e10, leg('Stand-in Broker', 'NVDA', 187.38, 187.42)),
  stock('KO', 'Coca-Cola', 58.7, -0.3, 1.4e9, leg('Stand-in Broker', 'KO', 58.69, 58.71)),
  stock('SPY', 'SPDR S&P 500 ETF', 662.1, 0.4, 2.71e10, leg('Stand-in Broker', 'SPY', 662.08, 662.12)),
  stock('TSLA', 'Tesla', 251.3, -2.7, 2.2e10, leg('Interactive Brokers', 'TSLA', 251.27, 251.33, true)),
  { id: 'USDY', key: 'rwa:USDY', kind: 'rwa', tabs: ['rwas'], name: 'USDY', base: 'USDY', price: 1.1052, chg: 0, vol: 1.24e7, qtyStep: 0.01, minQty: 1, issuer: 'Stand-in Issuer', at: [leg('Stand-in Wallet', 'USDY/USDC', 1.1049, 1.1055)] },
  { id: 'USDC', key: 'stable:USDC', kind: 'stable', tabs: [], name: 'USD Coin', base: 'USDC', price: 1, chg: null, vol: null, qtyStep: 0.01, minQty: 1, at: [] },
  event('FED-DEC', 'Will the Fed cut rates at its December meeting?', 'Economics', '2026-12-09T19:00:00Z', 1.84e6, out('Yes', 0.62, 0.61, 0.63, 0.04), out('No', 0.38, 0.37, 0.39, -0.04)),
  event('CPI-NOV', 'Will US inflation come in above 3.0% in the next CPI report?', 'Economics', '2026-11-12T13:30:00Z', 6.2e5, out('Yes', 0.41, 0.4, 0.42, -0.02), out('No', 0.59, 0.58, 0.6, 0.02)),
  event('ETH-3K', 'Will ETH close the year above $3,000?', 'Crypto', '2026-12-31T23:59:00Z', 4.1e5, out('Yes', 0.38, 0.37, 0.39, 0.03), out('No', 0.62, 0.61, 0.63, -0.03), ['predictions', 'crypto']),
  event('ANTHROPIC-IPO', 'Will Anthropic IPO before January 1, 2027?', 'IPO', '2026-12-31T23:59:00Z', 2.15e5, out('Yes', 0.64, 0.63, 0.65, 0.01), out('No', 0.36, 0.35, 0.37, -0.01)),
];

export const instrument = id => INSTRUMENTS.find(i => i.id === String(id ?? '').toUpperCase()) ?? null;
