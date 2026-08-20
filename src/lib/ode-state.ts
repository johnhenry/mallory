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

export type OdeState = OdeStateV1;

export const DEFAULT_ODE_STATE: OdeState = {
  v: 1,
  expr: "x - y",
  x0: "0",
  y0: "1",
  xMin: "-5",
  xMax: "5",
  yMin: "-5",
  yMax: "5",
};

export function encodeOdeState(state: OdeState): string {
  return encodeStateFragment(state);
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. */
export function decodeOdeState(fragment: string): OdeState | null {
  try {
    const parsed: unknown = decodeStateFragment(fragment);
    return isOdeStateV1(parsed) ? parsed : null;
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

