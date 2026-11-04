// face/tests/desk-carry-smoke.test.ts
/** A graceful stop on a REAL composed tree carries the phone's part through the desk ledger (spec §16 H3, R93; the
 * measurement it guards, .superpowers/sdd/2026-11-02-desk-hardening/graceful-stop-measurement.md, case 1). dsh's
 * teardown clears the desk session's inbox whatever the desk's own cancel keeps, so a text queued behind a turn under way
 * at a graceful stop survives only in the ledger's `desk-carry`. This is the check that guards that across dsh upgrades:
 * 1. the first face: the desk as main.ts installs it; a phone text (`LONG`, Telegram's message 1, the account's inbox 1)
 *    whose model call hangs until its abort, a second (`QUEUED`, message and inbox 2) queued behind it, then main.ts's
 *    shutdown - `desk.dispose(0)`, then
 *    the tree's own dispose - and the process exits;
 * 2. a fresh face on the same home: its boot resumes the desk session, posts `QUEUED` again under its own key with
 *    `(carried over a restart)` in its provenance line, the model answers it once, the phone gets the restart line for
 *    `LONG` and then `QUEUED`'s answer, and the ledger holds the `desk-carry` and its `desk-carried`; and the root context
 *    hears dsh-agent's `agent/inbox/claimed` for `QUEUED`, the event the conversation's carry reads a claimed but
 *    unlogged text from (src/desk.ts `claimsOf`).
 *
 * TWO PROCESSES. A face boots once per process (smoke.test.ts), and a restart is two boots, so the test runs this file
 * twice as a child - `one`, then `two` - on one fixture home, and reads what the second reports as a JSON line. The
 * model is a stub on `stub/echo` answering `echo <text>`, `LONG` hanging until its abort in the first; AKShare is off;
 * the second face's phone is a fake account (tests/fake-phone-account.ts) its bridge reads and sends through, as
 * main.ts's does - its outlet set before its boot's carry can deliver - and what reached its send route is reported.
 *
 * WHERE IT RUNS. `tests/tmp/desk-carry-smoke-<pid>/`, inside the repository: `repo/` (the desk root), `home/` (the harness
 * home), `bots/`. `FACE_ACCOUNT_URL` points the children at a closed port, so no face pairs with a running Account; the
 * second face's phone is its own fake account.
 *
 * Own file, gated: FACE_SMOKE=1.
 * @module
 */
import "./helpers/no-market.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Context } from "@deepseek-ai/cordis";
import { installModelSelection } from "@deepseek-ai/dsh-agent";
import type { GenerateOptions, StreamChunk } from "@deepseek-ai/dsh-llm";
import { bootFace } from "../src/boot.ts";
import { installDesk, readEvents, type DeskEvent } from "../src/desk.ts";
import type { DeskConversationCtxLike } from "../src/desk-conversation.ts";
import type { DeskSessionDeps } from "../src/desk-session.ts";
import { deliveryKey } from "../src/phone-bridge.ts";
import { createPhoneClient, type PhoneClient } from "../src/phone.ts";
import { setupFaceProfile } from "../src/setup.ts";
import { GRAVIT_PLUGIN_ABS, populateBotsRoot } from "./bots-fixture.ts";
import { fakePhoneAccount } from "./fake-phone-account.ts";
import { StubAdapter } from "./stub-llm.ts";

