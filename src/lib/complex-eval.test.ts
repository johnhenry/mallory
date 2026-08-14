import assert from "node:assert/strict";
import { test } from "node:test";
import { ComplexNumber, Symbolic } from "mallory-math";
import { evaluateComplex } from "./complex-eval.ts";

function evalAt(source: string, z: ComplexNumber): ComplexNumber {
  return evaluateComplex(Symbolic.parse(source), { z });
}

function assertNear(actual: ComplexNumber, expectedRe: number, expectedIm: number, tolerance = 1e-9) {
  assert.ok(Math.abs(actual.value - expectedRe) < tolerance, `re: ${actual.value} !~ ${expectedRe}`);
  assert.ok(Math.abs(actual.iValue - expectedIm) < tolerance, `im: ${actual.iValue} !~ ${expectedIm}`);
}

test("Euler's identity: exp(i*pi) = -1", () => {
  assertNear(evalAt("exp(z)", new ComplexNumber(0, Math.PI)), -1, 0);
});

test("sqrt(-1) = i", () => {
  assertNear(evalAt("sqrt(z)", new ComplexNumber(-1, 0)), 0, 1);
});

test("z^2 + 1 at z=i is 0", () => {
  assertNear(evalAt("z^2 + 1", ComplexNumber.I), 0, 0);
});

test("division by zero produces a directed infinity, not a thrown error", () => {
  const result = evalAt("1/z", ComplexNumber.Zero);
  assert.equal(result.magnitude(), Infinity);
});

test("sin(pi/2) = 1 (real slice matches the familiar real-valued identity)", () => {
  assertNear(evalAt("sin(z)", new ComplexNumber(Math.PI / 2, 0)), 1, 0);
});

test("ln(-1) = i*pi (principal branch)", () => {
  assertNear(evalAt("ln(z)", new ComplexNumber(-1, 0)), 0, Math.PI);
});

test("constants pi and e resolve without needing to be bound in env", () => {
  const result = evaluateComplex(Symbolic.parse("pi + e"), {});
  assertNear(result, Math.PI + Math.E, 0);
});

test("an unbound free variable throws a clear error", () => {
  assert.throws(() => evaluateComplex(Symbolic.parse("z + w"), { z: ComplexNumber.One }), /"w" is not bound/);
});

test("a real-only function (e.g. floor) throws a clear error instead of silently misbehaving", () => {
  assert.throws(() => evalAt("floor(z)", new ComplexNumber(1.5, 0)), /"floor" isn't supported/);
});

test("cot(z) matches 1/tan(z)", () => {
  const z = new ComplexNumber(0.7, 0.3);
  const cot = evalAt("cot(z)", z);
  const reciprocalTan = z.tangent().reciprocal();
  assertNear(cot, reciprocalTan.value, reciprocalTan.iValue);
});

test("acosh(z) round-trips cosh(z) for a sample point", () => {
  const z = new ComplexNumber(1.2, 0.4);
  const roundTripped = evalAt("acosh(z)", z.hyperbolicCosine());
  assertNear(roundTripped, z.value, z.iValue, 1e-6);
});

test("a piecewise expression has no complex meaning and throws", () => {
  const expr = Symbolic.parse("z");
  const piecewise = { type: "piecewise" as const, branches: [{ cond: expr, expr }], otherwise: expr };
  assert.throws(() => evaluateComplex(piecewise, { z: ComplexNumber.One }), /"piecewise" has no complex-valued meaning/);
});
