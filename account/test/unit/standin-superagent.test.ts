import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ANTHROPIC_KEY_REF } from "../../src/portfolio/account/brain-claude.ts";
import { readRoom } from "../../src/portfolio/account/desk.ts";
import { startStandin, type Standin } from "../standin/ui-standin.ts";

/** The stand-in's superagent flags (test/standin/ui-standin.ts), so the page's states can be looked at without real keys: `--cards` hires the
 * superagent with its autonomy off, so in Guard its leads wait for the owner on cards (the pane's "Waits for you" strip); `--brain-refuses`
 * has the scripted brain answer as the API does to a key it refuses, until the stand-in's key file is changed — the rejected-key fix with
 * real paths, and the fault cleared on the next answered call */
let s: Standin | undefined;
afterEach(async () => {
  await s?.close();
  if (s) rmSync(s.home, { recursive: true, force: true });
  s = undefined;
});

describe("the stand-in's superagent flags", () => {
  it("--cards: the superagent hired with its autonomy off, so a cleared lead waits for the owner on a card", async () => {
    s = await startStandin({ port: 0, tickMs: 0, agentMs: 0, superagent: true, cards: true });
    const desk = s.svc.desk!;
    expect(desk.catalog().autonomy).toBeNull();
    await desk.cycle("test");
    const v = (await desk.view())!;
    expect(v.venue.id).toBe("paper-momentum");
    expect(v.cards.length).toBeGreaterThan(0);
    expect(readRoom(s.home).some((m) => m.from === "sniper" && m.kind === "card" && /waits for you on card-\d+ \(Guard\)/.test(m.text))).toBe(true);
  }, 30_000);

  it("--brain-refuses: the key refused as the API would, the standing not ready with the fix, until the key file holds something else", async () => {
    s = await startStandin({ port: 0, tickMs: 0, agentMs: 0, superagent: true, brainRefuses: true });
    const desk = s.svc.desk!;
    const file = join(s.home, ANTHROPIC_KEY_REF);
    await desk.cycle("test");
    let v = (await desk.view())!;
    expect(v.brain).toMatchObject({ ok: false, fix: { code: "rejected", file, restart: false } });
    expect(readRoom(s.home).filter((m) => m.text === `Anthropic refused the brain's key. Replace it in ${file}; the next cycle reads it, no restart.`)).toHaveLength(1);
    // the owner changes what the file holds: the next call is answered, and the fault is gone
    writeFileSync(file, readFileSync(file, "utf8").replace("refuses", "accepts"), { mode: 0o600 });
    await desk.cycle("test");
    v = (await desk.view())!;
    expect(v.brain.ok).toBe(true);
    expect(readRoom(s.home).some((m) => m.text === "Anthropic answered the brain's call: its key works again.")).toBe(true);
  }, 30_000);
});
