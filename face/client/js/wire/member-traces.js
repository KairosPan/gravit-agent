import { isInjectedSource, mapFrame } from "./mapper.js";
import { readProjections } from "./summaries.js";

/** Read one room answer's process from its member session, without opening,
 * prompting or ACTIVATING that session.
 *
 * The read is two dsh 0.2.0-rc.2 Remotes that never resume an Agent
 * (NEW packages/api/session-controller/src/history.ts:77-112 `page`;
 * index.ts:490-512 `projections`; both observe through `sessionQuery` and
 * neither promotes, unlike `session/follow`, which background-activates a
 * cold ordinary session after its snapshot, history.ts:204-212):
 *
 *   1. `session/projections` fixes the cut. Its `asOfSeq` is the observed log
 *      cursor (session-projection src/index.ts:338-351 `cursorBefore(seq)`),
 *      which is exactly the inclusive `throughSeq` a page request must carry
 *      (types.ts:471-484) - the member may keep running while we page, and
 *      every page is read against the same cut. `null` means no such session.
 *      rc.5 kinds the answer (`SessionProjectionsValue`, session-controller
 *      lib/types/types.d.ts): `migration-required` carries no `asOfSeq`, so the
 *      trace is unavailable until that session's log is migrated; `readProjections`
 *      (summaries.js) reads all three shapes.
 *   2. `session/page` walks backwards from that cut. `beforeSeq` is exclusive
 *      and page boundaries are messages, not turns (history.ts:392-427), so we
 *      keep paging until the answer's own `turn/start` is present. A page is
 *      `{records:[{type:'event', event}], hasMore}` (types.ts:425-429, 546-549).
 *
 * Every event arrives in the 0.2 shape - persisted 0.1.1 logs are migrated on
 * read (session-format-v3-to-v4 README) - so a surface replacement names
 * `startSeq`/`endSeq` (types.ts:446-448) and a tool result is a `role:'tool'`
 * message; the mapper absorbs the latter.
 * @module
 */

/** @param {unknown} value @returns {boolean} */
function object(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {Array<any>} entries - records sorted by seq. @param {string} sessionId @param {number} turn
 * @returns {import("./mapper.js").FrameView[]} */
function traceOf(entries, sessionId, turn) {
  const start = entries.findIndex(({ event }) => event.type === "turn/start" && event.data?.turn === turn);
  const end = entries.findIndex(({ event }, index) => index > start && event.type === "turn/end" && event.data?.turn === turn);
  if (end < 0 || entries.slice(start + 1, end).some(({ event }) => event.type === "turn/start")) {
    throw new Error("This answer's turn is incomplete; its trace cannot be read yet.");
  }

  /** @type {import("./mapper.js").FrameView[]} */
  let views = [];
  for (let index = start + 1; index < entries.length; index++) {
    const event = entries[index].event;
    const op = event.surfaceOp;
    // Honor even a textless replacement, and later compaction of this turn.
    // Paired call/result events share one UI card: replacing either drops it.
    // The wire names the inclusive range startSeq..endSeq (types.ts:446-448);
    // 0.1.1's start/end is migrated away on read (v3-to-v4 "Sequence references").
    if (object(op) && op.op === "replace" && Number.isSafeInteger(op.startSeq) && Number.isSafeInteger(op.endSeq) && op.startSeq <= op.endSeq) {
      const shadowed = views.filter((view) => view.seq >= op.startSeq && view.seq <= op.endSeq);
      const calls = new Set(shadowed.map((view) => view.card?.callId).filter((id) => id !== undefined));
      views = views.filter((view) => !shadowed.includes(view) && !(view.card?.callId !== undefined && calls.has(view.card.callId)));
    }
    if (index >= end) continue;
    // User/context messages have no top-level turn; other process events do.
    if (typeof event.data?.turn === "number" && event.data.turn !== turn) continue;
    // The mapper's one transcript path: a record is normalized to the frame a
    // live follow event becomes, so a trace maps exactly like the transcript.
    const view = mapFrame({ type: "session/event", sessionId, event });
    if (view.kind === "card") views.push(view);
    else if (view.kind === "bubble" && view.role === "operator" && isInjectedSource(view.source)) views.push(view);
    else if (view.kind === "bubble" && view.role === "gravit" && view.thinking) views.push({ ...view, text: "" });
  }
  // The fold is already applied. Never pass member replacement instructions
  // to the room transcript, whose sequence numbers are a separate namespace.
  return views.map((view) => ({ ...view, surfaceOp: "append" }));
}

/**
 * @param {(endpoint: string, args: Record<string, unknown>) => Promise<any>} call -
 *   api.js's unary Remote call (injected, so the tests drive it without a host).
 * @param {{sessionId: string, turn: number}} reference
 * @returns {Promise<import("./mapper.js").FrameView[]>} Process rows only; no answer prose.
 * @throws {Error} when the exact turn is unavailable, incomplete, or unreadable.
 */
export async function loadMemberTrace(call, { sessionId, turn }) {
  if (typeof sessionId !== "string" || sessionId.trim() === "" || !Number.isSafeInteger(turn) || turn < 1) {
    throw new Error("This answer recorded no member turn.");
  }
  const cut = await call("session/projections", { request: { sessionId } });
  if (cut === null) throw new Error("The member session does not exist.");
  const { asOfSeq, migrationRequired } = readProjections(cut);
  if (migrationRequired) throw new Error("The member session's history needs a migration before its trace can be read.");
  // throughSeq must be an integer >= -1 (history.ts:305-318); -1 is an empty log.
  if (asOfSeq === null || asOfSeq < -1) throw new Error("The trace's history is malformed.");
  const address = { kind: "session", sessionId };
  const entries = new Map();
  let beforeSeq;
  while (true) {
    const page = await call("session/page", {
      request: { address, throughSeq: asOfSeq, maxMessages: 100, ...(beforeSeq === undefined ? {} : { beforeSeq }) },
    });
    if (!object(page) || !Array.isArray(page.records) || typeof page.hasMore !== "boolean") {
      throw new Error("The trace's history is malformed.");
    }
    let oldest = Infinity;
    for (const record of page.records) {
      if (!object(record) || record.type !== "event" || !object(record.event)
        || !Number.isSafeInteger(record.event.seq) || record.event.seq < 0) {
        throw new Error("The trace's history is malformed.");
      }
      oldest = Math.min(oldest, record.event.seq);
      if (!entries.has(record.event.seq)) entries.set(record.event.seq, record);
    }
    const sorted = [...entries.values()].sort((a, b) => a.event.seq - b.event.seq);
    if (sorted.some(({ event }) => event.type === "turn/start" && event.data?.turn === turn)) {
      return traceOf(sorted, sessionId, turn);
    }
    if (!page.hasMore) throw new Error("No trace was found for this answer's turn.");
    if (!Number.isFinite(oldest) || (beforeSeq !== undefined && oldest >= beforeSeq)) {
      throw new Error("The trace's history stopped loading; try again.");
    }
    beforeSeq = oldest;
  }
}
