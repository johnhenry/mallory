import { decodeStateFragment, encodeStateFragment } from "./url-fragment.ts";
/**
 * URL-state schema for DiscretePanel -- the raw inputs only (see
 * cell-ids.ts's cellIdsDiscrete); every result cell is purely derived.
 */
export interface DiscreteStateV1 {
  v: 1;
  groupKind: "cyclic" | "symmetric";
  groupN: string;
  gcdA: string;
  gcdB: string;
  factorizeN: string;
  crtText: string;
}

export type DiscreteState = DiscreteStateV1;

export const DEFAULT_DISCRETE_STATE: DiscreteState = {
  v: 1,
  groupKind: "cyclic",
  groupN: "6",
  gcdA: "270",
  gcdB: "192",
  factorizeN: "360",
  crtText: "2,3\n3,5\n2,7",
};

export function encodeDiscreteState(state: DiscreteState): string {
  return encodeStateFragment(state);
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. */
export function decodeDiscreteState(fragment: string): DiscreteState | null {
  try {
    const parsed: unknown = decodeStateFragment(fragment);
    return isDiscreteStateV1(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isDiscreteStateV1(value: unknown): value is DiscreteStateV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 1 || (v.groupKind !== "cyclic" && v.groupKind !== "symmetric")) return false;
  const fields = ["groupN", "gcdA", "gcdB", "factorizeN", "crtText"] as const;
  return fields.every((f) => typeof v[f] === "string");
}

