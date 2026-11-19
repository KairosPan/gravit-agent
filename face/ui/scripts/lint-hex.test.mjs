import assert from "node:assert/strict";
import { test } from "node:test";

import { hexHits, lintHex } from "./lint-hex.mjs";

test("a hex colour is a hit, and a route or word is not", () => {
  assert.deepEqual(hexHits("fill: #5EEBDD; border: #fff"), ["#5EEBDD", "#fff"]);
  assert.deepEqual(hexHits("open /kitchen-sink and #/markets"), []);
  assert.deepEqual(hexHits("the token file is tokens.css"), []);
});

test("the app source has no raw hex outside the token file", () => {
  assert.deepEqual(lintHex(), []);
});
