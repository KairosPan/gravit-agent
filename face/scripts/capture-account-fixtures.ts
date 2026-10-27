/** Captures the Account's read and prepare answers once, as the fixtures the graft's client tests read
 * (`tests/fixtures/account/`, held to what the views read by `tests/account-fixtures.test.ts`):
 * starts the Account's own stand-in — the real Account over simulated venues, no network, no real
 * money, a fresh temporary home — through the smokes' own helper (`tests/helpers/standin.ts`, which
 * removes that home after the stop only when it is a `ui-standin-` directory directly under the
 * tmpdir), reads each route with a bare loopback `fetch` (the Account's fence answers a request
 * that carries no Origin), posts three owner prepares as the page posts them (`{ draft }`, unsigned,
 * so no pairing: a live order, a watch, and an answer to the page's first card), drops every
 * `native` and `icon` key, cuts every array of a read to its first 12 entries (`venues`' arrays and
 * a prepared action's stay whole: every connector judged, every field signed), writes each answer
 * as pretty JSON — the stand-in's `now`, nonces and deadlines as captured — keeps the push
 * channel's first ten frames (or the whole ones heard in 20 s) in `stream-frames.txt` — verbatim
 * but for the same two keys dropped from each frame's `data:` (its arrays whole) — and stops the
 * stand-in.
 *
 *     cd face && npx tsx scripts/capture-account-fixtures.ts
 *
 * The stand-in runs from the repo's `account/` (`npm ci` there); `FACE_ACCOUNT_SEAT_DIR`, optional,
 * names another install of the Account instead. Either is read, never written. The stand-in takes a free port, never
 * the real Account's 4820. Takes no arguments; prints each file it wrote. A read or a prepare the
 * Account does not answer `ok: true` stops the capture before any file is written.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { seatDir } from "../src/account-seat.ts";
import { freePort, standinPaths, startStandin, stopStandin } from "../tests/helpers/standin.ts";

const DIR = seatDir();
const { cli: CLI, script: STANDIN } = standinPaths(DIR);
const OUT = fileURLToPath(new URL("../tests/fixtures/account/", import.meta.url));
/** How many entries of every array a read's fixture keeps (a frame's, `venues`' and a prepared action's arrays stay whole). */
const KEEP = 12;
/** The reads whose arrays stay whole: `venues` is every connector the Account judges, each crossed with
 * `account.connectLive.options` — its first twelve rows are all exchanges. A prepared action's arrays stay whole
 * too: its `shown` is every field the owner signs, and the page shows them all. */
const WHOLE = new Set(["venues"]);
/** Keys no fixture carries: a venue's raw answer, a logo's URL. */
const STRIPPED = new Set(["native", "icon"]);
/** This reader's name on the stream (the Account takes 8 to 48 letters, digits, dashes or underscores). */
const STREAM_CLIENT = "face-fixture00000000000000";
const STREAM_FRAMES = 10;
const STREAM_MS = 20_000;
const READ_MS = 60_000;

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
  ["venues", "/api/account/venues"],
  ["paper-books", "/api/account/paper/books"],
  ["keyfile", "/api/account/keyfile?kind=alpaca-paper&venue=alpaca-paper"],
];

/** The owner's prepares, by fixture name, and the draft each one posts; `approveCard` answers the page's first card. */
const PREPARES: readonly (readonly [name: string, draft: (card: { id: string; hash: string }) => Record<string, string>])[] = [
  ["prepared-order", () => ({
    type: "liveOrder", venue: "ex", symbol: "ETH/USDT", side: "buy", orderType: "market", usd: "25", limitPrice: "", stopPrice: "", tif: "",
    postOnly: "", reduceOnly: "", extendedHours: "", trailPercent: "", trailPrice: "", takeProfit: "", stopLoss: "",
  })],
  ["prepared-watch", () => ({ type: "setWatch", venue: "ex", symbol: "BTC/USDT", on: "true" })],
  ["prepared-card", (card) => ({ type: "approveCard", card: card.id, action: card.hash, decision: "approve" })],
];

interface ExploreLeg { venue: string; symbol: string; connected?: boolean }

/** One answer's body; anything but a 2xx `ok: true` stops the capture. */
async function answered(path: string, res: Response): Promise<unknown> {
  const text = await res.text();
  let body: { ok?: unknown } | undefined;
  try { body = JSON.parse(text) as { ok?: unknown }; } catch { body = undefined; }
  if (!res.ok || body?.ok !== true) throw new Error(`${path} answered ${res.status}: ${text.slice(0, 400)}`);
  return body;
}

/** One read, its body as the Account answered it. */
async function read(base: string, path: string): Promise<unknown> {
  return answered(path, await fetch(`${base}${path}`, { signal: AbortSignal.timeout(READ_MS) }));
}

/** One prepare, as the page posts it — `{ draft }`, unsigned, so no pairing — its body as the Account answered it. */
async function prepare(base: string, draft: Record<string, string>): Promise<unknown> {
  const path = "/api/account/prepare";
  const res = await fetch(`${base}${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ draft }), signal: AbortSignal.timeout(READ_MS),
  });
  const body = await answered(`${path} (${draft.type})`, res);
  if (!Array.isArray((body as { shown?: unknown }).shown)) throw new Error(`${path} (${draft.type}) answered no shown list`);
  return body;
}

/** The page's first card, which the `approveCard` prepare answers. */
function firstCard(account: unknown): { id: string; hash: string } {
  const card = (account as { cards?: { id?: unknown; hash?: unknown }[] }).cards?.[0];
  if (typeof card?.id !== "string" || typeof card.hash !== "string") throw new Error("/api/account has no card to answer");
  return { id: card.id, hash: card.hash };
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

/** Every read, the prepares, then the stream: the answers and the prepared actions by fixture name, and the frames. */
async function capture(base: string): Promise<{ answers: Map<string, unknown>; prepared: Map<string, unknown>; frames: string }> {
  const answers = new Map<string, unknown>();
  for (const [name, path] of READS) answers.set(name, await read(base, path));
  const { venue, symbol } = connectedLeg(answers.get("explore-all"));
  const market = new URLSearchParams({ venue, symbol }).toString();
  answers.set("candles", await read(base, `/api/account/candles?${market}&range=1D`));
  answers.set("market", await read(base, `/api/account/market?${market}`));
  const card = firstCard(answers.get("account"));
  const prepared = new Map<string, unknown>();
  for (const [name, draft] of PREPARES) prepared.set(name, await prepare(base, draft(card)));
  return { answers, prepared, frames: await streamFrames(`${base}/api/account/stream?client=${STREAM_CLIENT}`) };
}

for (const [path, fix] of [[CLI, "run npm ci in the checkout"], [STANDIN, "not the Account's checkout"]] as const) {
  if (!existsSync(path)) throw new Error(`${path} is missing: ${fix} (FACE_ACCOUNT_SEAT_DIR names the checkout)`);
}
const standin = await startStandin(await freePort(), DIR);
const { answers, prepared, frames } = await capture(standin.url).finally(() => stopStandin(standin));
mkdirSync(OUT, { recursive: true });
for (const [name, body] of [...answers, ...prepared]) {
  const file = join(OUT, `${name}.json`);
  writeFileSync(file, `${JSON.stringify(stripped(body, prepared.has(name) || WHOLE.has(name) ? Infinity : KEEP), null, 2)}\n`);
  console.log(file);
}
const streamFile = join(OUT, "stream-frames.txt");
writeFileSync(streamFile, strippedFrames(frames));
console.log(streamFile);
