import { decodeStateFragment, encodeStateFragment } from "./url-fragment.ts";
/**
 * URL-state schema for OdePanel -- a flat dump of its 7 free string cells
 * (see cell-ids.ts's cellIdsOde). No construction-log/replay needed (unlike
 * geometry-state.ts): every cell here is a plain user-editable field with no
 * dynamically-created dependent structure. Same base64url-in-the-hash
 * convention as graph-state.ts/multi-graph-state.ts.
 */
export interface OdeStateV1 {
  v: 1;
  expr: string;
  x0: string;
  y0: string;
  xMin: string;
  xMax: string;
  yMin: string;
  yMax: string;
}

/** One initial-value-problem row (#336 item 7, unlimited expressions) -- the expr/x0/y0 half of a v1 state, plus color/visibility. The x/y domain is shared across every row (v2's own top-level xMin/xMax/yMin/yMax), same "shared viewport, per-row shape" split ode2-state.ts's own v1->v2 migration used. */
export interface OdeRowState {
  expr: string;
  x0: string;
  y0: string;
  color: number;
  visible: boolean;
}

/** v2 (#336 item 7): unlimited initial-value problems sharing one x/y domain, same "flat single state -> ordered rows" upgrade ode2-state.ts's own v1->v2 migration used. */
export interface OdeStateV2 {
  v: 2;
  xMin: string;
  xMax: string;
  yMin: string;
  yMax: string;
  rows: OdeRowState[];
}

export type OdeState = OdeStateV2;

const DEFAULT_ROW: OdeRowState = {
  expr: "x - y",
  x0: "0",
  y0: "1",
  color: 0x2563eb,
  visible: true,
};

export const DEFAULT_ODE_STATE: OdeState = {
  v: 2,
  xMin: "-5",
  xMax: "5",
  yMin: "-5",
  yMax: "5",
  rows: [DEFAULT_ROW],
};

/** Exported for notebook-state.ts's own "ode" block upgrade -- notebook blocks nest this panel's state type directly rather than re-declaring its version history, so they need the same v1->v2 migration this file's own decodeOdeState applies. */
export function upgradeOdeV1ToV2(v1: OdeStateV1): OdeStateV2 {
  return {
    v: 2,
    xMin: v1.xMin,
    xMax: v1.xMax,
    yMin: v1.yMin,
    yMax: v1.yMax,
    rows: [{ expr: v1.expr, x0: v1.x0, y0: v1.y0, color: 0x2563eb, visible: true }],
  };
}

export function encodeOdeState(state: OdeState): string {
  return encodeStateFragment(state);
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. */
export function decodeOdeState(fragment: string): OdeState | null {
  try {
    const parsed: unknown = decodeStateFragment(fragment);
    if (isOdeStateV2(parsed)) return parsed;
    if (isOdeStateV1(parsed)) return upgradeOdeV1ToV2(parsed);
    return null;
  } catch {
    return null;
  }
}

export function isOdeStateV1(value: unknown): value is OdeStateV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.v === 1 &&
    typeof v.expr === "string" &&
    typeof v.x0 === "string" &&
    typeof v.y0 === "string" &&
    typeof v.xMin === "string" &&
    typeof v.xMax === "string" &&
    typeof v.yMin === "string" &&
    typeof v.yMax === "string"
  );
}

export function isOdeStateV2(value: unknown): value is OdeStateV2 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 2 || !Array.isArray(v.rows)) return false;
  if (typeof v.xMin !== "string" || typeof v.xMax !== "string" || typeof v.yMin !== "string" || typeof v.yMax !== "string") return false;
  return v.rows.every((row) => {
    if (typeof row !== "object" || row === null) return false;
    const r = row as Record<string, unknown>;
    return (
      typeof r.expr === "string" &&
      typeof r.x0 === "string" &&
      typeof r.y0 === "string" &&
      typeof r.color === "number" &&
      typeof r.visible === "boolean"
    );
  });
}
