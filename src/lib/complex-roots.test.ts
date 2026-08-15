import assert from "node:assert/strict";
import { test } from "node:test";
import { ComplexNumber, Symbolic } from "mallory-math";
import { evaluateComplex } from "./complex-eval.ts";
import { findComplexZeros, findComplexPoles, type ComplexDomain } from "./complex-roots.ts";

const FULL_DOMAIN: ComplexDomain = { reMin: -3, reMax: 3, imMin: -3, imMax: 3 };

function zerosOf(exprText: string, domain: ComplexDomain, gridSize?: number) {
  const expr = Symbolic.parse(exprText);
  const deriv = Symbolic.differentiate(expr, "z");
  return findComplexZeros((z) => evaluateComplex(expr, { z }), (z) => evaluateComplex(deriv, { z }), domain, gridSize);
}

function polesOf(exprText: string, domain: ComplexDomain, gridSize?: number) {
  const expr = Symbolic.parse(exprText);
  const deriv = Symbolic.differentiate(expr, "z");
  return findComplexPoles((z) => evaluateComplex(expr, { z }), (z) => evaluateComplex(deriv, { z }), domain, gridSize);
}

function assertClose(actual: ComplexNumber, expectedRe: number, expectedIm: number, tolerance = 1e-4) {
  assert.ok(Math.abs(actual.value - expectedRe) < tolerance, `real part ${actual.value} not close to ${expectedRe}`);
  assert.ok(Math.abs(actual.iValue - expectedIm) < tolerance, `imag part ${actual.iValue} not close to ${expectedIm}`);
}

test("findComplexZeros: z^2-1 has exactly the two real roots +1 and -1, hand-computed", () => {
  const roots = zerosOf("z^2-1", FULL_DOMAIN);
  assert.equal(roots.length, 2);
  const sorted = [...roots].sort((a, b) => a.value - b.value);
  assertClose(sorted[0]!, -1, 0);
  assertClose(sorted[1]!, 1, 0);
});

test("findComplexZeros: z^3-1 has exactly the three cube roots of unity, hand-computed (1, -0.5+-0.8660254i)", () => {
  const roots = zerosOf("z^3-1", FULL_DOMAIN);
  assert.equal(roots.length, 3);
  const sorted = [...roots].sort((a, b) => a.iValue - b.iValue);
  assertClose(sorted[0]!, -0.5, -Math.sqrt(3) / 2);
  assertClose(sorted[1]!, 1, 0);
  assertClose(sorted[2]!, -0.5, Math.sqrt(3) / 2);
});

test("findComplexZeros: sin(z) is zero at every integer multiple of pi -- a narrow domain finds exactly -pi, 0, pi", () => {
  const roots = zerosOf("sin(z)", { reMin: -4, reMax: 4, imMin: -1, imMax: 1 });
  assert.equal(roots.length, 3);
  const sorted = [...roots].sort((a, b) => a.value - b.value);
  assertClose(sorted[0]!, -Math.PI, 0);
  assertClose(sorted[1]!, 0, 0);
  assertClose(sorted[2]!, Math.PI, 0);
});

test("findComplexZeros: roots outside the search domain are dropped, even though Newton would converge to them from a seed inside it", () => {
  // z^2-1's roots are at +-1; restricting the domain to re>0.1 excludes -1.
  const roots = zerosOf("z^2-1", { reMin: 0.1, reMax: 3, imMin: -3, imMax: 3 });
  assert.equal(roots.length, 1);
  assertClose(roots[0]!, 1, 0);
});

test("findComplexZeros: rejects an inverted domain or a non-positive grid size", () => {
  assert.throws(() => findComplexZeros((z) => z, (z) => z, { reMin: 1, reMax: 0, imMin: -1, imMax: 1 }), /Domain bounds/);
  assert.throws(() => findComplexZeros((z) => z, (z) => z, { reMin: -1, reMax: 1, imMin: 1, imMax: 0 }), /Domain bounds/);
  assert.throws(() => findComplexZeros((z) => z, (z) => z, { reMin: -1, reMax: 1, imMin: -1, imMax: 1 }, 0), /Grid size/);
});

test("findComplexPoles: 1/(z^2-1) has poles exactly where the denominator vanishes, at +1 and -1", () => {
  const poles = polesOf("1/(z^2-1)", FULL_DOMAIN);
  assert.equal(poles.length, 2);
  const sorted = [...poles].sort((a, b) => a.value - b.value);
  assertClose(sorted[0]!, -1, 0, 1e-3);
  assertClose(sorted[1]!, 1, 0, 1e-3);
});

test("findComplexPoles: csc(z) = 1/sin(z) has poles at every integer multiple of pi, matching sin's own zeros", () => {
  const poles = polesOf("csc(z)", { reMin: -4, reMax: 4, imMin: -1, imMax: 1 });
  assert.equal(poles.length, 3);
  const sorted = [...poles].sort((a, b) => a.value - b.value);
  assertClose(sorted[0]!, -Math.PI, 0, 1e-3);
  assertClose(sorted[1]!, 0, 0, 1e-3);
  assertClose(sorted[2]!, Math.PI, 0, 1e-3);
});

test("findComplexPoles: a function with no poles in the domain (a polynomial) finds none", () => {
  const poles = polesOf("z^2-1", FULL_DOMAIN);
  assert.equal(poles.length, 0);
});

test("findComplexPoles: rejects an inverted domain or a non-positive grid size (same validation as findComplexZeros)", () => {
  assert.throws(() => findComplexPoles((z) => z, (z) => z, { reMin: 1, reMax: 0, imMin: -1, imMax: 1 }), /Domain bounds/);
  assert.throws(() => findComplexPoles((z) => z, (z) => z, { reMin: -1, reMax: 1, imMin: -1, imMax: 1 }, -3), /Grid size/);
});
