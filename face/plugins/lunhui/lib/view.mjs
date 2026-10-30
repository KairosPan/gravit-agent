// face/plugins/lunhui/lib/view.mjs
/**
 * The Lunhui run view's evidence half (run view spec §5.3–§5.5): `evidenceView(sealed)` turns a
 * sealed run's frozen evidence into the blocks the client draws and Gravit's `view` digest
 * summarises - breadth, the indices with their minute lines, the ladder by promotion, yesterday's
 * limit-ups today, and the stocks keyed by code - and `mostMoved` finds the window of a minute line
 * that moved most. Pure functions over what `readSealedRun` reads: no clock, no I/O, and nothing
 * here is read by a role (no contract names `minutes`).
 *
 * Every block carries `unavailable`: null when it is drawn, else the reason in a few words. Breadth
 * and the indices need the `index` source in the manifest's evidence ("index not frozen"); the
 * ladder and yesterday need `limit-up` ("limit-up not frozen"). Breadth without a counts item -
 * the distribution refused - is "counts not frozen". A run frozen before the minute lines existed
 * draws every block but the lines: each index row and stock is `minutesMissing: "NOT_FROZEN"`.
 */
import { promotion } from "./derive.mjs";
import { exchangeOf, limitPrices, limitRate, minuteLabel } from "./market.mjs";

/** The order the indices are drawn in; any other symbol follows in evidence order. */
const INDEX_ORDER = ["sh000001", "sz399001", "sz399006", "sh000300"];

/** What a block, or an index row or stock, says when its source or its line was not frozen. */
const NOT_FROZEN = "NOT_FROZEN";

/**
 * A frozen minute line, compact: the session grid's points 0.. up to `through`, prices to the fen,
 * volume (lots) and amount (CNY) per minute.
 * @typedef {{ prec: number, through: string, price: number[], volume: number[], amount: number[] }} Minutes
 */
/** @typedef {{ bucket: number, count: number }} Bucket */
/**
 * @typedef {{ advancers: number | null, unchanged: number | null, decliners: number | null,
 *   limitUp: number | null, limitDown: number | null, total: number | null, turnover: number | null,
 *   ratio: number | null, buckets: Bucket[], unavailable: string | null }} BreadthBlock
 */
/**
 * @typedef {{ symbol: string, name: string | null, prec: number | null, last: number | null,
 *   pct: number | null, change: number | null, amount: number | null, minutes: Minutes | null,
 *   minutesMissing: string | null }} IndexRow
 */
/** @typedef {{ rows: IndexRow[], unavailable: string | null }} IndicesBlock */
/**
 * A name on the ladder: its first seal "HH:MM", breaks and seal funds from the pool row it is
 * listed by (null where that pool has none - a miss is listed by its 昨日涨停 row).
 * @typedef {{ code: string, name: string | null, pct: number | null, firstSeal: string | null,
 *   breaks: number | null, sealFunds: number | null }} Stock
 */
/**
 * @typedef {{ n: number, sealed: Stock[], from: number | null, promoted: number | null,
 *   missed: Stock[], broke: Stock[], gap: boolean }} LadderRung
 */
/**
 * @typedef {{ height: number, rungs: LadderRung[], firstTries: { sealed: number, tries: number },
 *   unavailable: string | null }} LadderBlock
 */
/** @typedef {{ code: string, name: string | null, yesterdayBoards: number, pct: number | null }} YesterdayRow */
/**
 * @typedef {{ count: number, median: number | null, belowMinus5Share: number | null,
 *   rows: YesterdayRow[], unavailable: string | null }} YesterdayBlock
 */
