// face/tests/watchdog.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { checkHealth, contextOf, LABEL, OTHER_FACE, servicePlan, type HealthCode, type ServiceDeps } from "../scripts/service.ts";
import { accountHomeOf, accountSendOf, answers, phoneDirectOf, readNetworkFile, readWatchdogState, slackApiOf, runWatchdog, watchdogStatePath, type WatchdogDeps } from "../scripts/watchdog.ts";
import { deskTime } from "../src/desk.ts";

const home = (): Promise<string> => mkdtemp(join(tmpdir(), "face-watchdog-"));
/** 15:30 UTC: 11:30 in New York. */
const T0 = Date.parse("2026-11-30T15:30:00.000Z");
const FIVE_MIN = 5 * 60_000;

interface Run {
  deps: WatchdogDeps; sent: string[]; direct: string[]; logs: string[]; restarts: number;
  at(ms: number): void; health(code: HealthCode, reason: string): void; account(up: boolean): void; market(up: boolean): void;
}

/** WatchdogDeps over a temp home: the health and the clock set by the test, every line and log recorded. */
async function watch(o: { off?: boolean; restartCode?: number } = {}): Promise<Run> {
  const h = await home();
  const sent: string[] = []; const logs: string[] = [];
  let now = T0;
  const direct: string[] = [];
  let result: { code: HealthCode; reason: string } = { code: 0, reason: "healthy" };
  let accountUp = true; let marketUp = true;
  const run: Run = {
    sent, direct, logs, restarts: 0,
    at: (ms) => { now = ms; },
    health: (code, reason) => { result = { code, reason }; },
    account: (up) => { accountUp = up; },
    market: (up) => { marketUp = up; },
    deps: {
      home: h,
      check: async () => result,
      checkAccount: async () => accountUp,
      checkMarket: async () => marketUp,
      restart: async () => { run.restarts++; return o.restartCode ?? 0; },
      send: async (text) => { sent.push(text); return true; },
      sendDirect: async (text) => { direct.push(text); return true; },
      offInForce: async () => o.off ?? false,
      now: () => now,
      log: (line) => { logs.push(line); },
    },
  };
  return run;
}

const DOWN = "no answer on 3090 (launchd: not running)";
/** A cleared state, as readWatchdogState reads one back. */
const CLEARED = { degradedChecks: 0, accountDownChecks: 0, marketDownChecks: 0 };

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
  assert.deepEqual(await readWatchdogState(w.deps.home), CLEARED);
  await runWatchdog(w.deps);
  assert.equal(w.sent.length, 2, "healthy with no outage says nothing");
  w.health(2, DOWN);
  await runWatchdog(w.deps);
  assert.equal(w.restarts, 2, "a new outage is restarted once again");
});

/* Ruling 10's narrowing: during an outage the operator starts a face in a terminal to look. That face answering is not
 * launchd's face answering: the outage stays open, the restart is not run again, and nothing is said. */
test("another face answering during an outage neither closes it nor says answers again; launchd's own face does", async () => {
  const w = await watch();
  w.health(2, DOWN);
  await runWatchdog(w.deps);
  const opened = await readWatchdogState(w.deps.home);
  w.at(T0 + FIVE_MIN);
  w.health(1, OTHER_FACE);
  assert.equal(await runWatchdog(w.deps), 0);
  assert.equal(w.sent.length, 1, "no line: launchd's face has not answered");
  assert.deepEqual(await readWatchdogState(w.deps.home), opened, "the state unchanged, the degraded count left alone");
  w.at(T0 + 2 * FIVE_MIN);
  w.health(2, DOWN);
  await runWatchdog(w.deps);
  assert.equal(w.restarts, 1, "the terminal face closed: the same outage, not restarted again");
  assert.equal(w.sent.length, 1);
  w.at(T0 + 3 * FIVE_MIN);
  w.health(0, "healthy");
  await runWatchdog(w.deps);
  assert.deepEqual(w.sent.slice(1), [`the desk answers again (down since ${deskTime(new Date(T0), new Date(T0 + 3 * FIVE_MIN))})`]);
  assert.deepEqual(await readWatchdogState(w.deps.home), CLEARED);
});

