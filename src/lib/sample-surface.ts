import { Graph3DUtils, Symbolic, Vector, type Mesh } from "mallory-math";
import { preprocessImplicitMultiplication } from "./implicit-mult.ts";

export interface SurfaceDomain {
  min: number;
  max: number;
}

/**
 * Sample a two-variable expression z=f(x,y) over a grid into mallory-math
 * Graph3DUtils Mesh data (two triangle sweeps, non-indexed). Mirrors
 * sample-function.ts's sampleExpr: Symbolic.compile is built once outside
 * the sampling loop rather than re-parsing per grid point.
 *
 * `Graph3DUtils.pointMatrixToMesh3D` (upstream, unmodifiable) builds a face
 * for every three neighboring grid points unconditionally -- a NaN/Infinity
 * z value (e.g. at a singularity) still produces a `Vec3` (just with a
 * non-finite z), poisoning that triangle rather than being skipped. Since
 * that function can't be changed, the fix is a post-filter here: drop any
 * face touching a non-finite z, mirroring sample-function.ts's gap handling.
 */
export function sampleSurface(
  expr: string,
  xDomain: SurfaceDomain,
  yDomain: SurfaceDomain,
  resolution: number,
  params: Record<string, number> = {},
  // Unlimited overlaid surfaces (#336 item 7): each row picks its own fill
  // color, so several overlaid surfaces in one scene stay visually
  // distinguishable -- same optional trailing param, same default (the
  // panel's original single-surface blue), as sampleParametricSurface's own
  // identical addition (issue #251).
  color = 0x2563eb,
): Mesh[] {
  const compiled = Symbolic.compile(preprocessImplicitMultiplication(expr));
  const xStep = (xDomain.max - xDomain.min) / resolution;
  const yStep = (yDomain.max - yDomain.min) / resolution;
  const env: Record<string, number> = { ...params, x: 0, y: 0 };
  const matrix = Graph3DUtils.dualRangeVector(
    (x, y) => {
      env.x = x;
      env.y = y;
      return Vector.fromArray([x, y, compiled(env)]);
    },
    xDomain.min,
    xDomain.max,
    xStep,
    yDomain.min,
    yDomain.max,
    yStep,
  );
  const meshes = Graph3DUtils.pointMatrixToMesh3D(matrix, color, 1, 0x93c5fd, 1);
  return meshes.map((mesh) => ({
    ...mesh,
    faces: mesh.faces.filter((face) => face.every((vertex) => Number.isFinite(vertex.z))),
  }));
}
