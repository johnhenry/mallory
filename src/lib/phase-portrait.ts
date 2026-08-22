import { ComplexNumber, Symbolic, SystemDidNotConvergeError, type Expr } from "@johnhenry/math";
import { linalg } from "mallory-adapter-math";
import { Tensor } from "mallory-tensor-core";
import type { Domain } from "./sample-function.ts";
import type { OdeSystemSpec } from "./sample-ode.ts";

export type FixedPointClass = "saddle" | "stable-node" | "unstable-node" | "stable-spiral" | "unstable-spiral" | "center";

export const FIXED_POINT_LABEL: Record<FixedPointClass, string> = {
  saddle: "Saddle",
  "stable-node": "Stable node",
  "unstable-node": "Unstable node",
  "stable-spiral": "Stable spiral",
  "unstable-spiral": "Unstable spiral",
  center: "Center",
};

export interface ClassifiedFixedPoint {
  x: number;
  y: number;
  eigenvalues: [ComplexNumber, ComplexNumber];
  kind: FixedPointClass;
}

const DEDUPE_TOLERANCE = 1e-4;
const NEAR_ZERO = 1e-9;

/**
 * Searches for fixed points of `spec` (dx/dt = f, dy/dt = g, both = 0) by
 * running `Symbolic.solveSystemNumeric` from a grid of seed points spanning
 * `xDomain`x`yDomain` -- that method "only ever finds one root near the
 * initial guess" (its own doc comment), so covering the domain with several
 * seeds is how multiple fixed points get found at all. Seeds that fail to
 * converge (SystemDidNotConvergeError, or any other evaluation failure) are
 * silently skipped -- most seeds in a typical grid don't sit near any root.
 * Successful roots within `DEDUPE_TOLERANCE` of an already-found one are
 * merged, since neighboring seeds routinely converge to the same point.
 */
export function findFixedPoints(spec: OdeSystemSpec, xDomain: Domain, yDomain: Domain, t: number, gridDensity = 7): Array<{ x: number; y: number }> {
  const [nameA, nameB] = spec.stateVars;
  const equations: (Expr | string)[] = spec.derivatives.map((d) =>
    spec.independentVar === "t" ? Symbolic.substitute(d, spec.independentVar, String(t)) : d,
  );
  const found: Array<{ x: number; y: number }> = [];

  for (let i = 0; i < gridDensity; i++) {
    const sx = xDomain.min + (i / Math.max(1, gridDensity - 1)) * (xDomain.max - xDomain.min);
    for (let j = 0; j < gridDensity; j++) {
      const sy = yDomain.min + (j / Math.max(1, gridDensity - 1)) * (yDomain.max - yDomain.min);
      try {
        const root = Symbolic.solveSystemNumeric(equations, [nameA, nameB], [sx, sy]);
        const x = root[nameA] as number;
        const y = root[nameB] as number;
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const isDuplicate = found.some((p) => Math.hypot(p.x - x, p.y - y) < DEDUPE_TOLERANCE);
        if (!isDuplicate) found.push({ x, y });
      } catch (e) {
        if (e instanceof SystemDidNotConvergeError) continue;
        // Any other evaluation failure (e.g. a domain error at this seed) is
        // just as uninformative as non-convergence for this search.
        continue;
      }
    }
  }
  return found;
}

/**
 * Classifies a fixed point of `spec` by the eigenvalues of its Jacobian,
 * computed exactly via symbolic partial differentiation
 * (`Symbolic.differentiate`) and evaluated at the point -- not a numeric
 * finite-difference approximation. The Jacobian is handed to
 * `mallory-adapter-math`'s `linalg.eigGeneral` (Hessenberg + shifted-QR),
 * which -- unlike a symmetric-only eigensolver -- correctly returns the
 * complex-conjugate pairs that make spirals/centers.
 *
 * Classification by eigenvalue real/imaginary parts (standard planar
 * linearization theory):
 *  - both real, opposite sign -> saddle
 *  - both real, same sign -> stable/unstable node (sign of the real parts)
 *  - complex conjugate pair, nonzero real part -> stable/unstable spiral
 *  - complex conjugate pair, ~zero real part -> center
 */
export function classifyFixedPoint(spec: OdeSystemSpec, point: { x: number; y: number }, t: number): ClassifiedFixedPoint {
  const [nameA, nameB] = spec.stateVars;
  const env = (x: number, y: number): Record<string, number> => ({ [nameA]: x, [nameB]: y, [spec.independentVar]: t });

  const dfdx = Symbolic.differentiate(spec.derivatives[0], nameA);
  const dfdy = Symbolic.differentiate(spec.derivatives[0], nameB);
  const dgdx = Symbolic.differentiate(spec.derivatives[1], nameA);
  const dgdy = Symbolic.differentiate(spec.derivatives[1], nameB);

  const j00 = Symbolic.evaluate(dfdx, env(point.x, point.y));
  const j01 = Symbolic.evaluate(dfdy, env(point.x, point.y));
  const j10 = Symbolic.evaluate(dgdx, env(point.x, point.y));
  const j11 = Symbolic.evaluate(dgdy, env(point.x, point.y));

  const jacobian = Tensor.from([j00, j01, j10, j11]).reshape([2, 2]);
  const raw = linalg.eigGeneral(jacobian);
  if (raw.length !== 2) throw new Error(`eigGeneral of a 2x2 matrix returned ${raw.length} eigenvalues, expected 2.`);
  const eigenvalues: [ComplexNumber, ComplexNumber] = [raw[0] as ComplexNumber, raw[1] as ComplexNumber];

  return { x: point.x, y: point.y, eigenvalues, kind: classifyFromEigenvalues(eigenvalues) };
}

export function classifyFromEigenvalues([e0, e1]: [ComplexNumber, ComplexNumber]): FixedPointClass {
  const bothReal = Math.abs(e0.iValue) < NEAR_ZERO && Math.abs(e1.iValue) < NEAR_ZERO;
  if (bothReal) {
    if (e0.value * e1.value < 0) return "saddle";
    return e0.value + e1.value < 0 ? "stable-node" : "unstable-node";
  }
  // Non-real eigenvalues of a real matrix always come as a conjugate pair,
  // so both real parts are equal -- either one classifies the pair.
  const realPart = e0.value;
  if (Math.abs(realPart) < NEAR_ZERO) return "center";
  return realPart < 0 ? "stable-spiral" : "unstable-spiral";
}
