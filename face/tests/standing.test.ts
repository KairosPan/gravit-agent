// face/tests/standing.test.ts
/** The standing orders (src/standing.ts): the anchors and their instants across DST and the early closes,
 * the offsets that would leave a session's ET date, `standing.yml` read under CORE_SCHEMA (dates stay
 * strings, only CORE's booleans, only HH:MM, each refusal naming its key), the room before the close
 * (P2-16), an order without its arming fields (P2-22), the order's working directory, the arming edits -
 * appended and re-hashed as text, kept only when a re-parse shows exactly that change - and the write.
 * Offline; the write's fixture home sits under tests/tmp/standing-<pid>/ and is removed afterwards. */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deskDir } from "../src/desk.ts";
import type { MarketSession } from "../src/market-clock.ts";
import {
  DEFAULT_PRODUCER_DEADLINE_MS, DEFAULT_TURN_DEADLINE_MS, GRACE_MS, STANDING_FILE, STANDING_TEXT_MAX_BYTES, STANDING_YAML_MAX_BYTES,
  anchorInstant, appendOrder, formatAnchor, isEtDate, isOrderDir, orderCwd, parseAnchor, parseStanding, parseStandingDuration,
  readDeskYaml, rehashOrder, renderOrder, sha256Hex, unarmedOrders, writeStanding,
  type ArmEntry, type StandingLoad, type StandingOrder,
} from "../src/standing.ts";

const TEST_DIR = join(dirname(fileURLToPath(import.meta.url)), "tmp", `standing-${process.pid}`);
after(() => rm(TEST_DIR, { recursive: true, force: true }));

const S = (date: string, open: string, close: string, early = false): MarketSession => ({ date, open, close, early });

const SHA = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const ARMED = "2026-10-20T18:00:00.000Z";

/** The head of FULL: a comment and the budget. */
const HEAD = "# the desk's standing orders\nbudget:\n  dailyTokens: 2000000\norders:\n";
/** FULL's one order, as an operator could write it by hand: plain scalars, the date unquoted. */
const ORDER = `  - id: preclose
    dir: desk
    file: STANDING.md
    sha256: ${SHA}
    at: close-30m
    producer: builtin:brief
    wake: true
    turnDeadline: 10m
    producerDeadline: 5m
    expires: 2026-11-30
    enabled: true
    armedAt: "${ARMED}"
`;
const FULL = HEAD + ORDER;

/** FULL's order as parseStanding reads it. */
const PRECLOSE: StandingOrder = {
  id: "preclose", dir: "desk", file: "STANDING.md", sha256: SHA, at: "close-30m", anchor: { kind: "close", offsetMin: -30 },
  producer: { kind: "builtin", name: "brief" }, wake: true, turnDeadlineMs: 600_000, producerDeadlineMs: 300_000,
  expires: "2026-11-30", enabled: true, armedAt: ARMED,
};

/** The errors of a refused load; fails the test when the load was not refused. */
function errorsOf(load: StandingLoad, label: string): string[] {
  assert.equal(load.ok, false, `${label}: refused`);
  return load.ok ? [] : load.errors;
}

/** The orders of a good load; fails the test when the load was refused. */
function ordersOf(load: StandingLoad, label: string): StandingOrder[] {
  assert.ok(load.ok, `${label}: ${load.ok ? "" : load.errors.join("; ")}`);
  return load.ok ? load.orders : [];
}

/* ---------- the anchors ---------- */

