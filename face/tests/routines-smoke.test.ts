// face/tests/routines-smoke.test.ts
/** One routine's run end to end on a REAL composed tree (docs/superpowers/plans/2026-11-14-desk-page-2-routines-
 * engine.md, Task 8): the desk as main.ts installs it - `installDesk` with its conversation and its clock rows -, whose
 * routines' clock row (src/routine-clock.ts) runs a routine at its slot in a fresh, supervised desk session
 * (src/routine-run.ts). One boot, on Monday 2026-11-16, and one run:
 * 1. the store (`routines.json`) is written through src/routines.ts's acts - a proposal, then its confirmation - at
 *    08:00 ET, before the routine's one slot, 09:30 ET every day, so no market calendar decides it;
 * 2. a tick at 09:30:10 ET queues the slot and runs it: one fresh `gravit-desk` session in `desk/journal`, woken by a
 *    message whose source is `routine`, which sees `desk_headlines` among its tools - and the market row's two reads,
 *    `mcp__market__market_explore` and `mcp__market__market_candles`, whenever this boot mounts that row;
 * 3. the stub answers a headline and a report: `routines.jsonl` holds the run's `started`, `finished` (`ended`, the
 *    headline, reported) and `report`; `events.jsonl` holds its `desk-turn` with `source: "routine"` - what the daily
 *    cap counts, and what no unit test could show of the real supervisor; `GET /data/desk/routines` shows the run
 *    Succeeded with the headline as its note; `GET /data/desk/news` shows the report under the routine;
 * 4. the report's line reaches Gravit's one conversation: the desk is installed with `router: true` and bound to a
 *    recording stand-in of that conversation (src/phone-bridge.ts `PhoneConversation`), whose `note` receives one
 *    `{ kind: "routine", … }` line - and src/conversation.ts `noteMessage` gives it the id `note-routine:<key>`. The
 *    real conversation's injection of that id is tests/conversation.test.ts's; binding it here would boot the whole
 *    router for one line.
 *
 * WHAT STANDS IN. The model is a stub on `stub/echo`, the tree's default route and so the desk's; its every reply
 * reports all four token buckets, as in tests/schedule-smoke.test.ts, and it answers the routine's wake - the last
 * message whose `source.kind` is `routine` - with the report. The clock rows run on a WallClock (tests/desk-fakes.ts)
 * that moves only when told, over fake calendars; the standing orders' tick is a day and no standing order is armed;
 * the routines' clock ticks only when the test calls its `tick()`. The desk's `now` is the same clock, so News reads
 * its seven days from the fixture's Monday. AKShare is off, the market a dead port (helpers/no-market.ts); the quote
 * source is a fake that nothing asks. No phone is connected, and a routine never sends to one. Nothing leaves the
 * machine.
 *
 * WHERE IT RUNS. `tests/tmp/routines-smoke-<pid>/`, inside the repository and without a `.git` of its own, as
 * tests/desk-smoke.test.ts explains: `root/` (the journal the face makes), `home/`, `bots/`. Everything from the
 * fixture's making on runs inside the test's `try`; its cleanup runs each step whatever the one before it did - the
 * desk, the face, the fixture.
 *
 * Own file, gated: one boot per process (smoke.test.ts).
 * @module
 */
import "./helpers/no-market.ts";
import "./helpers/no-memory.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { Context } from "@deepseek-ai/cordis";
import { installModelSelection } from "@deepseek-ai/dsh-agent";
import type { GenerateOptions, StreamChunk } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import { bootFace, type BootedFace } from "../src/boot.ts";
import { noteMessage, type DeskLine } from "../src/conversation.ts";
import { installDesk, readEvents, readRecords, type DeskEvent, type DeskHandle } from "../src/desk.ts";
import type { DeskConversationCtxLike } from "../src/desk-conversation.ts";
import type { DeskNews } from "../src/desk-news.ts";
import { DESK_ALLOW } from "../src/desk-preset.ts";
import type { DeskSessionDeps } from "../src/desk-session.ts";
import type { MarketSession } from "../src/market-clock.ts";
import type { PhoneConversation } from "../src/phone-bridge.ts";
import type { RoutinesStatus } from "../src/routine-clock.ts";
import { isRunRecord, type RoutineRunRecord } from "../src/routine-run.ts";
import { routineOps, ROUTINES_LEDGER } from "../src/routines.ts";
import { setupFaceProfile } from "../src/setup.ts";
import { bjDate } from "../src/et.ts";
import { expandAllow } from "../plugins/bot.js";
import { GRAVIT_PLUGIN_ABS, populateBotsRoot } from "./bots-fixture.ts";
import { fakeCalendar, WallClock } from "./desk-fakes.ts";
import { boundPort } from "./remote.ts";
import { StubAdapter, type StubReply } from "./stub-llm.ts";
import { unwind } from "./unwind.ts";

