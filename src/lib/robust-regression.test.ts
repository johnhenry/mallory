import assert from "node:assert/strict";
import { test } from "node:test";
import { findOutlierIndices, fitRobustLinear } from "./robust-regression.ts";

test("fitRobustLinear: recovers a line close to the true slope/intercept despite one severe outlier -- unlike ordinary least squares (verified separately: OLS on this exact data gives slope~11.87/intercept~-25.3)", async () => {
  const xs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const points = xs.map((x) => ({ x, y: 2 * x + 1 })); // true line y = 2x + 1
  points[9] = { x: 9, y: 200 }; // one severe outlier
  const { slope, intercept } = await fitRobustLinear(points, { lr: 0.1, epochs: 500 });
  // Empirically verified (node -e against the real installed package) to converge to
  // slope~2.0887/intercept~0.7655 -- allow a wide-ish tolerance since Adam's exact
  // trajectory could shift slightly across dependency patch versions, but it must
  // stay close to the TRUE line (2, 1), nowhere near OLS's outlier-dragged (11.87, -25.3).
  assert.ok(Math.abs(slope - 2) < 0.5, `slope: ${slope}`);
  assert.ok(Math.abs(intercept - 1) < 1, `intercept: ${intercept}`);
});

test("fitRobustLinear: rejects fewer than two points", async () => {
  await assert.rejects(() => fitRobustLinear([{ x: 0, y: 0 }]), /at least two/);
});

test("fitRobustLinear: rejects a non-positive learning rate or an out-of-range epoch count", async () => {
  const points = [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ];
  await assert.rejects(() => fitRobustLinear(points, { lr: 0 }), /Learning rate/);
  await assert.rejects(() => fitRobustLinear(points, { epochs: 0 }), /Epochs/);
  await assert.rejects(() => fitRobustLinear(points, { epochs: 100000 }), /Epochs/);
});

test("findOutlierIndices: hand-computed MAD threshold flags exactly the one severely-off point, not the moderately-off ones", () => {
  // Residuals from y=x: [-1, 0.5, -0.5, 1, 0, 20]. Hand-computed: median=0.25,
  // MAD=0.75, scaledMad=1.11195, only the last residual (20) exceeds 2.5 scaled-MADs.
  const points = [
    { x: 0, y: -1 },
    { x: 1, y: 1.5 },
    { x: 2, y: 1.5 },
    { x: 3, y: 4 },
    { x: 4, y: 4 },
    { x: 5, y: 25 },
  ];
  assert.deepEqual(findOutlierIndices(points, 1, 0), [5]);
});

test("findOutlierIndices: no points on the line at all still correctly finds none when residuals are uniform (mad=0 bails out rather than dividing by zero)", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
    { x: 2, y: 2 },
  ];
  assert.deepEqual(findOutlierIndices(points, 1, 0), []);
});

test("findOutlierIndices: an empty or single-point list returns no outliers", () => {
  assert.deepEqual(findOutlierIndices([], 1, 0), []);
  assert.deepEqual(findOutlierIndices([{ x: 0, y: 0 }], 1, 0), []);
});
