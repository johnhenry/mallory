import { decodeStateFragment, encodeStateFragment } from "./url-fragment.ts";
import type { ComplexComponent } from "./sample-complex-graph.ts";

/**
 * URL-state schema for ComplexGraph3DPanel (issue #345) -- a flat dump of
 * its free cells (see cell-ids.ts's cellIdsComplexGraph3D). Single-object
 * v1, not the multi-row "unlimited expressions" shape SpaceCurvePanel/
 * ParametricSurfacePanel/OdePanel etc. use -- deliberate v1 scope match
 * with #345's own comment: this panel only supports the CURVE case (drop a
 * domain component) for now, and multi-curve overlay is a natural but
 * separate follow-up once the surface case (the other #345 follow-up)
 * clarifies what "another row" even means here.
 */
export interface ComplexGraphStateV1 {
  v: 1;
  yExpr: string;
  drop: ComplexComponent;
  axisX: ComplexComponent;
  axisY: ComplexComponent;
  axisZ: ComplexComponent;
  tMin: string;
  tMax: string;
}

export type ComplexGraphState = ComplexGraphStateV1;

/** y = e^(i*x): the issue's own worked example, so the panel opens already showing the spiral rather than a blank/degenerate default. */
export const DEFAULT_COMPLEX_GRAPH_STATE: ComplexGraphState = {
  v: 1,
  yExpr: "exp(i*x)",
  drop: "imX",
  axisX: "reX",
  axisY: "reY",
  axisZ: "imY",
  tMin: "0",
  tMax: String(4 * Math.PI),
};

export function encodeComplexGraphState(state: ComplexGraphState): string {
  return encodeStateFragment(state);
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. */
export function decodeComplexGraphState(fragment: string): ComplexGraphState | null {
  try {
    const parsed: unknown = decodeStateFragment(fragment);
    return isComplexGraphStateV1(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isComplexComponent(v: unknown): v is ComplexComponent {
  return v === "reX" || v === "imX" || v === "reY" || v === "imY";
}

export function isComplexGraphStateV1(value: unknown): value is ComplexGraphStateV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.v === 1 &&
    typeof v.yExpr === "string" &&
    isComplexComponent(v.drop) &&
    isComplexComponent(v.axisX) &&
    isComplexComponent(v.axisY) &&
    isComplexComponent(v.axisZ) &&
    typeof v.tMin === "string" &&
    typeof v.tMax === "string"
  );
}
