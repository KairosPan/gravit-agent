/** The world's cash indices, every region from one fixed list, each index on its own source chain (Tencent, Naver, TWSE MIS, Eastmoney).
 * One read per region: the first source of each index is asked once for all that region's indices it covers (Naver and Eastmoney take a
 * comma list), then the next source once for those that failed; the whole read is bounded at 9 s and what answered is returned. An index no
 * source answered keeps its last level flagged stale for a day, then is left out with the read's note naming it. A non-200 reply, a body that
 * does not parse and a reply with no row are each a failure for the indices it should have carried. A read that is not whole (a stale row or
 * a missing one) is never written into the keep. An index with no source that answered in Task 3's fixtures is not on the list (spec §5.3). */
import { isRefusal, type Refusal } from "../core/errors.ts";
import { no } from "../refuse.ts";
import { CN_BARS, HISTORY_BODY_LIMIT, historyUrl, parseKline, type CnBar } from "./cn-history.ts";
import { realCnHttp, type CnHttp } from "./cn-http.ts";
import { decodeGbk, QUOTE_RESPONSE_LIMIT, QUOTE_TIMEOUT_MS } from "./cn-quotes.ts";
import { BARS_TTL_MS, cnKeeper } from "./china.ts";
import type { RegionId } from "./categories.ts";
import { eastmoney, emKlineUrl, emSecidsUrl, type EmRow } from "./eastmoney.ts";
import type { ExploreItem } from "./explore.ts";
import { hkKlineUrl, parseHkKline } from "./hk-parse.ts";
import {
  misIndexUrl, naverDomesticUrl, naverIndexChartUrl, naverWorldUrl, parseMisIndex, parseNaverIndexChart, parseNaverIndices, parseTencentIndices,
  tencentIndexUrl, type IxLevel,
} from "./index-parse.ts";
import { HK_HOSTS, NAVER_HOSTS, politeHosts, retryOnce, TWSE_HOSTS } from "./local-http.ts";
import { localSession, SESSIONS, type SessionHours } from "./local-session.ts";
import { indexRow, quoteWord, rankTtlMs, type LocalHistory, type LocalMarket, type LocalRead, type LocalSort, type LocalStatus } from "./local.ts";
import type { CnSession } from "./cn-session.ts";
import type { CandleRange } from "./trade.ts";

export interface SourceCode { from: "tencent" | "naver" | "naver-kr" | "eastmoney" | "twse"; code: string }
export interface WorldIndex {
  region: RegionId; id: string; name: string;
  /** the index's own exchange hours: a key of SESSIONS, or "cn" (Asia/Shanghai 09:30-11:30, 13:00-15:00) */
  hours: keyof typeof SESSIONS | "cn";
  quote: SourceCode[]; history: SourceCode[];
}

export const IX_READ_MS = 9_000;
export const IX_LIVE_MS = 15_000;
/** a level kept after its sources stopped answering is shown (flagged stale) for a day, then left out */
export const IX_STALE_MS = 86_400_000;
const CN_HOURS: SessionHours = { zone: "Asia/Shanghai", windows: [["09:30", "11:30"], ["13:00", "15:00"]] };
const hoursOf = (h: WorldIndex["hours"]): SessionHours => (h === "cn" ? CN_HOURS : SESSIONS[h]);
const NAMES: Record<SourceCode["from"], string> = { tencent: "Tencent", naver: "Naver", "naver-kr": "Naver", eastmoney: "Eastmoney", twse: "TWSE" };

const tc = (code: string): SourceCode => ({ from: "tencent", code });
const nv = (code: string): SourceCode => ({ from: "naver", code });
const nk = (code: string): SourceCode => ({ from: "naver-kr", code });
const em = (code: string): SourceCode => ({ from: "eastmoney", code });
/** an index whose history is Eastmoney's kline, then Naver's chart (world codes only) as its quote chain names them; Tencent-first indices say theirs */
function ix(region: RegionId, id: string, name: string, hours: WorldIndex["hours"], quote: SourceCode[], history?: SourceCode[]): WorldIndex {
  return { region, id, name, hours, quote, history: history ?? [...quote.filter((s) => s.from === "eastmoney"), ...quote.filter((s) => s.from === "naver")] };
}
const cn = (id: string, name: string, code: string, secid: string): WorldIndex => ix("cn", id, name, "cn", [tc(code)], [tc(code), em(secid)]);
const hk = (id: string, name: string, code: string, secid: string, naver: SourceCode[]): WorldIndex =>
  ix("hk", id, name, "hk", [tc(code), ...naver, em(secid)], [tc(code), em(secid)]);

