/** A Lunhui run's leaders as the owner's memory is asked about them: when a fresh sealed run is first read, the face's
 * own code asks the memory, as `gravit-face`, which of the owner's lessons apply to buying each of the run's top names,
 * once per run, and keeps the answers. No model is in the path.
 *
 * - The leaders ({@link leadersOf}): the names sealed on the ladder's rungs of two boards and up, the highest rung
 *   first and a rung's own order kept, each code once and six digits only, at most {@link LEADERS_MAX}.
 * - Their 所属行业 ({@link industryOf}): the frozen pool's, passed only as 1 to {@link INDUSTRY_MAX} code points none
 *   of which src/echo.ts would escape.
 * - The store ({@link createLunhuiLessons}): the runs service's view first, its refusals passed through; then the kept
 *   answer, in the process or in `<dir>/<strategy>/<run>.json`, read back through a shape check; then a run sealed
 *   more than {@link LUNHUI_FRESH_MS} ago, or whose sealing time does not parse, is not asked, nor is one that froze
 *   no limit-up pool, nor one asked while the memory is not connected. Otherwise each leader's price facts are read
 *   together, each within the facts' own bound, and each leader is recalled in turn within {@link LEADER_ASK_MS}; the
 *   answer, faults included, is kept in the file and in the process and is not asked again. A second read of a run
 *   being asked awaits that ask. A fault and a failed write are one log line each.
 *
 * The file is written under a temporary name beside it (flag `wx`, mode 0o600) and renamed into place, its directory
 * made 0o700 at the first write. Its path is built only from names the runs service accepted, each matching its copy
 * of the runs module's grammar.
 *
 * MODULE WEIGHT. src/desk.ts does not import it (tests/desk-weight.test.ts).
 * @module
 */
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { UNSAFE_ECHO_RE } from "./echo.ts";
import { askMemory, type Asked, type GateLesson, type GateUntold } from "./memory-ask.ts";
import { FACT_READ_MS, type Facts } from "./memory-facts.ts";
import { memoryFaultWords, type MemoryStanding } from "./memory.ts";
import { CN_SYMBOL_RE } from "./symbols.ts";

/** The most leaders a run is asked about. */
export const LEADERS_MAX = 5;
/** How long after its sealing a run is still asked. */
export const LUNHUI_FRESH_MS = 86_400_000;
/** The bound of each leader's recall. */
export const LEADER_ASK_MS = 3_000;
/** The longest 所属行业 passed, in code points. */
export const INDUSTRY_MAX = 24;

/** A strategy name. Copied, not imported, from `STRATEGY_NAME_RE` in `face/plugins/lunhui/lib/runs.mjs` (the face does
 * not import from `plugins/`); tests/memory-lunhui.test.ts pins the copy to its source. */
export const STRATEGY_NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}\p{M}_-]{0,40}$/u;
/** A run id. Copied from `RUN_ID_RE` in the same module, and pinned the same way. */
export const RUN_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** A leader: its code and the boards of the rung it is sealed on. */
export interface Leader { code: string; boards: number }

/** A leader and what its recall told. */
export interface LeaderLessons extends Leader, Asked {}

/** A run's lessons: checked and kept, not checked and why, or the memory's words for why it is not connected. */
export type LunhuiLessons =
  | { state: "checked"; strategy: string; run: string; askedAt: string; leaders: LeaderLessons[] }
  | { state: "not checked"; why: "old" | "no pool" | "unreadable"; words: string }
  | { state: "not connected"; words: string };

