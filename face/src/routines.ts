/** The routines' store and its acts. A routine is a named instruction the operator confirmed on a card, run on a
 * schedule by an unattended agent; a proposal is a routine waiting for that confirmation. Both live in one file,
 * `routines.json` in the desk's directory ({@link deskDir}), and this module is the one place they are kept and
 * changed: every act reads the file, checks, and writes it whole (a temp file renamed over it) under one file lock on
 * its path, then appends one line to `routines.jsonl` beside it. A file that fails to parse or to check loads as
 * unreadable, and then every act refuses and writes nothing - the operator's file is never written over.
 *
 * Light by rule (tests/desk-weight.test.ts): `desk.ts` loads this module, so it imports `desk.ts`,
 * `routine-schedule.ts` and node built-ins alone.
 * @module
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { withFileLock, writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";
import { appendRecord, deskDir } from "./desk.ts";
import { parseSchedule, type RoutineSchedule, type Weekday } from "./routine-schedule.ts";

/** The store's file, in {@link deskDir}. */
export const ROUTINES_FILE = "routines.json";
/** The acts' ledger, in {@link deskDir} beside the store. */
export const ROUTINES_LEDGER = "routines.jsonl";
/** The most routines the store keeps. */
export const ROUTINES_MAX = 20;
/** The most proposals pending at once. */
export const PROPOSALS_MAX = 10;
/** The longest name, in characters. */
export const NAME_MAX = 60;
/** The longest instruction, in characters. */
export const INSTRUCTION_MAX = 2_000;
/** The longest note, in characters. */
export const NOTE_MAX = 200;
/** How long a proposal stays pending before the sweep expires it. */
export const PROPOSAL_TTL_MS = 7 * 86_400_000;
/** How long a settled proposal is kept before the sweep removes it. */
export const SETTLED_KEEP_MS = 30 * 86_400_000;
/** The daily token cap a store is first written with. */
export const DAILY_TOKENS_DEFAULT = 10_000_000;

/** Where a proposal was asked for: the face's page, or a phone network. */
export type Origin = { kind: "web" } | { kind: "phone"; network: string };

/** A confirmed routine. `sha256` is its version's {@link versionSha}; `proposal` the proposal that set that version;
 * `enabledAt` when it was last switched on (absent until it is, and left as it is by a switch off or a replacement) -
 * the clock row never records a slot before it, nor one before `confirmedAt`. Neither is part of the version. */
export interface Routine {
  id: string;
  name: string;
  schedule: RoutineSchedule;
  instruction: string;
  note?: string;
  sha256: string;
  proposal: string;
  origin: Origin;
  confirmedAt: string;
  enabled: boolean;
  enabledAt?: string;
}

/** A routine waiting for the operator's confirmation, or settled one way or another. `replaces` names the routine
 * a confirmation would change in place; `routine` the one it made or changed. */
export interface Proposal {
  id: string;
  name: string;
  schedule: RoutineSchedule;
  instruction: string;
  note?: string;
  sha256: string;
  replaces?: string;
  origin: Origin;
  proposedAt: string;
  state: "pending" | "confirmed" | "dismissed" | "superseded" | "expired";
  settledAt?: string;
  routine?: string;
}

/** The whole store, as `routines.json` holds it. */
export interface RoutineStore {
  version: 1;
  budget: { dailyTokens: number };
  routines: Routine[];
  proposals: Proposal[];
}

/** The store as loaded, or why it could not be. */
export type StoreLoad = { ok: true; store: RoutineStore } | { ok: false; error: string };

/** An act refused: `invalid` input, a `limit` reached, an `unknown` id, a proposal or routine in the wrong `state`,
 * or an `unreadable` store. */
export class RoutineError extends Error {
  constructor(readonly code: "invalid" | "limit" | "unknown" | "state" | "unreadable", message: string) {
    super(message);
    this.name = "RoutineError";
  }
}

/** The acts on the store. */
export interface RoutineOps {
  /** A new pending proposal, checked. */
  propose(input: { name: unknown; schedule: unknown; instruction: unknown; note?: unknown; replaces?: unknown; origin: Origin }): Promise<Proposal>;
  /** A pending proposal made a routine, or its routine changed in place; a second call answers the same, changing nothing. */
  confirm(proposal: string): Promise<{ routine: Routine; proposal: Proposal }>;
  /** A pending proposal dismissed; a dismissed one answers itself. */
  dismiss(proposal: string): Promise<Proposal>;
  /** A routine switched on (stamping its `enabledAt`) or off. */
  setEnabled(id: string, enabled: boolean): Promise<Routine>;
  /** A routine deleted. */
  remove(id: string): Promise<void>;
  /** Pending proposals older than {@link PROPOSAL_TTL_MS} expired; ones settled longer than {@link SETTLED_KEEP_MS} removed. */
  sweep(): Promise<void>;
}

