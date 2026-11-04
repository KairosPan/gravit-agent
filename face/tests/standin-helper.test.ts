/** The stand-in helper the smokes share (tests/helpers/standin.ts), offline: the recursive rm after a smoke takes only a
 * stand-in's own home, and no stand-in is ever started on the real Account's port. */
import test from "node:test";
import assert from "node:assert/strict";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { REAL_ACCOUNT_PORT, REAL_MARKET_PORT, isStandinHome, parseStandinLines, standinDir, standinSkipFor, startStandin } from "./helpers/standin.ts";
import { seatDir } from "../src/account-seat.ts";

test("the stand-in's home guard takes a ui-standin- directory directly under tmpdir() and nothing else", () => {
  assert.equal(isStandinHome(join(tmpdir(), "ui-standin-cipTOK")), true, "the home the stand-in makes for itself");
  for (const path of [
    tmpdir(),
    join(tmpdir(), "ui-standin-"),
    join(tmpdir(), "ui-standin-cipTOK", ".."),
    join(tmpdir(), "ui-standin-cipTOK", "ledger"),
    join(tmpdir(), "elsewhere", "ui-standin-cipTOK"),
    join(tmpdir(), "face-seat-home-cipTOK"),
    join(tmpdir(), "ui-standin-cip TOK"),
    join(homedir(), ".buyer-agent-demo"),
    join(homedir(), "ui-standin-cipTOK"),
    "ui-standin-cipTOK",
  ]) assert.equal(isStandinHome(path), false, path);
});

test("no stand-in is started on the real Account's port", async () => {
  await assert.rejects(startStandin(REAL_ACCOUNT_PORT), /4820 is the real Account's/);
});

test("the stand-in's directory falls back to the face's seatDir() when FACE_ACCOUNT_SEAT_DIR is unset", () => {
  assert.equal(standinDir({}), seatDir());
  assert.equal(standinDir({ FACE_ACCOUNT_SEAT_DIR: "/tmp/x" }), "/tmp/x");
});
test("skips with the install line when the directory has no tsx", () => {
  assert.match(String(standinSkipFor({ FACE_SMOKE: "1" }, "/nonexistent/account")), /npm ci in account\//);
});

test("the helper parses the market line beside the account, pairing code and home lines", () => {
  const printed = [
    "STAND-IN ACCOUNT · no network, no real money: every venue, price and fill on it is made up (test/standin)",
    "  account       http://127.0.0.1:51234  — no page: start the face with FACE_ACCOUNT_URL=http://127.0.0.1:51234",
    "  market        http://127.0.0.1:51235  — start the face with FACE_MARKET_URL=http://127.0.0.1:51235",
    "  pairing code  ABCD-EFGH  — type it on Gravit's face (Account): your browser becomes an owner beside the stand-in's seed key",
    "  home          /tmp/ui-standin-cipTOK  (fresh, kept after you stop; its ledger is /tmp/ui-standin-cipTOK/ledger.jsonl)",
  ].join("\n");
  assert.deepEqual(parseStandinLines(printed), { url: "http://127.0.0.1:51234", marketUrl: "http://127.0.0.1:51235", code: "ABCD-EFGH", home: "/tmp/ui-standin-cipTOK" });
  const noMarket = printed.split("\n").filter((line) => !/^\s*market\s/.test(line)).join("\n");
  assert.equal(parseStandinLines(noMarket), undefined, "a stand-in that prints no market line is not yet started (an older one is waited on, then reported)");
  assert.equal(parseStandinLines(printed.split("\n").slice(0, 2).join("\n")), undefined, "the lines not yet all written");
});

test("no stand-in is started on the market's port either", async () => {
  assert.equal(REAL_MARKET_PORT, 4821);
  await assert.rejects(startStandin(REAL_MARKET_PORT), /4821 is the market's/);
});
