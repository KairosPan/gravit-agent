/** The 问财 client: a free-form question to iFinD's natural-language screener (smart_stock_picking, through the iFinD client's `pick`), under
 * a rolling daily budget, an answer kept a minute, and iFinD's column-oriented reply turned into trimmed rows. It holds no token: the picker
 * does, and no answer or refusal here names one, a host or a URL. */
import type { IfindPicker } from "./cn-ifind.js";

export const WENCAI_TYPES = ["stock", "fund"] as const;
export type WencaiType = (typeof WENCAI_TYPES)[number];

export const WENCAI_DEADLINE_MS = 30_000, WENCAI_QUESTION_MAX = 300, WENCAI_LIMIT_DEFAULT = 50, WENCAI_LIMIT_MAX = 200, WENCAI_CELL_MAX = 200;
export const WENCAI_KEEP_MS = 60_000, WENCAI_WINDOW_MS = 86_400_000, WENCAI_PER_DAY_DEFAULT = 100;

export type WencaiWord = "bad-question" | "bad-type" | "off" | "unconfigured" | "budget" | "credential" | "timeout" | "too-large" | "unreachable" | "upstream";
/** resetsAt: when the oldest counted call leaves the window (ISO); null when none is counted */
export interface WencaiBudget { used: number; cap: number; resetsAt: string | null }
/** truncated: more rows than returned, or a cell was cut; tables: only when iFinD sent more than one */
export interface WencaiTable { columns: string[]; rows: unknown[][]; rowCount: number; returned: number; truncated: boolean; tables?: number }
export interface WencaiOk extends WencaiTable { ok: true; question: string; type: WencaiType; asOf: string; budget: WencaiBudget }
export type WencaiAnswer =
  | { kind: "ok"; body: WencaiOk }
  | { kind: "refused"; word: WencaiWord; message: string; detail?: { errorcode: number | null; errmsg: string } };
export interface CnWencai {
  ask(req: { question?: unknown; type?: unknown; limit?: unknown }): Promise<WencaiAnswer>;
  budget(): WencaiBudget;
  /** configured and a cap above 0 */
  enabled(): boolean;
}

const CREDENTIAL_CODES = new Set([-1301, -1302]);
const CONTROL = /[\u0000-\u001f\u007f]/;
const MESSAGES = {
  question: `question: 1 to ${WENCAI_QUESTION_MAX} characters after trimming, with no control characters (a newline among them)`,
  type: `type: ${WENCAI_TYPES.join(" or ")}`,
  limit: `limit: an integer from 1 to ${WENCAI_LIMIT_MAX}`,
  off: "问财 is off on this market (MARKET_WENCAI_PER_DAY is 0)",
  unconfigured: "iFinD is not configured on this market: 问财 cannot be asked",
  credential: "iFinD refused the account's token: the account may have expired. Renew it at iFinD, write the new refresh token into .env.ifind, then restart the market.",
  timeout: `问财 did not answer within ${WENCAI_DEADLINE_MS / 1000} seconds`,
  "too-large": "问财's answer was larger than the market accepts",
  unreachable: "iFinD could not be reached",
} as const;

/** a string of more than `max` characters (code points) as its first max - 1 and "…" */
function cut(s: string, max: number): string {
  const cps = [...s];
  return cps.length > max ? `${cps.slice(0, max - 1).join("")}…` : s;
}
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** iFinD's first table (one array per column) as columns and rows in column order, the first `limit` rows; null when the reply is not
 * `{errorcode: 0, tables: [...]}`. A short column is filled with null; a long string cell is cut. */
export function tableOf(reply: unknown, limit: number): WencaiTable | null {
  if (!isRecord(reply) || reply.errorcode !== 0 || !Array.isArray(reply.tables)) return null;
  const first = reply.tables[0];
  const table = isRecord(first) && isRecord(first.table) ? first.table : {};
  const columns = Object.keys(table);
  const values = columns.map((c) => { const v = table[c]; return Array.isArray(v) ? v : []; });
  const rowCount = values.reduce((n, v) => Math.max(n, v.length), 0);
  const returned = Math.min(rowCount, limit);
  let cutAny = false;
  const rows: unknown[][] = [];
  for (let i = 0; i < returned; i++) {
    rows.push(values.map((v) => {
      const cell = i < v.length ? v[i] : null;
      if (typeof cell !== "string") return cell === undefined ? null : cell;
      const c = cut(cell, WENCAI_CELL_MAX);
      if (c !== cell) cutAny = true;
      return c;
    }));
  }
  return { columns, rows, rowCount, returned, truncated: rowCount > returned || cutAny, ...(reply.tables.length > 1 ? { tables: reply.tables.length } : {}) };
}

/** MARKET_WENCAI_PER_DAY: a non-negative integer (0 = off); anything else is the default */
export function wencaiPerDay(env: Record<string, string | undefined>): number {
  const v = env.MARKET_WENCAI_PER_DAY;
  return v !== undefined && /^\d+$/.test(v) ? Number(v) : WENCAI_PER_DAY_DEFAULT;
}

