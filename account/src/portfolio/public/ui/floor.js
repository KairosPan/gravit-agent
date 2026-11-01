/* THE FLOOR — the superagent's desk drawn as a trading floor on one canvas: a deep-sea room in the trading area's colours, a back wall with the
   wall screen, the ticker tape, a New York clock, the target trophy, the shredder and the brain's rack, and on the floor one desk per seat
   of the Desk (Head, Search, Risk, Sniper, Exit, Watch, and the two seats only an outside agent can take, Flow and Sentiment) with a soft
   blob mascot at each, speaking in bubbles, passing leads to one another as glowing packets and firing orders at the wall screen.

   NOTHING MADE UP. This is a scene engine and nothing else: it reads nothing and asks nothing. The page (ui/superagent.js) gives it the
   desk's state, whole, with set(state) — about once a second — and one animation event per thing the desk did with push(event). Every
   figure, every line on the wall screen, every packet that flies and every word in a bubble comes from one of the two, and so from a real
   Desk event, a real paper order or fill, or a real public read. What moves on its own is decor and is drawn as decor, never as data: the
   mascots breathe and blink and follow the pointer with their eyes, the room has parallax, the rack's idle LEDs blink dimly, the trophy's
   meniscus shimmers at its real level. A seat nobody sits in is drawn empty — an empty chair, its monitor off — and says why under it. A
   seat the page has not read yet (seats: null) is not called empty: its chair and its mascot's outline are drawn dim, its monitor off, no
   words under its name, and the canvas's words say "Seats: reading…". The radar dish at the Flow seat and the antenna at the Sentiment
   seat stand still while their seats are empty: they pulse only when the agent sitting there says something. Nothing is drawn where there
   is no data: no market in focus, no candles; no scan, no network; no quotes, no tape — each place says so in words instead.

   The story before the state. The page reads the desk once a second and hands the floor the state as it stands now, then the events that
   led there; the events take seconds to play. So the floor keeps a shown copy of what the events change and moves each part of it only
   when its event plays, never ahead of the story: the shredder counts a reject once its packet has gone in (the state's count less the
   rejects still in line or in the air); the Head's funnel and the scan (the network, Search's bars, the caption) change when the Head's
   cycle line plays — the scan already when Search first speaks or throws in that cycle; the wall screen turns to a new lead's market when
   that lead's first packet lifts; a mark is drawn on it when its fill plays. The Head's cycle line itself waits until everything queued
   before it has started and no packet is in the air: the summary comes after what it sums up. What the session says (paused, halted,
   ended, not read) shows at once; when the session leaves "live", or the page stops reading (stale), what was still waiting to be said is
   let go and every packet lands at once, so the last cycle is never narrated in the dark. While the floor is stale it starts no new
   bubble or packet, draws a dim veil and says since when it has not been read; the mascots keep breathing.

   Mounting
     flMount(canvas, { onPick? })   the floor drawn into canvas; returns a handle:
       set(state)    the whole current state (below); cheap to call every second: what changed is laid out again, nothing else
       push(event)   one animation event (below), queued and played in order per actor — and per lead, so a lead's packet lands at Risk
                     before Risk's verdict on it plays — while the loop runs; applied at once, as its end state, when it does not (reduced
                     motion, the canvas scrolled away, the page hidden)
       release()     the loop stopped, every listener and observer dropped; what is drawn stays
       stats()       { fps, p95ms, scriptMs, long, idle, lite, still }: the display's frame rate (the median interval between the browser's
                     own frame callbacks, the last 120 of them), the 95th percentile of that interval — how long a frame really took to
                     come round, painting and everything else on the page included, not only this engine's part — the 95th percentile
                     of the time this engine's own script spent on a drawn frame (scriptMs: a part of the frame, never to be shown as
                     the frame), how many long animation frames the browser reported over the last ten seconds (long: where the browser
                     reports them, else null), whether the floor is resting at its idle rate (nothing moving: a frame drawn at most every
                     33 ms), whether the engine dropped to its lighter setting, and whether it is still (reduced motion or no frames to
                     draw in); fps, p95ms and scriptMs are 0 until thirty frames were measured
     onPick({ role })   a click on a mascot, its chair or its desk;   onPick({ symbol })   a click on the wall screen or a scan node;
     onPick({ tray: true })   a click on the owner's tray at the front edge (the page brings its "Waits for you" strip into view)

   state = {
     session: { state: "live" | "paused" | "halted" | "ended" | "none", halted?: { why } },
     seats:   null (not read yet) | [{ role, name, kind: "house" | "outside" | "empty", status: "ok" | "not let in" | "expired" | "revoked" |
                 "empty", why?, limit?: { perOrderUsd, leftUsd, budgetUsd }, lastOrder?: { usd } }],
     cards:   the owner's cards waiting from this desk's seats (a whole number; absent: not known),
     autonomy: true while the desk places its own paper orders without a card,
     stale:   { since } (an ISO time) once the page has failed to read the desk twice running, null otherwise,
     working: { role, what, lead? } | null,   inFlight: number (brain calls under way),   brain: { ok, why? },
     focus:   { symbol, name, kind, candles: [{ t, o, h, l, c, v? }], price?, priceStep?, marks: [{ lead, side, entry, tp?, sl?, state }] }
              | null,
     scan:    { at, rows: [{ symbol, changePct24h?, volumeUsd24h? }], picked: [symbol] } | null,
     funnel:  { scanned, cleared, executed, closed, rejected },   rejected: number,
     target:  { progressPct },   equity: { nowUsd, startUsd },
     ticker:  [{ text, dir: "up" | "down" | "flat" }],   clock: { zone: "America/New_York" },
     — and, where the page has them (each drawn only when given; a monitor without its figure says so): checks: { spreadPct, maxSpreadPct?,
       maxSizeUsd, lossRoomUsd, minNotionalUsd } (Risk's latest hard checks, and the desk's own spread line: without it the gauge draws
       no line at all), open: [{ lead, symbol, side, pnlUsd? }] (the open leads, each with its
       P&L where it has one: a lead with none yet — confirmed, or executed before its first mark — is kept, drawn as a hollow mark with
       no bar; open absent is "not known" ("—"), open: [] is "no open lead"), seats[].lastOrder (the seat's newest order size, so the
       Sniper's monitor survives a reload; without it the Sniper's own order events since mount, never another seat's)
   }
   event — one object whose `type` names its kind; by kind, the fields it carries and what the floor makes of it:
     say       role, text, kind, raw?               a room line: a speech bubble, typed out — text is the line in plain English, raw the
                                                    room's line as written (shown only where no text came, its " | " read as " · ")
     think     role, on                             a brain call starts or ends for a role (played at once: it is a state)
     handoff   lead, symbol, side, from, to         a lead moves between seats
     reject    lead, symbol, from, why              the lead's packet into the shredder
     order     lead, symbol, side, usd, role        the Sniper or Exit fires: a beam to the wall screen and a BUY/SELL tag
     fill      lead, symbol, side, price, qty       the tag bursts and turns into "FILLED qty SYM @ price": a buy's burst in mint, a
                                                    sell's in coral (the spec's mint is a buy's; the tag and the glyph carry the side
                                                    too, never the colour alone)
     exit      lead, symbol, why, pnlUsd            why one of tp, stop, time, liq, brain, other
     card      lead, symbol, role                   the order waits for the owner: the packet flies to the inbox tray
     halt      why                                  played at once: the banner shows with its why at once, until the next set() says
                                                    how the session stands
     cycle     n                                    played at once: the CYCLE n stamp at the Head

   Pure, and what the tests read (no DOM)
     flLayout(w, h) · flSpring(s, target, dtMs, k, c) · flBezier(...) · flArc(...) · flEase* · flQueueNew/flQueuePush/flQueueDue/
     flActorOf · flScanLayout(rows, picked, box, hole) · flTickerLoop(widths, gap) · flTickerOffset(tMs, pxPerSec, width) ·
     flNodeColor(change, pal) · flWrap(text, maxW, measure, maxLines) · flSnap(v, dpr, lw) · flRgb(css) · flPalette(el) · flAria(state) ·
     flPercentile(buf, n, q, scratch) · flDegrade(d, t, p75) · flNorm(state) · flPrice(n, step, ref)/flUsd/flSigned · flTickerSwapAt(off,
     loopW, tapeW) · flPlace(ax, ay, w, h, gap, W, rects, n, out) · flSearchBars(rows, picked) · flEmptyShort(seat) · flTicks(lo, hi, n,
     out) · flIsCycleLine(entry) · flTrayWords(cards, autonomy) · flMarkLabels(labs, top, bottom, pitch) · flMarkWords(mark, step) ·
     flScreenHead(focus) · flBase(symbol) · flKindName(kind) · flSniperText(E, usd, per, w, fs) · flRestore(E) · flDprNow(w, h) ·
     flBrainCode(brain)/flBrainWord(brain) · flScreenNone(scan) · flScreenFit(...)/flMarksApart(...) · flDecimals(x)

   The engine. One requestAnimationFrame loop at whatever rate the display runs (120 Hz where it can), each step capped at 50 ms so a
   stalled frame never throws a packet across the room. The canvas is drawn at the device's pixel ratio up to 2 — 1.5 where that would
   make it more than two million device pixels, for the cost of a frame grows with them — sized by a ResizeObserver; the loop stops while
   the canvas is scrolled out of view (IntersectionObserver) or the page is hidden, and is not measured for the gap. When nothing moves —
   no packet, particle, ring, beam or floating figure in the air, no bubble typing, every spring settled, nothing waiting in line — the
   floor rests: it still takes each of the browser's frame callbacks (so the display's own rate is what is measured) but draws at most
   every 33 ms, and is back at the full rate at once on a push(), a set() that changed something, or a pointer move. Particles, packets,
   rings, tags and beams live in pools made at mount: a frame allocates nothing it can avoid. Glows are drawn from small sprites rendered
   once; the wall and the floor are rendered once per size into layers; colours are kept as strings per alpha step; text is measured once
   and kept. Motion is springs (a pop that overshoots by 6 %, a jelly squash, a soft settle), never a linear tween: anticipation before a
   packet lifts, follow-through when it lands, staggered arrivals. The site's rule for slow machines (site/main.js): a phone-sized screen
   (narrower than 720 px) starts lite; elsewhere, after the first six seconds, once three frame intervals in four have been longer than
   22 ms for four seconds running (counted again from nothing each time the loop restarts), the engine drops to lite once and for good —
   no glows, trails or scanlines, half the particles; the pixel ratio stays, so the words stay sharp. With prefers-reduced-motion there
   is no loop at all: one still frame is drawn on each set() and push() (and when the canvas comes back into view), bubbles show their
   whole text, nothing flies, bursts or shakes. Words are wrapped once per text, size and font, not per frame; the canvas's place on the
   page is read on a resize or a scroll, not per pointer move; a change of the pixel ratio (the window moved to another display) sizes
   the canvas again. No word is drawn smaller than 9 CSS pixels (the tray's and the seats' words not under 10): where one would not fit
   at that size it is said shorter, or not drawn, never squeezed. On a narrow floor (a phone) at most two bubbles show at once, placed
   clear of each other and of the seats' labels, each seat's words fitted to the room beside it, and the captions are cut short to fit.
   An ended session turns every light off but the wall screen's. The canvas keeps no state of its own across a save and a restore: after
   each restore (flRestore) the font and the letter spacing it holds are taken as unknown and set again before the next word.

   Colours and type: the trading area's tokens (ui/tokens.css, the --hl-* set behind the Account's names there) read from the canvas's
   container with getComputedStyle, each from the first name it sets (FL_VARS): the room keeps its own deep-sea field (--sg-deep and
   --sg-deep-2 on .sg-floor, else --bg and --surface), the words in --text and --dim, the lines in --sg-line (else --border), the accent
   in --sg-mint (else --primary) with --sg-ink (else --on-primary) on it, rises and falls in --up and --down (the area's green and red),
   what waits in --warn, the screen's scanlines in --sg-scan, the glass and the shadows toward --sg-shadow (else the deep sea darkened),
   each mascot in --sg-r-<role> (the same colour as the role's card); FL_PALETTE's values where none is set. Every word is in the area's
   face (--font-sans: Manrope there), as a trading screen draws it: no monospace face is drawn. The ▲/▼ glyphs ride with every up
   and down: never colour alone. Amber is for what waits (the owner's tray while a card waits, a seat not let in) and the halt banner's
   second line only. */

/* the seats, in the Desk's order (src/portfolio/account/desk.ts ROLES), and the words each is called by */
const FL_ROLES = ["head", "search", "risk", "sniper", "exit", "watch", "flow", "sentiment"];
const FL_NAMES = { head: "Head", search: "Search", risk: "Risk", sniper: "Sniper", exit: "Exit", watch: "Watch", flow: "Flow", sentiment: "Sentiment", you: "You", account: "Account" };
/* where each seat stands on the floor: u across the room (0 its left wall, 1 its right), v its depth (0 the back wall, 1 the front edge).
   The pipeline reads left to right along the back row — Search, Risk, Sniper, Exit — so a lead's packet travels the way the eye reads;
   the front row holds the two outside seats at the left, Watch, and the Head of the floor front-right with its headset */
const FL_SEATS = {
  search: { u: 0.17, v: 0.3 },
  risk: { u: 0.39, v: 0.3 },
  sniper: { u: 0.61, v: 0.3 },
  exit: { u: 0.83, v: 0.3 },
  flow: { u: 0.11, v: 0.8 },
  sentiment: { u: 0.31, v: 0.8 },
  watch: { u: 0.6, v: 0.8 },
  head: { u: 0.86, v: 0.8 },
};
/* why an empty seat is empty, where the state does not say: the two outside seats wait for an outside agent with a feed */
const FL_EMPTY_WHY = { flow: "empty seat — needs a feed", sentiment: "empty seat — needs a feed" };
/* what a seat is doing (the desk's `working.what`), as the floor writes it under the seat's name */
const FL_WHAT = { scan: "scanning", clear: "clearing", enter: "entering", exit: "exiting", close: "closing", report: "reporting", review: "reviewing", follow: "following orders" };
/* each mascot's tint, inside the accent's family: the accent mixed toward the room's text (lighter) or its surface (darker) by a step of its
   own, so no two seats share a lightness; the name under each mascot says who it is, never the colour alone */
const FL_TINT = { head: ["text", 0.42], search: ["text", 0.14], sniper: ["surface", 0.06], watch: ["surface", 0.17], exit: ["surface", 0.26], risk: ["surface", 0.34], flow: ["surface", 0.43], sentiment: ["surface", 0.5] };
/* the colours where the container sets none: the floor's own deep-sea field and the trading area's tokens (ui/tokens.css, the ocean's
   Black) — its text, its dim words, its accent (the wake's cyan) and the near-black on it, its up green and its down red — and the amber
   of what waits */
const FL_PALETTE = {
  bg: "#05090c",
  surface: "#0c161b",
  text: "#f2f2f0",
  dim: "#9d9d98",
  line: "rgba(140,239,255,0.16)",
  mint: "#8cefff",
  ink: "#00161b",
  up: "#3fcf72",
  down: "#ff6b61",
  warn: "#f5c46b",
  scan: "rgba(0,0,0,0.16)",
};
/* where each colour is read from on the container, first found wins: the floor's own names (--sg-*, set on .sg-floor) before the
   trading area's (the Account's names as tokens.css redefines them there) */
const FL_VARS = {
  bg: ["--sg-deep", "--bg"],
  surface: ["--sg-deep-2", "--surface"],
  text: ["--text"],
  dim: ["--dim"],
  line: ["--sg-line", "--border"],
  mint: ["--sg-mint", "--primary"],
  ink: ["--sg-ink", "--on-primary"],
  up: ["--up"],
  down: ["--down"],
  warn: ["--warn"],
  scan: ["--sg-scan"],
};
/* each seat's name as its label writes it, made once */
const FL_UPPER = Object.fromEntries(FL_ROLES.map((r) => [r, FL_NAMES[r].toUpperCase()]));
/* a screen narrower than this is a phone's: the floor starts lite there, as the site does (site/main.js) */
const FL_LITE_WIDTH = 720;
/* how many speech bubbles may show at once: two on a narrow floor (a phone), five elsewhere; a line waits its turn beyond that */
const FL_BUBBLE_CAP = { narrow: 2, wide: 5 };
/* where a bubble may sit, as a fraction of its width either side of its speaker, tried in this order before lifting it higher */
const FL_BUB_DX = [0, -0.55, 0.55, -1.1, 1.1];
/* the springs, as [stiffness, damping] per second: pop overshoots by 6 % (damping ratio 0.67), snap is the same shape faster, jelly
   wobbles (a squash on a catch), soft and drift settle without overshoot (lights, parallax, a node flying to its place) */
const FL_SPRING = { pop: [320, 24], snap: [520, 30.6], jelly: [380, 13], soft: [90, 19], drift: [36, 12] };
/* a bubble types at 45 characters a second and holds four seconds plus 30 ms a character; an actor keeps at most four lines waiting to
   be said (the oldest let go: the room panel beside the floor keeps every line); at most 120 events wait in all */
const FL_TYPE_CPS = 45;
const FL_HOLD_MS = 4000;
const FL_HOLD_PER_CHAR = 30;
const FL_SAYS_KEPT = 4;
const FL_QUEUE_MAX = 120;
/* pools made at mount: particles (sparks, bursts, paper strips, the paused room's z's), packets in flight, rings, floating figures, tags on
   the wall screen, beams, slips in the tray */
const FL_PARTICLES = 640;
const FL_PACKETS = 16;
const FL_RINGS = 28;
const FL_FLOATS = 8;
const FL_TAGS = 10;
const FL_BEAMS = 6;
const FL_SLIPS = 3;
/* the tape scrolls at 46 px a second at full scale; the spread gauge reaches 1.2 % (twice desk.ts MAX_SPREAD_PCT) when the state gives
   no spread line of its own — then it draws no line, only the reading, for the line is the desk's to say (checks.maxSpreadPct); the rack has 12
   LEDs; the frame measures keep the last 120 frames */
const FL_TICKER_PXS = 46;
const FL_SPREAD_MAX = 0.6;
const FL_RACK_LEDS = 12;
const FL_FRAMES = 120;
/* the smallest word the floor draws, in CSS pixels: anything that would need less is said shorter or not drawn; the tray's words and the
   seats' captions are held to 10 */
const FL_MIN_TEXT = 9;
const FL_MIN_WORDS = 10;
/* resting: a frame drawn at most every 33 ms while nothing moves, and the full rate again for 600 ms after anything wakes the floor */
const FL_IDLE_MS = 33;
const FL_WAKE_MS = 600;
/* the device pixels past which the pixel ratio is held to 1.5 (a frame's cost grows with them) */
const FL_MAX_PX = 2_000_000;
/* what a market's kind is called on the wall screen */
const FL_KINDS = { coin: "Crypto", crypto: "Crypto", stock: "Stock", equity: "Stock", event: "Event", perp: "Perpetual", spot: "Spot", fund: "Fund", etf: "ETF" };
/* the fixtures' words, longest first: a narrow floor's fixture says the shorter where the longer does not fit at the least size */
// (the trophy's label goes under its figure, so the two read as progress: "−0.2% OF TARGET")
const FL_SAY_TARGET = ["OF TARGET", "OF GOAL"];
const FL_SAY_REJECTED = ["REJECTED", "REJECTS"];
/* at most this many scan nodes and every one is named at rest; beyond it only the picked */
const FL_NAMED_NODES = 12;
/* the dash patterns, made once */
const FL_DASH_0 = [];
const FL_DASH_2 = [2, 2];
const FL_DASH_33 = [3, 3];
const FL_DASH_54 = [5, 4];
const FL_DASH_23 = [2, 3];
/* Intl formatters, made on first use */
const FL_FMT = {};

/* ---- small pure helpers ----------------------------------------------------------------------------------------------------- */

const flClamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const flLerp = (a, b, t) => a + (b - a) * t;
/* the easings, each from 0 to 1 over 0..1: out-cubic for arrivals, in-out-cubic for flights, out-back for pops that overshoot */
const flEaseOutCubic = (t) => 1 - Math.pow(1 - flClamp(t, 0, 1), 3);
const flEaseInCubic = (t) => Math.pow(flClamp(t, 0, 1), 3);
const flEaseInOutCubic = (t) => {
  const x = flClamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
const flEaseOutBack = (t, s = 1.70158) => {
  const x = flClamp(t, 0, 1) - 1;
  return 1 + (s + 1) * x * x * x + s * x * x;
};

/* a string's 32-bit FNV-1a hash: what seeds a role's blinks and a node's first place, the same every time */
function flHash(s) {
  let h = 0x811c9dc5;
  const t = String(s ?? "");
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
/* a small seeded generator (mulberry32): decor's timings, never a figure */
function flRng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* one damped spring step, in place: s = { x, v }, moved toward target over dtMs (capped at 50 ms), integrated in sub-steps of at most
   1/240 s so the same motion comes out at 60 Hz and at 120 Hz; a spring at rest within a hair of its target is set on it. Returns s.x */
function flSpring(s, target, dtMs, k, c) {
  let left = flClamp(Number(dtMs) || 0, 0, 50) / 1000;
  while (left > 1e-9) {
    const h = left > 1 / 240 ? 1 / 240 : left;
    const a = -k * (s.x - target) - c * s.v;
    s.v += a * h;
    s.x += s.v * h;
    left -= h;
  }
  if (Math.abs(s.x - target) < 1e-4 && Math.abs(s.v) < 1e-3) {
    s.x = target;
    s.v = 0;
  }
  return s.x;
}

/* a point on a cubic Bézier, written into out ({ x, y }): no allocation per call */
function flBezier(ax, ay, bx, by, cx, cy, dx, dy, t, out) {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  out.x = a * ax + b * bx + c * cx + d * dx;
  out.y = a * ay + b * by + c * cy + d * dy;
  return out;
}
/* the two control points of an arc from (ax, ay) to (dx, dy) that rises above both ends — a thrown packet's path: lift grows with the
   distance (40 px plus a third of it, at most 220) unless given; written into out ({ bx, by, cx, cy }) */
function flArc(ax, ay, dx, dy, lift, out) {
  const dist = Math.hypot(dx - ax, dy - ay);
  const up = Number.isFinite(lift) ? lift : Math.min(220, 40 + dist * 0.34);
  const top = Math.min(ay, dy) - up;
  out.bx = ax + (dx - ax) * 0.22;
  out.by = top;
  out.cx = ax + (dx - ax) * 0.78;
  out.cy = top;
  return out;
}

/* a line at v drawn crisp at this pixel ratio: a line whose width covers an odd number of device pixels sits on a pixel's centre, an
   even one on the edge between two */
function flSnap(v, dpr, lw = 1) {
  const r = dpr > 0 ? dpr : 1;
  const px = Math.max(1, Math.round(lw * r));
  return px % 2 ? (Math.floor(v * r) + 0.5) / r : Math.round(v * r) / r;
}

/* a CSS colour as [r, g, b, a] (hex in 3, 6 or 8 digits, rgb(), rgba()); anything else is null */
function flRgb(css) {
  const t = String(css ?? "").trim().toLowerCase();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(t);
  if (m) {
    let hx = m[1];
    if (hx.length === 3) hx = hx.replace(/./g, "$&$&");
    const n = parseInt(hx.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, hx.length === 8 ? Math.round((parseInt(hx.slice(6), 16) / 255) * 1000) / 1000 : 1];
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/.exec(t);
  if (m) {
    const al = m[4] === undefined ? 1 : Number(m[4]) / (m[5] ? 100 : 1);
    const rgb = [Number(m[1]), Number(m[2]), Number(m[3]), flClamp(al, 0, 1)];
    return rgb.every(Number.isFinite) ? rgb : null;
  }
  return null;
}
/* a colour as CSS at an extra opacity a */
function flCss(rgb, a = 1) {
  const al = flClamp((rgb[3] ?? 1) * a, 0, 1);
  return `rgba(${Math.round(rgb[0])},${Math.round(rgb[1])},${Math.round(rgb[2])},${Math.round(al * 1000) / 1000})`;
}
/* two colours mixed: f of the way from a to b (opacity from a) */
function flMix(a, b, f) {
  return [flLerp(a[0], b[0], f), flLerp(a[1], b[1], f), flLerp(a[2], b[2], f), a[3] ?? 1];
}
/* the floor's colours: each read from the container's custom properties where it sets one (FL_VARS), FL_PALETTE's where it does not;
   with no element, or no getComputedStyle (a page without a window), FL_PALETTE's. Where the container sets them, also each role's
   own colour (--sg-r-<role>, as r_<role>: the mascot the same colour as its card) and the shade the glass and shadows mix toward
   (--sg-shadow, as shade); where it does not, flDerive makes them */
function flPalette(el) {
  let cs = null;
  try {
    cs = el && typeof getComputedStyle === "function" ? getComputedStyle(el) : null;
  } catch {
    cs = null;
  }
  const out = {};
  for (const key of Object.keys(FL_PALETTE)) {
    let rgb = null;
    if (cs && typeof cs.getPropertyValue === "function") {
      for (const name of FL_VARS[key]) {
        rgb = flRgb(cs.getPropertyValue(name));
        if (rgb) break;
      }
    }
    out[key] = rgb || flRgb(FL_PALETTE[key]);
  }
  if (cs && typeof cs.getPropertyValue === "function") {
    for (const role of FL_ROLES) {
      const rgb = flRgb(cs.getPropertyValue(`--sg-r-${role}`));
      if (rgb) out[`r_${role}`] = rgb;
    }
    const sh = flRgb(cs.getPropertyValue("--sg-shadow"));
    if (sh) out.shade = sh;
  }
  return out;
}
/* a scan node's colour from its 24-hour change: the up colour for a rise, the down colour for a fall, stronger the larger the move (full
   at 8 %), the dim words colour for no move or none known */
function flNodeColor(change, pal) {
  const p = pal || flPalette(null);
  const n = Number(change);
  if (change === null || change === undefined || change === "" || !Number.isFinite(n) || n === 0) return flCss(p.dim, 0.55);
  const m = flClamp(Math.abs(n) / 8, 0, 1);
  return flCss(n > 0 ? p.up : p.down, 0.35 + 0.65 * m);
}

/* figures as the floor writes them: a price to its step (or to four significant figures under 1, two decimals above), dollars, signed
   dollars with a true minus, a compact dollar figure for a small bar's label */
function flGroup(s) {
  const neg = s[0] === "-";
  const body = neg ? s.slice(1) : s;
  const dot = body.indexOf(".");
  const int = dot < 0 ? body : body.slice(0, dot);
  const frac = dot < 0 ? "" : body.slice(dot);
  return (neg ? "−" : "") + int.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + frac;
}
/* a price to its step's decimals. With no step and a ref — the entry a take-profit or a stop belongs to, or the entry itself — to the
   decimals the entry is written with (its fill as the venue gave it: 2,457.37 two, 62,428.5 one, at most eight), so the entry, its
   take-profit and its stop read alike, none shows more decimals than the market filled at, and the floor says the very figures the
   page's table of the same leads says (superagent.js writes them to the entry's decimals too). With neither, to a price of its own
   size: two decimals from a dollar up, the first four figures below that */
function flPrice(n, step, ref) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  const r = Number(ref);
  let d;
  const st = Number(step);
  if (Number.isFinite(st) && st > 0) d = flClamp(Math.ceil(-Math.log10(st) - 1e-9), 0, 8);
  else if (Number.isFinite(r)) {
    d = flDecimals(r);
    // never written as the entry itself (an entry on a round figure would make its take-profit read as the entry): the places grow
    // until the two differ, as superagent.js sgAtDecimals does
    while (d < 8 && v !== r && Number(v.toFixed(d)) === Number(r.toFixed(d))) d++;
  } else {
    const a = Math.abs(v);
    d = a === 0 || a >= 1 ? 2 : flClamp(3 - Math.floor(Math.log10(a)), 2, 8);
  }
  return flGroup(v.toFixed(d));
}
/* how many decimals a figure is written with, as a person writes it and as the page's px writes a price (ten figures at the most, so no
   float tail: 2457.3700000000003 is 2457.37), at most eight */
function flDecimals(x) {
  const s = String(Number(Number(x).toPrecision(10)));
  if (/e/i.test(s)) return 8;
  const dot = s.indexOf(".");
  return dot < 0 ? 0 : Math.min(8, s.length - dot - 1);
}
/* a market's base: what comes before its quote ("ETH" of "ETH/USD", "BTC" of "BTC-PERP"), else the symbol itself */
function flBase(sym) {
  const t = String(sym ?? "").trim();
  const b = t.split(/[/:\s-]/)[0];
  return b || t;
}
/* a market's kind in words: Crypto, Stock, Event, Perpetual…; one the floor does not know, as given with a capital */
function flKindName(kind) {
  const k = String(kind ?? "").trim();
  if (!k) return "";
  return FL_KINDS[k.toLowerCase()] || k.charAt(0).toUpperCase() + k.slice(1);
}
/* the wall screen's header: the market and its kind — "ETH/USD · Crypto", "SOL · Solana · Perpetual" — its name only where it says more
   than the symbol's base; an event by its question */
function flScreenHead(f) {
  const base = flBase(f.symbol);
  const name = f.name && f.name !== f.symbol && f.name !== base ? f.name : "";
  const kind = flKindName(f.kind);
  const event = String(f.kind ?? "").toLowerCase() === "event";
  return (event && name ? [name, kind] : [f.symbol, name, kind]).filter(Boolean).join(" · ");
}
/* dollars as the page writes money (core.js money): to the cent at any size, grouped by thousands ("$12,345.60", "−$0.44"), so a float
   on the floor and the bubble beside it say one figure. Only an amount under a cent that is not nothing is written to its first two
   figures ("$0.0044"), never rounded to a $0.00 that would hide it; a true minus before the dollar */
function flUsd(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const body = a === 0 || a >= 0.005 ? flGroup(a.toFixed(2)) : a.toFixed(flClamp(1 - Math.floor(Math.log10(a)), 3, 20));
  return (a === 0 || v > 0 ? "$" : "−$") + body;
}
function flSigned(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return (v > 0 ? "+" : "") + flUsd(v);
}
function flCompact(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const s = a >= 1e9 ? `${(a / 1e9).toFixed(1)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}K` : a.toFixed(a >= 10 ? 0 : 2);
  return (v < 0 ? "−$" : "$") + s;
}
/* the time in a zone as HH:MM:SS (a 24-hour clock); the zone's formatter is made once */
function flClockText(date, zone) {
  const z = zone || "America/New_York";
  let f = FL_FMT[z];
  if (f === undefined) {
    try {
      f = new Intl.DateTimeFormat("en-US", { timeZone: z, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    } catch {
      f = null;
    }
    FL_FMT[z] = f;
  }
  if (!f) return "";
  const parts = f.formatToParts(date);
  let hh = "00";
  let mm = "00";
  let ss = "00";
  for (const p of parts) {
    if (p.type === "hour") hh = p.value.padStart(2, "0").slice(-2);
    else if (p.type === "minute") mm = p.value.padStart(2, "0");
    else if (p.type === "second") ss = p.value.padStart(2, "0");
  }
  return `${hh === "24" ? "00" : hh}${mm}${ss}`;
}

/* words cut into at most maxLines lines no wider than maxW (measure(text) gives a width): words kept whole unless one alone is wider than
   a line (then it is cut), and the last line ended with "…" when the words did not all fit */
function flWrap(text, maxW, measure, maxLines = 3) {
  const words = String(text ?? "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines = [];
  let cur = "";
  let cut = false;
  const room = Math.max(1, maxW);
  outer: for (let i = 0; i < words.length; i++) {
    let word = words[i];
    while (word) {
      const next = cur ? `${cur} ${word}` : word;
      if (measure(next) <= room) {
        cur = next;
        word = "";
        break;
      }
      if (cur) {
        lines.push(cur);
        cur = "";
        if (lines.length === maxLines) {
          cut = true;
          break outer;
        }
        continue;
      }
      // one word wider than a line: the longest head of it that fits, the rest on the next line
      let n = word.length - 1;
      while (n > 1 && measure(word.slice(0, n)) > room) n--;
      lines.push(word.slice(0, n));
      word = word.slice(n);
      if (lines.length === maxLines) {
        cut = !!word || i < words.length - 1;
        break outer;
      }
    }
  }
  if (!cut && cur) {
    if (lines.length < maxLines) lines.push(cur);
    else cut = true;
  }
  if (cut && lines.length) {
    let last = lines[lines.length - 1];
    while (last.length > 0 && measure(`${last}…`) > room) last = last.slice(0, -1).trimEnd();
    lines[lines.length - 1] = `${last}…`;
  }
  return lines;
}

/* words wrapped as flWrap does, then balanced: the narrowest width that still takes no more lines, so a label never ends on one lonely
   word */
function flWrapEven(text, maxW, measure, maxLines = 2) {
  const first = flWrap(text, maxW, measure, maxLines);
  if (first.length < 2 || first[first.length - 1].endsWith("…")) return first;
  let lo = 1;
  let hi = maxW;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    const got = flWrap(text, mid, measure, maxLines);
    if (got.length <= first.length && !got[got.length - 1].endsWith("…")) hi = mid;
    else lo = mid;
  }
  return flWrap(text, hi, measure, maxLines);
}
/* the tape's loop: one pass of its items laid end to end with a gap after each — how wide the loop is and where each item starts */
function flTickerLoop(widths, gap) {
  const g = Math.max(0, Number(gap) || 0);
  const starts = [];
  let x = 0;
  for (const w of Array.isArray(widths) ? widths : []) {
    starts.push(x);
    x += Math.max(0, Number(w) || 0) + g;
  }
  return { width: x, starts };
}
/* how far the tape has scrolled after tMs at pxPerSec, inside one loop: the same at the loop's width as at nothing, so it never jumps */
function flTickerOffset(tMs, pxPerSec, width) {
  if (!(width > 0)) return 0;
  const d = ((Number(tMs) || 0) / 1000) * (Number(pxPerSec) || 0);
  const o = d % width;
  return o < 0 ? o + width : o;
}

/* a percentile of the first n values of buf, sorted in scratch (both typed arrays made once): no allocation */
function flPercentile(buf, n, q, scratch) {
  if (!(n > 0)) return 0;
  for (let i = 0; i < n; i++) scratch[i] = buf[i];
  const part = scratch.subarray(0, n);
  part.sort();
  return part[Math.min(n - 1, Math.floor(n * q))];
}
/* the site's rule for a slow machine (site/main.js degrade): never in the first six seconds; once the 75th-percentile frame has been over
   22 ms for four seconds running, lite — once, and never back (flapping would show). d = { born, slowSince, lite }, checked with the time
   t and the current p75; a fast check in between starts the four seconds again. Returns d.lite */
function flDegrade(d, t, p75) {
  if (d.lite) return true;
  if (t - d.born < 6000 || !(p75 > 0)) return false;
  if (p75 > 22) {
    if (!d.slowSince) d.slowSince = t;
    else if (t - d.slowSince > 4000) d.lite = true;
  } else d.slowSince = 0;
  return d.lite;
}

/* ---- the layout ------------------------------------------------------------------------------------------------------------- */

/* the room laid out for a canvas w × h CSS pixels: k is the size of things (1.2 at a 1600 × 700 floor, smaller with the canvas, and held
   so eight seats fit across a narrow one); the back wall takes the top 43 %, the floor the rest, receding a little toward the wall (a
   seat at the back is drawn at 84 % of one at the front edge). Each seat: its point on the floor, its scale s, the mascot (feet at its
   point, left of its desk), the desk, the desk's monitor, the box the whole station takes, and the layer it is drawn in (back or front
   row, for parallax and the draw order). The fixtures: the ticker tape across the top of the wall, the New York clock at the left, the
   rack under it, the wall screen in the middle, the crawler network's region around the screen, the trophy and the shredder at the
   right, the owner's inbox tray at the front edge, centred in the gap between the Sentiment and the Watch seats' words (tray: the box
   it is drawn in until its words are measured, and gapX0..gapX1 the room it may take; flTrayLay sizes it to its words). Font sizes step
   with k but never under the floor's smallest (labels 10–11 px, bubbles 11–13, small words 10, the tiniest 9: FL_MIN_TEXT), whatever
   the size of the canvas. A narrow floor (k under 0.6, a phone) is `narrow`: there the trophy and the shredder are given twice the
   share of the wall (their words fit on them) and the crawler network stops short of the trophy. */
function flLayout(w, h) {
  const W = Math.max(1, Number(w) || 1);
  const H = Math.max(1, Number(h) || 1);
  const k = Math.max(0.2, Math.min(H / 700, W * 0.0011) * 1.2);
  const narrow = k < 0.6;
  const wallBase = Math.round(H * 0.43);
  const cx = W / 2;
  const at = (u, v) => ({ x: cx + (u - 0.5) * W * (0.88 + 0.12 * v), y: wallBase + (H - wallBase) * v });
  const seats = {};
  for (const role of FL_ROLES) {
    const p = FL_SEATS[role];
    const f = at(p.u, p.v);
    const s = k * (0.84 + 0.16 * p.v);
    const cw = 40 * s;
    const chh = 46 * s;
    const charX = f.x - 44 * s;
    const deskX = f.x + 24 * s;
    const dw = 92 * s;
    const dh = 22 * s;
    const dd = 15 * s;
    const base = f.y - 4 * s;
    const desk = { x: deskX - dw / 2, cx: deskX, w: dw, front: base - dh, base, top: base - dh - dd, dd, inset: 5 * s };
    const mw = 60 * s;
    const mh = 38 * s;
    const mon = { x: deskX - mw / 2 + 3 * s, y: desk.top + dd * 0.35 - 7 * s - mh, w: mw, h: mh, standY: desk.top + dd * 0.55 };
    const char = { x: charX, y: f.y, w: cw, h: chh };
    const box = { x0: Math.min(charX - cw * 0.6, desk.x), x1: desk.x + dw, y0: Math.min(mon.y, f.y - chh * 1.1), y1: f.y + 4 * s };
    seats[role] = { role, u: p.u, v: p.v, s, x: f.x, y: f.y, char, desk, mon, box, layer: p.v < 0.5 ? "back" : "front" };
  }
  const order = FL_ROLES.slice().sort((a, b) => seats[a].v - seats[b].v || seats[a].u - seats[b].u);
  const R = (x0, y0, x1, y1) => ({ x: x0 * W, y: y0 * H, w: (x1 - x0) * W, h: (y1 - y0) * H });
  const screen = R(0.275, 0.1, 0.725, 0.385);
  const ticker = R(0.03, 0.022, 0.97, 0.068);
  const clock = R(0.03, 0.095, 0.14, 0.175);
  const rack = { x: 0.035 * W, y: 0.205 * H, w: 0.06 * W, h: wallBase + 0.035 * H - 0.205 * H };
  const trophy = narrow ? { x: 0.757 * W, y: 0.15 * H, w: 0.098 * W, h: wallBase + 0.03 * H - 0.15 * H } : { x: 0.85 * W, y: 0.15 * H, w: 0.05 * W, h: wallBase + 0.03 * H - 0.15 * H };
  const shredder = narrow ? { x: 0.873 * W, y: wallBase - 0.1 * H, w: 0.107 * W, h: 0.135 * H } : { x: 0.922 * W, y: wallBase - 0.1 * H, w: 0.058 * W, h: 0.135 * H };
  const net = { x: 0.105 * W, y: 0.085 * H, w: (narrow ? 0.745 : 0.84) * W - 0.105 * W, h: wallBase - 0.09 * H };
  const tp = at(0.455, 0.93);
  // the tray sits in the gap between the Sentiment and the Watch seats' words (each seat's words take at most labelRoom, centred on its
  // mascot), at the front edge; its box here is the least it takes, flTrayLay widens it to its words inside the gap
  const labelRoom = Math.max(54, Math.min(150 * k, W * 0.19));
  const gapX0 = seats.sentiment.char.x + labelRoom / 2 + 4;
  const gapX1 = Math.max(gapX0 + 24, seats.watch.char.x - labelRoom / 2 - 4);
  const trayW = flClamp(gapX1 - gapX0, 24, narrow ? 42 : 100 * k);
  const trayH = narrow ? 20 : Math.max(22 * k, 26);
  const trayX = (gapX0 + gapX1) / 2;
  const tray = { x: trayX - trayW / 2, y: Math.min(tp.y - 16 * k, H - trayH - 2), w: trayW, h: trayH, cx: trayX, gapX0, gapX1, bottom: Math.min(tp.y - 16 * k + trayH, H - 2) };
  const fs = { label: k >= 0.9 ? 11 : 10, bubble: k >= 1.05 ? 13 : k >= 0.75 ? 12 : 11, small: 10, tiny: FL_MIN_TEXT };
  return { w: W, h: H, k, narrow, cx, wallBase, seats, order, screen, ticker, clock, rack, trophy, shredder, net, tray, fs };
}

/* ---- the crawler network ---------------------------------------------------------------------------------------------------- */

/* the scan's rows laid out as nodes in the wall space either side of the screen (box: the network's region, hole: the screen, kept
   clear): a node's size from its 24-hour volume (log scale), the largest and the picked nearest the screen, then relaxed (a gentle
   force layout: neighbours closer than their sizes push apart, each kept inside its side). Deterministic: the same rows give the same
   places whatever order they come in (sorted, and seeded by each symbol's hash, not by chance). At most 40 rows. A row whose volume is
   not known is not drawn as the smallest: it takes a neutral size between the least and the most, is laid after the known, and is
   flagged hollow (drawn as an outline, "volume —" on hover). Where opt is given, what else is written on that wall is kept clear too:
   opt.keep, boxes no node may cover (the scan's caption), and opt.label ({ h, w(symbol), all, pickedOnly }), the name each named node
   carries above it (every node when there are at most FL_NAMED_NODES, or all; only the picked where pickedOnly — a phone's wall has no
   room for more): a node is pushed off another's name, two
   names are pushed apart, and a named node stays low enough in its side for its name to fit above it. Returns [{ symbol, x, y, r,
   picked, change, volume, hollow, named }] */
function flScanLayout(rows, picked, box, hole, opt) {
  if (!box || !hole) return [];
  const seen = new Set();
  const list = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const sym = r && typeof r.symbol === "string" ? r.symbol.trim() : "";
    if (!sym || seen.has(sym)) continue;
    seen.add(sym);
    list.push(r);
    if (list.length === 40) break;
  }
  if (!list.length) return [];
  const pick = new Set((Array.isArray(picked) ? picked : []).map(String));
  const pad = Math.max(4, Math.min(box.w, box.h) * 0.03);
  const sides = [
    { x: box.x, y: box.y, w: hole.x - pad - box.x, h: box.h, near: 1 },
    { x: hole.x + hole.w + pad, y: box.y, w: box.x + box.w - (hole.x + hole.w + pad), h: box.h, near: -1 },
  ].filter((s) => s.w > 8 && s.h > 8);
  if (!sides.length) return [];
  const unit = Math.sqrt(sides.reduce((a, s) => a + s.w * s.h, 0) / Math.max(1, list.length));
  const rMax = flClamp(unit * 0.3, 2.5, 14);
  const rMin = Math.max(1.5, rMax * 0.32);
  const vols = list.map((r) => {
    const v = Number(r.volumeUsd24h);
    return v > 0 ? Math.log10(v) : NaN;
  });
  const fin = vols.filter(Number.isFinite);
  const lo = fin.length ? Math.min(...fin) : 0;
  const hi = fin.length ? Math.max(...fin) : 0;
  const nodes = list.map((r, i) => {
    const v = vols[i];
    const known = Number.isFinite(v);
    const f = known ? (hi > lo ? (v - lo) / (hi - lo) : 0.6) : -1;
    const ch = Number(r.changePct24h);
    return { symbol: r.symbol.trim(), r: rMin + (rMax - rMin) * (known ? f : 0.5), picked: pick.has(r.symbol.trim()), change: Number.isFinite(ch) ? ch : null, volume: Number(r.volumeUsd24h) > 0 ? Number(r.volumeUsd24h) : null, f, h: flHash(r.symbol.trim()), x: 0, y: 0, side: 0 };
  });
  // the picked first, then the heaviest, then by name: the order the sides are filled in, whatever order the rows came in
  const sorted = nodes.slice().sort((a, b) => Number(b.picked) - Number(a.picked) || b.f - a.f || (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));
  const area = sides.map((s) => s.w * s.h);
  const total = area.reduce((a, b) => a + b, 0);
  const want = sides.map((_, i) => Math.round((area[i] / total) * sorted.length));
  want[0] = sorted.length - want.slice(1).reduce((a, b) => a + b, 0);
  let si = 0;
  const per = sides.map(() => []);
  for (const n of sorted) {
    // the sides filled in turn, each to its share of the room
    let tries = 0;
    while (per[si].length >= want[si] && tries++ < sides.length) si = (si + 1) % sides.length;
    per[si].push(n);
    n.side = si;
    si = (si + 1) % sides.length;
  }
  sides.forEach((s, i) => {
    const group = per[i];
    if (!group.length) return;
    const cols = Math.max(1, Math.round(Math.sqrt((group.length * s.w) / s.h)));
    const rowsN = Math.ceil(group.length / cols);
    const cw = s.w / cols;
    const rh = s.h / rowsN;
    group.forEach((n, j) => {
      // filled from the column nearest the screen outward, rows from the middle out: the heaviest sit closest to the chart
      const c = j % cols;
      const rIdx = Math.floor(j / cols);
      const col = s.near > 0 ? cols - 1 - c : c;
      const mid = Math.floor(rowsN / 2);
      const row = flClamp(mid + (rIdx % 2 ? Math.ceil(rIdx / 2) : -Math.ceil(rIdx / 2)), 0, rowsN - 1);
      const jx = ((n.h & 1023) / 1023 - 0.5) * cw * 0.5;
      const jy = (((n.h >>> 10) & 1023) / 1023 - 0.5) * rh * 0.5;
      n.x = s.x + (col + 0.5) * cw + jx;
      n.y = s.y + (row + 0.5) * rh + jy;
    });
  });
  // what is written on the wall beside the nodes: the boxes to keep clear, and each named node's name above it
  const keep = opt && Array.isArray(opt.keep) ? opt.keep.filter((r) => r && r.w > 0 && r.h > 0) : [];
  const lab = opt && opt.label && opt.label.h > 0 && typeof opt.label.w === "function" ? opt.label : null;
  const nameAll = !!lab && !lab.pickedOnly && (lab.all === true || nodes.length <= FL_NAMED_NODES);
  for (const n of nodes) {
    n.named = !!lab && (nameAll || n.picked);
    n.lw = n.named ? Math.max(1, Number(lab.w(n.symbol)) || 0) : 0;
  }
  const lh = lab ? lab.h : 0;
  const lgap = 3;
  // a name's box: centred over its node, its foot just above the node
  const nameBox = (n, out) => {
    out.x = n.x - n.lw / 2;
    out.y = n.y - n.r - lgap - lh;
    out.w = n.lw;
    out.h = lh;
    return out;
  };
  const nb0 = { x: 0, y: 0, w: 0, h: 0 };
  const nb1 = { x: 0, y: 0, w: 0, h: 0 };
  // relax: whoever overlaps a neighbour on its side is pushed apart, half each way; off the boxes kept clear and off the names; then kept
  // inside its side (a named node low enough for its name)
  const gap = Math.max(1.5, rMin * 0.8);
  for (let it = 0; it < 60; it++) {
    for (let a = 0; a < sorted.length; a++) {
      const na = sorted[a];
      for (let b = a + 1; b < sorted.length; b++) {
        const nb = sorted[b];
        if (na.side !== nb.side) continue;
        let dx = nb.x - na.x;
        let dy = nb.y - na.y;
        let d = Math.hypot(dx, dy);
        const need = na.r + nb.r + gap;
        if (d >= need) continue;
        if (d < 1e-6) {
          // two on one point: parted along an angle their names choose
          const ang = ((na.h ^ nb.h) % 6283) / 1000;
          dx = Math.cos(ang);
          dy = Math.sin(ang);
          d = 1;
        }
        const push = (need - d) / 2;
        na.x -= (dx / d) * push;
        na.y -= (dy / d) * push;
        nb.x += (dx / d) * push;
        nb.y += (dy / d) * push;
      }
    }
    if (lab || keep.length) {
      for (const na of sorted) {
        // off the boxes kept clear: the node, and its name
        for (const r of keep) {
          flPushOut(na, na.x, na.y, na.r + gap, r);
          if (na.named) flPushBox(na, nameBox(na, nb0), r, gap);
        }
        if (!na.named) continue;
        for (const nb of sorted) {
          if (nb === na || nb.side !== na.side) continue;
          // another node off this one's name; two names apart
          flPushOut(nb, nb.x, nb.y, nb.r + gap, nameBox(na, nb0));
          if (nb.named) {
            nameBox(nb, nb1);
            const ox = Math.min(nb0.x + nb0.w, nb1.x + nb1.w) - Math.max(nb0.x, nb1.x) + gap;
            const oy = Math.min(nb0.y + nb0.h, nb1.y + nb1.h) - Math.max(nb0.y, nb1.y) + gap;
            if (ox > 0 && oy > 0) {
              const sx = nb.x >= na.x ? 1 : -1;
              na.x -= (sx * ox) / 2;
              nb.x += (sx * ox) / 2;
            }
          }
        }
      }
    }
    for (const n of sorted) {
      const s = sides[n.side];
      n.x = flClamp(n.x, s.x + Math.max(n.r, n.lw / 2), s.x + s.w - Math.max(n.r, n.lw / 2));
      n.y = flClamp(n.y, s.y + n.r + (n.named ? lh + lgap : 0), s.y + s.h - n.r);
    }
  }
  const round = (v) => Math.round(v * 100) / 100;
  return nodes.map((n) => ({ symbol: n.symbol, x: round(n.x), y: round(n.y), r: round(n.r), picked: n.picked, change: n.change, volume: n.volume, hollow: n.volume === null, named: !!n.named }));
}
/* a circle (centre cx, cy, radius r, its point n) pushed out of a box, by the shortest way: out of the nearest edge when its centre is
   inside, else away from the box's nearest point until it clears */
function flPushOut(n, cx, cy, r, b) {
  const nx = flClamp(cx, b.x, b.x + b.w);
  const ny = flClamp(cy, b.y, b.y + b.h);
  const dx = cx - nx;
  const dy = cy - ny;
  const d = Math.hypot(dx, dy);
  if (d >= r) return;
  if (d > 1e-6) {
    n.x += (dx / d) * (r - d);
    n.y += (dy / d) * (r - d);
    return;
  }
  // the centre inside the box: out of whichever edge is nearest
  const l = cx - b.x + r;
  const rt = b.x + b.w - cx + r;
  const t = cy - b.y + r;
  const bt = b.y + b.h - cy + r;
  const m = Math.min(l, rt, t, bt);
  if (m === l) n.x -= l;
  else if (m === rt) n.x += rt;
  else if (m === t) n.y -= t;
  else n.y += bt;
}
/* a node moved so that a box of its own (its name) clears another box, by the shorter way: up or down, left or right */
function flPushBox(n, a, b, gap) {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) + gap;
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) + gap;
  if (ox <= 0 || oy <= 0) return;
  if (oy <= ox) n.y += a.y + a.h / 2 < b.y + b.h / 2 ? -oy : oy;
  else n.x += a.x + a.w / 2 < b.x + b.w / 2 ? -ox : ox;
}
/* Search's monitor's bars, made once per scan: for each row (at most 40) its height as a share of the monitor, from its volume on a log
   scale (a fifth at the least volume, all of it at the most) — NaN where the volume is not known, which draws no bar at all — and
   whether Search picked it */
function flSearchBars(rows, picked) {
  const list = (Array.isArray(rows) ? rows : []).slice(0, 40);
  const pick = new Set((Array.isArray(picked) ? picked : []).map(String));
  const logs = list.map((r) => {
    const v = Number(r && r.volumeUsd24h);
    return v > 0 ? Math.log10(v) : NaN;
  });
  const fin = logs.filter(Number.isFinite);
  const lo = fin.length ? Math.min(...fin) : 0;
  const hi = fin.length ? Math.max(...fin) : 0;
  return list.map((r, i) => ({ f: Number.isFinite(logs[i]) ? (hi > lo ? 0.2 + (0.8 * (logs[i] - lo)) / (hi - lo) : 0.6) : NaN, picked: pick.has(String(r && r.symbol)) }));
}

/* ---- the event queue -------------------------------------------------------------------------------------------------------- */

/* whose turn an event waits for: a line or an order is its role's, a packet its sender's, a fill or an exit the actor that fired the lead's
   order (so a fill never bursts before the beam reached the screen), anything else the room's */
function flActorOf(q, ev) {
  const e = ev || {};
  switch (e.type) {
    case "say":
    case "order":
    case "card":
    case "think":
      return String(e.role || "account");
    case "handoff":
    case "reject":
      return String(e.from || "account");
    case "fill":
    case "exit":
      return (e.lead && q && q.leadActor[e.lead]) || "screen";
    default:
      return "room";
  }
}
/* the lead an event is about: its own field, or — a room line, which carries none — the first lead id its words name ("L-0049"), so
   Risk's verdict on a lead is said only once the lead's packet has reached Risk */
function flLeadOf(ev) {
  if (!ev) return "";
  if (ev.lead) return String(ev.lead);
  if (ev.type === "say") {
    const m = /\bL-\d{3,}\b/.exec(String(ev.text ?? ""));
    return m ? m[0] : "";
  }
  return "";
}
/* the Head's cycle line: the summary of a cycle, said only after the cycle's story (flQueueDue) */
function flIsCycleLine(e) {
  return !!e && !!e.ev && e.ev.type === "say" && e.actor === "head" && e.ev.kind === "cycle";
}
/* a queue: the events in line, each actor's and each lead's turn, and how many packets are in the air (air: the engine counts them each
   frame; the Head's cycle line waits for none to be) */
function flQueueNew() {
  return { list: [], actors: Object.create(null), leads: Object.create(null), leadActor: Object.create(null), gen: 0, nLeads: 0, air: 0 };
}
/* one event in line, at time now. An actor keeps at most FL_SAYS_KEPT lines waiting (the oldest let go; the room panel keeps every line);
   at most FL_QUEUE_MAX events wait in all (the oldest let go). Returns the entry */
function flQueuePush(q, ev, now) {
  const actor = flActorOf(q, ev);
  if (ev && ev.type === "order" && ev.lead) q.leadActor[ev.lead] = actor;
  const e = { ev, actor, lead: flLeadOf(ev), at: now };
  if (ev && ev.type === "say") {
    let says = 0;
    for (const x of q.list) if (x.actor === actor && x.ev.type === "say") says++;
    if (says >= FL_SAYS_KEPT) {
      const i = q.list.findIndex((x) => x.actor === actor && x.ev.type === "say");
      if (i >= 0) q.list.splice(i, 1);
    }
  }
  q.list.push(e);
  if (q.list.length > FL_QUEUE_MAX) q.list.splice(0, q.list.length - FL_QUEUE_MAX);
  if (ev && ev.type === "exit" && ev.lead) delete q.leadActor[ev.lead];
  return e;
}
/* the events whose turn has come at now, taken out of the line in order and started with gate(entry) — which plays the event and says
   how long it keeps its actor busy ({ busy }), its lead ({ lead }), and for a line how long its bubble shows ({ bubble }). An event
   waits while anything ahead of it in line is its actor's or its lead's, while its actor is busy, while its lead is (a packet still in
   the air), and — a line — while its actor's last bubble still shows; and, where may is given, while may(entry) says no (the room's
   own limit: how many bubbles may show at once). The Head's cycle line is a barrier: it waits while anything queued before it has not
   started and while a packet is in the air (q.air), so the cycle's summary never runs ahead of the cycle. Written into out (cleared
   first); returns out */
function flQueueDue(q, now, gate, out, may) {
  out.length = 0;
  const g = ++q.gen;
  for (let i = 0; i < q.list.length; ) {
    const e = q.list[i];
    const a = q.actors[e.actor] || (q.actors[e.actor] = { busy: 0, bubble: 0, mark: 0 });
    let l = null;
    if (e.lead) {
      l = q.leads[e.lead];
      if (!l) {
        l = q.leads[e.lead] = { busy: 0, mark: 0 };
        q.nLeads++;
      }
    }
    // (entries are taken out of the list as they start: one still ahead of this one at index < i has not started)
    const blocked = a.mark === g || (l && l.mark === g) || a.busy > now || (e.ev.type === "say" && a.bubble > now) || (l && l.busy > now) || (flIsCycleLine(e) && (i > 0 || q.air > 0)) || (!!may && !may(e));
    if (blocked) {
      a.mark = g;
      if (l) l.mark = g;
      i++;
      continue;
    }
    q.list.splice(i, 1);
    const d = gate(e, q) || {};
    a.busy = now + (Number(d.busy) || 0);
    if (d.bubble) a.bubble = now + Number(d.bubble);
    if (l) l.busy = now + (Number(d.lead) || 0);
    out.push(e);
  }
  // leads long done are forgotten
  if (q.nLeads > 300) {
    for (const id of Object.keys(q.leads)) if (q.leads[id].busy < now - 60_000) delete q.leads[id];
    q.nLeads = Object.keys(q.leads).length;
  }
  return out;
}

/* ---- the state ---------------------------------------------------------------------------------------------------------------- */

const flNum = (n) => (n === null || n === undefined || n === "" ? NaN : Number(n));
/* one seat of the state as the engine reads it */
function flSeatNorm(x) {
  const lim = x.limit && typeof x.limit === "object" ? x.limit : null;
  const lo = x.lastOrder && typeof x.lastOrder === "object" && Number.isFinite(flNum(x.lastOrder.usd)) ? { usd: flNum(x.lastOrder.usd) } : null;
  return {
    role: x.role,
    name: typeof x.name === "string" ? x.name : FL_NAMES[x.role] || x.role,
    kind: x.kind === "house" || x.kind === "outside" ? x.kind : "empty",
    status: ["ok", "not let in", "expired", "revoked", "empty"].includes(x.status) ? x.status : x.kind === "house" || x.kind === "outside" ? "ok" : "empty",
    why: typeof x.why === "string" ? x.why : "",
    limit: lim ? { perOrderUsd: flNum(lim.perOrderUsd), leftUsd: flNum(lim.leftUsd), budgetUsd: flNum(lim.budgetUsd) } : null,
    lastOrder: lo,
  };
}
/* the state as the engine reads it: every part checked, what is missing or malformed taken as absent (never invented). Seats that are not
   a list are not read yet (null), never "every seat empty"; the owner's cards waiting a whole number, or null where not given; the
   autonomy true only when it says true; stale its since, or null */
function flNorm(state) {
  const o = state && typeof state === "object" ? state : {};
  const ss = o.session && typeof o.session === "object" ? o.session : {};
  const sState = ["live", "paused", "halted", "ended", "none"].includes(ss.state) ? ss.state : "none";
  const seats = Array.isArray(o.seats) ? o.seats.filter((x) => x && typeof x.role === "string").map(flSeatNorm) : null;
  const wk = o.working && typeof o.working === "object" && typeof o.working.role === "string" ? { role: o.working.role, what: String(o.working.what ?? ""), lead: o.working.lead ? String(o.working.lead) : "" } : null;
  let focus = null;
  if (o.focus && typeof o.focus === "object" && typeof o.focus.symbol === "string" && o.focus.symbol) {
    const f = o.focus;
    const candles = (Array.isArray(f.candles) ? f.candles : [])
      .map((b) => b && { t: flNum(b.t), o: flNum(b.o), h: flNum(b.h), l: flNum(b.l), c: flNum(b.c), v: flNum(b.v) })
      .filter((b) => b && [b.o, b.h, b.l, b.c].every(Number.isFinite));
    const marks = (Array.isArray(f.marks) ? f.marks : [])
      .filter((m) => m && Number.isFinite(flNum(m.entry)))
      .map((m) => ({ lead: String(m.lead ?? ""), side: m.side === "sell" ? "sell" : "buy", entry: flNum(m.entry), tp: flNum(m.tp), sl: flNum(m.sl), state: String(m.state ?? "") }));
    focus = { symbol: f.symbol, name: typeof f.name === "string" ? f.name : "", kind: typeof f.kind === "string" ? f.kind : "", candles, price: flNum(f.price), priceStep: flNum(f.priceStep), marks };
  }
  let scan = null;
  if (o.scan && typeof o.scan === "object") {
    const rows = (Array.isArray(o.scan.rows) ? o.scan.rows : []).filter((r) => r && typeof r.symbol === "string" && r.symbol.trim());
    scan = { at: o.scan.at ?? "", rows: rows.slice(0, 40).map((r) => ({ symbol: r.symbol.trim(), changePct24h: flNum(r.changePct24h), volumeUsd24h: flNum(r.volumeUsd24h) })), picked: (Array.isArray(o.scan.picked) ? o.scan.picked : []).map(String) };
  }
  const fn = o.funnel && typeof o.funnel === "object" ? o.funnel : null;
  const funnel = fn ? { scanned: flNum(fn.scanned), cleared: flNum(fn.cleared), executed: flNum(fn.executed), closed: flNum(fn.closed), rejected: flNum(fn.rejected) } : null;
  const rej = Number.isFinite(flNum(o.rejected)) ? flNum(o.rejected) : funnel && Number.isFinite(funnel.rejected) ? funnel.rejected : NaN;
  const ck = o.checks && typeof o.checks === "object" ? o.checks : null;
  // the open leads: each kept whether or not it has a P&L yet (NaN where it has none); absent is null — not known, never "none"
  const open = Array.isArray(o.open)
    ? o.open
        .filter((x) => x && typeof x === "object")
        .slice(0, 12)
        .map((x) => ({ lead: String(x.lead ?? ""), symbol: String(x.symbol ?? ""), side: x.side === "sell" ? "sell" : "buy", pnlUsd: flNum(x.pnlUsd) }))
    : null;
  let unknown = 0;
  for (const x of open || []) if (!Number.isFinite(x.pnlUsd)) unknown++;
  const cards = flNum(o.cards);
  const since = o.stale && typeof o.stale === "object" ? String(o.stale.since ?? "") : "";
  return {
    norm: true,
    session: { state: sState, halted: ss.halted && typeof ss.halted === "object" ? { why: String(ss.halted.why ?? "") } : null },
    seats,
    cards: Number.isFinite(cards) && cards >= 0 ? Math.floor(cards) : null,
    autonomy: o.autonomy === true,
    stale: o.stale && typeof o.stale === "object" ? { since } : null,
    working: wk,
    inFlight: Math.max(0, Math.floor(Number(o.inFlight) || 0)),
    brain: o.brain && typeof o.brain === "object" ? { ok: o.brain.ok === true, why: String(o.brain.why ?? ""), code: flBrainCode(o.brain) } : null,
    focus,
    scan,
    funnel,
    rejected: rej,
    target: o.target && Number.isFinite(flNum(o.target.progressPct)) ? { progressPct: flNum(o.target.progressPct) } : null,
    equity: o.equity && typeof o.equity === "object" ? { nowUsd: flNum(o.equity.nowUsd), startUsd: flNum(o.equity.startUsd) } : null,
    ticker: (Array.isArray(o.ticker) ? o.ticker : [])
      .filter((x) => x && String(x.text ?? "").trim())
      .slice(0, 40)
      .map((x) => ({ text: String(x.text).replace(/\s+/g, " ").trim().slice(0, 64), dir: x.dir === "up" || x.dir === "down" ? x.dir : "flat" })),
    clock: { zone: o.clock && typeof o.clock.zone === "string" && o.clock.zone ? o.clock.zone : "America/New_York" },
    checks: ck ? { spreadPct: flNum(ck.spreadPct), maxSpreadPct: flNum(ck.maxSpreadPct) > 0 ? flNum(ck.maxSpreadPct) : NaN, maxSizeUsd: flNum(ck.maxSizeUsd), lossRoomUsd: flNum(ck.lossRoomUsd), minNotionalUsd: flNum(ck.minNotionalUsd) } : null,
    open,
    // the Exit monitor's words when no lead it holds has a P&L yet (made here, once per state, not per frame), and their short form
    openNote: open && open.length && unknown === open.length ? `${open.length} open · P&L —` : "",
    openShort: open && open.length && unknown === open.length ? `${open.length} open` : "",
  };
}
/* a seat as the floor draws it: the state's seat for the role, or an empty one that says why — or, while the seats are not read yet, one
   being read (kind and status "reading": drawn dim, called neither empty nor taken) */
function flSeatOf(st, role) {
  if (!st.seats) return { role, name: FL_NAMES[role] || role, kind: "reading", status: "reading", why: "", limit: null, lastOrder: null };
  const s = st.seats.find((x) => x.role === role);
  if (s) return s;
  return { role, name: FL_NAMES[role] || role, kind: "empty", status: "empty", why: FL_EMPTY_WHY[role] || "", limit: null, lastOrder: null };
}
/* whether a seat is drawn as an empty chair: empty, or not read yet */
function flSeatOff(seat) {
  return seat.kind === "empty" || seat.status === "empty" || seat.kind === "reading";
}
/* why an empty seat is empty, as the floor writes it under the seat (short, so it fits a seat's share of the row): the outside seats'
   "empty seat — needs a feed", else the state's why up to its first colon ("Empty seat — not on this desk: fill it …" → "Empty seat —
   not on this desk"), else plain "empty seat"; on a narrow floor only the reason ("needs a feed", "not on this desk"), the empty chair
   saying the rest. The whole why stays in the canvas's words (flAria) and with the page */
function flEmptyShort(seat, narrow) {
  if (FL_EMPTY_WHY[seat.role]) return narrow ? "needs a feed" : FL_EMPTY_WHY[seat.role];
  const w = String(seat.why || "").replace(/\s+/g, " ").trim();
  if (!w) return "empty seat";
  const i = w.indexOf(":");
  const short = (i > 0 ? w.slice(0, i) : w).trim();
  // a narrow floor: the empty chair already says the seat is empty, so only the reason
  return narrow ? short.replace(/^empty seat\s*[—–-]\s*/i, "") || short : short;
}
/* why an empty seat is empty, in words: the state's own why, else the outside seats' "needs a feed", else plain "empty seat" */
function flEmptyWhy(seat) {
  if (seat.why) return seat.why;
  return FL_EMPTY_WHY[seat.role] || "empty seat";
}
/* The brain's trouble in a few words, for the rack under the wall, which has room for two short lines and no more. The whole of it — the
   account's sentence, the key file's path with Copy, the command that fixes it — is the page's, in the header's "Brain: Not ready" and
   its "How to fix ›"; the canvas's words (flAria) keep the whole sentence too. So the rack says only which trouble it is, never a
   sentence cut off mid-instruction ("off: Anthropic refused the brain's key: replace it in…"): "off · key refused".
   Which trouble: the account's own name for it (brain.fix.code, desk.ts BrainFix, where the page hands it on) — else read from the why
   the page gives, whether the account's whole sentence or the page's short word for it, the checks in this order because the sentences
   share words (the no-key sentence names ANTHROPIC_API_KEY "in its environment"; the environment's example names "the example"):
     rejected   the API refused the key ("Anthropic refused the brain's key…", "key refused", "the API did not accept the key")
     no-key     no key at all ("no key: the brain reads an Anthropic API key from …")
     env        what is set in the service's environment is wrong ("ANTHROPIC_API_KEY in the service's environment is the example…")
     example    the key file holds the empty template or an example, not a key, or names no model
     unusable   the key file is there but cannot be used ("the key file cannot be used: …", "key file unusable")
   "" where the why says none of these; flBrainWord then shows a short why as it is, else plain "not ready" */
const FL_BRAIN_WORDS = { rejected: "key refused", "no-key": "no key", env: "env setting wrong", example: "key file not filled in", unusable: "key file unusable" };
function flBrainCode(b) {
  const given = b && typeof b === "object" ? (typeof b.code === "string" ? b.code : b.fix && typeof b.fix === "object" && typeof b.fix.code === "string" ? b.fix.code : "") : "";
  if (FL_BRAIN_WORDS[given]) return given;
  const why = String((b && b.why) ?? "").replace(/\s+/g, " ").trim();
  if (!why) return "";
  if (/\brefused\b|\brejected\b|did not accept/i.test(why)) return "rejected";
  if (/^no key\b/i.test(why)) return "no-key";
  if (/service's environment/i.test(why)) return "env";
  if (/\bexample\b|empty template|not filled in/i.test(why)) return "example";
  if (/cannot be used|unusable/i.test(why)) return "unusable";
  return "";
}
/* the rack's line for the brain (the calls under way aside, which the rack counts itself): "idle" while it is ready, "not read yet" before
   the page has read it (the page's own words for that, never "off"), else "off · " and its trouble in a few words — the trouble's name
   (flBrainCode), else the why itself where it is short enough to be a word (up to 24 letters), else "not ready"; "" with no brain given */
function flBrainWord(b) {
  if (!b) return "";
  if (b.ok) return "idle";
  const why = String(b.why ?? "").replace(/\s+/g, " ").trim();
  if (/^not read yet\.?$/i.test(why)) return "not read yet";
  const code = typeof b.code === "string" && FL_BRAIN_WORDS[b.code] ? b.code : flBrainCode(b);
  if (code) return `off · ${FL_BRAIN_WORDS[code]}`;
  return why && why.length <= 24 ? `off · ${why.replace(/[.:;,]+$/, "")}` : why ? "off · not ready" : "off";
}
/* the floor in words, for the canvas's aria-label: the session, whether the page still reads it, who sits where and who is empty and why
   (or that the seats are being read), who is working, the brain, the wall screen's market and last price, the scan, the shredder, the
   target and the owner's cards — each only where the state says it */
function flAria(state) {
  const st = state && state.norm === true ? state : flNorm(state);
  const parts = [];
  const sess = st.session.state;
  parts.push(sess === "none" ? "Trading floor: no session running." : sess === "halted" ? `Trading floor: halted${st.session.halted && st.session.halted.why ? ` — ${st.session.halted.why}` : ""}.` : `Trading floor: ${sess} session.`);
  if (st.stale) {
    const when = flWhen(st.stale.since, st.clock.zone);
    parts.push(`Not read${when ? ` since ${when} ${flZoneName(st.clock.zone, false)}` : " lately"}: what is drawn is the last read.`);
  }
  const sitting = [];
  const empty = [];
  if (!st.seats) parts.push("Seats: reading…");
  else
    for (const role of FL_ROLES) {
      const seat = flSeatOf(st, role);
      if (seat.kind === "empty" || seat.status === "empty") empty.push(`${FL_NAMES[role]} (${flEmptyWhy(seat)})`);
      else sitting.push(seat.status === "ok" ? FL_NAMES[role] : `${FL_NAMES[role]} (${seat.status})`);
    }
  if (sitting.length) parts.push(`At their desks: ${sitting.join(", ")}.`);
  if (empty.length) parts.push(`Empty: ${empty.join(", ")}.`);
  if (st.working) parts.push(`${FL_NAMES[st.working.role] || st.working.role} is ${FL_WHAT[st.working.what] || st.working.what || "working"}${st.working.lead ? ` (${st.working.lead})` : ""}.`);
  if (st.inFlight > 0) parts.push(`${st.inFlight} brain call${st.inFlight === 1 ? "" : "s"} under way.`);
  if (st.brain && !st.brain.ok) parts.push(`The brain cannot think${st.brain.why ? `: ${st.brain.why}` : ""}.`);
  if (st.focus) {
    const last = Number.isFinite(st.focus.price) ? st.focus.price : st.focus.candles.length ? st.focus.candles[st.focus.candles.length - 1].c : NaN;
    parts.push(`Wall screen: ${st.focus.symbol}${st.focus.name ? ` (${st.focus.name})` : ""}${Number.isFinite(last) ? `, last ${flPrice(last, st.focus.priceStep)}` : ""}.`);
  } else parts.push("Wall screen: no market in focus.");
  if (st.scan) parts.push(`Last scan: ${st.scan.rows.length} market${st.scan.rows.length === 1 ? "" : "s"}, ${st.scan.picked.length} picked.`);
  if (Number.isFinite(st.rejected)) parts.push(`${st.rejected} lead${st.rejected === 1 ? "" : "s"} rejected.`);
  if (st.target) parts.push(`Target ${Math.round(st.target.progressPct * 10) / 10}% of the way.`);
  if (st.cards !== null) parts.push(st.cards > 0 ? `${st.cards} card${st.cards === 1 ? "" : "s"} wait${st.cards === 1 ? "s" : ""} for you.` : st.autonomy ? "Auto on paper: no card waits for you." : "No card waits for you.");
  return parts.join(" ");
}
/* a clock zone as the floor names it: New York for America/New_York, else the zone's city (upper case on the canvas) */
function flZoneName(zone, upper) {
  const z = String(zone || "America/New_York");
  const name = z === "America/New_York" ? "New York" : z.split("/").pop().replace(/_/g, " ");
  return upper ? name.toUpperCase() : name;
}

/* ---- the engine ----------------------------------------------------------------------------------------------------------------- */

function flNow() {
  return typeof performance !== "undefined" && performance && typeof performance.now === "function" ? performance.now() : Date.now();
}
function flReduced() {
  try {
    return typeof matchMedia === "function" && !!matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
function flPageHidden() {
  return typeof document !== "undefined" && !!document && document.hidden === true;
}
/* the pixel ratio the canvas is drawn at: the device's up to 2 — lite or not, so the words stay sharp on a phone — and 1.5 where a canvas
   w × h CSS pixels would otherwise be more than FL_MAX_PX device pixels */
function flDprNow(w, h) {
  const d = typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? Math.min(2, devicePixelRatio) : 1;
  return (Number(w) || 0) * (Number(h) || 0) * d * d > FL_MAX_PX ? Math.min(d, 1.5) : d;
}
/* an offscreen canvas for a sprite or a layer, where the page can make one (none in a page without a window: then drawn live) */
function flCanvas(w, h) {
  try {
    if (typeof document === "undefined" || !document || typeof document.createElement !== "function") return null;
    const c = document.createElement("canvas");
    if (!c || typeof c.getContext !== "function") return null;
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c.getContext("2d") ? c : null;
  } catch {
    return null;
  }
}
/* a colour string at an opacity, kept per hundredth so a frame makes none */
function flC(E, key, a = 1) {
  const q = a >= 1 ? 100 : a <= 0 ? 0 : Math.round(a * 100);
  let row = E.cc[key];
  if (!row) row = E.cc[key] = [];
  return row[q] || (row[q] = flCss(E.pal[key] || E.pal.text, q / 100));
}
/* the size, from size down to FL_MIN_TEXT, at which text fits maxW in a label's font and tracking (track: the letter spacing in em); 0
   where it does not fit even at the least — then it is not drawn */
function flFitSize(E, text, maxW, size, track, label, weight, least = FL_MIN_TEXT) {
  for (let fs = Math.max(least, Math.round(size)); fs >= least; fs--) if (flMeasure(E, flFont(E, fs, label, weight), text) * (1 + track) <= maxW) return fs;
  return 0;
}
/* a fixture's label written at (x, y) in the canvas's alignment, its size stepped down (to FL_MIN_TEXT at the least) until it fits maxW;
   text may be a list of ways to say it, longest first ("REJECTED", "REJECTS"): the first that fits at FL_MIN_TEXT or more is written;
   where none does, nothing is. Its letter spacing is the labels' 0.12 em, or track (a narrow floor's labels are set closer). Returns
   the size written at, or 0 */
function flFitLabel(E, text, x, y, maxW, size, alpha, track = 0.12) {
  const ways = Array.isArray(text) ? text : [text];
  for (const t of ways) {
    const fs = flFitSize(E, t, maxW, size, track, true, 500);
    if (!fs) continue;
    flTrack(E, track);
    flSetFont(E, flFont(E, fs, true, 500));
    E.ctx.fillStyle = flC(E, "mint", alpha);
    E.ctx.fillText(t, x, y);
    flTrack(E, 0);
    return fs;
  }
  return 0;
}
/* a font string, kept. Every word is in the area's face (--font-sans; a trading screen draws no monospace): `label` marks the floor's
   small upper-case labels, which ask at most for the face's medium weight; the rest are given the weight asked */
function flFont(E, size, label, weight = 500) {
  const wt = label ? Math.min(weight, 500) : weight;
  // kept by a number (no key string made per call)
  const key = size * 10000 + (label ? 1000 : 0) + wt;
  return E.fonts[key] || (E.fonts[key] = `${wt} ${size}px ${E.sans}`);
}
/* the canvas's state put back (ctx.restore) and the font and the letter spacing it holds taken as unknown: restore puts back the canvas's
   own, not what the engine last set inside the block, so the next word sets them again rather than trusting a kept copy that is wrong */
function flRestore(E) {
  E.ctx.restore();
  E.font = "";
  E.track = "";
}
/* a text's width in a font, measured once and kept, by font then by text (no key string made per call; a font's widths are let go
   when they grow past 800) */
function flMeasure(E, font, text) {
  let per = E.tw.get(font);
  if (!per) {
    per = new Map();
    E.tw.set(font, per);
  }
  const got = per.get(text);
  if (got !== undefined) return got;
  const ctx = E.ctx;
  let w = 0;
  if (ctx && typeof ctx.measureText === "function") {
    if (E.font !== font) {
      ctx.font = font;
      E.font = font;
    }
    const tracked = E.hasTrack && E.track && E.track !== "0px";
    if (tracked) ctx.letterSpacing = "0px";
    w = ctx.measureText(text).width || 0;
    if (tracked) ctx.letterSpacing = E.track;
  } else w = String(text).length * (parseFloat(font.split(" ")[1]) || 10) * 0.6;
  if (per.size > 800) per.clear();
  per.set(text, w);
  return w;
}
function flSetFont(E, font) {
  if (E.font !== font) {
    E.ctx.font = font;
    E.font = font;
  }
}
/* the letter spacing of the floor's small upper-case labels, where the canvas has it */
function flTrack(E, em) {
  const ctx = E.ctx;
  if (!E.hasTrack) return;
  const v = em ? `${em}em` : "0px";
  if (E.track !== v) {
    ctx.letterSpacing = v;
    E.track = v;
  }
}
/* a spring stepped toward its target (set on it at once in a still frame); one not yet settled keeps the floor from resting */
function flSp(E, s, target, preset, dt) {
  if (E.instant) {
    s.x = target;
    s.v = 0;
    return target;
  }
  const x = flSpring(s, target, dt, preset[0], preset[1]);
  if (s.v !== 0 || x !== target) E.moving = true;
  return x;
}
/* a rounded rectangle's path */
function flRound(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}
/* a speech bubble's path: a rounded box with its tail on the bottom edge pointing at (tipX, tipY) */
function flBubblePath(ctx, x, y, w, h, r, tipX, tipY, tail) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  const tx = flClamp(tipX, x + rr + tail, x + w - rr - tail);
  // a tail longer than its width (a bubble lifted over another) narrows to a thread
  if (tipY - (y + h) > tail * 2.5) tail = Math.max(1.5, tail * 0.45);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(tx + tail, y + h);
  ctx.lineTo(tipX, tipY);
  ctx.lineTo(tx - tail, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}
/* the mascot's body: a superellipse (exponent 2.6) standing on its base, a touch wider below (a soft pear); centre of the base at 0, 0 */
function flBlobPath(ctx, cw, chh) {
  const a = cw / 2;
  const b = chh / 2;
  const N = 44;
  ctx.beginPath();
  for (let i = 0; i <= N; i++) {
    const th = (i / N) * Math.PI * 2;
    const c = Math.cos(th);
    const s = Math.sin(th);
    const x = Math.sign(c) * Math.pow(Math.abs(c), 2 / 2.6) * a;
    const y = Math.sign(s) * Math.pow(Math.abs(s), 2 / 2.6) * b;
    const px = x * (1 + 0.07 * (s > 0 ? s : 0));
    const py = y - b;
    if (i) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
  }
  ctx.closePath();
}

/* everything the engine holds, made once at mount: pools, springs, the queue */
function flEngine(canvas, opts) {
  const ctx = canvas && typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
  const sp = (x = 0) => ({ x, v: 0 });
  const E = {
    canvas,
    ctx,
    onPick: opts && typeof opts.onPick === "function" ? opts.onPick : null,
    released: false,
    still: flReduced() || typeof requestAnimationFrame !== "function",
    running: false,
    instant: false,
    visible: true,
    raf: 0,
    last: 0,
    born: flNow(),
    lite: false,
    w: 0,
    h: 0,
    dpr: 1,
    L: null,
    pal: flPalette(null),
    cc: Object.create(null),
    fonts: Object.create(null),
    sans: '"Manrope", system-ui, "Segoe UI", Roboto, Ubuntu, "Helvetica Neue", sans-serif',
    font: "",
    track: "",
    hasTrack: !!ctx && "letterSpacing" in ctx,
    tw: new Map(),
    st: flNorm(null),
    // what the events have shown so far (the story before the state): the funnel and the scan held for the Head's cycle line (hold), the
    // wall screen's market held for a new lead's first packet (focusFor: the market it waits to turn to), the marks whose fill is still
    // in line (fills); sync: the first frame after a set() decides what to hold, once the set's events are in line; settle: the session
    // left "live" or the page stopped reading, so what waits is let go at that frame
    show: { funnel: null, scan: null, focus: null, hold: false, holdScan: false, focusFor: "", fills: new Set(), sync: false, settle: false },
    // the state's own signature (a set() that changed nothing does not wake a resting floor)
    sig: "",
    aria: "",
    q: flQueueNew(),
    due: [],
    tNow: 0,
    dtLast: 0,
    bOrder: [],
    bRects: Array.from({ length: 16 }, () => ({ x: 0, y: 0, w: 0, h: 0 })),
    hoverNode: "",
    chars: Object.create(null),
    bubbles: Object.create(null),
    bubbleList: [],
    // what each seat's label says, wrapped once per state, size and font (flLabels); the seat each role draws (flSeatsBy)
    labels: Object.create(null),
    seatBy: Object.create(null),
    // words wrapped once and kept, each with what it was wrapped for (flForget lets them go on a new size or newly loaded fonts)
    rackW: { lit: -1, brain: null, font: "", ww: 0, lines: [] },
    bannerW: { why: "", font: "", maxW: 0, lines: [], ok: false },
    shotW: { a: "", b: "", font: "", w: 0, lines: [], ok: false },
    headW: { text: "", font: "", w: 0, out: "", ok: false },
    searchBars: null,
    // the canvas's place on the page, read on a resize or after a scroll, not per pointer move
    rect: { left: 0, top: 0, ok: false },
    dprW: null,
    slipOrder: [],
    obs: Array.from({ length: 8 + 16 }, () => ({ x: 0, y: 0, w: 0, h: 0 })),
    place: { x: 0, y: 0 },
    scrObj: { x0: 0, x1: 0, top: 0, bottom: 0, slot: 0, lastX: NaN, lastY: NaN, ok: false, vlo: 0, vhi: 1, pb: 0, step: NaN, chipX: Infinity },
    exitTop: 0,
    light: sp(0.35),
    par: { x: sp(), y: sp() },
    ptr: { x: 0, y: 0, inside: false, at: 0 },
    hover: null,
    trophy: sp(0),
    lo: sp(NaN),
    hi: sp(NaN),
    scaleSig: "",
    // the wall screen's column for the marks' words (its width, on a spring) and the market it was opened for
    colW: sp(0),
    colSig: "",
    shake: { t0: -1e9, dur: 200, amp: 2 },
    flash: { t0: -1e9, dur: 320 },
    banner: sp(0),
    haltAt: -1e9,
    stamp: { n: 0, t0: -1e9 },
    shred: { why: "", whyAt: -1e9, chewUntil: -1e9, lines: null, ww: 0, font: "" },
    lastOrder: null,
    nodes: [],
    scanSig: "",
    tk: { items: [], loopW: 0, off: 0, pending: null, next: null, swapLoops: 0, sig: "", font: "", gap: 0 },
    clock: { text: "", at: -1e9, cells: [], zone: "", label: "" },
    // the measured frames: intervals between the browser's frame callbacks (every one, drawn or rested), and this engine's own time on
    // each drawn frame; the long animation frames the browser reported (their times), where it reports them
    iv: new Float32Array(FL_FRAMES),
    work: new Float32Array(FL_FRAMES),
    scratch: new Float32Array(FL_FRAMES),
    fi: 0,
    fn: 0,
    wi: 0,
    wn: 0,
    tick: 0,
    drawnAt: 0,
    idle: false,
    wakeUntil: 0,
    moving: false,
    loaf: null,
    longs: [],
    deg: { born: 0, slowSince: 0, lite: false },
    degAt: 0,
    layers: { wall: null, floor: null, sig: "" },
    sprites: null,
    listeners: [],
    ro: null,
    io: null,
    mql: null,
    scr: null,
    pt: { x: 0, y: 0 },
    arc: { bx: 0, by: 0, cx: 0, cy: 0 },
  };
  E.deg.born = E.born;
  // a phone-sized screen starts lite, as the site does
  if (typeof innerWidth === "number" && innerWidth > 0 && innerWidth < FL_LITE_WIDTH) {
    E.lite = true;
    E.deg.lite = true;
  }
  for (const role of FL_ROLES) {
    const rng = flRng(flHash(role));
    E.chars[role] = {
      role,
      rng,
      phase: rng() * Math.PI * 2,
      sq: sp(),
      rec: sp(),
      lean: sp(),
      amp: sp(1),
      glow: sp(0.5),
      coral: sp(),
      eyeX: sp(),
      eyeY: sp(),
      blinkAt: E.born + 1200 + rng() * 3000,
      blinkTwice: false,
      think: false,
      thinkAt: -1e9,
      coralUntil: -1e9,
      zAt: E.born + rng() * 1600,
      pulseAt: -1e9,
      catchAt: -1e9,
      mouth: 0,
    };
  }
  // the pools
  const N = FL_PARTICLES;
  E.P = { x: new Float32Array(N), y: new Float32Array(N), vx: new Float32Array(N), vy: new Float32Array(N), life: new Float32Array(N), max: new Float32Array(N), size: new Float32Array(N), rot: new Float32Array(N), vr: new Float32Array(N), kind: new Uint8Array(N), col: new Uint8Array(N), next: 0, count: 0, alive: 0, fast: 0 };
  E.packets = Array.from({ length: FL_PACKETS }, () => ({ on: false, kind: "", lead: "", sym: "", side: "buy", to: "", from: "", ax: 0, ay: 0, dx: 0, dy: 0, bx: 0, by: 0, cx: 0, cy: 0, t0: 0, lift: 0, fly: 0, land: 0, x: 0, y: 0, ang: 0, sc: 1, al: 1, trail: new Float32Array(32), tn: 0, ti: 0, sparkAt: 0, landed: false, rng: flRng(1) }));
  E.rings = Array.from({ length: FL_RINGS }, () => ({ on: false, x: 0, y: 0, r0: 0, r1: 0, t0: 0, dur: 0, col: "mint", lw: 1, wall: false }));
  E.floats = Array.from({ length: FL_FLOATS }, () => ({ on: false, text: "", x: 0, y: 0, rise: 0, t0: 0, dur: 0, col: "mint" }));
  E.tags = Array.from({ length: FL_TAGS }, () => ({ on: false, lead: "", sym: "", side: "buy", text: "", text2: "", price: NaN, born: 0, fillAt: -1e9, until: 0, sc: sp(), mo: sp(), chip: false }));
  E.beams = Array.from({ length: FL_BEAMS }, () => ({ on: false, role: "", lead: "", t0: 0, col: "mint" }));
  E.slips = Array.from({ length: FL_SLIPS }, () => ({ on: false, sym: "", side: "buy", label: "", t0: 0, a: 1, goneAt: 0 }));
  E.gate = (e) => flStart(E, e.ev, E.tNow, false);
  E.may = (e) => flMayStart(E, e);
  E.loop = (t) => flFrame(E, t);
  flSeatsBy(E);
  return E;
}
/* the seat each role draws, found once per state rather than per frame */
function flSeatsBy(E) {
  for (const role of FL_ROLES) E.seatBy[role] = flSeatOf(E.st, role);
}
/* every kept wrapping let go: a new size, or fonts that arrived, measure differently */
function flForget(E) {
  E.rackW.lit = -1;
  E.rackW.font = "";
  E.bannerW.ok = false;
  E.shotW.ok = false;
  E.headW.ok = false;
  E.shred.lines = null;
  if (E.cap) E.cap.size = "";
}
/* what each seat's label says, wrapped once (on set(), a new size, newly loaded fonts — never per frame): the role's name, then what it
   is doing, or why it cannot, or why the seat is empty (short: flEmptyShort) — nothing under the name of a seat not read yet; its box,
   which the bubbles keep clear of. The words under the name are FL_MIN_WORDS at the least; on a narrow floor (a phone) they are fitted
   to the room beside the seat — as wide as the distance to the nearest seat in its row, in at most two lines, the size stepped down to
   FL_MIN_WORDS — or not written at all (the seat's card on the page says the same, whole) */
function flLabels(E) {
  const L = E.L;
  if (!L) return;
  const fs = L.fs.label;
  const room = Math.max(54, Math.min(150 * L.k, L.w * 0.19));
  const nameFont = flFont(E, fs, true, 500);
  const st = E.st;
  for (const role of FL_ROLES) {
    const s = L.seats[role];
    const seat = E.seatBy[role];
    const empty = flSeatOff(seat);
    let line = "";
    let col = "dim";
    if (seat.kind === "reading") line = "";
    else if (empty) line = flEmptyShort(seat, L.narrow);
    else if (seat.status === "not let in") {
      line = "not let in";
      col = "warn";
    } else if (seat.status !== "ok") {
      line = seat.status;
      col = "down";
    } else if (st.working && st.working.role === role) {
      line = `${FL_WHAT[st.working.what] || st.working.what || "working"}${st.working.lead ? ` ${st.working.lead}` : ""}`;
      col = "mint";
    } else if (seat.kind === "outside") line = "outside agent";
    const lab = E.labels[role] || (E.labels[role] = { name: FL_UPPER[role], lines: [], col: "dim", font: "", nameFont: "", empty: false, reading: false, nx: 0, lx: 0, y: 0, lineH: 0, x0: 0, x1: 0, h: 0 });
    // the room the words may take: on a narrow floor the distance to the nearest seat in the row, else the house's label width
    let mine = room;
    if (L.narrow) {
      let near = Infinity;
      for (const other of FL_ROLES) if (other !== role && L.seats[other].layer === s.layer) near = Math.min(near, Math.abs(L.seats[other].char.x - s.char.x));
      mine = Math.min(room, near - 4);
    }
    let whyFs = Math.max(FL_MIN_WORDS, fs - 1);
    let lines = [];
    if (line) {
      const up = line.toUpperCase();
      const maxLines = L.narrow ? 2 : 3;
      const words = up.split(" ");
      for (; whyFs >= FL_MIN_WORDS; whyFs--) {
        const f = flFont(E, whyFs, true, 400);
        lines = flWrapEven(up, mine / 1.06, (x) => flMeasure(E, f, x), maxLines);
        // a word wider than the room is never cut in two ("SCAN" / "NING"): a smaller size, else (narrow) no words
        let whole = true;
        for (const w of words) if (flMeasure(E, f, w) > mine / 1.06) whole = false;
        if (!whole) {
          if (whyFs === FL_MIN_WORDS && L.narrow) lines = [];
          continue;
        }
        if (!lines.length || !lines[lines.length - 1].endsWith("…")) break;
      }
      whyFs = Math.max(FL_MIN_WORDS, whyFs);
      // still cut short on a narrow floor: not written (the seat's card says it whole)
      if (L.narrow && lines.length && lines[lines.length - 1].endsWith("…")) lines = [];
      // only the lines that fit above the canvas's bottom edge (a short canvas): never a word cut by the edge
      const room = Math.floor((L.h - 2 - (s.char.y + 6 * s.s + fs + 2)) / (whyFs + 1));
      if (lines.length > room) lines = room >= 1 ? flWrapEven(up, mine / 1.06, (x) => flMeasure(E, flFont(E, whyFs, true, 400), x), room) : [];
      if (lines.length && lines[lines.length - 1].endsWith("…") && L.narrow) lines = [];
    }
    const font = flFont(E, whyFs, true, 400);
    lab.lines = lines;
    let wide = 0;
    for (const ln of lab.lines) wide = Math.max(wide, flMeasure(E, font, ln) * 1.06);
    const nameW = flMeasure(E, nameFont, lab.name) * 1.12;
    lab.col = col;
    lab.font = font;
    lab.nameFont = nameFont;
    lab.empty = empty;
    lab.reading = seat.kind === "reading";
    lab.nx = s.char.x;
    lab.lx = flClamp(s.char.x, wide / 2 + 2, L.w - wide / 2 - 2);
    lab.y = s.char.y + 6 * s.s;
    lab.lineH = whyFs + 1;
    lab.x0 = Math.min(lab.nx - nameW / 2, lab.lx - wide / 2);
    lab.x1 = Math.max(lab.nx + nameW / 2, lab.lx + wide / 2);
    lab.h = fs + 2 + lab.lines.length * lab.lineH;
  }
}

/* ---- sizing, sprites and layers ------------------------------------------------------------------------------------------------ */

function flResize(E) {
  if (E.released) return;
  const c = E.canvas;
  let w = 0;
  let h = 0;
  try {
    const r = c && typeof c.getBoundingClientRect === "function" ? c.getBoundingClientRect() : null;
    w = r ? r.width : 0;
    h = r ? r.height : 0;
    E.rect.left = r ? Number(r.left) || 0 : 0;
    E.rect.top = r ? Number(r.top) || 0 : 0;
    E.rect.ok = !!r;
  } catch {
    w = 0;
  }
  if (!(w > 0) || !(h > 0)) {
    w = (c && c.clientWidth) || 0;
    h = (c && c.clientHeight) || 0;
  }
  w = Math.round(w);
  h = Math.round(h);
  const dpr = flDprNow(w, h);
  if (w === E.w && h === E.h && dpr === E.dpr && E.L) return;
  E.w = w;
  E.h = h;
  E.dpr = dpr;
  if (!(w > 0 && h > 0)) {
    E.L = null;
    return;
  }
  if (c) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  E.font = "";
  E.track = "";
  E.tw.clear();
  E.L = flLayout(w, h);
  const host = c && (c.parentElement || c);
  E.pal = flPalette(host);
  flFontsOf(E, host);
  flDerive(E);
  E.cc = Object.create(null);
  E.fonts = Object.create(null);
  flBuildSprites(E);
  flBuildLayers(E);
  flForget(E);
  flLabels(E);
  flTrayLay(E);
  flRelayNodes(E, flNow(), true);
  flTickerMeasure(E, null, true);
  flTickerTake(E);
  // every bubble showing laid out again for this size, from its own text
  flRewrapBubbles(E);
}
/* the face the page's tokens name (--font-sans: Manrope in the trading area), where it names one */
function flFontsOf(E, host) {
  try {
    if (!host || typeof getComputedStyle !== "function") return;
    const sans = String(getComputedStyle(host).getPropertyValue("--font-sans") || "").trim();
    if (sans) E.sans = sans;
  } catch {
    // the default stands
  }
}
/* the colours made from the palette: each mascot's tint (the page's --sg-r-<role> where it sets one, else the mint stepped toward the
   text or the surface), the desks, the wall and the floor; the glass and the shadows mix toward the page's shade (--sg-shadow), else
   toward the deep sea darkened — never a colour of the floor's own */
function flDerive(E) {
  const p = E.pal;
  for (const role of FL_ROLES) {
    if (p[`r_${role}`]) continue;
    const [toward, f] = FL_TINT[role];
    p[`r_${role}`] = flMix(p.mint, p[toward], f);
  }
  const shade = p.shade || [p.bg[0] * 0.05, p.bg[1] * 0.05, p.bg[2] * 0.05, 1];
  p.coralBody = flMix(p.down, p.text, 0.12);
  p.deskTop = flMix(p.surface, p.mint, 0.07);
  p.deskFront = flMix(p.surface, p.bg, 0.5);
  p.glass = flMix(p.bg, shade, 0.35);
  p.wallHi = flMix(p.surface, p.bg, 0.2);
  p.floorBack = flMix(p.surface, p.bg, 0.55);
  p.shadow = flMix(p.bg, shade, 0.6);
}
function flBuildSprites(E) {
  const glow = (key) => {
    const c = flCanvas(64, 64);
    if (!c) return null;
    const g = c.getContext("2d");
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, flCss(E.pal[key], 0.85));
    grd.addColorStop(0.3, flCss(E.pal[key], 0.32));
    grd.addColorStop(0.65, flCss(E.pal[key], 0.08));
    grd.addColorStop(1, flCss(E.pal[key], 0));
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    return c;
  };
  const shadow = (() => {
    const c = flCanvas(64, 64);
    if (!c) return null;
    const g = c.getContext("2d");
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, flCss(E.pal.shadow, 0.55));
    grd.addColorStop(0.6, flCss(E.pal.shadow, 0.22));
    grd.addColorStop(1, flCss(E.pal.shadow, 0));
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    return c;
  })();
  const bodies = Object.create(null);
  const L = E.L;
  for (const role of FL_ROLES) {
    const s = L.seats[role];
    bodies[role] = flBodySprite(E, E.pal[`r_${role}`], s.char.w, s.char.h);
    if (role === "risk") bodies.riskCoral = flBodySprite(E, E.pal.coralBody, s.char.w, s.char.h);
  }
  // the screen's scanlines: one row of a pattern
  let scan = null;
  if (!E.lite) {
    const c = flCanvas(4, 3);
    if (c) {
      const g = c.getContext("2d");
      g.fillStyle = flCss(E.pal.scan);
      g.fillRect(0, 0, 4, 1);
      try {
        scan = E.ctx && typeof E.ctx.createPattern === "function" ? E.ctx.createPattern(c, "repeat") : null;
      } catch {
        scan = null;
      }
    }
  }
  E.sprites = { mint: glow("mint"), down: glow("down"), warn: glow("warn"), text: glow("text"), shadow, bodies, scan };
}
/* one mascot's body rendered once at its size and the pixel ratio: a soft vertical light (lighter at the crown, deeper at the base), a
   rim of light along the upper edge, a highlight at the upper left */
function flBodySprite(E, tint, cw, chh) {
  const pad = 3;
  const dpr = E.dpr;
  const c = flCanvas((cw + pad * 2) * dpr, (chh + pad * 2) * dpr);
  if (!c) return null;
  const g = c.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.translate(pad + cw / 2, pad + chh);
  flBlobPath(g, cw, chh);
  const grd = g.createLinearGradient(0, -chh, 0, 0);
  grd.addColorStop(0, flCss(flMix(tint, E.pal.text, 0.3)));
  grd.addColorStop(0.5, flCss(tint));
  grd.addColorStop(1, flCss(flMix(tint, E.pal.surface, 0.34)));
  g.fillStyle = grd;
  g.fill();
  g.save();
  g.clip();
  // the lower shade: the body's own shadow on its base
  const sh = g.createRadialGradient(0, 0, chh * 0.1, 0, -chh * 0.1, chh * 0.75);
  sh.addColorStop(0, flCss(E.pal.surface, 0.22));
  sh.addColorStop(1, flCss(E.pal.surface, 0));
  g.fillStyle = sh;
  g.fillRect(-cw, -chh * 0.45, cw * 2, chh * 0.5);
  // the rim: the same outline, a pixel lower, drawn in the room's text colour inside the body
  g.lineWidth = 1.6;
  g.strokeStyle = flCss(E.pal.text, 0.32);
  g.translate(0, 1.4);
  flBlobPath(g, cw, chh);
  g.stroke();
  g.restore();
  g.fillStyle = flCss(E.pal.text, 0.34);
  g.beginPath();
  g.ellipse(-cw * 0.2, -chh * 0.8, cw * 0.11, chh * 0.06, -0.55, 0, Math.PI * 2);
  g.fill();
  return { c, w: cw + pad * 2, h: chh + pad * 2, ox: pad + cw / 2, oy: pad + chh };
}
/* the wall and the floor, rendered once per size into two layers a little larger than the canvas (the parallax never shows an edge) */
function flBuildLayers(E) {
  const L = E.L;
  const B = 10;
  const dpr = E.dpr;
  const wall = flCanvas((L.w + B * 2) * dpr, (L.wallBase + B * 2) * dpr);
  const floor = flCanvas((L.w + B * 2) * dpr, (L.h - L.wallBase + B * 2) * dpr);
  E.layers = { wall, floor, B };
  if (wall) {
    const g = wall.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, B * dpr, B * dpr);
    flPaintWall(E, g);
  }
  if (floor) {
    const g = floor.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, B * dpr, (B - L.wallBase) * dpr);
    flPaintFloor(E, g);
  }
}
function flPaintWall(E, g) {
  const L = E.L;
  const p = E.pal;
  const grd = g.createLinearGradient(0, 0, 0, L.wallBase);
  grd.addColorStop(0, flCss(p.bg));
  grd.addColorStop(1, flCss(p.wallHi));
  g.fillStyle = grd;
  g.fillRect(-12, -12, L.w + 24, L.wallBase + 12);
  // the mint wash behind the screen: the room's one light source
  const sc = L.screen;
  const wash = g.createRadialGradient(sc.x + sc.w / 2, sc.y + sc.h * 0.45, 0, sc.x + sc.w / 2, sc.y + sc.h * 0.45, sc.w * 0.75);
  wash.addColorStop(0, flCss(p.mint, 0.1));
  wash.addColorStop(1, flCss(p.mint, 0));
  g.fillStyle = wash;
  g.fillRect(-12, -12, L.w + 24, L.wallBase + 12);
  // panel seams
  g.strokeStyle = flCss(p.mint, 0.035);
  g.lineWidth = 1;
  for (let i = 1; i < 8; i++) {
    const x = flSnap((L.w * i) / 8, E.dpr);
    g.beginPath();
    g.moveTo(x, L.ticker.y + L.ticker.h + 4);
    g.lineTo(x, L.wallBase);
    g.stroke();
  }
  // the skirting: a hairline where the wall meets the floor, and the floor's shade under it
  g.fillStyle = flCss(p.surface, 0.9);
  g.fillRect(-12, L.wallBase - 5 * L.k, L.w + 24, 5 * L.k);
  g.strokeStyle = flCss(p.mint, 0.16);
  const y = flSnap(L.wallBase - 5 * L.k, E.dpr);
  g.beginPath();
  g.moveTo(-12, y);
  g.lineTo(L.w + 12, y);
  g.stroke();
}
function flPaintFloor(E, g) {
  const L = E.L;
  const p = E.pal;
  const y0 = L.wallBase;
  const grd = g.createLinearGradient(0, y0, 0, L.h);
  grd.addColorStop(0, flCss(p.floorBack));
  grd.addColorStop(1, flCss(p.bg));
  g.fillStyle = grd;
  g.fillRect(-12, y0, L.w + 24, L.h - y0 + 12);
  // the grid, receding: lines across at depths that close up toward the wall, lines into the room that lean toward its middle
  g.strokeStyle = flCss(p.mint, 0.045);
  g.lineWidth = 1;
  const xAt = (u, v) => L.cx + (u - 0.5) * L.w * (0.88 + 0.12 * v);
  for (let j = 1; j <= 10; j++) {
    const v = Math.pow(j / 10, 1.35);
    const y = flSnap(y0 + (L.h - y0) * v, E.dpr);
    g.beginPath();
    g.moveTo(-12, y);
    g.lineTo(L.w + 12, y);
    g.stroke();
  }
  for (let i = -2; i <= 18; i++) {
    const u = i / 16;
    g.beginPath();
    g.moveTo(xAt(u, 0), y0);
    g.lineTo(xAt(u, 1.1), L.h + 12);
    g.stroke();
  }
  // the wall's shade on the floor, and the room's corners in shadow
  const sh = g.createLinearGradient(0, y0, 0, y0 + 28 * L.k);
  sh.addColorStop(0, flCss(p.shadow, 0.35));
  sh.addColorStop(1, flCss(p.shadow, 0));
  g.fillStyle = sh;
  g.fillRect(-12, y0, L.w + 24, 28 * L.k);
  const vg = g.createRadialGradient(L.cx, y0 + (L.h - y0) * 0.35, L.w * 0.2, L.cx, y0 + (L.h - y0) * 0.35, L.w * 0.75);
  vg.addColorStop(0, flCss(p.shadow, 0));
  vg.addColorStop(1, flCss(p.shadow, 0.45));
  g.fillStyle = vg;
  g.fillRect(-12, y0, L.w + 24, L.h - y0 + 12);
}
/* a glow from a sprite, additive; nothing in lite or without sprites */
function flGlow(E, key, x, y, r, a) {
  if (E.lite || !E.sprites || a <= 0.003) return;
  const s = E.sprites[key];
  if (!s) return;
  const ctx = E.ctx;
  ctx.globalAlpha = Math.min(1, a);
  ctx.drawImage(s, x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = 1;
}

/* ---- wiring, the loop, the measure --------------------------------------------------------------------------------------------- */

function flOn(E, target, type, fn, opt) {
  if (!target || typeof target.addEventListener !== "function") return;
  target.addEventListener(type, fn, opt);
  E.listeners.push([target, type, fn, opt]);
}
function flWire(E) {
  const c = E.canvas;
  if (c && typeof c.setAttribute === "function") {
    c.setAttribute("role", "img");
    E.aria = flAria(E.st);
    c.setAttribute("aria-label", E.aria);
  }
  const point = (e) => {
    // the canvas's place, read once after a resize or a scroll (flResize keeps it), not per move: no layout forced per event
    if (!E.rect.ok) {
      try {
        const r = c && typeof c.getBoundingClientRect === "function" ? c.getBoundingClientRect() : null;
        E.rect.left = r ? Number(r.left) || 0 : 0;
        E.rect.top = r ? Number(r.top) || 0 : 0;
        E.rect.ok = !!r;
      } catch {
        E.rect.ok = false;
      }
    }
    E.ptr.x = (e.clientX ?? 0) - E.rect.left;
    E.ptr.y = (e.clientY ?? 0) - E.rect.top;
    E.ptr.inside = true;
    E.ptr.at = flNow();
    // the eyes follow the pointer: the floor is back at its full rate while it moves
    E.wakeUntil = E.ptr.at + FL_WAKE_MS;
  };
  flOn(E, c, "pointermove", point);
  flOn(E, c, "pointerdown", point);
  flOn(E, c, "pointerleave", () => {
    E.ptr.inside = false;
    E.hover = null;
    if (c && c.style) c.style.cursor = "";
  });
  flOn(E, c, "click", (e) => {
    point(e);
    const hit = flHit(E, E.ptr.x, E.ptr.y);
    if (hit && E.onPick) E.onPick(hit);
  });
  // a scroll (of the page or of any pane around it) or a window resize moves the canvas: its place is read again on the next pointer event
  if (typeof addEventListener === "function") {
    const moved = () => {
      E.rect.ok = false;
    };
    flOn(E, globalThis, "scroll", moved, { passive: true, capture: true });
    if (typeof ResizeObserver === "function") flOn(E, globalThis, "resize", moved, { passive: true });
  }
  if (typeof ResizeObserver === "function" && c) {
    E.ro = new ResizeObserver(() => {
      flResize(E);
      flKick(E);
      if (!E.running) flStillFrame(E);
    });
    E.ro.observe(c);
  } else if (typeof addEventListener === "function") {
    flOn(E, globalThis, "resize", () => {
      flResize(E);
      if (!E.running) flStillFrame(E);
    });
  }
  if (typeof IntersectionObserver === "function" && c) {
    E.io = new IntersectionObserver(
      (es) => {
        const e = es && es[es.length - 1];
        E.visible = !e || !!e.isIntersecting;
        flKick(E);
        // no loop (reduced motion): the frame drawn while away is redrawn as the state stands now
        if (!E.running && E.visible) flStillFrame(E);
      },
      { rootMargin: "60px" },
    );
    E.io.observe(c);
  }
  if (typeof document !== "undefined" && document) flOn(E, document, "visibilitychange", () => flKick(E));
  try {
    E.mql = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  } catch {
    E.mql = null;
  }
  if (E.mql) {
    const onMotion = () => {
      E.still = !!E.mql.matches || typeof requestAnimationFrame !== "function";
      flKick(E);
      if (!E.running) flStillFrame(E);
    };
    if (typeof E.mql.addEventListener === "function") flOn(E, E.mql, "change", onMotion);
  }
  if (typeof document !== "undefined" && document && document.fonts && typeof document.fonts.addEventListener === "function") {
    // the fonts arrived after the first measure: measured again, so a label never sits on the fallback font's widths
    flOn(E, document.fonts, "loadingdone", () => {
      E.tw.clear();
      E.font = "";
      flForget(E);
      flLabels(E);
      flTrayLay(E);
      flRelayNodes(E, flNow(), true);
      flTickerMeasure(E, null, true);
      flRewrapBubbles(E);
      if (!E.running) flStillFrame(E);
    });
  }
  flDprWatch(E);
  // the browser's own long animation frames, where it reports them: what a frame really cost the page, painting included
  try {
    const types = typeof PerformanceObserver === "function" ? PerformanceObserver.supportedEntryTypes : null;
    if (types && typeof types.includes === "function" && types.includes("long-animation-frame")) {
      E.loaf = new PerformanceObserver((list) => {
        for (const en of list.getEntries()) E.longs.push(Number(en.startTime) + Number(en.duration));
        if (E.longs.length > 64) E.longs.splice(0, E.longs.length - 64);
      });
      E.loaf.observe({ type: "long-animation-frame" });
    }
  } catch {
    E.loaf = null;
  }
}
/* the pixel ratio watched: a window moved to a display of another density changes it with no resize, so the canvas is sized again;
   the query is for the ratio now, so it is asked again after each change */
function flDprWatch(E) {
  if (E.dprW) {
    try {
      E.dprW.mql.removeEventListener("change", E.dprW.fn);
    } catch {
      // gone already
    }
    E.dprW = null;
  }
  if (E.released || typeof matchMedia !== "function" || typeof devicePixelRatio !== "number" || !(devicePixelRatio > 0)) return;
  let mql = null;
  try {
    mql = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
  } catch {
    mql = null;
  }
  if (!mql || typeof mql.addEventListener !== "function") return;
  const fn = () => {
    flDprWatch(E);
    flResize(E);
    if (!E.running) flStillFrame(E);
  };
  mql.addEventListener("change", fn);
  E.dprW = { mql, fn };
}
/* the loop runs while it can show something: not still, not released, the canvas in view, the page visible; stopping it settles every
   event in line to its end state, so nothing plays late when the floor comes back */
function flKick(E) {
  const should = !E.released && !E.still && E.visible && !flPageHidden() && !!E.ctx;
  if (should && !E.running) {
    E.running = true;
    E.tick = 0;
    E.drawnAt = 0;
    E.idle = false;
    E.fn = 0;
    E.fi = 0;
    E.wn = 0;
    E.wi = 0;
    // the slow spell is counted again from nothing: time spent hidden or out of view never counts toward lite
    E.deg.slowSince = 0;
    E.degAt = 0;
    E.raf = requestAnimationFrame(E.loop);
  } else if (!should && E.running) {
    E.running = false;
    if (E.raf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(E.raf);
    E.raf = 0;
    flSettle(E);
  }
}
/* every event still in line played at once as its end state, every packet landed, and what the events would have shown shown now. With
   drop (the session left "live", or the page stopped reading) the lines still waiting are let go unsaid and a bubble still showing is
   cut short: the last cycle is not narrated in the dark */
function flSettle(E, drop) {
  const t = flNow();
  const list = E.q.list.splice(0);
  for (const e of list) if (!(drop && e.ev.type === "say")) flStart(E, e.ev, t, true);
  for (const p of E.packets) if (p.on) flLand(E, p, t, true);
  if (drop) for (const b of E.bubbleList) if (b.on && b.end > t) b.end = t;
  E.P.alive = 0;
  E.P.fast = 0;
  for (let i = 0; i < E.P.life.length; i++) E.P.life[i] = 0;
  E.q.air = 0;
  flShowAll(E);
}
/* one of the browser's frame callbacks: the interval since the last one measured (drawn or rested — the display's own rate, and how late
   a frame came round), then the floor stepped and drawn, unless it rests: nothing moving, nothing woke it, and less than FL_IDLE_MS
   since the last drawn frame */
function flFrame(E, t) {
  if (E.released || !E.running) return;
  E.raf = 0;
  const raw = E.tick ? t - E.tick : 0;
  E.tick = t;
  if (raw > 0 && !flPageHidden()) {
    E.iv[E.fi] = raw;
    E.fi = (E.fi + 1) % FL_FRAMES;
    if (E.fn < FL_FRAMES) E.fn++;
  }
  const rest = E.idle && t >= E.wakeUntil && E.drawnAt > 0 && t - E.drawnAt < FL_IDLE_MS;
  if (!rest) {
    const dt = E.drawnAt ? flClamp(t - E.drawnAt, 0, 50) : 1000 / 60;
    E.drawnAt = t;
    const t0 = flNow();
    E.instant = false;
    flStep(E, t, dt);
    flDraw(E, t);
    E.work[E.wi] = flNow() - t0;
    E.wi = (E.wi + 1) % FL_FRAMES;
    if (E.wn < FL_FRAMES) E.wn++;
    E.idle = !flMoving(E, t);
  }
  if (t - E.degAt > 500 && E.fn >= 60) {
    E.degAt = t;
    const was = E.lite;
    if (flDegrade(E.deg, t, flPercentile(E.iv, E.fn, 0.75, E.scratch)) && !was) {
      E.lite = true;
      E.w = 0;
      flResize(E);
    }
  }
  if (E.running && !E.released) E.raf = requestAnimationFrame(E.loop);
}
/* one frame drawn as the state stands, every motion at its end (reduced motion, or a set() while the loop is stopped) */
function flStillFrame(E) {
  if (E.released || !E.ctx || !E.L || !E.visible) return;
  const t = flNow();
  E.instant = true;
  flStep(E, t, 0);
  flDraw(E, t);
  E.instant = false;
}
/* whether anything on the floor moves: a packet, a particle (a paused room's slow z's aside), a ring, a beam, a figure rising, a bubble
   typing or fading, a tag popping or fading, the room shaking or flashing, the cycle's stamp rising, an event waiting in line, or a
   spring not yet settled this frame. The tape, the clock and the breathing are slow enough to rest with */
function flMoving(E, t) {
  // (an event held while the floor is stale is not moving: nothing starts until the page reads the desk again)
  if (E.moving || (E.q.list.length && !E.st.stale) || E.P.fast > 0) return true;
  for (const p of E.packets) if (p.on) return true;
  for (const r of E.rings) if (r.on) return true;
  for (const b of E.beams) if (b.on) return true;
  for (const f of E.floats) if (f.on) return true;
  for (const b of E.bubbleList) if (b.on && (t < b.start + b.typeMs + 450 || t >= b.end - 40)) return true;
  for (const g of E.tags) if (g.on && (t < g.born + 60 || t > g.until)) return true;
  if (t - E.shake.t0 < E.shake.dur || t - E.flash.t0 < E.flash.dur || t - E.stamp.t0 < 2200 || t - E.haltAt < 900) return true;
  return false;
}
function flStats(E) {
  const n = E.fn;
  let long = null;
  if (E.loaf) {
    long = 0;
    const now = flNow();
    for (const end of E.longs) if (now - end < 10_000) long++;
  }
  if (n < 30 || E.still) return { fps: 0, p95ms: 0, scriptMs: 0, long, idle: false, lite: E.lite, still: E.still };
  const med = flPercentile(E.iv, n, 0.5, E.scratch);
  const p95 = flPercentile(E.iv, n, 0.95, E.scratch);
  const script = flPercentile(E.work, E.wn, 0.95, E.scratch);
  return { fps: med > 0 ? Math.round(1000 / med) : 0, p95ms: Math.round(p95 * 10) / 10, scriptMs: Math.round(script * 10) / 10, long, idle: E.idle, lite: E.lite, still: E.still };
}
function flRelease(E) {
  if (E.released) return;
  E.released = true;
  E.running = false;
  if (E.raf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(E.raf);
  E.raf = 0;
  for (const [target, type, fn, opt] of E.listeners) {
    try {
      target.removeEventListener(type, fn, opt);
    } catch {
      // gone already
    }
  }
  E.listeners.length = 0;
  flDprWatch(E);
  if (E.ro && typeof E.ro.disconnect === "function") E.ro.disconnect();
  if (E.io && typeof E.io.disconnect === "function") E.io.disconnect();
  if (E.loaf && typeof E.loaf.disconnect === "function") E.loaf.disconnect();
  E.ro = null;
  E.io = null;
  E.loaf = null;
  E.q.list.length = 0;
}

/* ---- set and push ---------------------------------------------------------------------------------------------------------------- */

/* the whole state taken: the seats' words laid out again, the tray's words, the canvas's words; what the events show (the funnel, the
   scan, the wall screen's market, the marks) is decided at the next frame, once this set's events are in line (the page sets, then
   pushes), or at once where there is no loop to play them. A session that leaves "live", or a page that has stopped reading, lets what
   waits go at that frame (flSettle). A set that changed anything wakes a resting floor */
function flSet(E, state) {
  if (E.released) return;
  const was = E.st;
  const st = flNorm(state);
  E.st = st;
  let sig = "";
  try {
    sig = JSON.stringify(state) || "";
  } catch {
    sig = `#${flNow()}`;
  }
  if (sig !== E.sig) {
    E.sig = sig;
    E.wakeUntil = flNow() + FL_WAKE_MS;
  }
  flSeatsBy(E);
  flLabels(E);
  flTrayLay(E);
  const t = flNow();
  // a role thinks only while it is the one working: a think left on by a missed "off" is cleared by the next state (after a grace of
  // a second and a half, so an event that arrived just before its state is not undone)
  for (const role of FL_ROLES) {
    const ch = E.chars[role];
    if (ch.think && (!st.working || st.working.role !== role) && t - ch.thinkAt > 1500) ch.think = false;
  }
  const S = E.show;
  if ((was.session.state === "live" && st.session.state !== "live") || (st.stale && !was.stale)) S.settle = true;
  S.sync = true;
  if (!E.running) {
    // no loop: nothing plays over time, so nothing waits to be shown
    S.settle = false;
    S.sync = false;
    flShowAll(E);
  }
  flTickerTake(E);
  const aria = flAria(st);
  if (aria !== E.aria && E.canvas && typeof E.canvas.setAttribute === "function") {
    E.aria = aria;
    E.canvas.setAttribute("aria-label", aria);
  }
  if (!E.running) flStillFrame(E);
}
function flPush(E, ev) {
  if (E.released || !ev || typeof ev !== "object" || typeof ev.type !== "string") return;
  const t = flNow();
  E.wakeUntil = t + FL_WAKE_MS;
  // think, halt and cycle are states, played at once; the rest wait their turn while the loop runs
  if (ev.type === "think" || ev.type === "halt" || ev.type === "cycle") flStart(E, ev, t, !E.running);
  else if (E.running) flQueuePush(E.q, ev, t);
  else flStart(E, ev, t, true);
  if (!E.running) flStillFrame(E);
}

/* ---- what the events have shown ---------------------------------------------------------------------------------------------------- */

/* the first frame after a set(): with the set's events in line, what each shown part waits for. The Head's cycle line in line holds the
   funnel and the scan; a new focus market with a packet for it in line holds the wall screen on the market it shows; each fill in line
   holds its mark off the screen. Nothing in line for a part: it is shown as the state stands */
function flSync(E) {
  const S = E.show;
  S.sync = false;
  if (S.settle) {
    S.settle = false;
    flSettle(E, true);
    return;
  }
  const st = E.st;
  const want = st.focus ? st.focus.symbol : "";
  const have = S.focus ? S.focus.symbol : "";
  let cycle = false;
  let turn = false;
  S.fills.clear();
  for (const e of E.q.list) {
    if (flIsCycleLine(e)) cycle = true;
    const ev = e.ev;
    if (ev.type === "fill" && ev.lead) S.fills.add(String(ev.lead));
    if (want && want !== have && flCarries(ev) && String(ev.symbol ?? "") === want) turn = true;
  }
  if (cycle) {
    S.hold = true;
    S.holdScan = true;
  } else flShowCycle(E);
  if (turn) S.focusFor = want;
  else {
    S.focus = st.focus;
    S.focusFor = "";
  }
}
/* an event that carries a lead's market across the floor: a packet, an order, a fill, an exit, a card */
function flCarries(ev) {
  const t = ev && ev.type;
  return t === "handoff" || t === "reject" || t === "order" || t === "fill" || t === "exit" || t === "card";
}
/* the scan shown as the state has it: Search's bars and the network's nodes laid out again */
function flShowScan(E) {
  const S = E.show;
  S.holdScan = false;
  if (S.scan === E.st.scan) return;
  S.scan = E.st.scan;
  E.searchBars = S.scan ? flSearchBars(S.scan.rows, S.scan.picked) : null;
  flRelayNodes(E, flNow(), false);
}
/* the cycle's figures shown as the state has them: the Head's funnel, and the scan */
function flShowCycle(E) {
  const S = E.show;
  S.hold = false;
  S.funnel = E.st.funnel;
  flShowScan(E);
}
/* everything shown as the state stands: nothing held */
function flShowAll(E) {
  const S = E.show;
  flShowCycle(E);
  S.focus = E.st.focus;
  S.focusFor = "";
  S.fills.clear();
}
/* an event starting moves what it shows: a lead's packet turns the wall screen to its market, Search's first word or throw shows the new
   scan, the Head's cycle line the funnel and the scan, a fill its mark */
function flShowOn(E, ev) {
  const S = E.show;
  if (S.focusFor && String(ev.symbol ?? "") === S.focusFor && flCarries(ev)) {
    S.focus = E.st.focus;
    S.focusFor = "";
  }
  if (S.hold && ev.type === "say" && ev.role === "head" && ev.kind === "cycle") flShowCycle(E);
  else if (S.holdScan && ((ev.type === "say" && ev.role === "search") || (ev.type === "handoff" && ev.from === "search"))) flShowScan(E);
  if (ev.type === "fill" && ev.lead) S.fills.delete(String(ev.lead));
}
/* the rejects not yet in the shredder: in line, or their packet still in the air */
function flRejectsWaiting(E) {
  let n = 0;
  for (const e of E.q.list) if (e.ev.type === "reject") n++;
  for (const p of E.packets) if (p.on && p.kind === "reject" && !p.landed) n++;
  return n;
}

/* ---- starting each event ------------------------------------------------------------------------------------------------------- */

/* the point an actor throws from and catches at: a mascot's chest; the owner ("you") at the inbox tray, the account at the rack */
function flAnchor(E, who) {
  const L = E.L;
  if (!L) return null;
  const s = L.seats[who];
  if (s) return { x: s.char.x, y: s.char.y - s.char.h * 0.55, layer: s.layer };
  if (who === "you") {
    const T = E.tray || L.tray;
    return { x: T.x + T.w / 2, y: T.y, layer: "front" };
  }
  if (who === "account") return { x: L.rack.x + L.rack.w / 2, y: L.rack.y, layer: "wall" };
  return null;
}
function flStart(E, ev, t, inst) {
  flShowOn(E, ev);
  switch (ev.type) {
    case "say":
      return flStartSay(E, ev, t, inst);
    case "think":
      return flStartThink(E, ev, t);
    case "handoff":
      return flStartPacket(E, ev, t, inst, "handoff", ev.from, ev.to);
    case "reject":
      return flStartReject(E, ev, t, inst);
    case "order":
      return flStartOrder(E, ev, t, inst);
    case "fill":
      return flStartFill(E, ev, t, inst);
    case "exit":
      return flStartExit(E, ev, t, inst);
    case "card":
      return flStartPacket(E, ev, t, inst, "card", ev.role, "tray");
    case "halt": {
      // the halt shows at once, with the event's own why, until the next set() says how the session stands
      const ss = E.st.session;
      const why = String(ev.why ?? "").trim() || (ss.halted && ss.halted.why) || "";
      if (ss.state !== "halted" || !(ss.halted && ss.halted.why)) {
        E.st.session = { state: "halted", halted: { why } };
        const aria = flAria(E.st);
        if (aria !== E.aria && E.canvas && typeof E.canvas.setAttribute === "function") {
          E.aria = aria;
          E.canvas.setAttribute("aria-label", aria);
        }
      }
      E.haltAt = t;
      E.banner.v += inst ? 0 : 6;
      return { busy: 0 };
    }
    case "cycle":
      E.stamp.n = Math.max(0, Math.floor(Number(ev.n) || 0));
      E.stamp.t0 = t;
      if (!inst) E.chars.head.glow.v += 5;
      return { busy: 0 };
    default:
      return { busy: 0 };
  }
}
function flBubbleOf(E, actor) {
  let b = E.bubbles[actor];
  if (!b) {
    b = E.bubbles[actor] = { actor, on: false, text: "", lines: [], kind: "", chars: 0, start: 0, typeMs: 0, hold: 0, end: 0, w: 0, h: 0, sc: { x: 0, v: 0 }, lineH: 0, fs: 0, padX: 0, padY: 0 };
    E.bubbleList.push(b);
  }
  return b;
}
/* a bubble's lines and box at the current size; with no size (a canvas hidden, 0 × 0) none — laid out again from its text when the
   canvas has a size (flResize), so an older line is never shown for a newer one */
function flBubbleLay(E, b) {
  const L = E.L;
  if (!L) {
    b.lines = [];
    b.chars = 0;
    b.w = 0;
    b.h = 0;
    return;
  }
  // a narrow floor (k under 0.6, a phone) keeps the bubbles' type (never under 11 px) and gives each a wider box, up to 42 % of the
  // floor, in three lines: at most two show at once there (FL_BUBBLE_CAP), placed clear of each other
  const narrow = L.narrow;
  const fs = L.fs.bubble;
  const font = flFont(E, fs, false, 400);
  const maxW = narrow ? Math.max(96, L.w * 0.42) : flClamp(Math.min(210 * L.k, L.w * 0.3), 96, 300);
  b.lines = flWrap(b.text, maxW, (s) => flMeasure(E, font, s), 3);
  let wMax = 0;
  for (const ln of b.lines) wMax = Math.max(wMax, flMeasure(E, font, ln));
  b.fs = fs;
  b.lineH = Math.round(fs * 1.36);
  b.padX = Math.round(9 * Math.max(narrow ? 0.55 : 0.7, L.k));
  b.padY = Math.round(6 * Math.max(narrow ? 0.55 : 0.7, L.k));
  b.w = Math.ceil(wMax + b.padX * 2 + (flAccent(b.kind) ? 4 : 0));
  b.h = b.lines.length * b.lineH + b.padY * 2;
  b.chars = b.lines.reduce((a, ln) => a + ln.length, 0);
}
function flRewrapBubbles(E) {
  for (const b of E.bubbleList) if (b.on) flBubbleLay(E, b);
}
/* whether a line may start now: no more bubbles at once than the floor holds (two on a narrow one), so a phone's room never stacks
   three bubbles over its seats; what waits plays as the others fade */
function flMayStart(E, e) {
  if (!e || !e.ev || e.ev.type !== "say") return true;
  const cap = flBubbleCap(E.L);
  let on = 0;
  for (const b of E.bubbleList) if (b.on && b.actor !== e.actor && E.tNow < b.end) on++;
  return on < cap;
}
/* how many bubbles the floor holds at once: five, two on a narrow floor, one on a floor too short for two (under 220 px: a phone's
   floor squeezed by its page), so a line never covers the whole room */
function flBubbleCap(L) {
  if (!L || !L.narrow) return FL_BUBBLE_CAP.wide;
  return L.h < 220 ? 1 : FL_BUBBLE_CAP.narrow;
}
/* a room line's kind, as the bubble's accent: what went wrong in coral, what moved money in mint, the rest plain */
function flAccent(kind) {
  if (kind === "halt" || kind === "refusal" || kind === "warning") return "down";
  if (kind === "order" || kind === "exit" || kind === "lead" || kind === "clearance" || kind === "card") return "mint";
  return "";
}
function flStartSay(E, ev, t, inst) {
  const actor = flActorOf(E.q, ev);
  // the line in plain English (the page's own words for it); where none came, the room's line as written, its " | " separators — which
  // would read as a capital I in the bubble's face — drawn as a middle dot (the room panel keeps the line as written)
  const said = String(ev.text ?? "").trim() ? ev.text : ev.raw;
  const text = String(said ?? "").replace(/\s+/g, " ").trim().slice(0, 600).replace(/ \| /g, " · ");
  if (!text) return { busy: 0 };
  const b = flBubbleOf(E, actor);
  b.text = text;
  b.kind = typeof ev.kind === "string" ? ev.kind : "";
  flBubbleLay(E, b);
  let waiting = 0;
  for (const x of E.q.list) if (x.actor === actor && x.ev.type === "say") waiting++;
  const typeMs = inst || E.still ? 0 : (b.chars / FL_TYPE_CPS) * 1000;
  let hold = FL_HOLD_MS + FL_HOLD_PER_CHAR * b.chars;
  // lines waiting behind this one: each holds for less (never under 1.4 s), so the floor keeps up with the room
  if (waiting) hold = Math.max(1400, hold / (1 + waiting));
  b.start = t;
  b.typeMs = typeMs;
  b.hold = hold;
  b.end = t + typeMs + hold;
  b.on = true;
  b.sc.x = inst ? 1 : 0;
  b.sc.v = 0;
  const ch = E.chars[actor];
  if (ch && !inst) {
    // the speaker leans into it: a small stretch up
    ch.sq.v -= 2.2;
    if (actor === "flow" || actor === "sentiment") ch.pulseAt = t;
  } else if (ch) ch.pulseAt = t;
  return { busy: typeMs + 180, bubble: typeMs + hold + 320 };
}
function flStartThink(E, ev, t) {
  const ch = E.chars[ev.role];
  if (!ch) return { busy: 0 };
  ch.think = !!ev.on;
  ch.thinkAt = t;
  return { busy: 0 };
}
function flPacketFree(E) {
  for (const p of E.packets) if (!p.on) return p;
  // all in the air: the oldest lands at once
  let old = E.packets[0];
  for (const p of E.packets) if (p.t0 < old.t0) old = p;
  flLand(E, old, flNow(), true);
  return old;
}
/* a packet thrown from one actor to another (a handoff), to the shredder (a reject) or to the owner's tray (a card): a lift with the
   sender's squash first (anticipation), the flight along an arc whose length sets its time, a catch */
function flStartPacket(E, ev, t, inst, kind, from, to) {
  const L = E.L;
  const a = flAnchor(E, from);
  let b = null;
  if (to === "shredder" && L) b = { x: L.shredder.x + L.shredder.w * 0.5, y: L.shredder.y + L.shredder.h * 0.08 };
  else if (to === "tray" && L) {
    const T = E.tray || L.tray;
    b = { x: T.x + T.w * 0.5, y: T.y + T.h * 0.2 };
  }
  else b = flAnchor(E, to);
  if (inst || !a || !b) {
    if (kind === "card") flSlip(E, ev.symbol, ev.side, t);
    return { busy: 0 };
  }
  const p = flPacketFree(E);
  p.on = true;
  p.kind = kind;
  p.lead = String(ev.lead ?? "");
  p.sym = String(ev.symbol ?? "").slice(0, 12);
  p.side = ev.side === "sell" ? "sell" : ev.side === "buy" ? "buy" : "";
  p.from = String(from ?? "");
  p.to = String(to ?? "");
  p.ax = a.x;
  p.ay = a.y - 8 * L.k;
  p.dx = b.x;
  p.dy = b.y;
  flArc(p.ax, p.ay, p.dx, p.dy, undefined, E.arc);
  p.bx = E.arc.bx;
  p.by = E.arc.by;
  p.cx = E.arc.cx;
  p.cy = E.arc.cy;
  const dist = Math.hypot(p.dx - p.ax, p.dy - p.ay);
  p.t0 = t;
  p.lift = 170;
  p.fly = flClamp(560 + dist * 0.55, 600, 1350);
  p.land = 170;
  p.x = p.ax;
  p.y = p.ay;
  p.ang = 0;
  p.sc = 0;
  p.al = 1;
  p.tn = 0;
  p.ti = 0;
  p.sparkAt = t;
  p.landed = false;
  p.rng = flRng(flHash(p.lead + p.kind + t));
  // one more in the air: the Head's cycle line waits for it to land
  E.q.air++;
  const ch = E.chars[from];
  if (ch) ch.sq.v += 3.4;
  return { busy: p.lift + 80, lead: p.lift + p.fly + p.land };
}
function flStartReject(E, ev, t, inst) {
  E.shred.why = [ev.lead, ev.symbol, ev.why].filter((x) => x !== undefined && x !== null && String(x).trim()).map(String).join(" · ");
  E.shred.lines = null;
  E.shred.whyAt = t;
  const ch = E.chars[ev.from];
  if (ch) ch.coralUntil = t + 1500;
  const d = flStartPacket(E, ev, t, inst, "reject", ev.from, "shredder");
  if (inst) return { busy: 0 };
  return { busy: d.busy, lead: (d.lead || 0) + 300 };
}
function flTagOf(E, lead, make) {
  for (const g of E.tags) if (g.on && g.lead && g.lead === lead) return g;
  if (!make) return null;
  let free = E.tags.find((g) => !g.on);
  if (!free) {
    free = E.tags[0];
    for (const g of E.tags) if (g.until < free.until) free = g;
  }
  return free;
}
function flStartOrder(E, ev, t, inst) {
  const lead = String(ev.lead ?? "");
  const sym = String(ev.symbol ?? "").slice(0, 12);
  const side = ev.side === "sell" ? "sell" : "buy";
  const usd = Number(ev.usd);
  // the Sniper's monitor shows the Sniper's own orders only (an Exit's or a Watch's close is not an order of its seat's)
  if (String(ev.role ?? "") === "sniper") E.lastOrder = { usd, sym, side, at: t };
  const g = flTagOf(E, lead || `#${t}`, true);
  g.on = true;
  g.lead = lead || `#${t}`;
  g.sym = sym;
  g.side = side;
  g.text = `${side === "sell" ? "SELL" : "BUY"} ${Number.isFinite(usd) ? flUsd(usd) : ""} ${sym}`.replace(/\s+/g, " ").trim();
  g.text2 = "";
  const f = E.show.focus;
  g.chip = !(f && f.symbol === sym);
  g.price = !g.chip ? (Number.isFinite(f.price) ? f.price : f.candles.length ? f.candles[f.candles.length - 1].c : NaN) : NaN;
  if (!g.chip && !Number.isFinite(g.price)) g.chip = true;
  g.born = inst ? t : t + 280;
  g.fillAt = -1e9;
  g.until = t + 9000;
  g.sc.x = inst ? 1 : 0;
  g.sc.v = 0;
  g.mo.x = 0;
  g.mo.v = 0;
  const ch = E.chars[ev.role];
  if (!inst) {
    if (ch) {
      // the recoil: thrown back toward the viewer, a squash, then the spring brings it home
      ch.rec.v += 140 * (E.L ? E.L.k : 1);
      ch.sq.v += 3;
    }
    const bm = E.beams.find((x) => !x.on) || E.beams[0];
    bm.on = true;
    bm.role = String(ev.role ?? "");
    bm.lead = g.lead;
    bm.t0 = t;
    bm.col = side === "sell" ? "down" : "mint";
  }
  return { busy: 650, lead: 320 };
}
function flStartFill(E, ev, t, inst) {
  const lead = String(ev.lead ?? "");
  const sym = String(ev.symbol ?? "").slice(0, 12);
  const side = ev.side === "sell" ? "sell" : "buy";
  const price = Number(ev.price);
  const qty = Number(ev.qty);
  let g = lead ? flTagOf(E, lead, false) : null;
  const f = E.show.focus;
  if (!g) {
    g = flTagOf(E, lead || `#${t}`, true);
    g.on = true;
    g.lead = lead || `#${t}`;
    g.sym = sym;
    g.side = side;
    g.text = `${side === "sell" ? "SELL" : "BUY"} ${sym}`;
    g.born = t;
    g.sc.x = inst ? 1 : 0;
    g.sc.v = 0;
  }
  g.chip = !(f && f.symbol === sym && Number.isFinite(price));
  if (!g.chip) g.price = price;
  g.text2 = `FILLED ${Number.isFinite(qty) ? flQty(qty) : ""} ${sym} @ ${Number.isFinite(price) ? flPrice(price, f && f.symbol === sym ? f.priceStep : NaN) : "—"}`.replace(/\s+/g, " ");
  g.fillAt = t;
  g.until = t + 7000;
  g.mo.x = inst ? 1 : 0;
  g.mo.v = 0;
  if (!inst) {
    const pos = flTagPos(E, g);
    if (pos) flBurst(E, pos.x, pos.y, side === "sell" ? 1 : 0, E.lite ? 13 : 26, 1);
  }
  return { busy: 0, lead: 500 };
}
function flQty(q) {
  const a = Math.abs(q);
  if (a >= 1000) return flGroup(q.toFixed(0));
  if (a >= 1) return String(Math.round(q * 1e4) / 1e4);
  return String(Number(q.toPrecision(4)));
}
function flStartExit(E, ev, t, inst) {
  const lead = String(ev.lead ?? "");
  const why = ["tp", "stop", "time", "liq", "brain", "other"].includes(ev.why) ? ev.why : "other";
  const pnl = Number(ev.pnlUsd);
  const g = lead ? flTagOf(E, lead, false) : null;
  let pos = g ? flTagPos(E, g) : null;
  if (!pos) pos = flMarkPos(E, lead, String(ev.symbol ?? ""));
  if (!pos && E.L) pos = { x: E.L.screen.x + E.L.screen.w * 0.8, y: E.L.screen.y + E.L.screen.h * 0.5 };
  if (!pos) return { busy: 0 };
  const col = why === "tp" ? "mint" : why === "stop" || why === "liq" ? "down" : why === "time" ? "dim" : "text";
  const words = why === "tp" ? "TP" : why === "stop" ? "STOP" : why === "liq" ? "LIQUIDATION" : why === "time" ? "TIME" : why === "brain" ? "EXIT" : "CLOSED";
  const fl = E.floats.find((x) => !x.on) || E.floats[0];
  fl.on = true;
  fl.text = `${words} ${String(ev.symbol ?? "").slice(0, 12)} ${Number.isFinite(pnl) ? flSigned(pnl) : ""}`.replace(/\s+/g, " ").trim();
  fl.x = pos.x;
  fl.y = pos.y;
  fl.rise = (inst ? 0 : 46) * (E.L ? E.L.k : 1);
  fl.t0 = t;
  fl.dur = inst ? 5000 : 1900;
  fl.col = Number.isFinite(pnl) && pnl !== 0 ? (pnl > 0 ? "up" : "down") : col === "mint" ? "mint" : "text";
  if (!inst) {
    const k = E.L ? E.L.k : 1;
    if (why === "tp") for (let i = 0; i < 3; i++) flRing(E, pos.x, pos.y, 4 * k, (34 + i * 16) * k, t + i * 90, 900, "mint", 2, true);
    else if (why === "stop" || why === "liq") {
      E.flash.t0 = t;
      E.shake.t0 = t;
      flRing(E, pos.x, pos.y, 4 * k, 40 * k, t, 600, "down", 2, true);
    } else if (why === "time") flRing(E, pos.x, pos.y, 6 * k, 36 * k, t, 1100, "dim", 1.5, true);
    else flRing(E, pos.x, pos.y, 6 * k, 32 * k, t, 900, "text", 1.2, true);
  }
  if (g) g.until = Math.min(g.until, t + 600);
  return { busy: 0, lead: 900 };
}
function flSlip(E, sym, side, t) {
  let s = E.slips.find((x) => !x.on);
  if (!s) {
    s = E.slips[0];
    for (const x of E.slips) if (x.t0 < s.t0) s = x;
  }
  s.on = true;
  s.sym = String(sym ?? "").slice(0, 10);
  s.side = side === "sell" ? "sell" : side === "buy" ? "buy" : "";
  s.label = s.side ? `${s.side === "sell" ? "▼" : "▲"} ${s.sym}` : s.sym;
  s.t0 = t;
  s.a = 1;
  s.goneAt = 0;
}
function flRing(E, x, y, r0, r1, t0, dur, col, lw, wall) {
  const r = E.rings.find((z) => !z.on) || E.rings[0];
  r.on = true;
  r.x = x;
  r.y = y;
  r.r0 = r0;
  r.r1 = r1;
  r.t0 = t0;
  r.dur = dur;
  r.col = col;
  r.lw = lw;
  r.wall = !!wall;
}
/* the colours a particle can take, by index */
const FL_PCOL = ["mint", "down", "text", "warn", "dim"];
/* one particle: kind 1 spark, 2 burst, 3 paper strip, 4 a paused room's z; taken from the pool (in lite, every other one is skipped) */
function flParticle(E, kind, x, y, vx, vy, life, size, col) {
  const P = E.P;
  if (E.lite && (P.count++ & 1)) return;
  const n = P.life.length;
  let i = P.next;
  for (let tries = 0; tries < n; tries++) {
    if (P.life[i] <= 0) break;
    i = (i + 1) % n;
  }
  P.next = (i + 1) % n;
  P.x[i] = x;
  P.y[i] = y;
  P.vx[i] = vx;
  P.vy[i] = vy;
  P.life[i] = life;
  P.max[i] = life;
  P.size[i] = size;
  P.rot[i] = 0;
  P.vr[i] = 0;
  P.kind[i] = kind;
  P.col[i] = col;
  return i;
}
function flBurst(E, x, y, col, count, speed) {
  const k = E.L ? E.L.k : 1;
  const rng = flRng(flHash(`${x}|${y}|${count}`));
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rng() * 0.4;
    const v = (60 + rng() * 140) * k * speed;
    flParticle(E, 2, x, y, Math.cos(a) * v, Math.sin(a) * v - 20 * k, 520 + rng() * 380, (1.2 + rng() * 1.6) * k, col);
  }
}

/* ---- where things are on the wall screen ------------------------------------------------------------------------------------------ */

/* the wall screen's geometry this frame (written by the screen's drawing into one object kept for it, read by beams, tags, threads and
   exits): S.ok when a chart is drawn; a price's height on it */
function flScrY(S, p) {
  return S.top + ((S.vhi - p) / (S.vhi - S.vlo || 1)) * (S.pb - S.top);
}
/* a tag's anchor: its right end, which points at the latest candle at the tag's price (the tag reaching left over older bars, so it stays
   on the screen), or — a tag for another market than the one on the screen — the right column of the chart, one under another. Written
   into one object kept for it (read at once by the caller) */
function flTagPos(E, g) {
  const S = E.scr;
  if (!S) return null;
  const out = E.tagAt || (E.tagAt = { x: 0, y: 0, chip: false });
  const k = E.L ? E.L.k : 1;
  if (!g.chip && Number.isFinite(g.price) && S.ok) {
    // its right end, the pointer included, kept 4 px clear of the last price's chip on the axis
    out.x = Math.min(S.lastX - S.slot * 1.1, S.chipX - 4 * k - 5 * k);
    out.y = flClamp(flScrY(S, g.price), S.top + 8, S.bottom - 8);
    out.chip = false;
    return out;
  }
  let n = 0;
  for (const x of E.tags) {
    if (x === g) break;
    if (x.on && (x.chip || !Number.isFinite(x.price))) n++;
  }
  out.x = Math.min(S.x1 - 6, S.chipX - 4 * k);
  out.y = S.top + 12 + n * 22 * k;
  out.chip = true;
  return out;
}
function flMarkPos(E, lead, sym) {
  const S = E.scr;
  const f = E.show.focus;
  if (!S || !S.ok || !f || f.symbol !== sym) return null;
  const m = f.marks.find((x) => x.lead === lead);
  if (!m) return null;
  return { x: S.lastX, y: flClamp(flScrY(S, m.entry), S.top, S.bottom) };
}

/* ---- the scan nodes and the tape ---------------------------------------------------------------------------------------------- */

/* a scan that changed is laid out again: nodes still in it fly from where they are to their new place, new ones fly in from the Search
   desk one after another, ones no longer in it fade where they stand */
function flRelayNodes(E, t, force) {
  const L = E.L;
  const sc = E.show.scan;
  const sig = sc ? `${sc.at}|${sc.rows.map((r) => `${r.symbol}:${r.changePct24h}:${r.volumeUsd24h}`).join(",")}|${sc.picked.join(",")}` : "";
  if (!force && sig === E.scanSig) return;
  const fresh = sig !== E.scanSig;
  E.scanSig = sig;
  if (!L) return;
  // what else is written on the wall beside the nodes: the scan's caption under the screen's left, and each named node's name
  const cap = flScanCaption(E, sc);
  const tfont = flFont(E, L.fs.tiny, true, 500);
  // kept clear too: the clock, the rack and its words
  const rw = flRackWordsBox(E);
  const keep = [{ x: L.clock.x - 3, y: L.clock.y - 3, w: L.clock.w + 6, h: L.clock.h + 6 }, { x: L.rack.x - 3, y: L.rack.y - 9 * L.k, w: L.rack.w + 9 * L.k + 6, h: L.rack.h + 9 * L.k }, rw];
  if (cap.w > 0) keep.push({ x: cap.x - 2, y: cap.y - 2, w: cap.w + 4, h: cap.h + 4 });
  const opt = { keep, label: { h: L.fs.tiny + 2, w: (sym) => flMeasure(E, tfont, flBase(sym)) + 2, pickedOnly: L.narrow } };
  const laid = sc ? flScanLayout(sc.rows, sc.picked, L.net, { x: L.screen.x - 6, y: L.screen.y - 6, w: L.screen.w + 12, h: L.screen.h + 12 }, opt) : [];
  const old = new Map(E.nodes.filter((n) => !n.gone).map((n) => [n.sym, n]));
  const from = L.seats.search.mon;
  const next = [];
  laid.forEach((d, i) => {
    let n = old.get(d.symbol);
    if (n) old.delete(d.symbol);
    else {
      const instant = E.instant || E.still || !E.running || force;
      n = { sym: d.symbol, x: { x: instant ? d.x : from.x + from.w / 2, v: 0 }, y: { x: instant ? d.y : from.y + from.h / 2, v: 0 }, a: { x: instant ? 1 : 0, v: 0 }, born: instant ? t : t + i * 28, gone: false };
    }
    n.tx = d.x;
    n.ty = d.y;
    n.r = d.r;
    n.picked = d.picked;
    n.named = d.named;
    n.base = flBase(d.symbol);
    n.change = d.change;
    n.vol = d.volume;
    n.hollow = d.hollow;
    n.peek = null;
    n.col = flNodeColor(d.change, E.pal);
    if (force) {
      n.x.x = d.x;
      n.y.x = d.y;
      n.x.v = 0;
      n.y.v = 0;
    }
    n.h = flHash(d.symbol);
    next.push(n);
  });
  if (fresh) for (const n of old.values()) {
    n.gone = true;
    next.push(n);
  }
  E.nodes = next;
}
/* the tape's items measured in its font. New items (a set() whose tape changed) are laid after the current ones, from the first loop
   boundary beyond the tape's right end, so they scroll in from the right and nothing on the tape changes in place; a newer tape that
   comes while one waits replaces it if its boundary is still out of sight, else waits behind it. A new size or newly loaded fonts
   measure what is shown, and what waits, again at once. Nothing is taken before the canvas has a size: the first size takes the
   state's tape */
function flTickerTake(E) {
  const sig = E.st.ticker.map((x) => `${x.dir}:${x.text}`).join("|");
  if (sig === E.tk.sig || !E.L) return;
  E.tk.sig = sig;
  flTickerMeasure(E, E.st.ticker, !E.running || !E.tk.items.length || !E.st.ticker.length);
}
/* how many whole loops of the tape now showing still pass before a new tape starts: the first loop boundary at or beyond the tape's
   right end (off: how far the current loop has scrolled; tapeW: the tape's width), so the new items enter from the right */
function flTickerSwapAt(off, loopW, tapeW) {
  if (!(loopW > 0)) return 0;
  return Math.max(1, Math.ceil(((Number(off) || 0) + Math.max(0, Number(tapeW) || 0)) / loopW));
}
function flTickerLay(E, src) {
  const font = E.tk.font;
  const items = src.map((x) => {
    const glyph = x.dir === "up" ? "▲" : x.dir === "down" ? "▼" : "";
    const text = glyph && !/[▲▼]/.test(x.text) ? `${glyph} ${x.text}` : x.text;
    return { src: x, text, dir: x.dir, w: flMeasure(E, font, text) };
  });
  return { items, loopW: flTickerLoop(items.map((x) => x.w), E.tk.gap).width };
}
function flTickerMeasure(E, raw, now) {
  const L = E.L;
  if (!L) return;
  const tk = E.tk;
  tk.font = flFont(E, Math.max(9, Math.round(L.ticker.h * 0.42)), true, 500);
  tk.gap = 28 * L.k;
  if (raw) {
    const got = flTickerLay(E, raw);
    if (now || !got.items.length) {
      tk.items = got.items;
      tk.loopW = got.loopW;
      tk.off = got.loopW > 0 ? tk.off % got.loopW : 0;
      tk.pending = null;
      tk.next = null;
    } else if (!tk.pending) {
      tk.pending = got;
      tk.swapLoops = flTickerSwapAt(tk.off, tk.loopW, L.ticker.w);
    } else if (tk.swapLoops * tk.loopW - tk.off >= L.ticker.w) tk.pending = got;
    else tk.next = got;
    return;
  }
  const cur = flTickerLay(E, tk.items.map((x) => x.src));
  tk.items = cur.items;
  tk.loopW = cur.loopW;
  tk.off = cur.loopW > 0 ? tk.off % cur.loopW : 0;
  if (tk.pending) {
    tk.pending = flTickerLay(E, tk.pending.items.map((x) => x.src));
    tk.swapLoops = flTickerSwapAt(tk.off, tk.loopW, L.ticker.w);
  }
  if (tk.next) tk.next = flTickerLay(E, tk.next.items.map((x) => x.src));
}

/* ---- the step: every spring, the queue, what flies ------------------------------------------------------------------------------- */

function flLightOf(st) {
  switch (st.session.state) {
    case "live":
      return 1;
    case "paused":
      return 0.55;
    case "halted":
      return 0.4;
    case "ended":
      return 0.14;
    default:
      return 0.5;
  }
}
function flStep(E, t, dt) {
  const L = E.L;
  if (!L) return;
  const st = E.st;
  const inst = E.instant;
  const sess = st.session.state;
  E.tNow = t;
  E.dtLast = dt;
  E.moving = false;
  // the first frame after a set(): what the events will show, now that they are in line
  if (!inst && E.show.sync) flSync(E);
  flSp(E, E.light, flLightOf(st), FL_SPRING.soft, dt);
  // parallax follows the pointer while it is over the floor
  const px = E.ptr.inside && !E.still ? flClamp((E.ptr.x / L.w - 0.5) * 2, -1, 1) : 0;
  const py = E.ptr.inside && !E.still ? flClamp((E.ptr.y / L.h - 0.5) * 2, -1, 1) : 0;
  flSp(E, E.par.x, px, FL_SPRING.soft, dt);
  flSp(E, E.par.y, py, FL_SPRING.soft, dt);
  flSp(E, E.trophy, st.target ? flClamp(st.target.progressPct, 0, 100) / 100 : 0, FL_SPRING.drift, dt);
  flSp(E, E.banner, sess === "halted" || sess === "none" || sess === "paused" || sess === "ended" ? 1 : 0, FL_SPRING.pop, dt);
  // the queue: what may start now starts — nothing while the page has stopped reading (no new bubble or packet on a stale floor); the
  // Head's cycle line waits for every packet in the air to land
  let air = 0;
  for (const p of E.packets) if (p.on && !p.landed) air++;
  E.q.air = air;
  if (!inst && E.q.list.length && !st.stale) flQueueDue(E.q, t, E.gate, E.due, E.may);
  // the eyes' target: the packet in the air, else the pointer while it moves, else the wall screen
  let lookX = L.screen.x + L.screen.w / 2;
  let lookY = L.screen.y + L.screen.h / 2;
  let looking = false;
  for (const p of E.packets) {
    if (p.on) {
      lookX = p.x;
      lookY = p.y;
      looking = true;
      break;
    }
  }
  if (!looking && E.ptr.inside && t - E.ptr.at < 3000) {
    lookX = E.ptr.x;
    lookY = E.ptr.y;
  }
  const still = sess === "halted" || sess === "ended";
  const working = st.working ? st.working.role : "";
  let idx = 0;
  for (const role of FL_ROLES) {
    const ch = E.chars[role];
    const s = L.seats[role];
    flSp(E, ch.amp, sess === "halted" || sess === "ended" ? 0 : sess === "paused" ? 0.45 : 1, FL_SPRING.soft, dt);
    flSp(E, ch.lean, sess === "paused" ? (idx % 2 ? 0.07 : -0.07) : sess === "ended" ? (idx % 2 ? 0.04 : -0.04) : 0, FL_SPRING.drift, dt);
    flSp(E, ch.sq, 0, FL_SPRING.jelly, dt);
    flSp(E, ch.rec, 0, FL_SPRING.snap, dt);
    flSp(E, ch.glow, working === role || ch.think ? 1 : 0.5, FL_SPRING.soft, dt);
    flSp(E, ch.coral, role === "risk" && (t < ch.coralUntil || sess === "halted") ? 1 : 0, FL_SPRING.soft, dt);
    // eyes: a unit toward what is looked at, scaled to the eye's room
    let ex = 0;
    let ey = 0;
    if (!still && !inst) {
      const dx = lookX - s.char.x;
      const dy = lookY - (s.char.y - s.char.h * 0.62);
      const d = Math.hypot(dx, dy) || 1;
      ex = (dx / d) * flClamp(d / 200, 0.35, 1);
      ey = (dy / d) * flClamp(d / 200, 0.35, 1);
    }
    flSp(E, ch.eyeX, ex, FL_SPRING.snap, dt);
    flSp(E, ch.eyeY, ey, FL_SPRING.snap, dt);
    // blinks every three to six seconds, now and then twice (decor, seeded by the role)
    if (t > ch.blinkAt + 170) {
      if (ch.blinkTwice) {
        ch.blinkTwice = false;
        ch.blinkAt = t + 90;
      } else {
        ch.blinkAt = t + 3000 + ch.rng() * 3000;
        ch.blinkTwice = ch.rng() < 0.18;
      }
    }
    // a paused room dozes: a z now and then over each mascot that sits there
    if (sess === "paused" && !inst && t > ch.zAt) {
      ch.zAt = t + 1500 + ch.rng() * 1100;
      const seat = E.seatBy[role];
      if (!flSeatOff(seat)) flParticle(E, 4, s.char.x + s.char.w * 0.3, s.char.y - s.char.h * 1.05, (8 + ch.rng() * 8) * L.k, -18 * L.k, 2600, L.fs.small + 1, 4);
    }
    idx++;
  }
  // bubbles open with a pop
  for (const b of E.bubbleList) {
    if (!b.on) continue;
    if (t > b.end + 320) {
      b.on = false;
      continue;
    }
    flSp(E, b.sc, 1, FL_SPRING.pop, dt);
  }
  flStepPackets(E, t, dt);
  flStepParticles(E, dt);
  // tags: a pop when the beam lands, a morph when filled, gone when their time is up
  for (const g of E.tags) {
    if (!g.on) continue;
    if (t > g.until + 400) {
      g.on = false;
      g.lead = "";
      continue;
    }
    if (t >= g.born) {
      if (!inst && g.sc.x === 0 && g.sc.v === 0) {
        const pos = flTagPos(E, g);
        if (pos) {
          flRing(E, pos.x, pos.y, 3 * L.k, 26 * L.k, t, 700, g.side === "sell" ? "down" : "mint", 1.5, true);
          flRing(E, pos.x, pos.y, 3 * L.k, 40 * L.k, t + 120, 800, g.side === "sell" ? "down" : "mint", 1, true);
        }
      }
      flSp(E, g.sc, 1, FL_SPRING.pop, dt);
    }
    flSp(E, g.mo, t >= g.fillAt ? 1 : 0, FL_SPRING.pop, dt);
  }
  for (const r of E.rings) if (r.on && t > r.t0 + r.dur) r.on = false;
  for (const f of E.floats) if (f.on && t > f.t0 + f.dur) f.on = false;
  for (const b of E.beams) if (b.on && t > b.t0 + 1100) b.on = false;
  flStepSlips(E, t);
  // the tape scrolls at a constant speed; a new set of items, laid after the current loops, becomes the tape once its first item has
  // reached the left end — where it already was, so nothing moves
  const tk = E.tk;
  if (tk.loopW > 0 && !inst) {
    tk.off += (dt / 1000) * FL_TICKER_PXS * L.k;
    for (let guard = 0; tk.loopW > 0 && tk.off >= tk.loopW && guard < 64; guard++) {
      tk.off -= tk.loopW;
      if (!tk.pending) continue;
      tk.swapLoops--;
      if (tk.swapLoops > 0) continue;
      tk.items = tk.pending.items;
      tk.loopW = tk.pending.loopW;
      tk.pending = tk.next;
      tk.next = null;
      if (tk.pending) tk.swapLoops = flTickerSwapAt(tk.off, tk.loopW, L.ticker.w);
    }
  } else if (tk.pending) {
    tk.items = (tk.next || tk.pending).items;
    tk.loopW = (tk.next || tk.pending).loopW;
    tk.pending = null;
    tk.next = null;
    tk.off = 0;
  }
  // the nodes fly to their places, one after another
  for (let i = E.nodes.length - 1; i >= 0; i--) {
    const n = E.nodes[i];
    if (n.gone) {
      flSp(E, n.a, 0, FL_SPRING.soft, dt);
      if (n.a.x < 0.02 || inst) E.nodes.splice(i, 1);
      continue;
    }
    if (t < n.born) continue;
    flSp(E, n.x, n.tx, FL_SPRING.drift, dt);
    flSp(E, n.y, n.ty, FL_SPRING.drift, dt);
    flSp(E, n.a, 1, FL_SPRING.soft, dt);
  }
  // the clock reads the time four times a second
  if (t - E.clock.at > 250 || inst) {
    E.clock.at = t;
    E.clock.text = flClockText(new Date(), st.clock.zone);
  }
  // the hover: what the pointer is over, and the hand cursor where a click picks something
  E.hoverNode = "";
  if (E.ptr.inside) {
    E.hover = flHit(E, E.ptr.x, E.ptr.y);
    const wx = E.ptr.x - E.par.x.x * 6 * 0.35;
    const wy = E.ptr.y - E.par.y.x * 4 * 0.35;
    for (const n of E.nodes) if (!n.gone && n.a.x > 0.5 && Math.hypot(wx - n.x.x, wy - n.y.x) <= Math.max(n.r + 3, 7)) E.hoverNode = n.sym;
    if (E.canvas && E.canvas.style) {
      const cur = E.hover ? "pointer" : "";
      if (E.canvas.style.cursor !== cur) E.canvas.style.cursor = cur;
    }
  }
}
function flStepPackets(E, t, dt) {
  const L = E.L;
  for (const p of E.packets) {
    if (!p.on) continue;
    const e = t - p.t0;
    if (e < p.lift) {
      // the lift: up from the sender's hands, popping to full size
      const u = e / p.lift;
      p.sc = flEaseOutBack(u, 2.2);
      p.x = p.ax;
      p.y = p.ay - 10 * L.k * flEaseOutCubic(u);
      p.ang = 0;
    } else if (e < p.lift + p.fly) {
      const u = flEaseInOutCubic((e - p.lift) / p.fly);
      flBezier(p.ax, p.ay - 10 * L.k, p.bx, p.by, p.cx, p.cy, p.dx, p.dy, u, E.pt);
      const ang = Math.atan2(E.pt.y - p.y, E.pt.x - p.x);
      p.x = E.pt.x;
      p.y = E.pt.y;
      p.ang = flClamp((Math.abs(ang) > Math.PI / 2 ? ang - Math.sign(ang) * Math.PI : ang) * 0.35, -0.35, 0.35);
      p.sc = 1;
      // the trail: the last sixteen places
      p.trail[p.ti * 2] = p.x;
      p.trail[p.ti * 2 + 1] = p.y;
      p.ti = (p.ti + 1) % 16;
      if (p.tn < 16) p.tn++;
      // sparks shed along the way
      if (t - p.sparkAt > 22) {
        p.sparkAt = t;
        const r = p.rng;
        flParticle(E, 1, p.x, p.y, (r() - 0.5) * 50 * L.k, (r() - 0.2) * 40 * L.k, 380 + r() * 260, (0.9 + r() * 1.1) * L.k, p.kind === "reject" ? 1 : p.kind === "card" ? 3 : p.side === "sell" ? 1 : 0);
      }
    } else if (!p.landed) flLand(E, p, t, false);
    else if (e < p.lift + p.fly + p.land) {
      const u = (e - p.lift - p.fly) / p.land;
      p.sc = 1 - flEaseInCubic(u) * 0.8;
      p.al = 1 - u;
      if (p.tn > 0 && (e | 0) % 2 === 0) p.tn--;
    } else p.on = false;
  }
}
/* a packet lands: the receiver squashes on the catch, the shredder chews, the tray takes a slip */
function flLand(E, p, t, inst) {
  p.landed = true;
  p.x = p.dx;
  p.y = p.dy;
  const L = E.L;
  if (inst) p.on = false;
  if (p.kind === "handoff") {
    const ch = E.chars[p.to];
    if (ch && !inst) {
      ch.sq.v += 4.6;
      ch.catchAt = t;
      flRing(E, p.dx, p.dy, 3 * L.k, 22 * L.k, t, 520, p.side === "sell" ? "down" : "mint", 1.5, false);
    }
  } else if (p.kind === "reject") {
    E.shred.chewUntil = t + 760;
    if (!inst) {
      const sh = L.shredder;
      for (let i = 0; i < 9; i++) {
        const r = p.rng;
        flParticle(E, 3, sh.x + sh.w * (0.2 + r() * 0.6), sh.y + sh.h * 0.9, (r() - 0.5) * 30 * L.k, (20 + r() * 30) * L.k, 1300 + r() * 500, (2 + r()) * L.k, 2);
      }
    }
  } else if (p.kind === "card") {
    flSlip(E, p.sym, p.side, t);
    if (!inst) flRing(E, p.dx, p.dy, 3 * L.k, 26 * L.k, t, 600, "warn", 1.5, false);
  }
}
function flStepParticles(E, dt) {
  const P = E.P;
  const s = dt / 1000;
  const k = E.L ? E.L.k : 1;
  let alive = 0;
  let fast = 0;
  for (let i = 0; i < P.life.length; i++) {
    if (P.life[i] <= 0) continue;
    P.life[i] -= dt;
    if (P.life[i] <= 0) continue;
    alive++;
    const kind = P.kind[i];
    if (kind !== 4) fast++;
    if (kind === 3) {
      // paper: falls, sways, turns
      P.vy[i] += 260 * k * s;
      P.vx[i] *= 1 - 1.5 * s;
      P.rot[i] += (P.vx[i] * 0.04 + 2) * s;
    } else if (kind === 4) {
      P.vx[i] *= 1 - 0.3 * s;
    } else {
      // sparks and bursts slow in the air and settle a little
      const drag = kind === 2 ? 3.2 : 2.4;
      P.vx[i] *= 1 - drag * s;
      P.vy[i] = P.vy[i] * (1 - drag * s) + 40 * k * s;
    }
    P.x[i] += P.vx[i] * s;
    P.y[i] += P.vy[i] * s;
  }
  P.alive = alive;
  P.fast = fast;
}

/* ---- picking ---------------------------------------------------------------------------------------------------------------------- */

/* what is under (x, y): the owner's tray ({ tray: true }), a mascot or its station ({ role }), the wall screen or a scan node
   ({ symbol }) */
function flHit(E, x, y) {
  const L = E.L;
  if (!L) return null;
  const px = E.par.x.x * 6;
  const py = E.par.y.x * 4;
  const T = flTrayShown(E) ? E.tray : null;
  if (T && x - px >= T.x - 3 && x - px <= T.x + T.w + 3 && y - py >= T.y - 3 && y - py <= T.y + T.h + 3) return { tray: true };
  for (let i = L.order.length - 1; i >= 0; i--) {
    const role = L.order[i];
    const s = L.seats[role];
    const f = s.layer === "back" ? 0.7 : 1;
    const lx = x - px * f;
    const ly = y - py * f;
    if (lx >= s.box.x0 && lx <= s.box.x1 && ly >= s.box.y0 && ly <= s.box.y1) return { role };
  }
  const wx = x - px * 0.35;
  const wy = y - py * 0.35;
  for (const n of E.nodes) {
    if (n.gone || n.a.x < 0.5) continue;
    if (Math.hypot(wx - n.x.x, wy - n.y.x) <= Math.max(n.r + 3, 7)) return { symbol: n.sym };
  }
  const sc = L.screen;
  const fo = E.show.focus;
  if (fo && wx >= sc.x && wx <= sc.x + sc.w && wy >= sc.y && wy <= sc.y + sc.h) return { symbol: fo.symbol };
  return null;
}

/* ---- drawing ---------------------------------------------------------------------------------------------------------------------- */

function flDraw(E, t) {
  const ctx = E.ctx;
  const L = E.L;
  if (!ctx || !L) return;
  const dpr = E.dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  E.font = "";
  if (E.hasTrack) {
    ctx.letterSpacing = "0px";
    E.track = "0px";
  }
  ctx.fillStyle = flC(E, "bg");
  ctx.fillRect(0, 0, L.w, L.h);
  // a stop or a liquidation shakes the room: 2 px, 200 ms, dying away
  let sx = 0;
  let sy = 0;
  const se = t - E.shake.t0;
  if (!E.instant && se >= 0 && se < E.shake.dur) {
    const a = E.shake.amp * (1 - se / E.shake.dur);
    sx = Math.sin(se * 0.21) * a;
    sy = Math.cos(se * 0.17) * a * 0.6;
  }
  ctx.translate(sx, sy);
  const px = E.par.x.x * 6;
  const py = E.par.y.x * 4;
  const lit = E.light.x;
  // the wall, its fixtures' bodies
  ctx.save();
  ctx.translate(px * 0.35, py * 0.35);
  flDrawWall(E);
  flDrawTicker(E, t);
  flDrawClock(E, t);
  flDrawRack(E, t, 0);
  flDrawTrophy(E, t, 0);
  flDrawShredder(E, t, 0);
  flRestore(E);
  // the floor
  ctx.save();
  ctx.translate(px * 0.6, py * 0.6);
  flDrawFloor(E);
  flRestore(E);
  // the stations, back row then front row
  for (const role of L.order) {
    const f = L.seats[role].layer === "back" ? 0.7 : 1;
    ctx.save();
    ctx.translate(px * f, py * f);
    flDrawStation(E, role, t);
    flRestore(E);
  }
  ctx.save();
  ctx.translate(px, py);
  flDrawTray(E, t, 0);
  flRestore(E);
  // what lights itself — the rack's LEDs, the words on the fixtures and under the seats — is drawn above the room's lights; in an ended
  // session every light is off but the wall screen's, so these go under the dark with the rest of the room
  const ended = E.st.session.state === "ended";
  if (ended) flDrawSelfLit(E, t, px, py);
  // the room's lights: everything above dims with them
  const dim = 1 - lit;
  if (dim > 0.004) {
    ctx.fillStyle = flC(E, "bg", dim * 0.88);
    ctx.fillRect(-12, -12, L.w + 24, L.h + 24);
  }
  // the wall screen and its network light themselves, always
  ctx.save();
  ctx.translate(px * 0.35, py * 0.35);
  flDrawScreen(E, t);
  flDrawNet(E, t);
  // over the screen's lines and the threads: the marks' words, then the order and fill tags (an order's moment above all)
  flDrawMarkWords(E);
  flDrawTags(E, t);
  flRestore(E);
  if (!ended) flDrawSelfLit(E, t, px, py);
  // what flies
  flDrawBeams(E, t, px, py);
  ctx.save();
  ctx.translate(px * 0.85, py * 0.85);
  flDrawPackets(E, t);
  flDrawParticles(E);
  flRestore(E);
  flDrawRings(E, t, px, py);
  ctx.save();
  ctx.translate(px * 0.35, py * 0.35);
  flDrawFloats(E, t);
  flRestore(E);
  flDrawBubbles(E, t, px, py);
  // the page has stopped reading the desk: a dim veil over the room, the session's banner over it, and since when it was last read
  const stale = !!E.st.stale;
  if (stale) {
    ctx.fillStyle = flC(E, "bg", 0.55);
    ctx.fillRect(-12, -12, L.w + 24, L.h + 24);
  }
  flDrawBanner(E, t);
  if (stale) flDrawStale(E);
}
/* the words on a stale floor: "NOT READ SINCE 22:17 NEW YORK" (the time the page last read the desk, on the floor's clock), in the dim
   words' colour on a plate of the room's ground, where the session's banner would be — under it when it shows */
function flDrawStale(E) {
  const ctx = E.ctx;
  const L = E.L;
  const st = E.st;
  const key = `${st.stale.since}|${st.clock.zone}`;
  if (E.staleKey !== key) {
    E.staleKey = key;
    const when = flWhen(st.stale.since, st.clock.zone);
    E.staleTxt = when ? `NOT READ SINCE ${when} ${flZoneName(st.clock.zone, true)}` : "NOT READ LATELY";
  }
  const fs = L.fs.small;
  const fsz = flFitSize(E, E.staleTxt, L.w - 24, fs, 0.12, true, 500);
  if (!fsz) return;
  const font = flFont(E, fsz, true, 500);
  const w = flMeasure(E, font, E.staleTxt) * 1.12 + 24;
  const h = fsz + 12;
  const B = E.bannerAt;
  const y = B ? B.y + B.h + 6 : flBannerY(E, h);
  ctx.fillStyle = flC(E, "bg", 0.92);
  flRound(ctx, L.w / 2 - w / 2, y, w, h, 6);
  ctx.fill();
  ctx.strokeStyle = flC(E, "line");
  ctx.lineWidth = 1;
  ctx.stroke();
  flTrack(E, 0.12);
  flSetFont(E, font);
  ctx.fillStyle = flC(E, "dim");
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(E.staleTxt, L.w / 2, y + h / 2 + 0.5);
  flTrack(E, 0);
  ctx.textAlign = "left";
}
/* where a banner h tall sits: between the back row's names and the front row's heads */
function flBannerY(E, h) {
  const L = E.L;
  const k = L.k;
  const back = L.seats.risk;
  const front = L.seats.watch;
  const gapTop = back.y + 8 * back.s + L.fs.label * 2.4;
  const gapBot = front.y - front.char.h * 1.1;
  return Math.max(L.wallBase + 6 * k, (gapTop + gapBot) / 2 - h / 2);
}
/* the fixtures' and the seats' own lights: the rack's LEDs and words, the trophy's fill and figure, the shredder's count, each seat's
   label, thought and stamp, the tray's words */
function flDrawSelfLit(E, t, px, py) {
  const ctx = E.ctx;
  const L = E.L;
  ctx.save();
  ctx.translate(px * 0.35, py * 0.35);
  flDrawRack(E, t, 1);
  flDrawTrophy(E, t, 1);
  flDrawShredder(E, t, 1);
  flRestore(E);
  for (const role of L.order) {
    const f = L.seats[role].layer === "back" ? 0.7 : 1;
    ctx.save();
    ctx.translate(px * f, py * f);
    flDrawStationLive(E, role, t);
    flRestore(E);
  }
  ctx.save();
  ctx.translate(px, py);
  flDrawTray(E, t, 1);
  flRestore(E);
}
function flDrawWall(E) {
  const ctx = E.ctx;
  const L = E.L;
  const ly = E.layers;
  if (ly.wall) ctx.drawImage(ly.wall, -ly.B, -ly.B, L.w + ly.B * 2, L.wallBase + ly.B * 2);
  else {
    ctx.fillStyle = flC(E, "wallHi");
    ctx.fillRect(-12, -12, L.w + 24, L.wallBase + 12);
  }
}
function flDrawFloor(E) {
  const ctx = E.ctx;
  const L = E.L;
  const ly = E.layers;
  if (ly.floor) ctx.drawImage(ly.floor, -ly.B, L.wallBase - ly.B, L.w + ly.B * 2, L.h - L.wallBase + ly.B * 2);
  else {
    ctx.fillStyle = flC(E, "floorBack");
    ctx.fillRect(-12, L.wallBase, L.w + 24, L.h - L.wallBase + 12);
  }
}
/* the ticker tape: the state's items scrolling left at a constant speed, end to end, the ends fading into the wall; no items, no tape —
   it says so */
function flDrawTicker(E) {
  const ctx = E.ctx;
  const L = E.L;
  const r = L.ticker;
  const tk = E.tk;
  ctx.fillStyle = flC(E, "bg", 0.85);
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = flC(E, "line");
  ctx.lineWidth = 1 / E.dpr;
  ctx.beginPath();
  const y0 = flSnap(r.y, E.dpr, 1 / E.dpr);
  const y1 = flSnap(r.y + r.h, E.dpr, 1 / E.dpr);
  ctx.moveTo(r.x, y0);
  ctx.lineTo(r.x + r.w, y0);
  ctx.moveTo(r.x, y1);
  ctx.lineTo(r.x + r.w, y1);
  ctx.stroke();
  ctx.textBaseline = "middle";
  const cy = r.y + r.h / 2 + 0.5;
  if (!tk.items.length || !(tk.loopW > 0)) {
    flSetFont(E, flFont(E, L.fs.tiny, true, 500));
    ctx.fillStyle = flC(E, "dim");
    ctx.textAlign = "center";
    ctx.fillText("No quotes read yet", r.x + r.w / 2, cy);
    ctx.textAlign = "left";
    return;
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  flSetFont(E, tk.font);
  ctx.textAlign = "left";
  let x = r.x - tk.off;
  let i = 0;
  let guard = 0;
  // the items now showing, loop after loop, until the boundary where the waiting tape begins
  let src = tk.items;
  let left = tk.pending ? tk.swapLoops * tk.items.length : -1;
  while (x < r.x + r.w && guard++ < 400) {
    if (left === 0) {
      src = tk.pending.items;
      i = 0;
      left = -1;
    }
    const it = src[i];
    if (x + it.w > r.x) {
      ctx.fillStyle = it.dir === "up" ? flC(E, "up") : it.dir === "down" ? flC(E, "down") : flC(E, "dim");
      ctx.fillText(it.text, x, cy);
    }
    x += it.w;
    ctx.fillStyle = flC(E, "mint", 0.3);
    ctx.fillRect(x + tk.gap / 2 - 1, cy - 1, 2, 2);
    x += tk.gap;
    i = (i + 1) % src.length;
    if (left > 0) left--;
  }
  flRestore(E);
  // the ends fade into the wall
  const fw = Math.min(60 * L.k, r.w * 0.08);
  if (!E.tkFade || E.tkFade.w !== fw || E.tkFade.x !== r.x) {
    const a = ctx.createLinearGradient(r.x, 0, r.x + fw, 0);
    a.addColorStop(0, flC(E, "bg"));
    a.addColorStop(1, flC(E, "bg", 0));
    const b = ctx.createLinearGradient(r.x + r.w - fw, 0, r.x + r.w, 0);
    b.addColorStop(0, flC(E, "bg", 0));
    b.addColorStop(1, flC(E, "bg"));
    E.tkFade = { a, b, w: fw, x: r.x };
  }
  ctx.fillStyle = E.tkFade.a;
  ctx.fillRect(r.x, r.y + 1, fw, r.h - 2);
  ctx.fillStyle = E.tkFade.b;
  ctx.fillRect(r.x + r.w - fw, r.y + 1, fw, r.h - 2);
}
/* the New York clock: split-flap cells, each digit folding over when it changes (a top flap falling, then the bottom unfolding) */
function flDrawClock(E, t) {
  const ctx = E.ctx;
  const L = E.L;
  const r = L.clock;
  const text = E.clock.text;
  flRound(ctx, r.x, r.y, r.w, r.h, 6 * L.k);
  ctx.fillStyle = flC(E, "surface");
  ctx.fill();
  ctx.strokeStyle = flC(E, "line");
  ctx.lineWidth = 1;
  ctx.stroke();
  const zone = E.st.clock.zone;
  if (E.clock.zone !== zone) {
    E.clock.zone = zone;
    E.clock.label = flZoneName(zone, true);
  }
  const top = r.y + Math.max(3, r.h * 0.08);
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  // the label stepped down to fit the clock's face; where it does not fit even at the least (a phone's clock), the digits take its room
  const lfs = flFitLabel(E, E.clock.label, r.x + 6 * L.k, top, r.w - 8 * L.k, L.fs.tiny, 0.7);
  if (!text) return;
  const pad = 5 * L.k;
  const ch = r.h - (top - r.y) - lfs - pad * 1.6;
  const wide = (r.w - pad * 2) / 8.4 >= 8;
  const digits = text;
  const nCells = wide ? text.length : Math.min(4, text.length);
  const colon = 0.5;
  const cw = (r.w - pad * 2) / (nCells + (nCells / 2 - 1) * colon + (nCells - 1) * 0.12);
  const cy = top + lfs + pad * 0.6;
  const cells = E.clock.cells;
  let x = r.x + pad;
  const font = flFont(E, Math.max(FL_MIN_TEXT, Math.round(Math.min(ch * 0.74, cw * 1.25))), true, 500);
  flSetFont(E, font);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < nCells; i++) {
    const c = cells[i] || (cells[i] = { ch: "", prev: "", at: -1e9 });
    const d = digits[i];
    if (c.ch !== d) {
      c.prev = c.ch || d;
      c.ch = d;
      c.at = t;
    }
    const p = E.instant || E.still ? 1 : flClamp((t - c.at) / 280, 0, 1);
    flFlapCell(E, x, cy, cw, ch, c.prev, d, p);
    x += cw * 1.12;
    if (i % 2 === 1 && i < nCells - 1) {
      ctx.fillStyle = flC(E, "mint", 0.55);
      const dot = Math.max(1.2, cw * 0.09);
      ctx.fillRect(x + cw * colon * 0.5 - dot / 2 - cw * 0.06, cy + ch * 0.3 - dot / 2, dot, dot);
      ctx.fillRect(x + cw * colon * 0.5 - dot / 2 - cw * 0.06, cy + ch * 0.7 - dot / 2, dot, dot);
      x += cw * colon;
    }
  }
  ctx.textAlign = "left";
}
/* one half of a flap cell: the upper or the lower half of a digit, folded to scale about the hinge, shaded as it turns */
function flFlapHalf(E, x, y, w, h, digit, upper, scale, shade) {
  const ctx = E.ctx;
  const mid = y + h / 2;
  ctx.save();
  ctx.beginPath();
  if (upper) ctx.rect(x, y, w, h / 2);
  else ctx.rect(x, mid, w, h / 2);
  ctx.clip();
  if (scale !== 1) {
    ctx.translate(0, mid);
    ctx.scale(1, Math.max(0.001, scale));
    ctx.translate(0, -mid);
  }
  flRound(ctx, x, y, w, h, Math.min(3, w * 0.18));
  ctx.fillStyle = flC(E, "bg");
  ctx.fill();
  ctx.fillStyle = flC(E, "text");
  ctx.fillText(digit, x + w / 2, mid + 0.5);
  if (shade > 0) {
    ctx.fillStyle = flC(E, "shadow", shade);
    ctx.fillRect(x, y, w, h);
  }
  flRestore(E);
}
function flFlapCell(E, x, y, w, h, prev, next, p) {
  const ctx = E.ctx;
  const mid = y + h / 2;
  if (p >= 1) {
    flFlapHalf(E, x, y, w, h, next, true, 1, 0);
    flFlapHalf(E, x, y, w, h, next, false, 1, 0);
  } else {
    flFlapHalf(E, x, y, w, h, next, true, 1, 0);
    flFlapHalf(E, x, y, w, h, prev, false, 1, 0);
    if (p < 0.5) flFlapHalf(E, x, y, w, h, prev, true, 1 - p * 2, p * 0.6);
    else flFlapHalf(E, x, y, w, h, next, false, p * 2 - 1, (1 - p) * 0.6);
  }
  // the hinge
  ctx.fillStyle = flC(E, "shadow", 0.7);
  ctx.fillRect(x, mid - 0.5, w, 1);
}
/* the brain's rack: a cabinet with twelve LEDs; one lit (mint, glowing) per brain call under way, the rest blinking dimly as idle LEDs do
   (decor, kept far below a lit one); under it the brain's state in words */
function flDrawRack(E, t, pass) {
  const ctx = E.ctx;
  const L = E.L;
  const r = L.rack;
  const k = L.k;
  const side = 9 * k;
  const cols = 2;
  const rows = FL_RACK_LEDS / cols;
  const ledR = Math.max(1.4, Math.min(r.w * 0.06, 3.2 * k));
  const led = E.led || (E.led = { x: 0, y: 0 });
  const ledAt = flLedAt;
  if (pass === 0) {
    // the side face, the top, the front
    ctx.fillStyle = flC(E, "deskFront");
    ctx.beginPath();
    ctx.moveTo(r.x + r.w, r.y);
    ctx.lineTo(r.x + r.w + side, r.y - side * 0.6);
    ctx.lineTo(r.x + r.w + side, r.y + r.h - side * 0.6);
    ctx.lineTo(r.x + r.w, r.y + r.h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = flC(E, "deskTop");
    ctx.beginPath();
    ctx.moveTo(r.x, r.y);
    ctx.lineTo(r.x + side, r.y - side * 0.6);
    ctx.lineTo(r.x + r.w + side, r.y - side * 0.6);
    ctx.lineTo(r.x + r.w, r.y);
    ctx.closePath();
    ctx.fill();
    flRound(ctx, r.x, r.y, r.w, r.h, 3 * k);
    ctx.fillStyle = flC(E, "surface");
    ctx.fill();
    ctx.strokeStyle = flC(E, "line");
    ctx.lineWidth = 1;
    ctx.stroke();
    // the bays
    ctx.strokeStyle = flC(E, "mint", 0.07);
    for (let i = 1; i < rows; i++) {
      const y = flSnap(r.y + r.h * 0.12 + i * ((r.h * 0.62) / rows) - (r.h * 0.62) / rows / 2, E.dpr);
      ctx.beginPath();
      ctx.moveTo(r.x + 3 * k, y);
      ctx.lineTo(r.x + r.w - 3 * k, y);
      ctx.stroke();
    }
    for (let i = 0; i < FL_RACK_LEDS; i++) {
      const p = ledAt(r, i, cols, rows, led);
      ctx.fillStyle = flC(E, "bg");
      ctx.beginPath();
      ctx.arc(p.x, p.y, ledR + 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }
  // the LEDs: one per brain call under way (or per mascot thinking, whichever is more)
  let thinking = 0;
  for (const role of FL_ROLES) if (E.chars[role].think) thinking++;
  const lit = Math.min(FL_RACK_LEDS, Math.max(E.st.inFlight, thinking));
  for (let i = 0; i < FL_RACK_LEDS; i++) {
    const p = ledAt(r, i, cols, rows, led);
    if (i < lit) {
      ctx.globalCompositeOperation = "lighter";
      flGlow(E, "mint", p.x, p.y, ledR * 5, 0.75);
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = flC(E, "mint");
    } else {
      const idle = E.instant ? 0.1 : 0.08 + 0.1 * (0.5 + 0.5 * Math.sin(t * 0.0011 + i * 1.7 + (i % 3) * 2.1));
      ctx.fillStyle = flC(E, "mint", idle);
    }
    ctx.beginPath();
    ctx.arc(p.x, p.y, ledR, 0, Math.PI * 2);
    ctx.fill();
  }
  // the words: the brain, and what it is doing or why it cannot
  const RB = flRackWordsBox(E);
  const ww = RB.w;
  const lx = RB.x + ww / 2;
  let ly = RB.y;
  flTrack(E, 0.12);
  flSetFont(E, flFont(E, L.fs.tiny, true, 500));
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = flC(E, "mint", 0.7);
  ctx.fillText("BRAIN", lx, ly);
  ly += L.fs.tiny + 3;
  flTrack(E, 0);
  const b = E.st.brain;
  const font = flFont(E, L.fs.tiny, true, 400);
  // the words wrapped only when what they say changes (the calls under way, the brain read anew), not per frame
  const RW = E.rackW;
  if (RW.lit !== lit || RW.brain !== b || RW.font !== font || RW.ww !== ww) {
    let line = "";
    RW.col = "dim";
    if (lit > 0) {
      line = `${lit} call${lit === 1 ? "" : "s"} under way`;
      RW.col = "mint";
    } else line = flBrainWord(b); // a few words, never a sentence cut off: the page's header says how to fix it
    RW.lit = lit;
    RW.brain = b;
    RW.font = font;
    RW.ww = ww;
    RW.lines = line ? flWrap(line, ww, (s) => flMeasure(E, font, s), 2) : [];
  }
  if (RW.lines.length) {
    flSetFont(E, font);
    const lines = RW.lines;
    ctx.fillStyle = flC(E, RW.col);
    for (const ln of lines) {
      ctx.fillText(ln, lx, ly);
      ly += L.fs.tiny + 2;
    }
  }
  ctx.textAlign = "left";
}
/* where the rack's words hang: centred under the rack, kept on the canvas, three lines tall at the most (the scan's nodes and caption
   keep clear of it). One object kept for it */
function flRackWordsBox(E) {
  const L = E.L;
  const r = L.rack;
  const B = E.rackBox || (E.rackBox = { x: 0, y: 0, w: 0, h: 0 });
  const ww = Math.max(70, r.w * 1.9);
  const lx = flClamp(r.x + r.w / 2, ww / 2 + 4, L.w - ww / 2 - 4);
  B.x = lx - ww / 2;
  B.y = r.y + r.h * 0.8;
  B.w = ww;
  B.h = L.fs.tiny * 3 + 7;
  return B;
}
/* where the rack's LED i sits, written into out */
function flLedAt(r, i, cols, rows, out) {
  const c = i % cols;
  const row = Math.floor(i / cols);
  out.x = r.x + r.w * (0.36 + c * 0.32);
  out.y = r.y + r.h * 0.12 + row * ((r.h * 0.62) / rows);
  return out;
}
/* the trophy: a glass on a pedestal filled to the target's real progress, its meniscus catching the light; the figure on the pedestal */
function flDrawTrophy(E, t, pass) {
  const ctx = E.ctx;
  const L = E.L;
  const r = L.trophy;
  const k = L.k;
  const ped = { x: r.x + r.w * 0.08, y: r.y + r.h * 0.62, w: r.w * 0.84, h: r.h * 0.38 };
  const cx = r.x + r.w / 2;
  const bowlTop = r.y + r.h * 0.06;
  const bowlBot = r.y + r.h * 0.4;
  const bw = r.w * (L.narrow ? 0.4 : 0.46);
  const level = E.trophy.x;
  const ly = bowlBot - (bowlBot - bowlTop) * level;
  if (pass === 0) {
    // the pedestal
    const side = 7 * k;
    ctx.fillStyle = flC(E, "deskTop");
    ctx.beginPath();
    ctx.moveTo(ped.x, ped.y);
    ctx.lineTo(ped.x + side, ped.y - side * 0.55);
    ctx.lineTo(ped.x + ped.w + side, ped.y - side * 0.55);
    ctx.lineTo(ped.x + ped.w, ped.y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = flC(E, "deskFront");
    ctx.beginPath();
    ctx.moveTo(ped.x + ped.w, ped.y);
    ctx.lineTo(ped.x + ped.w + side, ped.y - side * 0.55);
    ctx.lineTo(ped.x + ped.w + side, ped.y + ped.h - side * 0.55);
    ctx.lineTo(ped.x + ped.w, ped.y + ped.h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = flC(E, "surface");
    ctx.fillRect(ped.x, ped.y, ped.w, ped.h);
    ctx.strokeStyle = flC(E, "line");
    ctx.lineWidth = 1;
    ctx.strokeRect(ped.x, ped.y, ped.w, ped.h);
    // the stem and the foot
    ctx.fillStyle = flC(E, "mint", 0.18);
    ctx.fillRect(cx - r.w * 0.04, bowlBot, r.w * 0.08, ped.y - bowlBot - 4 * k);
    ctx.beginPath();
    ctx.ellipse(cx, ped.y - 3 * k, r.w * 0.24, 3.5 * k, 0, 0, Math.PI * 2);
    ctx.fill();
    // the handles
    ctx.strokeStyle = flC(E, "text", 0.35);
    ctx.lineWidth = Math.max(1, 1.4 * k);
    ctx.beginPath();
    ctx.arc(cx - bw, bowlTop + (bowlBot - bowlTop) * 0.32, (bowlBot - bowlTop) * 0.22, Math.PI * 0.5, Math.PI * 1.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + bw, bowlTop + (bowlBot - bowlTop) * 0.32, (bowlBot - bowlTop) * 0.22, -Math.PI * 0.5, Math.PI * 0.5);
    ctx.stroke();
    // the glass
    flBowl(ctx, cx, bw, bowlTop, bowlBot);
    ctx.fillStyle = flC(E, "mint", 0.05);
    ctx.fill();
    return;
  }
  // the fill: mint to the real progress, the meniscus at its top
  if (level > 0.002) {
    ctx.save();
    flBowl(ctx, cx, bw, bowlTop, bowlBot);
    ctx.clip();
    ctx.fillStyle = flC(E, "mint", 0.5);
    ctx.fillRect(cx - bw - 2, ly, bw * 2 + 4, bowlBot - ly + 2);
    ctx.fillStyle = flC(E, "mint", 0.25);
    ctx.fillRect(cx - bw - 2, ly + (bowlBot - ly) * 0.5, bw * 2 + 4, (bowlBot - ly) * 0.5 + 2);
    // the meniscus: a bright line, and a glint travelling along it (decor, at the real level)
    const frac = (ly - bowlTop) / (bowlBot - bowlTop);
    const half = bw * Math.sqrt(Math.max(0.02, 1 - Math.pow(frac, 2.2)));
    ctx.fillStyle = flC(E, "mint", 0.95);
    ctx.fillRect(cx - half, ly - 0.5, half * 2, Math.max(1, 1.2 * k));
    if (!E.instant) {
      const gx = cx + Math.sin(t * 0.0017) * half * 0.75;
      ctx.globalCompositeOperation = "lighter";
      flGlow(E, "mint", gx, ly, 6 * k, 0.8);
      ctx.globalCompositeOperation = "source-over";
    }
    flRestore(E);
    if (level >= 0.999) {
      ctx.globalCompositeOperation = "lighter";
      flGlow(E, "mint", cx, (bowlTop + bowlBot) / 2, bw * 2.2, 0.35);
      ctx.globalCompositeOperation = "source-over";
    }
  }
  flBowl(ctx, cx, bw, bowlTop, bowlBot);
  ctx.strokeStyle = flC(E, "text", 0.55);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.strokeStyle = flC(E, "text", 0.3);
  ctx.beginPath();
  ctx.moveTo(cx - bw * 0.62, bowlTop + 3 * k);
  ctx.quadraticCurveTo(cx - bw * 0.68, bowlTop + (bowlBot - bowlTop) * 0.55, cx - bw * 0.3, bowlBot - 3 * k);
  ctx.stroke();
  // The words, centred on the pedestal: how far the desk has come toward its target, the figure first and "OF TARGET" under it —
  // "−0.2% / OF TARGET", "42.0% / OF TARGET". The state's figure is progress (desk.ts target.progressPct: the change since the start as
  // a share of the target's dollars), not the target: written under a "TARGET" label it read as a target of −0.2% beside the header's
  // "Target +3%". The glass's fill carries the same progress. They may reach past the pedestal toward the screen and the shredder (a
  // phone's pedestal is narrow): the figure centred on it, the label centred under it where it fits so, else moved toward the screen
  // as far as it must, never past the screen's bezel or onto the shredder; where "OF TARGET" does not fit that room even at the least
  // size, "OF GOAL" (a phone's floor), else no label and the figure alone
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const room = Math.max(ped.w + 6 * k, 2 * Math.min(L.shredder.x - 3 - cx, cx - (L.screen.x + L.screen.w + 8 * k)));
  const tg = E.st.target;
  // the figure written once per value, its size stepped down until it fits the pedestal (a phone's pedestal is narrow)
  const v = tg ? Math.round(tg.progressPct * 10) / 10 : NaN;
  if (E.tgTxt === undefined || E.tgV !== v) {
    E.tgV = v;
    E.tgTxt = Number.isFinite(v) ? `${v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%` : "—";
  }
  const top = ped.y + ped.h * 0.14;
  const ffs = flFitSize(E, E.tgTxt, room, L.fs.small + 1, 0, true, 500);
  if (ffs) {
    flSetFont(E, flFont(E, ffs, true, 500));
    ctx.fillStyle = !Number.isFinite(v) ? flC(E, "dim") : v < 0 ? flC(E, "down") : flC(E, "mint");
    ctx.fillText(E.tgTxt, ped.x + ped.w / 2, top);
  }
  const lo = L.screen.x + L.screen.w + 8 * k;
  const hi = L.shredder.x - 3;
  const track = L.narrow ? 0.02 : 0.12;
  for (const say of FL_SAY_TARGET) {
    const lfs = flFitSize(E, say, Math.max(room, hi - lo), L.fs.tiny, track, true, 500);
    if (!lfs) continue;
    const lfont = flFont(E, lfs, true, 500);
    const half = (flMeasure(E, lfont, say) * (1 + track)) / 2;
    flTrack(E, track);
    flSetFont(E, lfont);
    ctx.fillStyle = flC(E, "mint", 0.7);
    ctx.fillText(say, flClamp(ped.x + ped.w / 2, lo + half, Math.max(lo + half, hi - half)), top + (ffs || L.fs.small + 1) + 3);
    flTrack(E, 0);
    break;
  }
  ctx.textAlign = "left";
}
/* the trophy's glass: a bowl from its rim down to its foot */
function flBowl(ctx, cx, bw, top, bot) {
  ctx.beginPath();
  ctx.moveTo(cx - bw, top);
  ctx.bezierCurveTo(cx - bw, top + (bot - top) * 0.75, cx - bw * 0.35, bot, cx, bot);
  ctx.bezierCurveTo(cx + bw * 0.35, bot, cx + bw, top + (bot - top) * 0.75, cx + bw, top);
  ctx.closePath();
}
/* the shredder: the count of rejected leads (the state's), its teeth turning while it chews, the last reject's lead and why for five
   seconds */
function flDrawShredder(E, t, pass) {
  const ctx = E.ctx;
  const L = E.L;
  const r = L.shredder;
  const k = L.k;
  const chewing = !E.instant && t < E.shred.chewUntil;
  if (pass === 0) {
    const side = 7 * k;
    ctx.fillStyle = flC(E, "deskTop");
    ctx.beginPath();
    ctx.moveTo(r.x, r.y);
    ctx.lineTo(r.x - side * 0.4, r.y - side * 0.6);
    ctx.lineTo(r.x + r.w - side * 0.4, r.y - side * 0.6);
    ctx.lineTo(r.x + r.w, r.y);
    ctx.closePath();
    ctx.fill();
    flRound(ctx, r.x, r.y, r.w, r.h * 0.86, 3 * k);
    ctx.fillStyle = flC(E, "surface");
    ctx.fill();
    ctx.strokeStyle = flC(E, "line");
    ctx.lineWidth = 1;
    ctx.stroke();
    // the slot
    ctx.fillStyle = flC(E, "shadow", 0.9);
    ctx.fillRect(r.x + r.w * 0.16, r.y + 3 * k, r.w * 0.68, Math.max(2, 3 * k));
    // the teeth: a zigzag that runs while it chews
    const ty = r.y + r.h * 0.86;
    const tw = Math.max(3, 5 * k);
    const shift = chewing ? (t * 0.06) % tw : 0;
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x + 2 * k, ty - 1, r.w - 4 * k, 6 * k);
    ctx.clip();
    ctx.strokeStyle = flC(E, "mint", chewing ? 0.6 : 0.28);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = r.x - tw + shift, i = 0; x < r.x + r.w + tw; x += tw / 2, i++) {
      const y = ty + (i % 2 ? 4 * k : 0);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    flRestore(E);
    return;
  }
  // the words, centred in the room between the trophy and the canvas's edge (the shredder's own middle, but for a pixel or two): a
  // phone's shredder is narrower than its word
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const lo = L.trophy.x + L.trophy.w + 3;
  const hi = L.w - 2;
  const mid = (lo + hi) / 2;
  const room = Math.max(r.w + 4 * k, hi - lo);
  flFitLabel(E, FL_SAY_REJECTED, mid, r.y + r.h * 0.2, room, L.fs.tiny, 0.7, L.narrow ? 0.02 : 0.12);
  // the rejects the shredder has taken: the state's count less those still in line or in the air (it counts a reject once it is in)
  const rjAll = E.st.rejected;
  const rj = Number.isFinite(rjAll) ? Math.max(0, rjAll - flRejectsWaiting(E)) : rjAll;
  if (E.rjTxt === undefined || !Object.is(E.rjV, rj)) {
    E.rjV = rj;
    E.rjTxt = Number.isFinite(rj) ? String(rj) : "—";
  }
  const cfs = flFitSize(E, E.rjTxt, room, Math.round(L.fs.small * 1.6), 0, true, 500);
  if (cfs) {
    flSetFont(E, flFont(E, cfs, true, 500));
    ctx.fillStyle = flC(E, "text");
    ctx.fillText(E.rjTxt, mid, r.y + r.h * 0.2 + L.fs.tiny + 4);
  }
  // the last reject's why, beside the shredder for five seconds (wrapped once per reject)
  const age = t - E.shred.whyAt;
  if (E.shred.why && age < 5000) {
    const font = flFont(E, L.fs.tiny, true, 400);
    const ww = Math.max(90, L.w * 0.13);
    if (!E.shred.lines || E.shred.ww !== ww || E.shred.font !== font) {
      E.shred.lines = flWrap(E.shred.why, ww, (s) => flMeasure(E, font, s), 3);
      E.shred.ww = ww;
      E.shred.font = font;
    }
    const lines = E.shred.lines;
    const a = E.instant ? 1 : age < 200 ? age / 200 : age > 4400 ? (5000 - age) / 600 : 1;
    flSetFont(E, font);
    ctx.textAlign = "right";
    ctx.globalAlpha = a;
    let y = r.y + r.h + 6 * k;
    for (const ln of lines) {
      ctx.fillStyle = flC(E, "down");
      ctx.fillText(ln, r.x + r.w, y);
      y += L.fs.tiny + 3;
    }
    ctx.globalAlpha = 1;
  }
  ctx.textAlign = "left";
}
/* the owner's tray at the front edge, in words that say what is true of it: amber "1 WAITS FOR YOU" / "3 WAIT FOR YOU" while the owner's
   cards from this desk's seats wait (amber is what waits), else dim "AUTO ON PAPER · NO CARDS" while the desk places its own paper
   orders, or "NO CARD WAITING"; "YOUR TRAY" where the state does not say. One line where it fits the gap between the Sentiment and the
   Watch seats' words, else two, never under FL_MIN_WORDS — where even two do not fit, only the count of what waits. Where no words fit
   and no card waits (a phone's floor, the gap between the seats' words narrower than "NO CARD"), no tray is drawn at all: an empty box
   with no words read as decor, and there is nothing in it to pick. It comes back the moment a card waits (the amber count fits where
   the words do not) or a slip lands in it. Laid out once per state and size (flTrayLay); the box is sized to its words and centred in
   the gap. Pure: the words for a count, the autonomy, and whether the count is known */
function flTrayWords(cards, autonomy) {
  if (cards === null || cards === undefined || !Number.isFinite(Number(cards))) return { one: "YOUR TRAY", two: ["YOUR", "TRAY"], col: "dim", count: "" };
  const n = Math.max(0, Math.floor(Number(cards)));
  if (n > 0) {
    const verb = n === 1 ? "WAITS" : "WAIT";
    return { one: `${n} ${verb} FOR YOU`, two: [`${n} ${verb}`, "FOR YOU"], col: "warn", count: String(n) };
  }
  if (autonomy) return { one: "AUTO ON PAPER · NO CARDS", two: ["AUTO ON PAPER", "NO CARDS"], col: "dim", count: "" };
  return { one: "NO CARD WAITING", two: ["NO CARD", "WAITING"], col: "dim", count: "" };
}
const FL_TRAY_TRACK = 0.08;
function flTrayLay(E) {
  const L = E.L;
  if (!L) return;
  const words = flTrayWords(E.st.cards, E.st.autonomy);
  const sen = E.labels.sentiment;
  const wat = E.labels.watch;
  // the gap the tray may take: between the two seats' words as drawn, else the layout's
  const x0 = sen ? Math.max(L.tray.gapX0 - 4, sen.x1 + 6) : L.tray.gapX0;
  const x1 = wat ? Math.min(Math.max(L.tray.gapX1 + 4, x0 + 24), wat.x0 - 6) : L.tray.gapX1;
  const room = Math.max(0, x1 - x0);
  const fs = FL_MIN_WORDS;
  const font = flFont(E, fs, true, 500);
  const w = (t) => flMeasure(E, font, t) * (1 + FL_TRAY_TRACK);
  const pad = 8;
  let lines = [];
  if (w(words.one) + pad * 2 <= room) lines = [words.one];
  else if (Math.max(w(words.two[0]), w(words.two[1])) + pad * 2 <= room) lines = words.two;
  else if (words.count && w(words.count) + pad <= room) lines = [words.count];
  let tw = 0;
  for (const ln of lines) tw = Math.max(tw, w(ln));
  const bevel = Math.max(4, 6 * L.k);
  const bw = flClamp(Math.max(tw + pad * 2, Math.min(L.tray.w, room)), 24, Math.max(24, room));
  const bh = bevel + (lines.length ? lines.length * (fs + 3) + 6 : Math.max(10, L.tray.h - bevel));
  const cx = flClamp(L.tray.cx, x0 + bw / 2, Math.max(x0 + bw / 2, x1 - bw / 2));
  const bottom = L.tray.bottom;
  const T = E.tray || (E.tray = { x: 0, y: 0, w: 0, h: 0, bevel: 0, lines: [], fs: 0, font: "", col: "dim", bare: false });
  T.x = cx - bw / 2;
  T.y = bottom - bh;
  T.w = bw;
  T.h = bh;
  T.bevel = bevel;
  T.lines = lines;
  T.fs = fs;
  T.font = font;
  T.col = words.col;
  // no words fit and none waits: not drawn, not picked, not a place a bubble keeps clear of (flTrayShown)
  T.bare = !lines.length && words.col !== "warn";
}
/* whether the owner's tray is on the floor this frame: laid out, and saying something — its words, or the amber of a card waiting — or
   holding a slip that landed (a card's packet flies to where the tray stands even while it is bare, and the tray shows to catch it) */
function flTrayShown(E) {
  const T = E.tray;
  if (!T) return false;
  if (!T.bare) return true;
  for (const s of E.slips) if (s.on) return true;
  return false;
}
function flDrawTray(E, t, pass) {
  const ctx = E.ctx;
  const L = E.L;
  const r = E.tray;
  if (!r || !flTrayShown(E)) return;
  const k = L.k;
  const front = r.y + r.bevel;
  const waits = r.col === "warn";
  if (pass === 0) {
    ctx.fillStyle = flC(E, "deskTop");
    ctx.beginPath();
    ctx.moveTo(r.x, front);
    ctx.lineTo(r.x + Math.min(8 * k, r.w * 0.2), r.y);
    ctx.lineTo(r.x + r.w - Math.min(8 * k, r.w * 0.2), r.y);
    ctx.lineTo(r.x + r.w, front);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = flC(E, "deskFront");
    ctx.fillRect(r.x, front, r.w, r.y + r.h - front);
    ctx.strokeStyle = waits ? flC(E, "warn", 0.45) : flC(E, "line");
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x, front, r.w, r.y + r.h - front);
    return;
  }
  // the slips that landed, newest on top (ordered in an array kept for it, not made per frame); each kept while its card waits
  const live = E.slipOrder;
  live.length = 0;
  for (const s of E.slips) if (s.on) live.push(s);
  live.sort(flByT0);
  for (let i = 0; i < live.length; i++) {
    const s = live[i];
    const age = t - s.t0;
    ctx.globalAlpha = flClamp(s.a, 0, 1);
    const sw = 34 * k;
    const sh = Math.max(12 * k, FL_MIN_TEXT + 4);
    const x = r.x + r.w / 2 - sw / 2 + (i - (live.length - 1) / 2) * 10 * k;
    const y = r.y - sh * 0.55 - i * 2 * k;
    flRound(ctx, x, y, sw, sh, 2 * k);
    ctx.fillStyle = flC(E, "text", 0.92);
    ctx.fill();
    const sfs = flFitSize(E, s.label, sw - 4, L.fs.tiny, 0, true, 500);
    if (sfs) {
      flSetFont(E, flFont(E, sfs, true, 500));
      ctx.fillStyle = flC(E, "ink");
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(s.label, x + sw / 2, y + sh / 2 + 0.5);
    }
    if (age < 1600 && !E.instant) {
      ctx.globalCompositeOperation = "lighter";
      flGlow(E, "warn", x + sw / 2, y + sh / 2, sw, 0.4 * (1 - age / 1600));
      ctx.globalCompositeOperation = "source-over";
    }
  }
  ctx.globalAlpha = 1;
  // a pointer over the tray: an outline in the accent, for it can be picked
  if (E.hover && E.hover.tray) {
    ctx.strokeStyle = flC(E, "mint", 0.85);
    ctx.lineWidth = 1.5;
    flRound(ctx, r.x - 2, r.y - 2, r.w + 4, r.h + 4, 3);
    ctx.stroke();
  }
  if (!r.lines.length) return;
  flTrack(E, FL_TRAY_TRACK);
  flSetFont(E, r.font);
  ctx.fillStyle = flC(E, r.col);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lh = r.fs + 3;
  const mid = front + (r.y + r.h - front) / 2;
  for (let i = 0; i < r.lines.length; i++) ctx.fillText(r.lines[i], r.x + r.w / 2, mid + (i - (r.lines.length - 1) / 2) * lh + 0.5);
  flTrack(E, 0);
  ctx.textAlign = "left";
}
/* the slips in the tray: while the state counts the owner's cards waiting, the newest that many stay (a slip is kept while its card
   waits, however long) and the rest fade out in 600 ms; where it does not count them, each fades from ten seconds after it landed. A
   still frame lets a slip that is not kept go at once */
function flStepSlips(E, t) {
  const cards = E.st.cards;
  for (const s of E.slips) {
    if (!s.on) continue;
    let rank = 0;
    for (const o of E.slips) if (o.on && o !== s && o.t0 > s.t0) rank++;
    if (cards === null) {
      s.a = t - s.t0 < 10_000 ? 1 : 1 - (t - s.t0 - 10_000) / 4000;
      if (E.instant && s.a > 0) s.a = 1;
    } else if (rank < cards) {
      s.goneAt = 0;
      s.a = 1;
    } else {
      if (!s.goneAt) s.goneAt = t;
      s.a = E.instant ? 0 : 1 - (t - s.goneAt) / 600;
    }
    if (s.a <= 0) s.on = false;
  }
}
/* by time, the oldest first */
function flByT0(a, b) {
  return a.t0 - b.t0;
}
/* by when a bubble opened, the oldest first */
function flByStart(a, b) {
  return a.start - b.start;
}

/* one station: the desk, its monitor and what the monitor shows, the mascot or its empty chair, the dish or the antenna of an outside
   seat */
function flDrawStation(E, role, t) {
  const ctx = E.ctx;
  const L = E.L;
  const s = L.seats[role];
  const seat = E.seatBy[role];
  const empty = flSeatOff(seat);
  const reading = seat.kind === "reading";
  const k = s.s;
  const d = s.desk;
  const sp = E.sprites;
  // shadows on the floor
  if (sp && sp.shadow) {
    ctx.drawImage(sp.shadow, d.x - d.w * 0.08, d.base - 8 * k, d.w * 1.16, 16 * k);
    if (!empty) ctx.drawImage(sp.shadow, s.char.x - s.char.w * 0.7, s.char.y - 5 * k, s.char.w * 1.4, 10 * k);
  }
  // the desk: its front, its top, the rim of light along its edge
  ctx.fillStyle = flC(E, "deskFront");
  ctx.fillRect(d.x, d.front, d.w, d.base - d.front);
  ctx.fillStyle = flC(E, "deskTop");
  ctx.beginPath();
  ctx.moveTo(d.x, d.front);
  ctx.lineTo(d.x + d.w, d.front);
  ctx.lineTo(d.x + d.w - d.inset, d.top);
  ctx.lineTo(d.x + d.inset, d.top);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = flC(E, "mint", 0.2);
  ctx.lineWidth = 1;
  ctx.beginPath();
  const ry = flSnap(d.front, E.dpr);
  ctx.moveTo(d.x, ry);
  ctx.lineTo(d.x + d.w, ry);
  ctx.stroke();
  // a keyboard
  ctx.fillStyle = flC(E, "deskFront", 0.9);
  flRound(ctx, d.cx - d.w * 0.26, d.top + d.dd * 0.55, d.w * 0.4, d.dd * 0.3, 1.5 * k);
  ctx.fill();
  // the monitor: stand, bezel, glass, and the role's view
  const m = s.mon;
  ctx.fillStyle = flC(E, "deskFront");
  ctx.fillRect(m.x + m.w / 2 - 2 * k, m.y + m.h, 4 * k, m.standY - m.y - m.h);
  flRound(ctx, m.x - 2 * k, m.y - 2 * k, m.w + 4 * k, m.h + 4 * k, 3 * k);
  ctx.fillStyle = flC(E, "deskFront");
  ctx.fill();
  flRound(ctx, m.x, m.y, m.w, m.h, 2 * k);
  ctx.fillStyle = flC(E, "glass");
  ctx.fill();
  if (empty) {
    // off: dark glass and a reflection
    ctx.strokeStyle = flC(E, "text", 0.06);
    ctx.lineWidth = 2 * k;
    ctx.beginPath();
    ctx.moveTo(m.x + m.w * 0.15, m.y + m.h * 0.9);
    ctx.lineTo(m.x + m.w * 0.55, m.y + m.h * 0.1);
    ctx.stroke();
  } else {
    const g = E.chars[role].glow.x;
    ctx.fillStyle = flC(E, "mint", 0.03 + 0.06 * g);
    ctx.fillRect(m.x, m.y, m.w, m.h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(m.x, m.y, m.w, m.h);
    ctx.clip();
    flDrawMonitor(E, role, seat, m, g, k);
    flRestore(E);
  }
  if (role === "flow") flDrawDish(E, s, !empty, t);
  if (role === "sentiment") flDrawAntenna(E, s, !empty, t);
  // the mascot, or the chair where it would sit; a seat not read yet: the chair and the mascot's outline, both dim
  if (reading) {
    ctx.globalAlpha = 0.45;
    flDrawChair(E, s);
    ctx.globalAlpha = 1;
    flDrawGhost(E, s);
  } else if (empty) flDrawChair(E, s);
  else flDrawMascot(E, role, seat, s, t);
}
/* a seat not read yet: the mascot's outline, dim and faceless, beside its chair — neither someone sitting there nor an empty seat */
function flDrawGhost(E, s) {
  const ctx = E.ctx;
  ctx.save();
  ctx.translate(s.char.x, s.char.y - 2 * s.s);
  flBlobPath(ctx, s.char.w, s.char.h);
  ctx.fillStyle = flC(E, "surface", 0.5);
  ctx.fill();
  ctx.strokeStyle = flC(E, "dim", 0.35);
  ctx.lineWidth = 1;
  ctx.stroke();
  flRestore(E);
}
/* what a seat's monitor shows, from the state only; a seat whose figure the state does not give says "—", and what is not known is never
   drawn as a figure (no stub bar for an unknown volume, no bar for an unknown P&L). A monitor's words fit its glass: their size stepped
   down to FL_MIN_TEXT, then said shorter (short), else not written — never cut at the glass's edge */
function flMonNote(E, txt, x, y, w, h, a, fs, show, short) {
  if (!show) return;
  let text = txt;
  let size = flFitSize(E, text, w - 2, fs, 0, true, 500);
  if (!size && short) {
    text = short;
    size = flFitSize(E, text, w - 2, fs, 0, true, 500);
  }
  if (!size || size + 2 > h) return;
  const ctx = E.ctx;
  flSetFont(E, flFont(E, size, true, 500));
  ctx.fillStyle = flC(E, "mint", 0.6 * a);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + w / 2, y + h / 2);
  ctx.textAlign = "left";
}
function flDrawMonitor(E, role, seat, m, g, k) {
  const ctx = E.ctx;
  const st = E.st;
  const pad = 3 * k;
  const x = m.x + pad;
  const y = m.y + pad;
  const w = m.w - pad * 2;
  const h = m.h - pad * 2;
  const a = 0.45 + 0.55 * g;
  // the monitor's words: never under FL_MIN_TEXT; a glass too small for them shows its bars and lines only
  const fs = Math.max(FL_MIN_TEXT, Math.round(7 * k));
  const showText = w > 26 && h > fs + 2;
  if (seat.status !== "ok") return flMonNote(E, seat.status === "not let in" ? "waits" : seat.status, x, y, w, h, a, fs, showText);
  if (role === "head") {
    // the funnel as the events have shown it: scanned, cleared, executed, closed — a count beside each bar where a row is tall enough
    // for its figure, else the four counts in one line under the bars, else the bars alone
    const f = E.show.funnel;
    if (!f) return flMonNote(E, "—", x, y, w, h, a, fs, showText);
    const vals = E.fun || (E.fun = [0, 0, 0, 0]);
    vals[0] = f.scanned;
    vals[1] = f.cleared;
    vals[2] = f.executed;
    vals[3] = f.closed;
    let top = 1;
    for (const v of vals) if (Number.isFinite(v) && v > top) top = v;
    const gap = Math.max(1, 1.5 * k);
    const font = flFont(E, fs, true, 500);
    const rowH = (h - gap * 3) / 4;
    let numW = 0;
    for (const v of vals) numW = Math.max(numW, flMeasure(E, font, Number.isFinite(v) ? flIntText(E, v) : "—"));
    const perRow = showText && rowH + gap >= fs + 1 && numW + 4 < w * 0.45;
    const line = !perRow && showText ? flFunnelLine(E, vals) : "";
    const under = !!line && h - fs - 2 >= 4 * 2 + 3 * gap && flMeasure(E, font, line) <= w;
    const barsH = under ? h - fs - 2 : h;
    const bh = (barsH - gap * 3) / 4;
    const textW = perRow ? numW + 4 : 0;
    for (let i = 0; i < 4; i++) {
      const v = vals[i];
      const bw = Number.isFinite(v) ? Math.max(1, (v / top) * (w - textW)) : 0;
      ctx.fillStyle = flC(E, "mint", (0.85 - i * 0.15) * a);
      if (bw > 0) ctx.fillRect(x, y + i * (bh + gap), bw, bh);
      if (perRow) {
        flSetFont(E, font);
        ctx.fillStyle = flC(E, "text", 0.85 * a);
        ctx.textBaseline = "middle";
        ctx.textAlign = "right";
        ctx.fillText(Number.isFinite(v) ? flIntText(E, v) : "—", x + w, y + i * (bh + gap) + bh / 2 + 0.5);
        ctx.textAlign = "left";
      }
    }
    if (under) {
      flSetFont(E, font);
      ctx.fillStyle = flC(E, "text", 0.85 * a);
      ctx.textBaseline = "bottom";
      ctx.textAlign = "left";
      ctx.fillText(line, x, y + h + 1);
    }
    return;
  }
  if (role === "search") {
    // the scan's rows' volume, as bars made once per scan as the events have shown it (flSearchBars): a row whose volume is not known
    // has no bar
    const bars = E.searchBars;
    if (!bars || !bars.length) return flMonNote(E, "no scan", x, y, w, h, a, fs, showText);
    const n = Math.min(bars.length, Math.max(4, Math.floor(w / (2.6 * k))));
    const bw = w / n;
    for (let i = 0; i < n; i++) {
      const b = bars[i];
      if (!Number.isFinite(b.f)) continue;
      const bh = b.f * h;
      ctx.fillStyle = flC(E, "mint", (b.picked ? 0.95 : 0.38) * a);
      ctx.fillRect(x + i * bw + bw * 0.15, y + h - bh, Math.max(0.8, bw * 0.7), bh);
    }
    return;
  }
  if (role === "risk") {
    // the spread gauge against the desk's own spread line (checks.maxSpreadPct), the line at the top, beyond it in coral; with no line
    // given, no line is drawn and the reading is not judged: the arc plain, the needle on a scale to 1.2 %
    const ck = st.checks;
    const line = ck && Number.isFinite(ck.maxSpreadPct) ? ck.maxSpreadPct : NaN;
    const hasLine = Number.isFinite(line);
    const reach = hasLine ? line * 2 : FL_SPREAD_MAX * 2;
    const cx = x + w / 2;
    const cy = y + h * 0.9;
    // the reading is written above the arc, never under the needle's pivot: the arc made small enough for it to fit
    const R = Math.min(w * 0.42, h * 0.9 - (showText ? fs + 3 : 0));
    if (!(R > 3)) return;
    ctx.lineWidth = Math.max(1.5, 2.2 * k);
    ctx.strokeStyle = flC(E, "mint", 0.4 * a);
    ctx.beginPath();
    ctx.arc(cx, cy, R, Math.PI, hasLine ? Math.PI * 1.5 : Math.PI * 2);
    ctx.stroke();
    if (hasLine) {
      ctx.strokeStyle = flC(E, "down", 0.55 * a);
      ctx.beginPath();
      ctx.arc(cx, cy, R, Math.PI * 1.5, Math.PI * 2);
      ctx.stroke();
    }
    const sp = ck ? ck.spreadPct : NaN;
    if (Number.isFinite(sp)) {
      const ang = Math.PI + flClamp(sp / reach, 0, 1) * Math.PI;
      ctx.strokeStyle = flC(E, hasLine && sp > line ? "down" : "text", a);
      ctx.lineWidth = Math.max(1, 1.2 * k);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(ang) * R * 0.92, cy + Math.sin(ang) * R * 0.92);
      ctx.stroke();
    }
    if (showText) {
      if (E.spV !== sp || E.spTxt === undefined) {
        E.spV = sp;
        E.spTxt = Number.isFinite(sp) ? `${sp.toFixed(2)}%` : "—";
      }
      flSetFont(E, flFont(E, fs, true, 500));
      ctx.fillStyle = Number.isFinite(sp) ? flC(E, "text", 0.85 * a) : flC(E, "mint", 0.55 * a);
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(E.spTxt, cx, cy - R - 2);
      ctx.textAlign = "left";
    }
    return;
  }
  if (role === "sniper") {
    // the Sniper's last order's size (the state's, else its own order events since mount — never another seat's) against its limit per
    // order, and what is left of its budget
    const lim = seat.limit;
    const per = lim && Number.isFinite(lim.perOrderUsd) && lim.perOrderUsd > 0 ? lim.perOrderUsd : NaN;
    const usd = seat.lastOrder && Number.isFinite(seat.lastOrder.usd) ? seat.lastOrder.usd : E.lastOrder && Number.isFinite(E.lastOrder.usd) ? E.lastOrder.usd : NaN;
    const bh = Math.max(2, h * 0.2);
    ctx.fillStyle = flC(E, "mint", 0.16 * a);
    ctx.fillRect(x, y + h * 0.55, w, bh);
    if (Number.isFinite(usd)) {
      ctx.fillStyle = flC(E, "mint", 0.9 * a);
      ctx.fillRect(x, y + h * 0.55, Number.isFinite(per) ? flClamp(usd / per, 0, 1) * w : w, bh);
    }
    if (lim && Number.isFinite(lim.leftUsd) && Number.isFinite(lim.budgetUsd) && lim.budgetUsd > 0) {
      ctx.fillStyle = flC(E, "mint", 0.16 * a);
      ctx.fillRect(x, y + h * 0.85, w, Math.max(1, bh * 0.4));
      ctx.fillStyle = flC(E, "mint", 0.6 * a);
      ctx.fillRect(x, y + h * 0.85, flClamp(lim.leftUsd / lim.budgetUsd, 0, 1) * w, Math.max(1, bh * 0.4));
    }
    if (showText && h * 0.55 >= fs + 1) {
      // one string, centred: the order against the limit where both fit ("$60.00 / $250", else "$60 / $250"), else the order alone
      // (the bar says the ratio), else nothing; worked out once per figure and size
      if (E.snV !== usd || E.snP !== per || E.snW !== w || E.snF !== fs || E.snTxt === undefined) {
        E.snV = usd;
        E.snP = per;
        E.snW = w;
        E.snF = fs;
        E.snTxt = flSniperText(E, usd, per, w, fs);
      }
      if (E.snTxt) {
        flSetFont(E, flFont(E, fs, true, 500));
        ctx.fillStyle = flC(E, "text", 0.85 * a);
        ctx.textBaseline = "top";
        ctx.textAlign = "center";
        ctx.fillText(E.snTxt, x + w / 2, y);
        ctx.textAlign = "left";
      }
    }
    return;
  }
  if (role === "exit") {
    // the open leads' P&L as bars about a zero line; a lead with no P&L yet is a hollow mark on the line, never a bar; none known at
    // all: how many are open, in words. "no open lead" only when the state says so; nothing said about it: "—"
    const open = st.open;
    if (!open) return flMonNote(E, "—", x, y, w, h, a, fs, showText);
    if (!open.length) return flMonNote(E, "no open lead", x, y, w, h, a, fs, showText, "none open");
    if (st.openNote) return flMonNote(E, st.openNote, x, y, w, h, a, fs, showText, st.openShort);
    let top = 1e-9;
    for (const o of open) if (Number.isFinite(o.pnlUsd)) top = Math.max(top, Math.abs(o.pnlUsd));
    const bw = w / open.length;
    const zero = y + h / 2;
    ctx.fillStyle = flC(E, "mint", 0.25 * a);
    ctx.fillRect(x, zero - 0.5, w, 1);
    for (let i = 0; i < open.length; i++) {
      const o = open[i];
      if (!Number.isFinite(o.pnlUsd)) {
        const q = Math.max(2, Math.min(bw * 0.4, h * 0.2));
        ctx.strokeStyle = flC(E, "dim", a);
        ctx.lineWidth = 1;
        ctx.strokeRect(x + i * bw + bw / 2 - q / 2, zero - q / 2, q, q);
        continue;
      }
      const bh = (Math.abs(o.pnlUsd) / top) * (h / 2 - 1);
      ctx.fillStyle = flC(E, o.pnlUsd >= 0 ? "up" : "down", 0.85 * a);
      if (o.pnlUsd >= 0) ctx.fillRect(x + i * bw + bw * 0.2, zero - bh, bw * 0.6, bh);
      else ctx.fillRect(x + i * bw + bw * 0.2, zero, bw * 0.6, bh);
    }
    return;
  }
  if (role === "watch") {
    // the market in focus: its last 40 closes as a line, the open marks' entries dashed across it; fewer than two candles: no line,
    // and it says so; candles but no marks: the line, captioned "no marks"
    const f = E.show.focus;
    if (!f) return flMonNote(E, "no market", x, y, w, h, a, fs, showText);
    const cs = f.candles;
    const i0 = Math.max(0, cs.length - 40);
    const nb = cs.length - i0;
    if (nb < 2) return flMonNote(E, "no candles", x, y, w, h, a, fs, showText);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = i0; i < cs.length; i++) {
      lo = Math.min(lo, cs[i].c);
      hi = Math.max(hi, cs[i].c);
    }
    for (const mk of f.marks) {
      lo = Math.min(lo, mk.entry);
      hi = Math.max(hi, mk.entry);
    }
    const span = hi - lo || Math.abs(hi) * 0.01 || 1;
    ctx.strokeStyle = flC(E, "mint", 0.9 * a);
    ctx.lineWidth = Math.max(1, 1.1 * k);
    ctx.beginPath();
    for (let i = i0; i < cs.length; i++) {
      const px = x + ((i - i0) / (nb - 1)) * w;
      const py = y + h - ((cs[i].c - lo) / span) * h;
      if (i > i0) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    }
    ctx.stroke();
    let shown = 0;
    for (const mk of f.marks) if (!E.show.fills.has(mk.lead)) shown++;
    if (shown) {
      ctx.setLineDash(FL_DASH_2);
      ctx.lineWidth = 1;
      for (const mk of f.marks) {
        if (E.show.fills.has(mk.lead)) continue;
        const my = y + h - ((mk.entry - lo) / span) * h;
        ctx.strokeStyle = flC(E, "text", 0.6 * a);
        ctx.beginPath();
        ctx.moveTo(x, my);
        ctx.lineTo(x + w, my);
        ctx.stroke();
      }
      ctx.setLineDash(FL_DASH_0);
    } else if (showText && flFitSize(E, "no marks", w, fs, 0, true, 500) === fs) {
      flSetFont(E, flFont(E, fs, true, 500));
      ctx.fillStyle = flC(E, "mint", 0.6 * a);
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText("no marks", x, y);
    }
    return;
  }
  // an outside agent's seat: it brings its own feed; the floor has none of it to show
  flMonNote(E, "outside agent", x, y, w, h, a, fs, showText, "outside");
}
/* the Head's four counts in one line (scanned · cleared · executed · closed), made again only when a count changes */
function flFunnelLine(E, vals) {
  const c = E.funC || (E.funC = { v: [NaN, NaN, NaN, NaN], s: "" });
  let same = !!c.s;
  for (let i = 0; i < 4; i++) if (!Object.is(c.v[i], vals[i])) same = false;
  if (!same) {
    for (let i = 0; i < 4; i++) c.v[i] = vals[i];
    c.s = vals.map((v) => (Number.isFinite(v) ? String(v) : "—")).join(" · ");
  }
  return c.s;
}
/* the Sniper's words for its last order against its limit per order, the first that fits the glass w wide at fs: "$60.00 / $250",
   "$60 / $250", "$60.00", "$60"; "no order" where it has placed none; "" where none fits */
function flSniperText(E, usd, per, w, fs) {
  const font = flFont(E, fs, true, 500);
  const fits = (t) => flMeasure(E, font, t) <= w;
  if (!Number.isFinite(usd)) return fits("no order") ? "no order" : "";
  const tries = Number.isFinite(per) ? [`${flUsd(usd)} / ${flCompact(per)}`, `${flCompact(usd)} / ${flCompact(per)}`, flUsd(usd), flCompact(usd)] : [flUsd(usd), flCompact(usd)];
  for (const t of tries) if (fits(t)) return t;
  return "";
}
/* a whole number as text, kept per value (the funnel's counts change once a cycle, not per frame) */
function flIntText(E, v) {
  const c = E.ints || (E.ints = new Map());
  let s = c.get(v);
  if (s === undefined) {
    if (c.size > 200) c.clear();
    s = String(v);
    c.set(v, s);
  }
  return s;
}
function flDrawChair(E, s) {
  const ctx = E.ctx;
  const k = s.s;
  const x = s.char.x;
  const y = s.char.y;
  ctx.strokeStyle = flC(E, "dim", 0.55);
  ctx.fillStyle = flC(E, "surface", 0.7);
  ctx.lineWidth = Math.max(1, 1.2 * k);
  // the back, the seat, the post and the base
  flRound(ctx, x - 12 * k, y - 40 * k, 24 * k, 18 * k, 4 * k);
  ctx.fill();
  ctx.stroke();
  flRound(ctx, x - 14 * k, y - 20 * k, 28 * k, 6 * k, 3 * k);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y - 14 * k);
  ctx.lineTo(x, y - 4 * k);
  ctx.moveTo(x - 10 * k, y - 1 * k);
  ctx.lineTo(x + 10 * k, y - 1 * k);
  ctx.stroke();
}
/* the radar dish at the Flow seat: standing still while the seat is empty; lit, and pulsing when the agent there speaks, once taken */
function flDrawDish(E, s, taken, t) {
  const ctx = E.ctx;
  const k = s.s;
  const d = s.desk;
  const x = d.x + d.w - 8 * k;
  const y = d.top + 2 * k;
  ctx.strokeStyle = taken ? flC(E, "mint", 0.85) : flC(E, "dim", 0.45);
  ctx.lineWidth = Math.max(1, 1.3 * k);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - 16 * k);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(x, y - 22 * k, 13 * k, 6 * k, -0.5, 0, Math.PI);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 3 * k, y - 21 * k);
  ctx.lineTo(x + 3 * k, y - 30 * k);
  ctx.stroke();
  const age = t - E.chars.flow.pulseAt;
  if (taken && age >= 0 && age < 1200 && !E.instant) {
    const p = age / 1200;
    ctx.strokeStyle = flC(E, "mint", 0.6 * (1 - p));
    ctx.beginPath();
    ctx.arc(x + 3 * k, y - 30 * k, (4 + p * 26) * k, -Math.PI * 0.9, -Math.PI * 0.1);
    ctx.stroke();
  }
}
/* the feed antenna at the Sentiment seat: the same rule as the dish */
function flDrawAntenna(E, s, taken, t) {
  const ctx = E.ctx;
  const k = s.s;
  const d = s.desk;
  const x = d.x + d.w - 8 * k;
  const y = d.top + 2 * k;
  ctx.strokeStyle = taken ? flC(E, "mint", 0.85) : flC(E, "dim", 0.45);
  ctx.lineWidth = Math.max(1, 1.2 * k);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - 34 * k);
  for (let i = 0; i < 3; i++) {
    const yy = y - (14 + i * 7) * k;
    const ww = (8 - i * 2) * k;
    ctx.moveTo(x - ww, yy);
    ctx.lineTo(x + ww, yy);
  }
  ctx.stroke();
  ctx.fillStyle = taken ? flC(E, "mint") : flC(E, "dim", 0.45);
  ctx.beginPath();
  ctx.arc(x, y - 35 * k, 1.8 * k, 0, Math.PI * 2);
  ctx.fill();
  const age = t - E.chars.sentiment.pulseAt;
  if (taken && age >= 0 && age < 1400 && !E.instant) {
    for (let i = 0; i < 2; i++) {
      const p = flClamp((age - i * 220) / 1100, 0, 1);
      if (p <= 0 || p >= 1) continue;
      ctx.strokeStyle = flC(E, "mint", 0.55 * (1 - p));
      ctx.beginPath();
      ctx.arc(x, y - 35 * k, (3 + p * 22) * k, -Math.PI * 0.85, -Math.PI * 0.15);
      ctx.stroke();
    }
  }
}
/* a mascot: feet on the floor, a body that breathes (scale ±2 % at a quarter of a hertz, each seat at its own phase), squashes on a
   throw or a catch, recoils on an order and leans back in a paused room; two eyes that blink and follow what flies; a mouth that moves
   only while its line is being typed; the Head's headset */
