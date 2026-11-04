import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { isRefusal } from "../../src/core/errors.ts";
import { formatRouting, parseRouting, quietHolds, ROUTE_ROWS, rowOf, type Routing } from "../../src/portfolio/identity/kinds.ts";
import { readNetworkSecret, removeNetworkSecret, writeNetworkSecret } from "../../src/portfolio/identity/secret-file.ts";
import { DEFAULT_STATE, loadIdentity, saveIdentity, Strangers, type IdentityState } from "../../src/portfolio/identity/store.ts";

/** THE IDENTITY STORE (identity/kinds.ts, store.ts, secret-file.ts): the routing string the owner signs, the kind of every message and its
 * row, quiet hours on New York's clock, the state file, the strangers (a count, a time and a masked id, never more) and a network's token
 * file (0600 in a 0700 folder, written whole, never through a link). Every token below is made up for the test. */
const homes: string[] = [];
afterAll(() => {
  for (const h of homes) rmSync(h, { recursive: true, force: true });
});
const newHome = (): string => {
  const h = mkdtempSync(join(tmpdir(), "identity-store-"));
  homes.push(h);
  return h;
};
const mode = (p: string): string => (statSync(p).mode & 0o777).toString(8);
const FAKE = { token: "123456789:AAFakeTokenForTheTestOnly_abcdefghijk", botId: "123456789", username: "gravit_test_bot", operatorId: "987654321", operatorHandle: "operator" };

describe("the routing string", () => {
  it("routing round-trips in row order, networks sorted", () => {
    const s = "chat=telegram;alerts=telegram;brief=;cards=telegram;fills=telegram";
    expect(formatRouting(parseRouting(s) as Routing)).toBe(s);
    expect(parseRouting("alerts=telegram;chat=telegram;brief=;cards=;fills=")).toMatch(/order/);
    expect(parseRouting("chat=imessage;alerts=;brief=;cards=;fills=")).toMatch(/imessage/);
  });
  it("refuses a missing row, an extra row, a repeated network and a row without '='", () => {
    expect(typeof parseRouting("chat=;alerts=;brief=;cards=")).toBe("string");
    expect(typeof parseRouting("chat=;alerts=;brief=;cards=;fills=;more=")).toBe("string");
    expect(typeof parseRouting("chat=telegram,telegram;alerts=;brief=;cards=;fills=")).toBe("string");
    expect(typeof parseRouting("chat;alerts=;brief=;cards=;fills=")).toBe("string");
    expect(ROUTE_ROWS).toEqual(["chat", "alerts", "brief", "cards", "fills"]);
  });
});

describe("kinds and quiet hours", () => {
  it("every kind has its row; the watchdog is in none", () => {
    expect(rowOf("urgent")).toBe("alerts");
    expect(rowOf("report")).toBe("fills");
    expect(rowOf("watchdog")).toBe("always");
    expect(rowOf("chat")).toBe("chat");
    expect(rowOf("alert")).toBe("alerts");
    expect(rowOf("brief")).toBe("brief");
    expect(rowOf("card")).toBe("cards");
    expect(rowOf("fill")).toBe("fills");
  });
  it("quiet hours hold proactive kinds across midnight, never chat, urgent or watchdog", () => {
    const q = { from: "23:00", to: "07:00" };
    const et = (hhmm: string) => Date.parse(`2026-11-04T${hhmm}:00-05:00`);
    for (const k of ["alert", "brief", "report", "card", "fill"] as const) expect(quietHolds(k, et("23:30"), q)).toBe(true);
    for (const k of ["chat", "urgent", "watchdog"] as const) expect(quietHolds(k, et("23:30"), q)).toBe(false);
    expect(quietHolds("alert", et("07:00"), q)).toBe(false);
    expect(quietHolds("alert", et("06:59"), q)).toBe(true);
    expect(quietHolds("alert", et("03:00"), null)).toBe(false);
  });
  it("a window inside one day holds from 'from' up to but not at 'to'", () => {
    const q = { from: "12:00", to: "13:00" };
    const et = (hhmm: string) => Date.parse(`2026-11-04T${hhmm}:00-05:00`);
    expect(quietHolds("brief", et("11:59"), q)).toBe(false);
    expect(quietHolds("brief", et("12:00"), q)).toBe(true);
    expect(quietHolds("brief", et("12:59"), q)).toBe(true);
    expect(quietHolds("brief", et("13:00"), q)).toBe(false);
  });
});

