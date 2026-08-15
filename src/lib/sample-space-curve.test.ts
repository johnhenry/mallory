import assert from "node:assert/strict";
import { test } from "node:test";
import { sampleSpaceCurve } from "./sample-space-curve.ts";

test("sampleSpaceCurve: a quarter-circle in the xy-plane, hand-computed against cos/sin", () => {
  const points = sampleSpaceCurve("cos(t)", "sin(t)", "0", { min: 0, max: Math.PI / 2 }, 2);
  assert.equal(points.length, 3);
  assert.deepEqual(points[0], { x: 1, y: 0, z: 0 });
  assert.ok(Math.abs((points[1]?.x ?? NaN) - Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs((points[1]?.y ?? NaN) - Math.SQRT1_2) < 1e-12);
  assert.equal(points[1]?.z, 0);
  assert.ok(Math.abs(points[2]?.x ?? NaN) < 1e-15); // cos(pi/2) ~ 0 up to float error
  assert.ok(Math.abs((points[2]?.y ?? NaN) - 1) < 1e-12);
});

test("sampleSpaceCurve: resolution N samples N+1 evenly-spaced points across [tMin, tMax]", () => {
  const points = sampleSpaceCurve("t", "t", "t", { min: 0, max: 1 }, 10);
  assert.equal(points.length, 11);
  assert.deepEqual(points[0], { x: 0, y: 0, z: 0 });
  assert.deepEqual(points[10], { x: 1, y: 1, z: 1 });
  assert.deepEqual(points[5], { x: 0.5, y: 0.5, z: 0.5 });
});

test("sampleSpaceCurve: a pole (division by zero) at a single sample is skipped, not aborting the whole curve", () => {
  // t in [-1, 1], resolution 4 -> samples at t = -1, -0.5, 0, 0.5, 1; z=1/t blows up exactly at t=0.
  const points = sampleSpaceCurve("t", "t", "1/t", { min: -1, max: 1 }, 4);
  assert.equal(points.length, 4); // the t=0 sample is dropped, the other 4 survive
  assert.deepEqual(points, [
    { x: -1, y: -1, z: -1 },
    { x: -0.5, y: -0.5, z: -2 },
    { x: 0.5, y: 0.5, z: 2 },
    { x: 1, y: 1, z: 1 },
  ]);
});

test("sampleSpaceCurve: an entirely-degenerate expression (constant NaN) returns no points at all", () => {
  assert.deepEqual(sampleSpaceCurve("0/0", "t", "t", { min: 0, max: 1 }, 5), []);
});