/**
 * One code's facts across the three pools: `pool` the first it sits in (zt, zb, yesterday) and
 * today's price, pct, industry, turnover and amount from that row; `boards` from zt, `tried` from
 * zb (the board it broke trying), `yesterdayBoards` from 昨日涨停; `limitUp`/`limitDown` from the
 * minute line's `prec` by the code's limit rate, null without a line; `minutesMissing` null with a
 * line, else the freeze's reason or "NOT_FROZEN".
 * @typedef {{ code: string, symbol: string | null, name: string | null, industry: string | null,
 *   pool: "zt" | "zb" | "yesterday", price: number | null, pct: number | null, boards: number | null,
 *   tried: number | null, yesterdayBoards: number | null, firstSeal: string | null,
 *   lastSeal: string | null, breaks: number | null, sealFunds: number | null,
 *   limitPrice: number | null, turnover: number | null, amount: number | null,
 *   limitUp: number | null, limitDown: number | null, minutes: Minutes | null,
 *   minutesMissing: string | null }} StockFacts
 */
/**
 * @typedef {{ session: string | null, through: string | null, breadth: BreadthBlock,
 *   indices: IndicesBlock, ladder: LadderBlock, yesterday: YesterdayBlock,
 *   stocks: Record<string, StockFacts> }} EvidenceView
 */
/**
 * The sealed run the view reads: `readSealedRun`'s shape plus the run's `metrics.json`, its
 * artifacts keyed by module.
 * @typedef {{ strategy: string, run: string, manifest: any, metrics?: any,
 *   evidence: Array<{ source: string, session?: string, items: any[] }>,
 *   artifacts?: Record<string, any> }} SealedView
 */

const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const str = (value) => (typeof value === "string" ? value : null);

/** A seal time "HHMMSS" (or "HMMSS", as a number may lose its zero) to "HH:MM"; null otherwise. */
function sealTime(value) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).padStart(6, "0");
  return /^\d{6}$/.test(text) ? `${text.slice(0, 2)}:${text.slice(2, 4)}` : null;
}

/** A minute item to the compact `Minutes` the view carries. */
function compact(item) {
  return { prec: item.prec, through: item.through, price: item.price, volume: item.volume, amount: item.amount };
}

/** The value of the derived item measuring `measure`, or null. */
function measure(items, name) {
  const hit = items.find((item) => item?.kind === "derived" && item.measure === name);
  return hit === undefined ? null : hit.value ?? null;
}

/** The items of `source` when the manifest lists it and its evidence was read, else null. */
function sourceItems(sealed, source) {
  const listed = (sealed.manifest?.evidence ?? []).some((entry) => entry?.source === source);
  const file = (sealed.evidence ?? []).find((entry) => entry?.source === source);
  return listed && file && Array.isArray(file.items) ? file.items : null;
}

/** @returns {BreadthBlock} */
function breadthOf(items) {
  const empty = (unavailable) => ({
    advancers: null, unchanged: null, decliners: null, limitUp: null, limitDown: null, total: null,
    turnover: null, ratio: null, buckets: [], unavailable,
  });
  if (items === null) return empty("index not frozen");
  const counts = items.find((item) => item?.kind === "counts");
  if (!counts) return empty("counts not frozen");
  return {
    advancers: num(counts.advancers),
    unchanged: num(counts.unchanged),
    decliners: num(counts.decliners),
    limitUp: num(counts.limitUp) ?? num(measure(items, "limit_up_count")),
    limitDown: num(counts.limitDown) ?? num(measure(items, "limit_down_count")),
    total: num(counts.total),
    turnover: num(measure(items, "total_turnover")),
    ratio: num(measure(items, "advance_decline_ratio")),
    buckets: (Array.isArray(counts.buckets) ? counts.buckets : []).map(({ bucket, count }) => ({ bucket, count })),
    unavailable: null,
  };
}

/** The minute line, or the reason it is missing, of the item keyed `key` in `field`. */
function lineOf(items, field, key) {
  const line = items.find((item) => item?.kind === "minutes" && item[field] === key);
  if (line) return { minutes: compact(line), minutesMissing: null };
  const missing = items.find((item) => item?.kind === "minutes_missing" && item[field] === key);
  return { minutes: null, minutesMissing: missing ? String(missing.reason ?? "UNKNOWN") : NOT_FROZEN };
}

