// face/client/js/market-fmt.js — a quote's change as the screens print it, after Linqi's formatter (buyer-agent-demo
// ui/core.js): ▲ or ▼ with the words a screen reader says, in percent (the quote wire's change_pct is in percentage points)

export function chgHtml(n) {
  if (n == null || Number.isNaN(n)) return '<span class="flat">—</span>';
  if (n === 0) return '<span class="flat">0.00%</span>';
  const a = Math.abs(n);
  const up = n > 0;
  return `<span class="${up ? 'up' : 'down'}"><span aria-hidden="true">${up ? '▲' : '▼'}</span><span class="sr-only">${up ? 'up' : 'down'}</span> ${a >= 1 ? a.toFixed(1) : a.toFixed(2)}%</span>`;
}

// a local currency's mark (spec 2026-11-20 §5.6): Hong Kong's and Taiwan's dollars, the won, the yuan; a won has no minor unit shown
const LOCAL_MARKS = { HKD: 'HK$', TWD: 'NT$', KRW: '₩', CNY: '¥' }; // en-kept: currency marks
const LOCAL_DIGITS = { KRW: 0 };
const finite = v => typeof v === 'number' && Number.isFinite(v);
const markOf = currency => (typeof currency === 'string' && currency ? LOCAL_MARKS[currency] ?? `${currency} ` : '');

/** A Hong Kong, Korean, Taiwanese or A share's price in its currency (HK$400.00, ₩71,500, NT$1,025.00, ¥1,392.05); with no
 *  currency, a cash index's level in points, bare (18,000.50); nothing given is —. */
export function localPrice(v, currency) {
  if (!finite(v)) return '—';
  const digits = LOCAL_DIGITS[currency] ?? 2;
  const figure = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${v < 0 ? '-' : ''}${markOf(currency)}${figure}`;
}

const SIZES = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'k']];
/** An amount in its currency, compact (a session's turnover: HK$4.8B, ₩1.2T, NT$35.1B); with no currency the figure alone; nothing
 *  given is —. */
export function localAmount(v, currency) {
  if (!finite(v)) return '—';
  const abs = Math.abs(v);
  // 0.99995 of a size already rounds to 1.0 of it: 999,960 reads 1M, not 1000k
  const size = SIZES.find(([n]) => abs >= n * 0.99995);
  const figure = size ? `${Number((abs / size[0]).toFixed(1))}${size[1]}` : String(Number(abs.toPrecision(3)));
  return `${v < 0 ? '-' : ''}${markOf(currency)}${figure}`;
}
