import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createContext, runInContext, Script } from "node:vm";
import { describe, expect, it } from "vitest";

/** The floor (ui/floor.js): the superagent's desk drawn as a trading floor on one canvas, run as the page runs it — a plain script in one
 * global scope after ui/core.js — here in a vm. Its pure parts are read directly: the room's layout at any size, the springs and the arcs
 * every motion is made of, the per-actor (and per-lead) event queue, the scan's deterministic node layout, the tape's seamless loop, a
 * node's colour, the wrapping of a bubble's words, crisp lines, the palette read from the container, the site's rule for a slow machine,
 * the floor in words. Mounted on a stand-in canvas whose context records what is drawn, the engine is read for what the owner sees:
 * nothing drawn from no data (each empty place says so in words), empty seats saying why, a halt's real why, one still frame per set()
 * and push() under reduced motion and no loop at all, a loop that measures its frames and stops while the page is hidden, the lite
 * setting after slow frames, a typed bubble, picking a seat or the screen, and everything stopped on release. In the trading area: its
 * tokens read before the floor's own fallbacks, seats not read yet drawn as placeholders, the owner's tray in true words, a stale floor
 * veiled, the font set again after every restore, no word under 9 px or cut, the marks' words laid apart, the market and the scan in
 * words, and the story before the state (the shredder, the funnel and the screen move when their events play; the Head's cycle line
 * waits for the cycle; a session that ends lets what waits go); and a floor that rests while nothing moves. */
const UI = fileURLToPath(new URL("../../src/portfolio/public/ui/", import.meta.url));
const FILES = ["core.js", "floor.js"];
const SOURCE = readFileSync(`${UI}floor.js`, "utf8");

type Fn = (...a: unknown[]) => unknown;
interface Registry {
  on: Map<string, Set<Fn>>;
  add(t: string, fn: Fn): void;
  remove(t: string, fn: Fn): void;
  fire(t: string, e?: Record<string, unknown>): void;
  count(): number;
}
function registry(): Registry {
  const on = new Map<string, Set<Fn>>();
  return {
    on,
    add: (t, fn) => {
      if (!on.has(t)) on.set(t, new Set());
      on.get(t)!.add(fn);
    },
    remove: (t, fn) => void on.get(t)?.delete(fn),
    fire: (t, e = {}) => {
      for (const fn of [...(on.get(t) ?? [])]) fn({ preventDefault() {}, ...e });
    },
    count: () => [...on.values()].reduce((a, s) => a + s.size, 0),
  };
}

/** a 2D context that draws nothing and remembers: every text written (fillText), how many rectangles were filled, every call by name, and
 * in order what was written, filled and stroked with the style (and, for words, the font and the opacity) it was drawn in. Like a real
 * canvas it keeps its font, letter spacing, opacity and styles on a stack that save() pushes and restore() pops */
function recorder() {
  const texts: string[] = [];
  const calls = new Map<string, number>();
  const seq: Array<{ op: string; style: string; args: unknown[]; font?: string; alpha?: number; base?: string }> = [];
  const state: Record<string, unknown> = { font: "10px sans-serif", letterSpacing: "0px", globalAlpha: 1 };
  const stack: Array<Record<string, unknown>> = [];
  const grad = { addColorStop() {} };
  const target: Record<string, unknown> = {};
  const ctx = new Proxy(target, {
    get(_t, k: string) {
      if (k in state) return state[k];
      if (k === "measureText")
        return (s: string) => {
          const px = Number(/(\d+(?:\.\d+)?)px/.exec(String(state.font))?.[1] ?? 10);
          return { width: String(s).length * px * 0.6 };
        };
      if (k === "createLinearGradient" || k === "createRadialGradient") return () => grad;
      if (k === "createPattern") return () => ({});
      if (k === "then") return undefined;
      return (...a: unknown[]) => {
        calls.set(k, (calls.get(k) ?? 0) + 1);
        if (k === "save") stack.push({ ...state });
        if (k === "restore" && stack.length) Object.assign(state, stack.pop());
        if (k === "fillText") texts.push(String(a[0]));
        if (k === "fillText") seq.push({ op: k, style: String(state.fillStyle), args: a, font: String(state.font), alpha: Number(state.globalAlpha), base: String(state.textBaseline) });
        if (k === "fillRect") seq.push({ op: k, style: String(state.fillStyle), args: a, alpha: Number(state.globalAlpha) });
        if (k === "stroke" || k === "strokeRect") seq.push({ op: k, style: String(state.strokeStyle), args: a });
      };
    },
    set(_t, k: string, v) {
      state[k] = v;
      return true;
    },
    has(_t, k: string) {
      return k in state;
    },
  });
  return { ctx, texts, calls, seq, clear: () => (texts.length = 0, calls.clear(), seq.length = 0) };
}

interface Opts {
  raf?: boolean;
  reduced?: boolean;
  dpr?: number;
  io?: boolean;
  size?: { w: number; h: number };
  css?: Record<string, string>;
  innerWidth?: number;
}
/** the page around the floor: a clock the test turns, frames the test hands out (where it has frames at all), a document that can be
 * hidden, and a canvas whose size and listeners the test reads */
function page(opts: Opts = {}) {
  const size = opts.size ?? { w: 1600, h: 700 };
  const clock = { t: 1000 };
  const frames = new Map<number, (t: number) => void>();
  let nextId = 1;
  const counts = { raf: 0, cancel: 0, createElement: 0, matchMedia: 0, listen: 0, ioDisconnect: 0, rect: 0 };
  const win = registry();
  const doc = registry();
  const cv = registry();
  const rec = recorder();
  const attrs = new Map<string, string>();
  const ios: Array<(es: Array<{ isIntersecting: boolean }>) => void> = [];
  const canvas = {
    width: 300,
    height: 150,
    style: {} as Record<string, string>,
    get clientWidth() {
      return size.w;
    },
    get clientHeight() {
      return size.h;
    },
    parentElement: null,
    getContext: () => rec.ctx,
    getBoundingClientRect: () => (counts.rect++, { left: 0, top: 0, width: size.w, height: size.h }),
    setAttribute: (k: string, v: unknown) => void attrs.set(k, String(v)),
    getAttribute: (k: string) => attrs.get(k) ?? null,
    addEventListener: (t: string, fn: Fn) => cv.add(t, fn),
    removeEventListener: (t: string, fn: Fn) => cv.remove(t, fn),
  };
  const document = {
    hidden: false,
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    documentElement: { dataset: { theme: "cream" } },
    addEventListener: (t: string, fn: Fn) => (counts.listen++, doc.add(t, fn)),
    removeEventListener: (t: string, fn: Fn) => doc.remove(t, fn),
  };
  const sandbox: Record<string, unknown> = {
    document,
    location: { hash: "", origin: "http://127.0.0.1:4820" },
    history: { replaceState() {} },
    console,
    URLSearchParams,
    Intl,
    setTimeout,
    clearTimeout,
    addEventListener: (t: string, fn: Fn) => (counts.listen++, win.add(t, fn)),
    removeEventListener: (t: string, fn: Fn) => win.remove(t, fn),
    performance: { now: () => clock.t },
  };
  if (opts.dpr) sandbox.devicePixelRatio = opts.dpr;
  if (opts.innerWidth) sandbox.innerWidth = opts.innerWidth;
  if (opts.raf) {
    sandbox.requestAnimationFrame = (fn: (t: number) => void) => {
      counts.raf++;
      const id = nextId++;
      frames.set(id, fn);
      return id;
    };
    sandbox.cancelAnimationFrame = (id: number) => {
      counts.cancel++;
      frames.delete(id);
    };
  }
  if (opts.reduced !== undefined)
    sandbox.matchMedia = (q: string) => (counts.matchMedia++, { matches: !!opts.reduced && /reduced-motion/.test(q), addEventListener() {}, removeEventListener() {} });
  if (opts.io)
    sandbox.IntersectionObserver = class {
      constructor(fn: (es: Array<{ isIntersecting: boolean }>) => void) {
        ios.push(fn);
      }
      observe() {}
      disconnect() {
        counts.ioDisconnect++;
      }
    };
  if (opts.css) {
    const css = opts.css;
    sandbox.getComputedStyle = () => ({ getPropertyValue: (k: string) => css[k] ?? "" });
  }
  const ctx = createContext(sandbox);
  sandbox.window = runInContext("globalThis", ctx);
  // what core.js does as it loads is its own; what floor.js adds is counted apart
  let afterCore = { ...counts };
  for (const f of FILES) {
    new Script(readFileSync(`${UI}${f}`, "utf8"), { filename: f }).runInContext(ctx);
    if (f === "core.js") afterCore = { ...counts };
  }
  const byFloor = Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v - afterCore[k as keyof typeof counts]]));
  const baseline = { doc: doc.count(), win: win.count() };
  sandbox.CANVAS = canvas;
  const run = <T = unknown>(code: string): T => runInContext(code, ctx) as T;
  /** hand out one frame at time t (each callback the floor asked for, once) */
  const frame = (t: number) => {
    clock.t = t;
    const due = [...frames.entries()];
    frames.clear();
    for (const [, fn] of due) fn(t);
  };
  return { run, sandbox, clock, frame, frames, counts, byFloor, baseline, rec, canvas, cv, doc, win, ios, attrs, size };
}

/** a desk's state as the page hands it over, with what a test changes */
function state(extra: Record<string, unknown> = {}) {
  const H = 3_600_000;
  const candles = Array.from({ length: 30 }, (_, i) => ({ t: i * H, o: 100 + i, h: 102 + i, l: 99 + i, c: 101 + i, v: 10 + i }));
  return {
    session: { state: "live" },
    seats: ["head", "search", "risk", "sniper", "exit", "watch"].map((role) => ({ role, name: `Desk ${role}`, kind: "house", status: "ok" })),
    working: null,
    inFlight: 0,
    brain: { ok: true },
    focus: { symbol: "SOL", name: "Solana", kind: "perp", candles, price: 130.5, priceStep: 0.01, marks: [] },
    scan: null,
    funnel: { scanned: 40, cleared: 4, executed: 2, closed: 1, rejected: 3 },
    rejected: 3,
    target: { progressPct: 42 },
    equity: { nowUsd: 10_420, startUsd: 10_000 },
    ticker: [],
    clock: { zone: "America/New_York" },
    ...extra,
  };
}
const bare = { session: { state: "live" }, seats: [], working: null, inFlight: 0, focus: null, scan: null, ticker: [], clock: { zone: "America/New_York" } };

