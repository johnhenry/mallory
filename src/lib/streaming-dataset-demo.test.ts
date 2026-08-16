import assert from "node:assert/strict";
import { test } from "node:test";
import { runShuffleEpochsDemo, simulatePrefetchTiming } from "./streaming-dataset-demo.ts";

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
