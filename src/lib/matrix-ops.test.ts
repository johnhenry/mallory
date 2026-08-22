import assert from "node:assert/strict";
import { test } from "node:test";
import { MatrixMath } from "@johnhenry/math";
import {
  computeDecompositions,
  computeDeterminant,
  computeInverse,
  parseMatrixText,
  polynomialRootsViaCompanionMatrix,
  tracedRref,
} from "./matrix-ops.ts";

test("parseMatrixText: parses a well-formed matrix", () => {
  const m = parseMatrixText("1, 2, 3\n4 5 6\n7,8,9");
  assert.deepEqual(m, [
    [1, 2, 3],
    [4, 5, 6],
    [7, 8, 9],
  ]);
});

test("parseMatrixText: rejects ragged rows", () => {
  assert.throws(() => parseMatrixText("1 2 3\n4 5"), /same number of entries/);
});

test("parseMatrixText: rejects non-numeric entries", () => {
  assert.throws(() => parseMatrixText("1 2\nx 4"), /must be a number/);
});

test("parseMatrixText: rejects empty input", () => {
  assert.throws(() => parseMatrixText(""));
});

test("computeDeterminant: hand-computed 2x2", () => {
  // det([[4,3],[6,3]]) = 4*3 - 3*6 = -6
  assert.equal(computeDeterminant([[4, 3], [6, 3]]).value, -6);
});

test("computeDeterminant: identity is 1", () => {
  assert.equal(
    computeDeterminant([
      [1, 0],
      [0, 1],
    ]).value,
    1,
  );
});

test("computeDeterminant: rejects a non-square matrix", () => {
  assert.throws(() => computeDeterminant([[1, 2, 3], [4, 5, 6]]), /square/);
});

test("computeInverse: A * inv(A) = I for a hand-checkable 2x2", () => {
  const A = [[4, 3], [6, 3]];
  const inv = computeInverse(A).matrix;
  // (A * inv)[0][0] = 4*inv[0][0] + 3*inv[1][0]
  const c00 = (A[0]?.[0] as number) * (inv[0]?.[0] as number) + (A[0]?.[1] as number) * (inv[1]?.[0] as number);
  const c11 = (A[1]?.[0] as number) * (inv[0]?.[1] as number) + (A[1]?.[1] as number) * (inv[1]?.[1] as number);
  assert.ok(Math.abs(c00 - 1) < 1e-9);
  assert.ok(Math.abs(c11 - 1) < 1e-9);
});

test("tracedRref: final result matches MatrixMath.rref's own (independent) implementation", () => {
  const cases: number[][][] = [
    [[1, 2, 1], [2, 4, 0], [1, 1, 2]],
    [[2, 1, -1, 8], [-3, -1, 2, -11], [-2, 1, 2, -3]],
    [[1, 2], [3, 4], [5, 6]],
  ];
  for (const m of cases) {
    const traced = tracedRref(m).result;
    const reference = [...MatrixMath.rref(m)].map((row) => [...row]);
    assert.equal(traced.length, reference.length);
    for (let i = 0; i < traced.length; i++) {
      for (let j = 0; j < (traced[i] as number[]).length; j++) {
        assert.ok(
          Math.abs(((traced[i] as number[])[j] as number) - ((reference[i] as number[])[j] as number)) < 1e-6,
          `mismatch at [${i}][${j}]: traced=${(traced[i] as number[])[j]}, reference=${(reference[i] as number[])[j]}`,
        );
      }
    }
  }
});

test("tracedRref: records at least one step for a non-trivial matrix", () => {
  const { steps } = tracedRref([[2, 4], [1, 3]]);
  assert.ok(steps.length > 0);
  // Every recorded step's matrix has the same shape as the input.
  for (const step of steps) {
    assert.equal(step.matrix.length, 2);
    assert.equal(step.matrix[0]?.length, 2);
  }
});

