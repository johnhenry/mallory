import assert from "node:assert/strict";
import { test } from "node:test";
import { Symbolic } from "@johnhenry/math";
import {
  findConditionCrossings,
  findDiscontinuities,
  findIntersections,
  findRootCrossings,
  resolveAdaptiveTolerance,
  sampleExpr,
  sampleExprAdaptive,
  sampleRegionMask,
} from "./sample-function.ts";

test("samples a plain function of x with no params", () => {
  const path = sampleExpr("x^2", { min: -2, max: 2 }, 5);
  assert.equal(path.commands.length, 5);
});

test("substitutes param values for free variables alongside the axis variable", () => {
  const path = sampleExpr("a*x^2+b", { min: 0, max: 0 }, 2, "x", { a: 2, b: 3 });
  const [command] = path.commands;
  assert.ok(command);
  assert.equal(command.y, 3);
});

test("changing a param value changes the sampled output", () => {
  const withA1 = sampleExpr("a*x", { min: 1, max: 1 }, 2, "x", { a: 1 });
  const withA5 = sampleExpr("a*x", { min: 1, max: 1 }, 2, "x", { a: 5 });
  assert.equal(withA1.commands[0]?.y, 1);
  assert.equal(withA5.commands[0]?.y, 5);
});

test("breaks the path into separate segments at singularities instead of drawing a garbage line through them", () => {
  // resolution 9 over [-2,2] samples at step 0.5: -2,-1.5,-1,-0.5,0,0.5,1,1.5,2
  // -- the singularities at x=-1 and x=1 land exactly on sample points.
  const path = sampleExpr("1/(x^2-1)", { min: -2, max: 2 }, 9);
  const moveTos = path.commands.filter((c) => c.op === "moveTo");
  assert.equal(moveTos.length, 3);
  assert.ok(path.commands.every((c) => Number.isFinite(c.x) && Number.isFinite(c.y)));
});

test("sampleExpr defaults to the standard blue when no color is given, and honors an explicit color", () => {
  const defaultPath = sampleExpr("x", { min: 0, max: 1 }, 2);
  assert.equal(defaultPath.stroke.color, 0x2563eb);
  const redPath = sampleExpr("x", { min: 0, max: 1 }, 2, "x", {}, 0xdc2626);
  assert.equal(redPath.stroke.color, 0xdc2626);
});

test("sampleExprAdaptive adds no extra points for an already-straight line", () => {
  const path = sampleExprAdaptive("2*x+1", { min: -1, max: 1 }, 5);
  assert.equal(path.commands.length, 5);
});

test("sampleExprAdaptive refines beyond the base grid where the curve is sharply nonlinear", () => {
  // A narrow bump that a 5-point base grid straddles almost entirely (only
  // sampling near x=0, ±0.5, ±1) -- adaptive refinement must add points a
  // plain sampleExpr at the same base resolution wouldn't have.
  const uniform = sampleExpr("exp(-100*x^2)", { min: -1, max: 1 }, 5);
  const adaptive = sampleExprAdaptive("exp(-100*x^2)", { min: -1, max: 1 }, 5, "x", {}, 0x2563eb, { maxDepth: 6, tolerance: 1e-4 });
  assert.ok(adaptive.commands.length > uniform.commands.length);
});

test("sampleExprAdaptive matches the analytic value closely at a refined point", () => {
  const path = sampleExprAdaptive("x^3", { min: -1, max: 1 }, 3, "x", {}, 0x2563eb, { maxDepth: 8, tolerance: 1e-6 });
  const near0 = path.commands.reduce((best, c) => (Math.abs(c.x) < Math.abs(best.x) ? c : best));
  assert.ok(Math.abs(near0.y - near0.x ** 3) < 1e-4);
});

test("sampleExprAdaptive still produces gaps at singularities (does not force a bad midpoint sample in)", () => {
  const path = sampleExprAdaptive("1/(x^2-1)", { min: -2, max: 2 }, 9, "x", {}, 0x2563eb, { maxDepth: 4, tolerance: 1e-4 });
  const moveTos = path.commands.filter((c) => c.op === "moveTo");
  assert.equal(moveTos.length, 3);
  assert.ok(path.commands.every((c) => Number.isFinite(c.x) && Number.isFinite(c.y)));
});

// resolveAdaptiveTolerance / viewport-relative refinement (issue #52's
// "refinement budget" follow-up).
test("resolveAdaptiveTolerance: an explicit tolerance always wins, visibleYRange or not", () => {
  assert.equal(resolveAdaptiveTolerance(0.5, { min: -10, max: 10 }), 0.5);
  assert.equal(resolveAdaptiveTolerance(0.5, undefined), 0.5);
});

test("resolveAdaptiveTolerance: no explicit tolerance, no visibleYRange -- falls back to the pre-#52 fixed 1e-3", () => {
  assert.equal(resolveAdaptiveTolerance(undefined, undefined), 1e-3);
});

