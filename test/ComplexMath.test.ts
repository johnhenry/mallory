import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addVector,
  angleBetween,
  crossProduct,
  distanceVector,
  dotProduct,
  magnitudeVector,
  pNorm,
  standardNormalDistribution,
  standardNormalProbability,
} from "../src/ComplexMath.ts";
import { ComplexNumber } from "../src/ComplexNumber.ts";
import { Vector } from "../src/Vector.ts";

const z = (re: number, im = 0) => new ComplexNumber(re, im);
const cvec = (...xs: Array<[number, number] | number>) =>
  Vector.fromArray(xs.map((x) => (Array.isArray(x) ? z(x[0], x[1]) : z(x))));

function near(a: ComplexNumber, re: number, im: number, eps = 1e-6): boolean {
  return Math.abs(a.value - re) <= eps && Math.abs(a.iValue - im) <= eps;
}

test("vector add / dot / cross (index bug fix)", () => {
  assert.deepEqual([...addVector(cvec(1, 2), cvec(3, 4))].map(String), ["4", "6"]);
  assert.ok(dotProduct(cvec(1, 2, 3), cvec(4, 5, 6)).equals(z(32)));
  const cross = crossProduct(cvec(1, 0, 0), cvec(0, 1, 0));
  assert.ok((cross[2] as ComplexNumber).equals(z(1)));
  // real z-components (index 2), not index 3
  const cross2 = crossProduct(cvec(0, 0, 2), cvec(0, 3, 0));
  assert.ok((cross2[0] as ComplexNumber).equals(z(-6)));
});

test("pNorm / magnitude / distance", () => {
  assert.ok(near(magnitudeVector(cvec(3, 4)), 5, 0));
  assert.ok(near(pNorm(cvec(1, -2, 3), 1), 6, 0));
  assert.ok(near(distanceVector(cvec(0, 0), cvec(3, 4)), 5, 0));
});

test("angleBetween orthogonal vectors is pi/2", () => {
  assert.ok(near(angleBetween(cvec(1, 0), cvec(0, 1)), Math.PI / 2, 0, 1e-9));
});

test("normalDistribution is a proper PDF (bug fix)", () => {
  // standard normal peak at 0 is 1/sqrt(2pi) ~ 0.39894
  const pdf = standardNormalDistribution(z(0));
  assert.ok(near(pdf, 1 / Math.sqrt(2 * Math.PI), 0, 1e-6));
  // CDF at 0 ~ 0.5
  assert.ok(near(standardNormalProbability(z(0)), 0.5, 0, 1e-3));
});
