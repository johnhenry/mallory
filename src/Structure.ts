import { ComplexNumber } from "./ComplexNumber.ts";
import { Decimal } from "./Decimal.ts";
import { DualNumber } from "./DualNumber.ts";
import { Quaternion } from "./Quaternion.ts";
import { Rational } from "./Rational.ts";
import { Vector } from "./Vector.ts";
import { type Matrix, VectorUtils } from "./VectorUtils.ts";

/**
 * Structure — a generic algebraic structure (group, ring, field, …) defined by
 * its membership criteria, operations, inverses and identities. Given those, it
 * provides linear algebra (vectors and matrices) over the structure, mirroring
 * {@link RealMath}/{@link ComplexMath} but parameterised by arbitrary operations.
 *
 * Ported from Mallory's ActionScript `Structure`. The AS3 matrix section was
 * essentially non-functional — several methods were mistakenly declared `static`
 * yet called instance operations, many referenced undefined capitalised names
 * (`Scale`, `ScaleMatrix`, `Determinant`), `crossProduct` overwrote its first
 * operand with the second and read index 3, `powerMatrix` invoked a method that
 * does not exist, and `vectorSum`/`vectorProduct` never returned. All of this is
 * reconstructed here as working instance methods. The `chriteria` spelling is
 * corrected to `criteria`.
 */

export interface StructureOptions<T> {
  /** Membership predicates; an element is a member iff it satisfies them all. */
  criteria?: Array<(element: unknown) => boolean>;
  /** Binary operations; `operations[0]` is "add", `operations[1]` is "multiply". */
  operations?: Array<(a: T, b: T) => T>;
  /** Inverse maps; `inverses[0]` is "negative", `inverses[1]` is "reciprocal". */
  inverses?: Array<(x: T) => T>;
  /** Identity elements; `identities[0]` is "zero", `identities[1]` is "one". */
  identities?: T[];
  /** Optional coercion of an arbitrary value into the structure. */
  wrap?: (x: unknown) => T;
  /** Optional equality test (defaults to strict `===`). */
  equality?: (a: T, b: T) => boolean;
}

type SVec<T> = Vector<T>;
type SMat<T> = Matrix<T>;

export class Structure<T = unknown> {
  private readonly _criteria: Array<(element: unknown) => boolean>;
  private readonly _operations: Array<(a: T, b: T) => T>;
  private readonly _inverses: Array<(x: T) => T>;
  private readonly _identities: T[];
  private readonly _wrapMethod: (x: unknown) => T;
  private readonly _equalityMethod: (a: T, b: T) => boolean;

  constructor(options: StructureOptions<T> = {}) {
    this._criteria = options.criteria ?? [];
    this._operations = options.operations ?? [];
    this._inverses = options.inverses ?? [];
    this._identities = options.identities ?? [];
    this._wrapMethod = options.wrap ?? ((x) => x as T);
    this._equalityMethod = options.equality ?? ((a, b) => a === b);
  }

  // -- criteria ------------------------------------------------------------

  criterion(index: number): (element: unknown) => boolean {
    return this._criteria[index] as (element: unknown) => boolean;
  }

  isMember(element: unknown): boolean {
    return this._criteria.every((c) => c(element) !== false);
  }

  // -- operations ----------------------------------------------------------

  operation(index: number): (a: T, b: T) => T {
    return this._operations[index] as (a: T, b: T) => T;
  }

  /** Repeatedly apply `operation(operationIndex)` `power` times (using the inverse for negative powers). */
  integerPower(scalar: T, power: number, operationIndex = 0): T {
    let result = this.identity(operationIndex);
    const op = this.operation(operationIndex);
    let s = scalar;
    let p = power;
    if (p < 0) {
      p = -p;
      s = this.inverse(operationIndex)(scalar);
    }
    for (let i = 0; i < p; i++) result = op(result, s);
    return result;
  }

  get add(): (a: T, b: T) => T {
    return this._operations[0] as (a: T, b: T) => T;
  }
  addPower(scalar: T, power: number): T {
    return this.integerPower(scalar, power, 0);
  }

