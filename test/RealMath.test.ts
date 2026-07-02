import assert from "node:assert/strict";
import { test } from "node:test";
import {
  add,
  angleBetween,
  cosine,
  crossProduct,
  differentiateN,
  distanceVector,
  divide,
  dotProduct,
  equal,
  hyperbolicCosine,
  hyperbolicSine,
  integrateN,
  logarithm,
  magnitudeVector,
  multiply,
  negative,
  pNorm,
  roundTo,
  sine,
  solveN,
  standardNormalProbability,
  subtract,
} from "../src/RealMath.ts";
import { Vector } from "../src/Vector.ts";

const v = (...xs: number[]) => Vector.fromArray(xs);
const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

test("basic arithmetic incl. subtract bug fix", () => {
  assert.equal(add(2, 3), 5);
  assert.equal(subtract(5, 3), 2); // AS3 returned a*b = 15
  assert.equal(multiply(4, 5), 20);
  assert.equal(negative(7), -7);
});

test("divide handles zero denominators", () => {
  assert.equal(divide(6, 3), 2);
  assert.equal(divide(1, 0), Infinity);
  assert.equal(divide(-1, 0), -Infinity);
  assert.ok(Number.isNaN(divide(0, 0)));
});

test("equal respects tolerance (bug fix)", () => {
  assert.equal(equal(0.1 + 0.2, 0.3), false, "exact fails due to float");
  assert.equal(equal(0.1 + 0.2, 0.3, 1e-9), true, "tolerance works");
});

test("identity cleans floating noise", () => {
  assert.equal(sine(Math.PI), 0, "sin(pi) rounds to 0");
  assert.equal(cosine(Math.PI / 2), 0);
});

test("logarithm with base", () => {
  assert.ok(close(logarithm(8, 2), 3));
  assert.ok(close(logarithm(Math.E), 1));
});

test("hyperbolic identities", () => {
  assert.ok(close(hyperbolicCosine(0), 1));
  assert.ok(close(hyperbolicSine(0), 0));
  // cosh^2 - sinh^2 = 1
  assert.ok(close(hyperbolicCosine(1.3) ** 2 - hyperbolicSine(1.3) ** 2, 1, 1e-6));
});

test("roundTo", () => {
  assert.equal(roundTo(3.14159265, 2), 3.14);
  assert.equal(roundTo(2.5, 0), 3);
});

test("integrateN approximates a known integral (bug fix)", () => {
  // ∫₀¹ x² dx = 1/3
  assert.ok(
    close(
      integrateN((x) => x * x, 0, 1, 0.0001),
      1 / 3,
      1e-3,
    ),
  );
  // ∫₀^π sin x dx = 2
  assert.ok(close(integrateN(Math.sin, 0, Math.PI, 0.0001), 2, 1e-3));
});

test("differentiateN approximates a derivative (symmetric, bug fix)", () => {
  // d/dx x² at x=3 is 6
  assert.ok(
    close(
      differentiateN((x) => x * x, 3, 1e-4),
      6,
      1e-4,
    ),
  );
  // d/dx sin at 0 is 1
  assert.ok(close(differentiateN(Math.sin, 0, 1e-4), 1, 1e-6));
});

test("solveN finds a root", () => {
  // solve x² = 9 near guess 2 -> ~3
  const root = solveN((x) => x * x, 9, 1e-6, 2);
  assert.ok(close(Math.abs(root), 3, 1e-2));
});

test("normalProbability approximates the standard normal CDF", () => {
  // P(Z < 0) = 0.5
  assert.ok(close(standardNormalProbability(0), 0.5, 1e-3));
  // P(Z < 1.96) ~ 0.975
  assert.ok(close(standardNormalProbability(1.96), 0.975, 5e-3));
});

test("dotProduct and crossProduct (index bug fix)", () => {
  assert.equal(dotProduct(v(1, 2, 3), v(4, 5, 6)), 32);
  // standard basis: x cross y = z
  assert.deepEqual([...crossProduct(v(1, 0, 0), v(0, 1, 0))], [0, 0, 1]);
  // uses real z component (index 2), not index 3
  assert.deepEqual([...crossProduct(v(0, 0, 2), v(0, 3, 0))], [-6, 0, 0]);
});

test("pNorm / magnitude / distance", () => {
  assert.ok(close(magnitudeVector(v(3, 4)), 5));
  assert.ok(close(pNorm(v(1, -2, 3), 1), 6));
  assert.equal(pNorm(v(1, -5, 3), 0), 5, "0-norm = max abs");
  assert.ok(close(distanceVector(v(0, 0), v(3, 4)), 5));
});

test("angleBetween orthogonal vectors is pi/2", () => {
  assert.ok(close(angleBetween(v(1, 0), v(0, 1)), Math.PI / 2));
});
