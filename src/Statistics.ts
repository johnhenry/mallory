import { jitter, roundTo } from "./RealMath.ts";
import { Vector } from "./Vector.ts";
import { VectorUtils } from "./VectorUtils.ts";

/**
 * Statistics — order-dependent descriptive statistics and simple linear
 * regression over `number[]`-like {@link Vector}s. Split out of `RealMath`/
 * `ComplexMath` because these operations (median, percentiles, IQR, outlier
 * detection) rely on a total order and don't generalize to complex numbers.
 *
 * Plain exported functions (no wrapping class), matching the "namespace
 * class" fix applied to {@link RealMath}.
 *
 * Bug fixes inherited from the RealMath/ComplexMath AS3 port:
 *  - `sort` is numeric, not the default lexicographic Array sort.
 *  - `variance` is sample variance (divides by N-1), not population variance.
 */

type RVec = Vector<number>;
type Unary = (x: number) => number;

/** Numeric sort (bug fix: the AS3 default sort was lexicographic). */
export function sort(list: RVec, ascending = true): RVec {
  const sorted = list.clone().sort((a, b) => (a as number) - (b as number)) as RVec;
  return ascending ? sorted : sorted.reversed();
}

export function minimum(list: RVec): number {
  return sort(list, true)[0] as number;
}

export function maximum(list: RVec): number {
  return sort(list, false)[0] as number;
}

export function percentile(list: RVec, n: number): number {
  const ordered = sort(list);
  const theIndex = n * (ordered.length + 1);
  if (theIndex === Math.floor(theIndex)) {
    return ordered[theIndex - 1] as number;
  }
  return ((ordered[Math.floor(theIndex - 1)] as number) + (ordered[Math.ceil(theIndex - 1)] as number)) / 2;
}

export function median(list: RVec): number {
  return percentile(list, 0.5);
}
export function q1(list: RVec): number {
  return percentile(list, 0.25);
}
export function q3(list: RVec): number {
  return percentile(list, 0.75);
}

export function fiveNumberSummary(list: RVec): RVec {
  return Vector.fromArray([minimum(list), q1(list), median(list), q3(list), maximum(list)]);
}

export function sum(list: RVec): number {
  return VectorUtils.collapse(list, (a, b) => a + b, 0) as number;
}

export function product(list: RVec): number {
  return VectorUtils.collapse(list, (a, b) => a * b, 1) as number;
}

export function mean(list: RVec): number {
  return sum(list) / list.length;
}

/** Sample variance (bug fix: AS3 divided by N despite the `n<2 -> NaN` guard). */
export function variance(list: RVec): number {
  if (list.length < 2) return NaN;
  const m = mean(list);
  let s = 0;
  for (const x of list) s += ((x as number) - m) ** 2;
  return s / (list.length - 1);
}

export function standardDeviation(list: RVec): number {
  return Math.sqrt(variance(list));
}

/** Population variance (divides by N; complements the sample {@link variance}). */
export function populationVariance(list: RVec): number {
  if (list.length < 1) return NaN;
  const m = mean(list);
  let s = 0;
  for (const x of list) s += ((x as number) - m) ** 2;
  return s / list.length;
}

export function populationStandardDeviation(list: RVec): number {
  return Math.sqrt(populationVariance(list));
}

export function zScore(x: number, mean_ = 0, sDev = 1): number {
  return (x - mean_) / sDev;
}

export function invertZScore(z: number, mean_ = 0, sDev = 1): number {
  return z * sDev + mean_;
}

export function zScoreList(list: RVec): RVec {
  const m = mean(list);
  const sd = standardDeviation(list);
  return VectorUtils.transform(list, (x) => zScore(x, m, sd));
}

export function roundedList(list: RVec, precision: number): RVec {
  return VectorUtils.transform(list, (x) => roundTo(x, precision));
}

export function jitteredList(list: RVec, magnitude = 0.1): RVec {
  return VectorUtils.transform(list, (x) => jitter(x, magnitude));
}

export function isOutlier(list: RVec, value: number, distance = 1.5): boolean {
  const range = distance * interQuartileRange(list);
  return value < q1(list) - range || value > q3(list) + range;
}

export function interQuartileRange(list: RVec): number {
  return q3(list) - q1(list);
}

export function outliers(list: RVec, distance = 1.5): RVec {
  return VectorUtils.filter(list, (x) => isOutlier(list, x, distance));
}

export function outliersRemoved(list: RVec, distance = 1.5): RVec {
  return VectorUtils.filter(list, (x) => !isOutlier(list, x, distance));
}

// -- bivariate ------------------------------------------------------------------

export function correlation(x: RVec, y: RVec): number {
  if (x.length < 2) return NaN;
  const xMean = mean(x);
  const yMean = mean(y);
  const xSD = standardDeviation(x);
  const ySD = standardDeviation(y);
  let s = 0;
  for (let i = 0; i < x.length; i++) {
    s += (((x[i] as number) - xMean) / xSD) * (((y[i] as number) - yMean) / ySD);
  }
  return s / (x.length - 1);
}

export function linRegSlope(x: RVec, y: RVec): number {
  return (correlation(x, y) * standardDeviation(y)) / standardDeviation(x);
}

export function linRegIntercept(x: RVec, y: RVec): number {
  return mean(y) - linRegSlope(x, y) * mean(x);
}

export function linearRegression(x: RVec, y: RVec): RVec {
  return Vector.fromArray([linRegSlope(x, y), linRegIntercept(x, y)]);
}

export function linearRegressionFunction(x: RVec, y: RVec): Unary {
  const slope = linRegSlope(x, y);
  const intercept = linRegIntercept(x, y);
  return (a: number) => slope * a + intercept;
}