describe("the floor's pure parts", () => {
  it("declares only fl/FL names at the top level, and touches nothing as it loads", () => {
    const names = [...SOURCE.matchAll(/^(?:async\s+)?function\s*\*?\s*([\w$]+)|^(?:const|let|var|class)\s+([\w$]+)/gm)].map((m) => m[1] ?? m[2]);
    expect(names.length).toBeGreaterThan(40);
    expect(names.filter((n) => !/^(fl|FL)[A-Z_]/.test(n!))).toEqual([]);
    expect(new Set(names).size).toBe(names.length);
    // loading it (after core.js) asks for no frame, hangs no listener, asks no media query, makes no element
    const p = page({ raf: true, reduced: false });
    expect(p.byFloor).toEqual({ raf: 0, cancel: 0, createElement: 0, matchMedia: 0, listen: 0, ioDisconnect: 0, rect: 0 });
    expect(p.run("typeof flMount")).toBe("function");
  });

  it("lays the room out at any size: every station inside the canvas and clear of its neighbours, the pipeline left to right along the back row, the Head front-right", () => {
    const p = page();
    const sizes: Array<[number, number]> = [[1600, 700], [1200, 525], [900, 394], [375, 300], [375, 420]];
    for (const [w, h] of sizes) {
      const L = p.run<any>(`flLayout(${w}, ${h})`);
      const at = `${w}×${h}`;
      expect(Object.keys(L.seats).sort(), at).toEqual(["exit", "flow", "head", "risk", "search", "sentiment", "sniper", "watch"]);
      for (const role of Object.keys(L.seats)) {
        const b = L.seats[role].box;
        expect(b.x0, `${at} ${role}`).toBeGreaterThanOrEqual(0);
        expect(b.x1, `${at} ${role}`).toBeLessThanOrEqual(w);
        expect(b.y0, `${at} ${role}`).toBeGreaterThanOrEqual(L.wallBase - 2);
        expect(b.y1, `${at} ${role}`).toBeLessThanOrEqual(h);
      }
      // stations in one row never overlap
      for (const row of [["search", "risk", "sniper", "exit"], ["flow", "sentiment", "watch", "head"]])
        for (let i = 1; i < row.length; i++) expect(L.seats[row[i - 1]!].box.x1, `${at} ${row[i]}`).toBeLessThan(L.seats[row[i]!].box.x0);
      const x = (r: string) => L.seats[r].x;
      expect(x("search") < x("risk") && x("risk") < x("sniper") && x("sniper") < x("exit"), at).toBe(true);
      expect(Math.max(x("flow"), x("sentiment"), x("watch")), at).toBeLessThan(x("head"));
      expect(L.seats.head.y, at).toBeGreaterThan(L.seats.search.y);
      // a back seat is drawn smaller than a front one; the draw order goes back to front
      expect(L.seats.search.s, at).toBeLessThan(L.seats.head.s);
      expect(L.order.slice(0, 4).sort(), at).toEqual(["exit", "risk", "search", "sniper"]);
      // the wall's fixtures are on the canvas, the screen in its middle, above the floor
      for (const f of ["screen", "ticker", "clock", "rack", "trophy", "shredder", "tray"]) {
        const r = L[f];
        expect(r.x >= 0 && r.y >= 0 && r.x + r.w <= w + 0.01 && r.y + r.h <= h + 0.01, `${at} ${f}`).toBe(true);
      }
      expect(Math.abs(L.screen.x + L.screen.w / 2 - w / 2), at).toBeLessThan(1);
      expect(L.screen.y + L.screen.h, at).toBeLessThan(L.wallBase);
      // the house's mono labels: 9–11 px
      expect(L.fs.label >= 9 && L.fs.label <= 11, at).toBe(true);
      // the same size, the same room
      expect(JSON.stringify(p.run(`flLayout(${w}, ${h})`))).toBe(JSON.stringify(L));
    }
  });

  it("moves on springs: a pop overshoots by about 6 % and settles, a soft spring never overshoots, the same at 60 Hz and 120 Hz, a stalled frame capped at 50 ms", () => {
    const p = page();
    const peak = p.run<number>(`(() => { const s = { x: 0, v: 0 }; let m = 0; for (let i = 0; i < 240; i++) m = Math.max(m, flSpring(s, 1, 1000 / 120, ...FL_SPRING.pop)); return m; })()`);
    expect(peak).toBeGreaterThan(1.05);
    expect(peak).toBeLessThan(1.07);
    expect(p.run(`(() => { const s = { x: 0, v: 0 }; for (let i = 0; i < 400; i++) flSpring(s, 1, 1000 / 120, ...FL_SPRING.pop); return s.x; })()`)).toBe(1);
    expect(p.run<number>(`(() => { const s = { x: 0, v: 0 }; let m = 0; for (let i = 0; i < 600; i++) m = Math.max(m, flSpring(s, 1, 1000 / 120, ...FL_SPRING.soft)); return m; })()`)).toBeLessThanOrEqual(1);
    const at = (hz: number) => p.run<number>(`(() => { const s = { x: 0, v: 0 }; for (let i = 0; i < ${hz / 4}; i++) flSpring(s, 1, 1000 / ${hz}, ...FL_SPRING.pop); return s.x; })()`);
    expect(Math.abs(at(60) - at(120))).toBeLessThan(1e-3);
    expect(p.run(`(() => { const a = { x: 0, v: 0 }, b = { x: 0, v: 0 }; flSpring(a, 1, 1000, ...FL_SPRING.pop); flSpring(b, 1, 50, ...FL_SPRING.pop); return a.x === b.x && a.v === b.v; })()`)).toBe(true);
    // the easings start at 0 and end at 1; out-back passes 1 on its way
    expect(p.run("[flEaseOutCubic(0), flEaseOutCubic(1), flEaseInOutCubic(0), flEaseInOutCubic(0.5), flEaseInOutCubic(1), flEaseOutBack(1)]")).toEqual([0, 1, 0, 0.5, 1, 1]);
    expect(p.run<number>("flEaseOutBack(0)")).toBeCloseTo(0, 12);
    expect(p.run<number>("flEaseOutBack(0.6)")).toBeGreaterThan(1);
  });

  it("throws a packet along an arc that rises above both ends and lands exactly on its catcher", () => {
    const p = page();
    p.run("globalThis.ARC = flArc(100, 400, 500, 380, undefined, {})");
    const A = p.run<{ bx: number; by: number; cx: number; cy: number }>("ARC");
    expect(A.by).toBeLessThan(380);
    expect(A.cy).toBeLessThan(380);
    const pt = (t: number) => p.run<{ x: number; y: number }>(`flBezier(100, 400, ARC.bx, ARC.by, ARC.cx, ARC.cy, 500, 380, ${t}, {})`);
    expect(pt(0)).toEqual({ x: 100, y: 400 });
    expect(pt(1)).toEqual({ x: 500, y: 380 });
    expect(pt(0.5).y).toBeLessThan(380);
    let last = -Infinity;
    for (let t = 0; t <= 1.0001; t += 0.1) {
      const x = pt(Math.min(1, t)).x;
      expect(x).toBeGreaterThanOrEqual(last);
      last = x;
    }
    // a longer throw rises higher, up to 220 px
    expect(p.run<number>("flArc(0, 0, 900, 0, undefined, {}).by")).toBeLessThan(p.run<number>("flArc(0, 0, 200, 0, undefined, {}).by"));
    expect(p.run("flArc(0, 0, 5000, 0, undefined, {}).by")).toBe(-220);
  });

  it("plays events in order per actor and per lead: a second line waits for the first bubble, a verdict waits for its lead's packet to land, other actors go at once", () => {
    const p = page();
    p.run(`globalThis.Q = flQueueNew(); globalThis.OUT = []; globalThis.STARTED = [];
      globalThis.GATE = (e) => { STARTED.push(e.ev.type + ":" + e.actor + (e.lead ? ":" + e.lead : "")); return e.ev.type === "say" ? { busy: 500, bubble: 3000 } : e.ev.type === "handoff" ? { busy: 200, lead: 1200 } : { busy: 0 }; };
      globalThis.DUE = (t) => flQueueDue(Q, t, GATE, OUT).map((e) => e.ev.type + ":" + e.actor);`);
    p.run(`flQueuePush(Q, { type: "say", role: "search", text: "LEAD L-0049 | SOL" }, 0);
      flQueuePush(Q, { type: "handoff", lead: "L-0049", symbol: "SOL", side: "buy", from: "search", to: "risk" }, 0);
      flQueuePush(Q, { type: "say", role: "risk", text: "RISK CLEARANCE L-0049 | Verdict: CLEAR" }, 0);
      flQueuePush(Q, { type: "say", role: "head", text: "Cycle 12" }, 0);
      flQueuePush(Q, { type: "say", role: "search", text: "no other lead" }, 0);`);
    // at once: Search's line and the Head's (another actor); Risk's verdict names L-0049, which Search's line also names, so it waits
    expect(p.run("DUE(0)")).toEqual(["say:search", "say:head"]);
    // Search typed for 500 ms: then its packet lifts; Search's second line still waits for the first bubble
    expect(p.run("DUE(499)")).toEqual([]);
    expect(p.run("DUE(500)")).toEqual(["handoff:search"]);
    // the packet is in the air until 1700: Risk, free all along, says its verdict only then
    expect(p.run("DUE(1699)")).toEqual([]);
    expect(p.run("DUE(1700)")).toEqual(["say:risk"]);
    expect(p.run("DUE(2999)")).toEqual([]);
    expect(p.run("DUE(3000)")).toEqual(["say:search"]);
    expect(p.run("Q.list.length")).toBe(0);
    // a fill waits on the actor that fired its lead's order; an exit too
    p.run(`flQueuePush(Q, { type: "order", lead: "L-7", symbol: "SOL", side: "buy", usd: 250, role: "sniper" }, 0)`);
    expect(p.run(`flActorOf(Q, { type: "fill", lead: "L-7" })`)).toBe("sniper");
    expect(p.run(`flActorOf(Q, { type: "fill", lead: "L-8" })`)).toBe("screen");
    expect(p.run(`flActorOf(Q, { type: "reject", from: "risk" })`)).toBe("risk");
    expect(p.run(`flActorOf(Q, { type: "card", role: "sniper" })`)).toBe("sniper");
  });

  it("keeps at most four lines waiting per actor (the oldest let go, never an action) and at most 120 events in all", () => {
    const p = page();
    p.run(`globalThis.Q = flQueueNew();
      flQueuePush(Q, { type: "order", lead: "L-1", symbol: "SOL", side: "buy", usd: 1, role: "sniper" }, 0);
      for (let i = 0; i < 10; i++) flQueuePush(Q, { type: "say", role: "sniper", text: "line " + i }, 0);`);
    expect(p.run("Q.list.map((e) => e.ev.type === 'say' ? e.ev.text : e.ev.type)")).toEqual(["order", "line 6", "line 7", "line 8", "line 9"]);
    p.run(`for (let i = 0; i < 300; i++) flQueuePush(Q, { type: "handoff", lead: "L-" + i, from: "search", to: "risk" }, 0)`);
    expect(p.run("Q.list.length")).toBe(120);
    expect(p.run("Q.list[119].ev.lead")).toBe("L-299");
  });

  it("lays the scan's rows out as nodes beside the screen, the same way every time: sized by volume, the picked marked, none on the screen", () => {
    const p = page();
    const rows = Array.from({ length: 30 }, (_, i) => ({ symbol: `S${i}`, changePct24h: (i % 7) - 3, volumeUsd24h: 10 ** (5 + (i % 6)) }));
    const box = { x: 168, y: 60, w: 1176, h: 236 };
    const hole = { x: 434, y: 64, w: 732, h: 207 };
    const lay = (r: unknown[]) => p.run<any[]>(`flScanLayout(${JSON.stringify(r)}, ["S3", "S9"], ${JSON.stringify(box)}, ${JSON.stringify(hole)})`);
    const a = lay(rows);
    expect(a).toHaveLength(30);
    // the same rows in another order land in the same places
    const b = lay([...rows].reverse());
    const bySym = (xs: any[]) => Object.fromEntries(xs.map((n) => [n.symbol, [n.x, n.y, n.r]]));
    expect(bySym(b)).toEqual(bySym(a));
    expect(JSON.stringify(lay(rows))).toBe(JSON.stringify(a));
    for (const n of a) {
      expect(n.x - n.r >= box.x - 0.01 && n.x + n.r <= box.x + box.w + 0.01 && n.y - n.r >= box.y - 0.01 && n.y + n.r <= box.y + box.h + 0.01, n.symbol).toBe(true);
      const inHole = n.x + n.r > hole.x && n.x - n.r < hole.x + hole.w && n.y + n.r > hole.y && n.y - n.r < hole.y + hole.h;
      expect(inHole, n.symbol).toBe(false);
    }
    // larger volume, larger node; the picked flagged, the rest not
    const r = (s: string) => a.find((n) => n.symbol === s).r;
    expect(r("S5")).toBeGreaterThan(r("S0"));
    expect(a.filter((n) => n.picked).map((n) => n.symbol).sort()).toEqual(["S3", "S9"]);
    // they barely touch: no two closer than 85 % of their radii's sum
    for (let i = 0; i < a.length; i++)
      for (let j = i + 1; j < a.length; j++) expect(Math.hypot(a[i].x - a[j].x, a[i].y - a[j].y), `${a[i].symbol}/${a[j].symbol}`).toBeGreaterThan((a[i].r + a[j].r) * 0.85);
    // nothing to lay: nothing; a row without a symbol or a repeated one is dropped; at most forty
    expect(p.run(`flScanLayout([], [], ${JSON.stringify(box)}, ${JSON.stringify(hole)})`)).toEqual([]);
    expect(p.run<any[]>(`flScanLayout([{ symbol: "A" }, { symbol: "A" }, { name: "x" }, null], [], ${JSON.stringify(box)}, ${JSON.stringify(hole)})`).map((n) => n.symbol)).toEqual(["A"]);
    const many = Array.from({ length: 60 }, (_, i) => ({ symbol: `M${i}` }));
    expect(p.run<any[]>(`flScanLayout(${JSON.stringify(many)}, [], ${JSON.stringify(box)}, ${JSON.stringify(hole)})`)).toHaveLength(40);
    // a row whose volume is unknown is drawn at the smallest size and its change unknown
    const u = p.run<any[]>(`flScanLayout([{ symbol: "U" }, { symbol: "V", volumeUsd24h: 1e9, changePct24h: 2 }], [], ${JSON.stringify(box)}, ${JSON.stringify(hole)})`);
    expect(u[0].change).toBeNull();
    expect(u[0].volume).toBeNull();
    expect(u[0].r).toBeLessThan(u[1].r);
  });

  it("loops the tape seamlessly: one pass is its items and their gaps, the scroll the same at a whole loop as at none, at a constant speed", () => {
    const p = page();
    expect(p.run("flTickerLoop([100, 50, 30], 20)")).toEqual({ width: 240, starts: [0, 120, 190] });
    expect(p.run("flTickerLoop([], 20)")).toEqual({ width: 0, starts: [] });
    expect(p.run("flTickerOffset(0, 40, 240)")).toBe(0);
    expect(p.run("flTickerOffset(6000, 40, 240)")).toBe(0);
    expect(p.run("flTickerOffset(1000, 40, 240)")).toBe(40);
    expect(p.run("flTickerOffset(7000, 40, 240)")).toBe(40);
    expect(p.run<number>("flTickerOffset(2500, 40, 240)") - p.run<number>("flTickerOffset(1500, 40, 240)")).toBe(40);
    expect(p.run("flTickerOffset(1000, 40, 0)")).toBe(0);
  });

  it("colours a node by its change: up in the up colour, down in the down colour, stronger the larger the move, the dim colour for none", () => {
    const p = page();
    // the trading area's up green and down red, never the accent for a rise
    expect(p.run("flNodeColor(4)")).toBe("rgba(63,207,114,0.675)");
    expect(p.run("flNodeColor(-8)")).toBe("rgba(255,107,97,1)");
    expect(p.run("flNodeColor(-40)")).toBe("rgba(255,107,97,1)");
    expect(p.run("flNodeColor(0.8)")).toBe("rgba(63,207,114,0.415)");
    for (const none of ["undefined", "null", "NaN", "0", '""']) expect(p.run(`flNodeColor(${none})`), none).toBe("rgba(157,157,152,0.55)");
    // a page's own green is used where it sets one
    expect(p.run(`flNodeColor(8, { up: [1, 2, 3, 1], down: [4, 5, 6, 1], dim: [7, 8, 9, 1] })`)).toBe("rgba(1,2,3,1)");
  });

  it("wraps a bubble's words in at most three lines no wider than its box, cutting only a word wider than a line, and ends what does not fit with …", () => {
    const p = page();
    const m = "(s) => s.length * 6";
    expect(p.run(`flWrap("Bought 1.64 SOL at 152.31", 120, ${m}, 3)`)).toEqual(["Bought 1.64 SOL at", "152.31"]);
    const long = "RISK CLEARANCE L-0049 spread 0.04% size $250 TP +1.5% SL -0.8% 12h Verdict: CLEAR → SNIPER and more words after it";
    const lines = p.run<string[]>(`flWrap(${JSON.stringify(long)}, 120, ${m}, 3)`);
    expect(lines).toHaveLength(3);
    for (const ln of lines) expect(ln.length * 6).toBeLessThanOrEqual(120);
    expect(lines[2]!.endsWith("…")).toBe(true);
    expect(p.run(`flWrap("0x1234567890abcdef1234567890", 60, ${m}, 3)`)).toEqual(["0x12345678", "90abcdef12", "34567890"]);
    expect(p.run(`flWrap("  ", 60, ${m}, 3)`)).toEqual([]);
    expect(p.run(`flWrap("a b c d e f", 6, ${m}, 2)`)).toEqual(["a", "…"]);
    // a balanced label: the same number of lines, none left with a lonely word
    expect(p.run(`flWrapEven("EMPTY SEAT — NEEDS A FEED", 130, ${m}, 3)`)).toEqual(["EMPTY SEAT —", "NEEDS A FEED"]);
  });

  it("puts a line where it draws crisp: an odd number of device pixels on a pixel's centre, an even one on the edge", () => {
    const p = page();
    expect(p.run("flSnap(10.3, 1, 1)")).toBe(10.5);
    expect(p.run("flSnap(10.2, 2, 1)")).toBe(10);
    expect(p.run("flSnap(10.3, 2, 1)")).toBe(10.5);
    expect(p.run("flSnap(10.3, 2, 0.5)")).toBe(10.25);
    expect(p.run("flSnap(10.3, 1, 2)")).toBe(10);
    expect(p.run<number>("flSnap(7.9, 3, 1)")).toBeCloseTo(23.5 / 3, 12);
  });

  it("reads its colours from the container's tokens where set — the floor's own deep-sea field first, then the trading area's names — and the area's values where not", () => {
    const p = page();
    expect(p.run("flRgb('#97fce3')")).toEqual([151, 252, 227, 1]);
    expect(p.run("flRgb('#abc')")).toEqual([170, 187, 204, 1]);
    expect(p.run("flRgb(' rgba(238, 248, 244, 0.62) ')")).toEqual([238, 248, 244, 0.62]);
    expect(p.run("flRgb('rgb(1 2 3 / 50%)')")).toEqual([1, 2, 3, 0.5]);
    expect(p.run("flRgb('color-mix(in srgb, red, blue)')")).toBeNull();
    // with nothing set: the floor's deep-sea field, and the trading area's text, dim words, accent, near-black, up, down and amber
    const spec = p.run<Record<string, number[]>>("flPalette(null)");
    expect(spec.bg).toEqual([5, 9, 12, 1]);
    expect(spec.surface).toEqual([12, 22, 27, 1]);
    expect(spec.text).toEqual([242, 242, 240, 1]);
    expect(spec.dim).toEqual([157, 157, 152, 1]);
    expect(spec.line).toEqual([140, 239, 255, 0.16]);
    expect(spec.mint).toEqual([140, 239, 255, 1]);
    expect(spec.ink).toEqual([0, 22, 27, 1]);
    expect(spec.up).toEqual([63, 207, 114, 1]);
    expect(spec.down).toEqual([255, 107, 97, 1]);
    expect(spec.warn).toEqual([245, 196, 107, 1]);
    expect(spec.scan).toEqual([0, 0, 0, 0.16]);
    // the first name set wins: --sg-mint before --primary, --sg-deep before --bg; one that is not a colour is passed over
    const q = page({ css: { "--primary": "#112233", "--sg-mint": "", "--down": "rgb(9, 8, 7)", "--bg": "not a colour" } });
    const got = q.run<Record<string, number[]>>("flPalette({})");
    expect(got.mint).toEqual([17, 34, 51, 1]);
    expect(got.down).toEqual([9, 8, 7, 1]);
    expect(got.bg).toEqual([5, 9, 12, 1]);
    const area = page({ css: { "--sg-deep": "#072723", "--bg": "#1b2429", "--surface": "#0f1a1f", "--text": "#f6fefd", "--dim": "#949e9c", "--sg-mint": "#97fce4", "--primary": "#50d2c1", "--on-primary": "#04060c", "--up": "#1fa67d" } });
    const a = area.run<Record<string, number[]>>("flPalette({})");
    expect(a.bg).toEqual([7, 39, 35, 1]);
    expect(a.surface).toEqual([15, 26, 31, 1]);
    expect(a.mint).toEqual([151, 252, 228, 1]);
    expect(a.ink).toEqual([4, 6, 12, 1]);
    expect(a.up).toEqual([31, 166, 125, 1]);
  });

  it("drops to lite as the site does: never in the first six seconds, then after four seconds of slow frames, once and for good", () => {
    const p = page();
    p.run("globalThis.D = { born: 0, slowSince: 0, lite: false }");
    expect(p.run("flDegrade(D, 5000, 40)")).toBe(false);
    expect(p.run("flDegrade(D, 6500, 40)")).toBe(false);
    expect(p.run("flDegrade(D, 9000, 40)")).toBe(false);
    // a fast check starts the count again
    expect(p.run("flDegrade(D, 9500, 12)")).toBe(false);
    expect(p.run("flDegrade(D, 10000, 40)")).toBe(false);
    expect(p.run("flDegrade(D, 13999, 40)")).toBe(false);
    expect(p.run("flDegrade(D, 14001, 40)")).toBe(true);
    expect(p.run("flDegrade(D, 20000, 5)")).toBe(true);
    // the percentile of what was measured, without allocating
    expect(p.run("flPercentile(new Float32Array([5, 1, 4, 2, 3, 0, 0]), 5, 0.5, new Float32Array(7))")).toBe(3);
    expect(p.run("flPercentile(new Float32Array([5, 1, 4, 2, 3]), 5, 0.95, new Float32Array(5))")).toBe(5);
    expect(p.run("flPercentile(new Float32Array(4), 0, 0.5, new Float32Array(4))")).toBe(0);
  });

  it("says the floor in words: the session, who sits where, the empty seats and why, who works, the brain's why, the screen, the scan, the shredder, the target", () => {
    const p = page();
    const words = p.run<string>(`flAria(${JSON.stringify(state({ working: { role: "search", what: "scan" }, inFlight: 2, scan: { at: "x", rows: [{ symbol: "A" }, { symbol: "B" }], picked: ["A"] } }))})`);
    expect(words).toContain("Trading floor: live session.");
    expect(words).toContain("At their desks: Head, Search, Risk, Sniper, Exit, Watch.");
    expect(words).toContain("Empty: Flow (empty seat — needs a feed), Sentiment (empty seat — needs a feed).");
    expect(words).toContain("Search is scanning.");
    expect(words).toContain("2 brain calls under way.");
    expect(words).toContain("Wall screen: SOL (Solana), last 130.50.");
    expect(words).toContain("Last scan: 2 markets, 1 picked.");
    expect(words).toContain("3 leads rejected.");
    expect(words).toContain("Target 42% of the way.");
    const halted = p.run<string>(`flAria(${JSON.stringify({ ...bare, session: { state: "halted", halted: { why: "the day's loss limit" } }, brain: { ok: false, why: "no key" }, seats: [{ role: "risk", kind: "house", status: "not let in" }, { role: "flow", kind: "outside", status: "ok" }] })})`);
    expect(halted).toContain("Trading floor: halted — the day's loss limit.");
    expect(halted).toContain("The brain cannot think: no key.");
    expect(halted).toContain("At their desks: Risk (not let in), Flow.");
    expect(halted).toContain("Empty: Head (empty seat)");
    expect(halted).toContain("Wall screen: no market in focus.");
    expect(halted).not.toContain("rejected");
    expect(halted).not.toContain("Target");
    expect(p.run("flAria(null)")).toContain("Trading floor: no session running.");
  });

  it("reads a state as given and takes nothing malformed as data: bad bars, marks without an entry, an unknown session, a seat with no kind", () => {
    const p = page();
    const n = p.run<any>(`flNorm({ session: { state: "dancing" }, seats: [{ role: "risk" }, { name: "x" }], inFlight: "2.9", focus: { symbol: "SOL", candles: [{ o: 1, h: 2, l: 0.5, c: 1.5 }, { o: "x" }, null], marks: [{ lead: "L-1", entry: 10, tp: null }, { lead: "L-2" }] }, ticker: [{ text: "  BTC  1  ", dir: "sideways" }, { text: "" }], rejected: "n/a", funnel: { rejected: 4 } })`);
    expect(n.session.state).toBe("none");
    expect(n.seats).toHaveLength(1);
    expect(n.seats[0].kind).toBe("empty");
    expect(n.seats[0].status).toBe("empty");
    expect(n.inFlight).toBe(2);
    expect(n.focus.candles).toHaveLength(1);
    expect(n.focus.marks.map((m: any) => m.lead)).toEqual(["L-1"]);
    expect(Number.isNaN(n.focus.marks[0].tp)).toBe(true);
    expect(n.ticker).toEqual([{ text: "BTC 1", dir: "flat" }]);
    expect(n.rejected).toBe(4);
    expect(n.target).toBeNull();
    expect(n.brain).toBeNull();
  });

  it("writes figures as the floor shows them: a price to its step, dollars to the cent with a true minus, signed P&L", () => {
    const p = page();
    expect(p.run("[flPrice(67210.5), flPrice(152.3, 0.01), flPrice(0.0001234), flPrice(1.5, 0.001), flPrice(NaN)]")).toEqual(["67,210.50", "152.30", "0.0001234", "1.500", "—"]);
    expect(p.run("[flUsd(250), flUsd(12345.6), flUsd(-8.1), flSigned(12.4), flSigned(-2.05), flSigned(0), flCompact(1.2e9), flCompact(400)]")).toEqual(["$250.00", "$12,345.60", "−$8.10", "+$12.40", "−$2.05", "$0.00", "$1.2B", "$400"]);
  });
});

