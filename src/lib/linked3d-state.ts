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
 *
 * v2 (#336 item 7): `pane2d` is untouched -- GraphCanvas/the 2D pane isn't
 * being touched by this port. `pane3d` lifts from a single surface to
 * unlimited overlaid surfaces (`rows`), mirroring every other panel's own
 * v1->v2 "flat state -> ordered rows" migration in this series. Each row
 * gets its own `color`/`visible` (mirroring every other multi-row panel's
 * row shape, e.g. ComplexGraphRowState/OdeSystemRowState) even though v1's
 * single surface never had a color of its own -- see Graph3DCanvas.tsx's
 * `seedGraph3DRow` for how a row's color feeds into its mesh's material via
 * `sampleSurface`'s own color param.
 */
export interface Linked3DStateV1 {
  v: 1;
  pane2d: { source: string; params: Record<string, number>; structureModulus: number | null };
  pane3d: { source: string; params: Record<string, number> };
  crossSectionY: number;
}

/** One overlaid surface row (v2, unlimited surfaces) -- a v1 state's own source/params, plus color/visibility. */
export interface Graph3DRowState {
  source: string;
  params: Record<string, number>;
  color: number;
  visible: boolean;
}

export interface Linked3DStateV2 {
  v: 2;
  pane2d: { source: string; params: Record<string, number>; structureModulus: number | null };
  pane3d: { rows: Graph3DRowState[] };
  crossSectionY: number;
}

export type Linked3DState = Linked3DStateV2;

export const DEFAULT_LINKED3D_STATE: Linked3DState = {
  v: 2,
  pane2d: { source: "sin(x)", params: {}, structureModulus: null },
  pane3d: { rows: [{ source: "sin(x)*cos(y)", params: {}, color: 0x2563eb, visible: true }] },
  crossSectionY: 0,
};

export function encodeLinked3DState(state: Linked3DState): string {
  return encodeStateFragment(state);
}

/** Exported for notebook-state.ts-style callers should this block type ever gain nested-state upgrading; used directly by decodeLinked3DState below. */
export function upgradeLinked3DV1ToV2(v1: Linked3DStateV1): Linked3DStateV2 {
  return {
    v: 2,
    pane2d: v1.pane2d,
    pane3d: { rows: [{ source: v1.pane3d.source, params: v1.pane3d.params, color: 0x2563eb, visible: true }] },
    crossSectionY: v1.crossSectionY,
  };
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. */
export function decodeLinked3DState(fragment: string): Linked3DState | null {
  try {
    const parsed: unknown = decodeStateFragment(fragment);
    if (isLinked3DStateV2(parsed)) return parsed;
    if (isLinked3DStateV1(parsed)) return upgradeLinked3DV1ToV2(parsed);
    return null;
  } catch {
    return null;
  }
}

function isRecordOfNumbers(v: unknown): v is Record<string, number> {
  return typeof v === "object" && v !== null && Object.values(v).every((n) => typeof n === "number");
}

function isPane2dV1(p2: Record<string, unknown>): boolean {
  return typeof p2.source === "string" && isRecordOfNumbers(p2.params) && (p2.structureModulus === null || typeof p2.structureModulus === "number");
}

export function isLinked3DStateV1(value: unknown): value is Linked3DStateV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 1 || typeof v.crossSectionY !== "number") return false;
  if (typeof v.pane2d !== "object" || v.pane2d === null) return false;
  if (typeof v.pane3d !== "object" || v.pane3d === null) return false;
  const p3 = v.pane3d as Record<string, unknown>;
  return isPane2dV1(v.pane2d as Record<string, unknown>) && typeof p3.source === "string" && isRecordOfNumbers(p3.params);
}

export function isLinked3DStateV2(value: unknown): value is Linked3DStateV2 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 2 || typeof v.crossSectionY !== "number") return false;
  if (typeof v.pane2d !== "object" || v.pane2d === null) return false;
  if (typeof v.pane3d !== "object" || v.pane3d === null) return false;
  const p3 = v.pane3d as Record<string, unknown>;
  if (!isPane2dV1(v.pane2d as Record<string, unknown>) || !Array.isArray(p3.rows)) return false;
  return p3.rows.every((row) => {
    if (typeof row !== "object" || row === null) return false;
    const r = row as Record<string, unknown>;
    return typeof r.source === "string" && isRecordOfNumbers(r.params) && typeof r.color === "number" && typeof r.visible === "boolean";
  });
}
