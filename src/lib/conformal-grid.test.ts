import assert from "node:assert/strict";
import { test } from "node:test";
import { ComplexNumber } from "@johnhenry/math";
import { autoFitViewport, mapGridLines, polarGridLines, rectangularGridLines } from "./conformal-grid.ts";

const VIEWPORT = { xMin: -2, xMax: 2, yMin: -1, yMax: 1 };

test("rectangularGridLines: one line per spacing-aligned Re and Im value, each sampled at 61 points", () => {
  const lines = rectangularGridLines(VIEWPORT, 1);
  // verticals at x=-2,-1,0,1,2 (5) + horizontals at y=-1,0,1 (3) = 8
  assert.equal(lines.length, 8);
  for (const line of lines) assert.equal(line.length, 61);
});

test("rectangularGridLines: a vertical line at x=-2 spans the full y-range endpoint to endpoint", () => {
  const lines = rectangularGridLines(VIEWPORT, 1);
  const line = lines[0];
  assert.ok(line);
  assert.equal(line[0]?.value, -2);
  assert.equal(line[0]?.iValue, -1);
  assert.equal(line[line.length - 1]?.value, -2);
  assert.equal(line[line.length - 1]?.iValue, 1);
});

test("rectangularGridLines: rejects non-positive spacing", () => {
  assert.throws(() => rectangularGridLines(VIEWPORT, 0), /spacing must be positive/);
  assert.throws(() => rectangularGridLines(VIEWPORT, -1), /spacing must be positive/);
});

test("polarGridLines: one line per radial ring plus one per angular ray", () => {
  const lines = polarGridLines(2, 1, 4);
  // circles at r=1,2 (2) + rays at 4 angles (4) = 6
  assert.equal(lines.length, 6);
});

test("polarGridLines: a circle of radius r has constant magnitude at every sample", () => {
  const lines = polarGridLines(3, 3, 1);
  const circle = lines[0];
  assert.ok(circle);
  for (const z of circle) assert.ok(Math.abs(z.magnitude() - 3) < 1e-9);
});

test("polarGridLines: rejects invalid maxRadius/radialSpacing/angularCount", () => {
  assert.throws(() => polarGridLines(0, 1, 4), /maxRadius must be positive/);
  assert.throws(() => polarGridLines(2, 0, 4), /radialSpacing must be positive/);
  assert.throws(() => polarGridLines(2, 1, 0), /angularCount must be a positive integer/);
});

test("mapGridLines: maps every point through f (identity check)", () => {
  const line = [new ComplexNumber(0, 0), new ComplexNumber(1, 1)];
  const mapped = mapGridLines([line], (z) => z);
  assert.deepEqual(mapped, [
    [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ],
  ]);
});

test("mapGridLines: f(z)=z^2 applied to a known point matches hand computation ((1+i)^2 = 2i)", () => {
  const line = [new ComplexNumber(1, 1)];
  // A single-point "line" can't form a polyline (needs >= 2 points), so pad
  // with a second point far enough away not to interfere.
  const withPad = [new ComplexNumber(1, 1), new ComplexNumber(2, 2)];
  const mapped = mapGridLines([withPad], (z) => z.power(2));
  const first = mapped[0]?.[0];
  assert.ok(first);
  assert.ok(Math.abs(first.x - 0) < 1e-9);
  assert.ok(Math.abs(first.y - 2) < 1e-9);
});

test("mapGridLines: a pole in the middle of a line splits it into separate runs, dropping any run shorter than 2 points", () => {
  // 1/z is singular at z=0; the two surviving single-point fragments on
  // either side each fall below the 2-point minimum and are dropped.
  const line = [new ComplexNumber(-1, 0), new ComplexNumber(0, 0), new ComplexNumber(1, 0)];
  const mapped = mapGridLines([line], (z) => new ComplexNumber(1, 0).divide(z));
  assert.deepEqual(mapped, []);
});

test("mapGridLines: a pole with enough points on either side keeps both surviving runs", () => {
  const line = [new ComplexNumber(-2, 0), new ComplexNumber(-1, 0), new ComplexNumber(0, 0), new ComplexNumber(1, 0), new ComplexNumber(2, 0)];
  const mapped = mapGridLines([line], (z) => new ComplexNumber(1, 0).divide(z));
  assert.equal(mapped.length, 2);
  assert.equal(mapped[0]?.length, 2);
  assert.equal(mapped[1]?.length, 2);
});

test("autoFitViewport: fits a square window around the data's bounding box, centered on its midpoint", () => {
  const fit = autoFitViewport([[{ x: -1, y: -1 }, { x: 3, y: 2 }]], VIEWPORT, 0);
  assert.equal(fit.xMin, -1);
  assert.equal(fit.xMax, 3);
  assert.equal(fit.yMin, -1.5);
  assert.equal(fit.yMax, 2.5);
});

test("autoFitViewport: padding widens the window symmetrically", () => {
  const noPad = autoFitViewport([[{ x: 0, y: 0 }, { x: 2, y: 0 }]], VIEWPORT, 0);
  const padded = autoFitViewport([[{ x: 0, y: 0 }, { x: 2, y: 0 }]], VIEWPORT, 0.5);
  assert.ok(padded.xMax - padded.xMin > noPad.xMax - noPad.xMin);
});

test("autoFitViewport: falls back to the given viewport when there are no finite points", () => {
  assert.deepEqual(autoFitViewport([], VIEWPORT), VIEWPORT);
  assert.deepEqual(autoFitViewport([[]], VIEWPORT), VIEWPORT);
});
