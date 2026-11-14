// face/tests/routine-propose-smoke.test.ts
/** A routine from a message to its first run on a REAL composed tree (docs/superpowers/plans/2026-11-14-desk-page-3-
 * routines-from-messages.md, Task 4): the desk as main.ts installs it - `installDesk` with its clock rows, before the
 * conversation -, then Gravit's one conversation and its tasks (src/tasks.ts `installRouter` over src/conversation.ts
 * `installConversation` and `installTasks`, given `home`, so the conversation carries src/routine-tools.ts's two tools),
 * the desk bound to it. One boot, on Monday 2026-11-16 by the injected clock:
 * 1. an operator prompt over the browser's Remote wire has the stub call `routine_propose` - a daily 09:30 ET schedule, so
 *    no market calendar decides it -; the tool answers `{ ok, proposal, when, runsPerDay }` with the face's when line,
 *    and `routines.json` holds one pending proposal, from the web, and no routine;
 * 2. `GET /data/desk/routines` lists the proposal pending; `POST /data/desk/routines/confirm { proposal }` - the card's
 *    ✓, the real route - at 08:00 ET, before the slot, makes the routine;
 * 3. the injected clock reaches 09:30:10 ET and the routines' clock row ticks: one run, `started`, `finished` (ended,
 *    the headline) and `report` in `routines.jsonl`; `GET /data/desk/routines` shows the routine with its run Succeeded
 *    and the proposal confirmed and current;
 * 4. a turn the operator's message did not open - a task's report relayed into the conversation (an operator prompt has
 *    the stub call `task_start`, the worker calls `task_report` ready) - in which the stub calls `routine_propose`: the
 *    tool answers the operator-only refusal (src/task-tools.ts `OPERATOR_ONLY`) and the store still holds one proposal.
 *
 * WHERE IT RUNS. Two `mkdtemp` directories under the system's temp directory, as tests/router-smoke.test.ts's are, not
 * under tests/tmp: the conversation's folder sits in the harness home and its fence refuses every turn under a `.git`
 * (tests/tmp is inside this checkout). The home; the repository root, with a `.git` of its own and `strategies/fx`, under
 * which the desk's journal and the task's worker run. The bots root is tests/bots-fixture.ts's `makeBotsRoot`. All three
 * are removed in `after`.
 *
 * WHAT STANDS IN. The model is the shared stub on `stub/echo`, the tree's default route and so the conversation's, the
 * workers' and the desk's, every reply reporting all four token buckets (as tests/routines-smoke.test.ts's, which the
 * run's usage needs); it is scripted per session by its preset: the conversation (`gravit-router`), a desk run
 * (`gravit-desk`, answering the routine's wake with a headline and a report) and the worker (`parentSession` the
 * conversation). The clock rows run on a WallClock (tests/desk-fakes.ts) that moves only when told, over fake calendars;
 * the standing orders' tick is a day and no standing order is armed; the routines' clock ticks only when the test calls
 * its `tick()`. The desk's `now` is that clock, so the confirm is timed at 08:00 ET; the conversation's tools time a
 * proposal by the wall clock, earlier than the injected Monday, which no expiry minds. AKShare and the Account seat are
 * off, the market a dead port (helpers/no-market.ts); the quote source is a fake nothing asks. No phone is connected.
 *
 * Own file, gated: FACE_SMOKE=1. The two tests share one boot, in order.
 * @module
 */
