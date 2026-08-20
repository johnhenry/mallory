import { decodeStateFragment, encodeStateFragment } from "./url-fragment.ts";
/**
 * URL-state schema for SystemSolverPanel -- a flat dump of its 2 free cells
 * (see cell-ids.ts's cellIdsSystem): an ordered equation-string list (order
 * is significant -- rows are indexed by array position, not id) and a
 * comma-separated variable-name string. No construction-log/replay needed.
 */
export interface SystemStateV1 {
  v: 1;
  equations: string[];
  variables: string;
}

export type SystemState = SystemStateV1;

export const DEFAULT_SYSTEM_STATE: SystemState = {
  v: 1,
  equations: ["2*x + 3*y = 12", "x - y = 1"],
  variables: "x,y",
};

export function encodeSystemState(state: SystemState): string {
  return encodeStateFragment(state);
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. */
export function decodeSystemState(fragment: string): SystemState | null {
  try {
    const parsed: unknown = decodeStateFragment(fragment);
    return isSystemStateV1(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isSystemStateV1(value: unknown): value is SystemStateV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 1 || typeof v.variables !== "string" || !Array.isArray(v.equations)) return false;
  return v.equations.every((e) => typeof e === "string");
}

