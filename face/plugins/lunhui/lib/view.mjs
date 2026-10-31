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
 *
 * The digest's number grammar (`viewDigest`), one rule for every line:
 * - a negative number is written with U+2212 "−", never "-", and there is no negative zero;
 * - a non-zero positive percentage carries "+" ("+0.82%"); zero is "0.00%", a negative "−1.33%";
 * - prices, percentages and ratios have two decimals ("3697.52", "ratio 0.12", "break_ratio 0.41");
 * - counts are whole numbers with no thousands separator ("4774 down", "limit_down_count 22");
 * - turnover in CNY is "X.XX万亿" from 1e12, "X.XX亿" from 1e8, else whole yuan;
 * - a value that is absent is "—".
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
 * minute lines only, null when none was frozen - a stock's line may run later and does not move
 * it; `session` the manifest's.
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

// ---- The artifact half (run view spec §5.3, §5.5) and the digest (M15) ----

/** The market modules the view reads, in the order their verdicts are drawn (M14). */
export const VIEW_MODULES = Object.freeze(["environment", "sentiment", "theme", "counterevidence"]);

/** The sources the sources block lists, in its order. */
const VIEW_SOURCES = ["index", "limit-up", "boards", "quotes"];

/** The modules with a verdict tile. */
const VERDICT_MODULES = ["environment", "sentiment", "theme"];

/** The signals block's fixed table: each measure, in drawing order, on its side. */
const SIGNAL_SIDES = [
  ["break_ratio", "contraction"],
  ["limit_down_count", "contraction"],
  ["yesterday_negative_tail", "contraction"],
  ["seal_ratio", "relay"],
  ["yesterday_return_median", "relay"],
  ["max_streak", "relay"],
];

/** The provider whose boards stand in for Eastmoney's. */
const STAND_IN_PROVIDER = "同花顺问财";

/** The digest's budget in UTF-8 bytes. */
const DIGEST_BYTES = 2048;

/**
 * A source's row: `provider` the manifest entry's provider (null on an older run), `fallbackFrom`
 * the refusal code of the provider it stood in for (`fallback_from.code`, null without one).
 * @typedef {{ source: string, frozen: boolean, delayed: boolean, provider: string | null, fallbackFrom: string | null,
 *   refusals: string[], missingIn: string[] }} SourceRow
 */
/** @typedef {{ id: string, text: string }} VerdictLine */
/**
 * A market module's tile: `state` its headline state (environment `index_state`, sentiment
 * `state`, theme `theme_stage`) or, for an artifact not `OK`, its status; `detail` the second
 * headline (`liquidity …`, `money effect …`, `rotation …`) or `missing <sources>`; `challenged` the
 * reviewer's items against it; `lines` its claims, then its limitations with id "—".
 * @typedef {{ module: string, status: string | null, state: string | null, detail: string | null,
 *   challenged: number, lines: VerdictLine[] }} Verdict
 */
/** @typedef {{ id: string, against: string | null, kind: string | null, text: string }} ReviewerItem */
/** @typedef {{ items: ReviewerItem[] }} ReviewerBlock */
/** @typedef {{ measure: string, value: number, side: "contraction" | "relay" }} SignalMeasure */
/**
 * @typedef {{ state: string | null, moneyEffect: string | null, conflict: string | null,
 *   measures: SignalMeasure[], challenges: ReviewerItem[] }} SignalsBlock
 */
/** @typedef {{ module: string, id: string, text: string }} Citation */
/**
 * The run view (§5.5): the evidence half, the run's names and seal time, the sources, the
 * verdicts, the reviewer, the signals, and each stock's citations. `through` is the max `through`
 * across the index minute lines only (null without one); stock lines may run later than it.
 * `stocks` is keyed by code and carries no `unavailable` - such a key would collide with a code -
 * so a consumer reads `ladder.unavailable` to know whether the limit-up pools were frozen.
 * @typedef {Omit<EvidenceView, "stocks"> & { strategy: string, run: string, frozenAt: string | null,
 *   sources: SourceRow[], verdicts: Verdict[], reviewer: ReviewerBlock | null,
 *   signals: SignalsBlock | null, stocks: Record<string, StockFacts & { cited: Citation[] }> }} View
 */

