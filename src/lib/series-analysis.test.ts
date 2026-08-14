import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeSeries, computeSeriesPartialSums } from "./series-analysis.ts";

test("computeSeriesPartialSums: hand-computed running sums for 1/n^2 starting at n=1", () => {
  const sums = computeSeriesPartialSums("1/n^2", "n", 1, 3);
  assert.deepEqual(
    sums.map((s) => s.n),
    [1, 2, 3],
  );
  assert.equal(sums[0]?.sum, 1);
  assert.equal(sums[1]?.sum, 1.25);
  assert.ok(Math.abs((sums[2]?.sum as number) - (1 + 0.25 + 1 / 9)) < 1e-12);
});

test("computeSeriesPartialSums: a plain finite sum matches the closed-form n(n+1)/2 for 'n' from 1", () => {
  const sums = computeSeriesPartialSums("n", "n", 1, 10);
  const last = sums[sums.length - 1];
  assert.equal(last?.n, 10);
  assert.equal(last?.sum, 55); // 10*11/2
});

test("computeSeriesPartialSums: count is capped at a hard maximum, not unbounded", () => {
  const sums = computeSeriesPartialSums("1", "n", 1, 10000);
  assert.ok(sums.length <= 500);
});

test("analyzeSeries: 1/n^2 from 1 to Infinity converges to pi^2/6 (Basel problem)", () => {
  const result = analyzeSeries("1/n^2", "n", 1, Infinity, 10);
  assert.equal(result.diverges, false);
  assert.ok(result.finalSum !== null);
  assert.ok(Math.abs(result.finalSum - Math.PI ** 2 / 6) < 1e-6);
});

test("analyzeSeries: 1/n from 1 to Infinity diverges (harmonic series), reporting null finalSum and a message", () => {
  const result = analyzeSeries("1/n", "n", 1, Infinity, 10);
  assert.equal(result.diverges, true);
  assert.equal(result.finalSum, null);
  assert.ok(result.divergeMessage && result.divergeMessage.length > 0);
});

test("analyzeSeries: a geometric series (1/2)^n from n=0 sums to exactly 2", () => {
  const result = analyzeSeries("(1/2)^n", "n", 0, Infinity, 10);
  assert.equal(result.diverges, false);
  assert.equal(result.finalSum, 2);
});

test("analyzeSeries: a finite range is a plain partial sum, matching computeSeriesPartialSums's own last value", () => {
  const result = analyzeSeries("n", "n", 1, 5, 100);
  assert.equal(result.diverges, false);
  assert.equal(result.finalSum, 15);
  assert.equal(result.partialSums.length, 5);
  assert.equal(result.partialSums[result.partialSums.length - 1]?.sum, 15);
});

test("analyzeSeries: a genuine parse error is not misreported as divergence", () => {
  assert.throws(() => analyzeSeries("1/(", "n", 1, Infinity, 10));
});

test("analyzeSeries: an infinite range plots at most plotCount terms, not every term to infinity", () => {
  const result = analyzeSeries("1/n^2", "n", 1, Infinity, 7);
  assert.equal(result.partialSums.length, 7);
});
