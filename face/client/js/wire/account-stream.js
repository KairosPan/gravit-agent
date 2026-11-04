// face/client/js/wire/account-stream.js — the Account's push channel in the browser (spec 2026-10-22 §5.1, §6.1–6.2):
// one EventSource per tab at /data/account/stream through the face's proxy, under a client id minted once
// (`face-<24 hex>`, the Account's grammar), and the markets it follows told to /data/account/stream/markets.
// The policy:
// - every named frame reaches onEvent as { type, id, data }, data parsed (a frame that does not parse is dropped, its
//   id kept); the Account's snapshot is one more event: the host decides what to read again;
// - the resume point is the newest frame id: the browser re-sends it as Last-Event-ID on its own reconnects, which
//   are left to it, and a fresh source carries it as `since`;
// - no sign of life (the open, or any frame, the Account's 15 s hb among them) for STALE_MS is stale; for DEAD_MS the
//   source is dropped and reopened after the next RETRY_MS delay, as is a source the face refused (its 400 or 503:
//   the browser's CLOSED) or one that could not be made — a step per failure in a row, held at the last, back to the
//   first at the first frame;
// - the follow set (deduplicated, the first FOLLOW_LIMIT) is told on every open and on every change while open, each
//   POST with a rising n, and once more a second later when the face did not take it;
// - close() drops the source and every timer and forgets nothing: the next open() resumes and tells the set again;
// - each change of status() is told to onStatus once, as it happens (the host's cadence follows the stream).
// No DOM, no store, no visibility handling and nothing logged: those are the host's.

export const STALE_MS = 20_000, DEAD_MS = 45_000, RETRY_MS = [1000, 2000, 5000, 10000, 30000], FOLLOW_LIMIT = 16;

/** The Account's stream and its follows, the defaults (`paths` names another upstream's: wire/market-stream.js). The follow
 * path is bare: the face answers 400 to any query name there, and 415 to a body not declared JSON. */
export const ACCOUNT_PATHS = Object.freeze({ stream: "/data/account/stream", follow: "/data/account/stream/markets" });
/** How long after a follow POST the face did not take the set is told once more. */
const RETELL_MS = 1_000;
/** The Account's frames are all named, and a browser EventSource fires onmessage for unnamed ones only. */
export const ACCOUNT_EVENT_TYPES = Object.freeze(["snapshot", "order", "fill", "position", "balance", "paper", "statement", "card", "desk", "quote", "trades", "book", "hb"]);
/** EventSource.readyState: CONNECTING while the browser reconnects by itself, CLOSED once it has given up. */
const CONNECTING = 0, CLOSED = 2;

/** @typedef {{type: string, id: string|undefined, data: unknown}} AccountEvent */
/** @typedef {{readyState: number, onopen: ((event: unknown) => void)|null, onerror: ((event: unknown) => void)|null, addEventListener: (type: string, listener: (event: {data?: string, lastEventId?: string}) => void) => void, close: () => void}} AccountEvents */

/** A tab's stream client id in the Account's grammar: `face-` and 12 random bytes as 24 lower-case hex.
 * @param {(length: number) => Uint8Array} random
 * @returns {string}
 */
