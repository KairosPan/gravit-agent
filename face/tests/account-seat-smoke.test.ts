/** The Account seat, end to end but for the human (spec 2026-10-20 §10):
 * the Account's own stand-in (no network, a fresh temp home, writes on),
 * the seat process spawned by the face's `mcp-account` row and pointed at
 * it as the stand-in's seeded agent, Gate 2 holding the seat's writes, and
 * the stand-in answering an approved order with a CARD of its own.
 *
 * Skipped unless `FACE_SMOKE=1` and the repo's `account/` is installed
 * (`npm ci` there; `FACE_ACCOUNT_SEAT_DIR` names another install): the
 * install is read, never written — the seat's key is the stand-in's derived
 * one (`PORTFOLIO_SEAT_KEYS=sim`), its home a scratch directory, so nothing
 * lands in the operator's `~/.buyer-agent-demo`. This is the canary for the
 * Account moving under the face: a renamed write tool falls out of the gate's
 * list here, not offline. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupFaceProfile } from "../src/setup.ts";
import { bootFace, type FacePatchList } from "../src/boot.ts";
import { ACCOUNT_SEAT_ROW_ID, ACCOUNT_SEAT_SERVER, SEAT_TOOL_PREFIX, composedSeatRow, type SeatEntryLike } from "../src/account-seat.ts";
import { auditOrderTools, SEAT_WRITE_RAW_NAMES } from "../src/orders.ts";
import { registerSeatRoute, type SeatView } from "../src/seat.ts";
import { mountClient, remote, signIn } from "./remote.ts";
import { makeBotsRoot } from "./bots-fixture.ts";
import { STANDIN_CLI as CLI, STANDIN_DIR as DIR, freePort, standinSkip, startStandin, stopStandin } from "./helpers/standin.ts";

const skip = standinSkip();

/** The stand-in's seeded agent: `PORTFOLIO_SEAT_KEYS=sim` derives the key from this id, so the seat IS that agent. */
const SEEDED_AGENT_ID = "ui-standin-claude-code";
/** The name the stand-in admitted it under, which the route matches by. */
const SEEDED_AGENT_NAME = "Claude Code";
/** The real-account writes the seat registers (the simulated-only three never register against a real account). */
const REAL_WRITES = SEAT_WRITE_RAW_NAMES.filter((raw) => !["portfolio_order", "portfolio_execute", "portfolio_transfer"].includes(raw));

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const textOf = (result: { content?: { text?: string }[] }): string => result.content?.[0]?.text ?? "";

