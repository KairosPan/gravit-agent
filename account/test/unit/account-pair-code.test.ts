/** PAIRING BY CODE (account/exchange.ts pairDevice, spec 2026-11-09 §5.4): a browser that waits to sign asks for a code of its own, the
 * account prints it in its terminal, and the browser that types it becomes a signer as Let it sign makes one. A code lives in memory only:
 * 10 minutes, 5 wrong tries, one process. Every signer says how it came in — the first device, let in from another, or let in with a code —
 * and a restart says the same from the ledger. Nothing leaves the process. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { isRefusal, type Refusal } from "../../src/core/errors.ts";
import type { Host } from "../../src/portfolio/account/exchange.ts";
import { DEVICE_CODE_MS, DEVICE_CODE_TRIES } from "../../src/portfolio/account/pairing.ts";
import { simKey } from "../../src/portfolio/account/sign.ts";
import { browser, CODE, fresh, HOUR, laptop, ok, run, START } from "../attack/account-runs.ts";

afterEach(() => vi.restoreAllMocks());

const CODE_SHAPE = /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/;
const refusal = (o: unknown): Refusal => {
  if (!isRefusal(o)) throw new Error(`expected a refusal, got ${JSON.stringify(o).slice(0, 200)}`);
  return o;
};
/** what the account says to its terminal, kept */
const said = () => {
  const lines: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(" ")));
  return lines;
};
/** a run whose clock the test moves */
async function clocked(home: string, at = 0) {
  let t = START + at;
  const x = await run(home, at, { extra: { now: () => new Date(t).toISOString() } });
  return { ...x, pass: (ms: number) => void (t += ms) };
}
/** the account's first device: the browser, with the code the server printed */
const first = (x: Awaited<ReturnType<typeof run>>) => expect(x.engine.pairDevice(browser.jwk, "Desk", CODE)).toMatchObject({ role: "owner" });
/** a waiting browser asks for its code: the code the terminal was given */
const ask = (x: Awaited<ReturnType<typeof run>>, key = laptop, label = "Laptop") => {
  const spy = vi.spyOn(x.engine.host as Required<Host>, "askedCode");
  expect(x.engine.pairDevice(key.jwk, label, undefined, true)).toMatchObject({ role: "asked" });
  return spy.mock.calls.at(-1)![2] as string;
};
const owner = async (x: Awaited<ReturnType<typeof run>>, id: string) => (await x.engine.view()).signers.owners.find((o) => o.id === id);

