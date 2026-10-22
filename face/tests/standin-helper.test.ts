/** The stand-in helper the smokes share (tests/helpers/standin.ts), offline: the recursive rm after a smoke takes only a
 * stand-in's own home, and no stand-in is ever started on the real Account's port. */
import test from "node:test";
import assert from "node:assert/strict";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { REAL_ACCOUNT_PORT, isStandinHome, startStandin } from "./helpers/standin.ts";

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
