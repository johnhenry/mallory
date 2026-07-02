import assert from "node:assert/strict";
import { test } from "node:test";
import { MatrixMath } from "../src/MatrixMath.ts";
import { Vector } from "../src/Vector.ts";

const mat = (rows: number[][]) => Vector.fromArray(rows.map((r) => Vector.fromArray(r)));
const rawM = (m: Vector<unknown>) => [...m].map((r) => [...(r as Vector<number>)]);
const closeM = (a: number[][], b: number[][], eps = 1e-6) =>
  a.length === b.length && a.every((row, i) => row.every((v, j) => Math.abs(v - b[i][j]) <= eps));
const matmul = (a: number[][], b: number[][]) =>
  a.map((row) => b[0].map((_, j) => row.reduce((s, v, k) => s + v * b[k][j], 0)));

test("lu: P*A = L*U", () => {
  const A = [
    [2, 1, 1],
    [4, 3, 3],
    [8, 7, 9],
  ];
  const { L, U, P } = MatrixMath.lu(mat(A));
  const lhs = matmul(rawM(P), A);
  const rhs = matmul(rawM(L), rawM(U));
  assert.ok(closeM(lhs, rhs));
});

test("solve: A x = b", () => {
  const A = mat([
    [2, 1],
    [1, 3],
  ]);
  const x = MatrixMath.solve(A, [3, 5]);
  // 2x+y=3, x+3y=5 -> x=0.8, y=1.4
  assert.ok(Math.abs((x[0] as number) - 0.8) < 1e-9 && Math.abs((x[1] as number) - 1.4) < 1e-9);
});

test("rref and rank", () => {
  const A = mat([
    [1, 2, 3],
    [2, 4, 6],
    [1, 1, 1],
  ]);
  assert.equal(MatrixMath.rank(A), 2);
  const full = mat([
    [1, 0],
    [0, 1],
  ]);
  assert.equal(MatrixMath.rank(full), 2);
});

test("nullSpace: A * n = 0", () => {
  const A = mat([
    [1, 2, 3],
    [2, 4, 6],
  ]);
  const ns = rawM(MatrixMath.nullSpace(A));
  assert.ok(ns.length >= 1);
  for (const n of ns) {
    const Ax = rawM(A).map((row) => row.reduce((s, v, j) => s + v * n[j], 0));
    assert.ok(Ax.every((v) => Math.abs(v) < 1e-9));
  }
});

test("qr: Q*R = A and Q orthonormal", () => {
  const A = [
    [1, 1],
    [1, 0],
    [0, 1],
  ];
  const { Q, R } = MatrixMath.qr(mat(A));
  assert.ok(closeM(matmul(rawM(Q), rawM(R)), A));
  // QᵀQ = I
  const Qr = rawM(Q);
  const qtq = matmul(
    Qr[0].map((_, j) => Qr.map((row) => row[j])),
    Qr,
  );
  assert.ok(
    closeM(qtq, [
      [1, 0],
      [0, 1],
    ]),
  );
});

test("cholesky: L*Lᵀ = A", () => {
  const A = [
    [4, 2],
    [2, 3],
  ];
  const L = rawM(MatrixMath.cholesky(mat(A)));
  const lt = L[0].map((_, j) => L.map((row) => row[j]));
  assert.ok(closeM(matmul(L, lt), A));
  assert.throws(
    () =>
      MatrixMath.cholesky(
        mat([
          [1, 2],
          [2, 1],
        ]),
      ),
    /positive-definite/,
  );
});

test("eigenSymmetric: known eigenvalues", () => {
  // [[2,0],[0,3]] -> eigenvalues 3,2
  const { values } = MatrixMath.eigenSymmetric(
    mat([
      [2, 0],
      [0, 3],
    ]),
  );
  assert.ok(Math.abs((values[0] as number) - 3) < 1e-9 && Math.abs((values[1] as number) - 2) < 1e-9);
  // symmetric [[2,1],[1,2]] -> eigenvalues 3,1
  const e2 = MatrixMath.eigenSymmetric(
    mat([
      [2, 1],
      [1, 2],
    ]),
  );
  assert.ok(Math.abs((e2.values[0] as number) - 3) < 1e-6 && Math.abs((e2.values[1] as number) - 1) < 1e-6);
});

test("eigenSymmetric: A v = lambda v", () => {
  const A = [
    [2, 1],
    [1, 2],
  ];
  const { values, vectors } = MatrixMath.eigenSymmetric(mat(A));
  const V = rawM(vectors);
  for (let i = 0; i < 2; i++) {
    const v = V.map((row) => row[i]);
    const Av = A.map((row) => row.reduce((s, x, j) => s + x * v[j], 0));
    const lv = v.map((x) => (values[i] as number) * x);
    assert.ok(Av.every((x, k) => Math.abs(x - lv[k]) < 1e-6));
  }
});

test("svd: U*S*Vᵀ = A", () => {
  const A = [
    [3, 0],
    [0, -2],
  ];
  const { U, S, V } = MatrixMath.svd(mat(A));
  const Sr = [...S];
  const diag = [
    [Sr[0], 0],
    [0, Sr[1]],
  ];
  const recon = matmul(
    matmul(rawM(U), diag),
    rawM(V)[0].map((_, j) => rawM(V).map((row) => row[j])),
  );
  assert.ok(
    closeM(
      recon.map((r) => r.map(Math.abs)),
      A.map((r) => r.map(Math.abs)),
      1e-6,
    ),
  );
  assert.ok(Sr[0] >= Sr[1], "singular values descending");
});

test("leastSquares fits a line", () => {
  // fit y = m x + c to (0,1),(1,3),(2,5),(3,7) -> m=2, c=1
  const A = mat([
    [0, 1],
    [1, 1],
    [2, 1],
    [3, 1],
  ]);
  const x = MatrixMath.leastSquares(A, [1, 3, 5, 7]);
  assert.ok(Math.abs((x[0] as number) - 2) < 1e-6 && Math.abs((x[1] as number) - 1) < 1e-6);
});

test("pseudoInverse: A A⁺ A = A", () => {
  const A = [
    [1, 2],
    [3, 4],
    [5, 6],
  ];
  const Aplus = rawM(MatrixMath.pseudoInverse(mat(A)));
  const recon = matmul(matmul(A, Aplus), A);
  assert.ok(closeM(recon, A, 1e-5));
});

test("norms and condition number", () => {
  assert.ok(Math.abs(MatrixMath.frobeniusNorm(mat([[3, 4]])) - 5) < 1e-9);
  assert.ok(
    Math.abs(
      MatrixMath.spectralNorm(
        mat([
          [2, 0],
          [0, 3],
        ]),
      ) - 3,
    ) < 1e-6,
  );
  assert.ok(
    Math.abs(
      MatrixMath.conditionNumber(
        mat([
          [2, 0],
          [0, 1],
        ]),
      ) - 2,
    ) < 1e-6,
  );
});
