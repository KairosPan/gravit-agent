// face/tests/abilities-shipped.test.ts
/** The two shipped declarations (spec 2026-11-13 Abilities on Discover, §4.5, §6 "The shipped files"):
 * `face/plugins/analog/ability.json` and `face/plugins/readthrough/ability.json`, read from the real plugins root
 * in folder order and both kept. Each one's tools are the names its plugin registers and its rows the ids its
 * plugin composes (`ANALOG_*`, `READ_THROUGH_*`); its roles are under `roles/` and its skills under `dsh/skills/`;
 * its icon is one of the client's (`client/js/icons.js`); it carries a Chinese name, blurb and about; and no string
 * of the file, a key or a value, holds 做多. The event analog's about names its 20- and 60-session horizons in both
 * languages. Offline; reads the tree, writes nothing. */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ABILITY_FILE, PLUGINS_ROOT, readAbilities, type AbilityFile } from "../src/abilities.ts";
import { ANALOG_ROW_IDS, ANALOG_TOOL_NAMES } from "../src/analog.ts";
import { READ_THROUGH_ROW_IDS, READ_THROUGH_TOOL_NAMES } from "../src/readthrough.ts";
import { ROLES_ROOT } from "../src/roles.ts";
import { ICONS } from "../client/js/icons.js";

/** The skill packs' root: a skill is `<pack>/<name>/SKILL.md` under it. */
const SKILLS_ROOT = join(PLUGINS_ROOT, "..", "..", "dsh", "skills");

/** Each shipped ability's folder under `face/plugins/`, by id, in the order the reader keeps them. */
const FOLDERS = { "event-analogs": "analog", "read-through": "readthrough" } as const;

/** The word no shipped string may hold: a card names no side to take. */
const SIDE = "做多";

const shipped = readAbilities(PLUGINS_ROOT);

/** The kept declaration with this id. */
function kept(id: string): AbilityFile {
  const ability = shipped.abilities.find((candidate) => candidate.id === id);
  assert.ok(ability !== undefined, `${id} must be kept; kept ${shipped.abilities.map((a) => a.id).join(", ") || "none"}`);
  return ability;
}

/** Every string in a parsed JSON value, each object's keys among them. */
function stringsOf(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsOf);
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, inner]) => [key, ...stringsOf(inner)]);
  }
  return [];
}

test("the shipped declarations: event-analogs, then read-through, none refused", () => {
  assert.deepEqual(shipped.refused, []);
  assert.deepEqual(shipped.abilities.map((ability) => ability.id), Object.keys(FOLDERS));
});

test("event-analogs: the analog plugin's tools and rows, the source reader, the analog guide, the rewind icon", () => {
  const ability = kept("event-analogs");
  assert.deepEqual(ability.tools, [...ANALOG_TOOL_NAMES]);
  assert.deepEqual(ability.rows, [...ANALOG_ROW_IDS]);
  assert.deepEqual(ability.roles, ["source-reader"]);
  assert.deepEqual(ability.skills, ["analog-guide"]);
  assert.equal(ability.icon, "rewind");
});

test("read-through: the read-through plugin's tools and rows, no role, no skill, the arrows icon", () => {
  const ability = kept("read-through");
  assert.deepEqual(ability.tools, [...READ_THROUGH_TOOL_NAMES]);
  assert.deepEqual(ability.rows, [...READ_THROUGH_ROW_IDS]);
  assert.deepEqual(ability.roles, []);
  assert.deepEqual(ability.skills, []);
  assert.equal(ability.icon, "arrows");
});

for (const [id, folder] of Object.entries(FOLDERS)) {
  test(`${id}: its roles and skills are in the repo, its icon is the client's, a Chinese name, blurb and about, no ${SIDE}`, () => {
    const ability = kept(id);
    for (const role of ability.roles) {
      assert.ok(existsSync(join(ROLES_ROOT, role, "role.yml")), `the role ${role} has roles/${role}/role.yml`);
    }
    const packs = readdirSync(SKILLS_ROOT, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    for (const skill of ability.skills) {
      assert.ok(packs.some((pack) => existsSync(join(SKILLS_ROOT, pack, skill, "SKILL.md"))),
        `the skill ${skill} has a SKILL.md under dsh/skills/*/${skill}/`);
    }
    assert.ok(ability.icon !== null && Object.keys(ICONS).includes(ability.icon), `the icon ${String(ability.icon)} is a key of ICONS`);
    assert.ok(ability.zh !== null, "it carries a zh overlay");
    for (const field of ["name", "blurb", "about"] as const) {
      assert.equal(typeof ability.zh[field], "string", `zh.${field} is given`);
    }
    const file = JSON.parse(readFileSync(join(PLUGINS_ROOT, folder, ABILITY_FILE), "utf8")) as unknown;
    const strings = stringsOf(file);
    assert.ok(strings.length > 0, "the file's strings are read");
    for (const text of strings) assert.equal(text.includes(SIDE), false, `no string holds ${SIDE}; saw ${JSON.stringify(text)}`);
  });
}

test("event-analogs: its about names the 250-session ceiling and the SPY default, in English and in Chinese", () => {
  const ability = kept("event-analogs");
  for (const [language, about] of [["en", ability.about], ["zh", ability.zh?.about ?? ""]] as const) {
    for (const word of ["250", "SPY"]) assert.ok(about.includes(word), `the ${language} about names ${word}`);
  }
});