test("tracedRref: a matrix already in RREF records zero steps", () => {
  const identity = [[1, 0], [0, 1]];
  const { result, steps } = tracedRref(identity);
  assert.deepEqual(result, identity);
  assert.equal(steps.length, 0);
});

test("computeDecompositions: LU reconstructs the original matrix (P*A = L*U)", () => {
  const A = [[4, 3], [6, 3]];
  const { lu } = computeDecompositions(A);
  // Reconstruct L*U and compare against P*A.
  const L = [...lu.L].map((r) => [...r]) as number[][];
  const U = [...lu.U].map((r) => [...r]) as number[][];
  const P = [...lu.P].map((r) => [...r]) as number[][];
  const n = A.length;
  const LU: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) (LU[i] as number[])[j] += (L[i]?.[k] as number) * (U[k]?.[j] as number);
  const PA: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) (PA[i] as number[])[j] += (P[i]?.[k] as number) * (A[k]?.[j] as number);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) assert.ok(Math.abs((LU[i] as number[])[j]! - (PA[i] as number[])[j]!) < 1e-9);
});

test("computeDecompositions: eigenSymmetric is present for a symmetric matrix, absent for a non-symmetric one", () => {
  const symmetric = computeDecompositions([[2, 1], [1, 2]]);
  assert.ok(symmetric.eigenSymmetric !== undefined);
  const nonSymmetric = computeDecompositions([[2, 1], [0, 2]]);
  assert.equal(nonSymmetric.eigenSymmetric, undefined);
});

test("computeDecompositions: cholesky fails cleanly on a non-positive-definite matrix without breaking the other decompositions", () => {
  const notPosDef = [[1, 2], [2, 1]]; // eigenvalues 3, -1 -- indefinite
  const result = computeDecompositions(notPosDef);
  assert.ok(typeof result.choleskyError === "string");
  assert.ok(result.lu !== undefined);
  assert.ok(result.svd !== undefined);
});

test("computeDecompositions: nullSpace basis vectors are genuine kernel elements (A*v = 0)", () => {
  const A = [[1, 2, 3], [2, 4, 6]]; // rank 1, 2-dimensional null space
  const { nullSpace } = computeDecompositions(A);
  assert.equal(nullSpace.length, 2);
  for (const v of nullSpace) {
    for (const row of A) {
      const dot = row.reduce((sum, a, i) => sum + a * (v[i] as number), 0);
      assert.ok(Math.abs(dot) < 1e-9, `A*v should be 0, got ${dot} for v=${v}`);
    }
  }
});

test("computeDecompositions: a full-rank square matrix's null space is the trivial {0} (MatrixMath represents this as a single all-zero row, not an empty basis)", () => {
  const { nullSpace } = computeDecompositions([[1, 0], [0, 1]]);
  assert.equal(nullSpace.length, 1);
  assert.ok((nullSpace[0] as number[]).every((v) => v === 0));
});

test("polynomialRootsViaCompanionMatrix: x^3 - 6x^2 + 11x - 6 has roots 1, 2, 3", () => {
  const roots = polynomialRootsViaCompanionMatrix([-6, 11, -6]);
  assert.equal(roots.length, 3);
  const realParts = roots.map((r) => r.value).sort((a, b) => a - b);
  assert.ok(Math.abs((realParts[0] as number) - 1) < 1e-6);
  assert.ok(Math.abs((realParts[1] as number) - 2) < 1e-6);
  assert.ok(Math.abs((realParts[2] as number) - 3) < 1e-6);
  for (const r of roots) assert.ok(Math.abs(r.iValue) < 1e-6);
});

test("polynomialRootsViaCompanionMatrix: x^2 + 1 has roots +-i (genuinely complex, no real root exists)", () => {
  const roots = polynomialRootsViaCompanionMatrix([1, 0]);
  assert.equal(roots.length, 2);
  for (const r of roots) {
    assert.ok(Math.abs(r.value) < 1e-6);
    assert.ok(Math.abs(Math.abs(r.iValue) - 1) < 1e-6);
  }
});
