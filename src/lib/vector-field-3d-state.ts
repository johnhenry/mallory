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

export type VectorField3DState = VectorField3DStateV1;

export const DEFAULT_VECTOR_FIELD_3D_STATE: VectorField3DState = {
  v: 1,
  exprDx: "-y",
  exprDy: "x",
  exprDz: "0.2*z",
  xMin: "-2",
  xMax: "2",
  yMin: "-2",
  yMax: "2",
  zMin: "-2",
  zMax: "2",
};

export function encodeVectorField3DState(state: VectorField3DState): string {
  return base64UrlEncode(JSON.stringify(state));
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. */
export function decodeVectorField3DState(fragment: string): VectorField3DState | null {
  try {
    const parsed: unknown = JSON.parse(base64UrlDecode(fragment));
    return isVectorField3DStateV1(parsed) ? parsed : null;
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
