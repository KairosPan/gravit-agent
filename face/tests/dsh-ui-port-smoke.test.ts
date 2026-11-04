/** The dsh UI port's host side on a real boot (plan 1 of the port, Task 6): what the face's
 * overlay rows and its own `/data/search` give the page, driven over the wire the page uses.
 *
 * - Pins: `workspace/pinSession` / `workspace/unpinSession` answer the pin set, and a
 *   `workspace/follow` stream over the page's own `openMux` carries it in its baseline and as a
 *   `pinned` frame after the pin.
 * - Commands and skills: `commands/list` on a live conversation names the five commands the
 *   composer offers; `skills/list` answers on a cold session without activating it.
 * - The projections: after one stub turn `session/projections` carries the `turnOutline` and
 *   `sessionStats` units (the `session-turn-outline` and `session-stats` rows).
 * - Jobs: a `job/list` stream (the `job-controller` row) opens with a `rows` frame.
 * - Earlier history: `session/page` with `beforeSeq` answers `{records, hasMore}`.
 * - An upload: `POST /api/session/uploadFileBinary` mints a receipt, and a prompt holding it is
 *   accepted on the stub model.
 * - The `session-reference` row is up: `ctx.get("sessionReferenceResolver")` is defined.
 * - Search: `src/search.ts` wired to the booted `sessionPersistence` as `main.ts` wires it finds a
 *   stub turn's Chinese prompt by a two-character query.
 * - The composer's three host facts (plan 3, Task 9): a cold conversation is resumed by
 *   `commands/list` and `commands/execute` alike (no `gateway/lookup-not-found` at rc.5), and after a
 *   `session/follow`'s snapshot (what `live.activate` waits on) a command answers; a project skill is offered by `skills/list` and its
 *   literal `/<name>` line reaches the model as its `<skill_content>`; a conversation chip
 *   serialized by the page's own `serialize` brings dsh's `## Referenced sessions` message.
 * - Attachments (plan 4, Task 9): a cold session's `session/projections` carries `imageLimits`; an
 *   image to the text-only stub is refused `MODEL_DOES_NOT_SUPPORT_IMAGES` and an unknown receipt
 *   `FILE_NOT_STAGED`; on `stub-see` (the stub declaring image input, picked by
 *   `session/selectModel`) the page's own `contentParts` prompt is logged as an image block and
 *   `session/attachment` gives its PNG back; `role-pdf-page-reader` is listed whole beside
 *   `read_image`; and `commands/execute` with an unknown receipt settles the text
 *   `host/actions.js`'s RECEIPT_UNKNOWN matches.
 *
 * ONE BOOT PER PROCESS (smoke.test.ts header): `bootFace` sets `process.env.DSH_HOME`, so this is
 * its own file, every test sharing the one boot. The scratch home is a `mkdtemp` directory, never
 * `~/.dsh`; the seat is disabled; the model is the stub (`tests/stub-llm.ts`), as goal-smoke's.
 * @module
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { GenerateOptions } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import { setupFaceProfile } from "../src/setup.ts";
import { bootFace } from "../src/boot.ts";
import { readMeta } from "../src/sessions.ts";
import { openSearchIndex, type SearchIndex } from "../src/search-index.ts";
import { makeSearch, readEventsFrom, registerSearchRoutes, type StoredSession } from "../src/search.ts";
import type { StoredEvent } from "../src/search-text.ts";
// allowJs (tsconfig): the browser module is imported as it ships, untranspiled.
import { openMux } from "../client/js/wire/api.js";
import { serialize } from "../client/js/composer/draft.js";
import { contentParts } from "../client/js/composer/files.js";
import { makeBotsRoot } from "./bots-fixture.ts";
import { mountClient, remote, remoteResult, signIn } from "./remote.ts";
import { StubAdapter, type StubReply } from "./stub-llm.ts";
import type { LlmModelInfo, LlmResolvedModelInfo } from "@deepseek-ai/dsh-llm";

const gated = process.env.FACE_SMOKE !== "1";
const skip = gated && "set FACE_SMOKE=1";
const SEARCH_PROMPT = "贵州茅台的估值很高，宁德时代下跌了";
const UI_PORT_PROBE_BODY = "UI_PORT_PROBE_BODY: answer with the probe's marker.";

/** A valid 1 x 1 PNG, base64. */
const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** The stub with eyes: the same scripted route, its model declaring text and image input (provider `stub-see`). */
class SeeingStubAdapter extends StubAdapter {
  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve([{ provider, id: "echo", name: "echo", inputModalities: ["text", "image"] }]);
  }
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, inputModalities: ["text", "image"], context: { contextWindow: 128_000 } });
  }
}

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor<T>(what: string, check: () => T | undefined | false, ms = 10_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await settle(10);
  }
}