  get multiply(): (a: T, b: T) => T {
    return this._operations[1] as (a: T, b: T) => T;
  }
  multiplyPower(scalar: T, power: number): T {
    return this.integerPower(scalar, power, 1);
  }

  // -- inverses ------------------------------------------------------------

  inverse(index = 0): (x: T) => T {
    return this._inverses[index] as (x: T) => T;
  }
  get negative(): (x: T) => T {
    return this.inverse(0);
  }
  get reciprocal(): (x: T) => T {
    return this.inverse(1);
  }

  subtract(a: T, b: T): T {
    return this.add(a, this.negative(b));
  }
  divide(a: T, b: T): T {
    return this.multiply(a, this.reciprocal(b));
  }

  // -- identities ----------------------------------------------------------

  identity(index = 0): T {
    return this._identities[index] as T;
  }
  get zero(): T {
    return this._identities[0] as T;
  }
  get one(): T {
    return this._identities[1] as T;
  }

  get wrap(): (x: unknown) => T {
    return this._wrapMethod;
  }
  get equality(): (a: T, b: T) => boolean {
    return this._equalityMethod;
  }

  // -- vectors -------------------------------------------------------------

  contains(alpha: SVec<T>, element: T): boolean {
    return VectorUtils.contains(alpha, element, this.equality);
  }

  wrapVector(alpha: Vector<unknown>): SVec<T> {
    return VectorUtils.transform(alpha, this.wrap);
  }

  addVector(alpha: SVec<T>, beta: SVec<T>): SVec<T> {
    return VectorUtils.combine(alpha, beta, this.add, this.zero) as SVec<T>;
  }

  scaleVector(alpha: SVec<T>, scalar: T): SVec<T> {
    return VectorUtils.transform(alpha, (x) => this.multiply(scalar, x));
  }

  negativeVector(alpha: SVec<T>): SVec<T> {
    return VectorUtils.transform(alpha, this.negative);
  }

  reciprocalVector(alpha: SVec<T>): SVec<T> {
    return VectorUtils.transform(alpha, this.reciprocal);
  }

  inverseVector(alpha: SVec<T>, index = 0): SVec<T> {
    return VectorUtils.transform(alpha, this.inverse(index));
  }

  subtractVector(alpha: SVec<T>, beta: SVec<T>): SVec<T> {
    return this.addVector(alpha, this.negativeVector(beta));
  }

  dotProduct(alpha: SVec<T>, beta: SVec<T>): T {
    const collapsable = VectorUtils.combine(alpha, beta, this.multiply, this.zero) as SVec<T>;
    return VectorUtils.collapse(collapsable, this.add) as T;
  }

  /** 3D cross product (bug fix: correct operands and index 2 for the z-component). */
  crossProduct(alpha: SVec<T>, beta: SVec<T>): SVec<T> {
    const a: T[] = [this.zero, this.zero, this.zero];
    const b: T[] = [this.zero, this.zero, this.zero];
    for (let idx = 0; idx < 3; idx++) {
      if (idx < alpha.length && alpha[idx] != null) a[idx] = alpha[idx] as T;
      if (idx < beta.length && beta[idx] != null) b[idx] = beta[idx] as T;
    }
    const i = this.subtract(this.multiply(a[1] as T, b[2] as T), this.multiply(a[2] as T, b[1] as T));
    const j = this.subtract(this.multiply(a[2] as T, b[0] as T), this.multiply(a[0] as T, b[2] as T));
    const k = this.subtract(this.multiply(a[0] as T, b[1] as T), this.multiply(a[1] as T, b[0] as T));
    return Vector.fromArray([i, j, k]);
  }

  kroneckerProduct(A: SVec<T>, B: SVec<T>): SVec<T> {
    let kronecker = VectorUtils.constantVector(A.length, null as unknown) as Vector<unknown>;
    kronecker = VectorUtils.fillByIndex(kronecker, (i) => this.scaleVector(B, A[i] as T));
    return VectorUtils.flattenSDLevels(kronecker, 2) as SVec<T>;
  }