const gated = process.env.FACE_SMOKE !== "1";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = join(HERE, "tmp", `routines-smoke-${process.pid}`);
const ROOT = join(BASE, "root");
const HOME = join(BASE, "home");
const BOTS = join(BASE, "bots");
const STUB = { provider: "stub", model: "echo" };

/** The one day: a Monday, open 09:30 ET to 16:00 ET in New York, and in Beijing a session of its own. */
const DATE = "2026-11-16";
const SESSION: MarketSession = { date: DATE, open: "2026-11-16T14:30:00Z", close: "2026-11-16T21:00:00Z", early: false };
const CN_SESSION: MarketSession = { date: DATE, open: "2026-11-16T01:30:00Z", close: "2026-11-16T07:00:00Z", early: false };
/** When the face boots and the routine is confirmed: 08:00 ET. */
const BOOT_AT = "2026-11-16T13:00:00Z";
/** The routine's slot, 09:30 ET, and the tick ten seconds after it - inside the 5-minute grace. */
const SLOT = "09:30";
const SLOT_AT = "2026-11-16T14:30:00.000Z";
const TICK_AT = "2026-11-16T14:30:10Z";
/** The standing orders' tick: a day, so no timer ticks inside the file. */
const TICK_MS = 86_400_000;

/** The routine as the operator confirmed it. */
const NAME = "Morning movers";
const INSTRUCTION = "Read the pre-market movers among the book's names and report any idea worth a look.";
/** The stub's answer: a headline, a blank line, the report. */
const HEADLINE = "1 idea: long AMD";
const BODY = "AMD +3.1% pre-market on the MI400 order (Reuters, 09:12 ET).\nNVDA flat (market row, 09:29 ET).";
const ANSWER = `${HEADLINE}\n\n${BODY}`;

/** The market row's two reads in the desk's mask: present in the tree only when this boot mounts that row. */
const MARKET_READS = ["mcp__market__market_explore", "mcp__market__market_candles"] as const;

/* ---------- the model ---------- */

/** What every stub reply reports, as the provider would: four buckets, disjoint, no total. */
const USAGE = { inputTokens: 40, outputTokens: 6, cacheReadTokens: 30, cacheWriteTokens: 4 } as const;

/** The shared stub, every reply carrying {@link USAGE} instead of the stub's two buckets. */
class MeteredStub extends StubAdapter {
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    for await (const chunk of super.stream(options)) {
      if (chunk.type === "usage") continue;
      if (chunk.type === "finish") yield { type: "usage", usage: { ...USAGE } };
      yield chunk;
    }
  }
}

type Message = GenerateOptions["messages"][number];
const sourceOf = (m: Message): Record<string, unknown> => (m.source ?? {}) as Record<string, unknown>;
const textOf = (m: Message): string => m.content.map((b) => ("text" in b ? b.text : "")).join("\n");
/** The routine's wake a request answers: the last message whose source is `routine`. */
const wakeOf = (r: GenerateOptions): Message | undefined => [...r.messages].reverse().find((m) => sourceOf(m).kind === "routine");