test("parseAnchor and anchorInstant across DST and the early closes", () => {           // Review Focus 8
  assert.deepEqual(parseAnchor("close-30m"), { kind: "close", offsetMin: -30 });
  assert.deepEqual(parseAnchor("open"), { kind: "open", offsetMin: 0 });
  assert.deepEqual(parseAnchor("close"), { kind: "close", offsetMin: 0 });
  assert.deepEqual(parseAnchor("open+15m"), { kind: "open", offsetMin: 15 });
  assert.deepEqual(parseAnchor("close-600m"), { kind: "close", offsetMin: -600 });
  assert.deepEqual(parseAnchor("15:30"), { kind: "time", hour: 15, minute: 30 });
  assert.deepEqual(parseAnchor("00:00"), { kind: "time", hour: 0, minute: 0 });
  assert.deepEqual(parseAnchor("23:59"), { kind: "time", hour: 23, minute: 59 });
  for (const bad of ["close-30", "close-0m", "close-601m", "9:30", "24:00", "15:60", "Close-30m", " close-30m", "", "close-030m", "open+601m",
    "close -30m", "close-30m ", "close-30min", "close-1h", "15:30:00", "1530", "noon"]) {
    assert.equal(parseAnchor(bad), undefined, bad);
  }
  for (const text of ["open", "close", "open-90m", "open+5m", "close-30m", "close+10m", "15:30", "09:05", "00:00"]) {
    assert.equal(formatAnchor(parseAnchor(text)!), text, `formatAnchor is parseAnchor's inverse: ${text}`);
  }
  const at = (a: string, s: MarketSession) => new Date(anchorInstant(parseAnchor(a)!, s)).toISOString();
  assert.equal(at("close-30m", S("2026-03-09", "2026-03-09T13:30:00Z", "2026-03-09T20:00:00Z")), "2026-03-09T19:30:00.000Z"); // first EDT session
  assert.equal(at("close-30m", S("2026-11-02", "2026-11-02T14:30:00Z", "2026-11-02T21:00:00Z")), "2026-11-02T20:30:00.000Z"); // first EST session
  assert.equal(at("close-30m", S("2026-11-27", "2026-11-27T14:30:00Z", "2026-11-27T18:00:00Z", true)), "2026-11-27T17:30:00.000Z");
  assert.equal(at("15:30", S("2026-11-27", "2026-11-27T14:30:00Z", "2026-11-27T18:00:00Z", true)), "2026-11-27T20:30:00.000Z"); // not moved
  assert.equal(at("open-90m", S("2026-11-02", "2026-11-02T14:30:00Z", "2026-11-02T21:00:00Z")), "2026-11-02T13:00:00.000Z");
  assert.equal(at("15:30", S("2026-03-09", "2026-03-09T13:30:00Z", "2026-03-09T20:00:00Z")), "2026-03-09T19:30:00.000Z", "15:30 EDT");
  assert.equal(at("close+10m", S("2026-11-02", "2026-11-02T14:30:00Z", "2026-11-02T21:00:00Z")), "2026-11-02T21:10:00.000Z");
  assert.equal(at("open", S("2026-11-02", "2026-11-02T14:30:00Z", "2026-11-02T21:00:00Z")), "2026-11-02T14:30:00.000Z");
});

test("an anchor that leaves its session's ET date is refused", () => {                  // Review Focus 5
  assert.ok(parseAnchor("open-570m")); assert.equal(parseAnchor("open-571m"), undefined);
  assert.ok(parseAnchor("close+479m")); assert.equal(parseAnchor("close+480m"), undefined);
  assert.ok(parseAnchor("open+600m")); assert.ok(parseAnchor("close-600m"), "the other two directions stop at 600");
  const session = S("2026-11-02", "2026-11-02T14:30:00Z", "2026-11-02T21:00:00Z");
  assert.equal(new Date(anchorInstant(parseAnchor("open-570m")!, session)).toISOString(), "2026-11-02T05:00:00.000Z", "00:00 ET, the date's first minute");
  assert.equal(new Date(anchorInstant(parseAnchor("close+479m")!, session)).toISOString(), "2026-11-03T04:59:00.000Z", "23:59 ET, its last");
  const errors = errorsOf(parseStanding(FULL.replace("close-30m", "open-571m")), "open-571m");
  assert.equal(errors.length, 1);
  assert.ok(errors[0].startsWith("orders[0] (preclose): at "), errors[0]);
  assert.match(errors[0], /"open-571m"/);
  assert.equal(errorsOf(parseStanding(FULL.replace("close-30m", "close+480m")), "close+480m").length, 1);
});

/* ---------- reading standing.yml ---------- */

