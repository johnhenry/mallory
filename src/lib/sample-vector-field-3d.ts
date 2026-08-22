import { Symbolic } from "@johnhenry/math";
import { preprocessImplicitMultiplication } from "./implicit-mult.ts";

export interface VectorField3DPoint {
  x: number;
  y: number;
  z: number;
  dx: number;
  dy: number;
  dz: number;
}

export interface Domain3D {
  min: number;
  max: number;
}

/**
 * Samples a 3D vector field (dx,dy,dz) = F(x,y,z) on a cubic lattice --
 * the 2D `sampleVectorField2D` pattern (sample-ode.ts) lifted one dimension,
 * with three independent expressions instead of a compiled ODE-system
 * function (there's no 3-variable analog of `compileSystem`/`OdeSystemSpec`
 * to reuse). `gridDensity` grows cubically (density^3 points), so it stays
 * small compared to `sampleVectorField2D`'s own default.
 */
export function sampleVectorField3D(
  exprDx: string,
  exprDy: string,
  exprDz: string,
  xDomain: Domain3D,
  yDomain: Domain3D,
  zDomain: Domain3D,
  gridDensity = 5,
): VectorField3DPoint[] {
  const compiledDx = Symbolic.compile(preprocessImplicitMultiplication(exprDx));
  const compiledDy = Symbolic.compile(preprocessImplicitMultiplication(exprDy));
  const compiledDz = Symbolic.compile(preprocessImplicitMultiplication(exprDz));
  const points: VectorField3DPoint[] = [];
  const env: Record<string, number> = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < gridDensity; i++) {
    const x = xDomain.min + (i / (gridDensity - 1)) * (xDomain.max - xDomain.min);
    for (let j = 0; j < gridDensity; j++) {
      const y = yDomain.min + (j / (gridDensity - 1)) * (yDomain.max - yDomain.min);
      for (let k = 0; k < gridDensity; k++) {
        const z = zDomain.min + (k / (gridDensity - 1)) * (zDomain.max - zDomain.min);
        env.x = x;
        env.y = y;
        env.z = z;
        const dx = compiledDx(env);
        const dy = compiledDy(env);
        const dz = compiledDz(env);
        if (Number.isFinite(dx) && Number.isFinite(dy) && Number.isFinite(dz)) points.push({ x, y, z, dx, dy, dz });
      }
    }
  }
  return points;
}
