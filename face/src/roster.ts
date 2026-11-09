/** `$DSH_HOME/face/channels.json`: the one roster - which CLI agents and which
 * bots are available to Gravit, for the whole face (one-entry plan 4).
 *
 * On disk `{version: 2, agents, bots}`. A version-1 file (the per-channel
 * rosters, `{version: 1, channels: {<wsId>: {agents, bots}}}`) is turned into
 * the union of its channels once, at boot ({@link ensureRoster}), its old text
 * kept beside it as {@link ROSTER_V1_BACKUP}. The file keeps its old name so
 * an operator who repaired it by hand finds it where it always was.
 *
 * It fails CLOSED: a file the face does not understand (unparseable text, a
 * non-object, a version other than 1 or 2, a v1 file whose `channels` is not
 * an object) reads as corrupt, is never written over, and refuses every agent
 * call and every bot until the operator repairs it by hand.
 *
 * Every write is a read-modify-write inside one cross-process lock, queued in
 * this process first so two switches flipped at once land in the order they
 * were issued (the lock alone polls, so it does not keep order).
 *
 * What this is NOT: containment. dsh registers agent tools tree-wide with no
 * per-session scope, and Gravit has an unrestricted shell and unrestricted
 * network. The roster is a menu that states intent; see spec §5.
 * @module
 */
