import assert from "node:assert/strict";
import { test } from "node:test";
import { convergencePlot, dartPlot, histogramPlot } from "./MonteCarloPanel.tsx";

test("dartPlot: a not-ok result returns null", () => {
  assert.equal(dartPlot({ ok: false, message: "bad" }), null);
});

test("dartPlot: splits points into inside/outside by their own .inside flag, fixed [-1,1]x[-1,1] viewport", () => {
  const result = {
    ok: true as const,
    result: {
      piEstimate: 3.2,
      n: 4,
      points: [
        { x: 0.1, y: 0.1, inside: true },
        { x: 0.9, y: 0.9, inside: false },
        { x: -0.2, y: 0.3, inside: true },
        { x: 0.95, y: -0.9, inside: false },
      ],
      convergence: [],
    },
  };
  const plot = dartPlot(result);
  assert.ok(plot);
  assert.deepEqual(plot.viewport, { xMin: -1, xMax: 1, yMin: -1, yMax: 1 });
  assert.deepEqual(plot.insidePoints, [
    { x: 0.1, y: 0.1 },
    { x: -0.2, y: 0.3 },
  ]);
  assert.deepEqual(plot.outsidePoints, [
    { x: 0.9, y: 0.9 },
    { x: 0.95, y: -0.9 },
  ]);
});

test("convergencePlot: a not-ok result, or an ok result with zero convergence points, returns null", () => {
  assert.equal(convergencePlot({ ok: false, message: "bad" }), null);
  assert.equal(convergencePlot({ ok: true, result: { piEstimate: 3, n: 0, points: [], convergence: [] } }), null);
});

test("convergencePlot: viewport is [0,n]x[2.5,4] (pi=3.14159... comfortably inside), so piReferenceLine spans the full x-range at y=pi", () => {
  const result = {
    ok: true as const,
    result: {
      piEstimate: 3.1,
      n: 500,
      points: [],
      convergence: [
        { n: 100, estimate: 3.0 },
        { n: 500, estimate: 3.1 },
      ],
    },
  };
  const plot = convergencePlot(result);
  assert.ok(plot);
  assert.deepEqual(plot.viewport, { xMin: 0, xMax: 500, yMin: 2.5, yMax: 4 });
  assert.deepEqual(plot.points, [
    { x: 100, y: 3.0 },
    { x: 500, y: 3.1 },
  ]);
  assert.deepEqual(plot.piReferenceLine, [
    { x: 0, y: Math.PI },
    { x: 500, y: Math.PI },
  ]);
});

// The null-piReferenceLine branch (pi entirely outside [yMin,yMax]) is
// unreachable through this function's real caller: the panel's viewport is
// always the fixed [2.5,4] constant above, which always contains pi. This
// null check was already present in the pre-refactor inline draw-effect
// code (same condition, same reachability) -- carried over unchanged by
// this extraction, not new logic introduced here.

test("histogramPlot: a not-ok result returns null", () => {
  assert.equal(histogramPlot({ ok: false, message: "bad" }), null);
});

test("histogramPlot: viewport spans the first bin's x0 to the last bin's x1, y up to the max count", () => {
  const stroke = { thickness: 1, color: 0x000000, alpha: 1, pixelHinting: false, scaleMode: "normal" as const, caps: null, joints: null, miterLimit: 3 };
  const result = {
    ok: true as const,
    result: {
      bins: [
        { x0: 0, x1: 2, count: 3 },
        { x0: 2, x1: 4, count: 7 },
        { x0: 4, x1: 6, count: 1 },
      ],
      sampleMean: 0,
      sampleVariance: 0,
      theoreticalMean: 0,
      theoreticalVariance: 0,
      densityPath: { stroke, commands: [{ op: "moveTo" as const, x: 1, y: 0.2 }] },
    },
  };
  const plot = histogramPlot(result);
  assert.ok(plot);
  assert.deepEqual(plot.viewport, { xMin: 0, xMax: 6, yMin: 0, yMax: 7 });
  assert.deepEqual(plot.bins, result.result.bins);
});

test("histogramPlot: rescales the density path into count-space -- its own max sample maps to maxCount, other samples scale proportionally", () => {
  const stroke = { thickness: 1.5, color: 0x2563eb, alpha: 1, pixelHinting: false, scaleMode: "normal" as const, caps: null, joints: null, miterLimit: 3 };
  const result = {
    ok: true as const,
    result: {
      bins: [{ x0: 0, x1: 1, count: 10 }],
      sampleMean: 0,
      sampleVariance: 0,
      theoreticalMean: 0,
      theoreticalVariance: 0,
      // maxDensity = 0.8, maxCount = 10 -> scale factor 10/0.8 = 12.5
      densityPath: {
        stroke,
        commands: [
          { op: "moveTo" as const, x: 0, y: 0.4 },
          { op: "lineTo" as const, x: 0.5, y: 0.8 },
          { op: "lineTo" as const, x: 1, y: 0.2 },
        ],
      },
    },
  };
  const plot = histogramPlot(result);
  assert.ok(plot);
  assert.deepEqual(
    plot.densityPath.commands.map((c) => c.y),
    [5, 10, 2.5],
  );
  // x, op, and the path's own stroke pass through unchanged.
  assert.deepEqual(
    plot.densityPath.commands.map((c) => c.x),
    [0, 0.5, 1],
  );
  assert.equal(plot.densityPath.stroke, stroke);
});