import "./helpers/no-market.ts";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import { installModelSelection } from "@deepseek-ai/dsh-agent";
import type { GenerateOptions, StreamChunk } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import { bootFace, type BootedFace } from "../src/boot.ts";
import { installConversation, type ConversationCtxLike, type ConversationHandle } from "../src/conversation.ts";
import { claimsOf, installDesk, readRecords, type DeskHandle } from "../src/desk.ts";
import type { DeskConversationCtxLike } from "../src/desk-conversation.ts";
import { CONVERSATION_PRESET, DESK_PRESET } from "../src/desk-names.ts";
import type { DeskSessionDeps } from "../src/desk-session.ts";
import { isTrustedDataRequest } from "../src/http.ts";
import type { MarketSession } from "../src/market-clock.ts";
import type { RoutineClock, RoutinesStatus } from "../src/routine-clock.ts";
import { isRunRecord, type RoutineRunRecord } from "../src/routine-run.ts";
import { runsPerDay, whenText, type RoutineSchedule } from "../src/routine-schedule.ts";
import { loadRoutines, ROUTINES_LEDGER, type Routine } from "../src/routines.ts";
import { setupFaceProfile } from "../src/setup.ts";
import { OPERATOR_ONLY } from "../src/task-tools.ts";
import { installRouter, installTasks, phoneConversation, type TasksCtxLike, type TasksHandle } from "../src/tasks.ts";
import { rosterBots } from "../src/task-worker.ts";
import { listBots } from "../src/bots.ts";
import { bjDate } from "../src/et.ts";
import { makeBotsRoot } from "./bots-fixture.ts";
import { fakeCalendar, WallClock } from "./desk-fakes.ts";
import { mountClient, remote, signIn } from "./remote.ts";
import { StubAdapter, type StubReply } from "./stub-llm.ts";

const gated = process.env.FACE_SMOKE !== "1";
const skip = gated && "set FACE_SMOKE=1";
const STUB = { provider: "stub", model: "echo" };

/** The one day: a Monday, open 09:30 ET to 16:00 ET in New York, and in Beijing a session of its own. */
const DATE = "2026-11-16";
const SESSION: MarketSession = { date: DATE, open: "2026-11-16T14:30:00Z", close: "2026-11-16T21:00:00Z", early: false };
const CN_SESSION: MarketSession = { date: DATE, open: "2026-11-16T01:30:00Z", close: "2026-11-16T07:00:00Z", early: false };
/** When the face boots and the card is confirmed: 08:00 ET. */
const BOOT_AT = "2026-11-16T13:00:00Z";
/** The routine's slot, 09:30 ET, and the tick ten seconds after it - inside the 5-minute grace. */
const SLOT = "09:30";
const SLOT_AT = "2026-11-16T14:30:00.000Z";
const TICK_AT = "2026-11-16T14:30:10Z";
/** The standing orders' tick: a day, so no timer ticks inside the file. */
const TICK_MS = 86_400_000;

/** The operator's prompt that has the conversation propose the routine, and the call the stub makes. */
const PROPOSE = "PROPOSE_ROUTINE";
const NAME = "Idea screening";
const SCHEDULE: RoutineSchedule = { days: "daily", times: [SLOT] };
const INSTRUCTION = "Read quotes and headlines and screen for trade ideas. Place no orders.";
/** The operator's prompt that has the conversation start a task, and what its worker reports. */
const START = "START_TASK_FX";
const TITLE = "FX probe";
const REPORT = "REPORT_FX: the fixture strategy holds nothing yet.";
/** The run's answer: a headline, a blank line, the report. */
const HEADLINE = "1 idea: long AMD";
const BODY = "AMD +3.1% pre-market on the MI400 order (Reuters, 09:12 ET).";
const ANSWER = `${HEADLINE}\n\n${BODY}`;

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
type Ev = { type: string; data?: unknown };
const sourceOf = (m: { source?: unknown }): Record<string, unknown> => (m.source ?? {}) as Record<string, unknown>;
const textOf = (m: Message): string => m.content.map((b) => ("text" in b ? b.text : "")).join("\n");

/** The last message a person or the task machinery sent in a request, and how many tool results came after it. */
function trigger(r: GenerateOptions): { message?: Message; results: number } {
  for (let i = r.messages.length - 1; i >= 0; i--) {
    const kind = sourceOf(r.messages[i]!).kind;
    if (kind === "user" || kind === "task" || kind === "telegram") {
      return { message: r.messages[i], results: r.messages.slice(i + 1).filter((m) => sourceOf(m).kind === "tool").length };
    }
  }
  return { results: 0 };
}