export function mintClientId(random) {
  return `face-${Array.from(random(12), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** The Account's push channel for one tab, over the face's proxy. The host owns on and off (`open`, `close`), the
 * follow set (`follow`) and what an event means (`onEvent`); this owns the connection, the resume point and the
 * follow POSTs, and tells `onStatus` each new status. `open()` is a no-op while the stream is on (connecting, open,
 * stale or waiting to reopen). The clocks are the injected timers. `paths` and `eventTypes` name another upstream's stream
 * (the market's: wire/market-stream.js); the defaults are the Account's.
 * @param {{createEventSource: (url: string) => AccountEvents, fetcher: (path: string, init: {method: string, headers: Record<string, string>, body: string}) => Promise<{status: number}>, schedule: (callback: () => void, delay: number) => any, cancelTimer: (timer: any) => void, random: (length: number) => Uint8Array, onStatus?: (status: 'idle'|'connecting'|'open'|'stale'|'closed') => void, paths?: {stream: string, follow: string}, eventTypes?: readonly string[]}} deps
 * @param {(event: AccountEvent) => void} onEvent
 */
export function createAccountStream({ createEventSource, fetcher, schedule, cancelTimer, random, onStatus = () => {}, paths = ACCOUNT_PATHS, eventTypes = ACCOUNT_EVENT_TYPES }, onEvent) {
  const STREAM_PATH = paths.stream, FOLLOW_PATH = paths.follow;
  const clientId = mintClientId(random);
  let phase = "idle";      // 'idle' until the first open(), 'on' from open() to close(), 'off' after close()
  /** @type {AccountEvents|null} */
  let source = null;       // the current source; null while closed or waiting to reopen
  let connected = false;   // the current source opened and has not failed since
  let quiet = false;       // no sign of life for STALE_MS
  /** @type {string|null} */
  let last = null;         // the newest frame id: the resume point
  let failures = 0;        // failed sources in a row: the step into RETRY_MS
  /** @type {string[]} */
  let markets = [];        // the follow set
  let told = 0;            // the n of the newest follow POST
  let said = "idle";       // the status onStatus was last told
  let staleTimer = null, deadTimer = null, reopenTimer = null, retellTimer = null;

  /** @returns {'idle'|'connecting'|'open'|'stale'|'closed'} */
  function status() {
    if (phase === "idle") return "idle";
    if (phase === "off" || source === null) return "closed";
    if (!connected) return "connecting";
    return quiet ? "stale" : "open";
  }
  /** Tell onStatus when status() answers otherwise than when it was last told: the end of every way in. */
  function notify() {
    const next = status();
    if (next === said) return;
    said = next;
    onStatus(next);
  }
  /** Cancel a timer if one is pending; the null to keep in its place. */
  function clear(timer) {
    if (timer !== null) cancelTimer(timer);
    return null;
  }
  /** The source opened or a frame came: both clocks start over. */
  function armClocks() {
    staleTimer = clear(staleTimer);
    deadTimer = clear(deadTimer);
    quiet = false;
    staleTimer = schedule(() => { staleTimer = null; quiet = true; notify(); }, STALE_MS);
    deadTimer = schedule(() => { deadTimer = null; backOff(); notify(); }, DEAD_MS);
  }
  /** Drop the current source with its clocks and any retell; the last id and the follow set stay. */
  function drop() {
    const dropped = source;
    source = null; connected = false; quiet = false;
    staleTimer = clear(staleTimer); deadTimer = clear(deadTimer); retellTimer = clear(retellTimer);
    dropped?.close();
  }
  /** A source dead, refused or never made: drop it and connect again after the next delay. */
  function backOff() {
    drop();
    const delay = RETRY_MS[Math.min(failures, RETRY_MS.length - 1)];
    failures += 1;
    reopenTimer = schedule(() => { reopenTimer = null; connect(); notify(); }, delay);
  }
  function connect() {
    const since = last === null ? "" : `&since=${encodeURIComponent(last)}`;
    let es;
    try {
      es = createEventSource(`${STREAM_PATH}?client=${encodeURIComponent(clientId)}${since}`);
    } catch {
      backOff();
      return;
    }
    source = es;
    // a dropped source's late callbacks fall through the `es !== source` guards
    es.onopen = () => {
      if (es !== source) return;
      connected = true;
      armClocks();
      void tell(false);
      notify();
    };
    es.onerror = () => {
      if (es !== source) return;
      if (es.readyState === CLOSED) backOff();
      else if (es.readyState === CONNECTING) connected = false;
      notify();
    };
    for (const type of eventTypes) es.addEventListener(type, (event) => frame(es, type, event));
    armClocks();
  }
  /** @param {AccountEvents} es @param {string} type @param {{data?: string, lastEventId?: string}} event */
  function frame(es, type, event) {
    if (es !== source) return;
    failures = 0;
    armClocks();
    notify();
    const id = event.lastEventId || undefined;
    if (id !== undefined) last = id;
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    onEvent({ type, id, data });
  }
  /** POST the follow set with the next n; a first telling the face did not take is told once more after RETELL_MS,
   * unless a newer telling, a dropped source or the browser's reconnect has overtaken it.
   * @param {boolean} again
   */
  async function tell(again) {
    retellTimer = clear(retellTimer);
    const n = ++told;
    const es = source;
    let taken = false;
    try {
      const answer = await fetcher(FOLLOW_PATH, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client: clientId, markets, n }) });
      taken = answer.status >= 200 && answer.status < 300;
    } catch {
      // a POST that threw was not taken
    }
    if (taken || again || n !== told || es !== source || !connected) return;
    retellTimer = schedule(() => { retellTimer = null; if (connected) void tell(true); }, RETELL_MS);
  }

  return {
    clientId,
    open() {
      if (phase === "on") return;
      phase = "on";
      connect();
      notify();
    },
    close() {
      phase = "off";
      drop();
      reopenTimer = clear(reopenTimer);
      notify();
    },
    /** @param {Iterable<string>} keys */
    follow(keys) {
      const next = [...new Set(keys)].slice(0, FOLLOW_LIMIT);
      const same = next.length === markets.length && next.every((key) => markets.includes(key));
      markets = next;
      if (!same && connected) void tell(false);
    },
    status,
    lastId: () => last,
  };
}