/** @returns {IndicesBlock} */
function indicesOf(items) {
  if (items === null) return { rows: [], unavailable: "index not frozen" };
  const quotes = items.filter((item) => item?.kind === "index");
  const rank = (symbol) => {
    const i = INDEX_ORDER.indexOf(symbol);
    return i === -1 ? INDEX_ORDER.length : i;
  };
  const ordered = quotes.map((quote, i) => ({ quote, i })).sort((a, b) => rank(a.quote.symbol) - rank(b.quote.symbol) || a.i - b.i);
  // Index minute items carry a symbol and no code.
  const indexLines = items.filter((item) => !Object.hasOwn(item ?? {}, "code"));
  const rows = ordered.map(({ quote }) => ({
    symbol: quote.symbol,
    name: str(quote.name),
    prec: num(quote.previousClose),
    last: num(quote.last),
    pct: num(quote.changePercent),
    change: num(quote.change),
    amount: num(quote.amountCny),
    ...lineOf(indexLines, "symbol", quote.symbol),
  }));
  return { rows, unavailable: null };
}

/** The pool rows of the limit-up items, by pool. */
function poolsOf(items) {
  const pools = { zt: [], zb: [], yesterday: [] };
  for (const item of items ?? []) if (item && Object.hasOwn(pools, item.pool) && typeof item.code === "string") pools[item.pool].push(item);
  return pools;
}

/** @returns {Stock} */
function stockOf(row, code) {
  return {
    code,
    name: str(row?.name),
    pct: num(row?.pct),
    firstSeal: sealTime(row?.firstSealAt),
    breaks: num(row?.breakCount),
    sealFunds: num(row?.sealFunds),
  };
}

/** @returns {LadderBlock} */
function ladderOf(items, pools) {
  if (items === null) return { height: 0, rungs: [], firstTries: { sealed: 0, tries: 0 }, unavailable: "limit-up not frozen" };
  const first = (rows) => {
    const map = new Map();
    for (const row of rows) if (!map.has(row.code)) map.set(row.code, row);
    return map;
  };
  const zt = first(pools.zt);
  const zb = first(pools.zb);
  const yesterday = first(pools.yesterday);
  const { height, rungs, firstTries } = promotion(pools);
  return {
    height,
    rungs: rungs.map((rung) => ({
      n: rung.n,
      sealed: rung.sealed.map((code) => stockOf(zt.get(code), code)),
      from: rung.from,
      promoted: rung.promoted,
      missed: rung.missed.map((code) => stockOf(yesterday.get(code), code)),
      broke: rung.broke.map((code) => stockOf(zb.get(code), code)),
      gap: rung.gap,
    })),
    firstTries,
    unavailable: null,
  };
}

