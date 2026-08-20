import { ComplexNumber, Symbolic } from "mallory-math";
import { evaluateComplex } from "./complex-eval.ts";
import { preprocessImplicitMultiplication } from "./implicit-mult.ts";
import type { Domain1D, SpaceCurvePoint } from "./sample-space-curve.ts";

/**
 * A complex "graph" y = f(x) has 4 real degrees of freedom (Re(x), Im(x),
 * Re(y), Im(y)) -- a 3D plot can only show 3 at once. Any of the 4 may be
 * assigned to any screen axis (X/Y/Z), or left "none" (that axis's screen
 * coordinate is just fixed at 0 -- see `AxisChoice`).
 */
export type ComplexComponent = "reX" | "imX" | "reY" | "imY";

/** An axis dropdown's full choice set: one of the 4 real components, or explicitly unassigned. */
export type AxisChoice = ComplexComponent | "none";

export const ALL_COMPONENTS: ComplexComponent[] = ["reX", "imX", "reY", "imY"];

export const COMPONENT_LABELS: Record<ComplexComponent, string> = {
  reX: "Re(x)",
  imX: "Im(x)",
  reY: "Re(y)",
  imY: "Im(y)",
};

export function isComplexComponent(v: unknown): v is ComplexComponent {
  return v === "reX" || v === "imX" || v === "reY" || v === "imY";
}

export function isAxisChoice(v: unknown): v is AxisChoice {
  return v === "none" || isComplexComponent(v);
}

/**
 * The screen-axis assignment: which of the 4 real components (or "none")
 * maps to X/Y/Z. Any axis may independently be "none", any real component
 * may be reused... except not reused -- see `isValidComplexAxisAssignment`,
 * which is the only remaining constraint (previously the UI/sampler also
 * required "exactly one domain component dropped" so the result was always
 * a clean curve; that rule is gone -- see this module's own top comment
 * and `sampleComplexGraph`'s curve-vs-scatter auto-detection instead).
 */
export interface ComplexGraphAxisAssignment {
  x: AxisChoice;
  y: AxisChoice;
  z: AxisChoice;
}

/**
 * True iff at least one axis is assigned to a real component (otherwise
 * there's nothing to plot at all) and no two axes share the same
 * non-"none" component (multiple axes can independently be "none", that's
 * just an incomplete-looking but valid assignment -- see `AxisSelect`'s own
 * doc comment in ComplexGraph3DPanel.tsx for why the UI only blocks exact
 * duplicates and nothing more).
 */
export function isValidComplexAxisAssignment(assignment: ComplexGraphAxisAssignment): boolean {
  const used = [assignment.x, assignment.y, assignment.z].filter(isComplexComponent);
  if (used.length === 0) return false;
  return new Set(used).size === used.length;
}

/**
 * Explicit per-domain-component "sweep even if not shown on any screen
 * axis" flags (issue #365) -- independent from axis assignment. Today's
 * default behavior (both false) means a domain component that isn't
 * assigned to a screen axis is implicitly held fixed at 0, which is what
 * makes `{Re(x), Re(y), None}` for `e^(i*x)` trace a clean curve rather
 * than scatter (Im(x) never actually varies). Setting a flag to true
 * sweeps that component across the domain range regardless of whether
 * it's assigned to an axis -- the way to deliberately reproduce the
 * "hidden dimension shows up as scatter" case #359's own design comment
 * anticipated, distinct from today's implicit real-only default.
 */
export interface DomainSweepFlags {
  reX: boolean;
  imX: boolean;
}

const NO_FORCED_SWEEP: DomainSweepFlags = { reX: false, imX: false };

/**
 * Which of the 2 domain components (Re(x)/Im(x)) are EFFECTIVELY swept --
 * assigned to at least one screen axis, OR explicitly forced via `sweep`
 * (issue #365) -- drives `sampleComplexGraph`'s 0D/1D/2D sampling and
 * curve-vs-scatter choice below. Exported so the panel's own UI hint can
 * describe the same 0/1/2-used cases without duplicating the rule.
 */
export function usedDomainComponents(assignment: ComplexGraphAxisAssignment, sweep: DomainSweepFlags = NO_FORCED_SWEEP): Array<"reX" | "imX"> {
  const assigned = new Set([assignment.x, assignment.y, assignment.z]);
  return (["reX", "imX"] as const).filter((c) => assigned.has(c) || sweep[c]);
}

/** Grid side length for the 2-domain-components-used (surface-shaped) case -- squared, so kept far below the 1D curve case's `resolution` to stay responsive (60^2 = 3721 points, plenty dense for a scatter). */
const GRID_RESOLUTION = 60;