export const WORLD_INDICES: readonly WorldIndex[] = [
  ix("us", "spx", "S&P 500", "us", [nv(".INX"), em("100.SPX")]),
  ix("us", "ccmp", "Nasdaq Composite", "us", [nv(".IXIC")]),
  ix("us", "dji", "Dow Jones", "us", [nv(".DJI"), em("100.DJIA")]),
  cn("sse", "SSE Composite", "sh000001", "1.000001"),
  cn("szse", "SZSE Component", "sz399001", "0.399001"),
  cn("csi300", "CSI 300", "sh000300", "1.000300"),
  cn("chinext", "ChiNext", "sz399006", "0.399006"),
  cn("star50", "STAR 50", "sh000688", "1.000688"),
  hk("hsi", "Hang Seng", "hkHSI", "100.HSI", [nv(".HSI")]),
  hk("hscei", "Hang Seng China Enterprises", "hkHSCEI", "100.HSCEI", []),
  hk("hstech", "Hang Seng Tech", "hkHSTECH", "124.HSTECH", []),
  ix("jp", "n225", "Nikkei 225", "jp", [nv(".N225"), em("100.N225")]),
  ix("kr", "kospi", "KOSPI", "kr", [nk("KOSPI"), em("100.KS11")]),
  ix("kr", "kospi200", "KOSPI 200", "kr", [em("100.KOSPI200")]),
  ix("kr", "kosdaq", "KOSDAQ", "kr", [nk("KOSDAQ")]),
  ix("tw", "taiex", "TAIEX", "tw", [{ from: "twse", code: "t00" }, nv(".TWII"), em("100.TWII")], [em("100.TWII"), nv(".TWII")]),
  ix("in", "sensex", "BSE Sensex", "in", [nv(".BSESN"), em("100.SENSEX")]),
  ix("eu", "sx5e", "Euro Stoxx 50", "xetr", [nv(".STOXX50E"), em("100.SX5E")]),
  ix("eu", "dax", "DAX", "xetr", [nv(".GDAXI"), em("100.GDAXI")]),
  ix("eu", "ftse", "FTSE 100", "xlon", [nv(".FTSE"), em("100.FTSE")]),
  ix("eu", "cac", "CAC 40", "xpar", [nv(".FCHI"), em("100.FCHI")]),
];

type Fresh = IxLevel & { from: string };
type Base = { fresh: Map<string, Fresh>; stale: Map<string, Fresh>; left: WorldIndex[]; asOf: string; session: CnSession; whole: boolean };
type LevelsAnswer = { items: ExploreItem[]; read: LocalRead };
const ids = (region: RegionId): WorldIndex[] => WORLD_INDICES.filter((i) => i.region === region);
const MONTHS: Partial<Record<CandleRange, number>> = { "1M": 1, "3M": 3, "6M": 6, "1Y": 12, "5Y": 60 };
const EM_LIMIT: Record<Exclude<CandleRange, "1D" | "5D">, number> = { "1M": 40, "3M": 100, "6M": 200, YTD: 260, "1Y": 320, "5Y": 1320, MAX: 9000 };

