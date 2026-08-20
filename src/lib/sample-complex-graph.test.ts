import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isAxisChoice,
  isComplexComponent,
  isValidComplexAxisAssignment,
  sampleComplexGraph,
  type ComplexGraphAxisAssignment,
} from "./sample-complex-graph.ts";

test("isComplexComponent/isAxisChoice: the 4 real components pass both; 'none' passes only isAxisChoice; garbage passes neither", () => {
  for (const c of ["reX", "imX", "reY", "imY"]) {
    assert.equal(isComplexComponent(c), true);
    assert.equal(isAxisChoice(c), true);
  }
  assert.equal(isComplexComponent("none"), false);
  assert.equal(isAxisChoice("none"), true);
  assert.equal(isComplexComponent("bogus"), false);
  assert.equal(isAxisChoice("bogus"), false);
});

test("isValidComplexAxisAssignment: accepts any assignment with no repeated component, any mix of 'none'", () => {
  assert.equal(isValidComplexAxisAssignment({ x: "reX", y: "reY", z: "imY" }), true);
  assert.equal(isValidComplexAxisAssignment({ x: "reX", y: "imX", z: "imY" }), true); // both domain used -- fine now, just scatter-shaped
  assert.equal(isValidComplexAxisAssignment({ x: "reX", y: "reY", z: "none" }), true);
  assert.equal(isValidComplexAxisAssignment({ x: "reX", y: "none", z: "none" }), true);
});

test("isValidComplexAxisAssignment: rejects a repeated component", () => {
  assert.equal(isValidComplexAxisAssignment({ x: "reX", y: "reY", z: "reY" }), false);
});

test("isValidComplexAxisAssignment: rejects all-'none' (nothing to plot)", () => {
  assert.equal(isValidComplexAxisAssignment({ x: "none", y: "none", z: "none" }), false);
});

test("sampleComplexGraph throws for an invalid (duplicate-component or all-none) assignment rather than silently sampling garbage", () => {
  assert.throws(() => sampleComplexGraph("x", { x: "reX", y: "reX", z: "imY" }, { min: 0, max: 1 }));
  assert.throws(() => sampleComplexGraph("x", { x: "none", y: "none", z: "none" }, { min: 0, max: 1 }));
});

test("sampleComplexGraph: y = e^(i*x) with axes {Re(x)=t, Re(y), Im(y)} traces a spiral -- one domain component used, curve mode", () => {
  // e^(i*t) = cos(t) + i*sin(t): a unit circle in the (Re y, Im y) plane
  // while t itself runs along the x axis -- the issue's own worked example.
  const assignment: ComplexGraphAxisAssignment = { x: "reX", y: "reY", z: "imY" };
  const { mode, points } = sampleComplexGraph("exp(i*x)", assignment, { min: 0, max: 2 * Math.PI }, 360);

  assert.equal(mode, "curve");
  assert.ok(points.length > 300, "expects a fully-sampled curve (no unexpected poles)");

  // Every point's radius in the (y, z) = (Re y, Im y) plane is 1 -- |e^(it)| = 1.
  for (const p of points) {
    const radius = Math.hypot(p.y, p.z);
    assert.ok(Math.abs(radius - 1) < 1e-6, `expected unit radius at t=${p.x}, got ${radius}`);
  }

  // x itself (the swept parameter, Re(x)) runs monotonically from 0 to 2*PI.
  assert.ok(Math.abs((points[0] as { x: number }).x - 0) < 1e-6);
  assert.ok(Math.abs((points[points.length - 1] as { x: number }).x - 2 * Math.PI) < 1e-3);

  // Spot-check t = PI/2: e^(i*PI/2) = i -> Re(y)=0, Im(y)=1.
  const quarterIndex = Math.round((360 * (Math.PI / 2)) / (2 * Math.PI));
  const quarterPoint = points[quarterIndex] as { x: number; y: number; z: number };
  assert.ok(Math.abs(quarterPoint.y - 0) < 1e-3);
  assert.ok(Math.abs(quarterPoint.z - 1) < 1e-3);
});

test("sampleComplexGraph: implicitly holding Re(x) at 0 instead sweeps Im(x) as the free parameter", () => {
  // x = i*t (pure imaginary), y = x^2 = -t^2 -- real-valued and negative for t != 0.
  const assignment: ComplexGraphAxisAssignment = { x: "imX", y: "reY", z: "imY" };
  const { mode, points } = sampleComplexGraph("x^2", assignment, { min: 1, max: 2 }, 10);
  assert.equal(mode, "curve");
  assert.ok(points.length > 0);
  for (const p of points) {
    assert.ok(Math.abs(p.z - 0) < 1e-9, "Im(y) should be exactly 0 for a real-valued result");
    assert.ok(p.y < 0, "Re(y) = -t^2 should be negative for t in [1,2]");
  }
});

test("sampleComplexGraph: a pole is skipped, not fatal to the rest of the curve", () => {
  // y = 1/x has a pole exactly at x=0, which sits inside t in [-1, 1].
  const assignment: ComplexGraphAxisAssignment = { x: "reX", y: "reY", z: "imY" };
  const { points } = sampleComplexGraph("1/x", assignment, { min: -1, max: 1 }, 20);
  assert.ok(points.length > 0, "expects most samples to still succeed");
  assert.ok(points.length < 21, "expects at least the exact pole sample to be skipped");
});

test("sampleComplexGraph: both domain components assigned -> scatter mode, a 2D grid of samples", () => {
  // x free over both Re(x) and Im(x), y axis unused ("none"): every grid
  // point of the (Re(x), Im(x)) square shows up directly as (x, z) -- a
  // dense sheet, not a single-parameter curve.
  const assignment: ComplexGraphAxisAssignment = { x: "reX", y: "none", z: "imX" };
  const { mode, points } = sampleComplexGraph("x", assignment, { min: -1, max: 1 }, 20);
  assert.equal(mode, "scatter");
  assert.ok(points.length > 100, "expects a full 2D grid, not a 1D sweep's worth of points");
  for (const p of points) {
    assert.equal(p.y, 0, "the unused axis reads as a constant 0");
  }
});

test("sampleComplexGraph: no domain component assigned -> a single point (x fixed at the origin)", () => {
  const assignment: ComplexGraphAxisAssignment = { x: "reY", y: "imY", z: "none" };
  const { mode, points } = sampleComplexGraph("3+4i", assignment, { min: -5, max: 5 });
  assert.equal(mode, "scatter");
  assert.equal(points.length, 1);
  assert.ok(Math.abs((points[0] as { x: number }).x - 3) < 1e-9);
  assert.ok(Math.abs((points[0] as { y: number }).y - 4) < 1e-9);
});

test("sampleComplexGraph: an axis assigned 'none' always reads as 0, even alongside a curve sweep", () => {
  const assignment: ComplexGraphAxisAssignment = { x: "reX", y: "reY", z: "none" };
  const { mode, points } = sampleComplexGraph("exp(i*x)", assignment, { min: 0, max: Math.PI }, 20);
  assert.equal(mode, "curve");
  for (const p of points) {
    assert.equal(p.z, 0);
  }
});