test("resolveAdaptiveTolerance: no explicit tolerance, visibleYRange given -- 1e-4 of the y-span, hand-computed", () => {
  // span 20 (yMin -10, yMax 10) * 1e-4 = 2e-3
  assert.equal(resolveAdaptiveTolerance(undefined, { min: -10, max: 10 }), 2e-3);
  // span 2 (zoomed in 10x) * 1e-4 = 2e-4 -- a tighter (smaller) tolerance, i.e. more refinement
  assert.equal(resolveAdaptiveTolerance(undefined, { min: -1, max: 1 }), 2e-4);
});

test("sampleExprAdaptive: zoomed-in (smaller visibleYRange) refines a curvy expression MORE densely than zoomed-out, at the same domain/base-resolution", () => {
  // sin(20*x) oscillates enough over [-1,1] that neither zoom level is
  // "already straight" -- both refine, but the zoomed-in (tighter,
  // viewport-relative) tolerance should recurse deeper.
  const zoomedOut = sampleExprAdaptive("sin(20*x)", { min: -1, max: 1 }, 5, "x", {}, 0x2563eb, { maxDepth: 8 }, { min: -1000, max: 1000 });
  const zoomedIn = sampleExprAdaptive("sin(20*x)", { min: -1, max: 1 }, 5, "x", {}, 0x2563eb, { maxDepth: 8 }, { min: -1, max: 1 });
  assert.ok(
    zoomedIn.commands.length > zoomedOut.commands.length,
    `zoomed-in should refine more densely: zoomedIn=${zoomedIn.commands.length} zoomedOut=${zoomedOut.commands.length}`,
  );
});

test("sampleExpr gaps a curve near a huge-but-finite asymptote sample when visibleYRange is given", () => {
  // tan(x) near pi/2 (~1.5708): a high-resolution grid over [0,3] (step
  // ~0.0003) guarantees some sample lands within ~0.00015 of the pole,
  // where tan(x) is huge but still finite -- without visibleYRange this
  // used to connect such points with one long line straight across the
  // canvas. findDiscontinuities (not a raw moveTo count, which always
  // includes one leading moveTo for the very start of the path -- not a
  // gap) is the established way this file already checks for a real
  // internal gap.
  const withRange = sampleExpr("tan(x)", { min: 0, max: 3 }, 10000, "x", {}, 0x2563eb, { min: -10, max: 10 });
  assert.ok(findDiscontinuities(withRange).length >= 1, "expected at least one gap near the pi/2 asymptote");
});

test("sampleExpr does not gap tan(x) when visibleYRange is omitted (backward compatible default)", () => {
  const withoutRange = sampleExpr("tan(x)", { min: 0, max: 3 }, 50);
  assert.equal(findDiscontinuities(withoutRange).length, 0, "no visibleYRange means no off-visible-plot gapping, matching pre-existing behavior");
});

test("sampleExpr does not false-positive gap an ordinary bounded curve when visibleYRange is given", () => {
  const path = sampleExpr("sin(x)", { min: -10, max: 10 }, 50, "x", {}, 0x2563eb, { min: -10, max: 10 });
  assert.equal(findDiscontinuities(path).length, 0);
});

test("sampleExprAdaptive gaps tan(x) near its asymptote when visibleYRange is given, but not without it", () => {
  const withRange = sampleExprAdaptive("tan(x)", { min: 0, max: 3 }, 50, "x", {}, 0x2563eb, {}, { min: -10, max: 10 });
  assert.ok(findDiscontinuities(withRange).length >= 1);
  const withoutRange = sampleExprAdaptive("tan(x)", { min: 0, max: 3 }, 50);
  assert.equal(findDiscontinuities(withoutRange).length, 0);
});

test("sampleExprAdaptive: identical repeated calls return the SAME Path2D object (memoized, not just structurally equal) -- issue #52's memoization audit", () => {
  const first = sampleExprAdaptive("sin(x) + cos(2*x)", { min: -5, max: 5 }, 40, "x", { unused: 1 });
  const second = sampleExprAdaptive("sin(x) + cos(2*x)", { min: -5, max: 5 }, 40, "x", { unused: 1 });
  assert.equal(second, first, "a cache hit should return the exact same object reference, not a recomputed equal one");
});

test("findRootCrossings finds the two roots of x^2-4 (a resolution-9 grid over [-3,3])", () => {
  const path = sampleExpr("x^2-4", { min: -3, max: 3 }, 13);
  const roots = findRootCrossings(path);
  const xs = roots.map((r) => r.x).sort((a, b) => a - b);
  assert.equal(xs.length, 2);
  assert.ok(Math.abs((xs[0] as number) - -2) < 0.5);
  assert.ok(Math.abs((xs[1] as number) - 2) < 0.5);
});

