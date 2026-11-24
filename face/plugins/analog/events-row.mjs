// face/plugins/analog/events-row.mjs
/**
 * `analog-events`: `analog_events`, past events like a stock's present news, measured. `execute`, in order:
 * `NOT_GRAVIT` for a delegated child; the scan (`analogViews.scanEvents`) at the call's base, horizons and benchmark,
 * which marks a source opened only when the service's page record holds it; the view stored (`analogViews.writeView`);
 * then the reply `{ ok, view, digest }`, the digest built from the scan's own view under the stored id, so the numbers it
 * quotes are the scan's whatever the store trimmed. Every refusal throws through `asToolError`.
 */
import { defineTool } from "@deepseek-ai/dsh-tools";
import { eventsDigest } from "./lib/event-digest.mjs";
import { ANCHORS_MAX, EVENTS_MAX, GROUPS_MAX, LIMITS } from "./lib/event-scan.mjs";
import { BASES, TIMINGS } from "./lib/events.mjs";
import { asToolError, callerIsChild, refuse } from "./lib/errors.mjs";

export const name = "analog-events";
export const inject = ["tools", "analogViews"];

export const EVENTS_DESCRIPTION =
  "Past events like this one, measured. Give the precedents you researched: for each, the company's current US ticker, a short label, a group, the date the news first became public (a listing: its first trading day) and its timing (pre, open, post or closed, New York), the source URL and whether the source reader verified it; optionally the present case, with up to three anchors. Choose the measurement before you call: `base` (prior_close, the default: the close before the first session that could react; price: each event's own price, such as an IPO's offer price, given with the first day's open its source states and, after a split, the company's split record, so the face can tie it to the split-adjusted bars; day0_open or day0_close: that session's own open or close; a listing has no close before it), `horizons` (up to six, 0 to 250 sessions; default 0, 1, 5, 20, 60) and `benchmark` (a US ticker, default SPY, or none). Answers what each stock did from that base against the benchmark, as a digest and the id of a view; the page draws the table from the view, so quote its numbers from the digest. Research first: load the analog-guide skill and hand the finding and dating to role_source_reader. A date or a price typed from memory is never verified, and the face shows as unverified any source the reader did not open. What this tool cannot measure, measure from daily bars as the skill says, labelled as your own. A reading of the past with no lookahead guard: never evidence for a trade, never a forecast, never a recommendation.";

/** What each timing means, as the source reader's persona defines it; the date is New York's. */
const TIMING_WORDS =
  "when on that date the news came out, New York time: pre before 09:30, open during the session, post after 16:00, closed a weekend or a market holiday; the date is New York's";

/** Each case's price fields, read under base `price` only; the scan refuses them under another base. */
const PRICE_FIELDS = {
  price: { type: "number", description: "under base price: the price its source states, such as an IPO's offer price" },
  stated_open: { type: "number", description: "under base price: day 0's opening price as the same source states it" },
  splits: {
    type: "array",
    description: "under base price, after a split: the company's splits after day 0, each date, new shares and old",
    items: {
      type: "object",
      additionalProperties: false,
      properties: {
        date: { type: "string", description: "YYYY-MM-DD, the split's date", required: true },
        new: { type: "integer", description: "the new shares", required: true },
        old: { type: "integer", description: "the old shares", required: true },
      },
    },
  },
  splits_source: { type: "string", description: "the URL of the company's page that lists them" },
};

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
        ...PRICE_FIELDS,
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
            source: { type: "string", description: `optional, the source's http(s) URL without credentials, at most ${LIMITS.source} characters` },
            verified: { type: "boolean", description: "optional, whether the source reader verified the date at the source" },
            note: { type: "string", description: `optional, at most ${LIMITS.note} characters` },
            ...PRICE_FIELDS,
          },
        },
      },
    },
  },
  base: {
    type: "string",
    enum: [...BASES],
    description: "what each change is measured from: prior_close (the default) the close before the first session that could react; price each case's own price; day0_open day 0's open; day0_close day 0's close",
  },
  horizons: { type: "array", items: { type: "integer" }, description: "up to six, 0 to 250 sessions after day 0" },
  benchmark: { type: "string", description: "a US ticker to measure against, SPY by default, or none" },
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
        const view = await service.scanEvents({
          title: args.title, events: args.events, query: args.query, base: args.base, horizons: args.horizons, benchmark: args.benchmark,
        });
        const { id } = await service.writeView(view);
        return JSON.stringify({ ok: true, view: id, digest: eventsDigest({ ...view, id }) });
      } catch (error) {
        throw asToolError(error);
      }
    },
  })));
}