describe("the floor mounted", () => {
  it("with no frames to draw in, draws one still frame per set() and per push(); nothing from no data — each empty place says so", () => {
    const p = page();
    p.run("globalThis.H = flMount(CANVAS, {})");
    expect(p.run("H.stats()")).toEqual({ fps: 0, p95ms: 0, scriptMs: 0, long: null, idle: false, lite: false, still: true });
    // the canvas at the device's pixel ratio (1 here)
    expect([p.canvas.width, p.canvas.height]).toEqual([1600, 700]);
    p.rec.clear();
    p.run(`H.set(${JSON.stringify(bare)})`);
    const t = p.rec.texts;
    expect(t).toContain("No market in focus");
    expect(t).toContain("No quotes read yet");
    // no figure the state did not give: no tag, no fill, no up or down, no rejected count, no target
    expect(t.filter((x) => /FILLED|BUY|SELL|[▲▼]/.test(x))).toEqual([]);
    expect(t).toContain("REJECTED");
    expect(t).toContain("OF TARGET");
    expect(t.filter((x) => x === "—").length).toBeGreaterThanOrEqual(2);
    // every seat empty, saying why; no mascot was asked to think
    expect(t.filter((x) => x === "EMPTY SEAT — NEEDS A FEED")).toHaveLength(2);
    expect(t.filter((x) => x === "EMPTY SEAT")).toHaveLength(6);
    expect(p.attrs.get("role")).toBe("img");
    expect(p.attrs.get("aria-label")).toContain("Empty: Head (empty seat)");
    // one frame per push too
    const before = p.rec.calls.get("fillRect") ?? 0;
    p.run(`H.push({ type: "cycle", n: 3 })`);
    expect(p.rec.calls.get("fillRect") ?? 0).toBeGreaterThan(before);
  });

  it("draws what the state gives: the market's candles and its last price, the seats at their desks, the shredder's and the target's real figures, the tape", () => {
    const p = page();
    p.run("globalThis.H = flMount(CANVAS, {})");
    p.rec.clear();
    p.run(`H.set(${JSON.stringify(state({ ticker: [{ text: "BTC 67,210 2.1%", dir: "up" }, { text: "ETH 3,100 0.4%", dir: "down" }], working: { role: "risk", what: "clear", lead: "L-0049" } }))})`);
    const t = p.rec.texts;
    expect(t).toContain("SOL · Solana · Perpetual");
    expect(t).toContain("130.50");
    expect(t).toContain("▲ BTC 67,210 2.1%");
    expect(t).toContain("▼ ETH 3,100 0.4%");
    expect(t).toContain("3");
    expect(t).toContain("42.0%");
    expect(t).toContain("CLEARING L-0049");
    expect(t).toContain("SEARCH");
    expect(t.filter((x) => x === "EMPTY SEAT — NEEDS A FEED")).toHaveLength(2);
    // thirty candles: a wick and a body each
    expect(p.rec.calls.get("fillRect") ?? 0).toBeGreaterThan(60);
    expect(p.attrs.get("aria-label")).toContain("Risk is clearing (L-0049).");
  });

  it("says a halt's real why, and the brain's why it cannot think", () => {
    const p = page();
    p.run("globalThis.H = flMount(CANVAS, {})");
    p.rec.clear();
    p.run(`H.set(${JSON.stringify(state({ session: { state: "halted", halted: { why: "Today's loss reached 5% of the start" } }, brain: { ok: false, why: "no key" } }))})`);
    expect(p.rec.texts).toContain("DESK HALTED");
    expect(p.rec.texts.join(" ")).toContain("Today's loss reached 5% of the start");
    expect(p.rec.texts).toContain("off · no key");
    p.rec.clear();
    p.run(`H.set(${JSON.stringify(state({ session: { state: "paused" } }))})`);
    expect(p.rec.texts).toContain("PAUSED");
    expect(p.rec.texts).not.toContain("DESK HALTED");
    p.rec.clear();
    p.run(`H.set(${JSON.stringify(state())})`);
    expect(p.rec.texts.filter((x) => /HALTED|PAUSED|SESSION ENDED|NO SESSION/.test(x))).toEqual([]);
  });

  it("plays an event at once, as its end state, while there is no loop: a line whole, an order's tag, its fill, an exit's figure, a card's slip", () => {
    const p = page();
    p.run("globalThis.H = flMount(CANVAS, {})");
    p.run(`H.set(${JSON.stringify(state())})`);
    p.rec.clear();
    p.run(`H.push({ type: "say", role: "sniper", kind: "order", text: "Bought 1.64 SOL at 152.31 ($250)." })`);
    expect(p.rec.texts.join(" ")).toContain("Bought 1.64 SOL at 152.31 ($250).");
    p.run(`H.push({ type: "order", lead: "L-9", symbol: "SOL", side: "buy", usd: 250, role: "sniper" })`);
    expect(p.rec.texts).toContain("BUY $250.00 SOL");
    p.rec.clear();
    p.run(`H.push({ type: "fill", lead: "L-9", symbol: "SOL", side: "buy", price: 130.5, qty: 1.64 })`);
    expect(p.rec.texts).toContain("FILLED 1.64 SOL @ 130.50");
    // the sniper's monitor shows the last order's size
    expect(p.rec.texts).toContain("$250.00");
    p.run(`H.push({ type: "exit", lead: "L-9", symbol: "SOL", why: "tp", pnlUsd: 12.4 })`);
    expect(p.rec.texts).toContain("TP SOL +$12.40");
    p.rec.clear();
    // a card carries no side: its slip names the market and claims no direction
    p.run(`H.push({ type: "card", lead: "L-10", symbol: "ETH", role: "sniper" })`);
    expect(p.rec.texts).toContain("ETH");
    // the state does not count the owner's cards here: the tray claims nothing
    expect(p.rec.texts).toContain("YOUR TRAY");
    expect(p.rec.texts.filter((x) => /[▲▼] ETH/.test(x))).toEqual([]);
    // the reject's why beside the shredder, with its lead
    p.run(`H.push({ type: "reject", lead: "L-11", symbol: "PEPE", from: "risk", why: "spread 0.92%" })`);
    expect(p.rec.texts.join(" ")).toContain("L-11 · PEPE · spread 0.92%");
    // an order for a market not on the screen is still shown, in the screen's right column, never at a made-up price level
    p.rec.clear();
    p.run(`H.push({ type: "order", lead: "L-12", symbol: "ETH", side: "sell", usd: 100, role: "sniper" })`);
    expect(p.rec.texts).toContain("SELL $100.00 ETH");
  });

  it("under reduced motion asks for no frame at all, and still draws each set()", () => {
    const p = page({ raf: true, reduced: true });
    p.run("globalThis.H = flMount(CANVAS, {})");
    expect(p.counts.raf).toBe(0);
    expect(p.run("H.stats().still")).toBe(true);
    p.rec.clear();
    p.run(`H.set(${JSON.stringify(state())})`);
    expect(p.rec.texts).toContain("SOL · Solana · Perpetual");
    p.run(`H.push({ type: "say", role: "head", text: "Cycle 4 (the clock): 40 scanned" })`);
    expect(p.rec.texts).toContain("Cycle 4 (the clock): 40 scanned");
    expect(p.counts.raf).toBe(0);
  });

  it("runs one loop at the display's rate and measures it; a line types out over its frames; the loop stops while the page is hidden and on release", () => {
    const p = page({ raf: true, reduced: false, dpr: 3 });
    p.run("globalThis.H = flMount(CANVAS, {})");
    // the pixel ratio held to 2, and to 1.5 where 2 would make the canvas more than two million device pixels
    expect([p.canvas.width, p.canvas.height]).toEqual([2400, 1050]);
    const small = page({ raf: true, reduced: false, dpr: 3, size: { w: 800, h: 350 } });
    small.run("globalThis.H = flMount(CANVAS, {})");
    expect([small.canvas.width, small.canvas.height]).toEqual([1600, 700]);
    expect(p.frames.size).toBe(1);
    p.run(`H.set(${JSON.stringify(state())})`);
    let t = 1000;
    for (let i = 0; i < 60; i++) p.frame((t += 1000 / 120));
    expect(p.frames.size).toBe(1);
    const st = p.run<{ fps: number; p95ms: number; scriptMs: number; lite: boolean; still: boolean }>("H.stats()");
    expect(st.fps).toBe(120);
    // the 95th percentile of the frame interval — how long a frame took to come round — not only the engine's own part of it
    expect(st.p95ms).toBeCloseTo(8.3, 1);
    expect(st.scriptMs).toBeGreaterThanOrEqual(0);
    expect(st.lite).toBe(false);
    expect(st.still).toBe(false);
    // a line, typed: a fifth of a second in, part of it; five seconds in, all of it
    const line = "Cycle 12 (the clock): 40 scanned, 2 cleared, 1 placed, 2 open";
    p.run(`H.push({ type: "say", role: "head", kind: "cycle", text: ${JSON.stringify(line)} })`);
    p.frame((t += 8));
    const start = t;
    while (t < start + 200) p.frame((t += 1000 / 120));
    p.rec.clear();
    p.frame((t += 8));
    const partial = p.rec.texts.filter((x) => line.startsWith(x) && x.length > 3);
    expect(partial.length).toBeGreaterThan(0);
    expect(partial.every((x) => x.length < 30)).toBe(true);
    while (t < start + 2500) p.frame((t += 1000 / 60));
    // (typed out and nothing else moving, the floor rests: a frame drawn at most every 33 ms)
    p.rec.clear();
    p.frame((t += 40));
    expect(p.rec.texts.join(" ")).toContain("Cycle 12 (the clock): 40 scanned, 2 cleared,");
    // hidden: the loop stops (no frame asked), events then land as their end state; visible again: one loop, not two
    (p.sandbox.document as { hidden: boolean }).hidden = true;
    p.doc.fire("visibilitychange");
    expect(p.frames.size).toBe(0);
    const asked = p.counts.raf;
    p.run(`H.push({ type: "order", lead: "L-1", symbol: "SOL", side: "buy", usd: 5, role: "sniper" })`);
    expect(p.counts.raf).toBe(asked);
    (p.sandbox.document as { hidden: boolean }).hidden = false;
    p.doc.fire("visibilitychange");
    p.doc.fire("visibilitychange");
    expect(p.frames.size).toBe(1);
    // released: the frame cancelled, every listener gone, nothing asked again
    p.run("H.release()");
    expect(p.frames.size).toBe(0);
    expect(p.cv.count()).toBe(0);
    expect(p.doc.count()).toBe(p.baseline.doc);
    expect(p.win.count()).toBe(p.baseline.win);
    p.run(`H.set(${JSON.stringify(state())}); H.push({ type: "cycle", n: 9 })`);
    expect(p.frames.size).toBe(0);
  });

  it("stops while the canvas is scrolled out of view, and comes back with it", () => {
    const p = page({ raf: true, reduced: false, io: true });
    p.run("globalThis.H = flMount(CANVAS, {})");
    expect(p.frames.size).toBe(1);
    p.ios[0]!([{ isIntersecting: false }]);
    expect(p.frames.size).toBe(0);
    p.ios[0]!([{ isIntersecting: true }]);
    expect(p.frames.size).toBe(1);
    p.run("H.release()");
    expect(p.counts.ioDisconnect).toBe(1);
  });

  it("drops to lite after slow frames past the first six seconds, once, keeping its pixel ratio so the words stay sharp", () => {
    const p = page({ raf: true, reduced: false, dpr: 2, size: { w: 800, h: 350 } });
    p.run("globalThis.H = flMount(CANVAS, {})");
    p.run(`H.set(${JSON.stringify(state())})`);
    expect(p.canvas.width).toBe(1600);
    let t = 1000;
    // smooth for six seconds: never lite
    while (t < 7000) p.frame((t += 1000 / 60));
    expect(p.run("H.stats().lite")).toBe(false);
    // then 30 ms frames for five seconds
    while (t < 13_000) p.frame((t += 30));
    expect(p.run("H.stats().lite")).toBe(true);
    expect(p.canvas.width).toBe(1600);
    expect(p.frames.size).toBe(1);
  });

  it("picks what is clicked: a mascot or its desk gives its role, the wall screen its market, empty floor nothing", () => {
    const p = page();
    p.run("globalThis.PICKS = []; globalThis.H = flMount(CANVAS, { onPick: (w) => PICKS.push(w) })");
    p.run(`H.set(${JSON.stringify(state())})`);
    const L = p.run<any>("flLayout(1600, 700)");
    const click = (x: number, y: number) => p.cv.fire("click", { clientX: x, clientY: y });
    click(L.seats.sniper.char.x, L.seats.sniper.char.y - L.seats.sniper.char.h / 2);
    click(L.seats.flow.desk.cx, L.seats.flow.desk.front);
    click(L.screen.x + L.screen.w / 2, L.screen.y + L.screen.h / 2);
    click(L.w / 2, (L.seats.search.y + L.seats.head.y - L.seats.head.char.h) / 2);
    expect(JSON.parse(p.run<string>("JSON.stringify(PICKS)"))).toEqual([{ role: "sniper" }, { role: "flow" }, { symbol: "SOL" }]);
    // with no market on the screen, the screen picks nothing
    p.run(`H.set(${JSON.stringify(bare)})`);
    click(L.screen.x + L.screen.w / 2, L.screen.y + L.screen.h / 2);
    expect(p.run("PICKS.length")).toBe(3);
  });

  it("keeps a mascot thinking only while it is the one working", () => {
    const p = page({ raf: true, reduced: false });
    p.run("globalThis.H = flMount(CANVAS, {})");
    p.run(`H.set(${JSON.stringify(state({ working: { role: "search", what: "scan" }, inFlight: 1 }))})`);
    p.run(`H.push({ type: "think", role: "search", on: true })`);
    let t = 1000;
    for (let i = 0; i < 10; i++) p.frame((t += 16));
    p.rec.clear();
    p.frame((t += 16));
    expect(p.rec.texts).toContain("1 call under way");
    // the call ended, its "off" lost: two seconds on, a state with no one working clears it
    p.clock.t = t + 2000;
    p.run(`H.set(${JSON.stringify(state({ working: null, inFlight: 0 }))})`);
    p.rec.clear();
    p.frame((t += 2000));
    expect(p.rec.texts).toContain("idle");
    expect(p.rec.texts).not.toContain("1 call under way");
  });

  it("mounts on a canvas with no 2D context without failing: it draws nothing and still says the floor in words", () => {
    const p = page({ raf: true, reduced: false });
    p.run("globalThis.BAD = { setAttribute: (k, v) => (BAD[k] = v), getBoundingClientRect: () => ({ width: 800, height: 350, left: 0, top: 0 }), style: {}, addEventListener() {}, removeEventListener() {} }; globalThis.H = flMount(BAD, {})");
    p.run(`H.set(${JSON.stringify(state())}); H.push({ type: "say", role: "head", text: "hi" })`);
    expect(p.counts.raf).toBe(0);
    expect(p.run<string>("BAD['aria-label']")).toContain("Wall screen: SOL");
    p.run("H.release()");
  });
});

