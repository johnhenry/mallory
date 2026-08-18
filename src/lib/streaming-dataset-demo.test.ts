import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeWindowedAverage,
  generateNoisySignal,
  runConcurrentOrderingDemo,
  runShuffleEpochsDemo,
  simulatePrefetchTiming,
  simulateTeeConsumers,
} from "./streaming-dataset-demo.ts";

test("runShuffleEpochsDemo: rejects a non-positive size or epochCount", () => {
  assert.rejects(() => runShuffleEpochsDemo(0, 3, 1), /size must be positive/);
  assert.rejects(() => runShuffleEpochsDemo(5, 0, 1), /epochCount must be positive/);
});

test("runShuffleEpochsDemo: returns exactly epochCount arrays, each a permutation of [0, size)", async () => {
  const epochs = await runShuffleEpochsDemo(6, 4, 7);
  assert.equal(epochs.length, 4);
  for (const epoch of epochs) {
    assert.deepEqual(
      [...epoch].sort((a, b) => a - b),
      [0, 1, 2, 3, 4, 5],
    );
  }
});

test("runShuffleEpochsDemo: the same seed reproduces the exact same epoch sequence", async () => {
  const a = await runShuffleEpochsDemo(8, 3, 99);
  const b = await runShuffleEpochsDemo(8, 3, 99);
  assert.deepEqual(a, b);
});

test("runShuffleEpochsDemo: different seeds produce a different sequence (not a no-op shuffle)", async () => {
  const a = await runShuffleEpochsDemo(10, 3, 1);
  const b = await runShuffleEpochsDemo(10, 3, 2);
  assert.notDeepEqual(a, b);
});

test("runShuffleEpochsDemo: consecutive epochs differ from each other (reshuffle, not the same order repeated)", async () => {
  const epochs = await runShuffleEpochsDemo(10, 3, 5);
  assert.notDeepEqual(epochs[0], epochs[1]);
  assert.notDeepEqual(epochs[1], epochs[2]);
});

test("simulatePrefetchTiming: rejects a non-positive itemCount", () => {
  assert.rejects(() => simulatePrefetchTiming(0, 1, 1, 1), /itemCount must be positive/);
});

test("simulatePrefetchTiming: with a fake instant sleep, both configs still yield itemCount items in source order", async () => {
  const noopSleep = () => Promise.resolve();
  const { withPrefetch, withoutPrefetch } = await simulatePrefetchTiming(5, 5, 5, 2, noopSleep);
  assert.equal(withPrefetch.length, 5);
  assert.equal(withoutPrefetch.length, 5);
});

test("simulatePrefetchTiming: arrival times are non-decreasing (items don't arrive out of order)", async () => {
  const noopSleep = () => Promise.resolve();
  const { withPrefetch, withoutPrefetch } = await simulatePrefetchTiming(6, 2, 2, 2, noopSleep);
  for (const arrivals of [withPrefetch, withoutPrefetch]) {
    for (let i = 1; i < arrivals.length; i++) {
      assert.ok(arrivals[i] >= arrivals[i - 1], `arrivals not non-decreasing at index ${i}: ${arrivals}`);
    }
  }
});

test("simulatePrefetchTiming: onArrival fires once per item per config, in index order, matching the returned arrays", async () => {
  const noopSleep = () => Promise.resolve();
  const seen: Array<{ config: string; index: number; ms: number }> = [];
  const result = await simulatePrefetchTiming(4, 1, 1, 2, noopSleep, (config, index, ms) => {
    seen.push({ config, index, ms });
  });
  assert.equal(seen.length, 8);
  const withPrefetchSeen = seen.filter((s) => s.config === "withPrefetch").map((s) => s.index);
  const withoutPrefetchSeen = seen.filter((s) => s.config === "withoutPrefetch").map((s) => s.index);
  assert.deepEqual(withPrefetchSeen, [0, 1, 2, 3]);
  assert.deepEqual(withoutPrefetchSeen, [0, 1, 2, 3]);
  assert.deepEqual(
    seen.filter((s) => s.config === "withPrefetch").map((s) => s.ms),
    result.withPrefetch,
  );
});

test("simulatePrefetchTiming: prefetching overlaps producer and consumer latency, finishing sooner than without it (real timers, small delays)", async () => {
  const { withPrefetch, withoutPrefetch } = await simulatePrefetchTiming(5, 10, 10, 3);
  assert.ok(withPrefetch.at(-1)! < withoutPrefetch.at(-1)!, `expected prefetch total (${withPrefetch.at(-1)}) < no-prefetch total (${withoutPrefetch.at(-1)})`);
});

test("runConcurrentOrderingDemo: rejects non-positive itemCount, non-positive concurrency, and empty durationsMs", () => {
  assert.rejects(() => runConcurrentOrderingDemo(0, [1], 1), /itemCount must be positive/);
  assert.rejects(() => runConcurrentOrderingDemo(3, [1], 0), /concurrency must be positive/);
  assert.rejects(() => runConcurrentOrderingDemo(3, [], 1), /durationsMs must contain at least one value/);
});

test("runConcurrentOrderingDemo: ordered mode always returns items in input order regardless of per-item duration", async () => {
  const noopSleep = () => Promise.resolve();
  const { ordered } = await runConcurrentOrderingDemo(6, [30, 3, 30, 3, 30, 3], 6, noopSleep);
  assert.deepEqual(ordered, [0, 1, 2, 3, 4, 5]);
});

