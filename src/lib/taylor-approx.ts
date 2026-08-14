import { Symbolic, type Expr, type Path2D } from "mallory-math";
import { exprToLatex } from "./expr-to-latex.ts";
import { preprocessImplicitMultiplication } from "./implicit-mult.ts";
import { sampleExpr, type Domain } from "./sample-function.ts";

const RESOLUTION = 300;
const TAYLOR_COLOR = 0xdc2626; // distinct from the default curve blue, so the approximation reads as a separate overlay

export interface TaylorApproximation {
  fPath: Path2D;
  taylorPath: Path2D;
  taylorExpr: Expr;
  latex: string;
}

/**
 * Samples both f(x) and its degree-`order` Taylor polynomial about `center`
 * (via `Symbolic.taylor`) over the same domain, so the two can be drawn
 * overlaid. `Symbolic.taylor` returns a plain `Expr` that `sampleExpr`
 * already accepts directly (`Expr | string`) -- no separate polynomial
 * sampler needed.
 */
export function computeTaylorApproximation(
  expr: string,
  center: number,
  order: number,
  xDomain: Domain,
  visibleYRange?: { min: number; max: number },
): TaylorApproximation {
  const parsed = Symbolic.parse(preprocessImplicitMultiplication(expr));
  const fPath = sampleExpr(parsed, xDomain, RESOLUTION, "x", {}, undefined, visibleYRange);
  const taylorExpr = Symbolic.taylor(parsed, "x", center, order);
  const taylorPath = sampleExpr(taylorExpr, xDomain, RESOLUTION, "x", {}, TAYLOR_COLOR, visibleYRange);
  return { fPath, taylorPath, taylorExpr, latex: exprToLatex(taylorExpr) };
}

export type LimitDirection = "left" | "right" | "both";

export interface LimitOutcome {
  ok: true;
  value: number;
}

/**
 * Numeric limit via `Symbolic.limit` -- note its own documented behavior: a
 * one-sided limit that diverges to +-infinity returns a large finite proxy
 * value (its numeric-approximation strategy), not `Infinity` itself, so a
 * caller displaying the raw number for a genuinely divergent limit will see
 * something like `1000000`, not `Infinity`. Left as-is here (not
 * special-cased to detect "large enough to mean infinity") since that
 * threshold is Symbolic.limit's own implementation detail, not something
 * this module should second-guess.
 */
export function computeLimit(expr: string, point: number, direction: LimitDirection): LimitOutcome | { ok: false; message: string } {
  try {
    const value = Symbolic.limit(preprocessImplicitMultiplication(expr), "x", point, direction);
    return { ok: true, value };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
