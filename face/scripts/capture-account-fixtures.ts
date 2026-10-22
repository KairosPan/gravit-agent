/** Captures the Account's read answers once, as the fixtures the graft's client tests read
 * (`tests/fixtures/account/`, held to what the views read by `tests/account-fixtures.test.ts`):
 * starts the Account's own stand-in — the real Account over simulated venues, no network, no real
 * money, a fresh temporary home — as `tests/account-seat-smoke.test.ts` starts it, reads each route
 * with a bare loopback `fetch` (the Account's fence answers a request that carries no Origin),
 * drops every `native` and `icon` key, cuts every array to its first 12 entries, writes each answer
 * as pretty JSON, keeps the push channel's first ten frames (or the whole ones heard in 20 s) in
 * `stream-frames.txt` — verbatim but for the same two keys dropped from each frame's `data:` (its
 * arrays whole) — and stops the stand-in.
 *
 *     cd face && FACE_ACCOUNT_SEAT_DIR=~/buyer-agent-demo npx tsx scripts/capture-account-fixtures.ts
 *
 * `FACE_ACCOUNT_SEAT_DIR` is an installed checkout of linqizhe07/buyer-agent-demo (`npm ci` there),
 * `~/buyer-agent-demo` when unset; it is read, never written. The stand-in takes a free port, never
 * the real Account's 4820. Takes no arguments; prints each file it wrote. A read the Account does
 * not answer `ok: true` stops the capture before any file is written.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { seatDir } from "../src/account-seat.ts";

const DIR = seatDir();
const CLI = join(DIR, "node_modules", "tsx", "dist", "cli.mjs");
const STANDIN = join(DIR, "test", "standin", "ui-standin.ts");
const OUT = fileURLToPath(new URL("../tests/fixtures/account/", import.meta.url));
/** How many entries of every array a JSON fixture keeps (a frame's arrays stay whole). */
const KEEP = 12;
/** Keys no fixture carries: a venue's raw answer, a logo's URL. */
const STRIPPED = new Set(["native", "icon"]);
/** This reader's name on the stream (the Account takes 8 to 48 letters, digits, dashes or underscores). */
const STREAM_CLIENT = "face-fixture00000000000000";
const STREAM_FRAMES = 10;
const STREAM_MS = 20_000;
const START_MS = 90_000;
const READ_MS = 60_000;
const STOP_MS = 10_000;

/** The fixtures, by file name, and the read each one is; `candles` and `market` follow from `explore-all`. */
const READS: readonly (readonly [name: string, path: string])[] = [
  ["account", "/api/account"],
  ["explore-all", "/api/account/explore"],
  ["explore-predictions", "/api/account/explore?tab=predictions"],
  ["holdings", "/api/account/holdings?cost=1"],
  ["holdings-paper", "/api/account/holdings?cost=1&paper=1"],
  ["positions", "/api/account/positions"],
  ["statement", "/api/account/statement"],
  ["history", "/api/account/history?range=1w"],
  ["history-paper", "/api/account/history?range=1w&paper=1"],
  ["agents", "/api/account/agents"],
  ["compare", "/api/account/compare?base=ETH&side=buy"],
];

interface Standin { url: string; home: string; child: ChildProcess }
interface ExploreLeg { venue: string; symbol: string; connected?: boolean }

const freePort = (): Promise<number> => new Promise((resolve, reject) => {
  const server = createServer();
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    server.close(() => (typeof address === "object" && address !== null ? resolve(address.port) : reject(new Error("no port"))));
  });
});

/** Start the Account's stand-in on `port` and wait for its page and home lines. */
function startStandin(port: number): Promise<Standin> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, STANDIN, "--port", String(port), "--no-desk"], { cwd: DIR, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const timer = setTimeout(() => { child.kill("SIGINT"); reject(new Error(`the stand-in printed no page line in ${START_MS / 1000} s:\n${out}`)); }, START_MS);
    const look = (): void => {
      const url = /^\s*page\s+(\S+)/m.exec(out)?.[1];
      const home = /^\s*home\s+(\S+)/m.exec(out)?.[1];
      if (url !== undefined && home !== undefined) { clearTimeout(timer); resolve({ url, home, child }); }
    };
    child.stdout.on("data", (chunk: Buffer) => { out += chunk.toString(); look(); });
    child.stderr.on("data", (chunk: Buffer) => { out += chunk.toString(); });
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`the stand-in exited with ${code}:\n${out}`)); });
  });
}

/** Stop the stand-in as Ctrl-C does (killed if still up after {@link STOP_MS}) and remove the temporary home it kept. */
async function stopStandin(standin: Standin): Promise<void> {
  const { child } = standin;
  if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise<void>((resolve) => { child.once("exit", () => resolve()); });
    child.kill("SIGINT");
    const timer = setTimeout(() => child.kill("SIGKILL"), STOP_MS);
    await exited;
    clearTimeout(timer);
  }
  if (standin.home.startsWith(join(tmpdir(), "ui-standin-"))) await rm(standin.home, { recursive: true, force: true });
}

