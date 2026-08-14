import assert from "node:assert/strict";
import { test } from "node:test";
import { memoizeLru } from "./memoize-lru.ts";

function countingFn() {
  let calls = 0;
  const fn = (a: number, b: number) => {
    calls++;
    return a + b;
  };
  return { fn, callCount: () => calls };
}

test("memoizeLru: identical repeated calls invoke the underlying function only once", () => {
  const { fn, callCount } = countingFn();
  const memoized = memoizeLru(fn);
  assert.equal(memoized(2, 3), 5);
  assert.equal(memoized(2, 3), 5);
  assert.equal(memoized(2, 3), 5);
  assert.equal(callCount(), 1);
});

test("memoizeLru: different arguments are cached separately, each invoking the underlying function once", () => {
  const { fn, callCount } = countingFn();
  const memoized = memoizeLru(fn);
  assert.equal(memoized(1, 1), 2);
  assert.equal(memoized(2, 2), 4);
  assert.equal(memoized(1, 1), 2);
  assert.equal(memoized(2, 2), 4);
  assert.equal(callCount(), 2);
});

test("memoizeLru: evicts the least-recently-used entry once maxSize is exceeded", () => {
  const { fn, callCount } = countingFn();
  const memoized = memoizeLru(fn, { maxSize: 2 });
  memoized(1, 0); // cache: [1]
  memoized(2, 0); // cache: [1, 2]
  memoized(3, 0); // evicts 1 (least recently used) -- cache: [2, 3]
  assert.equal(callCount(), 3);
  memoized(1, 0); // 1 was evicted -- must recompute
  assert.equal(callCount(), 4);
});

test("memoizeLru: accessing an entry refreshes its recency, protecting it from eviction", () => {
  const { fn, callCount } = countingFn();
  const memoized = memoizeLru(fn, { maxSize: 2 });
  memoized(1, 0); // cache: [1]
  memoized(2, 0); // cache: [1, 2]
  memoized(1, 0); // re-access 1 -- recency order becomes [2, 1], call count still 2
  assert.equal(callCount(), 2);
  memoized(3, 0); // evicts 2 (now least recently used, not 1) -- cache: [1, 3]
  assert.equal(callCount(), 3);
  memoized(1, 0); // 1 should still be cached
  assert.equal(callCount(), 3);
  memoized(2, 0); // 2 was evicted -- must recompute
  assert.equal(callCount(), 4);
});

test("memoizeLru: defaults to a maxSize of 20", () => {
  const { fn, callCount } = countingFn();
  const memoized = memoizeLru(fn);
  for (let i = 0; i < 20; i++) memoized(i, 0);
  assert.equal(callCount(), 20);
  for (let i = 0; i < 20; i++) memoized(i, 0); // all 20 should still be cached
  assert.equal(callCount(), 20);
  memoized(20, 0); // the 21st distinct call evicts the least-recently-used (0)
  assert.equal(callCount(), 21);
  memoized(0, 0); // 0 was evicted -- must recompute
  assert.equal(callCount(), 22);
});
