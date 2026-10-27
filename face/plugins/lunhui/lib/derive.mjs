// face/plugins/lunhui/lib/derive.mjs
/**
 * The Lunhui derived measures (modules spec A20): the market-wide measures host code computes at
 * freeze time, so the model never re-derives them - 连板高度 distribution, 封板 and 炸板 ratios by
 * unique stock, 昨日涨停 today's median return and negative tail, each board's breadth and turnover
 * share, the market's advance/decline ratio and limit counts from Eastmoney's up/down distribution,
 * and the composites' total turnover. Pure functions over the rows `eastmoney.mjs` and `market.mjs`
 * return; each item cites the evidence ids of the rows it read.
 *
 * A derived item is `{ source, kind: "derived", measure, value, inputs, params? }`, with no `id` of
 * its own: the freeze hands rows and derived items to `addEvidence` together, which gives every
 * item its id, `evidenceId` of exactly that object. A measure whose inputs are absent or whose
 * denominator is 0 has `value: null`, never NaN and never a missing item; the counts' measures over
 * no counts item cite no input at all. `params` names what a measure rests on beyond its inputs - a
 * threshold, a board, or the definition of the counts (the endpoint and the limit bucket, spec §17).
 *
 * The ids contract: `ids` maps `rowKey(kind, code)` to the evidence id the row will get, built by
 * the caller as `evidenceId(row)` over the row object exactly as it will be handed to `addEvidence`,
 * unchanged (rows carry no id field). The keys: `rowKey("zt" | "zb" | "yesterday", code)` for pool
 * rows (one code can sit in zt and zb), `rowKey("board", code)` for a board, `rowKey("counts")` for
 * the market counts, `rowKey("quote", symbol)` for a Tencent quote. A row the map does not know
 * is host code's bug, a `TypeError`.
 */

/** The share of 昨日涨停 at or below this pct is `yesterday_negative_tail`. */
export const NEGATIVE_TAIL_PCT = -5;

/**
 * The definition the counts' measures carry (spec §17): Eastmoney's up/down distribution endpoint,
 * and the buckets it gives the limit-up and limit-down shares (inferred, §16). `eastmoney.mjs` reads
 * them too, so the request and the measures name one thing.
 */
export const COUNTS_ENDPOINT = "getTopicZDFenBu";
export const LIMIT_UP_BUCKET = 11;
export const LIMIT_DOWN_BUCKET = -11;

/** The composites whose turnover sums to `total_turnover`. */
const COMPOSITES = ["sh000001", "sz399001"];

/** @typedef {Map<string, string>} RowIds */
/**
 * @typedef {{ source: string, kind: "derived", measure: string, value: unknown, inputs: string[],
 *   params?: Record<string, unknown> }} DerivedItem
 */

/**
 * The key of a row in an ids map: `kind:code`, or `kind` alone for a single-row source (the counts).
 * @param {string} kind
 * @param {string} [code]
 */
export function rowKey(kind, code) {
  return code === undefined ? kind : `${kind}:${code}`;
}

/** The evidence id of the row keyed `kind`/`code`; a missing one is a TypeError. */
function idOf(ids, kind, code) {
  const key = rowKey(kind, code);
  const id = ids.get(key);
  if (typeof id !== "string") throw new TypeError(`lunhui: no evidence id for the row ${JSON.stringify(key)}`);
  return id;
}

/** @returns {DerivedItem} */
function item(source, measure, value, inputs, extra = {}) {
  return { source, kind: "derived", measure, value, inputs, ...extra };
}

/** `n / d`, or null when either is not a number or `d` is 0. */
function ratio(n, d) {
  return typeof n === "number" && typeof d === "number" && d !== 0 ? n / d : null;
}

