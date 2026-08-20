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

export const ALL_COMPONENTS: ComplexComponent[] = ["reX", "imX", "reY", "imY"];

export const COMPONENT_LABELS: Record<ComplexComponent, string> = {
  reX: "Re(x)",
  imX: "Im(x)",
  reY: "Re(y)",
  imY: "Im(y)",
};

function isDomainComponent(c: ComplexComponent): boolean {
  return c === "reX" || c === "imX";
}

/**
 * The screen-axis assignment: which of the 4 real components maps to X/Y/Z.
 * The 4th (unassigned) component is implicitly the dropped one, held fixed
 * at 0 -- there's no separate `drop` field to keep in sync with x/y/z (a
 * UI iteration on #345: the first version had one, which meant two
 * different controls could disagree about which component was excluded;
 * deriving it from whichever component ISN'T one of x/y/z removes that
 * whole class of inconsistency by construction).
 */
export interface ComplexGraphAxisAssignment {
  x: ComplexComponent;
  y: ComplexComponent;
  z: ComplexComponent;
}

/** The one component not assigned to any screen axis -- null if `assignment` isn't even a valid 3-of-4 selection (see `isValidCurveAxisAssignment`) yet, e.g. mid-edit with a duplicate. */
export function droppedComponent(assignment: ComplexGraphAxisAssignment): ComplexComponent | null {
  const used = new Set([assignment.x, assignment.y, assignment.z]);
  if (used.size !== 3) return null;
  return ALL_COMPONENTS.find((c) => !used.has(c)) ?? null;
}

/**
 * True iff `x`/`y`/`z` are 3 distinct components AND exactly one of them is
 * a domain component (Re(x) or Im(x)) -- equivalently, both Re(y) and
 * Im(y) are assigned somewhere, since the dropped 4th component must be a
 * domain one for this to be a curve (dropping a range component would be
 * the surface case instead, issue #345's own follow-up, not built here).
 * There are only 12 valid assignments total (2 choices of which domain
 * component survives x 3! orderings across X/Y/Z) -- small enough that
 * `isValidAxisTriple` (used by the UI's own per-option disabling) can just
 * brute-force-check every candidate rather than reasoning about it
 * case-by-case.
 */
export function isValidCurveAxisAssignment(assignment: ComplexGraphAxisAssignment): boolean {
  return isValidAxisTriple(assignment.x, assignment.y, assignment.z);
}

/** Order-independent: true iff `a`, `b`, `c` are 3 distinct components with exactly one domain component among them. Exported so the UI can ask "would choosing `c` here, alongside whatever the other two dropdowns already show, produce a valid assignment?" for its own per-option disabling, without duplicating this rule. */
export function isValidAxisTriple(a: ComplexComponent, b: ComplexComponent, c: ComplexComponent): boolean {
  const set = new Set([a, b, c]);
  if (set.size !== 3) return false;
  const domainCount = [a, b, c].filter(isDomainComponent).length;
  return domainCount === 1;
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
  const drop = droppedComponent(assignment);
  if (drop === null || !isValidCurveAxisAssignment(assignment)) {
    throw new Error("Every one of Re(x)/Im(x)/Re(y)/Im(y) must be assigned to exactly one of X/Y/Z, leaving Re(x) or Im(x) as the one dropped.");
  }
  const expr = Symbolic.parse(preprocessImplicitMultiplication(yExprSource));
  const points: SpaceCurvePoint[] = [];
  for (let i = 0; i <= resolution; i++) {
    const t = tDomain.min + (i / resolution) * (tDomain.max - tDomain.min);
    const reX = drop === "reX" ? 0 : t;
    const imX = drop === "imX" ? 0 : t;
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
