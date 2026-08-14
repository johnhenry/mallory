import assert from "node:assert/strict";
import { test } from "node:test";
import { getThemeColors } from "./theme-colors.ts";

test("getThemeColors: falls back to the light-theme palette when document isn't available (SSR/plain Node)", () => {
  assert.equal(typeof document, "undefined"); // sanity: this test environment has no DOM
  const colors = getThemeColors();
  assert.equal(colors.ink, "#1c2531");
  assert.equal(colors.inkSoft, "#47536b");
  assert.equal(colors.muted, "#64748b");
});