/** Every request the stub model saw, the title model's included, in order. */
const requests: GenerateOptions[] = [];
/** The stub's reply: a text answer to every request, recorded first. */
const script = (request: GenerateOptions): StubReply => {
  requests.push(request);
  return { kind: "text", text: "STUB_OK" };
};
/** One request's messages as text, to look for what dsh put in them. */
const textOf = (request: GenerateOptions) => JSON.stringify(request.messages);

interface Booted {
  ctx: any;
  dispose: () => Promise<void>;
  base: string;
  cookie: string;
  root: string;
  index: SearchIndex;
  rpc: <T = unknown>(endpoint: string, args: object) => Promise<T>;
  /** One call's raw outcome, for a refusal's code. */
  rpcResult: (endpoint: string, args: object) => ReturnType<typeof remoteResult>;
  /** A fresh live conversation in the scratch root. */
  open: () => Promise<string>;
  /** One prompt, then the agent idle again. */
  turn: (sessionId: string, content: object[]) => Promise<void>;
  agentOf: (sessionId: string) => Agent | undefined;
}
let face: Booted | undefined;
const scope = globalThis as Record<string, unknown>;
const realFetch = globalThis.fetch;
const realSocket = globalThis.WebSocket;
const realLocation = scope.location;
const muxes: { close(): void }[] = [];

before(async () => {
  if (gated) return;
  const root = await realpath(await mkdtemp(join(tmpdir(), "face-ui-port-root-")));
  const home = await mkdtemp(join(tmpdir(), "face-ui-port-home-"));
  await mkdir(join(root, ".git"));
  await writeFile(join(root, "GRAVIT.md"), "# fixture\n");
  /* A project skill (dsh-skill-filesystem's `<projectRoot>/.dsh/skills/<name>/SKILL.md`), before the boot. */
  await mkdir(join(root, ".dsh", "skills", "ui-port-probe"), { recursive: true });
  await writeFile(join(root, ".dsh", "skills", "ui-port-probe", "SKILL.md"),
    `---\nname: ui-port-probe\ndescription: The UI port smoke's probe skill.\n---\n\n${UI_PORT_PROBE_BODY}\n`);
  setupFaceProfile(home);
  const patchPath = join(home, "profiles", "face", "cordis.patch.yml");
  const patch = readFileSync(patchPath, "utf8").replace(/^\[\][ \t]*$/m, "");
  // This smoke owns a scratch profile: no operator data server, the stub model for every session.
  writeFileSync(patchPath, `${patch}\n- id: mcp-account\n  disabled: true\n- id: agent-default-model\n  config:\n    provider: stub\n    model: echo\n`);
  const { ctx, dispose } = await bootFace({ profileName: "face", port: 0, dshHome: home, botsRoot: await makeBotsRoot() });
  ctx.llm.registerAdapter(["stub"], new StubAdapter(script));
  ctx.llm.registerAdapter(["stub-see"], new SeeingStubAdapter(script));
  mountClient(ctx);
  /* Search as main.ts wires it, against the booted persistence; the index in the scratch home. */
  const persistence = ctx.get("sessionPersistence") as {
    list(): Promise<readonly StoredSession[]>;
    flush(): Promise<void>;
    open(id: string, access: "read"): Promise<{ read(offset?: number, length?: number): Promise<{ events: readonly StoredEvent[] }>; [Symbol.asyncDispose](): Promise<void> }>;
  };
  await mkdir(join(home, "face"), { recursive: true });
  const index = openSearchIndex(join(home, "face", "search-index.sqlite"));
  registerSearchRoutes(ctx.webServer, makeSearch({
    root,
    index,
    list: () => persistence.list(),
    read: (id, from) => readEventsFrom(persistence, id, from),
    deleted: async () => new Set((await readMeta(home)).deleted),
  }));
  const base = `http://127.0.0.1:${ctx.webServer.port}`;
  const cookie = await signIn(ctx, base);
  const rpc = <T = unknown>(endpoint: string, args: object) => remote<T>(base, cookie, endpoint, args);
  const rpcResult = (endpoint: string, args: object) => remoteResult(base, cookie, endpoint, args);
  const agentOf = (id: string) => ctx.agents.get(SessionId(id)) as Agent | undefined;
  const open = async () => (await rpc<{ sessionId: string }>("session/create", { request: { cwd: root } })).sessionId;
  const turn = async (sessionId: string, content: object[]) => {
    const agent = agentOf(sessionId);
    assert.ok(agent, `session ${sessionId} is live`);
    const ends = () => agent.session.snapshotEvents().filter((e: { type: string }) => e.type === "turn/end").length;
    const before = ends();
    await rpc("session/prompt", { request: { requestId: `ui-port-${randomUUID()}`, sessionId, mode: "queue", content } });
    await waitFor("the turn's end", () => ends() > before, 30_000);
    await agent.whenIdle();
    await persistence.flush();
  };
  face = { ctx, dispose, base, cookie, root, index, rpc, rpcResult, open, turn, agentOf };

  /* The page's mux, as client-mux-smoke installs it: same-origin fetch and a WebSocket with the cookie. */
  scope.location = { protocol: "http:", host: `127.0.0.1:${ctx.webServer.port}` };
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
});

