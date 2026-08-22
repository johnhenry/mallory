import assert from "node:assert/strict";
import { test } from "node:test";
import { NumberTheory } from "@johnhenry/math";
import { buildGroupInfo, factorizeForPanel, solveCrt, tracedGcd } from "./discrete-math.ts";

test("buildGroupInfo: Z6 under addition is a group, abelian, with the expected Cayley table", () => {
  const info = buildGroupInfo("cyclic", 6);
  assert.equal(info.labels.length, 6);
  assert.equal(info.isGroup, true);
  assert.equal(info.isAbelian, true);
  assert.equal(info.identityIndex, 0);
  // table[i][j] should be (i+j) mod 6, matching the elements' own index (labels are "0".."5" in order).
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) {
      assert.equal(info.table[i]?.[j], (i + j) % 6);
    }
  }
});

test("buildGroupInfo: Z6's element orders match the known cyclic-group orders (1,6,3,2,3,6)", () => {
  const info = buildGroupInfo("cyclic", 6);
  assert.deepEqual(info.elementOrders, [1, 6, 3, 2, 3, 6]);
});

test("buildGroupInfo: S3 is a group, non-abelian, with 6 elements", () => {
  const info = buildGroupInfo("symmetric", 3);
  assert.equal(info.labels.length, 6);
  assert.equal(info.isGroup, true);
  assert.equal(info.isAbelian, false);
  assert.ok(info.identityIndex !== null);
});

test("buildGroupInfo: S1 is trivially abelian (single element)", () => {
  const info = buildGroupInfo("symmetric", 1);
  assert.equal(info.labels.length, 1);
  assert.equal(info.isAbelian, true);
});

test("buildGroupInfo: rejects n above the Sn size cap", () => {
  assert.throws(() => buildGroupInfo("symmetric", 6), /only supported up to/);
});

test("buildGroupInfo: rejects a non-positive-integer n", () => {
  assert.throws(() => buildGroupInfo("cyclic", 0));
  assert.throws(() => buildGroupInfo("cyclic", -3));
});

test("tracedGcd: matches NumberTheory.gcd's own result across several pairs", () => {
  const pairs: [bigint, bigint][] = [[48n, 18n], [270n, 192n], [17n, 5n], [0n, 7n], [100n, 100n]];
  for (const [a, b] of pairs) {
    const { gcd } = tracedGcd(a, b);
    assert.equal(gcd, NumberTheory.gcd(a, b), `mismatch for gcd(${a},${b})`);
  }
});

test("tracedGcd: every step's remainder is consistent with a = q*b + r", () => {
  const { steps } = tracedGcd(270n, 192n);
  assert.ok(steps.length > 0);
  for (const step of steps) {
    assert.equal(step.q * step.b + step.r, step.a);
    assert.ok(step.r >= 0n && step.r < step.b);
  }
});

test("tracedGcd: the last step's b is the final gcd", () => {
  const { steps, gcd } = tracedGcd(48n, 18n);
  assert.equal(steps[steps.length - 1]?.b, gcd);
});

test("factorizeForPanel: 360 = 2^3 * 3^2 * 5", () => {
  const { factors, isPrime } = factorizeForPanel(360n);
  assert.deepEqual(factors, [[2n, 3], [3n, 2], [5n, 1]]);
  assert.equal(isPrime, false);
});

test("factorizeForPanel: a prime factors as itself^1", () => {
  const { factors, isPrime } = factorizeForPanel(97n);
  assert.deepEqual(factors, [[97n, 1]]);
  assert.equal(isPrime, true);
});

test("factorizeForPanel: rejects n < 2", () => {
  assert.throws(() => factorizeForPanel(1n));
  assert.throws(() => factorizeForPanel(0n));
});

test("solveCrt: x=23 (mod 3)=2, (mod 5)=3, (mod 7)=2 -- the textbook example", () => {
  const result = solveCrt([2n, 3n, 2n], [3n, 5n, 7n]);
  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.x, 23n);
    assert.equal(result.modulus, 105n);
  }
});

test("solveCrt: non-coprime moduli report ok:false rather than throwing", () => {
  const result = solveCrt([1n, 2n], [4n, 6n]); // gcd(4,6)=2, inconsistent for these remainders
  assert.equal(result.ok, false);
});

test("solveCrt: rejects mismatched array lengths", () => {
  assert.throws(() => solveCrt([1n, 2n], [3n]));
});