const strings = (value) => (Array.isArray(value) ? value.filter((v) => typeof v === "string") : []);

/** The view's modules: the listed ones (or the manifest's artifacts) among `VIEW_MODULES`, with an artifact read. */
function modulesOf(sealed, modules) {
  const wanted = new Set(Array.isArray(modules) ? modules : strings(sealed.manifest?.artifacts));
  const artifacts = sealed.artifacts ?? {};
  return VIEW_MODULES.filter((name) => wanted.has(name) && artifacts[name] && typeof artifacts[name] === "object");
}

/** @returns {SourceRow[]} */
function sourcesOf(sealed, artifacts) {
  const listed = sealed.manifest?.evidence ?? [];
  const refusals = sealed.metrics?.refusals ?? {};
  return VIEW_SOURCES.map((source) => {
    const entry = listed.find((e) => e?.source === source);
    return {
      source,
      frozen: entry !== undefined,
      delayed: entry?.delayed === true,
      provider: str(entry?.provider),
      fallbackFrom: str(entry?.fallback_from?.code),
      refusals: strings(refusals[source]),
      missingIn: Object.keys(artifacts).filter((module) => strings(artifacts[module].missing_sources).includes(source)),
    };
  });
}

/** @returns {ReviewerItem[]} */
function reviewerItemsOf(artifact) {
  return (Array.isArray(artifact?.items) ? artifact.items : []).map((item) => ({
    id: String(item?.id ?? "—"), against: str(item?.against), kind: str(item?.kind), text: String(item?.text ?? ""),
  }));
}

/** The headline state and the second headline of an OK artifact, by module. */
const HEADLINES = {
  environment: (a) => [str(a.index_state), a.liquidity_state ? `liquidity ${a.liquidity_state}` : null],
  sentiment: (a) => [str(a.state), a.money_effect ? `money effect ${a.money_effect}` : null],
  theme: (a) => [str(a.theme_stage), a.rotation ? `rotation ${a.rotation}` : null],
};

/** @returns {Verdict} */
function verdictOf(module, artifact, reviewer) {
  const status = str(artifact.status);
  const missing = strings(artifact.missing_sources);
  const [state, detail] = status === "OK"
    ? HEADLINES[module](artifact)
    : [status, missing.length ? `missing ${missing.join(", ")}` : null];
  const claims = (Array.isArray(artifact.claims) ? artifact.claims : []).map((c) => ({ id: String(c?.id ?? "—"), text: String(c?.text ?? "") }));
  const limitations = strings(artifact.limitations).map((text) => ({ id: "—", text }));
  return {
    module, status, state: state ?? status, detail,
    challenged: (reviewer ?? []).filter((item) => item.against === module).length,
    lines: [...claims, ...limitations],
  };
}

/** A derived measure's value from either source's items. */
function measureOf(sealed, name) {
  for (const source of ["limit-up", "index"]) {
    const value = measure(sourceItems(sealed, source) ?? [], name);
    if (value !== null) return value;
  }
  return null;
}

/** @returns {SignalsBlock} */
function signalsOf(sealed, sentiment, reviewer) {
  const streaks = measureOf(sealed, "streak_distribution");
  const keys = streaks && typeof streaks === "object" ? Object.keys(streaks).map(Number).filter(Number.isFinite) : [];
  const value = (name) => (name === "max_streak" ? (keys.length ? Math.max(...keys) : null) : num(measureOf(sealed, name)));
  return {
    state: str(sentiment.state),
    moneyEffect: str(sentiment.money_effect),
    conflict: str(sentiment.conflict),
    measures: SIGNAL_SIDES.flatMap(([name, side]) => {
      const v = value(name);
      return v === null ? [] : [{ measure: name, value: v, side }];
    }),
    challenges: (reviewer ?? []).filter((item) => item.against === "sentiment"),
  };
}