export interface LunhuiLessonsDeps {
  /** `<harness home>/face/memory/lunhui`, made at the first write. */
  dir: string;
  /** The runs service's view with no module; throws its coded refusals. */
  view: (strategy: string, run: string) => Promise<unknown>;
  open: () => Promise<MemoryStanding>;
  /** A code's price facts as an A share. */
  facts: (code: string) => Promise<Facts>;
  log: (line: string) => void;
  now?: () => number;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

export interface LunhuiLessonsStore { get(strategy: string, run: string): Promise<LunhuiLessons> }

const OLD: LunhuiLessons = { state: "not checked", why: "old", words: "lessons were not checked for this run" };
const NO_POOL: LunhuiLessons = { state: "not checked", why: "no pool", words: "the run froze no limit-up pool" };
const UNREADABLE: LunhuiLessons = { state: "not checked", why: "unreadable", words: "the kept answer could not be read" };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const count = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/** Pure: the ladder's top names, whatever order its rungs and their names are given in. */
export function leadersOf(view: unknown): Leader[] {
  if (!isObject(view) || !isObject(view.ladder)) return [];
  const { rungs, unavailable } = view.ladder;
  if ((unavailable !== null && unavailable !== undefined) || !Array.isArray(rungs)) return [];
  const tall = rungs
    .filter((rung): rung is { n: number; sealed: unknown[] } => isObject(rung) && Number.isInteger(rung.n) && (rung.n as number) >= 2 && Array.isArray(rung.sealed))
    .sort((a, b) => b.n - a.n);
  const out: Leader[] = [];
  const seen = new Set<string>();
  for (const rung of tall) {
    for (const stock of rung.sealed) {
      const code = isObject(stock) ? stock.code : undefined;
      if (typeof code !== "string" || !CN_SYMBOL_RE.test(code) || seen.has(code)) continue;
      seen.add(code);
      out.push({ code, boards: rung.n });
      if (out.length === LEADERS_MAX) return out;
    }
  }
  return out;
}

/** Pure: the frozen pool's 所属行业 of `code`, when it is 1 to {@link INDUSTRY_MAX} code points none of which
 * src/echo.ts would escape. */
export function industryOf(view: unknown, code: string): string | undefined {
  if (!isObject(view) || !isObject(view.stocks) || !Object.hasOwn(view.stocks, code)) return undefined;
  const stock = view.stocks[code];
  const industry = isObject(stock) ? stock.industry : undefined;
  if (typeof industry !== "string") return undefined;
  const points = [...industry].length;
  if (points < 1 || points > INDUSTRY_MAX || industry.search(UNSAFE_ECHO_RE) !== -1) return undefined;
  return industry;
}

/** A kept lesson, rebuilt from its known fields; undefined when it is not of the shape. */
function lessonOf(v: unknown): GateLesson | undefined {
  if (!isObject(v)) return undefined;
  const { id, strength, says, words, fired, followed, overridden } = v;
  if (typeof id !== "string" || (strength !== "caveat" && strength !== "red-line")) return undefined;
  if ((says !== "dont" && says !== "do" && says !== "careful") || typeof words !== "string") return undefined;
  if (!count(fired) || !count(followed) || !count(overridden)) return undefined;
  return { id, strength, says, words, fired, followed, overridden };
}

/** A kept untold lesson, rebuilt; undefined when it is not of the shape. */
function untoldOf(v: unknown): GateUntold | undefined {
  if (!isObject(v) || typeof v.id !== "string" || !Array.isArray(v.needs) || !v.needs.every((need) => typeof need === "string")) return undefined;
  return { id: v.id, needs: [...v.needs] };
}

/** Each item rebuilt by `of`, or undefined when one is not of the shape. */
function listOf<T>(v: unknown, of: (item: unknown) => T | undefined): T[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: T[] = [];
  for (const item of v) {
    const one = of(item);
    if (one === undefined) return undefined;
    out.push(one);
  }
  return out;
}

/** A kept leader, rebuilt; undefined when it is not of the shape. */
function leaderOf(v: unknown): LeaderLessons | undefined {
  if (!isObject(v) || typeof v.code !== "string" || !CN_SYMBOL_RE.test(v.code) || !Number.isInteger(v.boards) || (v.boards as number) < 2) return undefined;
  const lessons = listOf(v.lessons, lessonOf);
  const untold = listOf(v.untold, untoldOf);
  if (lessons === undefined || untold === undefined || !count(v.lessonsMore) || !count(v.untoldMore)) return undefined;
  if ((v.recall !== undefined && typeof v.recall !== "string") || (v.fault !== undefined && typeof v.fault !== "string")) return undefined;
  return {
    code: v.code, boards: v.boards as number,
    ...(v.recall === undefined ? {} : { recall: v.recall as string }),
    lessons, lessonsMore: v.lessonsMore, untold, untoldMore: v.untoldMore,
    ...(v.fault === undefined ? {} : { fault: v.fault as string }),
  };
}

/** A kept answer of `strategy`'s `run`, rebuilt; undefined when it is not of the `checked` shape. */
function keptOf(v: unknown, strategy: string, run: string): LunhuiLessons | undefined {
  if (!isObject(v) || v.state !== "checked" || v.strategy !== strategy || v.run !== run) return undefined;
  if (typeof v.askedAt !== "string" || Number.isNaN(Date.parse(v.askedAt))) return undefined;
  const leaders = listOf(v.leaders, leaderOf);
  if (leaders === undefined || leaders.length > LEADERS_MAX) return undefined;
  return { state: "checked", strategy, run, askedAt: v.askedAt, leaders };
}

/** A refusal the runs service would give, for a name its grammar refuses. */
const refused = (code: "NOT_A_STRATEGY" | "BAD_RUN_ID"): Error => Object.assign(new Error(code === "BAD_RUN_ID" ? "bad run id" : "no such strategy"), { code });

/** The store. `get` rejects only with the view's refusals. */
export function createLunhuiLessons(deps: LunhuiLessonsDeps): LunhuiLessonsStore {
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((run: () => void, ms: number): unknown => setTimeout(run, ms));
  const clearTimer = deps.clearTimer ?? ((timer: unknown): void => clearTimeout(timer as ReturnType<typeof setTimeout>));
  /** The checked answers, by `<strategy>/<run>`. */
  const kept = new Map<string, LunhuiLessons>();
  /** The asks under way, by `<strategy>/<run>`. */
  const asking = new Map<string, Promise<LunhuiLessons>>();

  const say = (line: string): void => {
    try {
      deps.log(line);
    } catch {
      /* a log that throws costs the answer nothing */
    }
  };

  /** A code's price facts, or none when they do not come within {@link FACT_READ_MS}. Never rejects. */
  const factsOf = (code: string): Promise<Facts> =>
    new Promise((resolve) => {
      let done = false;
      let timer: unknown;
      const settle = (facts: Facts): void => {
        if (done) return;
        done = true;
        try {
          clearTimer(timer);
        } catch {
          /* the timer fires into a settled read */
        }
        resolve(facts);
      };
      const none = (): void => settle({ facts: {}, sources: {} });
      Promise.resolve()
        .then(() => deps.facts(code))
        .then((facts) => (isObject(facts) && isObject(facts.facts) && isObject(facts.sources) ? settle(facts) : none()), none);
      try {
        timer = setTimer(none, FACT_READ_MS);
      } catch {
        none();
      }
    });

  /** The kept file: the answer, unreadable, or undefined when there is none. */
  const readKept = async (file: string, strategy: string, run: string): Promise<LunhuiLessons | undefined> => {
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (code === "ENOENT" || code === "ENOTDIR") return undefined;
      return UNREADABLE;
    }
    try {
      return keptOf(JSON.parse(text), strategy, run) ?? UNREADABLE;
    } catch {
      return UNREADABLE;
    }
  };