after(async () => {
  for (const mux of muxes) mux.close();
  globalThis.fetch = realFetch;
  globalThis.WebSocket = realSocket;
  scope.location = realLocation;
  face?.index.close();
  await face?.dispose();
});

/** One mux with its ready seen, kept for `after` to close. */
async function openReadyMux(): Promise<ReturnType<typeof openMux>> {
  let ready = false;
  const mux = openMux({ onReady: () => { ready = true; }, onEvent: () => {}, onGate: () => {}, onGateGone: () => {}, onDown: () => {} });
  muxes.push(mux);
  await waitFor("the mux ready", () => ready);
  return mux;
}

test("pins: pinSession answers the pin set, workspace/follow carries it in its baseline and a pinned frame, unpinSession removes it", { skip, timeout: 60_000 }, async () => {
  const f = face!;
  const sessionId = await f.open();
  const mux = await openReadyMux();
  const frames: Record<string, any>[] = [];
  mux.stream("workspace/follow", {}, { onItem: (value: unknown) => { frames.push(value as Record<string, any>); } });
  const baseline = await waitFor("the workspace baseline", () => frames[0]);
  assert.equal(baseline.type, "baseline", JSON.stringify(baseline).slice(0, 200));
  assert.ok(Array.isArray(baseline.value.pinnedSessionIds), "the baseline carries the pin set");
  assert.equal(baseline.value.pinnedSessionIds.includes(sessionId), false);

  const pinned = await f.rpc<{ pinnedSessionIds: string[] }>("workspace/pinSession", { request: { sessionId } });
  assert.ok(pinned.pinnedSessionIds.includes(sessionId), JSON.stringify(pinned));
  const frame = await waitFor("a pinned frame", () => frames.find((item) => item.type === "pinned" && item.pinnedSessionIds.includes(sessionId)));
  assert.ok(frame);

  const unpinned = await f.rpc<{ pinnedSessionIds: string[] }>("workspace/unpinSession", { request: { sessionId } });
  assert.equal(unpinned.pinnedSessionIds.includes(sessionId), false, JSON.stringify(unpinned));
  await waitFor("the pin gone from the follow", () => frames.find((item, at) => at > frames.indexOf(frame) && item.type === "pinned" && !item.pinnedSessionIds.includes(sessionId)));
});

test("commands and skills: commands/list on a live conversation names compact, feedback, goal, permission and plan; skills/list answers on a cold session without activating it", { skip, timeout: 60_000 }, async () => {
  const f = face!;
  const live = await f.open();
  const commands = await f.rpc<{ name: string }[]>("commands/list", { agentId: live });
  const names = commands.map((command) => command.name);
  for (const name of ["compact", "feedback", "goal", "permission", "plan"]) assert.ok(names.includes(name), `${name} in ${JSON.stringify(names)}`);

  /* A cold session: created on the registry and disposed, so its log is on disk and no agent is live. */
  const coldId = `session-${randomUUID()}`;
  const handle = await f.ctx.agents.create({ sessionId: coldId, meta: { cwd: f.root }, agentOptions: { provider: "stub", model: "echo" } });
  await handle.dispose();
  await f.ctx.get("sessionPersistence").flush();
  assert.equal(f.agentOf(coldId), undefined, "the session is cold");
  const skills = await f.rpc<{ skills: unknown[] }>("skills/list", { request: { sessionId: coldId } });
  assert.ok(Array.isArray(skills.skills), JSON.stringify(skills));
  assert.equal(f.agentOf(coldId), undefined, "skills/list did not activate it");
});

