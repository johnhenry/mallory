import type { Path2D } from "@johnhenry/math";
import { findPeaks, type FindPeaksOptions } from "@johnhenry/math-plus-signal";
import { Tensor } from "@johnhenry/math-plus-tensor-core";

export interface CurveExtremum {
  x: number;
  y: number;
  prominence: number;
}

export interface CurveExtrema {
  maxima: CurveExtremum[];
  minima: CurveExtremum[];
}

/**
 * Finds local maxima/minima on a sampled curve via `@johnhenry/math-plus-signal`'s
 * `findPeaks` (scipy-`find_peaks`-equivalent local-maxima detection).
 * `findPeaks` only detects maxima, so minima come from running it again on
 * the negated y-values -- the standard trick, not a second algorithm.
 * Works on `path.commands` in sample order, which `sampleExpr`/
 * `sampleExprAdaptive` always produce left-to-right, so index-in-array
 * doubles as the "index in samples" `findPeaks` expects.
 */
export function findCurveExtrema(path: Path2D, options?: FindPeaksOptions): CurveExtrema {
  const ys = path.commands.map((c) => c.y);
  if (ys.length === 0) return { maxima: [], minima: [] };

  const toExtrema = (indices: number[], prominences: number[]): CurveExtremum[] =>
    indices.map((idx, i) => ({
      x: (path.commands[idx] as { x: number }).x,
      y: (path.commands[idx] as { y: number }).y,
      prominence: prominences[i] as number,
    }));

  const maximaResult = findPeaks(Tensor.from(ys), options);
  const minimaResult = findPeaks(Tensor.from(ys.map((y) => -y)), options);

  return {
    maxima: toExtrema(maximaResult.indices, maximaResult.prominences),
    minima: toExtrema(minimaResult.indices, minimaResult.prominences),
  };
}
