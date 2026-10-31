// face/plugins/lunhui/lib/present.mjs
/**
 * The composition check of `lunhui_present` (run view spec §5.2, M15, M16, M20): Gravit picks,
 * orders, titles and focuses blocks from the face's catalog, and `checkPresent` says yes or why not
 * against the same view model the route serves (`buildView`) and its digest (`viewDigest`). Pure:
 * no clock, no I/O, nothing written. A refusal is a thrown `LunhuiError`, `NOT_A_MARKET_RUN` or
 * `INVALID_PRESENT` with "<field>: <reason>".
 *
 * The number rule (`unsupportedNumbers`): every number Gravit writes must be one the digest holds,
 * in any form a reader would accept - "4,774" for 4774, "1.3%" for −1.33%, "41%" for 0.41,
 * full-width digits. Text is normalised, run ids and dates are dropped, times "H:MM" are compared
 * as "HH:MM" against the digest's times, and a number with d decimals is supported when some digest
 * value rounds to it at d decimals (or, with "%", that value × 100 does). A pool code is skipped.
 */
import { refuse } from "./errors.mjs";
import { minuteIndex } from "./market.mjs";
import { VIEW_MODULES } from "./view.mjs";

/** The catalog's kinds `lunhui_present` takes (§5.3); plan 3 adds `yesterday` and `signals`. */
export const PRESENT_KINDS = Object.freeze(["verdicts", "breadth", "indices", "ladder", "sources"]);

/** The kinds a card run of one module may draw (M20). */
export const MODULE_BLOCKS = Object.freeze({
  environment: Object.freeze(["verdicts", "breadth", "indices", "sources"]),
  sentiment: Object.freeze(["verdicts", "ladder", "sources"]),
  theme: Object.freeze(["verdicts", "sources"]),
  counterevidence: Object.freeze(["verdicts", "sources"]),
});

/** The limits, characters counted as code points. */
export const PRESENT_LIMITS = Object.freeze({ summary: 160, title: 40, blocks: 6, choices: 3, label: 30 });

/** The kinds that need a title, and the ones whose view block carries `unavailable`. */
const TITLED = new Set(["breadth", "indices", "ladder"]);

const FULL_WIDTH = { "．": ".", "：": ":", "，": ",", "％": "%", "＋": "+", "－": "-", "−": "-" };

/** Full-width digits and punctuation, and U+2212, to their ASCII forms. */
export function normaliseText(text) {
  return String(text).replace(/[０-９．：，％＋－−]/g, (ch) => {
    const code = ch.charCodeAt(0);
    return code >= 0xff10 && code <= 0xff19 ? String(code - 0xff10) : FULL_WIDTH[ch];
  });
}

const RUN_ID = /\d{8}T\d{6}Z-[0-9a-f]{8}/g;
const DATE = /\d{4}-\d{1,2}-\d{1,2}|(?<!\d)\d{1,2}-\d{1,2}(?!\d)|\d{1,2}月\d{1,2}日/g;
const TIME = /(?<!\d)(\d{1,2}):(\d{2})(?!\d)/g;
const NUMBER = /(?<![\d.])[+-]?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(%?)/g;

/** A span blanked to spaces of its length, so the positions of what follows hold. */
const blank = (match) => " ".repeat(match.length);

/**
 * A text's times and numbers, each with its position: exempt spans dropped first, then the times
 * (as "HH:MM"), then the numbers.
 * @param {string} text
 */
function tokens(text) {
  let rest = normaliseText(text).replace(RUN_ID, blank).replace(DATE, blank);
  /** @type {{ at: number, time: string }[]} */
  const times = [];
  rest = rest.replace(TIME, (match, h, m, at) => {
    times.push({ at, time: `${h.padStart(2, "0")}:${m}` });
    return blank(match);
  });
  /** @type {{ at: number, raw: string, value: number, decimals: number, percent: boolean }[]} */
  const numbers = [];
  for (const match of rest.matchAll(NUMBER)) {
    const [raw, whole, frac = "", percent] = match;
    const int = whole.replace(/,/g, "");
    numbers.push({ at: match.index, raw, value: Number(frac ? `${int}.${frac}` : int), decimals: frac.length, percent: percent === "%" });
  }
  return { times, numbers };
}

