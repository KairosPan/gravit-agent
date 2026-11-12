// face/plugins/readthrough/service-row.mjs
/**
 * `read-through-service` - the read-through backbone row. It provides the `readThrough` service the tool row injects:
 * one record under the harness home (`createRecord`) held for the row's life, the annotation runs open now, and the
 * face's half once the face wires it.
 *
 * The service: `wire({ prices, deskSymbols, usSessionOn, refClose })`, the face's half, which may be wired again;
 * `ready()`, whether it is wired; `open(sessionId, { pass, asks })`, an annotation run that may give a direction for
 * each `{ symbol, ref }` it asks; `close(sessionId)`, the blocks that run accepted, in call order, the run then
 * forgotten; `given(symbol, ref)`, whether a direction is on record for that event; `later(items)`, a re-priced line
 * for each recorded direction that named rivals; `sent(ids, sent)`, one `sent` line an id; and `propose(raw,
 * { sessionId, desk })`, which checks a call, prices it, records it and renders its block. Every `propose` runs on one
 * promise chain for the service, so the second of two calls arriving together sees the first one's line.
 *
 * Config: `recordDir`, the absolute record directory. `universe` and `now` are test-only. The service is provided
 * inside `ctx.effect`, so a reload of the row disposes it.
 */
import { isAbsolute } from "node:path";
import { UNIVERSE, UNIVERSE_AS_OF } from "../analog/lib/universe.mjs";
import { checkArgs } from "./lib/args.mjs";
import { renderBlock, renderLater } from "./lib/block.mjs";
import { refuse } from "./lib/errors.mjs";
import { fenceOf } from "./lib/fence.mjs";
import { createRecord, newId } from "./lib/record.mjs";

export const name = "read-through-service";
export const inject = [];

/**
 * @typedef {{ symbol: string, price: number | null, changePct: number | null, feed: string, asOf: string | null }} Quote
 * @typedef {{ prices: (symbols: string[]) => Promise<Quote[]>, deskSymbols: () => Promise<string[]>,
 *   usSessionOn: () => boolean, refClose: (date: string) => string | undefined }} Wiring
 * @typedef {{ symbol: string, ref: string }} Ask
 * @typedef {{ pass: string, asks: Ask[], blocks: { id: string, text: string }[] }} Run
 */

/**
 * @param {any} ctx the row's context
 * @param {{ recordDir?: unknown, universe?: string[], now?: () => Date }} config
 */
