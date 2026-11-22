/** Ornn's compute price indices, keyless: the daily GPU rental indices ($/GPU·hr) and the token price indices ($/M tokens, per lab and per
 * class), from one fixed list. Three latest-index asks (GPU daily-all, the labs, the classes) are each kept an hour; a failed ask answers its
 * last good read, flagged stale, for ten minutes past that read's keep, then its rows are left out with the read's note naming them (and when
 * no ask has anything, the read is refused). A failed ask is not asked again for ten minutes. A row's price is its latest settle; its change is
 * the latest settle less the previous one, from the row's history: the list never waits for a history, it starts the missing ones in the
 * background, one at a time, one that answers per row per settle (a failed one tried again after an hour), and shows a row's change once its history has answered. A history is kept until
 * 24 h after its last point (at least an hour); a GPU's current (intraday) value from api.ornnai.com is read only by `quote`, kept five
 * minutes, and its host failing leaves the rest of the quote answered with a note. A quote waits at most ORNN_QUOTE_PART_MS for a history
 * or a current value and ORNN_QUOTE_MS in all (under the face's seven-second cut): one late or failed is null in the answer and is not
 * asked again for ten minutes (a late read still lands in its keep when it answers). Every row is view-only (venue `ornn`), never in `all` and
 * never a dollar volume; nothing Ornn does not give is computed but the change, said as such. Both hosts are in the shared guard
 * (local-http.ts LOCAL_HOSTS), so a 403, 429 or 3xx pauses that host for every ask. */
import { isRefusal, type Refusal } from "../core/errors.ts";
import { no } from "../refuse.ts";
import type { CnBar } from "./cn-history.ts";
import { realCnHttp, type CnHttp } from "./cn-http.ts";
import type { ExploreItem } from "./explore.ts";
import { ORNN_HOSTS, politeHosts } from "./local-http.ts";
import type { LocalMarket, LocalSort, LocalStatus } from "./local.ts";
import type { CandleRange } from "./trade.ts";

export { ORNN_HOSTS } from "./local-http.ts";

export interface OrnnIndex {
  /** the row's own id: its `at` symbol, as quotes and candles take it */
  id: string;
  /** `cmp:<id>` */
  key: string;
  name: string;
  kind: "gpu" | "lab" | "class";
  /** Ornn's own name for it: the GPU's (as its URLs take it), the lab's or the class's */
  ornn: string;
  unit: string;
}

export const GPU_UNIT = "$/GPU·hr";
export const TOKEN_UNIT = "$/M tokens";
const gpu = (id: string, ornn: string): OrnnIndex => ({ id, key: `cmp:${id}`, name: ornn, kind: "gpu", ornn, unit: GPU_UNIT });
const tok = (kind: "lab" | "class", ornn: string, name: string): OrnnIndex => ({ id: `tok-${ornn}`, key: `cmp:tok-${ornn}`, name, kind, ornn, unit: TOKEN_UNIT });

export const ORNN_INDICES: readonly OrnnIndex[] = [
  gpu("a100", "A100 SXM4"), gpu("b200", "B200"), gpu("b300", "B300"), gpu("h100", "H100 SXM"), gpu("h200", "H200"), gpu("rtx5090", "RTX 5090"),
  gpu("rtxpro6000", "RTX PRO 6000 WS"),
  tok("lab", "anthropic", "Anthropic tokens"), tok("lab", "openai", "OpenAI tokens"), tok("lab", "google", "Google tokens"),
  tok("lab", "deepseek", "DeepSeek tokens"),
  tok("class", "closed", "Closed-source tokens"), tok("class", "open", "Open-source tokens"),
];

export const ORNN_VENUE = "ornn";
export const ORNN_NAME = "Ornn";
/** the three latest-index asks are kept an hour */
export const ORNN_LIST_TTL_MS = 3_600_000;
/** a failed latest-index ask answers its last good read, flagged stale, for this long past that read's keep */
export const ORNN_STALE_MS = 600_000;
/** a failed latest-index ask is not asked again for this long (its last good read, or nothing, answers); nor a quote's history or current
 * value that failed or was late */
