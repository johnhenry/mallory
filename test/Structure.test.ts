import assert from "node:assert/strict";
import { test } from "node:test";
import { Structure } from "../src/Structure.ts";
import { Vector } from "../src/Vector.ts";

const v = (...xs: number[]) => Vector.fromArray(xs);
const mat = (rows: number[][]) => Vector.fromArray(rows.map((r) => Vector.fromArray(r)));
const deep = (m: Vector<unknown>) => m.map((r) => (r instanceof Vector ? [...r] : r));

// The real field (Q/R modelled with JS numbers).
const realField = new Structure<number>({
  criteria: [(x) => typeof x === "number"],
  operations: [(a, b) => a + b, (a, b) => a * b],
  inverses: [(x) => -x, (x) => 1 / x],
  identities: [0, 1],
  equality: (a, b) => a === b,
});

// The finite field GF(7).
const P = 7;
const modInverse = (x: number): number => {
  let r = 1;
  for (let i = 0; i < P - 2; i++) r = (r * x) % P; // Fermat: x^(p-2)
  return ((r % P) + P) % P;
};
const gf7 = new Structure<number>({
  operations: [(a, b) => (((a + b) % P) + P) % P, (a, b) => (((a * b) % P) + P) % P],
  inverses: [(x) => (((P - x) % P) + P) % P, (x) => modInverse(x)],
  identities: [0, 1],
  equality: (a, b) => ((a % P) + P) % P === ((b % P) + P) % P,
});

test("isMember checks all criteria", () => {
  assert.equal(realField.isMember(3), true);
  assert.equal(realField.isMember("x"), false);
});

test("scalar ops via structure", () => {
  assert.equal(realField.subtract(5, 3), 2);
  assert.equal(realField.divide(6, 3), 2);
  assert.equal(realField.addPower(2, 3), 6, "2+2+2 via repeated add");
  assert.equal(realField.multiplyPower(2, 3), 8, "2*2*2 via repeated multiply");
  assert.equal(realField.multiplyPower(2, -1), 0.5);
});

test("vector ops over the real field", () => {
  assert.deepEqual([...realField.addVector(v(1, 2), v(3, 4))], [4, 6]);
  assert.deepEqual([...realField.scaleVector(v(1, 2, 3), 2)], [2, 4, 6]);
  assert.equal(realField.dotProduct(v(1, 2, 3), v(4, 5, 6)), 32);
  // cross product bug fix
  assert.deepEqual([...realField.crossProduct(v(1, 0, 0), v(0, 1, 0))], [0, 0, 1]);
});

test("matrix ops over the real field", () => {
  const a = mat([
    [1, 2],
    [3, 4],
  ]);
  const b = mat([
    [5, 6],
    [7, 8],
  ]);
  assert.deepEqual(deep(realField.addMatrix(a, b)), [
    [6, 8],
    [10, 12],
  ]);
  assert.deepEqual(deep(realField.multiplyMatrix(a, b)), [
    [19, 22],
    [43, 50],
  ]);
  assert.equal(realField.determinant(a), -2);
  assert.equal(realField.trace(a), 5);
  assert.deepEqual(
    deep(
      realField.powerMatrix(
        mat([
          [1, 1],
          [0, 1],
        ]),
        3,
      ),
    ),
    [
      [1, 3],
      [0, 1],
    ],
  );
});

test("invertMatrix over the real field", () => {
  const a = mat([
    [4, 7],
    [2, 6],
  ]);
  const inv = realField.invertMatrix(a);
  const prod = realField.multiplyMatrix(a, inv).map((r) => (r as Vector<number>).map((x) => Math.round(x)));
  assert.deepEqual(deep(prod as Vector<unknown>), [
    [1, 0],
    [0, 1],
  ]);
});

test("Structure works over the finite field GF(7)", () => {
  // GF(7) arithmetic
  assert.equal(gf7.add(5, 4), 2); // 9 mod 7
  assert.equal(gf7.multiply(3, 5), 1); // 15 mod 7
  assert.equal(gf7.reciprocal(3), 5, "3*5 = 15 = 1 mod 7");
  // matrix inverse over GF(7): A * A^-1 = I (mod 7)
  const a = mat([
    [2, 3],
    [1, 4],
  ]);
  const inv = gf7.invertMatrix(a);
  const prod = gf7.multiplyMatrix(a, inv);
  assert.equal(gf7.equality((prod[0] as Vector<number>)[0], 1), true);
  assert.equal(gf7.equality((prod[0] as Vector<number>)[1], 0), true);
  assert.equal(gf7.equality((prod[1] as Vector<number>)[1], 1), true);
});

test("vectorSum / vectorProduct return values (bug fix)", () => {
  assert.equal(realField.vectorSum(v(1, 2, 3, 4)), 10);
  assert.equal(realField.vectorProduct(v(1, 2, 3, 4)), 24);
});
