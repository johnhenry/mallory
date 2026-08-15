import assert from "node:assert/strict";
import { test } from "node:test";
import { sampleImplicitCurveIntervalBoxes } from "./interval-implicit.ts";

test("sampleImplicitCurveIntervalBoxes: a box straddling a known point on the circle x^2+y^2=4 is kept", () => {
  const boxes = sampleImplicitCurveIntervalBoxes("x^2+y^2=4", { min: -3, max: 3 }, { min: -3, max: 3 }, { maxDepth: 8 });
  assert.ok(
    boxes.some((b) => b.xMin <= 2 && 2 <= b.xMax && b.yMin <= 0 && 0 <= b.yMax),
    "expected some leaf box to enclose the known circle point (2,0)",
  );
});

test("sampleImplicitCurveIntervalBoxes: a region provably far from the circle is discarded entirely (no false positives)", () => {
  const boxes = sampleImplicitCurveIntervalBoxes("x^2+y^2=4", { min: -3, max: 3 }, { min: -3, max: 3 }, { maxDepth: 8 });
  assert.ok(
    !boxes.some((b) => b.xMin >= 2.5 && b.yMin >= 2.5),
    "no box entirely within [2.5,3]x[2.5,3] should survive -- that corner is provably outside the circle (min distance from origin > 2)",
  );
});

test("sampleImplicitCurveIntervalBoxes: never misses a curve point marching squares can step over -- the thin lemniscate cusp near the origin is enclosed at a coarse resolution", () => {
  // (x^2+y^2)^2 - 2*(x^2-y^2) = 0 passes exactly through the origin, and
  // the two lobes pinch to near-zero width there -- the classic case where
  // a coarse point-sampled grid can straddle the pinch without any corner
  // landing close enough to register a sign change.
  const boxes = sampleImplicitCurveIntervalBoxes(
    "(x^2+y^2)^2 - 2*(x^2-y^2)",
    { min: -2, max: 2 },
    { min: -2, max: 2 },
    { maxDepth: 3 }, // coarse: only 8 units wide / 2^3 = 0.5 per leaf box
  );
  assert.ok(
    boxes.some((b) => b.xMin <= 0 && 0 <= b.xMax && b.yMin <= 0 && 0 <= b.yMax),
    "expected the origin (a genuine zero of the lemniscate) to be enclosed even at coarse depth",
  );
});

test("sampleImplicitCurveIntervalBoxes: a box where the field can't be rigorously bounded (division by zero, e.g. tan's asymptote) is conservatively kept, not silently dropped", () => {
  // y = tan(x) has a vertical asymptote at x = pi/2 -- cos(x) touches zero
  // inside any box straddling it, so sin(x)/cos(x) throws from Interval's
  // own divide() rather than returning a bogus bounded result.
  const boxes = sampleImplicitCurveIntervalBoxes("y=tan(x)", { min: 0, max: 3.3 }, { min: -5, max: 5 }, { maxDepth: 6 });
  assert.ok(
    boxes.some((b) => b.xMin <= Math.PI / 2 && Math.PI / 2 <= b.xMax),
    "expected a box straddling the tan asymptote to be conservatively kept rather than dropped",
  );
});

test("sampleImplicitCurveIntervalBoxes: maxDepth bounds the leaf box count at 4^maxDepth regardless of curve complexity", () => {
  const boxes = sampleImplicitCurveIntervalBoxes("x^2+y^2=4", { min: -3, max: 3 }, { min: -3, max: 3 }, { maxDepth: 4 });
  assert.ok(boxes.length <= 4 ** 4, `expected at most ${4 ** 4} boxes at depth 4, got ${boxes.length}`);
});
