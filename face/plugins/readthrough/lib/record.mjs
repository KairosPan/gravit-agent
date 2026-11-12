// face/plugins/readthrough/lib/record.mjs
/**
 * The record: every direction proposed for a stock's rivals, one JSON line in `<dir>/directions.jsonl` under the
 * harness home, and one more line when its message is sent or not. The file is only ever appended to, in a directory
 * made 0o700, the file 0o600. Appends run one after another on one promise chain per record; each first reads the
 * file's last byte and writes a newline before its own line when that byte is not one, so a line torn by a crash never
 * swallows the next. Reading skips a line that is not JSON or has no known `kind`.
 */
import { randomBytes } from "node:crypto";
import { appendFile, mkdir, open, readFile } from "node:fs/promises";
import { join } from "node:path";

/** The record's file name, under the record's directory. */
export const RECORD_FILE = "directions.jsonl";
/** A direction id: `rt-`, the New York date YYYYMMDD, a dash and 8 lowercase hex digits. */
export const ID_RE = /^rt-\d{8}-[0-9a-f]{8}$/;

const NEW_YORK_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * @typedef {{ symbol: string, price: number | null, changePct: number | null, feed: string, asOf: string | null, traded: boolean }} Print
 * @typedef {{ kind: "annotation", pass: string, sessionId: string, ref: string } | { kind: "task", sessionId: string }} Caller
 * @typedef {{ kind: "direction", id: string, t: string, caller: Caller, symbol: string, basis: string, event: string,
 *   sources: string[], logic: string, peers: Array<Print & { reason: string }>, stricken: Print, spy: Print,
 *   counter: string | null, noDirection: string | null, certainty: string, shut: boolean }} DirectionEntry
 * @typedef {{ kind: "sent", id: string, t: string, sent: boolean }} SentEntry
 * @typedef {DirectionEntry | SentEntry} Entry
 */

const KINDS = new Set(["direction", "sent"]);

/**
 * A new direction id: the New York date of `now` and four random bytes in hex.
 * @param {Date} now
 * @returns {string}
 */
export function newId(now) {
  return `rt-${NEW_YORK_DATE.format(now).replaceAll("-", "")}-${randomBytes(4).toString("hex")}`;
}

/**
 * Whether the file ends in a newline, or is empty or missing.
 * @param {string} file
 * @returns {Promise<boolean>}
 */
async function endsWhole(file) {
  let handle;
  try {
    handle = await open(file, "r");
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === "ENOENT") return true;
    throw err;
  }
  try {
    const { size } = await handle.stat();
    if (size === 0) return true;
    const byte = Buffer.alloc(1);
    await handle.read(byte, 0, 1, size - 1);
    return byte[0] === 0x0a;
  } finally {
    await handle.close();
  }
}

/**
 * The record kept in `dir`.
 * @param {string} dir
 */
export function createRecord(dir) {
  const file = join(dir, RECORD_FILE);
  /** @type {Promise<unknown>} */
  let chain = Promise.resolve();

  /**
   * @param {Record<string, unknown>} entry
   * @returns {Promise<void>}
   */
  function write(entry) {
    const run = chain.then(async () => {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const lead = (await endsWhole(file)) ? "" : "\n";
      await appendFile(file, `${lead}${JSON.stringify(entry)}\n`, { mode: 0o600 });
    });
    chain = run.catch(() => {});
    return run;
  }

  /** @returns {Promise<Entry[]>} */
  async function all() {
    let text;
    try {
      text = await readFile(file, "utf8");
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code === "ENOENT") return [];
      throw err;
    }
    /** @type {Entry[]} */
    const entries = [];
    for (const line of text.split("\n")) {
      if (!line) continue;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (parsed && typeof parsed === "object" && KINDS.has(parsed.kind)) entries.push(parsed);
    }
    return entries;
  }

  return {
    /**
     * Appends a direction, a `DirectionEntry` as the caller built it; the record stores it as given.
     * @param {Record<string, unknown>} entry
     * @returns {Promise<void>}
     */
    append: (entry) => write(entry),
    /**
     * Appends whether a direction's message was sent.
     * @param {string} id
     * @param {boolean} sent
     * @param {string} t
     * @returns {Promise<void>}
     */
    sent: (id, sent, t) => write({ kind: "sent", id, t, sent }),
    /**
     * The latest direction an annotation gave for `symbol` against the reference close `ref`, if any.
     * @param {string} symbol
     * @param {string} ref
     * @returns {Promise<DirectionEntry | undefined>}
     */
    async given(symbol, ref) {
      const entries = await all();
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i];
        if (e.kind === "direction" && e.symbol === symbol && e.caller?.kind === "annotation" && e.caller.ref === ref) {
          return e;
        }
      }
      return undefined;
    },
    all,
  };
}