/** One line of {@link ROUTINES_LEDGER}. */
interface LedgerLine {
  t: string;
  kind: "proposed" | "confirmed" | "dismissed" | "superseded" | "expired" | "switched" | "deleted";
  proposal?: string;
  routine?: string;
  sha256?: string;
  enabled?: boolean;
}

const WEEK: readonly Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const ROUTINE_ID = /^r-[0-9a-f]{8}$/;
const PROPOSAL_ID = /^p-[0-9a-f]{8}$/;
/** Whether `v` is a routine's id: `r-` and eight lowercase hex digits. */
export const isRoutineId = (v: unknown): v is string => typeof v === "string" && ROUTINE_ID.test(v);
/** Whether `v` is a proposal's id: `p-` and eight lowercase hex digits. */
export const isProposalId = (v: unknown): v is string => typeof v === "string" && PROPOSAL_ID.test(v);
const STATES: readonly Proposal["state"][] = ["pending", "confirmed", "dismissed", "superseded", "expired"];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isIso = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));

/** A schedule in its one form: `times` ascending, a weekday list in the week's order, keys in a fixed order - so one
 * schedule always serializes, and hashes, the same. */
function canonical(schedule: RoutineSchedule): RoutineSchedule {
  const days = Array.isArray(schedule.days) ? WEEK.filter((d) => (schedule.days as Weekday[]).includes(d)) : schedule.days;
  return "times" in schedule
    ? { days, times: [...schedule.times].sort() }
    : { days, every: { minutes: schedule.every.minutes, from: schedule.every.from, to: schedule.every.to } };
}

/**
 * A routine version's hash: sha256, hex, of the canonical JSON of its name, schedule and instruction.
 * @param input - the version's name, schedule and instruction.
 */
export function versionSha(input: { name: string; schedule: RoutineSchedule; instruction: string }): string {
  const text = JSON.stringify({ name: input.name, schedule: canonical(input.schedule), instruction: input.instruction });
  return createHash("sha256").update(text).digest("hex");
}

/** `v` as a name, an instruction or a note within `max` characters (at least `min`), trimmed - or the sentence refusing it. */
function checkText(v: unknown, what: string, min: number, max: number): { ok: true; text: string } | { ok: false; error: string } {
  const range = min === 0 ? `at most ${max.toLocaleString("en-US")}` : `${min} to ${max.toLocaleString("en-US")}`;
  const error = `A routine's ${what} is ${range} characters.`;
  if (typeof v !== "string") return { ok: false, error };
  const text = v.trim();
  return within(text, min, max) ? { ok: true, text } : { ok: false, error };
}

/** Whether `s` is `min` to `max` characters long, counted by code point as task-tools.ts counts its limits. */
const within = (s: string, min: number, max: number): boolean => {
  const n = Array.from(s).length;
  return n >= min && n <= max;
};

/** `v` as a schedule, parsed and canonical, or undefined. */
function scheduleOf(v: unknown): RoutineSchedule | undefined {
  const parsed = parseSchedule(v);
  return parsed.ok ? canonical(parsed.schedule) : undefined;
}

const isOrigin = (v: unknown): v is Origin =>
  isRecord(v) && (v.kind === "web" || (v.kind === "phone" && typeof v.network === "string"));

/** The fields a routine and a proposal share, checked; their schedule canonical and their `sha256` recomputed from
 * the name, schedule and instruction, so a store edited by hand never carries a stale version id. Undefined when one
 * fails. */
function versionOf(v: Record<string, unknown>): Pick<Routine, "name" | "schedule" | "instruction" | "note" | "sha256" | "origin"> | undefined {
  const schedule = scheduleOf(v.schedule);
  if (schedule === undefined) return undefined;
  if (typeof v.name !== "string" || !within(v.name, 1, NAME_MAX)) return undefined;
  if (typeof v.instruction !== "string" || !within(v.instruction, 1, INSTRUCTION_MAX)) return undefined;
  if (v.note !== undefined && (typeof v.note !== "string" || !within(v.note, 0, NOTE_MAX))) return undefined;
  if (!isOrigin(v.origin)) return undefined;
  const sha256 = versionSha({ name: v.name, schedule, instruction: v.instruction });
  return { name: v.name, schedule, instruction: v.instruction, ...(v.note === undefined ? {} : { note: v.note }), sha256, origin: v.origin };
}

