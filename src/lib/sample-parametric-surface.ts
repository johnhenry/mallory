import { Graph3DUtils, Symbolic, Vector, type Mesh } from "mallory-math";
import { preprocessImplicitMultiplication } from "./implicit-mult.ts";

export interface ParametricDomain {
  min: number;
  max: number;
}

/**
 * Sample a parametric surface r(u,v) = (x(u,v), y(u,v), z(u,v)) over a u/v
 * grid into mallory-math Graph3DUtils Mesh data. Mirrors sample-surface.ts's
 * sampleSurface (same `dualRangeVector` -> `pointMatrixToMesh3D` pipeline),
 * but unlike a z=f(x,y) height field -- where x/y ARE the grid coordinates,
 * always finite by construction, and only z can go non-finite -- here x, y,
 * AND z are all independently computed from expressions, so a face is
 * dropped if ANY of its three vertex components is non-finite, not just z.
 */
export function sampleParametricSurface(
  exprX: string,
  exprY: string,
  exprZ: string,
  uDomain: ParametricDomain,
  vDomain: ParametricDomain,
  resolution: number,
  params: Record<string, number> = {},
  // Unlimited surfaces (issue #251): each row picks its own fill color, so
  // several overlaid surfaces in one scene stay visually distinguishable --
  // defaults to the panel's original single-surface blue.
  color = 0x2563eb,
): Mesh[] {
  const compiledX = Symbolic.compile(preprocessImplicitMultiplication(exprX));
  const compiledY = Symbolic.compile(preprocessImplicitMultiplication(exprY));
  const compiledZ = Symbolic.compile(preprocessImplicitMultiplication(exprZ));
  const uStep = (uDomain.max - uDomain.min) / resolution;
  const vStep = (vDomain.max - vDomain.min) / resolution;
  const env: Record<string, number> = { ...params, u: 0, v: 0 };
  const matrix = Graph3DUtils.dualRangeVector(
    (u, v) => {
      env.u = u;
      env.v = v;
      return Vector.fromArray([compiledX(env), compiledY(env), compiledZ(env)]);
    },
    uDomain.min,
    uDomain.max,
    uStep,
    vDomain.min,
    vDomain.max,
    vStep,
  );
  const meshes = Graph3DUtils.pointMatrixToMesh3D(matrix, color, 1, 0x93c5fd, 1);
  return meshes.map((mesh) => ({
    ...mesh,
    faces: mesh.faces.filter((face) => face.every((vertex) => Number.isFinite(vertex.x) && Number.isFinite(vertex.y) && Number.isFinite(vertex.z))),
  }));
}

export interface ParametricPreset {
  label: string;
  exprX: string;
  exprY: string;
  exprZ: string;
  uDomain: ParametricDomain;
  vDomain: ParametricDomain;
}

const TWO_PI = 2 * Math.PI;

/**
 * Three named presets (issue #30's explicit examples). Formulas hand-checked
 * at (u,v)=(0,0) (and sphere at (0, pi/2)) against the closed-form geometry
 * they're supposed to draw -- see sample-parametric-surface.test.ts.
 */
export const PARAMETRIC_PRESETS: Record<string, ParametricPreset> = {
  torus: {
    label: "Torus",
    exprX: "(2+cos(v))*cos(u)",
    exprY: "(2+cos(v))*sin(u)",
    exprZ: "sin(v)",
    uDomain: { min: 0, max: TWO_PI },
    vDomain: { min: 0, max: TWO_PI },
  },
  sphere: {
    label: "Sphere",
    exprX: "2*sin(v)*cos(u)",
    exprY: "2*sin(v)*sin(u)",
    exprZ: "2*cos(v)",
    uDomain: { min: 0, max: TWO_PI },
    vDomain: { min: 0, max: Math.PI },
  },
  mobius: {
    label: "Möbius strip",
    exprX: "(1+(v/2)*cos(u/2))*cos(u)",
    exprY: "(1+(v/2)*cos(u/2))*sin(u)",
    exprZ: "(v/2)*sin(u/2)",
    uDomain: { min: 0, max: TWO_PI },
    vDomain: { min: -1, max: 1 },
  },
};
