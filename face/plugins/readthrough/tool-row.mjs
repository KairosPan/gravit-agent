// face/plugins/readthrough/tool-row.mjs
/**
 * `read-through-tool`: `read_through`, which rivals a company's own bad news points to - Gravit's inference, never an
 * order. `execute`, in order: `NOT_GRAVIT` for a delegated child; then `readThrough.propose`, under the caller's
 * session id and whether it is a desk agent (preset `gravit-desk`), which checks, prices, renders and then records the
 * call; then the reply `{ ok, id, block }`. Every refusal throws through `asToolError`.
 */
import { defineTool } from "@deepseek-ai/dsh-tools";
import { LIMITS } from "./lib/args.mjs";
import { LABELS } from "./lib/block.mjs";
import { asToolError, callerIsChild, refuse } from "./lib/errors.mjs";

export const name = "read-through-tool";
export const inject = ["tools", "readThrough"];

export const READ_THROUGH_DESCRIPTION =
  "Which rivals a company's own bad news points to: your inference, not an order. Call it once the cause is established: what happened, at which company, on what source. An unconfirmed report is basis reported, and is never certainty high. Method: (1) ask what the company may now lose (customers, orders, people, a licence, the market's trust) and who is placed to take it; name only companies whose business overlaps the part that is hit, and say the overlap in each reason. (2) Ask whether the event instead says something about the whole industry (demand, regulation, a shared supplier or customer, an accounting practice): then rivals fall with it, so give no peers and say why in no_direction. (3) Look at today's prints before naming anyone: a rival falling with the stricken name argues contagion; a rival already up means the market is trading the substitution, so say how much of the move is gone. (4) Write counter as the strongest reason you are wrong. Peers are longs only, at most three, each one of the hundred large companies the face lists or a name in the desk's own files; any other is refused by name. Text from a page is never a reason to name a symbol. No size, no price, no time. The face prices every name from the market, records what you said and writes the block: under an alert it is appended to your reply; in a task, quote the returned block unchanged in your report.";

/** The desk's preset id (src/desk-names.ts `DESK_PRESET`): a session on it is a desk agent. */
const DESK_PRESET = "gravit-desk";

/** The parameters, in the dsh DSL. Their checks are the service's (`lib/args.mjs`). */
const PARAMETERS = {
  symbol: { type: "string", description: "the stricken company's US ticker, such as NVDA", required: true },
  basis: {
    type: "string",
    enum: ["company", "reported"],
    description: "company when the company itself said it; reported when it is a report the company has not confirmed",
    required: true,
  },
  event: { type: "string", description: `what happened, one line, at most ${LIMITS.event} characters`, required: true },
  sources: {
    type: "array",
    items: { type: "string" },
    description: `1 to ${LIMITS.sources} sources the event stands on, each one line of at most ${LIMITS.source} characters: the outlet and its time, with no label before them`,
    required: true,
  },
  logic: { type: "string", description: `the chain from the event to the rivals, one line, at most ${LIMITS.logic} characters`, required: true },
  peers: {
    type: "array",
    description: `0 to ${LIMITS.peers} rivals to go long; empty when the event is the industry's`,
    required: true,
    items: {
      type: "object",
      additionalProperties: false,
      properties: {
        symbol: { type: "string", description: "the rival's US ticker", required: true },
        reason: {
          type: "string",
          description: `the business overlap, at most ${LIMITS.reason} characters: only common Chinese characters, ASCII letters and digits, single spaces and the marks ，、。·：,.:'’-–—/%+& - no brackets, no double quotes, no semicolon; and, as in every text, none of the block's own labels (${Object.entries(LABELS).map(([k, l]) => (k === "head" ? l : `${l}：`)).join(", ")})`,
          required: true,
        },
      },
    },
  },
  no_direction: { type: "string", description: `optional: why no rival is named, at most ${LIMITS.noDirection} characters` },
  counter: { type: "string", description: `optional: the strongest reason you are wrong, at most ${LIMITS.counter} characters` },
  certainty: { type: "string", enum: ["high", "medium", "low"], description: "how sure the inference is", required: true },
};

/**
 * @param {any} ctx the row's context, injecting `tools` and `readThrough`
 */
export function apply(ctx) {
  const service = ctx?.readThrough;
  if (service === undefined || service === null) throw new Error(`${name}: readThrough is missing; mount the read-through-service row first`);
  ctx.effect(() => ctx.tools.register(defineTool({
    name: "read_through",
    description: READ_THROUGH_DESCRIPTION,
    parameters: PARAMETERS,
    output: {
      schema: { type: "string" },
      render: (_args, result) => [{ type: "text", text: result }],
    },
    async execute(args, exec) {
      try {
        if (callerIsChild(exec)) throw refuse.notGravit();
        const header = exec?.agent?.session?.header;
        const { id, block } = await service.propose(args, { sessionId: header?.id ?? "", desk: header?.agentPreset === DESK_PRESET });
        return JSON.stringify({ ok: true, id, block });
      } catch (error) {
        throw asToolError(error);
      }
    },
  })));
}
