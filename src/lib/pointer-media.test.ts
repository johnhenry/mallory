import assert from "node:assert/strict";
import { test } from "node:test";
import { isCoarsePointer } from "./pointer-media.ts";

test("isCoarsePointer: SSR-safe -- false when there's no document/matchMedia", () => {
  assert.equal(typeof window, "undefined");
  assert.equal(isCoarsePointer(), false);
});