  // -- matrices ------------------------------------------------------------

  generateIdentity(height = 1, width = 1): SMat<T> {
    return VectorUtils.generateIdentity(height, width, this.one, this.zero);
  }

  addMatrix(alpha: SMat<T>, beta: SMat<T>): SMat<T> {
    return VectorUtils.combine(alpha, beta, (a, b) => this.addVector(a, b)) as SMat<T>;
  }

  scaleMatrix(alpha: SMat<T>, scalar: T): SMat<T> {
    return VectorUtils.transformEndNodes(alpha, (x) => this.multiply(scalar, x as T)) as SMat<T>;
  }

  negativeMatrix(alpha: SMat<T>): SMat<T> {
    return VectorUtils.transformEndNodes(alpha, (x) => this.negative(x as T)) as SMat<T>;
  }

  subtractMatrix(alpha: SMat<T>, beta: SMat<T>): SMat<T> {
    return this.addMatrix(alpha, this.negativeMatrix(beta));
  }

  scaleRow(alpha: SMat<T>, index = 0, scalar: T): SMat<T> {
    const newM = alpha.clone();
    return VectorUtils.rowSet(newM, this.scaleVector(newM[index] as SVec<T>, scalar), index);
  }

  scaleColumn(alpha: SMat<T>, index = 0, scalar: T): SMat<T> {
    return VectorUtils.transpose(this.scaleRow(alpha, index, scalar));
  }

  trace(alpha: SMat<T>): T {
    return VectorUtils.collapse(VectorUtils.diagonal(alpha), this.add) as T;
  }

  kroneckerMatrixProduct(alpha: SMat<T>, beta: SMat<T>): SMat<T> {
    let kronecker = VectorUtils.constantMatrix(
      VectorUtils.height(alpha),
      VectorUtils.width(alpha),
      null as unknown,
    ) as Matrix<unknown>;
    kronecker = VectorUtils.fillMatrixByIndex(kronecker, (i, j) =>
      this.scaleMatrix(beta, (alpha[i] as SVec<T>)[j] as T),
    );
    return VectorUtils.breakBlock(kronecker as Matrix<SMat<T>>);
  }

  multiplyMatrix(alpha: SMat<T>, beta: SMat<T>): SMat<T> {
    const kroneckerList = new Vector<SMat<T>>();
    for (let i = 0; i < VectorUtils.width(alpha); i++) {
      kroneckerList.push(this.kroneckerMatrixProduct(VectorUtils.getColumn(alpha, i), VectorUtils.getRow(beta, i)));
    }
    return VectorUtils.collapse(kroneckerList, (a, b) => this.addMatrix(a, b)) as SMat<T>;
  }

  /** Integer matrix power (bug fix: actually accumulates the factors). */
  powerMatrix(alpha: SMat<T>, power = 1): SMat<T> {
    if (power === 0) return this.generateIdentity(VectorUtils.height(alpha), VectorUtils.width(alpha));
    const base = power > 0 ? alpha.clone() : this.invertMatrix(alpha);
    const powerList = new Vector<SMat<T>>();
    for (let i = 0; i < Math.abs(power); i++) powerList.push(base.clone());
    return VectorUtils.collapse(powerList, (a, b) => this.multiplyMatrix(a, b)) as SMat<T>;
  }

  determinant(alpha: SMat<T>): T {
    if (VectorUtils.width(alpha) !== VectorUtils.height(alpha)) return this.zero;
    if (VectorUtils.width(alpha) < 2) return (alpha[0] as SVec<T>)[0] as T;
    const detList = new Vector<T>();
    for (let i = 0; i < VectorUtils.width(alpha); i++) {
      const temp = VectorUtils.columnRemoved(VectorUtils.rowRemoved(alpha, 0), i);
      const entry = (alpha[0] as SVec<T>)[i] as T;
      const signed = i % 2 === 0 ? entry : this.negative(entry);
      detList.push(this.multiply(signed, this.determinant(temp)));
    }
    return VectorUtils.collapse(detList, this.add) as T;
  }

