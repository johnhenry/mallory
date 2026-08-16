import assert from "node:assert/strict";
import { test } from "node:test";
import { CellGraph } from "./cell-graph.ts";
import { cellIdsMatrix } from "./cell-ids.ts";
import { resolveMatrixChatCommand } from "./matrix-chat-commands.ts";
import { computeDecompositions, computeDeterminant, computeInverse, type Mat } from "./matrix-ops.ts";

type Result<T> = { ok: true; value: T } | { ok: false; message: string };

function seededGraph(matrix: Mat) {
  const graph = new CellGraph();
  const ids = cellIdsMatrix("test");
  graph.define(ids.determinant, (): Result<number> => {
    try {
      return { ok: true, value: computeDeterminant(matrix).value };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });
  graph.define(ids.inverse, (): Result<Mat> => {
    try {
      return { ok: true, value: computeInverse(matrix).matrix };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });
  graph.define(ids.decompositions, () => ({ ok: true as const, value: computeDecompositions(matrix) }));
  return { graph, ids };
}

test("resolveMatrixChatCommand: returns null for an unrecognized phrasing", () => {
  const { graph, ids } = seededGraph([[1, 0], [0, 1]]);
  assert.equal(resolveMatrixChatCommand("what's the weather", { graph, ids }), null);
});

test('resolveMatrixChatCommand: "invert this matrix" reports the already-computed inverse, hand-verified for a simple 2x2', () => {
  // [[2,0],[0,2]]^-1 = [[0.5,0],[0,0.5]]
  const { graph, ids } = seededGraph([
    [2, 0],
    [0, 2],
  ]);
  const result = resolveMatrixChatCommand("invert this matrix", { graph, ids });
  assert.equal(result?.ok, true);
  assert.equal(result?.message, "Inverse: [0.5000, 0.0000] [0.0000, 0.5000]");
});

test('resolveMatrixChatCommand: "inverse of the matrix" is also recognized (alternate phrasing)', () => {
  const { graph, ids } = seededGraph([
    [2, 0],
    [0, 2],
  ]);
  const result = resolveMatrixChatCommand("inverse of the matrix", { graph, ids });
  assert.equal(result?.ok, true);
});

test('resolveMatrixChatCommand: "invert this matrix" on a non-square matrix surfaces the same error computeInverse throws', () => {
  const { graph, ids } = seededGraph([[1, 2, 3]]);
  const result = resolveMatrixChatCommand("invert this matrix", { graph, ids });
  assert.equal(result?.ok, false);
  assert.match(result!.message, /Inverse requires a square matrix\./);
});

test('resolveMatrixChatCommand: "determinant of this matrix" reports the hand-computed value', () => {
  // det([[1,2],[3,4]]) = 1*4 - 2*3 = -2
  const { graph, ids } = seededGraph([
    [1, 2],
    [3, 4],
  ]);
  const result = resolveMatrixChatCommand("determinant of this matrix", { graph, ids });
  assert.equal(result?.ok, true);
  assert.equal(result?.message, "Determinant: -2.0000");
});

test('resolveMatrixChatCommand: "eigenvalues of this matrix" on a symmetric matrix reports the eigenSymmetric values', () => {
  // [[2,0],[0,3]] is diagonal (trivially symmetric): eigenvalues are 2 and 3.
  const { graph, ids } = seededGraph([
    [2, 0],
    [0, 3],
  ]);
  const result = resolveMatrixChatCommand("eigenvalues of this matrix", { graph, ids });
  assert.equal(result?.ok, true);
  assert.match(result!.message, /^Eigenvalues: /);
  const values = result!.message
    .replace("Eigenvalues: ", "")
    .split(", ")
    .map(Number)
    .sort((a, b) => a - b);
  assert.deepEqual(values, [2, 3]);
});

test('resolveMatrixChatCommand: "eigenvalues of this matrix" on a NON-symmetric matrix reports the "only computed for symmetric" message, matching MatrixPanel\'s own actual capability', () => {
  const { graph, ids } = seededGraph([
    [1, 2],
    [3, 4],
  ]);
  const result = resolveMatrixChatCommand("eigenvalues of this matrix", { graph, ids });
  assert.equal(result?.ok, false);
  assert.match(result!.message, /only computed for a symmetric matrix/);
});

test("resolveMatrixChatCommand: is case-insensitive and tolerant of extra whitespace", () => {
  const { graph, ids } = seededGraph([
    [1, 0],
    [0, 1],
  ]);
  const result = resolveMatrixChatCommand("  INVERT   THIS   MATRIX  ", { graph, ids });
  assert.equal(result?.ok, true);
});