test("the projections: after one stub turn, turnOutline holds one entry and sessionStats counts one turn", { skip, timeout: 60_000 }, async () => {
  const f = face!;
  const sessionId = await f.open();
  await f.turn(sessionId, [{ type: "text", text: "one turn" }]);
  const projections = await f.rpc<{ kind: string; asOfSeq: number; values: Record<string, any> }>("session/projections", { request: { sessionId } });
  assert.equal(projections.kind, "sequenced");
  /* Observed at dsh 0.2.1-rc.5: an array, one `{turn, seq, prompt, response}` per turn. */
  const outline = projections.values.turnOutline as { turn: number; prompt: string; response: string }[] | undefined;
  assert.ok(Array.isArray(outline), `turnOutline in ${JSON.stringify(projections.values).slice(0, 300)}`);
  assert.equal(outline.length, 1, JSON.stringify(outline));
  assert.deepEqual({ turn: outline[0]!.turn, prompt: outline[0]!.prompt, response: outline[0]!.response }, { turn: 1, prompt: "one turn", response: "STUB_OK" });
  const stats = projections.values.sessionStats;
  assert.ok(stats !== undefined, `sessionStats in ${Object.keys(projections.values).join(", ")}`);
  assert.equal(stats.turns, 1, JSON.stringify(stats).slice(0, 300));
});

test("jobs: a job/list stream opens with a rows frame", { skip, timeout: 60_000 }, async () => {
  const f = face!;
  const sessionId = await f.open();
  const mux = await openReadyMux();
  const frames: Record<string, any>[] = [];
  mux.stream("job/list", { request: { sessionId } }, {
    onItem: (value: unknown) => { frames.push(value as Record<string, any>); },
    onError: (error: unknown) => { frames.push({ type: "ERROR", error }); },
  });
  const first = await waitFor("the first job/list frame", () => frames[0]);
  assert.equal(first.type, "rows", JSON.stringify(first).slice(0, 300));
  assert.ok(Array.isArray(first.jobs));
});

test("earlier history: session/page with beforeSeq answers records and hasMore", { skip, timeout: 60_000 }, async () => {
  const f = face!;
  const sessionId = await f.open();
  await f.turn(sessionId, [{ type: "text", text: "first" }]);
  await f.turn(sessionId, [{ type: "text", text: "second" }]);
  const { asOfSeq } = await f.rpc<{ asOfSeq: number }>("session/projections", { request: { sessionId } });
  const page = await f.rpc<{ records: unknown[]; hasMore: boolean }>("session/page", {
    request: { address: { kind: "session", sessionId }, throughSeq: asOfSeq, beforeSeq: asOfSeq, maxMessages: 1 },
  });
  assert.ok(Array.isArray(page.records) && page.records.length > 0, JSON.stringify(page).slice(0, 300));
  assert.equal(page.hasMore, true, "two turns hold more than one message before the cut");
  for (const record of page.records as { type: string; event: { seq: number } }[]) {
    assert.equal(record.type, "event");
    assert.ok(record.event.seq < asOfSeq, `a page before ${asOfSeq} holds only earlier events: ${record.event.seq}`);
  }
});

test("an upload: uploadFileBinary mints a receipt and a prompt holding it is accepted on the stub model", { skip, timeout: 60_000 }, async () => {
  const f = face!;
  const sessionId = await f.open();
  const res = await realFetch(`${f.base}/api/session/uploadFileBinary?sessionId=${encodeURIComponent(sessionId)}&name=a.csv`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream", cookie: f.cookie },
    body: "code,close\n600519,1500\n",
  });
  assert.equal(res.status, 200, await res.clone().text());
  const body = await res.json() as { ok: boolean; value?: { receiptId?: string } };
  assert.equal(body.ok, true, JSON.stringify(body));
  const receiptId = body.value?.receiptId;
  assert.equal(typeof receiptId, "string", JSON.stringify(body));
  const accepted = await f.rpc<{ accepted: boolean }>("session/prompt", {
    request: { requestId: `ui-port-${randomUUID()}`, sessionId, mode: "queue", content: [{ type: "text", text: "read it" }, { type: "file", receiptId }] },
  });
  assert.equal(accepted.accepted, true);
  const agent = f.agentOf(sessionId)!;
  const end = await waitFor("the upload turn's end", () => agent.session.snapshotEvents().find((e: { type: string }) => e.type === "turn/end"), 30_000) as { data: { reason: { kind: string } } };
  assert.equal(end.data.reason.kind, "completed", JSON.stringify(end.data));
  await agent.whenIdle();
});

