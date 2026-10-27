/* THE ACCOUNT'S PUSH CHANNEL, the page's end (GET /api/account/stream; the account's end is account/stream.ts). One stream a tab, opened
   once the shell has read the account (stStart), closed while the tab is hidden and opened again when it shows — naming the last event it
   heard (?since=), so what came meanwhile comes now, or a snapshot when the account no longer keeps it. What comes is handed to whoever
   listens (stOn), one event at a time, each listener's fault its own; nothing here draws anything but the dot that says how the stream
   stands (stDot). The polls the page always had stay: they are the fallback, and run much slower while the stream is connected.

   A browser without EventSource (and the test stand-in, which has none) never opens one: the health is "down" and the page reads the
   account by its polls, as it did before it had a stream.

     stOn(type, fn) → off()   fn(data, type) for each event of that type: order · fill · position · balance · paper · statement · card ·
                              desk · snapshot (a page that could not resume: read everything again), "*" for every one of them, and
                              "health" (fn(health)) when the health changes
     stHealth()               "connected" — open, and heard from in the last ST_STALE_MS (the account sends a heartbeat every 15 s) ·
                              "stale" — open, and silent for longer (a stream the network froze: closed and opened again after
                              ST_DEAD_MS) · "down" — not open: no EventSource, the tab hidden, the account not answering (the browser asks
                              again a second later, as the stream said), or refused (503: as many pages listen as the account keeps) —
                              opened again here after ST_RETRY_MS, longer each time
     stStart()                open it (once; the shell calls it after its first read)
     stFollow(keys, marks)    the markets this tab shows, each `<venue>:<symbol>` (ui/terminal.js says them as the market showing changes,
                              and as the pane is shown or put aside): `keys` the ones shown whole — their quote, book and trades come on the
                              stream as quote · book · trades events — and `marks` the ones whose price alone is shown (the positions'
                              marks under the panels: their quote only, said to the account with a "~" before the key, so it streams no
                              book for them), the account streaming them from the venues while a page shows them. Said again each time the
                              stream opens (an empty list too: a stream the account carried over from the last may still follow what this
                              tab no longer shows); a tab whose stream closed (hidden) follows nothing until it opens again, and an empty
                              list follows nothing at all. Each telling is numbered (one more each time), so the account takes the latest
                              of them however the requests overtake one another, and one it did not take is said once more
     stQuoteOf(venue, symbol) the latest quote the stream pushed for a market this tab follows, as it came (bid, ask, last, mark, funding,
                              its venue's moment `at`, `priceAt` its venue's own moment of the best bid and ask it carries, `seenAt` the
                              moment its stream last confirmed it, `from`, `live`, `seq` — and for a US share, whose real-time quote no venue
                              streams but the account reads over REST, `everyMs`, how often its source writes it where it is read as it
                              is written (Robinhood's), or `askedEveryMs`, how often the account asks a source that writes nothing on a
                              cadence of its own (Nasdaq's, stamped with its last trade to the minute), and `delayMs`, 0: its `at` and
                              `seenAt` are its own stamp) with `gotAt` — the moment this page had it — or
                              null: not followed, nothing pushed on the stream open now (what an earlier one pushed was let go as it
                              dropped: the account says each again when this one follows it), or the stream not connected now (a quote the
                              stream no longer carries is never taken as live)
     stPrice(q, perp)         the price a pushed quote stands for, as the account prices a market from its stream (live/paper.ts
                              streamed): a perpetual's the middle of its best bid and ask (its mark, else its last trade, where there is
                              no book), anything else its last trade (else the middle); undefined where it says none
     stDrawn(q)               a pushed quote has just been drawn (the market bar, the chart: inside the frame that shows it): how long
                              after its venue's own moment of its best bid and ask (`priceAt`) it reached the screen is kept, once for
                              each such moment — the last ST_LAG_N of them, nothing written anywhere, nothing logged — and stLag() says it:
                              { n, p50, p95, last } in ms, or null before any. A quote with no venue moment of its own is not counted,
                              nor a market's first on a stream (the stream's word on it as it stands, which may be from long before)
     stDot()                  every [data-st-dot] on the page says the health: a dot and a word, the rest on hover

   The tab names itself on its stream (ST_CLIENT, made when the page loads and never kept: a tab duplicated, or reloaded, is another page),
   so the account knows which markets this tab follows. */

