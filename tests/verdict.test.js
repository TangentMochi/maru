import { test } from "node:test";
import assert from "node:assert/strict";
import { verdict } from "../src/js/verdict.js";

test("200番台は YES", () => {
  for (const status of [200, 201, 204, 299]) assert.equal(verdict(status), "YES");
});

test("400番台は 再考", () => {
  for (const status of [400, 401, 404, 429, 499]) {
    assert.equal(verdict(status), "再考", String(status));
  }
});

test("それ以外は NO", () => {
  for (const status of [100, 199, 300, 304, 399, 500, 503]) {
    assert.equal(verdict(status), "NO", String(status));
  }
});

test("応答がなければ NO", () => {
  assert.equal(verdict(null), "NO");
});
