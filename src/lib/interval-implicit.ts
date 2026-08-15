import { Interval, Symbolic } from "mallory-math";
import { equationToImplicitZero } from "./equation-to-zero.ts";
import { evaluateInterval } from "./interval-eval.ts";
import { preprocessImplicitMultiplication } from "./implicit-mult.ts";
import type { Domain } from "./sample-function.ts";

export interface ImplicitBox {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export interface IntervalSubdivisionOptions {
  /** Hard cap on recursion depth -- bounds worst-case box count at 4^maxDepth. */
  maxDepth?: number;
  /** Stop subdividing once a box's larger side is at or below this size. */
  minBoxSize?: number;
}

/**
 * Guaranteed-coverage implicit-curve enclosure via interval-box subdivision
 * (issue #21, item 1): evaluate the relation's field over a box using
 * rigorous `Interval` arithmetic (`evaluateInterval`, #85's interval-mode
 * evaluator); if 0 is provably NOT in the result, the curve cannot pass
 * through the box at all, so it's discarded outright -- a proof, not a
 * sample. Otherwise the box is split into 4 quadrants and each is checked
 * recursively, down to `maxDepth`/`minBoxSize`, where it's kept as a leaf
 * "the curve is somewhere in here" enclosure.
 *
 * Unlike `sampleImplicitCurve`'s marching squares -- which only evaluates
 * the field at grid POINTS and can step clean over a thin branch or a
 * near-tangency that happens to fall between two adjacent sample points --
 * this method can never silently miss a genuine curve segment inside the
 * starting domain: a box is only ever discarded when interval arithmetic
 * has proven it's empty.
 */
export function sampleImplicitCurveIntervalBoxes(
  expr: string,
  xDomain: Domain,
  yDomain: Domain,
  options: IntervalSubdivisionOptions = {},
  xVar = "x",
  yVar = "y",
): ImplicitBox[] {
  const maxDepth = options.maxDepth ?? 12;
  const minBoxSize = options.minBoxSize ?? 0;
  const parsed = Symbolic.parse(preprocessImplicitMultiplication(equationToImplicitZero(expr)));
  const boxes: ImplicitBox[] = [];

  function recurse(xMin: number, xMax: number, yMin: number, yMax: number, depth: number): void {
    let containsZero: boolean;
    try {
      containsZero = evaluateInterval(parsed, { [xVar]: new Interval(xMin, xMax), [yVar]: new Interval(yMin, yMax) }).contains(0);
    } catch {
      // Can't rigorously bound the field over this box (division by a
      // zero-containing interval, sqrt/log of a non-positive interval,
      // etc.) -- conservatively treat as "can't disprove a zero is here"
      // rather than silently dropping a box that might hold the curve.
      containsZero = true;
    }
    if (!containsZero) return;

    const atLimit = depth >= maxDepth || Math.max(xMax - xMin, yMax - yMin) <= minBoxSize;
    if (atLimit) {
      boxes.push({ xMin, xMax, yMin, yMax });
      return;
    }

    const xMid = (xMin + xMax) / 2;
    const yMid = (yMin + yMax) / 2;
    recurse(xMin, xMid, yMin, yMid, depth + 1);
    recurse(xMid, xMax, yMin, yMid, depth + 1);
    recurse(xMin, xMid, yMid, yMax, depth + 1);
    recurse(xMid, xMax, yMid, yMax, depth + 1);
  }

  recurse(xDomain.min, xDomain.max, yDomain.min, yDomain.max, 0);
  return boxes;
}