function flDrawMascot(E, role, seat, s, t) {
  const ctx = E.ctx;
  const ch = E.chars[role];
  const k = s.s;
  const cw = s.char.w;
  const chh = s.char.h;
  const x = s.char.x;
  const y = s.char.y;
  const faded = seat.status !== "ok";
  const breath = E.instant ? 0 : Math.sin(t * 0.001 * Math.PI * 2 * 0.25 + ch.phase) * 0.02 * ch.amp.x;
  const sq = flClamp(ch.sq.x, -0.35, 0.35);
  const sy = 1 + breath - sq * 0.22;
  const sxx = 1 - breath * 0.5 + sq * 0.16;
  if (faded) ctx.globalAlpha = 0.55;
  // feet
  ctx.fillStyle = flC(E, `r_${role}`);
  const fw = 7 * k;
  ctx.beginPath();
  ctx.ellipse(x - cw * 0.2, y - 1.5 * k, fw / 2, 2.4 * k, 0, 0, Math.PI * 2);
  ctx.ellipse(x + cw * 0.2, y - 1.5 * k, fw / 2, 2.4 * k, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.translate(x, y - 2 * k + ch.rec.x * 0.12);
  ctx.rotate(ch.lean.x);
  ctx.scale(sxx, sy);
  // the dots of a thought, behind the head first
  if (ch.think && !E.instant) flThinkDots(E, ch, cw, chh, t, false);
  const sp = E.sprites;
  const body = sp && sp.bodies[role];
  if (body) {
    ctx.drawImage(body.c, -body.ox, -body.oy, body.w, body.h);
    if (role === "risk" && ch.coral.x > 0.01 && sp.bodies.riskCoral) {
      ctx.globalAlpha = (faded ? 0.55 : 1) * ch.coral.x;
      ctx.drawImage(sp.bodies.riskCoral.c, -body.ox, -body.oy, body.w, body.h);
      ctx.globalAlpha = faded ? 0.55 : 1;
    }
  } else {
    flBlobPath(ctx, cw, chh);
    ctx.fillStyle = role === "risk" && ch.coral.x > 0.5 ? flC(E, "coralBody") : flC(E, `r_${role}`);
    ctx.fill();
  }
  // an outside agent's seat: a dashed ring at its feet says it is not the desk's own
  if (seat.kind === "outside") {
    ctx.setLineDash([2, 2]);
    ctx.strokeStyle = flC(E, "ink", 0.5);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(0, -chh * 0.18, cw * 0.32, chh * 0.08, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // the eyes
  const sess = E.st.session.state;
  const ex = ch.eyeX.x * 2.2 * k;
  const ey = ch.eyeY.x * 1.6 * k;
  let open = 1;
  const be = t - ch.blinkAt;
  if (!E.instant && be >= 0 && be < 170 && sess !== "halted") open = 1 - Math.sin((be / 170) * Math.PI);
  if (sess === "paused") open = Math.min(open, 0.4);
  if (sess === "ended") open = Math.min(open, 0.15);
  const eyY = -chh * 0.6 + ey;
  const erx = cw * 0.075;
  const ery = cw * 0.105 * Math.max(0.08, open);
  ctx.fillStyle = flC(E, "ink");
  ctx.beginPath();
  ctx.ellipse(-cw * 0.17 + ex, eyY, erx, ery, 0, 0, Math.PI * 2);
  ctx.ellipse(cw * 0.17 + ex, eyY, erx, ery, 0, 0, Math.PI * 2);
  ctx.fill();
  if (open > 0.5) {
    ctx.fillStyle = flC(E, "text", 0.9);
    ctx.beginPath();
    ctx.arc(-cw * 0.17 + ex - erx * 0.3, eyY - ery * 0.35, erx * 0.35, 0, Math.PI * 2);
    ctx.arc(cw * 0.17 + ex - erx * 0.3, eyY - ery * 0.35, erx * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }
  // the mouth: open and closing while its line is typed out (only then)
  const b = E.bubbles[role];
  let talk = 0;
  if (b && b.on && !E.instant) {
    const age = t - b.start;
    if (age < b.typeMs) talk = 0.5 + 0.5 * Math.sin(age * 0.045);
  }
  ctx.fillStyle = flC(E, "ink", 0.85);
  ctx.beginPath();
  if (talk > 0.05) ctx.ellipse(ex * 0.6, eyY + cw * 0.2, cw * 0.06, cw * 0.05 * talk + 0.5, 0, 0, Math.PI * 2);
  else ctx.ellipse(ex * 0.6, eyY + cw * 0.2, cw * 0.05, Math.max(0.6, 0.9 * k), 0, 0, Math.PI * 2);
  ctx.fill();
  if (role === "head") flHeadset(E, ch, cw, chh, k, t);
  if (ch.think && !E.instant) flThinkDots(E, ch, cw, chh, t, true);
  flRestore(E);
  ctx.globalAlpha = 1;
}
function flHeadset(E, ch, cw, chh, k, t) {
  const ctx = E.ctx;
  ctx.strokeStyle = flC(E, "ink", 0.9);
  ctx.lineWidth = Math.max(1.2, 2 * k);
  ctx.beginPath();
  ctx.ellipse(0, -chh * 0.74, cw * 0.47, chh * 0.3, 0, Math.PI * 1.08, Math.PI * 1.92);
  ctx.stroke();
  ctx.fillStyle = flC(E, "ink");
  flRound(ctx, -cw * 0.55, -chh * 0.7, cw * 0.14, chh * 0.2, 2 * k);
  ctx.fill();
  ctx.lineWidth = Math.max(1, 1.2 * k);
  ctx.beginPath();
  ctx.moveTo(-cw * 0.46, -chh * 0.55);
  ctx.quadraticCurveTo(-cw * 0.4, -chh * 0.36, -cw * 0.14, -chh * 0.36);
  ctx.stroke();
  // the mic's tip lights while the Head's line is typed
  const b = E.bubbles.head;
  const on = b && b.on && !E.instant && t - b.start < b.typeMs;
  ctx.fillStyle = on ? flC(E, "mint") : flC(E, "ink");
  ctx.beginPath();
  ctx.arc(-cw * 0.13, -chh * 0.36, Math.max(1.2, 1.8 * k), 0, Math.PI * 2);
  ctx.fill();
}
/* three dots orbiting the head while a brain call is under way — the ones behind the head drawn before it, the ones in front after */
function flThinkDots(E, ch, cw, chh, t, front) {
  const ctx = E.ctx;
  const R = cw * 0.62;
  const cy = -chh * 1.04;
  for (let i = 0; i < 3; i++) {
    const a = (t - ch.thinkAt) * 0.0042 + (i * Math.PI * 2) / 3;
    const sn = Math.sin(a);
    if (front ? sn < 0 : sn >= 0) continue;
    const x = Math.cos(a) * R;
    const y = cy + sn * R * 0.3;
    const r = Math.max(1.2, cw * 0.05) * (0.8 + 0.25 * sn);
    if (front) {
      ctx.globalCompositeOperation = "lighter";
      flGlow(E, "mint", x, y, r * 4, 0.5);
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.fillStyle = flC(E, "mint", front ? 1 : 0.55);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}
/* what each station shows above the room's lights: its name and status in words, the thought bubble of a thinking seat, the cycle stamp
   at the Head */
function flDrawStationLive(E, role, t) {
  const ctx = E.ctx;
  const L = E.L;
  const s = L.seats[role];
  const lab = E.labels[role];
  const empty = lab ? lab.empty : true;
  const k = s.s;
  const ch = E.chars[role];
  // the label, wrapped once (flLabels): the role's name, then what it is doing, or why it cannot, or why the seat is empty
  if (lab) {
    const fs = L.fs.label;
    let ly = lab.y;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    flTrack(E, 0.12);
    flSetFont(E, lab.nameFont);
    ctx.fillStyle = lab.reading ? flC(E, "dim", 0.8) : flC(E, "mint", empty ? 0.62 : 0.78);
    ctx.fillText(lab.name, lab.nx, ly);
    ly += fs + 2;
    if (lab.lines.length) {
      flTrack(E, 0.06);
      flSetFont(E, lab.font);
      ctx.fillStyle = flC(E, lab.col);
      for (const ln of lab.lines) {
        ctx.fillText(ln, lab.lx, ly);
        ly += lab.lineH;
      }
    }
    flTrack(E, 0);
    ctx.textAlign = "left";
  }
  if (empty) return;
  // the thought bubble while a brain call is under way: three small puffs up to a pill with typing dots
  if (ch.think) {
    const hx = s.char.x + s.char.w * 0.4;
    const hy = s.char.y - s.char.h * 1.08;
    const pop = E.instant ? 1 : flEaseOutBack(flClamp((t - ch.thinkAt) / 320, 0, 1), 1.9);
    ctx.save();
    ctx.translate(hx, hy);
    ctx.scale(pop, pop);
    ctx.fillStyle = flC(E, "surface", 0.96);
    ctx.strokeStyle = flC(E, "mint", 0.4);
    ctx.lineWidth = 1;
    flPuff(ctx, 2 * k, -2 * k, 1.8 * k);
    flPuff(ctx, 6 * k, -7 * k, 2.6 * k);
    const pw = 30 * k;
    const ph = 15 * k;
    flRound(ctx, 6 * k, -14 * k - ph, pw, ph, ph / 2);
    ctx.fill();
    ctx.stroke();
    for (let i = 0; i < 3; i++) {
      const wave = E.instant ? 0.6 : 0.5 + 0.5 * Math.sin((t - ch.thinkAt) * 0.012 - i * 0.9);
      ctx.fillStyle = flC(E, "mint", 0.35 + 0.65 * wave);
      ctx.beginPath();
      ctx.arc(6 * k + pw * (0.28 + i * 0.22), -14 * k - ph / 2 - wave * 1.6 * k, 1.8 * k, 0, Math.PI * 2);
      ctx.fill();
    }
    flRestore(E);
  }
  // the cycle's stamp at the Head: "CYCLE n" rising off its monitor for two seconds
  if (role === "head" && E.stamp.n > 0) {
    const age = t - E.stamp.t0;
    if (age >= 0 && age < 2200) {
      const p = age / 2200;
      const a = E.instant ? 1 : p < 0.15 ? p / 0.15 : 1 - Math.max(0, (p - 0.6) / 0.4);
      ctx.globalAlpha = a;
      flTrack(E, 0.12);
      flSetFont(E, flFont(E, L.fs.small, true, 500));
      ctx.fillStyle = flC(E, "mint");
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      if (E.stamp.txtN !== E.stamp.n) {
        E.stamp.txtN = E.stamp.n;
        E.stamp.txt = `CYCLE ${E.stamp.n}`;
      }
      ctx.fillText(E.stamp.txt, s.mon.x + s.mon.w / 2, s.mon.y - 4 * k - (E.instant ? 0 : flEaseOutCubic(p) * 14 * k));
      flTrack(E, 0);
      ctx.textAlign = "left";
      ctx.globalAlpha = 1;
    }
  }
}

/* one puff of a thought bubble */
function flPuff(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}
/* the wall screen: the focus market's candles as its source gave them (the newest that fit), volume under them where the bars carry it,
   the last price as a dashed line with its tag, the desk's entry, take-profit and stop lines for its marks (their words laid apart:
   flMarkLabels), the order and fill tags, the latest candle ringed where the scan's threads meet it. The market is the one the events
   have shown (E.show.focus), each mark only once its fill has played. No market in focus, or no candles: it says which, and draws no
   axes */
function flDrawScreen(E, t) {
  const ctx = E.ctx;
  const L = E.L;
  const r = L.screen;
  const k = L.k;
  const f = E.show.focus;
  // the halo of a live screen
  if (f && f.candles.length) {
    ctx.globalCompositeOperation = "lighter";
    flGlow(E, "mint", r.x + r.w / 2, r.y + r.h / 2, r.w * 0.62, 0.1);
    ctx.globalCompositeOperation = "source-over";
  }
  // the bezel and the glass
  flRound(ctx, r.x - 6 * k, r.y - 6 * k, r.w + 12 * k, r.h + 12 * k, 10 * k);
  ctx.fillStyle = flC(E, "surface");
  ctx.fill();
  ctx.strokeStyle = flC(E, "line");
  ctx.lineWidth = 1;
  ctx.stroke();
  flRound(ctx, r.x, r.y, r.w, r.h, 6 * k);
  ctx.fillStyle = flC(E, "glass");
  ctx.fill();
  ctx.save();
  flRound(ctx, r.x, r.y, r.w, r.h, 6 * k);
  ctx.clip();
  const fs = L.fs.small;
  const padL = 10 * k;
  // the price axis as wide as its figures (the last price's, written with its chip's padding), so none is cut at the glass's edge
  let axisW = Math.max(40, 54 * k);
  if (f && f.candles.length) {
    const c = f.candles[f.candles.length - 1];
    const lastTxt = flPriceKept(E, Number.isFinite(f.price) ? f.price : c.h, f.priceStep);
    axisW = Math.max(axisW, flMeasure(E, flFont(E, L.fs.tiny, true, 500), lastTxt) + 8 * k + 2 * k + 6);
  }
  const top = r.y + Math.max(18, 24 * k);
  const bottom = r.y + r.h - 8 * k;
  const x0 = r.x + padL;
  const x1 = r.x + r.w - axisW;
  // the screen's geometry, in the one object kept for it: no chart yet (S.ok false) until the candles are drawn
  const S = E.scrObj;
  S.x0 = x0;
  S.x1 = r.x + r.w - 10 * k;
  S.top = top;
  S.bottom = bottom;
  S.slot = 0;
  S.lastX = NaN;
  S.lastY = NaN;
  S.ok = false;
  S.step = NaN;
  S.chipX = Infinity;
  E.scr = S;
  // the marks' words this frame, staged here and drawn by flDrawMarkWords once the threads are drawn: none until the marks say
  const labs = E.markLabs || (E.markLabs = { list: [], pool: [], merged: [], said: [], x0: 0, x1: 0, top: 0, lh: 0, k: 1, font: "", colIn: 0 });
  labs.list.length = 0;
  labs.merged.length = 0;
  labs.said.length = 0;
  if (!f) {
    // its words found again only when the scan it speaks of changes, not per frame
    const NW = E.noneW || (E.noneW = { ok: false, scan: null, a: "", b: "" });
    if (!NW.ok || NW.scan !== E.show.scan) {
      const why = flScreenNone(E.show.scan);
      NW.ok = true;
      NW.scan = E.show.scan;
      NW.a = why.a;
      NW.b = why.b;
    }
    flScreenMsg(E, NW.a, NW.b);
    flRestore(E);
    return;
  }
  // the header: the market (cut to the room its change leaves), and its change over the bars on the screen
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const hfont = flFont(E, fs, true, 500);
  const HW = E.headW;
  const roomW = r.w - padL - 10 * k - (f.candles.length ? flMeasure(E, hfont, "▲ 00.00%") + 8 * k : 0);
  if (!HW.ok || HW.focus !== f || HW.font !== hfont || HW.w !== roomW) {
    let out = flScreenHead(f);
    if (flMeasure(E, hfont, out) * 1.06 > roomW) {
      while (out.length > 1 && flMeasure(E, hfont, `${out}…`) * 1.06 > roomW) out = out.slice(0, -1).trimEnd();
      out = `${out}…`;
    }
    HW.ok = true;
    HW.focus = f;
    HW.font = hfont;
    HW.w = roomW;
    HW.out = out;
    HW.none = `No candles for ${f.symbol} yet`;
  }
  flTrack(E, 0.06);
  flSetFont(E, hfont);
  ctx.fillStyle = flC(E, "text");
  ctx.fillText(HW.out, x0, r.y + (top - r.y) / 2 + 1);
  flTrack(E, 0);
  if (!f.candles.length) {
    flScreenMsg(E, HW.none, "its source has given no bars");
    flRestore(E);
    return;
  }
  // The marks' words have a column of their own at the chart's right end, between the newest bar and the price axis, so no candle
  // ever runs through a word: the bars end where the column starts (xc), the marks' lines run on across it to the axis, and each line's
  // words stand in the column at its height, on a plate of the glass. Its width is that of the widest word it holds. All of them said
  // the same way — each with the lead's id where every one fits in four tenths of the chart, else every one without it ("TP 13.85"),
  // else no column at all: each mark's words then said once, whole, at the top left. Which marks' words merge (all three of its lines
  // within one line of words: said once, whole, at the top left) depends on the scale, and the scale on the bars, and the bars on the
  // column; so it is decided first, at the scale the screen moves toward with the column open (flScreenFit, flMarksApart) — and where
  // no mark's words are left apart, there is no column (with more bars the scale only widens, so merged marks stay merged). No mark,
  // no column: the bars run to the axis. The column opens and closes on a quick spring, its words fading in once it is (nearly) open
  const lh = L.fs.tiny + 3;
  const lfont = flFont(E, L.fs.tiny, true, 500);
  const colMax = (x1 - x0) * 0.4;
  let wFull = 0;
  let wShort = 0;
  for (const m of f.marks) {
    if (E.show.fills.has(m.lead)) continue;
    if (!m.words) m.words = flMarkWords(m, f.priceStep);
    const w = m.words;
    wFull = Math.max(wFull, flMeasure(E, lfont, w.entry), Number.isFinite(m.tp) ? flMeasure(E, lfont, w.tp) : 0, Number.isFinite(m.sl) ? flMeasure(E, lfont, w.sl) : 0);
    wShort = Math.max(wShort, flMeasure(E, lfont, w.entryS), Number.isFinite(m.tp) ? flMeasure(E, lfont, w.tpS) : 0, Number.isFinite(m.sl) ? flMeasure(E, lfont, w.slS) : 0);
  }
  const form = !wFull ? "" : wFull <= colMax ? "full" : wShort <= colMax ? "short" : "";
  const cs = f.candles;
  const lastBar = cs[cs.length - 1];
  const last = Number.isFinite(f.price) ? f.price : lastBar.c;
  // a bar as wide whether or not there is a column
  const slot = flClamp((x1 - x0) / 56, 4, 12);
  const F = E.fitObj || (E.fitObj = { i0: 0, nb: 0, lo: 0, hi: 1, pb: 0, hasVol: false });
  // the column: the words, their plate's 3 px either side, 3 px clear of the axis and 4 px clear of the newest bar — where a mark's
  // words stand apart in it
  let colT = form ? (form === "full" ? wFull : wShort) + 6 + 7 * k : 0;
  if (colT > 0 && !flMarksApart(f.marks, E.show.fills, flScreenFit(cs, f.marks, last, x0, x1 - colT, slot, top, bottom, k, F), top, lh)) colT = 0;
  if (f.symbol !== E.colSig) {
    // another market: its column at once, as its scale is
    E.colSig = f.symbol;
    E.colW.x = colT;
    E.colW.v = 0;
  }
  const colW = Math.max(0, flSp(E, E.colW, colT, FL_SPRING.snap, E.dtLast));
  const colIn = colT > 0 ? flClamp((colW / colT - 0.9) / 0.1, 0, 1) : 0;
  const xc = x1 - colW;
  // the newest bars that fit before the column, by index (no copy of the candles per frame), and the scale they set
  flScreenFit(cs, f.marks, last, x0, xc, slot, top, bottom, k, F);
  const i0 = F.i0;
  const nb = F.nb;
  const first = cs[i0];
  const chg = first.o ? ((last - first.o) / first.o) * 100 : NaN;
  if (Number.isFinite(chg)) {
    if (E.chgV !== chg) {
      E.chgV = chg;
      E.chgTxt = `${chg >= 0 ? "▲" : "▼"} ${Math.abs(chg).toFixed(2)}%`;
    }
    ctx.textAlign = "right";
    flSetFont(E, hfont);
    ctx.fillStyle = flC(E, chg >= 0 ? "up" : "down");
    ctx.fillText(E.chgTxt, r.x + r.w - 10 * k, r.y + (top - r.y) / 2 + 1);
    ctx.textAlign = "left";
  }
  // the scale moves toward the fit's on a spring
  const tLo = F.lo;
  const tHi = F.hi;
  if (f.symbol !== E.scaleSig || !Number.isFinite(E.lo.x) || !Number.isFinite(E.hi.x) || E.instant) {
    E.scaleSig = f.symbol;
    E.lo.x = tLo;
    E.hi.x = tHi;
    E.lo.v = 0;
    E.hi.v = 0;
  } else {
    flSpring(E.lo, tLo, E.dtLast, FL_SPRING.soft[0], FL_SPRING.soft[1]);
    flSpring(E.hi, tHi, E.dtLast, FL_SPRING.soft[0], FL_SPRING.soft[1]);
  }
  const vlo = E.lo.x;
  const vhi = E.hi.x;
  const hasVol = F.hasVol;
  const volH = hasVol ? (bottom - top) * 0.16 : 0;
  const pb = F.pb;
  S.vlo = vlo;
  S.vhi = vhi;
  S.pb = pb;
  S.top = top;
  // the grid and the price axis (the ticks found again only when the scale moved)
  if (!E.ticks || E.tickLo !== vlo || E.tickHi !== vhi) {
    E.ticks = flTicks(vlo, vhi, 4, E.ticks || []);
    E.tickLo = vlo;
    E.tickHi = vhi;
  }
  const ticks = E.ticks;
  flSetFont(E, flFont(E, L.fs.tiny, true, 400));
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 1 / E.dpr;
  // (a tick's figure a line of words below the one before it at the least, and clear of the last price's chip: a short screen writes
  // fewer, never one over another)
  let lastTick = -Infinity;
  const chipY = flScrY(S, last);
  for (let j = ticks.length - 1; j >= 0; j--) {
    const tv = ticks[j];
    const y = flSnap(flScrY(S, tv), E.dpr, 1 / E.dpr);
    if (y < top || y > pb) continue;
    ctx.strokeStyle = flC(E, "line", 0.6);
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
    if (y - lastTick < L.fs.tiny + 3 || Math.abs(y - chipY) < L.fs.tiny + 4) continue;
    lastTick = y;
    ctx.fillStyle = flC(E, "dim");
    ctx.fillText(flPriceKept(E, tv, f.priceStep), x1 + 6 * k, y);
  }
  // volume
  if (hasVol) {
    let vmax = 0;
    for (let i = i0; i < cs.length; i++) if (Number.isFinite(cs[i].v)) vmax = Math.max(vmax, cs[i].v);
    for (let i = i0; i < cs.length; i++) {
      const b = cs[i];
      if (!Number.isFinite(b.v) || !(vmax > 0)) continue;
      const vh = (b.v / vmax) * volH;
      ctx.fillStyle = flC(E, b.c >= b.o ? "up" : "down", 0.28);
      ctx.fillRect((xc - slot * (nb - (i - i0)) + slot / 2) - slot * 0.31, bottom - vh, slot * 0.62, vh);
    }
  }
  // the candles: a one-device-pixel wick on a pixel's centre, a body at least a pixel tall
  const bw = Math.max(1, Math.round(slot * 0.62 * E.dpr) / E.dpr);
  const wick = 1 / E.dpr;
  for (let i = i0; i < cs.length; i++) {
    const b = cs[i];
    const up = b.c >= b.o;
    const cx = flSnap((xc - slot * (nb - (i - i0)) + slot / 2), E.dpr, wick);
    ctx.fillStyle = flC(E, up ? "up" : "down", 0.95);
    const yh = flScrY(S, b.h);
    ctx.fillRect(cx - wick / 2, yh, wick, Math.max(wick, flScrY(S, b.l) - yh));
    const yt = flScrY(S, Math.max(b.o, b.c));
    const yb = flScrY(S, Math.min(b.o, b.c));
    ctx.fillRect(Math.round((cx - bw / 2) * E.dpr) / E.dpr, yt, bw, Math.max(1 / E.dpr, yb - yt));
  }
  const lastX = xc - slot + slot / 2;
  // the marks: entry solid, take-profit dashed in the up colour, stop dashed in the down colour — the lines here, their words laid apart
  // (flMarkLabels) in the column: each at its line, pushed off the one above; a mark whose lines all fall within one line of words
  // said once, whole, at the screen's top left on a plate of the glass as opaque as the glass (it hides the old bars under it, none
  // runs through it). The words are drawn later, by flDrawMarkWords, over the last price's line and the scan's threads. A mark whose
  // fill has not played yet is not drawn
  // the merged words said shorter (without the lead's id, then the entry alone) where the chart is too narrow for them whole
  const chartW = x1 - x0 - 6;
  const pick = (a, b, c) => (flMeasure(E, lfont, a) <= chartW ? a : flMeasure(E, lfont, b) <= chartW ? b : c && flMeasure(E, lfont, c) <= chartW ? c : "");
  let used = 0;
  for (const m of f.marks) {
    if (E.show.fills.has(m.lead)) continue;
    if (!m.words) m.words = flMarkWords(m, f.priceStep);
    let ylo = Infinity;
    let yhi = -Infinity;
    let n = 0;
    for (let j = 0; j < 3; j++) {
      const v = j === 0 ? m.entry : j === 1 ? m.tp : m.sl;
      if (!Number.isFinite(v)) continue;
      const y = flScrY(S, v);
      if (y < S.top - 2 || y > S.pb + 2) continue;
      const key = j === 0 ? (m.state === "confirmed" ? "warn" : "text") : j === 1 ? "up" : "down";
      flMarkLine(E, y, key, j === 0 ? (m.state === "confirmed" ? FL_DASH_23 : FL_DASH_0) : FL_DASH_54, x0, x1);
      const lab = labs.pool[used] || (labs.pool[used] = { y: 0, text: "", key: "" });
      used++;
      lab.y = y;
      lab.text = !form ? "" : form === "full" ? (j === 0 ? m.words.entry : j === 1 ? m.words.tp : m.words.sl) : j === 0 ? m.words.entryS : j === 1 ? m.words.tpS : m.words.slS;
      lab.key = key;
      labs.list.push(lab);
      ylo = Math.min(ylo, y);
      yhi = Math.max(yhi, y);
      n++;
    }
    if (n >= 1 && (!form || colT === 0 || m.merged)) {
      // too close to write apart (decided before the bars were laid out: flMarksApart), or no column for its words (a chart too narrow
      // for even "TP 13.85" in four tenths of it): this mark's words said once, whole, at the top left
      labs.list.length -= n;
      labs.merged.push(m);
    }
  }
  flMarkLabels(labs.list, S.top + 1, S.pb - 1, lh);
  for (let i = 0; i < labs.merged.length; i++) {
    const w = labs.merged[i].words;
    labs.said.push(pick(w.all, w.allS, w.entryS));
  }
  labs.x0 = x0;
  labs.x1 = x1;
  labs.top = S.top;
  labs.lh = lh;
  labs.k = k;
  labs.font = lfont;
  labs.colIn = colIn;
  // the last price: a dashed line across, its tag on the axis
  {
    const y = flSnap(flScrY(S, last), E.dpr, 1);
    const up = lastBar.c >= lastBar.o;
    ctx.setLineDash(FL_DASH_33);
    ctx.strokeStyle = flC(E, up ? "up" : "down", 0.75);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
    ctx.setLineDash(FL_DASH_0);
    const txt = flPriceKept(E, last, f.priceStep);
    const tfont = flFont(E, L.fs.tiny, true, 500);
    flSetFont(E, tfont);
    const tw = flMeasure(E, tfont, txt) + 8 * k;
    const th = L.fs.tiny + 6;
    S.chipX = x1 + 2 * k;
    flRound(ctx, x1 + 2 * k, y - th / 2, Math.min(tw, r.x + r.w - x1 - 3 * k), th, 3);
    ctx.fillStyle = flC(E, up ? "up" : "down");
    ctx.fill();
    ctx.fillStyle = flC(E, "ink");
    ctx.textBaseline = "middle";
    ctx.fillText(txt, x1 + 6 * k, y + 0.5);
  }
  // the latest candle, where the threads meet: a ring that breathes (decor on a real point)
  const ly = flScrY(S, lastBar.c);
  const ring = E.instant ? 0.5 : 0.5 + 0.5 * Math.sin(t * 0.004);
  ctx.strokeStyle = flC(E, "mint", 0.35 + 0.4 * ring);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(lastX, ly, (4 + ring * 2) * k, 0, Math.PI * 2);
  ctx.stroke();
  S.x0 = x0;
  S.x1 = x1;
  S.bottom = pb;
  S.slot = slot;
  S.lastX = lastX;
  S.lastY = ly;
  S.step = f.priceStep;
  S.ok = true;
  // scanlines over the glass, and the coral flash of a stop
  if (E.sprites && E.sprites.scan && !E.lite) {
    ctx.fillStyle = E.sprites.scan;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.globalAlpha = 1;
  }
  const fe = t - E.flash.t0;
  if (!E.instant && fe >= 0 && fe < E.flash.dur) {
    ctx.fillStyle = flC(E, "down", 0.22 * (1 - fe / E.flash.dur));
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }
  flRestore(E);
}
/* The marks' words, drawn after the wall screen's last-price line and the scan's threads to the latest candle, so neither runs through a
   word: the column's words at their lines (fading in as the column opens), the merged ones at the top left — as flDrawScreen staged
   them this frame (E.markLabs), inside the glass */
function flDrawMarkWords(E) {
  const labs = E.markLabs;
  if (!labs || (!labs.list.length && !labs.said.length)) return;
  const ctx = E.ctx;
  const r = E.L.screen;
  ctx.save();
  flRound(ctx, r.x, r.y, r.w, r.h, 6 * E.L.k);
  ctx.clip();
  flSetFont(E, labs.font);
  ctx.textBaseline = "middle";
  if (labs.colIn > 0) {
    ctx.globalAlpha = labs.colIn;
    for (const lab of labs.list) if (lab.text) flAxisWords(E, lab.text, lab.key, labs.x1 - 3 * labs.k, lab.y, labs.font, "right");
    ctx.globalAlpha = 1;
  }
  for (let i = 0; i < labs.said.length; i++) if (labs.said[i]) flAxisWords(E, labs.said[i], "text", labs.x0 + 2 * labs.k, labs.top + labs.lh / 2 + 1 + i * labs.lh, labs.font, "left");
  flRestore(E);
}
/* a price as the axis writes it, kept per value and step (the axis's round ticks recur frame after frame) */
function flPriceKept(E, v, step) {
  let c = E.prices;
  if (!c || E.pricesStep !== step) {
    c = E.prices = new Map();
    E.pricesStep = step;
  }
  let s = c.get(v);
  if (s === undefined) {
    if (c.size > 256) c.clear();
    s = flPrice(v, step);
    c.set(v, s);
  }
  return s;
}
/* one of a mark's lines across the chart: at its height, in its colour and dash (its words are laid out apart: flMarkLabels) */
function flMarkLine(E, y0, key, dash, x0, x1) {
  const ctx = E.ctx;
  const y = flSnap(y0, E.dpr, 1);
  ctx.setLineDash(dash);
  ctx.strokeStyle = flC(E, key, 0.8);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();
  ctx.setLineDash(FL_DASH_0);
}
/* a mark's words, made once per mark: its entry ("L-0002 ENTRY ▲ 2,459.08", "WAITS" while it waits for the owner), its take-profit and
   its stop each on its own, and all three in one line for when they are too close to write apart ("L-0002 ▲ entry 2,459.08 · TP
   2,468.92 · SL 2,449.24"); the entry as it filled and the take-profit and the stop to its decimals (or the market's step), never
   more than it quotes — the figures the page's table of the same leads writes */
function flMarkWords(m, step) {
  const P = (v) => flPrice(v, step, m.entry);
  const g = m.side === "sell" ? "▼" : "▲";
  const at = m.state === "confirmed" ? "waits" : "entry";
  const rest = [Number.isFinite(m.tp) ? `TP ${P(m.tp)}` : "", Number.isFinite(m.sl) ? `SL ${P(m.sl)}` : ""].filter(Boolean);
  const all = [`${m.lead} ${g} ${at} ${P(m.entry)}`, ...rest].join(" · ");
  const allS = [`${g} ${at} ${P(m.entry)}`, ...rest].join(" · ");
  // and each said shorter, without the lead's id, for a narrow chart
  return { tp: `${m.lead} TP ${P(m.tp)}`, sl: `${m.lead} SL ${P(m.sl)}`, entry: `${m.lead} ${at.toUpperCase()} ${g} ${P(m.entry)}`, all, tpS: `TP ${P(m.tp)}`, slS: `SL ${P(m.sl)}`, entryS: `${g} ${P(m.entry)}`, allS };
}
/* Where the wall screen's bars go and the scale they set, for bars that end at xr: the newest that fit, a slot each (from index i0, nb of
   them), the price range they, the last price and the marks inside a reach of them take, opened by 8 % (lo..hi: the scale the screen
   moves toward), whether they carry volume, and the bottom of the price part (pb: above the volume strip where they do). Pure; written
   into out, which it returns */
function flScreenFit(cs, marks, last, x0, xr, slot, top, bottom, k, out) {
  const n = Math.max(2, Math.floor((xr - x0 - slot) / slot));
  const i0 = cs.length > n ? cs.length - n : 0;
  let lo = Infinity;
  let hi = -Infinity;
  let hasVol = false;
  for (let i = i0; i < cs.length; i++) {
    lo = Math.min(lo, cs[i].l);
    hi = Math.max(hi, cs[i].h);
    if (!hasVol && Number.isFinite(cs[i].v) && cs[i].v > 0) hasVol = true;
  }
  lo = Math.min(lo, last);
  hi = Math.max(hi, last);
  const reach = (hi - lo || Math.abs(hi) * 0.01 || 1) * 0.8;
  const rlo = lo - reach;
  const rhi = hi + reach;
  for (const m of marks) {
    for (let j = 0; j < 3; j++) {
      const v = j === 0 ? m.entry : j === 1 ? m.tp : m.sl;
      if (Number.isFinite(v) && v > rlo && v < rhi) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
  }
  const span = hi - lo || Math.abs(hi) * 0.01 || 1;
  out.i0 = i0;
  out.nb = cs.length - i0;
  out.lo = lo - span * 0.08;
  out.hi = hi + span * 0.08;
  out.hasVol = hasVol;
  out.pb = bottom - (hasVol ? (bottom - top) * 0.16 + 4 * k : 0);
  return out;
}
/* Which marks' words are said apart, each line's at its height, and which merge into one line at the top left: at the fit's scale (fit:
   flScreenFit's), a mark whose lines on the screen (two or more) all fall within one line of words (lh) is merged (m.merged, written on
   each mark shown; a mark whose fill has not played yet is not shown). Returns whether any shown mark has a line on the screen that is
   not merged — whether the column for the words is wanted at all */
function flMarksApart(marks, unshown, fit, top, lh) {
  let apart = false;
  const h = fit.pb - top;
  const span = fit.hi - fit.lo || 1;
  for (const m of marks) {
    m.merged = false;
    if (unshown.has(m.lead)) continue;
    let ylo = Infinity;
    let yhi = -Infinity;
    let n = 0;
    for (let j = 0; j < 3; j++) {
      const v = j === 0 ? m.entry : j === 1 ? m.tp : m.sl;
      if (!Number.isFinite(v)) continue;
      const y = top + ((fit.hi - v) / span) * h;
      if (y < top - 2 || y > fit.pb + 2) continue;
      ylo = Math.min(ylo, y);
      yhi = Math.max(yhi, y);
      n++;
    }
    m.merged = n >= 2 && yhi - ylo < lh;
    if (n >= 1 && !m.merged) apart = true;
  }
  return apart;
}
/* the marks' words laid out down the axis, in place: sorted by height, each pushed down to at least pitch below the one above, all kept
   between top and bottom (pushed back up from the bottom where they would run past it). labs: [{ y }] (centres); returns labs */
function flMarkLabels(labs, top, bottom, pitch) {
  labs.sort(flByY);
  const half = pitch / 2;
  for (let i = 0; i < labs.length; i++) {
    const lo = i ? labs[i - 1].y + pitch : top + half;
    if (labs[i].y < lo) labs[i].y = lo;
  }
  for (let i = labs.length - 1; i >= 0; i--) {
    const hi = i < labs.length - 1 ? labs[i + 1].y - pitch : bottom - half;
    if (labs[i].y > hi) labs[i].y = Math.max(top + half, hi);
  }
  return labs;
}
function flByY(a, b) {
  return a.y - b.y;
}
/* words on the chart over a small plate of the glass, as opaque as the glass itself, so no line and no bar shows through them; aligned
   "right" (ending at x) or "left" */
function flAxisWords(E, text, key, x, y, font, align) {
  const ctx = E.ctx;
  const w = flMeasure(E, font, text);
  const h = E.L.fs.tiny + 3;
  const lx = align === "right" ? x - w : x;
  ctx.fillStyle = flC(E, "glass");
  ctx.fillRect(lx - 3, y - h / 2, w + 6, h);
  ctx.fillStyle = flC(E, key);
  ctx.textAlign = "left";
  ctx.fillText(text, lx, y + 0.5);
}
/* What the wall screen says with no market in focus, from the scan the floor shows (the shown copy: it moves when the Head's cycle line
   plays, as the caption under the network does), so the screen and that caption never disagree:
     no scan yet                    "No market in focus" · "the screen waits for the desk's first scan"
     a scan that picked none        "No market picked yet" · "the last scan picked none of its 6 markets" (the caption beside it says
                                    "SCANNED 6 MARKETS AT 00:05 · PICKED 0")
     a scan that picked, no focus   "No market in focus" alone: the page gave the floor no market to chart (it charts the open lead's
                                    market, else the newest lead's, else the scan's top pick, at a venue it knows), and the floor
                                    does not guess why
   Pure; the screen keeps what it says until the scan changes (E.noneW) */
function flScreenNone(scan) {
  if (!scan) return { a: "No market in focus", b: "the screen waits for the desk's first scan" };
  const n = Array.isArray(scan.rows) ? scan.rows.length : 0;
  const picked = Array.isArray(scan.picked) ? scan.picked.length : 0;
  if (!picked) return { a: "No market picked yet", b: n ? `the last scan picked none of its ${n} market${n === 1 ? "" : "s"}` : "the last scan read no market" };
  return { a: "No market in focus", b: "" };
}
/* the screen's words when it has nothing to chart: a title, and under it why, wrapped (once per text and size) to the screen's width */
function flScreenMsg(E, a, b) {
  const ctx = E.ctx;
  const L = E.L;
  const r = L.screen;
  const fs = L.fs.small;
  const W = E.shotW;
  const f1 = flFont(E, fs + 1, false, 700);
  const f2 = flFont(E, fs, false, 400);
  const room = r.w - 16 * L.k;
  if (!W.ok || W.a !== a || W.b !== b || W.font !== f2 || W.w !== room) {
    W.ok = true;
    W.a = a;
    W.b = b;
    W.font = f2;
    W.w = room;
    W.l1 = flWrap(a, room, (x) => flMeasure(E, f1, x), 1);
    W.lines = b ? flWrap(b, room, (x) => flMeasure(E, f2, x), 2) : [];
  }
  const n = W.lines.length;
  const y0 = r.y + r.h / 2 - (n ? fs * 0.8 + (n - 1) * fs * 0.6 : 0);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  flSetFont(E, f1);
  ctx.fillStyle = flC(E, "text", 0.85);
  if (W.l1.length) ctx.fillText(W.l1[0], r.x + r.w / 2, y0);
  flSetFont(E, f2);
  ctx.fillStyle = flC(E, "dim");
  for (let i = 0; i < n; i++) ctx.fillText(W.lines[i], r.x + r.w / 2, y0 + fs * 1.7 + i * fs * 1.25);
  ctx.textAlign = "left";
}
/* round ticks for an axis: n or so steps of 1, 2, 2.5 or 5 times a power of ten inside lo..hi; written into out where given */
function flTicks(lo, hi, n, out) {
  const o = out || [];
  o.length = 0;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return o;
  const raw = (hi - lo) / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / mag;
  const step = (m >= 5 ? 5 : m >= 2.5 ? 2.5 : m >= 2 ? 2 : 1) * mag;
  const j0 = Math.ceil(lo / step);
  for (let j = j0; j * step <= hi + step * 1e-9 && o.length < 12; j++) o.push(Number((j * step).toPrecision(12)));
  return o;
}
/* the order and fill tags: a BUY/SELL tag at the order's price level (popped in when the beam lands, with a ripple), turned by a fill
   into "FILLED qty SYM @ price"; a tag for a market not on the screen sits in its right column */
function flDrawTags(E, t) {
  const ctx = E.ctx;
  const L = E.L;
  const k = L.k;
  for (const g of E.tags) {
    if (!g.on || t < g.born) continue;
    const pos = flTagPos(E, g);
    if (!pos) continue;
    const sc = g.sc.x;
    if (sc <= 0.01) continue;
    const fade = t > g.until ? 1 - (t - g.until) / 400 : 1;
    const mo = g.text2 ? flClamp(g.mo.x, 0, 1.1) : 0;
    const fsz = L.fs.tiny;
    const font = flFont(E, fsz, true, 600);
    const w1 = flMeasure(E, font, g.text) + 12 * k;
    const w2 = g.text2 ? flMeasure(E, font, g.text2) + 12 * k : w1;
    const w = flLerp(w1, w2, flClamp(mo, 0, 1));
    const h = fsz + 8;
    const x = pos.x - w;
    const y = pos.y - h / 2;
    ctx.save();
    ctx.globalAlpha = flClamp(fade, 0, 1);
    ctx.translate(pos.x, pos.y);
    ctx.scale(sc, sc);
    ctx.translate(-pos.x, -pos.y);
    if (!E.lite) {
      ctx.globalCompositeOperation = "lighter";
      flGlow(E, g.side === "sell" ? "down" : "mint", x + w / 2, pos.y, w * 0.7, 0.35);
      ctx.globalCompositeOperation = "source-over";
    }
    flRound(ctx, x, y, w, h, h / 2);
    ctx.fillStyle = flC(E, g.side === "sell" ? "down" : "mint");
    ctx.fill();
    // the pointer at the candle
    if (!pos.chip) {
      ctx.beginPath();
      ctx.moveTo(pos.x - 1, pos.y - 3 * k);
      ctx.lineTo(pos.x + 5 * k, pos.y);
      ctx.lineTo(pos.x - 1, pos.y + 3 * k);
      ctx.fill();
    }
    flSetFont(E, font);
    ctx.fillStyle = flC(E, "ink");
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const ty = pos.y + 0.5;
    if (mo < 1 && g.text2) {
      ctx.globalAlpha = flClamp(fade, 0, 1) * (1 - flClamp(mo, 0, 1));
      ctx.fillText(g.text, x + 6 * k, ty - mo * 6 * k);
      ctx.globalAlpha = flClamp(fade, 0, 1) * flClamp(mo, 0, 1);
      ctx.fillText(g.text2, x + 6 * k, ty + (1 - mo) * 6 * k);
    } else ctx.fillText(g.text2 || g.text, x + 6 * k, ty);
    flRestore(E);
  }
}
/* the crawler network: the scan's rows as nodes either side of the screen (size by volume, tint by change), the picked ones ringed and
   named, a thread from each picked node to the latest candle with light travelling along it; the scan's time and counts under it */
function flDrawNet(E, t) {
  const ctx = E.ctx;
  const L = E.L;
  const k = L.k;
  const S = E.scr;
  const sc = E.show.scan;
  if (!E.nodes.length) {
    if (sc && !sc.rows.length) {
      flSetFont(E, flFont(E, L.fs.tiny, true, 400));
      ctx.fillStyle = flC(E, "dim");
      ctx.textBaseline = "top";
      ctx.fillText("Last scan: no rows", L.net.x, L.wallBase - 0.06 * L.h);
    }
    return;
  }
  // the threads first, under the nodes — only where the screen has a latest candle to meet
  if (S && S.ok && Number.isFinite(S.lastX)) {
    for (const n of E.nodes) {
      if (!n.picked || n.gone || n.a.x < 0.05) continue;
      const ax = n.x.x;
      const ay = n.y.x;
      const dx = S.lastX;
      const dy = S.lastY;
      const toward = ax < dx ? 1 : -1;
      const bx = ax + toward * Math.abs(dx - ax) * 0.45;
      const by = ay;
      const cx = dx - toward * Math.abs(dx - ax) * 0.25;
      const cy = dy - 20 * k;
      ctx.strokeStyle = flC(E, "mint", 0.32 * n.a.x);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.bezierCurveTo(bx, by, cx, cy, dx, dy);
      ctx.stroke();
      if (!E.instant) {
        const pulses = E.lite ? 1 : 2;
        for (let i = 0; i < pulses; i++) {
          const u = (t / 1700 + i / pulses + (n.h % 1000) / 1000) % 1;
          flBezier(ax, ay, bx, by, cx, cy, dx, dy, u, E.pt);
          const a = Math.sin(u * Math.PI) * n.a.x;
          ctx.globalCompositeOperation = "lighter";
          flGlow(E, "mint", E.pt.x, E.pt.y, 7 * k, 0.7 * a);
          ctx.globalCompositeOperation = "source-over";
          ctx.fillStyle = flC(E, "mint", a);
          ctx.beginPath();
          ctx.arc(E.pt.x, E.pt.y, 1.4 * k, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }
  for (const n of E.nodes) {
    const a = n.a.x;
    if (a < 0.01) continue;
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.arc(n.x.x, n.y.x, n.r, 0, Math.PI * 2);
    if (n.hollow) {
      // a volume not known: an outline at a neutral size, never a small filled dot that would read as "the least traded"
      ctx.strokeStyle = n.col;
      ctx.lineWidth = 1;
      ctx.stroke();
    } else {
      ctx.fillStyle = n.col;
      ctx.fill();
    }
    if (n.picked) {
      ctx.strokeStyle = flC(E, "mint", 0.9);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(n.x.x, n.y.x, n.r + 2.5 * k, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  // the names: every node's base at rest where there are at most FL_NAMED_NODES (dim, the picked in the words' colour), else the
  // picked's only; and the one under the pointer with its change and volume
  flSetFont(E, flFont(E, L.fs.tiny, true, 500));
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  const hov = E.hoverNode;
  for (const n of E.nodes) {
    if (n.gone || n.a.x < 0.3 || !n.named || n.sym === hov) continue;
    ctx.globalAlpha = n.a.x;
    ctx.fillStyle = n.picked ? flC(E, "text") : flC(E, "dim");
    ctx.fillText(n.base, n.x.x, n.y.x - n.r - 3);
  }
  ctx.globalAlpha = 1;
  let hn = null;
  if (hov) for (const n of E.nodes) if (n.sym === hov && !n.gone) hn = n;
  if (hn) {
    if (!hn.peek) {
      // the node's words, made once: its change where known, its volume or "volume —"
      const chg = Number.isFinite(hn.change) ? `${hn.change >= 0 ? "▲" : "▼"} ${Math.abs(hn.change).toFixed(2)}%` : "";
      const vol = Number.isFinite(hn.vol) ? `${flCompact(hn.vol)} vol` : "volume —";
      hn.peek = [hn.sym, chg, vol].filter(Boolean).join(" · ");
    }
    const txt = hn.peek;
    const font = flFont(E, L.fs.tiny, true, 500);
    const w = flMeasure(E, font, txt) + 12 * k;
    const h = L.fs.tiny + 8;
    const x = flClamp(hn.x.x - w / 2, 4, L.w - w - 4);
    const y = hn.y.x - hn.r - h - 6 * k;
    flRound(ctx, x, y, w, h, 4);
    ctx.fillStyle = flC(E, "surface", 0.96);
    ctx.fill();
    ctx.strokeStyle = flC(E, "line");
    ctx.stroke();
    ctx.fillStyle = flC(E, "text");
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(txt, x + 6 * k, y + h / 2 + 0.5);
  }
  // the scan's caption, in words: when it ran, how many markets it read and how many it picked (laid out with the nodes: flScanCaption)
  const cap = E.cap;
  if (sc && cap && cap.text) {
    flTrack(E, 0.06);
    flSetFont(E, cap.font);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = flC(E, "dim");
    ctx.fillText(cap.text, cap.x, cap.y);
    flTrack(E, 0);
  }
  ctx.textAlign = "left";
}
/* the scan's caption under the screen's left: "SCANNED 6 MARKETS AT 22:17 · PICKED 1", or its short form "6 MARKETS · PICKED 1" where
   the long one would run past the screen's right edge; its box, which the nodes keep clear of. Made once per scan and size */
function flScanCaption(E, sc) {
  const L = E.L;
  const cap = E.cap || (E.cap = { scan: null, size: "", text: "", font: "", x: 0, y: 0, w: 0, h: 0 });
  const size = `${L.w}x${L.h}|${E.sans}`;
  if (cap.scan === sc && cap.size === size) return cap;
  cap.scan = sc;
  cap.size = size;
  cap.font = flFont(E, L.fs.tiny, true, 400);
  // it starts clear of the rack's words, which hang beside it under the rack
  const rw = flRackWordsBox(E);
  cap.x = Math.max(L.net.x, rw.x + rw.w + 8);
  cap.y = L.screen.y + L.screen.h + 6 * L.k;
  cap.h = L.fs.tiny + 1;
  if (!sc) {
    cap.text = "";
    cap.w = 0;
    return cap;
  }
  const n = sc.rows.length;
  const when = sc.at ? flWhen(sc.at, E.st.clock.zone) : "";
  const markets = `${n} MARKET${n === 1 ? "" : "S"}`;
  const long = `SCANNED ${markets}${when ? ` AT ${when}` : ""} · PICKED ${sc.picked.length}`;
  const short = `${markets} · PICKED ${sc.picked.length}`;
  const room = L.screen.x + L.screen.w - cap.x;
  cap.text = flMeasure(E, cap.font, long) * 1.06 <= room ? long : flMeasure(E, cap.font, short) * 1.06 <= room ? short : "";
  cap.w = cap.text ? flMeasure(E, cap.font, cap.text) * 1.06 : 0;
  return cap;
}
/* a scan's time as HH:MM in the clock's zone */
function flWhen(at, zone) {
  const d = new Date(typeof at === "number" ? at : String(at));
  if (Number.isNaN(d.getTime())) return "";
  const s = flClockText(d, zone);
  return s ? `${s.slice(0, 2)}:${s.slice(2, 4)}` : "";
}
/* an order's beam: from the firing seat's monitor to its tag on the wall screen, drawn out fast, held, faded */
function flDrawBeams(E, t, px, py) {
  const ctx = E.ctx;
  const L = E.L;
  for (const b of E.beams) {
    if (!b.on) continue;
    const s = L.seats[b.role];
    const g = flTagOf(E, b.lead, false);
    if (!s || !g) {
      b.on = false;
      continue;
    }
    const pos = flTagPos(E, g);
    if (!pos) continue;
    const f = s.layer === "back" ? 0.7 : 1;
    const ax = s.mon.x + s.mon.w / 2 + px * f;
    const ay2 = s.mon.y + py * f;
    const bx = pos.x + px * 0.35;
    const by = pos.y + py * 0.35;
    const e = t - b.t0;
    const head = flEaseOutCubic(e / 280);
    const a = e < 480 ? 1 : 1 - (e - 480) / 600;
    if (a <= 0) continue;
    const hx = flLerp(ax, bx, head);
    const hy = flLerp(ay2, by, head);
    if (!E.lite) {
      ctx.strokeStyle = flC(E, b.col, 0.14 * a);
      ctx.lineWidth = 6 * L.k;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(ax, ay2);
      ctx.lineTo(hx, hy);
      ctx.stroke();
    }
    ctx.strokeStyle = flC(E, b.col, 0.9 * a);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(ax, ay2);
    ctx.lineTo(hx, hy);
    ctx.stroke();
    ctx.lineCap = "butt";
    ctx.globalCompositeOperation = "lighter";
    flGlow(E, b.col, hx, hy, 10 * L.k, a);
    ctx.globalCompositeOperation = "source-over";
  }
}
/* the packets in the air: a trail behind each (tapering, fading), its glow, the small card with its side's glyph and its symbol */
function flDrawPackets(E) {
  const ctx = E.ctx;
  const L = E.L;
  const k = L.k;
  for (const p of E.packets) {
    if (!p.on) continue;
    const col = p.kind === "reject" ? "down" : p.kind === "card" ? "warn" : p.side === "sell" ? "down" : "mint";
    if (!E.lite && p.tn > 1) {
      ctx.lineCap = "round";
      for (let j = 1; j < p.tn; j++) {
        const i0 = (p.ti - p.tn + j - 1 + 32) % 16;
        const i1 = (p.ti - p.tn + j + 32) % 16;
        const u = j / p.tn;
        ctx.strokeStyle = flC(E, col, 0.5 * u * p.al);
        ctx.lineWidth = Math.max(0.5, 3.2 * k * u);
        ctx.beginPath();
        ctx.moveTo(p.trail[i0 * 2], p.trail[i0 * 2 + 1]);
        ctx.lineTo(p.trail[i1 * 2], p.trail[i1 * 2 + 1]);
        ctx.stroke();
      }
      ctx.lineCap = "butt";
    }
    ctx.globalCompositeOperation = "lighter";
    flGlow(E, col, p.x, p.y, 22 * k * p.sc, 0.55 * p.al);
    ctx.globalCompositeOperation = "source-over";
    const font = flFont(E, L.fs.tiny, true, 600);
    const glyph = p.kind === "reject" ? "✕" : p.side === "sell" ? "▼" : p.side === "buy" ? "▲" : "";
    const label = glyph ? `${glyph} ${p.sym}` : p.sym;
    const w = flMeasure(E, font, label) + 12 * k;
    const h = L.fs.tiny + 8;
    ctx.save();
    ctx.globalAlpha = p.al;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.ang);
    ctx.scale(p.sc, p.sc);
    flRound(ctx, -w / 2, -h / 2, w, h, 4 * k);
    ctx.fillStyle = flC(E, "surface");
    ctx.fill();
    ctx.strokeStyle = flC(E, col);
    ctx.lineWidth = 1;
    ctx.stroke();
    flSetFont(E, font);
    ctx.fillStyle = flC(E, col);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 0, 0.5);
    flRestore(E);
  }
  ctx.textAlign = "left";
}
function flDrawParticles(E) {
  const ctx = E.ctx;
  const P = E.P;
  if (!P.alive) return;
  // the glows first, additively, then the cores
  if (!E.lite && E.sprites) {
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < P.life.length; i++) {
      if (P.life[i] <= 0) continue;
      const kind = P.kind[i];
      if (kind !== 1 && kind !== 2) continue;
      const l = P.life[i] / P.max[i];
      const key = FL_PCOL[P.col[i]];
      const s = E.sprites[key === "dim" ? "text" : key];
      if (!s) continue;
      const r = P.size[i] * 4;
      ctx.globalAlpha = 0.5 * l;
      ctx.drawImage(s, P.x[i] - r, P.y[i] - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
  for (let i = 0; i < P.life.length; i++) {
    if (P.life[i] <= 0) continue;
    const l = P.life[i] / P.max[i];
    const kind = P.kind[i];
    const key = FL_PCOL[P.col[i]];
    if (kind === 3) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, l * 1.6) * 0.8;
      ctx.translate(P.x[i], P.y[i]);
      ctx.rotate(P.rot[i]);
      ctx.fillStyle = flC(E, "text");
      ctx.fillRect(-P.size[i] * 0.5, -P.size[i] * 1.8, P.size[i], P.size[i] * 3.6);
      flRestore(E);
    } else if (kind === 4) {
      ctx.globalAlpha = Math.sin(l * Math.PI) * 0.8;
      flSetFont(E, flFont(E, Math.round(P.size[i]), true, 500));
      ctx.fillStyle = flC(E, "dim");
      ctx.fillText("z", P.x[i], P.y[i]);
    } else {
      ctx.globalAlpha = l;
      const r = P.size[i] * (0.6 + 0.4 * l);
      ctx.fillStyle = flC(E, key);
      ctx.fillRect(P.x[i] - r / 2, P.y[i] - r / 2, r, r);
    }
  }
  ctx.globalAlpha = 1;
}
function flDrawRings(E, t, px, py) {
  const ctx = E.ctx;
  for (const r of E.rings) {
    if (!r.on || t < r.t0) continue;
    const p = (t - r.t0) / r.dur;
    if (p >= 1) continue;
    const e = flEaseOutCubic(p);
    const f = r.wall ? 0.35 : 0.85;
    ctx.strokeStyle = flC(E, r.col, Math.pow(1 - p, 1.5) * 0.9);
    ctx.lineWidth = Math.max(0.6, r.lw * (1 - p * 0.6));
    ctx.beginPath();
    ctx.arc(r.x + px * f, r.y + py * f, r.r0 + (r.r1 - r.r0) * e, 0, Math.PI * 2);
    ctx.stroke();
  }
}
/* the figure an exit leaves: its why and its P&L in words, rising off the wall screen and fading */
function flDrawFloats(E, t) {
  const ctx = E.ctx;
  const L = E.L;
  for (const f of E.floats) {
    if (!f.on) continue;
    const p = flClamp((t - f.t0) / f.dur, 0, 1);
    const a = E.instant ? 1 : p < 0.1 ? p / 0.1 : p > 0.7 ? 1 - (p - 0.7) / 0.3 : 1;
    const y = f.y - flEaseOutCubic(p) * f.rise - 10 * L.k;
    flSetFont(E, flFont(E, L.fs.small + 2, true, 600));
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.globalAlpha = a;
    ctx.fillStyle = flC(E, "bg", 0.75);
    const w = flMeasure(E, flFont(E, L.fs.small + 2, true, 600), f.text) + 12 * L.k;
    flRound(ctx, f.x - w / 2, y - L.fs.small - 6, w, L.fs.small + 8, 4);
    ctx.fill();
    ctx.fillStyle = flC(E, f.col);
    ctx.fillText(f.text, f.x, y);
    ctx.globalAlpha = 1;
  }
  ctx.textAlign = "left";
}
/* where an actor's bubble points: over its mascot's head (higher while a thought bubble shows), over the tray for the owner, over the
   rack for the account; written into one object kept for it */
function flBubbleAnchor(E, actor, px, py) {
  const L = E.L;
  const s = L.seats[actor];
  const out = E.anc || (E.anc = { x: 0, y: 0, s: 1 });
  if (s) {
    const f = s.layer === "back" ? 0.7 : 1;
    const ch = E.chars[actor];
    out.x = s.char.x + px * f;
    out.y = s.char.y - s.char.h * 1.06 - 4 * s.s - (ch && ch.think ? 22 * s.s : 0) + py * f;
    out.s = s.s;
    return out;
  }
  if (actor === "you") {
    const T = E.tray || L.tray;
    out.x = T.x + T.w / 2 + px;
    out.y = T.y - 6 * L.k + py;
    out.s = L.k;
    return out;
  }
  if (actor === "account") {
    out.x = L.rack.x + L.rack.w / 2 + px * 0.35;
    out.y = L.rack.y - 8 * L.k + py * 0.35;
    out.s = L.k;
    return out;
  }
  return null;
}
/* where a bubble w × h whose tail points at (ax, ay) sits, clear of the first n boxes in rects (the seats' labels and the bubbles placed
   before it) and inside a floor W wide: straight above its speaker if that is clear, else a little to one side or the other (FL_BUB_DX),
   lifted over what it would still cover — the clear place nearest its speaker wins, a step sideways costing a little less than a step
   up; none clear: the one that covers least. Written into out ({ x, y }); returns out */
function flPlace(ax, ay, w, h, gap, W, rects, n, out) {
  const y0 = ay - gap - h;
  const home = flClamp(ax - w / 2, 4, W - w - 4);
  let best = Infinity;
  out.x = home;
  out.y = Math.max(4, y0);
  for (let c = 0; c < FL_BUB_DX.length; c++) {
    const x = flClamp(ax - w / 2 + FL_BUB_DX[c] * w, 4, W - w - 4);
    if (c > 0 && x === home) continue;
    let y = y0;
    for (let guard = 0; guard < 8; guard++) {
      let hit = -1;
      for (let i = 0; i < n; i++) {
        const r = rects[i];
        if (x < r.x + r.w + 3 && x + w + 3 > r.x && y < r.y + r.h + 3 && y + h + 3 > r.y) {
          hit = i;
          break;
        }
      }
      if (hit < 0) break;
      y = rects[hit].y - h - 4;
    }
    const yy = Math.max(4, y);
    let cover = 0;
    for (let i = 0; i < n; i++) {
      const r = rects[i];
      const ox = Math.min(x + w, r.x + r.w) - Math.max(x, r.x);
      const oy = Math.min(yy + h, r.y + r.h) - Math.max(yy, r.y);
      if (ox > 0 && oy > 0) cover += ox * oy;
    }
    // a step up costs more than a step aside: a bubble lifted far from its speaker reads as someone else's
    const cost = cover * 1000 + Math.abs(x - home) * 0.6 + (y0 - yy) * 2;
    if (cost < best) {
      best = cost;
      out.x = x;
      out.y = yy;
    }
  }
  return out;
}
/* the speech bubbles: popped in on a spring (to 106 % and back), typed out at 45 characters a second with a caret, held, then lifted
   away as they fade. The newest few only (two on a narrow floor), each placed clear of the seats' labels and of the bubbles placed
   before it (flPlace) */
function flDrawBubbles(E, t, px, py) {
  const ctx = E.ctx;
  const L = E.L;
  // the oldest first, so the newest is placed last, around the others
  const order = E.bOrder;
  order.length = 0;
  for (const b of E.bubbleList) if (b.on && b.lines.length && t <= b.end + 320) order.push(b);
  order.sort(flByStart);
  const cap = flBubbleCap(L);
  const skip = Math.max(0, order.length - cap);
  // the obstacles: every seat's label (where it is drawn, with the parallax of its row), then the bubbles as they are placed
  const rects = E.obs;
  let placed = 0;
  for (const role of FL_ROLES) {
    const lab = E.labels[role];
    if (!lab || placed >= rects.length) continue;
    const f = L.seats[role].layer === "back" ? 0.7 : 1;
    const r = rects[placed++];
    r.x = lab.x0 + px * f;
    r.y = lab.y + py * f;
    r.w = lab.x1 - lab.x0;
    r.h = lab.h;
  }
  // and the owner's tray with its words (the wall's own words a bubble may cover while it speaks: lifting it over them would take it
  // from its speaker and over the scan)
  const T = flTrayShown(E) ? E.tray : null;
  if (T && T.w > 0 && placed < rects.length) {
    const r = rects[placed++];
    r.x = T.x + px;
    r.y = T.y + py;
    r.w = T.w;
    r.h = T.h;
  }
  for (let oi = skip; oi < order.length; oi++) {
    const b = order[oi];
    const key = b.actor;
    const an = flBubbleAnchor(E, key, px, py);
    if (!an) continue;
    const age = t - b.start;
    const out = t > b.end ? flClamp((t - b.end) / 320, 0, 1) : 0;
    if (out >= 1) continue;
    const k = L.k;
    const w = b.w;
    const h = b.h;
    const tail = 5 * Math.max(0.7, k);
    const lift = flEaseInCubic(out) * 10 * k;
    const at = flPlace(an.x, an.y - lift, w, h, tail, L.w, rects, placed, E.place);
    const bx = at.x;
    const by = at.y;
    if (placed < rects.length) {
      const r = rects[placed++];
      r.x = bx;
      r.y = by;
      r.w = w;
      r.h = h;
    }
    const tipY = an.y - lift;
    const sc = E.instant ? 1 : b.sc.x;
    ctx.save();
    ctx.globalAlpha = 1 - out;
    ctx.translate(an.x, tipY);
    ctx.scale(sc, sc);
    ctx.translate(-an.x, -tipY);
    flBubblePath(ctx, bx, by, w, h, 8 * Math.max(0.7, k), an.x, tipY, tail);
    ctx.fillStyle = flC(E, "surface", 0.97);
    ctx.fill();
    const acc = flAccent(b.kind);
    ctx.strokeStyle = acc ? flC(E, acc, 0.55) : flC(E, "mint", 0.24);
    ctx.lineWidth = 1;
    ctx.stroke();
    let tx = bx + b.padX;
    if (acc) {
      ctx.fillStyle = flC(E, acc);
      ctx.fillRect(bx + b.padX * 0.5, by + b.padY, 2, h - b.padY * 2);
      tx += 4;
    }
    // the words, typed: as many characters as the time since it opened allows
    const shown = b.typeMs > 0 && !E.instant ? Math.floor((age / 1000) * FL_TYPE_CPS) : b.chars;
    const font = flFont(E, b.fs, false, 400);
    flSetFont(E, font);
    ctx.fillStyle = flC(E, "text");
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    let left = shown;
    let cx = tx;
    let cy = by + b.padY + b.lineH / 2;
    for (let i = 0; i < b.lines.length; i++) {
      const ln = b.lines[i];
      const y = by + b.padY + b.lineH * (i + 0.5) + 0.5;
      if (left <= 0) break;
      if (left >= ln.length) {
        ctx.fillText(ln, tx, y);
        cx = tx + flMeasure(E, font, ln);
        cy = y;
        left -= ln.length;
      } else {
        const part = ln.slice(0, left);
        ctx.fillText(part, tx, y);
        cx = tx + (ctx.measureText ? ctx.measureText(part).width : part.length * b.fs * 0.55);
        cy = y;
        left = 0;
      }
    }
    // the caret, while it types and a moment after
    if (!E.instant && b.typeMs > 0 && age < b.typeMs + 450 && (age < b.typeMs || Math.floor(age / 260) % 2 === 0)) {
      ctx.fillStyle = flC(E, "mint");
      ctx.fillRect(cx + 1, cy - b.fs * 0.5, Math.max(1, 1.4 * k), b.fs);
    }
    flRestore(E);
  }
}
/* the room's state across the top of the floor: a halt in coral with its real why (the why's line in amber), a pause, an end, no
   session — each in plain words */
function flDrawBanner(E, t) {
  const ctx = E.ctx;
  const L = E.L;
  const sess = E.st.session.state;
  const pop = E.banner.x;
  E.bannerAt = null;
  if (sess === "live" || pop <= 0.01) return;
  const k = L.k;
  let title = "";
  let why = "";
  let col = "dim";
  if (sess === "halted") {
    title = "DESK HALTED";
    why = (E.st.session.halted && E.st.session.halted.why) || "";
    col = "down";
  } else if (sess === "paused") title = "PAUSED";
  else if (sess === "ended") title = "SESSION ENDED";
  else title = "NO SESSION RUNNING";
  const fs = L.fs.small;
  const maxW = Math.min(L.w * 0.6, 520 * k);
  const font2 = flFont(E, fs, false, 400);
  // the why wrapped once per why and size, not per frame
  const BW = E.bannerW;
  if (!BW.ok || BW.why !== why || BW.font !== font2 || BW.maxW !== maxW) {
    BW.ok = true;
    BW.why = why;
    BW.font = font2;
    BW.maxW = maxW;
    BW.lines = why ? flWrap(why, maxW - 28 * k, (s) => flMeasure(E, font2, s), 2) : [];
  }
  const lines = BW.lines;
  flTrack(E, 0.12);
  const font1 = flFont(E, fs + 1, true, 600);
  const tw = flMeasure(E, font1, title) + title.length * (fs + 1) * 0.12;
  flTrack(E, 0);
  let w = tw;
  for (const ln of lines) w = Math.max(w, flMeasure(E, font2, ln));
  w += 28 * k;
  const h = (fs + 1) * 1.4 + lines.length * fs * 1.4 + 14 * k;
  const x = L.w / 2 - w / 2;
  // between the back row's names and the front row's heads
  const y = flBannerY(E, h);
  const B = E.bannerBox || (E.bannerBox = { y: 0, h: 0 });
  B.y = y;
  B.h = h;
  E.bannerAt = B;
  ctx.save();
  ctx.translate(L.w / 2, y);
  ctx.scale(pop, pop);
  ctx.translate(-L.w / 2, -y);
  flRound(ctx, x, y, w, h, 8 * k);
  ctx.fillStyle = flC(E, "bg", 0.94);
  ctx.fill();
  if (col === "down") {
    ctx.fillStyle = flC(E, "down", 0.12);
    ctx.fill();
    const fresh = t - E.haltAt;
    if (!E.instant && fresh >= 0 && fresh < 900) {
      ctx.globalCompositeOperation = "lighter";
      flGlow(E, "down", L.w / 2, y + h / 2, w * 0.7, 0.4 * (1 - fresh / 900));
      ctx.globalCompositeOperation = "source-over";
    }
  }
  ctx.strokeStyle = col === "down" ? flC(E, "down", 0.8) : flC(E, "line");
  ctx.lineWidth = 1;
  flRound(ctx, x, y, w, h, 8 * k);
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  flTrack(E, 0.12);
  flSetFont(E, font1);
  ctx.fillStyle = col === "down" ? flC(E, "down") : flC(E, "text", 0.85);
  ctx.fillText(title, L.w / 2, y + 7 * k);
  flTrack(E, 0);
  flSetFont(E, font2);
  ctx.fillStyle = flC(E, "warn");
  let ly = y + 7 * k + (fs + 1) * 1.4;
  for (const ln of lines) {
    ctx.fillText(ln, L.w / 2, ly);
    ly += fs * 1.4;
  }
  flRestore(E);
  ctx.textAlign = "left";
}

/* ---- the handle ------------------------------------------------------------------------------------------------------------------ */

/* the floor on a canvas: see the top of this file */
function flMount(canvas, opts = {}) {
  const E = flEngine(canvas, opts);
  flWire(E);
  flResize(E);
  flKick(E);
  if (!E.running) flStillFrame(E);
  return {
    set: (state) => flSet(E, state),
    push: (event) => flPush(E, event),
    release: () => flRelease(E),
    stats: () => flStats(E),
  };
}
