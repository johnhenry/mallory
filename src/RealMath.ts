import { Vector } from "./Vector.ts";
import { VectorUtils } from "./VectorUtils.ts";

/**
 * RealMath — arithmetic, trigonometry, numeric calculus and probability over
 * real numbers, as plain exported functions (no wrapping class — a `static`
 * method bag buys nothing over top-level functions for pure scalar math).
 * Ported from Mallory's ActionScript `RealMath`.
 *
 * Matrix operations were dropped: `Structure.realField()` already provides
 * generic linear algebra, and {@link MatrixMath} covers heavier real-only
 * needs (LU/QR/Cholesky/SVD). Sample statistics (`mean`/`variance`/percentiles/
 * regression/etc.) moved to {@link Statistics}, which is real-only by nature
 * (order-dependent stats don't generalize to complex numbers).
 *
 * Bugs fixed from the AS3 original:
 *  - `subtract` returned `a*b` (!).
 *  - `equal` ignored its tolerance argument (`Math.abs(a-b) <= 0`).
 *  - `integrateN` used a nonsensical sample point and had an unreachable return.
 *  - `differentiateN` was a forward difference despite claiming to be symmetric.
 *  - `crossProduct` read index 3 for the z-component and used truthiness tests.
 */

type RVec = Vector<number>;
type Unary = (x: number) => number;

// -- constants ---------------------------------------------------------------

export const Zero = 0;
export const One = 1;
export const E = Math.E;
export const PI = Math.PI;
export const PHI = 1.61803399;
export const PositiveInfinity = Infinity;
export const NegativeInfinity = -Infinity;

// -- Chapter 1: utilities -----------------------------------------------------

export function radiansToDegrees(r: number): number {
  return (180 / Math.PI) * r;
}

export function degreesToRadians(d: number): number {
  return (Math.PI / 180) * d;
}

// -- Chapter 2: comparison -----------------------------------------------------

/** Equality within `distance` (bug fix: AS3 ignored the tolerance). */
export function equal(a: number, b: number, distance = 0): boolean {
  return Math.abs(a - b) <= distance;
}

export function compare(a: number, b: number): number {
  if (a > b) return 1;
  if (a < b) return -1;
  return 0;
}

export function lessThan(a: number, b: number): boolean {
  return a < b;
}

export function greaterThan(a: number, b: number): boolean {
  return a > b;
}

// -- Chapter 3: unary -----------------------------------------------------------

export function negative(a = 0): number {
  return -a;
}

/** `1/a` (matches `divide`'s directed-infinity convention rather than always returning NaN). */
export function reciprocal(a = 1): number {
  return 1 / a;
}

/** Round away tiny floating-point noise (rounds to 10 decimal places). */
export function identity(a = 1): number {
  return roundTo(a);
}

// -- Chapter 4: binary -----------------------------------------------------------

export function add(a = 0, b = 0): number {
  return a + b;
}

/** Subtraction (bug fix: AS3 returned `a*b`). */
export function subtract(a = 0, b = 0): number {
  return a - b;
}

export function multiply(a = 1, b = 1): number {
  return a * b;
}

export function divide(a = 1, b = 1): number {
  if (b === 0) {
    if (a > 0) return Infinity;
    if (a < 0) return -Infinity;
    return NaN;
  }
  return a / b;
}

// -- Chapter 5: exponential / logarithmic -----------------------------------------

export function power(a = 1, exponent = 1): number {
  return a ** exponent;
}

export function square(a = 1): number {
  return a ** 2;
}

export function squareRoot(a = 1): number {
  return Math.sqrt(a);
}

export function logarithm(a = 1, base = Math.E): number {
  return Math.log(a) / Math.log(base);
}

// -- Chapter 6: trigonometry -----------------------------------------------------

export function sine(a = 0): number {
  return identity(Math.sin(a));
}
export function cosine(a = 0): number {
  return identity(Math.cos(a));
}
export function tangent(a = 0): number {
  return identity(Math.tan(a));
}
export function cosecant(a = 0): number {
  return identity(1 / Math.sin(a));
}
export function secant(a = 0): number {
  return identity(1 / Math.cos(a));
}
export function cotangent(a = 0): number {
  return identity(1 / Math.tan(a));
}

