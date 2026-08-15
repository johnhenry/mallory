import { Symbolic } from "mallory-math";
import { preprocessImplicitMultiplication } from "./implicit-mult.ts";

export interface SpaceCurvePoint {
  x: number;
  y: number;
  z: number;
}

export interface Domain1D {
  min: number;
  max: number;
}

/**
 * Samples a parametric space curve r(t) = (x(t), y(t), z(t)) -- issue #30
 * item 2, unblocked from `Graph3DUtils.create3DCurveSegment` (verified
 * broken: it silently discards the z-component of a segment's direction,
 * producing a flat 2D ribbon regardless of input -- see the issue's own
 * empirical writeup). Mirrors `sample-vector-field-3d.ts`'s code shape
 * (three independently `Symbolic.compile`d expressions, no `Graph3DUtils`/
 * `Mesh` involvement at all) rather than `sample-parametric-surface.ts`'s,
 * since that file's `dualRangeVector`/`pointMatrixToMesh3D` pipeline is
 * inherently 2-parameter (a lattice-to-mesh-faces pipeline) with no
 * single-parameter analog to narrow down to.
 *
 * A non-finite sample (e.g. a pole in the expression) is skipped rather
 * than aborting the whole curve -- unlike `drawFilledArea`'s run-splitting
 * for a 2D discontinuous curve, the caller here builds one continuous
 * `THREE.CatmullRomCurve3` through every returned point, so a skipped
 * sample reads as a straight interpolated bridge across the gap rather than
 * a genuine break. Documented v1 simplification: none of this issue's own
 * presets (helix, trefoil knot, circle) have a pole in their domain, so it
 * doesn't come up in practice yet.
 */
export function sampleSpaceCurve(exprX: string, exprY: string, exprZ: string, tDomain: Domain1D, resolution = 300): SpaceCurvePoint[] {
  const compiledX = Symbolic.compile(preprocessImplicitMultiplication(exprX));
  const compiledY = Symbolic.compile(preprocessImplicitMultiplication(exprY));
  const compiledZ = Symbolic.compile(preprocessImplicitMultiplication(exprZ));
  const points: SpaceCurvePoint[] = [];
  const env: Record<string, number> = { t: 0 };
  for (let i = 0; i <= resolution; i++) {
    const t = tDomain.min + (i / resolution) * (tDomain.max - tDomain.min);
    env.t = t;
    const x = compiledX(env);
    const y = compiledY(env);
    const z = compiledZ(env);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) points.push({ x, y, z });
  }
  return points;
}

export interface SpaceCurvePreset {
  label: string;
  exprX: string;
  exprY: string;
  exprZ: string;
  tDomain: Domain1D;
}

/** Keyed (not an array), matching `sample-parametric-surface.ts`'s `PARAMETRIC_PRESETS` convention. */
export const SPACE_CURVE_PRESETS: Record<string, SpaceCurvePreset> = {
  helix: { label: "Helix", exprX: "cos(t)", exprY: "sin(t)", exprZ: "0.15*t", tDomain: { min: 0, max: 4 * Math.PI } },
  circle: { label: "Circle", exprX: "cos(t)", exprY: "sin(t)", exprZ: "0", tDomain: { min: 0, max: 2 * Math.PI } },
  trefoil: {
    label: "Trefoil knot",
    exprX: "sin(t) + 2*sin(2*t)",
    exprY: "cos(t) - 2*cos(2*t)",
    exprZ: "-sin(3*t)",
    tDomain: { min: 0, max: 2 * Math.PI },
  },
};
