/** The read-through rows: which rivals a company's own bad news points to,
 * Gravit's inference and never an order, as in-process dsh rows - boot.ts
 * composes them right after the analog rows, in the same project layer, below
 * everything the operator writes, so an operator row with one of these ids
 * replaces that row's config (a replacement restates `recordDir`) and
 * `disabled: true` removes it.
 *
 * Two cordis file-plugin rows under `face/plugins/readthrough/`, in one insert:
 * `read-through-service`, the backbone that provides the `readThrough` service
 * (the record under `$DSH_HOME/face/readthrough`, the annotation runs open now,
 * and the face's half once wired), then `read-through-tool`, injecting `tools`
 * and `readThrough`, which registers `read_through`. The tool is registered
 * tree-wide, as dsh's own are; no bot's allow list names it
 * (`tests/bots.test.ts`), the desk's mask does (src/desk-preset.ts), and the
 * row refuses a desk agent's call outside an annotation run.
 *
 * The face's half is here too: {@link wireReadThrough}, which main.ts calls with the Market's quotes whether the
 * desk is on or off, wires the service with the prices, the desk's own symbols and the XNYS clock, and
 * {@link readThroughLane} (src/readthrough-lane.ts, a leaf for src/desk.ts's module weight, re-exported here) is
 * the service as the annotator and the watch call it. src/ reaches the service through
 * the context alone, never by importing anything under plugins/. */
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { FacePatchList } from "./boot.ts";
import { loadHoldings, loadLevels, loadRules } from "./desk-book.ts";
import { etDate } from "./et.ts";
import { nyInstant, sessionFor, xnysWindow, type MarketSession } from "./market-clock.ts";
import type { MarketQuoteSource } from "./market-quotes.ts";
import type { ReadThroughLane } from "./readthrough-lane.ts";
import { idOf, marketOf } from "./symbols.ts";
import { AFTER_HOURS_MS } from "./watch-eval.ts";

export { READ_THROUGH_NEVER, readThroughLane, type ReadThroughAsk, type ReadThroughEvent, type ReadThroughLane } from "./readthrough-lane.ts";

export const READ_THROUGH_ROW_IDS = ["read-through-service", "read-through-tool"] as const;

/** The tools the rows register, in row order. */
export const READ_THROUGH_TOOL_NAMES = ["read_through"] as const;

/** `face/plugins/readthrough/`, beside this file's `src/`. */
const PLUGIN_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "plugins", "readthrough");

/** The rows: each `name` the absolute file URL of its plugin file
 * (`read-through-service` → `service-row.mjs`, `read-through-tool` →
 * `tool-row.mjs`); `home` is the harness home, `$DSH_HOME`. */
export function readThroughPatches(home: string): FacePatchList {
  return [{
    insert: READ_THROUGH_ROW_IDS.map((id) => ({
      id,
      name: pathToFileURL(join(PLUGIN_DIR, `${id.slice("read-through-".length)}-row.mjs`)).href,
      config: id === "read-through-service" ? { recordDir: join(home, "face", "readthrough") } : {},
    })),
  }];
}

/* ---------- the face's half ---------- */

/** One print as the service reads it: the Market's price, its change from the previous close in percent, its feed
 * and when it traded; `price` and `changePct` are `null` when the Market has none. */
export interface ReadThroughPrint { symbol: string; price: number | null; changePct: number | null; feed: string; asOf: string | null }

/** The `readThrough` service as this file calls it (plugins/readthrough/service-row.mjs). */
type ReadThroughService = ReadThroughLane & { wire(deps: ReadThroughWiring): void };

/** The face's half the service is wired with. */
interface ReadThroughWiring {
  prices(symbols: string[]): Promise<ReadThroughPrint[]>;
  deskSymbols(): Promise<string[]>;
  usSessionOn(): boolean;
}

/** The service's prices: each symbol asked of `quotes` as a US share, the prints in the order asked. Rejects with
 * the source's `unavailable` when it has no price at all, and with the snapshot's rejection. */