/* the events the account sends, each heard by name (a browser hands an event with a name only to a listener for that name) */
const ST_EVENTS = ["snapshot", "order", "fill", "position", "balance", "paper", "statement", "card", "desk", "quote", "trades", "book", "hb"];
const ST_STALE_MS = 20_000;
const ST_DEAD_MS = 45_000;
const ST_WATCH_MS = 5_000;
const ST_RETRY_MS = [1_000, 2_000, 5_000, 10_000, 30_000];
/* the most markets one tab follows (the account keeps as many: account/stream.ts MAX_FOLLOWS) */
const ST_FOLLOW_MAX = 16;
/* this tab's own name on its stream: random where the browser makes one, else from the clock and Math.random */
const ST_CLIENT = (() => {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return `tab-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
  } catch {
    // no crypto here: the clock's
  }
  return `tab-${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
})();
/* the stream's state: the EventSource open now (null when none), the health, the last event's id, when the stream was last heard from, whether
   the shell started it, the opens refused in a row, the timer that opens it again, the watch that finds it silent, who listens, the keys
   this tab follows as the account is told them (a price-only one with its "~"), the number of the last telling of them (it only rises) and
   the timer that says one again, and the latest quote pushed for each market followed (by `<venue>:<symbol>`; never more than it follows) */
const STREAM = { es: null, health: "down", lastId: "", heardAt: 0, started: false, fails: 0, timer: 0, watch: 0, subs: new Map(), follows: [], told: 0, tellTimer: 0, quotes: new Map() };
/* a telling of the markets the account did not take (no answer, a refusal) is said once more this much later */
const ST_TELL_AGAIN_MS = 1_000;
/* how many of the latest quote-to-screen times are kept (stDrawn), and the venue moment last drawn for each market (by key: the bar and the
   chart drawing one quote count it once, and a quote that moved nothing of its best bid and ask — a mark, a trade — is not counted again) */
const ST_LAG_N = 64;
const ST_LAG = { ms: [], seen: new Map() };

function stOn(type, fn) {
  const set = STREAM.subs.get(type) || new Set();
  set.add(fn);
  STREAM.subs.set(type, set);
  return () => void set.delete(fn);
}
const stHealth = () => STREAM.health;

function stStart() {
  if (STREAM.started) return;
  STREAM.started = true;
  stOpen();
}

/* one stream opened, where there can be one: a browser with EventSource, a tab in view, none open already */
function stOpen() {
  clearTimeout(STREAM.timer);
  STREAM.timer = 0;
  if (typeof EventSource === "undefined") return void stSet("down");
  if (STREAM.es || (typeof document !== "undefined" && document.hidden)) return;
  let es;
  try {
    es = new EventSource(`/api/account/stream?${STREAM.lastId ? `since=${encodeURIComponent(STREAM.lastId)}&` : ""}client=${ST_CLIENT}`);
  } catch {
    return void stLater();
  }
  STREAM.es = es;
  es.onopen = () => {
    if (STREAM.es !== es) return;
    STREAM.fails = 0;
    STREAM.heardAt = Date.now();
    stSet("connected");
    // what this tab shows, said again on every stream it opens — none too: the account forgot it when the last one closed, or carried the
    // last one's over to this one, which may follow what the tab has stopped showing meanwhile
    stTellFollows();
  };
  es.onerror = () => {
    if (STREAM.es !== es) return;
    // what the stream pushed is no market's word now (as stClose lets it go): the account says each again when the stream that opens next
    // follows it
    stForget();
    // CONNECTING again: the browser asks again by itself, after the second the stream said, naming the last id it heard. CLOSED: it gave up
    // (a 503, an answer that was no stream) — asked again here, later each time
    if (es.readyState === 2) {
      es.close();
      STREAM.es = null;
      stSet("down");
      stLater();
    } else stSet("down");
  };
  for (const type of ST_EVENTS) es.addEventListener(type, (e) => stHeard(es, type, e));
  stWatch();
}
/* the markets this tab shows: said to the account now when the stream is open, and again whenever one opens — the ones shown whole first,
   then the ones whose price alone is shown, each with its "~" (none that is shown whole as well), ST_FOLLOW_MAX in all. A quote kept for a
   market no longer followed goes */
function stFollow(keys, marks = []) {
  const ok = (list) => [...new Set((Array.isArray(list) ? list : []).filter((k) => typeof k === "string" && k.indexOf(":") > 0 && k[0] !== "~"))];
  const whole = ok(keys);
  const next = [...whole, ...ok(marks).filter((k) => !whole.includes(k)).map((k) => `~${k}`)].slice(0, ST_FOLLOW_MAX);
  for (const k of [...STREAM.quotes.keys()]) if (!next.includes(k) && !next.includes(`~${k}`)) STREAM.quotes.delete(k);
  // a market no longer followed: its first quote once it is followed again is the stream's word on it as it stands (stDrawn)
  for (const k of [...ST_LAG.seen.keys()]) if (!next.includes(k) && !next.includes(`~${k}`)) ST_LAG.seen.delete(k);
  if (next.join("\n") === STREAM.follows.join("\n")) return;
  STREAM.follows = next;
  stTellFollows();
}
/* the latest quote pushed for a market this tab follows, while the stream is connected (stQuoteOf in the head of this file) */
function stQuoteOf(venue, symbol) {
  if (STREAM.health !== "connected") return null;
  return STREAM.quotes.get(`${venue}:${symbol}`) || null;
}
/* a quote pushed, kept as the market's latest — never one from before the one kept (an older seq of the same market's stream) */
function stKeepQuote(q) {
  if (!q || typeof q !== "object" || typeof q.venue !== "string" || typeof q.symbol !== "string") return;
  const k = `${q.venue}:${q.symbol}`;
  if (!STREAM.follows.includes(k) && !STREAM.follows.includes(`~${k}`)) return;
  const had = STREAM.quotes.get(k);
  if (had && Number(q.seq) < Number(had.seq)) return;
  STREAM.quotes.set(k, { ...q, gotAt: Date.now() });
}
/* the price a pushed quote stands for (stPrice in the head of this file) */
function stPrice(q, perp) {
  if (!q) return undefined;
  const pos = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);
  const bid = pos(q.bid);
  const ask = pos(q.ask);
  const mid = bid !== undefined && ask !== undefined && ask >= bid ? (bid + ask) / 2 : undefined;
  return perp ? (mid ?? pos(q.mark) ?? pos(q.last)) : (pos(q.last) ?? mid);
}
/* A PUSHED QUOTE DRAWN: how long after its venue's own moment of the best bid and ask it carries (`priceAt`) it reached the screen — counted
   once for each such moment of a market (the bar and the chart drawing it count it once; a quote a mark or a trade sent, with the same best
   bid and ask, is no new moment), the last ST_LAG_N. Never from another moment: a quote its venue stamped no such moment on (its `at` may be
   this machine's own clock then, or another channel's) is not counted, and neither is a market's first since it was followed or the stream
   opened — the stream's word on it as it stands, which may be from long before. A clock a little behind the venue's never makes it less
   than nothing. Nothing is written anywhere and nothing is logged: the page shows it (stLag) where it says how its prices come */
