import { Symbolic, type Expr } from "@johnhenry/math";

/**
 * Exact numeric derivative f'(x0) of a single-variable expression at a
 * point, via symbolic differentiation (`Symbolic.differentiate`) +
 * evaluation -- NOT via `DualNumber` forward-mode AD, despite that sounding
 * like the more direct approach for "exact derivative at a point."
 * `DualNumber` only plugs into an arbitrary `Expr` through
 * `Symbolic.evaluateOverStructure`, which explicitly throws on any `func`/
 * `call2` node (sin/cos/sqrt/exp/atan2/...) -- i.e. it can't evaluate the
 * vast majority of expressions this app's graphing panels actually plot.
 * `Symbolic.differentiate` has no such restriction (it already supports
 * every function this app's expression grammar does), so it's the correct
 * general-purpose path -- and `DualNumber`'s exactness guarantee doesn't buy
 * anything extra here anyway, since differentiate+evaluate is already exact
 * by construction (no finite-difference approximation involved).
 */
export function evaluateDerivativeAtPoint(expr: Expr | string, x: number, params: Record<string, number> = {}, variable = "x"): number {
  const derivative = Symbolic.differentiate(expr, variable);
  return Symbolic.evaluate(derivative, { ...params, [variable]: x });
}