describe("the floor after review: what it never says wrongly, and what it never redoes per frame", () => {
  const MINT_CORAL = /^rgba\(255,107,97,/;
  const labelOf = (texts: string[], from: string, n: number) => texts.slice(texts.indexOf(from) + 1, texts.indexOf(from) + 1 + n).join(" ");

  it("lays a bubble out again from its own text after the canvas was 0 × 0: never an older line for a newer one", () => {
    const p = page();
    p.run("globalThis.H = flMount(CANVAS, {})");
    p.run(`H.set(${JSON.stringify(state())})`);
    p.run(`H.push({ type: "say", role: "risk", text: "FIRST LINE alpha" })`);
    p.size.w = 0;
    p.size.h = 0;
    p.win.fire("resize");
    p.run(`H.push({ type: "say", role: "risk", text: "SECOND LINE beta" })`);
    p.size.w = 1600;
    p.size.h = 700;
    p.win.fire("resize");
    p.rec.clear();
    p.run(`H.set(${JSON.stringify(state())})`);
    expect(p.rec.texts.join(" ")).toContain("SECOND LINE beta");
    expect(p.rec.texts.join(" ")).not.toContain("FIRST LINE alpha");
  });

  it("keeps an open lead with no P&L yet: Exit's monitor says how many are open, never 'no open lead'; 'no open lead' only for a given empty list", () => {
    const p = page();
    p.run("globalThis.H = flMount(CANVAS, {})");
    p.rec.clear();
    p.run(`H.set(${JSON.stringify(state({ open: [{ lead: "L-1", symbol: "SOL", side: "buy" }] }))})`);
    // its words fit its glass: said short where the whole would run past it
    expect(p.rec.texts).toContain("1 open");
    expect(p.rec.texts).not.toContain("no open lead");
    expect(p.run<string>(`flNorm({ open: [{ lead: "L-1" }] }).openNote`)).toBe("1 open · P&L —");
    expect(p.run<any>(`flNorm({ open: [{ lead: "L-1", symbol: "SOL", side: "buy" }, { lead: "L-2", pnlUsd: 3 }] }).open.map((o) => [o.lead, o.pnlUsd])`)).toEqual([["L-1", NaN], ["L-2", 3]]);
    // a mix: the known as bars, the unknown as a hollow mark — no words about P&L
    p.rec.clear();
    p.run(`H.set(${JSON.stringify(state({ open: [{ lead: "L-1", symbol: "SOL", side: "buy" }, { lead: "L-2", symbol: "ETH", side: "sell", pnlUsd: -4 }] }))})`);
    expect(p.rec.texts.filter((x) => /open|P&L/.test(x))).toEqual([]);
    expect(p.rec.seq.filter((x) => x.op === "strokeRect" && /^rgba\(157,157,152,/.test(x.style))).toHaveLength(1);
    p.rec.clear();
    p.run(`H.set(${JSON.stringify(state({ open: [] }))})`);
    // (said short, "none open", where "no open lead" would run past the glass)
    expect(p.rec.texts.filter((x) => x === "no open lead" || x === "none open")).toHaveLength(1);
    // not given at all: not known, so not "none"
    p.rec.clear();
    p.run(`H.set(${JSON.stringify(state())})`);
    expect(p.rec.texts.filter((x) => x === "no open lead" || x === "none open")).toEqual([]);
    expect(p.run("flNorm({}).open")).toBeNull();
  });

  it("shows on Sniper's monitor the Sniper's own orders only, and the state's last order after a reload", () => {
    const p = page();
    p.run("globalThis.H = flMount(CANVAS, {})");
    const seats = state().seats.map((x) => (x.role === "sniper" ? { ...x, limit: { perOrderUsd: 500, leftUsd: 9000, budgetUsd: 10000 } } : x));
    p.run(`H.set(${JSON.stringify(state({ seats }))})`);
    p.rec.clear();
    // an Exit's close is an order event too: not the Sniper's
    p.run(`H.push({ type: "order", lead: "L-3", symbol: "SOL", side: "sell", usd: 1234, role: "exit" })`);
    expect(p.rec.texts).toContain("SELL $1,234.00 SOL");
    expect(p.rec.texts).not.toContain("$1,234.00");
    expect(p.rec.texts).toContain("no order");
    p.run(`H.push({ type: "order", lead: "L-4", symbol: "SOL", side: "buy", usd: 250, role: "sniper" })`);
    // one string, centred: here the order alone fits the glass (its bar says the ratio to the limit)
    expect(p.rec.texts).toContain("$250.00");
    expect(p.rec.texts.filter((x) => x.includes("$250.00$") || /\$500/.test(x))).toEqual([]);
    // a fresh floor (a reload) with the state's last order for the seat: shown, not "no order"
    const q = page();
    q.run("globalThis.H = flMount(CANVAS, {})");
    q.rec.clear();
    const seats2 = state().seats.map((x) => (x.role === "sniper" ? { ...x, lastOrder: { usd: 310 } } : x));
    q.run(`H.set(${JSON.stringify(state({ seats: seats2 }))})`);
    expect(q.rec.texts).toContain("$310.00");
    expect(q.rec.texts).not.toContain("no order");
  });

  it("writes an empty seat's short why under it, even on a phone's canvas, and keeps the whole why in words", () => {
    const why = "Empty seat — an outside agent can take it: it needs a feed of large and smart-money flows, which no house seat has.";
    const house = "Empty seat — not on this desk: fill it from the Agents pane.";
    const seats = [...state().seats.filter((x) => x.role !== "watch"), { role: "flow", name: "Flow", kind: "empty", status: "empty", why }, { role: "watch", name: "Watch", kind: "empty", status: "empty", why: house }];
    // (a phone's floor tall enough for two lines under its front row: a shorter one writes only what fits above its bottom edge)
    for (const size of [{ w: 335, h: 340 }, { w: 1500, h: 656 }]) {
      const p = page({ size });
      p.run("globalThis.H = flMount(CANVAS, {})");
      p.rec.clear();
      p.run(`H.set(${JSON.stringify(state({ seats }))})`);
      const t = p.rec.texts;
      // on a phone the empty chair says "empty": the words keep only the reason
      const narrow = size.w < 400;
      expect(labelOf(t, "FLOW", 2), `${size.w}`).toMatch(narrow ? /^NEEDS A FEED/ : /^EMPTY SEAT —\s?NEEDS A FEED/);
      expect(t.join(" "), `${size.w}`).not.toMatch(/OUTSIDE AGENT CAN|IT NEEDS A FEED OF/);
      expect(labelOf(t, "WATCH", 3), `${size.w}`).toMatch(narrow ? /^NOT ON THIS/ : /^EMPTY SEAT — ?NOT ON THIS DESK/);
      expect(t.join(" "), `${size.w}`).not.toContain("AGENTS PANE");
      expect(p.attrs.get("aria-label")).toContain(why);
    }
    expect(p0().run(`flEmptyShort({ role: "watch", why: ${JSON.stringify(house)} })`)).toBe("Empty seat — not on this desk");
    expect(p0().run(`flEmptyShort({ role: "flow", why: ${JSON.stringify(why)} })`)).toBe("empty seat — needs a feed");
    expect(p0().run(`flEmptyShort({ role: "head" })`)).toBe("empty seat");
    expect(p0().run(`flEmptyShort({ role: "watch", why: ${JSON.stringify(house)} }, true)`)).toBe("not on this desk");
    expect(p0().run(`flEmptyShort({ role: "flow" }, true)`)).toBe("needs a feed");
  });
  const p0 = () => page();

  it("colours each mascot with the page's own role colour, and reads the scanlines' and the shade's colours from the tokens", () => {
    const p = page({ css: { "--sg-r-risk": "#b9f2e3", "--sg-r-head": "#97fce3", "--sg-scan": "rgba(1, 2, 3, 0.2)", "--sg-shadow": "#010203" } });
    const pal = p.run<Record<string, number[]>>("(() => { const E = { pal: flPalette({}) }; flDerive(E); return E.pal; })()");
    expect(pal.r_risk).toEqual([185, 242, 227, 1]);
    expect(pal.r_head).toEqual([151, 252, 227, 1]);
    expect(pal.scan).toEqual([1, 2, 3, 0.2]);
    expect(pal.shade).toEqual([1, 2, 3, 1]);
    // the glass mixes toward the page's shade, not toward a black of the floor's own
    expect(pal.glass!.slice(0, 3).map(Math.round)).toEqual([4, 7, 9]);
    // a role the page does not colour: the floor's own step of the mint; no shade set: the deep sea darkened
    const q = page();
    const own = q.run<Record<string, number[]>>("(() => { const E = { pal: flPalette(null) }; flDerive(E); return E.pal; })()");
    expect(own.r_risk).not.toEqual([185, 242, 227, 1]);
    expect(own.scan).toEqual([0, 0, 0, 0.16]);
    expect(own.shade).toBeUndefined();
    expect(own.glass!.slice(0, 3).map(Math.round)).toEqual([3, 6, 8]);
  });

  it("changes the tape seamlessly: new quotes enter from the right after the current loop, nothing on the tape changes in place", () => {
    const p = page({ raf: true, reduced: false });
    expect(p.run("flTickerSwapAt(100, 300, 1000)")).toBe(4);
    expect(p.run("flTickerSwapAt(0, 3000, 1000)")).toBe(1);
    expect(p.run("flTickerSwapAt(0, 0, 1000)")).toBe(0);
    p.run("globalThis.H = flMount(CANVAS, {})");
    const tape = (tag: string) => [{ text: `${tag}1 1.00`, dir: "up" }, { text: `${tag}2 2.00`, dir: "down" }];
    p.run(`H.set(${JSON.stringify({ ...bare, ticker: tape("AAA") })})`);
    let t = 1000;
    for (let i = 0; i < 40; i++) p.frame((t += 30));
    p.run(`H.set(${JSON.stringify({ ...bare, ticker: tape("BBB") })})`);
    const seen = (re: RegExp) => p.rec.texts.some((x) => re.test(x));
    p.rec.clear();
    p.frame((t += 30));
    expect(seen(/AAA/)).toBe(true);
    expect(seen(/BBB/)).toBe(false);
    let both = false;
    let onlyNew = false;
    for (let i = 0; i < 1200 && !onlyNew; i++) {
      p.rec.clear();
      p.frame((t += 50));
      if (seen(/AAA/) && seen(/BBB/)) both = true;
      if (!seen(/AAA/) && seen(/BBB/)) onlyNew = true;
    }
    // a frame with the old quotes still on the left and the new already coming in on the right; then only the new
    expect(both).toBe(true);
    expect(onlyNew).toBe(true);
  });

  it("says on Watch's monitor 'no candles' when there are too few, and captions the line 'no marks' when it has none", () => {
    const p = page();
    p.run("globalThis.H = flMount(CANVAS, {})");
    const one = state().focus;
    p.rec.clear();
    p.run(`H.set(${JSON.stringify(state({ focus: { ...one, candles: one.candles.slice(0, 1), marks: [{ lead: "L-1", side: "buy", entry: 100, state: "executed" }] } }))})`);
    expect(p.rec.texts).toContain("no candles");
    expect(p.rec.texts).not.toContain("no marks");
    p.rec.clear();
    p.run(`H.set(${JSON.stringify(state())})`);
    expect(p.rec.texts).toContain("no marks");
    p.rec.clear();
    p.run(`H.set(${JSON.stringify(state({ focus: { ...one, marks: [{ lead: "L-1", side: "buy", entry: 120, state: "executed" }] } }))})`);
    expect(p.rec.texts).not.toContain("no marks");
  });

  it("never draws a missing volume as a figure: no bar for it on Search's monitor, a neutral hollow node in the network", () => {
    const p = page();
    const bars = p.run<Array<{ f: number; picked: boolean }>>(`flSearchBars([{ symbol: "A", volumeUsd24h: 1e6 }, { symbol: "B" }, { symbol: "C", volumeUsd24h: 1e9 }], ["C"])`);
    expect(bars[0]).toEqual({ f: 0.2, picked: false });
    expect(Number.isNaN(bars[1]!.f)).toBe(true);
    expect(bars[2]!.f).toBeCloseTo(1, 9);
    expect(bars[2]!.picked).toBe(true);
    const box = { x: 168, y: 60, w: 1176, h: 236 };
    const hole = { x: 434, y: 64, w: 732, h: 207 };
    const rows = [...Array.from({ length: 6 }, (_, i) => ({ symbol: `K${i}`, volumeUsd24h: 10 ** (5 + i) })), { symbol: "U" }];
    const a = p.run<any[]>(`flScanLayout(${JSON.stringify(rows)}, [], ${JSON.stringify(box)}, ${JSON.stringify(hole)})`);
    const u = a.find((n) => n.symbol === "U");
    const rs = a.filter((n) => n.symbol !== "U").map((n) => n.r);
    expect(u.hollow).toBe(true);
    expect(u.volume).toBeNull();
    expect(u.r).toBeGreaterThan(Math.min(...rs));
    expect(u.r).toBeLessThan(Math.max(...rs));
    expect(a.filter((n) => n.hollow).map((n) => n.symbol)).toEqual(["U"]);
  });

  it("under reduced motion redraws the floor as it stands when the canvas comes back into view", () => {
    const p = page({ raf: true, reduced: true, io: true });
    p.run("globalThis.H = flMount(CANVAS, {})");
    p.ios[0]!([{ isIntersecting: false }]);
    p.run(`H.set(${JSON.stringify(state())})`);
    p.rec.clear();
    p.ios[0]!([{ isIntersecting: true }]);
    expect(p.rec.texts).toContain("SOL · Solana · Perpetual");
    expect(p.counts.raf).toBe(0);
  });

  it("counts a slow spell again from nothing when the loop restarts: time hidden never drops it to lite", () => {
    const p = page({ raf: true, reduced: false, dpr: 2 });
    p.run("globalThis.H = flMount(CANVAS, {})");
    p.run(`H.set(${JSON.stringify(bare)})`);
    let t = 1000;
    while (t < 7500) p.frame((t += 1000 / 60));
    // three seconds of slow frames: not yet four
    while (t < 10_500) p.frame((t += 30));
    expect(p.run("H.stats().lite")).toBe(false);
    (p.sandbox.document as { hidden: boolean }).hidden = true;
    p.doc.fire("visibilitychange");
    t += 20_000;
    p.clock.t = t;
    (p.sandbox.document as { hidden: boolean }).hidden = false;
    p.doc.fire("visibilitychange");
    // shown again, slow again for two and a half seconds: the spell before it was hidden does not count
    const back = t;
    while (t < back + 2500) p.frame((t += 30));
    expect(p.run("H.stats().lite")).toBe(false);
  });

  it("starts lite on a phone-sized screen, as the site does", () => {
    const p = page({ raf: true, reduced: false, dpr: 2, innerWidth: 375, size: { w: 375, h: 300 } });
    p.run("globalThis.H = flMount(CANVAS, {})");
    // lite, at the device's pixel ratio still: a phone's words are not drawn blurred
    expect(p.canvas.width).toBe(750);
    let t = 1000;
    for (let i = 0; i < 40; i++) p.frame((t += 1000 / 60));
    expect(p.run("H.stats().lite")).toBe(true);
    const q = page({ raf: true, reduced: false, dpr: 2, innerWidth: 1440, size: { w: 800, h: 350 } });
    q.run("globalThis.H = flMount(CANVAS, {})");
    expect(q.canvas.width).toBe(1600);
    expect(q.run("H.stats().lite")).toBe(false);
  });

  it("wraps no words per frame: labels, the rack's words, the shredder's why and the banner's are wrapped once and kept", () => {
    const p = page({ raf: true, reduced: false });
    p.run("globalThis.H = flMount(CANVAS, {})");
    p.run(`H.set(${JSON.stringify(state({ session: { state: "halted", halted: { why: "the day's loss line" } }, brain: { ok: false, why: "no key" }, working: { role: "risk", what: "clear", lead: "L-0049" } }))})`);
    p.run(`H.push({ type: "reject", lead: "L-11", symbol: "PEPE", from: "risk", why: "spread 0.92%" })`);
    let t = 1000;
    for (let i = 0; i < 5; i++) p.frame((t += 16));
    p.run("globalThis.WRAPS = 0; const flWrapWas = flWrap; globalThis.flWrap = (...a) => (WRAPS++, flWrapWas(...a))");
    for (let i = 0; i < 30; i++) p.frame((t += 16));
    expect(p.run("WRAPS")).toBe(0);
    // a new state (another working seat) wraps the labels again, once
    p.run(`H.set(${JSON.stringify(state({ working: { role: "search", what: "scan" } }))})`);
    p.frame((t += 16));
    const once = p.run<number>("WRAPS");
    expect(once).toBeGreaterThan(0);
    for (let i = 0; i < 30; i++) p.frame((t += 16));
    expect(p.run("WRAPS")).toBe(once);
  });

  it("turns every light off but the wall screen's in an ended session: the fixtures' and seats' words go under the dark", () => {
    const p = page();
    p.run("globalThis.H = flMount(CANVAS, {})");
    p.rec.clear();
    p.run(`H.set(${JSON.stringify(state({ session: { state: "ended" } }))})`);
    const seq = p.rec.seq;
    const dark = seq.findIndex((x) => x.op === "fillRect" && x.args[0] === -12 && x.args[1] === -12 && x.args[2] === 1624 && x.args[3] === 724);
    expect(dark).toBeGreaterThan(0);
    const at = (text: string) => seq.findIndex((x) => x.op === "fillText" && x.args[0] === text);
    for (const w of ["OF TARGET", "REJECTED", "YOUR TRAY", "SEARCH", "BRAIN"]) {
      expect(at(w), w).toBeGreaterThanOrEqual(0);
      expect(at(w), w).toBeLessThan(dark);
    }
    expect(at("SOL · Solana · Perpetual")).toBeGreaterThan(dark);
    expect(at("SESSION ENDED")).toBeGreaterThan(dark);
    // live: the words light themselves, above the room's lights
    p.rec.clear();
    p.run(`H.set(${JSON.stringify(state({ session: { state: "paused" } }))})`);
    const dark2 = p.rec.seq.findIndex((x) => x.op === "fillRect" && x.args[0] === -12 && x.args[1] === -12 && x.args[2] === 1624 && x.args[3] === 724);
    expect(p.rec.seq.findIndex((x) => x.op === "fillText" && x.args[0] === "OF TARGET")).toBeGreaterThan(dark2);
  });

  it("reads the canvas's place once per resize or scroll, not per pointer move, and sizes the canvas again when the pixel ratio changes", () => {
    const p = page({ raf: true, reduced: false, dpr: 1 });
    const mq: Array<{ q: string; fns: Set<Fn> }> = [];
    p.sandbox.matchMedia = (q: string) => {
      const m = { q, fns: new Set<Fn>(), matches: false, addEventListener: (_t: string, fn: Fn) => m.fns.add(fn), removeEventListener: (_t: string, fn: Fn) => m.fns.delete(fn) };
      mq.push(m);
      return m;
    };
    p.run("globalThis.PICKS = []; globalThis.H = flMount(CANVAS, { onPick: (w) => PICKS.push(w) })");
    const read = p.counts.rect;
    for (let i = 0; i < 10; i++) p.cv.fire("pointermove", { clientX: 100 + i, clientY: 100 });
    expect(p.counts.rect).toBe(read);
    (p.sandbox.document as any).documentElement.classList = { add() {}, remove() {} };
    p.win.fire("scroll");
    p.cv.fire("pointermove", { clientX: 120, clientY: 100 });
    p.cv.fire("pointermove", { clientX: 121, clientY: 100 });
    expect(p.counts.rect).toBe(read + 1);
    // a click still picks where it lands
    const L = p.run<any>("flLayout(1600, 700)");
    p.cv.fire("click", { clientX: L.seats.sniper.char.x, clientY: L.seats.sniper.char.y - L.seats.sniper.char.h / 2 });
    expect(JSON.parse(p.run<string>("JSON.stringify(PICKS)"))).toEqual([{ role: "sniper" }]);
    // the window moved to a display at twice the density: no resize, but the ratio's query changes
    const res = mq.filter((m) => /resolution: 1dppx/.test(m.q) && m.fns.size);
    expect(res).toHaveLength(1);
    p.sandbox.devicePixelRatio = 2;
    for (const fn of [...res[0]!.fns]) fn({});
    // (1.5 for this size: two would make it more than two million device pixels)
    expect(p.canvas.width).toBe(2400);
    expect(mq.filter((m) => /resolution: 2dppx/.test(m.q) && m.fns.size)).toHaveLength(1);
    expect(res[0]!.fns.size).toBe(0);
    p.run("H.release()");
    expect(mq.every((m) => m.fns.size === 0)).toBe(true);
  });

  it("shows a halt event's why at once, before the state says it", () => {
    const p = page();
    p.run("globalThis.H = flMount(CANVAS, {})");
    p.run(`H.set(${JSON.stringify(state())})`);
    p.rec.clear();
    p.run(`H.push({ type: "halt", why: "Today's loss reached 5% of the start" })`);
    expect(p.rec.texts).toContain("DESK HALTED");
    expect(p.rec.texts.join(" ")).toContain("Today's loss reached 5% of the start");
    expect(p.attrs.get("aria-label")).toContain("halted — Today's loss reached 5% of the start");
    // the next state says how the session stands
    p.rec.clear();
    p.run(`H.set(${JSON.stringify(state())})`);
    expect(p.rec.texts).not.toContain("DESK HALTED");
  });

  it("draws Risk's spread line only where the state gives it: no line, no coral, no judgement of the reading otherwise", () => {
    const p = page();
    p.run("globalThis.H = flMount(CANVAS, {})");
    const coral = () => p.rec.seq.filter((x) => (x.op === "stroke" || x.op === "strokeRect") && MINT_CORAL.test(x.style)).length;
    p.rec.clear();
    p.run(`H.set(${JSON.stringify(state({ checks: { spreadPct: 0.9 } }))})`);
    expect(p.rec.texts).toContain("0.90%");
    expect(coral()).toBe(0);
    p.rec.clear();
    p.run(`H.set(${JSON.stringify(state({ checks: { spreadPct: 0.9, maxSpreadPct: 0.6 } }))})`);
    // the line's coral half, and the needle past it in coral
    expect(coral()).toBe(2);
    expect(p.run("flNorm({ checks: { spreadPct: 0.1, maxSpreadPct: 0.8 } }).checks.maxSpreadPct")).toBe(0.8);
    expect(Number.isNaN(p.run<number>("flNorm({ checks: { spreadPct: 0.1 } }).checks.maxSpreadPct"))).toBe(true);
  });

  it("lays out a phone's floor legibly: two bubbles at most at once, clear of each other and of the seats' labels; the fixtures' words fit", () => {
    const L = page().run<any>("flLayout(375, 300)");
    expect(L.narrow).toBe(true);
    // the trophy and the shredder side by side, neither on the screen nor on each other
    expect(L.trophy.x).toBeGreaterThan(L.screen.x + L.screen.w + 4);
    expect(L.trophy.x + L.trophy.w).toBeLessThan(L.shredder.x);
    expect(L.net.x + L.net.w).toBeLessThanOrEqual(L.trophy.x);
    // no word under 9 px, the seats' words not under 10, the bubbles' not under 11 — whatever the size
    expect(L.fs.tiny).toBe(9);
    expect(L.fs.label).toBeGreaterThanOrEqual(10);
    expect(L.fs.bubble).toBeGreaterThanOrEqual(11);
    // the tray in the gap between the Sentiment's and the Watch's words
    const room = Math.max(54, Math.min(150 * L.k, 375 * 0.19));
    expect(L.tray.gapX0).toBeGreaterThanOrEqual(L.seats.sentiment.char.x + room / 2);
    expect(L.tray.gapX1).toBeLessThanOrEqual(L.seats.watch.char.x - room / 2);
    expect(L.tray.x + L.tray.w / 2).toBeCloseTo((L.tray.gapX0 + L.tray.gapX1) / 2, 6);
    // the pure placement: crowded speakers' bubbles never overlap one another or what is to be kept clear
    const p = page({ size: { w: 375, h: 300 } });
    const placed = p.run<Array<{ x: number; y: number; w: number; h: number }>>(`(() => {
      const rects = [{ x: 60, y: 200, w: 70, h: 20 }];
      const out = [];
      for (const ax of [100, 112, 124]) {
        const at = flPlace(ax, 190, 90, 30, 4, 375, rects, rects.length, { x: 0, y: 0 });
        const r = { x: at.x, y: at.y, w: 90, h: 30 };
        rects.push(r);
        out.push(r);
      }
      return [rects[0], ...out];
    })()`);
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i]!;
        const b = placed[j]!;
        const overlap = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
        expect(overlap, `${i}/${j}`).toBe(false);
      }
    for (const r of placed) expect(r.x >= 4 && r.x + r.w <= 371 && r.y >= 4).toBe(true);
    // mounted at 375 × 300 with five seats speaking at once (no loop: all at once): two bubbles shown, the newest
    p.run("globalThis.H = flMount(CANVAS, {})");
    p.run(`H.set(${JSON.stringify(state())})`);
    for (const role of ["head", "search", "risk", "sniper", "exit"]) p.run(`H.push({ type: "say", role: "${role}", text: "line of ${role}" })`);
    p.rec.clear();
    p.run(`H.set(${JSON.stringify(state())})`);
    expect(p.rec.texts.filter((x) => /^line of/.test(x))).toEqual(["line of sniper", "line of exit"]);
    // the words on the trophy and the shredder fit them
    expect(p.rec.texts.filter((x) => x === "OF TARGET" || x === "OF GOAL")).toHaveLength(1);
    expect(p.rec.texts).toContain("REJECTED");
  });

  it("lets a line wait while the floor already shows as many bubbles as it holds (two on a phone)", () => {
    const p = page({ raf: true, reduced: false, size: { w: 375, h: 300 } });
    p.run("globalThis.H = flMount(CANVAS, {})");
    p.run(`H.set(${JSON.stringify(state())})`);
    for (const role of ["head", "search", "risk"]) p.run(`H.push({ type: "say", role: "${role}", text: "word from ${role}" })`);
    let t = 1000;
    while (t < 2500) p.frame((t += 16));
    p.rec.clear();
    p.frame((t += 16));
    const shown = p.rec.texts.join(" ");
    expect(shown).toContain("word from head");
    expect(shown).toContain("word from search");
    expect(shown).not.toContain("word from risk");
    // once one of them has faded, the third speaks
    let spoke = false;
    for (let i = 0; i < 700 && !spoke; i++) {
      p.rec.clear();
      p.frame((t += 20));
      spoke = p.rec.texts.join(" ").includes("word from risk");
    }
    expect(spoke).toBe(true);
  });
});


