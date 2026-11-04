// face/tests/watchdog.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { checkHealth, contextOf, LABEL, OTHER_FACE, servicePlan, type HealthCode, type ServiceDeps } from "../scripts/service.ts";
import { accountHomeOf, accountSendOf, phoneDirectOf, readWatchdogState, runWatchdog, watchdogStatePath, type WatchdogDeps } from "../scripts/watchdog.ts";
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
      sendDirect: async (text) => { direct.push(text); },
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