/** Each stock with the claims and challenges citing it: its pool rows' ids among their evidence ids, or its name in their text. */
function citedStocks(stocks, limitUp, artifacts) {
  const ids = new Map();
  for (const item of limitUp ?? [])
    if (item && typeof item.pool === "string" && typeof item.code === "string" && typeof item.id === "string")
      ids.set(item.code, [...(ids.get(item.code) ?? []), item.id]);
  const texts = [];
  for (const [module, artifact] of Object.entries(artifacts)) {
    const rows = module === "counterevidence" ? [...(artifact.claims ?? []), ...(artifact.items ?? [])] : artifact.claims ?? [];
    for (const row of Array.isArray(rows) ? rows : [])
      if (row && typeof row.text === "string") texts.push({ module, id: String(row.id ?? "—"), text: row.text, evidence: strings(row.evidence_ids) });
  }
  return Object.fromEntries(Object.entries(stocks).map(([code, facts]) => {
    const own = ids.get(code) ?? [];
    const cited = texts
      .filter((t) => t.evidence.some((id) => own.includes(id)) || (facts.name && t.text.includes(facts.name)))
      .map(({ module, id, text }) => ({ module, id, text }));
    return [code, { ...facts, cited }];
  }));
}

/**
 * A sealed run's whole view (§5.5): `evidenceView`'s blocks, plus the sources, the verdicts of the
 * listed market modules, the reviewer, the signals, and each stock's citations. `modules` defaults
 * to the manifest's artifacts among `VIEW_MODULES`; unknown names are ignored, and a module whose
 * artifact was not read counts as unlisted. `reviewer` needs counterevidence, `signals` sentiment.
 * `evidence`, when given, is `evidenceView(sealed)` computed earlier (the runs service's cache): it
 * is used as it is, its blocks shared by reference with the view, so neither may be mutated.
 * @param {SealedView} sealed
 * @param {{ modules?: string[], evidence?: ReturnType<typeof evidenceView> }} [options]
 * @returns {View}
 */
export function buildView(sealed, { modules, evidence: cached } = {}) {
  const evidence = cached ?? evidenceView(sealed);
  const listed = modulesOf(sealed, modules);
  /** @type {Record<string, any>} */
  const artifacts = Object.fromEntries(listed.map((name) => [name, sealed.artifacts?.[name]]));
  const reviewerItems = artifacts.counterevidence ? reviewerItemsOf(artifacts.counterevidence) : null;
  return {
    strategy: sealed.strategy,
    run: sealed.run,
    frozenAt: str(sealed.manifest?.sealed_at),
    ...evidence,
    sources: sourcesOf(sealed, artifacts),
    verdicts: VERDICT_MODULES.filter((m) => artifacts[m]).map((m) => verdictOf(m, artifacts[m], reviewerItems)),
    reviewer: reviewerItems ? { items: reviewerItems } : null,
    signals: artifacts.sentiment ? signalsOf(sealed, artifacts.sentiment, reviewerItems) : null,
    stocks: citedStocks(evidence.stocks, sourceItems(sealed, "limit-up"), artifacts),
  };
}

/** Two decimals, U+2212 for a negative, no negative zero. */
function fix2(x) {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  const text = (Math.round(x * 100) === 0 ? 0 : x).toFixed(2);
  return text.startsWith("-") ? `−${text.slice(1)}` : text;
}

/** A signed percentage, two decimals: "+0.82%", "−1.33%", "0.00%". */
function pctText(x) {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  const text = fix2(x);
  return `${x > 0 && text !== "0.00" ? "+" : ""}${text}%`;
}