describe("the floor in the trading area: its tokens, its words, and its story before its state", () => {
  const SANS = '"Manrope", system-ui, "Segoe UI", Roboto, Ubuntu, "Helvetica Neue", sans-serif';
  /** the words drawn after a label, in order (the shredder's count after "REJECTED") */
  const after = (texts: string[], from: string) => texts[texts.lastIndexOf(from) + 1];
  /** New York's hh:mm for a time, as the floor's clock writes it */
  const nyHM = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso)).replace(/^24/, "00");

  it("draws seats not read yet as neutral placeholders — no 'EMPTY SEAT', no words under the names — and says 'Seats: reading…'", () => {
    const p = page();
    p.run("globalThis.H = flMount(CANVAS, {})");
    // before any state, and with seats not given (null): reading, never every chair empty
    expect(p.attrs.get("aria-label")).toContain("Seats: reading…");
    p.rec.clear();
    p.run(`H.set(${JSON.stringify({ ...bare, seats: null })})`);
    const t = p.rec.texts;
    expect(t.filter((x) => /EMPTY SEAT|NEEDS A FEED|NOT ON THIS DESK/.test(x))).toEqual([]);
    for (const name of ["HEAD", "SEARCH", "RISK", "SNIPER", "EXIT", "WATCH", "FLOW", "SENTIMENT"]) expect(t, name).toContain(name);
    expect(p.attrs.get("aria-label")).toContain("Seats: reading…");
    expect(p.attrs.get("aria-label")).not.toContain("Empty:");
    expect(p.run("flNorm({}).seats")).toBeNull();
    expect(p.run("flNorm({ seats: null }).seats")).toBeNull();
    // once read (an array), as before: the empty ones say why
    p.rec.clear();
    p.run(`H.set(${JSON.stringify(bare)})`);
    expect(p.rec.texts.filter((x) => x === "EMPTY SEAT")).toHaveLength(6);
    expect(p.attrs.get("aria-label")).not.toContain("Seats: reading…");
  });

  it("says on the owner's tray what is true of it — amber while cards wait, dim otherwise — keeps a slip while its card waits, and lets the tray be picked", () => {
    expect(page().run("[flTrayWords(1, false), flTrayWords(3, true), flTrayWords(0, true), flTrayWords(0, false), flTrayWords(null, true)].map((w) => [w.one, w.col])")).toEqual([
      ["1 WAITS FOR YOU", "warn"],
      ["3 WAIT FOR YOU", "warn"],
      ["AUTO ON PAPER · NO CARDS", "dim"],
      ["NO CARD WAITING", "dim"],
      ["YOUR TRAY", "dim"],
    ]);
    const p = page();
    p.run("globalThis.PICKS = []; globalThis.H = flMount(CANVAS, { onPick: (w) => PICKS.push(w) })");
    const styleOf = (text: string) => p.rec.seq.find((x) => x.op === "fillText" && x.args[0] === text)?.style;
    p.rec.clear();
    p.run(`H.set(${JSON.stringify(state({ cards: 1 }))})`);
    expect(styleOf("1 WAITS FOR YOU")).toBe("rgba(245,196,107,1)");
    p.rec.clear();
    p.run(`H.set(${JSON.stringify(state({ cards: 0, autonomy: true }))})`);
    expect(styleOf("AUTO ON PAPER · NO CARDS")).toBe("rgba(157,157,152,1)");
    expect(p.rec.texts.filter((x) => /WAIT/.test(x))).toEqual([]);
    expect(p.attrs.get("aria-label")).toContain("Auto on paper: no card waits for you.");
    // a card's slip stays while its card waits, however long; it goes once none waits
    p.run(`H.set(${JSON.stringify(state({ cards: 1 }))})`);
    p.run(`H.push({ type: "card", lead: "L-10", symbol: "ETH", role: "sniper" })`);
    p.clock.t += 60_000;
    p.rec.clear();
    p.run(`H.set(${JSON.stringify(state({ cards: 1 }))})`);
    expect(p.rec.texts).toContain("ETH");
    p.rec.clear();
    p.run(`H.set(${JSON.stringify(state({ cards: 0 }))})`);
    expect(p.rec.texts).not.toContain("ETH");
    // a click on the tray picks it
    const L = p.run<any>("flLayout(1600, 700)");
    p.cv.fire("click", { clientX: L.tray.cx, clientY: L.tray.bottom - 4 });
    expect(JSON.parse(p.run<string>("JSON.stringify(PICKS)"))).toEqual([{ tray: true }]);
  });

  it("dims a stale floor under a veil, says since when it was not read, and starts no new bubble until it is read again", () => {
    const since = "2026-10-14T14:17:00.000Z";
    const p = page({ raf: true, reduced: false });
    p.run("globalThis.H = flMount(CANVAS, {})");
    p.run(`H.set(${JSON.stringify(state())})`);
    let t = 1000;
    for (let i = 0; i < 5; i++) p.frame((t += 16));
    p.run(`H.set(${JSON.stringify(state({ stale: { since } }))})`);
    p.frame((t += 16));
    p.run(`H.push({ type: "say", role: "risk", text: "a line said while the page is not reading" })`);
    let said = false;
    let veil = false;
    let words = false;
    for (let i = 0; i < 120; i++) {
      p.rec.clear();
      p.frame((t += 40));
      if (p.rec.texts.join(" ").includes("a line said while")) said = true;
      if (p.rec.seq.some((x) => x.op === "fillRect" && x.style === "rgba(5,9,12,0.55)" && x.args[0] === -12)) veil = true;
      if (p.rec.texts.includes(`NOT READ SINCE ${nyHM(since)} NEW YORK`)) words = true;
    }
    expect(said).toBe(false);
    expect(veil).toBe(true);
    expect(words).toBe(true);
    expect(p.attrs.get("aria-label")).toContain(`Not read since ${nyHM(since)} New York`);
    // read again: what waited plays
    p.run(`H.set(${JSON.stringify(state())})`);
    for (let i = 0; i < 60 && !said; i++) {
      p.rec.clear();
      p.frame((t += 40));
      if (p.rec.texts.join(" ").includes("a line said while")) said = true;
    }
    expect(said).toBe(true);
  });

  it("sets the font again after every restore: a bubble drawn after another is in its own face, never the one the canvas restored", () => {
    const p = page();
    p.run("globalThis.H = flMount(CANVAS, {})");
    p.run(`H.set(${JSON.stringify(bare)})`);
    p.run(`H.push({ type: "say", role: "head", text: "first words from the head" })`);
    p.run(`H.push({ type: "say", role: "risk", text: "second words from risk" })`);
    p.rec.clear();
    p.run(`H.set(${JSON.stringify(bare)})`);
    const fonts = p.rec.seq.filter((x) => x.op === "fillText" && /words from/.test(String(x.args[0]))).map((x) => x.font);
    expect(fonts).toHaveLength(2);
    expect(fonts).toEqual([`400 13px ${SANS}`, `400 13px ${SANS}`]);
    // and flRestore lets the kept font go
    expect(p.run("(() => { const E = { ctx: { restore() {} }, font: 'x', track: '0.12em' }; flRestore(E); return [E.font, E.track]; })()")).toEqual(["", ""]);
  });

  it("writes no word under 9 px at any size, every word in the area's face, none cut in two or by the canvas's bottom edge", () => {
    const rich = state({
      working: { role: "search", what: "scan" },
      cards: 2,
      scan: { at: "2026-10-14T14:17:00.000Z", rows: [{ symbol: "SOL", changePct24h: 2, volumeUsd24h: 1e9 }, { symbol: "ETH/USD", changePct24h: -1, volumeUsd24h: 2e9 }], picked: ["SOL"] },
      checks: { spreadPct: 0.05, maxSpreadPct: 0.6 },
      open: [{ lead: "L-1", symbol: "SOL", side: "buy" }],
      seats: state().seats.map((x) => (x.role === "sniper" ? { ...x, limit: { perOrderUsd: 250, leftUsd: 2000, budgetUsd: 2500 }, lastOrder: { usd: 60 } } : x)),
      focus: { ...state().focus, marks: [{ lead: "L-1", side: "buy", entry: 129, tp: 131, sl: 127, state: "executed" }] },
    });
    for (const size of [{ w: 369, h: 161 }, { w: 343, h: 300 }, { w: 1024, h: 448 }, { w: 1600, h: 700 }, { w: 2400, h: 1050 }]) {
      const p = page({ size });
      p.run("globalThis.H = flMount(CANVAS, {})");
      p.run(`H.push({ type: "say", role: "sniper", kind: "order", text: "Bought 1.64 SOL at 152.31 ($250)." })`);
      p.rec.clear();
      p.run(`H.set(${JSON.stringify(rich)})`);
      const words = p.rec.seq.filter((x) => x.op === "fillText");
      expect(words.length, `${size.w}`).toBeGreaterThan(20);
      for (const x of words) {
        const px = Number(/(\d+(?:\.\d+)?)px/.exec(String(x.font))?.[1]);
        expect(px, `${size.w} ${String(x.args[0])}`).toBeGreaterThanOrEqual(9);
        expect(String(x.font), `${size.w} ${String(x.args[0])}`).toContain(SANS);
        // a word written from its top reaches no lower than the canvas's bottom edge
        if (x.base === "top") expect(Number(x.args[2]) + px, `${size.w}×${size.h} ${String(x.args[0])}`).toBeLessThanOrEqual(size.h + 1);
      }
      // the working seat's words whole, or not at all: never "SCAN" / "NING"
      expect(p.rec.texts.filter((x) => /^(SCAN|NING|SCANNI?N?)$/.test(x)), `${size.w}`).toEqual([]);
    }
  });

  it("fits each monitor's words to its glass: the Sniper's order against its limit when both fit, else the order alone; the Head's counts", () => {
    const p = page();
    p.run("globalThis.E = { tw: new Map(), fonts: {}, sans: 'S', font: '', track: '', hasTrack: false, ctx: { measureText: (t) => ({ width: String(t).length * 6 }) } }");
    expect(p.run("flSniperText(E, 60, 250, 200, 10)")).toBe("$60.00 / $250");
    expect(p.run("flSniperText(E, 60, 250, 61, 10)")).toBe("$60 / $250");
    expect(p.run("flSniperText(E, 60, 250, 40, 10)")).toBe("$60.00");
    expect(p.run("flSniperText(E, 60, 250, 20, 10)")).toBe("$60");
    expect(p.run("flSniperText(E, NaN, 250, 60, 10)")).toBe("no order");
    expect(p.run("flSniperText(E, 60, 250, 10, 10)")).toBe("");
    // a large floor: a count beside each of the Head's bars
    const q = page({ size: { w: 2400, h: 1050 } });
    q.run("globalThis.H = flMount(CANVAS, {})");
    q.rec.clear();
    q.run(`H.set(${JSON.stringify(state())})`);
    for (const n of ["40", "4", "2", "1"]) expect(q.rec.texts, n).toContain(n);
  });

  it("lays a mark's words apart down the axis, merges them where they cannot be, and writes a take-profit and a stop to the entry's decimals", () => {
    const p = page();
    expect(p.run("flMarkLabels([{ y: 100 }, { y: 103 }, { y: 105 }], 0, 300, 12).map((l) => l.y)")).toEqual([100, 112, 124]);
    expect(p.run("flMarkLabels([{ y: 295 }, { y: 290 }], 0, 300, 12).map((l) => l.y)")).toEqual([282, 294]);
    expect(p.run("flMarkLabels([{ y: 1 }], 0, 300, 12).map((l) => l.y)")).toEqual([6]);
    expect(p.run("[flPrice(14.0911, NaN, 13.96), flPrice(0.121423, NaN, 0.1209), flPrice(2468.9234, NaN, 2459.08), flPrice(14.0911, 0.001, 13.96)]")).toEqual(["14.09", "0.1214", "2,468.92", "14.091"]);
    // an entry on a round figure: its take-profit and stop never read as the entry itself (the table's sgAtDecimals does the same)
    expect(p.run("[flPrice(5.02, NaN, 5), flPrice(4.98, NaN, 5), flPrice(5, NaN, 5), flPrice(0.12048, NaN, 0.12)]")).toEqual(["5.02", "4.98", "5", "0.1205"]);
    // apart: each line's words, the lead's id with them
    p.run("globalThis.H = flMount(CANVAS, {})");
    p.rec.clear();
    p.run(`H.set(${JSON.stringify(state({ focus: { ...state().focus, priceStep: undefined, marks: [{ lead: "L-0002", side: "buy", entry: 120.25, tp: 126.1234, sl: 114.5, state: "executed" }] } }))})`);
    expect(p.rec.texts).toContain("L-0002 ENTRY ▲ 120.25");
    expect(p.rec.texts).toContain("L-0002 TP 126.12");
    expect(p.rec.texts).toContain("L-0002 SL 114.50");
    // within one line of words: said once, whole, at the screen's top left
    p.rec.clear();
    p.run(`H.set(${JSON.stringify(state({ focus: { ...state().focus, marks: [{ lead: "L-0002", side: "buy", entry: 120, tp: 120.05, sl: 119.97, state: "executed" }] } }))})`);
    expect(p.rec.texts).toContain("L-0002 ▲ entry 120.00 · TP 120.05 · SL 119.97");
    expect(p.rec.texts.filter((x) => /^L-0002 (TP|SL|ENTRY)/.test(x))).toEqual([]);
  });

  it("names the market and its kind in words, the scan in words, and every node by its base when there are few", () => {
    const at = "2026-10-14T14:17:00.000Z";
    expect(page().run(`[flScreenHead({ symbol: "ETH/USD", name: "ETH", kind: "coin" }), flScreenHead({ symbol: "SOL", name: "Solana", kind: "perp" }), flScreenHead({ symbol: "AAPL", name: "", kind: "stock" }), flScreenHead({ symbol: "KX-1", name: "Will the Fed cut?", kind: "event" })]`)).toEqual(["ETH/USD · Crypto", "SOL · Solana · Perpetual", "AAPL · Stock", "Will the Fed cut? · Event"]);
    const p = page();
    p.run("globalThis.H = flMount(CANVAS, {})");
    p.rec.clear();
    p.run(`H.set(${JSON.stringify(state({ scan: { at, rows: [{ symbol: "ETH/USD", volumeUsd24h: 2e9 }, { symbol: "BTC/USD", volumeUsd24h: 9e9 }, { symbol: "SOL", volumeUsd24h: 1e9 }], picked: ["SOL"] } }))})`);
    expect(p.rec.texts).toContain(`SCANNED 3 MARKETS AT ${nyHM(at)} · PICKED 1`);
    for (const b of ["ETH", "BTC", "SOL"]) expect(p.rec.texts, b).toContain(b);
    expect(p.rec.texts.filter((x) => /ROWS/.test(x))).toEqual([]);
    // the picked in the words' colour, the rest dim
    const styleOf = (text: string) => p.rec.seq.find((x) => x.op === "fillText" && x.args[0] === text)?.style;
    expect(styleOf("SOL")).toMatch(/^rgba\(242,242,240,/);
    expect(styleOf("BTC")).toMatch(/^rgba\(157,157,152,/);
    // many nodes: only the picked is named
    const many = Array.from({ length: 20 }, (_, i) => ({ symbol: `M${i}/USD`, volumeUsd24h: 1e6 * (i + 1) }));
    p.rec.clear();
    p.run(`H.set(${JSON.stringify(state({ scan: { at, rows: many, picked: ["M3/USD"] } }))})`);
    expect(p.rec.texts.filter((x) => /^M\d+$/.test(x))).toEqual(["M3"]);
    // and the layout keeps the caption's box clear of every node
    const box = { x: 168, y: 60, w: 1176, h: 236 };
    const hole = { x: 434, y: 64, w: 732, h: 207 };
    const keep = { x: 168, y: 250, w: 400, h: 20 };
    const laid = p.run<any[]>(`flScanLayout(${JSON.stringify(many)}, [], ${JSON.stringify(box)}, ${JSON.stringify(hole)}, { keep: [${JSON.stringify(keep)}] })`);
    for (const n of laid) {
      const nx = Math.max(keep.x, Math.min(n.x, keep.x + keep.w));
      const ny = Math.max(keep.y, Math.min(n.y, keep.y + keep.h));
      expect(Math.hypot(n.x - nx, n.y - ny), n.symbol).toBeGreaterThanOrEqual(n.r - 0.5);
    }
  });

  it("shows a line's plain words, the room's own line only where none came", () => {
    const p = page();
    p.run("globalThis.H = flMount(CANVAS, {})");
    p.run(`H.set(${JSON.stringify(state())})`);
    p.rec.clear();
    p.run(`H.push({ type: "say", role: "search", text: "Lead L-1 on SOL: buy.", raw: "LEAD L-1 | SOL | long" })`);
    expect(p.rec.texts.join(" ")).toContain("Lead L-1 on SOL: buy.");
    expect(p.rec.texts.join(" ")).not.toContain("LEAD L-1");
    p.rec.clear();
    p.run(`H.push({ type: "say", role: "risk", text: "", raw: "RISK L-2 | Verdict: CLEAR" })`);
    expect(p.rec.texts.join(" ")).toContain("RISK L-2 · Verdict: CLEAR");
  });

  it("holds the Head's cycle line until everything queued before it has started and no packet is in the air", () => {
    const p = page();
    p.run(`globalThis.Q = flQueueNew(); globalThis.OUT = [];
      globalThis.GATE = (e) => { if (e.ev.type === "handoff") Q.air++; return e.ev.type === "say" ? { busy: 500, bubble: 3000 } : e.ev.type === "handoff" ? { busy: 200, lead: 1200 } : { busy: 0 }; };
      globalThis.DUE = (t) => flQueueDue(Q, t, GATE, OUT).map((e) => e.ev.type + ":" + e.actor);
      flQueuePush(Q, { type: "say", role: "search", text: "LEAD L-1 on SOL" }, 0);
      flQueuePush(Q, { type: "handoff", lead: "L-1", symbol: "SOL", side: "buy", from: "search", to: "risk" }, 0);
      flQueuePush(Q, { type: "say", role: "head", kind: "cycle", text: "Cycle 2: 1 scanned" }, 0);`);
    // the Head is free, but its cycle line waits behind Search's line and its packet
    expect(p.run("DUE(0)")).toEqual(["say:search"]);
    expect(p.run("DUE(500)")).toEqual(["handoff:search"]);
    // the packet in the air: still waiting
    expect(p.run("DUE(900)")).toEqual([]);
    p.run("Q.air = 0");
    expect(p.run("DUE(1000)")).toEqual(["say:head"]);
    // a Head line of another kind is not held
    p.run(`flQueuePush(Q, { type: "say", role: "search", text: "more" }, 1000); flQueuePush(Q, { type: "say", role: "head", kind: "note", text: "a note" }, 1000)`);
    expect(p.run("DUE(4000)")).toEqual(["say:search", "say:head"]);
  });

  it("moves the shredder's count, the Head's funnel and the wall screen's market only when their events play, never ahead of the story", () => {
    const p = page({ raf: true, reduced: false, size: { w: 2400, h: 1050 } });
    p.run("globalThis.H = flMount(CANVAS, {})");
    const eth = { symbol: "ETH", name: "Ethereum", kind: "coin", candles: state().focus.candles, price: 130.5, priceStep: 0.01, marks: [] };
    p.run(`H.set(${JSON.stringify(state({ rejected: 2 }))})`);
    let t = 1000;
    for (let i = 0; i < 10; i++) p.frame((t += 16));
    // one read: the state already counts the reject and a new funnel, the focus turned to ETH; the events tell how
    p.run(`H.set(${JSON.stringify(state({ rejected: 3, funnel: { scanned: 50, cleared: 5, executed: 3, closed: 1, rejected: 3 }, focus: eth }))})`);
    p.run(`H.push({ type: "say", role: "search", kind: "lead", text: "Lead L-7 on ETH: buy, a clean break of the range" })`);
    p.run(`H.push({ type: "handoff", lead: "L-7", symbol: "ETH", side: "buy", from: "search", to: "risk" })`);
    p.run(`H.push({ type: "reject", lead: "L-8", symbol: "PEPE", from: "risk", why: "spread 0.92%" })`);
    p.run(`H.push({ type: "say", role: "head", kind: "cycle", text: "Cycle 9 (the clock): 2 leads scanned, 1 cleared, 0 placed, 1 open." })`);
    p.rec.clear();
    p.frame((t += 16));
    // at once: the old count (the reject's packet is not in yet), the old funnel, the old market (the lead's packet has not lifted)
    expect(after(p.rec.texts, "REJECTED")).toBe("2");
    expect(p.rec.texts).toContain("40");
    expect(p.rec.texts).not.toContain("50");
    expect(p.rec.texts).toContain("SOL · Solana · Perpetual");
    expect(p.rec.texts.join(" ")).not.toContain("Cycle 9");
    // then the story: the packet lifts (the screen turns to ETH), the reject lands (3), and only then the Head sums up (the new funnel)
    const seen: Record<string, number> = {};
    for (let i = 0; i < 900; i++) {
      p.rec.clear();
      p.frame((t += 16));
      const tx = p.rec.texts;
      if (!seen.eth && tx.includes("ETH · Ethereum · Crypto")) seen.eth = t;
      if (!seen.three && after(tx, "REJECTED") === "3") seen.three = t;
      // (the Head's line as it starts typing: its first letters)
      if (!seen.cycle && tx.some((x) => x.length > 0 && x.startsWith("C") && "Cycle 9 (the clock): 2 leads scanned".startsWith(x))) seen.cycle = t;
      if (!seen.fifty && tx.includes("50")) seen.fifty = t;
    }
    expect(seen.eth).toBeGreaterThan(0);
    expect(seen.three).toBeGreaterThan(0);
    expect(seen.cycle).toBeGreaterThan(Math.max(seen.eth!, seen.three!));
    // the funnel turns as the Head's line starts (its first letter shows a frame or two later)
    expect(seen.fifty).toBeGreaterThan(Math.max(seen.eth!, seen.three!));
    expect(Math.abs(seen.fifty! - seen.cycle!)).toBeLessThan(100);
  });

  it("lets what waits go when the session leaves 'live': the last cycle is not narrated in the dark", () => {
    const p = page({ raf: true, reduced: false });
    p.run("globalThis.H = flMount(CANVAS, {})");
    p.run(`H.set(${JSON.stringify(state())})`);
    let t = 1000;
    for (let i = 0; i < 5; i++) p.frame((t += 16));
    p.run(`H.set(${JSON.stringify(state({ session: { state: "ended" } }))})`);
    p.run(`H.push({ type: "say", role: "risk", text: "first line of the last cycle" })`);
    p.run(`H.push({ type: "say", role: "risk", text: "second line of the last cycle" })`);
    let said = false;
    let ended = false;
    for (let i = 0; i < 400; i++) {
      p.rec.clear();
      p.frame((t += 20));
      if (/line of the last cycle/.test(p.rec.texts.join(" "))) said = true;
      if (p.rec.texts.includes("SESSION ENDED")) ended = true;
    }
    expect(said).toBe(false);
    expect(ended).toBe(true);
  });

  it("rests while nothing moves — a frame drawn at most every 33 ms, the display's rate still measured — and is back at the full rate on a push", () => {
    const p = page({ raf: true, reduced: false, size: { w: 800, h: 350 } });
    p.run("globalThis.H = flMount(CANVAS, {})");
    p.run(`H.set(${JSON.stringify(bare)})`);
    let t = 1000;
    while (t < 5000) p.frame((t += 1000 / 120));
    expect(p.run("H.stats().idle")).toBe(true);
    const drawnOver = (n: number) => {
      let drawn = 0;
      for (let i = 0; i < n; i++) {
        const before = p.rec.calls.get("fillRect") ?? 0;
        p.frame((t += 1000 / 120));
        if ((p.rec.calls.get("fillRect") ?? 0) > before) drawn++;
      }
      return drawn;
    };
    // 48 frame callbacks over 400 ms: about twelve drawn
    const resting = drawnOver(48);
    expect(resting).toBeGreaterThanOrEqual(10);
    expect(resting).toBeLessThanOrEqual(14);
    expect(p.run("H.stats().fps")).toBe(120);
    // a line pushed: every callback draws while it types
    p.run(`H.push({ type: "say", role: "head", text: "Cycle 4 (the clock): 40 scanned, 2 cleared, 1 placed, 2 open" })`);
    expect(drawnOver(24)).toBe(24);
    expect(p.run("H.stats().idle")).toBe(false);
  });
});

