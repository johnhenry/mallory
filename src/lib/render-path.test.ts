import assert from "node:assert/strict";
import { test } from "node:test";
import { hexToRgba } from "./render-path.ts";

test("hexToRgba: decomposes a 0xRRGGBB color into its channels, hand-computed", () => {
  assert.equal(hexToRgba(0x2563eb, 0.25), "rgba(37, 99, 235, 0.25)");
  assert.equal(hexToRgba(0xdc2626, 0.5), "rgba(220, 38, 38, 0.5)");
});

test("hexToRgba: black and white edge cases", () => {
  assert.equal(hexToRgba(0x000000, 1), "rgba(0, 0, 0, 1)");
  assert.equal(hexToRgba(0xffffff, 0), "rgba(255, 255, 255, 0)");
});
