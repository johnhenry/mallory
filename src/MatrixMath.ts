import { Vector } from "./Vector.ts";
import type { Matrix } from "./VectorUtils.ts";

/**
 * MatrixMath — numerical linear algebra: decompositions (LU, QR, Cholesky,
 * eigen, SVD), direct solvers, rank/RREF/null space, least squares, the
 * pseudo-inverse, and matrix norms. Complements the elementary matrix ops in
 * {@link RealMath} (determinant, inverse, multiply) with the higher-level
 * factorisations they lacked.
 *
 * Matrices are the library's `Matrix<number>` (a {@link Vector} of row Vectors);
 * plain `number[][]` is also accepted as input.
 */

type Mat = Matrix<number>;
type MatrixInput = Mat | number[][];

const EPS = 1e-12;

const raw = (m: MatrixInput): number[][] => [...(m as Iterable<Iterable<number>>)].map((r) => [...r]);
const wrap = (a: number[][]): Mat => Vector.fromArray(a.map((r) => Vector.fromArray(r)));
const vec = (a: number[]): Vector<number> => Vector.fromArray(a);
const identity = (n: number): number[][] =>
  Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
const zeros = (m: number, n: number): number[][] => Array.from({ length: m }, () => new Array(n).fill(0));
const transposeRaw = (a: number[][]): number[][] => a[0].map((_, j) => a.map((row) => row[j]));
const matmul = (a: number[][], b: number[][]): number[][] => {
  const m = a.length;
  const n = b[0].length;
  const k = b.length;
  const out = zeros(m, n);
  for (let i = 0; i < m; i++) for (let p = 0; p < k; p++) for (let j = 0; j < n; j++) out[i][j] += a[i][p] * b[p][j];
  return out;
};

export interface LUResult {
  L: Mat;
  U: Mat;
  P: Mat;
  sign: number;
}

export interface QRResult {
  Q: Mat;
  R: Mat;
}

export interface EigenResult {
  values: Vector<number>;
  vectors: Mat;
}

export interface SVDResult {
  U: Mat;
  S: Vector<number>;
  V: Mat;
}

export class MatrixMath {
  /** LU decomposition with partial pivoting: `P·A = L·U`. */
  static lu(A: MatrixInput): LUResult {
    const U = raw(A);
    const n = U.length;
    const L = identity(n);
    const P = identity(n);
    let sign = 1;
    for (let k = 0; k < n; k++) {
      let pivot = k;
      for (let i = k + 1; i < n; i++) if (Math.abs(U[i][k]) > Math.abs(U[pivot][k])) pivot = i;
      if (pivot !== k) {
        [U[k], U[pivot]] = [U[pivot], U[k]];
        [P[k], P[pivot]] = [P[pivot], P[k]];
        for (let j = 0; j < k; j++) [L[k][j], L[pivot][j]] = [L[pivot][j], L[k][j]];
        sign = -sign;
      }
      if (Math.abs(U[k][k]) < EPS) continue; // singular column
      for (let i = k + 1; i < n; i++) {
        const f = U[i][k] / U[k][k];
        L[i][k] = f;
        for (let j = k; j < n; j++) U[i][j] -= f * U[k][j];
      }
    }
    return { L: wrap(L), U: wrap(U), P: wrap(P), sign };
  }