  const write = async (file: string, answer: LunhuiLessons): Promise<void> => {
    const temp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
    try {
      await writeFile(temp, JSON.stringify(answer), { flag: "wx", mode: 0o600 });
      await rename(temp, file);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => {});
      throw error;
    }
  };

  /** Steps 2 to 7, for a view the runs service gave. */
  const answer = async (view: unknown, strategy: string, run: string, key: string): Promise<LunhuiLessons> => {
    const folder = join(deps.dir, strategy);
    const file = join(folder, `${run}.json`);
    const found = await readKept(file, strategy, run);
    if (found !== undefined) {
      if (found.state === "checked") kept.set(key, found);
      return found;
    }
    const frozenAt = isObject(view) && typeof view.frozenAt === "string" ? Date.parse(view.frozenAt) : Number.NaN;
    if (!Number.isFinite(frozenAt) || now() - frozenAt > LUNHUI_FRESH_MS) return OLD;
    if (!isObject(view) || !isObject(view.ladder) || (view.ladder.unavailable !== null && view.ladder.unavailable !== undefined)) return NO_POOL;
    let standing: MemoryStanding;
    try {
      standing = await deps.open();
    } catch (error) {
      return { state: "not connected", words: memoryFaultWords(error) };
    }
    if (standing?.connected !== true) return { state: "not connected", words: String(standing?.say) };

    const askedAt = new Date(now()).toISOString();
    const leaders = leadersOf(view);
    const facts = await Promise.all(leaders.map((leader) => factsOf(leader.code)));
    const told: LeaderLessons[] = [];
    for (const [i, leader] of leaders.entries()) {
      const given: Facts = { facts: { ...facts[i].facts }, sources: { ...facts[i].sources } };
      const industry = industryOf(view, leader.code);
      if (industry !== undefined) {
        given.facts.industry = industry;
        given.sources.industry = `the run's frozen limit-up pool (${run})`;
      }
      const result = await askMemory(
        async () => standing,
        { considering: ["buy"], symbol: leader.code, market: "CN", facts: given },
        { ms: LEADER_ASK_MS, setTimer, clearTimer },
      );
      const asked: Asked = "asked" in result ? result.asked : { lessons: [], lessonsMore: 0, untold: [], untoldMore: 0, fault: result.notConnected };
      if (asked.fault !== undefined) say(`memory lunhui: ${strategy}/${run}: ${leader.code}: ${asked.fault}`);
      told.push({ code: leader.code, boards: leader.boards, ...asked });
    }
    const checked: LunhuiLessons = { state: "checked", strategy, run, askedAt, leaders: told };
    kept.set(key, checked);
    try {
      await mkdir(folder, { recursive: true, mode: 0o700 });
      await write(file, checked);
    } catch (error) {
      say(`memory lunhui: ${strategy}/${run}: the answer could not be kept: ${memoryFaultWords(error)}`);
    }
    return checked;
  };

  return {
    async get(strategy, run) {
      const view = await deps.view(strategy, run);
      if (!STRATEGY_NAME_RE.test(strategy)) throw refused("NOT_A_STRATEGY");
      if (!RUN_ID_RE.test(run)) throw refused("BAD_RUN_ID");
      const key = `${strategy}/${run}`;
      const held = kept.get(key);
      if (held !== undefined) return held;
      const under = asking.get(key);
      if (under !== undefined) return under;
      const ask = answer(view, strategy, run, key).finally(() => asking.delete(key));
      asking.set(key, ask);
      return ask;
    },
  };
}
