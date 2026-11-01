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

/** The most ladder names whose minute lines a limit-up freeze keeps (run view M6). */
export const LADDER_CAP = 40;

/** `a` before `b` by `firstSealAt` ("HHMMSS"), a null one last. */
function bySeal(a, b) {
  const x = typeof a.firstSealAt === "string" ? a.firstSealAt : "~";
  const y = typeof b.firstSealAt === "string" ? b.firstSealAt : "~";
  return x < y ? -1 : x > y ? 1 : 0;
}

const byCode = (a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);

/** A board count as a number: a finite one, else 0. */
const height = (value) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/**
 * The tried height of a 炸板池 row, over `yesterday`: the same code's first `yesterdayBoards`,
 * else 0, plus 1 - the board it broke trying.
 * @param {any[]} yesterday
 * @returns {(row: any) => number}
 */
function triedHeight(yesterday) {
  const yesterdayBoards = new Map();
  for (const row of yesterday) if (!yesterdayBoards.has(row.code)) yesterdayBoards.set(row.code, height(row.yesterdayBoards));
  return (row) => (yesterdayBoards.get(row.code) ?? 0) + 1;
}

/**
 * The ladder's names (run view M6), the codes whose minute lines the limit-up freeze keeps: zt
 * rows at 2 boards or more, by boards descending, then `firstSealAt`, then code; then zb rows not
 * in zt whose tried height - the same code's `yesterdayBoards`, else 0, plus 1 - is 2 or more, by
 * tried height descending, then code; then 昨日涨停 rows at 2 `yesterdayBoards` or more not yet
 * listed, by `yesterdayBoards` descending, then code. Unique, at most `cap`. A first board is never
 * a ladder name.
 * @param {{ zt: any[], zb: any[], yesterday: any[] }} pools
 * @param {number} [cap]
 * @returns {string[]}
 */
export function ladderCodes({ zt, zb, yesterday }, cap = LADDER_CAP) {
  const sealed = new Set(zt.map((row) => row.code));
  const tried = triedHeight(yesterday);

  const ladder = zt
    .filter((row) => height(row.boards) >= 2)
    .sort((a, b) => height(b.boards) - height(a.boards) || bySeal(a, b) || byCode(a, b));
  const broken = zb
    .filter((row) => !sealed.has(row.code) && tried(row) >= 2)
    .sort((a, b) => tried(b) - tried(a) || byCode(a, b));
  const fell = yesterday
    .filter((row) => height(row.yesterdayBoards) >= 2)
    .sort((a, b) => height(b.yesterdayBoards) - height(a.yesterdayBoards) || byCode(a, b));

  const codes = new Set();
  for (const row of [...ladder, ...broken, ...fell]) codes.add(row.code);
  return [...codes].slice(0, cap);
}

/**
 * @typedef {{ n: number, sealed: string[], from: number | null, promoted: number | null,
 *   missed: string[], broke: string[], gap: boolean }} Rung
 */
/** @typedef {{ height: number, rungs: Rung[], firstTries: { sealed: number, tries: number } }} Promotion */

/**
 * The ladder's promotions from yesterday's pool (run view): one rung per board count `n`, from
 * `max(height, the highest yesterdayBoards + 1)` down to 1 - at least 1 when zb holds a code not in
 * zt - `height` being today's highest zt `boards` (0 for an empty zt). A rung's `sealed` are the zt codes at `n` boards, by `firstSealAt`
 * then code; `from` the 昨日涨停 rows at `n - 1` boards, `promoted` how many of them sealed at `n`;
 * `broke` the zb codes not in zt whose tried height is `n`, and `missed` the rest of `from`, both
 * by code; `gap` a rung below the height with nothing sealed. At `n` 1 nothing comes from
 * yesterday: `from` and `promoted` are null, and `firstTries` counts its sealed against its
 * sealed plus broke. Codes only, no evidence ids: the view draws it, no role reads it.
 * @param {{ zt: any[], zb: any[], yesterday: any[] }} pools
 * @returns {Promotion}
 */
export function promotion({ zt, zb, yesterday }) {
  const inZt = new Set(zt.map((row) => row.code));
  const tried = triedHeight(yesterday);
  const top = Math.max(0, ...zt.map((row) => height(row.boards)));
  const topYesterday = Math.max(0, ...yesterday.map((row) => height(row.yesterdayBoards)));
  const codesOf = (rows) => [...new Set(rows.map((row) => row.code))];

  /** @type {Rung[]} */
  const rungs = [];
  // A zb break not in zt tried a board at least: with zt and yesterday empty, rung 1 still holds it.
  const anyBroke = zb.some((row) => !inZt.has(row.code));
  for (let n = Math.max(top, yesterday.length > 0 ? topYesterday + 1 : 0, anyBroke ? 1 : 0); n >= 1; n--) {
    const sealedRows = zt.filter((row) => height(row.boards) === n).sort((a, b) => bySeal(a, b) || byCode(a, b));
    const sealed = codesOf(sealedRows);
    const broke = codesOf(zb.filter((row) => !inZt.has(row.code) && tried(row) === n).sort(byCode));
    const gap = sealed.length === 0 && n < top;
    if (n === 1) {
      rungs.push({ n, sealed, from: null, promoted: null, missed: [], broke, gap });
      continue;
    }
    const from = codesOf(yesterday.filter((row) => height(row.yesterdayBoards) === n - 1));
    const sealedHere = new Set(sealed);
    const brokeHere = new Set(broke);
    const promoted = from.filter((code) => sealedHere.has(code)).length;
    const missed = from.filter((code) => !sealedHere.has(code) && !brokeHere.has(code)).sort();
    rungs.push({ n, sealed, from: from.length, promoted, missed, broke, gap });
  }
  const first = rungs.find((rung) => rung.n === 1);
  const firstTries = first ? { sealed: first.sealed.length, tries: first.sealed.length + first.broke.length } : { sealed: 0, tries: 0 };
  return { height: top, rungs, firstTries };
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
