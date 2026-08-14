import { SeriesDivergesError, Symbolic } from "mallory-math";

export interface SeriesPartialSum {
  n: number;
  sum: number;
}

export interface SeriesResult {
  /** null when the series diverges (or its convergence couldn't be confirmed within Symbolic.sumSeries's own budget). */
  finalSum: number | null;
  diverges: boolean;
  divergeMessage: string | null;
  partialSums: SeriesPartialSum[];
}

const MAX_PLOTTED_TERMS = 500;

/**
 * The running partial sums S(n) = term(from) + ... + term(n) for up to
 * `count` terms starting at `from` -- a separate walk from
 * `Symbolic.sumSeries` (which only returns the final scalar), needed for the
 * partial-sum dot plot. Uses `Symbolic.evaluate` (float, real-valued) since
 * the summation index is always a plain integer here.
 */
export function computeSeriesPartialSums(exprText: string, variable: string, from: number, count: number): SeriesPartialSum[] {
  const expr = Symbolic.parse(exprText);
  const clampedCount = Math.max(0, Math.min(count, MAX_PLOTTED_TERMS));
  const partialSums: SeriesPartialSum[] = [];
  let running = 0;
  for (let i = 0; i < clampedCount; i++) {
    const n = from + i;
    running += Symbolic.evaluate(expr, { [variable]: n });
    partialSums.push({ n, sum: running });
  }
  return partialSums;
}

/**
 * Analyzes a series: its convergence verdict (via `Symbolic.sumSeries`,
 * catching `SeriesDivergesError` specifically rather than treating every
 * thrown error as divergence -- a genuine parse error surfaces as its own
 * distinct error, not misreported as "diverges") plus a partial-sum trend
 * for plotting, up to `plotCount` terms (capped, for an infinite range,
 * since a dot plot can't usefully show hundreds of thousands of points).
 */
export function analyzeSeries(exprText: string, variable: string, from: number, to: number, plotCount: number): SeriesResult {
  const expr = Symbolic.parse(exprText);
  const availableTerms = Number.isFinite(to) ? to - from + 1 : plotCount;
  const partialSums = computeSeriesPartialSums(exprText, variable, from, Math.min(plotCount, availableTerms));

  try {
    const finalSum = Symbolic.sumSeries(expr, from, to, variable);
    return { finalSum, diverges: false, divergeMessage: null, partialSums };
  } catch (e) {
    if (e instanceof SeriesDivergesError) {
      return { finalSum: null, diverges: true, divergeMessage: e.message, partialSums };
    }
    throw e;
  }
}
