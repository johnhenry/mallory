import { decodeStateFragment, encodeStateFragment } from "./url-fragment.ts";
/**
 * URL-state schema for VectorField3DPanel -- a flat dump of its free string
 * cells (see cell-ids.ts's cellIdsVectorField3D). Same shape/convention as
 * parametric-surface-state.ts. Defaults to a swirling rotation-about-z field
 * with a slight z-drift, so the plot reads as genuinely 3D rather than a
 * flat 2D field extruded through z.
 */
export interface VectorField3DStateV1 {
  v: 1;
  exprDx: string;
  exprDy: string;
  exprDz: string;
  xMin: string;
  xMax: string;
  yMin: string;
  yMax: string;
  zMin: string;
  zMax: string;
}

/** One field row (issue #251, unlimited expressions) -- the exact shape of a v1 state, plus color/visibility. */
export interface VectorField3DRowState {
  exprDx: string;
  exprDy: string;
  exprDz: string;
  xMin: string;
  xMax: string;
  yMin: string;
  yMax: string;
  zMin: string;
  zMax: string;
  color: number;
  visible: boolean;
}

/** v2 (issue #251): unlimited fields, same "flat single state -> ordered rows" upgrade graph-state.ts's own v2->v3 migration used. */
export interface VectorField3DStateV2 {
  v: 2;
  rows: VectorField3DRowState[];
}

export type VectorField3DState = VectorField3DStateV2;

const DEFAULT_ROW: VectorField3DRowState = {
  exprDx: "-y",
  exprDy: "x",
  exprDz: "0.2*z",
  xMin: "-2",
  xMax: "2",
  yMin: "-2",
  yMax: "2",
  zMin: "-2",
  zMax: "2",
  color: 0x2563eb,
  visible: true,
};

export const DEFAULT_VECTOR_FIELD_3D_STATE: VectorField3DState = {
  v: 2,
  rows: [DEFAULT_ROW],
};

function upgradeV1ToV2(v1: VectorField3DStateV1): VectorField3DStateV2 {
  return {
    v: 2,
    rows: [
      {
        exprDx: v1.exprDx,
        exprDy: v1.exprDy,
        exprDz: v1.exprDz,
        xMin: v1.xMin,
        xMax: v1.xMax,
        yMin: v1.yMin,
        yMax: v1.yMax,
        zMin: v1.zMin,
        zMax: v1.zMax,
        color: 0x2563eb,
        visible: true,
      },
    ],
  };
}

export function encodeVectorField3DState(state: VectorField3DState): string {
  return encodeStateFragment(state);
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. */
export function decodeVectorField3DState(fragment: string): VectorField3DState | null {
  try {
    const parsed: unknown = decodeStateFragment(fragment);
    if (isVectorField3DStateV2(parsed)) return parsed;
    if (isVectorField3DStateV1(parsed)) return upgradeV1ToV2(parsed);
    return null;
  } catch {
    return null;
  }
}

export function isVectorField3DStateV1(value: unknown): value is VectorField3DStateV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 1) return false;
  const fields = ["exprDx", "exprDy", "exprDz", "xMin", "xMax", "yMin", "yMax", "zMin", "zMax"] as const;
  return fields.every((f) => typeof v[f] === "string");
}

export function isVectorField3DStateV2(value: unknown): value is VectorField3DStateV2 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 2 || !Array.isArray(v.rows)) return false;
  const fields = ["exprDx", "exprDy", "exprDz", "xMin", "xMax", "yMin", "yMax", "zMin", "zMax"] as const;
  return v.rows.every((row) => {
    if (typeof row !== "object" || row === null) return false;
    const r = row as Record<string, unknown>;
    return fields.every((f) => typeof r[f] === "string") && typeof r.color === "number" && typeof r.visible === "boolean";
  });
}