describe("the state file", () => {
  it("a fresh home reads the default state; a saved one reads back; the file is 0600 in 0700", () => {
    const home = newHome();
    expect(loadIdentity(home)).toEqual(DEFAULT_STATE);
    expect(DEFAULT_STATE).toEqual({ bindings: [], routing: { chat: [], alerts: [], brief: [], cards: [], fills: [] }, quiet: { from: "23:00", to: "07:00" }, blocked: [] });
    const s: IdentityState = {
      bindings: [{ network: "telegram", speaksAs: "@gravit_test_bot", botId: "123456789", talksOnlyWith: "@operator", operatorId: "987654321", since: "2026-11-04T12:00:00.000Z", fingerprint: "abcd1234" }],
      routing: { chat: ["telegram"], alerts: ["telegram"], brief: [], cards: ["telegram"], fills: ["telegram"] },
      quiet: null,
      blocked: ["0123456789ab"],
    };
    saveIdentity(home, s);
    expect(loadIdentity(home)).toEqual(s);
    const file = join(home, "identity", "state.json");
    expect(mode(file)).toBe("600");
    expect(mode(join(home, "identity"))).toBe("700");
    expect(readdirSync(join(home, "identity")).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});

describe("the strangers", () => {
  it("a stranger keeps a count, the last time and a masked id, never more", () => {
    const home = newHome();
    const st = new Strangers(home);
    st.note("telegram", "123456789", 1);
    st.note("telegram", "123456789", 2);
    expect(st.list()).toEqual([{ network: "telegram", sender: st.refOf("telegram", "123456789"), masked: "…789", count: 2, last: new Date(2).toISOString() }]);
    expect(readFileSync(join(home, "identity", "strangers.json"), "utf8")).not.toContain("123456789");
    expect(st.refOf("telegram", "123456789")).toMatch(/^[0-9a-f]{12}$/);
    expect(mode(join(home, "identity", "strangers.json"))).toBe("600");
    // a fresh reader of the same home sees the same strangers
    expect(new Strangers(home).list()).toEqual(st.list());
    st.remove(st.refOf("telegram", "123456789"));
    expect(st.list()).toEqual([]);
    expect(new Strangers(home).list()).toEqual([]);
  });
  it("at most 50 strangers: the oldest last time leaves first", () => {
    const home = newHome();
    const st = new Strangers(home);
    for (let i = 0; i < 51; i++) st.note("telegram", String(1000 + i), 10 + i);
    const list = st.list();
    expect(list.length).toBe(50);
    expect(list.map((s) => s.sender)).not.toContain(st.refOf("telegram", "1000"));
    expect(list.map((s) => s.sender)).toContain(st.refOf("telegram", "1050"));
  });
});

describe("a network's token file", () => {
  it("the token file is 0600 in 0700, written whole, never through a link", () => {
    const home = newHome();
    const w = writeNetworkSecret(home, "telegram", FAKE);
    expect(isRefusal(w)).toBe(false);
    if (isRefusal(w)) return;
    expect(w.file).toBe(join(realpathSync(home), "credentials", "networks", "telegram.json"));
    expect(mode(w.file)).toBe("600");
    expect(mode(join(home, "credentials", "networks"))).toBe("700");
    expect(JSON.parse(readFileSync(w.file, "utf8"))).toEqual(FAKE);
    expect(readNetworkSecret(home, "telegram")).toEqual(FAKE);
    expect(readdirSync(join(home, "credentials", "networks")).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    const r1 = removeNetworkSecret(home, "telegram");
    expect(r1).toEqual({ ok: true, removed: true });
    expect(removeNetworkSecret(home, "telegram")).toEqual({ ok: true, removed: false });
    expect(readNetworkSecret(home, "telegram")).toBeUndefined();
  });
  it("a link at credentials/networks is refused and nothing is written", () => {
    const home = newHome();
    const elsewhere = newHome();
    mkdirSync(join(home, "credentials"), { mode: 0o700 });
    symlinkSync(elsewhere, join(home, "credentials", "networks"));
    const w = writeNetworkSecret(home, "telegram", FAKE);
    expect(isRefusal(w)).toBe(true);
    if (!isRefusal(w)) return;
    expect(w.code).toBe("E_ACCOUNT_CREDENTIAL");
    expect(w.message).toMatch(/a network's token/);
    expect(JSON.stringify(w)).not.toContain(FAKE.token);
    expect(readdirSync(elsewhere)).toEqual([]);
    expect(isRefusal(removeNetworkSecret(home, "telegram"))).toBe(true);
  });
  it("a link where the file should be is refused, and a file others can read is not read", () => {
    const home = newHome();
    const elsewhere = newHome();
    mkdirSync(join(home, "credentials", "networks"), { recursive: true, mode: 0o700 });
    symlinkSync(join(elsewhere, "x.json"), join(home, "credentials", "networks", "telegram.json"));
    const w = writeNetworkSecret(home, "telegram", FAKE);
    expect(isRefusal(w) && w.code).toBe("E_ACCOUNT_CREDENTIAL");
    expect(existsSync(join(elsewhere, "x.json"))).toBe(false);
    expect(readNetworkSecret(home, "telegram")).toBeUndefined();
  });
});