test("parseStanding reads the mapping under CORE_SCHEMA: dates stay strings, only true and false, only HH:MM", () => {
  const ok = parseStanding(FULL);
  assert.ok(ok.ok, ok.ok ? "" : ok.errors.join("; "));
  assert.equal(ok.orders[0].expires, "2026-11-30");
  assert.equal(ok.budget?.dailyTokens, 2_000_000);
  assert.deepEqual(ok, { ok: true, budget: { dailyTokens: 2_000_000 }, orders: [PRECLOSE] });

  /* defaults on a minimal order */
  const minimal = `orders:\n  - id: m\n    dir: strategies/alpha\n    sha256: ${SHA}\n    at: "15:30"\n    expires: 2026-11-30\n    armedAt: "${ARMED}"\n`;
  assert.deepEqual(parseStanding(minimal), {
    ok: true,
    orders: [{
      id: "m", dir: "strategies/alpha", file: "STANDING.md", sha256: SHA, at: "15:30", anchor: { kind: "time", hour: 15, minute: 30 },
      wake: true, turnDeadlineMs: DEFAULT_TURN_DEADLINE_MS, producerDeadlineMs: DEFAULT_PRODUCER_DEADLINE_MS, expires: "2026-11-30", enabled: true, armedAt: ARMED,
    }],
  }, "file STANDING.md, wake and enabled true, 600,000 and 300,000 ms; no budget is no key");
  assert.equal(DEFAULT_TURN_DEADLINE_MS, 600_000);
  assert.equal(DEFAULT_PRODUCER_DEADLINE_MS, 300_000);
  const optional = ordersOf(parseStanding(FULL.replace("    wake: true\n", `    wake: true\n    model: deepseek-official/deepseek-v4-pro\n`)
    .replace("builtin:brief", "scripts/p.py").replace("    wake: true\n", `    producerSha256: ${SHA_B}\n    wake: true\n`)
    .replace("enabled: true", "enabled: False").replace("turnDeadline: 10m", "turnDeadline: 90s")), "optional keys")[0];
  assert.deepEqual(optional, {
    ...PRECLOSE, producer: { kind: "script", script: "scripts/p.py" }, producerSha256: SHA_B, model: "deepseek-official/deepseek-v4-pro",
    enabled: false, turnDeadlineMs: 90_000,
  }, "a script producer with its hash, a model, CORE's False, a deadline in seconds");

  /* refused, each one edit of FULL, each one line opening with what it is about and the key */
  const order = (key: string): string => `orders[0] (preclose): ${key} `;
  const refusals: [label: string, text: string, opening: string][] = [
    ["enabled: yes", FULL.replace("enabled: true", "enabled: yes"), order("enabled")],
    ["wake: no", FULL.replace("wake: true", "wake: no"), order("wake")],
    ["at: 0930", FULL.replace("at: close-30m", "at: 0930"), order("at")],
    ["at: 9:30", FULL.replace("at: close-30m", "at: 9:30"), order("at")],
    ["expires: 2026-13-01", FULL.replace("expires: 2026-11-30", "expires: 2026-13-01"), order("expires")],
    ["expires: Nov 30", FULL.replace("expires: 2026-11-30", "expires: Nov 30"), order("expires")],
    ["wakeup: true", FULL.replace("    wake: true\n", "    wakeup: true\n"), order("wakeup")],
    ["top-level orderz", FULL.replace("orders:", "orderz:"), "orderz "],
    ["orders a mapping", FULL.replace("  - id: preclose\n", "  preclose:\n    id: preclose\n"), "orders "],
    ["a second id preclose", FULL + ORDER, "orders[1] (preclose): id "],
    ["id: 123", FULL.replace("id: preclose", "id: 123"), "orders[0]: id "],
    ["id: true", FULL.replace("id: preclose", "id: true"), "orders[0]: id "],
    ["dir: strategies/_template", FULL.replace("dir: desk", "dir: strategies/_template"), order("dir")],
    ["dir: ../x", FULL.replace("dir: desk", "dir: ../x"), order("dir")],
    ["dir: desk/journal", FULL.replace("dir: desk", "dir: desk/journal"), order("dir")],
    ["producer: builtin:nope", FULL.replace("builtin:brief", "builtin:nope"), order("producer")],
    ["producer: scripts/x.mjs", FULL.replace("builtin:brief", "scripts/x.mjs"), order("producer")],
    ["producerSha256 with builtin:brief", FULL.replace("    wake: true\n", `    producerSha256: ${SHA_B}\n    wake: true\n`), order("producerSha256")],
    ["wake: false with no producer", FULL.replace("    producer: builtin:brief\n", "").replace("wake: true", "wake: false"), order("wake")],
    ["model: flash", FULL.replace("    wake: true\n", "    wake: true\n    model: flash\n"), order("model")],
    ["turnDeadline: 45m", FULL.replace("turnDeadline: 10m", "turnDeadline: 45m"), order("turnDeadline")],
    ["producerDeadline: 5s", FULL.replace("producerDeadline: 5m", "producerDeadline: 5s"), order("producerDeadline")],
    ["sha256: abc", FULL.replace(`sha256: ${SHA}`, "sha256: abc"), order("sha256")],
    ["dailyTokens: 0", FULL.replace("dailyTokens: 2000000", "dailyTokens: 0"), "budget.dailyTokens "],
    ["dailyTokens: 2M", FULL.replace("dailyTokens: 2000000", "dailyTokens: 2M"), "budget.dailyTokens "],
    ["file: x/STANDING.md", FULL.replace("file: STANDING.md", "file: x/STANDING.md"), order("file")],
    ["armedAt: yesterday", FULL.replace(`armedAt: "${ARMED}"`, "armedAt: yesterday"), order("armedAt")],
    ["at: 15:30:00", FULL.replace("at: close-30m", "at: 15:30:00"), order("at")],
  ];
  for (const [label, text, opening] of refusals) {
    assert.notEqual(text, FULL, `${label}: the edit applies`);
    const errors = errorsOf(parseStanding(text), label);
    assert.equal(errors.length, 1, `${label}: ${errors.join(" | ")}`);
    assert.ok(errors[0].startsWith(opening), `${label} opens ${JSON.stringify(opening)}: ${errors[0]}`);
  }
  assert.equal(errorsOf(parseStanding(FULL.replace("builtin:brief", "builtin:nope")), "builtin:nope")[0],
    'orders[0] (preclose): producer names an unknown builtin "nope"');
  assert.deepEqual(errorsOf(parseStanding(FULL.replace("    producer: builtin:brief\n", "").replace("wake: true", "wake: false").replace("close-30m", "close-4m")),
    "wake: false, no producer, close-4m"),
  ["orders[0] (preclose): wake is false, so it needs a producer: an order with neither runs nothing"],
  "one fault, one line: an order that runs nothing has no room to ask about");
  assert.ok(errorsOf(parseStanding(FULL + ORDER), "a second id")[0].startsWith("orders[1] (preclose): id preclose "));
  assert.deepEqual(errorsOf(parseStanding(FULL.replace("dailyTokens: 2000000", "dailyToken: 2000000")), "budget.dailyToken"),
    ["budget.dailyToken is not a key budget takes (dailyTokens)", "budget.dailyTokens is missing"], "unknown keys are refused in the budget too");

  /* no orders */
  for (const empty of ["", "# notes\n", "orders:\n", "---\n", "orders: []\n"]) {
    assert.deepEqual(parseStanding(empty), { ok: true, orders: [] }, JSON.stringify(empty));
  }
  assert.deepEqual(parseStanding("budget:\n  dailyTokens: 5\n"), { ok: true, budget: { dailyTokens: 5 }, orders: [] });

  /* the file itself */
  const big = `#${"x".repeat(STANDING_YAML_MAX_BYTES - 1)}\n`;
  assert.equal(Buffer.byteLength(big), 65_537);
  assert.deepEqual(parseStanding(big), { ok: false, errors: ["standing.yml is 65,537 bytes; the limit is 65,536"] });
  const tab = errorsOf(parseStanding("orders:\n\t- id: a\n"), "a tab");
  assert.ok(tab[0].startsWith("standing.yml is not YAML:"), tab[0]);
  assert.ok(!tab[0].includes("\n"), "one line");
  /* the parser's line quotes the file: cut at 60 characters and every control or direction character escaped (p2-m13) */
  const tagged = errorsOf(parseStanding(`budget: !\u202e${"x".repeat(200)} 1\n`), "an unknown tag");
  assert.ok(tagged[0].startsWith("standing.yml is not YAML: unknown tag"), tagged[0]);
  assert.ok(tagged[0].includes("\\u202e") && !tagged[0].includes("\u202e"), `the override is escaped: ${tagged[0]}`);
  assert.ok(tagged[0].endsWith("…") && [...tagged[0].slice("standing.yml is not YAML: ".length)].length <= 70, tagged[0]);
  assert.deepEqual(parseStanding("- id: a\n"), { ok: false, errors: ["standing.yml must be a mapping of budget: and orders:"] });
  assert.deepEqual(errorsOf(parseStanding("budget:\n"), "a bare budget"), ["budget must be a mapping with dailyTokens"]);
  assert.equal(errorsOf(parseStanding("orders: [1]\n"), "an order that is not a mapping")[0], "orders[0]: must be a mapping of an order's keys");
  assert.match(errorsOf(parseStanding("orders:\n  - id: x\n"), "a bare order").join("\n"), /dir is missing[\s\S]*at is missing[\s\S]*expires is missing/);

  /* the reader underneath */
  assert.equal(readDeskYaml("d: 2026-11-30\n") instanceof Object, true);
  assert.deepEqual(readDeskYaml("d: 2026-11-30\nt: 15:30\nb: True\n"), { d: "2026-11-30", t: "15:30", b: true });
  assert.throws(() => readDeskYaml("a: 1\na: 2\n"), (e: Error) => e.message.startsWith("duplicated mapping key") && !e.message.includes("\n"));
  assert.ok(isEtDate("2026-11-30"));
  for (const bad of ["2026-02-30", "2026-13-01", "2026-1-01", "Nov 30", 20261130, undefined]) assert.equal(isEtDate(bad), false, String(bad));
  assert.equal(parseStandingDuration("10m", 60_000, 1_800_000), 600_000);
  assert.equal(parseStandingDuration("90s", 10_000, 1_800_000), 90_000);
  for (const bad of ["45m", "5s", "10", "10 m", "1h", 600, "-5m"]) assert.equal(parseStandingDuration(bad, 10_000, 1_800_000), undefined, String(bad));
  assert.equal(GRACE_MS, 300_000);
  assert.equal(STANDING_TEXT_MAX_BYTES, 16_384);
  assert.equal(STANDING_FILE, "standing.yml");
});

