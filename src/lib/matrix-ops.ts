import { ComplexNumber, MatrixMath, Structure, Vector, type EigenResult, type LUResult, type QRResult, type SVDResult } from "@johnhenry/math";
import { linalg } from "mallory-adapter-math";
import { Tensor } from "mallory-tensor-core";

export type Mat = number[][];

/** Parses a matrix from text: one row per line, entries comma/space separated. Throws a clear message on ragged rows or non-numeric entries, rather than producing a malformed matrix. */
export function parseMatrixText(text: string): Mat {
  const lines = text
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) throw new Error("Enter at least one row.");
  const rows = lines.map((line) =>
    line
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number),
  );
  const width = rows[0]?.length ?? 0;
  if (width === 0) throw new Error("Each row needs at least one entry.");
  for (const row of rows) {
    if (row.length !== width) throw new Error("Every row must have the same number of entries.");
    if (row.some(Number.isNaN)) throw new Error("Every entry must be a number.");
  }
  return rows;
}

function toMalloryMatrix(m: Mat): Vector<Vector<number>> {
  return Vector.fromArray(m.map((row) => Vector.fromArray(row)));
}

function toPlain(m: Vector<Vector<number>>): Mat {
  return [...m].map((row) => [...row]);
}

function isSquare(m: Mat): boolean {
  return m.length > 0 && m.every((row) => row.length === m.length);
}

export interface Determinant {
  value: number;
}

export function computeDeterminant(m: Mat): Determinant {
  if (!isSquare(m)) throw new Error("Determinant requires a square matrix.");
  return { value: Structure.realField().determinant(toMalloryMatrix(m)) };
}

export interface Inverse {
  matrix: Mat;
}

export function computeInverse(m: Mat): Inverse {
  if (!isSquare(m)) throw new Error("Inverse requires a square matrix.");
  return { matrix: toPlain(Structure.realField().invertMatrix(toMalloryMatrix(m))) };
}

/** One elementary row operation applied during traced RREF -- either scaling a row or adding a multiple of one row to another (the two operations Gauss-Jordan needs; row swaps are folded into a "swap" description for when a zero pivot forces reordering). */
export interface RrefStep {
  description: string;
  matrix: Mat;
}

export interface TracedRref {
  result: Mat;
  steps: RrefStep[];
}

/**
 * Gauss-Jordan elimination with a step recorded after every elementary row
 * operation, for the panel's step-through UI. `MatrixMath.rref` only
 * returns the final matrix, not the path there, so this is a separate,
 * from-scratch implementation -- its FINAL result is cross-checked against
 * `MatrixMath.rref`'s own (independently implemented) result in tests,
 * rather than trusted on its own.
 */
export function tracedRref(input: Mat): TracedRref {
  const m = input.map((row) => [...row]);
  const rows = m.length;
  const cols = m[0]?.length ?? 0;
  const steps: RrefStep[] = [];
  let pivotRow = 0;

  for (let col = 0; col < cols && pivotRow < rows; col++) {
    let sel = -1;
    for (let r = pivotRow; r < rows; r++) {
      if (Math.abs((m[r] as number[])[col] as number) > 1e-10) {
        sel = r;
        break;
      }
    }
    if (sel === -1) continue;

    if (sel !== pivotRow) {
      const tmp = m[sel] as number[];
      m[sel] = m[pivotRow] as number[];
      m[pivotRow] = tmp;
      steps.push({ description: `Swap row ${sel + 1} and row ${pivotRow + 1}`, matrix: m.map((r) => [...r]) });
    }

    const pivotVal = (m[pivotRow] as number[])[col] as number;
    if (Math.abs(pivotVal - 1) > 1e-10) {
      m[pivotRow] = (m[pivotRow] as number[]).map((v) => v / pivotVal);
      steps.push({ description: `R${pivotRow + 1} ← R${pivotRow + 1} / ${pivotVal.toFixed(4)}`, matrix: m.map((r) => [...r]) });
    }

    for (let r = 0; r < rows; r++) {
      if (r === pivotRow) continue;
      const factor = (m[r] as number[])[col] as number;
      if (Math.abs(factor) < 1e-10) continue;
      m[r] = (m[r] as number[]).map((v, i) => v - factor * ((m[pivotRow] as number[])[i] as number));
      steps.push({ description: `R${r + 1} ← R${r + 1} - (${factor.toFixed(4)}) × R${pivotRow + 1}`, matrix: m.map((row) => [...row]) });
    }

    pivotRow++;
  }

  return { result: m, steps };
}

export interface DecompositionSet {
  lu: LUResult;
  qr: QRResult;
  rank: number;
  nullSpace: Mat;
  eigenSymmetric?: EigenResult;
  choleskyError?: string;
  svd: SVDResult;
  conditionNumber: number;
}

/** Runs every decomposition MatrixMath offers over the same matrix, one call each, catching failures per-decomposition (a non-positive-definite matrix legitimately fails Cholesky without that invalidating the others) rather than one try/catch around everything. */
export function computeDecompositions(m: Mat): DecompositionSet {
  const lu = MatrixMath.lu(m);
  const qr = MatrixMath.qr(m);
  const rank = MatrixMath.rank(m);
  const svd = MatrixMath.svd(m);
  const conditionNumber = MatrixMath.conditionNumber(m);

  let eigenSymmetric: EigenResult | undefined;
  const isSym = isSquare(m) && m.every((row, i) => row.every((v, j) => Math.abs(v - (m[j] as number[])[i]!) < 1e-9));
  if (isSym) eigenSymmetric = MatrixMath.eigenSymmetric(m);

  let choleskyError: string | undefined;
  try {
    MatrixMath.cholesky(m);
  } catch (e) {
    choleskyError = e instanceof Error ? e.message : String(e);
  }

  const nullSpace = MatrixMath.nullSpace(m);

  return { lu, qr, rank, nullSpace: toPlain(nullSpace), eigenSymmetric, choleskyError, svd, conditionNumber };
}

/**
 * Roots of a monic polynomial `x^n + a[n-1]*x^(n-1) + ... + a[1]*x + a[0]`
 * via its companion matrix's eigenvalues (a classical equivalence: the
 * companion matrix's characteristic polynomial IS the given polynomial).
 * Uses `mallory-adapter-math`'s `eigGeneral` rather than `eigenSymmetric`
 * since a companion matrix is essentially never symmetric and its
 * eigenvalues are frequently genuinely complex (conjugate pairs) --
 * exactly the case `eigenSymmetric` can't handle.
 *
 * `coeffs` is `[a0, a1, ..., a(n-1)]` (ascending degree, monic leading
 * coefficient of 1 implied) -- e.g. `x^3 - 6x^2 + 11x - 6` (roots 1,2,3)
 * is `coeffs = [-6, 11, -6]`.
 */
export function polynomialRootsViaCompanionMatrix(coeffs: number[]): ComplexNumber[] {
  const n = coeffs.length;
  if (n === 0) throw new Error("Enter at least one coefficient.");
  const flat = new Array(n * n).fill(0);
  for (let i = 0; i < n; i++) flat[i * n + (n - 1)] = -(coeffs[i] as number);
  for (let i = 1; i < n; i++) flat[i * n + (i - 1)] = 1;
  const companion = Tensor.from(flat).reshape([n, n]);
  return linalg.eigGeneral(companion);
}
