import { GraphUtils, Symbolic, Vector, type Path2D } from "@johnhenry/math";
import type { Domain } from "./sample-function.ts";
import { preprocessImplicitMultiplication } from "./implicit-mult.ts";

/**
 * Samples a parametric curve (x(t), y(t)) over a t-domain into a
 * mallory-math Path2D, gap-tolerant the same way `sampleExpr` is: a
 * non-finite sample (either component) breaks the current run rather than
 * drawing a garbage line through it.
 */
export function sampleParametricCurve(
  exprX: string,
  exprY: string,
  tDomain: Domain,
  resolution: number,
  tVar = "t",
  color = 0x2563eb,
): Path2D {
  const compiledX = Symbolic.compile(preprocessImplicitMultiplication(exprX));
  const compiledY = Symbolic.compile(preprocessImplicitMultiplication(exprY));
  const env: Record<string, number> = { [tVar]: 0 };
  const runs: Vector<number>[][] = [[]];
  for (let i = 0; i < resolution; i++) {
    const t = tDomain.min + (i / (resolution - 1)) * (tDomain.max - tDomain.min);
    env[tVar] = t;
    const x = compiledX(env);
    const y = compiledY(env);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      (runs[runs.length - 1] as Vector<number>[]).push(Vector.fromArray([x, y]));
    } else if ((runs[runs.length - 1] as Vector<number>[]).length > 0) {
      runs.push([]);
    }
  }
  const segments = runs.filter((run) => run.length > 0).map((run) => GraphUtils.vectorToCurve(Vector.fromArray(run), 2, color));
  if (segments.length === 0) return GraphUtils.vectorToCurve(Vector.fromArray([]), 2, color);
  return { stroke: (segments[0] as Path2D).stroke, commands: segments.flatMap((s) => s.commands) };
}

/**
 * A polar curve r(θ) is just a parametric curve x=r·cosθ, y=r·sinθ
 * parametrized by θ -- reuses `sampleParametricCurve` directly on two
 * string expressions built from the r(θ) source, rather than a separate
 * sampling algorithm.
 */
export function samplePolarCurve(exprR: string, thetaDomain: Domain, resolution: number, thetaVar = "t", color = 0x2563eb): Path2D {
  return sampleParametricCurve(`(${exprR})*cos(${thetaVar})`, `(${exprR})*sin(${thetaVar})`, thetaDomain, resolution, thetaVar, color);
}