/** A turnover in CNY: 万亿 at 1e12 or more, 亿 at 1e8 or more. */
function turnoverText(x) {
  if (x === null || !Number.isFinite(x)) return "—";
  if (Math.abs(x) >= 1e12) return `${fix2(x / 1e12)}万亿`;
  if (Math.abs(x) >= 1e8) return `${fix2(x / 1e8)}亿`;
  return String(Math.round(x));
}

/** The signals' measures that are counts, written whole; every other measure is a ratio or a percentage. */
const COUNT_MEASURES = new Set(["limit_down_count", "max_streak"]);

/** A signal measure's value: a count whole, anything else to two decimals as the breadth ratio is. */
const valueText = (name, x) => (COUNT_MEASURES.has(name) ? countText(x) : fix2(x));
const countText = (x) => (x === null || x === undefined ? "—" : String(x));
const nameText = (stock) => stock.name ?? stock.code;

/** "UPSTREAM_TIMEOUT, UPSTREAM_INVALID×2": each code once, in first order, with its count past one. */
function refusalText(codes) {
  const counts = new Map();
  for (const code of codes) counts.set(code, (counts.get(code) ?? 0) + 1);
  return [...counts].map(([code, n]) => (n > 1 ? `${code}×${n}` : code)).join(", ");
}

/** An index row: close and pct, then high, low and the hour that moved most when a line was frozen. */
function indexLine(row) {
  let line = `${row.name ?? row.symbol} ${fix2(row.last)} ${pctText(row.pct)}`;
  const price = row.minutes?.price;
  if (!Array.isArray(price) || price.length === 0) return line;
  let hi = 0;
  let lo = 0;
  price.forEach((p, i) => {
    if (p > price[hi]) hi = i;
    if (p < price[lo]) lo = i;
  });
  line += ` · high ${fix2(price[hi])} ${minuteLabel(hi)} · low ${fix2(price[lo])} ${minuteLabel(lo)}`;
  const moved = mostMoved(row.minutes);
  if (moved) line += ` · most moved ${moved.from}–${moved.to} ${pctText(moved.change)}`;
  return line;
}

/** A rung's counts: "4: 3 sealed, from 3 3/6", "3: gap, from 2 0/8, 1 broke". */
function rungText(rung) {
  let text = `${rung.n}: ${rung.gap ? "gap" : `${rung.sealed.length} sealed`}`;
  if (rung.from !== null) text += `, from ${rung.n - 1} ${rung.promoted}/${rung.from}`;
  if (rung.broke.length) text += `, ${rung.broke.length} broke`;
  return text;
}

