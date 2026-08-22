import assert from "node:assert/strict";
import { test } from "node:test";
import { Rng } from "@johnhenry/math-plus-tensor-core";
import { binValues, estimateDartPi, estimateMonteCarloIntegral, sampleDistributionHistogram } from "./monte-carlo.ts";

test("binValues: hand-computed placement for [0..9] into 5 bins of width 1.8", () => {
  // min=0, max=9, width=1.8. Bin edges: [0,1.8) [1.8,3.6) [3.6,5.4) [5.4,7.2) [7.2,9].
  const values = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const bins = binValues(values, 5);
  assert.equal(bins.length, 5);
  // 0,1 -> bin0; 2,3 -> bin1; 4,5 -> bin2; 6,7 -> bin3; 8,9 -> bin4 (9 clamped into the last bin).
  assert.deepEqual(
    bins.map((b) => b.count),
    [2, 2, 2, 2, 2],
  );
  assert.equal(bins[0]?.x0, 0);
  assert.ok(Math.abs((bins[4]?.x1 as number) - 9) < 1e-9);
});

test("binValues: the minimum value lands in the first bin, the maximum in the last", () => {
  const bins = binValues([-5, -3, 0, 2, 5, 10], 4);
  assert.ok((bins[0] as { count: number }).count >= 1); // -5 is in bins[0]
  assert.ok((bins[3] as { count: number }).count >= 1); // 10 is in bins[3]
});

test("binValues: a constant array (zero width) puts every value in a single bin without throwing", () => {
  const bins = binValues([5, 5, 5, 5], 4);
  const total = bins.reduce((sum, b) => sum + b.count, 0);
  assert.equal(total, 4);
});

test("estimateDartPi converges toward pi as n grows (law of large numbers)", () => {
  const result = estimateDartPi(20000, new Rng(42));
  assert.ok(Math.abs(result.piEstimate - Math.PI) < 0.05, `estimate ${result.piEstimate} too far from pi`);
});

test("estimateDartPi: the exact same seed reproduces the exact same estimate", () => {
  const a = estimateDartPi(5000, new Rng(7));
  const b = estimateDartPi(5000, new Rng(7));
  assert.equal(a.piEstimate, b.piEstimate);
  assert.deepEqual(a.points, b.points);
});

test("estimateDartPi: a different seed produces a different estimate (not hardcoded/degenerate)", () => {
  const a = estimateDartPi(500, new Rng(1));
  const b = estimateDartPi(500, new Rng(2));
  assert.notEqual(a.piEstimate, b.piEstimate);
});

test("estimateDartPi: the convergence series is monotonically increasing in n and ends near the final estimate", () => {
  const result = estimateDartPi(10000, new Rng(3));
  assert.ok(result.convergence.length > 1);
  for (let i = 1; i < result.convergence.length; i++) {
    assert.ok((result.convergence[i] as { n: number }).n > (result.convergence[i - 1] as { n: number }).n);
  }
  const last = result.convergence[result.convergence.length - 1] as { estimate: number };
  assert.ok(Math.abs(last.estimate - result.piEstimate) < 0.2);
});

test("estimateDartPi: rendered points are capped well below n for a large run", () => {
  const result = estimateDartPi(50000, new Rng(9));
  assert.ok(result.points.length < 5000);
});

test("sampleDistributionHistogram: normal(0,1) sample mean/variance land near the theoretical values for a large n", () => {
  const result = sampleDistributionHistogram("normal", { mean: 0, sd: 1 }, 20000, new Rng(11));
  assert.equal(result.theoreticalMean, 0);
  assert.equal(result.theoreticalVariance, 1);
  assert.ok(Math.abs(result.sampleMean - 0) < 0.1);
  assert.ok(Math.abs(result.sampleVariance - 1) < 0.2);
});

test("sampleDistributionHistogram: bins partition the sample range and counts sum to n", () => {
  const n = 3000;
  const result = sampleDistributionHistogram("uniform", { a: 0, b: 10 }, n, new Rng(13), 15);
  assert.equal(result.bins.length, 15);
  const total = result.bins.reduce((sum, b) => sum + b.count, 0);
  assert.equal(total, n);
  for (let i = 1; i < result.bins.length; i++) {
    assert.ok(Math.abs((result.bins[i] as { x0: number }).x0 - (result.bins[i - 1] as { x1: number }).x1) < 1e-9);
  }
});

test("sampleDistributionHistogram: reproducible with the same seed", () => {
  const a = sampleDistributionHistogram("poisson", { lambda: 4 }, 1000, new Rng(21));
  const b = sampleDistributionHistogram("poisson", { lambda: 4 }, 1000, new Rng(21));
  assert.deepEqual(a.bins, b.bins);
  assert.equal(a.sampleMean, b.sampleMean);
});

