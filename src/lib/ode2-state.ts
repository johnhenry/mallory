import { decodeStateFragment, encodeStateFragment } from "./url-fragment.ts";
/**
 * URL-state schema for Ode2Panel -- a flat dump of its 10 free string cells
 * (see cell-ids.ts's cellIdsOde2). Same shape/convention as ode-state.ts:
 * every cell is a plain user-editable field, no construction log needed.
 */
export interface Ode2StateV1 {
  v: 1;
  a: string;
  b: string;
  c: string;
  x0: string;
  y0: string;
  yPrime0: string;
  xMin: string;
  xMax: string;
  yMin: string;
  yMax: string;
}

/** One equation row (issue #251, unlimited expressions) -- the a/b/c/x0/y0/yPrime0 half of a v1 state, plus color/visibility. The x/y domain is shared across every row (v2's own `viewport`), same "shared viewport, per-row shape" split cellIdsImplicit's doc comment describes. */
export interface Ode2RowState {
  a: string;
  b: string;
  c: string;
  x0: string;
  y0: string;
  yPrime0: string;
  color: number;
  visible: boolean;
}

/** v2 (issue #251): unlimited equations sharing one x/y viewport, same "flat single state -> ordered rows" upgrade graph-state.ts's own v2->v3 migration used. */
export interface Ode2StateV2 {
  v: 2;
  xMin: string;
  xMax: string;
  yMin: string;
  yMax: string;
  rows: Ode2RowState[];
}

export type Ode2State = Ode2StateV2;

const DEFAULT_ROW: Ode2RowState = {
  a: "1",
  b: "0.4",
  c: "4",
  x0: "0",
  y0: "1",
  yPrime0: "0",
  color: 0x2563eb,
  visible: true,
};

/** Underdamped: disc = 0.4^2 - 4*1*4 = -15.84 < 0 -- decaying oscillation. */
export const DEFAULT_ODE2_STATE: Ode2State = {
  v: 2,
  xMin: "0",
  xMax: "10",
  yMin: "-1.5",
  yMax: "1.5",
  rows: [DEFAULT_ROW],
};

function upgradeV1ToV2(v1: Ode2StateV1): Ode2StateV2 {
  return {
    v: 2,
    xMin: v1.xMin,
    xMax: v1.xMax,
    yMin: v1.yMin,
    yMax: v1.yMax,
    rows: [{ a: v1.a, b: v1.b, c: v1.c, x0: v1.x0, y0: v1.y0, yPrime0: v1.yPrime0, color: 0x2563eb, visible: true }],
  };
}

export function encodeOde2State(state: Ode2State): string {
  return encodeStateFragment(state);
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. */
export function decodeOde2State(fragment: string): Ode2State | null {
  try {
    const parsed: unknown = decodeStateFragment(fragment);
    if (isOde2StateV2(parsed)) return parsed;
    if (isOde2StateV1(parsed)) return upgradeV1ToV2(parsed);
    return null;
  } catch {
    return null;
  }
}

export function isOde2StateV1(value: unknown): value is Ode2StateV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.v === 1 &&
    typeof v.a === "string" &&
    typeof v.b === "string" &&
    typeof v.c === "string" &&
    typeof v.x0 === "string" &&
    typeof v.y0 === "string" &&
    typeof v.yPrime0 === "string" &&
    typeof v.xMin === "string" &&
    typeof v.xMax === "string" &&
    typeof v.yMin === "string" &&
    typeof v.yMax === "string"
  );
}

export function isOde2StateV2(value: unknown): value is Ode2StateV2 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 2 || !Array.isArray(v.rows)) return false;
  if (typeof v.xMin !== "string" || typeof v.xMax !== "string" || typeof v.yMin !== "string" || typeof v.yMax !== "string") return false;
  const fields = ["a", "b", "c", "x0", "y0", "yPrime0"] as const;
  return v.rows.every((row) => {
    if (typeof row !== "object" || row === null) return false;
    const r = row as Record<string, unknown>;
    return fields.every((f) => typeof r[f] === "string") && typeof r.color === "number" && typeof r.visible === "boolean";
  });
}