export const ORNN_FAIL_HOLD_MS = 600_000;
/** a quote waits this long for a row's history and a GPU's current value (both asked at once) */
export const ORNN_QUOTE_PART_MS = 3_000;
/** a quote's whole wait, its latest-index read included: under the face's seven-second cut of /api/quotes (face/src/market-proxy.ts) */
export const ORNN_QUOTE_MS = 5_000;
/** a GPU's current value is kept five minutes */
export const ORNN_CURRENT_TTL_MS = 300_000;
/** a history is kept until 24 h after its last point, and at least an hour */
export const ORNN_HISTORY_AFTER_MS = 86_400_000;
export const ORNN_HISTORY_MIN_MS = 3_600_000;
/** a background history read that failed is tried once more for the same settle after this long (a read that answered is once per settle) */
export const ORNN_HISTORY_RETRY_MS = 3_600_000;
/** the token histories are asked for this many days back from today (UTC dates): Ornn's free tier holds three months */
export const ORNN_HISTORY_DAYS = 90;
/** the pause between two background history reads */
export const ORNN_PACE_MS = 500;
export const ORNN_TIMEOUT_MS = 8_000;
export const ORNN_BODY_LIMIT = 1_000_000;
export const ORNN_HISTORY_NOTE = "Ornn's free history is three months";

const DATA = "https://data.ornn.com/api/public-index";
const DAILY_URL = `${DATA}/daily-index/all`;
const LABS_URL = `${DATA}/otpi`;
const CLASSES_URL = `${DATA}/otpi/weight-class`;
const CURRENT_URL = (name: string): string => `https://api.ornnai.com/api/gpu/${encodeURIComponent(name)}`;
const HEADERS = { accept: "application/json" };

/** a settle: the index's value and its settle date (YYYY-MM-DD) */
interface Settle { value: number; date: string }
/** a history point: its time (ms), its date and its value */
interface Point { t: number; date: string; value: number }
type Group = "gpu" | "lab" | "class";
const GROUP_WORDS: Record<Group, string> = { gpu: "Ornn's GPU indices", lab: "Ornn's lab token indices", class: "Ornn's class token indices" };

export type OrnnMarket = LocalMarket & { unit: string; current?: { value: number; at: string } | null };
export interface OrnnRows { items: ExploreItem[]; asOf: string; stale?: true; note?: string }
export interface OrnnHistory {
  venue: "ornn"; venueName: "Ornn"; symbol: string; range: Exclude<CandleRange, "1D" | "5D">; candles: CnBar[]; source: string; note?: string;
}
export interface OrnnSource {
  rows(sort: LocalSort): Promise<OrnnRows | Refusal>;
  history(id: string, range: CandleRange): Promise<OrnnHistory | Refusal>;
  quote(id: string): Promise<OrnnMarket | Refusal>;
  status(): LocalStatus;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.length ? v : null);
const round = (v: number, places: number): number => Math.round(v * 10 ** places) / 10 ** places;
const dayOf = (iso: string): string | null => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : null);
const utcDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
/** a timer that answers LATE after `ms`, and its clearing */
const LATE: unique symbol = Symbol("late");
function lateAfter(ms: number): { late: Promise<typeof LATE>; clear: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<typeof LATE>((go) => { timer = setTimeout(() => go(LATE), ms); });
  return { late, clear: () => clearTimeout(timer) };
}
function rowsOf(body: string): unknown[] {
  const v = JSON.parse(body) as { success?: unknown; data?: unknown };
  if (v.success === false || !Array.isArray(v.data)) throw new Error("shape");
  return v.data;
}

