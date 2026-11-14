/** The reconcile clock: the face measures the memory's decisions against prices on its own time,
 * with no model involved - one run {@link MEMORY_FIRST_MS} after it is installed, then one every
 * {@link MEMORY_EVERY_MS} - and says each run in one log line.
 *
 * A run opens the memory (the opener main.ts builds from the row as composed, src/memory.ts
 * `memoryOpener`) and calls its `reconcile` as {@link FACE_MEMORY_NAME}; it reads no file of the
 * home and calls nothing else of the memory. Nothing waits on it and nothing fails by it: no home,
 * no install, a disabled row and a fault are each one line. A run that has not come back within
 * {@link MEMORY_LIMIT_MS} is abandoned, not cancelled: it is said once, its late result logs
 * nothing, and the next tick starts a new run; a tick that finds a run still inside its limit is
 * skipped and says nothing.
 *
 * Installed by main.ts beside the desk unless `FACE_MEMORY_RECONCILE=0`
 * ({@link memoryClockEnabled}; tests/helpers/no-memory.ts sets it for every test boot), and
 * disposed in both shutdown paths before the tree. Its default timers are unref'd, so the clock
 * never holds the process open; `dispose` clears them and waits for nothing.
 * @module
 */
import type { ReconcileReport } from "gravit-memory";
import { FACE_MEMORY_NAME, NO_MEMORY_HERE, memoryFaultWords, type MemoryStanding } from "./memory.ts";

/** The first run, after installing: two minutes. */
export const MEMORY_FIRST_MS = 120_000;
/** Between runs: eight hours. */
export const MEMORY_EVERY_MS = 8 * 3_600_000;
/** How long a run is waited for before it is abandoned: 60 s, the row's own call timeout. */
export const MEMORY_LIMIT_MS = 60_000;

const LINE_LIMIT = `memory: reconcile passed its ${MEMORY_LIMIT_MS / 1000} s limit and is left to finish`;

/** Whether the clock runs: `FACE_MEMORY_RECONCILE` is anything but "0". */
export function memoryClockEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.FACE_MEMORY_RECONCILE !== "0";
}

/** A reconcile's report as its one line: fresh (it read nothing), skipped (no price source), or
 *  what it measured. */
export function reconcileLine(report: ReconcileReport): string {
  if (report.fresh) {
    return `memory: reconcile fresh: the source was asked at ${report.fresh.asked_at}, again after ${report.fresh.again_after}`;
  }
  if (report.source === null) return "memory: reconcile skipped: the home's config.json names no price source";
  return `memory: reconciled: measured ${report.measured}, closed ${report.closed}, still due ${report.stillDue}, refused ${report.refused.length}`;
}

export interface MemoryClockDeps {
  /** Opens the memory as the row was composed (src/memory.ts `memoryOpener`). */
  open: () => Promise<MemoryStanding>;
  /** Where each run's line goes; main.ts gives the face's own stderr line. */
  log: (line: string) => void;
  /** The timers; by default `setTimeout`, unref'd, and `clearTimeout`. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

export interface MemoryClock {
  /** One run now, whatever else is in flight; resolves to the line it logged. */
  runOnce(): Promise<string>;
  /** Clears the clock's timers; a run in flight is left, and nothing is waited for. */
  dispose(): void;
}

function unrefTimer(fn: () => void, ms: number): unknown {
  const timer = setTimeout(fn, ms);
  timer.unref();
  return timer;
}

/** One run's words, never a throw: the standing that is not connected, the report's line, or the
 *  fault - a home nobody made said as the door says it. */
async function reconcileWords(open: () => Promise<MemoryStanding>): Promise<string> {
  try {
    const standing = await open();
    if (!standing.connected) return `memory: ${standing.say}`;
    return reconcileLine(await standing.memory.reconcile(FACE_MEMORY_NAME));
  } catch (error) {
    const words = memoryFaultWords(error);
    return words === NO_MEMORY_HERE ? `memory: ${NO_MEMORY_HERE}` : `memory: reconcile failed: ${words}`;
  }
}

/** Installs the clock: its first tick {@link MEMORY_FIRST_MS} from now. */
export function installMemoryClock(deps: MemoryClockDeps): MemoryClock {
  const setTimer = deps.setTimer ?? unrefTimer;
  const clearTimer = deps.clearTimer ?? ((timer: unknown) => clearTimeout(timer as NodeJS.Timeout));
  /** The tick's timer, and each run's limit still armed. */
  let tickTimer: unknown;
  const limits = new Set<unknown>();
  /** The latest run, while it is in flight and inside its limit. */
  let inFlight: Promise<string> | undefined;
  let disposed = false;

  function runOnce(): Promise<string> {
    const run = new Promise<string>((resolve) => {
      let done = false;
      const finish = (line: string): void => {
        if (done) return;
        done = true;
        limits.delete(limit);
        clearTimer(limit);
        if (inFlight === run) inFlight = undefined;
        deps.log(line);
        resolve(line);
      };
      const limit = setTimer(() => finish(LINE_LIMIT), MEMORY_LIMIT_MS);
      limits.add(limit);
      void reconcileWords(deps.open).then(finish);
    });
    inFlight = run;
    return run;
  }

  function tick(): void {
    if (disposed) return;
    tickTimer = setTimer(tick, MEMORY_EVERY_MS);
    if (inFlight === undefined) void runOnce();
  }

  tickTimer = setTimer(tick, MEMORY_FIRST_MS);
  return {
    runOnce,
    dispose() {
      disposed = true;
      clearTimer(tickTimer);
      for (const limit of limits) clearTimer(limit);
      limits.clear();
    },
  };
}
