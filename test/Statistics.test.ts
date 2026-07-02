import assert from "node:assert/strict";
import { test } from "node:test";
import {
  correlation,
  isOutlier,
  linearRegressionFunction,
  linRegIntercept,
  linRegSlope,
  maximum,
  mean,
  median,
  minimum,
  outliers,
  outliersRemoved,
  product,
  sort,
  standardDeviation,
  sum,
  variance,
} from "../src/Statistics.ts";
import { Vector } from "../src/Vector.ts";

const v = (...xs: number[]) => Vector.fromArray(xs);
const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

test("sort is numeric (bug fix) so order stats are correct", () => {
  const data = v(10, 2, 33, 4, 1);
  assert.deepEqual([...sort(data)], [1, 2, 4, 10, 33]);
  assert.equal(minimum(data), 1);
  assert.equal(maximum(data), 33);
  assert.equal(median(v(3, 1, 2)), 2);
});

test("sum / product / mean", () => {
  assert.equal(sum(v(1, 2, 3, 4)), 10);
  assert.equal(product(v(1, 2, 3, 4)), 24);
  assert.equal(mean(v(2, 4, 6)), 4);
});

test("variance is sample variance (bug fix)", () => {
  // sample variance of [2,4,6] = ((−2)²+0+2²)/(3−1) = 8/2 = 4
  assert.equal(variance(v(2, 4, 6)), 4);
  assert.ok(close(standardDeviation(v(2, 4, 6)), 2));
  assert.ok(Number.isNaN(variance(v(5))));
});

test("interquartile range and outliers", () => {
  const data = v(1, 2, 3, 4, 5, 6, 7, 8, 100);
  assert.ok(isOutlier(data, 100));
  assert.ok([...outliers(data)].includes(100));
  assert.ok(![...outliersRemoved(data)].includes(100));
});

test("linear regression recovers a perfect line", () => {
  const x = v(0, 1, 2, 3, 4);
  const y = v(1, 3, 5, 7, 9); // y = 2x + 1
  assert.ok(close(linRegSlope(x, y), 2, 1e-9));
  assert.ok(close(linRegIntercept(x, y), 1, 1e-9));
  const f = linearRegressionFunction(x, y);
  assert.ok(close(f(10), 21, 1e-9));
  assert.ok(close(correlation(x, y), 1, 1e-9));
});
