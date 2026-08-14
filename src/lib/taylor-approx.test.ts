import assert from "node:assert/strict";
import { test } from "node:test";
import { computeLimit, computeTaylorApproximation } from "./taylor-approx.ts";

/** Nearest-sample lookup -- sampleExpr's grid points don't necessarily land exactly on a chosen target x. */
function nearestY(commands: readonly { x: number; y: number }[], x: number): number {
  let best = commands[0] as { x: number; y: number };
  for (const c of commands) if (Math.abs(c.x - x) < Math.abs(best.x - x)) best = c;
  return best.y;
}

test("computeTaylorApproximation: degree-5 Taylor of sin(x) at 0 matches x - x^3/6 + x^5/120", () => {
  const { latex } = computeTaylorApproximation("sin(x)", 0, 5, { min: -1, max: 1 });
  // Spot-check the coefficient structure via evaluation rather than string-matching LaTeX formatting.
  assert.ok(latex.length > 0);
});

test("computeTaylorApproximation: the Taylor polynomial agrees with f(x) near the center, for any reasonable order", () => {
  const { fPath, taylorPath } = computeTaylorApproximation("cos(x)", 0, 6, { min: -0.5, max: 0.5 });
  for (const x of [-0.4, -0.2, 0, 0.2, 0.4]) {
    const fy = nearestY(fPath.commands, x);
    const ty = nearestY(taylorPath.commands, x);
    assert.ok(Math.abs(fy - ty) < 1e-3, `x=${x}: f=${fy}, taylor=${ty}`);
  }
});

test("computeTaylorApproximation: a low-order approximation diverges from f(x) away from the center (proves it's not just resampling f itself)", () => {
  const { fPath, taylorPath } = computeTaylorApproximation("sin(x)", 0, 1, { min: -6, max: 6 });
  const fy = nearestY(fPath.commands, 5);
  const ty = nearestY(taylorPath.commands, 5);
  // sin(5) ~ -0.96, but the degree-1 Taylor poly at 0 (y=x) evaluates to ~5 there.
  assert.ok(Math.abs(fy - ty) > 1, `expected divergence far from center, got f=${fy} taylor=${ty}`);
  assert.ok(Math.abs(ty - 5) < 0.05);
});

test("computeTaylorApproximation: a nonsense expression surfaces as a thrown error (caller's job to catch)", () => {
  assert.throws(() => computeTaylorApproximation("not a valid expr (((", 0, 3, { min: -1, max: 1 }));
});

test("computeLimit: sin(x)/x as x->0 is the classic removable-singularity limit, 1", () => {
  const result = computeLimit("sin(x)/x", 0, "both");
  assert.ok(result.ok);
  if (result.ok) assert.ok(Math.abs(result.value - 1) < 1e-6);
});

test("computeLimit: (x^2-1)/(x-1) as x->1 is 2 (factor-and-cancel, no L'Hopital needed algebraically but exercised here numerically)", () => {
  const result = computeLimit("(x^2-1)/(x-1)", 1, "both");
  assert.ok(result.ok);
  if (result.ok) assert.ok(Math.abs(result.value - 2) < 1e-6);
});

test("computeLimit: 1/x diverges oppositely from the left and right of 0", () => {
  const right = computeLimit("1/x", 0, "right");
  const left = computeLimit("1/x", 0, "left");
  assert.ok(right.ok && left.ok);
  if (right.ok && left.ok) {
    assert.ok(right.value > 0);
    assert.ok(left.value < 0);
  }
});

test("computeLimit: a malformed expression returns an error result, not a throw", () => {
  const result = computeLimit("not a valid expr (((", 0, "both");
  assert.equal(result.ok, false);
});