async function waitFor(what: string, check: () => boolean | Promise<boolean>, ms = 30_000): Promise<void> {
  const until = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

type DeskTurnEvent = Extract<DeskEvent, { kind: "desk-turn" }>;

test("routines smoke: a routine confirmed in the store runs at its slot on a real boot, its report reaching the ledger, the page, News and the conversation", {
  skip: gated && "set FACE_SMOKE=1", timeout: 240_000,
}, async () => {
  let booted: BootedFace | undefined;
  let desk: DeskHandle | undefined;
  let passed = false;
  /** Every line the desk logged: the test's own sink, printed on a failure. */
  const faceLog: string[] = [];
  try {
    /* ---------- the fixture ---------- */
    await rm(BASE, { recursive: true, force: true });
    await mkdir(ROOT, { recursive: true });
    await mkdir(BOTS, { recursive: true });
    await populateBotsRoot(BOTS, GRAVIT_PLUGIN_ABS);
    setupFaceProfile(HOME);
    const patchPath = join(HOME, "profiles", "face", "cordis.patch.yml");
    const patch = readFileSync(patchPath, "utf8").replace(/^\[\][ \t]*$/m, "");
    writeFileSync(patchPath, [
      patch,
      // This smoke owns a scratch profile: never the operator's data server, never a real model.
      "- id: mcp-akshare",
      "  disabled: true",
      "- id: agent-default-model",
      "  config:",
      `    provider: ${STUB.provider}`,
      `    model: ${STUB.model}`,
      "",
    ].join("\n"));

    /* ---------- 1. THE STORE: proposed and confirmed at 08:00 ET, before the slot ---------- */
    const clock = new WallClock(BOOT_AT);
    const ops = routineOps({ home: HOME, now: () => clock.now() });
    const proposal = await ops.propose({
      name: NAME, schedule: { days: "daily", times: [SLOT] }, instruction: INSTRUCTION, origin: { kind: "web" },
    });
    const { routine } = await ops.confirm(proposal.id);
    assert.equal(routine.confirmedAt, new Date(BOOT_AT).toISOString(), "confirmed at the clock's 08:00 ET");
    assert.equal(routine.enabled, true, "a new routine is on");
    const KEY = `${routine.id}:${DATE}:${SLOT}`;

    booted = await bootFace({ profileName: "face", port: 0, dshHome: HOME, botsRoot: BOTS });
    const { ctx } = booted;
    const base = `http://127.0.0.1:${boundPort(ctx)}`;

    /* Every agent the tree creates. */
    const created: string[] = [];
    ctx.on("agent/created", ({ agent }) => {
      created.push(String(agent.id));
      return undefined;
    });

    /* The model: every request kept by session; the routine's wake answered with the report. A session's first
     * request also notes the session as it runs the turn: its preset, its cwd and its permission. */
    const requests = new Map<string, GenerateOptions[]>();
    const views = new Map<string, { preset?: string; cwd?: string; permission: unknown }>();
    const script = (r: GenerateOptions): StubReply => {
      if (r.purpose !== undefined) return { kind: "text", text: "routines smoke" }; // titles, compaction
      const id = String(r.sessionId);
      const seen = requests.get(id) ?? [];
      seen.push(r);
      requests.set(id, seen);
      if (seen.length === 1) {
        const agent = ctx.agents.get(SessionId(id));
        if (agent !== undefined) {
          const { header } = agent.session;
          views.set(id, { preset: header.agentPreset, cwd: header.cwd, permission: ctx.permissionPresets.current(agent.session) });
        }
      }
      return wakeOf(r) === undefined ? { kind: "text", text: "noted" } : { kind: "text", text: ANSWER };
    };
    ctx.llm.registerAdapter([STUB.provider], new MeteredStub(script));

    /* The desk, as main.ts installs it with the one conversation coming, and the clock rows' seams: the WallClock at
     * 08:00 ET, a day-long standing-orders tick, the fake calendars; its `now` the same clock. */
    const sessionCtx = ctx as unknown as DeskConversationCtxLike;
    const install: NonNullable<DeskSessionDeps["installModelSelection"]> = (agentCtx, ref) => installModelSelection(agentCtx as unknown as Context, ref);
    const calendar = fakeCalendar({ [DATE]: SESSION });
    const cn = fakeCalendar({ [DATE]: CN_SESSION }, "fake XSHG", (n) => bjDate(new Date(n)));
    desk = installDesk(ctx.webServer, {
      home: HOME, enabled: true, root: ROOT, route: STUB, sessionCtx, installModelSelection: install, ctx,
      now: () => clock.now(),
      router: true,
      quotes: { snapshot: async () => ({ ok: true, generated_at: new Date(clock.now()).toISOString(), quotes: [], providers: [] }) },
      schedule: { clock, calendar, calendars: { cn }, tickMs: TICK_MS },
      log: (line) => { faceLog.push(line); },
    });
    /* Gravit's one conversation, as a recorder of what the desk notes into it. */
    const notes: DeskLine[] = [];
    const oneConversation: PhoneConversation = {
      post: async () => { throw new Error("routines smoke: nothing posts to the conversation"); },
      stop: async () => false,
      carry: async () => {},
      note: (line) => { notes.push(line); },
      status: async () => ({ running: 0, waiting: 0 }),
    };
    desk.bindRouter(oneConversation);
    const routines = await desk.routines;
    assert.ok(routines !== undefined, "with the conversation and the schedule, the routines' clock row runs");

    /* ---------- the file's helpers ---------- */
    const runRecords = async (): Promise<RoutineRunRecord[]> =>
      (await readRecords(HOME, ROUTINES_LEDGER, isRunRecord)).records.filter((r) => "key" in r && r.key === KEY);
    const get = async <T>(path: string): Promise<T> => {
      const res = await fetch(`${base}${path}`);
      assert.equal(res.status, 200, `GET ${path}`);
      return (await res.json()) as T;
    };

    /* The boot ticks - the standing orders' and the routines' - at 08:00 ET: nothing due yet. */
    await clock.advance(0);
    assert.deepEqual(await runRecords(), [], "before its slot, the routine has no run");
    const before = await get<RoutinesStatus>("/data/desk/routines");
    assert.deepEqual(before.load, { ok: true }, "the page reads the store");
    assert.deepEqual(before.routines.map((r) => [r.id, r.name, r.enabled, r.next?.slot, r.runs.length]), [[routine.id, NAME, true, SLOT, 0]],
      "the routine is listed, on, its next slot 09:30 ET, no runs");

    /* ---------- 2. THE RUN: a tick inside the slot's grace ---------- */
    const at = created.length;
    clock.set(TICK_AT);
    await routines.tick();
    await waitFor("the run's report record", async () => (await runRecords()).some((r) => r.kind === "report"));
    await waitFor("the clock row to let go of the run", async () => {
      const status = await routines.status();
      return status.running === undefined && status.queued.length === 0;
    });
    const records = await runRecords();
    assert.deepEqual(records.map((r) => r.kind), ["started", "finished", "report"], "routines.jsonl: the run's started, finished and report, in order");
    const [started, finished, report] = records as [
      Extract<RoutineRunRecord, { kind: "started" }>, Extract<RoutineRunRecord, { kind: "finished" }>, Extract<RoutineRunRecord, { kind: "report" }>,
    ];
    assert.deepEqual([started.routine, started.name, started.sha256, started.date, started.slot, started.at, started.test],
      [routine.id, NAME, routine.sha256, DATE, SLOT, SLOT_AT, undefined], "started: the routine's version, the slot, no test");
    assert.equal(started.t, new Date(TICK_AT).toISOString(), "started at the tick, inside the grace");
    assert.deepEqual([finished.outcome, finished.headline, finished.reported, finished.error], ["ended", HEADLINE, true, undefined],
      `finished: ended, the headline, reported; saw ${JSON.stringify(finished)}`);
    assert.deepEqual([report.routine, report.name, report.headline, report.body], [routine.id, NAME, HEADLINE, BODY], "report: the headline and the body");

    /* the session: one fresh desk agent in the journal, its first request the routine's wake */
    const runId = finished.sessionId;
    assert.ok(runId !== undefined, "the finished record names the run's session");
    assert.deepEqual(created.slice(at), [runId], "one fresh session, the run's");
    const view = views.get(runId);
    assert.ok(view !== undefined, "the run's session reached the model");
    assert.deepEqual([view.preset, view.permission, relative(ROOT, view.cwd ?? "")], ["gravit-desk", "workspace-write", join("desk", "journal")],
      "a gravit-desk session, workspace-write, in desk/journal");
    const first = requests.get(runId)?.[0];
    assert.ok(first !== undefined);
    const wake = wakeOf(first);
    assert.ok(wake !== undefined, "its first request answers a message whose source is routine");
    assert.deepEqual(sourceOf(wake), { kind: "routine", routine: routine.id, slot: SLOT, date: DATE }, "the wake's source names the routine, the slot and the date");
    const wakeText = textOf(wake);
    assert.equal(wakeText.split("\n")[0], `[routine · ${NAME} · ${DATE} ${SLOT} ET]`, "the wake opens with its provenance line");
    assert.ok(wakeText.includes(`\n${INSTRUCTION}\n`), "and carries the instruction as confirmed");

    /* the tools it saw: desk_headlines always; the market row's two reads when this boot mounts that row */
    const offered = (first.tools ?? []).map((t) => t.name);
    assert.ok(offered.includes("desk_headlines"), `the run sees desk_headlines; saw ${JSON.stringify(offered)}`);
    const tools = ctx.get("tools") as { schemas(agent?: unknown): { name: string }[] };
    const known = new Set(tools.schemas().map((s) => s.name));
    const marketMounted = MARKET_READS.every((name) => known.has(name));
    if (marketMounted) {
      for (const name of MARKET_READS) assert.ok(offered.includes(name), `the market row is mounted, so the run sees ${name}`);
      assert.deepEqual(expandAllow([...MARKET_READS], known).missing, [], "the desk's mask names both, and both are in this tree");
    }
    console.log(`routines smoke: the market row's two reads are ${marketMounted ? "mounted, and the run saw both" : "not in this tree; asserted desk_headlines alone"}`);
    assert.ok(MARKET_READS.every((name) => DESK_ALLOW.includes(name)), "the desk's mask names the market row's two reads");

    /* ---------- 3. THE COUNT: the desk-turn the real supervisor wrote carries source "routine" ---------- */
    const turns = (await readEvents(HOME)).events.filter((e): e is DeskTurnEvent => e.kind === "desk-turn" && e.sessionId === runId);
    assert.deepEqual(turns.map((e) => [e.source, e.outcome]), [["routine", "ended"]], "events.jsonl: one desk-turn, its source routine - what the daily cap counts");
    const spent = USAGE.inputTokens + USAGE.outputTokens + USAGE.cacheReadTokens + USAGE.cacheWriteTokens;
    assert.deepEqual(finished.usage && [finished.usage.uncachedInputTokens, finished.usage.outputTokens, finished.usage.cacheReadTokens, finished.usage.cacheWriteTokens],
      [USAGE.inputTokens, USAGE.outputTokens, USAGE.cacheReadTokens, USAGE.cacheWriteTokens], "the finished record keeps the turn's one model call's tokens");

    /* ---------- 4. THE PAGE AND NEWS ---------- */
    const after = await get<RoutinesStatus>("/data/desk/routines");
    const listed = after.routines.find((r) => r.id === routine.id);
    assert.ok(listed !== undefined);
    assert.deepEqual(listed.runs.map((r) => [r.key, r.status, r.note, r.sessionId]), [[KEY, "succeeded", HEADLINE, runId]],
      "GET /data/desk/routines: the run Succeeded, its note the headline");
    assert.deepEqual(after.cap, { dailyTokens: 10_000_000, used: spent, spent: false }, "the day's cap, the run's tokens counted against it");
    const news = await get<{ ok: true } & DeskNews>("/data/desk/news");
    assert.equal(news.reports.total, 1, "GET /data/desk/news: one report");
    assert.deepEqual(news.reports.groups.map((g) => [g.routine, g.latest.key, g.latest.headline, g.latest.body, g.earlier.length]),
      [[{ id: routine.id, name: NAME }, KEY, HEADLINE, BODY, 0]], "under the routine, the report");

    /* ---------- 5. THE CONVERSATION: the report's one line ---------- */
    assert.equal(notes.length, 1, `one line noted into the conversation; saw ${JSON.stringify(notes)}`);
    const [line] = notes;
    assert.deepEqual(line, { kind: "routine", routine: routine.id, name: NAME, key: KEY, date: DATE, text: ANSWER }, "the routine's line: its key, its headline and report");
    const message = noteMessage(line!, "NONCE");
    assert.equal(message?.id, `note-routine:${KEY}`, "which the conversation injects under note-routine:<key>");
    assert.ok(message?.text.startsWith(`[routine · ${NAME} · ${DATE}]\n<<<desk-data NONCE>>>`), `fenced as data; saw ${JSON.stringify(message?.text)}`);

    assert.deepEqual(faceLog.filter((l) => /routine/.test(l)), [], `the desk logged no routine failure; saw ${JSON.stringify(faceLog)}`);
    passed = true;
  } finally {
    if (!passed && faceLog.length > 0) console.error(`routines smoke: the desk's log -\n${faceLog.join("\n")}`);
    await unwind("routines smoke", passed, [
      ["the desk", () => desk?.dispose(0)],
      ["the face", () => booted?.dispose()],
      ["the fixture", () => rm(BASE, { recursive: true, force: true })],
    ]);
  }
});