/** One read, its body as the Account answered it; anything but `ok: true` stops the capture. */
async function read(base: string, path: string): Promise<unknown> {
  const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(READ_MS) });
  const text = await res.text();
  let body: { ok?: unknown } | undefined;
  try { body = JSON.parse(text) as { ok?: unknown }; } catch { body = undefined; }
  if (!res.ok || body?.ok !== true) throw new Error(`${path} answered ${res.status}: ${text.slice(0, 400)}`);
  return body;
}

/** The first Markets row with a venue connected live: that venue's line, which the candles and market reads ask for. */
function connectedLeg(explore: unknown): ExploreLeg {
  const items = (explore as { items: { at: ExploreLeg[] }[] }).items;
  const leg = items.flatMap((item) => item.at).find((at) => at.connected === true);
  if (leg === undefined) throw new Error("no row of /api/account/explore is at a venue connected live");
  return leg;
}

/** `value` as a fixture keeps it: every `native` and `icon` key dropped and every array cut to its first `keep` entries (whole by default), all the way down. */
function stripped(value: unknown, keep = Infinity): unknown {
  if (Array.isArray(value)) return value.slice(0, keep).map((inner) => stripped(inner, keep));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !STRIPPED.has(key)).map(([key, inner]) => [key, stripped(inner, keep)]));
}

/** The frames with each `data: <json>` line {@link stripped} (its arrays whole); every other line, and a `data:` line that is not JSON, as heard. */
function strippedFrames(frames: string): string {
  return frames.split("\n").map((line) => {
    if (!line.startsWith("data: ")) return line;
    try { return `data: ${JSON.stringify(stripped(JSON.parse(line.slice("data: ".length))))}`; } catch { return line; }
  }).join("\n");
}

/** The first `n` whole frames of `text`, each ending at a blank line; a frame cut off at the end is left out. */
function wholeFrames(text: string, n: number): string {
  let end = 0;
  for (let frame = 0; frame < n; frame++) {
    const blank = text.indexOf("\n\n", end);
    if (blank < 0) break;
    end = blank + 2;
  }
  return text.slice(0, end);
}

/** The push channel's first {@link STREAM_FRAMES} frames verbatim, or the whole ones heard in {@link STREAM_MS}; then the stream is closed. */
async function streamFrames(url: string): Promise<string> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), STREAM_MS);
  let text = "";
  try {
    const res = await fetch(url, { headers: { accept: "text/event-stream" }, signal: abort.signal });
    if (!res.ok || res.body === null) throw new Error(`the stream answered ${res.status}: ${(await res.text()).slice(0, 400)}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    while (text.split("\n\n").length - 1 < STREAM_FRAMES) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } catch (error) {
    if (!abort.signal.aborted) throw error;
  } finally {
    clearTimeout(timer);
    abort.abort();
  }
  const frames = wholeFrames(text, STREAM_FRAMES);
  if (frames === "") throw new Error(`the stream told no whole frame in ${STREAM_MS / 1000} s: ${JSON.stringify(text.slice(0, 400))}`);
  return frames;
}

/** Every read, then the stream: the answers by fixture name, and the frames. */
async function capture(base: string): Promise<{ answers: Map<string, unknown>; frames: string }> {
  const answers = new Map<string, unknown>();
  for (const [name, path] of READS) answers.set(name, await read(base, path));
  const { venue, symbol } = connectedLeg(answers.get("explore-all"));
  const market = new URLSearchParams({ venue, symbol }).toString();
  answers.set("candles", await read(base, `/api/account/candles?${market}&range=1D`));
  answers.set("market", await read(base, `/api/account/market?${market}`));
  return { answers, frames: await streamFrames(`${base}/api/account/stream?client=${STREAM_CLIENT}`) };
}

for (const [path, fix] of [[CLI, "run npm ci in the checkout"], [STANDIN, "not the Account's checkout"]] as const) {
  if (!existsSync(path)) throw new Error(`${path} is missing: ${fix} (FACE_ACCOUNT_SEAT_DIR names the checkout)`);
}
const standin = await startStandin(await freePort());
const { answers, frames } = await capture(standin.url).finally(() => stopStandin(standin));
mkdirSync(OUT, { recursive: true });
for (const [name, body] of answers) {
  const file = join(OUT, `${name}.json`);
  writeFileSync(file, `${JSON.stringify(stripped(body, KEEP), null, 2)}\n`);
  console.log(file);
}
const streamFile = join(OUT, "stream-frames.txt");
writeFileSync(streamFile, strippedFrames(frames));
console.log(streamFile);
