// face/tests/fixtures/midboot-order-standin.js
/**
 * A SEAT-WRITE STAND-IN, registered the moment the tool registry exists - for
 * tests/order-gate-midboot-smoke.test.ts only. It stands in for the Account
 * seat's row: an MCP row's tools are registered as that row activates
 * (dsh-mcp-client awaits its initial discovery, NEW
 * packages/mcp/mcp-client/src/index.ts:194-199), which can be long before a
 * slower sibling lets `boot()` resolve.
 *
 * The tool's name and description come from the row's `config`, so the test
 * states them (the name carries a seat write's raw suffix, src/orders.ts
 * SEAT_WRITE_RAW_NAMES) and the gate sees exactly what the real tool would
 * show it. Nothing is behind it - no seat, no Account, no venue: its body only
 * RECORDS its arguments in the drill, and that record is the test's evidence
 * of whether an order dispatched (the same stand-in order-gate-smoke.test.ts
 * registers after boot).
 *
 * It also hands the test the ROOT context of the tree being booted: `bootFace`
 * returns it only once `boot()` has resolved, and the test's whole point is to
 * act before that. The registration is an effect of this row's fiber - the
 * registering context owns it (NEW packages/core/scope/src/store.ts:226-264) -
 * so it leaves with the row. Imports nothing (see midboot-slow-row.js).
 */
export const name = "midboot-order-standin";
export const inject = ["tools"];

/** The drill's key; tests/order-gate-midboot-smoke.test.ts uses the same one. */
const DRILL = Symbol.for("gravit-face.order-gate-midboot-drill");

/**
 * Register the stand-in and publish the root context to the drill.
 * @param ctx - this row's context; `tools` is injected.
 * @param config - `{ tool, description }` from the row.
 * @throws when no drill is installed, or the row names no tool.
 */
export function apply(ctx, config) {
  const drill = globalThis[DRILL];
  if (drill === undefined) {
    throw new Error(`${name}: no drill installed - this fixture runs only under tests/order-gate-midboot-smoke.test.ts`);
  }
  if (typeof config?.tool !== "string" || typeof config?.description !== "string") {
    throw new Error(`${name}: the row must configure { tool, description }`);
  }
  drill.root = ctx.root;
  ctx.tools.register({
    name: config.tool,
    description: config.description,
    parameters: {
      type: "object",
      properties: { venue: { type: "string" }, symbol: { type: "string" }, qty: { type: "number" }, side: { type: "string" } },
    },
    output: { schema: { type: "object" }, render: () => [{ type: "text", text: "drill order recorded" }] },
    execute: async (args) => {
      drill.ran.push(args);
      return { recorded: true };
    },
  });
  drill.standinRegistered = Date.now();
}