function stDrawn(q) {
  const at = q ? Date.parse(String(q.priceAt || "")) : NaN;
  if (!Number.isFinite(at)) return;
  const k = `${q.venue}:${q.symbol}`;
  const had = ST_LAG.seen.get(k);
  if (had !== undefined && at <= had) return;
  ST_LAG.seen.set(k, at);
  if (ST_LAG.seen.size > ST_FOLLOW_MAX * 4) ST_LAG.seen.delete(ST_LAG.seen.keys().next().value);
  if (had === undefined) return;
  ST_LAG.ms.push(Math.max(0, Date.now() - at));
  if (ST_LAG.ms.length > ST_LAG_N) ST_LAG.ms.shift();
}
/* a short time as it is said: 180 ms under a second, 1.4 s above */
const stMs = (ms) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
/* the quote-to-screen times kept: how many, the middle one, the one 95 in 100 come within, the last; null before any */
function stLag() {
  const n = ST_LAG.ms.length;
  if (!n) return null;
  const sorted = [...ST_LAG.ms].sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(n - 1, Math.floor(p * n))];
  return { n, p50: at(0.5), p95: at(0.95), last: ST_LAG.ms[n - 1] };
}
/* THE MARKETS THIS TAB SHOWS, told to the account on the stream open now — each telling numbered one more than the last (n), so the account
   takes only the latest it has heard, however two said back to back (the market showing, then its positions' marks) overtake each other
   on their way. One the account did not take (no answer, a refusal: the account not answering, a stream it does not know yet) is said once
   more a second later — only while that stream is still the one open and nothing newer was said since: the next telling, or the next
   stream's, says the list as it is then */
function stTellFollows(again = false) {
  const es = STREAM.es;
  if (!es || es.readyState !== 1 || typeof fetch !== "function") return;
  const n = ++STREAM.told;
  clearTimeout(STREAM.tellTimer);
  STREAM.tellTimer = 0;
  let sent;
  try {
    sent = fetch("/api/account/stream/markets", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client: ST_CLIENT, markets: STREAM.follows, n }) });
  } catch {
    sent = null;
  }
  // taken: an answer of 2xx (a browser's Response says it as `ok`)
  Promise.resolve(sent)
    .then((r) => !!r && (typeof r.ok === "boolean" ? r.ok : Number(r.status) >= 200 && Number(r.status) < 300), () => false)
    .then((taken) => {
      if (taken || again || STREAM.es !== es || es.readyState !== 1 || STREAM.told !== n) return;
      STREAM.tellTimer = setTimeout(() => {
        STREAM.tellTimer = 0;
        if (STREAM.es === es && STREAM.told === n) stTellFollows(true);
      }, ST_TELL_AGAIN_MS);
    });
}
/* what a stream pushed let go, as it stops being one this tab hears (closed, dropped, or a snapshot: the account started again): its
   quotes are no market's word now, and each market's next quote is the stream's word on it as it stands (stDrawn counts none of them) */
