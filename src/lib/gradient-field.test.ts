import assert from "node:assert/strict";
import { test } from "node:test";
import { DualNumber, Symbolic } from "@johnhenry/math";
import { evaluateDual, sampleGradientField } from "./gradient-field.ts";

function gradAt(exprText: string, x: number, y: number): [number, number] {
  const parsed = Symbolic.parse(exprText);
  return DualNumber.gradient((xs) => evaluateDual(parsed, { x: xs[0] as DualNumber, y: xs[1] as DualNumber }), [x, y]) as [
    number,
    number,
  ];
}

test("evaluateDual: gradient of x^2+y^2 matches (2x, 2y) exactly", () => {
  const [dx, dy] = gradAt("x^2 + y^2", 3, -4);
  assert.ok(Math.abs(dx - 6) < 1e-9);
  assert.ok(Math.abs(dy - -8) < 1e-9);
});

test("evaluateDual: gradient of sin(x)*y matches (cos(x)*y, sin(x)) exactly", () => {
  const [dx, dy] = gradAt("sin(x) * y", 0, 3);
  assert.ok(Math.abs(dx - 3) < 1e-9); // d/dx = cos(0)*3 = 3
  assert.ok(Math.abs(dy - 0) < 1e-9); // d/dy = sin(0) = 0
});

test("evaluateDual: a general (non-constant) exponent works via the exp(y*ln(x)) identity, matching x^y's known partials", () => {
  // f = x^y at (2,3): df/dx = y*x^(y-1) = 3*4=12, df/dy = x^y*ln(x) = 8*ln(2)
  const [dx, dy] = gradAt("x^y", 2, 3);
  assert.ok(Math.abs(dx - 12) < 1e-6, `dx: ${dx}`);
  assert.ok(Math.abs(dy - 8 * Math.log(2)) < 1e-6, `dy: ${dy}`);
});

test("evaluateDual: pi and e resolve as constants without needing to be bound", () => {
  const parsed = Symbolic.parse("pi * x + e * y");
  const result = evaluateDual(parsed, { x: DualNumber.constant(1), y: DualNumber.constant(1) });
  assert.ok(Math.abs(result.value - (Math.PI + Math.E)) < 1e-9);
});

test("evaluateDual: an unbound variable throws a clear error", () => {
  const parsed = Symbolic.parse("x + z");
  assert.throws(() => evaluateDual(parsed, { x: DualNumber.constant(1) }), /"z" is not bound/);
});

test("evaluateDual: a function DualNumber doesn't support (e.g. asin) throws a clear error", () => {
  const parsed = Symbolic.parse("asin(x)");
  assert.throws(() => evaluateDual(parsed, { x: DualNumber.constant(0.5) }), /"asin" isn't supported/);
});

test("sampleGradientField: matches the exact gradient of x^2+y^2 at every grid point", () => {
  const points = sampleGradientField("x^2 + y^2", { min: -2, max: 2 }, { min: -2, max: 2 }, 5);
  assert.equal(points.length, 25);
  for (const p of points) {
    assert.ok(Math.abs(p.dx - 2 * p.x) < 1e-9, `dx at (${p.x},${p.y})`);
    assert.ok(Math.abs(p.dy - 2 * p.y) < 1e-9, `dy at (${p.x},${p.y})`);
  }
});

test("sampleGradientField: a point outside the field's domain (ln(x) at x<=0) is omitted, not NaN", () => {
  const points = sampleGradientField("ln(x) + y", { min: -1, max: 1 }, { min: 0, max: 1 }, 5, "x", "y");
  // Half the x-domain (x <= 0) is outside ln's domain -- those grid columns should be entirely absent.
  assert.ok(points.length > 0 && points.length < 25, `expected a partial grid, got ${points.length}/25 points`);
  for (const p of points) assert.ok(p.x > 0, `point at x=${p.x} should have been outside ln's domain`);
});