test("sampleDistributionHistogram: binomial's density curve uses pmf (discrete), not pdf", () => {
  const result = sampleDistributionHistogram("binomial", { n: 10, p: 0.5 }, 5000, new Rng(17), 10);
  // Every density value should be a valid probability in [0,1].
  for (const cmd of result.densityPath.commands) {
    assert.ok(cmd.y >= 0 && cmd.y <= 1);
  }
  assert.equal(result.theoreticalMean, 5); // n*p = 10*0.5
});

test("estimateMonteCarloIntegral: a constant function has zero variance, so every checkpoint is exact (no sampling error possible)", () => {
  const result = estimateMonteCarloIntegral("1", "x", 0, 5, 1000, new Rng(1));
  assert.equal(result.trueValue, 5);
  assert.equal(result.estimate, 5);
  assert.equal(result.absoluteError, 0);
  for (const point of result.convergence) {
    assert.equal(point.estimate, 5);
    assert.equal(point.errorBand, 0);
  }
});

test("estimateMonteCarloIntegral: matches Symbolic.integrateDefinite's exact value for a known integral (2x on [0,1] -> 1)", () => {
  const result = estimateMonteCarloIntegral("2*x", "x", 0, 1, 200000, new Rng(42));
  assert.equal(result.trueValue, 1);
  // A large-n Monte Carlo run should land close to the true value -- generous
  // tolerance since this is a genuine statistical estimate, not exact
  // arithmetic (confirmed directly: 200k samples at this seed lands within
  // ~0.001 of 1).
  assert.ok(Math.abs(result.estimate - 1) < 0.01, `estimate ${result.estimate} too far from true value 1`);
});

test("estimateMonteCarloIntegral: the first checkpoint's error band matches a hand-computed Welford variance + 95% CI (z=1.96)", () => {
  // f(x)=x on [0,1] with n=2 -- the two Rng(42) samples ARE the y-values
  // directly (identity function, span=1), so the running mean/variance/CI
  // half-width can be computed by hand from the same seeded sequence and
  // compared bit-for-bit (not just "smaller than the previous checkpoint").
  const result = estimateMonteCarloIntegral("x", "x", 0, 1, 2, new Rng(42));
  const x1 = 0.30447083548642695;
  const x2 = 0.896538217086345;
  const mean = (x1 + x2) / 2;
  const variance = (x1 - mean) ** 2 + (x2 - mean) ** 2; // Welford's m2, sample variance = m2/(n-1) with n=2
  const standardError = Math.sqrt(variance / 2);
  const expectedErrorBand = 1.96 * standardError;
  // n=2 with the default checkpoint spacing yields checkpoints at n=1 AND
  // n=2 (every count, since floor(2/100)=0 clamps to 1) -- the n=1 point has
  // zero variance by definition (a single sample), so the full-sample
  // checkpoint to check against the hand computation is the last one.
  const full = result.convergence[result.convergence.length - 1];
  assert.ok(full);
  assert.equal(full.n, 2);
  assert.ok(Math.abs(full.estimate - mean) < 1e-12);
  assert.ok(Math.abs(full.errorBand - expectedErrorBand) < 1e-9, `expected ${expectedErrorBand}, got ${full.errorBand}`);
});

test("estimateMonteCarloIntegral: the error band shrinks as n grows (1/sqrt(n) convergence)", () => {
  const result = estimateMonteCarloIntegral("sin(x) + 2", "x", 0, Math.PI, 50000, new Rng(7));
  const first = result.convergence[0];
  const last = result.convergence[result.convergence.length - 1];
  assert.ok(first);
  assert.ok(last);
  assert.ok(last.errorBand < first.errorBand, `expected the error band to shrink: first=${first.errorBand}, last=${last.errorBand}`);
});

test("estimateMonteCarloIntegral: convergence checkpoints are non-decreasing in n and span the full run", () => {
  const result = estimateMonteCarloIntegral("x", "x", 0, 2, 10000, new Rng(3));
  const ns = result.convergence.map((c) => c.n);
  for (let i = 1; i < ns.length; i++) assert.ok((ns[i] as number) > (ns[i - 1] as number));
  assert.equal(ns[ns.length - 1], 10000);
});

test("estimateMonteCarloIntegral: rejects a non-positive sample count and an inverted bound range", () => {
  assert.throws(() => estimateMonteCarloIntegral("x", "x", 0, 1, 0, new Rng(1)), /positive integer/);
  assert.throws(() => estimateMonteCarloIntegral("x", "x", 5, 2, 100, new Rng(1)), /Upper bound must be greater/);
});
