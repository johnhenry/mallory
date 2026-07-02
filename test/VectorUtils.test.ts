import assert from "node:assert/strict";
import { test } from "node:test";
import { Vector } from "../src/Vector.ts";
import { VectorUtils as VU } from "../src/VectorUtils.ts";

const v = <T>(...xs: T[]) => Vector.fromArray(xs);
const mat = <T>(rows: T[][]) => Vector.fromArray(rows.map((r) => Vector.fromArray(r)));
const deep = (m: Vector<unknown>) => m.map((r) => (r instanceof Vector ? [...r] : r));

test("isVector / isNotVector", () => {
  assert.equal(VU.isVector(v(1)), true);
  assert.equal(VU.isVector(5), false);
  assert.equal(VU.isNotVector(5), true);
});

test("isMultiDimensional / isFlat", () => {
  assert.equal(VU.isMultiDimensional(mat([[1], [2]])), true);
  assert.equal(VU.isFlat(v(1, 2, 3)), true);
  assert.equal(VU.isFlat(mat([[1]])), false);
});

test("contains with and without equality fn", () => {
  assert.equal(VU.contains(v(1, 2, 3), 2), true);
  assert.equal(VU.contains(v(1, 2, 3), 9), false);
  assert.equal(
    VU.contains(v(1, 2, 3), 4, (a, b) => Math.abs(a - b) <= 1),
    true,
  );
});

test("longer / shorter with tie rules", () => {
  const a = v(1, 2);
  const b = v(3, 4);
  assert.equal(VU.longer(a, b), a, "tie -> first");
  assert.equal(VU.shorter(a, b), b, "tie -> second");
  const short = v(1);
  const long = v(1, 2, 3);
  assert.equal(VU.longer(short, long), long);
  assert.equal(VU.shorter(short, long), short);
});

test("arithmeticSequence", () => {
  assert.deepEqual([...VU.arithmeticSequence(0, 5, 1)], [0, 1, 2, 3, 4, 5]);
  assert.deepEqual([...VU.arithmeticSequence(5, 0, -2)], [5, 3, 1]);
  assert.deepEqual([...VU.arithmeticSequence(3, 3, 0)], [3]);
});

test("arithmeticBounds produces size steps (bug fix)", () => {
  // 4 steps from 0 to 8 -> step 2 -> [0,2,4,6,8]
  assert.deepEqual([...VU.arithmeticBounds(0, 8, 4)], [0, 2, 4, 6, 8]);
});

test("geometricSequence", () => {
  assert.deepEqual([...VU.geometricSequence(1, 16, 2)], [1, 2, 4, 8, 16]);
});

test("constantVector / constantMatrix", () => {
  assert.deepEqual([...VU.constantVector(3, 7)], [7, 7, 7]);
  assert.deepEqual(deep(VU.constantMatrix(2, 2, 0)), [
    [0, 0],
    [0, 0],
  ]);
});

test("merge: two vectors, vector+scalar, scalar+vector (bug fix), two scalars", () => {
  assert.deepEqual([...VU.merge(v(1, 2), v(3, 4))], [1, 2, 3, 4]);
  assert.deepEqual([...VU.merge(v(1, 2), 3)], [1, 2, 3]);
  // AS3 bug: scalar + vector inserted the vector into itself. Correct: prepend scalar.
  assert.deepEqual([...VU.merge(0, v(1, 2))], [0, 1, 2]);
  assert.deepEqual([...VU.merge(1, 2)], [1, 2]);
});

test("recursiveSequence (fibonacci, keep=true) does not mutate seeds", () => {
  const seeds = [0, 1];
  const fib = VU.recursiveSequence<number>(
    seeds,
    (s) => s[s.length - 1] + s[s.length - 2],
    (s) => (s as ArrayLike<number>).length >= 8,
    true,
  );
  assert.deepEqual([...fib], [0, 1, 1, 2, 3, 5, 8, 13]);
  assert.deepEqual(seeds, [0, 1], "caller's seeds untouched");
});

test("wrap nests to a given depth", () => {
  assert.equal(VU.wrap(5, 0), 5);
  assert.deepEqual(deep(VU.wrap(5, 1) as Vector<unknown>), [5]);
});

test("transform / replace / fillByIndex", () => {
  assert.deepEqual([...VU.transform(v(1, 2, 3), (x) => x * 2)], [2, 4, 6]);
  assert.deepEqual([...VU.replace(v(1, 2, 3), "x")], ["x", "x", "x"]);
  assert.deepEqual([...VU.fillByIndex(v(0, 0, 0), (i) => i * i)], [0, 1, 4]);
});

test("transformEndNodes / replaceEndNodes recurse", () => {
  const nested = mat([
    [1, 2],
    [3, 4],
  ]);
  assert.deepEqual(deep(VU.transformEndNodes(nested, (x) => (x as number) + 10) as Vector<unknown>), [
    [11, 12],
    [13, 14],
  ]);
  assert.deepEqual(deep(VU.replaceEndNodes(nested, 0) as Vector<unknown>), [
    [0, 0],
    [0, 0],
  ]);
});

