// face/src/abilities.ts
/** Abilities: what a plugin under `face/plugins/<folder>/` says Gravit can do with it, in a
 * declaration of its own, `ability.json` (spec 2026-11-13 Abilities on Discover, §4.1–§4.2).
 *
 * A declaration is one UTF-8 JSON object of at most {@link ABILITY_MAX_BYTES} bytes. Its text
 * is for a person browsing Discover: Gravit never reads the file, and nothing here changes a
 * prompt, a preset, a tool or a role. {@link validateAbility} checks one parsed object field by
 * field, in the order of {@link AbilityFile}, and keeps only the fields it names: a Gravit-Field
 * manifest's `kind`, `url`, `homepage`, `by`, `needs` and `writes` pass unread. Every string is
 * trimmed, its length counted in code points, and refused when it holds a control character
 * (C0, U+007F, C1) - but a line break (`\n`) inside `about`, which separates its paragraphs.
 * A key a declaration may leave out is left out when it is absent or `null`.
 *
 * {@link readAbilities} reads every `<folder>/ability.json` directly under a root, folders in
 * name order, once, synchronously, as `readRoles` (src/roles.ts) reads the role library. A file that is
 * over the size (checked before it is parsed), starts with a byte-order mark, is not UTF-8 or
 * not JSON, breaks a rule, or repeats an id an earlier file took is left out and returned as a
 * refusal that names the file, the field and the rule; the reader itself writes nothing and
 * throws for no declaration, so a bad file never stops a boot.
 *
 * {@link abilityListing} answers `GET /data/abilities.json` (§4.3, {@link registerAbilityRoutes}):
 * each declaration kept at boot, in the order read, with its {@link abilityState} and each
 * declared row, tool, role and skill beside whether the booted tree has it. A row is read from
 * its loader entry, a tool by its name alone: nothing of a row's options and no tool's
 * description is served.
 * @module
 */
import { readdirSync, readFileSync, statSync, type Dirent } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fencedGet, isTrustedDataRequest } from "./http.ts";
import { FIBER_PHASE, type PanelDeps } from "./panels.ts";
import { ROLE_ID_RE, TOOL_NAME_MAX, TOOL_NAME_RE } from "./roles.ts";
import type { RouteRegistrar } from "./static.ts";

/** The face's own plugin directory - where the face reads the declarations from.
 *  Module-relative, as `ROLES_ROOT` is. */
export const PLUGINS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "plugins");
/** The declaration's file name, in a plugin's own folder. */
export const ABILITY_FILE = "ability.json";
/** The largest declaration, in bytes. */
export const ABILITY_MAX_BYTES = 8192;

/** An ability's id: a lowercase letter, then 1 to 40 lowercase letters, digits or `-`. */
const ID_RE = /^[a-z][a-z0-9-]{1,40}$/;
/** A row id as the face composes it (`analog-views`). */
const ROW_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** A skill's name: kebab-case (`analog-guide`). */
const SKILL_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** C0, U+007F and C1. */
const CONTROL_RE = /[\u0000-\u001F\u007F-\u009F]/;
/** {@link CONTROL_RE} but the line break `about` separates its paragraphs with. */
const CONTROL_BUT_NEWLINE_RE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/;
/** UTF-8's byte-order mark. */
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/* The bounds of spec §4.1: a text's in code points, a list's in entries. */
const NAME_MAX = 40;
const BLURB_MAX = 90;
const ABOUT_MAX = 600;
const ASKS_MAX = 4;
const ASK_MAX = 120;
const LIMITS_MAX = 4;
const LIMIT_MAX = 160;
const TOOLS_MAX = 16;
const ROWS_MAX = 16;
const ROLES_MAX = 8;
const SKILLS_MAX = 8;

/** The fields the `zh` overlay may give, each under its top-level rule. `asks` and `limits`
 *  replace their lists whole; a field the overlay lacks reads from the top level. */
export interface AbilityText { name?: string; blurb?: string; about?: string; asks?: string[]; limits?: string[] }

