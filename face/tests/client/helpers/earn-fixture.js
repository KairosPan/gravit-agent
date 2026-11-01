// The Account's earn read as the stand-in would answer it (account/src/portfolio/service.ts EarnView), over the stand-in's page
// (tests/fixtures/account/account.json), for the Earn tests of plan 4b Task 3: at Stand-in Exchange a flexible USDT product
// (USDT ready there, 150 in it), a DOGE product that takes money (no DOGE there), a bonded ETH product closed with its reason
// and one with nothing in it; at OKX — marked not served on this network — a USDT product with money in it; Kraken's read failed.
import { readFileSync } from 'node:fs';

const fx = name => JSON.parse(readFileSync(new URL(`../../fixtures/account/${name}.json`, import.meta.url), 'utf8'));

export const OKX = { id: 'okx', name: 'OKX', live: true, earn: { can: true, what: 'savings' }, notServed: { said: 'OKX does not serve this location' }, holdings: [{ asset: 'USDT', amount: 900, usd: 900, class: 'stable' }] };

/** The stand-in's page with OKX connected and not served here. */
export function earnPage() {
  const p = fx('account');
  p.venues = [...p.venues, OKX];
  return p;
}

const ex = { venue: 'ex', venueName: 'Stand-in Exchange' };
/** The earn read. */
export function earnBody() {
  return {
    ok: true, asOf: '2026-10-22T07:40:00.000Z',
    venues: [{ venue: 'ex', venueName: 'Stand-in Exchange', can: true, what: 'stand-in earn' }, { venue: 'mm', venueName: 'MetaMask', can: false, what: 'vaults', whyNot: 'the agent wallet has not been approved for vaults' }],
    products: [
      { ...ex, id: 'flex:DOGE', asset: 'DOGE', name: 'DOGE · Flexible', apy: 0.01, rateKind: 'apr', lockDays: 0, lands: 'the funding account', canSupply: true, canWithdraw: true },
      { ...ex, id: 'bond:ETH', asset: 'ETH', name: 'ETH · Bonded', apy: 0.03, apyHigh: 0.05, lockDays: 14, lands: 'the funding account', canSupply: false, canWithdraw: true, why: 'Full for now' },
      { ...ex, id: 'flex:USDT', asset: 'USDT', name: 'USDT · Flexible (stand-in)', apy: 0.046, lockDays: 0, minAmount: 1, lands: 'the funding account', canSupply: true, canWithdraw: true },
      { venue: 'okx', venueName: 'OKX', id: 'savings:USDT', asset: 'USDT', name: 'USDT · Savings', apy: 0.02, lands: 'funding', canSupply: true, canWithdraw: true },
    ],
    positions: [
      { ...ex, product: 'flex:USDT', id: 'flex:USDT', asset: 'USDT', amount: 150, usd: 150, apy: 0.046 },
      { ...ex, product: 'bond:ETH', id: 'bond:ETH', asset: 'ETH', amount: 0 },
      { venue: 'okx', venueName: 'OKX', product: 'savings:USDT', id: 'savings:USDT', asset: 'USDT', amount: 5 },
    ],
    missing: [{ venue: 'kraken', venueName: 'Kraken', why: 'the venue said 429' }],
    writes: { on: true, capUsd: 250, turnOn: 'npm run account' },
  };
}