/** `x` rounded half up on magnitude to `d` decimals. */
const round = (x, d) => Math.round(x * 10 ** d + 1e-9) / 10 ** d;

/**
 * The numbers and times in `texts` the digest does not hold: raw tokens and "HH:MM" times, unique,
 * in order of appearance. A six-digit token in `codes` (the view's stock codes) is skipped.
 * @param {string[]} texts
 * @param {string} digest
 * @param {Set<string>} codes
 * @returns {string[]}
 */
export function unsupportedNumbers(texts, digest, codes) {
  const held = tokens(digest);
  const heldTimes = new Set(held.times.map((t) => t.time));
  const values = held.numbers.map((n) => n.value);
  const supported = (n) =>
    values.some((x) => round(x, n.decimals) === n.value || (n.percent && round(x * 100, n.decimals) === n.value));
  const out = [];
  for (const text of texts) {
    const { times, numbers } = tokens(text);
    const missing = [
      ...times.filter((t) => !heldTimes.has(t.time)).map((t) => ({ at: t.at, token: t.time })),
      ...numbers
        .filter((n) => !(/^\d{6}$/.test(n.raw) && codes.has(n.raw)) && !supported(n))
        .map((n) => ({ at: n.at, token: n.raw })),
    ].sort((a, b) => a.at - b.at);
    for (const { token } of missing) if (!out.includes(token)) out.push(token);
  }
  return out;
}

/** The modules a composition records: the card run's module, else the run's market artifacts. */
export function presentModules(args, manifest) {
  if (typeof args?.module === "string") return [args.module];
  const artifacts = new Set(Array.isArray(manifest?.artifacts) ? manifest.artifacts : []);
  return VIEW_MODULES.filter((m) => artifacts.has(m));
}

const points = (text) => [...text].length;
const isText = (value, max) => typeof value === "string" && points(value) >= 1 && points(value) <= max;
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/** A focus "HH:MM" to its grid index, or null off the grid or malformed. */
const gridIndex = (hhmm) => (typeof hhmm === "string" && /^\d{2}:\d{2}$/.test(hhmm) ? minuteIndex(hhmm.replace(":", "")) : null);

/** Why a block of `kind` cannot be drawn from `view`, or null when it can. */
function undrawable(kind, view) {
  if (kind === "sources") return null;
  if (kind === "verdicts") return view.verdicts?.length || view.reviewer ? null : "这个运行没有可画的模块结论或反证";
  return view[kind]?.unavailable ?? null;
}

/** Why `focus` does not fit a block of `kind` on `view`, or null when it does. */
function badFocus(kind, focus, view) {
  if (kind === "ladder") {
    if (!isObject(focus) || !Number.isInteger(focus.rung)) return "ladder 的 focus 须为 { rung }，rung 是整数";
    return view.ladder.rungs.some((r) => r.n === focus.rung) ? null : `梯队里没有 ${focus.rung} 板`;
  }
  if (kind === "indices") {
    if (!isObject(focus)) return "indices 的 focus 须为 { from, to }";
    const from = gridIndex(focus.from);
    const to = gridIndex(focus.to);
    if (from === null || to === null) return "from 与 to 须为交易时段内的 HH:MM（09:30–11:30、13:00–15:00）";
    if (from >= to) return "from 须早于 to";
    const through = gridIndex(view.through);
    if (through === null || to > through) return `to 须不晚于分时线的截止时间 ${view.through ?? "（无分时线）"}`;
    return null;
  }
  return `${kind} 不接受 focus；只有 ladder 与 indices 可标重点`;
}