  permanent(alpha: SMat<T>): T {
    if (VectorUtils.width(alpha) < 2) return (alpha[0] as SVec<T>)[0] as T;
    const detList = new Vector<T>();
    for (let i = 0; i < VectorUtils.width(alpha); i++) {
      const temp = VectorUtils.columnRemoved(VectorUtils.rowRemoved(alpha, 0), i);
      detList.push(this.multiply((alpha[0] as SVec<T>)[i] as T, this.permanent(temp)));
    }
    return VectorUtils.collapse(detList, this.add) as T;
  }

  /**
   * Matrix inverse by Gauss-Jordan elimination over the structure's field
   * operations, with a zero-pivot row swap (bug fix — the AS3 version had no
   * pivoting and divided by a zero pivot).
   */
  invertMatrix(alpha: SMat<T>, checkDeterminant = true): SMat<T> {
    const n = VectorUtils.height(alpha);
    const w = VectorUtils.width(alpha);
    if (checkDeterminant && this.equality(this.determinant(alpha), this.zero)) {
      return VectorUtils.constantMatrix(n, w, this.zero);
    }

    const mat: T[][] = [...alpha].map((row) => [...(row as SVec<T>)]);
    const inv: T[][] = [...this.generateIdentity(n, n)].map((row) => [...(row as SVec<T>)]);

    for (let col = 0; col < n; col++) {
      if (this.equality(mat[col][col] as T, this.zero)) {
        let swap = -1;
        for (let r = col + 1; r < n; r++) {
          if (!this.equality(mat[r][col] as T, this.zero)) {
            swap = r;
            break;
          }
        }
        if (swap === -1) continue; // singular column
        [mat[col], mat[swap]] = [mat[swap], mat[col]];
        [inv[col], inv[swap]] = [inv[swap], inv[col]];
      }
      const pivotInv = this.reciprocal(mat[col][col] as T);
      for (let k = 0; k < n; k++) {
        mat[col][k] = this.multiply(mat[col][k] as T, pivotInv);
        inv[col][k] = this.multiply(inv[col][k] as T, pivotInv);
      }
      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const f = mat[r][col] as T;
        for (let k = 0; k < n; k++) {
          mat[r][k] = this.subtract(mat[r][k] as T, this.multiply(f, mat[col][k] as T));
          inv[r][k] = this.subtract(inv[r][k] as T, this.multiply(f, inv[col][k] as T));
        }
      }
    }
    return Vector.fromArray(inv.map((row) => Vector.fromArray(row)));
  }

  // -- vector statistics (bug fix: the AS3 versions never returned) --------

  vectorSum(alpha: SVec<T>): T {
    return VectorUtils.collapse(alpha, this.add) as T;
  }

  vectorProduct(alpha: SVec<T>): T {
    return VectorUtils.collapse(alpha, this.multiply) as T;
  }

  vectorCollapseOperation(alpha: SVec<T>, index = 0): T {
    return VectorUtils.collapse(alpha, this.operation(index)) as T;
  }

  // -- ready-made structures -----------------------------------------------

  /** The field of real numbers (JS `number`). */
  static realField(): Structure<number> {
    return new Structure<number>({
      criteria: [(x) => typeof x === "number"],
      operations: [(a, b) => a + b, (a, b) => a * b],
      inverses: [(x) => -x, (x) => 1 / x],
      identities: [0, 1],
      equality: (a, b) => a === b,
      wrap: (x) => Number(x),
    });
  }

  /** The field of complex numbers ({@link ComplexNumber}). */
  static complexField(): Structure<ComplexNumber> {
    return new Structure<ComplexNumber>({
      criteria: [(x) => x instanceof ComplexNumber],
      operations: [(a, b) => a.add(b), (a, b) => a.multiply(b)],
      inverses: [(x) => x.neg(), (x) => x.reciprocal()],
      identities: [ComplexNumber.Zero, ComplexNumber.One],
      equality: (a, b) => a.equals(b),
      wrap: (x) => (x instanceof ComplexNumber ? x : new ComplexNumber(x as number)),
    });
  }

  /**
   * The ring of integers modulo `n` (Z/nZ). It is a field when `n` is prime; for
   * a composite `n`, {@link reciprocal} returns `NaN` for non-invertible elements.
   */
  static integersModulo(n: number): Structure<number> {
    const mod = (x: number) => ((x % n) + n) % n;
    const modInverse = (a: number): number => {
      let [oldR, r] = [mod(a), n];
      let [oldS, s] = [1, 0];
      while (r !== 0) {
        const q = Math.floor(oldR / r);
        [oldR, r] = [r, oldR - q * r];
        [oldS, s] = [s, oldS - q * s];
      }
      return oldR !== 1 ? NaN : mod(oldS);
    };
    return new Structure<number>({
      criteria: [(x) => typeof x === "number"],
      operations: [(a, b) => mod(a + b), (a, b) => mod(a * b)],
      inverses: [(x) => mod(-x), modInverse],
      identities: [0, 1],
      equality: (a, b) => mod(a) === mod(b),
      wrap: (x) => mod(Number(x)),
    });
  }

  /** The Boolean ring GF(2): XOR is addition, AND is multiplication (elements 0/1). */
  static booleanRing(): Structure<number> {
    return Structure.integersModulo(2);
  }

  /** The field of exact rational numbers ({@link Rational}). */
  static rationalField(): Structure<Rational> {
    return new Structure<Rational>({
      criteria: [(x) => x instanceof Rational],
      operations: [(a, b) => a.add(b), (a, b) => a.multiply(b)],
      inverses: [(x) => x.negate(), (x) => x.reciprocal()],
      identities: [Rational.Zero, Rational.One],
      equality: (a, b) => a.equals(b),
      wrap: (x) => Rational.from(x as number),
    });
  }

  /**
   * The field of arbitrary-precision {@link Decimal}s. Division is approximate
   * (rounded to `Decimal.DEFAULT_PRECISION` significant digits) — the one place
   * this "field" isn't exact, matching `Decimal.divide` itself.
   */
  static decimalField(): Structure<Decimal> {
    return new Structure<Decimal>({
      criteria: [(x) => x instanceof Decimal],
      operations: [(a, b) => a.add(b), (a, b) => a.multiply(b)],
      inverses: [(x) => x.negate(), (x) => Decimal.One.divide(x)],
      identities: [Decimal.Zero, Decimal.One],
      equality: (a, b) => a.equals(b),
      wrap: (x) => Decimal.from(x as number | string | bigint),
    });
  }

  /** The (non-commutative) division ring of {@link Quaternion}s. */
  static quaternionRing(): Structure<Quaternion> {
    return new Structure<Quaternion>({
      criteria: [(x) => x instanceof Quaternion],
      operations: [(a, b) => a.add(b), (a, b) => a.multiply(b)],
      inverses: [(x) => x.negate(), (x) => x.inverse()],
      identities: [Quaternion.Zero, Quaternion.Identity],
      equality: (a, b) => a.equals(b),
    });
  }

  /** The commutative ring of {@link DualNumber}s (autodiff carrier). */
  static dualNumbers(): Structure<DualNumber> {
    return new Structure<DualNumber>({
      criteria: [(x) => x instanceof DualNumber],
      operations: [(a, b) => a.add(b), (a, b) => a.multiply(b)],
      inverses: [(x) => x.negate(), (x) => new DualNumber(1, 0).divide(x)],
      identities: [new DualNumber(0, 0), new DualNumber(1, 0)],
      equality: (a, b) => a.value === b.value && a.deriv === b.deriv,
      wrap: (x) => (x instanceof DualNumber ? x : DualNumber.constant(x as number)),
    });
  }
}