function stForget() {
  STREAM.quotes.clear();
  ST_LAG.seen.clear();
}
/* the stream closed (the tab hidden, a silent stream let go): nothing more is heard from it */
function stClose() {
  if (STREAM.es) STREAM.es.close();
  STREAM.es = null;
  // what the closed stream pushed is no market's word now: the account says each again when the next stream follows it
  stForget();
  clearTimeout(STREAM.tellTimer);
  STREAM.tellTimer = 0;
  clearInterval(STREAM.watch);
  STREAM.watch = 0;
  stSet("down");
}
/* opened again later: after a second, then 2, 5, 10, and every 30 s after that (back to a second once one is open) */
function stLater() {
  clearTimeout(STREAM.timer);
  STREAM.timer = setTimeout(stOpen, ST_RETRY_MS[Math.min(STREAM.fails, ST_RETRY_MS.length - 1)]);
  STREAM.fails++;
}
/* every few seconds while one is open: a stream silent past ST_STALE_MS is stale, past ST_DEAD_MS let go and opened again (from where it
   stopped) — a socket the network dropped without a word is never trusted as connected */
function stWatch() {
  if (STREAM.watch) return;
  STREAM.watch = setInterval(() => {
    if (!STREAM.es) return;
    const quiet = Date.now() - STREAM.heardAt;
    if (quiet > ST_DEAD_MS) {
      stClose();
      stOpen();
    } else if (quiet > ST_STALE_MS && STREAM.health === "connected") stSet("stale");
  }, ST_WATCH_MS);
}
/* an event heard: the stream is alive, the id kept (where the next stream starts from), and the event handed on (a heartbeat only keeps the
   stream alive) */
function stHeard(es, type, e) {
  if (STREAM.es !== es) return;
  STREAM.heardAt = Date.now();
  if (e && e.lastEventId) STREAM.lastId = String(e.lastEventId);
  if (STREAM.health !== "connected") stSet("connected");
  if (type === "hb") return;
  let data = null;
  try {
    data = JSON.parse(e.data);
  } catch {
    return;
  }
  // a market's quote kept as its latest, before its listeners hear it (they read it with stQuoteOf); a snapshot (the account started
  // again, or the stream could not resume) lets go of every quote kept: the markets' streams count afresh, and say themselves again
  if (type === "quote") stKeepQuote(data);
  else if (type === "snapshot") stForget();
  stTell(type, data);
}
/* an event handed to its listeners and to those of "*"; a listener that throws is its own fault */
function stTell(type, data) {
  for (const fn of [...(STREAM.subs.get(type) || []), ...(STREAM.subs.get("*") || [])]) {
    try {
      fn(data, type);
    } catch (err) {
      console.error(err);
    }
  }
}
/* the health set, told, and shown */
function stSet(h) {
  if (STREAM.health === h) return;
  STREAM.health = h;
  for (const fn of [...(STREAM.subs.get("health") || [])]) {
    try {
      fn(h);
    } catch (err) {
      console.error(err);
    }
  }
  stDot();
}
/* the health in a word, as the dot says it, and what it means on hover */
function stWords(h = STREAM.health) {
  if (h === "connected") {
    const lag = stLag();
    return ["Live", `Account updates arrive as they happen: orders, fills, positions, balances${lag ? `. The prices pushed reach this screen about ${stMs(lag.p50)} after their venue's own moment (the middle of the last ${lag.n}; 95 in 100 within ${stMs(lag.p95)})` : ""}.`];
  }
  if (h === "stale") return ["Quiet", `No word from the account for ${Math.round((Date.now() - STREAM.heardAt) / 1000)} s: the page also reads it every few seconds, and asks for the stream again.`];
  const why = typeof EventSource === "undefined" ? "This browser has no event streams" : !STREAM.started ? "The account is being read" : typeof document !== "undefined" && document.hidden ? "The tab is hidden" : "The stream is not connected";
  return ["Polling", `${why}: the page reads the account every few seconds instead.`];
}
/* every dot on the page drawn from the health (the trading area's foot carries one: ui/terminal.js) */
function stDot() {
  if (typeof document === "undefined" || typeof document.querySelectorAll !== "function") return;
  const [word, title] = stWords();
  for (const el of document.querySelectorAll("[data-st-dot]")) {
    if (el.dataset) el.dataset.st = STREAM.health;
    if (el.textContent !== word) el.textContent = word;
    if (el.setAttribute) el.setAttribute("title", title);
  }
}

/* hidden: the stream closed (a hidden tab holds none of the browser's few connections to the account); shown: opened again from the last id
   it heard, so what came meanwhile comes now */
if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  document.addEventListener("visibilitychange", () => {
    if (!STREAM.started) return;
    if (document.hidden) stClose();
    else stOpen();
  });
}