describe("pairing a browser by the code its terminal prints", () => {
  it("a waiting browser asks for a code: one terminal line, role asked; asking again while it lives prints nothing new", async () => {
    const x = await run(fresh(), 0);
    first(x);
    const lines = said();
    const spy = vi.spyOn(x.engine.host as Required<Host>, "askedCode");
    expect(DEVICE_CODE_MS).toBe(600_000);
    expect(DEVICE_CODE_TRIES).toBe(5);
    expect(x.engine.pairDevice(laptop.jwk, "Laptop", undefined, true)).toEqual({ ok: true, kid: laptop.kid, role: "asked" });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toBe("Laptop");
    expect(spy.mock.calls[0]![1]).toBe(laptop.kid);
    const code = spy.mock.calls[0]![2] as string;
    expect(code).toMatch(CODE_SHAPE);
    expect(lines).toEqual([`a browser asks to sign for the account (Laptop · ${laptop.kid!.slice(0, 8)}): code ${code}, good for 10 minutes — type it on that page`]);
    // it waits as a knock makes it wait: Let it sign could admit it
    expect(x.engine.state.pendingDevices.map((d) => d.kid)).toEqual([laptop.kid]);
    expect(x.engine.pairDevice(laptop.jwk, "Laptop", undefined, true)).toMatchObject({ role: "asked" });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(lines).toHaveLength(1);
    // a knock without asking is a knock, as today
    expect(x.engine.pairDevice(laptop.jwk, "Laptop")).toMatchObject({ role: "pending" });
  });

  it("the right code admits only its browser, whatever its case and spaces", async () => {
    const x = await run(fresh(), 0);
    first(x);
    said();
    const code = ask(x);
    const other = simKey("device:pair-code-other");
    expect(x.engine.pairDevice(other.jwk, "Other")).toMatchObject({ role: "pending" });
    // another waiting browser typing it: no code is live for THAT browser
    expect(refusal(x.engine.pairDevice(other.jwk, "Other", code)).message).toBe("no code is live for this browser: press Get a code");
    const log = vi.spyOn(x.engine.host, "log");
    expect(x.engine.pairDevice(laptop.jwk, "Laptop", code.toLowerCase().replace("-", " "))).toEqual({ ok: true, kid: laptop.kid, role: "owner" });
    expect(x.engine.state.pendingDevices.map((d) => d.kid)).toEqual([other.kid]);
    expect(x.engine.state.threshold).toBe(1);
    expect(await owner(x, `device:${laptop.kid}`)).toMatchObject({ kind: "device", label: "Laptop", via: "code" });
    // the row a restart reads, and the phone's notice will
    expect(log.mock.calls.map((c) => c[0])).toEqual([{ kind: "action", venue: "*", tool: "account_pair", signer: `device:${laptop.kid}`, reason: "a device was let in with the code its terminal printed (Laptop)", native: { jwk: { kty: "EC", crv: "P-256", x: laptop.jwk!.x, y: laptop.jwk!.y }, label: "Laptop", code: true, admitted: true } }]);
    // the browser let in signs for the account
    expect(ok(await x.own({ type: "setWatch", venue: "ex", symbol: "BTC/USDT", on: "true" }, laptop))).toMatchObject({ kind: "account" });
    // the code is spent
    expect(refusal(x.engine.pairDevice(other.jwk, "Other", code)).message).toBe("no code is live for this browser: press Get a code");
  });

  it("a code expires after 10 minutes and dies after 5 wrong tries", async () => {
    const x = await clocked(fresh());
    first(x);
    said();
    const code = ask(x);
    x.pass(600_001);
    expect(refusal(x.engine.pairDevice(laptop.jwk, "Laptop", code)).message).toBe("no code is live for this browser: press Get a code");
    // asked again: a new code, a new terminal line
    const next = ask(x);
    for (let i = 1; i <= 4; i++) expect(refusal(x.engine.pairDevice(laptop.jwk, "Laptop", "AAAA-BBBB")).message).toBe(`that is not the code printed for this browser (${5 - i} tries left)`);
    expect(refusal(x.engine.pairDevice(laptop.jwk, "Laptop", "AAAA-BBBB")).message).toBe("too many wrong codes: press Get a code for a new one");
    expect(refusal(x.engine.pairDevice(laptop.jwk, "Laptop", next)).message).toBe("no code is live for this browser: press Get a code");
    expect((await owner(x, `device:${laptop.kid}`))).toBeUndefined();
  });

  it("a code dies with a restart; the browser it admitted stays a signer, let in with a code", async () => {
    const home = fresh();
    const tablet = simKey("device:pair-code-tablet");
    const one = await run(home, 0);
    first(one);
    said();
    expect(one.engine.pairDevice(laptop.jwk, "Laptop", ask(one))).toMatchObject({ role: "owner" });
    const dead = ask(one, tablet, "Tablet");
    const two = await run(home, HOUR);
    expect(two.svc.restored).toMatchObject({ owner: true, skipped: [] });
    expect(refusal(two.engine.pairDevice(tablet.jwk, "Tablet", dead)).message).toBe("no code is live for this browser: press Get a code");
    expect(await owner(two, `device:${laptop.kid}`)).toMatchObject({ label: "Laptop", via: "code", addedAt: new Date(START).toISOString() });
    expect(ok(await two.own({ type: "setWatch", venue: "ex", symbol: "BTC/USDT", on: "true" }, laptop))).toMatchObject({ kind: "account" });
  });

  it("Let it sign marks the device let in from its signer; the first device is the first", async () => {
    const home = fresh();
    const one = await run(home, 0);
    first(one);
    expect(one.engine.pairDevice(laptop.jwk, "Laptop")).toMatchObject({ role: "pending" });
    const users = [`device:${browser.kid}`, `device:${laptop.kid}`].sort();
    ok(await one.own({ type: "convertToMultiSigUser", signers: JSON.stringify({ authorizedUsers: users, threshold: 1 }) }, browser));
    for (const x of [one, await run(home, HOUR)]) {
      const owners = (await x.engine.view()).signers.owners;
      expect(owners.find((o) => o.id === `device:${browser.kid}`)).toMatchObject({ id: `device:${browser.kid}`, kind: "device", label: "Desk", via: "first", addedAt: new Date(START).toISOString() });
      expect(owners.find((o) => o.id === `device:${laptop.kid}`)).toMatchObject({ kind: "device", label: "Laptop", via: "letIn", by: `device:${browser.kid}` });
    }
  });

  it("a code never undercuts an account that needs more than one signature: neither asked for nor typed", async () => {
    const x = await run(fresh(), 0);
    first(x);
    said();
    const code = ask(x);
    // the account now needs two signatures: Let it sign, co-signed by both, is the only way in
    const tablet = simKey("device:pair-code-threshold");
    expect(x.engine.pairDevice(tablet.jwk, "Tablet")).toMatchObject({ role: "pending" });
    const users = [`device:${browser.kid}`, `device:${tablet.kid}`].sort();
    ok(await x.own({ type: "convertToMultiSigUser", signers: JSON.stringify({ authorizedUsers: users, threshold: 2 }) }, browser));
    expect(x.engine.state.threshold).toBe(2);
    const NEEDS = "this account needs more than one signature: a browser that signs lets this one in under Settings › Devices";
    const spy = vi.spyOn(x.engine.host as Required<Host>, "askedCode");
    const phone = simKey("device:pair-code-phone");
    expect(refusal(x.engine.pairDevice(phone.jwk, "Phone", undefined, true)).message).toBe(NEEDS);
    expect(spy).not.toHaveBeenCalled();
    // the code minted before the threshold rose is no way in either
    expect(refusal(x.engine.pairDevice(laptop.jwk, "Laptop", code)).message).toBe(NEEDS);
    expect(await owner(x, `device:${laptop.kid}`)).toBeUndefined();
    expect(await owner(x, `device:${phone.kid}`)).toBeUndefined();
  });

  it("a label with a line break or a link reaches the terminal and the owners cleaned", async () => {
    const x = await run(fresh(), 0);
    first(x);
    const lines = said();
    const code = ask(x, laptop, "Chrome\nhttps://evil.example");
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("\n");
    expect(lines[0]).not.toContain("https://");
    expect(lines[0]).toContain("(Chrome <link> · ");
    expect(x.engine.pairDevice(laptop.jwk, "whatever", code)).toMatchObject({ role: "owner" });
    const label = (await owner(x, `device:${laptop.kid}`))!.label;
    expect(label).toBe("Chrome <link>");
  });
});
