import type { Path2D } from "mallory-math";
import { pairwiseSync, transduceSync, transducers } from "mallory-iteration";

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