async function waitFor(what: string, check: () => boolean | Promise<boolean>, ms = 30_000): Promise<void> {
  const until = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

/** The face as this file holds it. */
interface Face {
  booted: BootedFace;
  desk: DeskHandle;
  routines: RoutineClock;
  conversation: ConversationHandle;
  tasks: TasksHandle;
  sessionId: string;
  base: string;
  cookie: string;
  clock: WallClock;
  lines: string[];
}

const made: string[] = [];
let home = "";
let root = "";
let face: Face | undefined;
/** The routine the first test confirmed, for the second. */
let confirmed: Routine | undefined;

after(async () => {
  const held = face;
  face = undefined;
  if (held !== undefined) {
    await held.desk.quiesce();
    await held.tasks.dispose();
    await held.conversation.dispose();
    await held.desk.dispose(0);
    await held.booted.dispose();
  }
  await Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Boot the face on {@link home}; install the desk, then the conversation and its tasks, as main.ts does. */
async function boot(bots: string): Promise<Face> {
  const booted = await bootFace({ profileName: "face", port: 0, dshHome: home, botsRoot: bots });
  const { ctx } = booted;
  const script = (r: GenerateOptions): StubReply => {
    if (r.purpose !== undefined) return { kind: "text", text: "routine propose smoke" }; // titles, compaction
    const header = ctx.sessions.get(r.sessionId!)?.header;
    if (header?.agentPreset === DESK_PRESET) {
      /* a routine's run: the wake is the last message whose source is `routine` */
      const wake = [...r.messages].reverse().find((m) => sourceOf(m).kind === "routine");
      return { kind: "text", text: wake === undefined ? "noted" : ANSWER };
    }
    const { message, results } = trigger(r);
    const kind = message === undefined ? undefined : sourceOf(message).kind;
    if (header?.agentPreset === CONVERSATION_PRESET) {
      if (kind === "user" && textOf(message!).includes(PROPOSE)) {
        return results === 0
          ? { kind: "tool", name: "routine_propose", args: { name: NAME, schedule: SCHEDULE, instruction: INSTRUCTION } }
          : { kind: "text", text: "I've drafted the routine." };
      }
      if (kind === "user" && textOf(message!).includes(START)) {
        return results === 0 ? { kind: "tool", name: "task_start", args: { title: TITLE, brief: "BRIEF_FX: report.", strategy: "fx" } } : { kind: "text", text: "STARTED" };
      }
      if (kind === "task") {
        /* a relay's turn is not the operator's: this proposal must be refused */
        return results === 0
          ? { kind: "tool", name: "routine_propose", args: { name: "From a relay", schedule: SCHEDULE, instruction: "must not be stored" } }
          : { kind: "text", text: "RELAYED" };
      }
      return { kind: "text", text: "OK" };
    }
    if (header?.parentSession !== undefined && kind === "task") {
      return results === 0 ? { kind: "tool", name: "task_report", args: { status: "ready", text: REPORT } } : { kind: "text", text: "WORKER_DONE" };
    }
    return { kind: "text", text: "OK" };
  };
  ctx.llm.registerAdapter([STUB.provider], new MeteredStub(script));
  const lines: string[] = [];
  const log = (line: string): void => { lines.push(line); };
  const install: NonNullable<DeskSessionDeps["installModelSelection"]> = (agentCtx, ref) => installModelSelection(agentCtx as unknown as Context, ref);

  /* the desk, as main.ts installs it before the conversation, with the clock rows' seams */
  const clock = new WallClock(BOOT_AT);
  const calendar = fakeCalendar({ [DATE]: SESSION });
  const cn = fakeCalendar({ [DATE]: CN_SESSION }, "fake XSHG", (n) => bjDate(new Date(n)));
  const desk = installDesk(ctx.webServer, {
    home, enabled: true, root, route: STUB, sessionCtx: ctx as unknown as DeskConversationCtxLike, installModelSelection: install, ctx,
    now: () => clock.now(),
    router: true,
    quotes: { snapshot: async () => ({ ok: true, generated_at: new Date(clock.now()).toISOString(), quotes: [], providers: [] }) },
    schedule: { clock, calendar, calendars: { cn }, tickMs: TICK_MS },
    log,
  });
  const deskConversation = desk.conversation;
  const router = await installRouter({
    conversation: () => installConversation({
      ctx: ctx as unknown as ConversationCtxLike, home, route: STUB, installModelSelection: install, log,
      ...(deskConversation === undefined ? {} : { deliver: (text, opts) => deskConversation.deliver(text, opts) }),
      onClaimed: claimsOf(ctx),
    }),
    tasks: (held) => installTasks(ctx.webServer, {
      ctx: ctx as unknown as TasksCtxLike, root, route: STUB, installModelSelection: install, conversation: held,
      bots: rosterBots(home, () => listBots(bots, () => (ctx.get("agentPresets") as { list(): Promise<{ id: string; broken?: string }[]> }).list(), booted.botPresets.errors)),
      home, isTrusted: isTrustedDataRequest, log,
    }),
    log,
  });
  desk.bindRouter("sessionId" in router ? phoneConversation(router.conversation, router.tasks.ops) : undefined);
  if (!("sessionId" in router)) {
    await desk.dispose(1);
    await booted.dispose();
    throw new Error(`the conversation was not installed: ${lines.join(" | ")}`);
  }
  await router.tasks.ready;
  const routines = await desk.routines;
  assert.ok(routines !== undefined, `with the conversation and the schedule, the routines' clock row runs; the log: ${lines.join(" | ")}`);
  const base = `http://127.0.0.1:${ctx.webServer.port}`;
  mountClient(ctx);
  const cookie = await signIn(ctx, base);
  return { booted, desk, routines, conversation: router.conversation, tasks: router.tasks, sessionId: router.sessionId, base, cookie, clock, lines };
}

const held = (): Face => {
  assert.ok(face !== undefined, "the face is booted (the first test ran)");
  return face;
};
const convEvents = (f: Face): readonly Ev[] => f.booted.ctx.agents.get(SessionId(f.sessionId))!.session.snapshotEvents() as readonly Ev[];
/** The tool results the conversation's log holds after its `at`th event, as the model reads them. */
const resultsAfter = (f: Face, at: number): { isError?: boolean; text: string }[] => convEvents(f).slice(at)
  .filter((e) => e.type === "tool/result")
  .map((e) => {
    const message = (e.data as { message: { isError?: boolean; content: { text?: string }[] } }).message;
    return { isError: message.isError, text: message.content.map((b) => b.text ?? "").join("\n") };
  });
const idle = (f: Face) => waitFor("the conversation idle", () => f.booted.ctx.agents.get(SessionId(f.sessionId))!.status === "idle", 60_000);
const prompt = (f: Face, text: string) => remote(f.base, f.cookie, "session/prompt", {
  request: { requestId: `routine-propose-${crypto.randomUUID()}`, sessionId: f.sessionId, mode: "queue", content: [{ type: "text", text }] },
});
async function get<T>(f: Face, path: string): Promise<T> {
  const res = await fetch(`${f.base}${path}`);
  assert.equal(res.status, 200, `GET ${path}`);
  return (await res.json()) as T;
}
async function post<T>(f: Face, path: string, body: object): Promise<{ status: number; json: T }> {
  const res = await fetch(`${f.base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as T };
}

test("a browser message has Gravit propose a routine; the card's confirm adds it; the injected clock reaches its slot and it runs once, Succeeded, the proposal confirmed", { skip, timeout: 240_000 }, async () => {
  home = await mkdtemp(join(tmpdir(), "face-routine-propose-home-"));
  made.push(home);
  const rawRoot = await mkdtemp(join(tmpdir(), "face-routine-propose-root-"));
  made.push(rawRoot);
  root = await realpath(rawRoot);
  const bots = await makeBotsRoot();
  made.push(bots);
  await mkdir(join(root, ".git"));
  await mkdir(join(root, "strategies", "fx"), { recursive: true });
  setupFaceProfile(home);
  const patchPath = join(home, "profiles", "face", "cordis.patch.yml");
  const patch = readFileSync(patchPath, "utf8").replace(/^\[\][ \t]*$/m, "");
  // This smoke owns a scratch profile: never the operator's data server or Account, never a real model.
  writeFileSync(patchPath, `${patch}\n- id: mcp-akshare\n  disabled: true\n- id: mcp-account\n  disabled: true\n` +
    `- id: agent-default-model\n  config:\n    provider: ${STUB.provider}\n    model: ${STUB.model}\n`);

  face = await boot(bots);
  const f = face;
  /* the boot ticks - the standing orders' and the routines' - at 08:00 ET: nothing to run */
  await f.clock.advance(0);

  /* ---------- 1. THE PROPOSAL: an operator prompt, the stub's routine_propose ---------- */
  const at = convEvents(f).length;
  await prompt(f, PROPOSE);
  await waitFor("the routine_propose result", () => resultsAfter(f, at).length > 0, 60_000);
  await idle(f);
  const [result] = resultsAfter(f, at);
  assert.notEqual(result!.isError, true, result!.text);
  const answer = JSON.parse(result!.text) as { ok: boolean; proposal: string; when: string; runsPerDay: number };
  const when = whenText(SCHEDULE);
  assert.deepEqual([answer.ok, answer.when, answer.runsPerDay], [true, when, runsPerDay(SCHEDULE)], "the tool answers ok, the face's when line, one run a day");
  assert.equal(when, "Every day at 09:30 ET");

  const stored = await loadRoutines(home);
  assert.ok(stored.ok, "the store reads");
  assert.deepEqual(stored.store.routines, [], "a proposal adds no routine");
  assert.deepEqual(stored.store.proposals.map((p) => [p.id, p.name, p.instruction, p.state, p.origin]),
    [[answer.proposal, NAME, INSTRUCTION, "pending", { kind: "web" }]], "routines.json: one pending proposal, from the web");

  const before = await get<RoutinesStatus>(f, "/data/desk/routines");
  assert.deepEqual(before.routines, [], "the page lists no routine yet");
  assert.deepEqual(before.proposals.map((p) => [p.id, p.state, p.when, p.current]), [[answer.proposal, "pending", when, false]], "and the proposal, pending");

  /* ---------- 2. THE CARD'S ✓: the real route, at 08:00 ET ---------- */
  const confirm = await post<{ ok: boolean; routine: Routine }>(f, "/data/desk/routines/confirm", { proposal: answer.proposal });
  assert.equal(confirm.status, 200, JSON.stringify(confirm.json));
  const { routine } = confirm.json;
  assert.deepEqual([routine.name, routine.instruction, routine.enabled, routine.proposal, routine.confirmedAt],
    [NAME, INSTRUCTION, true, answer.proposal, new Date(BOOT_AT).toISOString()], "the routine, on, confirmed at the desk clock's 08:00 ET");
  const again = await post<{ ok: boolean; routine: Routine }>(f, "/data/desk/routines/confirm", { proposal: answer.proposal });
  assert.deepEqual([again.status, again.json.routine.id], [200, routine.id], "a second confirm answers the same routine");
  const added = await get<RoutinesStatus>(f, "/data/desk/routines");
  assert.deepEqual(added.routines.map((r) => [r.id, r.when, r.enabled, r.next?.date, r.next?.slot, r.runs.length]),
    [[routine.id, when, true, DATE, SLOT, 0]], "one routine, its next run today at 09:30 ET, no runs");
  confirmed = routine;

  /* ---------- 3. THE RUN: the injected clock reaches the slot ---------- */
  const KEY = `${routine.id}:${DATE}:${SLOT}`;
  const runRecords = async (): Promise<RoutineRunRecord[]> =>
    (await readRecords(home, ROUTINES_LEDGER, isRunRecord)).records.filter((r) => "key" in r && r.key === KEY);
  assert.deepEqual(await runRecords(), [], "before its slot, no run");
  f.clock.set(TICK_AT);
  await f.routines.tick();
  await waitFor("the run's report record", async () => (await runRecords()).some((r) => r.kind === "report"), 60_000);
  await waitFor("the clock row to let go of the run", async () => {
    const status = await f.routines.status();
    return status.running === undefined && status.queued.length === 0;
  });
  const records = await runRecords();
  assert.deepEqual(records.map((r) => r.kind), ["started", "finished", "report"], "routines.jsonl: one run's started, finished and report");
  const [started, finished] = records as [Extract<RoutineRunRecord, { kind: "started" }>, Extract<RoutineRunRecord, { kind: "finished" }>];
  assert.deepEqual([started.routine, started.sha256, started.at, started.test], [routine.id, routine.sha256, SLOT_AT, undefined], "started: the confirmed version, at the slot");
  assert.deepEqual([finished.outcome, finished.headline, finished.reported], ["ended", HEADLINE, true], `finished; saw ${JSON.stringify(finished)}`);

  const status = await get<RoutinesStatus>(f, "/data/desk/routines");
  const listed = status.routines.find((r) => r.id === routine.id);
  assert.ok(listed !== undefined, "the routine is on the page");
  assert.deepEqual(listed.runs.map((r) => [r.key, r.status, r.note]), [[KEY, "succeeded", HEADLINE]], "GET /data/desk/routines: one run, Succeeded, its note the headline");
  assert.deepEqual(status.proposals.map((p) => [p.id, p.state, p.routine, p.current]), [[answer.proposal, "confirmed", routine.id, true]],
    "and the proposal confirmed, current, naming its routine");
  assert.deepEqual(f.lines.filter((l) => /routine/.test(l)), [], `nothing logged a routine failure; saw ${JSON.stringify(f.lines)}`);
});

test("a turn the operator's message did not open - a task's relayed report - calls routine_propose: refused with the operator-only line, nothing stored", { skip, timeout: 240_000 }, async () => {
  const f = held();
  assert.ok(confirmed !== undefined, "the routine from the test before");
  const at = convEvents(f).length;
  await prompt(f, START);
  /* the operator's turn starts the task; the worker's report reaches the conversation as a `task` message, whose turn
   * the stub answers with routine_propose */
  const relayAt = (): number => convEvents(f).findIndex((e, i) => i >= at && e.type === "user/message" && sourceOf((e.data ?? {}) as { source?: unknown }).kind === "task"
    && sourceOf((e.data ?? {}) as { source?: unknown }).form === "report");
  await waitFor("the task's relay in the conversation", () => relayAt() >= 0, 90_000);
  await waitFor("the relay turn's tool result", () => resultsAfter(f, relayAt()).length > 0, 60_000);
  await idle(f);
  const [refused] = resultsAfter(f, relayAt());
  assert.equal(refused!.isError, true, "the call is refused");
  assert.ok(refused!.text.includes(OPERATOR_ONLY), refused!.text);

  const stored = await loadRoutines(home);
  assert.ok(stored.ok);
  assert.equal(stored.store.proposals.length, 1, "the store still holds one proposal");
  assert.deepEqual(stored.store.proposals.map((p) => p.name), [NAME], "the first, not the relay's");
  assert.deepEqual(stored.store.routines.map((r) => r.id), [confirmed.id], "and one routine");
});