export function worldIndices(deps: { http?: CnHttp; clock?: () => number; eastmoney?: ReturnType<typeof eastmoney> } = {}): {
  levels(region: RegionId, sort?: LocalSort): Promise<LevelsAnswer | Refusal>;
  quotes(ids: readonly string[]): Promise<Map<string, LocalMarket> | Refusal>;
  history(id: string, range: CandleRange): Promise<LocalHistory | Refusal>;
  status(): LocalStatus;
} {
  const now = deps.clock ?? Date.now;
  const raw = deps.http ?? realCnHttp;
  const clock = deps.clock ? { clock: deps.clock } : {};
  const tencent = politeHosts(raw, HK_HOSTS, clock), naver = politeHosts(raw, NAVER_HOSTS, clock), twse = politeHosts(raw, TWSE_HOSTS, clock);
  const em_ = deps.eastmoney ?? eastmoney({ http: raw, ...clock });
  let status: LocalStatus = { state: "unavailable", said: "Indices · not read yet" };
  const unavailable = (): Refusal => no("E_VENUE_UNREACHABLE", { venue: "ix", message: "no source is answering: the indices cannot be read now" });
  const badAction = (message: string): Refusal => no("E_ACCOUNT_BAD_ACTION", { venue: "ix", message });

  async function get(http: CnHttp, url: string, maxBytes = QUOTE_RESPONSE_LIMIT): Promise<Uint8Array> {
    const reply = await retryOnce(() => http(url, { timeoutMs: QUOTE_TIMEOUT_MS, maxBytes }));
    if (reply.status !== 200) throw new Error("http");
    return reply.bytes;
  }
  const utf8 = (b: Uint8Array): string => new TextDecoder("utf-8").decode(b);

  /** one ask of one source for these codes: what it answered by code; a failed ask answers nothing */
  async function ask(from: SourceCode["from"], codes: string[]): Promise<Map<string, IxLevel>> {
    try {
      if (from === "tencent") return parseTencentIndices(decodeGbk(await get(tencent, tencentIndexUrl(codes))), codes) ?? new Map();
      if (from === "naver") return parseNaverIndices(utf8(await get(naver, naverWorldUrl(codes))), "world") ?? new Map();
      if (from === "naver-kr") return parseNaverIndices(utf8(await get(naver, naverDomesticUrl(codes))), "domestic") ?? new Map();
      if (from === "twse") {
        const one = parseMisIndex(utf8(await get(twse, misIndexUrl(codes[0]!))), codes[0]!);
        return one ? new Map([[codes[0]!, one]]) : new Map();
      }
      const rows = await em_.list(emSecidsUrl(codes));
      if (isRefusal(rows)) return new Map();
      const out = new Map<string, IxLevel>();
      for (const r of rows as EmRow[]) {
        const code = codes.find((c) => c.split(".")[1] === r.code);
        if (code === undefined || r.price === null) continue;
        out.set(code, { level: r.price, change: r.change, changePct: r.changePct, prevClose: r.prevClose, open: r.open, high: r.high, low: r.low, at: r.at ?? null, delayMin: null });
      }
      return out;
    } catch { return new Map(); }
  }

  const lastGood = new Map<string, { at: number; level: Fresh }>();
  const keySource = (i: WorldIndex): string => `${i.region}:${i.id}`;

  async function readRegion(region: RegionId): Promise<Base | Refusal> {
    const list = ids(region);
    const fresh = new Map<string, Fresh>();
    let closed = false;
    /** the indices at their `step`th source, grouped by source, each group asked once; those that failed go to the next, not waiting for the others */
    const run = (pending: WorldIndex[], step: number): Promise<void> => {
      const groups = new Map<SourceCode["from"], WorldIndex[]>();
      for (const i of pending) { const s = i.quote[step]; if (s) groups.set(s.from, [...(groups.get(s.from) ?? []), i]); }
      return Promise.all([...groups].map(async ([from, members]) => {
        const got = await ask(from, members.map((i) => i.quote[step]!.code));
        if (closed) return;
        const failed: WorldIndex[] = [];
        for (const i of members) {
          const l = got.get(i.quote[step]!.code);
          if (l) fresh.set(i.id, { ...l, from: quoteWord(NAMES[from], l.delayMin) }); else failed.push(i);
        }
        if (failed.length) await run(failed, step + 1);
      })).then(() => undefined);
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => { timer = setTimeout(resolve, IX_READ_MS); });
    await Promise.race([run(list, 0), deadline]);
    clearTimeout(timer);
    closed = true;
    const at = now();
    const answered = new Map(fresh); // a late answer cannot change what this read says
    for (const [id, l] of answered) lastGood.set(`${region}:${id}`, { at, level: l });
    const stale = new Map<string, Fresh>();
    const left: WorldIndex[] = [];
    for (const i of list) {
      if (answered.has(i.id)) continue;
      const old = lastGood.get(keySource(i));
      if (old && at - old.at < IX_STALE_MS) stale.set(i.id, old.level); else left.push(i);
    }
    if (!answered.size && !stale.size) { status = { state: "unavailable", said: "no source is answering: the indices cannot be read now" }; return unavailable(); }
    const asOf = new Date(at).toISOString();
    const lastTrade = [...answered.values()].map((l) => l.at).find((t) => t !== null) ?? null;
    const sessions = list.map((i) => localSession(hoursOf(i.hours), at, answered.get(i.id)?.at ?? lastTrade));
    const session = sessions.find((s) => s.phase === "trading") ?? sessions.find((s) => s.phase === "midday") ?? sessions[0]!;
    status = stale.size ? { state: "stale", said: `${[...stale.keys()].join(", ")} not answering · last level shown`, at: asOf } : { state: "live", said: "Indices · answering", at: asOf };
    return { fresh: answered, stale, left, asOf, session, whole: !stale.size && !left.length };
  }

  /** a region's read kept 15 s in session, until its earliest next open outside it (Europe's indices each by their own exchange's hours) */
  const kept = new Map<RegionId, { until: number; base: Base }>();
  const flights = new Map<RegionId, Promise<Base | Refusal>>();
  async function base(region: RegionId): Promise<Base | Refusal> {
    const hit = kept.get(region);
    if (hit && now() < hit.until) return hit.base;
    let flight = flights.get(region);
    if (!flight) {
      flight = readRegion(region).then((b) => {
        if (!isRefusal(b) && b.whole) {
          const t = now();
          kept.set(region, { until: t + Math.min(...ids(region).map((i) => rankTtlMs(hoursOf(i.hours), t, IX_LIVE_MS))), base: b });
        }
        return b;
      }).finally(() => flights.delete(region));
      flights.set(region, flight);
    }
    return flight;
  }

  const levelOf = (b: Base, i: WorldIndex): { l: Fresh; stale: boolean } | null => {
    const f = b.fresh.get(i.id); if (f) return { l: f, stale: false };
    const s = b.stale.get(i.id); return s ? { l: s, stale: true } : null;
  };

  async function levels(region: RegionId, sort: LocalSort = "volume"): Promise<LevelsAnswer | Refusal> {
    if (!ids(region).length) return badAction("no such region");
    const b = await base(region);
    if (isRefusal(b)) return b;
    const rows = ids(region).flatMap((i) => {
      const got = levelOf(b, i);
      if (!got) return [];
      const { l, stale } = got;
      return [{ pct: l.changePct, item: indexRow({ region, id: i.id, name: i.name, level: l.level, change: l.change, changePct: l.changePct,
        quoteFrom: stale ? `${l.from} · stale` : l.from, ...(l.at !== null ? { quoteAt: l.at } : {}) }) }];
    });
    if (sort === "movers") rows.sort((a, c) => (c.pct === null ? -1 : Math.abs(c.pct)) - (a.pct === null ? -1 : Math.abs(a.pct)));
    const note = b.left.length ? `${b.left.map((i) => i.name).join(", ")} left out: no source answered` : "the cash indices, each from its own source";
    const st: LocalStatus = b.stale.size ? { state: "stale", said: `${[...b.stale.keys()].join(", ")} not answering · last level shown`, at: b.asOf } : { state: "live", said: "Indices · answering", at: b.asOf };
    return { items: rows.map((r) => r.item), read: { venue: "ix", region, sort, total: rows.length, asOf: b.asOf, session: b.session, status: st, note } };
  }

  async function quotes(asked: readonly string[]): Promise<Map<string, LocalMarket> | Refusal> {
    const wanted = new Map<string, WorldIndex>();
    for (const id of asked) { const i = WORLD_INDICES.find((x) => `${x.region}:${x.id}` === id); if (i) wanted.set(id, i); }
    const out = new Map<string, LocalMarket>();
    let refusal: Refusal | null = null;
    for (const region of new Set([...wanted.values()].map((i) => i.region))) {
      const b = await base(region);
      if (isRefusal(b)) { refusal = b; continue; }
      for (const [id, i] of wanted) {
        if (i.region !== region) continue;
        const got = levelOf(b, i);
        if (!got) continue;
        const { l, stale } = got;
        const s = localSession(hoursOf(i.hours), now(), l.at);
        out.set(id, {
          symbol: id, name: i.name, kind: "spot", base: i.id, quote: "pts", open: false, types: [], price: l.level,
          ...(l.at !== null ? { quoteAt: l.at } : {}), quoteFrom: stale ? `${l.from} · stale` : l.from,
          ...(l.change !== null ? { change24h: l.change } : {}), ...(l.changePct !== null ? { changePct24h: l.changePct } : {}),
          session: { open: s.phase === "trading" },
          local: { prevClose: l.prevClose, open: l.open, high: l.high, low: l.low, volume: null, turnover: null, lastSession: s.lastSession, phase: s.phase,
            quoteStatus: l.delayMin === null ? "unsaid" : l.delayMin > 0 ? "delayed" : "live" },
        });
      }
    }
    return out.size || !refusal ? out : refusal;
  }

  // ---- history ---------------------------------------------------------------------------------------------------------------------
  const histories = cnKeeper<LocalHistory>(now, () => BARS_TTL_MS);
  const isHistory = (v: LocalHistory | Refusal): v is LocalHistory => !isRefusal(v);

  /** one source's daily bars for an index, or null */
  async function bars(s: SourceCode, range: Exclude<CandleRange, "1D" | "5D">): Promise<CnBar[] | null> {
    try {
      if (s.from === "tencent") {
        const [interval, count] = CN_BARS[range];
        if (s.code.startsWith("hk")) {
          const code = s.code.slice(2);
          return parseHkKline(utf8(await get(tencent, hkKlineUrl(code, interval, count), HISTORY_BODY_LIMIT)), code, interval);
        }
        return parseKline(utf8(await get(tencent, historyUrl(s.code, range), HISTORY_BODY_LIMIT)), s.code, interval);
      }
      if (s.from === "eastmoney") { const r = await em_.kline(emKlineUrl(s.code, EM_LIMIT[range])); return isRefusal(r) ? null : r; }
      if (s.from === "naver") return parseNaverIndexChart(utf8(await get(naver, naverIndexChartUrl(s.code), HISTORY_BODY_LIMIT)), s.code);
    } catch { /* a source failing is the next one's turn */ }
    return null;
  }
  /** a range is the window back from the latest bar (daily sources give their bars whole); a range longer than the bars is what there is */
  function windowOf(all: CnBar[], range: Exclude<CandleRange, "1D" | "5D">): CnBar[] {
    if (!all.length || range === "MAX") return all;
    const latest = new Date(all.at(-1)!.t);
    const from = range === "YTD" ? Date.UTC(latest.getUTCFullYear(), 0, 1) : Date.UTC(latest.getUTCFullYear(), latest.getUTCMonth() - MONTHS[range]!, latest.getUTCDate());
    return all.filter((b) => b.t >= from);
  }

  async function history(id: string, range: CandleRange): Promise<LocalHistory | Refusal> {
    const i = WORLD_INDICES.find((x) => `${x.region}:${x.id}` === id);
    if (!i) return badAction("no such index");
    if (range === "1D" || range === "5D") return badAction("an index's intraday chart is not read here");
    if (!Object.hasOwn(EM_LIMIT, range)) return badAction("no such chart range");
    return histories.ask(`${id}|${range}`, async () => {
      for (const s of i.history) {
        const got = await bars(s, range);
        const candles = got ? (s.from === "tencent" ? got : windowOf(got, range)) : [];
        if (candles.length) return { venue: "ix", venueName: NAMES[s.from], symbol: id, range, candles, source: NAMES[s.from] } as LocalHistory;
      }
      return no("E_VENUE_UNREACHABLE", { venue: "ix", message: "no source is answering: that index's history cannot be read now" });
    }, isHistory);
  }

  return { levels, quotes, history, status: () => status };
}
