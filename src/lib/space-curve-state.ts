/**
 * URL-state schema for SpaceCurvePanel (issue #30 item 2) -- a flat dump of
 * its free string cells (see cell-ids.ts's cellIdsSpaceCurve). Same shape/
 * convention as vector-field-3d-state.ts. Defaults to a helix, so the plot
 * reads as genuinely 3D rather than a flat planar curve.
 */
export interface SpaceCurveStateV1 {
  v: 1;
  exprX: string;
  exprY: string;
  exprZ: string;
  tMin: string;
  tMax: string;
}

export type SpaceCurveState = SpaceCurveStateV1;

export const DEFAULT_SPACE_CURVE_STATE: SpaceCurveState = {
  v: 1,
  exprX: "cos(t)",
  exprY: "sin(t)",
  exprZ: "0.15*t",
  tMin: "0",
  tMax: String(4 * Math.PI),
};

export function encodeSpaceCurveState(state: SpaceCurveState): string {
  return base64UrlEncode(JSON.stringify(state));
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. */
export function decodeSpaceCurveState(fragment: string): SpaceCurveState | null {
  try {
    const parsed: unknown = JSON.parse(base64UrlDecode(fragment));
    return isSpaceCurveStateV1(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isSpaceCurveStateV1(value: unknown): value is SpaceCurveStateV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 1) return false;
  const fields = ["exprX", "exprY", "exprZ", "tMin", "tMax"] as const;
  return fields.every((f) => typeof v[f] === "string");
}

function base64UrlEncode(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(input: string): string {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
