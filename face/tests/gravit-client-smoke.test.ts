/** The new client on a real boot: the page gravit-face serves at `/`, its
 * modules under `/client`, and the host layer (js/host/live.js over the page's
 * own api.js + mapper.js) listing, opening and reading a session over the
 * real wire — the stage-1 wiring of spec 2026-10-19 end to end.
 *
 * ONE BOOT PER PROCESS (smoke.test.ts header): `bootFace` sets
 * `process.env.DSH_HOME`, so this is its own file. The scratch home is a
 * `mkdtemp` directory, never `~/.dsh`, and AKShare is disabled.
 * @module
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupFaceProfile } from "../src/setup.ts";
import { bootFace } from "../src/boot.ts";
// allowJs (tsconfig): the browser modules are imported as they ship, untranspiled.
import { call, openMux } from "../client/js/wire/api.js";
import { mapFrame } from "../client/js/wire/mapper.js";
import { createStore } from "../client/js/store.js";
import { reducers } from "../client/js/reducers/index.js";
import { emptyState } from "../client/js/data/empty.js";
import { startLive } from "../client/js/host/live.js";
import { listConversations } from "../client/js/host/sessions.js";
import { makeBotsRoot } from "./bots-fixture.ts";
import { mountClient, signIn, remote } from "./remote.ts";

const gated = process.env.FACE_SMOKE !== "1";

/** Poll until `check` returns something truthy; fail naming `what` after `ms`. */
async function waitFor<T>(what: string, check: () => T | undefined | false, ms = 10_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

type Conversation = { id: string; kind: string; title: string; loaded: boolean; live: boolean; messages: unknown[] };
type State = { conversations: Conversation[]; status: { connected: boolean; line: string }; channels: { name: string; isRoot: boolean }[] };

test("gravit client smoke: the page at /, its modules under /client, and the live layer listing and opening a session on a real host", {
  skip: gated && "set FACE_SMOKE=1", timeout: 90_000,
}, async () => {
  const home = mkdtempSync(join(tmpdir(), "face-gravit-client-"));
  setupFaceProfile(home);
  const patchPath = join(home, "profiles", "face", "cordis.patch.yml");
  const patch = readFileSync(patchPath, "utf8").replace(/^\[\][ \t]*$/m, "");
  // This smoke owns a scratch profile and must not start the operator's data server.
  writeFileSync(patchPath, `${patch}\n- id: mcp-akshare\n  disabled: true\n- id: mcp-account\n  disabled: true\n`);
  const { ctx, dispose } = await bootFace({ profileName: "face", port: 0, dshHome: home, botsRoot: await makeBotsRoot() });

  const scope = globalThis as Record<string, unknown>;
  const realFetch = globalThis.fetch;
  const realSocket = globalThis.WebSocket;
  const realLocation = scope.location;
  let live: ReturnType<typeof startLive> | null = null;
  try {
    mountClient(ctx);
    const port = ctx.webServer.port;
    const base = `http://127.0.0.1:${port}`;
    const cookie = await signIn(ctx, base);

    // 1. the page and its modules, as a browser would fetch them
    const page = await realFetch(`${base}/`, { headers: { cookie } });
    assert.equal(page.status, 200);
    const body = await page.text();
    assert.match(body, /<title>Gravit<\/title>/);
    assert.match(body, /src="\/client\/js\/app\.js"/);
    for (const [path, type] of [["/client/js/host/live.js", "text/javascript"], ["/client/js/wire/api.js", "text/javascript"], ["/client/js/host/markets.js", "text/javascript"], ["/client/js/host/modules-view.js", "text/javascript"], ["/client/js/host/modules.js", "text/javascript"], ["/client/js/render/modules.js", "text/javascript"], ["/client/js/host/run-sheet-view.js", "text/javascript"], ["/client/js/host/run-sheet.js", "text/javascript"], ["/client/js/render/run-sheet.js", "text/javascript"], ["/client/css/app.css", "text/css"]] as const) {
      const res = await realFetch(base + path);
      assert.equal(res.status, 200, path);
      assert.match(res.headers.get("content-type") ?? "", new RegExp(type), path);
    }
    assert.equal((await realFetch(`${base}/client/chat.js`)).status, 404, "the old chat page is gone");
    assert.equal((await realFetch(`${base}/client/js/wire/market-quotes.js`)).status, 404, "the face's own quote wire is gone");
    for (const path of ["/market", "/account"]) assert.equal((await realFetch(base + path)).status, 404, `${path}: the old page is gone`);

    /* 2. the browser, as far as the modules can tell: same-origin relative
     * `fetch` with the cookie attached, and a WebSocket that sends it too. */
    scope.location = { protocol: "http:", host: `127.0.0.1:${port}` };
    globalThis.fetch = ((input: string | URL | Request, init: RequestInit = {}) =>
      realFetch(new URL(String(input), base), {
        ...init,
        headers: { ...(init.headers as Record<string, string> | undefined), cookie },
      })) as typeof fetch;
    globalThis.WebSocket = class extends realSocket {
      constructor(url: string | URL) {
        super(url, { headers: { cookie } } as unknown as string[]);
      }
    } as typeof WebSocket;

    // 3. a session to list, created the way the new-message screen creates one
    const created = await remote<{ sessionId: string }>(base, cookie, "session/create", { request: {} });
    assert.equal(typeof created.sessionId, "string");

    // 4. the live layer on the real wire: ready → the list → the conversation record
    const store = createStore({ initial: emptyState(), reducers });
    const timers = { after: (ms: number, fn: () => void) => setTimeout(fn, ms) };
    live = startLive({ store, openMux, call, mapFrame, getJson: (p: string) => fetch(p).then((r) => r.json()), timers });
    const state = () => store.get() as unknown as State;
    await waitFor("the list to carry the session", () => state().conversations.some((c) => c.id === created.sessionId));
    assert.equal(state().status.connected, true);
    const conv = state().conversations.find((c) => c.id === created.sessionId)!;
    assert.equal(conv.kind, "gravit");
    assert.equal(conv.title, "Untitled");
    // a bare bootFace mounts no /data route (main.ts does), so the index is unreachable here: the list still lands, with no channels
    assert.deepEqual(state().channels, [], "a missing channel index is tolerated, not fatal");

    // the same list through the pure reader, for the record
    const raw = await remote<{ items: unknown[] }>(base, cookie, "session/list", { _request: {} });
    const read = listConversations(raw.items, { presets: {}, bots: new Map(), channelOf: () => null, rooms: new Map(), lastSeen: {}, archived: new Set(), deleted: new Set() });
    assert.ok(read.some((c: { id: string }) => c.id === created.sessionId));

    // 5. opening it: a session just created is live (its agent is attached), so the read is a follow whose snapshot is the window;
    // a cold one would be paged instead (live.test.js pins both paths against a fake host)
    assert.equal(conv.live, true, "session/create attaches the agent, so the list reports it live");
    live.open(created.sessionId);
    const opened = await waitFor("the window", () => { const c = state().conversations.find((x) => x.id === created.sessionId); return c?.loaded ? c : undefined; });
    assert.ok(Array.isArray(opened.messages));
    assert.equal(state().status.line, "", "no complaint on the status line");
  } finally {
    live?.close();
    globalThis.fetch = realFetch;
    globalThis.WebSocket = realSocket;
    scope.location = realLocation;
    await dispose();
  }
});
