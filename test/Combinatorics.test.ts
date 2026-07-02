import assert from "node:assert/strict";
import { test } from "node:test";
import { Cycle } from "../src/Cycle.ts";
import { Permutation } from "../src/Permutation.ts";
import { PolynomialRing, polynomialToString } from "../src/PolynomialRing.ts";
import { Structure } from "../src/Structure.ts";

const R = new PolynomialRing(Structure.realField());

test("Cycle rejects repeats (bug fix)", () => {
  assert.throws(() => new Cycle([1, 2, 1]));
});

test("Cycle apply maps each element to the next, wrapping", () => {
  const c = new Cycle(["a", "b", "c"]);
  assert.equal(c.apply("a"), "b");
  assert.equal(c.apply("c"), "a");
  assert.equal(c.apply("z"), "z", "outside the cycle -> identity");
});

test("Cycle inverse / shift / toString", () => {
  const c = new Cycle([1, 2, 3]);
  assert.equal(c.toString(), "(1,2,3)");
  assert.deepEqual(c.inverse().elements, [3, 2, 1]);
  assert.deepEqual(c.shiftedLeft().elements, [2, 3, 1]);
});

test("Cycle even/odd and length", () => {
  assert.equal(new Cycle([1, 2, 3]).even(), true, "3-cycle is even");
  assert.equal(new Cycle([1, 2]).even(), false, "transposition is odd");
  assert.equal(new Cycle([5]).length, 1);
});

test("Cycle equal up to rotation, disjoint", () => {
  assert.equal(Cycle.equal(new Cycle([1, 2, 3]), new Cycle([2, 3, 1])), true);
  assert.equal(Cycle.equal(new Cycle([1, 2, 3]), new Cycle([1, 3, 2])), false);
  assert.equal(Cycle.disjoint(new Cycle([1, 2]), new Cycle([3, 4])), true);
  assert.equal(Cycle.disjoint(new Cycle([1, 2]), new Cycle([2, 3])), false);
});

test("Permutation apply and inverse", () => {
  const p = new Permutation([1, 2, 3], [2, 3, 1]);
  assert.equal(p.apply(1), 2);
  assert.equal(p.apply(3), 1);
  const inv = p.inverse();
  assert.equal(inv.apply(2), 1);
});

test("Permutation constructor rejects mismatched lengths (bug fix)", () => {
  assert.throws(() => new Permutation([1, 2], [1]));
});

test("Permutation cycle decomposition", () => {
  const p = new Permutation([1, 2, 3, 4], [2, 1, 4, 3]);
  const cycles = p.cycles();
  assert.equal(cycles.length, 2);
  assert.ok(cycles.every((c) => c.length === 2));
});

test("Permutation order via LCM of cycle lengths (bug fix)", () => {
  // (1 2 3)(4 5): order = lcm(3,2) = 6
  const p = new Permutation([1, 2, 3, 4, 5], [2, 3, 1, 5, 4]);
  assert.equal(p.order(), 6);
  assert.equal((Permutation.Identity as Permutation).order(), 1);
});

test("Permutation compose and commute", () => {
  const a = new Permutation([1, 2, 3], [2, 3, 1]);
  const b = new Permutation([1, 2, 3], [2, 1, 3]);
  const ab = Permutation.compose(a, b);
  // (a∘b)(1) = a(b(1)) = a(2) = 3
  assert.equal(ab.apply(1), 3);
  assert.equal(Permutation.commute(a, a.inverse()), true);
});

test("Cycle <-> Permutation round trip", () => {
  const c = new Cycle([1, 2, 3]);
  const p = c.toPermutation();
  assert.equal(p.apply(1), 2);
  assert.equal(p.apply(3), 1);
});

test("PolynomialRing degree / derivative / antiderivative", () => {
  const p = [1, 2, 3]; // 3x^2 + 2x + 1
  assert.equal(R.degree(p), 2);
  assert.deepEqual(R.derivative(p), [2, 6]); // 6x + 2
  assert.deepEqual(R.antiderivative(p), [0, 1, 1, 1]); // x^3 + x^2 + x
});

test("PolynomialRing multiply (bug fix: dimension.value)", () => {
  const a = [1, 1]; // x + 1
  const b = [1, 1]; // x + 1
  // (x+1)^2 = x^2 + 2x + 1
  assert.deepEqual(R.multiply(a, b), [1, 2, 1]);
});

test("polynomialToString", () => {
  const p = [1, 2, 3];
  assert.equal(polynomialToString(p), "3*x^2+2*x+1");
  assert.equal(polynomialToString(p, "x", false), "1+2*x+3*x^2");
});
