import assert from "node:assert/strict";
import { test } from "node:test";
import type { Path2D } from "mallory-math";
import { applyTensorOp, curveToTensorGrid, parseTensorGrid, summarizeTensor } from "./tensor-block.ts";

/** A minimal fake Path2D -- only `commands` is read by curveToTensorGrid, so `stroke` is a throwaway placeholder (mirrors curve-transform.test.ts's own fakePath). */
function fakePath(points: Array<{ x: number; y: number }>): Path2D {
  return {
    stroke: { color: 0, alpha: 1, thickness: 1 },
    commands: points.map((p, i) => ({ op: i === 0 ? "moveTo" : "lineTo", x: p.x, y: p.y })),
  } as Path2D;
}

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

test("applyTensorOp: pad borders a 2x3 grid with `arg` zeros on all four sides, matching mallory-tensor-core's own pad() directly", () => {
  const grid = [
    [1, 2, 3],
    [4, 5, 6],
  ];
  assert.deepEqual(applyTensorOp(grid, "pad", 1), [
    [0, 0, 0, 0, 0],
    [0, 1, 2, 3, 0],
    [0, 4, 5, 6, 0],
    [0, 0, 0, 0, 0],
  ]);
});

test("applyTensorOp: pad with arg=0 is a no-op (border width zero)", () => {
  const grid = [[1, 2]];
  assert.deepEqual(applyTensorOp(grid, "pad", 0), grid);
});

test("applyTensorOp: pad clamps a negative/fractional arg to a non-negative integer border width", () => {
  const grid = [[1, 2]];
  assert.deepEqual(applyTensorOp(grid, "pad", -3), grid);
  assert.deepEqual(applyTensorOp(grid, "pad", 1.9), [
    [0, 0, 0, 0],
    [0, 1, 2, 0],
    [0, 0, 0, 0],
  ]);
});

test("applyTensorOp: repeat duplicates each row `arg` times in place along axis 0 (NumPy repeat, not tile)", () => {
  const grid = [
    [1, 2, 3],
    [4, 5, 6],
  ];
  assert.deepEqual(applyTensorOp(grid, "repeat", 2), [
    [1, 2, 3],
    [1, 2, 3],
    [4, 5, 6],
    [4, 5, 6],
  ]);
});

test("applyTensorOp: repeat clamps a sub-1 arg to a count of 1 (identity)", () => {
  const grid = [[1, 2]];
  assert.deepEqual(applyTensorOp(grid, "repeat", 0), grid);
});

test("summarizeTensor: shape and min/max/mean/sum via the library's own reductions, hand-checked", () => {
  const summary = summarizeTensor([
    [1, 2, 3],
    [4, 5, 6],
  ]);
  assert.deepEqual(summary, { rows: 2, cols: 3, min: 1, max: 6, mean: 3.5, sum: 21 });
});

test("curveToTensorGrid: a curve under the sample cap keeps every point unchanged, hand-computed", () => {
  const path = fakePath([
    { x: 0, y: 0 },
    { x: 1, y: 2 },
    { x: 2, y: 4 },
  ]);
  assert.deepEqual(curveToTensorGrid(path), [
    [0, 1, 2],
    [0, 2, 4],
  ]);
});

test("curveToTensorGrid: a curve over the sample cap is evenly strided down to at most maxSamples points, hand-computed", () => {
  // 40 points, x=i, y=2i. stride = ceil(40/16) = 3 -> indices 0,3,6,...,39 (14 points, landing exactly on 39).
  const points = Array.from({ length: 40 }, (_, i) => ({ x: i, y: 2 * i }));
  const [xs, ys] = curveToTensorGrid(fakePath(points));
  assert.deepEqual(xs, [0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39]);
  assert.deepEqual(ys, [0, 6, 12, 18, 24, 30, 36, 42, 48, 54, 60, 66, 72, 78]);
});

test("curveToTensorGrid: a custom maxSamples is honored, hand-computed", () => {
  // 10 points, x=i, y=i. stride = ceil(10/3) = 4 -> indices 0,4,8 (3 points).
  const points = Array.from({ length: 10 }, (_, i) => ({ x: i, y: i }));
  assert.deepEqual(curveToTensorGrid(fakePath(points), 3), [
    [0, 4, 8],
    [0, 4, 8],
  ]);
});

test("curveToTensorGrid: an empty curve (no samples yet) throws rather than returning an empty grid", () => {
  assert.throws(() => curveToTensorGrid(fakePath([])), /no samples yet/);
});