export function apply(ctx, config) {
  const recordDir = config?.recordDir;
  if (typeof recordDir !== "string" || !isAbsolute(recordDir)) throw new Error(`${name}: recordDir must be an absolute path`);
  const universe = config.universe ?? UNIVERSE;
  const now = config.now ?? (() => new Date());
  const record = createRecord(recordDir);
  /** @type {Wiring | undefined} */
  let wiring;
  /** @type {Map<string, Run>} */
  const runs = new Map();
  /** @type {Promise<unknown>} */
  let chain = Promise.resolve();

  /**
   * A print as the record keeps it: whether it traded is, for a run, a change printed after the reference close; for
   * any other caller, a change at all.
   * @param {Quote} q
   * @param {string | undefined} close the run's reference close, an ISO instant; undefined for any other caller
   * @param {boolean} forRun
   */
  function printOf(q, close, forRun) {
    const traded = forRun
      ? q.changePct !== null && q.asOf !== null && close !== undefined && Date.parse(q.asOf) > Date.parse(close)
      : q.changePct !== null;
    return { symbol: q.symbol, price: q.price, changePct: q.changePct, feed: q.feed, asOf: q.asOf, traded };
  }

  /**
   * @param {unknown} raw
   * @param {{ sessionId: string, desk: boolean }} caller
   * @returns {Promise<{ id: string, block: string }>}
   */
  async function proposeNow(raw, { sessionId, desk }) {
    const w = wiring;
    if (w === undefined) throw refuse.notReady("the face has not wired them yet");
    const d = checkArgs(raw);
    const run = desk ? runs.get(sessionId) : undefined;
    if (desk && run === undefined) throw refuse.alertOnly();
    /** @type {Ask | undefined} */
    let ask;
    if (run !== undefined) {
      ask = run.asks.find((a) => a.symbol === d.symbol);
      if (ask === undefined) throw refuse.notAlerted(d.symbol, run.asks.map((a) => a.symbol));
      if (await given(d.symbol, ask.ref)) throw refuse.alreadyGiven(d.symbol, ask.ref);
    }
    const fence = fenceOf({ universe, desk: await w.deskSymbols(), stricken: d.symbol });
    for (const p of d.peers) if (!fence.has(p.symbol)) throw refuse.outsideFence(p.symbol, UNIVERSE_AS_OF);

    /** @type {Quote[]} */
    let quotes;
    try {
      quotes = await w.prices([d.symbol, ...d.peers.map((p) => p.symbol), "SPY"]);
    } catch (error) {
      throw refuse.notReady(String(/** @type {any} */ (error)?.message ?? error));
    }
    const forRun = run !== undefined;
    const close = ask === undefined ? undefined : w.refClose(ask.ref);
    const [stricken, ...rest] = quotes.map((q) => printOf(q, close, forRun));
    const spy = /** @type {ReturnType<typeof printOf>} */ (rest.pop());
    if (forRun && (stricken.price === null || stricken.changePct === null)) throw refuse.noTape(d.symbol);
    const shut = forRun ? false : !w.usSessionOn();

    const at = now();
    const id = newId(at);
    /** @type {import("./lib/record.mjs").DirectionEntry} */
    const entry = {
      kind: "direction",
      id,
      t: at.toISOString(),
      caller: run !== undefined && ask !== undefined
        ? { kind: "annotation", pass: run.pass, sessionId, ref: ask.ref }
        : { kind: "task", sessionId },
      symbol: d.symbol,
      basis: d.basis,
      event: d.event,
      sources: d.sources,
      logic: d.logic,
      peers: d.peers.map((p, i) => ({ ...rest[i], reason: p.reason })),
      stricken,
      spy,
      counter: d.counter,
      noDirection: d.noDirection,
      certainty: d.certainty,
      shut,
    };
    await record.append(entry);
    const block = renderBlock({ direction: d, tape: [stricken, ...rest, spy], shut, forTask: !forRun });
    run?.blocks.push({ id, text: block });
    return { id, block };
  }

  /**
   * @param {string} symbol
   * @param {string} ref
   */
  async function given(symbol, ref) {
    return (await record.given(symbol, ref)) !== undefined;
  }

  const service = {
    /** @param {Wiring} w */
    wire(w) {
      wiring = w;
    },
    ready: () => wiring !== undefined,
    /**
     * @param {string} sessionId
     * @param {{ pass: string, asks: Ask[] }} run
     */
    open(sessionId, { pass, asks }) {
      runs.set(sessionId, { pass, asks, blocks: [] });
    },
    /** @param {string} sessionId */
    close(sessionId) {
      const run = runs.get(sessionId);
      runs.delete(sessionId);
      return run?.blocks ?? [];
    },
    given,
    /**
     * @param {Ask[]} items
     * @returns {Promise<string[]>}
     */
    async later(items) {
      /** @type {string[]} */
      const lines = [];
      for (const { symbol, ref } of items) {
        const entry = await record.given(symbol, ref);
        if (entry === undefined || entry.peers.length === 0 || wiring === undefined) continue;
        let quotes;
        try {
          quotes = await wiring.prices(entry.peers.map((p) => p.symbol));
        } catch {
          continue;
        }
        const line = renderLater({
          givenAt: entry.t,
          peers: entry.peers.map((p, i) => ({ symbol: p.symbol, then: p.price, now: quotes[i]?.price ?? null })),
        });
        if (line !== null) lines.push(line);
      }
      return lines;
    },
    /**
     * @param {string[]} ids
     * @param {boolean} sent
     */
    async sent(ids, sent) {
      for (const id of ids) await record.sent(id, sent, now().toISOString());
    },
    /**
     * @param {unknown} raw
     * @param {{ sessionId: string, desk: boolean }} caller
     */
    propose(raw, caller) {
      const run = chain.then(() => proposeNow(raw, caller));
      chain = run.catch(() => {});
      return run;
    },
  };
  ctx.effect(() => ctx.provide("readThrough", service));
}