test("the session reference row is up: sessionReferenceResolver is defined", { skip }, () => {
  assert.notEqual(face!.ctx.get("sessionReferenceResolver"), undefined);
});

/* Search: a stored `user/message` event's data IS the message, an `assistant/message`'s wraps it. */
test("search: after a stub turn, /data/search?q=茅台 lists that session", {
  skip, timeout: 60_000,
}, async () => {
  const f = face!;
  const sessionId = await f.open();
  await f.turn(sessionId, [{ type: "text", text: SEARCH_PROMPT }]);
  const search = async (q: string) => {
    const res = await realFetch(`${f.base}/data/search?q=${encodeURIComponent(q)}`, {
      headers: { host: `127.0.0.1:${f.ctx.webServer.port}`, origin: f.base, cookie: f.cookie },
    });
    assert.equal(res.status, 200, await res.clone().text());
    const body = await res.json() as { ok: boolean; items: { sessionId: string; snippet: string }[] };
    assert.equal(body.ok, true);
    return { body, hit: body.items.find((item) => item.sessionId === sessionId) };
  };
  /* The wiring: the stub's answer in this session is indexed and found (trigram path). */
  const answer = await search("STUB_OK");
  assert.ok(answer.hit, `the answer is indexed: ${JSON.stringify(answer.body).slice(0, 500)}`);
  /* The brief's assertion: the operator's prompt, by a two-character query (LIKE path). */
  const { body, hit } = await search("茅台");
  assert.ok(hit, JSON.stringify(body).slice(0, 500));
  assert.ok(hit.snippet.includes("茅台"), hit.snippet);
});

/** A cold session as the skills test makes one: created on the registry and disposed, its log on disk, no agent live. */
async function coldSession(f: Booted): Promise<string> {
  const coldId = `session-${randomUUID()}`;
  const handle = await f.ctx.agents.create({ sessionId: coldId, meta: { cwd: f.root }, agentOptions: { provider: "stub", model: "echo" } });
  await handle.dispose();
  await f.ctx.get("sessionPersistence").flush();
  assert.equal(f.agentOf(coldId), undefined, "the session is cold");
  return coldId;
}

/* Observed at dsh 0.2.1-rc.5 (plan 3, Task 9): the spec's D13 premise does not hold. The face mounts
 * dsh-api-session-controller, which configures the gateway's `agent` lookup to resolve OR RESUME a
 * session, so `commands/list` and `commands/execute` on a cold conversation answer and leave it live;
 * neither fails with `gateway/lookup-not-found`. Hence composer.js reads commands only on a live
 * conversation (reading never activates, PLAN D16), and live.activate before a command is redundant
 * but harmless: after a follow's snapshot the command answers too. */
test("a cold conversation: commands/list and commands/execute resume it (no gateway/lookup-not-found), and after a session/follow's snapshot commands/execute answers", { skip, timeout: 60_000 }, async () => {
  const f = face!;
  const execute = (sessionId: string) => f.rpcResult("commands/execute", { agentId: sessionId, line: "/goal", submittedAttachments: [] });

  /* Reading the commands of a cold conversation activates it: the menu must not do it. */
  const listed = await coldSession(f);
  const list = await f.rpcResult("commands/list", { agentId: listed });
  assert.equal(list.ok, true, JSON.stringify(list).slice(0, 300));
  assert.ok(f.agentOf(listed), "commands/list resumed the cold session");

  /* A command on a cold conversation answers, and resumes it. */
  const direct = await coldSession(f);
  const cold = await execute(direct);
  assert.equal(cold.ok, true, JSON.stringify(cold).slice(0, 300));
  assert.ok(f.agentOf(direct), "commands/execute resumed the cold session");

  /* What live.activate does: a follow, until its first snapshot; the command then answers. */
  const followed = await coldSession(f);
  const mux = await openReadyMux();
  const frames: Record<string, any>[] = [];
  mux.stream("session/follow", { request: { address: { kind: "session", sessionId: followed }, assistantStream: true } }, {
    onItem: (value: unknown) => { frames.push(value as Record<string, any>); },
    onError: (error: unknown) => { frames.push({ type: "ERROR", error }); },
  });
  const snapshot = await waitFor("the follow's snapshot", () => frames.find((item) => item.type === "snapshot" || item.type === "ERROR"));
  assert.equal(snapshot.type, "snapshot", JSON.stringify(snapshot).slice(0, 300));
  /* The agent is registered a few milliseconds after the snapshot frame (measured ~11 ms), not with it. */
  await waitFor("the follow to activate the session", () => f.agentOf(followed));
  const warm = await execute(followed);
  assert.equal(warm.ok, true, JSON.stringify(warm).slice(0, 300));
  const value = (warm as { value?: { result?: { kind?: string } } }).value;
  assert.equal(value?.result?.kind, "success", JSON.stringify(warm).slice(0, 300));
});