test("the room before the close holds the producer, the turn and the 5-minute grace", () => {
  assert.deepEqual(parseStanding(FULL.replace("close-30m", "close-15m")), { ok: false,
    errors: ["orders[0] (preclose): close-15m leaves 15 min before the close; its producer (5 min), its turn (10 min) and the 5-minute grace need 20 min"] });
  assert.ok(parseStanding(FULL.replace("close-30m", "close-20m")).ok, "close-20m holds both and the grace");
  const noProducer = FULL.replace("    producer: builtin:brief\n", "");
  assert.deepEqual(parseStanding(noProducer.replace("close-30m", "close-10m")), { ok: false,
    errors: ["orders[0] (preclose): close-10m leaves 10 min before the close; its turn (10 min) and the 5-minute grace need 15 min"] });
  assert.ok(parseStanding(noProducer.replace("close-30m", "close-15m")).ok);
  const noWake = FULL.replace("wake: true", "wake: false");
  assert.deepEqual(parseStanding(noWake.replace("close-30m", "close-9m")), { ok: false,
    errors: ["orders[0] (preclose): close-9m leaves 9 min before the close; its producer (5 min) and the 5-minute grace need 10 min"] });
  assert.ok(parseStanding(noWake.replace("close-30m", "close-10m")).ok, "no turn: the producer and the grace");
  assert.deepEqual(parseStanding(FULL.replace("close-30m", "close-16m").replace("producerDeadline: 5m", "producerDeadline: 90s")), { ok: false,
    errors: ["orders[0] (preclose): close-16m leaves 16 min before the close; its producer (90 s), its turn (10 min) and the 5-minute grace need 990 s"] });
  assert.ok(parseStanding(FULL.replace("close-30m", "close-17m").replace("producerDeadline: 5m", "producerDeadline: 90s")).ok, "17 min hold 16.5");
  for (const free of ["close+10m", "close", "15:30", "open-10m", "open"]) {
    assert.ok(parseStanding(FULL.replace("close-30m", free)).ok, `${free}: no room rule`);
  }
});