export function hyperbolicSine(a: number): number {
  return identity(0.5 * (Math.exp(a) - Math.exp(-a)));
}
export function hyperbolicCosine(a: number): number {
  return identity(0.5 * (Math.exp(a) + Math.exp(-a)));
}
export function hyperbolicTangent(a: number): number {
  return hyperbolicSine(a) / hyperbolicCosine(a);
}
export function hyperbolicCosecant(a: number): number {
  return 1 / hyperbolicSine(a);
}
export function hyperbolicSecant(a: number): number {
  return 1 / hyperbolicCosine(a);
}
export function hyperbolicCotangent(a: number): number {
  return hyperbolicCosine(a) / hyperbolicSine(a);
}

// -- Chapter 7: series, algebra, calculus -----------------------------------------

export function sumSeries(unaryOperation: Unary, start = 0, end = 0): number {
  return VectorUtils.collapse(
    VectorUtils.transform(VectorUtils.arithmeticSequence(start, end), unaryOperation),
    (a, b) => a + b,
    0,
  ) as number;
}

export function productSeries(unaryOperation: Unary, start = 0, end = 0): number {
  return VectorUtils.collapse(
    VectorUtils.transform(VectorUtils.arithmeticSequence(start, end), unaryOperation),
    (a, b) => a * b,
    1,
  ) as number;
}

/**
 * Newton–Raphson root finder for `unaryOperation(x) == target`.
 *
 * Bug fix: the AS3 version updated `guess -= (f(guess) - target)`, i.e. Newton
 * with an assumed derivative of 1 — it diverges for almost any nonlinear
 * function. Here the derivative is estimated numerically ({@link differentiateN})
 * so the iteration actually converges, and unbounded recursion is replaced by a
 * bounded loop.
 */
export function solveN(
  unaryOperation: Unary,
  target: number,
  desiredAccuracy = 0.01,
  guess = 0,
  maxIterations = 10000,
): number {
  let x = guess;
  for (let i = 0; i < maxIterations; i++) {
    const difference = unaryOperation(x) - target;
    if (Math.abs(difference) <= desiredAccuracy) return x;
    const slope = differentiateN(unaryOperation, x, 1e-6);
    if (slope === 0 || !Number.isFinite(slope)) break;
    x = x - difference / slope;
  }
  return x;
}

/**
 * Numeric integral via the midpoint rule (bug fix: the AS3 code sampled at
 * `2*lowerLimit+interval` and had an unreachable return).
 */
export function integrateN(unaryOperation: Unary, lowerLimit: number, upperLimit: number, interval = 0.01): number {
  if (interval <= 0) throw new RangeError(`RealMath.integrateN: interval must be positive, got ${interval}`);
  let result = 0;
  for (let x = lowerLimit; x < upperLimit; x += interval) {
    result += unaryOperation(x + interval / 2);
  }
  return interval * result;
}

/**
 * Numeric derivative via the symmetric difference quotient (bug fix: the AS3
 * code was a forward difference despite the "symmetric" comment).
 */
export function differentiateN(unaryOperation: Unary, point: number, limit = 0.01): number {
  if (limit <= 0) throw new RangeError(`RealMath.differentiateN: limit must be positive, got ${limit}`);
  return (unaryOperation(point + limit) - unaryOperation(point - limit)) / (2 * limit);
}

// -- Chapter 9: probability -----------------------------------------------------

export function normalDistribution(mean: number, sDev: number): Unary {
  return (x: number) => (1 / (sDev * Math.sqrt(2 * Math.PI))) * Math.E ** (-0.5 * ((x - mean) / sDev) ** 2);
}

export function standardNormalDistribution(x: number): number {
  return normalDistribution(0, 1)(x);
}