test("stopped on purpose: nothing sent, the state cleared", async () => {
  const w = await watch();
  w.health(2, DOWN);
  await runWatchdog(w.deps);
  w.health(3, "stopped");
  await runWatchdog(w.deps);
  assert.equal(w.sent.length, 1, "only the outage's line");
  assert.deepEqual(await readWatchdogState(w.deps.home), CLEARED);
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
  assert.deepEqual(await readWatchdogState(w.deps.home), CLEARED);
  w.health(2, DOWN);
  await runWatchdog(w.deps);
  assert.equal(w.restarts, 1);
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

/* Task 10: the account and the market beside the desk (spec §5.10). */

/** 19:05 UTC: 14:05 in New York. */
const T1 = Date.parse("2026-11-30T19:05:00.000Z");
const ACCOUNT_DOWN = "the account has not answered since 14:05 ET; nothing reaches the phone until it does";

test("the account down two checks in a row: one direct notice, nothing more until it is back", async () => {
  const w = await watch();
  w.at(T1); w.account(false);
  assert.equal(await runWatchdog(w.deps), 0);
  assert.deepEqual(w.direct, [], "one check down says nothing");
  const one = await readWatchdogState(w.deps.home);
  assert.deepEqual([one.accountDownChecks, one.accountSince, one.accountSaid], [1, new Date(T1).toISOString(), undefined]);
  w.at(T1 + FIVE_MIN);
  await runWatchdog(w.deps);
  assert.deepEqual(w.direct, [ACCOUNT_DOWN]);
  assert.equal((await readWatchdogState(w.deps.home)).accountSaid, true);
  w.at(T1 + 2 * FIVE_MIN);
  await runWatchdog(w.deps);
  w.at(T1 + 3 * FIVE_MIN);
  await runWatchdog(w.deps);
  assert.deepEqual(w.direct, [ACCOUNT_DOWN], "one notice per outage");
  assert.deepEqual(w.sent, [], "nothing goes through an account that is down");
  assert.equal(w.restarts, 0, "the watchdog never restarts the account");
  assert.equal((await readWatchdogState(w.deps.home)).accountDownChecks, 4);
});

test("the account back after a notice: 'the account answers again (down since 14:05 ET)' through the account", async () => {
  const w = await watch();
  w.at(T1); w.account(false);
  await runWatchdog(w.deps);
  w.at(T1 + FIVE_MIN);
  await runWatchdog(w.deps);
  w.at(T1 + 2 * FIVE_MIN); w.account(true);
  await runWatchdog(w.deps);
  assert.deepEqual(w.sent, ["the account answers again (down since 14:05 ET)"]);
  assert.deepEqual(w.direct, [ACCOUNT_DOWN], "the direct path is used for the down notice alone");
  assert.deepEqual(await readWatchdogState(w.deps.home), CLEARED);
  /* a new outage is told again */
  w.account(false); await runWatchdog(w.deps); await runWatchdog(w.deps);
  assert.equal(w.direct.length, 2);

  /* down one check only, then back: nothing was said, so nothing is said */
  const blip = await watch();
  blip.account(false); await runWatchdog(blip.deps);
  blip.account(true); await runWatchdog(blip.deps);
  assert.deepEqual([blip.sent, blip.direct], [[], []]);
  assert.deepEqual(await readWatchdogState(blip.deps.home), CLEARED);
});

test("the market down two checks: 'the market has not answered since 14:05 ET: prices, the watch and paper fills wait', once, through the account; back: 'the market answers again (down since 14:05 ET)'", async () => {
  const w = await watch();
  w.at(T1); w.market(false);
  await runWatchdog(w.deps);
  assert.deepEqual(w.sent, []);
  w.at(T1 + FIVE_MIN);
  await runWatchdog(w.deps);
  w.at(T1 + 2 * FIVE_MIN);
  await runWatchdog(w.deps);
  assert.deepEqual(w.sent, ["the market has not answered since 14:05 ET: prices, the watch and paper fills wait"]);
  const s = await readWatchdogState(w.deps.home);
  assert.deepEqual([s.marketDownChecks, s.marketSince, s.marketSaid], [3, new Date(T1).toISOString(), true]);
  w.at(T1 + 3 * FIVE_MIN); w.market(true);
  await runWatchdog(w.deps);
  assert.deepEqual(w.sent.slice(1), ["the market answers again (down since 14:05 ET)"]);
  assert.deepEqual(w.direct, [], "the market's lines never take the direct path");
  assert.equal(w.restarts, 0, "the watchdog never restarts the market");
  assert.deepEqual(await readWatchdogState(w.deps.home), CLEARED);

  /* an account that does not take the market's line: not marked said, so the next run says it again */
  const r = await watch();
  r.deps.send = async (text) => { r.sent.push(text); return false; };
  r.market(false); await runWatchdog(r.deps); await runWatchdog(r.deps);
  assert.equal((await readWatchdogState(r.deps.home)).marketSaid, undefined);
  await runWatchdog(r.deps);
  assert.equal(r.sent.length, 2, "tried again at the next run");
  assert.ok(r.logs.some((l) => l.includes("the account did not take it")));
});

test("the desk's lines go through the account; while the account is down they are logged not sent", async () => {
  const w = await watch();
  w.health(2, DOWN);
  await runWatchdog(w.deps);
  assert.equal(w.sent.length, 1, "the desk's line goes through the account");
  assert.match(w.sent[0], /^the desk has not answered since /);

  const d = await watch();
  d.account(false); d.health(2, DOWN);
  await runWatchdog(d.deps);
  assert.equal(d.restarts, 1, "the desk is still restarted");
  assert.deepEqual([d.sent, d.direct], [[], []]);
  assert.ok(d.logs.some((l) => l.startsWith("the account is down, not sent: the desk has not answered since")), d.logs.join("\n"));
  /* a market line while the account is down waits for the account, and goes once it answers */
  const m = await watch();
  m.account(false); m.market(false);
  await runWatchdog(m.deps); await runWatchdog(m.deps);
  assert.deepEqual(m.sent, []);
  assert.equal(m.direct.length, 1);
  assert.ok(m.logs.some((l) => l.startsWith("the account is down, not sent: the market has not answered")));
  m.account(true);
  await runWatchdog(m.deps);
  assert.equal(m.sent.length, 2);
  assert.match(m.sent[0], /^the account answers again/);
  assert.match(m.sent[1], /^the market has not answered since /);
});

test("phoneDirectOf reads no token from a file others can read, and takes the token out of every line", async () => {
  const TOKEN = "123456:AAH-secret/tok+en";
  const accountHome = await mkdtemp(join(tmpdir(), "face-watchdog-account-"));
  const dir = join(accountHome, "credentials", "networks");
  const file = join(dir, "telegram.json");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(file, JSON.stringify({ token: TOKEN, botId: "123456", username: "gravit_bot", operatorId: "777", operatorHandle: "op" }), { mode: 0o644 });
  await chmod(file, 0o644);
  const urls: string[] = []; const bodies: string[] = []; const logs: string[] = [];
  let fail = false;
  /* a fake Bot API: it answers, it refuses, or it cannot be reached - and its words carry the token */
  const fakeBotApi = (async (input: string | URL | Request, init?: RequestInit) => {
    urls.push(String(input)); bodies.push(String(init?.body));
    assert.ok(init?.signal instanceof AbortSignal, "a timeout rides on every send");
    if (fail) throw new TypeError(`fetch failed: ${String(input)} ${encodeURIComponent(TOKEN)}`);
    return new Response(JSON.stringify({ ok: false, description: `Unauthorized ${TOKEN}` }), { status: 401 });
  }) as typeof fetch;
  const phone = phoneDirectOf(accountHome, { fetch: fakeBotApi, log: (l) => { logs.push(l); } });
  await phone.send("the account is down");
  assert.equal(urls.length, 0, "a token file others can read is not read");
  assert.match(logs.at(-1)!, /not read/);

  await chmod(file, 0o600);
  await phone.send(`the account is down ${TOKEN}`);
  assert.equal(urls[0], `https://api.telegram.org/bot${TOKEN}/sendMessage`, "the token goes only into the Bot API's URL");
  assert.equal(JSON.parse(bodies[0]).chat_id, 777, "to the operator the account bound");
  assert.ok(bodies[0].includes("<token>"));
  fail = true;
  await phone.send("again");
  assert.ok(logs.some((l) => l.includes("401")), "the refusal is logged");
  assert.ok(logs.some((l) => l.includes("fetch failed")), "the failure is logged, never thrown");
  assert.equal(phone.redact(`x ${TOKEN} ${encodeURIComponent(TOKEN)}`), "x <token> <token>", "redact knows the token read");
  for (const text of [...bodies, ...logs]) assert.ok(!text.includes(TOKEN) && !text.includes(encodeURIComponent(TOKEN)), text);

  /* a link anywhere on the way is not followed */
  const linked = await mkdtemp(join(tmpdir(), "face-watchdog-linked-"));
  await mkdir(join(linked, "credentials"), { recursive: true });
  await symlink(dir, join(linked, "credentials", "networks"));
  const viaLink = phoneDirectOf(linked, { fetch: fakeBotApi, log: (l) => { logs.push(l); } });
  const before = urls.length;
  await viaLink.send("x");
  const fileLinked = await mkdtemp(join(tmpdir(), "face-watchdog-filelink-"));
  await mkdir(join(fileLinked, "credentials", "networks"), { recursive: true });
  await symlink(file, join(fileLinked, "credentials", "networks", "telegram.json"));
  await phoneDirectOf(fileLinked, { fetch: fakeBotApi, log: (l) => { logs.push(l); } }).send("x");
  /* no file: nothing fetched, one line */
  const empty = await mkdtemp(join(tmpdir(), "face-watchdog-empty-"));
  await phoneDirectOf(empty, { fetch: fakeBotApi, log: (l) => { logs.push(l); } }).send("unsent");
  assert.equal(urls.length, before, "no link followed, no file: nothing fetched");
  assert.ok(logs.at(-1)!.includes("not sent"));
  for (const text of logs) assert.ok(!text.includes(TOKEN), text);

  assert.equal(accountHomeOf({ FACE_ACCOUNT_HOME: "/a", BUYER_HOME: "/b" }), "/a");
  assert.equal(accountHomeOf({ BUYER_HOME: "/b" }), "/b");
  assert.equal(accountHomeOf({}), join(homedir(), ".buyer-agent-demo"));
});

test("OFF in force holds every line, the account's and the market's too", async () => {
  const w = await watch({ off: true });
  w.account(false); w.market(false);
  for (let i = 0; i < 3; i++) await runWatchdog(w.deps);
  assert.deepEqual([w.sent, w.direct], [[], []]);
  assert.ok(w.logs.some((l) => l.includes("OFF in force, not sent: the account has not answered")));
  const s = await readWatchdogState(w.deps.home);
  assert.deepEqual([s.accountDownChecks, s.accountSaid, s.marketDownChecks, s.marketSaid], [3, undefined, 3, undefined], "nothing marked said");
  w.account(true); w.market(true);
  await runWatchdog(w.deps);
  assert.deepEqual([w.sent, w.direct], [[], []], "nothing was said, so no answers-again line");
  assert.deepEqual(await readWatchdogState(w.deps.home), CLEARED);
});

test("a line through the account is kind watchdog; true when the account answered, false when it refused or did not", async () => {
  const asked: { url: string; body: unknown }[] = []; const logs: string[] = [];
  let answer: () => Response = () => Response.json({ ok: true, sent: ["telegram:1"] });
  const fakeAccount = (async (input: string | URL | Request, init?: RequestInit) => {
    asked.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    assert.ok(init?.signal instanceof AbortSignal);
    return answer();
  }) as typeof fetch;
  const send = accountSendOf("http://127.0.0.1:4820/", { fetch: fakeAccount, log: (l) => { logs.push(l); } });
  assert.equal(await send("the desk answers again"), true);
  assert.deepEqual(asked[0], { url: "http://127.0.0.1:4820/api/account/identity/send", body: { kind: "watchdog", text: "the desk answers again" } });
  answer = () => Response.json({ ok: true, held: "nothing connected" });
  assert.equal(await send("x"), true, "a held line was answered");
  assert.ok(logs.at(-1)!.includes("nothing connected"));
  answer = () => Response.json({ ok: false, error: "Telegram refused the message" }, { status: 502 });
  assert.equal(await send("x"), false);
  assert.ok(logs.at(-1)!.includes("Telegram refused"));
  answer = () => new Response("<html>", { status: 502 });
  assert.equal(await send("x"), false);
  answer = () => { throw new TypeError("fetch failed"); };
  assert.equal(await send("x"), false);
  assert.ok(logs.at(-1)!.includes("could not be asked"));
});

/* Fix round 1. */

test("the direct notice is tried at each run until the Bot API takes it: no file, a file others can read, a refusal, no answer - then once", async () => {
  const TOKEN = "123456:AAH-secret/tok+en";
  const accountHome = await mkdtemp(join(tmpdir(), "face-watchdog-retry-"));
  const dir = join(accountHome, "credentials", "networks");
  const file = join(dir, "telegram.json");
  let mode: "refuse" | "fail" | "take" = "refuse";
  let taken = 0; let asked = 0;
  const fakeBotApi = (async () => {
    asked++;
    if (mode === "fail") throw new TypeError(`fetch failed ${TOKEN}`);
    if (mode === "refuse") return new Response(JSON.stringify({ ok: false, description: `Forbidden ${TOKEN}` }), { status: 403 });
    taken++;
    return Response.json({ ok: true, result: { message_id: 1 } });
  }) as typeof fetch;
  const w = await watch();
  const phone = phoneDirectOf(accountHome, { fetch: fakeBotApi, log: (l) => { w.logs.push(l); } });
  w.deps.sendDirect = phone.send;
  w.at(T1); w.account(false);
  await runWatchdog(w.deps);
  w.at(T1 + FIVE_MIN);
  await runWatchdog(w.deps); /* no token file */
  assert.equal(asked, 0);
  assert.equal((await readWatchdogState(w.deps.home)).accountSaid, undefined, "no file: not said");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(file, JSON.stringify({ token: TOKEN, botId: "123456", username: "gravit_bot", operatorId: "777", operatorHandle: "op" }), { mode: 0o644 });
  await chmod(file, 0o644);
  await runWatchdog(w.deps); /* a file others can read */
  assert.equal(asked, 0);
  assert.equal((await readWatchdogState(w.deps.home)).accountSaid, undefined);
  await chmod(file, 0o600);
  await runWatchdog(w.deps); /* refused */
  mode = "fail";
  await runWatchdog(w.deps); /* no answer */
  assert.equal(asked, 2);
  assert.equal((await readWatchdogState(w.deps.home)).accountSaid, undefined, "a refusal and a failure: not said");
  mode = "take";
  await runWatchdog(w.deps);
  await runWatchdog(w.deps);
  await runWatchdog(w.deps);
  assert.equal(taken, 1, "sent exactly once");
  assert.equal(asked, 3);
  assert.equal((await readWatchdogState(w.deps.home)).accountSaid, true);
  assert.ok(w.logs.some((l) => l.startsWith("not sent directly, tried again at the next run")));
  for (const l of w.logs) assert.ok(!l.includes(TOKEN) && !l.includes(encodeURIComponent(TOKEN)), l);
});

test("an account that answers 500 is up: no direct notice; only no answer counts", async () => {
  let status = 500; let silent = false;
  const fakeAccount = (async () => {
    if (silent) throw new TypeError("fetch failed (ECONNREFUSED)");
    return new Response("settle failed", { status });
  }) as typeof fetch;
  assert.equal(await answers("http://127.0.0.1:4820/api/overview", fakeAccount), true);
  status = 404;
  assert.equal(await answers("http://127.0.0.1:4820/api/overview", fakeAccount), true);
  status = 500;
  const w = await watch();
  w.deps.checkAccount = () => answers("http://127.0.0.1:4820/api/overview", fakeAccount);
  for (let i = 0; i < 3; i++) await runWatchdog(w.deps);
  assert.deepEqual(w.direct, []);
  assert.equal((await readWatchdogState(w.deps.home)).accountDownChecks, 0);
  silent = true;
  assert.equal(await answers("http://127.0.0.1:4820/api/overview", fakeAccount), false);
  await runWatchdog(w.deps); await runWatchdog(w.deps);
  assert.equal(w.direct.length, 1, "no answer twice: the notice");
});

test("a desk check that throws still checks the account and the market, and the run exits 1", async () => {
  const w = await watch();
  w.health(1, "ledger unreadable (EIO)");
  await runWatchdog(w.deps);
  const before = await readWatchdogState(w.deps.home);
  w.deps.check = async () => { throw new Error("launchctl vanished"); };
  w.at(T1); w.account(false); w.market(false);
  assert.equal(await runWatchdog(w.deps), 1);
  w.at(T1 + FIVE_MIN);
  assert.equal(await runWatchdog(w.deps), 1);
  assert.deepEqual(w.direct, [ACCOUNT_DOWN], "the account-down notice still fires");
  const s = await readWatchdogState(w.deps.home);
  assert.deepEqual([s.degradedChecks, s.degradedSince, s.degradedSaid], [before.degradedChecks, before.degradedSince, before.degradedSaid], "the desk's part as it was");
  assert.deepEqual([s.accountDownChecks, s.marketDownChecks], [2, 2]);
  assert.equal(w.restarts, 0);
  assert.ok(w.logs.some((l) => l.includes("check failed: launchctl vanished")));
});

/* Plan B2: Slack beside Telegram (ruling 13). The made-up tokens are built at runtime, so no literal in the tree has a
 * scanner's shape. */
const SLACK_BOT = ["xo", "xb-", "1234567890-", "2345678901-", "FakeBotTokenShape0123456"].join("");
const SLACK_APP = ["xa", "pp-", "1-A0FAKEAPP01-1234567890-", "ab".repeat(32)].join("");

/** An account home holding `networks`' files, each mode 0600 in a 0700 directory. */
async function accountHomeWith(networks: { telegram?: boolean; slack?: boolean }): Promise<string> {
  const accountHome = await mkdtemp(join(tmpdir(), "face-watchdog-b2-"));
  const dir = join(accountHome, "credentials", "networks");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  if (networks.telegram === true) {
    await writeFile(join(dir, "telegram.json"), JSON.stringify({ token: "123456:AAH-secret/tok+en", botId: "123456", username: "gravit_bot", operatorId: "777", operatorHandle: "op" }), { mode: 0o600 });
  }
  if (networks.slack === true) {
    await writeFile(join(dir, "slack.json"), JSON.stringify({
      appToken: SLACK_APP, botToken: SLACK_BOT, appId: "A0FAKEAPP01", channel: "D0FAKEDM01", botId: "T0FAKE001:U0BOT0001",
      username: "gravit", operatorId: "T0FAKE001:U0OP00001", operatorHandle: "@op",
    }), { mode: 0o600 });
  }
  return accountHome;
}

test("the account down with only Slack connected: one direct line through chat.postMessage, its tokens taken out", async () => {
  const accountHome = await accountHomeWith({ slack: true });
  const asked: { url: string; init: RequestInit }[] = [];
  let answer: () => Response = () => Response.json({ ok: false, error: `invalid_auth ${SLACK_BOT}` });
  const fakeSlack = (async (input: string | URL | Request, init?: RequestInit) => {
    asked.push({ url: String(input), init: init ?? {} });
    assert.ok(init?.signal instanceof AbortSignal, "a timeout rides on every send");
    return answer();
  }) as typeof fetch;
  const w = await watch();
  const phone = phoneDirectOf(accountHome, { fetch: fakeSlack, log: (l) => { w.logs.push(l); } });
  w.deps.sendDirect = (text) => phone.send(`${text} <!channel> & ${SLACK_APP} ${["xo", "xp-", "9999999999-abcdefghij"].join("")}`);
  w.at(T1); w.account(false);
  await runWatchdog(w.deps);
  w.at(T1 + FIVE_MIN);
  await runWatchdog(w.deps); /* Slack answers 200 with ok: false - a failure, not said */
  assert.equal(asked.length, 1);
  assert.equal((await readWatchdogState(w.deps.home)).accountSaid, undefined, "an ok:false answer is not taken");
  const first = asked[0];
  assert.equal(first.url, "https://slack.com/api/chat.postMessage");
  assert.equal(first.init.method, "POST");
  const headers = first.init.headers as Record<string, string>;
  assert.equal(headers.authorization, `Bearer ${SLACK_BOT}`, "the bot token in the header alone");
  assert.equal(headers["content-type"], "application/x-www-form-urlencoded");
  const form = new URLSearchParams(String(first.init.body));
  assert.equal(form.get("channel"), "D0FAKEDM01", "to the DM the account bound");
  assert.equal(form.get("text"), `${ACCOUNT_DOWN} &lt;!channel&gt; &amp; <token> <token>`.replace(/<token>/g, "&lt;token&gt;"), "escaped, both tokens and every Slack shape out");
  assert.equal(form.get("mrkdwn"), "false"); assert.equal(form.get("unfurl_links"), "false"); assert.equal(form.get("unfurl_media"), "false");
  assert.ok(!first.url.includes(SLACK_BOT) && !String(first.init.body).includes(SLACK_BOT), "never in the URL or the body");

  answer = () => Response.json({ ok: true, ts: "1730812345.001200" });
  w.at(T1 + 2 * FIVE_MIN);
  await runWatchdog(w.deps);
  assert.equal(asked.length, 2);
  assert.equal((await readWatchdogState(w.deps.home)).accountSaid, true);
  for (let i = 3; i < 6; i++) {
    w.at(T1 + i * FIVE_MIN);
    await runWatchdog(w.deps);
  }
  assert.equal(asked.length, 2, "nothing more until the account is back");
  assert.ok(w.logs.some((l) => l.includes("invalid_auth")), "the refusal is logged");
  for (const l of w.logs) assert.ok(!l.includes(SLACK_BOT) && !l.includes(SLACK_APP), l);
  assert.equal(phone.redact(`x ${SLACK_BOT} ${SLACK_APP} ${["xo", "xe-", "1-abcdefghijkl"].join("")}`), "x <token> <token> <token>");

  /* a Slack file others can read is not read; a channel that is no DM is no token file */
  const loose = await accountHomeWith({ slack: true });
  await chmod(join(loose, "credentials", "networks", "slack.json"), 0o644);
  const logs: string[] = [];
  assert.equal(await phoneDirectOf(loose, { fetch: fakeSlack, log: (l) => { logs.push(l); } }).send("x"), false);
  assert.match(logs.at(-1)!, /slack\.json can be read by other users/);
  assert.equal(asked.length, 2);
});

test("with both connected, the direct line goes on Telegram alone", async () => {
  const accountHome = await accountHomeWith({ telegram: true, slack: true });
  const urls: string[] = [];
  const fake = (async (input: string | URL | Request) => {
    urls.push(String(input));
    return Response.json({ ok: true, result: { message_id: 1 } });
  }) as typeof fetch;
  const phone = phoneDirectOf(accountHome, { fetch: fake, log: () => {} });
  assert.equal(await phone.send("the account is down"), true);
  assert.deepEqual(urls.map((u) => new URL(u).host), ["api.telegram.org"], "one line, on one network");
  /* a Telegram file that is there but fails the rules is Telegram connected, unreadable: Slack is not tried for it */
  await chmod(join(accountHome, "credentials", "networks", "telegram.json"), 0o644);
  const logs: string[] = [];
  assert.equal(await phoneDirectOf(accountHome, { fetch: fake, log: (l) => { logs.push(l); } }).send("x"), false);
  assert.equal(urls.length, 1);
  assert.match(logs.at(-1)!, /telegram\.json can be read by other users/);
});

test("the watchdog's Slack address is Slack's own unless ACCOUNT_SLACK_API is a loopback one", async () => {
  assert.equal(slackApiOf({}), "https://slack.com/api");
  assert.equal(slackApiOf({ ACCOUNT_SLACK_API: "http://127.0.0.1:4999" }), "http://127.0.0.1:4999/api");
  assert.equal(slackApiOf({ ACCOUNT_SLACK_API: "http://127.0.0.1:4999/api" }), "http://127.0.0.1:4999/api");
  for (const other of ["https://evil.example/api", "http://localhost:4999", "http://127.0.0.1:4999/x", "http://127.0.0.1:99999"]) {
    assert.equal(slackApiOf({ ACCOUNT_SLACK_API: other }), "https://slack.com/api", other);
  }
  const accountHome = await accountHomeWith({ slack: true });
  const urls: string[] = [];
  const fake = (async (input: string | URL | Request) => { urls.push(String(input)); return Response.json({ ok: true, ts: "1730812345.001200" }); }) as typeof fetch;
  assert.equal(await phoneDirectOf(accountHome, { fetch: fake, log: () => {}, slackApi: "http://127.0.0.1:4999/api" }).send("x"), true);
  assert.deepEqual(urls, ["http://127.0.0.1:4999/api/chat.postMessage"]);
  const read = readNetworkFile(accountHome, "slack");
  assert.ok("botToken" in read && read.channel === "D0FAKEDM01");
  assert.ok("why" in readNetworkFile(accountHome, "telegram"));
});