describe("the floor, polished for real users: money, the brain, the empty screen, the marks, the trophy and the tray say true things plainly", () => {
  /** New York's hh:mm for a time, as the floor's clock writes it */
  const CANDLE = /^rgba\((63,207,114|255,107,97),0\.95\)$/;
  /** where the candles end on the wall screen: the right edge of the rightmost wick or body drawn */
  const barsEnd = (seq: Array<{ op: string; style: string; args: unknown[] }>) =>
    Math.max(...seq.filter((x) => x.op === "fillRect" && CANDLE.test(x.style)).map((x) => Number(x.args[0]) + Number(x.args[2])));

  it("writes money to the cent everywhere, as the page does: a stop's float says −$0.44, as the bubble beside it does, never −$0.4400", () => {
    const p = page();
    expect(p.run("[flUsd(-0.44), flSigned(-0.44), flSigned(0.4), flUsd(0.009), flUsd(0.0044), flUsd(-0.0000001234), flUsd(1234), flUsd(12345.6), flUsd(-0)]")).toEqual([
      "−$0.44",
      "−$0.44",
      "+$0.40",
      "$0.01",
      "$0.0044",
      "−$0.00000012",
      "$1,234.00",
      "$12,345.60",
      "$0.00",
    ]);
    p.run("globalThis.H = flMount(CANVAS, {})");
    p.run(`H.set(${JSON.stringify(state())})`);
    p.rec.clear();
    p.run(`H.push({ type: "exit", lead: "L-9", symbol: "BTC/USD", why: "stop", pnlUsd: -0.44 })`);
    expect(p.rec.texts).toContain("STOP BTC/USD −$0.44");
    expect(p.rec.texts.filter((x) => /\$\d+\.\d{3,}/.test(x))).toEqual([]);
  });

  it("says the brain's trouble on its rack in a few words, never a sentence cut off mid-instruction; the whole sentence stays in the canvas's words", () => {
    const p = page();
    const refused = "Anthropic refused the brain's key: replace it in /Users/someone/.portfolio/credentials/anthropic/api-key.json — the next cycle reads it, no restart";
    const cases: Array<[unknown, string]> = [
      [{ ok: true }, "idle"],
      [{ ok: false, why: "not read yet" }, "not read yet"],
      [{ ok: false, why: refused }, "off · key refused"],
      [{ ok: false, why: "the API did not accept the key" }, "off · key refused"],
      [{ ok: false, why: "key refused" }, "off · key refused"],
      [{ ok: false, why: "no key: the brain reads an Anthropic API key from /h/k.json, which is not there yet; it is read again at every check, no restart needed (if you start the account by hand, ANTHROPIC_API_KEY in its environment works too)" }, "off · no key"],
      [{ ok: false, why: "ANTHROPIC_API_KEY in the service's environment is the example or a fragment, not a key: set the key itself and restart the service" }, "off · env setting wrong"],
      [{ ok: false, why: '/h/k.json holds the example, not a key: put your key between the quotes of "apiKey"' }, "off · key file not filled in"],
      [{ ok: false, why: "the key file cannot be used: other users can read it" }, "off · key file unusable"],
      [{ ok: false, why: "something long the floor has no name for, said in a whole sentence" }, "off · not ready"],
      [{ ok: false, why: "busy" }, "off · busy"],
      [{ ok: false }, "off"],
      [null, ""],
    ];
    for (const [b, want] of cases) expect(p.run(`flBrainWord(flNorm({ brain: ${JSON.stringify(b)} }).brain)`), JSON.stringify(b)).toBe(want);
    // the account's own name for the trouble, where the page hands it on, before anything read from a sentence
    expect(p.run(`flNorm({ brain: { ok: false, why: "anything at all", fix: { code: "rejected" } } }).brain.code`)).toBe("rejected");
    expect(p.run(`flBrainWord(flNorm({ brain: { ok: false, why: "anything at all", code: "no-key" } }).brain)`)).toBe("off · no key");
    // mounted: the rack's words are the few, the canvas's words the whole sentence
    p.run("globalThis.H = flMount(CANVAS, {})");
    p.rec.clear();
    p.run(`H.set(${JSON.stringify(state({ brain: { ok: false, why: refused } }))})`);
    expect(p.rec.texts[p.rec.texts.lastIndexOf("BRAIN") + 1]).toBe("off · key refused");
    expect(p.rec.texts.filter((x) => /replace it|refused the brain|…$/.test(x))).toEqual([]);
    expect(p.attrs.get("aria-label")).toContain(`The brain cannot think: ${refused}.`);
  });

  it("says 'No market picked yet' when the last scan picked none — never that the screen waits for a first scan already made", () => {
    const p = page();
    p.run("globalThis.H = flMount(CANVAS, {})");
    const at = "2026-10-15T04:05:00.000Z";
    const scan = { at, rows: [{ symbol: "BTC/USD" }, { symbol: "ETH/USD" }, { symbol: "LINK/USD" }], picked: [] };
    p.rec.clear();
    p.run(`H.set(${JSON.stringify(state({ focus: null, scan }))})`);
    expect(p.rec.texts).toContain("No market picked yet");
    expect(p.rec.texts).toContain("the last scan picked none of its 3 markets");
    expect(p.rec.texts.join(" ")).not.toContain("first scan");
    expect(p.rec.texts.join(" ")).toContain("PICKED 0");
    // no scan yet: the screen waits for the first
    p.rec.clear();
    p.run(`H.set(${JSON.stringify(state({ focus: null, scan: null }))})`);
    expect(p.rec.texts).toContain("No market in focus");
    expect(p.rec.texts).toContain("the screen waits for the desk's first scan");
    // a scan that picked, with no market given to chart: no guess at why
    p.rec.clear();
    p.run(`H.set(${JSON.stringify(state({ focus: null, scan: { ...scan, picked: ["ETH/USD"] } }))})`);
    expect(p.rec.texts).toContain("No market in focus");
    expect(p.rec.texts.join(" ")).not.toMatch(/first scan|picked none/);
    expect(p.run(`flScreenNone({ rows: [{ symbol: "A" }], picked: [] }).b`)).toBe("the last scan picked none of its 1 market");
  });

  it("keeps every mark's words clear of the candles: the bars end where the words' column begins, the words on plates as opaque as the glass", () => {
    const words = /^(L-0002 )?(TP|SL|ENTRY ▲) \d/;
    for (const size of [{ w: 1600, h: 700 }, { w: 1024, h: 448 }]) {
      const at = `${size.w}×${size.h}`;
      const p = page({ size });
      p.run("globalThis.H = flMount(CANVAS, {})");
      // no mark: no column, the bars run on to the axis
      p.rec.clear();
      p.run(`H.set(${JSON.stringify(state())})`);
      const free = barsEnd(p.rec.seq);
      p.rec.clear();
      p.run(`H.set(${JSON.stringify(state({ focus: { ...state().focus, priceStep: undefined, marks: [{ lead: "L-0002", side: "buy", entry: 128.25, tp: 131.5, sl: 125.1, state: "executed" }] } }))})`);
      const seq = p.rec.seq;
      const labels = seq.map((x, i) => [x, i] as const).filter(([x]) => x.op === "fillText" && words.test(String(x.args[0])));
      expect(labels.map(([x]) => String(x.args[0]).replace(/^L-0002 /, "")).sort(), at).toEqual(["ENTRY ▲ 128.25", "SL 125.10", "TP 131.50"]);
      const end = barsEnd(seq);
      expect(end, at).toBeLessThan(free);
      for (const [x, i] of labels) {
        const plate = seq.slice(0, i).reverse().find((y) => y.op === "fillRect")!;
        // a plate as opaque as the glass, under the whole of the words, and no bar reaching under it
        expect(plate.style, `${at} ${x.args[0]}`).toMatch(/,1\)$/);
        expect(plate.args[0] as number, `${at} ${x.args[0]}`).toBeLessThanOrEqual(x.args[1] as number);
        expect(end, `${at} ${x.args[0]}`).toBeLessThanOrEqual(plate.args[0] as number);
      }
    }
    // a chart too narrow for a column (a phone's): no column, the bars run on, each mark's words once at the top left on an opaque plate
    const ph = page({ size: { w: 343, h: 300 } });
    ph.run("globalThis.H = flMount(CANVAS, {})");
    ph.rec.clear();
    ph.run(`H.set(${JSON.stringify(state())})`);
    const free = barsEnd(ph.rec.seq);
    ph.rec.clear();
    ph.run(`H.set(${JSON.stringify(state({ focus: { ...state().focus, priceStep: undefined, marks: [{ lead: "L-0002", side: "buy", entry: 128.25, tp: 131.5, sl: 125.1, state: "executed" }] } }))})`);
    expect(barsEnd(ph.rec.seq)).toBe(free);
    expect(ph.rec.texts.filter((x) => words.test(x))).toEqual([]);
    const said = ph.rec.seq.findIndex((x) => x.op === "fillText" && /^(L-0002 )?▲ (entry )?128\.25/.test(String(x.args[0])));
    expect(said).toBeGreaterThan(0);
    expect(ph.rec.seq.slice(0, said).reverse().find((y) => y.op === "fillRect")!.style).toMatch(/,1\)$/);
    // the merged words at the top left sit on an opaque plate too, and a mark said only there leaves no empty column: the bars run on
    const q = page();
    q.run("globalThis.H = flMount(CANVAS, {})");
    q.rec.clear();
    q.run(`H.set(${JSON.stringify(state())})`);
    const open = barsEnd(q.rec.seq);
    q.rec.clear();
    q.run(`H.set(${JSON.stringify(state({ focus: { ...state().focus, marks: [{ lead: "L-0002", side: "buy", entry: 120, tp: 120.05, sl: 119.97, state: "executed" }] } }))})`);
    const i = q.rec.seq.findIndex((x) => x.op === "fillText" && x.args[0] === "L-0002 ▲ entry 120.00 · TP 120.05 · SL 119.97");
    expect(i).toBeGreaterThan(0);
    expect(q.rec.seq.slice(0, i).reverse().find((y) => y.op === "fillRect")!.style).toMatch(/,1\)$/);
    expect(barsEnd(q.rec.seq)).toBe(open);
  });

  it("writes a mark's words over every line on the screen: after the last price's dashed line and the scan's thread to the latest candle", () => {
    const p = page();
    p.run("globalThis.H = flMount(CANVAS, {})");
    p.rec.clear();
    const scan = { at: "2026-10-15T04:05:00.000Z", rows: [{ symbol: "SOL", volumeUsd24h: 1e9 }, { symbol: "ETH", volumeUsd24h: 2e9 }], picked: ["SOL"] };
    p.run(`H.set(${JSON.stringify(state({ scan, focus: { ...state().focus, priceStep: undefined, marks: [{ lead: "L-0002", side: "buy", entry: 128.25, tp: 131.5, sl: 125.1, state: "executed" }] } }))})`);
    const seq = p.rec.seq;
    const lastStroke = (re: RegExp) => seq.reduce((at, x, i) => ((x.op === "stroke" || x.op === "strokeRect") && re.test(x.style) ? i : at), -1);
    // the last price's dashed line (the up colour at 0.75) and the thread from the picked node (the accent, faint)
    const priceLine = lastStroke(/^rgba\(63,207,114,0\.75\)$/);
    const thread = lastStroke(/^rgba\(140,239,255,0\.32\)$/);
    expect(priceLine).toBeGreaterThan(0);
    expect(thread).toBeGreaterThan(0);
    const firstWord = seq.findIndex((x) => x.op === "fillText" && /^L-0002 (TP|SL|ENTRY)/.test(String(x.args[0])));
    expect(firstWord).toBeGreaterThan(priceLine);
    expect(firstWord).toBeGreaterThan(thread);
  });

  it("writes a mark's entry as it filled and its take-profit and stop to the entry's decimals, the figures the page's table writes", () => {
    const p = page();
    expect(p.run("[flPrice(62736.37, NaN, 62428.5), flPrice(62428.5, NaN, 62428.5), flPrice(2467.2, NaN, 2457.37), flPrice(2457.3700000000003, NaN, 2457.3700000000003), flPrice(13.8512, NaN, 13.79), flPrice(152.3)]")).toEqual([
      "62,736.4",
      "62,428.5",
      "2,467.20",
      "2,457.37",
      "13.85",
      "152.30",
    ]);
    const w = p.run<Record<string, string>>(`flMarkWords({ lead: "L-0002", side: "buy", entry: 62428.5, tp: 62736.37, sl: 62120.1, state: "executed" }, NaN)`);
    expect([w.entry, w.tp, w.sl]).toEqual(["L-0002 ENTRY ▲ 62,428.5", "L-0002 TP 62,736.4", "L-0002 SL 62,120.1"]);
  });

  it("writes the trophy's figure as progress toward the target — '−0.2%' over 'OF TARGET' — never a 'TARGET' label over the figure", () => {
    for (const size of [{ w: 1600, h: 700 }, { w: 343, h: 300 }]) {
      const at = `${size.w}×${size.h}`;
      const p = page({ size });
      p.run("globalThis.H = flMount(CANVAS, {})");
      p.rec.clear();
      p.run(`H.set(${JSON.stringify(state({ target: { progressPct: -0.2 } }))})`);
      const t = p.rec.texts;
      expect(t, at).not.toContain("TARGET");
      const fig = t.indexOf("−0.2%");
      expect(fig, at).toBeGreaterThanOrEqual(0);
      expect(["OF TARGET", "OF GOAL"], at).toContain(t[fig + 1]);
      // in the down colour (with its minus), the label in the fixtures' mint
      const seqFig = p.rec.seq.find((x) => x.op === "fillText" && x.args[0] === "−0.2%")!;
      expect(seqFig.style, at).toBe("rgba(255,107,97,1)");
    }
  });

  it("draws no unlabelled tray on a phone: where no words fit and no card waits there is no tray to see or pick; a waiting card brings it back, amber", () => {
    const size = { w: 343, h: 300 };
    const p = page({ size });
    p.run("globalThis.PICKS = []; globalThis.H = flMount(CANVAS, { onPick: (w) => PICKS.push(w) })");
    const L = p.run<any>(`flLayout(${size.w}, ${size.h})`);
    // the tray's front face: a box whose foot is at the tray's bottom, inside the gap between the Sentiment's and the Watch's words
    const trayBox = () =>
      p.rec.seq.filter((x) => x.op === "fillRect" && Math.abs(Number(x.args[1]) + Number(x.args[3]) - L.tray.bottom) < 0.01 && Number(x.args[0]) >= L.tray.gapX0 - 12 && Number(x.args[0]) + Number(x.args[2]) <= L.tray.gapX1 + 12);
    p.rec.clear();
    p.run(`H.set(${JSON.stringify(state({ cards: 0, autonomy: true }))})`);
    expect(trayBox()).toEqual([]);
    expect(p.rec.texts.filter((x) => /AUTO|NO CARD|TRAY/.test(x))).toEqual([]);
    p.cv.fire("click", { clientX: L.tray.cx, clientY: L.tray.bottom - 4 });
    expect(JSON.parse(p.run<string>("JSON.stringify(PICKS)"))).toEqual([]);
    // the canvas's words still say it
    expect(p.attrs.get("aria-label")).toContain("Auto on paper: no card waits for you.");
    // a card waits: the tray is back, its count amber, and it can be picked
    p.rec.clear();
    p.run(`H.set(${JSON.stringify(state({ cards: 1, autonomy: false }))})`);
    expect(trayBox().length).toBe(1);
    const amber = p.rec.seq.filter((x) => x.op === "fillText" && /^1( WAITS)?/.test(String(x.args[0])) && x.style === "rgba(245,196,107,1)");
    expect(amber.length).toBe(1);
    p.cv.fire("click", { clientX: L.tray.cx, clientY: L.tray.bottom - 4 });
    expect(JSON.parse(p.run<string>("JSON.stringify(PICKS)"))).toEqual([{ tray: true }]);
    // on a wide floor, where its words fit, the tray stays with no card waiting
    const q = page();
    q.run("globalThis.H = flMount(CANVAS, {})");
    q.rec.clear();
    q.run(`H.set(${JSON.stringify(state({ cards: 0, autonomy: true }))})`);
    expect(q.rec.texts).toContain("AUTO ON PAPER · NO CARDS");
  });
});
