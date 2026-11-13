// face/tests/analog-events-smoke.test.ts
/** The event analogs on a real boot (analogs spec §5.2, §6.5): the source reader's preset is listed whole, the running
 * registry lists `analog_events` and Gravit's view `role_source_reader`, and the two analog rows are listed active, with no `analog_chart` in the registry (withdrawn 2026-11-13); a
 * session created on `role-source-reader` sees exactly `web_fetch` and `web_search` - `web_fetch` in its own layer,
 * given by the face (src/source-reader.ts), proved here on the real tree; a Gravit session, a PDF page reader's and a
 * bot's see no `web_fetch`, the last two no analog tool either, and neither the conversation's allow list nor the
 * desk's names the reader's tools; through the real registry the reader's `web_fetch` reaches dsh's http provider,
 * which refuses a loopback address before any socket opens, until the fortieth page, after which the guard refuses
 * the next; `analog_events` for Gravit measures one event on a stub market and stores the view, its source counted
 * as verified only once the page record holds it; the view route serves the stored view with the cookie, refuses
 * another site's page and answers 404 for an id it does not hold; the reader cannot call `analog_events`; and the stub saw only `/api/candles` on `cboe`.
 *
 * ONE BOOT PER PROCESS (smoke.test.ts header): `bootFace` sets `process.env.DSH_HOME`, so this is its own file.
 * The scratch home is a `mkdtemp` directory, never `~/.dsh`; the Account seat
 * is disabled; `analog-views` is replaced by a row over a scratch views directory and the stub's origin; the stub is
 * an `http.createServer` on port 0 answering `/api/candles` from `fakeMarket` (analog-fixtures.ts) with `EVT`
 * (`EVENT`) and `SPY` (`EVENT_MARKET`); the boot's other market readers keep the dead URL `helpers/no-market.ts` sets.
 * The view route is registered here as `src/main.ts` registers it, and the page is mounted for the sign-in. The bots
 * root is a temp one holding one fixture bot, `probe`, on the template's allow list. No model is called and no page
 * is fetched: every `web_fetch` here asks for `http://127.0.0.1:9/probe`, which the provider refuses unopened.
 * Gated by FACE_SMOKE=1.
 * @module
 */
import "./helpers/no-market.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { SessionId } from "@deepseek-ai/dsh-session";
import { setupFaceProfile } from "../src/setup.ts";
import { bootFace } from "../src/boot.ts";
import { DEFAULT_ALLOW, createBot, renderComposition } from "../src/bots.ts";
import { isTrustedDataRequest } from "../src/http.ts";
import { registerAnalogViewRoute, type AnalogViewService } from "../src/analog-view.ts";
import { panelDeps, pluginListing } from "../src/panels.ts";
import { ROUTER_ALLOW } from "../src/router-preset.ts";
import { DESK_ALLOW } from "../src/desk-preset.ts";
import { SOURCE_READER_PAGES } from "../src/source-reader.ts";
import { EVENT, EVENT_MARKET, fakeMarket } from "./analog-fixtures.ts";
import { makeBotsRoot, PLUGIN_ABS } from "./bots-fixture.ts";
import { mountClient, remote, signIn } from "./remote.ts";

const gated = process.env.FACE_SMOKE !== "1";

/** The address every `web_fetch` here asks for: loopback, which dsh's http provider refuses before any socket opens. */
const PROBE = "http://127.0.0.1:9/probe";
/** The one event: `EVT`'s day 0 in `EVENT`, its source marked verified by the caller. */
const SOURCE = "https://example.com/a";
const EVENT_IN = { symbol: "EVT", label: "CEO out", group: "hired", date: "2020-04-10", timing: "pre", source: SOURCE, verified: true };

/** The slice of the booted `analogViews` service this smoke calls. */
interface AnalogViews extends AnalogViewService {
  notePage(url: string): void;
  pageOpened(url: string): boolean;
}

/** The slice of the booted `tools` service this smoke calls. */
interface Tools {
  schemas(scope?: object): { name: string }[];
  execute(exec: object): Promise<{ isError: boolean; content?: { text?: string }[] }>;
}

