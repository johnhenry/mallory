import assert from "node:assert/strict";
import { test } from "node:test";
import { COARSE_POINTER_HIT_RADIUS_MULTIPLIER, isCoarsePointer } from "./pointer-media.ts";

test("isCoarsePointer: SSR-safe -- false when there's no document/matchMedia", () => {
  assert.equal(typeof window, "undefined");
  assert.equal(isCoarsePointer(), false);
});

test("COARSE_POINTER_HIT_RADIUS_MULTIPLIER: the shared widening factor every panel's hit-radius call sites use (issue #106's established value)", () => {
  assert.equal(COARSE_POINTER_HIT_RADIUS_MULTIPLIER, 2.5);
});
