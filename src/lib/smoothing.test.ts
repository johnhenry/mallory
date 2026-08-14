import assert from "node:assert/strict";
import { test } from "node:test";
import { buildKernel, gaussianKernel, movingAverageKernel, residualSeries, smoothSeries } from "./smoothing.ts";

test("movingAverageKernel: width 3 is a uniform kernel summing to 1", () => {
  const k = movingAverageKernel(3);
  assert.deepEqual(Array.from(k), [1 / 3, 1 / 3, 1 / 3]);
});

test("movingAverageKernel: rejects even or non-positive width", () => {
  assert.throws(() => movingAverageKernel(4), /odd integer/);
  assert.throws(() => movingAverageKernel(0), /odd integer/);
  assert.throws(() => movingAverageKernel(-1), /odd integer/);
});

test("gaussianKernel: is normalized (sums to ~1) and symmetric", () => {
  const k = gaussianKernel(5);
  const sum = Array.from(k).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `sum=${sum}`);
  assert.ok(Math.abs(k[0]! - k[4]!) < 1e-12);
  assert.ok(Math.abs(k[1]! - k[3]!) < 1e-12);
});

test("gaussianKernel: peaks at the center", () => {
  const k = gaussianKernel(5);
  assert.ok(k[2]! > k[1]! && k[1]! > k[0]!);
});

test("buildKernel: dispatches to the right kernel by name", () => {
  assert.deepEqual(Array.from(buildKernel("moving-average", 3)), Array.from(movingAverageKernel(3)));
  assert.deepEqual(Array.from(buildKernel("gaussian", 5)), Array.from(gaussianKernel(5)));
});

test("smoothSeries: box-kernel-3 on a linear ramp trims the boundary and reproduces the center-average interior exactly", () => {
  const data = [1, 2, 3, 4, 5, 6, 7];
  const smoothed = smoothSeries(data, movingAverageKernel(3));
  assert.deepEqual(smoothed.indices, [1, 2, 3, 4, 5]);
  smoothed.values.forEach((v, i) => {
    assert.ok(Math.abs(v - data[smoothed.indices[i]!]!) < 1e-9, `index ${smoothed.indices[i]}: ${v}`);
  });
});

test("smoothSeries: trims floor(width/2) points off each end, matching the kernel's half-width", () => {
  const data = Array.from({ length: 10 }, (_, i) => i);
  const smoothed = smoothSeries(data, movingAverageKernel(5)); // half-width 2
  assert.equal(smoothed.indices[0], 2);
  assert.equal(smoothed.indices[smoothed.indices.length - 1], 7); // 10-1-2
  assert.equal(smoothed.indices.length, 6);
});

test("smoothSeries: rejects empty data and a kernel wider than the data", () => {
  assert.throws(() => smoothSeries([], movingAverageKernel(3)), /No data/);
  assert.throws(() => smoothSeries([1, 2], movingAverageKernel(5)), /can't exceed/);
});

test("residualSeries: raw minus smoothed is ~0 for a perfectly linear series (a box filter reproduces a line's own center value)", () => {
  const data = [1, 2, 3, 4, 5, 6, 7];
  const smoothed = smoothSeries(data, movingAverageKernel(3));
  const residuals = residualSeries(data, smoothed);
  residuals.forEach((r) => assert.ok(Math.abs(r) < 1e-9, `residual: ${r}`));
});

test("residualSeries: is nonzero where the raw data deviates from its local smoothed trend", () => {
  const data = [0, 0, 0, 10, 0, 0, 0]; // a single spike
  const smoothed = smoothSeries(data, movingAverageKernel(3));
  const residuals = residualSeries(data, smoothed);
  const spikeResidualIndex = smoothed.indices.indexOf(3);
  assert.ok(Math.abs(residuals[spikeResidualIndex]!) > 1, `residual at the spike: ${residuals[spikeResidualIndex]}`);
});
