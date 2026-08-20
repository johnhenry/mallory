import { ComplexNumber, Symbolic } from "mallory-math";
import { evaluateComplex } from "./complex-eval.ts";
import { preprocessImplicitMultiplication } from "./implicit-mult.ts";
import type { Domain1D, SpaceCurvePoint } from "./sample-space-curve.ts";

/**
 * A complex "graph" y = f(x) has 4 real degrees of freedom (Re(x), Im(x),
 * Re(y), Im(y)) -- a 3D plot can only show 3 axes, so exactly one is always
 * dropped (held fixed at 0). Which one determines the shape: dropping a
 * DOMAIN component (reX/imX) leaves the other domain component as the
 * single free real parameter driving a CURVE; dropping a RANGE component
 * (reY/imY) leaves both domain components free, driving a SURFACE (issue
 * #345's own follow-up, not implemented here). This module handles the
 * curve case only.
 */
export type ComplexComponent = "reX" | "imX" | "reY" | "imY";

export const COMPONENT_LABELS: Record<ComplexComponent, string> = {
  reX: "Re(x)",
  imX: "Im(x)",
  reY: "Re(y)",
  imY: "Im(y)",
};

export interface ComplexGraphAxisAssignment {
  /** Held fixed at 0. Must be "reX" or "imX" for the curve case -- dropping a range component produces a surface instead (issue #345's own follow-up). */
  drop: ComplexComponent;
  x: ComplexComponent;
  y: ComplexComponent;
  z: ComplexComponent;
}

/** True iff `assignment` is internally consistent: `drop` is a domain component, and {drop, x, y, z} is exactly the 4 components with no repeats. */
export function isValidCurveAxisAssignment(assignment: ComplexGraphAxisAssignment): boolean {
  if (assignment.drop !== "reX" && assignment.drop !== "imX") return false;
  const all = [assignment.drop, assignment.x, assignment.y, assignment.z];
  return new Set(all).size === 4;
}

/**
 * Samples the curve traced by y = f(x) as x's non-dropped domain component
 * sweeps `tDomain`, reading off whichever of {Re(x), Im(x), Re(y), Im(y)}
 * `assignment` maps to each screen axis. Reuses `SpaceCurvePanel`'s own
 * `SpaceCurvePoint` shape (issue #345) so its Three.js tube-rendering can
 * be reused unmodified -- the only new thing here is the complex-valued
 * math feeding it, not a new rendering pipeline.
 *
 * `yExprSource` is parsed through the same complex evaluator ComplexPanel
 * uses (`evaluateComplex`, `complex-eval.ts`) with `x` bound to the swept
 * complex value each step -- so `pi`/`e`/`i` and every elementary function
 * (sqrt/sin/exp/...) already work exactly as they do there.
 *
 * A non-finite or throwing sample (a pole, or outside the function's
 * domain) is skipped rather than aborting the whole curve, same as
 * `sampleSpaceCurve`'s own convention -- the caller builds one continuous
 * `CatmullRomCurve3` through whatever points come back.
 */
export function sampleComplexGraphCurve(
  yExprSource: string,
  assignment: ComplexGraphAxisAssignment,
  tDomain: Domain1D,
  resolution = 300,
): SpaceCurvePoint[] {
  if (!isValidCurveAxisAssignment(assignment)) {
    throw new Error('Curve mode needs "drop" to be Re(x) or Im(x), and every one of Re(x)/Im(x)/Re(y)/Im(y) assigned to exactly one of drop/x/y/z.');
  }
  const expr = Symbolic.parse(preprocessImplicitMultiplication(yExprSource));
  const points: SpaceCurvePoint[] = [];
  for (let i = 0; i <= resolution; i++) {
    const t = tDomain.min + (i / resolution) * (tDomain.max - tDomain.min);
    const reX = assignment.drop === "reX" ? 0 : t;
    const imX = assignment.drop === "imX" ? 0 : t;
    let y: ComplexNumber;
    try {
      // evaluateComplex's own constant table only has pi/e -- "i" (the
      // imaginary unit) has to be bound via env explicitly, same as
      // calculator-eval.ts's identical complex mode does.
      y = evaluateComplex(expr, { x: new ComplexNumber(reX, imX), i: ComplexNumber.I });
    } catch {
      continue;
    }
    const components: Record<ComplexComponent, number> = { reX, imX, reY: y.re, imY: y.im };
    const point: SpaceCurvePoint = { x: components[assignment.x], y: components[assignment.y], z: components[assignment.z] };
    if (Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)) points.push(point);
  }
  return points;
}
