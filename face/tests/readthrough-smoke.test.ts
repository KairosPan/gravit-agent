// face/tests/readthrough-smoke.test.ts
/** The read-through on a real boot: the running registry lists `read_through` and both rows are listed active; a
 * `gravit-desk` session sees it, a bot's session and the source reader's do not, and the conversation's allow list
 * does not name it; through the real registry a Gravit root session's call is priced, rendered with its event and
 * recorded as a task's; a desk session with no run open is refused `ALERT_ONLY`, and inside a run opened through
 * `readThroughLane` its call is accepted with no event line, closed with the run, counted as given, and refused
 * `ALREADY_GIVEN` in a later run of the same event; a rival outside the fence is refused by name; and the fake quote
 * source was asked for US shares alone, while no request left the process.
 *
 * ONE BOOT PER PROCESS (smoke.test.ts header): `bootFace` sets `process.env.DSH_HOME`, so this is its own file.
 * Built as tests/analog-events-smoke.test.ts is: the scratch home is a `mkdtemp` directory, never `~/.dsh`; the
 * Account seat is disabled; `read-through-service` is replaced by a row over a scratch record directory; the bots root
 * is a temp one holding one fixture bot, `probe`, on the template's allow list. After the boot the face's half is
 * wired as `src/main.ts` wires it, over a fake quote source answering NVDA −7.3%, AMD +5.4% and SPY −0.4% at 04:03 ET
 * on Monday 2026-11-09, a pre-market instant, and a temp repository root with no desk files. No model is called; no
 * market, web page or `~/.dsh` is read. Gated by FACE_SMOKE=1.
 * @module
 */
import "./helpers/no-market.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { SessionId } from "@deepseek-ai/dsh-session";
import { setupFaceProfile } from "../src/setup.ts";
import { bootFace } from "../src/boot.ts";
import { DEFAULT_ALLOW, createBot, renderComposition } from "../src/bots.ts";
import { panelDeps, pluginListing } from "../src/panels.ts";
import { ROUTER_ALLOW } from "../src/router-preset.ts";
import type { MarketQuote, MarketQuoteIdentity, MarketQuoteSource } from "../src/market-quotes.ts";
import { readThroughLane, wireReadThrough } from "../src/readthrough.ts";
import { ID_RE, createRecord } from "../plugins/readthrough/lib/record.mjs";
import { makeBotsRoot, PLUGIN_ABS } from "./bots-fixture.ts";
import { mountClient, remote, signIn } from "./remote.ts";

const gated = process.env.FACE_SMOKE !== "1";

/** The fixed instant: 04:03 ET on Monday 2026-11-09, in the pre-market. */
const AT = "2026-11-09T09:03:10.000Z";
/** The last session's date before it: Friday. */
const REF = "2026-11-06";
/** The instant the event's session began: 04:00 ET that Monday. */
const SINCE = "2026-11-09T09:00:00.000Z";
const ARGS = {
  symbol: "NVDA", basis: "company", event: "董事会对 CEO 启动独立调查", sources: ["NVIDIA newsroom 11-08 18:00 ET"], logic: "供应不确定 → 客户找备选",
  peers: [{ symbol: "AMD", reason: "数据中心 GPU 的直接替代" }], counter: "调查针对个人", certainty: "medium",
};
/** The fake source's prints: price and change from the previous close. */
const PRINTS: Record<string, [number, number]> = { NVDA: [173.07, -7.27], AMD: [473.39, 5.42], SPY: [740, -0.4] };

/** The slice of the booted `tools` service this smoke calls. */
interface Tools {
  schemas(scope?: object): { name: string }[];
  execute(exec: object): Promise<{ isError: boolean; content?: { text?: string }[] }>;
}

