import assert from "node:assert/strict";
import { test } from "node:test";
import { regressionPlot } from "./RegressionPanel.tsx";

test("regressionPlot: a not-ok fit returns null", () => {
  assert.equal(regressionPlot({ ok: false, message: "bad" }, "a", "leastSquares", null, false), null);
});

test("regressionPlot: linear fit, hand-computed viewport/curve/scatter, no outliers requested", () => {
  const fit = {
    ok: true as const,
    kind: "linear" as const,
    slope: 1,
    intercept: 0,
    r: 1,
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ],
  };
  const plot = regressionPlot(fit, "a", "leastSquares", null, false);
  assert.ok(plot);
  // autoViewport: xMin=0,xMax=2,yMin=0,yMax=2 -> pad = (2-0)*0.15 = 0.3 on both axes.
  assert.ok(Math.abs(plot.viewport.xMin - -0.3) < 1e-12);
  assert.ok(Math.abs(plot.viewport.xMax - 2.3) < 1e-12);
  assert.ok(Math.abs(plot.viewport.yMin - -0.3) < 1e-12);
  assert.ok(Math.abs(plot.viewport.yMax - 2.3) < 1e-12);
  assert.deepEqual(plot.scatterPoints, fit.points);
  // curve line spans the viewport's own x-range, y = slope*x + intercept = x.
  assert.ok(plot.curvePath);
  assert.equal(plot.curvePath.commands.length, 2);
  assert.deepEqual(plot.curvePath.commands[0], { op: "moveTo", x: -0.3, y: -0.3 });
  assert.deepEqual(plot.curvePath.commands[1], { op: "lineTo", x: 2.3, y: 2.3 });
  assert.deepEqual(plot.outlierPoints, []);
});

test("regressionPlot: outlier detection reuses the exact hand-computed MAD fixture from robust-regression.test.ts, only when showOutliers is on", () => {
  const fit = {
    ok: true as const,
    kind: "linear" as const,
    slope: 1,
    intercept: 0,
    r: 0.9,
    points: [
      { x: 0, y: -1 },
      { x: 1, y: 1.5 },
      { x: 2, y: 1.5 },
      { x: 3, y: 4 },
      { x: 4, y: 4 },
      { x: 5, y: 25 },
    ],
  };
  const withOutliers = regressionPlot(fit, "a", "leastSquares", null, true);
  assert.ok(withOutliers);
  assert.deepEqual(withOutliers.outlierPoints, [{ x: 5, y: 25 }]);

  const withoutOutliers = regressionPlot(fit, "a", "leastSquares", null, false);
  assert.ok(withoutOutliers);
  assert.deepEqual(withoutOutliers.outlierPoints, []);
});

test("regressionPlot: huber loss mode uses the Huber fit's own slope/intercept for the curve and outlier detection, not the least-squares fit's", () => {
  const fit = {
    ok: true as const,
    kind: "linear" as const,
    slope: 1,
    intercept: 0,
    r: 0.9,
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ],
  };
  const huberFitResult = { ok: true as const, value: { slope: 2, intercept: 3 } };
  const plot = regressionPlot(fit, "a", "huber", huberFitResult, false);
  assert.ok(plot);
  // autoViewport: xMin=0,xMax=10 -> xPad=1.5; yMin=0,yMax=10 -> yPad=1.5.
  // Curve uses the HUBER slope/intercept (2, 3), not the least-squares fit's (1, 0).
  assert.ok(plot.curvePath);
  const [start, end] = plot.curvePath.commands;
  assert.ok(Math.abs((start as { y: number }).y - (2 * -1.5 + 3)) < 1e-12);
  assert.ok(Math.abs((end as { y: number }).y - (2 * 11.5 + 3)) < 1e-12);
});

test("regressionPlot: huber mode with no successful huber fit yet falls back to the least-squares fit's own slope/intercept", () => {
  const fit = {
    ok: true as const,
    kind: "linear" as const,
    slope: 1,
    intercept: 0,
    r: 0.9,
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ],
  };
  const plot = regressionPlot(fit, "a", "huber", null, false);
  assert.ok(plot);
  const [start] = plot.curvePath!.commands;
  // Falls back to the least-squares slope/intercept (1, 0): y = 1*xMin + 0 = xMin.
  assert.ok(Math.abs((start as { x: number; y: number }).y - (start as { x: number }).x) < 1e-12);
});

test("regressionPlot: nonlinear fit with exactly one finite sample yields a null curvePath (a single point can't draw a meaningful line)", () => {
  const fit = {
    ok: true as const,
    kind: "nonlinear" as const,
    paramOrder: [],
    params: {},
    residualNorm: 0,
    rSquared: 1,
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ],
  };
  // autoViewport([0,10] x-range, [0,0] y-range): xPad=(10-0)*0.15=1.5 -> viewport.xMin=-1.5, viewport.xMax=11.5.
  // "sqrt(x - 11.5)" is finite (=0) ONLY at x=11.5, the sampling formula's own
  // i=199 (last) sample, which always lands exactly on viewport.xMax -- NaN at
  // every other of the 200 evenly-spaced samples (verified empirically: NaN at
  // x=10 and x=0 via a standalone Symbolic.compile check).
  const plot = regressionPlot(fit, "sqrt(x - 11.5)", "leastSquares", null, false);
  assert.ok(plot);
  assert.equal(plot.curvePath, null);
});

test("regressionPlot: nonlinear fit samples the model expression across the viewport, hand-verifiable for a constant model", () => {
  const fit = {
    ok: true as const,
    kind: "nonlinear" as const,
    paramOrder: ["a"],
    params: { a: 7 },
    residualNorm: 0,
    rSquared: 1,
    points: [
      { x: 0, y: 5 },
      { x: 10, y: 5 },
    ],
  };
  const plot = regressionPlot(fit, "a", "leastSquares", null, false);
  assert.ok(plot);
  // Model "a" ignores x, so every sampled y equals params.a = 7, all 200 samples finite.
  assert.ok(plot.curvePath);
  assert.equal(plot.curvePath.commands.length, 200);
  for (const cmd of plot.curvePath.commands) {
    assert.ok(Math.abs((cmd as { y: number }).y - 7) < 1e-9);
  }
  // First/last x hit the viewport's own xMin/xMax exactly (i=0 and i=199 of the sampling formula).
  assert.ok(Math.abs((plot.curvePath.commands[0] as { x: number }).x - plot.viewport.xMin) < 1e-9);
  assert.ok(Math.abs((plot.curvePath.commands[199] as { x: number }).x - plot.viewport.xMax) < 1e-9);
});
