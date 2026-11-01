/**
 * The 同花顺 concept tags that are not themes, compiled by hand from the 389 names the 2026-10-30
 * probe's all-market reply carried: memberships and connect channels, financing tags, shareholder
 * portfolios, house indices, screens, listing-status labels, report-forecast tags. A tag here
 * never becomes a stand-in board. Everything not listed is a theme, however broad. Each entry has
 * a one-line reason; `EXCLUDED_PATTERNS` covers the tags that recur by period.
 */

/** @type {ReadonlyMap<string, string>} concept → reason */
export const EXCLUDED_CONCEPTS = new Map([
  // memberships and channels
  ["融资融券", "financing membership, nearly every large cap"],
  ["深股通", "Stock Connect channel membership"],
  ["沪股通", "Stock Connect channel membership"],
  ["转融券标的", "securities-lending membership"],
  // shareholder portfolios
  ["国家大基金持股", "holder portfolio, not a theme"],
  ["证金持股", "holder portfolio, not a theme"],
  ["参股银行", "equity-stake portfolio"],
  ["参股券商", "equity-stake portfolio"],
  ["参股保险", "equity-stake portfolio"],
  ["中字头股票", "ownership class (central SOE name prefix)"],
  // house indices and screens
  ["同花顺中特估100", "house index basket"],
  ["同花顺漂亮100", "house index basket"],
  ["同花顺新质50", "house index basket"],
  ["同花顺出海50", "house index basket"],
  ["同花顺果指数", "house index basket"],
  ["中国AI 50", "index basket"],
  ["高股息精选", "dividend-yield screen"],
  ["独角兽概念", "list label, not an industry"],
  // listing status and event labels
  ["ST板块", "special-treatment status"],
  ["摘帽", "ST status removal label"],
  ["新股与次新股", "listing-age label"],
  ["注册制次新股", "listing-age label"],
  ["科创次新股", "listing-age label"],
  ["股权转让(并购重组)", "corporate-event label"],
]);

/** @type {ReadonlyArray<{ pattern: RegExp, reason: string }>} */
export const EXCLUDED_PATTERNS = [
  { pattern: /^\d{4}(?:一季报|中报|三季报|年报)(?:预增|预减|预亏|预盈|扭亏|增长|减亏)?$/, reason: "report-period forecast tag" },
];

/**
 * @param {string} concept
 * @returns {string | undefined} the reason the tag is not a theme, or undefined when it is one
 */
export function exclusionReason(concept) {
  const named = EXCLUDED_CONCEPTS.get(concept);
  if (named) return named;
  return EXCLUDED_PATTERNS.find((p) => p.pattern.test(concept))?.reason;
}