/** The count lines, in order: what the digest keeps first. */
function countLines(view) {
  const out = [`run ${view.run} · session ${view.session ?? "—"}${view.through ? ` · through ${view.through}` : ""}`];
  if (view.verdicts.length) out.push(`verdicts: ${view.verdicts.map((v) => `${v.module} ${v.state ?? "—"}`).join(" · ")}`);
  if (view.reviewer) {
    const against = VERDICT_MODULES.map((m) => [m, view.reviewer.items.filter((i) => i.against === m).length]).filter(([, n]) => n > 0);
    out.push(`reviewer: ${view.reviewer.items.length} items${against.map(([m, n]) => ` · ${m} ${n}`).join("")}`);
  }
  out.push(`sources: ${view.sources.map((s) => {
    if (s.frozen) return `${s.source} ✓${s.provider === STAND_IN_PROVIDER ? ` via iFinD${s.fallbackFrom ? ` (Eastmoney ${s.fallbackFrom})` : ""}` : ""}${s.delayed ? " delayed" : ""}`;
    if (s.refusals.length || s.missingIn.length) return `${s.source} ✗${s.refusals.length ? ` ${refusalText(s.refusals)}` : ""}`;
    return `${s.source} —`;
  }).join(" · ")}`);
  const b = view.breadth;
  out.push(b.unavailable
    ? `breadth: ${b.unavailable}`
    : `breadth: ${countText(b.advancers)} up · ${countText(b.unchanged)} unchanged · ${countText(b.decliners)} down · ratio ${fix2(b.ratio)} · limit-up ${countText(b.limitUp)} · limit-down ${countText(b.limitDown)} · turnover ${turnoverText(b.turnover)}`);
  if (view.indices.unavailable) out.push(`indices: ${view.indices.unavailable}`);
  else out.push(...view.indices.rows.map(indexLine));
  const l = view.ladder;
  out.push(l.unavailable
    ? `ladder: ${l.unavailable}`
    : `ladder: height ${l.height}${l.rungs.map((r) => ` · ${rungText(r)}`).join("")} · first tries ${l.firstTries.sealed}/${l.firstTries.tries}`);
  const y = view.yesterday;
  out.push(y.unavailable
    ? `yesterday: ${y.unavailable}`
    : `yesterday: ${y.count} limit-ups · median ${pctText(y.median)} · ${y.belowMinus5Share === null ? "—" : fix2(y.belowMinus5Share * 100) + "%"} below −5%`);
  if (view.signals) {
    const s = view.signals;
    const side = (name) => s.measures.filter((m) => m.side === name).map((m) => `${m.measure} ${valueText(m.measure, m.value)}`).join(", ") || "—";
    out.push(`signals: ${s.state ?? "—"} · money effect ${s.moneyEffect ?? "—"} · contraction ${side("contraction")} · relay ${side("relay")} · ${s.challenges.length} challenged`);
  }
  return out;
}

/** The name lines, after every count: the ladder's names from two boards up, then yesterday's. */
function nameLines(view) {
  const out = [];
  for (const rung of view.ladder.rungs) {
    if (rung.n < 2) continue;
    if (rung.sealed.length) out.push(`${rung.n} sealed: ${rung.sealed.map(nameText).join(", ")}`);
    if (rung.broke.length) out.push(`${rung.n} broke: ${rung.broke.map(nameText).join(", ")}`);
    if (rung.missed.length) out.push(`${rung.n} missed: ${rung.missed.map((s) => `${nameText(s)} ${pctText(s.pct)}`).join(", ")}`);
  }
  if (view.yesterday.rows.length)
    out.push(`yesterday names: ${view.yesterday.rows.map((r) => `${r.name ?? r.code} ${r.yesterdayBoards}b ${pctText(r.pct)}`).join(", ")}`);
  return out;
}

/** `text` cut to `limit` UTF-8 bytes with "…" at its end, at the last separator when one is near. */
function cut(text, limit) {
  const room = limit - Buffer.byteLength("…", "utf8");
  let end = 0;
  let bytes = 0;
  for (const ch of text) {
    const size = Buffer.byteLength(ch, "utf8");
    if (bytes + size > room) break;
    bytes += size;
    end += ch.length;
  }
  const head = text.slice(0, end);
  const at = Math.max(head.lastIndexOf(", "), head.lastIndexOf(" · "), head.lastIndexOf("\n"));
  if (at > end / 2) return head[at] === "\n" ? `${head.slice(0, at + 1)}…` : `${head.slice(0, at)}…`;
  return `${head}…`;
}

/**
 * The text Gravit composes its answer from (M15): one line per fact the face will draw - the run,
 * the verdicts, the reviewer, the sources, breadth, each index (close, pct, and with a minute line
 * its high, low and the hour that moved most), the ladder's rungs and promotions, yesterday, the
 * signals - then the names. At most 2,048 UTF-8 bytes: past that the tail is cut and ends in "…",
 * so the name lists go before any count. Prices and percentages to two decimals, "−" for a
 * negative. A run read mid-session says "through HH:MM"; nothing says closed.
 * @param {View} view
 * @returns {string}
 */
export function viewDigest(view) {
  const text = [...countLines(view), ...nameLines(view)].join("\n");
  return Buffer.byteLength(text, "utf8") <= DIGEST_BYTES ? text : cut(text, DIGEST_BYTES);
}
