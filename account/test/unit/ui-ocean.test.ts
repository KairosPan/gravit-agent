/** The ocean (ui/ocean.js), the page's ground, run as the page runs it over a stand-in for the browser: a canvas whose 2D context records
 * what is drawn, animation frames handed out by the test at a display's rate, the stylesheet's colours as the tokens give them. It draws at
 * once, then a frame at the display's rate (a step of the world and a drawing each); under reduced motion it draws one still frame and asks
 * for no frame at all; it stops while the page is hidden; it reads its colours from the tokens and again when the background changes; it
 * reads the calm water's boxes four times a second at most; and released, it lets go of everything it listened to. Without a canvas it is a
 * handle that does nothing. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext, Script } from "node:vm";
import { describe, expect, it } from "vitest";

const PUBLIC = fileURLToPath(new URL("../../src/portfolio/public/", import.meta.url));
const OCEAN = readFileSync(join(PUBLIC, "ui/ocean.js"), "utf8");

/** Light's and Black's colours for the ocean, as ui/tokens.css writes them */
const LIGHT = { "--oc-ground": "#fcfcfb", "--oc-grid": "rgba(17, 17, 17, 0.05)", "--oc-shadow": "#e7e7e3", "--oc-lit": "#5d5d59", "--oc-ink": "#1b1b1a", "--oc-ink-on": "#f6f6f2", "--oc-sparkle": "#000000", "--oc-eye": "#8b8b86", "--oc-edge": "#85857f", "--oc-fish": "#2a2a27", "--oc-wake": "#8a8a85", "--oc-spark": "#e2453a", "--oc-glints": "#e8912d #e2453a #a855f7" };
const BLACK = { ...LIGHT, "--oc-ground": "#000000", "--oc-grid": "rgba(255, 255, 255, 0.055)", "--oc-shadow": "#2e2e2e", "--oc-lit": "#cecece", "--oc-fish": "#e6eeff", "--oc-wake": "#6ee6ff" };

