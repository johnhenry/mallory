import { ComplexNumber } from "./ComplexNumber.ts";
import { integrateN } from "./RealMath.ts";
import { Vector } from "./Vector.ts";
import { VectorUtils } from "./VectorUtils.ts";

/**
 * ComplexMath — the remaining complex-valued operations that don't belong on a
 * single {@link ComplexNumber}: vector algebra over `Vector<ComplexNumber>`
 * and probability distributions. Plain exported functions rather than a
 * `static` method bag (same "namespace class" fix as {@link RealMath}).
 *
 * Everything per-value (arithmetic, exponentials/logs, trig, comparisons) is
 * now a fluent {@link ComplexNumber} instance method. Matrix operations were
 * dropped — `Structure.complexField()` already provides generic linear
 * algebra. Order-dependent statistics (median/percentile/variance/etc.) were
 * dropped with them: they had no test coverage here and don't generalize to
 * complex numbers (there's no total order on the complex plane to found
 * percentiles on) — see {@link Statistics} for the real-only equivalents.
 *
 * Ported from Mallory's ActionScript `ComplexMath`; see `ComplexNumber`'s doc
 * comment for the bug fixes inherited from that port (directed-infinity
 * division, zero-base `power`, etc.). `normalDistribution`'s AS3 bug (the
 * reciprocal was taken of the whole PDF expression, flipping the exponential's
 * sign) is fixed here too.
 */

type CNInput = ComplexNumber | number;
type CVec = Vector<ComplexNumber>;
type CUnary = (x: ComplexNumber) => ComplexNumber;

const cn = (x: CNInput): ComplexNumber => (x instanceof ComplexNumber ? x : new ComplexNumber(x));

// -- vectors ------------------------------------------------------------------

export function addVector(alpha: CVec, beta: CVec): CVec {
  return VectorUtils.combine(alpha, beta, (a, b) => a.add(b)) as CVec;
}

export function scaleVector(alpha: CVec, scalar: CNInput): CVec {
  const s = cn(scalar);
  return VectorUtils.transform(alpha, (x) => s.multiply(x));
}

export function negativeVector(alpha: CVec): CVec {
  return scaleVector(alpha, -1);
}

export function subtractVector(alpha: CVec, beta: CVec): CVec {
  return addVector(alpha, negativeVector(beta));
}

export function dotProduct(alpha: CVec, beta: CVec): ComplexNumber {
  const collapsable = VectorUtils.combine(alpha, beta, (a, b) => a.multiply(b), ComplexNumber.Zero) as CVec;
  return VectorUtils.collapse(collapsable, (a, b) => a.add(b)) as ComplexNumber;
}

/** 3D cross product (bug fix: index 2 for z, presence not truthiness — as in RealMath). */
export function crossProduct(alpha: CVec, beta: CVec): CVec {
  const a = [ComplexNumber.Zero, ComplexNumber.Zero, ComplexNumber.Zero];
  const b = [ComplexNumber.Zero, ComplexNumber.Zero, ComplexNumber.Zero];
  for (let idx = 0; idx < 3; idx++) {
    if (idx < alpha.length && alpha[idx] != null) a[idx] = alpha[idx] as ComplexNumber;
    if (idx < beta.length && beta[idx] != null) b[idx] = beta[idx] as ComplexNumber;
  }
  const i = a[1].multiply(b[2]).subtract(a[2].multiply(b[1]));
  const j = a[2].multiply(b[0]).subtract(a[0].multiply(b[2]));
  const k = a[0].multiply(b[1]).subtract(a[1].multiply(b[0]));
  return Vector.fromArray([i, j, k]);
}

export function kroneckerProduct(A: CVec, B: CVec): CVec {
  let kronecker = VectorUtils.constantVector(A.length, null as unknown) as Vector<unknown>;
  kronecker = VectorUtils.fillByIndex(kronecker, (i) => scaleVector(B, A[i] as ComplexNumber));
  return VectorUtils.flattenSDLevels(kronecker, 2) as CVec;
}

export function pNorm(alpha: CVec, norm: CNInput = 2): ComplexNumber {
  const p = cn(norm);
  if (p.value === 0) {
    const magnitudes = VectorUtils.transform(alpha, (x) => new ComplexNumber(x.magnitude()));
    return VectorUtils.collapse(magnitudes, (a, b) => (a.magCompare(b) >= 0 ? a : b)) as ComplexNumber;
  }
  const summable = VectorUtils.transform(alpha, (x) => new ComplexNumber(x.magnitude()).power(p.value));
  const sum = VectorUtils.collapse(summable, (a, b) => a.add(b), ComplexNumber.Zero) as ComplexNumber;
  return sum.power(1 / p.value);
}

export function distanceVector(alpha: CVec, beta: CVec, norm: CNInput = 2): ComplexNumber {
  return pNorm(subtractVector(alpha, beta), norm);
}

export function magnitudeVector(alpha: CVec): ComplexNumber {
  return pNorm(alpha, 2);
}

export function angleBetween(alpha: CVec, beta: CVec): ComplexNumber {
  return dotProduct(alpha, beta)
    .divide(magnitudeVector(alpha).multiply(magnitudeVector(beta)))
    .arcCosine();
}

// -- probability ----------------------------------------------------------------

export function zScore(x: CNInput, mean: CNInput = 0, sDev: CNInput = 1): ComplexNumber {
  return cn(x).subtract(mean).divide(sDev);
}

export function invertZScore(z: CNInput, mean: CNInput = 0, sDev: CNInput = 1): ComplexNumber {
  return cn(z).multiply(sDev).add(mean);
}

/** Normal PDF closure over complex arguments. */
export function normalDistribution(mean: CNInput, sDev: CNInput): CUnary {
  return (x: ComplexNumber) =>
    cn(sDev)
      .multiply(Math.sqrt(2 * Math.PI))
      .reciprocal()
      .multiply(ComplexNumber.E.power(zScore(x, mean, sDev).square().multiply(-0.5)));
}

export function standardNormalDistribution(x: CNInput): ComplexNumber {
  return normalDistribution(0, 1)(cn(x));
}

/**
 * Numeric integral of a complex-valued function over a real interval, via the
 * real {@link integrateN} applied component-wise (bug fix: same midpoint-rule
 * fix as `RealMath.integrateN`).
 */
function integrateComplexN(
  unaryOperation: CUnary,
  lowerLimit: number,
  upperLimit: number,
  interval = 0.0001,
): ComplexNumber {
  const re = integrateN((t) => unaryOperation(new ComplexNumber(t, 0)).value, lowerLimit, upperLimit, interval);
  const im = integrateN((t) => unaryOperation(new ComplexNumber(t, 0)).iValue, lowerLimit, upperLimit, interval);
  return new ComplexNumber(re, im);
}

export function normalProbability(
  x: CNInput,
  mean: CNInput,
  sDev: CNInput,
  negativeInfinityApproximation = -5,
  integrationInterval = 0.0001,
): ComplexNumber {
  return integrateComplexN(
    normalDistribution(mean, sDev),
    negativeInfinityApproximation,
    cn(x).value,
    integrationInterval,
  );
}

export function standardNormalProbability(
  z: CNInput,
  negativeInfinityApproximation = -5,
  interval = 0.0001,
): ComplexNumber {
  return integrateComplexN(standardNormalDistribution, negativeInfinityApproximation, cn(z).value, interval);
}
