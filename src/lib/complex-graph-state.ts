import { decodeStateFragment, encodeStateFragment } from "./url-fragment.ts";
import { isAxisChoice, type AxisChoice } from "./sample-complex-graph.ts";

/**
 * URL-state schema for ComplexGraph3DPanel (issue #345) -- a flat dump of
 * its free cells (see cell-ids.ts's cellIdsComplexGraph3D). Single-object
 * v1, not the multi-row "unlimited expressions" shape SpaceCurvePanel/
 * ParametricSurfacePanel/OdePanel etc. use -- deliberate v1 scope match
 * with #345's own comment: this panel only supports the CURVE case (drop a
 * domain component) for now, and multi-curve overlay is a natural but
 * separate follow-up once the surface case (the other #345 follow-up)
 * clarifies what "another row" even means here.
 *
 * No separate `drop` field -- the dropped component is derived from
 * whichever of Re(x)/Im(x)/Re(y)/Im(y) ISN'T one of axisX/axisY/axisZ (see
 * sample-complex-graph.ts's `droppedComponent`). A very early version of
 * this schema had an explicit `drop` field; removed before this ever
 * shipped anywhere reachable, so no migration is needed -- a stray `drop`
 * key in an old fragment is simply ignored (extra keys don't fail
 * validation), so nothing breaks either way.
 *
 * Each axis is `AxisChoice` (a real component, or `"none"`) rather than
 * always-assigned `ComplexComponent` -- a follow-up UI fix: the first
 * version's dropdowns disabled any choice that would violate the "exactly
 * one domain component" curve-validity rule directly at the UI layer, on
 * the theory that an unreachable state is better than a confusing one. In
 * practice that made a perfectly fine reassignment (moving Im(x) from
 * Axis Z to Axis X, say) look stuck, since the OLD value briefly didn't
 * free up until the intermediate state passed the same strict check.
 * Axes now freely take any of the 4 components (duplicates still blocked)
 * or "none"; the domain-count rule moved to be a plain error message at
 * the sampling layer instead of a UI gate (see ComplexGraph3DPanel.tsx).
 */
export interface ComplexGraphStateV1 {
  v: 1;
  yExpr: string;
  axisX: AxisChoice;
  axisY: AxisChoice;
  axisZ: AxisChoice;
  tMin: string;
  tMax: string;
}

export type ComplexGraphState = ComplexGraphStateV1;

/** y = e^(i*x): the issue's own worked example, so the panel opens already showing the spiral rather than a blank/degenerate default. */
export const DEFAULT_COMPLEX_GRAPH_STATE: ComplexGraphState = {
  v: 1,
  yExpr: "exp(i*x)",
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

export function isComplexGraphStateV1(value: unknown): value is ComplexGraphStateV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.v === 1 &&
    typeof v.yExpr === "string" &&
    isAxisChoice(v.axisX) &&
    isAxisChoice(v.axisY) &&
    isAxisChoice(v.axisZ) &&
    typeof v.tMin === "string" &&
    typeof v.tMax === "string"
  );
}
