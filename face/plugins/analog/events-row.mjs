// face/plugins/analog/events-row.mjs
/**
 * `analog-events`: `analog_events`, past events like a stock's present news, measured. `execute`, in order:
 * `NOT_GRAVIT` for a delegated child; the scan (`analogViews.scanEvents`), which marks a source opened only when the
 * service's page record holds it; the view stored (`analogViews.writeView`); then the reply `{ ok, view, digest }`,
 * the digest built from the scan's own view under the stored id, so the numbers it quotes are the scan's whatever the
 * store trimmed. Every refusal throws through `asToolError`.
 */
import { defineTool } from "@deepseek-ai/dsh-tools";
import { eventsDigest } from "./lib/event-digest.mjs";
import { ANCHORS_MAX, EVENTS_MAX, GROUPS_MAX, LIMITS } from "./lib/event-scan.mjs";
import { TIMINGS } from "./lib/events.mjs";
import { asToolError, callerIsChild, refuse } from "./lib/errors.mjs";

export const name = "analog-events";
export const inject = ["tools", "analogViews"];

export const EVENTS_DESCRIPTION =
  "Past events like this one, measured. Give the precedents you researched: for each, the company's current US ticker, a short label, a group, the date the news first became public and its timing (pre, open, post or closed, New York), the source URL and whether the source reader verified it; optionally the present case, with up to three anchors. Answers what each stock did from the close before the first session that could react, against SPY, as a digest and the id of a view; the page draws the charts from the view, so quote numbers from the digest only. Research first: load the analog-guide skill and hand the finding and dating to role_source_reader. A date typed from memory is never verified, and the face shows as unverified any source the reader did not open. A reading of the past with no lookahead guard: never evidence for a trade, never a forecast, never a recommendation.";

/** What each timing means, as the source reader's persona defines it; the date is New York's. */
const TIMING_WORDS =
  "when on that date the news came out, New York time: pre before 09:30, open during the session, post after 16:00, closed a weekend or a market holiday; the date is New York's";

/** The parameters, in the dsh DSL. Their checks are the scan's. */
const PARAMETERS = {
  title: { type: "string", description: `what the events have in common, at most ${LIMITS.title} characters`, required: true },
  events: {
    type: "array",
    description: `1 to ${EVENTS_MAX} past events, in at most ${GROUPS_MAX} groups`,
    required: true,
    items: {
      type: "object",
      additionalProperties: false,
      properties: {
        symbol: { type: "string", description: "the company's current US ticker, such as NVDA", required: true },
        label: { type: "string", description: `a short label, at most ${LIMITS.label} characters`, required: true },
        group: { type: "string", description: `the event's group, at most ${LIMITS.group} characters`, required: true },
        date: { type: "string", description: "YYYY-MM-DD, the date the news first became public", required: true },
        timing: { type: "string", enum: [...TIMINGS], description: TIMING_WORDS, required: true },
        source: { type: "string", description: `the source's http(s) URL without credentials, at most ${LIMITS.source} characters`, required: true },
        verified: { type: "boolean", description: "whether the source reader verified the date at the source", required: true },
        note: { type: "string", description: `optional, at most ${LIMITS.note} characters` },
      },
    },
  },
  query: {
    type: "object",
    additionalProperties: false,
    description: "optional: the present case, measured beside the events",
    properties: {
      symbol: { type: "string", description: "the present case's US ticker", required: true },
      anchors: {
        type: "array",
        description: `1 to ${ANCHORS_MAX} dates of the present case's news`,
        required: true,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            label: { type: "string", description: `a short label, at most ${LIMITS.label} characters`, required: true },
            date: { type: "string", description: "YYYY-MM-DD", required: true },
            timing: { type: "string", enum: [...TIMINGS], description: TIMING_WORDS, required: true },
          },
        },
      },
    },
  },
};

/**
 * @param {any} ctx the row's context, injecting `tools` and `analogViews`
 */
export function apply(ctx) {
  const service = ctx?.analogViews;
  if (service === undefined || service === null) throw new Error(`${name}: analogViews is missing; mount the analog-views row first`);
  ctx.effect(() => ctx.tools.register(defineTool({
    name: "analog_events",
    description: EVENTS_DESCRIPTION,
    parameters: PARAMETERS,
    output: {
      schema: { type: "string" },
      render: (_args, result) => [{ type: "text", text: result }],
    },
    async execute(args, exec) {
      try {
        if (callerIsChild(exec)) throw refuse.notGravit();
        const view = await service.scanEvents({ title: args.title, events: args.events, query: args.query });
        const { id } = await service.writeView(view);
        return JSON.stringify({ ok: true, view: id, digest: eventsDigest({ ...view, id }) });
      } catch (error) {
        throw asToolError(error);
      }
    },
  })));
}
