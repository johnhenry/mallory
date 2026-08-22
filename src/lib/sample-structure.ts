import { Symbolic, type Expr } from "@johnhenry/math";
import type { FiniteStructure } from "./finite-structure.ts";
import { preprocessImplicitMultiplication } from "./implicit-mult.ts";

export interface ScatterPoint {
  x: number;
  y: number;
}

/**
 * Evaluates an expression at every element of a finite structure (e.g. every
 * element of Z/7Z), producing a scatter of points instead of a continuous
 * curve. Elements at which the expression is undefined (e.g. division by a
 * non-invertible element in a composite modulus, which `integersModulo`
 * reports as `NaN` rather than throwing) are silently skipped.
 */
export function sampleStructureExpr(
  expr: Expr | string,
  finite: FiniteStructure,
  variable = "x",
  params: Record<string, number> = {},
): ScatterPoint[] {
  const parsed = typeof expr === "string" ? Symbolic.parse(preprocessImplicitMultiplication(expr)) : expr;
  const points: ScatterPoint[] = [];
  for (const x of finite.elements) {
    try {
      const y = Symbolic.evaluateOverStructure(parsed, finite.structure, { ...params, [variable]: x });
      if (Number.isNaN(y)) continue;
      points.push({ x, y });
    } catch {
      continue;
    }
  }
  return points;
}