test("an order without its arming fields is refused: not armed", () => {                // Review Focus 3
  assert.deepEqual(parseStanding(FULL.replace(/^\s*armedAt:.*\n/m, "")), { ok: false, errors: ["orders[0] (preclose): not armed: npm run desk -- arm desk …"] });
  assert.deepEqual(parseStanding(FULL.replace(/^\s*sha256:.*\n/m, "")), { ok: false, errors: ["orders[0] (preclose): not armed: npm run desk -- arm desk …"] });
  assert.deepEqual(parseStanding(FULL.replace("builtin:brief", "scripts/p.py")), { ok: false, errors: ["orders[0] (preclose): not armed: npm run desk -- arm desk …"] },
    "a script producer without producerSha256");
  assert.deepEqual(parseStanding(FULL.replace("dir: desk", "dir: strategies/alpha").replace(/^\s*armedAt:.*\n/m, "").replace(/^\s*sha256:.*\n/m, "")),
    { ok: false, errors: ["orders[0] (preclose): not armed: npm run desk -- arm strategies/alpha …"] }, "one line however many fields are missing");

  /* the not-armed orders, labelled for the way out a refusal names */
  const unarmedSecond = `${FULL}  - id: Second\n    dir: desk\n    at: close\n    expires: 2026-11-30\n`;
  const errors = errorsOf(parseStanding(`${unarmedSecond.replace(/^\s*armedAt:.*\n/m, "")}orderz: 1\n`), "two unarmed");
  assert.deepEqual(unarmedOrders(errors), ["orders[0] (preclose)", "orders[1]"], "in file order; one without a good id by its index");
  assert.deepEqual(unarmedOrders(errorsOf(parseStanding(FULL.replace("enabled: true", "enabled: yes")), "armed")), [], "no not-armed fault, no label");
  assert.deepEqual(unarmedOrders(['orders[0] (x): "not armed: npm run desk -- arm desk …" is not a key an order takes']), [], "only the fault itself");
});

