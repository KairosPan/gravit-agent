// face/tests/watchdog.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkHealth, contextOf, LABEL, servicePlan, type HealthCode, type ServiceDeps } from "../scripts/service.ts";
import { phoneOf, readWatchdogState, runWatchdog, watchdogStatePath, type WatchdogDeps } from "../scripts/watchdog.ts";
import { deskTime } from "../src/desk.ts";

const home = (): Promise<string> => mkdtemp(join(tmpdir(), "face-watchdog-"));
/** 15:30 UTC: 11:30 in New York. */
const T0 = Date.parse("2026-11-30T15:30:00.000Z");
const FIVE_MIN = 5 * 60_000;

interface Run { deps: WatchdogDeps; sent: string[]; logs: string[]; restarts: number; at(ms: number): void; health(code: HealthCode, reason: string): void }

/** WatchdogDeps over a temp home: the health and the clock set by the test, every line and log recorded. */
async function watch(o: { off?: boolean; restartCode?: number } = {}): Promise<Run> {
  const h = await home();
  const sent: string[] = []; const logs: string[] = [];
  let now = T0;
  let result: { code: HealthCode; reason: string } = { code: 0, reason: "healthy" };
  const run: Run = {
    sent, logs, restarts: 0,
    at: (ms) => { now = ms; },
    health: (code, reason) => { result = { code, reason }; },
    deps: {
      home: h,
      check: async () => result,
      restart: async () => { run.restarts++; return o.restartCode ?? 0; },
      send: async (text) => { sent.push(text); },
      offInForce: async () => o.off ?? false,
      now: () => now,
      log: (line) => { logs.push(line); },
    },
  };
  return run;
}

const DOWN = "no answer on 3090 (launchd: not running)";

test("down once: one restart and one line; down again in the next run: neither again", async () => {
  const w = await watch();
  w.health(2, DOWN);
  assert.equal(await runWatchdog(w.deps), 0);
  assert.equal(w.restarts, 1);
  assert.deepEqual(w.sent, [`the desk has not answered since ${deskTime(new Date(T0), new Date(T0))} (${DOWN}); the watchdog restarted it`]);
  const state = await readWatchdogState(w.deps.home);
  assert.equal(state.outageSince, new Date(T0).toISOString());
  assert.equal(state.restartedAt, new Date(T0).toISOString());
  assert.equal((await stat(watchdogStatePath(w.deps.home))).mode & 0o777, 0o600, "watchdog.json is the operator's alone");
  w.at(T0 + FIVE_MIN);
  assert.equal(await runWatchdog(w.deps), 0);
  assert.equal(w.restarts, 1, "one restart per outage");
  assert.equal(w.sent.length, 1, "one line per outage");

  const failing = await watch({ restartCode: 1 });
  failing.health(2, DOWN);
  await runWatchdog(failing.deps);
  assert.equal(failing.restarts, 1);
  assert.match(failing.sent[0], /^the desk has not answered since \S+ ET \(no answer on 3090 \(launchd: not running\)\); the restart failed: npm run service -- restart exited 1/);

  const throwing = await watch();
  throwing.deps.restart = async () => { throw new Error("launchctl vanished"); };
  throwing.health(2, DOWN);
  assert.equal(await runWatchdog(throwing.deps), 0);
  assert.match(throwing.sent[0], /; the restart failed: launchctl vanished$/);
});

test("degraded twice in a row: one line; a third: none", async () => {
  const w = await watch();
  w.health(1, "telegram blocked: the operator's chat refuses the bot (403)");
  await runWatchdog(w.deps);
  assert.deepEqual(w.sent, [], "one degraded check says nothing");
  assert.equal((await readWatchdogState(w.deps.home)).degradedChecks, 1);
  w.at(T0 + FIVE_MIN);
  await runWatchdog(w.deps);
  assert.deepEqual(w.sent, [`the desk is degraded since ${deskTime(new Date(T0), new Date(T0 + FIVE_MIN))}: telegram blocked: the operator's chat refuses the bot (403)`]);
  w.at(T0 + 2 * FIVE_MIN);
  await runWatchdog(w.deps);
  assert.equal(w.sent.length, 1, "once per episode");
  const state = await readWatchdogState(w.deps.home);
  assert.deepEqual([state.degradedChecks, state.degradedSaid], [3, true]);
  assert.equal(w.restarts, 0, "a degraded desk is never restarted");
  w.health(0, "healthy");
  await runWatchdog(w.deps);
  w.health(1, "telegram blocked: the operator's chat refuses the bot (403)");
  await runWatchdog(w.deps); await runWatchdog(w.deps);
  assert.equal(w.sent.length, 2, "a healthy check ends the episode: the next one is said again");
});

test("back to healthy after an outage: one line and a cleared state", async () => {
  const w = await watch();
  w.health(2, DOWN);
  await runWatchdog(w.deps);
  w.at(T0 + FIVE_MIN);
  w.health(0, "healthy");
  await runWatchdog(w.deps);
  assert.equal(w.sent.length, 2);
  assert.equal(w.sent[1], `the desk answers again (down since ${deskTime(new Date(T0), new Date(T0 + FIVE_MIN))})`);
  assert.deepEqual(await readWatchdogState(w.deps.home), { degradedChecks: 0 });
  await runWatchdog(w.deps);
  assert.equal(w.sent.length, 2, "healthy with no outage says nothing");
  w.health(2, DOWN);
  await runWatchdog(w.deps);
  assert.equal(w.restarts, 2, "a new outage is restarted once again");
});

