/* THE OCEAN — the page's ground, drawn in type: a grid of character cells under the whole page, where a few sharks patrol and hunt schools
   of small fish. Written for this page in the look of stackedlol's ascii-sharks (none of its code is used: that repository carries no
   licence). It is decor and nothing else: it reads nothing, says nothing and stands for no figure. The panes float over it as frosted
   glass (shell.css), and the only things it answers are the pointer — fish keep clear of it, and a click on open water scatters them —
   and the page's headline: a part marked [data-ocean-calm] (the Portfolio's net worth, floating on the water) is a stretch of calm water
   the sharks swim round, so the figure is seldom crossed.

   Back to front, on one canvas fixed behind the app (account.html #ocean):
     the ground   a fill and a faint grid of cells, in the background's own colours (ui/tokens.css --oc-*: Light after the reference's
                  video, Black after its source; the trading area is always Black)
     the wake     a field over the cells that the tails and the fish stir, spreading out and fading: a small dot wherever it is strong
     the burst    where a fish was eaten, a few sparks for a moment
     the fish     schools: each fish keeps its room, lines up with the school and closes on its middle, one dash each, brighter the
                  nearer it swims and glinting while it turns hard. They bolt from a shark's head and flanks and from the pointer, and the alarm
                  runs fish to fish through a school, so a whole school breaks when only its edge saw the shark
     the sharks   a spine of joints the head pulls along (each joint bending only so far), a wave running down it. The body is laid on
                  the cells against a top-down outline (snout, pectoral fins, dorsal, tail; a hammerhead's head): a cell it covers is a
                  block of grey shaded by the light with a glyph on it — denser glyphs in shadow, a few glinting in colour — and a cell it
                  half covers, at the edge, is a light glyph alone. Each glyph is tied to a place on the skin, so it rides along with it.
                  They patrol, grow hungry, and hunt the stragglers of a school; the smaller ones swim deeper, under the bigger

   COST. The world moves in fixed steps (1/60 s, at most four a frame). A frame copies the ground, draws the blocks one colour at a time
   and every glyph from an atlas (each glyph in each colour drawn once, then copied); a shark is laid only on the cells near it, and a cell
   deep in its body is taken whole, unsampled. The loop stops while the page is hidden; past 10 ms for a step and a drawing (the 95th
   percentile of the last 120 of each), it draws every second frame. With prefers-reduced-motion there is no
   loop: one still frame, drawn again when the size or the background changes.

   ocMount(canvas)   the ocean drawn into canvas (it sizes itself to the canvas's box); returns { stats(), release() }: stats() is
                     { fps, p95ms, engineMs, stepMs, drawMs, lite, still, cells, fish, sharks } — the display's frame rate (the median
                     interval between frames), the 95th percentile of that interval, of the engine's own part of a frame, of one step of the
                     world and of one drawing (a frame is a drawing and as many steps as the time since the last one asks: one at 60 fps),
                     whether it draws every second frame, whether it is still — or null where there is no canvas to draw on
   OCEAN             the page's own, mounted on #ocean as the page loads */

const OC_STEP = 1 / 60;
const OC_JOINTS = 18;
/* the glyphs: a body cell's by its shadow (light to dense, so the texture follows the shading), the dorsal ridge's, a fin's, a cell half
   covered at the edge (the lighter set where less of it is covered), an eye, a burst's two (a fish is a dash: drawn as its bar) */
const OC_RAMP = ":;+tx%SX8#@";
const OC_RIDGE = "@#8";
const OC_FIN = "+;t%:";
const OC_EDGE_LO = ".',`";
const OC_EDGE_HI = ":;";
const OC_GLYPHS = [...new Set(`${OC_RAMP}${OC_RIDGE}${OC_FIN}${OC_EDGE_LO}${OC_EDGE_HI}o*·`)].join("");
const ocIdx = (s) => Int16Array.from([...s].map((c) => OC_GLYPHS.indexOf(c)));
const OC_I = { ramp: ocIdx(OC_RAMP), ridge: ocIdx(OC_RIDGE), fin: ocIdx(OC_FIN), lo: ocIdx(OC_EDGE_LO), hi: ocIdx(OC_EDGE_HI), eye: OC_GLYPHS.indexOf("o"), star: OC_GLYPHS.indexOf("*"), dot: OC_GLYPHS.indexOf("·") };
/* what a cell holds of a shark */
const OC_BODY = 1;
const OC_EDGE = 2;
const OC_FINS = 3;
const OC_RIDGE_F = 4;
const OC_EYE = 5;
/* where in a cell the four extra samples are taken (as shares of its width and height), for the edges' coverage */
const OC_SUB = [0.22, 0.28, 0.78, 0.28, 0.22, 0.74, 0.78, 0.74];

/* the schools' kinds: how fast they cruise and may go (px a second), the room each fish keeps (in cells, across and up), how strongly a
   school lines up, closes in and wanders, whether it turns about its middle (a bait ball), how level it swims, how many it is, how often it
   comes */
const OC_FISH = [
  // a bait ball: a tight school turning about its middle
  { cruise: 32, max: 62, min: 15, room: [1.7, 1.1], align: 1.5, close: 1.7, jitter: 36, circle: 58, level: 0.7, school: [14, 24], odds: 3 },
  // a ribbon: fast, lined up, loosely held
  { cruise: 48, max: 84, min: 24, room: [1.6, 1.0], align: 3.4, close: 0.45, jitter: 26, circle: 0, level: 1.5, school: [16, 28], odds: 3 },
  // a shoal: between the two
  { cruise: 38, max: 68, min: 18, room: [2.1, 1.2], align: 2.2, close: 1.0, jitter: 32, circle: 0, level: 1.7, school: [10, 18], odds: 3 },
  // strays: slow, wandering, close together
  { cruise: 22, max: 52, min: 9, room: [1.4, 1.1], align: 0.5, close: 1.3, jitter: 90, circle: 0, level: 0.4, school: [6, 10], odds: 1 },
];
const OC_ODDS = OC_FISH.reduce((n, k) => n + k.odds, 0);

const ocClamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const ocRand = (lo, hi) => lo + Math.random() * (hi - lo);
function ocSmooth(a, b, x) {
  const t = ocClamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
/* the shortest turn from angle a to angle b, in (−π, π] */
function ocTurn(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
/* three integers to a number in [0, 1), the same every time: a texture that stays put */
function ocHash(x, y, z) {
  let h = Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663) ^ Math.imul(z | 0, 83492791);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/* a colour as the stylesheet writes it (#rgb, #rrggbb, rgb(), rgba()) as [r, g, b, a], or null */
function ocRgb(text) {
  const s = String(text || "").trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16)).concat(1);
  m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(s);
  if (!m) return null;
  const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  return [+m[1], +m[2], +m[3], a];
}
const ocCss = (c, a = c[3]) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${+a.toFixed(3)})`;
const ocMix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
const ocLum = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;

/* a fin as a blade off the body: its root from a to b along the body, its tip at c along and r out (all in px). A point u along and d out
   is on it when, at its share of the reach (d / r), it lies between the leading edge (a to the tip, straight) and the trailing edge (b to
   the tip — bowed in on a falcate fin, so the fin is a sickle) */
function ocFin(u, d, a, b, c, r, falcate) {
  if (!(r > 0) || d > r) return false;
  const t = d / r;
  return u >= a + (c - a) * t && u <= b + (c - b) * (falcate ? t * t : t);
}
/* a requiem shark's half-width at s (0 the snout, 1 the tail), as a share of its length */
function ocReefHalf(s) {
  if (s < 0.12) return 0.088 * Math.pow(Math.sin(((s / 0.12) * Math.PI) / 2), 0.85);
  if (s < 0.3) return 0.088 + 0.018 * ocSmooth(0.12, 0.3, s);
  if (s < 0.86) return 0.017 + 0.089 * Math.pow(1 - (s - 0.3) / 0.56, 1.35);
  const k = (s - 0.86) / 0.14;
  return 0.017 * (1 - k) + 0.011 * Math.sin(k * Math.PI);
}
/* the sharks' outlines, top down, every figure a share of the length: the half-width, the pectoral fins (root from, root to, tip along,
   tip out) and whether they are sickles, the pelvic fins (the same four), how far the tail reaches out, the two dorsals (where the back
   catches the light), the eyes and the gills along the body, a hammerhead's head (half its span, how far its tips sweep back, its depth),
   and the skin's tint (r, g, b) */
const OC_PLANS = {
  reef: {
    half: ocReefHalf,
    pec: [0.16, 0.41, 0.53, 0.25],
    falcate: true,
    pelvic: [0.58, 0.65, 0.69, 0.08],
    tail: 0.09,
    dorsal: [0.33, 0.46],
    dorsal2: [0.72, 0.76],
    eye: [0.09, 0.13],
    gills: [0.19, 0.28],
    head: null,
    tint: [0.95, 0.99, 1.06],
  },
  hammer: {
    half: (s) => (s < 0.06 ? 0.044 : s < 0.3 ? 0.044 + 0.062 * ocSmooth(0.06, 0.3, s) : 0.94 * ocReefHalf(s)),
    pec: [0.17, 0.39, 0.5, 0.23],
    falcate: true,
    pelvic: [0.56, 0.63, 0.67, 0.075],
    tail: 0.115,
    dorsal: [0.27, 0.44],
    dorsal2: [0.7, 0.74],
    eye: null,
    gills: [0.16, 0.26],
    head: { span: 0.18, sweep: 0.04, depth: 0.085 },
    tint: [1.05, 0.99, 0.9],
  },
};
/* the roster, biggest first: what kind, and how big against the biggest (the smaller swim deeper) */
const OC_ROSTER = [
  { plan: "hammer", size: 1 },
  { plan: "reef", size: 0.84 },
  { plan: "reef", size: 0.74 },
  { plan: "hammer", size: 0.66 },
];

function ocMount(canvas) {
  const none = { stats: () => null, release() {} };
  if (!canvas || typeof canvas.getContext !== "function" || typeof requestAnimationFrame !== "function" || typeof getComputedStyle !== "function") return none;
  const g = canvas.getContext("2d", { alpha: false });
  if (!g) return none;
  const groundC = document.createElement("canvas");
  const atlasC = document.createElement("canvas");
  const ga = atlasC.getContext("2d");
  if (!ga) return none;

  // the box in CSS px, device pixels per CSS px, a cell in device px (CW × CH) and in CSS px (cw × ch), the grid, the gap between blocks
  let W = 0;
  let H = 0;
  let dpr = 1;
  let CW = 0;
  let CH = 0;
  let cw = 1;
  let ch = 1;
  let cols = 0;
  let rows = 0;
  let gap = 1;
  // the background's colours (read from the stylesheet), the inks the glyphs are drawn in, each shark's block colours by light
  let pal = null;
  let palSig = "";
  let inks = [];
  let wakeFills = [];
  let tileOf = new Int16Array(0);
  let tiles = 0;
  const TILE_COLS = 32;
  const TILE_ROWS = 24;
  // the fields over the cells: the wake and the bursts, what of a shark each cell holds, the light on it, its glyph's place on the skin,
  // which shark, and the frame a fish took it in
  let wake = new Float32Array(0);
  let wakeTmp = new Float32Array(0);
  let heat = new Float32Array(0);
  let cFlag = new Uint8Array(0);
  let cShade = new Float32Array(0);
  let cKey = new Uint32Array(0);
  let cShark = new Uint8Array(0);
  let cFish = new Uint32Array(0);
  let order = new Int32Array(0);
  // the counts the drawing sorts by: the wake's six strengths, and each shark's 32 steps of light (a shark's slot times 32)
  const wakeCount = new Int32Array(6);
  const wakeStart = new Int32Array(6);
  const wakeAt = new Int32Array(6);
  let blockCount = new Int32Array(0);
  let blockStart = new Int32Array(0);
  let blockAt = new Int32Array(0);
  let frameNo = 0;
  // the fish, one slot each: where, how fast, how alarmed, how fast it turns, how near (0.55 far to 1 near), its kind, the way its school
  // turns, alive, and when it may come back
  let N = 0;
  let fx = new Float32Array(0);
  let fy = new Float32Array(0);
  let fvx = new Float32Array(0);
  let fvy = new Float32Array(0);
  let fal = new Float32Array(0);
  let fturn = new Float32Array(0);
  let fdep = new Float32Array(0);
  let fkind = new Uint8Array(0);
  let fspin = new Int8Array(0);
  let falive = new Uint8Array(0);
  let fback = new Float32Array(0);
  // the cells the fish took this frame, with which fish (pairs)
  let fishCells = new Int32Array(0);
  // a fish's neighbours: buckets as wide as it sees
  let seen = 60;
  let bCols = 0;
  let bRows = 0;
  let bHead = new Int32Array(0);
  let bCount = new Uint16Array(0);
  let bNext = new Int32Array(0);
  const roomX = new Float32Array(OC_FISH.length);
  const roomY = new Float32Array(OC_FISH.length);
  let other = 40;
  let sharks = [];
  const pointer = { x: 0, y: 0, on: false };
  // the calm water: the boxes of the parts marked [data-ocean-calm], read again at most four times a second
  let calm = [];
  let calmAt = -1;
  const events = [];
  let time = 0;
  let acc = 0;
  let last = 0;
  let raf = 0;
  let lastSpawn = 0;
  let released = false;
  let lite = false;
  const gaps = [];
  const costs = [];
  const stepCosts = [];
  const drawCosts = [];
  const keep = (xs, x) => {
    xs.push(x);
    if (xs.length > 120) xs.shift();
  };
  const flow = { x: 0, y: 0 };

  // the shark being laid on the cells: its drawn spine (the wave in it), the length along it to each joint, its plan, its length, its
  // pectorals' reach each side (banked into a turn)
  const sp = new Float32Array(OC_JOINTS * 2);
  const arc = new Float32Array(OC_JOINTS);
  let arcAll = 1;
  let plan = OC_PLANS.reef;
  let Lc = 1;
  let finL = 0;
  let finR = 0;
  // the farthest anything of it reaches from its spine, and the length of a segment of the spine
  let reachMax = 0;
  let segLen = 1;
  // what the last sample found: what of the shark (0 none), the light on it, how far along (s), how far out (signed px), how far off the
  // spine (at least: a sample far off it stops early), and the body's half-width there
  let hFlag = 0;
  let hShade = 0;
  let hS = 0;
  let hV = 0;
  let hDist = 0;
  let hW = 0;

  const isStill = () => (typeof still === "function" ? still() : false);
  const FONT = '"Geist Mono", "SF Mono", ui-monospace, Menlo, monospace';

  // ---- the background's colours -----------------------------------------------------------------------------------------------------

  function readPalette() {
    const cs = getComputedStyle(document.documentElement);
    const v = (name, d) => ocRgb(cs.getPropertyValue(name)) || d;
    const ground = v("--oc-ground", [0, 0, 0, 1]);
    const p = {
      ground,
      grid: v("--oc-grid", [255, 255, 255, 0.055]),
      shadow: v("--oc-shadow", [46, 46, 46, 1]),
      lit: v("--oc-lit", [206, 206, 206, 1]),
      ink: v("--oc-ink", [14, 15, 19, 1]),
      inkOn: v("--oc-ink-on", [244, 244, 240, 1]),
      sparkle: v("--oc-sparkle", [255, 255, 255, 1]),
      eye: v("--oc-eye", [154, 160, 173, 1]),
      edge: v("--oc-edge", [150, 150, 150, 1]),
      fish: v("--oc-fish", [230, 238, 255, 1]),
      wake: v("--oc-wake", [110, 230, 255, 1]),
      spark: v("--oc-spark", [255, 122, 69, 1]),
      glints: String(cs.getPropertyValue("--oc-glints") || "").trim().split(/\s+/).map(ocRgb).filter(Boolean),
    };
    if (!p.glints.length) p.glints = [[224, 137, 44, 1]];
    return p;
  }
  /* the inks a glyph may be drawn in, by number: 0 on a light block, 1 on a dark one, 2 a sparkle, 3 an eye, then the glints, the edge's
     eight steps, the fish's five, the burst's two */
  function buildInks() {
    const p = pal;
    const list = [p.ink, p.inkOn, p.sparkle, p.eye];
    const glint0 = list.length;
    for (const c of p.glints) list.push(c);
    const edge0 = list.length;
    for (let k = 0; k < 8; k++) list.push(ocMix(p.ground, p.edge, 0.3 + (0.7 * (k + 1)) / 8));
    const fish0 = list.length;
    for (let k = 0; k < 5; k++) list.push([p.fish[0], p.fish[1], p.fish[2], 0.28 + 0.16 * k]);
    const spark0 = list.length;
    list.push(p.spark, [p.spark[0], p.spark[1], p.spark[2], 0.55]);
    inks = list.map((c) => ocCss(c));
    wakeFills = [0, 1, 2, 3, 4, 5].map((b) => ocCss(p.wake, (p.wake[3] * (b + 1)) / 6));
    inks.glint0 = glint0;
    inks.glints = p.glints.length;
    inks.edge0 = edge0;
    inks.fish0 = fish0;
    inks.spark0 = spark0;
    tileOf = new Int16Array(inks.length * OC_GLYPHS.length).fill(-1);
    tiles = 0;
  }
  /* each shark's blocks, 32 steps from shadow to light, in its tint, faded toward the ground the deeper it swims; with each, the ink its
     glyph reads in */
  function shadeSharks() {
    for (const sh of sharks) {
      const t = OC_PLANS[sh.plan].tint;
      const near = 0.72 + 0.28 * sh.depth;
      sh.fills = [];
      sh.inkOf = new Uint8Array(32);
      for (let k = 0; k < 32; k++) {
        const c = ocMix(pal.shadow, pal.lit, k / 31);
        const tinted = [Math.min(255, c[0] * t[0]), Math.min(255, c[1] * t[1]), Math.min(255, c[2] * t[2]), 1];
        const fill = ocMix(pal.ground, tinted, near);
        sh.fills.push(ocCss(fill, 1));
        sh.inkOf[k] = ocLum(fill) > 0.52 ? 0 : 1;
      }
    }
  }
  function paintGround() {
    const q = groundC.getContext("2d");
    if (!q) return;
    q.setTransform(1, 0, 0, 1, 0, 0);
    q.fillStyle = ocCss(pal.ground, 1);
    q.fillRect(0, 0, groundC.width, groundC.height);
    q.strokeStyle = ocCss(pal.grid);
    q.lineWidth = 1;
    q.beginPath();
    for (let c = 0; c <= cols; c++) {
      q.moveTo(c * CW + 0.5, 0);
      q.lineTo(c * CW + 0.5, groundC.height);
    }
    for (let r = 0; r <= rows; r++) {
      q.moveTo(0, r * CH + 0.5);
      q.lineTo(groundC.width, r * CH + 0.5);
    }
    q.stroke();
  }
  /* the background changed (Light, Black, the trading area) or the faces came: everything coloured is made again */
  function recolour(force) {
    const p = readPalette();
    const sig = JSON.stringify(p);
    if (!force && sig === palSig) return false;
    pal = p;
    palSig = sig;
    buildInks();
    shadeSharks();
    if (cols) paintGround();
    return true;
  }

  // ---- the atlas: each glyph in each ink drawn once ---------------------------------------------------------------------------------

  function tile(ink, glyph) {
    const k = ink * OC_GLYPHS.length + glyph;
    let t = tileOf[k];
    if (t >= 0) return t;
    if (tiles >= TILE_COLS * TILE_ROWS) return -1;
    t = tiles++;
    tileOf[k] = t;
    const x = (t % TILE_COLS) * CW;
    const y = ((t / TILE_COLS) | 0) * CH;
    ga.clearRect(x, y, CW, CH);
    ga.fillStyle = inks[ink];
    ga.fillText(OC_GLYPHS[glyph], x + CW / 2, y + CH / 2 + Math.max(1, dpr));
    return t;
  }
  function glyph(ink, gl, col, row) {
    const t = tile(ink, gl);
    if (t < 0) return;
    g.drawImage(atlasC, (t % TILE_COLS) * CW, ((t / TILE_COLS) | 0) * CH, CW, CH, col * CW, row * CH, CW, CH);
  }
  function resetAtlas() {
    atlasC.width = TILE_COLS * CW;
    atlasC.height = TILE_ROWS * CH;
    ga.font = `600 ${Math.round(CH * 0.7)}px ${FONT}`;
    ga.textAlign = "center";
    ga.textBaseline = "middle";
    if (tileOf.length) tileOf.fill(-1);
    tiles = 0;
  }

  // ---- size --------------------------------------------------------------------------------------------------------------------------

  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!(r.width >= 1 && r.height >= 1)) return false;
    const first = W === 0;
    dpr = Math.min(Math.max(Number(globalThis.devicePixelRatio) || 1, 1), 2);
    // a cell about a 140th of the width, 8 to 12 px, half again as tall; whole device pixels, so the grid never drifts
    CW = Math.max(6, Math.round(ocClamp(Math.round(r.width / 140), 8, 12) * dpr));
    CH = Math.round(CW * 1.5);
    cw = CW / dpr;
    ch = CH / dpr;
    gap = Math.max(1, Math.round(dpr));
    cols = Math.ceil(r.width / cw);
    rows = Math.ceil(r.height / ch);
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    groundC.width = canvas.width;
    groundC.height = canvas.height;
    const n = cols * rows;
    wake = new Float32Array(n);
    wakeTmp = new Float32Array(n);
    heat = new Float32Array(n);
    cFlag = new Uint8Array(n);
    cShade = new Float32Array(n);
    cKey = new Uint32Array(n);
    cShark = new Uint8Array(n);
    cFish = new Uint32Array(n);
    order = new Int32Array(n);
    const wasW = W;
    const wasH = H;
    W = r.width;
    H = r.height;
    // room in cells, so every fish has a cell of its own
    for (let k = 0; k < OC_FISH.length; k++) {
      roomX[k] = OC_FISH[k].room[0] * cw;
      roomY[k] = OC_FISH[k].room[1] * ch;
    }
    seen = Math.max(ch * 3, cw * 5.5);
    other = cw * 3;
    if (first || !N || W * H > wasW * wasH * 1.8 || W * H < wasW * wasH * 0.55) seed();
    else {
      for (let i = 0; i < N; i++) {
        fx[i] = ocClamp(fx[i], 0, W);
        fy[i] = ocClamp(fy[i], 0, H);
      }
    }
    recolour(true);
    resetAtlas();
    return true;
  }

  // ---- the world ---------------------------------------------------------------------------------------------------------------------

  function seed() {
    const side = Math.min(W, H);
    const base = ocClamp(side * 0.5, 180, 460);
    const count = W >= 1100 ? 4 : W >= 700 ? 3 : 2;
    sharks = [];
    for (let i = 0; i < count; i++) {
      const { plan: p, size } = OC_ROSTER[i];
      const L = base * size;
      const orbit = side * ocRand(0.28, 0.4);
      const a = (i / count) * Math.PI * 2 + ocRand(-0.4, 0.4);
      const dir = i % 2 === 0 ? 1 : -1;
      const x = W / 2 + Math.cos(a) * orbit * (W / side) * 0.9;
      const y = H / 2 + Math.sin(a) * orbit;
      const heading = a + (dir * Math.PI) / 2;
      const joints = new Float32Array(OC_JOINTS * 2);
      const seg = L / (OC_JOINTS - 1);
      for (let k = 0; k < OC_JOINTS; k++) {
        joints[k * 2] = x - Math.cos(heading) * seg * k;
        joints[k * 2 + 1] = y - Math.sin(heading) * seg * k;
      }
      sharks.push({ id: i + 1, plan: p, L, joints, heading, speed: 30, phase: ocRand(0, Math.PI * 2), turn: 0, hunger: ocRand(0.25, 0.75), wander: 0, dir, orbit, target: -1, retarget: 0, depth: size, fills: [], inkOf: new Uint8Array(32) });
    }
    // the deeper (smaller) first, so the bigger swim over them
    sharks.sort((a, b) => a.L - b.L);
    sharks.forEach((sh, i) => (sh.slot = i + 1));

    N = ocClamp(Math.round((W * H) / 4600), 70, 320);
    fx = new Float32Array(N);
    fy = new Float32Array(N);
    fvx = new Float32Array(N);
    fvy = new Float32Array(N);
    fal = new Float32Array(N);
    fturn = new Float32Array(N);
    fdep = new Float32Array(N);
    fkind = new Uint8Array(N);
    fspin = new Int8Array(N);
    falive = new Uint8Array(N);
    fback = new Float32Array(N);
    fishCells = new Int32Array(N * 2);
    bNext = new Int32Array(N);
    let i = 0;
    while (i < N) {
      const kind = pickKind();
      const K = OC_FISH[kind];
      const size = Math.min(K.school[0] + Math.floor(Math.random() * (K.school[1] - K.school[0] + 1)), N - i);
      const spin = Math.random() < 0.5 ? 1 : -1;
      const cx = ocRand(W * 0.06, W * 0.94);
      const cy = ocRand(H * 0.08, H * 0.92);
      // mostly level: fish cruise sideways far more than up or down
      const dir = (Math.random() < 0.5 ? 0 : Math.PI) + ocRand(-0.5, 0.5);
      for (let k = 0; k < size; k++, i++) {
        fx[i] = cx + ocRand(-1, 1) * roomX[kind] * Math.sqrt(size);
        fy[i] = cy + ocRand(-1, 1) * roomY[kind] * Math.sqrt(size) * 0.6;
        fvx[i] = Math.cos(dir) * K.cruise;
        fvy[i] = Math.sin(dir) * K.cruise;
        fkind[i] = kind;
        fspin[i] = spin;
        fdep[i] = ocRand(0.55, 1);
        falive[i] = 1;
      }
    }
    if (pal) shadeSharks();
  }
  function pickKind() {
    let r = Math.random() * OC_ODDS;
    for (let k = 0; k < OC_FISH.length; k++) {
      r -= OC_FISH[k].odds;
      if (r <= 0) return k;
    }
    return 0;
  }
  /* a slow current over the water, the curl of a drifting field (so it moves the schools about without piling them in a corner) */
  function current(x, y, t) {
    const a = x / 280 + t * 0.06;
    const b = y / 330 - t * 0.045;
    const c = (x - y) / 210 + t * 0.09;
    flow.x = ((-Math.sin(a) * Math.sin(b)) / 330 - (0.5 * Math.cos(c)) / 210) * 3300;
    flow.y = ((-Math.cos(a) * Math.cos(b)) / 280 - (0.5 * Math.cos(c)) / 210) * 3300;
    return flow;
  }
  function bucket(x, y) {
    const c = ocClamp(Math.floor(x / seen) + 2, 0, bCols - 1);
    const r = ocClamp(Math.floor(y / seen) + 2, 0, bRows - 1);
    return r * bCols + c;
  }
  function sortFish() {
    bCols = Math.ceil(W / seen) + 4;
    bRows = Math.ceil(H / seen) + 4;
    const n = bCols * bRows;
    if (bHead.length !== n) {
      bHead = new Int32Array(n);
      bCount = new Uint16Array(n);
    }
    bHead.fill(-1);
    bCount.fill(0);
    for (let i = 0; i < N; i++) {
      if (!falive[i]) continue;
      const b = bucket(fx[i], fy[i]);
      bNext[i] = bHead[b];
      bHead[b] = i;
      bCount[b]++;
    }
  }

  function stepFish(dt) {
    const R2 = seen * seen;
    const calm = Math.exp(-dt * 0.7);
    const pass = Math.min(1, dt * 6);
    for (let i = 0; i < N; i++) {
      if (!falive[i]) continue;
      const kind = fkind[i];
      const K = OC_FISH[kind];
      // an alarmed fish wants more room: the school flashes apart round a shark and closes again once it is gone
      const spread = 1 + 1.8 * fal[i];
      const rx = roomX[kind] * spread;
      const ry = roomY[kind] * spread;
      const x = fx[i];
      const y = fy[i];
      const speed = Math.hypot(fvx[i], fvy[i]) || 1;
      const hx = fvx[i] / speed;
      const hy = fvy[i] / speed;
      let ax = 0;
      let ay = 0;
      let sx = 0;
      let sy = 0;
      let vx = 0;
      let vy = 0;
      let mx = 0;
      let my = 0;
      let n = 0;
      let near = 0;
      const bc = ocClamp(Math.floor(x / seen) + 2, 0, bCols - 1);
      const br = ocClamp(Math.floor(y / seen) + 2, 0, bRows - 1);
      for (let r = Math.max(0, br - 1); r <= Math.min(bRows - 1, br + 1); r++) {
        for (let c = Math.max(0, bc - 1); c <= Math.min(bCols - 1, bc + 1); c++) {
          for (let j = bHead[r * bCols + c]; j !== -1; j = bNext[j]) {
            if (j === i) continue;
            const dx = fx[j] - x;
            const dy = fy[j] - y;
            const d2 = dx * dx + dy * dy;
            if (d2 >= R2 || d2 < 1e-6) continue;
            const d = Math.sqrt(d2);
            // straight behind it, a fish sees nothing
            if ((dx * hx + dy * hy) / d < -0.6) continue;
            const qx = dx / rx;
            const qy = dy / ry;
            const q2 = qx * qx + qy * qy;
            if (q2 < 1) {
              const q = Math.sqrt(q2) || 1e-3;
              const k = (1 - q) / q;
              sx -= qx * k;
              sy -= qy * k;
            }
            if (fkind[j] === kind) {
              vx += fvx[j];
              vy += fvy[j];
              mx += dx;
              my += dy;
              n++;
            } else if (d < other) {
              // another kind keeps to its own school
              const k = ((1 - d / other) / d) * 0.6;
              sx -= dx * k;
              sy -= dy * k;
            }
            if (fal[j] > near) near = fal[j];
          }
        }
      }
      ax += sx * 420;
      ay += sy * 420;
      if (n > 0) {
        const al = 1.4 * K.align;
        const co = K.close * (1 - 0.8 * fal[i]);
        ax += (vx / n - fvx[i]) * al + (mx / n) * co;
        ay += (vy / n - fvy[i]) * al + (my / n) * co;
        if (K.circle > 0) {
          const l = Math.hypot(mx, my) || 1;
          const pull = fspin[i] * K.circle * (1 - fal[i]);
          ax += (-my / l) * pull;
          ay += (mx / l) * pull;
        }
      }
      // the sharks: the nearest of the front joints, so a fish gives the flanks room too; it breaks to whichever side of the shark's path
      // it is on
      let fear = 0;
      for (const sh of sharks) {
        const range = sh.L * 0.6 + 60;
        let best = Infinity;
        let bx = 0;
        let by = 0;
        for (let k = 0; k <= 12; k += 3) {
          const jx = sh.joints[k * 2];
          const jy = sh.joints[k * 2 + 1];
          const d2 = (x - jx) * (x - jx) + (y - jy) * (y - jy);
          if (d2 < best) {
            best = d2;
            bx = jx;
            by = jy;
          }
        }
        const d = Math.sqrt(best);
        if (d >= range || d < 1e-3) continue;
        const w = (1 - d / range) * (1 - d / range);
        const cx = Math.cos(sh.heading);
        const cy = Math.sin(sh.heading);
        const side = cx * (y - sh.joints[1]) - cy * (x - sh.joints[0]) >= 0 ? 1 : -1;
        ax += (((x - bx) / d) * 0.7 - cy * side * 0.9) * 1100 * w;
        ay += (((y - by) / d) * 0.7 + cx * side * 0.9) * 1100 * w;
        fear = Math.max(fear, Math.sqrt(w));
      }
      if (pointer.on) {
        const dx = x - pointer.x;
        const dy = y - pointer.y;
        const d = Math.hypot(dx, dy);
        if (d < 130 && d > 1e-3) {
          const w = (1 - d / 130) * (1 - d / 130);
          ax += (dx / d) * 1100 * w;
          ay += (dy / d) * 1100 * w;
          fear = Math.max(fear, Math.sqrt(w) * 0.8);
        }
      }
      // the alarm: set by a threat, passed on by a neighbour (a little weaker each time), fading by itself
      let alarm = Math.max(fal[i] * calm, fear);
      const relayed = near * 0.86;
      if (relayed > alarm) alarm += (relayed - alarm) * pass;
      fal[i] = alarm;
      // soft walls
      const m = 36;
      if (x < m) ax += (m - x) * 7;
      else if (x > W - m) ax -= (x - (W - m)) * 7;
      if (y < m) ay += (m - y) * 7;
      else if (y > H - m) ay -= (y - (H - m)) * 7;
      const cur = current(x, y, time);
      ax += cur.x * 0.5 + (Math.random() - 0.5) * K.jitter;
      ay += cur.y * 0.5 + (Math.random() - 0.5) * K.jitter;
      // level, unless it is bolting
      ay -= fvy[i] * K.level * (1 - 0.7 * alarm);
      // toward the speed it likes, which rises with fear
      const want = K.cruise * (1 + 1.3 * alarm);
      ax += (want - speed) * hx * 1.6;
      ay += (want - speed) * hy * 1.6;
      const before = Math.atan2(fvy[i], fvx[i]);
      fvx[i] += ax * dt;
      fvy[i] += ay * dt;
      const top = K.max * (1 + 1.8 * alarm);
      const s = Math.hypot(fvx[i], fvy[i]);
      if (s > top) {
        fvx[i] *= top / s;
        fvy[i] *= top / s;
      } else if (s < K.min && s > 1e-3) {
        fvx[i] *= K.min / s;
        fvy[i] *= K.min / s;
      }
      fturn[i] += (ocTurn(before, Math.atan2(fvy[i], fvx[i])) / dt - fturn[i]) * Math.min(1, dt * 8);
      fx[i] = ocClamp(x + fvx[i] * dt, -60, W + 60);
      fy[i] = ocClamp(y + fvy[i] * dt, -60, H + 60);
    }
  }

  /* prey in the shark's forward cone, the near ones in sparse water first (a dense school confuses a hunter, so the stragglers go); the
     one it is after is kept unless another is clearly better */
  function prey(sh) {
    const range = sh.L * 0.9 + 160;
    const hx = sh.joints[0];
    const hy = sh.joints[1];
    const fwx = Math.cos(sh.heading);
    const fwy = Math.sin(sh.heading);
    let best = -1;
    let bestScore = Infinity;
    let keptScore = Infinity;
    for (let i = 0; i < N; i++) {
      if (!falive[i]) continue;
      const dx = fx[i] - hx;
      const dy = fy[i] - hy;
      const d = Math.hypot(dx, dy);
      if (d > range || d < 1e-3) continue;
      const cos = (dx * fwx + dy * fwy) / d;
      if (cos < 0.2) continue;
      const score = d * (1 + (1 - cos) * 0.8) * (1 + bCount[bucket(fx[i], fy[i])] * 0.07);
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
      if (i === sh.target) keptScore = score;
    }
    return sh.target >= 0 && keptScore < bestScore * 1.3 ? sh.target : best;
  }

  function stepSharks(dt) {
    const side = Math.min(W, H);
    const cxW = W / 2;
    const cyW = H / 2;
    for (const sh of sharks) {
      const L = sh.L;
      const J = sh.joints;
      const hx = J[0];
      const hy = J[1];
      sh.hunger = Math.min(1, sh.hunger + dt * 0.03);
      let dx = Math.cos(sh.heading);
      let dy = Math.sin(sh.heading);
      // a wander that drifts slowly from side to side
      sh.wander = ocClamp(sh.wander + (Math.random() - 0.5) * dt * 3.2, -1.1, 1.1);
      dx += Math.cos(sh.heading + sh.wander) * 0.45;
      dy += Math.sin(sh.heading + sh.wander) * 0.45;
      if (time >= sh.retarget) {
        sh.target = prey(sh);
        sh.retarget = time + 0.45;
      }
      const t = sh.target;
      let hunting = false;
      let closing = 0;
      if (t >= 0 && falive[t] && sh.hunger > 0.3) {
        // aim where the fish is about to be
        const tx = fx[t] + fvx[t] * 0.35 - hx;
        const ty = fy[t] + fvy[t] * 0.35 - hy;
        const d = Math.hypot(tx, ty) || 1;
        const w = 1.4 + 2.6 * sh.hunger;
        dx += (tx / d) * w;
        dy += (ty / d) * w;
        hunting = true;
        closing = ocClamp(1 - d / (L * 0.9), 0, 1);
      } else {
        // a lazy circuit round the middle of the page
        const rx = (hx - cxW) / (W / side);
        const ry = hy - cyW;
        const r = Math.hypot(rx, ry) || 1;
        const radius = sh.orbit * (1 + 0.15 * Math.sin(time * 0.05 + sh.id));
        const radial = ocClamp((radius - r) / radius, -1, 1);
        dx += ((-ry / r) * sh.dir + (rx / r) * radial * 0.9) * 0.55;
        dy += ((rx / r) * sh.dir + (ry / r) * radial * 0.9) * 0.55;
      }
      for (const o of sharks) {
        if (o === sh) continue;
        for (let k = 0; k < OC_JOINTS; k += 4) {
          const ox = hx - o.joints[k * 2];
          const oy = hy - o.joints[k * 2 + 1];
          const d = Math.hypot(ox, oy);
          const room = (L + o.L) * 0.45;
          if (d < room && d > 1e-3) {
            const w = (1 - d / room) * 3;
            dx += (ox / d) * w;
            dy += (oy / d) * w;
          }
        }
      }
      // the calm water (a headline): a soft oval round it that pushes the head out, harder while the shark only patrols
      for (const z of calm) {
        const ex = (hx - z.x) / (z.rx + L * 0.25);
        const ey = (hy - z.y) / (z.ry + L * 0.15);
        const e2 = ex * ex + ey * ey;
        if (e2 < 1) {
          const e = Math.sqrt(e2) || 1e-3;
          const w = (1 - e) * (hunting ? 1.2 : 2.6);
          dx += (ex / e) * w;
          dy += (ey / e) * w;
        }
      }
      // the snout out of the window: turn back, so a body dips off the edge now and then but never wanders away
      const out = Math.max(-hx, hx - W, -hy, hy - H);
      if (out > -L * 0.05) {
        const w = ocClamp((out + L * 0.05) / (L * 0.35), 0, 1) * 3.5;
        const toX = cxW - hx;
        const toY = cyW - hy;
        const d = Math.hypot(toX, toY) || 1;
        dx += (toX / d) * w;
        dy += (toY / d) * w;
      }
      // no pivoting on the spot: the turning circle grows with the speed
      const agility = Math.min(hunting ? 1.7 + closing : 0.8, sh.speed / (L * 0.22));
      const turned = ocClamp(ocTurn(sh.heading, Math.atan2(dy, dx)), -agility * dt, agility * dt);
      sh.heading += turned;
      sh.turn += (turned / dt - sh.turn) * Math.min(1, dt * 3);
      const cruise = 30 + L * 0.04;
      sh.speed += ((hunting ? cruise * (1.45 + closing * 1.5) : cruise) - sh.speed) * Math.min(1, dt * 1.1);
      sh.phase += dt * (2 + sh.speed / 24);
      J[0] += Math.cos(sh.heading) * sh.speed * dt;
      J[1] += Math.sin(sh.heading) * sh.speed * dt;
      // follow the leader, each joint bending at most so far: a C at most, never folded back
      const seg = L / (OC_JOINTS - 1);
      let prev = sh.heading + Math.PI;
      for (let k = 1; k < OC_JOINTS; k++) {
        const px = J[(k - 1) * 2];
        const py = J[(k - 1) * 2 + 1];
        let a = Math.atan2(J[k * 2 + 1] - py, J[k * 2] - px);
        a = prev + ocClamp(ocTurn(prev, a), -0.16, 0.16);
        J[k * 2] = px + Math.cos(a) * seg;
        J[k * 2 + 1] = py + Math.sin(a) * seg;
        prev = a;
      }
      if (sh.hunger > 0.15) {
        const mouth = L * 0.05 + 8;
        const m2 = mouth * mouth;
        for (let i = 0; i < N; i++) {
          if (!falive[i]) continue;
          if ((fx[i] - J[0]) * (fx[i] - J[0]) + (fy[i] - J[1]) * (fy[i] - J[1]) < m2) {
            falive[i] = 0;
            fback[i] = time + ocRand(3, 8);
            sh.hunger = Math.max(0, sh.hunger - 0.16);
            events.push({ eat: true, x: fx[i], y: fy[i] });
          }
        }
      }
    }
  }

  /* the eaten come back as a new school swimming in from an edge, so the water never empties */
  function respawn() {
    let due = 0;
    for (let i = 0; i < N; i++) if (!falive[i] && fback[i] <= time) due++;
    if (!due || (due < 6 && time - lastSpawn < 9)) return;
    lastSpawn = time;
    const edge = Math.floor(Math.random() * 4);
    const along = ocRand(0.15, 0.85);
    const x = edge === 0 ? -20 : edge === 1 ? W + 20 : along * W;
    const y = edge === 2 ? -20 : edge === 3 ? H + 20 : along * H;
    const inward = Math.atan2(H / 2 - y, W / 2 - x) + ocRand(-0.5, 0.5);
    const kind = pickKind();
    const K = OC_FISH[kind];
    const spin = Math.random() < 0.5 ? 1 : -1;
    let left = K.school[1];
    for (let i = 0; i < N && left > 0; i++) {
      if (falive[i] || fback[i] > time) continue;
      left--;
      falive[i] = 1;
      fkind[i] = kind;
      fal[i] = 0;
      fturn[i] = 0;
      fspin[i] = spin;
      fx[i] = x + ocRand(-1, 1) * seen;
      fy[i] = y + ocRand(-1, 1) * seen;
      fvx[i] = Math.cos(inward) * K.cruise * 1.4;
      fvy[i] = Math.sin(inward) * K.cruise * 1.4;
    }
  }

  /* the calm water as the page lays it out now: read from the boxes of the marked parts (none that is not shown) */
  function readCalm() {
    calm = [];
    if (typeof document.querySelectorAll !== "function") return;
    for (const el of document.querySelectorAll("[data-ocean-calm]")) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > H) continue;
      calm.push({ x: r.left + r.width / 2, y: r.top + r.height / 2, rx: r.width / 2, ry: r.height / 2 });
    }
  }
  function step(dt) {
    time += dt;
    sortFish();
    stepFish(dt);
    stepSharks(dt);
    respawn();
  }

  // ---- the sharks on the cells ---------------------------------------------------------------------------------------------------------

  /* where a point falls on the shark being laid (its spine in sp): the nearest point of the spine says how far along (s) and how far out
     (signed by the side); the outline says the rest. The nearest joint is found first, and only the two segments beside it are measured
     (the spine bends gently, so the nearest point is on one of them); a point farther from every joint than anything of the shark reaches
     is off it at once. Its answer is in h* (nothing made per sample) */
  function sample(px, py) {
    let near = 0;
    let nearD = Infinity;
    for (let k = 0; k < OC_JOINTS; k++) {
      const dx = sp[k * 2] - px;
      const dy = sp[k * 2 + 1] - py;
      const d2 = dx * dx + dy * dy;
      if (d2 < nearD) {
        nearD = d2;
        near = k;
      }
    }
    // every point of the spine is within half a segment of a joint
    const floor = Math.sqrt(nearD) - segLen / 2;
    if (floor > reachMax) {
      hDist = floor;
      hFlag = 0;
      return false;
    }
    let best = Infinity;
    let bestS = 0;
    let sign = 1;
    let nx = 0;
    let ny = 0;
    for (let k = Math.max(0, near - 1); k <= Math.min(OC_JOINTS - 2, near); k++) {
      const ax = sp[k * 2];
      const ay = sp[k * 2 + 1];
      const dx = sp[k * 2 + 2] - ax;
      const dy = sp[k * 2 + 3] - ay;
      const l2 = dx * dx + dy * dy || 1;
      let u = ((px - ax) * dx + (py - ay) * dy) / l2;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      const qx = ax + dx * u - px;
      const qy = ay + dy * u - py;
      const d2 = qx * qx + qy * qy;
      if (d2 < best) {
        best = d2;
        const l = Math.sqrt(l2);
        bestS = (arc[k] + u * l) / arcAll;
        sign = dx * (py - ay) - dy * (px - ax) >= 0 ? 1 : -1;
        nx = (-dy / l) * sign;
        ny = (dx / l) * sign;
      }
    }
    const a = Math.sqrt(best);
    const s = bestS;
    const u = s * Lc;
    hDist = a;
    hS = s;
    hV = a * sign;
    const P = plan;
    if (P.head && u < Lc * (P.head.sweep + P.head.depth)) {
      // a hammerhead's head: a wing across the snout, its tips swept back, the eyes at its ends
      const r = a / (Lc * P.head.span);
      const front = Lc * P.head.sweep * r * r;
      if (r <= 1 && u >= front && u <= front + Lc * P.head.depth * (1 - 0.25 * r * r * r * r)) {
        const eye = r > 0.86;
        hFlag = eye ? OC_EYE : OC_BODY;
        hShade = eye ? 0 : 0.64 - 0.22 * r + (u < front + Lc * 0.012 ? 0.1 : 0);
        return true;
      }
    }
    const w = P.half(s) * Lc;
    hW = w;
    if (a <= w) {
      const across = a / (w || 1);
      // a rounded back lit from the upper left, the flanks falling away into shadow
      const facing = (nx * -0.6 + ny * -0.8) * across;
      let shade = 0.6 - across * across * 0.44 + facing * 0.26;
      let flag = OC_BODY;
      if (s > P.dorsal[0] && s < P.dorsal[1] && across < 0.3) {
        flag = OC_RIDGE_F;
        shade = 1;
      } else if (s > P.dorsal2[0] && s < P.dorsal2[1] && across < 0.4) {
        shade = Math.max(shade, 0.84);
      } else if (P.eye && s > P.eye[0] && s < P.eye[1] && across > 0.62) {
        flag = OC_EYE;
        shade = 0;
      } else if (s > P.gills[0] && s < P.gills[1] && across > 0.6) {
        // five gill slits
        if (((((s - P.gills[0]) / (P.gills[1] - P.gills[0])) * 5) | 0) % 2 === 0) shade *= 0.45;
      } else if (s < 0.05) {
        shade = Math.max(shade, 0.72);
      }
      hFlag = flag;
      hShade = shade;
      return true;
    }
    const tip = sign > 0 ? finR : finL;
    const pf = P.pec;
    if (ocFin(u, a, Lc * pf[0], Lc * pf[1], Lc * pf[2], tip, P.falcate)) {
      hFlag = OC_FINS;
      hShade = 0.38 + 0.24 * (1 - Math.min(1, a / tip));
      return true;
    }
    const pv = P.pelvic;
    if (ocFin(u, a, Lc * pv[0], Lc * pv[1], Lc * pv[2], Lc * pv[3], false) || ocFin(u, a, Lc * 0.86, Lc * 0.95, Lc, Lc * P.tail, false)) {
      hFlag = OC_FINS;
      hShade = 0.36;
      return true;
    }
    hFlag = 0;
    return false;
  }

  /* how far anything of the shark being laid reaches from its spine at s: the body, and the fins and the head only where they are */
  function reachAt(s) {
    const P = plan;
    let r = P.half(s) * Lc;
    if (s >= P.pec[0] && s <= P.pec[2] + 0.02) r = Math.max(r, finL, finR);
    if (s >= P.pelvic[0] && s <= P.pelvic[2] + 0.02) r = Math.max(r, Lc * P.pelvic[3]);
    if (s >= 0.85) r = Math.max(r, Lc * P.tail);
    if (P.head && s <= P.head.sweep + P.head.depth + 0.02) r = Math.max(r, Lc * P.head.span);
    return r;
  }
  /* each shark's spine drawn with the wave in it, then every cell near it sampled against the outline: a cell well covered takes the
     shark's block, one only partly covered an edge glyph */
  function layShark(sh, slot, t) {
    const L = sh.L;
    const J = sh.joints;
    const swim = ocClamp(sh.speed / 60, 0.4, 1.4);
    plan = OC_PLANS[sh.plan];
    Lc = L;
    for (let k = 0; k < OC_JOINTS; k++) {
      const s = k / (OC_JOINTS - 1);
      const a = Math.max(0, k - 1);
      const b = Math.min(OC_JOINTS - 1, k + 1);
      let tx = J[a * 2] - J[b * 2];
      let ty = J[a * 2 + 1] - J[b * 2 + 1];
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      // the wave grows toward the tail
      const off = L * 0.048 * (0.12 + 0.88 * Math.pow(s, 1.7)) * swim * Math.sin(sh.phase - s * 5);
      sp[k * 2] = J[k * 2] - ty * off;
      sp[k * 2 + 1] = J[k * 2 + 1] + tx * off;
    }
    arc[0] = 0;
    for (let k = 1; k < OC_JOINTS; k++) arc[k] = arc[k - 1] + Math.hypot(sp[k * 2] - sp[k * 2 - 2], sp[k * 2 + 1] - sp[k * 2 - 1]);
    arcAll = arc[OC_JOINTS - 1] || 1;
    // banked into a turn: the inside fin shortens, the outside one spreads
    const bank = ocClamp(sh.turn * 0.45, -0.35, 0.35);
    const flex = 1 + 0.06 * Math.sin(sh.phase * 0.5);
    finR = L * plan.pec[3] * flex * (1 - bank);
    finL = L * plan.pec[3] * flex * (1 + bank);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let k = 0; k < OC_JOINTS; k++) {
      x0 = Math.min(x0, sp[k * 2]);
      x1 = Math.max(x1, sp[k * 2]);
      y0 = Math.min(y0, sp[k * 2 + 1]);
      y1 = Math.max(y1, sp[k * 2 + 1]);
    }
    reachMax = Math.max(finL, finR, L * plan.pelvic[3], L * plan.tail, plan.head ? L * plan.head.span : 0, L * 0.11);
    segLen = arcAll / (OC_JOINTS - 1);
    const half = Math.hypot(cw, ch) / 2;
    const out = reachMax + half;
    const c0 = Math.max(0, Math.floor((x0 - out) / cw));
    const c1 = Math.min(cols - 1, Math.floor((x1 + out) / cw));
    const r0 = Math.max(0, Math.floor((y0 - out) / ch));
    const r1 = Math.min(rows - 1, Math.floor((y1 + out) / ch));
    if (c0 > c1 || r0 > r1) return;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const x = c * cw;
        const y = r * ch;
        const centre = sample(x + cw / 2, y + ch / 2);
        // well clear of everything it reaches (anywhere, or at that point along it): nothing to sample
        if (!centre && (hDist > reachMax + half || hDist > reachAt(hS) + half)) continue;
        const flag = hFlag;
        const shade = hShade;
        const s = hS;
        const v = hV;
        let hits = centre ? 1 : 0;
        // deep in the body the cell is covered whole; near the outline (or a fin, or the head) its corners say how much
        if (centre && (flag === OC_BODY || flag === OC_RIDGE_F) && hW - Math.abs(v) > half && !(plan.head && s < plan.head.sweep + plan.head.depth)) hits = 5;
        else for (let k = 0; k < OC_SUB.length; k += 2) if (sample(x + OC_SUB[k] * cw, y + OC_SUB[k + 1] * ch)) hits++;
        if (!hits) continue;
        const i = r * cols + c;
        // tied to a place on the skin, so the glyph rides along with the body
        cKey[i] = (ocHash(Math.round(s * 56), Math.round(v / (cw * 0.9)), sh.id) * 4294967295) >>> 0;
        cShark[i] = slot;
        if (centre && hits >= 3) {
          cFlag[i] = flag;
          cShade[i] = ocClamp(shade + (ocHash(c, r, Math.floor(t * 6)) - 0.5) * 0.06, 0, 1);
        } else {
          cFlag[i] = OC_EDGE;
          cShade[i] = hits / 5;
        }
      }
    }
  }

  // ---- a frame -------------------------------------------------------------------------------------------------------------------------

  function stamp(field, x, y, radius, amount) {
    const c0 = Math.floor(x / cw);
    const r0 = Math.floor(y / ch);
    for (let r = r0 - radius; r <= r0 + radius; r++) {
      for (let c = c0 - radius; c <= c0 + radius; c++) {
        if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
        const d = Math.hypot(c - c0, (r - r0) * 1.4);
        if (d > radius + 0.5) continue;
        const i = r * cols + c;
        field[i] = Math.min(1.6, field[i] + amount * (1 - d / (radius + 1)));
      }
    }
  }
  const cellOf = (x, y) => {
    const c = Math.floor(x / cw);
    const r = Math.floor(y / ch);
    return c < 0 || r < 0 || c >= cols || r >= rows ? -1 : r * cols + c;
  };
  /* the wake: what moved since the last frame stirs it, then it spreads to the four neighbours and fades */
  function stir(dt) {
    for (const e of events) {
      if (e.eat) {
        stamp(heat, e.x, e.y, 2, 1);
        stamp(wake, e.x, e.y, 3, 0.9);
      } else stamp(wake, e.x, e.y, 6, 1.4);
    }
    events.length = 0;
    for (let i = 0; i < N; i++) {
      if (!falive[i]) continue;
      const k = cellOf(fx[i], fy[i]);
      if (k >= 0) wake[k] = Math.min(1.6, wake[k] + 0.012 + fal[i] * 0.03);
    }
    for (const sh of sharks) {
      // the tail moves the most water
      for (let k = OC_JOINTS - 6; k < OC_JOINTS; k++) {
        const i = cellOf(sh.joints[k * 2], sh.joints[k * 2 + 1]);
        if (i >= 0) wake[i] = Math.min(1.6, wake[i] + 0.05 + sh.speed * 0.0012);
      }
    }
    if (pointer.on) stamp(wake, pointer.x, pointer.y, 1, 0.08);
    const fade = Math.exp(-dt * 1.5);
    for (let r = 0; r < rows; r++) {
      const row = r * cols;
      for (let c = 0; c < cols; c++) {
        const i = row + c;
        const e = wake[i];
        const l = c > 0 ? wake[i - 1] : e;
        const rt = c < cols - 1 ? wake[i + 1] : e;
        const u = r > 0 ? wake[i - cols] : e;
        const d = r < rows - 1 ? wake[i + cols] : e;
        wakeTmp[i] = (e * 4 + l + rt + u + d) * 0.125 * fade;
      }
    }
    const was = wake;
    wake = wakeTmp;
    wakeTmp = was;
    const cool = Math.exp(-dt * 2.2);
    for (let i = 0; i < heat.length; i++) heat[i] *= cool;
  }

  function draw(dt) {
    if (!cols || !pal) return;
    const t = time;
    const n = cols * rows;
    frameNo++;
    stir(dt);
    cFlag.fill(0);
    for (const sh of sharks) layShark(sh, sh.slot, t);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.drawImage(groundC, 0, 0);

    // the fish take their cells (the nearer first, where two meet in one); none where a shark is
    let taken = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < N; i++) {
        if (!falive[i] || (fdep[i] > 0.78 ? 0 : 1) !== pass) continue;
        const k = cellOf(fx[i], fy[i]);
        if (k < 0 || cFish[k] === frameNo || cFlag[k]) continue;
        cFish[k] = frameNo;
        fishCells[taken++] = k;
        fishCells[taken++] = i;
      }
    }

    // the wake's dots, one colour a strength (counted into order, then drawn a strength at a time)
    const counts = wakeCount.fill(0);
    for (let i = 0; i < n; i++) {
      const e = wake[i];
      if (e > 0.45 && !cFlag[i] && cFish[i] !== frameNo) counts[Math.min(5, ((e - 0.45) * 5) | 0)]++;
    }
    const starts = wakeStart;
    starts[0] = 0;
    for (let b = 1; b < 6; b++) starts[b] = starts[b - 1] + counts[b - 1];
    const at = wakeAt;
    at.set(starts);
    for (let i = 0; i < n; i++) {
      const e = wake[i];
      if (e > 0.45 && !cFlag[i] && cFish[i] !== frameNo) order[at[Math.min(5, ((e - 0.45) * 5) | 0)]++] = i;
    }
    const dot = Math.max(2, Math.round(CW * 0.2));
    for (let b = 0; b < 6; b++) {
      if (!counts[b]) continue;
      g.fillStyle = wakeFills[b];
      for (let k = starts[b]; k < starts[b] + counts[b]; k++) {
        const i = order[k];
        g.fillRect(Math.round((i % cols) * CW + CW * 0.64 - dot / 2), Math.round(((i / cols) | 0) * CH + CH * 0.64 - dot / 2), dot, dot);
      }
    }

    // the bursts
    for (let i = 0; i < n; i++) {
      const h = heat[i];
      if (h < 0.08 || cFlag[i]) continue;
      glyph(inks.spark0 + (h > 0.5 ? 0 : 1), h > 0.6 ? OC_I.star : OC_I.dot, i % cols, (i / cols) | 0);
    }

    // the fish: a dash each (drawn as the bar a dash is, five strengths, one colour at a time), brighter the nearer, a glint while it turns
    // hard or bolts
    const dashW = Math.round(CW * 0.5);
    const dashH = Math.max(2, Math.round(CH * 0.07));
    for (let b = 0; b < 5; b++) {
      g.fillStyle = inks[inks.fish0 + b];
      for (let k = 0; k < taken; k += 2) {
        const i = fishCells[k + 1];
        const glint = ocClamp(Math.abs(fturn[i]) / 3.5, 0, 1);
        if (ocClamp(Math.floor((0.3 + (0.4 * (fdep[i] - 0.55)) / 0.45 + 0.3 * Math.max(glint, fal[i])) * 5), 0, 4) !== b) continue;
        const cell = fishCells[k];
        g.fillRect((cell % cols) * CW + ((CW - dashW) >> 1), ((cell / cols) | 0) * CH + Math.round(CH * 0.56), dashW, dashH);
      }
    }

    // the sharks: their blocks, one colour at a time (counted by shark and light into order), then their glyphs
    const levels = (sharks.length + 1) * 32;
    if (blockCount.length !== levels + 1) {
      blockCount = new Int32Array(levels + 1);
      blockStart = new Int32Array(levels + 1);
      blockAt = new Int32Array(levels + 1);
    }
    const bc = blockCount.fill(0);
    for (let i = 0; i < n; i++) {
      const f = cFlag[i];
      if (f === OC_BODY || f === OC_FINS || f === OC_RIDGE_F) bc[cShark[i] * 32 + ((cShade[i] * 31) | 0)]++;
    }
    const bs = blockStart;
    for (let b = 1; b <= levels; b++) bs[b] = bs[b - 1] + bc[b - 1];
    const bat = blockAt;
    bat.set(bs);
    for (let i = 0; i < n; i++) {
      const f = cFlag[i];
      if (f === OC_BODY || f === OC_FINS || f === OC_RIDGE_F) order[bat[cShark[i] * 32 + ((cShade[i] * 31) | 0)]++] = i;
    }
    for (let b = 0; b < levels; b++) {
      if (!bc[b]) continue;
      const sh = sharks[((b / 32) | 0) - 1];
      if (!sh) continue;
      g.fillStyle = sh.fills[b % 32];
      for (let k = bs[b]; k < bs[b] + bc[b]; k++) {
        const i = order[k];
        g.fillRect((i % cols) * CW + gap, ((i / cols) | 0) * CH + gap, CW - gap, CH - gap);
      }
    }
    for (let i = 0; i < n; i++) {
      const f = cFlag[i];
      if (!f) continue;
      const col = i % cols;
      const row = (i / cols) | 0;
      const key = cKey[i];
      const sh = sharks[cShark[i] - 1];
      // the hide shimmers: each glyph's colour is drawn again on a clock of its own
      const roll = ocHash(key, Math.floor(t * 2.2 + (key % 991) / 89), 7);
      if (f === OC_EDGE) {
        const set = cShade[i] >= 0.5 ? OC_I.hi : OC_I.lo;
        const ink = roll < 0.06 ? inks.glint0 + (key % inks.glints) : inks.edge0 + ocClamp(Math.round(cShade[i] * 7 * (0.7 + 0.3 * (sh ? sh.depth : 1))), 0, 7);
        glyph(ink, set[(key >>> 8) % set.length], col, row);
        continue;
      }
      if (f === OC_EYE) {
        glyph(3, OC_I.eye, col, row);
        continue;
      }
      const shade = cShade[i];
      let gl;
      if (f === OC_RIDGE_F) gl = OC_I.ridge[(key >>> 8) % OC_I.ridge.length];
      else if (f === OC_FINS) gl = OC_I.fin[(key >>> 8) % OC_I.fin.length];
      else gl = OC_I.ramp[ocClamp(Math.floor((1 - shade) * (OC_I.ramp.length - 0.01)) + (((key >>> 4) % 3) - 1), 0, OC_I.ramp.length - 1)];
      const ink = roll < 0.08 ? inks.glint0 + (key % inks.glints) : roll < 0.11 ? 2 : sh ? sh.inkOf[(shade * 31) | 0] : 0;
      glyph(ink, gl, col, row);
    }
  }

  // ---- the loop ----------------------------------------------------------------------------------------------------------------------

  function frame(now) {
    raf = 0;
    if (released) return;
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    if (last) keep(gaps, now - last);
    last = now;
    const t0 = performance.now();
    // the calm water's boxes, four times a second at most (a read of a box may have to lay the page out)
    if (now - calmAt > 250) {
      calmAt = now;
      readCalm();
    }
    acc += dt;
    let steps = 0;
    while (acc >= OC_STEP && steps < 4) {
      const s0 = performance.now();
      step(OC_STEP);
      keep(stepCosts, performance.now() - s0);
      acc -= OC_STEP;
      steps++;
    }
    if (steps === 4) acc = 0;
    // past its budget, every second frame is drawn (the world still moves every frame)
    if (lite && frameNo & 1) frameNo++;
    else {
      const d0 = performance.now();
      draw(lite ? dt * 2 : dt);
      keep(drawCosts, performance.now() - d0);
    }
    keep(costs, performance.now() - t0);
    // what a frame at the display's own rate costs — a step and a drawing — decides it (a slowed page catching up takes several steps)
    if (drawCosts.length >= 60 && frameNo % 120 === 0) lite = p95(stepCosts) + p95(drawCosts) > 10;
    schedule();
  }
  function schedule() {
    if (raf || released || isStill() || (typeof document !== "undefined" && document.hidden)) return;
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
  }
  /* reduced motion: the water given a few seconds to settle, then one frame */
  function stillFrame() {
    if (!cols) return;
    if (time < 4) for (let i = 0; i < 240; i++) step(OC_STEP);
    draw(OC_STEP);
  }
  const p95 = (xs) => {
    const s = xs.slice().sort((a, b) => a - b);
    return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] : 0;
  };

  // ---- what it listens to ------------------------------------------------------------------------------------------------------------

  const off = [];
  const on = (target, type, fn, opts) => {
    if (!target || typeof target.addEventListener !== "function") return;
    target.addEventListener(type, fn, opts);
    off.push(() => target.removeEventListener(type, fn, opts));
  };
  const redraw = () => {
    if (isStill()) stillFrame();
    else draw(0);
  };
  on(globalThis, "pointermove", (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.on = e.pointerType !== "touch";
  }, { passive: true });
  on(document.documentElement, "pointerleave", () => (pointer.on = false));
  on(globalThis, "blur", () => (pointer.on = false));
  // a click on open water (the page's own ground, never a card or a control): everything near it bolts straight out
  on(globalThis, "pointerdown", (e) => {
    const el = e.target;
    if (isStill() || !el || typeof el.matches !== "function" || !el.matches("html, body, .app, .main, .panes, .pane, .pane > div, .cols, .col-main, .col-side, .cards-grid")) return;
    events.push({ eat: false, x: e.clientX, y: e.clientY });
    for (let i = 0; i < N; i++) {
      if (!falive[i]) continue;
      const dx = fx[i] - e.clientX;
      const dy = fy[i] - e.clientY;
      const d = Math.hypot(dx, dy);
      if (d > 240 || d < 1e-3) continue;
      const k = (1 - d / 240) * 260;
      fvx[i] += (dx / d) * k;
      fvy[i] += (dy / d) * k;
      fal[i] = 1;
    }
  }, { passive: true });
  on(document, "visibilitychange", () => (document.hidden ? stop() : schedule()));
  if (typeof STILL !== "undefined" && STILL && typeof STILL.addEventListener === "function") {
    on(STILL, "change", () => {
      if (isStill()) {
        stop();
        stillFrame();
      } else schedule();
    });
  }
  let ro = null;
  if (typeof ResizeObserver === "function") {
    ro = new ResizeObserver(() => resize() && redraw());
    ro.observe(canvas);
  } else on(globalThis, "resize", () => resize() && redraw());
  // the background: Light, Black, or the trading area's (html[data-theme], html[data-area])
  let mo = null;
  if (typeof MutationObserver === "function") {
    mo = new MutationObserver(() => recolour(false) && (resetAtlas(), redraw()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-area"] });
  }
  // the glyphs' face: until it comes they are drawn in the fallback; once it has, the atlas is drawn again in it
  if (document.fonts && typeof document.fonts.load === "function") {
    document.fonts.load(`600 16px ${FONT}`).then(() => {
      if (released) return;
      resetAtlas();
      if (isStill()) draw(0);
    }, () => {});
  }

  if (resize()) {
    if (isStill()) stillFrame();
    else draw(0);
  }
  schedule();

  return {
    stats() {
      const med = gaps.length ? gaps.slice().sort((a, b) => a - b)[gaps.length >> 1] : 0;
      return { fps: med ? Math.round(1000 / med) : 0, p95ms: +p95(gaps).toFixed(1), engineMs: +p95(costs).toFixed(2), stepMs: +p95(stepCosts).toFixed(2), drawMs: +p95(drawCosts).toFixed(2), lite, still: isStill(), cells: cols * rows, fish: N, sharks: sharks.length };
    },
    release() {
      released = true;
      stop();
      if (ro) ro.disconnect();
      if (mo) mo.disconnect();
      for (const f of off.splice(0)) f();
    },
  };
}

/* the page's own ocean, under everything (account.html #ocean) */
const OCEAN = ocMount(typeof document !== "undefined" && document && typeof document.getElementById === "function" ? document.getElementById("ocean") : null);
