import assert from "node:assert/strict";
import { test } from "node:test";
import { PolynomialRing } from "../src/PolynomialRing.ts";
import { Rational } from "../src/Rational.ts";
import { Structure } from "../src/Structure.ts";

test("PolynomialRing over the reals: degree/add/subtract/multiply/evaluate", () => {
  const R = new PolynomialRing(Structure.realField());
  const p = [1, 2, 3]; // 3x^2 + 2x + 1
  const q = [0, 1]; // x
  assert.equal(R.degree(p), 2);
  assert.equal(R.degree([]), -1);
  assert.equal(R.degree([0, 0, 0]), -1, "trailing zeros are trimmed");
  assert.deepEqual(R.add(p, q), [1, 3, 3]);
  assert.deepEqual(R.subtract(p, q), [1, 1, 3]);
  assert.deepEqual(R.multiply(q, q), [0, 0, 1]); // x * x = x^2
  assert.equal(R.evaluate(p, 3), 34); // 3*9 + 2*3 + 1
  assert.equal(R.toString(p), "3*x^2+2*x+1");
});

test("PolynomialRing.divmod over the reals: (x^2 - 1) / (x - 1) = x + 1 remainder 0", () => {
  const R = new PolynomialRing(Structure.realField());
  const dividend = [-1, 0, 1]; // x^2 - 1
  const divisor = [-1, 1]; // x - 1
  const { quotient, remainder } = R.divmod(dividend, divisor);
  assert.deepEqual(quotient, [1, 1]); // x + 1
  assert.deepEqual(remainder, []);
  assert.ok(R.equal(R.add(R.multiply(quotient, divisor), remainder), dividend));
});

test("PolynomialRing.divmod is exact over the rationals: x^3 - 1 by x - 1", () => {
  const field = Structure.rationalField();
  const R = new PolynomialRing(field);
  const one = Rational.from(1);
  const dividend = [one.negate(), Rational.Zero, Rational.Zero, one]; // x^3 - 1
  const divisor = [one.negate(), one]; // x - 1
  const { quotient, remainder } = R.divmod(dividend, divisor);
  assert.equal(R.toString(quotient), "1*x^2+1*x+1");
  assert.equal(remainder.length, 0);
});

test("PolynomialRing.gcd over GF(7) is monic", () => {
  const gf7 = Structure.integersModulo(7);
  const R = new PolynomialRing(gf7);
  // (x-1)(x-2) = x^2 - 3x + 2  ->  mod 7: [2, 4, 1]
  const p1 = [2, 4, 1];
  // (x-1)(x-3) = x^2 - 4x + 3  ->  mod 7: [3, 3, 1]
  const p2 = [3, 3, 1];
  const gcd = R.gcd(p1, p2);
  // shared root x = 1  ->  monic (x - 1) = [-1 mod 7, 1] = [6, 1]
  assert.deepEqual(gcd, [6, 1]);
});

test("PolynomialRing.equal ignores trailing zero padding", () => {
  const R = new PolynomialRing(Structure.realField());
  assert.ok(R.equal([1, 2], [1, 2, 0, 0]));
  assert.ok(!R.equal([1, 2], [1, 3]));
});