type Refused = Extract<WencaiAnswer, { kind: "refused" }>;
const refuse = (word: WencaiWord, message: string, detail?: Refused["detail"]): Refused =>
  ({ kind: "refused", word, message, ...(detail ? { detail } : {}) });
/** iFinD's code and errmsg passed on as data, the errmsg cut to 200 characters in the message as in the detail */
const upstreamError = (errorcode: number | null, errmsg: string): Refused => {
  const said = cut(errmsg, WENCAI_CELL_MAX);
  return refuse("upstream", `问财 answered with an error${errorcode === null ? "" : ` (errorcode ${errorcode})`}: ${said || "no message"}`, { errorcode, errmsg: said });
};

function parse(bytes: Uint8Array): unknown {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { return undefined; }
}

export function createWencai(o: { picker: IfindPicker; configured: () => boolean; perDay: number; now?: () => number }): CnWencai {
  const now = o.now ?? Date.now;
  const cap = o.perDay;
  /** the times of the counted smart_stock_picking calls inside the window, oldest first */
  const calls: number[] = [];
  const kept = new Map<string, { at: number; body: WencaiOk }>();
  const flights = new Map<string, Promise<WencaiAnswer>>();

  const prune = (): void => {
    const t = now();
    while (calls.length > 0 && t - calls[0]! >= WENCAI_WINDOW_MS) calls.shift();
  };
  const budget = (): WencaiBudget => {
    prune();
    return { used: calls.length, cap, resetsAt: calls.length > 0 ? new Date(calls[0]! + WENCAI_WINDOW_MS).toISOString() : null };
  };
  /** kept from the moment the reply came back (its asOf) */
  const keep = (key: string, body: WencaiOk): void => {
    const t = now();
    for (const [k, e] of kept) if (t - e.at >= WENCAI_KEEP_MS) kept.delete(k);
    kept.set(key, { at: Date.parse(body.asOf), body });
  };

  const read = async (question: string, type: WencaiType, limit: number): Promise<WencaiAnswer> => {
    const b = budget();
    if (b.used >= cap) {
      // the call whose leaving brings the count under the cap
      const frees = new Date(calls[b.used - cap]! + WENCAI_WINDOW_MS).toISOString();
      return refuse("budget", `${b.used} of ${cap} 问财 calls spent in the last 24 hours; the next one frees at ${frees}`);
    }
    const { answer, asked } = await o.picker.pick(question, type, WENCAI_DEADLINE_MS);
    const at = now();
    for (let i = 0; i < asked; i++) calls.push(at);
    if (answer.kind === "refused") return refuse(answer.word, MESSAGES[answer.word]);
    if (answer.status !== 200) return upstreamError(null, `HTTP ${answer.status}`);
    const reply = parse(answer.bytes);
    if (!isRecord(reply)) return upstreamError(null, "the reply was not JSON");
    const code = reply.errorcode;
    if (typeof code === "number" && CREDENTIAL_CODES.has(code)) return refuse("credential", MESSAGES.credential);
    const table = tableOf(reply, limit);
    if (!table) {
      const errmsg = typeof reply.errmsg === "string" && reply.errmsg ? reply.errmsg : code === 0 ? "the reply held no tables" : "";
      return upstreamError(typeof code === "number" ? code : null, errmsg);
    }
    return { kind: "ok", body: { ok: true, question, type, asOf: new Date(at).toISOString(), ...table, budget: budget() } };
  };

  return {
    budget,
    enabled: () => o.configured() && cap > 0,
    ask(req) {
      const q = typeof req.question === "string" ? req.question.trim() : "";
      if (q.length === 0 || [...q].length > WENCAI_QUESTION_MAX || CONTROL.test(q)) return Promise.resolve(refuse("bad-question", MESSAGES.question));
      const type = req.type ?? "stock";
      if (!(WENCAI_TYPES as readonly unknown[]).includes(type)) return Promise.resolve(refuse("bad-type", MESSAGES.type));
      const limit = req.limit ?? WENCAI_LIMIT_DEFAULT;
      if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > WENCAI_LIMIT_MAX) return Promise.resolve(refuse("bad-question", MESSAGES.limit));
      if (cap <= 0) return Promise.resolve(refuse("off", MESSAGES.off));
      if (!o.configured()) return Promise.resolve(refuse("unconfigured", MESSAGES.unconfigured));

      const key = `${type}\n${limit}\n${q}`;
      const hit = kept.get(key);
      if (hit && now() - hit.at < WENCAI_KEEP_MS) return Promise.resolve({ kind: "ok", body: { ...hit.body, budget: budget() } });
      const flying = flights.get(key);
      if (flying) return flying;
      const flight = read(q, type as WencaiType, limit)
        .then((a) => { if (a.kind === "ok") keep(key, a.body); return a; })
        .finally(() => flights.delete(key));
      flights.set(key, flight);
      return flight;
    },
  };
}