/** daily-all: each listed GPU's settle by Ornn's name; a GPU not on the list is left out */
export function parseDaily(body: string): Map<string, Settle> {
  const out = new Map<string, Settle>();
  for (const r of rowsOf(body) as Array<Record<string, unknown>>) {
    const name = str(r.gpu_type), value = num(r.index_value), date = dayOf(String(r.date ?? ""));
    if (name !== null && value !== null && date !== null) out.set(name, { value, date });
  }
  return out;
}
/** the labs' or the classes' latest: each one's settle by Ornn's name (`lab` or `class`) */
export function parseTokens(body: string, field: "lab" | "class"): Map<string, Settle> {
  const out = new Map<string, Settle>();
  for (const r of rowsOf(body) as Array<Record<string, unknown>>) {
    const name = str(r[field]), value = num(r.indexPerMtok), date = dayOf(String(r.date ?? ""));
    if (name !== null && value !== null && date !== null) out.set(name, { value, date });
  }
  return out;
}
/** a history, oldest first: a GPU's points stamped by Ornn's timestamp, a token's by its date (midnight UTC) */
export function parseHistory(body: string, kind: OrnnIndex["kind"]): Point[] {
  const out: Point[] = [];
  for (const r of rowsOf(body) as Array<Record<string, unknown>>) {
    if (kind === "gpu") {
      const ts = str(r.timestamp), value = num(r.index_value), t = ts === null ? NaN : Date.parse(ts);
      if (ts !== null && value !== null && Number.isFinite(t)) out.push({ t, date: ts.slice(0, 10), value });
    } else {
      const date = dayOf(String(r.date ?? "")), value = num(r.indexPerMtok);
      if (date !== null && value !== null) out.push({ t: Date.parse(`${date}T00:00:00Z`), date, value });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/** the change from the previous settle: the latest settle less the last history point dated before it; none without such a point, and none
 * where that point is zero (no percentage of nothing) */
function changeOf(settle: Settle, points: readonly Point[]): { change: number; changePct: number; prev: number } | null {
  const prev = [...points].reverse().find((p) => p.date < settle.date);
  if (!prev || prev.value === 0) return null;
  const change = round(settle.value - prev.value, 10);
  return { change, changePct: round((settle.value / prev.value - 1) * 100, 2), prev: prev.value };
}

export function ornnSource(deps: { http?: CnHttp; clock?: () => number; paceMs?: number } = {}): OrnnSource {
  const now = deps.clock ?? Date.now;
  const http = politeHosts(deps.http ?? realCnHttp, ORNN_HOSTS, deps.clock ? { clock: deps.clock } : {});
  const paceMs = deps.paceMs ?? ORNN_PACE_MS;
  let status: LocalStatus = { state: "unavailable", said: "Ornn · not read yet" };
  const badAction = (message: string): Refusal => no("E_ACCOUNT_BAD_ACTION", { venue: ORNN_VENUE, message });
  const unreachable = (message: string): Refusal => no("E_VENUE_UNREACHABLE", { venue: ORNN_VENUE, message });

  async function get(url: string): Promise<string> {
    const r = await http(url, { timeoutMs: ORNN_TIMEOUT_MS, maxBytes: ORNN_BODY_LIMIT, headers: HEADERS });
    if (r.status !== 200) throw new Error("http");
    return new TextDecoder("utf-8").decode(r.bytes);
  }

  // ---- the three latest-index asks -------------------------------------------------------------------------------------------------
  type Ask = { good?: { at: number; settles: Map<string, Settle> }; failedAt?: number; flight?: Promise<void> };
  const asks: Record<Group, Ask> = { gpu: {}, lab: {}, class: {} };
  const readers: Record<Group, () => Promise<Map<string, Settle>>> = {
    gpu: async () => parseDaily(await get(DAILY_URL)),
    lab: async () => parseTokens(await get(LABS_URL), "lab"),
    class: async () => parseTokens(await get(CLASSES_URL), "class"),
  };
  /** one group's settles: fresh within its keep, else asked (one flight), else its last good read flagged stale within the stale window */
  async function settlesOf(g: Group): Promise<{ settles: Map<string, Settle>; at: number; stale: boolean } | null> {
    const a = asks[g];
    const fresh = (): boolean => a.good !== undefined && now() - a.good.at < ORNN_LIST_TTL_MS;
    if (!fresh() && !(a.failedAt !== undefined && now() - a.failedAt < ORNN_FAIL_HOLD_MS)) {
      a.flight ??= readers[g]().then((settles) => {
        if (!settles.size) throw new Error("empty");
        a.good = { at: now(), settles }; delete a.failedAt;
      }).catch(() => { a.failedAt = now(); }).finally(() => { delete a.flight; });
      await a.flight;
    }
    if (!a.good) return null;
    if (fresh()) return { settles: a.good.settles, at: a.good.at, stale: false };
    return now() < a.good.at + ORNN_LIST_TTL_MS + ORNN_STALE_MS ? { settles: a.good.settles, at: a.good.at, stale: true } : null;
  }
  const groupOf = (i: OrnnIndex): Group => i.kind;

  // ---- histories ---------------------------------------------------------------------------------------------------------------------
  const histories = new Map<string, { at: number; points: Point[] }>();
  const historyFlights = new Map<string, Promise<Point[] | null>>();
  /** when a row's history last failed (or was late for a quote): not asked again for ORNN_FAIL_HOLD_MS */
  const historyFailedAt = new Map<string, number>();
  /** each row's change for a settle (`<id>|<date>`), from its history; a row with a history and no previous point is kept as null */
  const changes = new Map<string, ReturnType<typeof changeOf>>();
  /** the rows whose background history read is under way for a settle (`<id>|<date>`: "pending"), or failed (the time it failed): a read
   * that answers is once per row per settle; one that failed is tried again after ORNN_HISTORY_RETRY_MS */
  const started = new Map<string, "pending" | number>();
  const historyKeep = (points: readonly Point[], at: number): number =>
    Math.max(points.length ? points.at(-1)!.t + ORNN_HISTORY_AFTER_MS - at : 0, ORNN_HISTORY_MIN_MS);

  function historyUrl(i: OrnnIndex): string {
    if (i.kind === "gpu") return `${DATA}/gpu/${encodeURIComponent(i.ornn)}/index-history`;
    const end = now(), start = end - ORNN_HISTORY_DAYS * 86_400_000;
    const dates = `startDate=${utcDate(start)}&endDate=${utcDate(end)}`;
    return i.kind === "lab" ? `${LABS_URL}?lab=${encodeURIComponent(i.ornn)}&${dates}` : `${CLASSES_URL}?class=${encodeURIComponent(i.ornn)}&${dates}`;
  }
  /** a row's history: kept, or read (one flight); null when Ornn does not answer it, and for ORNN_FAIL_HOLD_MS after it failed */
  async function pointsOf(i: OrnnIndex): Promise<Point[] | null> {
    const hit = histories.get(i.id);
    if (hit && now() - hit.at < historyKeep(hit.points, hit.at)) return hit.points;
    const failed = historyFailedAt.get(i.id);
    if (failed !== undefined && now() - failed < ORNN_FAIL_HOLD_MS) return null;
    let flight = historyFlights.get(i.id);
    if (!flight) {
      flight = get(historyUrl(i)).then((body) => {
        const points = parseHistory(body, i.kind);
        if (!points.length) throw new Error("empty");
        histories.set(i.id, { at: now(), points });
        historyFailedAt.delete(i.id);
        return points;
      }).catch(() => { historyFailedAt.set(i.id, now()); return null; }).finally(() => historyFlights.delete(i.id));
      historyFlights.set(i.id, flight);
    }
    return flight;
  }
  /** the background line: one history read at a time, `paceMs` apart */
  let line: Promise<void> = Promise.resolve();
  function startHistory(i: OrnnIndex, settle: Settle): void {
    const key = `${i.id}|${settle.date}`;
    if (changes.has(key)) return;
    const was = started.get(key);
    if (was === "pending" || (typeof was === "number" && now() - was < ORNN_HISTORY_RETRY_MS)) return;
    // a new settle: the row's older settles are let go
    if (was === undefined) for (const m of [started, changes]) for (const k of m.keys()) if (k.startsWith(`${i.id}|`)) m.delete(k);
    started.set(key, "pending");
    line = line.then(async () => {
      const points = await pointsOf(i).catch(() => null);
      if (points) { changes.set(key, changeOf(settle, points)); started.delete(key); }
      else started.set(key, now());
      if (paceMs > 0) await new Promise<void>((go) => setTimeout(go, paceMs));
    }).catch(() => {});
  }

  // ---- rows --------------------------------------------------------------------------------------------------------------------------
  const settleWords = (s: Settle, stale: boolean): string => `${ORNN_NAME} · settle ${s.date}${stale ? " · stale" : ""}`;
  function rowOf(i: OrnnIndex, s: Settle, stale: boolean): { item: ExploreItem; pct: number | null } {
    const ch = changes.get(`${i.id}|${s.date}`) ?? null;
    const quoteFrom = settleWords(s, stale);
    return {
      pct: ch?.changePct ?? null,
      item: {
        key: i.key, kind: "computeIndex", name: i.name, unit: i.unit, base: i.id, asset: "compute", form: "spot", price: s.value,
        ...(ch ? { change24h: ch.change, changePct24h: ch.changePct } : {}),
        quoteFrom, tabs: [],
        at: [{ venue: ORNN_VENUE, venueName: ORNN_NAME, symbol: i.id, connected: false, canTrade: false, public: true, price: s.value, quoteFrom }],
      },
    };
  }

  type Read = { got: Partial<Record<Group, { settles: Map<string, Settle>; at: number; stale: boolean }>>; asOf: string; stale: boolean; note?: string };
  async function read(): Promise<Read | Refusal> {
    const groups: Group[] = ["gpu", "lab", "class"];
    const answers = await Promise.all(groups.map((g) => settlesOf(g)));
    const got: Read["got"] = {};
    groups.forEach((g, n) => { if (answers[n]) got[g] = answers[n]!; });
    const present = groups.filter((g) => got[g]);
    if (!present.length) {
      status = { state: "unavailable", said: "Ornn is not answering: its indices cannot be read now" };
      return unreachable("Ornn is not answering: its indices cannot be read now");
    }
    const staleGroups = present.filter((g) => got[g]!.stale), missing = groups.filter((g) => !got[g]);
    const asOf = new Date(Math.min(...present.map((g) => got[g]!.at))).toISOString();
    const notes = [
      ...(missing.length ? [`${missing.map((g) => GROUP_WORDS[g]).join(", ")} left out: Ornn did not answer`] : []),
      ...(staleGroups.length ? [`${staleGroups.map((g) => GROUP_WORDS[g]).join(", ")} not answering · last settle shown`] : []),
    ];
    status = staleGroups.length || missing.length
      ? { state: "stale", said: notes.join("; "), at: asOf }
      : { state: "live", said: "Ornn · answering", at: asOf };
    return { got, asOf, stale: staleGroups.length > 0, ...(notes.length ? { note: notes.join("; ") } : {}) };
  }
  const settleOf = (r: Read, i: OrnnIndex): { s: Settle; stale: boolean } | null => {
    const g = r.got[groupOf(i)];
    const s = g?.settles.get(i.ornn);
    return g && s ? { s, stale: g.stale } : null;
  };

  async function rows(sort: LocalSort): Promise<OrnnRows | Refusal> {
    const r = await read();
    if (isRefusal(r)) return r;
    const gpus: Array<{ item: ExploreItem; pct: number | null }> = [], tokens: typeof gpus = [];
    for (const i of ORNN_INDICES) {
      const got = settleOf(r, i);
      if (!got) continue;
      startHistory(i, got.s);
      (i.kind === "gpu" ? gpus : tokens).push(rowOf(i, got.s, got.stale));
    }
    gpus.sort((a, b) => (b.item.price ?? 0) - (a.item.price ?? 0));
    const list = [...gpus, ...tokens];
    if (sort === "movers") list.sort((a, b) => (b.pct === null ? -1 : Math.abs(b.pct)) - (a.pct === null ? -1 : Math.abs(a.pct)));
    return { items: list.map((x) => x.item), asOf: r.asOf, ...(r.stale ? { stale: true as const } : {}), ...(r.note !== undefined ? { note: r.note } : {}) };
  }

  // ---- history -----------------------------------------------------------------------------------------------------------------------
  const RANGES: ReadonlySet<CandleRange> = new Set(["1M", "3M", "6M", "YTD", "1Y", "5Y", "MAX"]);
  async function history(id: string, range: CandleRange): Promise<OrnnHistory | Refusal> {
    const i = ORNN_INDICES.find((x) => x.id === id);
    if (!i) return badAction("no such Ornn index");
    if (range === "1D" || range === "5D") return badAction("Ornn's indices settle daily: no intraday chart");
    if (!RANGES.has(range)) return badAction("no such chart range");
    const points = await pointsOf(i);
    if (!points) return unreachable("Ornn is not answering: that index's history cannot be read now");
    const candles = points.map((p): CnBar => ({ t: p.t, o: p.value, h: p.value, l: p.value, c: p.value }));
    const shown = range === "1M" ? candles.slice(-30) : candles;
    return { venue: "ornn", venueName: "Ornn", symbol: id, range: range as OrnnHistory["range"], candles: shown, source: ORNN_NAME,
      ...(range === "1M" ? {} : { note: ORNN_HISTORY_NOTE }) };
  }

  // ---- quote -------------------------------------------------------------------------------------------------------------------------
  const currents = new Map<string, { at: number; value: { value: number; at: string } }>();
  const currentFlights = new Map<string, Promise<{ value: number; at: string } | null>>();
  /** when a GPU's current value last failed (or was late for a quote): null, unasked, for ORNN_FAIL_HOLD_MS */
  const currentFailedAt = new Map<string, number>();
  async function currentOf(i: OrnnIndex): Promise<{ value: number; at: string } | null> {
    const hit = currents.get(i.id);
    if (hit && now() - hit.at < ORNN_CURRENT_TTL_MS) return hit.value;
    const failed = currentFailedAt.get(i.id);
    if (failed !== undefined && now() - failed < ORNN_FAIL_HOLD_MS) return null;
    let flight = currentFlights.get(i.id);
    if (!flight) {
      flight = get(CURRENT_URL(i.ornn)).then((body) => {
        const v = JSON.parse(body) as { success?: unknown; data?: { index_value?: unknown; last_updated?: unknown } };
        const value = num(v.data?.index_value), at = str(v.data?.last_updated);
        if (v.success === false || value === null || at === null) throw new Error("shape");
        const answer = { value, at };
        currents.set(i.id, { at: now(), value: answer });
        currentFailedAt.delete(i.id);
        return answer;
      }).catch(() => { currentFailedAt.set(i.id, now()); return null; }).finally(() => currentFlights.delete(i.id));
      currentFlights.set(i.id, flight);
    }
    return flight;
  }

  async function quote(id: string): Promise<OrnnMarket | Refusal> {
    const i = ORNN_INDICES.find((x) => x.id === id);
    if (!i) return badAction("no such Ornn index");
    // the whole wait, and each part's: a late read is still under way and lands in its keep when it answers
    const whole = lateAfter(ORNN_QUOTE_MS);
    const part = lateAfter(ORNN_QUOTE_PART_MS);
    let got: { s: Settle; stale: boolean } | null, points: Point[] | null | typeof LATE, current: { value: number; at: string } | null | undefined | typeof LATE;
    try {
      const r = await Promise.race([read(), whole.late]);
      if (r === LATE) return unreachable("Ornn is not answering: its indices cannot be read now");
      if (isRefusal(r)) return r;
      got = settleOf(r, i);
      if (!got) return unreachable(`Ornn did not answer ${i.name}'s settle`);
      [points, current] = await Promise.all([
        Promise.race([pointsOf(i), part.late, whole.late]),
        i.kind === "gpu" ? Promise.race([currentOf(i), part.late, whole.late]) : Promise.resolve(undefined),
      ]);
    } finally {
      whole.clear(); part.clear();
    }
    // late: null in this answer, and held as a failure while its read is under way (its answer clears the hold, its failure renews it)
    if (points === LATE) { if (historyFlights.has(i.id)) historyFailedAt.set(i.id, now()); points = null; }
    if (current === LATE) { if (currentFlights.has(i.id)) currentFailedAt.set(i.id, now()); current = null; }
    const { s, stale } = got;
    const ch = points ? changeOf(s, points) : null;
    if (points) changes.set(`${i.id}|${s.date}`, ch);
    const upTo = points ? points.filter((p) => p.date <= s.date).map((p) => p.value) : [];
    if (points && !points.some((p) => p.date === s.date)) upTo.push(s.value);
    const month = upTo.slice(-30);
    const notes = [
      ...(points ? [] : ["Ornn's history did not answer: no previous settle or 30-day range"]),
      ...(current === null ? ["Ornn's current value did not answer: the latest settle is shown"] : []),
    ];
    return {
      symbol: i.id, name: i.name, kind: "spot", base: i.id, quote: "USD", unit: i.unit, open: false, types: [], price: s.value,
      quoteFrom: settleWords(s, stale),
      ...(ch ? { change24h: ch.change, changePct24h: ch.changePct } : {}),
      local: {
        prevClose: ch?.prev ?? null, open: null, high: month.length ? Math.max(...month) : null, low: month.length ? Math.min(...month) : null,
        volume: null, turnover: null, lastSession: s.date, phase: "closed", quoteStatus: "unsaid",
      },
      ...(i.kind === "gpu" ? { current: current ?? null } : {}),
      ...(notes.length ? { note: notes.join("; ") } : {}),
    };
  }

  return { rows, history, quote, status: () => status };
}
