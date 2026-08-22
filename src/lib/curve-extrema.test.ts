import assert from "node:assert/strict";
import { test } from "node:test";
import { GraphUtils, Vector } from "@johnhenry/math";
import { findCurveExtrema } from "./curve-extrema.ts";
import { sampleExpr } from "./sample-function.ts";

test("findCurveExtrema finds both maxima and minima of sin(x) over two full periods", () => {
  const path = sampleExpr("sin(x)", { min: 0, max: 4 * Math.PI }, 400);
  const { maxima, minima } = findCurveExtrema(path);

  assert.equal(maxima.length, 2);
  assert.equal(minima.length, 2);

  const maxXs = maxima.map((m) => m.x).sort((a, b) => a - b);
  const minXs = minima.map((m) => m.x).sort((a, b) => a - b);
  assert.ok(Math.abs((maxXs[0] as number) - Math.PI / 2) < 0.05);
  assert.ok(Math.abs((maxXs[1] as number) - (Math.PI / 2 + 2 * Math.PI)) < 0.05);
  assert.ok(Math.abs((minXs[0] as number) - (3 * Math.PI) / 2) < 0.05);
  assert.ok(Math.abs((minXs[1] as number) - ((3 * Math.PI) / 2 + 2 * Math.PI)) < 0.05);

  for (const m of maxima) assert.ok(Math.abs(m.y - 1) < 0.01);
  for (const m of minima) assert.ok(Math.abs(m.y - -1) < 0.01);
});

test("findCurveExtrema finds no extrema on a strictly monotonic curve", () => {
  const path = sampleExpr("x", { min: -5, max: 5 }, 100);
  const { maxima, minima } = findCurveExtrema(path);
  assert.equal(maxima.length, 0);
  assert.equal(minima.length, 0);
});

test("findCurveExtrema respects a height filter", () => {
  // sin(x) over 4 periods has maxima all at y=1 -- a height above 1 filters all of them out.
  const path = sampleExpr("sin(x)", { min: 0, max: 8 * Math.PI }, 800);
  const unfiltered = findCurveExtrema(path);
  assert.ok(unfiltered.maxima.length > 0);
  const filtered = findCurveExtrema(path, { height: 1.5 });
  assert.equal(filtered.maxima.length, 0);
});

test("findCurveExtrema on an empty path returns empty results rather than throwing", () => {
  const { maxima, minima } = findCurveExtrema(GraphUtils.vectorToCurve(Vector.fromArray([]), 2, 0));
  assert.equal(maxima.length, 0);
  assert.equal(minima.length, 0);
});

test("findCurveExtrema: a single parabola arc has one maximum and no minima", () => {
  const path = sampleExpr("-x^2", { min: -3, max: 3 }, 200);
  const { maxima, minima } = findCurveExtrema(path);
  assert.equal(maxima.length, 1);
  assert.equal(minima.length, 0);
  assert.ok(Math.abs((maxima[0] as { x: number }).x) < 0.05);
});
