// face/plugins/analog/views-row.mjs
/**
 * `analog-views` - the analog backbone row. It provides the `analogViews` service the tool row injects: one keep of
 * daily histories read through the market (`createBarsKeep`) and one view store under the harness home
 * (`createViewStore`), both for the row's life, so two scans at once share each company's read and a later scan of
 * the same trading day reads again only the query's stock, SPY and any history that was read short.
 *
 * The service: `scanChart({ symbol, asOf?, also? })`, the scan of one query over the fixed universe;
 * `scanEvents({ title, events, query? })`, the scan of a researched list of past events, each source marked opened
 * only when the page record holds it; `notePage(url)`, which records a page a reader opened; `pageOpened(url)`,
 * whether the record holds it; `writeView(view)`, which stores a view under a new id and answers
 * `{ id, bytes, windowsDropped, casesDropped }`; `readView(id)`, a stored view by its id. The page record
 * (`createPageRecord`) is held in memory for the row's life, beside the keep. Every history is read from the market
 * at `FACE_MARKET_URL` (default `http://127.0.0.1:4821`) and nowhere else.
 *
 * Config: `viewsDir`, the absolute views directory (`$DSH_HOME/face/analog/views`). `market`, `ask`, `now` and
 * `universe` are test-only. The service is provided inside `ctx.effect`, so a reload of the row disposes it.
 */
import { isAbsolute } from "node:path";
import { DEFAULT_MARKET_URL, marketOrigin } from "../lunhui/lib/market-fetch.mjs";
import { createBarsKeep, marketAsk } from "./lib/bars.mjs";
import { scanChart } from "./lib/chart-scan.mjs";
import { scanEvents } from "./lib/event-scan.mjs";
import { createPageRecord } from "./lib/pages.mjs";
import { UNIVERSE } from "./lib/universe.mjs";
import { createViewStore } from "./lib/views.mjs";

export const name = "analog-views";
export const inject = [];

/**
 * @param {any} ctx the row's context
 * @param {{ viewsDir?: unknown, market?: string, ask?: import("./lib/bars.mjs").Ask, now?: () => Date, universe?: string[] }} config
 */
export function apply(ctx, config) {
  const viewsDir = config?.viewsDir;
  if (typeof viewsDir !== "string" || !isAbsolute(viewsDir)) throw new Error(`${name}: viewsDir must be an absolute path`);
  const ask = config.ask ?? marketAsk(marketOrigin(config.market ?? (process.env.FACE_MARKET_URL || DEFAULT_MARKET_URL)));
  const now = config.now ?? (() => new Date());
  const universe = config.universe ?? UNIVERSE;
  const keep = createBarsKeep({ ask });
  const pages = createPageRecord();
  const store = createViewStore(viewsDir);
  const service = {
    /** @param {{ symbol: unknown, asOf?: unknown, also?: unknown }} args */
    scanChart: ({ symbol, asOf, also }) =>
      scanChart({ symbol: /** @type {string} */ (symbol), asOf: /** @type {any} */ (asOf), also: /** @type {any} */ (also), universe, keep, now }),
    /** @param {{ title: unknown, events: unknown, query?: unknown }} args */
    scanEvents: ({ title, events, query }) =>
      scanEvents({ title, events, query, keep, now, opened: (url) => pages.has(url) }),
    /** @param {unknown} url */
    notePage: (url) => pages.note(url),
    /** @param {unknown} url */
    pageOpened: (url) => pages.has(url),
    /** @param {Record<string, unknown> & { cases: any[] }} view */
    writeView: (view) => store.write(view, now()),
    /** @param {string} id */
    readView: (id) => store.read(id),
  };
  ctx.effect(() => ctx.provide("analogViews", service));
}
