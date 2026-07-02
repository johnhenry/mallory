import assert from "node:assert/strict";
import { test } from "node:test";
import { Logic } from "../src/Logic.ts";

test("truth / falsehood ignore arguments", () => {
  assert.equal(Logic.truth(1, "x", null), true);
  assert.equal(Logic.falsehood(1, "x", null), false);
});

test("and / or", () => {
  assert.equal(Logic.and(true, true), true);
  assert.equal(Logic.and(true, false), false);
  assert.equal(Logic.or(false, true), true);
  assert.equal(Logic.or(false, false), false);
});

test("xor is exclusive", () => {
  assert.equal(Logic.xor(true, false), true);
  assert.equal(Logic.xor(true, true), false);
  assert.equal(Logic.xor(false, false), false);
});

test("not", () => {
  assert.equal(Logic.not(false), true);
  assert.equal(Logic.not(1), false);
});