test("orderCwd maps desk to desk/journal and strategies/<name> to itself, and refuses the rest", () => {
  const root = "/repo";
  assert.equal(orderCwd(root, "desk"), join(root, "desk", "journal"));
  assert.equal(orderCwd(root, "strategies/alpha"), join(root, "strategies", "alpha"));
  assert.equal(orderCwd(root, "strategies/成长"), join(root, "strategies", "成长"), "a channel name in any script");
  for (const bad of ["desk/journal", "strategies/_template", "x", "strategies/", "strategies/a/b", "strategies/../desk", "strategies/.hidden", "", "./desk",
    "strategies/a b", "Desk"]) {
    assert.throws(() => orderCwd(root, bad), TypeError, bad);
    assert.equal(isOrderDir(bad), false, bad);
  }
  assert.ok(isOrderDir("desk"));
  assert.ok(isOrderDir("strategies/alpha"));
  assert.equal(isOrderDir("strategies/été"), false, "a name not in NFC is refused, as createChannel would never make it");
  assert.equal(isOrderDir(7), false);
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(sha256Hex(Buffer.from("abc")), sha256Hex("abc"));
});

/* ---------- the arming edits ---------- */

/** An entry as `npm run desk -- arm` makes it. */
const ENTRY: ArmEntry = {
  id: "preclose", dir: "desk", file: "STANDING.md", sha256: SHA, at: "close-30m", producer: "builtin:brief", wake: true,
  turnDeadline: "10m", producerDeadline: "5m", expires: "2026-11-30", armedAt: ARMED,
};

/** An armed order `a` with its own hash. */
const ORDER_A = `  - id: a
    dir: desk
    sha256: ${SHA_C}
    at: "15:30"
    expires: 2026-12-31
    armedAt: "${ARMED}"
`;

test("renderOrder writes block YAML in the entry's key order, every string double-quoted", () => {
  assert.equal(renderOrder(ENTRY, 2), [
    '  - id: "preclose"',
    '    dir: "desk"',
    '    file: "STANDING.md"',
    `    sha256: "${SHA}"`,
    '    at: "close-30m"',
    '    producer: "builtin:brief"',
    "    wake: true",
    '    turnDeadline: "10m"',
    '    producerDeadline: "5m"',
    '    expires: "2026-11-30"',
    "    enabled: true",
    `    armedAt: "${ARMED}"`,
    "",
  ].join("\n"));
  const all: ArmEntry = { ...ENTRY, producer: "scripts/p.py", producerSha256: SHA_B, wake: false, model: "deepseek-official/deepseek-v4-pro" };
  assert.equal(renderOrder(all, 0), [
    '- id: "preclose"', '  dir: "desk"', '  file: "STANDING.md"', `  sha256: "${SHA}"`, '  at: "close-30m"', '  producer: "scripts/p.py"',
    `  producerSha256: "${SHA_B}"`, "  wake: false", '  model: "deepseek-official/deepseek-v4-pro"', '  turnDeadline: "10m"', '  producerDeadline: "5m"',
    '  expires: "2026-11-30"', "  enabled: true", `  armedAt: "${ARMED}"`, "",
  ].join("\n"));
});