interface Rec {
  ops: Record<string, number>;
  fills: string[];
}
/** a 2D context that records how many of each drawing call it was given, and the colour each fillRect was drawn in */
function context(rec: Rec) {
  const count = (op: string) => () => void (rec.ops[op] = (rec.ops[op] ?? 0) + 1);
  const ctx: Record<string, unknown> = { fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", textAlign: "", textBaseline: "", globalAlpha: 1 };
  for (const op of ["setTransform", "drawImage", "fillText", "clearRect", "beginPath", "moveTo", "lineTo", "stroke"]) ctx[op] = count(op);
  ctx.fillRect = () => {
    rec.ops.fillRect = (rec.ops.fillRect ?? 0) + 1;
    rec.fills.push(String(ctx.fillStyle));
  };
  return ctx;
}

/** the ocean in a stand-in browser: `still` as the owner's motion setting, the tokens as the stylesheet's, a 1440 × 900 canvas at 2× */
function ocean(opts: { still?: boolean; tokens?: Record<string, string>; calm?: Array<{ left: number; top: number; width: number; height: number }> } = {}) {
  const page: Rec = { ops: {}, fills: [] };
  const ground: Rec = { ops: {}, fills: [] };
  const made: Rec[] = [];
  let frames: Array<(t: number) => void> = [];
  const listeners: Array<{ on: string; type: string; added: boolean }> = [];
  const heard: Record<string, Array<(e?: unknown) => void>> = {};
  const target = (on: string) => ({
    addEventListener(type: string, fn: (e?: unknown) => void) {
      listeners.push({ on, type, added: true });
      (heard[`${on}:${type}`] ||= []).push(fn);
    },
    removeEventListener(type: string) {
      listeners.push({ on, type, added: false });
    },
  });
  let tokens = { ...(opts.tokens ?? LIGHT) };
  const motion = { matches: !!opts.still, ...target("motion") };
  let resized: (() => void) | null = null;
  let recoloured: (() => void) | null = null;
  let calmReads = 0;
  const canvas = { width: 0, height: 0, getContext: () => context(page), getBoundingClientRect: () => ({ width: 1440, height: 900, left: 0, top: 0 }) };
  const documentElement = { ...target("html") };
  const sandbox: Record<string, unknown> = {
    document: {
      ...target("document"),
      hidden: false,
      documentElement,
      createElement: () => {
        const rec: Rec = made.length === 0 ? ground : { ops: {}, fills: [] };
        made.push(rec);
        return { width: 0, height: 0, getContext: () => context(rec) };
      },
      getElementById: (id: string) => (id === "ocean" ? canvas : null),
      querySelectorAll: (sel: string) => {
        if (sel !== "[data-ocean-calm]") return [];
        calmReads++;
        return (opts.calm ?? []).map((b) => ({ getBoundingClientRect: () => ({ ...b, right: b.left + b.width, bottom: b.top + b.height }) }));
      },
      fonts: { load: () => Promise.resolve() },
    },
    getComputedStyle: () => ({ getPropertyValue: (name: string) => tokens[name as keyof typeof tokens] ?? "" }),
    requestAnimationFrame: (fn: (t: number) => void) => (frames.push(fn), frames.length),
    cancelAnimationFrame: () => {
      frames = [];
    },
    ResizeObserver: class {
      constructor(fn: () => void) {
        resized = fn;
      }
      observe() {}
      disconnect() {}
    },
    MutationObserver: class {
      constructor(fn: () => void) {
        recoloured = fn;
      }
      observe() {}
      disconnect() {}
    },
    performance: { now: () => performance.now() },
    devicePixelRatio: 2,
    STILL: motion,
    still: () => motion.matches,
    console,
    Math,
    JSON,
    Promise,
  };
  Object.assign(sandbox, target("window"));
  const ctx = createContext(sandbox);
  sandbox.globalThis = runInContext("globalThis", ctx);
  new Script(OCEAN, { filename: "ui/ocean.js" }).runInContext(ctx);
  const run = <T = unknown>(code: string): T => runInContext(code, ctx) as T;
  let clock = 1000;
  /** n frames at a display's rate (60 a second), as the browser hands them out */
  const tick = (n: number, ms = 1000 / 60) => {
    for (let i = 0; i < n; i++) {
      const next = frames.shift();
      if (!next) return i;
      clock += ms;
      next(clock);
    }
    return n;
  };
  return {
    run,
    tick,
    page,
    ground,
    listeners,
    pending: () => frames.length,
    stats: () => run<Record<string, number | boolean>>("OCEAN.stats()"),
    fire: (on: string, type: string, e?: unknown) => (heard[`${on}:${type}`] ?? []).forEach((fn) => fn(e)),
    hide: (hidden: boolean) => ((sandbox.document as { hidden: boolean }).hidden = hidden),
    setMotion: (still: boolean) => (motion.matches = still),
    setTokens: (t: Record<string, string>) => (tokens = { ...t }),
    resize: () => resized && resized(),
    recolour: () => recoloured && recoloured(),
    calmReads: () => calmReads,
  };
}

describe("the ocean, the page's ground", () => {
  it("draws at once as the page loads, then a frame at the display's rate — a step of the world and a drawing each", () => {
    const o = ocean();
    // the first frame is drawn before any animation frame: the ground (copied), the sharks' blocks
    expect(o.page.ops.drawImage).toBeGreaterThan(0);
    expect(o.pending()).toBe(1);
    const drawn = o.page.ops.drawImage ?? 0;
    expect(o.tick(240)).toBe(240);
    expect(o.page.ops.drawImage).toBeGreaterThan(drawn + 240);
    const s = o.stats();
    expect(s.fps).toBe(60);
    expect(s.still).toBe(false);
    expect(s.sharks).toBe(4);
    expect(s.fish).toBe(282);
    // the grid's cells: a 140th of 1440 is 10 px, half again as tall, at 2× (144 × 60)
    expect(s.cells).toBe(8640);
    // one step and one drawing measured apiece
    expect(Number(s.stepMs)).toBeGreaterThan(0);
    expect(Number(s.drawMs)).toBeGreaterThan(0);
  });

  it("under reduced motion draws one still frame and asks for no frame at all; turned off, it starts to move", () => {
    const o = ocean({ still: true });
    expect(o.page.ops.drawImage).toBeGreaterThan(0);
    expect(o.pending()).toBe(0);
    expect(o.stats().still).toBe(true);
    o.setMotion(false);
    o.fire("motion", "change");
    expect(o.pending()).toBe(1);
    // and back on: the loop stops at once, the frame drawn still
    o.setMotion(true);
    o.fire("motion", "change");
    expect(o.pending()).toBe(0);
  });

  it("stops while the page is hidden and goes on when it shows again", () => {
    const o = ocean();
    o.tick(10);
    o.hide(true);
    o.fire("document", "visibilitychange");
    expect(o.pending()).toBe(0);
    o.hide(false);
    o.fire("document", "visibilitychange");
    expect(o.pending()).toBe(1);
  });

  it("draws its ground in the background's own colours, and again when the background changes (Light, Black, the trading area)", () => {
    const o = ocean({ tokens: LIGHT });
    expect(o.ground.fills[0]).toBe("rgba(252,252,251,1)");
    o.setTokens(BLACK);
    o.recolour();
    expect(o.ground.fills.at(-1)).toBe("rgba(0,0,0,1)");
    // the same colours again change nothing
    const n = o.ground.fills.length;
    o.recolour();
    expect(o.ground.fills.length).toBe(n);
  });

  it("reads the calm water's boxes four times a second at most, never every frame", () => {
    const o = ocean({ calm: [{ left: 400, top: 120, width: 800, height: 300 }] });
    o.tick(120);
    // two seconds of frames: about eight reads, not a hundred and twenty
    expect(o.calmReads()).toBeGreaterThanOrEqual(7);
    expect(o.calmReads()).toBeLessThanOrEqual(9);
  });

  it("released, stops and lets go of every listener it added", () => {
    const o = ocean();
    o.tick(5);
    o.run("OCEAN.release()");
    expect(o.pending()).toBe(0);
    const added = o.listeners.filter((l) => l.added).map((l) => `${l.on}:${l.type}`).sort();
    const removed = o.listeners.filter((l) => !l.added).map((l) => `${l.on}:${l.type}`).sort();
    expect(added.length).toBeGreaterThan(0);
    expect(removed).toEqual(added);
  });

  it("is a handle that does nothing where there is no canvas to draw on", () => {
    const o = ocean();
    expect(o.run("ocMount(null).stats()")).toBeNull();
    expect(o.run("ocMount({}).stats()")).toBeNull();
    expect(o.run("ocMount({ getContext: () => null }).stats()")).toBeNull();
  });
});
