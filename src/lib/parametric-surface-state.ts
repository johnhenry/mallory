import { decodeStateFragment, encodeStateFragment } from "./url-fragment.ts";
/**
 * URL-state schema for ParametricSurfacePanel -- a flat dump of its free
 * string cells (see cell-ids.ts's cellIdsParametricSurface). Same shape/
 * convention as series-state.ts. Defaults to the torus preset.
 */
export interface ParametricSurfaceStateV1 {
  v: 1;
  exprX: string;
  exprY: string;
  exprZ: string;
  uMin: string;
  uMax: string;
  vMin: string;
  vMax: string;
}

/** One surface row (issue #251, unlimited expressions) -- the exact shape of a v1 state, plus color/visibility. */
export interface ParametricSurfaceRowState {
  exprX: string;
  exprY: string;
  exprZ: string;
  uMin: string;
  uMax: string;
  vMin: string;
  vMax: string;
  color: number;
  visible: boolean;
}

/** v2 (issue #251): unlimited surfaces, same "flat single state -> ordered rows" upgrade graph-state.ts's own v2->v3 migration used. */
export interface ParametricSurfaceStateV2 {
  v: 2;
  rows: ParametricSurfaceRowState[];
}

export type ParametricSurfaceState = ParametricSurfaceStateV2;

const DEFAULT_ROW: ParametricSurfaceRowState = {
  exprX: "(2+cos(v))*cos(u)",
  exprY: "(2+cos(v))*sin(u)",
  exprZ: "sin(v)",
  uMin: "0",
  uMax: "6.28318",
  vMin: "0",
  vMax: "6.28318",
  color: 0x2563eb,
  visible: true,
};

export const DEFAULT_PARAMETRIC_SURFACE_STATE: ParametricSurfaceState = {
  v: 2,
  rows: [DEFAULT_ROW],
};

function upgradeV1ToV2(v1: ParametricSurfaceStateV1): ParametricSurfaceStateV2 {
  return {
    v: 2,
    rows: [
      {
        exprX: v1.exprX,
        exprY: v1.exprY,
        exprZ: v1.exprZ,
        uMin: v1.uMin,
        uMax: v1.uMax,
        vMin: v1.vMin,
        vMax: v1.vMax,
        color: 0x2563eb,
        visible: true,
      },
    ],
  };
}

export function encodeParametricSurfaceState(state: ParametricSurfaceState): string {
  return encodeStateFragment(state);
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. */
export function decodeParametricSurfaceState(fragment: string): ParametricSurfaceState | null {
  try {
    const parsed: unknown = decodeStateFragment(fragment);
    if (isParametricSurfaceStateV2(parsed)) return parsed;
    if (isParametricSurfaceStateV1(parsed)) return upgradeV1ToV2(parsed);
    return null;
  } catch {
    return null;
  }
}

export function isParametricSurfaceStateV1(value: unknown): value is ParametricSurfaceStateV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 1) return false;
  const fields = ["exprX", "exprY", "exprZ", "uMin", "uMax", "vMin", "vMax"] as const;
  return fields.every((f) => typeof v[f] === "string");
}

export function isParametricSurfaceStateV2(value: unknown): value is ParametricSurfaceStateV2 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 2 || !Array.isArray(v.rows)) return false;
  const fields = ["exprX", "exprY", "exprZ", "uMin", "uMax", "vMin", "vMax"] as const;
  return v.rows.every((row) => {
    if (typeof row !== "object" || row === null) return false;
    const r = row as Record<string, unknown>;
    return fields.every((f) => typeof r[f] === "string") && typeof r.color === "number" && typeof r.visible === "boolean";
  });
}

