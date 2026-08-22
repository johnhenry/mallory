import { ComplexNumber } from "@johnhenry/math";
import assert from "node:assert/strict";
import { test } from "node:test";
import { rootsPlot } from "./MatrixPanel.tsx";

test("rootsPlot: a not-ok result returns null", () => {
  assert.equal(rootsPlot({ ok: false, message: "bad" }), null);
});

test("rootsPlot: points are the roots' own (value, iValue), viewport is 1.2x the largest |component| in either axis, clamped to at least 1", () => {
  const roots = [new ComplexNumber(2, 3), new ComplexNumber(-4, 1)];
  const plot = rootsPlot({ ok: true, value: roots });
  assert.ok(plot);
  assert.deepEqual(plot.points, [
    { x: 2, y: 3 },
    { x: -4, y: 1 },
  ]);
  // maxAbs = max(1, |2|,|3|,|-4|,|1|) = 4 -> viewport = [-4.8, 4.8] both axes.
  assert.deepEqual(plot.viewport, { xMin: -4.8, xMax: 4.8, yMin: -4.8, yMax: 4.8 });
});

test("rootsPlot: an all-tiny-roots case clamps maxAbs to 1 (not 0), so the viewport never degenerates to a point", () => {
  const plot = rootsPlot({ ok: true, value: [new ComplexNumber(0.01, -0.02)] });
  assert.ok(plot);
  // maxAbs = max(1, 0.01, 0.02) = 1 -> viewport = [-1.2, 1.2] both axes.
  assert.deepEqual(plot.viewport, { xMin: -1.2, xMax: 1.2, yMin: -1.2, yMax: 1.2 });
});

test("rootsPlot: an empty roots array still returns a valid plot with an empty points array and the clamped-to-1 viewport", () => {
  const plot = rootsPlot({ ok: true, value: [] });
  assert.ok(plot);
  assert.deepEqual(plot.points, []);
  assert.deepEqual(plot.viewport, { xMin: -1.2, xMax: 1.2, yMin: -1.2, yMax: 1.2 });
});
