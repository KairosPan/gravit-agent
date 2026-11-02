import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PERSONA_PREFIX_SECTION, renderPrompt } from "@deepseek-ai/dsh-system-prompt";
import { PERSONA_PATH, PERSONA_VARIABLES, readPersona, validatePersonaTemplate } from "../src/persona.ts";

/** The installed renderer, on the one section the persona fills at dsh 0.2.0
 *  (`personaPrefix` → `deployment:persona-prefix`, NEW
 *  packages/core/system-prompt/src/index.ts:179, 432-437). `provider` and
 *  `model` are what dsh-agent-loop registers at 0.2.1-rc.5
 *  (@deepseek-ai/dsh-agent-loop lib/index.js:1591-1592), and no `cwd`: the
 *  variable left with 0.2.1, the working-directory context carries the
 *  directory now (D21, B3). */
const renderPersona = (text: string): string => renderPrompt({
  sections: [{ name: PERSONA_PREFIX_SECTION, text }],
  contexts: [],
  tools: [],
  variables: { provider: "deepseek-official", model: "deepseek-flash" },
});

test("validatePersonaTemplate accepts provider and model, refuses cwd and everything else the strict renderer would throw on", () => {
  assert.equal(validatePersonaTemplate("You are Gravit on {{model}} via {{provider}}."), undefined);
  // `cwd` was a known variable until 0.2.1; the refusal names the ones that are left.
  const cwd = validatePersonaTemplate("Your directory is {{cwd}}.");
  assert.match(cwd ?? "", /unknown persona variable \{\{cwd\}\}/);
  assert.match(cwd ?? "", /known: provider, model\)/);
  assert.match(validatePersonaTemplate("") ?? "", /empty/);
  assert.match(validatePersonaTemplate("   \n") ?? "", /empty/);
  assert.match(validatePersonaTemplate("Hello {{date}}") ?? "", /unknown persona variable \{\{date\}\}/);
  assert.match(validatePersonaTemplate("Hello {{ model }") ?? "", /unbalanced/);
  assert.match(validatePersonaTemplate("Hello {{{model}}}") ?? "", /unbalanced|unknown/);
  assert.match(validatePersonaTemplate("Hello {{ model }}") ?? "", /unknown persona variable/);
});

test("readPersona returns the trimmed file and throws with the path on a bad template", async () => {
  const dir = await mkdtemp(join(tmpdir(), "face-persona-"));
  const good = join(dir, "good.md");
  await writeFile(good, "\nYou are Probe on {{model}}.\n\n");
  assert.equal(readPersona(good), "You are Probe on {{model}}.");
  const bad = join(dir, "bad.md");
  await writeFile(bad, "You are {{nobody}}.");
  assert.throws(() => readPersona(bad), (err: Error) => err.message.includes(bad) && /nobody/.test(err.message));
});

test("the shipped persona.md is valid and names Gravit", () => {
  const text = readPersona(PERSONA_PATH);
  assert.match(text, /You are Gravit/);
  assert.equal(validatePersonaTemplate(text), undefined);
  assert.equal(text.includes("{{cwd}}"), false, "the loop registers no cwd variable at 0.2.1 (D21): the working-directory context tells the model its directory");
  assert.equal(text.includes("through report"), false, "the 0.1.1 report tool left dsh at 0.2.0 (tool-subagent-report, b91e7ce366); the persona must not name it");
});

/* The validator is only worth its refusal if it is never LOOSER than the
 * renderer it guards: a persona it passes that dsh then throws on fails every
 * step of every session. Pinned against the installed strict renderer so an
 * upstream change to the variable grammar fails here, at the pin bump. */
test("whatever validatePersonaTemplate accepts, dsh's strict renderer renders - and what dsh throws on, it refuses", () => {
  assert.match(renderPersona(readPersona(PERSONA_PATH)), /^You are Gravit/, "the shipped persona renders with provider and model registered and no cwd");
  assert.deepEqual([...PERSONA_VARIABLES], ["provider", "model"]);
  for (const variable of PERSONA_VARIABLES) {
    assert.doesNotThrow(() => renderPersona(`You run {{${variable}}}.`), variable);
  }
  assert.equal(renderPersona("You are Gravit on {{model}} via {{provider}}."), "You are Gravit on deepseek-flash via deepseek-official.");
  for (const text of ["Hello {{date}}", "Hello {{cwd}}", "Hello {{ model }}", "Hello {{Model}}"]) {
    assert.notEqual(validatePersonaTemplate(text), undefined, `the face refuses ${text}`);
    assert.throws(() => renderPersona(text), `and dsh would have thrown on ${text}`);
  }
});