export function readThroughPrices(quotes: Pick<MarketQuoteSource, "snapshot" | "unavailable">): (symbols: string[]) => Promise<ReadThroughPrint[]> {
  return async (symbols) => {
    if (quotes.unavailable !== undefined) throw new Error(quotes.unavailable);
    const payload = await quotes.snapshot(symbols.map((symbol) => ({ id: idOf("us", symbol), market: "us", symbol })));
    return symbols.map((symbol, i) => {
      const q = payload.quotes[i];
      return { symbol, price: q?.price ?? null, changePct: q?.change_pct ?? null, feed: q?.feed ?? "", asOf: q?.as_of ?? null };
    });
  };
}

/**
 * The desk's own US symbols, which the fence admits beside the universe: those of `desk/rules.yml`,
 * `desk/holdings.yml` and `desk/levels.yml` under `root`, sorted, each once. A strategy's levels are not the
 * desk's; a missing or refused file adds nothing, and a refused entry is left out.
 * @param root - the repository root.
 * @param today - the ET date, `YYYY-MM-DD`, a level's expiry is judged against.
 */
export async function deskFenceSymbols(root: string, today: string): Promise<string[]> {
  const [rules, holdings, levels] = await Promise.all([
    loadRules(join(root, "desk", "rules.yml"), "desk/rules.yml"),
    loadHoldings(join(root, "desk", "holdings.yml"), "desk/holdings.yml"),
    loadLevels(join(root, "desk", "levels.yml"), "desk/levels.yml", today),
  ]);
  const symbols = [
    ...rules.entries.flatMap((rule) => rule.symbols.symbols),
    ...holdings.entries.map((holding) => holding.symbol),
    ...levels.entries.map((level) => level.symbol),
  ];
  return [...new Set(symbols.filter((symbol) => marketOf(symbol) === "us"))].sort();
}

/** That New York date's XNYS session by the builtin rules, or `undefined` for a closed day or no date. */
function xnysSessionOn(date: string): MarketSession | undefined {
  let session: ReturnType<typeof sessionFor>;
  try {
    session = sessionFor(xnysWindow(date, 1), date);
  } catch {
    return undefined;
  }
  return typeof session === "object" ? session : undefined;
}

/** Whether `now` lies in a US session as the watch polls it: from 04:00 ET of a session day to its close plus
 * after-hours, 20:00 ET, or 17:00 on an early close (src/watch-eval.ts `AFTER_HOURS_MS`), on the builtin XNYS rules. */
export function usSessionOn(now: number): boolean {
  const date = etDate(new Date(now));
  const session = xnysSessionOn(date);
  return session !== undefined && now >= Date.parse(nyInstant(date, 4, 0)) && now < Date.parse(session.close) + AFTER_HOURS_MS;
}

/**
 * Wire the face's half into the `readThrough` service through `ctx.inject(["readThrough"], …)`, so a reloaded row
 * is wired again: the Market's prices from `quotes`, the desk's symbols under `root` on the ET date of the moment
 * asked, and the XNYS clock at `now`.
 * @param ctx - the root context.
 * @param deps - the quote source, the repository root, and the clock (the wall clock by default).
 */
export function wireReadThrough(
  ctx: { inject(deps: string[], callback: (layer: any) => void): unknown },
  deps: { quotes: Pick<MarketQuoteSource, "snapshot" | "unavailable">; root: string; now?: () => number },
): void {
  const now = deps.now ?? Date.now;
  const wiring: ReadThroughWiring = {
    prices: readThroughPrices(deps.quotes),
    deskSymbols: () => deskFenceSymbols(deps.root, etDate(new Date(now()))),
    usSessionOn: () => usSessionOn(now()),
  };
  ctx.inject(["readThrough"], (layer: { readThrough?: ReadThroughService }) => {
    layer.readThrough?.wire(wiring);
  });
}
