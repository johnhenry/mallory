import { Symbolic } from "mallory-math";
import { preprocessImplicitMultiplication } from "./implicit-mult.ts";
import { sampleImplicitCurve, type ImplicitSegment } from "./sample-implicit.ts";
import type { Domain } from "./sample-function.ts";

export interface ContourLevel {
  level: number;
  segments: ImplicitSegment[];
}

/**
 * Finds `f`'s finite value range over a coarse `resolution`x`resolution`
 * grid -- just enough to pick sensible contour levels automatically,
 * not a rigorous global min/max (a genuinely spiky field could have a
 * narrower sampled range than its true extrema, same caveat any coarse
 * grid sample has).
 */
function sampleValueRange(compiled: (env: Record<string, number>) => number, xDomain: Domain, yDomain: Domain, xVar: string, yVar: string, resolution: number): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < resolution; i++) {
    const x = xDomain.min + (i / (resolution - 1)) * (xDomain.max - xDomain.min);
    for (let j = 0; j < resolution; j++) {
      const y = yDomain.min + (j / (resolution - 1)) * (yDomain.max - yDomain.min);
      const value = compiled({ [xVar]: x, [yVar]: y });
      if (!Number.isFinite(value)) continue;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
}

/**
 * Multi-level contour plot of a scalar field `f(xVar, yVar)`: `levelCount`
 * evenly-spaced level curves f(x,y)=c, strictly between f's sampled min and
 * max (the endpoints themselves are excluded -- a level exactly at the
 * field's extremum touches at most one point, not a traceable curve).
 * Reuses `sampleImplicitCurve` per level (the same marching-squares tracer
 * `ImplicitPanel`'s single f(x,y)=0 relation already uses), parameterized
 * by shifting the field down by each level constant -- `sampleImplicitCurve`
 * already handles turning a bare expression into implicit-zero form itself,
 * so this always passes a genuine "(f) - (c)" relation, never a bare
 * equation with its own "=" (contour input is a function, not a relation).
 */
export function computeContourLevels(
  exprText: string,
  xDomain: Domain,
  yDomain: Domain,
  resolution = 80,
  levelCount = 8,
  xVar = "x",
  yVar = "y",
): ContourLevel[] {
  const preprocessed = preprocessImplicitMultiplication(exprText);
  const compiled = Symbolic.compile(preprocessed, { declaredVariables: [xVar, yVar] });
  const range = sampleValueRange(compiled, xDomain, yDomain, xVar, yVar, Math.min(resolution, 40));
  if (!range) throw new Error("f(x,y) is not finite anywhere over the current domain.");
  const { min, max } = range;
  if (max - min < 1e-9) throw new Error("f(x,y) is constant over the current domain -- no contour levels to draw.");

  const levels: ContourLevel[] = [];
  for (let k = 1; k <= levelCount; k++) {
    const level = min + (k / (levelCount + 1)) * (max - min);
    const segments = sampleImplicitCurve(`(${preprocessed}) - (${level})`, xDomain, yDomain, resolution, xVar, yVar);
    levels.push({ level, segments });
  }
  return levels;
}
