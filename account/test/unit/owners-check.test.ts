/** account:owners — says whether the face signs for the running Account before its page goes (one read, no key, no id). */
import { describe, expect, it } from "vitest";
import { checkOwners, ownerStanding, SENTENCE } from "../../src/portfolio/owners-check.ts";

const signers = (owners: unknown[], pending: unknown[] = []) => ({ owners, threshold: 1, pendingDevices: pending });
const answer = (body: unknown, status = 200): typeof fetch => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

describe("account:owners", () => {
  it("no owner is ownerless and exits 0", async () => {
    const r = await checkOwners({ url: "http://x", fetch: answer({ signers: signers([]) }) });
    expect(r.verdict).toBe("ownerless");
    expect(r.lines.at(-1)).toBe(SENTENCE.ownerless);
  });

  it("an owner device labelled Gravit face is face-signs, and says a label is a hint", () => {
    const r = ownerStanding(signers([{ id: "0xabc", kind: "device", label: "Gravit face" }]));
    expect(r.verdict).toBe("face-signs");
    expect(r.lines.join("\n")).toContain("A label is a hint, not a proof");
  });

  it("owners without the face's device stop, naming the remedies left since the page retired, in order, --fresh last", () => {
    const r = ownerStanding(signers([{ id: "0x1", kind: "device", label: "Account page" }, { id: "0x2", kind: "wallet", label: "Gravit face" }]));
    expect(r.verdict).toBe("stop");
    const text = r.lines.join("\n");
    expect(text).not.toContain("the page's Settings");
    const steps = ["a face browser that already signs", "Settings › Devices", "9614314c", "same home", "--fresh"].map((w) => text.indexOf(w));
    expect(steps.every((i) => i >= 0)).toBe(true);
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
    expect(text).toContain("throws away the owner, the venues, the agents and their limits");
  });

  it("an unreadable signers shape stops", () => {
    for (const bad of [undefined, null, "x", { owners: "no" }, { owners: [{ kind: "device" }] }, signers([5])]) expect(ownerStanding(bad).verdict).toBe("stop");
  });

  it("an Account that does not answer stops, naming npm run account", async () => {
    const down = (async () => { throw new Error("ECONNREFUSED"); }) as typeof fetch;
    for (const f of [down, answer({}, 500)]) {
      const r = await checkOwners({ url: "http://127.0.0.1:4820", fetch: f });
      expect(r.verdict).toBe("stop");
      expect(r.lines[0]).toBe("The Account at http://127.0.0.1:4820 did not answer: start it (npm run account) and run this again");
    }
  });

  it("the lines list each owner as kind · label and the devices waiting, and no id", () => {
    const r = ownerStanding(signers([{ id: "0xSECRETID", kind: "device", label: "Gravit face" }], [{ kid: "kid-secret", at: "t" }]));
    expect(r.lines[0]).toBe("device · Gravit face");
    expect(r.lines[1]).toBe("devices waiting: 1");
    const text = r.lines.join("\n");
    expect(text).not.toContain("0xSECRETID");
    expect(text).not.toContain("kid-secret");
  });
});
