import type { Path2D } from "@johnhenry/math";
import { pairwiseSync, transduceSync, transducers } from "@johnhenry/iteration";

export interface CurvePoint {
  x: number;
  y: number;
}

/**
 * Splits a Path2D's flat command list into contiguous runs at each
 * `moveTo` (mirrors `render-path.ts`'s `drawFilledArea` run-splitting) --
 * a curve with a domain gap/discontinuity produces multiple `moveTo`s, and
 * a derivative/integral computed *across* that gap (bridging two unrelated
 * branches) would be meaningless, so each run is transformed independently.
 */
function splitRuns(path: Path2D): CurvePoint[][] {
  const runs: CurvePoint[][] = [];
  let current: CurvePoint[] = [];
  for (const cmd of path.commands) {
    if (cmd.op === "moveTo" && current.length > 0) {
      runs.push(current);
      current = [];
    }
    current.push({ x: cmd.x, y: cmd.y });
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

/**
 * Numeric derivative via `mallory-iteration`'s `pairwiseSync` (issue #35
 * item 2): each output point is the midpoint-slope of one consecutive pair
 * of input samples -- `pairwiseSync` is exactly the right shape here, since
 * every output needs precisely its two neighboring inputs and nothing else.
 * A degenerate pair (equal x, from a vertical jump) is skipped rather than
 * dividing by zero.
 */
export function derivativeCurve(path: Path2D): CurvePoint[][] {
  return splitRuns(path).map((run) => {
    const out: CurvePoint[] = [];
    for (const [p1, p2] of pairwiseSync(run)) {
      const dx = p2.x - p1.x;
      if (dx === 0) continue;
      out.push({ x: (p1.x + p2.x) / 2, y: (p2.y - p1.y) / dx });
    }
    return out;
  });
}

/**
 * Running numeric integral via `mallory-iteration`'s `transducers.accumulate`
 * (issue #35 item 2): each consecutive pair's trapezoid area feeds a running
 * sum -- `accumulate` is a scan (one output per input, not a single fold),
 * which is exactly a running/partial-sum integral, starting from `(x0, 0)`.
 */
export function integralCurve(path: Path2D): CurvePoint[][] {
  return splitRuns(path).map((run) => {
    if (run.length === 0) return [];
    const first = run[0] as CurvePoint;
    const areas: number[] = [];
    for (const [p1, p2] of pairwiseSync(run)) areas.push(((p1.y + p2.y) / 2) * (p2.x - p1.x));
    const runningSums = transduceSync(transducers.accumulate((sum: number, area: number) => sum + area, 0))(areas);
    const out: CurvePoint[] = [{ x: first.x, y: 0 }];
    let i = 1;
    for (const sum of runningSums) {
      out.push({ x: (run[i] as CurvePoint).x, y: sum });
      i++;
    }
    return out;
  });
}

/**
 * Linear-interpolates `run`'s y-value at `x`, or null if `x` falls outside
 * `run`'s own x-range (a curve is only defined where it was actually
 * sampled -- extrapolating past either end would silently invent data).
 * `run` is assumed x-ascending, matching every sampler in this codebase's
 * own convention (sampleExpr, sampleParametricCurve, etc. all walk their
 * domain left to right); the per-segment `x >= p1.x && x <= p2.x` test
 * below already excludes any `x` outside `[run[0].x, run[last].x]` on its
 * own (no segment ever matches), so there's no separate up-front bounds
 * check to keep in sync with it.
 */
function interpolateAt(run: readonly CurvePoint[], x: number): number | null {
  for (let i = 0; i < run.length - 1; i++) {
    const p1 = run[i] as CurvePoint;
    const p2 = run[i + 1] as CurvePoint;
    if (x >= p1.x && x <= p2.x) {
      if (p2.x === p1.x) return p1.y;
      const t = (x - p1.x) / (p2.x - p1.x);
      return p1.y + t * (p2.y - p1.y);
    }
  }
  return null;
}

/**
 * `pathA - pathB`, sampled at `pathA`'s own x-positions (issue #35's
 * "difference of two curves" item). The two curves need not share sample
 * counts or exact x-positions -- e.g. two graph rows with different
 * expressions over the same viewport still get resampled at (likely)
 * different points by GraphCanvasMulti's adaptive sampler -- so `pathB` is
 * linearly interpolated at each of `pathA`'s x's rather than naively
 * zipped pointwise (which would silently misalign unless both curves
 * happened to share identical sampling). A point where `pathB` doesn't
 * cover `pathA`'s x (outside its domain, or in a different run across a
 * gap) is skipped -- gap-tolerant, matching sampleExpr's own convention
 * for "undefined here" rather than raising an error.
 */
export function differenceCurve(pathA: Path2D, pathB: Path2D): CurvePoint[][] {
  const runsA = splitRuns(pathA);
  const runsB = splitRuns(pathB);
  return runsA.map((runA) => {
    const out: CurvePoint[] = [];
    for (const p of runA) {
      let bValue: number | null = null;
      for (const runB of runsB) {
        bValue = interpolateAt(runB, p.x);
        if (bValue !== null) break;
      }
      if (bValue !== null) out.push({ x: p.x, y: p.y - bValue });
    }
    return out;
  });
}