/**
 * The composition check (§5.2), its rules in order: a market run; the summary; the blocks' kinds;
 * each block drawable; the titles; the focuses; the choices; every number in the digest.
 * @param {any} args the `lunhui_present` call's arguments
 * @param {{ view: any, digest: string, manifest: any }} run the run's view, its digest and `run.json`
 * @returns {{ blocks: string[], modules: string[] }}
 */
export function checkPresent(args, { view, digest, manifest }) {
  if (manifest?.kind !== "market") throw refuse.notMarketRun();
  const L = PRESENT_LIMITS;
  if (!isText(args?.summary, L.summary)) throw refuse.invalidPresent("summary", `须为 1–${L.summary} 个字符`);

  const blocks = args.blocks;
  if (!Array.isArray(blocks) || blocks.length < 1 || blocks.length > L.blocks)
    throw refuse.invalidPresent("blocks", `须为 1–${L.blocks} 个块`);
  const module = args.module;
  if (module !== undefined && !own(MODULE_BLOCKS, module))
    throw refuse.invalidPresent("module", `须为 ${Object.keys(MODULE_BLOCKS).join("、")} 之一`);
  const seen = new Set();
  blocks.forEach((block, i) => {
    if (!isObject(block)) throw refuse.invalidPresent(`blocks[${i}]`, "每个块须为对象");
    if (!PRESENT_KINDS.includes(block.kind))
      throw refuse.invalidPresent(`blocks[${i}].kind`, `须为 ${PRESENT_KINDS.join("、")} 之一`);
    if (module !== undefined && !MODULE_BLOCKS[module].includes(block.kind))
      throw refuse.invalidPresent(`blocks[${i}].kind`, `${module} 模块只能画 ${MODULE_BLOCKS[module].join("、")}`);
    if (seen.has(block.kind)) throw refuse.invalidPresent("blocks", `${block.kind} 出现了两次；每种块至多一次`);
    seen.add(block.kind);
  });
  blocks.forEach((block, i) => {
    const reason = undrawable(block.kind, view);
    if (reason !== null) throw refuse.invalidPresent(`blocks[${i}]`, `${block.kind} 画不出来：${reason}`);
  });
  blocks.forEach((block, i) => {
    if (block.title === undefined && !TITLED.has(block.kind)) return;
    if (!isText(block.title, L.title))
      throw refuse.invalidPresent(`blocks[${i}].title`, `${block.kind} 的标题须为 1–${L.title} 个字符`);
  });
  blocks.forEach((block, i) => {
    if (block.focus === undefined) return;
    const reason = badFocus(block.kind, block.focus, view);
    if (reason !== null) throw refuse.invalidPresent(`blocks[${i}].focus`, reason);
  });

  const choices = args.choices ?? [];
  if (!Array.isArray(choices) || choices.length > L.choices) throw refuse.invalidPresent("choices", `须为 0–${L.choices} 个追问`);
  choices.forEach((choice, i) => {
    if (!isObject(choice)) throw refuse.invalidPresent(`choices[${i}]`, "每个追问须为对象");
    if (!isText(choice.label, L.label)) throw refuse.invalidPresent(`choices[${i}].label`, `须为 1–${L.label} 个字符`);
    if (choice.stock !== undefined && !(typeof choice.stock === "string" && own(view.stocks ?? {}, choice.stock)))
      throw refuse.invalidPresent(`choices[${i}].stock`, "须为这个运行涨停池里的一个六位代码");
  });

  const texts = [args.summary, ...blocks.flatMap((b) => (b.title === undefined ? [] : [b.title])), ...choices.map((c) => c.label)];
  const missing = unsupportedNumbers(texts, digest, new Set(Object.keys(view.stocks ?? {})));
  if (missing.length) throw refuse.invalidPresent("numbers", `这些数字不在 view 摘要里：${missing.join("、")}`);

  return { blocks: blocks.map((b) => b.kind), modules: presentModules(args, manifest) };
}