test("runConcurrentOrderingDemo: unordered mode is a permutation of the same indices as ordered mode", async () => {
  const noopSleep = () => Promise.resolve();
  const { ordered, unordered } = await runConcurrentOrderingDemo(6, [30, 3, 30, 3, 30, 3], 6, noopSleep);
  assert.deepEqual([...unordered].sort((a, b) => a - b), [...ordered].sort((a, b) => a - b));
});

test("runConcurrentOrderingDemo: unordered mode lets fast items overtake slower ones that started earlier (real timers, small delays)", async () => {
  // Indices 1, 3, 5 are fast (3ms); indices 0, 2, 4 are slow (30ms). With
  // concurrency covering all 6 items, they all start together, so
  // completion order should track duration, not input position.
  const { unordered } = await runConcurrentOrderingDemo(6, [30, 3, 30, 3, 30, 3], 6);
  const fastPositions = [1, 3, 5].map((i) => unordered.indexOf(i));
  const slowPositions = [0, 2, 4].map((i) => unordered.indexOf(i));
  assert.ok(
    Math.max(...fastPositions) < Math.min(...slowPositions),
    `expected all fast items before all slow items in unordered result: ${unordered}`,
  );
});

test("generateNoisySignal: rejects non-positive n", () => {
  assert.throws(() => generateNoisySignal(0, 1, 1), /n must be positive/);
});

test("generateNoisySignal: returns n samples, deterministic for a given seed, different across seeds", () => {
  const a = generateNoisySignal(20, 42, 0.5);
  const b = generateNoisySignal(20, 42, 0.5);
  const c = generateNoisySignal(20, 43, 0.5);
  assert.equal(a.length, 20);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test("computeWindowedAverage: rejects a non-positive or too-large windowSize", () => {
  assert.rejects(() => computeWindowedAverage([1, 2, 3], 0), /windowSize must be positive/);
  assert.rejects(() => computeWindowedAverage([1, 2, 3], 4), /must not exceed values\.length/);
});

test("computeWindowedAverage: windowSize 1 returns the values unchanged", async () => {
  const result = await computeWindowedAverage([5, 1, 9, 2], 1);
  assert.deepEqual(result, [5, 1, 9, 2]);
});

test("computeWindowedAverage: averages each overlapping window and yields values.length - windowSize + 1 points", async () => {
  const result = await computeWindowedAverage([1, 3, 5, 7], 2);
  assert.deepEqual(result, [2, 4, 6]);
});

test("computeWindowedAverage: a constant signal stays constant after smoothing", async () => {
  const result = await computeWindowedAverage([4, 4, 4, 4, 4], 3);
  assert.deepEqual(result, [4, 4, 4]);
});

test("simulateTeeConsumers: rejects non-positive itemCount", () => {
  assert.rejects(() => simulateTeeConsumers(0, 1, 1, 1), /itemCount must be positive/);
});

test("simulateTeeConsumers: both branches see every item, in order, with a fake instant sleep", async () => {
  const noopSleep = () => Promise.resolve();
  const seen: Array<{ branch: string; item: number }> = [];
  const { fastArrivals, slowArrivals } = await simulateTeeConsumers(5, 1, 1, 1, noopSleep, (branch, item) => {
    seen.push({ branch, item });
  });
  assert.equal(fastArrivals.length, 5);
  assert.equal(slowArrivals.length, 5);
  // A guard against the tee's known concurrent-cold-start race (see the
  // implementation comment): both branches must see items 0..4, in order,
  // with none skipped or duplicated, even when both consumers race to pull
  // from an unstarted source at the same instant.
  assert.deepEqual(
    seen.filter((s) => s.branch === "fast").map((s) => s.item),
    [0, 1, 2, 3, 4],
  );
  assert.deepEqual(
    seen.filter((s) => s.branch === "slow").map((s) => s.item),
    [0, 1, 2, 3, 4],
  );
});

test("simulateTeeConsumers: onArrival fires once per item per branch, matching the returned arrays", async () => {
  const noopSleep = () => Promise.resolve();
  const seen: Array<{ branch: string; item: number; ms: number }> = [];
  const result = await simulateTeeConsumers(4, 1, 1, 1, noopSleep, (branch, item, ms) => {
    seen.push({ branch, item, ms });
  });
  assert.equal(seen.length, 8);
  assert.deepEqual(
    seen.filter((s) => s.branch === "fast").map((s) => s.item),
    [0, 1, 2, 3],
  );
  assert.deepEqual(
    seen.filter((s) => s.branch === "fast").map((s) => s.ms),
    result.fastArrivals,
  );
});

test("simulateTeeConsumers: a slow branch never blocks the fast branch, no matter how slow (real timers)", async () => {
  const { fastArrivals, slowArrivals } = await simulateTeeConsumers(5, 5, 2, 200, undefined, undefined);
  // The fast branch should finish in roughly itemCount * max(produceMs, fastConsumeMs),
  // completely unaffected by slowConsumeMs -- well under what the slow branch needs.
  assert.ok(fastArrivals.at(-1)! < 100, `expected fast branch to finish quickly, got ${fastArrivals.at(-1)}ms`);
  assert.ok(slowArrivals.at(-1)! > fastArrivals.at(-1)!, "expected the slow branch to finish after the fast branch");
});
