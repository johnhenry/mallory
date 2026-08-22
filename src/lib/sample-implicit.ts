import { Symbolic } from "@johnhenry/math";
import { equationToImplicitZero } from "./equation-to-zero.ts";
import { preprocessImplicitMultiplication } from "./implicit-mult.ts";
import type { Domain } from "./sample-function.ts";

export interface ImplicitSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Builds the scalar field f(x,y) whose zero-level-set is the plotted curve.
 * `Symbolic.parse` has no bare `=` (only `==`/`!=`, to stay unambiguous with
 * this exact "implicitly equals zero" convention) -- so `equationToImplicitZero`
 * (the same helper `SystemSolverPanel` uses) converts a typed "x^2+y^2=4"
 * into "(x^2+y^2)-(4)" first. A relation already in implicit-zero form (no
 * bare "=") passes through unchanged.
 */
function compileField(expr: string, xVar: string, yVar: string): (x: number, y: number) => number {
  const parsed = Symbolic.parse(preprocessImplicitMultiplication(equationToImplicitZero(expr)));
  const compiled = Symbolic.compile(parsed);
  return (x, y) => compiled({ [xVar]: x, [yVar]: y });
}

// Which pair(s) of cell edges the zero-contour crosses, indexed by a 4-bit
// case (bit0=bottom-left corner "inside" i.e. field>=0, bit1=bottom-right,
// bit2=top-right, bit3=top-left) -- the standard marching-squares lookup,
// derived directly from "connect the edges adjacent to whichever corner(s)
// differ from their neighbors." Cases 5 and 10 are the ambiguous diagonal
// ("saddle") cases: resolved via the standard asymptotic decider -- the
// bilinear-average of the four corner values approximates the field at the
// cell center, and its sign reveals which pair of opposite corners the
// zero-contour actually separates. If the average's sign matches the
// corners currently paired as "diagonal-same" in the default pairing below,
// the true topology is the *other* diagonal pairing (the contour passes
// through the middle connecting the opposite pair instead), so the
// default is swapped; otherwise the default already matches. (Verified
// directly against a real bilinear field where this is exact, not just
// approximate -- see sample-implicit.test.ts.)
type Point = { x: number; y: number };
function edgesForCase(
  caseIndex: number,
  bottom: Point,
  right: Point,
  top: Point,
  left: Point,
  corners?: { v00: number; v10: number; v01: number; v11: number },
): [Point, Point][] {
  switch (caseIndex) {
    case 1:
    case 14:
      return [[left, bottom]];
    case 2:
    case 13:
      return [[bottom, right]];
    case 3:
    case 12:
      return [[left, right]];
    case 4:
    case 11:
      return [[right, top]];
    case 5: {
      const defaultPairing: [Point, Point][] = [
        [left, bottom],
        [right, top],
      ];
      if (!corners) return defaultPairing;
      const avg = (corners.v00 + corners.v10 + corners.v01 + corners.v11) / 4;
      if (avg >= 0 === corners.v00 >= 0) {
        return [
          [left, top],
          [bottom, right],
        ];
      }
      return defaultPairing;
    }
    case 6:
    case 9:
      return [[bottom, top]];
    case 7:
    case 8:
      return [[left, top]];
    case 10: {
      const defaultPairing: [Point, Point][] = [
        [bottom, right],
        [top, left],
      ];
      if (!corners) return defaultPairing;
      const avg = (corners.v00 + corners.v10 + corners.v01 + corners.v11) / 4;
      if (avg >= 0 === corners.v10 >= 0) {
        return [
          [left, bottom],
          [right, top],
        ];
      }
      return defaultPairing;
    }
    default:
      return [];
  }
}

function lerpToZero(a: number, b: number, va: number, vb: number): number {
  if (va === vb) return a;
  return a + ((0 - va) / (vb - va)) * (b - a);
}

/**
 * Traces the zero-contour of a two-variable relation (e.g. "x^2+y^2=4") over
 * a rectangular domain via marching squares: sample f(x,y) on a
 * resolution×resolution grid, and for every cell whose four corners aren't
 * all the same sign, interpolate where the boundary crosses each edge.
 * Returns disconnected line segments (not one continuous path) since an
 * implicit curve can have multiple components, self-intersections, or
 * branches that don't reduce to a single polyline.
 */
export function sampleImplicitCurve(
  expr: string,
  xDomain: Domain,
  yDomain: Domain,
  resolution = 80,
  xVar = "x",
  yVar = "y",
): ImplicitSegment[] {
  const field = compileField(expr, xVar, yVar);
  const nx = resolution;
  const ny = resolution;
  const xs = Array.from({ length: nx }, (_, i) => xDomain.min + (i / (nx - 1)) * (xDomain.max - xDomain.min));
  const ys = Array.from({ length: ny }, (_, j) => yDomain.min + (j / (ny - 1)) * (yDomain.max - yDomain.min));

  const grid: number[][] = ys.map((y) => xs.map((x) => field(x, y)));

  const segments: ImplicitSegment[] = [];
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const x0 = xs[i] as number;
      const x1 = xs[i + 1] as number;
      const y0 = ys[j] as number;
      const y1 = ys[j + 1] as number;
      const v00 = grid[j]?.[i];
      const v10 = grid[j]?.[i + 1];
      const v01 = grid[j + 1]?.[i];
      const v11 = grid[j + 1]?.[i + 1];
      if (v00 === undefined || v10 === undefined || v01 === undefined || v11 === undefined) continue;
      if (![v00, v10, v01, v11].every(Number.isFinite)) continue;

      let caseIndex = 0;
      if (v00 >= 0) caseIndex |= 1;
      if (v10 >= 0) caseIndex |= 2;
      if (v11 >= 0) caseIndex |= 4;
      if (v01 >= 0) caseIndex |= 8;
      if (caseIndex === 0 || caseIndex === 15) continue;

      const bottom: Point = { x: lerpToZero(x0, x1, v00, v10), y: y0 };
      const right: Point = { x: x1, y: lerpToZero(y0, y1, v10, v11) };
      const top: Point = { x: lerpToZero(x0, x1, v01, v11), y: y1 };
      const left: Point = { x: x0, y: lerpToZero(y0, y1, v00, v01) };

      for (const [p1, p2] of edgesForCase(caseIndex, bottom, right, top, left, { v00, v10, v01, v11 })) {
        segments.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
      }
    }
  }
  return segments;
}