export type ComplexGraphSampleResult = { mode: "curve" | "scatter"; points: SpaceCurvePoint[] };

/**
 * Samples y = f(x) over `tDomain`, reading off whichever of {Re(x), Im(x),
 * Re(y), Im(y)} `assignment` maps to each screen axis (an axis assigned
 * "none" always reads as a constant 0). How many of the 2 domain
 * components (Re(x)/Im(x)) are actually assigned to a screen axis decides
 * both the sampling shape and the render mode, auto-detected rather than
 * chosen by the caller:
 *
 *  - 0 used: x is entirely fixed at the origin -- a single point.
 *  - 1 used: the other domain component is implicitly held at 0, and the
 *    used one sweeps `tDomain` as a single free real parameter -- a clean
 *    1D curve (e.g. the classic e^(i*x) spiral: {Re(x), Re(y), Im(y)}).
 *  - 2 used: both domain components are free, so a single 1D sweep can't
 *    capture the result -- a Re(x)*Im(x) grid over `tDomain` x `tDomain`
 *    is sampled instead, which generically covers a 2D sheet. Rendered as
 *    a scatter (point cloud), not a tube -- there's no single parameter
 *    order to draw a tube through. This is also what a plain real-only
 *    plot (e.g. mapping just {Re(x), Re(y)}, "None" on Z) falls into:
 *    since Im(x) isn't pinned to 0 by being assigned "none" -- it's simply
 *    not shown -- the swept grid still varies it, so distinct (Re(x),
 *    Im(x)) pairs can land on/near the same visible (Re(x), Re(y)) spot,
 *    which is exactly the "series of dots" the design discussion
 *    anticipated for that case.
 *
 * A non-finite or throwing sample (a pole, or outside the function's
 * domain) is skipped rather than aborting the whole sample, same as
 * `sampleSpaceCurve`'s own convention.
 */
export function sampleComplexGraph(
  yExprSource: string,
  assignment: ComplexGraphAxisAssignment,
  tDomain: Domain1D,
  resolution = 300,
  sweep: DomainSweepFlags = NO_FORCED_SWEEP,
): ComplexGraphSampleResult {
  if (!isValidComplexAxisAssignment(assignment)) {
    throw new Error("Assign at least one axis to a component, and don't assign the same component to two axes.");
  }
  const expr = Symbolic.parse(preprocessImplicitMultiplication(yExprSource));

  function sampleAt(reX: number, imX: number): SpaceCurvePoint | null {
    let y: ComplexNumber;
    try {
      // evaluateComplex's own constant table only has pi/e -- "i" (the
      // imaginary unit) has to be bound via env explicitly, same as
      // calculator-eval.ts's identical complex mode does.
      y = evaluateComplex(expr, { x: new ComplexNumber(reX, imX), i: ComplexNumber.I });
    } catch {
      return null;
    }
    const components: Record<ComplexComponent, number> = { reX, imX, reY: y.re, imY: y.im };
    const at = (choice: AxisChoice) => (choice === "none" ? 0 : components[choice]);
    const point: SpaceCurvePoint = { x: at(assignment.x), y: at(assignment.y), z: at(assignment.z) };
    return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z) ? point : null;
  }

  const domainUsed = usedDomainComponents(assignment, sweep);
  const points: SpaceCurvePoint[] = [];

  if (domainUsed.length === 0) {
    const p = sampleAt(0, 0);
    if (p) points.push(p);
    if (points.length === 0) throw new Error("x = 0 isn't a valid input to this expression -- nothing to plot.");
    return { mode: "scatter", points };
  }

  if (domainUsed.length === 1) {
    const sweptComponent = domainUsed[0] as "reX" | "imX";
    for (let i = 0; i <= resolution; i++) {
      const t = tDomain.min + (i / resolution) * (tDomain.max - tDomain.min);
      const reX = sweptComponent === "reX" ? t : 0;
      const imX = sweptComponent === "imX" ? t : 0;
      const p = sampleAt(reX, imX);
      if (p) points.push(p);
    }
    if (points.length < 2) throw new Error("Not enough valid samples to draw a curve -- widen the t range or check the expression.");
    return { mode: "curve", points };
  }

  const grid = Math.min(resolution, GRID_RESOLUTION);
  for (let i = 0; i <= grid; i++) {
    const reX = tDomain.min + (i / grid) * (tDomain.max - tDomain.min);
    for (let j = 0; j <= grid; j++) {
      const imX = tDomain.min + (j / grid) * (tDomain.max - tDomain.min);
      const p = sampleAt(reX, imX);
      if (p) points.push(p);
    }
  }
  if (points.length === 0) throw new Error("Not enough valid samples to plot -- widen the t range or check the expression.");
  return { mode: "scatter", points };
}
