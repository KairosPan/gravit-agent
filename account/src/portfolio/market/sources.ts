/** A PUBLIC SOURCE OF THE MARKET'S, AS THE ACCOUNT USES ONE (plan A1 task 4): a PublicSource whose every read is the market's protocol
 * (GET /api/source/:id/…, market's protocol.ts) through the account's transport (client.ts) — so service.ts reads it exactly as it read
 * the source in-process, through its own cache (keptPublic) on top. It answers the reads the market says the source has (`has`), and no
 * others; its notes are the ones the market sent beside the listing asked; its clock is the account's US clock where the market names
 * New York's; it has no background reader (`feed`): the market runs the US shares' reader in its own hub, which the account mirrors
 * (hub.ts). Each read is kept here a short while (KEEP), under the account's own cache's longer keep. */
import { isRefusal, type Refusal } from "../../core/errors.ts";
import { usClock } from "../account/calendar.ts";
import type { Candle, CandleInterval, CandlePage, CandleWindow, MarketStats, OrderBook, PublicTrade } from "../live/trade.ts";
import type { MarketClient } from "./client.ts";
import { readLike, type EventsQuery, type Listing, type ListingsQuery, type PublicSource, type Settlement } from "./shapes.ts";

/** a source as GET /api/sources describes it (the market's protocol.ts `described`) */
export interface SourceRow {
  id: string;
  name: string;
  kind: PublicSource["kind"];
  connectTo: string;
  connector: string;
  readOnly?: string | undefined;
  historyApart?: true | undefined;
  /** its clock's zone, where it keeps one */
  sessions?: string | undefined;
  has: { line: boolean; stats: boolean; events: boolean; candles: boolean; book: boolean; trades: boolean; settlement: boolean; fundingHistory: boolean; notes: boolean };
}

/** how long each read is kept here, ms */
export const KEEP = { listings: 5_000, stats: 5_000, events: 5_000, line: 2_000, candles: 10_000, book: 1_000, trades: 1_000, settlement: 30_000, funding: 60_000 } as const;
/** the most symbols the market takes in one stats read (protocol.ts) */
const STATS_MOST = 500;
/** the most a listing or an events read asks for (protocol.ts) */
const LIMIT_MOST = 5_000;

/** a query string of the parameters given (absent and empty ones left out) */
function qs(p: Record<string, string | number | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== "") u.set(k, String(v));
  return u.toString();
}
const limitOf = (n: number): number => Math.max(1, Math.min(LIMIT_MOST, Math.floor(Number.isFinite(n) ? n : 1)));

export function remoteSource(c: MarketClient, row: SourceRow): PublicSource {
  const base = `/api/source/${encodeURIComponent(row.id)}`;
  const value = async <T>(path: string, ttlMs: number): Promise<T | Refusal> => {
    const r = await c.get<T>(path, ttlMs);
    return isRefusal(r) ? r : r.value;
  };
  /** the notes the market sent beside each listing asked, by its query */
  const notes = new Map<string, string[]>();
  const noteKey = (q: string | undefined): string => (q ?? "").trim();
  const has = row.has;
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    connectTo: row.connectTo,
    connector: row.connector,
    ...(row.readOnly !== undefined ? { readOnly: row.readOnly } : {}),
    ...(row.historyApart ? { historyApart: true as const } : {}),
    ...(row.sessions === usClock.zone ? { sessions: usClock } : {}),
    async listings(o: ListingsQuery): Promise<Listing[] | Refusal> {
      const q = noteKey(o.q);
      const r = await c.get<Listing[]>(`${base}/listings?${qs({ q, limit: limitOf(o.limit) })}`, KEEP.listings);
      if (isRefusal(r)) return r;
      if (Array.isArray(r.extra.notes)) {
        if (notes.size > 256) notes.clear();
        notes.set(q, (r.extra.notes as unknown[]).filter((n): n is string => typeof n === "string"));
      }
      return r.value;
    },
    ...(has.notes ? { notes: (o: { q?: string | undefined }) => notes.get(noteKey(o.q)) ?? [] } : {}),
    ...(has.line ? { line: (symbol: string) => value<Listing | null>(`${base}/line?${qs({ symbol })}`, KEEP.line) } : {}),
    ...(has.stats
      ? {
          async stats(symbols?: string[]): Promise<Map<string, MarketStats> | Refusal> {
            // the market takes STATS_MOST symbols a read: more are asked in parts, and put together
            const parts = symbols?.length ? Array.from({ length: Math.ceil(symbols.length / STATS_MOST) }, (_, i) => symbols.slice(i * STATS_MOST, (i + 1) * STATS_MOST)) : [undefined];
            const out = new Map<string, MarketStats>();
            const from: unknown[] = [];
            for (const part of parts) {
              const r = await value<Array<[string, MarketStats]>>(`${base}/stats?${qs({ symbols: part?.join(",") })}`, KEEP.stats);
              if (isRefusal(r)) return r;
              for (const [k, v] of r) out.set(k, v);
              from.push(r);
            }
            return readLike(out, ...from);
          },
        }
      : {}),
    ...(has.events ? { events: (o: EventsQuery) => value<Listing[]>(`${base}/events?${qs({ category: o.category, closingWithinMs: o.closingWithinMs, limit: limitOf(o.limit) })}`, KEEP.events) } : {}),
    ...(has.candles ? { candles: (symbol: string, interval: CandleInterval, w: CandleWindow) => value<Candle[] | CandlePage>(`${base}/candles?${qs({ symbol, interval, since: w.since, until: w.until, limit: w.limit, range: w.range, own: w.own ? "true" : undefined })}`, KEEP.candles) } : {}),
    ...(has.book ? { book: (symbol: string, depth: number) => value<OrderBook>(`${base}/book?${qs({ symbol, depth: Math.max(1, Math.min(50, Math.floor(depth) || 20)) })}`, KEEP.book) } : {}),
    ...(has.trades ? { trades: (symbol: string, limit: number) => value<PublicTrade[]>(`${base}/trades?${qs({ symbol, limit: Math.max(1, Math.min(100, Math.floor(limit) || 30)) })}`, KEEP.trades) } : {}),
    ...(has.settlement ? { settlement: (symbol: string) => value<Settlement>(`${base}/settlement?${qs({ symbol })}`, KEEP.settlement) } : {}),
    ...(has.fundingHistory ? { fundingHistory: (symbol: string, from: number, to: number) => value<Array<{ at: number; rate: number }>>(`${base}/funding?${qs({ symbol, from: Math.floor(from), to: Math.floor(to) })}`, KEEP.funding) } : {}),
    // a forced re-check that found the venue answering again: the market lets go of what it held of it too (POST /api/source/:id/reset)
    reset: () => void c.post(`${base}/reset`, {}).catch(() => undefined),
  };
}