  /** Solve the linear system `A·x = b` via LU decomposition. */
  static solve(A: MatrixInput, b: number[] | Vector<number>): Vector<number> {
    const a = raw(A);
    const n = a.length;
    const rhs = [...(b as Iterable<number>)];
    const { L, U, P } = MatrixMath.lu(a);
    const Lr = raw(L);
    const Ur = raw(U);
    const Pr = raw(P);
    // Pb
    const pb = Pr.map((row) => row.reduce((s, v, j) => s + v * rhs[j], 0));
    // forward solve L y = Pb
    const y = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let s = pb[i];
      for (let j = 0; j < i; j++) s -= Lr[i][j] * y[j];
      y[i] = s; // L has unit diagonal
    }
    // back solve U x = y
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      let s = y[i];
      for (let j = i + 1; j < n; j++) s -= Ur[i][j] * x[j];
      x[i] = Math.abs(Ur[i][i]) < EPS ? 0 : s / Ur[i][i];
    }
    return vec(x);
  }

  /** Reduced row echelon form (Gauss-Jordan elimination). */
  static rref(A: MatrixInput): Mat {
    const a = raw(A);
    const rows = a.length;
    const cols = a[0].length;
    let lead = 0;
    for (let r = 0; r < rows && lead < cols; r++, lead++) {
      let i = r;
      while (lead < cols && Math.abs(a[i][lead]) < EPS) {
        i++;
        if (i === rows) {
          i = r;
          lead++;
          if (lead === cols) return wrap(a);
        }
      }
      [a[i], a[r]] = [a[r], a[i]];
      const pivot = a[r][lead];
      for (let j = 0; j < cols; j++) a[r][j] /= pivot;
      for (let k = 0; k < rows; k++) {
        if (k === r) continue;
        const factor = a[k][lead];
        for (let j = 0; j < cols; j++) a[k][j] -= factor * a[r][j];
      }
    }
    return wrap(a);
  }

  /** Rank of a matrix (number of nonzero rows in its RREF). */
  static rank(A: MatrixInput): number {
    const r = raw(MatrixMath.rref(A));
    return r.filter((row) => row.some((v) => Math.abs(v) > 1e-9)).length;
  }

  /** A basis for the null space (kernel) of `A`, as a matrix whose rows are basis vectors. */
  static nullSpace(A: MatrixInput): Mat {
    const R = raw(MatrixMath.rref(A));
    const rows = R.length;
    const cols = R[0].length;
    const pivotCols: number[] = [];
    for (let r = 0; r < rows; r++) {
      const lead = R[r].findIndex((v) => Math.abs(v) > 1e-9);
      if (lead !== -1) pivotCols.push(lead);
    }
    const freeCols: number[] = [];
    for (let c = 0; c < cols; c++) if (!pivotCols.includes(c)) freeCols.push(c);

    const basis: number[][] = [];
    for (const free of freeCols) {
      const v = new Array(cols).fill(0);
      v[free] = 1;
      for (let r = 0; r < pivotCols.length; r++) v[pivotCols[r]] = -R[r][free];
      basis.push(v);
    }
    return wrap(basis.length ? basis : [new Array(cols).fill(0)]);
  }

  /** QR decomposition via modified Gram-Schmidt: `A = Q·R` (Q orthonormal). */
  static qr(A: MatrixInput): QRResult {
    const a = raw(A);
    const m = a.length;
    const n = a[0].length;
    const Q = zeros(m, n);
    const R = zeros(n, n);
    const cols = transposeRaw(a); // columns of A
    for (let j = 0; j < n; j++) {
      const v = [...cols[j]];
      for (let i = 0; i < j; i++) {
        let dot = 0;
        for (let r = 0; r < m; r++) dot += Q[r][i] * v[r];
        R[i][j] = dot;
        for (let r = 0; r < m; r++) v[r] -= dot * Q[r][i];
      }
      let norm = Math.hypot(...v);
      R[j][j] = norm;
      if (norm < EPS) norm = 1;
      for (let r = 0; r < m; r++) Q[r][j] = v[r] / norm;
    }
    return { Q: wrap(Q), R: wrap(R) };
  }

  /** Cholesky decomposition of a symmetric positive-definite matrix: `A = L·Lᵀ`. */
  static cholesky(A: MatrixInput): Mat {
    const a = raw(A);
    const n = a.length;
    const L = zeros(n, n);
    for (let j = 0; j < n; j++) {
      let d = a[j][j];
      for (let k = 0; k < j; k++) d -= L[j][k] * L[j][k];
      if (d <= 0) throw new Error("Matrix is not positive-definite.");
      L[j][j] = Math.sqrt(d);
      for (let i = j + 1; i < n; i++) {
        let s = a[i][j];
        for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
        L[i][j] = s / L[j][j];
      }
    }
    return wrap(L);
  }

  /**
   * Eigenvalues and orthonormal eigenvectors of a symmetric matrix via the
   * cyclic Jacobi rotation algorithm. Values are returned in descending order.
   */
  static eigenSymmetric(A: MatrixInput, maxSweeps = 100): EigenResult {
    const a = raw(A);
    const n = a.length;
    const V = identity(n);
    for (let sweep = 0; sweep < maxSweeps; sweep++) {
      let off = 0;
      for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q];
      if (off < EPS) break;
      for (let p = 0; p < n; p++) {
        for (let q = p + 1; q < n; q++) {
          if (Math.abs(a[p][q]) < EPS) continue;
          const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
          const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
          const c = 1 / Math.sqrt(t * t + 1);
          const s = t * c;
          for (let i = 0; i < n; i++) {
            const aip = a[i][p];
            const aiq = a[i][q];
            a[i][p] = c * aip - s * aiq;
            a[i][q] = s * aip + c * aiq;
          }
          for (let i = 0; i < n; i++) {
            const api = a[p][i];
            const aqi = a[q][i];
            a[p][i] = c * api - s * aqi;
            a[q][i] = s * api + c * aqi;
          }
          for (let i = 0; i < n; i++) {
            const vip = V[i][p];
            const viq = V[i][q];
            V[i][p] = c * vip - s * viq;
            V[i][q] = s * vip + c * viq;
          }
        }
      }
    }
    const pairs = a.map((row, i) => ({ value: row[i], vec: V.map((r) => r[i]) }));
    pairs.sort((x, y) => y.value - x.value);
    return {
      values: vec(pairs.map((p) => p.value)),
      vectors: wrap(transposeRaw(pairs.map((p) => p.vec))),
    };
  }

  /**
   * Singular value decomposition `A = U·Σ·Vᵀ` (via the eigendecomposition of
   * `AᵀA`). Returns `U`, the singular values `S` (descending), and `V`.
   */
  static svd(A: MatrixInput): SVDResult {
    const a = raw(A);
    const m = a.length;
    const n = a[0].length;
    const at = transposeRaw(a);
    const ata = matmul(at, a); // n×n
    const { values, vectors } = MatrixMath.eigenSymmetric(ata);
    const V = raw(vectors); // columns are eigenvectors of AᵀA
    const sv = [...values].map((v) => Math.sqrt(Math.max(v, 0)));
    // U columns: A·v_i / σ_i
    const U = zeros(m, n);
    for (let i = 0; i < n; i++) {
      const vi = V.map((r) => r[i]);
      const avi = a.map((row) => row.reduce((s, val, j) => s + val * vi[j], 0));
      const sigma = sv[i];
      for (let r = 0; r < m; r++) U[r][i] = sigma > EPS ? avi[r] / sigma : 0;
    }
    return { U: wrap(U), S: vec(sv), V: wrap(V) };
  }

  /** Least-squares solution of an overdetermined system `A·x ≈ b` (normal equations). */
  static leastSquares(A: MatrixInput, b: number[] | Vector<number>): Vector<number> {
    const a = raw(A);
    const at = transposeRaw(a);
    const ata = matmul(at, a);
    const rhs = [...(b as Iterable<number>)];
    const atb = at.map((row) => row.reduce((s, v, j) => s + v * rhs[j], 0));
    return MatrixMath.solve(wrap(ata), atb);
  }

  /** The Moore-Penrose pseudo-inverse `A⁺` (via SVD). */
  static pseudoInverse(A: MatrixInput): Mat {
    const { U, S, V } = MatrixMath.svd(A);
    const Ur = raw(U);
    const Vr = raw(V);
    const s = [...S];
    const n = s.length;
    // A⁺ = V · Σ⁺ · Uᵀ
    const sInv = s.map((v) => (v > 1e-9 ? 1 / v : 0));
    const sigmaPlus = zeros(n, n);
    for (let i = 0; i < n; i++) sigmaPlus[i][i] = sInv[i];
    return wrap(matmul(matmul(Vr, sigmaPlus), transposeRaw(Ur)));
  }

  /** The Frobenius norm (root of the sum of squared entries). */
  static frobeniusNorm(A: MatrixInput): number {
    return Math.hypot(...raw(A).flat());
  }

  /** The spectral (2-)norm: the largest singular value. */
  static spectralNorm(A: MatrixInput): number {
    return Math.max(...MatrixMath.svd(A).S);
  }

  /** The 2-norm condition number `σ_max / σ_min`. */
  static conditionNumber(A: MatrixInput): number {
    const s = [...MatrixMath.svd(A).S];
    const min = Math.min(...s);
    return min < EPS ? Number.POSITIVE_INFINITY : Math.max(...s) / min;
  }
}
