import assert from "node:assert/strict";
import { test } from "node:test";
import { frobeniusNormalForm } from "./frobenius.ts";
import type { Mat } from "./matrix-ops.ts";

/** Plain matrix multiply, local to this test file only (MatrixMath doesn't expose one publicly) -- used to cross-check that `P` really satisfies `P^T @ matrix @ P === permuted`, not just trust the hand-derived construction. */
function matMul(a: Mat, b: Mat): Mat {
  const n = a.length;
  const m = b[0]!.length;
  const k = b.length;
  return Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => Array.from({ length: k }, (_, l) => a[i]![l]! * b[l]![j]!).reduce((x, y) => x + y, 0)));
}

function transpose(a: Mat): Mat {
  return a[0]!.map((_, j) => a.map((row) => row[j]!));
}

test("frobeniusNormalForm: a single 3-cycle is irreducible (one strongly connected component)", () => {
  // 0 -> 1 -> 2 -> 0
  const matrix: Mat = [
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 0],
  ];
  const result = frobeniusNormalForm(matrix);
  assert.equal(result.irreducible, true);
  assert.equal(result.blocks.length, 1);
  assert.deepEqual(result.blocks[0]!.component.slice().sort(), [0, 1, 2]);
});

test("frobeniusNormalForm: P really satisfies P^T @ matrix @ P === permuted (direct multiply cross-check, not just the reindex construction)", () => {
  const matrix: Mat = [
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 0],
  ];
  const { P, permuted } = frobeniusNormalForm(matrix);
  const recomputed = matMul(matMul(transpose(P), matrix), P);
  assert.deepEqual(recomputed, permuted);
});

/**
 * The video's own worked example: two strongly connected 3-cycles (A =
 * {a0,a1,a2}, B = {b0,b1,b2}) with one edge A->B (a0->b0) and none B->A --
 * not strongly connected overall, reducible into upper block-triangular
 * form with a 3x3 zero block in the lower left. Entered here with rows/
 * columns deliberately SCRAMBLED (not already in component order), so the
 * test actually exercises the relabeling, not just a no-op identity
 * permutation. Scramble order (original semantic vertex -> matrix index):
 * index 0 = b1, index 1 = a0, index 2 = b2, index 3 = a1, index 4 = b0,
 * index 5 = a2.
 */
test("frobeniusNormalForm: two components with a one-way edge produce upper block-triangular form, zero lower-left block", () => {
  const matrix: Mat = [
    [0, 0, 1, 0, 0, 0], // b1 -> b2
    [0, 0, 0, 1, 1, 0], // a0 -> a1, a0 -> b0 (cross edge)
    [0, 0, 0, 0, 1, 0], // b2 -> b0
    [0, 0, 0, 0, 0, 1], // a1 -> a2
    [1, 0, 0, 0, 0, 0], // b0 -> b1
    [0, 1, 0, 0, 0, 0], // a2 -> a0
  ];
  const result = frobeniusNormalForm(matrix);

  assert.equal(result.irreducible, false);
  assert.equal(result.blocks.length, 2);

  // A = {a0,a1,a2} = original indices {1,3,5}; B = {b0,b1,b2} = {4,0,2}.
  const componentSets = result.blocks.map((b) => new Set(b.component));
  const aComponent = componentSets.find((s) => s.has(1))!;
  const bComponent = componentSets.find((s) => s.has(4))!;
  assert.deepEqual([...aComponent].sort(), [1, 3, 5]);
  assert.deepEqual([...bComponent].sort(), [0, 2, 4]);

  // A must come first (it's the source component: A -> B exists, B -> A doesn't).
  const aBlock = result.blocks.find((b) => b.component.includes(1))!;
  const bBlock = result.blocks.find((b) => b.component.includes(4))!;
  assert.ok(aBlock.start < bBlock.start, "the source component (A) must be ordered before the sink component (B)");

  // Lower-left block (B rows, A columns) is entirely zero -- no B -> A edges.
  for (let i = bBlock.start; i < bBlock.end; i++) {
    for (let j = aBlock.start; j < aBlock.end; j++) {
      assert.equal(result.permuted[i]![j], 0, `permuted[${i}][${j}] should be 0 (no B->A edges), got ${result.permuted[i]![j]}`);
    }
  }

  // The cross edge a0->b0 must land somewhere in the upper-right block (A rows, B columns).
  let crossEdgeFound = false;
  for (let i = aBlock.start; i < aBlock.end; i++) {
    for (let j = bBlock.start; j < bBlock.end; j++) {
      if (result.permuted[i]![j] === 1) crossEdgeFound = true;
    }
  }
  assert.ok(crossEdgeFound, "the a0->b0 cross edge must appear somewhere in the upper-right block");

  // Same direct multiply cross-check as the 3-cycle test above, on this larger example.
  const recomputed = matMul(matMul(transpose(result.P), matrix), result.P);
  assert.deepEqual(recomputed, result.permuted);
});

test("frobeniusNormalForm: throws on a non-square matrix", () => {
  assert.throws(() => frobeniusNormalForm([[1, 2, 3], [4, 5, 6]] as Mat), /square/);
});