/** One declaration, as kept: the named fields alone, trimmed, with the defaults filled in. */
export interface AbilityFile {
  /** Unique among the declarations read. */
  id: string;
  name: string;
  /** The card's line: no trailing `.` or `。`. */
  blurb: string;
  /** A name in `face/client/js/icons.js`, or `null` when the file gives none; the client draws
   *  `bolt` for none and for a name it lacks. */
  icon: string | null;
  /** What it does and how it runs; `\n` separates paragraphs. */
  about: string;
  /** Questions a person could put to Gravit. */
  asks: string[];
  /** What it does not tell you. */
  limits: string[];
  /** The tools its rows register, by name. */
  tools: string[];
  /** Its row ids, as the face composes them. */
  rows: string[];
  /** The role ids it uses. */
  roles: string[];
  /** The skills that teach Gravit to use it. */
  skills: string[];
  /** The Chinese overlay, or `null` when the file has none. */
  zh: AbilityText | null;
}

/** Why a declaration is left out: the first broken field (`manifest` for the file as a whole,
 *  `zh.<field>` for an overlay field) and its rule in words. */
export interface AbilityRefusal { field: string; rule: string }

/** A broken rule, thrown inside {@link validateAbility} and returned from it as its refusal. */
class Refused extends Error {
  constructor(readonly field: string, readonly rule: string) {
    super(`${field}: ${rule}`);
  }
}

/** Whether a key a declaration may leave out is given: neither absent nor `null`. */
const given = (value: unknown): boolean => value !== undefined && value !== null;

const lengthOf = (text: string): number => [...text].length;

/** A text field's value, trimmed, `label` opening its rules (a list entry's number). */
function text(value: unknown, field: string, max: number, options: { label?: string; paragraphs?: boolean } = {}): string {
  const label = options.label ?? "";
  if (typeof value !== "string") throw new Refused(field, `${label}${value === undefined ? "is missing" : "must be a string"}`);
  const kept = value.trim();
  if ((options.paragraphs === true ? CONTROL_BUT_NEWLINE_RE : CONTROL_RE).test(kept)) {
    throw new Refused(field, `${label}holds a control character${options.paragraphs === true ? "; only a line break (\\n) is allowed" : ""}`);
  }
  const length = lengthOf(kept);
  if (length < 1 || length > max) throw new Refused(field, `${label}must be 1 to ${max} characters (it has ${length})`);
  return kept;
}

/** A name of a grammar (an id, a tool, a row, a role, a skill), trimmed. */
function word(value: unknown, field: string, fits: (kept: string) => boolean, rule: string, label = ""): string {
  if (typeof value !== "string") throw new Refused(field, `${label}${value === undefined ? "is missing" : "must be a string"}`);
  const kept = value.trim();
  if (!fits(kept)) throw new Refused(field, `${label}${rule}`);
  return kept;
}

/** A list of `min` to `max` entries, each kept by `entry`; `unique` refuses an entry listed twice. */
function list(value: unknown, field: string, min: number, max: number, unique: boolean,
  entry: (item: unknown, label: string) => string): string[] {
  if (!Array.isArray(value)) throw new Refused(field, `must be a list of ${min} to ${max} entries`);
  if (value.length < min || value.length > max) throw new Refused(field, `must hold ${min} to ${max} entries (it holds ${value.length})`);
  const seen = new Set<string>();
  return value.map((item: unknown, index: number) => {
    const kept = entry(item, `entry ${index + 1} `);
    if (unique && seen.has(kept)) throw new Refused(field, `lists ${JSON.stringify(kept)} twice`);
    seen.add(kept);
    return kept;
  });
}

const nameOf = (value: unknown, field: string): string => text(value, field, NAME_MAX);

function blurbOf(value: unknown, field: string): string {
  const blurb = text(value, field, BLURB_MAX);
  if (/[.。]$/u.test(blurb)) throw new Refused(field, "must not end with a period (. or 。): it is the card's line");
  return blurb;
}

const aboutOf = (value: unknown, field: string): string => text(value, field, ABOUT_MAX, { paragraphs: true });

const asksOf = (value: unknown, field: string): string[] =>
  list(value, field, 0, ASKS_MAX, false, (item, label) => text(item, field, ASK_MAX, { label }));

const limitsOf = (value: unknown, field: string): string[] =>
  list(value, field, 0, LIMITS_MAX, false, (item, label) => text(item, field, LIMIT_MAX, { label }));

function iconOf(value: unknown): string | null {
  if (!given(value)) return null;
  if (typeof value !== "string") throw new Refused("icon", "must be a string: an icon's name, or left out");
  const icon = value.trim();
  if (icon === "") throw new Refused("icon", "must name an icon, or be left out");
  if (CONTROL_RE.test(icon)) throw new Refused("icon", "holds a control character");
  return icon;
}