import { access, appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { withFileLock, writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";
import { isBotId } from "./bots.ts";
import { HttpError } from "./http.ts";

/** Diagnostic label, the same string every other `${BIN}:`-prefixed line in
 * this program uses (main.ts's own copy, `main.ts:26`, carries the same
 * rationale: not imported, because it is a label rather than a contract). */
const BIN = "gravit-face";

const ROSTER_FILE = ["face", "channels.json"] as const;

/** Durable, append-only record of every operator roster write - I2: the
 * README and spec §5 promise "a dated line to a face log" as the roster
 * write's ONLY Rule-5 answer (it openly cannot be PREVENTED - honest limit
 * 4), so the record needs to actually be one: dated, on disk, under the
 * operator-owned `$DSH_HOME/face/` side, not a bare undated stdout line. */
const ROSTER_LOG_FILE = ["face", "roster.log"] as const;

/** The v1 file's text, kept beside the roster when {@link ensureRoster} turns it into v2. */
export const ROSTER_V1_BACKUP = "channels.v1.json";

/** What is available to Gravit, for the whole face. */
export interface Roster {
  agents: string[];
  bots: string[];
}

const pathOf = (home: string): string => join(home, ...ROSTER_FILE);

/** The refusal every write over a file the face does not understand gives - it names the file. */
const corruptMessage = (home: string): string =>
  `${pathOf(home)} cannot be read as a roster - repair or remove it by hand, then switch again`;

/** Strings only, non-empty, first occurrence kept. */
function agentList(value: unknown): string[] {
  const out: string[] = [];
  if (!Array.isArray(value)) return out;
  for (const bin of value) {
    if (typeof bin !== "string" || bin === "" || out.includes(bin)) continue;
    out.push(bin);
  }
  return out;
}

/** Bot ids only ({@link isBotId}), first occurrence kept. */
function botList(value: unknown): string[] {
  const out: string[] = [];
  if (!Array.isArray(value)) return out;
  for (const id of value) {
    if (!isBotId(id) || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** One reading of the file's text. `v1` carries the union of a version-1 file's channels. */
type Parsed =
  | { kind: "v2"; roster: Roster }
  | { kind: "v1"; roster: Roster }
  | { kind: "corrupt" };

function parse(text: string): Parsed {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { kind: "corrupt" };
  }
  if (!isPlainObject(doc)) return { kind: "corrupt" };
  if (doc.version === 2) return { kind: "v2", roster: { agents: agentList(doc.agents), bots: botList(doc.bots) } };
  if (doc.version !== 1 || !isPlainObject(doc.channels)) return { kind: "corrupt" };
  const agents: string[] = [];
  const bots: string[] = [];
  for (const row of Object.values(doc.channels)) {
    if (!isPlainObject(row)) continue;
    for (const bin of agentList(row.agents)) if (!agents.includes(bin)) agents.push(bin);
    for (const id of botList(row.bots)) if (!bots.includes(id)) bots.push(id);
  }
  return { kind: "v1", roster: { agents, bots } };
}

/** The file's text, or `undefined` when it is absent. Any other read error throws. */
async function readText(home: string): Promise<string | undefined> {
  try {
    return await readFile(pathOf(home), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

/** The in-process queue in front of the lock, per roster file: `withFileLock`
 * retries on a timer, so two waiters can take it in either order; chaining
 * here first keeps this process's writes in the order they were issued. */
const queues = new Map<string, Promise<unknown>>();

async function serialized<T>(home: string, operation: () => Promise<T>): Promise<T> {
  const file = pathOf(home);
  const previous = queues.get(file) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(async () => {
    // withFileLock creates the lock beside `file`; the parent directory must
    // already exist for that `wx` create to succeed on a fresh $DSH_HOME.
    await mkdir(join(home, ROSTER_FILE[0]), { recursive: true });
    return await withFileLock(file, operation);
  });
  queues.set(file, run);
  try {
    return await run;
  } finally {
    if (queues.get(file) === run) queues.delete(file);
  }
}

const writeRoster = (home: string, roster: Roster): Promise<void> =>
  writeFileAtomic(pathOf(home), `${JSON.stringify({ version: 2, agents: roster.agents, bots: roster.bots }, null, 2)}\n`, { mode: 0o600 });

/**
 * The roster as it is on disk: `null` and not corrupt when the file is absent; `null` and corrupt
 * for unparseable text, a non-object, or a `version` other than 2 (a v1 file too, until
 * {@link ensureRoster} has turned it). Junk entries drop: agents keep non-empty strings, bots keep
 * {@link isBotId} ids, each first occurrence once.
 * @param home - the harness home holding `face/`.
 */
export async function readRoster(home: string): Promise<{ roster: Roster | null; corrupt: boolean }> {
  let text: string | undefined;
  try {
    text = await readText(home);
  } catch {
    return { roster: null, corrupt: true };
  }
  if (text === undefined) return { roster: null, corrupt: false };
  const parsed = parse(text);
  return parsed.kind === "v2" ? { roster: parsed.roster, corrupt: false } : { roster: null, corrupt: true };
}

/**
 * Make sure the roster exists, once at boot. An absent file is seeded with `connectedBins` and no
 * bots (`migrated: "seeded"`); a v1 file becomes the union of its channels, agents and bots each in
 * first-seen order, after its text is kept in {@link ROSTER_V1_BACKUP} (`migrated: "v1"`; a backup
 * already there is never overwritten); a v2 file is left as it is. Anything else is corrupt and left
 * byte for byte - never seeded over.
 * @param home - the harness home holding `face/`.
 * @param connectedBins - the connected CLI agents with a recipe, the seed for an absent file.
 */
export async function ensureRoster(
  home: string,
  connectedBins: readonly string[],
): Promise<{ roster: Roster | null; corrupt: boolean; migrated?: "v1" | "seeded" }> {
  return await serialized(home, async () => {
    const text = await readText(home);
    if (text === undefined) {
      const roster: Roster = { agents: agentList([...connectedBins]), bots: [] };
      await writeRoster(home, roster);
      return { roster, corrupt: false, migrated: "seeded" as const };
    }
    const parsed = parse(text);
    if (parsed.kind === "corrupt") return { roster: null, corrupt: true };
    if (parsed.kind === "v2") return { roster: parsed.roster, corrupt: false };
    const backup = join(home, ROSTER_FILE[0], ROSTER_V1_BACKUP);
    const kept = await access(backup).then(() => true, () => false);
    if (!kept) await writeFileAtomic(backup, text, { mode: 0o600 });
    await writeRoster(home, parsed.roster);
    return { roster: parsed.roster, corrupt: false, migrated: "v1" as const };
  });
}

/**
 * The operator's switch: `id` is available to Gravit (`on`) or not. An added id goes last, a
 * removed one leaves the others in their order. Refuses a bot id outside {@link isBotId} or an empty
 * agent id (400) before the file is touched, and a corrupt or absent file (409, naming it) rather
 * than writing over it - {@link ensureRoster} at boot is the only writer that creates the file.
 * @returns the roster as written.
 */
export async function setAvailable(home: string, kind: "agent" | "bot", id: string, on: boolean): Promise<Roster> {
  if (kind === "bot" && !isBotId(id)) throw new HttpError(400, `not a bot id: ${id}`);
  if (kind === "agent" && (typeof id !== "string" || id === "")) throw new HttpError(400, "not an agent id");
  return await serialized(home, async () => {
    const text = await readText(home);
    const parsed = text === undefined ? undefined : parse(text);
    if (parsed === undefined || parsed.kind !== "v2") throw new HttpError(409, corruptMessage(home));
    const key = kind === "agent" ? "agents" : "bots";
    const current = parsed.roster[key];
    const list = on ? (current.includes(id) ? current : [...current, id]) : current.filter((entry) => entry !== id);
    const next: Roster = { ...parsed.roster, [key]: list };
    await writeRoster(home, next);
    return next;
  });
}

/**
 * Record one switch: a stdout line plus one dated line `available <kind> <id> = on|off` appended
 * to `$DSH_HOME/face/roster.log`. A record, not a gate: a failure to append is reported on stderr
 * and swallowed, never thrown. Call after {@link setAvailable} resolves.
 */
export async function logAvailable(home: string, kind: "agent" | "bot", id: string, on: boolean): Promise<void> {
  const line = `${new Date().toISOString()} available ${kind} ${id} = ${on ? "on" : "off"}`;
  console.log(`${BIN}: ${line}`);
  try {
    await mkdir(join(home, ROSTER_LOG_FILE[0]), { recursive: true });
    await appendFile(join(home, ...ROSTER_LOG_FILE), `${line}\n`, { encoding: "utf8", mode: 0o600 });
  } catch (err) {
    console.error(`${BIN}: failed to append to ${join(home, ...ROSTER_LOG_FILE)} - the switch itself still stands:`, err);
  }
}

/* ---- The per-channel rosters, retired by one-entry plan 4. They read a v1
 * file as before; over a v2 file they read what they read for any shape
 * without `channels` - corrupt. ---- */

/** The v1 on-disk shape.
 * @deprecated plan 4 Task 4 removes this */
export interface RosterFile {
  version: 1;
  channels: Record<string, { agents: string[]; bots: string[] }>;
}

/** Parse defensively: unknown shapes read as empty, junk entries drop, and
 * an unparseable file is reported so callers can fail closed.
 * @deprecated plan 4 Task 4 removes this */
export async function readRosters(home: string): Promise<{ rosters: RosterFile["channels"]; corrupt: boolean }> {
  let text: string;
  try {
    text = await readFile(pathOf(home), "utf8");
  } catch {
    return { rosters: {}, corrupt: false }; // absent is not corrupt
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { rosters: {}, corrupt: true };
  }
  if (parsed === null || typeof parsed !== "object") return { rosters: {}, corrupt: true };
  const { channels } = parsed as { channels?: unknown };
  if (channels === null || typeof channels !== "object") return { rosters: {}, corrupt: true };
  const rosters: RosterFile["channels"] = {};
  for (const [id, row] of Object.entries(channels as Record<string, unknown>)) {
    if (row === null || typeof row !== "object") continue;
    const { agents } = row as { agents?: unknown };
    if (!Array.isArray(agents)) continue;
    const bins: string[] = [];
    for (const bin of agents) {
      if (typeof bin !== "string" || bin === "" || bins.includes(bin)) continue;
      bins.push(bin);
    }
    const { bots } = row as { bots?: unknown };
    const ids: string[] = [];
    if (Array.isArray(bots)) {
      for (const id of bots) {
        if (typeof id !== "string" || !isBotId(id) || ids.includes(id)) continue;
        ids.push(id);
      }
    }
    rosters[id] = { agents: bins, bots: ids };
  }
  return { rosters, corrupt: false };
}

/** Read-modify-write inside one cross-process lock. `mutate` returns the new
 * channels map, or `null` to leave the file untouched.
 *
 * The read happens INSIDE `withFileLock`, not before it: this file is seeded
 * from the GET path, so a reconcile and an operator's toggle can start
 * within the same tick. If the read ran outside the lock, the second writer
 * would already hold a stale snapshot by the time it got the lock and would
 * commit right over the first writer's change — the exact silent-revert this
 * store exists to prevent. */
async function update(
  home: string,
  mutate: (current: { rosters: RosterFile["channels"]; corrupt: boolean }) => RosterFile["channels"] | null,
): Promise<void> {
  const file = pathOf(home);
  await serialized(home, async () => {
    const current = await readRosters(home);
    const next = mutate(current);
    if (next === null) return;
    const doc: RosterFile = { version: 1, channels: next };
    await writeFileAtomic(file, `${JSON.stringify(doc, null, 2)}\n`, { mode: 0o600 });
  });
}

/** Give a newly adopted channel its starting roster. A no-op when the channel
 * already has one, and a no-op when the file is corrupt — a background seed
 * must never clobber a file the operator can still repair by hand.
 * @deprecated plan 4 Task 4 removes this
 */
export async function seedRoster(home: string, workspaceId: string, bins: readonly string[]): Promise<void> {
  await update(home, ({ rosters, corrupt }) => {
    if (corrupt || Object.hasOwn(rosters, workspaceId)) return null;
    return { ...rosters, [workspaceId]: { agents: [...bins], bots: [] } };
  });
}

/** The operator's explicit write: this channel's roster is exactly `bins`.
 *
 * REFUSES over a corrupt file rather than replacing it (I1). `rosters` reads
 * as `{}` when the file is corrupt (unparseable, or a `channels` key that is
 * absent or not an object — what a future `version: 2` migration would look
 * like too), so spreading `...rosters` over that reading would silently
 * REPLACE the whole file with this one entry: one chip click on one channel
 * would wipe every other channel's curated roster, with nothing said. A
 * refusal that names the file is recoverable by hand; a wipe is not.
 * @deprecated plan 4 Task 4 removes this
 */
export async function setRoster(home: string, workspaceId: string, bins: readonly string[]): Promise<void> {
  await update(home, ({ rosters, corrupt }) => {
    if (corrupt) {
      throw new HttpError(
        409,
        `${pathOf(home)} is corrupt and cannot be safely merged into - repair or remove it by hand, then set the roster again`,
      );
    }
    return { ...rosters, [workspaceId]: { agents: [...new Set(bins)], bots: rosters[workspaceId]?.bots ?? [] } };
  });
}

/**
 * Record one operator roster write: a stdout line (the `${BIN}:` prefix
 * convention every other diagnostic in this program uses) plus a timestamped
 * line appended to `$DSH_HOME/face/roster.log` — the durable half spec §5
 * and the README promise. A record, not a gate: a write failure here (a full
 * disk, a permissions problem) is logged to stderr and swallowed, never
 * thrown — it must not turn an already-committed roster write into a failed
 * response. Call AFTER {@link setRoster} resolves, never before: this logs
 * what was written, not what was attempted.
 * @param home - the harness home holding `face/`.
 * @param workspaceId - the channel whose roster changed.
 * @param agents - the resulting roster, verbatim.
 * @deprecated plan 4 Task 4 removes this
 */
export async function logRosterWrite(home: string, workspaceId: string, agents: readonly string[]): Promise<void> {
  const line = `${new Date().toISOString()} roster ${workspaceId} = [${agents.join(", ")}]`;
  console.log(`${BIN}: ${line}`);
  try {
    await mkdir(join(home, ROSTER_LOG_FILE[0]), { recursive: true });
    /* 0o600 to match channels.json beside it - mode applies on creation only. */
    await appendFile(join(home, ...ROSTER_LOG_FILE), `${line}\n`, { encoding: "utf8", mode: 0o600 });
  } catch (err) {
    console.error(`${BIN}: failed to append to ${join(home, ...ROSTER_LOG_FILE)} - the roster write itself still stands:`, err);
  }
}

/** This channel's roster, or `null` when none is known — an unadopted
 * channel, or a corrupt file. `null` is the fail-closed reading.
 * @deprecated plan 4 Task 4 removes this
 */
export async function rosterFor(home: string, workspaceId: string): Promise<string[] | null> {
  const { rosters } = await readRosters(home);
  return Object.hasOwn(rosters, workspaceId) ? [...rosters[workspaceId].agents] : null;
}

/** The operator's explicit write of a channel's BOT roster: exactly `ids`,
 * deduplicated in order. Refuses a corrupt file for the reason `setRoster`
 * gives, and refuses any id outside the bot grammar before it can reach the
 * file - the ids become directory names under `bots/` when the engine mounts
 * them. Agents are left as they were. The cap on members (ROOM_CAPS) is the
 * route's to apply, not this store's: the store records what it is told.
 * @deprecated plan 4 Task 4 removes this
 */
export async function setBots(home: string, workspaceId: string, ids: readonly string[]): Promise<void> {
  const bad = ids.filter((id) => !isBotId(id));
  if (bad.length > 0) throw new HttpError(400, `not a bot id: ${bad.join(", ")}`);
  await update(home, ({ rosters, corrupt }) => {
    if (corrupt) {
      throw new HttpError(409, `${pathOf(home)} is corrupt and cannot be safely merged into - repair or remove it by hand, then set the roster again`);
    }
    return { ...rosters, [workspaceId]: { agents: rosters[workspaceId]?.agents ?? [], bots: [...new Set(ids)] } };
  });
}

/** This channel's bot roster, or `null` when the channel has no entry (or the file is corrupt).
 * @deprecated plan 4 Task 4 removes this
 */
export async function botsFor(home: string, workspaceId: string): Promise<string[] | null> {
  const { rosters } = await readRosters(home);
  return Object.hasOwn(rosters, workspaceId) ? [...rosters[workspaceId].bots] : null;
}

/** The bots twin of {@link logRosterWrite}: its own line kind, same file, same never-throws contract.
 * @deprecated plan 4 Task 4 removes this
 */
export async function logBotsWrite(home: string, workspaceId: string, bots: readonly string[]): Promise<void> {
  const line = `${new Date().toISOString()} bots ${workspaceId} = [${bots.join(", ")}]`;
  console.log(`${BIN}: ${line}`);
  try {
    await mkdir(join(home, ROSTER_LOG_FILE[0]), { recursive: true });
    await appendFile(join(home, ...ROSTER_LOG_FILE), `${line}\n`, { encoding: "utf8", mode: 0o600 });
  } catch (err) {
    console.error(`${BIN}: failed to append to ${join(home, ...ROSTER_LOG_FILE)} - the bots write itself still stands:`, err);
  }
}
