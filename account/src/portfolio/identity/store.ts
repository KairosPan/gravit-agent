/** THE IDENTITY STATE AND THE STRANGERS — what the account keeps about the networks it speaks on, besides their tokens.
 *
 * `<home>/identity/state.json` holds the bindings (which bot speaks as Gravit, and the one person it talks to), the routing, quiet hours
 * and the senders the owner blocked. `<home>/identity/strangers.json` holds whoever wrote to the bot and is not the operator: a reference
 * (the first 12 hex of sha256("<network>:<id>")), the id masked to its last three characters, how many times and when last — never a name, a
 * handle, the id itself or a text. At most 50 strangers are kept; the one heard from longest ago leaves first.
 *
 * Both files are 0600 in a 0700 folder, written whole (a temporary file beside it, flushed, renamed over the old one). A token is never
 * here: it is in `<home>/credentials/networks/<network>.json` (secret-file.ts). */
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync, type Stats } from "node:fs";
import { join } from "node:path";
import { emptyRouting, isClock, NETWORKS, ROUTE_ROWS, type Network, type Routing } from "./kinds.ts";

export interface Binding {
  network: Network;
  /** the bot's handle, as the tab shows it */
  speaksAs: string;
  botId: string;
  /** the operator's handle, as the tab shows it */
  talksOnlyWith: string;
  operatorId: string;
  /** when it was connected, ISO */
  since: string;
  /** the token's fingerprint the owner signed */
  fingerprint: string;
}

export interface IdentityState {
  bindings: Binding[];
  routing: Routing;
  /** quiet hours on New York's clock, or null when off */
  quiet: { from: string; to: string } | null;
  /** the strangers' references the owner blocked */
  blocked: string[];
}

const freshDefault = (): IdentityState => ({ bindings: [], routing: emptyRouting(), quiet: { from: "23:00", to: "07:00" }, blocked: [] });

function deepFreeze<T>(v: T): T {
  if (v && typeof v === "object") {
    for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k]);
    Object.freeze(v);
  }
  return v;
}

/** no bindings, every row empty, quiet 23:00–07:00, none blocked — frozen: loadIdentity answers a fresh copy to change */
export const DEFAULT_STATE: IdentityState = deepFreeze(freshDefault());

export const identityDir = (home: string): string => join(home, "identity");
export const statePath = (home: string): string => join(identityDir(home), "state.json");
export const strangersPath = (home: string): string => join(identityDir(home), "strangers.json");

/** how many blocked senders the state keeps: past it, the one blocked longest ago leaves first */
export const BLOCKED_MAX = 200;