export function normalProbability(
  x: number,
  mean: number,
  sDev: number,
  negativeInfinityApproximation = -5,
  integrationInterval = 0.0001,
): number {
  return integrateN(normalDistribution(mean, sDev), negativeInfinityApproximation, x, integrationInterval);
}

export function standardNormalProbability(z: number, negativeInfinityApproximation = -5, interval = 0.0001): number {
  return integrateN(standardNormalDistribution, negativeInfinityApproximation, z, interval);
}

// -- Chapter 8: precision & randomness -----------------------------------------

/** Round to `precision` decimal places (replaces the buggy Flex NumberFormatter). */
export function roundTo(num: number, precision = 10): number {
  if (!Number.isFinite(num)) return num;
  const factor = 10 ** precision;
  return Math.round(num * factor) / factor;
}

/** Uniform random in `[min(r1,r2), max(r1,r2)]`. */
export function random(r1 = 1, r2 = 0, _inclusive = true): number {
  const low = Math.min(r1, r2);
  const high = Math.max(r1, r2);
  return low + Math.random() * (high - low);
}

/** Placeholder for the random.org fetch; always falls back to {@link random}. */
export function randomOrg(lower = 0, upper = 1, inclusive = true, fallback = true): number {
  if (fallback) return random(lower, upper, inclusive);
  return 0;
}

export function jitter(a: number, magnitude = 0.1): number {
  return a + (2 * Math.random() - 1) * magnitude;
}

// -- Part II Chapter 1: vectors -----------------------------------------------

export function addVector(alpha: RVec, beta: RVec): RVec {
  return VectorUtils.combine(alpha, beta, add) as RVec;
}

export function scaleVector(alpha: RVec, scalar: number): RVec {
  return VectorUtils.transform(alpha, (x) => multiply(scalar, x));
}

export function negativeVector(alpha: RVec): RVec {
  return scaleVector(alpha, -1);
}

export function subtractVector(alpha: RVec, beta: RVec): RVec {
  return addVector(alpha, negativeVector(beta));
}

export function dotProduct(alpha: RVec, beta: RVec): number {
  const collapsable = VectorUtils.combine(alpha, beta, multiply, 0) as RVec;
  return VectorUtils.collapse(collapsable, add) as number;
}

/**
 * 3D cross product (bug fix: the AS3 code read index 3 for the z-component
 * and used truthiness tests that dropped legitimate zero components).
 */
export function crossProduct(alpha: RVec, beta: RVec): RVec {
  const a = [0, 0, 0];
  const b = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    if (i < alpha.length && alpha[i] != null) a[i] = alpha[i] as number;
    if (i < beta.length && beta[i] != null) b[i] = beta[i] as number;
  }
  const i = a[1] * b[2] - a[2] * b[1];
  const j = a[2] * b[0] - a[0] * b[2];
  const k = a[0] * b[1] - a[1] * b[0];
  return Vector.fromArray([i, j, k]);
}

export function kroneckerProduct(A: RVec, B: RVec): RVec {
  let kronecker = VectorUtils.constantVector(A.length, null as unknown as number) as Vector<unknown>;
  kronecker = VectorUtils.fillByIndex(kronecker, (i) => scaleVector(B, A[i] as number));
  return VectorUtils.flattenSDLevels(kronecker, 2) as RVec;
}

export function distanceVector(alpha: RVec, beta: RVec, norm = 2): number {
  return pNorm(subtractVector(alpha, beta), norm);
}

export function pNorm(alpha: RVec, norm = 2): number {
  if (norm === 0) return Math.max(...VectorUtils.transform(alpha, Math.abs));
  const summable = VectorUtils.transform(alpha, (x) => Math.abs(x) ** norm);
  const sum = VectorUtils.collapse(summable, (a, b) => a + b, 0) as number;
  return sum ** (1 / norm);
}

export function magnitudeVector(alpha: RVec): number {
  return pNorm(alpha, 2);
}

export function angleBetween(alpha: RVec, beta: RVec): number {
  return Math.acos(dotProduct(alpha, beta) / (magnitudeVector(alpha) * magnitudeVector(beta)));
}