/** The finite numbers among `values`. */
function numbers(values) {
  return values.filter((value) => typeof value === "number" && Number.isFinite(value));
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The limit-up measures of the three pools (source `limit-up`): `streak_distribution` - zt rows by
 * 连板数 (`boards`), `{ "1": n, "2": n, … }`, `{}` for an empty pool; `seal_ratio` and
 * `break_ratio` - unique zt codes and unique zb codes over the unique codes of zt ∪ zb;
 * `yesterday_return_median` - the median `pct` of 昨日涨停; `yesterday_negative_tail` - the share
 * of 昨日涨停 with `pct <= NEGATIVE_TAIL_PCT`, the threshold in `params`. A null `pct` or
 * `boards` is left out of its measure.
 * @param {{ zt: any[], zb: any[], yesterday: any[] }} pools
 * @param {RowIds} ids
 * @returns {DerivedItem[]}
 */
export function deriveLimitUp({ zt, zb, yesterday }, ids) {
  const ztIds = zt.map((row) => idOf(ids, "zt", row.code));
  const zbIds = zb.map((row) => idOf(ids, "zb", row.code));
  const yIds = yesterday.map((row) => idOf(ids, "yesterday", row.code));

  const distribution = {};
  for (const boards of numbers(zt.map((row) => row.boards))) distribution[boards] = (distribution[boards] ?? 0) + 1;

  const sealed = new Set(zt.map((row) => row.code));
  const broken = new Set(zb.map((row) => row.code));
  const union = new Set([...sealed, ...broken]).size;

  const pcts = numbers(yesterday.map((row) => row.pct));
  const tail = pcts.filter((pct) => pct <= NEGATIVE_TAIL_PCT).length;

  return [
    item("limit-up", "streak_distribution", distribution, ztIds),
    item("limit-up", "seal_ratio", ratio(sealed.size, union), [...ztIds, ...zbIds]),
    item("limit-up", "break_ratio", ratio(broken.size, union), [...ztIds, ...zbIds]),
    item("limit-up", "yesterday_return_median", median(pcts), yIds),
    item("limit-up", "yesterday_negative_tail", ratio(tail, pcts.length), yIds, { params: { pct: NEGATIVE_TAIL_PCT } }),
  ];
}

/**
 * Each fetched board's `breadth` - `advancers / (advancers + decliners)`, its own counts - and
 * `turnover_share` - its `amount` over the sum of the fetched boards' `amount`s (source `boards`),
 * the board's code in `params.board`. `members` is accepted and never read: a member list is cut at
 * 100, so no measure comes from one.
 * @param {any[]} boards
 * @param {unknown[]} members
 * @param {RowIds} ids
 * @returns {DerivedItem[]}
 */
export function deriveBoards(boards, members, ids) {
  const all = boards.map((board) => idOf(ids, "board", board.code));
  const sum = numbers(boards.map((board) => board.amount)).reduce((a, b) => a + b, 0);
  return boards.flatMap((board, i) => {
    const { advancers, decliners } = board;
    const breadth = typeof advancers === "number" && typeof decliners === "number" ? ratio(advancers, advancers + decliners) : null;
    const params = { board: board.code };
    return [
      item("boards", "breadth", breadth, [all[i]], { params }),
      item("boards", "turnover_share", ratio(board.amount, sum), all, { params }),
    ];
  });
}

/**
 * The market counts' measures (source `index`): `advance_decline_ratio` - `advancers /
 * decliners` - `limit_up_count` and `limit_down_count`, all from one distribution reply (spec §16),
 * each naming its definition in `params`: the endpoint, and the bucket a limit count reads (§17).
 * A limit count the reply lacked is null in the counts and null here. With `counts` null - the
 * distribution refused, the index items landed without it - the three are `value: null` citing no
 * input.
 * @param {{ advancers: number, decliners: number, limitUp: number | null, limitDown: number | null } | null} counts
 * @param {RowIds} ids
 * @returns {DerivedItem[]}
 */
export function deriveCounts(counts, ids) {
  const inputs = counts === null ? [] : [idOf(ids, "counts")];
  return [
    item("index", "advance_decline_ratio", counts === null ? null : ratio(counts.advancers, counts.decliners), inputs, {
      params: { endpoint: COUNTS_ENDPOINT },
    }),
    item("index", "limit_up_count", counts?.limitUp ?? null, inputs, { params: { endpoint: COUNTS_ENDPOINT, bucket: LIMIT_UP_BUCKET } }),
    item("index", "limit_down_count", counts?.limitDown ?? null, inputs, { params: { endpoint: COUNTS_ENDPOINT, bucket: LIMIT_DOWN_BUCKET } }),
  ];
}

/**
 * `total_turnover` (source `index`): the `amountCny` of `sh000001` plus `sz399001` from the Tencent
 * quotes, null when either quote or its amount is absent; the inputs cite the composites found.
 * @param {any[]} quotes
 * @param {RowIds} ids
 * @returns {DerivedItem[]}
 */
export function deriveIndex(quotes, ids) {
  const found = COMPOSITES.map((symbol) => quotes.find((quote) => quote.symbol === symbol)).filter(Boolean);
  const amounts = numbers(found.map((quote) => quote.amountCny));
  const value = amounts.length === COMPOSITES.length ? amounts[0] + amounts[1] : null;
  return [item("index", "total_turnover", value, found.map((quote) => idOf(ids, "quote", quote.symbol)))];
}