test("a skill by its literal name: skills/list names ui-port-probe, and a prompt \"/ui-port-probe hello\" reaches the model with its skill_content", { skip, timeout: 60_000 }, async () => {
  const f = face!;
  const sessionId = await f.open();
  const listed = await f.rpc<{ skills: { name: string }[] }>("skills/list", { request: { sessionId } });
  assert.ok(listed.skills.some((skill) => skill.name === "ui-port-probe"), JSON.stringify(listed).slice(0, 500));

  const from = requests.length;
  await f.turn(sessionId, [{ type: "text", text: "/ui-port-probe hello" }]);
  /* The model's request for the turn (the title model's request, if any, holds no skill). */
  const seen = requests.slice(from).map(textOf);
  const tag = JSON.stringify('<skill_content name="ui-port-probe">').slice(1, -1);
  const hit = seen.find((body) => body.includes(tag));
  assert.ok(hit, `${seen.length} requests after the prompt: ${seen.map((body) => body.slice(0, 600)).join(" | ")}`);
  assert.ok(hit.includes("UI_PORT_PROBE_BODY"), hit.slice(0, 1500));
});

test("a conversation chip: the page's serialized mention brings a Referenced sessions message", { skip, timeout: 60_000 }, async () => {
  const f = face!;
  const a = await f.open();
  await f.turn(a, [{ type: "text", text: "the referenced turn" }]);
  const b = await f.open();
  const text = serialize([{ type: "chip", chip: { kind: "conversation", id: a, label: "A" } }], {});
  const from = requests.length;
  await f.turn(b, [{ type: "text", text }]);
  const seen = requests.slice(from).map(textOf);
  assert.ok(seen.some((body) => body.includes("## Referenced sessions")), `${text}: ${seen.map((body) => body.slice(0, 400)).join(" | ")}`);
});

/* Attachments (plan 4, Task 9): the limits, the two refusals, an image on an image route, and the PDF role. */
test("the image limits: session/projections on a cold session carries imageLimits", { skip, timeout: 60_000 }, async () => {
  const f = face!;
  const coldId = await coldSession(f);
  const projections = await f.rpc<{ values: Record<string, any> }>("session/projections", { request: { sessionId: coldId } });
  const limits = projections.values.imageLimits;
  assert.ok(limits, `imageLimits in ${Object.keys(projections.values).join(", ")}`);
  assert.equal(limits.maxImagesPerMessage, 20, JSON.stringify(limits));
  assert.equal(limits.maxImageBytes, 20_971_520, JSON.stringify(limits));
  assert.deepEqual([...limits.mediaTypes].sort(), ["image/gif", "image/jpeg", "image/png", "image/webp"], JSON.stringify(limits));
});

test("an image to a text-only model is refused before admission: session/attachment-invalid, reason MODEL_DOES_NOT_SUPPORT_IMAGES", { skip, timeout: 60_000 }, async () => {
  const f = face!;
  const sessionId = await f.open();
  const refused = await f.rpcResult("session/prompt", {
    request: { requestId: `ui-port-${randomUUID()}`, sessionId, mode: "queue", content: [{ type: "text", text: "look" }, { type: "image", mediaType: "image/png", data: PNG_1PX, name: "dot.png" }] },
  }) as { ok: boolean; error?: { code?: string; details?: { reason?: string } } };
  assert.equal(refused.ok, false, JSON.stringify(refused).slice(0, 300));
  assert.equal(refused.error?.code, "session/attachment-invalid", JSON.stringify(refused).slice(0, 300));
  assert.equal(refused.error?.details?.reason, "MODEL_DOES_NOT_SUPPORT_IMAGES", JSON.stringify(refused).slice(0, 300));
  assert.equal(f.agentOf(sessionId)!.session.snapshotEvents().some((e: { type: string }) => e.type === "user/message"), false, "nothing admitted");
});

