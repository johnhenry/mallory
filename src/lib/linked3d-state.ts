import { decodeStateFragment, encodeStateFragment } from "./url-fragment.ts";
/**
 * URL-state schema for Linked3DView -- combines a 2D pane's state (cellIds's
 * shape, same fields as graph-state.ts's per-cell schema) with a 3D pane's
 * state (cellIds3D's smaller shape: no point/exact/structure/scatter/
 * derivative) plus the cross-pane `crossSectionY` link, all sharing one URL
 * fragment. No existing schema combines both pane shapes, so this is a new,
 * bespoke module rather than an extension of graph-state.ts (whose v3
 * multi-cell design assumes every cell is a 2D `cellIds` pane) or
 * multi-graph-state.ts (whose rows are yet another, unrelated shape).
 * `mode` (float/exact) isn't captured: GraphCanvas has no prop to set its
 * initial mode from outside, the same pre-existing limitation
 * LinkedGraphPanes's own panes already have.
 */
export interface Linked3DStateV1 {
  v: 1;
  pane2d: { source: string; params: Record<string, number>; structureModulus: number | null };
  pane3d: { source: string; params: Record<string, number> };
  crossSectionY: number;
}

export type Linked3DState = Linked3DStateV1;

export const DEFAULT_LINKED3D_STATE: Linked3DState = {
  v: 1,
  pane2d: { source: "sin(x)", params: {}, structureModulus: null },
  pane3d: { source: "sin(x)*cos(y)", params: {} },
  crossSectionY: 0,
};

export function encodeLinked3DState(state: Linked3DState): string {
  return encodeStateFragment(state);
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. */
export function decodeLinked3DState(fragment: string): Linked3DState | null {
  try {
    const parsed: unknown = decodeStateFragment(fragment);
    return isLinked3DStateV1(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecordOfNumbers(v: unknown): v is Record<string, number> {
  return typeof v === "object" && v !== null && Object.values(v).every((n) => typeof n === "number");
}

function isLinked3DStateV1(value: unknown): value is Linked3DStateV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 1 || typeof v.crossSectionY !== "number") return false;
  if (typeof v.pane2d !== "object" || v.pane2d === null) return false;
  if (typeof v.pane3d !== "object" || v.pane3d === null) return false;
  const p2 = v.pane2d as Record<string, unknown>;
  const p3 = v.pane3d as Record<string, unknown>;
  return (
    typeof p2.source === "string" &&
    isRecordOfNumbers(p2.params) &&
    (p2.structureModulus === null || typeof p2.structureModulus === "number") &&
    typeof p3.source === "string" &&
    isRecordOfNumbers(p3.params)
  );
}