/** `v` as a routine, or undefined. */
function routineOf(v: unknown): Routine | undefined {
  if (!isRecord(v) || typeof v.id !== "string" || !ROUTINE_ID.test(v.id)) return undefined;
  const version = versionOf(v);
  if (version === undefined || typeof v.proposal !== "string" || !PROPOSAL_ID.test(v.proposal)) return undefined;
  if (!isIso(v.confirmedAt) || typeof v.enabled !== "boolean") return undefined;
  if (v.enabledAt !== undefined && !isIso(v.enabledAt)) return undefined;
  return {
    id: v.id, ...version, proposal: v.proposal, confirmedAt: v.confirmedAt, enabled: v.enabled,
    ...(v.enabledAt === undefined ? {} : { enabledAt: v.enabledAt as string }),
  };
}

/** `v` as a proposal, or undefined. */
function proposalOf(v: unknown): Proposal | undefined {
  if (!isRecord(v) || typeof v.id !== "string" || !PROPOSAL_ID.test(v.id)) return undefined;
  const version = versionOf(v);
  if (version === undefined || !isIso(v.proposedAt) || !(STATES as readonly unknown[]).includes(v.state)) return undefined;
  if (v.replaces !== undefined && (typeof v.replaces !== "string" || !ROUTINE_ID.test(v.replaces))) return undefined;
  if (v.settledAt !== undefined && !isIso(v.settledAt)) return undefined;
  if (v.routine !== undefined && (typeof v.routine !== "string" || !ROUTINE_ID.test(v.routine))) return undefined;
  if ((v.state === "pending") !== (v.settledAt === undefined)) return undefined;
  return {
    id: v.id, ...version,
    ...(v.replaces === undefined ? {} : { replaces: v.replaces as string }),
    proposedAt: v.proposedAt, state: v.state as Proposal["state"],
    ...(v.settledAt === undefined ? {} : { settledAt: v.settledAt as string }),
    ...(v.routine === undefined ? {} : { routine: v.routine as string }),
  };
}

/** The store's text checked, or the sentence saying why it is not one. */
function parseStore(text: string): StoreLoad {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `${ROUTINES_FILE} is not JSON: ${(err as Error).message}` };
  }
  if (!isRecord(raw) || raw.version !== 1) return { ok: false, error: `${ROUTINES_FILE} is not a version 1 store.` };
  const budget = raw.budget;
  if (!isRecord(budget) || typeof budget.dailyTokens !== "number" || !Number.isInteger(budget.dailyTokens) || budget.dailyTokens < 0) {
    return { ok: false, error: `${ROUTINES_FILE} has no budget.dailyTokens as a whole number.` };
  }
  if (!Array.isArray(raw.routines) || !Array.isArray(raw.proposals)) return { ok: false, error: `${ROUTINES_FILE} lacks routines or proposals.` };
  const routines: Routine[] = [];
  for (const [i, r] of raw.routines.entries()) {
    const routine = routineOf(r);
    if (routine === undefined) return { ok: false, error: `${ROUTINES_FILE}: routine ${i + 1} fails its check.` };
    routines.push(routine);
  }
  const proposals: Proposal[] = [];
  for (const [i, p] of raw.proposals.entries()) {
    const proposal = proposalOf(p);
    if (proposal === undefined) return { ok: false, error: `${ROUTINES_FILE}: proposal ${i + 1} fails its check.` };
    proposals.push(proposal);
  }
  if (new Set(routines.map((r) => r.id)).size !== routines.length || new Set(proposals.map((p) => p.id)).size !== proposals.length) {
    return { ok: false, error: `${ROUTINES_FILE} holds one id twice.` };
  }
  return { ok: true, store: { version: 1, budget: { dailyTokens: budget.dailyTokens }, routines, proposals } };
}

/** The store's path in `home`. */
const storePath = (home: string): string => join(deskDir(home), ROUTINES_FILE);

/**
 * The store, checked. An absent file is an empty store with the default daily cap, not an error; a file that does not
 * parse, or whose shape or any routine's or proposal's schedule fails its check, is `{ ok: false }`.
 * @param home - the harness home.
 */
