// face/client/js/market-fmt.js — a quote's change as the screens print it, after Linqi's formatter (buyer-agent-demo
// ui/core.js): ▲ or ▼ with the words a screen reader says, in percent (the quote wire's change_pct is in percentage points)

export function chgHtml(n) {
  if (n == null || Number.isNaN(n)) return '<span class="flat">—</span>';
  if (n === 0) return '<span class="flat">0.00%</span>';
  const a = Math.abs(n);
  const up = n > 0;
  return `<span class="${up ? 'up' : 'down'}"><span aria-hidden="true">${up ? '▲' : '▼'}</span><span class="sr-only">${up ? 'up' : 'down'}</span> ${a >= 1 ? a.toFixed(1) : a.toFixed(2)}%</span>`;
}