test("appendOrder appends verified, keeps comments and the budget, and refuses a shape it cannot append to", () => {
  const expected: StandingOrder = { ...PRECLOSE };
  const fromEmpty = appendOrder("", ENTRY);
  assert.ok("text" in fromEmpty, JSON.stringify(fromEmpty));
  assert.equal(fromEmpty.text, `orders:\n${renderOrder(ENTRY, 2)}`);
  assert.deepEqual(parseStanding(fromEmpty.text), { ok: true, orders: [expected] });

  const notes = `# my notes\nbudget:\n  dailyTokens: 2000000\norders:\n${ORDER_A}`;
  const appended = appendOrder(notes, ENTRY);
  assert.ok("text" in appended, JSON.stringify(appended));
  assert.ok(appended.text.startsWith(notes), "the comment, the budget and order a stay as they were");
  const load = parseStanding(appended.text);
  assert.deepEqual(ordersOf(load, "appended").map((o) => o.id), ["a", "preclose"]);
  assert.deepEqual(load.ok && load.budget, { dailyTokens: 2_000_000 });

  const noNewline = appendOrder(`budget:\n  dailyTokens: 5 # a cap`, ENTRY);
  assert.ok("text" in noNewline);
  assert.equal(noNewline.text, `budget:\n  dailyTokens: 5 # a cap\norders:\n${renderOrder(ENTRY, 2)}`, "orders: added at the end, on a line of its own");

  const emptyList = appendOrder("orders: []\n", ENTRY);
  assert.ok("text" in emptyList);
  assert.equal(emptyList.text, `orders:\n${renderOrder(ENTRY, 2)}`, "orders: [] becomes orders:");
  assert.deepEqual(parseStanding(emptyList.text), { ok: true, orders: [expected] });
  for (const none of ["orders: ~", "orders: null", "orders: ~ # none yet"]) {
    const nulled = appendOrder(`budget:\n  dailyTokens: 5\n${none}\n`, ENTRY);
    assert.ok("text" in nulled, `${none}: ${JSON.stringify(nulled)}`);
    assert.equal(nulled.text, `budget:\n  dailyTokens: 5\n${none.replace(/ (~|null)/, "")}\n${renderOrder(ENTRY, 2)}`, `${none} appends like an empty list`);
  }

  const flush = appendOrder(`orders:\n${ORDER_A.replace(/^ {2}/gm, "")}`, ENTRY);
  assert.ok("text" in flush, JSON.stringify(flush));
  assert.ok(flush.text.endsWith(renderOrder(ENTRY, 0)), "the list's own indentation is kept");
  assert.deepEqual(ordersOf(parseStanding(flush.text), "flush").map((o) => o.id), ["a", "preclose"]);

  const byHand = `standing.yml has a shape arm cannot append to safely; add this entry under orders: by hand:\n${renderOrder(ENTRY, 2)}`;
  assert.deepEqual(appendOrder(`orders:\n${ORDER_A}budget:\n  dailyTokens: 5\n`, ENTRY), { error: byHand }, "orders before budget");
  assert.deepEqual(appendOrder(`orders: [{id: a, dir: desk, sha256: ${SHA_C}, at: close, expires: 2026-12-31, armedAt: "${ARMED}"}]\n`, ENTRY), { error: byHand },
    "a flow-style list");
  assert.deepEqual(appendOrder("{budget: {dailyTokens: 5}}\n", ENTRY), { error: byHand }, "a flow-style mapping");
  assert.deepEqual(appendOrder(`orders:\n${ORDER}`, ENTRY), { error: byHand }, "verified: an id that is taken does not re-parse as one more order");
  assert.deepEqual(appendOrder("orderz: 1\n", ENTRY), { error: byHand }, "a file that is refused already");
  assert.deepEqual(appendOrder("", { ...ENTRY, at: "close-10m" }), { error: `standing.yml has a shape arm cannot append to safely; add this entry under orders: by hand:\n${renderOrder({ ...ENTRY, at: "close-10m" }, 2)}` },
    "an entry the file would refuse is never written");
});