const lstatOf = (p: string): Stats | undefined => {
  try {
    return lstatSync(p);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
};
const linkRefused = (what: string): Error => Object.assign(new Error(`${what} in the home is a link: the identity's files are never written through one`), { code: "ELINK" });

/** Write a file of the identity folder whole: the folder made 0700 (and set so again), a fresh temporary file ("wx", 0600), flushed,
 * renamed over the old one. A link at identity/ or at the file is refused (thrown, code ELINK): nothing is written through one */
export function writeIdentityFile(home: string, name: string, text: string): void {
  const dir = identityDir(home);
  const d = lstatOf(dir);
  if (d?.isSymbolicLink()) throw linkRefused("identity/");
  if (d && !d.isDirectory()) throw Object.assign(new Error("identity/ in the home is not a folder"), { code: "ENOTDIR" });
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const file = join(dir, name);
  if (lstatOf(file)?.isSymbolicLink()) throw linkRefused(`identity/${name}`);
  const tmp = join(dir, `.${name}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    const fd = openSync(tmp, "wx", 0o600);
    try {
      writeSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    chmodSync(tmp, 0o600);
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

function readJson(path: string): unknown {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

const isNetwork = (v: unknown): v is Network => typeof v === "string" && (NETWORKS as readonly string[]).includes(v);
const str = (v: unknown): v is string => typeof v === "string";

function bindingOf(v: unknown): Binding | undefined {
  if (!v || typeof v !== "object") return undefined;
  const b = v as Record<string, unknown>;
  if (!isNetwork(b.network)) return undefined;
  for (const k of ["speaksAs", "botId", "talksOnlyWith", "operatorId", "since", "fingerprint"]) if (!str(b[k])) return undefined;
  return { network: b.network, speaksAs: b.speaksAs as string, botId: b.botId as string, talksOnlyWith: b.talksOnlyWith as string, operatorId: b.operatorId as string, since: b.since as string, fingerprint: b.fingerprint as string };
}

/** Read the identity state. A fresh home, or a file that cannot be read, reads as the default; a field that is not well formed reads as
 * its default, the rest kept. */
export function loadIdentity(home: string): IdentityState {
  const raw = readJson(statePath(home));
  const out = freshDefault();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const r = raw as Record<string, unknown>;
  if (Array.isArray(r.bindings)) out.bindings = r.bindings.map(bindingOf).filter((b): b is Binding => b !== undefined);
  if (r.routing && typeof r.routing === "object") {
    const routing = r.routing as Record<string, unknown>;
    for (const row of ROUTE_ROWS) {
      const nets = routing[row];
      if (Array.isArray(nets)) out.routing[row] = [...new Set(nets.filter(isNetwork))].sort();
    }
  }
  if (r.quiet === null) out.quiet = null;
  else if (r.quiet && typeof r.quiet === "object") {
    const q = r.quiet as Record<string, unknown>;
    if (str(q.from) && str(q.to) && isClock(q.from) && isClock(q.to) && q.from !== q.to) out.quiet = { from: q.from, to: q.to };
  }
  if (Array.isArray(r.blocked)) out.blocked = [...new Set(r.blocked.filter(str))].slice(-BLOCKED_MAX);
  return out;
}

/** Write the identity state whole */
export function saveIdentity(home: string, s: IdentityState): void {
  writeIdentityFile(home, "state.json", `${JSON.stringify(s, null, 1)}\n`);
}

// ---- the strangers ----------------------------------------------------------------------------------------------------------------

export interface Stranger {
  network: Network;
  /** the first 12 hex of sha256("<network>:<id>") */
  sender: string;
  /** "…" and the id's last three characters (digits on Telegram, digits and capitals on Slack) */
  masked: string;
  count: number;
  /** when last heard from, ISO */
  last: string;
}

export const STRANGERS_MAX = 50;

export const senderRef = (network: Network, id: string): string => createHash("sha256").update(`${network}:${id}`).digest("hex").slice(0, 12);
export const maskId = (id: string): string => `…${id.slice(-3)}`;
/** a masked id as Not you shows it and blockSender signs it: "…" and up to three of the id's last characters — digits for Telegram,
 * digits and capitals for Slack's user ids */
export const MASKED = /^…[0-9A-Z]{1,3}$/;

function strangerOf(v: unknown): Stranger | undefined {
  if (!v || typeof v !== "object") return undefined;
  const s = v as Record<string, unknown>;
  if (!isNetwork(s.network) || !str(s.sender) || !/^[0-9a-f]{12}$/.test(s.sender) || !str(s.masked) || !str(s.last)) return undefined;
  if (typeof s.count !== "number" || !Number.isFinite(s.count) || s.count < 1) return undefined;
  return { network: s.network, sender: s.sender, masked: s.masked, count: Math.floor(s.count), last: s.last };
}

/** Whoever wrote to a bot and is not its operator, kept as a count and a time, persisted at every note */
export class Strangers {
  private rows: Stranger[];

  constructor(private readonly home: string) {
    const raw = readJson(strangersPath(home));
    this.rows = Array.isArray(raw) ? raw.map(strangerOf).filter((s): s is Stranger => s !== undefined) : [];
  }

  /** the reference a sender is kept under */
  refOf(network: Network, id: string): string {
    return senderRef(network, id);
  }

  /** a stranger wrote at `at` (ms): counted, the last time moved, the file written; past 50, the one heard from longest ago leaves */
  note(network: Network, id: string, at: number): void {
    const sender = senderRef(network, id);
    const last = new Date(at).toISOString();
    const row = this.rows.find((s) => s.sender === sender);
    if (row) {
      row.count += 1;
      row.last = last;
    } else this.rows.push({ network, sender, masked: maskId(id), count: 1, last });
    if (this.rows.length > STRANGERS_MAX) {
      this.rows.sort((a, b) => Date.parse(a.last) - Date.parse(b.last));
      this.rows.splice(0, this.rows.length - STRANGERS_MAX);
    }
    this.save();
  }

  /** the strangers, the one heard from last first */
  list(): Stranger[] {
    return [...this.rows].sort((a, b) => Date.parse(b.last) - Date.parse(a.last)).map((s) => ({ ...s }));
  }

  /** forget a stranger by reference */
  remove(sender: string): void {
    const before = this.rows.length;
    this.rows = this.rows.filter((s) => s.sender !== sender);
    if (this.rows.length !== before) this.save();
  }

  private save(): void {
    writeIdentityFile(this.home, "strangers.json", `${JSON.stringify(this.rows, null, 1)}\n`);
  }
}
