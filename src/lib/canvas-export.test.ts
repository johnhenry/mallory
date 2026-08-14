import assert from "node:assert/strict";
import { test } from "node:test";
import { pngExportFilename } from "./canvas-export.ts";

test("pngExportFilename: a plain lowercase label", () => {
  assert.equal(pngExportFilename("graphing"), "mallory-graph-graphing.png");
});

test("pngExportFilename: spaces and mixed case are slugified", () => {
  assert.equal(pngExportFilename("Complex Plane"), "mallory-graph-complex-plane.png");
});

test("pngExportFilename: special characters collapse to single hyphens", () => {
  assert.equal(pngExportFilename("f(z) = z^2 + 1"), "mallory-graph-f-z-z-2-1.png");
});

test("pngExportFilename: leading/trailing punctuation is trimmed, not left as a leading/trailing hyphen", () => {
  assert.equal(pngExportFilename("  --signal--  "), "mallory-graph-signal.png");
});

test("pngExportFilename: an empty or all-punctuation label falls back to 'export'", () => {
  assert.equal(pngExportFilename(""), "mallory-graph-export.png");
  assert.equal(pngExportFilename("###"), "mallory-graph-export.png");
});
