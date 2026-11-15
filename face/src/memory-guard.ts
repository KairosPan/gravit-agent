/** The memory's owner-name fence: a decision is written in the owner's name in one place only -
 * Gravit's one conversation, in a turn the operator's own message opened ("in place": the calling
 * session is the conversation's held session and its turn is the operator's, both read when the
 * call arrives).
 *
 * The table is the whole rule. A `memory_record` whose `whose` is exactly "owner", and a
 * `memory_amend` review whose `whose` is exactly "owner", are refused unless in place. A
 * `memory_amend` void or close of a decision id is handed on in place with no read; elsewhere the
 * target's `whose` is read from the memory ({@link decisionOwner}) - the owner's is refused, an
 * agent's and one the memory does not hold are handed on (the package answers the latter). Anything
 * else, a malformed call among it, is handed on: the package's own schema answers it.
 *
 * It only refuses: a call it does not refuse is handed on through `next()`, and it never answers
 * `allow`. It fails closed: a throw while judging a call whose name matched, a read that fails, a
 * memory not connected, a read past {@link MEMORY_GUARD_LIMIT_MS} or one that runs out of
 * {@link MEMORY_GUARD_PAGES} refuses that call, with one line; nothing throws out of the listener.
 * It never writes to the memory, and never opens it for a call that is in place.
 *
 * It is a rule on the tool call, not containment: a shell turn can reach the memory's home by other
 * means. One listener on the ROOT context's `tools/pre-execute`, in front, as the member guard's
 * (src/room.ts `installMemberGuard`); main.ts installs it.
 * @module
 */

/** The fence's tools: `memory_record` and `memory_amend` under any server, since dsh runs
 *  `tools/pre-execute` before it resolves visibility and a name may be the model's own text. */
export const MEMORY_WRITE_TOOL = /^mcp__[A-Za-z0-9_-]{1,64}__memory_(record|amend)$/;

/** A decision's id as the package shapes it (its `DECISION_ID`). */
const DECISION_ID = /^d-\d{8}-[0-9a-f]{8}$/;

/** What a call is told when it writes the owner's name out of place. */
export const OWNER_NAME_REFUSED =
  "the owner's name is written only in the conversation, in a turn the owner's own message opened; " +
  "register your own call with whose \"agent\", or tell the owner";

/** What a call is told when it voids or closes the owner's decision out of place. */
export function ownerDecisionRefused(id: string): string {
  return `decision ${id} is the owner's: it is voided or closed only in the conversation, in a turn the owner's own message opened; tell the owner`;
}

/** What a call is told when the decision it voids or closes could not be read. */
export function ownerDecisionUnchecked(id: string): string {
  return `decision ${id} could not be checked against the memory, so it is not voided or closed here; try again, or tell the owner`;
}

/** How long the look-up of a decision's owner is waited for, every read together: 10 s. */
export const MEMORY_GUARD_LIMIT_MS = 10_000;
/** The most reads one look-up makes, {@link PAGE} decisions each. */
export const MEMORY_GUARD_PAGES = 25;
const PAGE = 200;

const WHY_TURN = "not the operator's turn in the conversation";
const WHY_UNCHECKED = "the decision could not be checked";

/** What a call asks of the owner's name: nothing; the name itself; or the standing of a decision. */
export type OwnerWrite =
  | { kind: "none" }
  | { kind: "name"; what: "record" | "review" }
  | { kind: "standing"; what: "void" | "close"; decision: string };

/** A call's arguments as a plain object, or undefined. */
function argsObject(args: unknown): Record<string, unknown> | undefined {
  return typeof args === "object" && args !== null && !Array.isArray(args) ? (args as Record<string, unknown>) : undefined;
}

/** What a call asks of the owner's name, from its tool's name and its arguments as the model sent them. */
export function ownerWriteOf(name: string, args: unknown): OwnerWrite {
  const tool = MEMORY_WRITE_TOOL.exec(name)?.[1];
  const a = argsObject(args);
  if (tool === undefined || a === undefined) return { kind: "none" };
  if (tool === "record") return a.whose === "owner" ? { kind: "name", what: "record" } : { kind: "none" };
  if (a.what === "review") return a.whose === "owner" ? { kind: "name", what: "review" } : { kind: "none" };
  if ((a.what === "void" || a.what === "close") && typeof a.decision === "string" && DECISION_ID.test(a.decision)) {
    return { kind: "standing", what: a.what, decision: a.decision };
  }
  return { kind: "none" };
}

/** The face's handle as the fence reads it; `MemoryStanding` (src/memory.ts) is assignable to it. */
export type GuardStanding =
  | { connected: true; memory: { decisions(filter?: { before?: string; limit?: number }): Promise<{ items: readonly { view: { line: { id: string; whose: string } } }[]; more: boolean }> } }
  | { connected: false };

/** Whose decision `id` is; throws when the memory is not connected, a read throws, or the pages run out.
 * It reads the decisions newest first, {@link PAGE} at a time, each page `before` the last one's last id. */
export async function decisionOwner(
  open: () => Promise<GuardStanding>,
  id: string,
  pages: number = MEMORY_GUARD_PAGES,
): Promise<"owner" | "agent" | "absent"> {
  const standing = await open();
  if (!standing.connected) throw new Error("the memory is not connected");
  let before: string | undefined;
  for (let read = 0; read < pages; read += 1) {
    const page = await standing.memory.decisions(before === undefined ? { limit: PAGE } : { before, limit: PAGE });
    const found = page.items.find((item) => item.view.line.id === id);
    if (found !== undefined) return found.view.line.whose === "owner" ? "owner" : "agent";
    if (!page.more) return "absent";
    before = page.items[page.items.length - 1]?.view.line.id;
    if (before === undefined) throw new Error("an empty page said more remain");
  }
  throw new Error(`the decision was not in the newest ${pages * PAGE}`);
}