const gated = process.env.FACE_SMOKE !== "1";
const HERE = dirname(fileURLToPath(import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const STUB = { provider: "stub", model: "echo" };
/** What the second face reports, on one line of its stdout. */
const REPORT = "DESK-CARRY-REPORT ";

/** The fixture, by its base directory: `repo/`, `home/` and `bots/` under it. */
const paths = (base: string) => ({ base, root: join(base, "repo"), home: join(base, "home"), bots: join(base, "bots") });

type Message = GenerateOptions["messages"][number];
const textOf = (m: Message): string => m.content.map((b) => ("text" in b ? b.text : "")).join("\n");
/** The last phone message a model call answers, whole: its provenance line, then the operator's text. */
const lastPhone = (r: GenerateOptions): string => {
  for (let i = r.messages.length - 1; i >= 0; i--) {
    if (((r.messages[i].source ?? {}) as { kind?: unknown }).kind === "telegram") return textOf(r.messages[i]);
  }
  return "";
};
const wordOf = (text: string): string => text.split("\n").pop() ?? "";

async function waitFor(what: string, check: () => boolean | Promise<boolean>, ms = 30_000): Promise<void> {
  const until = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((done) => setTimeout(done, 20));
  }
}

/** A promise that rejects once `signal` aborts. */
const untilAbort = (signal: AbortSignal | undefined): Promise<never> => new Promise((_, fail) => {
  if (signal === undefined) return;
  if (signal.aborted) fail(signal.reason);
  signal.addEventListener("abort", () => fail(signal.reason), { once: true });
});

/** The face booted on the fixture with the desk installed as main.ts installs it; `hang` names the texts whose model
 * call waits for its abort. Every main-route model call is kept, with the phone message it answers. */
async function bootDesk(base: string, hang: ReadonlySet<string>, phone?: PhoneClient) {
  const { root, home, bots } = paths(base);
  const booted = await bootFace({ profileName: "face", port: 0, dshHome: home, botsRoot: bots });
  const { ctx } = booted;
  const requests: string[] = [];
  /* what the desk conversation hears through src/desk.ts `claimsOf`: dsh-agent's claims, on the root context */
  const claimed: string[] = [];
  (ctx as unknown as { on(name: string, listener: (payload: { message: { id: string } }) => void): unknown })
    .on("agent/inbox/claimed", ({ message }) => { claimed.push(message.id); });
  class Stub extends StubAdapter {
    override async *stream(o: GenerateOptions): AsyncIterable<StreamChunk> {
      const phone = lastPhone(o);
      if (o.purpose === undefined) {
        requests.push(phone);
        if (hang.has(wordOf(phone))) await untilAbort((o as { signal?: AbortSignal }).signal);
      }
      yield* super.stream(o);
    }
  }
  ctx.llm.registerAdapter([STUB.provider], new Stub((o) => ({ kind: "text", text: `echo ${wordOf(lastPhone(o))}` })));
  const install: NonNullable<DeskSessionDeps["installModelSelection"]> = (agentCtx, ref) => installModelSelection(agentCtx as unknown as Context, ref);
  const desk = installDesk(ctx.webServer, {
    home, enabled: true, ctx, root, route: STUB, sessionCtx: ctx as unknown as DeskConversationCtxLike,
    installModelSelection: install, log: (line) => { console.error(line); },
    quotes: { snapshot: async () => ({ ok: true, generated_at: new Date().toISOString(), quotes: [], providers: [] }) },
    ...(phone === undefined ? {} : { phone }),
  });
  const conversation = desk.conversation!;
  await waitFor("the desk session", () => conversation.current().sessionId !== undefined);
  return { booted, ctx, desk, conversation, requests, claimed };
}

/** When the two texts were written: a minute before the first face's boot. */
const WRITTEN = new Date(Date.now() - 60_000).toISOString();
/** The key the bridge posts the account's inbox message `n` under (Telegram's message `n` too). */
const keyOf = (n: number): string => deliveryKey({ id: n, messageId: `telegram:${n}`, at: WRITTEN });
/** A phone text, keyed and shaped as the bridge posts the account's inbox message `n`. */
const phone = (d: Awaited<ReturnType<typeof bootDesk>>, text: string, n: number) => d.conversation.post({
  text, key: keyOf(n), source: { kind: "telegram", at: Date.parse(WRITTEN) },
  message: { kind: "telegram", network: "telegram", messageId: `telegram:${n}` },
});

/** The first face: LONG under way, QUEUED behind it, then main.ts's graceful shutdown. */
async function phaseOne(base: string): Promise<void> {
  const { root, home, bots } = paths(base);
  await mkdir(join(root, "desk"), { recursive: true });
  await mkdir(bots, { recursive: true });
  await populateBotsRoot(bots, GRAVIT_PLUGIN_ABS);
  setupFaceProfile(home);
  const patchPath = join(home, "profiles", "face", "cordis.patch.yml");
  const patch = readFileSync(patchPath, "utf8").replace(/^\[\][ \t]*$/m, "");
  writeFileSync(patchPath, [patch, "- id: mcp-akshare", "  disabled: true", "- id: agent-default-model", "  config:",
    `    provider: ${STUB.provider}`, `    model: ${STUB.model}`, ""].join("\n"));
  const d = await bootDesk(base, new Set(["LONG"]));
  const long = await phone(d, "LONG", 1);
  if (!("opened" in long)) throw new Error(`LONG was refused: ${JSON.stringify(long)}`);
  await waitFor("LONG's model call", () => d.requests.some((r) => wordOf(r) === "LONG"));
  const queued = await phone(d, "QUEUED", 2);
  if (!("opened" in queued)) throw new Error(`QUEUED was refused: ${JSON.stringify(queued)}`);
  await d.desk.dispose(0);
  await d.booted.dispose();
}

/** The second face: what its boot did with the carry, reported once QUEUED's answer has left. */
async function phaseTwo(base: string): Promise<void> {
  const account = await fakePhoneAccount();
  const d = await bootDesk(base, new Set(), createPhoneClient({ url: account.url, secrets: [] }));
  const sent = (): unknown[] => account.texts();
  await waitFor("QUEUED's answer", () => sent().includes("echo QUEUED"));
  await new Promise((done) => setTimeout(done, 1_000)); // anything sent twice would land by now
  const events = (await readEvents(paths(base).home)).events;
  console.log(`${REPORT}${JSON.stringify({ requests: d.requests, sent: sent(), sends: account.sends, events, claimed: d.claimed })}`);
  await d.desk.dispose(0);
  await d.booted.dispose();
  await account.close();
}

if (process.argv[2] === "one" || process.argv[2] === "two") {
  const base = process.argv[3];
  try {
    await (process.argv[2] === "one" ? phaseOne(base) : phaseTwo(base));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
} else {
  test("desk carry smoke: a graceful stop with a text queued behind a turn, and a fresh boot answers it, marked carried", {
    skip: gated && "set FACE_SMOKE=1", timeout: 240_000,
  }, async () => {
    const base = join(HERE, "tmp", `desk-carry-smoke-${process.pid}`);
    await rm(base, { recursive: true, force: true });
    /** This file as a child, phase `phase`: its exit code and its stdout. */
    const run = (phase: string) => new Promise<{ code: number | null; out: string; err: string }>((done, fail) => {
      const child = spawn(process.execPath, ["--import", "tsx", SELF, phase, base], {
        cwd: join(HERE, ".."), stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, FACE_ACCOUNT_URL: "http://127.0.0.1:9" },
      });
      let out = "";
      let err = "";
      child.stdout.on("data", (b: Buffer) => { out += b.toString(); });
      child.stderr.on("data", (b: Buffer) => { err += b.toString(); });
      const kill = setTimeout(() => { child.kill("SIGKILL"); }, 100_000);
      child.on("exit", (code) => { clearTimeout(kill); done({ code, out, err }); });
      child.on("error", fail);
    });
    try {
      const one = await run("one");
      assert.equal(one.code, 0, `the first face: ${one.err}`);
      const two = await run("two");
      assert.equal(two.code, 0, `the second face: ${two.err}`);
      const line = two.out.split("\n").find((l) => l.startsWith(REPORT));
      assert.ok(line !== undefined, `the second face reported nothing: ${two.out}\n${two.err}`);
      const report = JSON.parse(line.slice(REPORT.length)) as { requests: string[]; sent: string[]; sends: Record<string, unknown>[]; events: DeskEvent[]; claimed: string[] };
      const carriedKey = report.claimed.find((id) => id.startsWith("telegram:2#2@"));
      assert.ok(carriedKey !== undefined, `the root context hears agent/inbox/claimed: ${JSON.stringify(report.claimed)}`);

      const carries = report.events.filter((e): e is Extract<DeskEvent, { kind: "desk-carry" }> => e.kind === "desk-carry");
      assert.equal(carries.length, 1, "one carry, from the first face's dispose");
      const carry = carries[0];
      assert.deepEqual(carry.queued.map((q) => [q.key, q.text, typeof q.at]), [[carriedKey, "QUEUED", "string"]]);
      assert.equal(carry.cut?.turn, 1, "LONG's turn, under way");
      assert.match(String(carry.cut?.key), /^telegram:1#1@/);
      assert.equal(typeof carry.cut?.at, "string");
      const kinds = report.events.map((e) => e.kind);
      assert.ok(kinds.indexOf("desk-carry") < kinds.indexOf("shutdown"), `the carry comes before the shutdown: ${kinds.join(", ")}`);
      assert.deepEqual(report.events.filter((e) => e.kind === "desk-carried").map((e) => ({ ...e, t: "" })),
        [{ t: "", kind: "desk-carried", of: carry.t, posted: 1, skipped: 0 }]);

      const queuedCalls = report.requests.filter((r) => wordOf(r) === "QUEUED");
      assert.equal(queuedCalls.length, 1, `QUEUED answered once by the second face: ${JSON.stringify(report.requests)}`);
      assert.match(queuedCalls[0], /^\[telegram · operator · [^\]]* ET \(carried over a restart\)\]\nQUEUED$/);
      assert.equal(report.requests.filter((r) => wordOf(r) === "LONG").length, 0, "LONG is not sent again: the phone is asked to");
      assert.equal(report.sent.length, 2, JSON.stringify(report.sent));
      assert.match(report.sent[0], /^a restart cut your message of .+ ET before it was answered; send it again$/);
      assert.equal(report.sent[1], "echo QUEUED");
      assert.deepEqual(report.sends.map((b) => [b.kind, b.network]), [["chat", "telegram"], ["chat", "telegram"]], "both through the account, as chat replies to telegram");
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
}