test("analog events smoke: the reader's two tools and their fences, and analog_events storing a view, on a real boot", {
  skip: gated && "set FACE_SMOKE=1", timeout: 120_000,
}, async () => {
  const market = fakeMarket({ EVT: { bars: EVENT }, SPY: { bars: EVENT_MARKET } });
  const seen: Array<{ method: string; path: string }> = [];
  const stub = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://stub");
    seen.push({ method: req.method ?? "", path: url.pathname });
    if (req.method !== "GET" || url.pathname !== "/api/candles") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false }));
      return;
    }
    void market.ask(Object.fromEntries(url.searchParams)).then(({ status, body }) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;

  const home = mkdtempSync(join(tmpdir(), "face-analog-events-smoke-"));
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

  let dispose: (() => Promise<void>) | undefined;
  let disposeView: (() => void) | undefined;
  try {
    const booted = await bootFace({
      profileName: "face", port: 0, dshHome: home, botsRoot: bots,
      extraPatches: [{ id: "analog-views", config: { viewsDir: join(home, "views"), market: origin } }],
    });
    const { ctx } = booted;
    dispose = booted.dispose;
    disposeView = registerAnalogViewRoute(ctx.webServer, {
      isTrusted: isTrustedDataRequest,
      views: () => ctx.get("analogViews") as AnalogViewService | undefined,
    });
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
    const run = (name: string, args: unknown, agent: Agent) =>
      tools.execute({ callId: `events-smoke-${call++}`, name, arguments: args, agent, signal: new AbortController().signal });
    const textOf = (result: { content?: { text?: string }[] }): string => result.content?.[0]?.text ?? "";

    // 1. the reader's preset whole; analog_events registered, role_source_reader in Gravit's view; the rows active
    const presets = ctx.get("agentPresets") as { list(): Promise<{ id: string; broken?: string }[]> };
    const roster = await presets.list();
    const readerPreset = roster.find((p) => p.id === "role-source-reader");
    assert.ok(readerPreset !== undefined, `role-source-reader must be listed; saw ${roster.map((p) => p.id).join(", ")}`);
    assert.equal(readerPreset.broken, undefined, "role-source-reader is listed whole");
    assert.ok(names(tools.schemas()).includes("analog_events"), "analog_events is registered");
    const gravit = await create();
    const gravitTools = names(tools.schemas(gravit));
    assert.ok(gravitTools.includes("role_source_reader"), `Gravit's view lists role_source_reader; saw ${gravitTools.join(", ")}`);
    const listedRows = pluginListing(panelDeps(ctx, process.cwd(), home)).rows;
    assert.equal(names(tools.schemas()).includes("analog_chart"), false, "the chart analog is withdrawn: no analog_chart is registered");
    for (const id of ["analog-views", "analog-events"]) {
      const row = listedRows.find((r) => r.id.endsWith(`:${id}`));
      assert.ok(row, `${id} must be listed; saw ${listedRows.map((r) => r.id).join(", ")}`);
      assert.equal(row.phase, "active", id);
    }

    // 2. a session on the reader's preset sees exactly the two web tools, web_fetch in its own layer
    const reader = await create("role-source-reader");
    /* the face equips the agent from its `agent/created` listener; the tool is in place by the time any turn runs */
    const deadline = Date.now() + 5_000;
    while (!names(tools.schemas(reader)).includes("web_fetch") && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(names(tools.schemas(reader)), ["web_fetch", "web_search"], "the reader sees web_fetch and web_search, nothing else");

    // 3. no other session sees web_fetch; the PDF reader and a bot see no analog tool; the allow lists name none
    assert.equal(gravitTools.includes("web_fetch"), false, "Gravit's session has no web_fetch");
    const pdfTools = names(tools.schemas(await create("role-pdf-page-reader")));
    const botTools = names(tools.schemas(await create("probe")));
    for (const [who, seen] of [["the PDF page reader", pdfTools], ["the fixture bot", botTools]] as const) {
      for (const name of ["web_fetch", "analog_events"]) {
        assert.equal(seen.includes(name), false, `${who} has no ${name}; saw ${seen.join(", ")}`);
      }
    }
    for (const name of ["web_fetch", "analog_events", "role_source_reader"]) {
      assert.equal(ROUTER_ALLOW.includes(name), false, `ROUTER_ALLOW does not name ${name}`);
      assert.equal(DESK_ALLOW.includes(name), false, `DESK_ALLOW does not name ${name}`);
    }
    assert.deepEqual(ROUTER_ALLOW.filter((name) => name.startsWith("analog_")), [], "no analog tool in the conversation's preset");
    assert.deepEqual(DESK_ALLOW.filter((name) => name.startsWith("analog_")), [], "no analog tool in the desk's preset");

    // 4. the reader's web_fetch through the real registry: the provider's refusal, forty times, then the budget's
    assert.equal(SOURCE_READER_PAGES, 40);
    for (let page = 1; page <= SOURCE_READER_PAGES; page += 1) {
      const fetched = await run("web_fetch", { url: PROBE }, reader);
      assert.equal(fetched.isError, true, `page ${page}: the provider refuses a loopback address`);
      assert.match(textOf(fetched), /non-public IP address/, `page ${page}: in the http provider's own words; saw ${textOf(fetched)}`);
    }
    const over = await run("web_fetch", { url: PROBE }, reader);
    assert.equal(over.isError, true, "the forty-first page is refused");
    assert.match(textOf(over), /at most 40 pages/, `by the reader's budget; saw ${textOf(over)}`);
    const gravitFetch = await run("web_fetch", { url: PROBE }, gravit);
    assert.equal(gravitFetch.isError, true, "Gravit's session has no web_fetch to call");
    assert.doesNotMatch(textOf(gravitFetch), /non-public IP address/, "and its call never reached the provider");

    // 5. analog_events for Gravit: one event and one anchor, each source verified only once the page record holds it
    const views = ctx.get("analogViews") as AnalogViews | undefined;
    assert.ok(views !== undefined, "analogViews must be provided");
    assert.equal(views.pageOpened(SOURCE), false, "the refused fetches noted no page");
    const anchor = { label: "first report", date: "2020-04-10", timing: "pre", source: SOURCE, verified: true };
    const ask = { title: "a CEO leaves", events: [EVENT_IN], query: { symbol: "EVT", anchors: [anchor] } };
    const answerOf = (result: { isError: boolean; content?: { text?: string }[] }) => {
      assert.equal(result.isError, false, `analog_events answers; saw ${textOf(result)}`);
      return JSON.parse(textOf(result)) as { ok: boolean; view: string; digest: string };
    };
    const unopened = answerOf(await run("analog_events", ask, gravit));
    assert.equal(unopened.ok, true);
    assert.match(unopened.digest.split("\n")[0]!, /0 verified, 1 unverified, 1 marked verified without an opened source/);
    views.notePage(SOURCE);
    const opened = answerOf(await run("analog_events", ask, gravit));
    assert.equal(opened.ok, true);
    assert.match(opened.digest.split("\n")[0]!, /1 verified, 0 unverified/);
    assert.doesNotMatch(opened.digest.split("\n")[0]!, /without an opened source/);

    // 6. the route serves the stored view with the cookie, and refuses another site's page
    const res = await fetch(`${base}/data/analog/view?id=${opened.view}`, { headers: { cookie } });
    assert.equal(res.status, 200);
    type Checked = { source: string | null; claimed: boolean; opened: boolean; verified: boolean; flags: string[] };
    const body = await res.json() as { ok: boolean; view: { kind: string; cases: { state: string }[]; query: { anchors: Checked[] } } };
    assert.equal(body.ok, true);
    assert.equal(body.view.kind, "events");
    const [read] = body.view.query.anchors;
    assert.deepEqual([read!.source, read!.claimed, read!.opened, read!.verified, read!.flags.includes("unopened")], [SOURCE, true, true, true, false],
      "the present case's anchor, its source opened by a reader, reads back verified");
    assert.equal(body.view.cases.filter((c) => c.state === "measured").length, 1, "one measured case");
    assert.equal(body.view.cases.length, 1);
    const foreign = await fetch(`${base}/data/analog/view?id=${opened.view}`, { headers: { origin: "http://evil.example.com" } });
    assert.equal(foreign.status, 403, "from another site's page the fence refuses");
    await foreign.arrayBuffer();
    const unknown = await fetch(`${base}/data/analog/view?id=an-20200101-00000000`, { headers: { cookie } });
    assert.equal(unknown.status, 404, "an id the store does not hold");
    await unknown.arrayBuffer();

    // 7. the reader cannot call analog_events; the stub saw only GET /api/candles on cboe
    const readerEvents = await run("analog_events", ask, reader);
    assert.equal(readerEvents.isError, true, "analog_events is not in the reader's view");
    assert.doesNotMatch(textOf(readerEvents), /NOT_GRAVIT/, `refused before the tool ran; saw ${textOf(readerEvents)}`);
    assert.ok(seen.length > 0, "the stub must have been read");
    assert.deepEqual(seen.filter((s) => s.method !== "GET" || s.path !== "/api/candles"), []);
    assert.deepEqual(market.calls.filter((q) => q.venue !== "cboe"), []);
  } finally {
    disposeView?.();
    await dispose?.();
    await new Promise<void>((resolve) => stub.close(() => resolve()));
  }
});
