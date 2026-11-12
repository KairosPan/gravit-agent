/** The read-through lane: the `readThrough` service as the annotator and the watch call it, over the root context.
 *
 * A LEAF, with no value import at all: src/desk.ts builds the lane, and src/desk.ts is what the pause switch
 * (scripts/desk.ts) and scripts/service.ts load, so its module weight is pinned by tests/desk-weight.test.ts.
 * src/readthrough.ts, the rows and the face's wiring, imports what it needs heavier (desk-book, market-clock,
 * watch-eval, js-yaml through standing) and re-exports everything here, so its importers are unchanged. */

/** One event a direction is recorded under: the stricken symbol and its reference date, `YYYY-MM-DD`. A later alert
 * names the events already given this way. */
export interface ReadThroughEvent { symbol: string; ref: string }

/** One event an annotation run may give a direction for: the event, and `since`, the ISO instant its session began -
 * a print at or after it is the market's reaction, one before it reads `未成交` (src/watch.ts `readThroughOf`). */
export interface ReadThroughAsk extends ReadThroughEvent { since: string }

/** The service's calls the annotator and the watch use, inert while the row is not mounted. */
export interface ReadThroughLane {
  ready(): boolean;
  open(sessionId: string, run: { pass: string; asks: ReadThroughAsk[] }): void;
  close(sessionId: string): { id: string; text: string }[];
  given(symbol: string, ref: string): Promise<boolean>;
  later(items: ReadThroughEvent[]): Promise<string[]>;
  sent(ids: string[], sent: boolean): Promise<void>;
}

/** The lane over `ctx.get("readThrough")`, read afresh at every call, so a reloaded row is the one called. With no
 * service: `ready` is false, `close` gives nothing, `given` false, `later` nothing, and `open` and `sent` do nothing. */
export function readThroughLane(ctx: { get(key: string): unknown }): ReadThroughLane {
  const service = () => ctx.get("readThrough") as ReadThroughLane | undefined;
  return {
    ready: () => service()?.ready() ?? false,
    open: (sessionId, run) => service()?.open(sessionId, run),
    close: (sessionId) => service()?.close(sessionId) ?? [],
    given: async (symbol, ref) => (await service()?.given(symbol, ref)) ?? false,
    later: async (items) => (await service()?.later(items)) ?? [],
    sent: async (ids, sent) => { await service()?.sent(ids, sent); },
  };
}
