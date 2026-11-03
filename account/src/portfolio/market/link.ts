/** THE ACCOUNT'S ONE LINK TO THE MARKET (plan A1 task 4): the transport (client.ts) and the four adapters over it — the market's public
 * sources (sources.ts), its hub mirrored (hub.ts), China (china.ts) and a coin's price (price.ts) — the four things service.ts takes as
 * options (publicMarkets, streams, china, liveDeps.price). Only server.ts's main and account-check.ts build one; a service made anywhere
 * else reaches no market unless a link is handed in.
 *
 * THE SOURCE LIST is GET /api/sources: none until the market first answers, asked again every SOURCES_WAIT_MS while it has not (an account
 * started before its market fills in once the market is up, with no restart) and every SOURCES_EVERY_MS after. A new list is made only
 * when the market's changes (its ids, or what each answers), so the service wraps its sources again only then. */
import { randomBytes } from "node:crypto";
import { isRefusal } from "../../core/errors.ts";
import { MARKET_DOWN, marketClient, type MarketClient } from "./client.ts";
import { remoteChina } from "./china.ts";
import { RemoteHub } from "./hub.ts";
import { remotePrice } from "./price.ts";
import type { ChinaSource, MarketHub, Price, PublicSource } from "./shapes.ts";
import { remoteSource, type SourceRow } from "./sources.ts";

/** the source list asked again this often once the market has answered it, and this often until it has */
export const SOURCES_EVERY_MS = 60_000;
export const SOURCES_WAIT_MS = 5_000;

export interface MarketLink {
  readonly client: MarketClient;
  /** the latest list: [] until /api/sources answers; refetched every 60 s, and every 5 s while it has not answered */
  sources(): PublicSource[];
  readonly hub: MarketHub;
  readonly china: ChinaSource;
  readonly price: Price;
  /** since when the market has not answered — a request it left unanswered, or its hub stream down with nothing answered since — in the
   * account's one sentence for it; undefined while it answers */
  marketOld(): { since: string; message: string } | undefined;
  /** resolves when /api/sources first answers, or false after ms */
  ready(ms: number): Promise<boolean>;
  /** begins the refetch and the hub stream */
  start(): void;
  close(): void;
}

/** what makes one list another: each source's id and the reads it answers */
const shapeOf = (rows: SourceRow[]): string => JSON.stringify(rows.map((r) => [r.id, r.has]));
const isRow = (v: unknown): v is SourceRow => !!v && typeof v === "object" && typeof (v as SourceRow).id === "string" && typeof (v as SourceRow).name === "string" && !!(v as SourceRow).has && typeof (v as SourceRow).has === "object";

export function connectMarket(o: { url: string; fetch?: typeof fetch; clock?: () => number; clientId?: string }): MarketLink {
  const client = marketClient({ url: o.url, ...(o.fetch ? { fetch: o.fetch } : {}), ...(o.clock ? { clock: o.clock } : {}) });
  const hub = new RemoteHub(client, { clientId: o.clientId ?? randomBytes(8).toString("hex"), ...(o.fetch ? { fetch: o.fetch } : {}), ...(o.clock ? { clock: o.clock } : {}) });
  const china = remoteChina(client);
  const price = remotePrice(client);
  let list: PublicSource[] = [];
  let shape: string | undefined;
  let answered = false;
  let started = false;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let asking: Promise<void> | undefined;
  const waiting = new Set<() => void>();
  /** since when the market has not answered: a request it did not answer (the client's staleSince), or its hub stream down with nothing
   * answered since it went down */
  const old = (): number | undefined => {
    const since = client.staleSince();
    if (since !== undefined) return since;
    const down = hub.downSince();
    const last = client.answeredAt();
    return down !== undefined && (last === undefined || last < down) ? down : undefined;
  };

  /** the list asked once (one ask at a time) */
  const refresh = (): Promise<void> =>
    (asking ??= (async () => {
      const r = await client.get<unknown>("/api/sources", 0);
      if (isRefusal(r) || !Array.isArray(r.value)) return;
      const rows = r.value.filter(isRow);
      const now = shapeOf(rows);
      if (now !== shape) {
        shape = now;
        list = rows.map((row) => remoteSource(client, row));
      }
      // the market answers: a hub stream waiting out its backoff is opened now
      hub.poke();
      if (!answered) {
        answered = true;
        for (const w of [...waiting]) w();
      }
    })().finally(() => (asking = undefined)));
  /** asked now, then again after its wait, until closed */
  const loop = async (): Promise<void> => {
    if (closed) return;
    await refresh();
    if (closed) return;
    // asked again soon while the market has not answered yet, or is not answering now: the ask that finds it back clears the mark and
    // opens the hub stream at once (poke), so a market back after a long while is not waited for through the stream's whole backoff
    timer = setTimeout(() => void loop(), answered && !old() ? SOURCES_EVERY_MS : SOURCES_WAIT_MS);
    timer.unref?.();
  };

  return {
    client,
    sources: () => list,
    hub,
    china,
    price,
    marketOld() {
      const since = old();
      return since === undefined ? undefined : { since: new Date(since).toISOString(), message: MARKET_DOWN };
    },
    ready(ms: number): Promise<boolean> {
      if (answered) return Promise.resolve(true);
      // a link not started is asked once now (account-check.ts reads the list without the hub)
      if (!started && !asking) void refresh();
      return new Promise<boolean>((resolve) => {
        const done = (v: boolean) => {
          clearTimeout(t);
          waiting.delete(yes);
          resolve(v);
        };
        const yes = () => done(answered);
        const t = setTimeout(() => done(answered), Math.max(0, ms));
        waiting.add(yes);
      });
    },
    start() {
      if (started || closed) return;
      started = true;
      void loop();
      hub.start();
    },
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      hub.close();
      for (const w of [...waiting]) w();
    },
  };
}
