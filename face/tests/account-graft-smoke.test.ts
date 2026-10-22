/** The Account grafted into the face, on a real boot (spec 2026-10-22 §10): the Account's own stand-in (no network,
 * a fresh temp home), the face booted with `FACE_ACCOUNT_URL` at it, and the screens' reads asked of the face's own
 * port as the page asks them — the Account's page, its markets, a query the whitelist refuses, its push channel, and
 * the seat box through the proxy's shared reader.
 *
 * Skipped unless `FACE_SMOKE=1` and `FACE_ACCOUNT_SEAT_DIR` names an installed checkout of
 * linqizhe07/buyer-agent-demo (`npm ci` there), as `account-seat-smoke` is: the checkout is read, never written; the
 * stand-in takes a free port, never the real Account's 4820. `bootFace` registers no `/data` route (`main.ts` does,
 * after it), so this test registers the proxy and the seat route on the booted web server itself, as `main.ts` does
 * with the composed seat row's URL. The seat row itself is disabled here: no seat process is spawned, so nothing is
 * written under the operator's `~/.buyer-agent-demo`.
 *
 * ONE BOOT PER PROCESS (smoke.test.ts header): `bootFace` sets `process.env.DSH_HOME`, so this is its own file. The
 * scratch home is a `mkdtemp` directory, never `~/.dsh`, and AKShare is disabled. This is the canary for the
 * Account's reads moving under the face, beside `account-seat-smoke`'s for its seat. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupFaceProfile } from "../src/setup.ts";
import { bootFace } from "../src/boot.ts";
import { registerAccountProxy } from "../src/account-proxy.ts";
import { registerSeatRoute, type SeatView } from "../src/seat.ts";
import { makeBotsRoot } from "./bots-fixture.ts";
import { freePort, standinSkip, startStandin, stopStandin, type Standin } from "./helpers/standin.ts";

const skip = standinSkip();

/** The stand-in's seeded agent, the seat the box looks for (`account-seat-smoke` admits it under this name). */
const SEEDED_AGENT_NAME = "Claude Code";
/** This reader's name on the stream, in the Account's grammar (8 to 48 letters, digits, dashes or underscores). */
const STREAM_CLIENT = "face-smoke0000000000000000";
/** How long the stream has to tell its first frame. */
const FIRST_FRAME_MS = 5_000;

/** The first frame the stream names (an `event:` line, its `data:` with it) within `ms`, or what came instead. */
async function firstFrame(res: Response, ms: number): Promise<{ event: string | undefined; data: string | undefined; heard: string }> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const timer = setTimeout(() => void reader.cancel(), ms);
  let heard = "";
  try {
    for (;;) {
      const blocks = heard.split("\n\n").slice(0, -1);
      const named = blocks.find((block) => /^event:/m.test(block));
      if (named !== undefined) return { event: /^event: ?(.*)$/m.exec(named)?.[1], data: /^data: ?(.*)$/m.exec(named)?.[1], heard };
      const { done, value } = await reader.read();
      if (done) return { event: undefined, data: undefined, heard };
      heard += decoder.decode(value, { stream: true });
    }
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => undefined);
  }
}

test("account graft smoke: the Account's page and markets, a refused query, its push channel and the seat box, through the face's own port", {
  skip, timeout: 240_000,
}, async () => {
  const standin: Standin = await startStandin(await freePort());
  const home = mkdtempSync(join(tmpdir(), "face-graft-home-"));
  const wasUrl = process.env.FACE_ACCOUNT_URL;
  let dispose: (() => Promise<void>) | undefined;
  let disposeProxy: (() => void) | undefined;
  try {
    /* 1. A scratch face home, AKShare and the seat row off; the face booted with the stand-in as its Account. */
    setupFaceProfile(home);
    const patchPath = join(home, "profiles", "face", "cordis.patch.yml");
    writeFileSync(patchPath, `${readFileSync(patchPath, "utf8").replace(/^\[\][ \t]*$/m, "")}\n- id: mcp-akshare\n  disabled: true\n- id: mcp-account\n  disabled: true\n`);
    process.env.FACE_ACCOUNT_URL = standin.url;
    const booted = await bootFace({ profileName: "face", port: 0, dshHome: home, botsRoot: await makeBotsRoot() });
    dispose = booted.dispose;
    const proxy = registerAccountProxy(booted.ctx.webServer, { url: standin.url });
    disposeProxy = proxy.dispose;
    registerSeatRoute(booted.ctx.webServer, { url: standin.url, seatName: SEEDED_AGENT_NAME, reader: proxy.reader });
    const base = `http://127.0.0.1:${booted.ctx.webServer.port}`;
    const said = `\nstand-in:\n${standin.log()}`;

    /* 2. The Account's page, as the Account answers it. */
    const page = await fetch(`${base}/data/account`);
    const pageBody = await page.json() as { ok?: unknown; venues?: unknown };
    assert.equal(page.status, 200, JSON.stringify(pageBody).slice(0, 400) + said);
    assert.equal(pageBody.ok, true);
    assert.ok(Array.isArray(pageBody.venues) && pageBody.venues.length > 0, `the page names its venues: ${JSON.stringify(pageBody.venues)}`);

    /* 3. Its markets. */
    const explore = await fetch(`${base}/data/account/explore`);
    const exploreBody = await explore.json() as { ok?: unknown; items?: unknown };
    assert.equal(explore.status, 200, JSON.stringify(exploreBody).slice(0, 400));
    assert.ok(Array.isArray(exploreBody.items) && exploreBody.items.length > 0, "explore lists the Account's markets");

    /* 4. A query name the whitelist does not carry: refused by the face, never asked of the Account. */
    const forced = await fetch(`${base}/data/account/explore?force=1`);
    assert.equal(forced.status, 400);
    assert.deepEqual(await forced.json(), { ok: false, error: "invalid account request" });

    /* 5. The push channel, piped: an event stream, and a frame the Account names within 5 s. */
    const abort = new AbortController();
    try {
      const stream = await fetch(`${base}/data/account/stream?client=${STREAM_CLIENT}`, { headers: { accept: "text/event-stream" }, signal: abort.signal });
      if (stream.status !== 200) assert.fail(`the stream answered ${stream.status}: ${(await stream.text()).slice(0, 400)}`);
      assert.match(stream.headers.get("content-type") ?? "", /^text\/event-stream/);
      const frame = await firstFrame(stream, FIRST_FRAME_MS);
      assert.ok(frame.event !== undefined, `no named frame in ${FIRST_FRAME_MS / 1000} s; heard ${JSON.stringify(frame.heard.slice(0, 400))}`);
      assert.doesNotThrow(() => JSON.parse(frame.data ?? ""), `the ${frame.event} frame carries JSON: ${String(frame.data).slice(0, 200)}`);
    } finally {
      abort.abort();
    }

    /* 6. The seat box, read through the proxy's own reader: the Account reachable. */
    const seat = await fetch(`${base}/data/seat.json`);
    assert.equal(seat.status, 200);
    const view = await seat.json() as SeatView;
    assert.equal(view.reachable, true, JSON.stringify(view));
  } finally {
    /* The web server first, then the proxy's open pipes (main.ts's order), then the stand-in and the homes. */
    if (dispose) await dispose();
    disposeProxy?.();
    if (wasUrl === undefined) delete process.env.FACE_ACCOUNT_URL; else process.env.FACE_ACCOUNT_URL = wasUrl;
    await stopStandin(standin);
    await rm(home, { recursive: true, force: true });
  }
});