test("read-through smoke: who sees read_through, the lane, the fence and the record, on a real boot", {
  skip: gated && "set FACE_SMOKE=1", timeout: 120_000,
}, async () => {
  const asked: MarketQuoteIdentity[] = [];
  const quoteOf = (a: MarketQuoteIdentity): MarketQuote => {
    const [price, changePct] = PRINTS[a.symbol] ?? [null, null];
    return {
      ...a, price, prev_close: null, change: null, change_pct: changePct, volume: null, as_of: AT, received_at: AT, volume_as_of: null,
      source: "market", feed: "robinhood", basis: "previous_close", quote_status: "live", market_status: "unknown", message: "",
    };
  };
  const quotes: MarketQuoteSource = {
    snapshot: async (assets) => {
      asked.push(...assets);
      return { ok: true, generated_at: AT, quotes: assets.map(quoteOf), providers: [] };
    },
  };

  const home = mkdtempSync(join(tmpdir(), "face-readthrough-smoke-"));
  const root = mkdtempSync(join(tmpdir(), "face-readthrough-root-"));
  setupFaceProfile(home);
  const patchPath = join(home, "profiles", "face", "cordis.patch.yml");
  const patch = readFileSync(patchPath, "utf8").replace(/^\[\][ \t]*$/m, "");
  // This smoke owns a scratch profile: no seat.
  writeFileSync(patchPath, `${patch}\n- id: mcp-account\n  disabled: true\n`);
  /* The fixture bot: the template's allow list, its plugin named by the absolute path a temp root needs. */
  const bots = await makeBotsRoot();
  await createBot(bots, { id: "probe", name: "Probe", soul: "You are Probe, a test voice." });
  await writeFile(join(bots, "probe", "agent.cordis.yml"),
    renderComposition({ soul: "You are Probe, a test voice.", allow: DEFAULT_ALLOW, plugin: PLUGIN_ABS }));

  const realFetch = globalThis.fetch;
  let dispose: (() => Promise<void>) | undefined;
  try {
    const recordDir = join(home, "readthrough");
    const booted = await bootFace({
      profileName: "face", port: 0, dshHome: home, botsRoot: bots,
      extraPatches: [{ id: "read-through-service", config: { recordDir } }],
    });
    const { ctx } = booted;
    dispose = booted.dispose;
    wireReadThrough(ctx, { quotes, root, now: () => Date.parse(AT) });
    mountClient(ctx);
    const base = `http://127.0.0.1:${ctx.webServer.port}`;
    const cookie = await signIn(ctx, base);

    const tools = ctx.get("tools") as Tools | undefined;
    assert.ok(tools !== undefined, "the tools service must be in the composed tree");
    const names = (schemas: { name: string }[]): string[] => schemas.map((s) => s.name).sort();
    const create = async (agentPreset?: string): Promise<Agent> => {
      const made = await remote<{ sessionId: string; agentPreset?: string }>(base, cookie, "session/create",
        { request: agentPreset === undefined ? { cwd: home } : { cwd: home, agentPreset } });
      assert.equal(made.agentPreset, agentPreset ?? "gravit");
      const agent = ctx.agents.get(SessionId(made.sessionId));
      assert.ok(agent !== undefined, `the ${agentPreset ?? "gravit"} session is live`);
      return agent;
    };
    let call = 0;
    const run = (args: unknown, agent: Agent) =>
      tools.execute({ callId: `readthrough-smoke-${call++}`, name: "read_through", arguments: args, agent, signal: new AbortController().signal });
    const textOf = (result: { content?: { text?: string }[] }): string => result.content?.[0]?.text ?? "";
    const answerOf = (result: { isError: boolean; content?: { text?: string }[] }) => {
      assert.equal(result.isError, false, `read_through answers; saw ${textOf(result)}`);
      return JSON.parse(textOf(result)) as { ok: boolean; id: string; block: string };
    };
    /** A refusal: an error result whose message starts `start` - the registry renders a thrown error `Error: <message>`. */
    const refusedWith = (result: { isError: boolean; content?: { text?: string }[] }, start: string): void => {
      assert.equal(result.isError, true, `refused ${start}; saw ${textOf(result)}`);
      assert.ok(textOf(result).startsWith(`Error: ${start}`), `the refusal starts ${start}; saw ${textOf(result)}`);
    };

    // 1. read_through registered; both rows active
    assert.ok(names(tools.schemas()).includes("read_through"), "read_through is registered");
    const listedRows = pluginListing(panelDeps(ctx, process.cwd(), home)).rows;
    for (const id of ["read-through-service", "read-through-tool"]) {
      const row = listedRows.find((r) => r.id.endsWith(`:${id}`));
      assert.ok(row, `${id} must be listed; saw ${listedRows.map((r) => r.id).join(", ")}`);
      assert.equal(row.phase, "active", id);
    }

    // 2. the desk sees it; a bot and the source reader do not; the conversation's allow list does not name it
    const desk = await create("gravit-desk");
    const deskTools = names(tools.schemas(desk));
    assert.ok(deskTools.includes("read_through"), `the desk's session sees read_through; saw ${deskTools.join(", ")}`);
    for (const preset of ["probe", "role-source-reader"]) {
      const seen = names(tools.schemas(await create(preset)));
      assert.equal(seen.includes("read_through"), false, `${preset} has no read_through; saw ${seen.join(", ")}`);
    }
    assert.equal(ROUTER_ALLOW.includes("read_through"), false, "ROUTER_ALLOW does not name read_through");
    const gravit = await create();

    /* from here on, every request this process makes is noted: none may be made */
    const requests: string[] = [];
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      requests.push(String(input instanceof Request ? input.url : input));
      return realFetch(input, init);
    }) as typeof fetch;

    // 3. a Gravit root session's call: priced, its event in the block, recorded as a task's
    const task = answerOf(await run(ARGS, gravit));
    assert.equal(task.ok, true);
    assert.match(task.id, ID_RE);
    assert.ok(task.block.split("\n")[1]!.startsWith("· 事件："), `a task's block names its event second; saw ${task.block}`);
    const record = createRecord(recordDir);
    const directions = async () => (await record.all()).filter((e: { kind: string }) => e.kind === "direction") as
      Array<{ id: string; caller: { kind: string } }>;
    assert.deepEqual((await directions()).map((d) => [d.id, d.caller.kind]), [[task.id, "task"]], "one direction line, a task's");

    // 4. the desk with no run open
    refusedWith(await run(ARGS, desk), "ALERT_ONLY");

    // 5. inside a run: accepted with no event line, closed with the run, given; a later run of the event refused
    const lane = readThroughLane(ctx);
    const deskId = String(desk.session.header.id);
    lane.open(deskId, { pass: "p-smoke", asks: [{ symbol: "NVDA", ref: REF, since: SINCE }] });
    const alert = answerOf(await run(ARGS, desk));
    assert.equal(alert.ok, true);
    assert.match(alert.id, ID_RE);
    assert.equal(alert.block.split("\n").some((line) => line.startsWith("· 事件：")), false, `an alert's block has no event line; saw ${alert.block}`);
    assert.deepEqual(lane.close(deskId), [{ id: alert.id, text: alert.block }], "the run closes with its one block");
    assert.equal(await lane.given("NVDA", REF), true, "the event is given");
    lane.open(deskId, { pass: "p-smoke-2", asks: [{ symbol: "NVDA", ref: REF, since: SINCE }] });
    refusedWith(await run(ARGS, desk), "ALREADY_GIVEN");
    assert.deepEqual(lane.close(deskId), [], "the refused call left no block");

    // 6. a rival outside the fence, refused by name
    refusedWith(await run({ ...ARGS, peers: [{ symbol: "NBIS", reason: "AI 云" }] }, gravit), "OUTSIDE_FENCE NBIS");

    // 7. US shares alone asked of the source; no request left the process
    assert.ok(asked.length > 0, "the source was asked");
    assert.deepEqual(asked.filter((a) => a.market !== "us"), [], "only US shares were asked for");
    assert.deepEqual(requests, [], "no request left the process: the dead market URL was never hit");
    assert.equal((await directions()).length, 2, "two directions recorded, the task's and the run's");
  } finally {
    globalThis.fetch = realFetch;
    await dispose?.();
  }
});
