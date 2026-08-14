import assert from "node:assert/strict";
import { test } from "node:test";
import { computeContourLevels } from "./contour-plot.ts";

test("computeContourLevels: x^2+y^2 over [-3,3]^2 gives evenly-spaced levels strictly between the field's sampled min (~0) and max (~18)", () => {
  const levels = computeContourLevels("x^2 + y^2", { min: -3, max: 3 }, { min: -3, max: 3 }, 60, 5);
  assert.equal(levels.length, 5);
  for (const l of levels) {
    assert.ok(l.level > 0 && l.level < 18, `level ${l.level} should be strictly inside (0, 18)`);
    assert.ok(l.segments.length > 0, `level ${l.level} should trace a nonempty contour`);
  }
  // Evenly spaced: consecutive gaps should all be equal (within float tolerance).
  const gaps = levels.slice(1).map((l, i) => l.level - (levels[i] as { level: number }).level);
  for (const g of gaps) assert.ok(Math.abs(g - (gaps[0] as number)) < 1e-6);
});

test("computeContourLevels: a larger level (farther from the field's minimum at the origin) traces a larger circle", () => {
  const levels = computeContourLevels("x^2 + y^2", { min: -5, max: 5 }, { min: -5, max: 5 }, 80, 3);
  // For x^2+y^2=c, every point on the contour is at radius sqrt(c) from the origin.
  for (const l of levels) {
    const expectedRadius = Math.sqrt(l.level);
    for (const s of l.segments) {
      const r1 = Math.hypot(s.x1, s.y1);
      assert.ok(Math.abs(r1 - expectedRadius) < 0.3, `level ${l.level}: point (${s.x1},${s.y1}) at radius ${r1}, expected ~${expectedRadius}`);
    }
  }
});

test("computeContourLevels: throws a clear error for a field that's constant over the domain", () => {
  assert.throws(() => computeContourLevels("5", { min: -1, max: 1 }, { min: -1, max: 1 }, 20, 3), /constant/);
});

test("computeContourLevels: respects the requested level count", () => {
  const levels = computeContourLevels("x + y", { min: -2, max: 2 }, { min: -2, max: 2 }, 40, 10);
  assert.equal(levels.length, 10);
});
