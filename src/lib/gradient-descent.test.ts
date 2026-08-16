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

test("runGradientDescent: a StepLR schedule (stepSize=1, gamma=0.5) applies AFTER the optimizer's own step -- the first descent step still uses the unmodified initial lr, the second uses lr halved", () => {
  const result = runGradientDescent(BOWL, 4, 3, "sgd", 0.1, 2, { stepSize: 1, gamma: 0.5 });
  assert.equal(result.path.length, 3);
  // Step 1: unmodified lr=0.1, grad=(6,10) at (4,3) -- same numbers the no-schedule test above hand-computes.
  assert.equal(result.path[1]?.x, 4 - 0.1 * 6);
  assert.equal(result.path[1]?.y, 3 - 0.1 * 10);
  // StepLR.step() fires once after step 1 (n=1, stepSize=1): lr becomes 0.1*0.5 = 0.05.
  // Step 2: grad at (3.4, 2.0) is (2*(3.4-1), 2*(2.0+2)) = (4.8, 8.0).
  const x1 = 4 - 0.1 * 6;
  const y1 = 3 - 0.1 * 10;
  assert.equal(result.path[2]?.x, x1 - 0.05 * (2 * (x1 - 1)));
  assert.equal(result.path[2]?.y, y1 - 0.05 * (2 * (y1 + 2)));
});

test("runGradientDescent: without a schedule, lr never changes -- every step uses the same effective lr as the unscheduled hand-computed test above", () => {
  const withoutSchedule = runGradientDescent(BOWL, 4, 3, "sgd", 0.1, 2);
  const withNoopSchedule = runGradientDescent(BOWL, 4, 3, "sgd", 0.1, 2, { stepSize: 1000, gamma: 0.5 });
  // stepSize=1000 with only 2 steps run means the schedule never actually fires (n never reaches 1000) -- identical path to no schedule at all.
  assert.deepEqual(withNoopSchedule.path, withoutSchedule.path);
});

// ---- SGD momentum (issue #33's last remaining item, mallory-plus#89) --------

test("runGradientDescent: SGD momentum matches hand-computed buf = momentum*buf + grad, param -= lr*buf (verified via a standalone node -e script)", () => {
  const result = runGradientDescent(BOWL, 4, 3, "sgd", 0.1, 2, undefined, { momentum: 0.9, nesterov: false });
  assert.equal(result.path.length, 3);
  assert.equal(result.path[1]?.x, 3.4);
  assert.equal(result.path[1]?.y, 2);
  assert.ok(Math.abs((result.path[2]?.x ?? Number.NaN) - 2.38) < 1e-12);
  assert.ok(Math.abs((result.path[2]?.y ?? Number.NaN) - 0.3) < 1e-12);
});

test("runGradientDescent: sgdMomentum with momentum=0 is byte-identical to no sgdMomentum at all", () => {
  const withoutMomentum = runGradientDescent(BOWL, 4, 3, "sgd", 0.1, 5);
  const withZeroMomentum = runGradientDescent(BOWL, 4, 3, "sgd", 0.1, 5, undefined, { momentum: 0, nesterov: false });
  assert.deepEqual(withZeroMomentum.path, withoutMomentum.path);
});

test("runGradientDescent: momentum is harmlessly ignored for adam/rmsprop -- identical path with or without sgdMomentum set", () => {
  for (const optimizer of ["adam", "rmsprop"] as const) {
    const without = runGradientDescent(BOWL, 4, 3, optimizer, 0.1, 5);
    const withMomentum = runGradientDescent(BOWL, 4, 3, optimizer, 0.1, 5, undefined, { momentum: 0.9, nesterov: true });
    assert.deepEqual(withMomentum.path, without.path, optimizer);
  }
});

test("runGradientDescent: SGD momentum reaches lower loss than plain SGD in the same 40 steps on an anisotropic, ill-conditioned bowl (verified via a standalone node -e sweep: momentum's advantage only shows up here, not on the isotropic BOWL above, which is already well-conditioned for plain SGD)", () => {
  const ANISOTROPIC = "x^2 + 10*y^2"; // same shape as GradientDescentPanel's own default expression
  const withMomentum = runGradientDescent(ANISOTROPIC, 4, 2, "sgd", 0.02, 40, undefined, { momentum: 0.9, nesterov: false });
  const plain = runGradientDescent(ANISOTROPIC, 4, 2, "sgd", 0.02, 40);
  const lastM = withMomentum.path[withMomentum.path.length - 1]!;
  const lastP = plain.path[plain.path.length - 1]!;
  assert.ok(lastM.f < lastP.f, `momentum should reach lower loss in the same 40 steps: momentum=${lastM.f}, plain=${lastP.f}`);
});

test("runGradientDescent: rejects a momentum outside [0, 1)", () => {
  assert.throws(() => runGradientDescent(BOWL, 4, 3, "sgd", 0.1, 10, undefined, { momentum: -0.1, nesterov: false }), /momentum must be a number in \[0, 1\)/);
  assert.throws(() => runGradientDescent(BOWL, 4, 3, "sgd", 0.1, 10, undefined, { momentum: 1, nesterov: false }), /momentum must be a number in \[0, 1\)/);
});

test("runGradientDescent: nesterov without a nonzero momentum propagates optim.SGD's own RangeError", () => {
  assert.throws(() => runGradientDescent(BOWL, 4, 3, "sgd", 0.1, 10, undefined, { momentum: 0, nesterov: true }), /nesterov requires a nonzero momentum/);
});
