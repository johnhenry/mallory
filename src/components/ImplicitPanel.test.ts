import assert from "node:assert/strict";
import { test } from "node:test";
import { boundOrDefault } from "./ImplicitPanel.tsx";

test("boundOrDefault: a literal \"0\" is used as-is, not treated as falsy (the bug: Number(x) || fallback discards it)", () => {
  assert.equal(boundOrDefault("0", -5), 0);
});

test("boundOrDefault: a genuinely non-numeric string falls back to the default", () => {
  assert.equal(boundOrDefault("not a number", -5), -5);
});

test("boundOrDefault: an empty string is JS's own Number('') === 0 quirk, not a parse failure -- returns 0, not the fallback", () => {
  assert.equal(boundOrDefault("", -5), 0);
});

test("boundOrDefault: an ordinary numeric string passes through unchanged", () => {
  assert.equal(boundOrDefault("3.3", -5), 3.3);
  assert.equal(boundOrDefault("-2", 5), -2);
});
