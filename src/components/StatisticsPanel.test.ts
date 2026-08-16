import assert from "node:assert/strict";
import { test } from "node:test";
import { residualPlot, smoothingPlot } from "./StatisticsPanel.tsx";

test("smoothingPlot: viewport spans [0, data.length-1] and +/-10% padding around the combined raw+smoothed y-range, hand-computed", () => {
  const { viewport, rawPoints, smoothedPoints } = smoothingPlot([1, 3, 2, 5], { indices: [1, 2], values: [2, 4] });
  // allY = [1,3,2,5,2,4] -> min=1, max=5, pad = (5-1)*0.1 = 0.4.
  assert.equal(viewport.xMin, 0);
  assert.equal(viewport.xMax, 3);
  assert.ok(Math.abs(viewport.yMin - 0.6) < 1e-12, `yMin: ${viewport.yMin}`);
  assert.ok(Math.abs(viewport.yMax - 5.4) < 1e-12, `yMax: ${viewport.yMax}`);
  assert.deepEqual(rawPoints, [
    { x: 0, y: 1 },
    { x: 1, y: 3 },
    { x: 2, y: 2 },
    { x: 3, y: 5 },
  ]);
  assert.deepEqual(smoothedPoints, [
    { x: 1, y: 2 },
    { x: 2, y: 4 },
  ]);
});

test("smoothingPlot: a flat (all-equal) raw+smoothed series gets a tiny non-zero padding (the 1e-9 floor), not a degenerate zero-height viewport", () => {
  const { viewport } = smoothingPlot([2, 2], { indices: [0, 1], values: [2, 2] });
  assert.equal(viewport.yMin, 2 - 1e-9);
  assert.equal(viewport.yMax, 2 + 1e-9);
});

test("smoothingPlot: an empty data array produces an empty rawPoints array and an xMax of -1 (matches data.length-1)", () => {
  const { viewport, rawPoints } = smoothingPlot([], { indices: [], values: [] });
  assert.equal(viewport.xMax, -1);
  assert.deepEqual(rawPoints, []);
});

test("residualPlot: viewport spans [0, last smoothed index] and +/-10% around the peak absolute residual, hand-computed", () => {
  const { viewport, points } = residualPlot({ indices: [1, 2], values: [2, 4] }, [1, -2]);
  // maxAbs = max(1, 2) = 2, so yMin/yMax = -2.2/2.2.
  assert.equal(viewport.xMin, 0);
  assert.equal(viewport.xMax, 2);
  assert.ok(Math.abs(viewport.yMin - -2.2) < 1e-12, `yMin: ${viewport.yMin}`);
  assert.ok(Math.abs(viewport.yMax - 2.2) < 1e-12, `yMax: ${viewport.yMax}`);
  assert.deepEqual(points, [
    { x: 1, y: 1 },
    { x: 2, y: -2 },
  ]);
});

test("residualPlot: all-zero residuals get a tiny non-zero viewport height (the 1e-9 floor, then +/-10% padding)", () => {
  const { viewport } = residualPlot({ indices: [0, 1], values: [1, 1] }, [0, 0]);
  assert.ok(Math.abs(viewport.yMin - -1.1e-9) < 1e-15, `yMin: ${viewport.yMin}`);
  assert.ok(Math.abs(viewport.yMax - 1.1e-9) < 1e-15, `yMax: ${viewport.yMax}`);
});

test("residualPlot: an empty indices array falls back to xMax=0 (the ?? 0 default), not NaN/undefined", () => {
  const { viewport } = residualPlot({ indices: [], values: [] }, []);
  assert.equal(viewport.xMax, 0);
});