test("account seat smoke: the seat mounts, its writes are gated, a read answers, an order without a grant is refused and with one becomes the Account's card", {
  skip, timeout: 300_000,
}, async () => {
  const port = await freePort();
  const standin = await startStandin(port);
  const home = mkdtempSync(join(tmpdir(), "face-seat-home-"));
  const seatHome = mkdtempSync(join(tmpdir(), "face-seat-buyer-home-"));
  const cleanups: (() => void)[] = [];
  let dispose: (() => Promise<void>) | undefined;
  try {
    /* 1. A scratch face home, its profile patch as setup writes it: the seat
     * row ON and replaced whole by this test's config (the operator's own
     * override path: an id patch with `config`), pointed at the stand-in as its
     * seeded agent, the seat's home a scratch directory. */
    setupFaceProfile(home);
    const extraPatches: FacePatchList = [{
      id: ACCOUNT_SEAT_ROW_ID,
      config: {
        transport: "stdio", serverName: ACCOUNT_SEAT_SERVER, command: process.execPath, args: [CLI, "src/portfolio/mcp.ts"], cwd: DIR,
        env: { PORTFOLIO_URL: standin.url, PORTFOLIO_AGENT: SEEDED_AGENT_ID, PORTFOLIO_SEAT_KEYS: "sim", BUYER_HOME: seatHome },
        toolCallTimeoutMs: 90_000, failOnStartupError: false,
      },
    } as unknown as FacePatchList[number]];
    const booted = await bootFace({ profileName: "face", port: 0, dshHome: home, botsRoot: await makeBotsRoot(), extraPatches });
    dispose = booted.dispose;
    const { ctx } = booted;
    const tools = ctx.get("tools") as {
      schemas(scope?: object): { name: string; description?: string }[];
      execute(exec: { callId: string; name: string; arguments: unknown; agent: object; signal: AbortSignal }): Promise<{ isError: boolean; content?: { type?: string; text?: string }[] }>;
    };

    /* 2. The seat mounts: its 36 real-account tools, the nine writes gated, no
     * read gated, the seat covered. */
    const deadline = Date.now() + 120_000;
    let names: string[] = [];
    while (Date.now() < deadline) {
      names = tools.schemas().map((schema) => schema.name);
      if (names.includes(`${SEAT_TOOL_PREFIX}portfolio_account`)) break;
      await sleep(500);
    }
    const seatNames = names.filter((name) => name.startsWith(SEAT_TOOL_PREFIX)).sort();
    assert.equal(seatNames.length, 36, `the seat's 36 real-account tools; saw ${seatNames.length}: ${seatNames.join(", ")}\nstand-in:\n${standin.log()}`);
    const audit = auditOrderTools(tools.schemas());
    const gatedSeat = audit.gated.filter((name) => name.startsWith(SEAT_TOOL_PREFIX)).sort();
    assert.deepEqual(gatedSeat, REAL_WRITES.map((raw) => `${SEAT_TOOL_PREFIX}${raw}`).sort(), "exactly the seat's real-account writes are gated");
    assert.deepEqual(audit.uncovered, [], "the seat is covered");
    for (const read of ["portfolio_account", "portfolio_holdings", "portfolio_wait", "portfolio_live_preview", "portfolio_akshare"]) assert.ok(seatNames.includes(`${SEAT_TOOL_PREFIX}${read}`), read);

    /* 3. A real session with an open turn, and the outermost answerer, as the
     * order-gate smoke does. */
    const base = `http://127.0.0.1:${ctx.webServer.port}`;
    mountClient(ctx);
    const cookie = await signIn(ctx, base);
    const created = await remote<{ sessionId: string }>(base, cookie, "session/create", { request: { cwd: home } });
    const agents = ctx.get("agents") as { get(id: string): { session: { append(type: string, data: object): unknown } } | undefined };
    const agent = agents.get(created.sessionId);
    assert.ok(agent, "session/create leaves a live agent");
    agent.session.append("turn/start", { turn: 1 });
    let answer: "allowed-once" | "rejected" = "rejected";
    const seen: { toolName?: string; callId?: string; reason?: string }[] = [];
    const on = ctx.on as unknown as (name: "approval/request", listener: (req: { toolName?: string; callId?: string; reason?: string }, next: () => Promise<string>) => Promise<string>, options: { prepend: boolean }) => () => void;
    cleanups.push(on.call(ctx, "approval/request", (req) => { seen.push({ toolName: req.toolName, callId: req.callId, reason: req.reason }); return Promise.resolve(answer); }, { prepend: true }));
    const signal = new AbortController().signal;
    const run = (callId: string, name: string, args: unknown) => tools.execute({ callId, name, arguments: args, agent, signal });

    /* 4. A read is never gated: the seat answers as the stand-in's seeded,
     * admitted agent, with its paper venue. */
    const account = await run("seat-account", `${SEAT_TOOL_PREFIX}portfolio_account`, {});
    assert.equal(account.isError, false, textOf(account));
    const standing = JSON.parse(textOf(account)) as { seat?: { authorised?: boolean; status?: string }; paperVenues?: string[] };
    assert.equal(standing.seat?.authorised, true, JSON.stringify(standing.seat));
    assert.ok(standing.paperVenues?.includes("paper-momentum"), JSON.stringify(standing.paperVenues));
    assert.equal(seen.length, 0, "no card for a read");

    /* 5. A market at the stand-in's exchange, where the seeded agent holds a
     * trade limit. */
    const markets = await run("seat-markets", `${SEAT_TOOL_PREFIX}portfolio_live_markets`, { venue: "ex" });
    const listed = JSON.parse(textOf(markets)) as { markets?: { symbol?: string }[] };
    const symbol = listed.markets?.[0]?.symbol;
    assert.ok(typeof symbol === "string" && symbol !== "", textOf(markets).slice(0, 400));
    const order = { venue: "ex", symbol, side: "buy", usd: 10 };

    /* 6. REJECTED at the face's card: the seat signs nothing, the model hears
     * the refusal in dsh's words, the card named the seat and the venue. */
    const rejected = await run("seat-rejected", `${SEAT_TOOL_PREFIX}portfolio_live_order`, order);
    assert.equal(rejected.isError, true, "a rejected seat order must not reach the seat");
    assert.match(textOf(rejected), /the user rejected tool "mcp__account__portfolio_live_order"/);
    assert.equal(seen.length, 1);
    assert.match(String(seen[0]?.reason), /^Account seat - mcp__account__portfolio_live_order: side=buy usd=10 symbol=.* venue=ex/);

    /* 7. ALLOWED-ONCE: the call reaches the seat, the seat signs it, and the
     * stand-in in Guard answers with a card of its own — the whole chain but
     * the human who signs it there. */
    answer = "allowed-once";
    const carded = await run("seat-approved", `${SEAT_TOOL_PREFIX}portfolio_live_order`, order);
    assert.equal(carded.isError, false, textOf(carded));
    const answered = JSON.parse(textOf(carded)) as { ok?: boolean; pending?: boolean; card?: { id?: string } };
    assert.equal(answered.pending, true, textOf(carded).slice(0, 400));
    assert.match(String(answered.card?.id), /^card-/);
    assert.equal(seen.length, 2);

    /* 7b. A batch: the card describes every leg (the final review's
     * Critical 1), and in Guard the stand-in answers each leg with a card. */
    /* two legs above the exchange's smallest order ($5 is refused there, not carded) */
    const batch = await run("seat-batch", `${SEAT_TOOL_PREFIX}portfolio_live_batch`, { legs: [order, { ...order, usd: 12 }] });
    assert.equal(batch.isError, false, textOf(batch));
    assert.match(String(seen[2]?.reason), /^Account seat - mcp__account__portfolio_live_batch: legs=\[1: side=buy usd=10 symbol=.* venue=ex; 2: side=buy usd=12 symbol=.* venue=ex\]$/);
    const legs = (JSON.parse(textOf(batch)) as { legs?: { pending?: boolean; card?: { id?: string } }[] }).legs ?? [];
    assert.equal(legs.length, 2, textOf(batch).slice(0, 400));
    assert.ok(legs.every((leg) => leg.pending === true && typeof leg.card?.id === "string"), `each leg waits on a card of its own in Guard: ${textOf(batch).slice(0, 600)}`);

    /* 8. The route reads the stand-in as the face would: the seat admitted
     * under its seeded name until a day the Account names, the paper venue
     * marked, the cards just raised. */
    const loader = ctx.get("loader") as { entries(): Iterable<SeatEntryLike> };
    assert.deepEqual(composedSeatRow(loader.entries()), { disabled: false, url: standin.url, seatName: SEEDED_AGENT_ID }, "the box reads the row as composed, this test's patch included");
    registerSeatRoute(ctx.webServer, { url: standin.url, seatName: SEEDED_AGENT_NAME });
    const read = await fetch(`${base}/data/seat.json?fresh=1`);
    assert.equal(read.status, 200);
    const view = await read.json() as SeatView;
    assert.equal(view.reachable, true, JSON.stringify(view));
    assert.equal(view.seat?.status, "admitted", JSON.stringify(view.seat));
    assert.ok(typeof view.seat?.validUntil === "number" && view.seat.validUntil > Date.now(), `the Account's ISO expiry reaches the box as milliseconds: ${JSON.stringify(view.seat)}`);
    assert.ok(view.seat?.limits.some((l) => typeof l.validUntil === "number"), "a limit's expiry too");
    assert.ok(view.venues?.some((v) => v.id === "paper-momentum" && v.paper === true), JSON.stringify(view.venues));
    assert.ok((view.cards?.length ?? 0) >= 1, `the card the seat raised waits on the Account page: ${JSON.stringify(view.cards)}`);
    assert.ok(view.cards?.some((c) => c.id === answered.card?.id), "and it is that card");
  } finally {
    for (const off of cleanups) off();
    if (dispose) await dispose();
    await stopStandin(standin);
    await rm(home, { recursive: true, force: true });
    await rm(seatHome, { recursive: true, force: true });
  }
});