/** @returns {YesterdayBlock} */
function yesterdayOf(items, pools) {
  if (items === null) return { count: 0, median: null, belowMinus5Share: null, rows: [], unavailable: "limit-up not frozen" };
  const pctKey = (row) => num(row.pct) ?? Infinity;
  const rows = pools.yesterday
    .filter((row) => (num(row.yesterdayBoards) ?? 0) >= 2)
    .sort((a, b) => b.yesterdayBoards - a.yesterdayBoards || pctKey(a) - pctKey(b) || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
    .map((row) => ({ code: row.code, name: str(row.name), yesterdayBoards: row.yesterdayBoards, pct: num(row.pct) }));
  return {
    count: pools.yesterday.length,
    median: num(measure(items, "yesterday_return_median")),
    belowMinus5Share: num(measure(items, "yesterday_negative_tail")),
    rows,
    unavailable: null,
  };
}

/** @returns {Record<string, StockFacts>} */
function stocksOf(items, pools) {
  /** @type {Record<string, StockFacts>} */
  const stocks = {};
  if (items === null) return stocks;
  const firstIn = (rows, code) => rows.find((row) => row.code === code);
  const codes = [...new Set([...pools.zt, ...pools.zb, ...pools.yesterday].map((row) => row.code))];
  for (const code of codes) {
    const zt = firstIn(pools.zt, code);
    const zb = firstIn(pools.zb, code);
    const y = firstIn(pools.yesterday, code);
    const row = zt ?? zb ?? y;
    const pool = zt ? "zt" : zb ? "zb" : "yesterday";
    const sealRow = zt ?? zb;
    const { minutes, minutesMissing } = lineOf(items, "code", code);
    const limits = minutes && num(minutes.prec) !== null ? limitPrices(minutes.prec, limitRate(code, row.name)) : null;
    const exchange = exchangeOf(code);
    stocks[code] = {
      code,
      symbol: exchange ? `${exchange}${code}` : null,
      name: str(row.name),
      industry: str(row.industry),
      pool,
      price: num(row.price),
      pct: num(row.pct),
      boards: zt ? num(zt.boards) : null,
      tried: zb ? (num(y?.yesterdayBoards) ?? 0) + 1 : null,
      yesterdayBoards: y ? num(y.yesterdayBoards) : null,
      firstSeal: sealTime(sealRow?.firstSealAt),
      lastSeal: sealTime(zt?.lastSealAt),
      breaks: num(sealRow?.breakCount),
      sealFunds: num(zt?.sealFunds),
      limitPrice: num(row.limitPrice),
      turnover: num(row.turnoverRate),
      amount: num(row.amount),
      limitUp: limits ? limits.up : null,
      limitDown: limits ? limits.down : null,
      minutes,
      minutesMissing,
    };
  }
  return stocks;
}

/**
 * The evidence half of a sealed run's view. `through` is the latest `through` among the index
 * minute lines, null when none was frozen; `session` the manifest's.
 * @param {SealedView} sealed
 * @returns {EvidenceView}
 */
export function evidenceView(sealed) {
  const index = sourceItems(sealed, "index");
  const limitUp = sourceItems(sealed, "limit-up");
  const pools = poolsOf(limitUp);
  const indices = indicesOf(index);
  const throughs = indices.rows.map((row) => row.minutes?.through).filter((t) => typeof t === "string").sort();
  return {
    session: str(sealed.manifest?.session),
    through: throughs.at(-1) ?? null,
    breadth: breadthOf(index),
    indices,
    ladder: ladderOf(limitUp, pools),
    yesterday: yesterdayOf(limitUp, pools),
    stocks: stocksOf(limitUp, pools),
  };
}

/**
 * The window of `span` minutes over which a minute line moved most: `change` in percentage points
 * of `prec`, `from`/`to` its ends as "HH:MM". Compared in whole fen, so equal moves tie exactly,
 * and a tie goes to the later window - the move nearest the line's end. A line shorter than
 * `span + 1` points is read whole; null without a line, a `prec`, or two points.
 * @param {Minutes | null | undefined} minutes
 * @param {number} [span]
 * @returns {{ from: string, to: string, change: number } | null}
 */
export function mostMoved(minutes, span = 60) {
  const price = minutes?.price;
  const prec = num(minutes?.prec);
  if (!Array.isArray(price) || price.length < 2 || prec === null || prec <= 0) return null;
  const width = Math.max(1, Math.min(Math.floor(span), price.length - 1));
  const fen = price.map((p) => Math.round(p * 100));
  let best = 0;
  let bestMove = fen[width] - fen[0];
  for (let i = 1; i + width < fen.length; i++) {
    const move = fen[i + width] - fen[i];
    if (Math.abs(move) >= Math.abs(bestMove)) {
      best = i;
      bestMove = move;
    }
  }
  return { from: minuteLabel(best), to: minuteLabel(best + width), change: ((price[best + width] - price[best]) / prec) * 100 };
}