export async function loadRoutines(home: string): Promise<StoreLoad> {
  let text: string;
  try {
    text = await readFile(storePath(home), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: true, store: { version: 1, budget: { dailyTokens: DAILY_TOKENS_DEFAULT }, routines: [], proposals: [] } };
    }
    return { ok: false, error: `${ROUTINES_FILE} could not be read: ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}` };
  }
  return parseStore(text);
}

/** A fresh id, `prefix` and eight hex characters, none of `taken`. */
function freshId(prefix: "r-" | "p-", taken: Set<string>): string {
  for (;;) {
    const id = `${prefix}${randomBytes(4).toString("hex")}`;
    if (!taken.has(id)) return id;
  }
}

/**
 * The acts on the store in `home`.
 * @param deps.home - the harness home.
 * @param deps.now - the clock, ms since the epoch; `Date.now` by default.
 * @param deps.log - where a failed ledger append is said; `console.error` by default.
 */
export function routineOps(deps: { home: string; now?: () => number; log?: (line: string) => void }): RoutineOps {
  const { home } = deps;
  const now = deps.now ?? Date.now;
  const path = storePath(home);

  /**
   * One act: under the store's lock, load it (refusing an unreadable one), let `change` check and change it, write it
   * whole when `change` says so, then append its ledger lines after the lock.
   */
  async function act<T>(change: (store: RoutineStore, t: string) => { result: T; write: boolean; lines: Omit<LedgerLine, "t">[] }): Promise<T> {
    await mkdir(deskDir(home), { recursive: true });
    const done = await withFileLock(path, async () => {
      const t = new Date(now()).toISOString(); // read under the lock: a queued act is timed when it runs
      const load = await loadRoutines(home);
      if (!load.ok) throw new RoutineError("unreadable", load.error);
      const out = change(load.store, t);
      if (out.write) await writeFileAtomic(path, `${JSON.stringify(load.store, null, 2)}\n`, { mode: 0o600 });
      return { ...out, t };
    });
    const { t } = done;
    for (const line of done.lines) await appendRecord(home, ROUTINES_LEDGER, { t, ...line }, { log: deps.log });
    return done.result;
  }

  /** The proposal `id` in `store`, or a refusal. */
  const proposalIn = (store: RoutineStore, id: string): Proposal => {
    const p = store.proposals.find((x) => x.id === id);
    if (p === undefined) throw new RoutineError("unknown", `No proposal ${id}.`);
    return p;
  };
  /** The routine `id` in `store`, or a refusal. */
  const routineIn = (store: RoutineStore, id: string): Routine => {
    const r = store.routines.find((x) => x.id === id);
    if (r === undefined) throw new RoutineError("unknown", `No routine ${id}.`);
    return r;
  };

  return {
    propose: (input) => act((store, t) => {
      const name = checkText(input.name, "name", 1, NAME_MAX);
      if (!name.ok) throw new RoutineError("invalid", name.error);
      const instruction = checkText(input.instruction, "instruction", 1, INSTRUCTION_MAX);
      if (!instruction.ok) throw new RoutineError("invalid", instruction.error);
      let note: string | undefined;
      if (input.note !== undefined) {
        const checked = checkText(input.note, "note", 0, NOTE_MAX);
        if (!checked.ok) throw new RoutineError("invalid", checked.error);
        note = checked.text === "" ? undefined : checked.text;
      }
      const parsed = parseSchedule(input.schedule);
      if (!parsed.ok) throw new RoutineError("invalid", parsed.error);
      const schedule = canonical(parsed.schedule);
      let replaces: string | undefined;
      if (input.replaces !== undefined) {
        if (typeof input.replaces !== "string" || !store.routines.some((r) => r.id === input.replaces)) {
          throw new RoutineError("unknown", `No routine ${String(input.replaces)} to replace.`);
        }
        replaces = input.replaces;
      }
      if (store.proposals.filter((p) => p.state === "pending").length >= PROPOSALS_MAX) {
        throw new RoutineError("limit", `At most ${PROPOSALS_MAX} proposals wait for confirmation at once.`);
      }
      const proposal: Proposal = {
        id: freshId("p-", new Set(store.proposals.map((p) => p.id))),
        name: name.text, schedule, instruction: instruction.text, ...(note === undefined ? {} : { note }),
        sha256: versionSha({ name: name.text, schedule, instruction: instruction.text }),
        ...(replaces === undefined ? {} : { replaces }),
        origin: input.origin, proposedAt: t, state: "pending",
      };
      store.proposals.push(proposal);
      return { result: proposal, write: true, lines: [{ kind: "proposed", proposal: proposal.id, sha256: proposal.sha256 }] };
    }),

    confirm: (id) => act((store, t) => {
      const proposal = proposalIn(store, id);
      if (proposal.state === "confirmed") {
        const routine = store.routines.find((r) => r.id === proposal.routine);
        if (routine === undefined) throw new RoutineError("state", `Proposal ${id} was confirmed; its routine has since been deleted.`);
        return { result: { routine, proposal }, write: false, lines: [] };
      }
      if (proposal.state !== "pending") throw new RoutineError("state", `Proposal ${id} is ${proposal.state}, not pending.`);
      if (Date.parse(t) - Date.parse(proposal.proposedAt) > PROPOSAL_TTL_MS) throw new RoutineError("state", `Proposal ${id} has expired.`);
      const version = {
        name: proposal.name, schedule: proposal.schedule, instruction: proposal.instruction,
        ...(proposal.note === undefined ? {} : { note: proposal.note }),
        sha256: proposal.sha256, proposal: proposal.id, origin: proposal.origin, confirmedAt: t,
      };
      let routine: Routine;
      const lines: Omit<LedgerLine, "t">[] = [];
      if (proposal.replaces !== undefined) {
        const index = store.routines.findIndex((r) => r.id === proposal.replaces);
        if (index < 0) throw new RoutineError("unknown", `Routine ${proposal.replaces}, which proposal ${id} replaces, has been deleted.`);
        const old = store.routines[index]!;
        routine = { id: old.id, ...version, enabled: old.enabled, ...(old.enabledAt === undefined ? {} : { enabledAt: old.enabledAt }) };
        store.routines[index] = routine;
      } else {
        if (store.routines.length >= ROUTINES_MAX) throw new RoutineError("limit", `At most ${ROUTINES_MAX} routines are kept; delete one first.`);
        routine = { id: freshId("r-", new Set(store.routines.map((r) => r.id))), ...version, enabled: true };
        store.routines.push(routine);
      }
      proposal.state = "confirmed";
      proposal.settledAt = t;
      proposal.routine = routine.id;
      lines.push({ kind: "confirmed", proposal: proposal.id, routine: routine.id, sha256: proposal.sha256 });
      if (proposal.replaces !== undefined) {
        for (const sibling of store.proposals) {
          if (sibling.state !== "pending" || sibling.replaces !== proposal.replaces) continue;
          sibling.state = "superseded";
          sibling.settledAt = t;
          lines.push({ kind: "superseded", proposal: sibling.id });
        }
      }
      return { result: { routine, proposal }, write: true, lines };
    }),

    dismiss: (id) => act((store, t) => {
      const proposal = proposalIn(store, id);
      if (proposal.state === "dismissed") return { result: proposal, write: false, lines: [] };
      if (proposal.state !== "pending") throw new RoutineError("state", `Proposal ${id} is ${proposal.state}, not pending.`);
      proposal.state = "dismissed";
      proposal.settledAt = t;
      return { result: proposal, write: true, lines: [{ kind: "dismissed", proposal: id }] };
    }),

    setEnabled: (id, enabled) => act((store, t) => {
      const routine = routineIn(store, id);
      if (routine.enabled === enabled) return { result: routine, write: false, lines: [] };
      routine.enabled = enabled;
      if (enabled) routine.enabledAt = t;
      return { result: routine, write: true, lines: [{ kind: "switched", routine: id, enabled }] };
    }),

    remove: (id) => act((store) => {
      routineIn(store, id);
      store.routines = store.routines.filter((r) => r.id !== id);
      return { result: undefined, write: true, lines: [{ kind: "deleted", routine: id }] };
    }),

    sweep: () => act((store, t) => {
      const at = Date.parse(t);
      const lines: Omit<LedgerLine, "t">[] = [];
      for (const p of store.proposals) {
        if (p.state !== "pending" || at - Date.parse(p.proposedAt) <= PROPOSAL_TTL_MS) continue;
        p.state = "expired";
        p.settledAt = t;
        lines.push({ kind: "expired", proposal: p.id });
      }
      const kept = store.proposals.filter((p) => p.settledAt === undefined || at - Date.parse(p.settledAt) <= SETTLED_KEEP_MS);
      const pruned = kept.length !== store.proposals.length;
      store.proposals = kept;
      return { result: undefined, write: lines.length > 0 || pruned, lines };
    }),
  };
}