test("rehashOrder replaces only that order's hashes", () => {
  const script: ArmEntry = { ...ENTRY, id: "b", sha256: SHA_B, producer: "scripts/p.py", producerSha256: SHA_B };
  const two = `budget:\n  dailyTokens: 5\norders:\n${ORDER_A}${renderOrder(script, 2)}# the end\n`;
  const NEW = "d".repeat(64);
  const NEW_P = "e".repeat(64);
  const rehashed = rehashOrder(two, "b", { sha256: NEW });
  assert.ok("text" in rehashed, JSON.stringify(rehashed));
  assert.equal(rehashed.text, two.replace(`    sha256: "${SHA_B}"`, `    sha256: "${NEW}"`), "only b's sha256 moves");
  const first = rehashOrder(two, "a", { sha256: NEW });
  assert.ok("text" in first, JSON.stringify(first));
  assert.equal(first.text, two.replace(`sha256: ${SHA_C}`, `sha256: "${NEW}"`), "a's block ends where b's opens: b's hashes stay");
  const both = rehashOrder(two, "b", { sha256: NEW, producerSha256: NEW_P });
  assert.ok("text" in both);
  assert.equal(both.text, two.replace(`    sha256: "${SHA_B}"`, `    sha256: "${NEW}"`).replace(`producerSha256: "${SHA_B}"`, `producerSha256: "${NEW_P}"`));
  const plain = rehashOrder(`orders:\n${ORDER_A}`, "a", { sha256: NEW });
  assert.ok("text" in plain);
  assert.equal(plain.text, `orders:\n${ORDER_A.replace(SHA_C, `"${NEW}"`)}`, "a plain id and a plain hash");
  const commented = rehashOrder(`orders:\n${ORDER_A.replace(`sha256: ${SHA_C}`, `sha256: '${SHA_C}' # pinned`)}`, "a", { sha256: NEW });
  assert.ok("text" in commented);
  assert.ok(commented.text.includes(`sha256: "${NEW}" # pinned`), "a comment on the line stays");

  const reordered = `orders:\n  - dir: desk\n    id: b\n    sha256: ${SHA_B}\n    at: close-30m\n    expires: 2026-11-30\n    armedAt: "${ARMED}"\n`;
  assert.ok(parseStanding(reordered).ok);
  const refused = rehashOrder(reordered, "b", { sha256: NEW });
  assert.ok("error" in refused);
  assert.equal(refused.error, `standing.yml has a shape rearm cannot rewrite safely; set these keys of b by hand:\n    sha256: "${NEW}"`,
    "an order whose - id: is not its first line");
  const refusedBoth = rehashOrder(`orders:\n${ORDER_A}`, "a", { sha256: NEW, producerSha256: NEW_P });
  assert.deepEqual(refusedBoth, { error: `standing.yml has a shape rearm cannot rewrite safely; set these keys of a by hand:\n    sha256: "${NEW}"\n    producerSha256: "${NEW_P}"` },
    "a script hash for an order that has no line for one");
  assert.ok("error" in rehashOrder(two, "nope", { sha256: NEW }), "no such order");
  assert.ok("error" in rehashOrder(two, "b", { sha256: "abc" }), "verified: a hash the file would refuse is never written");

  /* rearm --expires: the order's last day moves with its hashes */
  const extended = rehashOrder(two, "a", { sha256: NEW, expires: "2027-01-31" });
  assert.ok("text" in extended, JSON.stringify(extended));
  assert.equal(extended.text, two.replace(`sha256: ${SHA_C}`, `sha256: "${NEW}"`).replace("expires: 2026-12-31", 'expires: "2027-01-31"'),
    "a plain date rewritten double-quoted; b's quoted expires stays");
  const both3 = rehashOrder(two, "b", { sha256: SHA_B, producerSha256: NEW_P, expires: "2027-01-31" });
  assert.ok("text" in both3, JSON.stringify(both3));
  assert.equal(both3.text, two.replace(`producerSha256: "${SHA_B}"`, `producerSha256: "${NEW_P}"`).replace('expires: "2026-11-30"', 'expires: "2027-01-31"'));
  assert.deepEqual(rehashOrder(two, "a", { sha256: NEW, expires: "2027-02-30" }),
    { error: `standing.yml has a shape rearm cannot rewrite safely; set these keys of a by hand:\n    sha256: "${NEW}"\n    expires: "2027-02-30"` },
    "verified: a date the file would refuse is never written");
  const folded = `orders:\n${ORDER_A.replace("    expires: 2026-12-31\n", "    expires: >-\n      2026-12-31\n")}`;
  assert.ok(parseStanding(folded).ok, "a block-scalar date loads");
  assert.ok("error" in rehashOrder(folded, "a", { sha256: NEW, expires: "2027-01-31" }), "verified: a block-scalar date is left to the hand");
});

test("writeStanding makes the desk directory and writes standing.yml 0600, and refuses a file that changed since it was read", async () => {
  const home = join(TEST_DIR, "home");
  await writeStanding(home, "orders:\n");
  const path = join(deskDir(home), STANDING_FILE);
  assert.equal(await readFile(path, "utf8"), "orders:\n");
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  await writeFile(path, "orders: []\n");
  await chmod(path, 0o644);
  await writeStanding(home, FULL, { expect: "orders: []\n" });
  assert.equal(await readFile(path, "utf8"), FULL);
  assert.equal((await stat(path)).mode & 0o777, 0o600, "a hand-made 0644 file is replaced 0600");
  await assert.rejects(writeStanding(home, "orders:\n", { expect: "orders: []\n" }), /changed since it was read/);
  await assert.rejects(writeStanding(home, "orders:\n", { expect: null }), /changed since it was read/, "expected missing, found");
  assert.equal(await readFile(path, "utf8"), FULL, "nothing written");
  const fresh = join(TEST_DIR, "fresh");
  await mkdir(fresh, { recursive: true });
  await assert.rejects(writeStanding(fresh, "orders:\n", { expect: "orders:\n" }), /changed since it was read/, "expected a file, found none");
  await writeStanding(fresh, "orders:\n", { expect: null });
  assert.equal(await readFile(join(deskDir(fresh), STANDING_FILE), "utf8"), "orders:\n");
});
