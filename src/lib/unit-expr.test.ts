import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateUnitExpr } from "./unit-expr.ts";

test("multiplies velocity by time to distance: 5 m/s * 3 s", () => {
  const result = evaluateUnitExpr("5 m/s * 3 s");
  assert.equal(result.value, 15);
});

test("force from mass and acceleration, converted to a named derived unit: 9.8 m/s^2 * 70 kg in N", () => {
  const result = evaluateUnitExpr("9.8 m/s^2 * 70 kg in N");
  assert.equal(result.symbol, "N");
  assert.ok(Math.abs(result.value - 686) < 1e-9);
});

test("without an explicit conversion, a product stays in its raw composite unit (no auto-simplification to a named derived unit)", () => {
  const result = evaluateUnitExpr("9.8 m/s^2 * 70 kg");
  assert.ok(Math.abs(result.value - 686) < 1e-9);
  assert.notEqual(result.symbol, "N");
});

test("adding incompatible dimensions throws a DimensionMismatchError, not a silent wrong answer", () => {
  assert.throws(() => evaluateUnitExpr("5 m + 3 s"));
});

test("unit conversion: 3 mi in km", () => {
  const result = evaluateUnitExpr("3 mi in km");
  assert.equal(result.symbol, "km");
  assert.ok(Math.abs(result.value - 4.828032) < 1e-6);
});

test("standard precedence: 2 m + 3 m * 4 (multiplication before addition)", () => {
  const result = evaluateUnitExpr("2 m + 3 m * 4");
  assert.equal(result.value, 14); // 2 + (3*4) = 14, not (2+3)*4 = 20
});

test("subtraction of compatible units: 10 m - 4 m", () => {
  const result = evaluateUnitExpr("10 m - 4 m");
  assert.equal(result.value, 6);
});

test("division: 100 km / 2 h", () => {
  const result = evaluateUnitExpr("100 km / 2 h");
  assert.equal(result.value, 50);
});

test("dimensionless numbers (no unit token) combine as plain arithmetic", () => {
  const result = evaluateUnitExpr("2 + 3 * 4");
  assert.equal(result.value, 14);
  assert.ok(result.isDimensionless);
});

test("negative leading operand via a signed numeral token: -5 m + 8 m", () => {
  const result = evaluateUnitExpr("-5 m + 8 m");
  assert.equal(result.value, 3);
});

test("substitutes a known variable's dimensionless value into the expression", () => {
  const result = evaluateUnitExpr("k m", { k: 5 });
  assert.equal(result.value, 5);
  assert.equal(result.symbol, "m");
});

test("an unknown identifier that isn't a number or a known variable throws a clear error", () => {
  assert.throws(() => evaluateUnitExpr("k m"), /isn't a number or a known variable/);
});

test("malformed input throws rather than returning a nonsensical result", () => {
  assert.throws(() => evaluateUnitExpr(""));
  assert.throws(() => evaluateUnitExpr("5 m +"));
  assert.throws(() => evaluateUnitExpr("+ 5 m"));
  assert.throws(() => evaluateUnitExpr("5 m in"));
  assert.throws(() => evaluateUnitExpr("in km"));
});

// -- unit cancellation (mallory#305 bug 1) ---------------------------

test("#305: 5 m/s * 3 s simplifies to 15 m, not 15 m/s*s (identical symbols cancel)", () => {
  const result = evaluateUnitExpr("5 m/s * 3 s");
  assert.equal(result.value, 15);
  assert.equal(result.symbol, "m");
});

test("cancellation handles exponents: m/s^2 * s leaves m/s", () => {
  const result = evaluateUnitExpr("2 m/s^2 * 3 s");
  assert.equal(result.value, 6);
  assert.equal(result.symbol, "m/s");
});

test("full cancellation yields a dimensionless value: 6 s / 3 s = 2", () => {
  const result = evaluateUnitExpr("6 s / 3 s");
  assert.equal(result.value, 2);
  assert.equal(result.symbol, "");
  assert.ok(result.isDimensionless);
});

test("cancellation is textual, never dimensional: m/s * min does NOT silently convert (s and min are different symbols)", () => {
  const result = evaluateUnitExpr("5 m/s * 2 min");
  assert.equal(result.symbol, "m/s*min");
});

test("no-op simplification keeps the user's own units verbatim: 3 km / 2 s stays km/s, never converts to base SI", () => {
  const result = evaluateUnitExpr("3 km / 2 s");
  assert.equal(result.value, 1.5);
  assert.equal(result.symbol, "km/s");
});

test("an explicit `in <unit>` conversion is never re-simplified: 3 mi in km stays km", () => {
  const result = evaluateUnitExpr("3 mi in km");
  assert.equal(result.symbol, "km");
  assert.ok(Math.abs(result.value - 4.828032) < 1e-9);
});
