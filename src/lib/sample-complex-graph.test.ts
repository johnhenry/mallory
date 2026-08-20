import assert from "node:assert/strict";
import { test } from "node:test";
import {
  droppedComponent,
  isAxisChoice,
  isComplexComponent,
  isValidAxisTriple,
  isValidCurveAxisAssignment,
  sampleComplexGraphCurve,
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

test("isValidCurveAxisAssignment: accepts a well-formed assignment implicitly dropping Im(x)", () => {
  const assignment: ComplexGraphAxisAssignment = { x: "reX", y: "reY", z: "imY" };
  assert.equal(isValidCurveAxisAssignment(assignment), true);
});

test("isValidCurveAxisAssignment: rejects an assignment that would drop a range component (that's the surface case, not curve)", () => {
  // Both reX and imX assigned -> the omitted 4th component is reY, a range component.
  const assignment: ComplexGraphAxisAssignment = { x: "reX", y: "imX", z: "imY" };
  assert.equal(isValidCurveAxisAssignment(assignment), false);
});

test("isValidCurveAxisAssignment: rejects a repeated component", () => {
  const assignment: ComplexGraphAxisAssignment = { x: "reX", y: "reY", z: "reY" };
  assert.equal(isValidCurveAxisAssignment(assignment), false);
});

test("droppedComponent: reports the one component not assigned to any axis", () => {
  assert.equal(droppedComponent({ x: "reX", y: "reY", z: "imY" }), "imX");
  assert.equal(droppedComponent({ x: "imX", y: "reY", z: "imY" }), "reX");
});

test("droppedComponent: null for a not-yet-valid (duplicate) mid-edit assignment", () => {
  assert.equal(droppedComponent({ x: "reX", y: "reX", z: "reY" }), null);
});

test("isValidAxisTriple: the UI's own per-option disabling check -- would picking `c` alongside `a`,`b` be valid", () => {
  // a=Re(x), b=Re(y) already chosen: Im(x) would leave BOTH domain
  // components used (invalid, surface-shaped); Im(y) is the only valid pick.
  assert.equal(isValidAxisTriple("reX", "reY", "imX"), false);
  assert.equal(isValidAxisTriple("reX", "reY", "imY"), true);
  // a=Re(y), b=Im(y) already chosen (both range): either domain component works.
  assert.equal(isValidAxisTriple("reY", "imY", "reX"), true);
  assert.equal(isValidAxisTriple("reY", "imY", "imX"), true);
  // order independence
  assert.equal(isValidAxisTriple("imY", "reX", "reY"), true);
});

test("sampleComplexGraphCurve throws for an invalid (surface-shaped) assignment rather than silently sampling garbage", () => {
  const assignment: ComplexGraphAxisAssignment = { x: "reX", y: "imX", z: "imY" };
  assert.throws(() => sampleComplexGraphCurve("x", assignment, { min: 0, max: 1 }));
});

test("sampleComplexGraphCurve: y = e^(i*x) with axes {Re(x)=t, Re(y), Im(y)} traces a spiral -- the issue's own worked example", () => {
  // e^(i*t) = cos(t) + i*sin(t): a unit circle in the (Re y, Im y) plane
  // while t itself runs along the x axis -- exactly the spiral the issue
  // describes, hand-verified at a few sample points below.
  const assignment: ComplexGraphAxisAssignment = { x: "reX", y: "reY", z: "imY" };
  const points = sampleComplexGraphCurve("exp(i*x)", assignment, { min: 0, max: 2 * Math.PI }, 360);

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

test("sampleComplexGraphCurve: implicitly dropping Re(x) instead sweeps Im(x) as the free parameter", () => {
  // x = i*t (pure imaginary), y = x^2 = -t^2 -- real-valued and negative for t != 0.
  const assignment: ComplexGraphAxisAssignment = { x: "imX", y: "reY", z: "imY" };
  const points = sampleComplexGraphCurve("x^2", assignment, { min: 1, max: 2 }, 10);
  assert.ok(points.length > 0);
  for (const p of points) {
    assert.ok(Math.abs(p.z - 0) < 1e-9, "Im(y) should be exactly 0 for a real-valued result");
    assert.ok(p.y < 0, "Re(y) = -t^2 should be negative for t in [1,2]");
  }
});

test("sampleComplexGraphCurve: a pole is skipped, not fatal to the rest of the curve", () => {
  // y = 1/x has a pole exactly at x=0, which sits inside t in [-1, 1].
  const assignment: ComplexGraphAxisAssignment = { x: "reX", y: "reY", z: "imY" };
  const points = sampleComplexGraphCurve("1/x", assignment, { min: -1, max: 1 }, 20);
  assert.ok(points.length > 0, "expects most samples to still succeed");
  assert.ok(points.length < 21, "expects at least the exact pole sample to be skipped");
});
