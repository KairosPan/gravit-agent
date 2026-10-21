// face/tests/desk-fakes.ts
/** Fakes for the desk's clock row, shared by its offline tests - tests/firing.test.ts (one firing), and the clock
 * row's own tests and smoke (P2 Tasks 8 and 10):
 * - {@link WallClock}, a `DeskClock` on real UTC instants that moves only when told: `advance` fires the timers that
 *   fall due on the way, in order, as a running face would; `jump` and `set` move time and fire nothing, as a Mac
 *   that slept through the timers does;
 * - {@link fakeBus}, the root bus every session's events go through;
 * - {@link fakeAgents}, a desk agent factory shaped as src/desk-session.ts `createDeskAgent`'s result;
 * - {@link fakeSupervise}, a supervisor that hands its deps to the test, which plays the turn's end itself;
 * - {@link recordingDeliver}, a `deliver` that records each text;
 * - {@link fakeCalendar}, a market calendar over fixed days.
 * Nothing here touches the disk, the network or a real timer. */
import type { DeliverResult } from "../src/desk-conversation.ts";
import type { DeskClock, SessionEventsOn, superviseDeskTurns, SuperviseDeskTurnsDeps } from "../src/desk-session.ts";
import { etDate } from "../src/et.ts";
import type { DayAnswer, MarketCalendar, MarketSession, MarketWindow } from "../src/market-clock.ts";
import type { AgentLike, SessionLike } from "../src/room.ts";
import type { EventLike, MessageLike } from "../src/room-rules.ts";

/* ---------- the clock ---------- */

/**
 * A `DeskClock` that reads a real instant - `new WallClock("2026-11-27T17:30:04Z")` - and moves only when told.
 * `advance(ms)` is time passing in a running face: every timer that falls due on the way fires, in the order it falls
 * due (ties in the order they were set), each at its own instant, with pending promise continuations flushed before,
 * between and after. `jump(ms)` and `set(iso)` move time and fire nothing: the timers stay pending, overdue, until the
 * next `advance` - `advance(0)` fires them - as a Mac's timers wait out its sleep.
 */
export class WallClock implements DeskClock {
  private t: number;
  private timers: { at: number; fn: () => void; id: number }[] = [];
  private nextId = 1;

  constructor(startIso: string) {
    this.t = WallClock.instant(startIso);
  }

  private static instant(iso: string): number {
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) throw new RangeError(`WallClock takes an ISO instant, not ${JSON.stringify(iso)}`);
    return ms;
  }

  now(): number {
    return this.t;
  }

  /** A timer due `ms` from now - at once for a negative or non-finite `ms`, as Node clamps one. */
  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.timers.push({ at: this.t + (Number.isFinite(ms) ? Math.max(0, ms) : 0), fn, id });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers = this.timers.filter((timer) => timer.id !== handle);
  }

  /** How many timers are set and not yet fired or cleared. */
  pending(): number {
    return this.timers.length;
  }

  /** Let pending promise continuations run: twenty turns of the event loop. */
  async flush(): Promise<void> {
    for (let i = 0; i < 20; i++) await new Promise<void>((done) => { setImmediate(done); });
  }

  /** Move `ms` forward, firing each timer due on the way at its own instant (see the class doc). */
  async advance(ms: number): Promise<void> {
    const until = this.t + ms;
    await this.flush();
    for (;;) {
      const due = this.timers.filter((timer) => timer.at <= until).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (due === undefined) break;
      this.timers = this.timers.filter((timer) => timer.id !== due.id);
      this.t = Math.max(this.t, due.at);
      due.fn();
      await this.flush();
    }
    this.t = Math.max(this.t, until);
    await this.flush();
  }

  /** Move `ms` forward and fire nothing. */
  jump(ms: number): void {
    this.t += ms;
  }

  /** Read `iso` from now on - forward or back - and fire nothing. */
  set(iso: string): void {
    this.t = WallClock.instant(iso);
  }
}

/* ---------- the bus ---------- */

/** The root bus as a test drives it: `on` for the code under test, `emit` for the test. */
export interface FakeBus {
  on: SessionEventsOn;
  /** One event of session `sessionId`, to every listener, as dsh's `session/event` delivers it. */
  emit(sessionId: string, type: string, data?: unknown): void;
  readonly listeners: ReadonlySet<unknown>;
}

