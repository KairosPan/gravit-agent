/** THE ROBINHOOD TOKEN NAMES AND THE NAME GATE: Robinhood quotes a Stock Token by its tokenSymbol, which is not always the share's ticker
 * (SATS is EchoStar's token; SATS the ticker is now Strive's preferred), so its quote is taken only where the token's name and the
 * directory's company name agree. The fixtures are the probe's real answers (test/fixtures/us-stocks/). */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isRefusal } from "../../src/core/errors.ts";
import { RH_ASSETS, TOKEN_NAMES_MS, listedGate, namesAgree, robinhoodTokenNames } from "../../src/live/us-tokens.ts";
import { parseDirectory } from "../../src/live/us-directory.ts";
import type { Http, HttpReply } from "../../src/live/types.ts";

const text = (f: string) => readFileSync(new URL(`../fixtures/us-stocks/${f}`, import.meta.url), "latin1");
const DIR = new Map(parseDirectory(text("nasdaqlisted.txt"), text("otherlisted.txt")).map((e) => [e.symbol, e]));
const ASSETS = JSON.parse(readFileSync(new URL("../fixtures/us-stocks/rh-token-names.json", import.meta.url), "utf8")) as { assets: Array<{ tokenSymbol: string; tokenName: string }> };
const TOKENS = new Map(ASSETS.assets.map((a) => [a.tokenSymbol, a.tokenName.split(" • ")[0] ?? a.tokenName]));
const HOUR = 3_600_000;
const MIN = 60_000;

describe("namesAgree", () => {
  it("the eleven hard cases: SATS rejected, the other ten accepted", () => {
    const agree = (s: string) => namesAgree(TOKENS.get(s) ?? "", DIR.get(s)?.name ?? "");
    expect(agree("SATS")).toBe(false);
    for (const s of ["SPY", "JPM", "GE", "UPS", "AMD", "KSS", "DIS", "IBM", "HPE", "TTD"]) expect(agree(s), s).toBe(true);
  });

  it("all 205 tokens: 204 agree and SATS alone does not", () => {
    expect(TOKENS.size).toBe(205);
    const bad = [...TOKENS].filter(([s, n]) => !namesAgree(n, DIR.get(s)?.name ?? "")).map(([s]) => s);
    expect(TOKENS.size - bad.length).toBe(204);
    expect(bad).toEqual(["SATS"]);
  });

  it("works on the raw Security Name as on the display name", () => {
    expect(namesAgree("General Electric", "GE Aerospace Common Stock")).toBe(true);
    expect(namesAgree("EchoStar", "Strive, Inc. - 15.00% Series A Perpetual SATS Preferred Stock")).toBe(false);
  });
});

describe("listedGate", () => {
  it("with both maps the directory must list the symbol and the names must agree", () => {
    const gate = listedGate(DIR, TOKENS);
    expect(gate("SATS")).toBe(false);
    expect(gate("AAPL")).toBe(true);
    expect(gate("ZZZZ")).toBe(false);
  });

  it("with either map missing, only US_SHARES", () => {
    for (const gate of [listedGate(DIR, undefined), listedGate(undefined, TOKENS), listedGate(undefined, undefined)]) {
      expect(gate("AAPL")).toBe(true);
      expect(gate("CIEN")).toBe(false);
    }
  });
});

describe("robinhoodTokenNames", () => {
  function standIn(status = 200) {
    const asked: Array<{ url: string; host: string }> = [];
    const paced: string[] = [];
    const http: Http = async (url) => {
      asked.push({ url, host: paced[paced.length - 1] ?? "" });
      return { status, body: status === 200 ? ASSETS : undefined, text: "" } satisfies HttpReply;
    };
    return { http, asked, paced, pace: async (h: string) => void paced.push(h) };
  }

  it("reads rhj/assets once a day on the robinhood lane", async () => {
    let now = 1_000;
    const s = standIn();
    const t = robinhoodTokenNames({ http: s.http, pace: s.pace, clock: () => now });
    expect(t.now()).toBeUndefined();
    const first = await t.read();
    expect(isRefusal(first)).toBe(false);
    expect((first as ReadonlyMap<string, string>).get("SATS")).toBe("EchoStar");
    expect(t.now()?.size).toBe(205);
    expect(s.asked.map((a) => a.url)).toEqual([RH_ASSETS]);
    expect(s.paced).toEqual(["robinhood"]);
    now += 23 * HOUR;
    await t.read();
    expect(s.asked).toHaveLength(1);
    now += HOUR;
    expect(TOKEN_NAMES_MS).toBe(24 * HOUR);
    await t.read();
    expect(s.asked).toHaveLength(2);
  });

  it("a refusal is asked again after ten minutes, and a throwing pace is a refusal, not kept for good", async () => {
    let now = 0;
    const s = standIn(503);
    const t = robinhoodTokenNames({ http: s.http, pace: s.pace, clock: () => now });
    expect(isRefusal(await t.read())).toBe(true);
    now += 9 * MIN;
    await t.read();
    expect(s.asked).toHaveLength(1);
    now += 2 * MIN;
    await t.read();
    expect(s.asked).toHaveLength(2);
    expect(t.now()).toBeUndefined();

    let calls = 0;
    const flaky = robinhoodTokenNames({ http: standIn().http, pace: async () => { if (calls++ === 0) throw new Error("line closed"); }, clock: () => now });
    expect(isRefusal(await flaky.read())).toBe(true);
    now += 11 * MIN;
    expect(isRefusal(await flaky.read())).toBe(false);
  });
});