const toolsOf = (value: unknown): string[] =>
  list(value, "tools", 1, TOOLS_MAX, true, (item, label) => word(item, "tools",
    (kept) => TOOL_NAME_RE.test(kept) && kept.length <= TOOL_NAME_MAX,
    `must be a tool name: letters, digits, _ and - only, at most ${TOOL_NAME_MAX} characters`, label));

const rowsOf = (value: unknown): string[] =>
  list(value, "rows", 1, ROWS_MAX, true, (item, label) => word(item, "rows", (kept) => ROW_ID_RE.test(kept),
    "must be a row id: a lowercase letter or digit, then lowercase letters, digits or -, at most 64 characters", label));

const rolesOf = (value: unknown): string[] =>
  list(value, "roles", 0, ROLES_MAX, true, (item, label) => word(item, "roles", (kept) => ROLE_ID_RE.test(kept),
    "must be a role id: a lowercase letter or digit, then lowercase letters, digits or -, at most 64 characters", label));

const skillsOf = (value: unknown): string[] =>
  list(value, "skills", 0, SKILLS_MAX, true, (item, label) => word(item, "skills", (kept) => SKILL_RE.test(kept),
    "must be a skill name in kebab-case, e.g. analog-guide", label));

/** The `zh` overlay: only the fields it gives, each under its top-level rule. */
function overlayOf(value: unknown): AbilityText | null {
  if (!given(value)) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Refused("zh", "must be an object holding any of name, blurb, about, asks and limits");
  }
  const zh = value as Record<string, unknown>;
  const overlay: AbilityText = {};
  if (given(zh.name)) overlay.name = nameOf(zh.name, "zh.name");
  if (given(zh.blurb)) overlay.blurb = blurbOf(zh.blurb, "zh.blurb");
  if (given(zh.about)) overlay.about = aboutOf(zh.about, "zh.about");
  if (given(zh.asks)) overlay.asks = asksOf(zh.asks, "zh.asks");
  if (given(zh.limits)) overlay.limits = limitsOf(zh.limits, "zh.limits");
  return overlay;
}

/** Check one parsed declaration against the rules of spec §4.1. Pure. Kept, it is the named
 *  fields alone, trimmed, with `icon` and `zh` `null` and the optional lists empty when not
 *  given; refused, it is the first broken field in the order of {@link AbilityFile} and its
 *  rule in words. Whether the id is unique is {@link readAbilities}'s check. */