test("findRootCrossings finds no roots for a curve that never crosses zero", () => {
  const path = sampleExpr("x^2+1", { min: -3, max: 3 }, 13);
  assert.equal(findRootCrossings(path).length, 0);
});

test("findRootCrossings does not report a crossing across a moveTo (gap) boundary", () => {
  // 1/(x^2-1) has genuine sign changes around its two asymptotes at x=-1,1,
  // each of which starts a new moveTo run rather than a real interpolatable
  // root -- assert every reported root is far from ±1 (the singularities),
  // not merely that the count is some specific number.
  const path = sampleExpr("1/(x^2-1)", { min: -2, max: 2 }, 9);
  for (const r of findRootCrossings(path)) {
    assert.ok(Math.abs(r.x - 1) > 0.4);
    assert.ok(Math.abs(r.x + 1) > 0.4);
  }
});

test("findConditionCrossings generalizes to an arbitrary threshold, not just y=0", () => {
  // x^2 crosses the threshold y=4 at x=-2 and x=2 -- the signed distance to
  // that boundary is (y - 4), so the crossing interpolates correctly, unlike
  // a bare boolean predicate which can't say *where* between two samples
  // the threshold was actually crossed.
  const path = sampleExpr("x^2", { min: -3, max: 3 }, 13);
  const crossings = findConditionCrossings(path, (y) => y - 4);
  const xs = crossings.map((c) => c.x).sort((a, b) => a - b);
  assert.equal(xs.length, 2);
  assert.ok(Math.abs((xs[0] as number) - -2) < 0.5);
  assert.ok(Math.abs((xs[1] as number) - 2) < 0.5);
  for (const c of crossings) assert.ok(Math.abs(c.y - 4) < 1e-9);
});

test("findRootCrossings is findConditionCrossings with the identity (y=0) signed distance", () => {
  const path = sampleExpr("x^2-4", { min: -3, max: 3 }, 13);
  const viaRootCrossings = findRootCrossings(path);
  const viaCondition = findConditionCrossings(path, (y) => y).map((c) => ({ x: c.x, y: 0 }));
  assert.deepEqual(viaRootCrossings, viaCondition);
});

test("findDiscontinuities flags each gap in a sampled path, with the points on either side", () => {
  // 1/(x^2-1) has singularities at x=-1 and x=1, each starting a new
  // gap-tolerant run (a moveTo) -- exactly two discontinuities expected
  // over this domain.
  const path = sampleExpr("1/(x^2-1)", { min: -2, max: 2 }, 41);
  const gaps = findDiscontinuities(path);
  assert.equal(gaps.length, 2);
  const beforeXs = gaps.map((g) => g.before.x).sort((a, b) => a - b);
  assert.ok(Math.abs((beforeXs[0] as number) - -1) < 0.2);
  assert.ok(Math.abs((beforeXs[1] as number) - 1) < 0.2);
});

test("findDiscontinuities finds no gaps for a curve defined everywhere in the domain", () => {
  const path = sampleExpr("x^2", { min: -3, max: 3 }, 20);
  assert.equal(findDiscontinuities(path).length, 0);
});

test("findIntersections finds where x^2 and x+2 cross (x=-1 and x=2)", () => {
  const points = findIntersections("x^2", {}, "x+2", {}, { min: -3, max: 3 });
  const xs = points.map((p) => p.x).sort((a, b) => a - b);
  assert.equal(xs.length, 2);
  assert.ok(Math.abs((xs[0] as number) - -1) < 0.05);
  assert.ok(Math.abs((xs[1] as number) - 2) < 0.05);
  // Both functions agree on y at each reported intersection.
  for (const p of points) {
    assert.ok(Math.abs(p.y - (p.x + 2)) < 0.05);
  }
});

test("findIntersections respects each row's own params", () => {
  // f(x) = a*x with a=2, g(x) = b with b=6 -- crosses at x=3.
  const points = findIntersections("a*x", { a: 2 }, "b", { b: 6 }, { min: -3, max: 10 });
  assert.equal(points.length, 1);
  assert.ok(Math.abs((points[0] as { x: number }).x - 3) < 0.05);
});

test("findIntersections finds no points for curves that never cross", () => {
  const points = findIntersections("x^2+1", {}, "-x^2-1", {}, { min: -3, max: 3 });
  assert.equal(points.length, 0);
});

test("sampleRegionMask returns null for a non-cmp expression", () => {
  assert.equal(sampleRegionMask(Symbolic.parse("x^2"), { min: -2, max: 2 }, 5), null);
});

test("sampleRegionMask marks true where the comparison holds, for a simple x<0 case", () => {
  const mask = sampleRegionMask(Symbolic.parse("x<0"), { min: -2, max: 2 }, 5);
  // samples at -2, -1, 0, 1, 2 -- true for -2 and -1, false for 0, 1, 2
  assert.deepEqual(mask, [true, true, false, false, false]);
});
