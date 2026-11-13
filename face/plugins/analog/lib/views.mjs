// face/plugins/analog/lib/views.mjs
/**
 * The view store: one JSON file per stored view, `<dir>/<id>.json`, under the harness home
 * (`$DSH_HOME/face/analog/views/`). A view is written to `<id>.json.tmp` (flag `wx`, mode 0o600) and renamed into
 * place, in a directory made 0o700; the newest `kept` views stay, the older ones are removed by modification time.
 *
 * A view over `maxBytes` is trimmed before it is written, from its last case backwards: first windows go, the last
 * case's that still has one first; then whole cases leave, the last first. A view still over the cap with no case
 * left is refused `INTERNAL`. The trimming is decided from each case's own serialized size, with and without its
 * window, and the size of the rest of the view, so the view is serialized a handful of times, not once per drop. The
 * stored view carries its `id`, `windowsDropped` (the listed cases whose window the store removed) and `casesDropped`
 * (the cases it removed); the cases keep their given order, and the view given to `write` is never changed.
 */
import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { refuse } from "./errors.mjs";

/** The largest stored view, in UTF-8 bytes. */
export const VIEW_MAX_BYTES = 524_288;
/** How many views the store keeps, the newest by modification time. */
export const VIEWS_KEPT = 300;
/** A view id: `an-`, the New York date YYYYMMDD, a dash and 8 lowercase hex digits. */
export const VIEW_ID_RE = /^an-\d{8}-[0-9a-f]{8}$/;

const NEW_YORK_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * A new view id: the New York date of `now` and four random bytes in hex.
 * @param {Date} now
 * @param {() => Buffer} [random] the four bytes, `crypto.randomBytes(4)` unless given
 * @returns {string}
 */
export function newViewId(now, random = () => randomBytes(4)) {
  return `an-${NEW_YORK_DATE.format(now).replaceAll("-", "")}-${random().toString("hex")}`;
}

/** @param {string} text */
const byteSize = (text) => Buffer.byteLength(text, "utf8");

/**
 * The trimmed copy of a view to store, decided in one pass over the cases' own serialized sizes.
 * @param {Record<string, unknown> & { cases: any[] }} view
 * @param {string} id
 * @param {number} maxBytes
 * @returns {{ stored: Record<string, unknown>, windowsDropped: number, casesDropped: number }}
 */
function trim(view, id, maxBytes) {
  const cases = view.cases;
  // The rest of the view with both counts at 0; a count of more digits adds its extra digits.
  const rest = byteSize(JSON.stringify({ ...view, cases: [], id, windowsDropped: 0, casesDropped: 0 }));
  const hasWindow = cases.map((c) => c?.window !== null && c?.window !== undefined);
  const full = cases.map((c) => byteSize(JSON.stringify(c)));
  const bare = cases.map((c, i) => (hasWindow[i] ? byteSize(JSON.stringify({ ...c, window: null })) : full[i]));
  const windowless = cases.map(() => false);
  const listed = cases.map(() => true);

  let sum = full.reduce((a, b) => a + b, 0);
  let count = cases.length;
  let windowsDropped = 0;
  let casesDropped = 0;
  const total = () =>
    rest + sum + Math.max(0, count - 1) + String(windowsDropped).length - 1 + String(casesDropped).length - 1;

  // From the last case backwards.
  const order = cases.map((_, i) => i).reverse();

  /** @param {number[]} indices */
  const dropWindows = (indices) => {
    for (const i of indices) {
      if (total() <= maxBytes) return;
      if (!hasWindow[i] || windowless[i]) continue;
      windowless[i] = true;
      sum += bare[i] - full[i];
      windowsDropped += 1;
    }
  };
  /** @param {number[]} indices */
  const dropCases = (indices) => {
    for (const i of indices) {
      if (total() <= maxBytes) return;
      listed[i] = false;
      sum -= windowless[i] ? bare[i] : full[i];
      count -= 1;
      casesDropped += 1;
      if (windowless[i]) windowsDropped -= 1;
    }
  };
  dropWindows(order);
  dropCases(order);
  if (total() > maxBytes) throw refuse.internal();

  const kept = [];
  for (let i = 0; i < cases.length; i++) {
    if (listed[i]) kept.push(windowless[i] ? { ...cases[i], window: null } : cases[i]);
  }
  return { stored: { ...view, cases: kept, id, windowsDropped, casesDropped }, windowsDropped, casesDropped };
}

/**
 * The view store over one directory.
 * @param {string} dir the views directory, `$DSH_HOME/face/analog/views`
 * @param {{ kept?: number, maxBytes?: number }} [options]
 */
export function createViewStore(dir, { kept = VIEWS_KEPT, maxBytes = VIEW_MAX_BYTES } = {}) {
  /** Remove the oldest views beyond `kept`, never `keep`; a failed removal is one line on stderr. */
  const prune = async (/** @type {string} */ keep) => {
    const names = (await readdir(dir)).filter((n) => n.endsWith(".json") && n !== `${keep}.json`);
    if (names.length < kept) return;
    const dated = await Promise.all(
      names.map(async (name) => ({ name, at: await stat(join(dir, name)).then((s) => s.mtimeMs, () => Infinity) })),
    );
    dated.sort((a, b) => b.at - a.at);
    for (const { name } of dated.slice(Math.max(0, kept - 1))) {
      await rm(join(dir, name), { force: true }).catch((error) => {
        process.stderr.write(`analog: could not remove an old view: ${error?.message ?? String(error)}\n`);
      });
    }
  };

  return {
    /**
     * Store a view under a new id, trimmed to the size cap; the view given is not changed.
     * @param {Record<string, unknown> & { cases: any[] }} view any object with a `cases` array
     * @param {Date} [now]
     * @returns {Promise<{ id: string, bytes: number, windowsDropped: number, casesDropped: number }>}
     */
    async write(view, now = new Date()) {
      const id = newViewId(now);
      const { stored, windowsDropped, casesDropped } = trim(view, id, maxBytes);
      const text = JSON.stringify(stored);
      const bytes = byteSize(text);
      if (bytes > maxBytes) throw refuse.internal();
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const target = join(dir, `${id}.json`);
      const temp = `${target}.tmp`;
      try {
        await writeFile(temp, text, { flag: "wx", mode: 0o600 });
        await rename(temp, target);
      } catch (error) {
        await rm(temp, { force: true }).catch(() => {});
        throw error;
      }
      await prune(id);
      return { id, bytes, windowsDropped, casesDropped };
    },

    /**
     * A stored view by its id: `BAD_VIEW_ID` for a string that is not an id, before the disk is touched;
     * `NO_SUCH_VIEW` for one not kept.
     * @param {string} id
     * @returns {Promise<object>}
     */
    async read(id) {
      if (typeof id !== "string" || !VIEW_ID_RE.test(id)) throw refuse.badViewId();
      let text;
      try {
        text = await readFile(join(dir, `${id}.json`), "utf8");
      } catch (error) {
        if (/** @type {any} */ (error)?.code === "ENOENT") throw refuse.noSuchView();
        throw error;
      }
      return JSON.parse(text);
    },
  };
}
