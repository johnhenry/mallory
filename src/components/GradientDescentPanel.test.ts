import assert from "node:assert/strict";
import { test } from "node:test";
import { descentPathTo3DPoints, maxDescentSteps, STEP_SECONDS, visiblePathIndex, type OptimizerRun } from "./GradientDescentPanel.tsx";
import type { DescentPoint } from "../lib/gradient-descent.ts";

function fakeRun(optimizer: OptimizerRun["optimizer"], pathLength: number): OptimizerRun {
  const path = Array.from({ length: pathLength }, (_, i) => ({ x: i, y: i, f: i }));
  return { optimizer, result: { path, stoppedEarly: false } };
}

test("maxDescentSteps: no runs at all gives 0 steps, not -Infinity", () => {
  assert.equal(maxDescentSteps([]), 0);
});

test("maxDescentSteps: takes the longest racing path's step count (path length - 1 -- the initial point isn't a step)", () => {
  const runs = [fakeRun("sgd", 5), fakeRun("adam", 8), fakeRun("rmsprop", 3)];
  assert.equal(maxDescentSteps(runs), 7);
});

test("visiblePathIndex: time=0 shows only the initial point (index 0)", () => {
  assert.equal(visiblePathIndex(0, 5), 0);
});

test(`visiblePathIndex: hand-computed at time=0.25s with STEP_SECONDS=${STEP_SECONDS} -- floor(0.25/${STEP_SECONDS})=2`, () => {
  assert.equal(STEP_SECONDS, 0.1, "test assumes STEP_SECONDS=0.1 -- update the hand computation above if this changes");
  assert.equal(visiblePathIndex(0.25, 5), 2);
});

test("visiblePathIndex: a time far past the path's own duration clamps to the last valid index, not an out-of-bounds one", () => {
  assert.equal(visiblePathIndex(100, 5), 4);
});

test("descentPathTo3DPoints: an empty path gives an empty point list", () => {
  assert.deepEqual(descentPathTo3DPoints([], 5), []);
});

test("descentPathTo3DPoints: hand-computed axis mapping (mallory's height f -> Three's y, mallory's y -> Three's z) and time-gated growth", () => {
  const path: DescentPoint[] = [
    { x: 0, y: 0, f: 10 },
    { x: 1, y: 2, f: 20 },
    { x: 3, y: 4, f: 30 },
  ];
  // time=0.15, STEP_SECONDS=0.1 -> visiblePathIndex = floor(1.5) = 1, so
  // only the first two points are visible (the third stays hidden).
  assert.equal(STEP_SECONDS, 0.1, "test assumes STEP_SECONDS=0.1 -- update the hand computation above if this changes");
  assert.deepEqual(descentPathTo3DPoints(path, 0.15), [
    { x: 0, y: 10, z: 0 },
    { x: 1, y: 20, z: 2 },
  ]);
});

test("descentPathTo3DPoints: time=0 shows only the initial point, still correctly axis-mapped", () => {
  const path: DescentPoint[] = [{ x: 5, y: 6, f: 7 }];
  assert.deepEqual(descentPathTo3DPoints(path, 0), [{ x: 5, y: 7, z: 6 }]);
});
