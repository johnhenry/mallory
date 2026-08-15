import assert from "node:assert/strict";
import { test } from "node:test";
import { UnsupportedExprError } from "mallory-adapter-math";
import { runGradientDescent } from "./gradient-descent.ts";

const BOWL = "(x-1)^2 + (y+2)^2"; // unique minimum at (1, -2), f=0

test("runGradientDescent: SGD's first step from (4,3) lands exactly on start - lr*grad (autograd's exact gradient, hand-computed: grad=(6,10))", () => {
  const result = runGradientDescent(BOWL, 4, 3, "sgd", 0.1, 1);
  assert.equal(result.path.length, 2);
  // f64 end to end: 4 - 0.1*6 and 3 - 0.1*10, bit-for-bit.
  assert.equal(result.path[1]?.x, 4 - 0.1 * 6);
  assert.equal(result.path[1]?.y, 3 - 0.1 * 10);
});

test("runGradientDescent: path[0] is the start point with f evaluated there", () => {
  const result = runGradientDescent(BOWL, 4, 3, "sgd", 0.1, 5);
  assert.equal(result.path[0]?.x, 4);
  assert.equal(result.path[0]?.y, 3);
  assert.equal(result.path[0]?.f, (4 - 1) ** 2 + (3 + 2) ** 2); // 9 + 25 = 34
});

test("runGradientDescent: SGD converges to the bowl's known minimum (1, -2)", () => {
  const result = runGradientDescent(BOWL, 4, 3, "sgd", 0.1, 100);
  const last = result.path[result.path.length - 1]!;
  assert.ok(Math.abs(last.x - 1) < 1e-6);
  assert.ok(Math.abs(last.y + 2) < 1e-6);
  assert.equal(result.stoppedEarly, false);
});

test("runGradientDescent: Adam and RMSprop also converge to the same minimum (looser tolerance -- adaptive methods approach differently)", () => {
  for (const optimizer of ["adam", "rmsprop"] as const) {
    const result = runGradientDescent(BOWL, 4, 3, optimizer, 0.2, 300);
    const last = result.path[result.path.length - 1]!;
    assert.ok(Math.abs(last.x - 1) < 1e-2, `${optimizer} x: ${last.x}`);
    assert.ok(Math.abs(last.y + 2) < 1e-2, `${optimizer} y: ${last.y}`);
  }
});

test("runGradientDescent: an expression using only x still runs (y declared, gradient genuinely 0, y never moves)", () => {
  const result = runGradientDescent("(x-3)^2", 0, 5, "sgd", 0.1, 50);
  const last = result.path[result.path.length - 1]!;
  assert.ok(Math.abs(last.x - 3) < 1e-4);
  assert.equal(last.y, 5); // untouched
});

test("runGradientDescent: f values along the path are monotonically non-increasing for SGD on a convex bowl with a stable lr", () => {
  const result = runGradientDescent(BOWL, 4, 3, "sgd", 0.1, 50);
  for (let i = 1; i < result.path.length; i++) {
    assert.ok(result.path[i]!.f <= result.path[i - 1]!.f + 1e-12, `f rose at step ${i}`);
  }
});

test("runGradientDescent: divergence (too-large lr on a steep field) stops early instead of recording non-finite points", () => {
  const result = runGradientDescent("exp(x^2 + y^2)", 3, 3, "sgd", 10, 500);
  assert.equal(result.stoppedEarly, true);
  assert.ok(result.path.length < 501);
  for (const p of result.path) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.f));
  }
});

test("runGradientDescent: UnsupportedExprError propagates for an expression with no elementwise-tensor meaning", () => {
  assert.throws(() => runGradientDescent("gcd(x, y)", 1, 1, "sgd", 0.1, 10), UnsupportedExprError);
});

test("runGradientDescent: rejects a non-positive lr, a non-integer/over-cap step count, and a non-finite start", () => {
  assert.throws(() => runGradientDescent(BOWL, 0, 0, "sgd", 0, 10), /Learning rate must be a positive number/);
  assert.throws(() => runGradientDescent(BOWL, 0, 0, "sgd", 0.1, 0), /Steps must be a positive integer/);
  assert.throws(() => runGradientDescent(BOWL, 0, 0, "sgd", 0.1, 5000), /Steps must be a positive integer/);
  assert.throws(() => runGradientDescent(BOWL, Number.NaN, 0, "sgd", 0.1, 10), /Start point must be finite/);
});