test("stopped on purpose: nothing sent, the state cleared", async () => {
  const w = await watch();
  w.health(2, DOWN);
  await runWatchdog(w.deps);
  w.health(3, "stopped");
  await runWatchdog(w.deps);
  assert.equal(w.sent.length, 1, "only the outage's line");
  assert.deepEqual(await readWatchdogState(w.deps.home), { degradedChecks: 0 });
  assert.equal(w.restarts, 1);
  await runWatchdog(w.deps);
  assert.equal(w.restarts, 1, "a stopped desk is never restarted");
});

test("OFF in force: no line, the restart still runs", async () => {
  const w = await watch({ off: true });
  w.health(2, DOWN);
  await runWatchdog(w.deps);
  assert.equal(w.restarts, 1);
  assert.deepEqual(w.sent, []);
  assert.equal((await readWatchdogState(w.deps.home)).outageSince, new Date(T0).toISOString(), "the state goes on");
  assert.ok(w.logs.some((l) => l.includes("OFF in force")), "the log says what was not sent");
  const d = await watch({ off: true });
  d.health(1, "ledger unreadable (EIO)");
  await runWatchdog(d.deps); await runWatchdog(d.deps);
  assert.deepEqual(d.sent, []);
  assert.equal((await readWatchdogState(d.deps.home)).degradedChecks, 2);
});

test("an unreadable watchdog.json starts afresh", async () => {
  const w = await watch();
  await mkdir(join(w.deps.home, "face", "desk"), { recursive: true });
  await writeFile(watchdogStatePath(w.deps.home), "not json");
  assert.deepEqual(await readWatchdogState(w.deps.home), { degradedChecks: 0 });
  w.health(2, DOWN);
  await runWatchdog(w.deps);
  assert.equal(w.restarts, 1);
});

test("the bot token appears in no line and no log", async () => {
  const TOKEN = "123456:AAH-secret/tok+en";
  const bodies: string[] = []; const urls: string[] = []; const logs: string[] = [];
  let fail = false;
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    urls.push(String(input)); bodies.push(String(init?.body));
    assert.ok(init?.signal instanceof AbortSignal, "a timeout rides on every send");
    if (fail) throw new TypeError(`fetch failed: ${String(input)} ${encodeURIComponent(TOKEN)}`);
    return new Response(JSON.stringify({ ok: false, description: `Unauthorized ${TOKEN}` }), { status: 401 });
  }) as typeof fetch;
  const phone = phoneOf({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_OPERATOR_ID: "777" }, { fetch: fakeFetch, log: (l) => { logs.push(l); } });
  const w = await watch();
  w.deps.send = phone.send;
  w.deps.log = (line) => { logs.push(phone.redact(line)); };
  w.health(2, `no answer on 3090 (launchd: ${TOKEN})`);
  assert.equal(await runWatchdog(w.deps), 0);
  fail = true;
  await phone.send(`again ${TOKEN}`);
  assert.equal(urls[0], `https://api.telegram.org/bot${TOKEN}/sendMessage`, "the token goes only into the Bot API's URL");
  assert.equal(JSON.parse(bodies[0]).chat_id, 777);
  for (const text of [...bodies, ...logs]) assert.ok(!text.includes(TOKEN) && !text.includes(encodeURIComponent(TOKEN)), text);
  assert.ok(bodies[0].includes("<token>"));
  assert.ok(logs.some((l) => l.includes("401")), "the refusal is logged");
  assert.ok(logs.some((l) => l.includes("fetch failed")), "the failure is logged, never thrown");
  const none = phoneOf({}, { fetch: fakeFetch, log: (l) => { logs.push(l); } });
  await none.send("unsent");
  assert.equal(urls.length, 2, "no bridge configured: nothing fetched");
  assert.ok(logs.at(-1)!.includes("not configured"));
});

test("another face on the port reads 1, so the watchdog never restarts it", async () => {
  const homeDir = await home(); const root = await home();
  const dshHome = join(homeDir, ".dsh");
  const job = `gui/501/${LABEL}`;
  const calls: string[][] = [];
  const deps: ServiceDeps = {
    launchctl: (args) => { calls.push(args); return args[0] === "print" ? { ok: true, out: `${job} = {\n\tstate = running\n\tpid = 42\n}\n` } : { ok: true, out: "" }; },
    fetch: (async () => new Response(JSON.stringify({ ok: true, pid: 99, version: "v", bootedAt: "2026-11-30T15:00:00.000Z", uptimeMs: 1,
      desk: { enabled: true, dir: "/d" }, asleep: [], runs: [], turnsToday: { count: 0, usage: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } } }),
    { status: 200 })) as typeof fetch,
    homeDir, home: dshHome, root, uid: 501, platform: "darwin", nodePath: "/n", envPath: "/usr/bin",
    out: () => undefined, sleep: async () => undefined,
  };
  const plan = servicePlan({ root, home: dshHome, homeDir, node: "/n", path: "/usr/bin", launchAgentsDir: join(homeDir, "Library", "LaunchAgents") });
  await mkdir(join(homeDir, "Library", "LaunchAgents"), { recursive: true });
  await writeFile(plan.path, plan.plist);
  const w = await watch();
  w.deps.home = dshHome;
  w.deps.check = () => checkHealth(contextOf(deps, undefined), { now: () => T0 });
  for (let i = 0; i < 3; i++) { w.at(T0 + i * FIVE_MIN); await runWatchdog(w.deps); }
  assert.equal(w.restarts, 0);
  assert.ok(!calls.some((c) => c[0] !== "print"), "launchd only asked, never told");
  assert.deepEqual(w.sent, [`the desk is degraded since ${deskTime(new Date(T0), new Date(T0 + FIVE_MIN))}: another face holds the port`]);
  assert.ok(JSON.parse(await readFile(watchdogStatePath(dshHome), "utf8")).outageSince === undefined);
});