test("trim / removeElements / filter", () => {
  assert.deepEqual([...VU.trim(v(1, 2, 3, 4, 5), 1, 2)], [2, 3]);
  assert.deepEqual([...VU.removeElements(v(1, 2, 1, 3, 1), 1)], [2, 3]);
  assert.deepEqual([...VU.filter(v(1, 2, 3, 4), (x) => x % 2 === 0)], [2, 4]);
});

test("modes handles single, multi and empty", () => {
  assert.deepEqual([...VU.modes(v(5, 6, 3, 2, 5))], [5]);
  assert.deepEqual([...VU.modes(v(5, 6, 3, 6, 5))].sort(), [5, 6]);
  assert.deepEqual([...VU.modes(v<number>())], []);
});

test("flatten ragged / flattenSD", () => {
  const ragged = Vector.fromArray<unknown>([1, v(2, v(3, 4)), 5]);
  assert.deepEqual([...VU.flatten(ragged)], [1, 2, 3, 4, 5]);
});

test("collapse (sum) and count/matches", () => {
  assert.equal(
    VU.collapse(v(1, 2, 3, 4), (a, b) => a + b),
    10,
  );
  assert.equal(
    VU.collapse(v<number>(), (a, b) => a + b, -1),
    -1,
  );
  assert.equal(VU.count(v(1, 0, 1, 0, 1), 0), 2, "counts stored zeros correctly");
  assert.equal(
    VU.matches(v(1, 2, 3, 4), (x) => x > 2),
    2,
  );
});

test("combine with default handles stored zeros (bug fix)", () => {
  const a = v(0, 2, 4);
  const b = v(1, 1);
  // element-wise sum; where only a has an element, use it (even if 0)
  assert.deepEqual([...VU.combine(a, b, (x, y) => x + y)], [1, 3, 4]);
  const short = v(0);
  assert.deepEqual([...VU.combine(short, v(9, 9, 9), (x, y) => x + y, -1)], [9, -1, -1]);
});

test("consecutiveMatches", () => {
  assert.deepEqual(
    VU.consecutiveMatches(v(1, 1, 0, 1, 1, 1, 0), (x) => x === 1),
    [2, 3],
  );
});

test("isMatrix", () => {
  assert.equal(
    VU.isMatrix(
      mat([
        [1, 2],
        [3, 4],
      ]),
    ),
    true,
  );
  assert.equal(VU.isMatrix(mat([[1, 2], [3]])), false);
  assert.equal(VU.isMatrix(v(1, 2, 3)), false);
});

test("width / height", () => {
  const m = mat([
    [1, 2, 3],
    [4, 5, 6],
  ]);
  assert.equal(VU.height(m), 2);
  assert.equal(VU.width(m), 3);
});

test("transpose", () => {
  assert.deepEqual(
    deep(
      VU.transpose(
        mat([
          [1, 2, 3],
          [4, 5, 6],
        ]),
      ),
    ),
    [
      [1, 4],
      [2, 5],
      [3, 6],
    ],
  );
});

test("generateIdentity", () => {
  assert.deepEqual(deep(VU.generateIdentity(3, 3, 1, 0)), [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]);
});

test("getRow / getColumn", () => {
  const m = mat([
    [1, 2],
    [3, 4],
  ]);
  assert.deepEqual(deep(VU.getRow(m, 1)), [[3, 4]]);
  assert.deepEqual(deep(VU.getColumn(m, 0)), [[1], [3]]);
});

test("rowRemoved / columnRemoved", () => {
  const m = mat([
    [1, 2, 3],
    [4, 5, 6],
    [7, 8, 9],
  ]);
  assert.deepEqual(deep(VU.rowRemoved(m, 1)), [
    [1, 2, 3],
    [7, 8, 9],
  ]);
  assert.deepEqual(deep(VU.columnRemoved(m, 1)), [
    [1, 3],
    [4, 6],
    [7, 9],
  ]);
});

test("rowInserted / columnInserted", () => {
  const m = mat([
    [1, 2],
    [5, 6],
  ]);
  assert.deepEqual(deep(VU.rowInserted(m, v(3, 4), 1)), [
    [1, 2],
    [3, 4],
    [5, 6],
  ]);
  assert.deepEqual(deep(VU.columnInserted(m, v(9, 9), 1)), [
    [1, 9, 2],
    [5, 9, 6],
  ]);
});

test("diagonal / minorDiagonal", () => {
  const m = mat([
    [1, 2, 3],
    [4, 5, 6],
    [7, 8, 9],
  ]);
  assert.deepEqual([...VU.diagonal(m)], [1, 5, 9]);
  assert.deepEqual([...VU.diagonal(m, 1)], [2, 6]);
  assert.deepEqual([...VU.minorDiagonal(m)], [3, 5, 7]);
});

test("placeBlock overlays a block", () => {
  const target = VU.constantMatrix(3, 3, 0);
  const block = mat([
    [1, 1],
    [1, 1],
  ]);
  assert.deepEqual(deep(VU.placeBlock(target, block, 1, 1)), [
    [0, 0, 0],
    [0, 1, 1],
    [0, 1, 1],
  ]);
});

test("matrixString renders rows", () => {
  const s = VU.matrixString(
    mat([
      [1, 2],
      [3, 4],
    ]),
  );
  assert.ok(s.includes("[1,2]"));
  assert.ok(s.includes("[3,4]"));
});
