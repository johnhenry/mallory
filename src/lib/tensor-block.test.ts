import assert from "node:assert/strict";
import { test } from "node:test";
import { applyTensorOp, parseTensorGrid, summarizeTensor } from "./tensor-block.ts";

test("parseTensorGrid: spaces and commas both separate; one row per line; blank lines ignored", () => {
  assert.deepEqual(parseTensorGrid("1 2 3\n4, 5, 6"), [
    [1, 2, 3],
    [4, 5, 6],
  ]);
  assert.deepEqual(parseTensorGrid("\n  7  \n\n"), [[7]]);
});

test("parseTensorGrid: rejects ragged rows, non-numeric entries, empty input, and oversize grids", () => {
  assert.throws(() => parseTensorGrid("1 2\n3"), /same length/);
  assert.throws(() => parseTensorGrid("1 a"), /not a number/);
  assert.throws(() => parseTensorGrid("   \n  "), /at least one row/);
  assert.throws(() => parseTensorGrid(Array(17).fill("1").join("\n")), /At most 16 rows/);
  assert.throws(() => parseTensorGrid(Array(17).fill("1").join(" ")), /At most 16 columns/);
});

test("applyTensorOp: transpose/fliplr/flipud/roll match hand-computed results on a 2x3 grid", () => {
  const grid = [
    [1, 2, 3],
    [4, 5, 6],
  ];
  assert.deepEqual(applyTensorOp(grid, "transpose"), [
    [1, 4],
    [2, 5],
    [3, 6],
  ]);
  assert.deepEqual(applyTensorOp(grid, "fliplr"), [
    [3, 2, 1],
    [6, 5, 4],
  ]);
  assert.deepEqual(applyTensorOp(grid, "flipud"), [
    [4, 5, 6],
    [1, 2, 3],
  ]);
  // roll right by 1 along columns: the last element wraps to the front of each row.
  assert.deepEqual(applyTensorOp(grid, "roll"), [
    [3, 1, 2],
    [6, 4, 5],
  ]);
});

test("applyTensorOp: elementwise ops (abs/neg/exp/sqrt/clip01) match hand-computed values", () => {
  assert.deepEqual(applyTensorOp([[-2, 3]], "abs"), [[2, 3]]);
  assert.deepEqual(applyTensorOp([[-2, 3]], "neg"), [[2, -3]]);
  assert.deepEqual(applyTensorOp([[0, 1]], "exp"), [[1, Math.E]]);
  assert.deepEqual(applyTensorOp([[4, 9]], "sqrt"), [[2, 3]]);
  assert.deepEqual(applyTensorOp([[-1, 0.5, 2]], "clip01"), [[0, 0.5, 1]]);
});

test("applyTensorOp: sqrt of a negative yields a NaN cell (the library's own honest answer), not a throw", () => {
  const result = applyTensorOp([[-1, 4]], "sqrt");
  assert.ok(Number.isNaN(result[0]![0]!));
  assert.equal(result[0]![1], 2);
});

test('applyTensorOp: "none" round-trips the grid unchanged', () => {
  const grid = [
    [1.5, -2],
    [0, 7],
  ];
  assert.deepEqual(applyTensorOp(grid, "none"), grid);
});

test("summarizeTensor: shape and min/max/mean/sum via the library's own reductions, hand-checked", () => {
  const summary = summarizeTensor([
    [1, 2, 3],
    [4, 5, 6],
  ]);
  assert.deepEqual(summary, { rows: 2, cols: 3, min: 1, max: 6, mean: 3.5, sum: 21 });
});
