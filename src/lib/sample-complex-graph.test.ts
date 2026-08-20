import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hiddenRangeComponent,
  isAxisChoice,
  isComplexComponent,
  isValidComplexAxisAssignment,
  sampleComplexGraph,
  usedDomainComponents,
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

test("usedDomainComponents (#365): with no sweep flags, only assigned components are 'used' -- default matches today's implicit behavior", () => {
  const assignment: ComplexGraphAxisAssignment = { x: "reX", y: "reY", z: "none" };
  assert.deepEqual(usedDomainComponents(assignment), ["reX"]);
  assert.deepEqual(usedDomainComponents(assignment, { reX: false, imX: false }), ["reX"]);
});

test("usedDomainComponents (#365): a forced sweep flag adds an otherwise-unassigned component to the used set", () => {
  const assignment: ComplexGraphAxisAssignment = { x: "reX", y: "reY", z: "none" };
  assert.deepEqual(usedDomainComponents(assignment, { reX: false, imX: true }), ["reX", "imX"]);
});

test("usedDomainComponents (#365): forcing an ALREADY-assigned component doesn't duplicate it", () => {
  const assignment: ComplexGraphAxisAssignment = { x: "reX", y: "imX", z: "reY" };
  assert.deepEqual(usedDomainComponents(assignment, { reX: true, imX: true }), ["reX", "imX"]);
});

test("sampleComplexGraph (#365): forcing Im(x) to sweep turns an otherwise-clean curve into a scatter, even though Im(x) still isn't shown on any axis", () => {
  // {Re(x), Re(y), None} for exp(i*x) is the exact worked example that
  // motivated #365: with Im(x) held at 0 (the default), this traces a
  // clean curve (cos(t), sin(t) held off-axis). Forcing Im(x) to sweep
  // makes the grid 2D even though only Re(x)/Re(y) are ever shown.
  const assignment: ComplexGraphAxisAssignment = { x: "reX", y: "reY", z: "none" };
  const withoutForce = sampleComplexGraph("exp(i*x)", assignment, { min: 0, max: Math.PI }, 20);
  assert.equal(withoutForce.mode, "curve");
  const withForce = sampleComplexGraph("exp(i*x)", assignment, { min: 0, max: Math.PI }, 20, { reX: false, imX: true });
  assert.equal(withForce.mode, "scatter");
  assert.ok(withForce.points.length > withoutForce.points.length, "the 2D grid samples far more points than the 1D sweep");
  for (const p of withForce.points) {
    assert.equal(p.z, 0, "z is still 'none' -- forcing a sweep doesn't change what's shown, only what's swept");
  }
});

test("hiddenRangeComponent (#367): null when both Re(y)/Im(y) are shown -- nothing hidden to highlight against", () => {
  assert.equal(hiddenRangeComponent({ x: "reX", y: "reY", z: "imY" }), null);
});

test("hiddenRangeComponent (#367): null when NEITHER Re(y)/Im(y) is shown -- ambiguous which one 'near real' means", () => {
  assert.equal(hiddenRangeComponent({ x: "reX", y: "imX", z: "none" }), null);
});

test("hiddenRangeComponent (#367): returns the one hidden range component when exactly one is shown", () => {
  assert.equal(hiddenRangeComponent({ x: "reX", y: "imX", z: "reY" }), "imY");
  assert.equal(hiddenRangeComponent({ x: "reX", y: "reY", z: "none" }), "imY");
  assert.equal(hiddenRangeComponent({ x: "reX", y: "imY", z: "none" }), "reY");
});

test("sampleComplexGraph (#367): nearReal is undefined when both range components are shown -- nothing to highlight", () => {
  const { nearReal } = sampleComplexGraph("exp(i*x)", { x: "reX", y: "reY", z: "imY" }, { min: 0, max: Math.PI }, 20);
  assert.equal(nearReal, undefined);
});

test("sampleComplexGraph (#367): every point is near-real when the hidden component is identically 0 (a genuinely always-real function)", () => {
  // y = 1 (a real constant): Im(y) is exactly 0 for every sample, so the
  // maxAbs === 0 fallback in computeNearReal marks the whole set true --
  // correct, since the function really is always real here.
  const assignment: ComplexGraphAxisAssignment = { x: "reX", y: "imX", z: "reY" };
  const { mode, points, nearReal } = sampleComplexGraph("1", assignment, { min: -1, max: 1 }, 10);
  assert.equal(mode, "scatter");
  assert.ok(nearReal, "expected nearReal to be defined -- imY is the one hidden component");
  assert.equal(nearReal!.length, points.length);
  assert.ok(nearReal!.every(Boolean), "every sample should count as near-real when Im(y) is always exactly 0");
});

test("sampleComplexGraph (#367): only the grid row where the hidden component is exactly 0 is marked near-real for y = i*x", () => {
  // y = i*x = -Im(x) + i*Re(x): Im(y) = Re(x), hidden here (axes show
  // Re(x), Im(x), Re(y)). A symmetric [-1, 1] domain with an even grid
  // resolution (10) puts a sample row exactly at Re(x) = 0 (i = 5 of 10);
  // the tolerance (5% of the peak |Re(x)| = 1, i.e. 0.05) is too tight for
  // any adjacent row (Re(x) = +/-0.2) to also qualify.
  const assignment: ComplexGraphAxisAssignment = { x: "reX", y: "imX", z: "reY" };
  const { points, nearReal } = sampleComplexGraph("i*x", assignment, { min: -1, max: 1 }, 10);
  assert.ok(nearReal);
  const nearRealPoints = points.filter((_, i) => nearReal![i]);
  assert.ok(nearRealPoints.length > 0, "expects at least the Re(x) = 0 row to qualify");
  for (const p of nearRealPoints) {
    assert.ok(Math.abs(p.x - 0) < 1e-9, `expected every near-real point to have Re(x) (shown as the X axis) exactly 0, got ${p.x}`);
  }
  // Every OTHER row (Re(x) != 0) should be excluded -- confirms the
  // tolerance isn't so loose it accidentally includes neighboring rows.
  const excludedPoints = points.filter((_, i) => !nearReal![i]);
  assert.ok(excludedPoints.every((p) => Math.abs(p.x) > 1e-9));
});

test("sampleComplexGraph (#367): nearReal is still computed in curve mode when a hidden range component exists, even though the panel only surfaces the highlight in scatter mode", () => {
  const assignment: ComplexGraphAxisAssignment = { x: "reX", y: "reY", z: "none" };
  const { mode, nearReal } = sampleComplexGraph("exp(i*x)", assignment, { min: 0, max: 2 * Math.PI }, 20);
  assert.equal(mode, "curve");
  assert.ok(nearReal, "imY is hidden (Z is 'none'), so nearReal should still be computed here");
});
