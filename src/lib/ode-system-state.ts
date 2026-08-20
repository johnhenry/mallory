import { decodeStateFragment, encodeStateFragment } from "./url-fragment.ts";
/**
 * URL-state schema for OdeSystemPanel -- a flat dump of its 11 free string
 * cells (see cell-ids.ts's cellIdsOdeSystem). Same shape/convention as
 * ode-state.ts: no construction-log/replay needed, plain user-editable
 * fields only.
 */
export interface OdeSystemStateV1 {
  v: 1;
  exprX: string;
  exprY: string;
  t0: string;
  x0: string;
  y0: string;
  tMin: string;
  tMax: string;
  xMin: string;
  xMax: string;
  yMin: string;
  yMax: string;
}

/**
 * One coupled-system row (unlimited overlaid systems, mirroring OdePanel's
 * own v1->v2 migration): the exprX/exprY/t0/x0/y0/tMin/tMax half of a v1
 * state -- its own trajectory -- plus color/visibility. The phase-plane
 * viewport (v2's own top-level xMin/xMax/yMin/yMax) is shared across every
 * row, same "shared viewport, per-row shape" split ode-state.ts's own
 * v1->v2 migration used.
 */
export interface OdeSystemRowState {
  exprX: string;
  exprY: string;
  t0: string;
  x0: string;
  y0: string;
  tMin: string;
  tMax: string;
  color: number;
  visible: boolean;
}

/**
 * v2: unlimited coupled systems sharing one x/y phase-plane domain, same
 * "flat single state -> ordered rows" upgrade ode-state.ts's own v1->v2
 * migration used.
 */
export interface OdeSystemStateV2 {
  v: 2;
  xMin: string;
  xMax: string;
  yMin: string;
  yMax: string;
  rows: OdeSystemRowState[];
}

export type OdeSystemState = OdeSystemStateV2;

const DEFAULT_ROW: OdeSystemRowState = {
  exprX: "x*(1-y)",
  exprY: "y*(x-1)",
  t0: "0",
  x0: "2",
  y0: "1",
  tMin: "0",
  tMax: "15",
  color: 0x2563eb,
  visible: true,
};

export const DEFAULT_ODE_SYSTEM_STATE: OdeSystemState = {
  v: 2,
  xMin: "0",
  xMax: "3",
  yMin: "0",
  yMax: "3",
  rows: [DEFAULT_ROW],
};

/** Exported for notebook-state.ts's own "ode-system" block upgrade -- notebook blocks nest this panel's state type directly rather than re-declaring its version history, so they need the same v1->v2 migration this file's own decodeOdeSystemState applies. */
export function upgradeOdeSystemV1ToV2(v1: OdeSystemStateV1): OdeSystemStateV2 {
  return {
    v: 2,
    xMin: v1.xMin,
    xMax: v1.xMax,
    yMin: v1.yMin,
    yMax: v1.yMax,
    rows: [
      {
        exprX: v1.exprX,
        exprY: v1.exprY,
        t0: v1.t0,
        x0: v1.x0,
        y0: v1.y0,
        tMin: v1.tMin,
        tMax: v1.tMax,
        color: 0x2563eb,
        visible: true,
      },
    ],
  };
}

export function encodeOdeSystemState(state: OdeSystemState): string {
  return encodeStateFragment(state);
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. */
export function decodeOdeSystemState(fragment: string): OdeSystemState | null {
  try {
    const parsed: unknown = decodeStateFragment(fragment);
    if (isOdeSystemStateV2(parsed)) return parsed;
    if (isOdeSystemStateV1(parsed)) return upgradeOdeSystemV1ToV2(parsed);
    return null;
  } catch {
    return null;
  }
}

export function isOdeSystemStateV1(value: unknown): value is OdeSystemStateV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const fields = ["exprX", "exprY", "t0", "x0", "y0", "tMin", "tMax", "xMin", "xMax", "yMin", "yMax"] as const;
  return v.v === 1 && fields.every((f) => typeof v[f] === "string");
}

export function isOdeSystemStateV2(value: unknown): value is OdeSystemStateV2 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 2 || !Array.isArray(v.rows)) return false;
  if (typeof v.xMin !== "string" || typeof v.xMax !== "string" || typeof v.yMin !== "string" || typeof v.yMax !== "string") return false;
  const fields = ["exprX", "exprY", "t0", "x0", "y0", "tMin", "tMax"] as const;
  return v.rows.every((row) => {
    if (typeof row !== "object" || row === null) return false;
    const r = row as Record<string, unknown>;
    return fields.every((f) => typeof r[f] === "string") && typeof r.color === "number" && typeof r.visible === "boolean";
  });
}
