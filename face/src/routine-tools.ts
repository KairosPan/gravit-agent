// face/src/routine-tools.ts
/**
 * The conversation's two routine tools - `routine_propose` and `routine_list` - beside its five task tools
 * (src/task-tools.ts) on the conversation agent's own tool layer.
 *
 * `routine_propose` adds nothing: it stores a pending proposal (src/routines.ts `RoutineOps.propose`), which the
 * operator confirms or dismisses on its card in the browser. It runs only in a turn the operator's message opened
 * ({@link OPERATOR_ONLY}, checked first, so a refused call never reaches the store); then the face's secret check
 * looks at the name, the instruction and the note, and a call carrying a secret is refused in a sentence that never
 * echoes it, before anything is stored. A `RoutineError` from the store reaches the model as its message (dsh hands a
 * thrown error to the model as "Error: <message>"). The when line is the face's ({@link whenText}), never the model's.
 *
 * No tool here confirms, switches, tests or deletes a routine: only the operator's click does.
 * @module
 */
import type { TaskOrigin } from "./conversation.ts";
import type { DeskToolDefinition } from "./desk-tools.ts";
import { INSTRUCTION_MAX, loadRoutines, NAME_MAX, NOTE_MAX, type RoutineOps } from "./routines.ts";
import { runsPerDay, TIMES_MAX, whenText } from "./routine-schedule.ts";
import { OPERATOR_ONLY } from "./task-tools.ts";

/** What `routine_propose` throws when the name, the instruction or the note carries a secret. */
export const CARRIES_SECRET = "the routine carries a secret; say it without the key";

/** What the tools close over: the harness home, whose store `routine_list` reads; `operatorTurn()`, read on every
 * proposal; `turnOrigin()`, the proposal's origin (`web` when absent); and `hasSecret`, the face's secret check over
 * one text. */
export interface RoutineToolDeps {
  home: string;
  operatorTurn: () => boolean;
  turnOrigin?: () => TaskOrigin;
  hasSecret: (text: string) => boolean;
}

const asJson = (_args: unknown, value: unknown): { type: "text"; text: string }[] => [{ type: "text", text: JSON.stringify(value) }];
const objectOf = (args: unknown): Record<string, unknown> => (args !== null && typeof args === "object" ? (args as Record<string, unknown>) : {});

const HHMM_SCHEMA = { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" };
const SCHEDULE_SCHEMA = {
  type: "object",
  description: "New York time. `days`, then exactly one of `times` or `every`.",
  properties: {
    days: {
      oneOf: [
        { type: "string", enum: ["trading", "daily"] },
        { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", enum: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] } },
      ],
    },
    times: { type: "array", minItems: 1, maxItems: TIMES_MAX, items: HHMM_SCHEMA },
    every: {
      type: "object",
      properties: { minutes: { type: "integer" }, from: HHMM_SCHEMA, to: HHMM_SCHEMA },
      required: ["minutes", "from", "to"],
      additionalProperties: false,
    },
  },
  required: ["days"],
  oneOf: [{ required: ["times"] }, { required: ["every"] }],
  additionalProperties: false,
};

/** The two tools over `ops`, in this order. */
export function routineToolDefinitions(ops: RoutineOps, deps: RoutineToolDeps): DeskToolDefinition[] {
  const propose: DeskToolDefinition = {
    name: "routine_propose",
    description:
      "Propose a routine: work the operator wants on a clock. Only in a turn the operator's message opened. " +
      "It adds nothing: the operator sees a card with the name, when it runs and the instruction, and confirms it in the browser. " +
      "`schedule` is New York time: `days` is trading, daily or weekdays; give either `times` or `every` with its `from` and `to` (told no end, use 16:00). " +
      "`instruction` is what a fresh Gravit does on each run, alone: it can price symbols, read headlines, the market's list and bars, search and open web pages, and read the repository; it cannot see the account or place an order. " +
      "`note` is one line the operator should know. `replaces` is the id of the routine this changes.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1, maxLength: NAME_MAX },
        schedule: SCHEDULE_SCHEMA,
        instruction: { type: "string", minLength: 1, maxLength: INSTRUCTION_MAX },
        note: { type: "string", maxLength: NOTE_MAX },
        replaces: { type: "string" },
      },
      required: ["name", "schedule", "instruction"],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean", const: true },
          proposal: { type: "string" },
          when: { type: "string" },
          runsPerDay: { type: "integer" },
          replaces: { type: "string" },
        },
        required: ["ok", "proposal", "when", "runsPerDay"],
        additionalProperties: false,
      },
      render: asJson,
    },
    timeoutMs: 15_000,
    async execute(args) {
      if (!deps.operatorTurn()) throw new Error(OPERATOR_ONLY);
      const { name, schedule, instruction, note, replaces } = objectOf(args);
      /* the secret check before the store: a value that is no string the store refuses on its own */
      for (const text of [name, instruction, note]) {
        if (typeof text === "string" && deps.hasSecret(text)) throw new Error(CARRIES_SECRET);
      }
      const origin = deps.turnOrigin?.() ?? { kind: "web" as const };
      const proposal = await ops.propose({
        name, schedule, instruction, ...(note === undefined ? {} : { note }), ...(replaces === undefined ? {} : { replaces }), origin,
      });
      return {
        ok: true, proposal: proposal.id, when: whenText(proposal.schedule), runsPerDay: runsPerDay(proposal.schedule),
        ...(proposal.replaces === undefined ? {} : { replaces: proposal.replaces }),
      };
    },
    presentCall: (args) => ({ card: "generic", title: `Propose routine: ${String(objectOf(args).name ?? "")}`, kind: "read" }),
  };
  const list: DeskToolDefinition = {
    name: "routine_list",
    description: "The operator's routines and the cards still waiting: ids, names, when each runs, on or off.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    output: {
      schema: {
        type: "object",
        properties: {
          routines: {
            type: "array",
            items: {
              type: "object",
              properties: { id: { type: "string" }, name: { type: "string" }, when: { type: "string" }, enabled: { type: "boolean" } },
              required: ["id", "name", "when", "enabled"],
              additionalProperties: false,
            },
          },
          pending: {
            type: "array",
            items: {
              type: "object",
              properties: { proposal: { type: "string" }, name: { type: "string" }, when: { type: "string" }, replaces: { type: "string" } },
              required: ["proposal", "name", "when"],
              additionalProperties: false,
            },
          },
          error: { type: "string" },
        },
        additionalProperties: false,
      },
      render: asJson,
    },
    timeoutMs: 15_000,
    async execute() {
      const load = await loadRoutines(deps.home);
      if (!load.ok) return { error: load.error };
      return {
        routines: load.store.routines.map((r) => ({ id: r.id, name: r.name, when: whenText(r.schedule), enabled: r.enabled })),
        pending: load.store.proposals.filter((p) => p.state === "pending").map((p) => ({
          proposal: p.id, name: p.name, when: whenText(p.schedule), ...(p.replaces === undefined ? {} : { replaces: p.replaces }),
        })),
      };
    },
    presentCall: () => ({ card: "generic", title: "Routines", kind: "read" }),
  };
  return [propose, list];
}
