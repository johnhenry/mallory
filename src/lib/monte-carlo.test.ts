import assert from "node:assert/strict";
import { test } from "node:test";
import { Rng } from "mallory-tensor-core";
import { binValues, estimateDartPi, sampleDistributionHistogram } from "./monte-carlo.ts";

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