export function validateAbility(input: unknown): { ok: true; ability: AbilityFile } | { ok: false; error: AbilityRefusal } {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Refused("manifest", "must be a JSON object");
    const fields = input as Record<string, unknown>;
    /* Built in the field order of AbilityFile, so the first broken field is the one reported. */
    const ability: AbilityFile = {
      id: word(fields.id, "id", (kept) => ID_RE.test(kept),
        "must be a lowercase letter, then 1 to 40 lowercase letters, digits or -"),
      name: nameOf(fields.name, "name"),
      blurb: blurbOf(fields.blurb, "blurb"),
      icon: iconOf(fields.icon),
      about: aboutOf(fields.about, "about"),
      asks: given(fields.asks) ? asksOf(fields.asks, "asks") : [],
      limits: given(fields.limits) ? limitsOf(fields.limits, "limits") : [],
      tools: toolsOf(fields.tools),
      rows: rowsOf(fields.rows),
      roles: given(fields.roles) ? rolesOf(fields.roles) : [],
      skills: given(fields.skills) ? skillsOf(fields.skills) : [],
      zh: overlayOf(fields.zh),
    };
    return { ok: true, ability };
  } catch (error) {
    if (error instanceof Refused) return { ok: false, error: { field: error.field, rule: error.rule } };
    throw error;
  }
}

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** The parsed contents of one declaration file; `undefined` when there is no such file. */
function readDeclaration(path: string): { ok: true; value: unknown } | { ok: false; error: AbilityRefusal } | undefined {
  const manifest = (rule: string) => ({ ok: false as const, error: { field: "manifest", rule } });
  try {
    const stat = statSync(path);
    if (!stat.isFile()) return manifest("is not a file");
    if (stat.size > ABILITY_MAX_BYTES) return manifest(`is ${stat.size} bytes; the limit is ${ABILITY_MAX_BYTES}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    return manifest(`cannot be read: ${messageOf(error)}`);
  }
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    return manifest(`cannot be read: ${messageOf(error)}`);
  }
  /* Again on the bytes read, for a file that grew after its size was read. */
  if (bytes.length > ABILITY_MAX_BYTES) return manifest(`is ${bytes.length} bytes; the limit is ${ABILITY_MAX_BYTES}`);
  if (bytes.subarray(0, BOM.length).equals(BOM)) return manifest("starts with a byte-order mark; save it as UTF-8 without one");
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return manifest("is not UTF-8");
  }
  try {
    return { ok: true, value: JSON.parse(source) };
  } catch (error) {
    return manifest(`is not JSON: ${messageOf(error)}`);
  }
}

/** Read every `<folder>/ability.json` directly under `root`, folders in name order (by code
 *  unit, the same on every filesystem); a plain file, a symbolic link and a folder without the
 *  file are passed over. Synchronous. Each file is kept when {@link validateAbility} keeps it and
 *  its id is not taken by an earlier one; otherwise it is refused, `file` being
 *  `<folder>/ability.json` relative to `root`. A root that does not exist reads nothing; one that
 *  cannot be listed otherwise throws. */
export function readAbilities(root: string): { abilities: AbilityFile[]; refused: ({ file: string } & AbilityRefusal)[] } {
  const base = resolve(root);
  let entries: Dirent[];
  try {
    entries = readdirSync(base, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { abilities: [], refused: [] };
    throw error;
  }
  const abilities: AbilityFile[] = [];
  const refused: ({ file: string } & AbilityRefusal)[] = [];
  /** Each id kept, and the file that took it. */
  const taken = new Map<string, string>();
  for (const entry of [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (!entry.isDirectory()) continue;
    const file = `${entry.name}/${ABILITY_FILE}`;
    const read = readDeclaration(join(base, entry.name, ABILITY_FILE));
    if (read === undefined) continue;
    if (!read.ok) {
      refused.push({ file, ...read.error });
      continue;
    }
    const result = validateAbility(read.value);
    if (!result.ok) {
      refused.push({ file, ...result.error });
      continue;
    }
    const first = taken.get(result.ability.id);
    if (first !== undefined) {
      refused.push({ file, field: "id", rule: `repeats the id ${result.ability.id}, which ${first} took first` });
      continue;
    }
    taken.set(result.ability.id, file);
    abilities.push(result.ability);
  }
  return { abilities, refused };
}

/* ---------- the listing: GET /data/abilities.json (spec §4.3) ---------- */

/** An ability's state: its own rows' and tools', by {@link abilityState}. It says nothing of
 *  the desk or of Gravit's conversation. */
export type AbilityState = "on" | "off" | "starting" | "failed";

/** One ability as the listing serves it, built field by field from its declaration and the
 *  booted tree: no undeclared key, no path, nothing of a row's options, no tool's description. */
export interface AbilityRow {
  id: string; name: string; blurb: string; icon: string | null; about: string; asks: string[]; limits: string[];
  /** The declaration's `zh` as read, or `null`. */
  zh: AbilityText | null;
  state: AbilityState;
  /** Each declared row: its loader entry's enabled flag and fiber phase ({@link FIBER_PHASE}),
   *  or `{ enabled: false, phase: null }` when no entry has its id. */
  rows: { id: string; enabled: boolean; phase: string | null }[];
  /** Each declared tool, registered when the tool view names it. */
  tools: { name: string; registered: boolean }[];
  /** Each declared role, present when the face read it at boot. */
  roles: { id: string; present: boolean }[];
  /** Each declared skill, present when the skill registry lists it. */
  skills: { name: string; present: boolean }[];
}

/** What {@link abilityListing} reads: the panels' tree reads (src/panels.ts `PanelDeps`), the
 *  declarations and the role ids, both read once at boot. */
export interface AbilityDeps extends Pick<PanelDeps, "loaderEntries" | "toolSchemas" | "skills" | "cwd"> {
  /** The declarations {@link readAbilities} kept, in the order read. */
  abilities: readonly AbilityFile[];
  /** The ids of the roles `readRoles` (src/roles.ts) read at boot. */
  roleIds: ReadonlySet<string>;
  /** Where a failed skill registry is written, one line per listing that met it; stderr when
   *  not given. {@link registerAbilityRoutes} writes a line again only when it changes. */
  log?: (line: string) => void;
}

/** The face's stderr, the default {@link AbilityDeps.log}. */
const writeStderr = (line: string): void => {
  console.error(line);
};

/** An ability's state, by the first rule that holds (spec §4.3): `off` when a declared row is
 *  disabled or has no phase (no entry, no fiber, a disposed one); `failed` when a row's phase is
 *  `failed`, or every row is `active` and a declared tool is not registered; `on` when every row
 *  is `active` and every tool registered; `starting` otherwise. Roles and skills do not count. Pure. */
export function abilityState(rows: AbilityRow["rows"], tools: AbilityRow["tools"]): AbilityState {
  if (rows.some((row) => !row.enabled || row.phase === null)) return "off";
  if (rows.some((row) => row.phase === "failed")) return "failed";
  if (!rows.every((row) => row.phase === "active")) return "starting";
  return tools.every((tool) => tool.registered) ? "on" : "failed";
}

/** A declared row as its loader entry has it: the entry whose id ends with `:<id>` (the face's
 *  rows read `include:<id>`, as `lunhuiMounted` reads `include:lunhui-runs`), the first one. */
function rowOf(entries: readonly { id: string; disabled?: boolean; fiber?: { state: number } }[], id: string): AbilityRow["rows"][number] {
  const entry = entries.find((candidate) => candidate.id.endsWith(`:${id}`));
  if (entry === undefined) return { id, enabled: false, phase: null };
  return {
    id,
    enabled: entry.disabled !== true,
    phase: entry.fiber === undefined ? null : FIBER_PHASE[entry.fiber.state] ?? null,
  };
}

/** The skill registry's names. A registry that fails, by rejecting or by throwing, lists none, so
 *  every declared skill reads not present and the listing still answers; the failure is one
 *  `gravit-face: abilities - skill registry failed: <message>` line through `deps.log`, the
 *  message's first line. */
async function skillNames(deps: Pick<AbilityDeps, "skills" | "cwd" | "log">): Promise<ReadonlySet<string>> {
  try {
    return new Set((await deps.skills.list({ cwd: deps.cwd })).map((skill) => skill.name));
  } catch (error) {
    (deps.log ?? writeStderr)(`gravit-face: abilities - skill registry failed: ${messageOf(error).split("\n")[0]}`);
    return new Set();
  }
}

/** The listing `GET /data/abilities.json` answers: every declaration in the order given, each an
 *  {@link AbilityRow}. The loader entries, the tool names and the skill names are read once per
 *  call; a tool's schema gives its name alone. No declarations is `{ abilities: [] }`. */
export async function abilityListing(deps: AbilityDeps): Promise<{ abilities: AbilityRow[] }> {
  const entries = [...deps.loaderEntries()];
  const registered = new Set(deps.toolSchemas().map((schema) => schema.name));
  const skills = await skillNames(deps);
  return {
    abilities: deps.abilities.map((ability): AbilityRow => {
      const rows = ability.rows.map((id) => rowOf(entries, id));
      const tools = ability.tools.map((name) => ({ name, registered: registered.has(name) }));
      return {
        id: ability.id,
        name: ability.name,
        blurb: ability.blurb,
        icon: ability.icon,
        about: ability.about,
        asks: ability.asks,
        limits: ability.limits,
        zh: ability.zh,
        state: abilityState(rows, tools),
        rows,
        tools,
        roles: ability.roles.map((id) => ({ id, present: deps.roleIds.has(id) })),
        skills: ability.skills.map((name) => ({ name, present: skills.has(name) })),
      };
    }),
  };
}

/** Mount `GET /data/abilities.json`, one exact route: `{ ok: true, abilities }` through http.ts's
 *  `fencedGet` - the GET shell the panel routes use - behind the `/data` fence
 *  (`isTrustedDataRequest`), a refused request answered `403` with the fixed `FORBIDDEN` body.
 *  Discover reads the listing on every visit, so a failed skill registry's line is written
 *  through `deps.log` only when it differs from the last listing's: the same failure again is
 *  not repeated, another message is, and so is a failure after a listing that read the registry.
 * @param webServer - the host webserver service, or a test recorder.
 * @param deps - the tree reads, the declarations, the role ids and the log. */
export function registerAbilityRoutes(webServer: RouteRegistrar, deps: AbilityDeps): void {
  const write = deps.log ?? writeStderr;
  /** The failure line the last listing met; `undefined` after one that read the registry. */
  let last: string | undefined;
  webServer.register({
    kind: "exact",
    path: "/data/abilities.json",
    handler: fencedGet(isTrustedDataRequest, async () => {
      const failures: string[] = [];
      const listing = await abilityListing({ ...deps, log: (line) => { failures.push(line); } });
      const failure = failures[0];
      if (failure !== undefined && failure !== last) write(failure);
      last = failure;
      return listing;
    }),
  });
}