/** dsh-tools' `PreToolDecision`, stated structurally: the fence makes only the deny and hands on any other. */
export type MemoryPreDecision =
  | { kind: "allow" }
  | { kind: "deny"; reason: string }
  | { kind: "cancel" }
  | { kind: "ask"; reason?: string };

/** The slice of dsh-tools' `ToolExecution` the fence reads: the tool's name, its arguments as the model
 *  sent them, and the calling agent's id - its session's. */
export interface MemoryGuardExecution {
  name: string;
  arguments?: unknown;
  agent?: { id?: string };
}

export interface MemoryGuardCtxLike {
  on(
    name: "tools/pre-execute",
    listener: (exec: MemoryGuardExecution, next: () => Promise<MemoryPreDecision>) => Promise<MemoryPreDecision>,
    options?: { prepend?: boolean },
  ): () => unknown;
}

export interface MemoryGuardDeps {
  ctx: MemoryGuardCtxLike;
  /** The conversation's handle, or undefined while there is none (FACE_ROUTER=0, or not opened). */
  conversation: () => { current(): { sessionId: string } | undefined; operatorTurn(): boolean } | undefined;
  /** Opens the memory as the row was composed (src/memory.ts `memoryOpener`). */
  open: () => Promise<GuardStanding>;
  /** Where each refusal's line goes. */
  log: (line: string) => void;
  /** The look-up's limit; {@link MEMORY_GUARD_LIMIT_MS} by default. */
  limitMs?: number;
  /** The timers; by default `setTimeout`, unref'd, and `clearTimeout`. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

function unrefTimer(fn: () => void, ms: number): unknown {
  const timer = setTimeout(fn, ms);
  timer.unref();
  return timer;
}

/** A refusal: the deny the model reads, and the line's `what` and `why`. */
type Refusal = { reason: string; what: string; why: string };

/** The refusal for a matched call whose judging threw: the unchecked reason for an amend whose `decision`
 *  fits the shape, else the owner's-name reason. It cannot throw. */
function failClosed(name: string, args: unknown): Refusal {
  try {
    const tool = MEMORY_WRITE_TOOL.exec(name)?.[1];
    const a = argsObject(args);
    const what = tool === "record" ? "record" : a?.what === "void" || a?.what === "close" ? a.what : "review";
    if (tool === "amend" && typeof a?.decision === "string" && DECISION_ID.test(a.decision)) {
      return { reason: ownerDecisionUnchecked(a.decision), what, why: WHY_UNCHECKED };
    }
    return { reason: OWNER_NAME_REFUSED, what, why: WHY_TURN };
  } catch {
    return { reason: OWNER_NAME_REFUSED, what: "record", why: WHY_TURN };
  }
}

/** Installs the one listener, in front; returns its disposer. */
export function installMemoryGuard(deps: MemoryGuardDeps): () => unknown {
  const setTimer = deps.setTimer ?? unrefTimer;
  const clearTimer = deps.clearTimer ?? ((timer: unknown) => clearTimeout(timer as NodeJS.Timeout));
  const limitMs = deps.limitMs ?? MEMORY_GUARD_LIMIT_MS;

  /** The owner of decision `id`, or a throw once {@link MEMORY_GUARD_LIMIT_MS} has passed; the timer is
   *  cleared when the reads settle first. */
  function ownerWithinLimit(id: string): Promise<"owner" | "agent" | "absent"> {
    return new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimer(() => {
        if (done) return;
        done = true;
        reject(new Error("the look-up passed its limit"));
      }, limitMs);
      const settle = (fn: () => void): void => {
        if (done) return;
        done = true;
        clearTimer(timer);
        fn();
      };
      decisionOwner(deps.open, id).then(
        (owner) => settle(() => resolve(owner)),
        (error: unknown) => settle(() => reject(error)),
      );
    });
  }

  /** Whether the call is in place, read now. */
  function inPlace(agentId: string | undefined): boolean {
    if (agentId === undefined) return false;
    const conversation = deps.conversation();
    if (conversation === undefined) return false;
    return conversation.current()?.sessionId === agentId && conversation.operatorTurn() === true;
  }

  /** The refusal for a matched call, or undefined to hand it on. */
  async function judge(exec: MemoryGuardExecution): Promise<Refusal | undefined> {
    const write = ownerWriteOf(exec.name, exec.arguments);
    if (write.kind === "none" || inPlace(exec.agent?.id)) return undefined;
    if (write.kind === "name") return { reason: OWNER_NAME_REFUSED, what: write.what, why: WHY_TURN };
    let owner: "owner" | "agent" | "absent";
    try {
      owner = await ownerWithinLimit(write.decision);
    } catch {
      return { reason: ownerDecisionUnchecked(write.decision), what: write.what, why: WHY_UNCHECKED };
    }
    return owner === "owner" ? { reason: ownerDecisionRefused(write.decision), what: write.what, why: WHY_TURN } : undefined;
  }

  return deps.ctx.on("tools/pre-execute", async (exec, next) => {
    if (!MEMORY_WRITE_TOOL.test(exec.name)) return next();
    let refusal: Refusal | undefined;
    try {
      refusal = await judge(exec);
    } catch {
      refusal = failClosed(exec.name, exec.arguments);
    }
    if (refusal === undefined) return next();
    try {
      deps.log(`memory: refused ${exec.name} (${refusal.what}) from session ${exec.agent?.id ?? "unknown"}: ${refusal.why}`);
    } catch {
      // a log that throws does not undo the refusal
    }
    return { kind: "deny", reason: refusal.reason };
  }, { prepend: true });
}