/** The root bus: every listener sees every session's events, each with a fresh `seq`. */
export function fakeBus(): FakeBus {
  const listeners = new Set<(session: { id: string }, event: EventLike) => void>();
  let seq = 0;
  return {
    listeners,
    on: (_name, listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    emit(sessionId, type, data) {
      const event: EventLike = { type, seq: seq++, data };
      for (const listener of [...listeners]) listener({ id: sessionId }, event);
    },
  };
}

/* ---------- desk agents ---------- */

/** A desk agent as a firing drives it: what it was sent, how it was cancelled, and how often its handle was disposed. */
export class FakeDeskAgent implements AgentLike {
  status: "idle" | "running" = "idle";
  readonly followups: MessageLike[] = [];
  readonly cancels: unknown[][] = [];
  /** When set, `followup` throws it. */
  failFollowup: string | undefined;
  /** How many times its handle's `dispose` ran. */
  disposed = 0;
  readonly session: SessionLike;

  constructor(readonly id: string, cwd: string) {
    this.session = { id, header: { cwd, agentPreset: "gravit-desk" }, seq: 0, snapshotEvents: () => [], append: () => undefined };
  }

  followup(message: MessageLike): void {
    if (this.failFollowup !== undefined) throw new Error(this.failFollowup);
    this.followups.push(message);
  }

  cancel(...args: unknown[]): void {
    this.cancels.push(args);
  }

  /** The text of the `n`th message it was sent. */
  text(n = 0): string | undefined {
    return this.followups[n]?.content[0]?.text;
  }
}

/** A desk agent factory: `createAgent` is shaped as src/desk-session.ts `createDeskAgent`'s result. */
export interface FakeAgents {
  createAgent(opts: { cwd: string; route: { provider: string; model: string } }): Promise<{ agent: AgentLike; sessionId: string; dispose(): Promise<void> }>;
  /** What each `createAgent` call asked for, in order, failed ones included. */
  readonly created: { cwd: string; route: { provider: string; model: string } }[];
  /** Every agent made, in order; session ids `session-fake-1`, `session-fake-2`, … */
  readonly agents: FakeDeskAgent[];
  /** When set, `createAgent` rejects with it. */
  failCreate: string | undefined;
  /** When set, every agent made from now on throws it from `followup`. */
  failFollowup: string | undefined;
}

export function fakeAgents(): FakeAgents {
  let made = 0;
  const fakes: FakeAgents = {
    created: [],
    agents: [],
    failCreate: undefined,
    failFollowup: undefined,
    async createAgent(opts) {
      fakes.created.push({ cwd: opts.cwd, route: { provider: opts.route.provider, model: opts.route.model } });
      if (fakes.failCreate !== undefined) throw new Error(fakes.failCreate);
      const agent = new FakeDeskAgent(`session-fake-${++made}`, opts.cwd);
      agent.failFollowup = fakes.failFollowup;
      fakes.agents.push(agent);
      return { agent, sessionId: agent.id, dispose: async () => { agent.disposed += 1; } };
    },
  };
  return fakes;
}

/* ---------- supervision ---------- */

/** A supervisor that keeps what it was given: the test reads a call's `deadlineMs` and `fence`, and plays its turn's
 * end by calling its `onTurnEnd`. */
export interface FakeSupervise {
  supervise: typeof superviseDeskTurns;
  /** Each call's deps, in order. */
  readonly calls: SuperviseDeskTurnsDeps[];
  /** How many times each call's disposer ran, by call. */
  readonly disposed: number[];
}

export function fakeSupervise(): FakeSupervise {
  const calls: SuperviseDeskTurnsDeps[] = [];
  const disposed: number[] = [];
  return {
    calls,
    disposed,
    supervise: (deps) => {
      const i = calls.push(deps) - 1;
      disposed.push(0);
      return () => { disposed[i] += 1; };
    },
  };
}

/* ---------- delivery ---------- */

/** A `deliver` that records each text and answers `result` - or what `result` makes of the text and its number,
 * counted from 1 - else `{ sent: [<that number>] }`, as an outlet that sent it does. */
export function recordingDeliver(result?: DeliverResult | ((text: string, n: number) => DeliverResult)): {
  deliver(text: string): Promise<DeliverResult>;
  readonly texts: string[];
} {
  const texts: string[] = [];
  return {
    texts,
    deliver: async (text) => {
      texts.push(text);
      if (result === undefined) return { sent: [texts.length] };
      return typeof result === "function" ? result(text, texts.length) : result;
    },
  };
}

/* ---------- the market calendar ---------- */

/**
 * A market calendar over fixed days: each New York date `days` names is its session or `"closed"`; any other date is
 * `{ ok: false }`, as a calendar whose window does not hold it answers. `asked` lists the dates `today` was asked
 * about, a date once each time it changes, as the face's calendar asks its clock; `window()` is the days as one
 * window, from the first named to the last, `undefined` for none.
 * @param days - New York date → its session (its `date` the same) or `"closed"`.
 * @param python - the interpreter the calendar names.
 */
export function fakeCalendar(days: Record<string, MarketSession | "closed">, python = "python3"): MarketCalendar & { readonly asked: string[] } {
  const asked: string[] = [];
  const dates = Object.keys(days).sort();
  let window: MarketWindow | undefined;
  if (dates.length > 0) {
    const first = Date.parse(`${dates[0]}T00:00:00Z`);
    const last = Date.parse(`${dates[dates.length - 1]}T00:00:00Z`);
    window = {
      from: dates[0],
      days: Math.round((last - first) / 86_400_000) + 1,
      source: "fake calendar",
      python,
      sessions: dates.flatMap((date) => {
        const day = days[date];
        return day === "closed" ? [] : [day];
      }),
    };
  }
  let latest: DayAnswer | undefined;
  return {
    python,
    asked,
    async today(now) {
      const date = etDate(new Date(now));
      if (asked.at(-1) !== date) asked.push(date);
      const day = Object.hasOwn(days, date) ? days[date] : undefined;
      const answer: DayAnswer = day === undefined
        ? { ok: false, date, error: `the fake calendar has no ${date}` }
        : { ok: true, date, session: day, source: "fake calendar" };
      if (latest === undefined || date >= latest.date) latest = answer;
      return answer;
    },
    peek: () => latest,
    window: () => window,
  };
}