test("a receipt the session never staged is refused with FILE_NOT_STAGED", { skip, timeout: 60_000 }, async () => {
  const f = face!;
  const sessionId = await f.open();
  const refused = await f.rpcResult("session/prompt", {
    request: { requestId: `ui-port-${randomUUID()}`, sessionId, mode: "queue", content: [{ type: "text", text: "read it" }, { type: "file", receiptId: `receipt-${randomUUID()}` }] },
  }) as { ok: boolean; error?: { code?: string; details?: { reason?: string } } };
  assert.equal(refused.ok, false, JSON.stringify(refused).slice(0, 300));
  assert.equal(refused.error?.details?.reason, "FILE_NOT_STAGED", JSON.stringify(refused).slice(0, 300));
});

test("an image on an image route: accepted, logged as an image block, and session/attachment gives its bytes back", { skip, timeout: 60_000 }, async () => {
  const f = face!;
  const sessionId = await f.open();
  const selected = await f.rpc<{ selected: { provider: string; model: string } }>("session/selectModel", { request: { sessionId, provider: "stub-see", model: "echo" } });
  assert.deepEqual({ provider: selected.selected.provider, model: selected.selected.model }, { provider: "stub-see", model: "echo" });
  const image = { key: "k1", kind: "image", mediaType: "image/png", name: "dot.png" };
  await f.turn(sessionId, contentParts("look", [image], () => PNG_1PX));
  const message = f.agentOf(sessionId)!.session.snapshotEvents().find((e: { type: string }) => e.type === "user/message") as { data: { content: { type: string; attachment?: { attachmentId?: string; mediaType?: string } }[] } } | undefined;
  assert.ok(message, "the prompt is logged");
  /* Observed at dsh 0.2.1-rc.5: the logged block nests its ref, `{type:'image', attachment:{attachmentId, mediaType, width,
   * height, bytes, name}}` - the shape wire/mapper.js reads. */
  const block = message.data.content.find((part) => part.type === "image");
  assert.ok(block, JSON.stringify(message.data).slice(0, 500));
  const attachmentId = block.attachment?.attachmentId;
  assert.equal(typeof attachmentId, "string", JSON.stringify(block));
  assert.equal(block.attachment?.mediaType, "image/png", JSON.stringify(block));
  const read = await f.rpc<{ attachment: unknown; data: string }>("session/attachment", { request: { sessionId, attachmentId } });
  const bytes = Buffer.from(read.data, "base64");
  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "the bytes are a PNG");
});

test("the PDF role is up: role-pdf-page-reader is listed whole, and read_image is among the host's tools", { skip, timeout: 60_000 }, async () => {
  const f = face!;
  const presets = f.ctx.get("agentPresets") as { list(): Promise<{ id: string; broken?: string }[]> };
  const row = (await presets.list()).find((p) => p.id === "role-pdf-page-reader");
  assert.ok(row, "role-pdf-page-reader is listed");
  assert.equal(row.broken, undefined, `listed whole: ${row.broken}`);
  const tools = f.ctx.get("tools") as { schemas(scope?: object): { name: string }[] };
  assert.ok(tools.schemas().some((t) => t.name === "read_image"), "read_image is registered");
});

/* Carried from Task 6: the text host/actions.js's RECEIPT_UNKNOWN matches on (dsh-commands admitCommandAttachments, rc.5). */
test("a dropped receipt on a command: commands/execute /goal with an unknown receipt settles the error text RECEIPT_UNKNOWN matches", { skip, timeout: 60_000 }, async () => {
  const f = face!;
  const sessionId = await f.open();
  const executed = await f.rpc<{ result: { kind: string; text?: string } }>("commands/execute", {
    agentId: sessionId, line: "/goal read it", submittedAttachments: [{ type: "file", receiptId: `receipt-${randomUUID()}` }],
  });
  assert.deepEqual({ kind: executed.result.kind, text: executed.result.text }, { kind: "error", text: "File upload receipt is unknown for this session." });
});
